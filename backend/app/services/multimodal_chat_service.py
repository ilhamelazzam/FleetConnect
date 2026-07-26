from __future__ import annotations

import asyncio
import hashlib
import io
import json
import logging
import re
import time
import unicodedata
from dataclasses import dataclass, replace
from datetime import datetime, timedelta

from fastapi import Request
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.schemas.chat import (
    ChatAlertIntelligence,
    ChatAlertTimelineItem,
    ChatContextMessage,
    ChatDecisionRecommendation,
    ChatEquipmentDetails,
    ChatImageAnnotation,
    ChatImageResponse,
    ChatImageAnalysisMetadata,
    ChatIncidentDetails,
    ChatInvoiceCostItem,
    ChatInvoiceDetails,
    ChatWorkflowDetails,
)
from app.services.business_answer_quality_service import (
    is_generic_business_phrase,
    polish_chat_image_response,
    normalize_business_risk_score,
    normalize_business_score_label,
    polish_business_items,
    polish_business_text,
)
from app.services.chat_service import (
    ChatServerError,
    ChatServiceError,
    ImageAnalysisTimeoutError,
    LocalModelUnavailableError,
    MemoryPressureError,
    RequestCancelledError,
    VisionUnavailableError,
    _build_response,
    _derive_title_hint,
    _elapsed_ms,
    _ensure_request_connected,
    _finalize_answer,
    _generate_with_ollama,
    _log_chat_event,
    _truncate,
    _utcnow,
    get_data_summary,
)
from app.services.dashboard_analysis_service import DashboardAnalysisResult, analyze_dashboard_image
from app.services.customer_churn_service import get_customer_churn_overview
from app.services.cdr_analytics_service import get_cdr_overview
from app.services.image_annotation_service import ImageAnnotationResult, build_image_annotations
from app.services.image_preprocessing_service import PreparedImage, PreparedImageChunk, prepare_image_for_analysis
from app.services.mobile_fleet_service import get_mobile_fleet_overview
from app.services.ocr_service import (
    IncidentDocumentDetails,
    InvoiceCostItem,
    InvoiceDocumentDetails,
    OcrExtractionResult,
    EquipmentDocumentDetails,
    WorkflowDocumentDetails,
    _detect_alert_lines,
    _detect_departments,
    _detect_kpis,
    _detect_operators,
    _detect_visible_tables,
    _extract_incident_details,
    _extract_invoice_details,
    extract_image_ocr,
)
from app.services.recommendation_engine_service import (
    DecisionRecommendation,
    RecommendationEngineResult,
    build_decision_recommendations,
)
from app.services.vision_service import (
    VisionAnalysisResult,
    analyze_image_with_llava,
    is_vision_model_available,
)
from app.services.image_context_strict_service import (
    ExtractedValues,
    ImageAnalysisMetadata,
    build_extracted_values_from_ocr,
    build_image_analysis_metadata,
    filter_recommendation_strings,
    filter_unverified_claims,
    should_use_strict_mode,
)

MULTIMODAL_LOGGER = logging.getLogger("app.chat.multimodal")

EQUIPMENT_ROUTING_MODE_VISION_ONLY = "vision_only"
EQUIPMENT_ROUTING_MODE_FUSION = "vision_business_fusion"
QUESTION_TYPE_STANDARD = "STANDARD"
QUESTION_TYPE_EQUIPMENT_DETECTION = "EQUIPMENT_DETECTION"
EQUIPMENT_CONFIDENCE_CONFIRMED = "Confirme"
EQUIPMENT_CONFIDENCE_PROBABLE = "Probable"
EQUIPMENT_CONFIDENCE_UNCERTAIN = "Incertain"
EQUIPMENT_UNKNOWN_OBJECT_LABEL = "Objet non identifie avec certitude"
EQUIPMENT_NO_REPLACEMENT_NOTICE = "Aucun signe visuel ne justifie un remplacement immediat."
EQUIPMENT_CONDITIONAL_MODERNIZATION_NOTICE = (
    "Une modernisation peut etre etudiee uniquement si les besoins de debit, de couverture ou de disponibilite le justifient."
)
EQUIPMENT_VISUAL_READING_NOTICE = "Voici une lecture visuelle prudente des equipements visibles."
EQUIPMENT_GENERIC_FALLBACK_NOTICE = "Analyse prudente basee uniquement sur les elements visibles."
EQUIPMENT_GENERIC_CATEGORY_NOTICE = (
    "Les references exactes ne sont pas toutes lisibles ; l'analyse reste donc prudente."
)
EQUIPMENT_GENERIC_USAGE_NOTICE = "Usage estime selon la categorie visible."
STRICT_ROUTER_ONLY_VISIBLE_TYPE_KEYS = {
    "routeur_wifi",
    "routeur",
    "antennes_reseau",
    "boitier_reseau",
    "voyant_ports",
}
STRICT_ROUTER_ONLY_NON_VISIBLE_KEYWORDS = (
    "modem usb",
    "modems usb",
    "usb modem",
    "cle 4g",
    "cle 5g",
    "dongle",
    "carte sim",
    "cartes sim",
    "nano sim",
    "micro sim",
    "mini sim",
    "esim",
    "switch",
    "borne wifi",
    "borne wi fi",
    "access point",
    "wifi access point",
    "cable reseau",
    "cable ethernet",
    "cable lan",
    "cable rj45",
    "ethernet cable",
    "antenne telecom",
    "antenne radio",
    "antenne externe",
)
STRICT_ROUTER_ONLY_REMOVAL_LABELS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("Modem USB", ("modem usb", "modems usb", "usb modem", "cle 4g", "cle 5g", "dongle")),
    ("Carte SIM", ("carte sim", "cartes sim", "nano sim", "micro sim", "mini sim", "esim")),
    ("Switch", ("switch", "ethernet switch", "catalyst")),
    ("Borne WiFi", ("borne wifi", "bornes wifi", "borne wi fi", "access point", "wifi access point")),
    ("Antenne telecom", ("antenne telecom", "antennes telecom", "antenne radio", "antenne externe")),
    ("Cable reseau", ("cable reseau", "cable ethernet", "cable lan", "cable rj45", "ethernet cable")),
)
STRICT_ROUTER_ONLY_EXTRA_VISIBLE_HINTS = (
    "modem usb",
    "modems usb",
    "usb modem",
    "cle 4g",
    "cle 5g",
    "dongle",
    "carte sim",
    "cartes sim",
    "nano sim",
    "micro sim",
    "mini sim",
    "esim",
    "switch",
    "ethernet switch",
    "borne wifi",
    "bornes wifi",
    "borne wi fi",
    "access point",
    "wifi access point",
    "antenne telecom",
    "antennes telecom",
    "cable reseau",
    "cable ethernet",
    "cable lan",
    "cable rj45",
)
EQUIPMENT_NEUTRAL_PRIMARY_VISIBLE_LABEL = "Objet principal visible non confirme automatiquement"
EQUIPMENT_NEUTRAL_CONTEXT_VISIBLE_LABEL = "Environnement ou support visible"
EQUIPMENT_NEUTRAL_USAGE_NOTICE = "Fonction exacte non confirmee automatiquement a partir de l'image."
EQUIPMENT_NEUTRAL_CONFIDENCE_NOTICE = (
    "Faible a moyen, car l'analyse automatique n'a pas confirme les categories."
)
GENERIC_VISIBLE_VEHICLE_LABEL = "Vehicule apparent"
GENERIC_VISIBLE_WHEELS_LABEL = "Roues visibles"
GENERIC_VISIBLE_BODY_LABEL = "Carrosserie visible"
GENERIC_VISIBLE_PARKING_LABEL = "Zone de stationnement visible"
GENERIC_VISIBLE_OUTDOOR_LABEL = "Environnement exterieur visible"
GENERIC_VISIBLE_WIFI_ROUTER_LABEL = "Routeur Wi-Fi apparent"
GENERIC_VISIBLE_NETWORK_ANTENNAS_LABEL = "Antennes reseau visibles"
GENERIC_VISIBLE_NETWORK_CHASSIS_LABEL = "Boitier reseau visible"
GENERIC_VISIBLE_NETWORK_PORTS_LABEL = "Voyants ou ports apparents"
GENERIC_VISIBLE_USB_MODEM_LABEL = "Modem USB apparent"
GENERIC_VISIBLE_MOBILE_CONNECTIVITY_CHASSIS_LABEL = "Boitier de connectivite mobile visible"
GENERIC_VISIBLE_FURNITURE_LABEL = "Mobilier apparent"
GENERIC_VISIBLE_IT_LABEL = "Materiel informatique apparent"
GENERIC_VISIBLE_INDUSTRIAL_LABEL = "Machine ou equipement industriel apparent"
EQUIPMENT_FALLBACK_PARTIAL_NOTICE = (
    "Analyse visuelle avancee indisponible, reponse basee sur une detection visuelle limitee."
)
EQUIPMENT_QUALITY_REVIEW_NOTICE = (
    "Une vue plus detaillee peut etre utile pour confirmer certaines references exactes."
)
EQUIPMENT_LOW_QUALITY_SCORE_THRESHOLD = 0.26
VISIBLE_ONLY_FALLBACK_SOURCE_MODE = "visible_only_fallback"
VISIBLE_ONLY_FALLBACK_REVIEW_NOTICE = (
    "Une verification technique complementaire est recommandee si l'image reste insuffisamment detaillee."
)
VISIBLE_ONLY_FALLBACK_MODERNIZATION_NOTICE = (
    "Une modernisation peut etre etudiee selon les besoins operationnels, mais un remplacement ne peut etre envisage qu'apres inspection complementaire."
)
VISUAL_EQUIPMENT_DETECTION_FAILURE_MESSAGE = (
    "Analyse visuelle indisponible actuellement. Aucun equipement n'a pu etre identifie avec un niveau de confiance suffisant."
)
VISUAL_EQUIPMENT_DETECTION_PHRASES = (
    "identifie",
    "detecte",
    "que vois tu",
    "quels equipements",
    "analyse cette image",
    "quels objets",
    "quel appareil",
    "remplacer",
    "remplacement",
    "moderniser",
    "modernisation",
)
PHYSICAL_EQUIPMENT_OBJECT_KEYWORDS = (
    "equipement",
    "equipements",
    "materiel",
    "appareil",
    "appareils",
    "objet",
    "objets",
    "routeur",
    "router",
    "modem",
    "smartphone",
    "telephone",
    "carte sim",
    "sim",
    "nano sim",
    "micro sim",
    "mini sim",
    "esim",
    "cle 4g",
    "dongle",
    "serveur",
    "server",
    "imprimante",
    "printer",
    "ordinateur",
    "laptop",
    "pc",
    "machine",
    "vehicule",
    "vehicle",
    "infrastructure",
    "switch",
    "antenne",
    "borne wifi",
)
PHYSICAL_EQUIPMENT_INTENT_PHRASES = (
    "a quoi servent",
    "a quoi sert",
    "role des equipements",
    "role de chaque equipement",
    "fonction des equipements",
    "analyse du materiel",
    "analyse le materiel",
    "analyse du materiel present",
    "inventaire du materiel",
    "inventaire visuel du materiel",
    "decrire les objets visibles",
    "decris les objets visibles",
    "decris le role",
    "explique l utilisation",
    "explique l utilisation de ce materiel",
    "utilisation de ce materiel",
    "materiel present",
)
PHYSICAL_EQUIPMENT_IDENTIFICATION_PHRASES = (
    "quel est l equipement",
    "quel equipement",
    "quel est l appareil",
    "quel appareil",
    "quel est le materiel",
    "quel materiel",
)
PHYSICAL_EQUIPMENT_VISUAL_CONTEXT_PHRASES = (
    "sur cette photo",
    "sur la photo",
    "sur cette image",
    "sur l image",
    "present sur cette photo",
    "present sur la photo",
    "present sur cette image",
    "present sur l image",
    "visible sur cette photo",
    "visible sur la photo",
    "visible sur cette image",
    "visible sur l image",
)
PHYSICAL_EQUIPMENT_VISUAL_ROUTING_HINTS = (
    "huawei",
    "samsung",
    "iphone",
    "lte",
    "4g",
    "5g",
    "maroc telecom",
    "inwi",
    "orange",
    "usb",
)
TELECOM_EQUIPMENT_VISIBLE_HINTS = (
    "sim",
    "4g",
    "lte",
    "wifi",
    "wi fi",
    "routeur",
    "router",
    "modem",
    "huawei",
    "samsung",
    "inwi",
    "maroc telecom",
)
GENERIC_FALLBACK_FILENAME_HINTS: dict[str, tuple[str, ...]] = {
    "vehicule": ("vehicule", "vehicle", "voiture", "car", "auto", "truck", "camion", "parking", "garage"),
    "network": ("routeur", "router", "wifi", "wi-fi", "modem", "gateway", "cpe", "antenne"),
    "informatique": ("ordinateur", "computer", "laptop", "pc", "keyboard", "clavier", "screen", "monitor", "ecran"),
    "mobilier": ("bureau", "desk", "chair", "chaise", "table", "mobilier", "fauteuil"),
    "industriel": ("machine", "industrial", "usine", "atelier", "conveyor", "moteur", "panneau"),
    "exterieur": ("parking", "garage", "street", "road", "exterieur", "outdoor", "mur", "wall"),
}
EQUIPMENT_BUSINESS_FUSION_KEYWORDS = (
    "roaming",
    "cout",
    "coût",
    "budget",
    "forfait",
    "consommation",
    "quota",
    "depassement",
    "dépassement",
    "kpi",
    "anomalie",
    "alert",
    "alerte",
    "fraude",
    "ligne",
    "lignes",
    "flotte",
    "departement",
    "département",
    "csv",
    "dataset",
    "historique",
    "tendance",
    "usage mensuel",
)
EQUIPMENT_BRAND_HINTS = (
    "Samsung",
    "Apple",
    "Huawei",
    "Cisco",
    "ZTE",
    "Nokia",
    "Juniper",
    "Ubiquiti",
    "MikroTik",
    "TP-Link",
    "D-Link",
    "Netgear",
    "Fortinet",
    "Aruba",
    "Xiaomi",
    "Oppo",
    "Vivo",
    "Lenovo",
    "Dell",
)
EQUIPMENT_OPERATOR_HINTS = (
    "Maroc Telecom",
    "Inwi",
    "Orange",
)
USB_MODEM_RECLASSIFICATION_BRANDS = ("HUAWEI", "ZTE", "ALCATEL", "D-LINK")
USB_MODEM_RECLASSIFICATION_BRAND_ALIASES = {
    "HUAWEI": ("huawei",),
    "ZTE": ("zte",),
    "ALCATEL": ("alcatel",),
    "D-LINK": ("d link", "dlink", "d-link"),
}
USB_MODEM_LLAVA_HINTS = (
    "usb modem",
    "dongle",
    "modem",
    "cle 4g",
    "mobile broadband",
)
USB_MODEM_RECLASSIFICATION_SCORE_THRESHOLD = 0.7
VISION_IMAGE_CACHE_TTL = timedelta(minutes=30)
VISION_IMAGE_CACHE_MAX_ENTRIES = 96

try:  # pragma: no cover - optional runtime dependency
    import fitz  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover - optional runtime dependency
    fitz = None

try:  # pragma: no cover - optional runtime dependency
    import pdfplumber  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover - optional runtime dependency
    pdfplumber = None

try:  # pragma: no cover - optional runtime dependency
    import cv2  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover - optional runtime dependency
    cv2 = None

try:  # pragma: no cover - optional runtime dependency
    import numpy as np  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover - optional runtime dependency
    np = None

try:  # pragma: no cover - optional runtime dependency
    from PIL import Image as PilImage, UnidentifiedImageError  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover - optional runtime dependency
    PilImage = None
    UnidentifiedImageError = Exception


@dataclass(frozen=True)
class FinalImageAnswer:
    answer: str
    detected_kpis: list[str]
    recommendations: list[str]
    detected_anomalies: list[str]
    probable_causes: list[str]
    severity: str | None
    treatment_priority: str | None
    alert_summary: str | None
    confidence: float
    analysis_metadata: ImageAnalysisMetadata | None = None


@dataclass(frozen=True)
class PdfExtractionResult:
    text: str
    lines: list[str]
    visible_tables: list[str]
    page_count: int
    first_page_image_bytes: bytes | None
    ocr_result: OcrExtractionResult


@dataclass(frozen=True)
class DashboardFallbackSnapshot:
    incident_details: IncidentDocumentDetails
    kpis: list[str]
    departments: list[str]
    alerts: list[str]
    source: str = "dashboard_fallback_data"


@dataclass(frozen=True)
class EquipmentVisualInventoryItem:
    raw_label: str
    type_key: str | None
    type_label: str
    brand: str | None
    confidence_label: str
    usage_probable: str


@dataclass(frozen=True)
class AlertDashboardKpis:
    critical_alerts: int | None = None
    at_risk_clients_count: int | None = None
    department_risk: str | None = None
    contract_exposed: str | None = None
    exposure_rate: str | None = None
    exposure_rate_pct: float | None = None
    financial_impact_mad: str | None = None
    financial_impact_value_mad: float | None = None
    revenue_at_risk_mad: str | None = None
    revenue_at_risk_value_mad: float | None = None
    estimated_impact_mad: str | None = None
    estimated_impact_value_mad: float | None = None
    churn_rate: str | None = None
    churn_rate_pct: float | None = None
    roi_estimated: str | None = None
    roi_estimated_pct: float | None = None
    priority_actions_count: int | None = None
    average_score: str | None = None
    average_score_value: float | None = None
    fraud_score_visible: str | None = None
    fraud_score_value: float | None = None
    anomaly_score_visible: str | None = None
    anomaly_score_value: float | None = None
    optimization_score_visible: str | None = None
    optimization_score_value: float | None = None
    cost_score_visible: str | None = None
    cost_score_value: float | None = None
    max_risk_scores: tuple[str, ...] = ()
    risk_level: str | None = None

    def has_visible_kpis(self) -> bool:
        return any(
            (
                self.critical_alerts is not None,
                self.at_risk_clients_count is not None,
                self.department_risk is not None,
                self.contract_exposed is not None,
                self.exposure_rate is not None,
                self.financial_impact_mad is not None,
                self.revenue_at_risk_mad is not None,
                self.estimated_impact_mad is not None,
                self.churn_rate is not None,
                self.roi_estimated is not None,
                self.average_score is not None,
                self.fraud_score_visible is not None,
                self.anomaly_score_visible is not None,
                self.optimization_score_visible is not None,
                self.cost_score_visible is not None,
                bool(self.max_risk_scores),
            )
        )


@dataclass(frozen=True)
class CachedVisionAnalysis:
    vision_result: VisionAnalysisResult
    detected_objects: tuple[str, ...]
    previous_response: str | None
    expires_at: datetime


_VISION_ANALYSIS_CACHE: dict[str, CachedVisionAnalysis] = {}


def _compute_image_content_hash(image_bytes: bytes) -> str:
    return hashlib.sha1(image_bytes).hexdigest()


def _build_vision_analysis_cache_key(
    *,
    conversation_id: str | None,
    image_hash: str | None,
) -> str | None:
    if not conversation_id or not image_hash:
        return None
    return hashlib.sha1(f"{conversation_id}|{image_hash}".encode("utf-8")).hexdigest()


def _prune_vision_analysis_cache() -> None:
    now = _utcnow()
    expired_keys = [
        cache_key
        for cache_key, cached_item in _VISION_ANALYSIS_CACHE.items()
        if cached_item.expires_at <= now
    ]
    for cache_key in expired_keys:
        _VISION_ANALYSIS_CACHE.pop(cache_key, None)

    if len(_VISION_ANALYSIS_CACHE) <= VISION_IMAGE_CACHE_MAX_ENTRIES:
        return

    overflow = len(_VISION_ANALYSIS_CACHE) - VISION_IMAGE_CACHE_MAX_ENTRIES
    oldest_keys = sorted(
        _VISION_ANALYSIS_CACHE,
        key=lambda cache_key: _VISION_ANALYSIS_CACHE[cache_key].expires_at,
    )[:overflow]
    for cache_key in oldest_keys:
        _VISION_ANALYSIS_CACHE.pop(cache_key, None)


def _get_cached_vision_analysis(cache_key: str | None) -> CachedVisionAnalysis | None:
    if cache_key is None:
        return None
    _prune_vision_analysis_cache()
    return _VISION_ANALYSIS_CACHE.get(cache_key)


def _store_cached_vision_analysis(
    cache_key: str | None,
    *,
    vision_result: VisionAnalysisResult,
    previous_response: str | None,
) -> None:
    if cache_key is None:
        return
    _prune_vision_analysis_cache()
    _VISION_ANALYSIS_CACHE[cache_key] = CachedVisionAnalysis(
        vision_result=vision_result,
        detected_objects=tuple(vision_result.detected_objects),
        previous_response=previous_response,
        expires_at=_utcnow() + VISION_IMAGE_CACHE_TTL,
    )


def _resolve_analysis_mode(raw_mode: str | None) -> str:
    normalized_mode = (raw_mode or get_settings().image_analysis_default_mode).strip().lower()
    if normalized_mode == "dashboard_analysis":
        return "dashboard_analysis"
    return "advanced" if normalized_mode == "advanced" else "quick"


def _build_empty_ocr_result(
    *,
    status: str = "unavailable",
    error_message: str | None = None,
) -> OcrExtractionResult:
    return OcrExtractionResult(
        text="",
        lines=[],
        text_regions=[],
        amounts_mad=[],
        operators=[],
        departments=[],
        alerts=[],
        kpis=[],
        visible_tables=[],
        confidence=0.0,
        invoice_details=None,
        incident_details=None,
        workflow_details=None,
        equipment_details=None,
        ui_details=None,
        status=status,
        error_message=error_message,
    )


async def _extract_image_ocr_with_timeout(
    image_bytes: bytes,
    *,
    filename: str | None,
) -> OcrExtractionResult:
    timeout_seconds = max(1, get_settings().image_analysis_ocr_timeout_seconds)
    started_at = time.perf_counter()
    try:
        result = await asyncio.wait_for(
            asyncio.to_thread(extract_image_ocr, image_bytes),
            timeout=timeout_seconds,
        )
    except asyncio.TimeoutError:
        MULTIMODAL_LOGGER.warning(
            "event=image_ocr_timeout filename=%s timeout_seconds=%s duration_ms=%s",
            filename,
            timeout_seconds,
            round((time.perf_counter() - started_at) * 1000),
        )
        return _build_empty_ocr_result(
            status="timeout",
            error_message=(
                "La lecture textuelle n'a pas pu etre stabilisee dans le delai imparti ; "
                "la priorisation repose donc sur les KPI et signaux visuels detectes."
            ),
        )

    MULTIMODAL_LOGGER.info(
        "event=image_ocr_completed filename=%s status=%s confidence=%s text_length=%s duration_ms=%s",
        filename,
        result.status,
        round(result.confidence, 4),
        len(result.text),
        round((time.perf_counter() - started_at) * 1000),
    )
    return result


def _merge_chunk_ocr_results(
    chunk_results: list[OcrExtractionResult],
) -> OcrExtractionResult:
    if not chunk_results:
        return _build_empty_ocr_result()

    available_results = [
        result
        for result in chunk_results
        if result.status == "ok"
        and (
            result.text.strip()
            or result.kpis
            or result.amounts_mad
            or result.alerts
            or result.visible_tables
        )
    ]
    if not available_results:
        first_result = chunk_results[0]
        return replace(
            first_result,
            error_message=first_result.error_message
            or "Lecture documentaire locale indisponible sur les segments du dashboard.",
        )

    merged_lines = _dedupe_items(
        [line for result in available_results for line in result.lines],
        260,
    )
    merged_text = "\n".join(merged_lines)
    merged_amounts = _dedupe_items(
        [amount for result in available_results for amount in result.amounts_mad],
        18,
    )
    merged_operators = _detect_operators(merged_text)
    merged_departments = _detect_departments(merged_text)
    merged_alerts = _detect_alert_lines(merged_lines)
    merged_kpis = _detect_kpis(merged_lines)
    merged_tables = _detect_visible_tables(merged_lines)
    confidence_values = [result.confidence for result in available_results if result.confidence > 0]
    merged_confidence = (
        sum(confidence_values) / len(confidence_values)
        if confidence_values
        else 0.0
    )
    incident_details = _extract_incident_details(
        merged_lines,
        merged_text,
        merged_operators,
        merged_confidence,
    )
    invoice_details = _extract_invoice_details(
        merged_lines,
        merged_text,
        merged_operators,
        merged_confidence,
    )
    workflow_details = next(
        (result.workflow_details for result in available_results if result.workflow_details is not None),
        None,
    )
    equipment_details = next(
        (result.equipment_details for result in available_results if result.equipment_details is not None),
        None,
    )
    ui_details = next(
        (result.ui_details for result in available_results if result.ui_details is not None),
        None,
    )
    return OcrExtractionResult(
        text=merged_text,
        lines=merged_lines,
        text_regions=[],
        amounts_mad=merged_amounts,
        operators=merged_operators,
        departments=merged_departments,
        alerts=merged_alerts,
        kpis=merged_kpis,
        visible_tables=merged_tables,
        confidence=max(0.0, min(merged_confidence, 1.0)),
        invoice_details=invoice_details,
        incident_details=incident_details,
        workflow_details=workflow_details,
        equipment_details=equipment_details,
        ui_details=ui_details,
        status="ok",
        error_message=None,
    )


def _format_pct_label(value: float | None) -> str | None:
    if value is None or value <= 0:
        return None
    return f"{str(round(value, 1)).replace('.', ',')}%"


def _format_score_label(value: float | None) -> str | None:
    if value is None or value <= 0:
        return None
    bounded_value = max(0.0, min(100.0, value))
    compact = (
        str(int(round(bounded_value)))
        if abs(bounded_value - round(bounded_value)) < 0.05
        else str(round(bounded_value, 1)).replace(".", ",")
    )
    return f"{compact}/100"


def _build_dashboard_fallback_snapshot() -> DashboardFallbackSnapshot | None:
    try:
        churn_overview = get_customer_churn_overview()
    except Exception:
        MULTIMODAL_LOGGER.exception("event=dashboard_fallback_customer_churn_failed")
        churn_overview = None
    try:
        cdr_overview = get_cdr_overview()
    except Exception:
        MULTIMODAL_LOGGER.exception("event=dashboard_fallback_cdr_failed")
        cdr_overview = None
    try:
        mobile_overview = get_mobile_fleet_overview()
    except Exception:
        MULTIMODAL_LOGGER.exception("event=dashboard_fallback_mobile_failed")
        mobile_overview = None

    churn_kpis = (churn_overview or {}).get("kpis") or {}
    if not churn_kpis and not cdr_overview and not mobile_overview:
        return None

    at_risk_clients_count = int(churn_kpis.get("high_risk_customers") or 0) or None
    churn_rate_pct = float(churn_kpis.get("churn_rate_pct") or 0.0) or None
    churn_rate = _format_pct_label(churn_rate_pct)
    revenue_at_risk_value = float(churn_kpis.get("revenue_at_risk_mad") or 0.0) or None
    revenue_at_risk_mad = _format_invoice_amount(revenue_at_risk_value)
    average_score_value = float(churn_kpis.get("average_risk_score") or 0.0) or None
    average_score = (
        str(round(average_score_value, 1)).replace(".", ",")
        if average_score_value is not None
        else None
    )

    risk_by_department = (churn_overview or {}).get("risk_by_department") or []
    top_department = max(
        risk_by_department,
        key=lambda item: (
            float(item.get("revenue_at_risk_mad") or 0.0),
            float(item.get("predicted_high_risk_customers") or 0.0),
            float(item.get("average_risk_score") or 0.0),
        ),
        default=None,
    )
    department_risk = str(top_department.get("label")).strip() if top_department and top_department.get("label") else None

    churn_by_contract = (churn_overview or {}).get("churn_by_contract") or []
    top_contract = max(
        churn_by_contract,
        key=lambda item: (
            float(item.get("revenue_at_risk_mad") or 0.0),
            float(item.get("predicted_high_risk_customers") or 0.0),
            float(item.get("average_risk_score") or 0.0),
        ),
        default=None,
    )
    contract_exposed = None
    if top_contract and top_contract.get("label"):
        contract_count = int(top_contract.get("predicted_high_risk_customers") or top_contract.get("total_customers") or 0)
        contract_exposed = (
            f"{contract_count} clients sur contrat {top_contract['label']}"
            if contract_count > 0
            else f"Contrat {top_contract['label']}"
        )

    cdr_kpis = (cdr_overview or {}).get("kpis") or {}
    mobile_kpis = (mobile_overview or {}).get("kpis") or {}
    critical_alert_count = int(cdr_kpis.get("critical_alerts") or 0) or None
    fraud_score_value = float(cdr_kpis.get("average_risk_score") or 0.0) or None
    fraud_score_visible = _format_score_label(fraud_score_value)
    anomaly_score_value = float(mobile_kpis.get("average_budget_risk_score") or 0.0) or None
    anomaly_score_visible = _format_score_label(anomaly_score_value)
    cost_score_visible = _format_score_label(anomaly_score_value)
    derived_risk_score_value = max(
        value
        for value in [fraud_score_value or 0.0, anomaly_score_value or 0.0, average_score_value or 0.0]
    )

    severity = (
        "critique"
        if (revenue_at_risk_value or 0.0) >= 1_000_000
        or (at_risk_clients_count or 0) >= 1000
        or (churn_rate_pct or 0.0) >= 50.0
        else "elevee"
        if (revenue_at_risk_value or 0.0) >= 250_000
        or (at_risk_clients_count or 0) >= 250
        or (churn_rate_pct or 0.0) >= 25.0
        else "moyenne"
    )
    priority = "immediate" if severity == "critique" else "haute" if severity == "elevee" else "normale"

    incident_details = IncidentDocumentDetails(
        alert_type="dashboard",
        severity=severity,
        detected_at=None,
        operator=None,
        line_reference=None,
        suspect_cost_mad=None,
        call_volume=None,
        data_overage=None,
        error_message=None,
        priority=priority,
        summary="Fallback metier consolide a partir des dashboards backend disponibles.",
        critical_alert_count=critical_alert_count,
        exposure_rate=churn_rate,
        exposure_rate_pct=churn_rate_pct,
        financial_impact_mad=revenue_at_risk_mad,
        financial_impact_value_mad=revenue_at_risk_value,
        at_risk_clients_count=at_risk_clients_count,
        department_risk=department_risk,
        contract_exposed=contract_exposed,
        churn_rate=churn_rate,
        churn_rate_pct=churn_rate_pct,
        estimated_impact_mad=revenue_at_risk_mad,
        estimated_impact_value_mad=revenue_at_risk_value,
        revenue_at_risk_mad=revenue_at_risk_mad,
        revenue_at_risk_value_mad=revenue_at_risk_value,
        roi_estimated=None,
        roi_estimated_pct=None,
        priority_actions_count=None,
        average_score=average_score,
        average_score_value=average_score_value,
        risk_score=_format_score_label(derived_risk_score_value),
        fraud_score_visible=fraud_score_visible,
        fraud_score_value=fraud_score_value,
        anomaly_score_visible=anomaly_score_visible,
        anomaly_score_value=anomaly_score_value,
        optimization_score_visible=None,
        optimization_score_value=None,
        cost_score_visible=cost_score_visible,
        cost_score_value=anomaly_score_value,
        max_risk_scores=[],
        risky_entities=[],
        repeated_anomalies=[],
        visible_statuses=["critique" if severity == "critique" else "eleve"],
        critical_signals=_clean_business_items(
            [
                f"{at_risk_clients_count} clients a risque" if at_risk_clients_count is not None else "",
                f"Taux churn {churn_rate}" if churn_rate else "",
                f"Revenu a risque {revenue_at_risk_mad}" if revenue_at_risk_mad else "",
                f"Departement {department_risk}" if department_risk else "",
                contract_exposed or "",
            ],
            6,
        ),
        probable_causes=_clean_business_items(
            [
                "les indicateurs churn backend montrent une pression elevee sur la retention" if churn_rate else "",
                f"le departement {department_risk} concentre la plus forte exposition" if department_risk else "",
                "la base contrat la plus exposee doit etre traitee en priorite" if contract_exposed else "",
            ],
            4,
        ),
    )
    visible_kpis = _clean_business_items(
        [
            f"{at_risk_clients_count} clients a risque" if at_risk_clients_count is not None else "",
            f"Taux churn {churn_rate}" if churn_rate else "",
            f"Revenu a risque {revenue_at_risk_mad}" if revenue_at_risk_mad else "",
            department_risk or "",
            contract_exposed or "",
            f"Score moyen {average_score}" if average_score else "",
            f"Risque fraude {fraud_score_visible}" if fraud_score_visible else "",
            f"Risque anomalie {anomaly_score_visible}" if anomaly_score_visible else "",
        ],
        8,
    )
    return DashboardFallbackSnapshot(
        incident_details=incident_details,
        kpis=visible_kpis,
        departments=[department_risk] if department_risk else [],
        alerts=[f"{critical_alert_count} alertes critiques" if critical_alert_count is not None else "Dashboard churn"],
    )


def _apply_dashboard_fallback_snapshot(
    *,
    ocr_result: OcrExtractionResult,
    snapshot: DashboardFallbackSnapshot,
) -> OcrExtractionResult:
    merged_lines = _dedupe_items(
        [
            *ocr_result.lines,
            *snapshot.kpis,
            *snapshot.alerts,
        ],
        240,
    )
    merged_text = "\n".join(line for line in merged_lines if line.strip())
    return replace(
        ocr_result,
        text=merged_text,
        lines=merged_lines,
        departments=_dedupe_items([*ocr_result.departments, *snapshot.departments], 8),
        alerts=_dedupe_items([*ocr_result.alerts, *snapshot.alerts], 12),
        kpis=_dedupe_items([*ocr_result.kpis, *snapshot.kpis], 24),
        confidence=max(ocr_result.confidence or 0.0, OCR_CONFIDENCE_STRONG_KPI_FLOOR),
        incident_details=snapshot.incident_details,
        status="ok",
        error_message=None,
    )


async def _extract_prepared_image_ocr(
    prepared_image: PreparedImage,
    *,
    filename: str | None,
) -> tuple[OcrExtractionResult, list[OcrExtractionResult]]:
    if not prepared_image.is_long_screenshot or not prepared_image.chunks:
        result = await _extract_image_ocr_with_timeout(
            prepared_image.processed_bytes,
            filename=filename,
        )
        return result, []

    chunk_results: list[OcrExtractionResult] = []
    for chunk in prepared_image.chunks:
        chunk_filename = f"{filename or 'image'}#chunk-{chunk.index + 1}"
        result = await _extract_image_ocr_with_timeout(
            chunk.processed_bytes,
            filename=chunk_filename,
        )
        MULTIMODAL_LOGGER.info(
            "event=image_ocr_chunk_completed filename=%s chunk_index=%s chunk_width=%s chunk_height=%s status=%s confidence=%s text_length=%s visible_kpis=%s",
            filename,
            chunk.index,
            chunk.processed_width,
            chunk.processed_height,
            result.status,
            round(result.confidence, 4),
            len(result.text),
            len(result.kpis),
        )
        chunk_results.append(result)

    merged_result = _merge_chunk_ocr_results(chunk_results)
    MULTIMODAL_LOGGER.info(
        "event=image_ocr_chunks_merged filename=%s number_of_chunks=%s merged_text_length=%s merged_kpis=%s merged_confidence=%s",
        filename,
        len(prepared_image.chunks),
        len(merged_result.text),
        len(merged_result.kpis),
        round(merged_result.confidence, 4),
    )
    return merged_result, chunk_results


def _score_chunk_for_vision(result: OcrExtractionResult) -> int:
    return (
        len(result.kpis) * 30
        + len(result.amounts_mad) * 24
        + len(result.alerts) * 18
        + min(len(result.text), 800) // 20
    )


def _merge_vision_chunk_results(
    results: list[VisionAnalysisResult],
) -> VisionAnalysisResult:
    if not results:
        raise VisionUnavailableError("L'analyse visuelle detaillee des segments n'a retourne aucun resultat exploitable.")

    image_type_priority = {
        "alert_dashboard": 10,
        "dashboard": 9,
        "fraude": 8,
        "alerte": 7,
        "log": 6,
        "tableau": 5,
        "graphe": 4,
        "capture_interface": 1,
    }
    best_image_type = max(
        results,
        key=lambda item: image_type_priority.get(item.image_type, 0),
    ).image_type
    merged_radar_axes = next((item.radar_axes for item in results if item.radar_axes), [])
    return VisionAnalysisResult(
        image_type=best_image_type,
        analysis=" ".join(_dedupe_items([item.analysis for item in results if item.analysis], 6)),
        detected_kpis=_dedupe_items(
            [kpi for item in results for kpi in item.detected_kpis],
            12,
        ),
        recommendations=_dedupe_items(
            [recommendation for item in results for recommendation in item.recommendations],
            8,
        ),
        confidence=max(item.confidence for item in results),
        model=results[0].model,
        widgets=_dedupe_items([widget for item in results for widget in item.widgets], 10),
        charts=_dedupe_items([chart for item in results for chart in item.charts], 10),
        critical_zones=_dedupe_items(
            [zone for item in results for zone in item.critical_zones],
            10,
        ),
        radar_axes=merged_radar_axes,
        raw_output="\n\n".join(item.raw_output for item in results if item.raw_output),
    )


def _select_chunks_for_vision(
    prepared_image: PreparedImage,
    chunk_ocr_results: list[OcrExtractionResult],
) -> list[PreparedImageChunk]:
    if not prepared_image.chunks:
        return []
    if not chunk_ocr_results or len(chunk_ocr_results) != len(prepared_image.chunks):
        return list(prepared_image.chunks[:3])

    if all(
        result.status != "ok"
        or (
            not result.text.strip()
            and not result.kpis
            and not result.amounts_mad
            and not result.alerts
        )
        for result in chunk_ocr_results
    ):
        fallback_indexes = [0]
        if len(prepared_image.chunks) >= 3:
            fallback_indexes.append(len(prepared_image.chunks) // 2)
        selected = [
            chunk
            for chunk in prepared_image.chunks
            if chunk.index in fallback_indexes
        ]
        return selected or [prepared_image.chunks[0]]

    ranked_pairs = sorted(
        zip(prepared_image.chunks, chunk_ocr_results, strict=False),
        key=lambda pair: _score_chunk_for_vision(pair[1]),
        reverse=True,
    )
    selected_chunks = [pair[0] for pair in ranked_pairs[:3]]
    return sorted(selected_chunks, key=lambda chunk: chunk.index)


async def _analyze_prepared_image_with_vision(
    *,
    question: str,
    prepared_image: PreparedImage,
    chunk_ocr_results: list[OcrExtractionResult],
    timeout_seconds: int,
    analysis_mode: str,
    filename: str | None,
    prompt_profile_override: str | None = None,
    question_type: str | None = None,
    image_type: str | None = None,
    vision_routing: str | None = None,
) -> VisionAnalysisResult:
    if not prepared_image.is_long_screenshot or not prepared_image.chunks:
        payload_started_at = time.perf_counter()
        image_base64_payload = prepared_image.vision_base64_payload
        MULTIMODAL_LOGGER.info(
            "event=image_vision_payload_prepared filename=%s mode=single payload_chars=%s duration_ms=%s",
            filename,
            len(image_base64_payload),
            round((time.perf_counter() - payload_started_at) * 1000),
        )
        return await analyze_image_with_llava(
            question=question,
            image_base64=image_base64_payload,
            timeout_seconds=timeout_seconds,
            analysis_mode=analysis_mode,
            prompt_profile_override=prompt_profile_override,
            question_type=question_type,
            image_type=image_type,
            vision_routing=vision_routing,
        )

    selected_chunks = _select_chunks_for_vision(prepared_image, chunk_ocr_results)
    MULTIMODAL_LOGGER.info(
        "event=image_vision_long_screenshot_selected filename=%s number_of_chunks=%s selected_chunks=%s",
        filename,
        len(prepared_image.chunks),
        [
            {
                "index": chunk.index,
                "width": chunk.width,
                "height": chunk.height,
            }
            for chunk in selected_chunks
        ],
    )
    results: list[VisionAnalysisResult] = []
    last_exception: Exception | None = None
    per_chunk_timeout = max(30, min(timeout_seconds, 60))
    for chunk in selected_chunks:
        try:
            payload_started_at = time.perf_counter()
            chunk_base64_payload = chunk.vision_base64_payload
            MULTIMODAL_LOGGER.info(
                "event=image_vision_payload_prepared filename=%s mode=chunk chunk_index=%s payload_chars=%s duration_ms=%s",
                filename,
                chunk.index,
                len(chunk_base64_payload),
                round((time.perf_counter() - payload_started_at) * 1000),
            )
            result = await analyze_image_with_llava(
                question=question,
                image_base64=chunk_base64_payload,
                timeout_seconds=per_chunk_timeout,
                analysis_mode=analysis_mode,
                prompt_profile_override=prompt_profile_override,
                question_type=question_type,
                image_type=image_type,
                vision_routing=vision_routing,
            )
            MULTIMODAL_LOGGER.info(
                "event=image_vision_chunk_completed filename=%s chunk_index=%s image_type=%s confidence=%s detected_kpis=%s",
                filename,
                chunk.index,
                result.image_type,
                round(result.confidence, 4),
                len(result.detected_kpis),
            )
            results.append(result)
        except (ImageAnalysisTimeoutError, VisionUnavailableError, LocalModelUnavailableError) as exc:
            last_exception = exc
            MULTIMODAL_LOGGER.warning(
                "event=image_vision_chunk_failed filename=%s chunk_index=%s code=%s message=%s",
                filename,
                chunk.index,
                getattr(exc, "code", exc.__class__.__name__),
                getattr(exc, "user_message", str(exc)),
            )

    if results:
        return _merge_vision_chunk_results(results)
    if last_exception is not None:
        raise last_exception
    raise VisionUnavailableError("L'analyse visuelle detaillee des segments n'a retourne aucun resultat exploitable.")


def _resolve_image_vision_prompt_profile_override(
    *,
    question: str,
    question_type: str,
    ocr_result: OcrExtractionResult,
    image_type: str | None = None,
    vision_routing: str | None = None,
) -> str | None:
    normalized_image_type = _normalize_invoice_text(image_type or "")
    normalized_vision_routing = _normalize_invoice_text(vision_routing or "")
    if normalized_image_type == "equipement":
        return "physical_objects"
    if normalized_vision_routing == "equipment":
        return "physical_objects"
    if question_type == QUESTION_TYPE_EQUIPMENT_DETECTION:
        return "physical_objects"
    if ocr_result.equipment_details is not None:
        return "physical_objects"
    if _infer_equipment_type_from_text(ocr_result.text) is not None:
        return "physical_objects"
    if _question_targets_physical_equipment(question):
        return "physical_objects"
    return None


def _resolve_image_vision_timeout_seconds(
    *,
    question_type: str,
    ocr_result: OcrExtractionResult,
) -> int:
    configured_timeout = max(30, int(get_settings().image_analysis_vision_timeout_seconds))
    if (
        question_type == QUESTION_TYPE_EQUIPMENT_DETECTION
        or ocr_result.equipment_details is not None
        or _infer_equipment_type_from_text(ocr_result.text) is not None
    ):
        return configured_timeout
    return configured_timeout


def _resolve_pre_vision_image_type(
    *,
    question_type: str,
    ocr_result: OcrExtractionResult,
) -> str | None:
    if ocr_result.equipment_details is not None:
        return "equipement"
    if question_type == QUESTION_TYPE_EQUIPMENT_DETECTION:
        return "equipement"
    if _infer_equipment_type_from_text(ocr_result.text) is not None:
        return "equipement"
    return None


def _resolve_pre_vision_routing(
    *,
    question: str,
    question_type: str,
    image_type: str | None,
) -> str:
    if (
        _normalize_invoice_text(image_type or "") == "equipement"
        or question_type == QUESTION_TYPE_EQUIPMENT_DETECTION
        or _question_targets_physical_equipment(question)
    ):
        return "EQUIPMENT"
    return "STANDARD"


def _dedupe_items(values: list[str], limit: int) -> list[str]:
    deduped_values: list[str] = []
    seen = set()
    for value in values:
        cleaned_value = _harmonize_business_text(" ".join(value.split()).strip())
        key = _normalize_invoice_text(cleaned_value)
        if not cleaned_value or key in seen:
            continue
        seen.add(key)
        deduped_values.append(cleaned_value)
    return deduped_values[:limit]


def _limit_text(value: str, limit: int = 4000) -> str:
    compact_value = value.strip()
    if len(compact_value) <= limit:
        return compact_value
    return compact_value[:limit].rstrip()


def _normalize_invoice_text(value: str) -> str:
    normalized_value = unicodedata.normalize("NFD", value.lower())
    normalized_value = "".join(
        character for character in normalized_value if unicodedata.category(character) != "Mn"
    )
    return " ".join(normalized_value.split())


def _harmonize_business_text(value: str) -> str:
    cleaned_value = " ".join(value.split()).strip()
    if not cleaned_value:
        return ""
    replacements = (
        (r"\bscore fraude\b", "Risque fraude"),
        (r"\bscore anomalie\b", "Risque anomalie"),
        (r"\bscore optimisation\b", "Risque optimisation"),
        (r"\bscore cout\b", "Risque cout"),
        (r"\bscore sous-utilisation\b", "Risque sous-utilisation"),
        (r"\bscore sous utilisation\b", "Risque sous-utilisation"),
        (r"\bscore rentabilite\b", "Risque rentabilite"),
        (r"\bkpi visibles\b", "KPI consolides"),
        (r"\bimpact financier visible\b", "impact financier"),
        (r"\bimpact estime visible\b", "impact estime"),
        (r"\brevenu a risque visible\b", "revenu a risque"),
        (r"\btaux d'exposition visible\b", "taux d'exposition"),
        (r"\bscores fraude et anomalie visibles\b", "risques fraude et anomalie"),
        (r"\bprofils visibles atteignent\b", "profils atteignent"),
    )
    for pattern, replacement in replacements:
        cleaned_value = re.sub(pattern, replacement, cleaned_value, flags=re.IGNORECASE)
    return " ".join(cleaned_value.split()).strip()


def _extract_invoice_amount_value(value: str | None) -> float | None:
    if not value:
        return None
    match = re.search(
        r"(?<!\d)(\d{1,3}(?:[ .]\d{3})*(?:[.,]\d{2})?|\d+(?:[.,]\d+)?)",
        value,
        flags=re.IGNORECASE,
    )
    if not match:
        return None
    normalized_value = match.group(1).replace(" ", "").replace(",", ".")
    try:
        return float(normalized_value)
    except ValueError:
        return None


def _format_invoice_amount(value: float | None) -> str | None:
    if value is None or value <= 0:
        return None
    rounded_value = round(value, 2)
    if abs(rounded_value - round(rounded_value)) < 0.01:
        return f"{int(round(rounded_value)):,} MAD".replace(",", " ")
    return f"{rounded_value:,.2f} MAD".replace(",", " ").replace(".", ",")


def _format_share_pct(value: float | None) -> str | None:
    if value is None:
        return None
    rounded_value = round(value, 1)
    return f"{str(rounded_value).replace('.', ',')}%"


ALERT_FOCUSED_IMAGE_TYPES = {
    "alerte",
    "alert_dashboard",
    "fraude",
    "log",
    "appel_suspect",
    "depassement_quota",
    "erreur_systeme",
    "anomalie",
}

DEFENSIVE_BUSINESS_SNIPPETS = (
    "texte insuffisant",
    "a confirmer",
    "analyse limitee",
    "analyse exploitable",
    "analyse reste fondee sur les indicateurs detectes",
    "ocr non exploitable",
    "ocr indisponible",
    "aucune certitude",
    "lecture partielle",
    "lecture approfondie",
    "lecture visuelle",
    "aucune zone critique detectee",
    "indicateurs insuffisants",
    "capture a enrichir",
    "capture doit etre enrichie",
    "lecture croisee des risques",
    "zones sous supervisees",
    "zones sous-supervisees",
    "zones exposees",
    "gouvernance des priorites",
    "signaux visibles",
    "consolider les signaux visibles",
    "pilotage heterogene",
    "dimensions faibles",
    "arbitrage des actions",
    "lecture decisionnelle priorisee",
    "capture conserve des kpi visibles",
    "metriques verifiees restent stables",
    "synthese approfondie a ete raccourcie",
    "synthese detaillee n etait pas disponible",
)
ALLOWED_DEFENSIVE_BUSINESS_PHRASES = (
    "voici une lecture visuelle prudente des equipements visibles",
)

GENERIC_MULTIMODAL_ANSWER_SNIPPETS = (
    "resume intelligent",
    "la capture partagee met en evidence",
    "la capture met en evidence une alerte telecom",
    "la decision se concentre sur les indicateurs visibles les plus structurants",
    "les indicateurs les plus visibles appellent une priorisation ciblee",
    "point de lecture prioritaire",
    "lecture retenue",
    "ocr non exploitable",
    "capture a enrichir",
    "analyse exploitable",
    "lecture approfondie",
    "lecture visuelle",
    "signaux visibles",
    "zones exposees",
    "consolider les signaux visibles",
    "lecture decisionnelle priorisee",
    "analyse reste fondee sur les indicateurs detectes",
    "capture conserve des kpi visibles",
    "metriques verifiees restent stables",
    "synthese approfondie a ete raccourcie",
)

VISIBLE_KPI_STRICT_THRESHOLD = 4
OCR_CONFIDENCE_STRONG_KPI_FLOOR = 0.70
PIPELINE_DEBUG_TEXT_LIMIT = 9000
DASHBOARD_KPI_STRICT_RESPONSE_IMAGE_TYPES = {"dashboard", "alerte", "alert_dashboard"}


def _risk_level_weight(value: str | None) -> int:
    return {
        "low": 24,
        "medium": 48,
        "high": 72,
        "critical": 90,
    }.get((value or "").strip().lower(), 0)


def _contains_defensive_business_phrase(value: str) -> bool:
    normalized_value = _normalize_invoice_text(value)
    if any(allowed_phrase in normalized_value for allowed_phrase in ALLOWED_DEFENSIVE_BUSINESS_PHRASES):
        return False
    return any(snippet in normalized_value for snippet in DEFENSIVE_BUSINESS_SNIPPETS)


def _rewrite_stage_notice(notice: str) -> str:
    cleaned_notice = " ".join(notice.split()).strip()
    normalized_notice = _normalize_invoice_text(cleaned_notice)
    replacement_rules = (
        (
            (
                "capture conserve des kpi visibles",
                "analyse reste fondee sur les indicateurs detectes",
            ),
            "Certaines donnees restent partielles, mais les KPI detectes permettent deja d'identifier les risques prioritaires.",
        ),
        (
            (
                "traitement visuel detaille a rencontre un incident technique",
                "lecture visuelle a rencontre un incident technique",
            ),
            "Certaines donnees detaillees n'ont pas pu etre consolidees, mais les indicateurs les plus fiables confirment les priorites de traitement.",
        ),
        (
            (
                "traitement visuel detaille n etait pas disponible",
                "audit visuel complet n etait pas disponible",
                "lecture documentaire locale indisponible",
            ),
            "Les indicateurs consolides suffisent pour orienter l'analyse et les actions immediates.",
        ),
        (
            (
                "traitement visuel detaille a pris trop de temps",
                "lecture visuelle a pris trop de temps",
                "depasse la fenetre de traitement",
            ),
            "La lecture detaillee a ete limitee, mais les priorites metier restent exploitables.",
        ),
        (
            (
                "synthese approfondie a ete raccourcie",
                "synthese detaillee n etait pas disponible",
            ),
            "La note finale a ete recentree sur les priorites les plus materielles pour accelerer la decision.",
        ),
    )
    for snippets, replacement in replacement_rules:
        if any(snippet in normalized_notice for snippet in snippets):
            return replacement
    return cleaned_notice


def _normalize_stage_notices(stage_notices: list[str]) -> list[str]:
    return _dedupe_items(
        [_rewrite_stage_notice(notice) for notice in stage_notices if notice and notice.strip()],
        6,
    )


def _clean_business_items(values: list[str], limit: int) -> list[str]:
    return polish_business_items(
        [
            _harmonize_business_text(value)
            for value in values
            if value and value.strip() and not _contains_defensive_business_phrase(value) and not is_generic_business_phrase(value)
        ],
        limit=limit,
    )


def _multimodal_allows_max_risk_score(incident_details: IncidentDocumentDetails | None) -> bool:
    if incident_details is None:
        return False
    return (
        (incident_details.severity or "").strip().lower() == "critical"
        and (incident_details.critical_alert_count or 0) >= 10_000
        and max(
            incident_details.financial_impact_value_mad or 0.0,
            incident_details.revenue_at_risk_value_mad or 0.0,
            incident_details.estimated_impact_value_mad or 0.0,
        )
        >= 5_000_000
    )


def _polish_decision_recommendations(
    recommendations: list[DecisionRecommendation],
    *,
    exceptional_scores: bool = False,
) -> list[ChatDecisionRecommendation]:
    polished_recommendations: list[ChatDecisionRecommendation] = []
    for recommendation in recommendations:
        polished_recommendations.append(
            ChatDecisionRecommendation(
                title=polish_business_text(recommendation.title, exceptional_scores=exceptional_scores)
                or recommendation.title,
                priority=recommendation.priority,
                impact=recommendation.impact,
                estimated_saving=recommendation.estimated_saving,
                reason=polish_business_text(recommendation.reason, exceptional_scores=exceptional_scores)
                or recommendation.reason,
            )
        )
    return polished_recommendations


def _polish_alert_intelligence(
    alert_intelligence: ChatAlertIntelligence | None,
    *,
    exceptional_scores: bool = False,
) -> ChatAlertIntelligence | None:
    if alert_intelligence is None:
        return None
    return ChatAlertIntelligence(
        alert_family=alert_intelligence.alert_family,
        ai_risk_score=normalize_business_risk_score(
            alert_intelligence.ai_risk_score,
            exceptional=exceptional_scores,
        ),
        ocr_confidence_score=alert_intelligence.ocr_confidence_score,
        criticity=alert_intelligence.criticity,
        executive_summary=polish_business_text(
            alert_intelligence.executive_summary,
            exceptional_scores=exceptional_scores,
        )
        or alert_intelligence.executive_summary,
        business_risk=polish_business_text(
            alert_intelligence.business_risk,
            exceptional_scores=exceptional_scores,
        )
        or alert_intelligence.business_risk,
        financial_exposure_mad=alert_intelligence.financial_exposure_mad,
        potential_loss_mad=alert_intelligence.potential_loss_mad,
        possible_savings_mad=alert_intelligence.possible_savings_mad,
        priority_kpis=polish_business_items(
            alert_intelligence.priority_kpis,
            limit=8,
            exceptional_scores=exceptional_scores,
        ),
        visible_evidence=polish_business_items(
            alert_intelligence.visible_evidence,
            limit=8,
            exceptional_scores=exceptional_scores,
        ),
        at_risk_entities=polish_business_items(
            alert_intelligence.at_risk_entities,
            limit=8,
            exceptional_scores=exceptional_scores,
        ),
        immediate_actions=polish_business_items(
            alert_intelligence.immediate_actions,
            limit=6,
            exceptional_scores=exceptional_scores,
        ),
        recommended_controls=polish_business_items(
            alert_intelligence.recommended_controls,
            limit=6,
            exceptional_scores=exceptional_scores,
        ),
        alert_timeline=alert_intelligence.alert_timeline,
        audit_focus=polish_business_text(
            alert_intelligence.audit_focus,
            exceptional_scores=exceptional_scores,
        )
        or alert_intelligence.audit_focus,
    )


def _score_visible_business_kpi(value: str) -> int:
    normalized_value = _normalize_invoice_text(value)
    score = 0
    if re.search(r"\b\d{1,3}(?:[ .]\d{3})*(?:[.,]\d+)?\s*(?:mad|dhs|dh)\b", value, flags=re.IGNORECASE):
        score += 90
    if re.search(r"\b\d{1,3}\s*/\s*100\b", value, flags=re.IGNORECASE):
        score += 86
    if re.search(r"\b\d{1,3}(?:[.,]\d{1,2})?\s*%\b", value, flags=re.IGNORECASE):
        score += 82
    if any(keyword in normalized_value for keyword in ("impact", "exposition", "portefeuille", "budget", "cout", "roaming")):
        score += 14
    if any(keyword in normalized_value for keyword in ("score fraude", "fraude", "score anomal", "anomal", "score risque", "fleet health")):
        score += 12
    if any(keyword in normalized_value for keyword in ("alerte", "alertes", "depassement", "volume", "ligne")):
        score += 10
    return score


def _prioritize_visible_business_kpis(values: list[str], limit: int) -> list[str]:
    prioritized_values = sorted(
        _clean_business_items(values, max(limit * 3, 12)),
        key=lambda item: (_score_visible_business_kpi(item), -len(item)),
        reverse=True,
    )
    return _dedupe_items(prioritized_values, limit)


def _should_use_dashboard_kpi_strict_response(image_type: str) -> bool:
    return image_type in DASHBOARD_KPI_STRICT_RESPONSE_IMAGE_TYPES


def _collect_visible_pipeline_kpis(
    ocr_result: OcrExtractionResult,
    vision_result: VisionAnalysisResult | None = None,
) -> list[str]:
    incident = ocr_result.incident_details
    invoice = ocr_result.invoice_details
    workflow = ocr_result.workflow_details
    equipment = ocr_result.equipment_details

    visible_kpis = [
        *ocr_result.kpis,
        *ocr_result.amounts_mad,
        *(vision_result.detected_kpis if vision_result is not None else []),
    ]
    if incident is not None:
        visible_kpis.extend(
            [
                (
                    f"{incident.critical_alert_count} alertes critiques"
                    if incident.critical_alert_count is not None
                    else ""
                ),
                (
                    f"{incident.at_risk_clients_count} clients a risque"
                    if incident.at_risk_clients_count is not None
                    else ""
                ),
                f"Departement risque {incident.department_risk}" if incident.department_risk else "",
                f"Contrat expose {incident.contract_exposed}" if incident.contract_exposed else "",
                f"Taux d'exposition {incident.exposure_rate}" if incident.exposure_rate else "",
                f"Taux de churn {incident.churn_rate}" if incident.churn_rate else "",
                (
                    f"Revenu a risque {incident.revenue_at_risk_mad}"
                    if incident.revenue_at_risk_mad
                    else ""
                ),
                (
                    f"Impact financier {incident.financial_impact_mad}"
                    if incident.financial_impact_mad
                    else ""
                ),
                (
                    f"Impact estime {incident.estimated_impact_mad}"
                    if incident.estimated_impact_mad
                    else ""
                ),
                f"Score moyen {incident.average_score}" if incident.average_score else "",
                (
                    f"Risque fraude {incident.fraud_score_visible}"
                    if incident.fraud_score_visible
                    else ""
                ),
                (
                    f"Risque anomalie {incident.anomaly_score_visible}"
                    if incident.anomaly_score_visible
                    else ""
                ),
                (
                    f"Risque optimisation {incident.optimization_score_visible}"
                    if incident.optimization_score_visible
                    else ""
                ),
                (
                    f"Risque cout {incident.cost_score_visible}"
                    if incident.cost_score_visible
                    else ""
                ),
                f"ROI estime {incident.roi_estimated}" if incident.roi_estimated else "",
                *incident.max_risk_scores[:4],
                *incident.critical_signals[:4],
            ]
        )
    if invoice is not None:
        visible_kpis.extend(
            [
                f"Montant TTC {invoice.amount_ttc_mad}" if invoice.amount_ttc_mad else "",
                f"Montant HT {invoice.amount_ht_mad}" if invoice.amount_ht_mad else "",
                f"TVA {invoice.vat_amount_mad}" if invoice.vat_amount_mad else "",
                f"Total facture {invoice.total_amount_mad}" if invoice.total_amount_mad else "",
                *[
                    (
                        f"{item.label}: {item.amount_mad}"
                        + (
                            f" ({_format_share_pct(item.share_of_total_pct)} du total)"
                            if item.share_of_total_pct is not None
                            else ""
                        )
                    )
                    for item in invoice.cost_items[:4]
                ],
            ]
        )
    if workflow is not None:
        visible_kpis.extend(
            [
                f"Complexite workflow {workflow.complexity_score}/100",
                *workflow.critical_steps[:3],
            ]
        )
    if equipment is not None:
        visible_kpis.extend(
            [
                f"Etat equipement {equipment.condition_score}/100",
                f"Criticite equipement {equipment.criticality_score}/100",
                equipment.model or "",
            ]
        )
    return _prioritize_visible_business_kpis(visible_kpis, 12)


def _build_strict_extracted_values(
    *,
    ocr_result: OcrExtractionResult,
    vision_result: VisionAnalysisResult | None = None,
) -> ExtractedValues:
    incident = ocr_result.incident_details
    invoice = ocr_result.invoice_details
    workflow = ocr_result.workflow_details
    equipment = ocr_result.equipment_details

    image_metadata = [
        invoice.total_amount_mad if invoice is not None and invoice.total_amount_mad else "",
        invoice.amount_ttc_mad if invoice is not None and invoice.amount_ttc_mad else "",
        invoice.vat_amount_mad if invoice is not None and invoice.vat_amount_mad else "",
        invoice.billing_period if invoice is not None and invoice.billing_period else "",
        incident.revenue_at_risk_mad if incident is not None and incident.revenue_at_risk_mad else "",
        incident.financial_impact_mad if incident is not None and incident.financial_impact_mad else "",
        incident.estimated_impact_mad if incident is not None and incident.estimated_impact_mad else "",
        incident.exposure_rate if incident is not None and incident.exposure_rate else "",
        incident.churn_rate if incident is not None and incident.churn_rate else "",
        incident.average_score if incident is not None and incident.average_score else "",
        incident.fraud_score_visible if incident is not None and incident.fraud_score_visible else "",
        incident.anomaly_score_visible if incident is not None and incident.anomaly_score_visible else "",
        incident.optimization_score_visible if incident is not None and incident.optimization_score_visible else "",
        incident.cost_score_visible if incident is not None and incident.cost_score_visible else "",
        incident.risk_score if incident is not None and incident.risk_score else "",
        str(incident.critical_alert_count) if incident is not None and incident.critical_alert_count is not None else "",
        str(incident.at_risk_clients_count) if incident is not None and incident.at_risk_clients_count is not None else "",
        incident.department_risk if incident is not None and incident.department_risk else "",
        incident.contract_exposed if incident is not None and incident.contract_exposed else "",
        workflow.workflow_type if workflow is not None and workflow.workflow_type else "",
        equipment.model if equipment is not None and equipment.model else "",
        equipment.brand if equipment is not None and equipment.brand else "",
        *(
            incident.max_risk_scores
            if incident is not None
            else []
        ),
        *(
            incident.critical_signals
            if incident is not None
            else []
        ),
        *(
            [f"{item.label} {item.amount_mad}" for item in invoice.cost_items[:4]]
            if invoice is not None
            else []
        ),
    ]
    return build_extracted_values_from_ocr(
        ocr_result.text,
        ocr_amounts_mad=[str(amount) for amount in ocr_result.amounts_mad],
        ocr_kpis=ocr_result.kpis,
        operators=ocr_result.operators,
        departments=ocr_result.departments,
        vision_analysis=vision_result.analysis if vision_result is not None else "",
        vision_kpis=vision_result.detected_kpis if vision_result is not None else [],
        image_metadata=image_metadata,
    )


def _count_visible_pipeline_kpis(
    ocr_result: OcrExtractionResult,
    vision_result: VisionAnalysisResult | None = None,
) -> int:
    return len(_collect_visible_pipeline_kpis(ocr_result, vision_result))


def _has_strong_visible_pipeline_kpis(
    ocr_result: OcrExtractionResult,
    vision_result: VisionAnalysisResult | None = None,
) -> bool:
    return _count_visible_pipeline_kpis(ocr_result, vision_result) >= VISIBLE_KPI_STRICT_THRESHOLD


def _effective_ocr_confidence(
    ocr_result: OcrExtractionResult,
    vision_result: VisionAnalysisResult | None = None,
) -> float:
    confidence = max(0.0, min(ocr_result.confidence or 0.0, 1.0))
    if _has_strong_visible_pipeline_kpis(ocr_result, vision_result):
        return max(confidence, OCR_CONFIDENCE_STRONG_KPI_FLOOR)
    return confidence


def _truncate_debug_text(value: str, limit: int = PIPELINE_DEBUG_TEXT_LIMIT) -> str:
    cleaned_value = value.strip()
    if len(cleaned_value) <= limit:
        return cleaned_value
    remaining = len(cleaned_value) - limit
    return f"{cleaned_value[:limit]}\n...[truncated {remaining} chars]"


def _build_pipeline_debug_snapshot(
    *,
    question: str,
    image_type: str,
    analysis_mode: str,
    ocr_result: OcrExtractionResult,
    vision_result: VisionAnalysisResult | None,
) -> dict[str, object]:
    incident = ocr_result.incident_details
    visible_pipeline_kpis = _collect_visible_pipeline_kpis(ocr_result, vision_result)
    score_markers = _dedupe_items(
        [
            *(incident.max_risk_scores[:6] if incident is not None else []),
            incident.risk_score if incident is not None and incident.risk_score else "",
            incident.average_score if incident is not None and incident.average_score else "",
            incident.fraud_score_visible if incident is not None and incident.fraud_score_visible else "",
            incident.anomaly_score_visible if incident is not None and incident.anomaly_score_visible else "",
            incident.optimization_score_visible
            if incident is not None and incident.optimization_score_visible
            else "",
            incident.cost_score_visible if incident is not None and incident.cost_score_visible else "",
        ],
        8,
    )
    return {
        "message": (
            "KPI detectes avec succes"
            if visible_pipeline_kpis
            else "Aucun KPI detecte"
        ),
        "analysis_mode": analysis_mode,
        "image_type": image_type,
        "question": _truncate(question, 180),
        "ocr_raw_text": _truncate_debug_text(ocr_result.text or ""),
        "ocr_cleaned_text": _truncate_debug_text("\n".join(ocr_result.lines[:60])),
        "kpis_detectes": ocr_result.kpis[:12],
        "kpis_visibles_prioritaires": visible_pipeline_kpis,
        "scores_detectes": score_markers,
        "montants_mad_detectes": ocr_result.amounts_mad[:12],
        "ocr_confidence_calculee": round(_effective_ocr_confidence(ocr_result, vision_result) * 100, 1),
        "vision_detected_kpis": vision_result.detected_kpis[:8] if vision_result is not None else [],
        "vision_image_type": vision_result.image_type if vision_result is not None else None,
    }


def _log_kpi_pipeline_debug(
    *,
    question: str,
    image_type: str,
    analysis_mode: str,
    ocr_result: OcrExtractionResult,
    vision_result: VisionAnalysisResult | None,
) -> None:
    snapshot = _build_pipeline_debug_snapshot(
        question=question,
        image_type=image_type,
        analysis_mode=analysis_mode,
        ocr_result=ocr_result,
        vision_result=vision_result,
    )
    MULTIMODAL_LOGGER.info(
        "=== TEXTE OCR ===\n%s",
        json.dumps(
            {
                "ocr_raw_text": snapshot["ocr_raw_text"],
                "ocr_cleaned_text": snapshot["ocr_cleaned_text"],
                "ocr_confidence_calculee": snapshot["ocr_confidence_calculee"],
            },
            ensure_ascii=True,
            indent=2,
        ),
    )
    MULTIMODAL_LOGGER.info(
        "=== KPI DETECTES ===\n%s",
        json.dumps(
            {
                "message": snapshot["message"],
                "image_type": snapshot["image_type"],
                "analysis_mode": snapshot["analysis_mode"],
                "kpis_detectes": snapshot["kpis_detectes"],
                "kpis_visibles_prioritaires": snapshot["kpis_visibles_prioritaires"],
                "scores_detectes": snapshot["scores_detectes"],
                "montants_mad_detectes": snapshot["montants_mad_detectes"],
                "vision_detected_kpis": snapshot["vision_detected_kpis"],
            },
            ensure_ascii=True,
            indent=2,
        ),
    )
    MULTIMODAL_LOGGER.info(
        "=== KPI EXTRAITS ===\n%s",
        json.dumps(snapshot, ensure_ascii=True, indent=2),
    )


def _log_llm_prompt_debug(
    *,
    analysis_mode: str,
    image_type: str,
    visible_kpis: list[str],
    prompt: str | None,
    skipped_reason: str | None = None,
) -> None:
    if prompt is None:
        MULTIMODAL_LOGGER.info(
            "=== PROMPT FINAL LLM ===\nmode=%s image_type=%s visible_kpis=%d status=skipped reason=%s",
            analysis_mode,
            image_type,
            len(visible_kpis),
            skipped_reason or "not_requested",
        )
        return
    MULTIMODAL_LOGGER.info(
        "=== PROMPT FINAL LLM ===\nmode=%s image_type=%s visible_kpis=%d\n%s",
        analysis_mode,
        image_type,
        len(visible_kpis),
        _truncate_debug_text(prompt),
    )


def _log_llm_response_debug(
    *,
    analysis_mode: str,
    image_type: str,
    raw_answer: str,
    skipped_reason: str | None = None,
) -> None:
    if not raw_answer.strip():
        MULTIMODAL_LOGGER.info(
            "=== REPONSE BRUTE LLM ===\nmode=%s image_type=%s status=empty reason=%s",
            analysis_mode,
            image_type,
            skipped_reason or "empty_response",
        )
        return
    MULTIMODAL_LOGGER.info(
        "=== REPONSE BRUTE LLM ===\nmode=%s image_type=%s\n%s",
        analysis_mode,
        image_type,
        _truncate_debug_text(raw_answer),
    )


def _log_final_answer_debug(
    *,
    analysis_mode: str,
    image_type: str,
    visible_kpis: list[str],
    final_answer: str,
) -> None:
    MULTIMODAL_LOGGER.info(
        "=== REPONSE FINALE ===\nmode=%s image_type=%s visible_kpis=%d\n%s",
        analysis_mode,
        image_type,
        len(visible_kpis),
        _truncate_debug_text(final_answer),
    )


def _sanitize_stage_notices_for_visible_kpis(
    stage_notices: list[str],
    visible_kpis: list[str],
) -> list[str]:
    if len(visible_kpis) < VISIBLE_KPI_STRICT_THRESHOLD:
        return stage_notices
    blocked_snippets = (
        "texte insuffisant",
        "fiabilite a confirmer",
        "lecture partielle",
        "indicateurs insuffisants",
        "capture a enrichir",
        "capture doit etre enrichie",
        "analyse basee sur la capture",
        "analyse basee sur les kpi visibles",
        "analyse limitee",
        "analyse exploitable",
        "ocr non exploitable",
        "ocr indisponible",
        "lecture ocr",
        "lecture approfondie",
        "lecture visuelle",
        "signaux visibles",
        "consolider les signaux visibles",
        "lecture decisionnelle priorisee",
        "zones exposees",
        "analyse limitée",
    )
    return [
        notice
        for notice in stage_notices
        if all(snippet not in _normalize_invoice_text(notice) for snippet in blocked_snippets)
    ]


def _sanitize_stage_notices_for_dashboard_kpi_strict_response(
    stage_notices: list[str],
    image_type: str,
) -> list[str]:
    if not _should_use_dashboard_kpi_strict_response(image_type):
        return stage_notices
    blocked_snippets = (
        "lecture documentaire locale indisponible",
        "lecture ocr",
        "capture a enrichir",
        "capture doit etre enrichie",
        "lecture visuelle approfondie",
        "analyse exploitable",
        "consolider les signaux visibles",
        "lecture decisionnelle priorisee",
    )
    return [
        notice
        for notice in stage_notices
        if all(snippet not in _normalize_invoice_text(notice) for snippet in blocked_snippets)
    ]


def _has_material_visible_signals(
    *,
    image_type: str,
    ocr_result: OcrExtractionResult,
    decision_engine_result: RecommendationEngineResult,
) -> bool:
    incident = ocr_result.incident_details
    incident_driven_dashboard = (
        image_type == "dashboard"
        and incident is not None
        and bool(
            incident.critical_alert_count is not None
            or incident.at_risk_clients_count is not None
            or incident.exposure_rate
            or incident.churn_rate
            or incident.financial_impact_mad
            or incident.revenue_at_risk_mad
            or incident.fraud_score_visible
            or incident.anomaly_score_visible
            or incident.cost_score_visible
            or incident.max_risk_scores
            or ocr_result.departments
        )
    )
    if image_type == "facture" and ocr_result.invoice_details is not None:
        invoice = ocr_result.invoice_details
        return bool(
            invoice.total_amount_mad
            or invoice.amount_ttc_mad
            or invoice.cost_items
            or invoice.anomalies
        )
    if (image_type in ALERT_FOCUSED_IMAGE_TYPES or incident_driven_dashboard) and incident is not None:
        return bool(
            incident.critical_alert_count is not None
            or incident.at_risk_clients_count is not None
            or incident.exposure_rate
            or incident.churn_rate
            or incident.financial_impact_mad
            or incident.revenue_at_risk_mad
            or incident.average_score
            or incident.risk_score
            or incident.critical_signals
        )
    return bool(
        ocr_result.amounts_mad
        or ocr_result.kpis
        or ocr_result.visible_tables
        or decision_engine_result.fraud_score >= 55
        or decision_engine_result.anomaly_score >= 55
        or decision_engine_result.cost_score >= 55
    )


def _compute_ai_risk_score(
    *,
    image_type: str,
    ocr_result: OcrExtractionResult,
    decision_engine_result: RecommendationEngineResult,
) -> int:
    base_components = [
        _risk_level_weight(decision_engine_result.risk_level),
        decision_engine_result.anomaly_score,
        decision_engine_result.fraud_score,
        decision_engine_result.cost_score,
    ]
    ai_risk_score = round(sum(base_components) / len(base_components))
    if image_type in ALERT_FOCUSED_IMAGE_TYPES and ocr_result.incident_details is not None:
        incident = ocr_result.incident_details
        if (
            (incident.revenue_at_risk_value_mad or incident.financial_impact_value_mad or 0.0) >= 1_000_000
        ):
            ai_risk_score = max(ai_risk_score, 88)
        if (incident.at_risk_clients_count or 0) >= 1000:
            ai_risk_score = max(ai_risk_score, 84)
        if (incident.critical_alert_count or 0) >= 1000:
            ai_risk_score = max(ai_risk_score, 86)
        if "100/100" in (incident.max_risk_scores or []):
            ai_risk_score = max(ai_risk_score, 90)
        if max((incident.exposure_rate_pct or 0.0), (incident.churn_rate_pct or 0.0)) >= 50.0:
            ai_risk_score = max(ai_risk_score, 80)
    if image_type == "facture" and ocr_result.invoice_details is not None:
        invoice = ocr_result.invoice_details
        top_share = invoice.cost_items[0].share_of_total_pct if invoice.cost_items else 0.0
        if (top_share or 0.0) >= 30.0:
            ai_risk_score = max(ai_risk_score, 76)
        if invoice.risk_level == "critical":
            ai_risk_score = max(ai_risk_score, 84)
    return max(0, min(ai_risk_score, 99))


def _derive_financial_impact_level(
    *,
    image_type: str,
    ocr_result: OcrExtractionResult,
    decision_engine_result: RecommendationEngineResult,
) -> str:
    visible_amount = 0.0
    visible_alert_count = 0
    exposure_rate_pct = 0.0
    incident = ocr_result.incident_details
    incident_driven_dashboard = (
        image_type == "dashboard"
        and incident is not None
        and bool(
            incident.at_risk_clients_count is not None
            or incident.churn_rate
            or incident.revenue_at_risk_mad
            or incident.financial_impact_mad
            or incident.fraud_score_visible
            or incident.anomaly_score_visible
        )
    )
    if (image_type in ALERT_FOCUSED_IMAGE_TYPES or incident_driven_dashboard) and incident is not None:
        visible_amount = (
            incident.revenue_at_risk_value_mad
            or incident.financial_impact_value_mad
            or 0.0
        )
        visible_alert_count = max(
            incident.critical_alert_count or 0,
            incident.at_risk_clients_count or 0,
        )
        exposure_rate_pct = max(
            incident.exposure_rate_pct or 0.0,
            incident.churn_rate_pct or 0.0,
        )
    elif image_type == "facture" and ocr_result.invoice_details is not None:
        visible_amount = _extract_invoice_amount_value(
            ocr_result.invoice_details.total_amount_mad or ocr_result.invoice_details.amount_ttc_mad
        ) or 0.0
    elif ocr_result.amounts_mad:
        visible_amount = _extract_invoice_amount_value(ocr_result.amounts_mad[0]) or 0.0

    if (
        visible_amount >= 1_000_000
        or decision_engine_result.cost_score >= 80
        or decision_engine_result.fraud_score >= 80
        or decision_engine_result.anomaly_score >= 80
        or visible_alert_count >= 1000
    ):
        return "Eleve"
    if (
        visible_amount >= 150_000
        or decision_engine_result.cost_score >= 55
        or decision_engine_result.fraud_score >= 60
        or decision_engine_result.anomaly_score >= 50
        or visible_alert_count >= 3
        or exposure_rate_pct >= 40.0
    ):
        return "Moyen"
    return "Faible"


def _build_score_ia_section(
    *,
    image_type: str,
    ocr_result: OcrExtractionResult,
    decision_engine_result: RecommendationEngineResult,
    resolved_risk_level: str | None = None,
) -> list[str]:
    ai_risk_score = _compute_ai_risk_score(
        image_type=image_type,
        ocr_result=ocr_result,
        decision_engine_result=decision_engine_result,
    )
    return [
        "Score IA metier",
        f"- Risque IA: {ai_risk_score}%",
        f"- Impact financier: {_derive_financial_impact_level(image_type=image_type, ocr_result=ocr_result, decision_engine_result=decision_engine_result)}",
        f"- Criticite: {_format_risk_level_label(resolved_risk_level or decision_engine_result.risk_level)}",
        f"- Confiance OCR: {round(_effective_ocr_confidence(ocr_result) * 100)}%",
    ]


def _resolve_business_risk_level(
    *,
    initial_risk_level: str | None,
    image_type: str,
    ocr_result: OcrExtractionResult,
    decision_engine_result: RecommendationEngineResult,
    parsed_severity: str | None = None,
) -> str:
    risk_level = (initial_risk_level or "").strip().lower() or None
    if risk_level is None:
        if parsed_severity == "critique":
            risk_level = "critical"
        elif parsed_severity == "elevee":
            risk_level = "high"
        elif parsed_severity == "faible":
            risk_level = "low"
        else:
            risk_level = "medium"

    if (
        decision_engine_result.fraud_score >= 80
        or decision_engine_result.anomaly_score >= 80
        or decision_engine_result.cost_score >= 80
    ):
        risk_level = "critical"
    elif (
        risk_level in {"low", "medium"}
        and (
            decision_engine_result.fraud_score >= 60
            or decision_engine_result.anomaly_score >= 60
            or decision_engine_result.cost_score >= 60
        )
    ):
        risk_level = "high"

    incident = ocr_result.incident_details
    incident_driven_dashboard = (
        image_type == "dashboard"
        and incident is not None
        and bool(
            incident.at_risk_clients_count is not None
            or incident.churn_rate
            or incident.revenue_at_risk_mad
            or incident.financial_impact_mad
            or incident.fraud_score_visible
            or incident.anomaly_score_visible
        )
    )
    if (image_type in ALERT_FOCUSED_IMAGE_TYPES or incident_driven_dashboard) and incident is not None:
        if (
            (
                incident.revenue_at_risk_value_mad
                or incident.financial_impact_value_mad
                or 0.0
            ) >= 1_000_000
            or (incident.at_risk_clients_count or 0) >= 1000
            or (incident.critical_alert_count or 0) >= 1000
            or "100/100" in (incident.max_risk_scores or [])
        ):
            return "critical"
        if (
            max((incident.exposure_rate_pct or 0.0), (incident.churn_rate_pct or 0.0)) >= 50.0
            or (incident.critical_alert_count or 0) >= 100
            or decision_engine_result.fraud_score >= 60
            or (incident.fraud_score_value or 0.0) >= 60.0
            or (incident.anomaly_score_value or 0.0) >= 50.0
        ):
            return "high"
    visible_amount = _extract_invoice_amount_value(ocr_result.amounts_mad[0]) if ocr_result.amounts_mad else 0.0
    if (visible_amount or 0.0) >= 1_000_000:
        return "critical"
    if risk_level in {"low", "medium"} and (visible_amount or 0.0) >= 150_000:
        return "high"
    return risk_level


def _resolve_business_priority(
    *,
    initial_priority: str | None,
    resolved_risk_level: str,
    image_type: str,
    ocr_result: OcrExtractionResult,
    decision_engine_result: RecommendationEngineResult,
) -> str:
    normalized_priority = (initial_priority or "").strip().lower()
    incident = ocr_result.incident_details if image_type in ALERT_FOCUSED_IMAGE_TYPES else None
    if (
        incident is None
        and image_type == "dashboard"
        and ocr_result.incident_details is not None
        and (
            ocr_result.incident_details.at_risk_clients_count is not None
            or ocr_result.incident_details.churn_rate
            or ocr_result.incident_details.revenue_at_risk_mad
            or ocr_result.incident_details.financial_impact_mad
            or ocr_result.incident_details.fraud_score_visible
            or ocr_result.incident_details.anomaly_score_visible
        )
    ):
        incident = ocr_result.incident_details
    visible_amount = _extract_invoice_amount_value(ocr_result.amounts_mad[0]) if ocr_result.amounts_mad else 0.0

    if (
        resolved_risk_level == "critical"
        or decision_engine_result.fraud_score >= 80
        or decision_engine_result.anomaly_score >= 80
        or decision_engine_result.cost_score >= 80
        or (visible_amount or 0.0) >= 1_000_000
        or (
            incident is not None
            and (
                (incident.financial_impact_value_mad or 0.0) >= 1_000_000
                or (incident.revenue_at_risk_value_mad or 0.0) >= 1_000_000
                or (incident.at_risk_clients_count or 0) >= 1000
                or (incident.critical_alert_count or 0) >= 1000
                or "100/100" in (incident.max_risk_scores or [])
            )
        )
    ):
        return "immediate"
    if (
        normalized_priority == "immediate"
        or resolved_risk_level == "high"
        or decision_engine_result.fraud_score >= 60
        or decision_engine_result.anomaly_score >= 50
        or decision_engine_result.cost_score >= 55
        or (visible_amount or 0.0) >= 150_000
        or (
            incident is not None
            and (
                max((incident.exposure_rate_pct or 0.0), (incident.churn_rate_pct or 0.0)) >= 50.0
                or (incident.fraud_score_value or 0.0) >= 60.0
                or (incident.anomaly_score_value or 0.0) >= 50.0
            )
        )
    ):
        return "haute"
    if normalized_priority in {"haute", "normale", "basse"}:
        return normalized_priority
    return "normale"


def _polish_business_answer(
    *,
    answer: str,
    image_type: str,
    ocr_result: OcrExtractionResult,
    decision_engine_result: RecommendationEngineResult,
) -> str:
    if not answer.strip():
        return answer

    material_signals = _has_material_visible_signals(
        image_type=image_type,
        ocr_result=ocr_result,
        decision_engine_result=decision_engine_result,
    )
    filtered_lines: list[str] = []
    seen_lines = set()
    for raw_line in answer.splitlines():
        stripped_line = raw_line.strip()
        if not stripped_line:
            if filtered_lines and filtered_lines[-1] != "":
                filtered_lines.append("")
            continue
        normalized_line = _normalize_invoice_text(stripped_line)
        if material_signals and _contains_defensive_business_phrase(stripped_line):
            continue
        if normalized_line in seen_lines:
            continue
        seen_lines.add(normalized_line)
        filtered_lines.append(stripped_line)

    polished_lines: list[str] = []
    for index, line in enumerate(filtered_lines):
        if line == "" and (index == 0 or index == len(filtered_lines) - 1):
            continue
        polished_lines.append(line)
    return "\n".join(polished_lines).strip()


def _estimate_alert_savings(
    *,
    incident_details: IncidentDocumentDetails,
    decision_engine_result: RecommendationEngineResult,
) -> str | None:
    financial_impact = incident_details.financial_impact_value_mad or 0.0
    if financial_impact <= 0:
        return None
    ratio = 0.12
    if incident_details.alert_type in {"fraude", "appel_suspect"}:
        ratio = 0.28
    elif incident_details.data_overage or incident_details.alert_type == "depassement_quota":
        ratio = 0.18
    elif decision_engine_result.risk_level == "critical":
        ratio = 0.22
    return _format_invoice_amount(financial_impact * ratio)


def _build_alert_timeline(
    *,
    incident_details: IncidentDocumentDetails,
    decision_engine_result: RecommendationEngineResult,
    top_actions: list[str],
) -> list[ChatAlertTimelineItem]:
    timeline: list[ChatAlertTimelineItem] = []
    if incident_details.critical_alert_count is not None:
        timeline.append(
            ChatAlertTimelineItem(
                label="Volume d'alertes",
                detail=f"{incident_details.critical_alert_count} alertes critiques visibles.",
                status="critical" if incident_details.critical_alert_count >= 1000 else "watch",
            )
        )
    if incident_details.at_risk_clients_count is not None:
        timeline.append(
            ChatAlertTimelineItem(
                label="Clients a risque",
                detail=f"{incident_details.at_risk_clients_count} clients a risque visibles.",
                status="critical" if incident_details.at_risk_clients_count >= 1000 else "watch",
            )
        )
    if incident_details.exposure_rate:
        timeline.append(
            ChatAlertTimelineItem(
                label="Exposition",
                detail=f"Taux d'exposition observe a {incident_details.exposure_rate}.",
                status="critical"
                if (incident_details.exposure_rate_pct or 0.0) >= 50.0
                else "watch",
            )
        )
    if incident_details.churn_rate:
        timeline.append(
            ChatAlertTimelineItem(
                label="Churn",
                detail=f"Taux de churn observe a {incident_details.churn_rate}.",
                status="critical"
                if (incident_details.churn_rate_pct or 0.0) >= 50.0
                else "watch",
            )
        )
    if incident_details.financial_impact_mad:
        timeline.append(
            ChatAlertTimelineItem(
                label="Impact financier",
                detail=f"Exposition economique visible a {incident_details.financial_impact_mad}.",
                status="critical"
                if (incident_details.financial_impact_value_mad or 0.0) >= 1_000_000
                else "watch",
            )
        )
    if incident_details.max_risk_scores or incident_details.risk_score:
        timeline.append(
            ChatAlertTimelineItem(
                label="Profils a risque",
                detail=(
                    "Des scores 100/100 sont visibles sur plusieurs profils."
                    if "100/100" in (incident_details.max_risk_scores or [])
                    else f"Score de risque visible: {incident_details.risk_score}."
                    if incident_details.risk_score
                    else "Des profils a risque sont visibles sur la capture."
                ),
                status="critical"
                if "100/100" in (incident_details.max_risk_scores or [])
                else "watch",
            )
        )
    if top_actions:
        timeline.append(
            ChatAlertTimelineItem(
                label="Action immediate",
                detail=top_actions[0],
                status="action",
            )
        )
    if not timeline and incident_details.summary:
        timeline.append(
            ChatAlertTimelineItem(
                label="Synthese",
                detail=incident_details.summary,
                status="observed",
            )
        )
    return timeline[:5]


def _build_alert_intelligence(
    *,
    incident_details: IncidentDocumentDetails | None,
    decision_engine_result: RecommendationEngineResult,
    ocr_confidence: float | None,
) -> ChatAlertIntelligence | None:
    if incident_details is None:
        return None

    max_risk_scores = incident_details.max_risk_scores or (
        [incident_details.risk_score] if incident_details.risk_score else []
    )
    risk_signals = [
        _risk_level_weight(decision_engine_result.risk_level),
        decision_engine_result.anomaly_score,
        decision_engine_result.fraud_score,
        decision_engine_result.cost_score,
    ]
    ai_risk_score = round(sum(risk_signals) / len(risk_signals))
    if incident_details.critical_alert_count is not None and incident_details.critical_alert_count >= 1000:
        ai_risk_score = max(ai_risk_score, 86)
    if (
        incident_details.at_risk_clients_count is not None
        and incident_details.at_risk_clients_count >= 1000
    ):
        ai_risk_score = max(ai_risk_score, 84)
    if (
        (
            incident_details.revenue_at_risk_value_mad
            or incident_details.financial_impact_value_mad
            or 0.0
        ) >= 1_000_000
    ):
        ai_risk_score = max(ai_risk_score, 88)
    if "100/100" in max_risk_scores:
        ai_risk_score = max(ai_risk_score, 90)
    if max((incident_details.exposure_rate_pct or 0.0), (incident_details.churn_rate_pct or 0.0)) >= 50.0:
        ai_risk_score = max(ai_risk_score, 80)
    ai_risk_score = max(0, min(ai_risk_score, 99))

    criticity = (decision_engine_result.risk_level or "medium").strip().lower()
    if (
        (
            incident_details.revenue_at_risk_value_mad
            or incident_details.financial_impact_value_mad
            or 0.0
        ) >= 1_000_000
        or (incident_details.at_risk_clients_count or 0) >= 1000
        or (incident_details.critical_alert_count or 0) >= 1000
        or "100/100" in max_risk_scores
        or decision_engine_result.fraud_score >= 80
        or decision_engine_result.anomaly_score >= 80
        or decision_engine_result.cost_score >= 80
    ):
        criticity = "critical"
    elif (
        criticity in {"low", "medium"}
        and (
            max((incident_details.exposure_rate_pct or 0.0), (incident_details.churn_rate_pct or 0.0)) >= 40.0
            or (incident_details.critical_alert_count or 0) >= 3
            or (incident_details.at_risk_clients_count or 0) >= 1000
            or decision_engine_result.fraud_score >= 60
            or decision_engine_result.anomaly_score >= 50
            or decision_engine_result.cost_score >= 55
        )
    ):
        criticity = "high"
    priority_kpis = _dedupe_items(
        [
            (
                f"{incident_details.critical_alert_count} alertes critiques"
                if incident_details.critical_alert_count is not None
                else ""
            ),
            (
                f"Taux d'exposition {incident_details.exposure_rate}"
                if incident_details.exposure_rate
                else ""
            ),
            (
                f"Impact financier {incident_details.financial_impact_mad}"
                if incident_details.financial_impact_mad
                else ""
            ),
            (
                f"Impact estime {incident_details.estimated_impact_mad}"
                if incident_details.estimated_impact_mad
                else ""
            ),
            (
                f"Clients a risque {incident_details.at_risk_clients_count}"
                if incident_details.at_risk_clients_count is not None
                else ""
            ),
            (
                f"Taux churn {incident_details.churn_rate}"
                if incident_details.churn_rate
                else ""
            ),
            (
                f"Score moyen {incident_details.average_score}"
                if incident_details.average_score
                else ""
            ),
            (
                "Scores 100/100 visibles"
                if "100/100" in max_risk_scores
                else f"Score de risque {incident_details.risk_score}"
                if incident_details.risk_score
                else ""
            ),
        ],
        6,
    )
    visible_evidence = _dedupe_items(
        [
            *incident_details.critical_signals[:4],
            *incident_details.repeated_anomalies[:2],
            *incident_details.visible_statuses[:2],
        ],
        6,
    )
    immediate_actions = _dedupe_items(
        [recommendation.title for recommendation in decision_engine_result.recommendations[:4]],
        4,
    )
    recommended_controls = _dedupe_items(
        [
            *[
                recommendation.reason
                for recommendation in decision_engine_result.recommendations[:4]
                if recommendation.reason
            ],
            *incident_details.probable_causes[:2],
        ],
        5,
    )
    financial_anchor = (
        incident_details.revenue_at_risk_mad
        or incident_details.financial_impact_mad
        or incident_details.estimated_impact_mad
        or incident_details.suspect_cost_mad
    )
    business_risk = (
        "Le cumul des alertes visibles expose la flotte a une derive budgetaire et a une surcharge de supervision."
    )
    if incident_details.alert_type in {"fraude", "appel_suspect"}:
        business_risk = (
            "Les alertes fraude detectees traduisent un risque eleve et un besoin de containment rapide sur les lignes exposees."
        )
    elif incident_details.alert_type == "log":
        business_risk = (
            "Les logs visibles traduisent un risque de continuite de service et de supervision si la cause n'est pas traitee."
        )
    elif incident_details.data_overage or incident_details.alert_type == "depassement_quota":
        business_risk = (
            "Les depassements visibles peuvent accelerer la derive des couts telecom si les lignes ne sont pas recadrees."
        )

    executive_summary_parts = _dedupe_items(
        [
            (
                f"{incident_details.critical_alert_count} alertes critiques actives"
                if incident_details.critical_alert_count is not None
                else ""
            ),
            (
                f"un taux d'exposition de {incident_details.exposure_rate}"
                if incident_details.exposure_rate
                else ""
            ),
            (
                f"un revenu a risque visible de {incident_details.revenue_at_risk_mad}"
                if incident_details.revenue_at_risk_mad
                else ""
            ),
            (
                f"un impact estime de {incident_details.estimated_impact_mad}"
                if incident_details.estimated_impact_mad
                else ""
            ),
            (
                f"{incident_details.at_risk_clients_count} clients a risque"
                if incident_details.at_risk_clients_count is not None
                else ""
            ),
            (
                f"un taux de churn de {incident_details.churn_rate}"
                if incident_details.churn_rate
                else ""
            ),
            (
                "des scores 100/100 sur des profils a risque"
                if "100/100" in max_risk_scores
                else ""
            ),
        ],
        4,
    )
    if executive_summary_parts:
        executive_summary = (
            "Le visuel d'alerte met en evidence "
            + ", ".join(executive_summary_parts[:-1])
            + (
                " et " + executive_summary_parts[-1]
                if len(executive_summary_parts) > 1
                else executive_summary_parts[0]
            )
            + "."
        )
    else:
        executive_summary = incident_details.summary or "Les indicateurs visibles appellent une lecture de supervision prioritaire."

    audit_focus = (
        "Auditer en premier les profils 100/100 et les lignes a plus fort impact financier."
        if "100/100" in max_risk_scores and financial_anchor
        else "Consolider les alertes critiques visibles puis verifier les lignes les plus exposees."
    )
    return ChatAlertIntelligence(
        alert_family=incident_details.alert_type,
        ai_risk_score=ai_risk_score,
        ocr_confidence_score=(
            max(0, min(round((ocr_confidence or 0.0) * 100), 100))
            if ocr_confidence is not None
            else None
        ),
        criticity=criticity,
        executive_summary=executive_summary,
        business_risk=business_risk,
        financial_exposure_mad=financial_anchor,
        potential_loss_mad=financial_anchor,
        possible_savings_mad=_estimate_alert_savings(
            incident_details=incident_details,
            decision_engine_result=decision_engine_result,
        ),
        priority_kpis=priority_kpis,
        visible_evidence=visible_evidence,
        at_risk_entities=incident_details.risky_entities[:5],
        immediate_actions=immediate_actions,
        recommended_controls=recommended_controls,
        alert_timeline=_build_alert_timeline(
            incident_details=incident_details,
            decision_engine_result=decision_engine_result,
            top_actions=immediate_actions,
        ),
        audit_focus=audit_focus,
    )


def _has_alert_value_signal(value: str) -> bool:
    return bool(
        re.search(
            r"\d|%|\bmad\b|\b100\s*/\s*100\b",
            value,
            flags=re.IGNORECASE,
        )
    )


def _find_alert_line(lines: list[str], keywords: tuple[str, ...]) -> str | None:
    normalized_keywords = tuple(_normalize_invoice_text(keyword) for keyword in keywords)
    for index, line in enumerate(lines):
        normalized_line = _normalize_invoice_text(line)
        if not any(keyword in normalized_line for keyword in normalized_keywords):
            continue

        candidate_windows: list[str] = []
        window_ranges = (
            (index, index),
            (index, index + 1),
            (index, index + 2),
            (max(0, index - 1), index),
            (max(0, index - 1), min(len(lines) - 1, index + 1)),
        )
        for start, end in window_ranges:
            window = " ".join(
                " ".join(lines[position].split()).strip()
                for position in range(start, min(end + 1, len(lines)))
                if " ".join(lines[position].split()).strip()
            ).strip()
            if window and window not in candidate_windows:
                candidate_windows.append(window)

        for candidate in candidate_windows:
            if _has_alert_value_signal(candidate):
                return candidate

        if candidate_windows:
            return candidate_windows[0]
    return None


def _extract_integer_value(value: str | None) -> int | None:
    if not value:
        return None
    match = re.search(r"(?<!\d)(\d{1,3}(?:[ .]\d{3})*|\d+)(?!\d)", value)
    if not match:
        return None
    try:
        return int(match.group(1).replace(" ", "").replace(".", ""))
    except ValueError:
        return None


def _extract_percentage_value(value: str | None) -> float | None:
    if not value:
        return None
    match = re.search(r"(\d{1,3}(?:[.,]\d{1,2})?)\s*%", value)
    if not match:
        return None
    try:
        return float(match.group(1).replace(",", "."))
    except ValueError:
        return None


def _extract_percentage_near_keywords(
    lines: list[str],
    keywords: tuple[str, ...],
) -> tuple[str | None, float | None]:
    candidate_line = _find_alert_line(lines, keywords)
    if not candidate_line:
        return (None, None)
    match = re.search(r"(\d{1,3}(?:[.,]\d{1,2})?)\s*%", candidate_line)
    if not match:
        return (None, None)
    percentage = f"{match.group(1).replace('.', ',')}%"
    return percentage, _extract_percentage_value(percentage)


def _compact_alert_text(value: str | None) -> str:
    return " ".join((value or "").replace("\u00a0", " ").split())


def _normalize_score_token(value: str) -> str:
    return re.sub(r"\s+", "", value)


def _find_first_group_across_texts(
    texts: list[str],
    patterns: tuple[str, ...],
    group_name: str,
) -> str | None:
    for text in texts:
        if not text:
            continue
        for pattern in patterns:
            match = re.search(pattern, text, flags=re.IGNORECASE)
            if match:
                value = match.group(group_name)
                if value:
                    return " ".join(value.split()).strip()
    return None


def _find_first_department_across_texts(texts: list[str]) -> str | None:
    for text in texts:
        departments = _detect_departments(text)
        if departments:
            return departments[0]
    return None


def _extract_contract_exposure_across_texts(texts: list[str]) -> str | None:
    count = _find_first_group_across_texts(
        texts,
        (
            r"(?P<count>\d{1,3}(?:[ .]\d{3})*|\d+)\s+clients?\s+sur\s+contrat\s+(?:mensuel|annuel|monthly|annual)\b",
            r"(?:contrat\s+(?:mensuel|annuel)|monthly contract|annual contract)[^\d]{0,24}(?P<count>\d{1,3}(?:[ .]\d{3})*|\d+)\s+clients?\b",
        ),
        "count",
    )
    if not count:
        return None
    normalized_text = " ".join(texts).lower()
    if "annuel" in normalized_text or "annual" in normalized_text:
        return f"{count} clients sur contrat annuel"
    return f"{count} clients sur contrat mensuel"


def extract_alert_dashboard_kpis(
    ocr_text: str,
    vision_text: str,
) -> AlertDashboardKpis:
    source_texts = [
        _compact_alert_text(ocr_text),
        _compact_alert_text(vision_text),
    ]
    combined_text = " ".join(text for text in source_texts if text).strip()
    if not combined_text:
        return AlertDashboardKpis()

    critical_alert_text = _find_first_group_across_texts(
        source_texts,
        (
            r"(?P<count>\d{1,3}(?:[ .]\d{3})*|\d+)\s*(?:alertes?\s+)?critiques?\b",
            r"(?:alertes?\s+critiques?|critical alerts?|critiques?\b)[^\d]{0,24}(?P<count>\d{1,3}(?:[ .]\d{3})*|\d+)",
        ),
        "count",
    )
    critical_alerts = _extract_integer_value(critical_alert_text)

    exposure_rate = _find_first_group_across_texts(
        source_texts,
        (
            r"(?:taux\s+d['’]?\s*exposition|exposure rate|risk exposure|exposition)[^\d]{0,24}(?P<rate>\d{1,3}(?:[.,]\d{1,2})?)\s*%",
            r"(?P<rate>\d{1,3}(?:[.,]\d{1,2})?)\s*%[^\n\r]{0,24}(?:taux\s+d['’]?\s*exposition|exposure rate|risk exposure|exposition)",
        ),
        "rate",
    )
    exposure_rate = f"{exposure_rate.replace('.', ',')}%" if exposure_rate else None
    exposure_rate_pct = _extract_percentage_value(exposure_rate)

    financial_impact_source = _find_first_group_across_texts(
        source_texts,
        (
            r"(?:impact\s+financier(?:\s+potentiel)?|financial impact|exposition financiere|perte potentielle)[^\d]{0,32}(?P<amount>\d{1,3}(?:[ .]\d{3})*(?:[.,]\d{2})?|\d+(?:[.,]\d+)?)\s*(?:MAD|DH|DHS)",
            r"(?P<amount>\d{1,3}(?:[ .]\d{3})*(?:[.,]\d{2})?|\d+(?:[.,]\d+)?)\s*(?:MAD|DH|DHS)[^\n\r]{0,32}(?:impact\s+financier(?:\s+potentiel)?|financial impact|exposition financiere|perte potentielle)",
        ),
        "amount",
    )
    financial_impact_value_mad = _extract_invoice_amount_value(
        f"{financial_impact_source} MAD" if financial_impact_source else None
    )
    financial_impact_mad = (
        _format_invoice_amount(financial_impact_value_mad)
        or (f"{financial_impact_source} MAD" if financial_impact_source else None)
    )

    average_score = _find_first_group_across_texts(
        source_texts,
        (
            r"(?:score\s+moyen(?:\s+de\s+risque)?|average score|score global)[^\d]{0,20}(?P<score>\d{1,3}(?:[.,]\d{1,2})?)",
            r"(?P<score>\d{1,3}(?:[.,]\d{1,2})?)[^\n\r]{0,20}(?:score\s+moyen(?:\s+de\s+risque)?|average score|score global)",
        ),
        "score",
    )
    average_score = average_score.replace(".", ",") if average_score else None
    try:
        average_score_value = float(average_score.replace(",", ".")) if average_score else None
    except ValueError:
        average_score_value = None

    max_risk_scores = tuple(
        _dedupe_items(
            [
                _normalize_score_token(match.group("score"))
                for text in source_texts
                for match in re.finditer(
                    r"(?P<score>\d{1,3}\s*/\s*100)",
                    text,
                    flags=re.IGNORECASE,
                )
            ],
            6,
        )
    )

    risk_level: str | None = None
    if (
        (financial_impact_value_mad or 0.0) >= 1_000_000
        or (critical_alerts or 0) >= 1000
        or any(score == "100/100" for score in max_risk_scores)
    ):
        risk_level = "critical"
    elif (exposure_rate_pct or 0.0) >= 50.0:
        risk_level = "high"
    elif any(
        (
            critical_alerts is not None,
            exposure_rate_pct is not None,
            financial_impact_value_mad is not None,
            average_score_value is not None,
        )
    ):
        risk_level = "medium"

    return AlertDashboardKpis(
        critical_alerts=critical_alerts,
        exposure_rate=exposure_rate,
        exposure_rate_pct=exposure_rate_pct,
        financial_impact_mad=financial_impact_mad,
        financial_impact_value_mad=financial_impact_value_mad,
        average_score=average_score,
        average_score_value=average_score_value,
        max_risk_scores=max_risk_scores,
        risk_level=risk_level,
    )


def extract_alert_dashboard_kpis(
    ocr_text: str,
    vision_text: str,
) -> AlertDashboardKpis:
    source_texts = [
        _compact_alert_text(ocr_text),
        _compact_alert_text(vision_text),
    ]
    combined_text = " ".join(text for text in source_texts if text).strip()
    if not combined_text:
        return AlertDashboardKpis()

    critical_alert_text = _find_first_group_across_texts(
        source_texts,
        (
            r"(?P<count>\d{1,3}(?:[ .]\d{3})*|\d+)\s*(?:alertes?\s+)?critiques?\b",
            r"(?:alertes?\s+critiques?|critical alerts?|critiques?\b)[^\d]{0,24}(?P<count>\d{1,3}(?:[ .]\d{3})*|\d+)",
        ),
        "count",
    )
    critical_alerts = _extract_integer_value(critical_alert_text)

    at_risk_clients_text = _find_first_group_across_texts(
        source_texts,
        (
            r"(?P<count>\d{1,3}(?:[ .]\d{3})*|\d+)\s+(?:clients?\s+a\s+risque|clients?\s+at\s+risk|utilisateurs?\s+a\s+risque)\b",
            r"(?:clients?\s+a\s+risque|clients?\s+at\s+risk|utilisateurs?\s+a\s+risque)\s*[:=-]?\s*(?P<count>\d{1,3}(?:[ .]\d{3})*|\d+)\b(?![.,]\d)",
        ),
        "count",
    )
    at_risk_clients_count = _extract_integer_value(at_risk_clients_text)
    department_risk = _find_first_department_across_texts(source_texts)
    contract_exposed = _extract_contract_exposure_across_texts(source_texts)

    exposure_rate = _find_first_group_across_texts(
        source_texts,
        (
            r"(?:taux\s+d['’]?\s*exposition|exposure rate|risk exposure|exposition)[^\d]{0,24}(?P<rate>\d{1,3}(?:[.,]\d{1,2})?)\s*%",
            r"(?P<rate>\d{1,3}(?:[.,]\d{1,2})?)\s*%[^\n\r]{0,24}(?:taux\s+d['’]?\s*exposition|exposure rate|risk exposure|exposition)",
        ),
        "rate",
    )
    exposure_rate = f"{exposure_rate.replace('.', ',')}%" if exposure_rate else None
    exposure_rate_pct = _extract_percentage_value(exposure_rate)

    churn_rate = _find_first_group_across_texts(
        source_texts,
        (
            r"(?:taux\s+churn|churn rate|churn)[^\d]{0,24}(?P<rate>\d{1,3}(?:[.,]\d{1,2})?)\s*%",
            r"(?P<rate>\d{1,3}(?:[.,]\d{1,2})?)\s*%[^\n\r]{0,24}(?:taux\s+churn|churn rate|churn)",
        ),
        "rate",
    )
    churn_rate = f"{churn_rate.replace('.', ',')}%" if churn_rate else None
    churn_rate_pct = _extract_percentage_value(churn_rate)

    revenue_at_risk_source = _find_first_group_across_texts(
        source_texts,
        (
            r"(?:revenu\s+a\s+risque|revenue at risk|exposition portefeuille|portfolio exposure|revenu risque)[^\d]{0,32}(?P<amount>\d{1,3}(?:[ .]\d{3})*(?:[.,]\d{2})?|\d+(?:[.,]\d+)?)\s*(?:MAD|DH|DHS)",
            r"(?P<amount>\d{1,3}(?:[ .]\d{3})*(?:[.,]\d{2})?|\d+(?:[.,]\d+)?)\s*(?:MAD|DH|DHS)[^\n\r]{0,32}(?:revenu\s+a\s+risque|revenue at risk|exposition portefeuille|portfolio exposure|revenu risque)",
        ),
        "amount",
    )
    revenue_at_risk_value_mad = _extract_invoice_amount_value(
        f"{revenue_at_risk_source} MAD" if revenue_at_risk_source else None
    )
    revenue_at_risk_mad = (
        _format_invoice_amount(revenue_at_risk_value_mad)
        or (f"{revenue_at_risk_source} MAD" if revenue_at_risk_source else None)
    )

    estimated_impact_source = _find_first_group_across_texts(
        source_texts,
        (
            r"(?:impact\s+estime|impact\s+estim[eé]|impact\s+financier(?:\s+potentiel)?|financial impact|estimated impact|perte potentielle)[^\d]{0,32}(?P<amount>\d{1,3}(?:[ .]\d{3})*(?:[.,]\d{2})?|\d+(?:[.,]\d+)?)\s*(?:MAD|DH|DHS)",
            r"(?P<amount>\d{1,3}(?:[ .]\d{3})*(?:[.,]\d{2})?|\d+(?:[.,]\d+)?)\s*(?:MAD|DH|DHS)[^\n\r]{0,32}(?:impact\s+estime|impact\s+estim[eé]|impact\s+financier(?:\s+potentiel)?|financial impact|estimated impact|perte potentielle)",
        ),
        "amount",
    )
    estimated_impact_value_mad = _extract_invoice_amount_value(
        f"{estimated_impact_source} MAD" if estimated_impact_source else None
    )
    estimated_impact_mad = (
        _format_invoice_amount(estimated_impact_value_mad)
        or (f"{estimated_impact_source} MAD" if estimated_impact_source else None)
    )
    financial_impact_value_mad = revenue_at_risk_value_mad or estimated_impact_value_mad
    financial_impact_mad = revenue_at_risk_mad or estimated_impact_mad

    average_score = _find_first_group_across_texts(
        source_texts,
        (
            r"(?:score\s+moyen(?:\s+de\s+risque)?|average score|score global)[^\d]{0,20}(?P<score>\d{1,3}(?:[.,]\d{1,2})?)",
            r"(?P<score>\d{1,3}(?:[.,]\d{1,2})?)[^\n\r]{0,20}(?:score\s+moyen(?:\s+de\s+risque)?|average score|score global)",
        ),
        "score",
    )
    average_score = average_score.replace(".", ",") if average_score else None
    try:
        average_score_value = float(average_score.replace(",", ".")) if average_score else None
    except ValueError:
        average_score_value = None

    roi_estimated = _find_first_group_across_texts(
        source_texts,
        (
            r"(?:roi\s+estime|roi estimated|roi)[^\d]{0,18}(?P<rate>\d{1,3}(?:[.,]\d{1,2})?)\s*%",
            r"(?P<rate>\d{1,3}(?:[.,]\d{1,2})?)\s*%[^\n\r]{0,18}(?:roi\s+estime|roi estimated|roi)",
        ),
        "rate",
    )
    roi_estimated = f"{roi_estimated.replace('.', ',')}%" if roi_estimated else None
    roi_estimated_pct = _extract_percentage_value(roi_estimated)

    priority_actions_text = _find_first_group_across_texts(
        source_texts,
        (
            r"(?:actions?\s+prioritaires?|priority actions?)[^\d]{0,20}(?P<count>\d{1,3}(?:[ .]\d{3})*|\d+)",
            r"(?P<count>\d{1,3}(?:[ .]\d{3})*|\d+)[^\n\r]{0,20}(?:actions?\s+prioritaires?|priority actions?)",
        ),
        "count",
    )
    priority_actions_count = _extract_integer_value(priority_actions_text)

    fraud_score_visible = _find_first_group_across_texts(
        source_texts,
        (
            r"(?:score\s+fraude|fraud score|fraude)[^\d]{0,18}(?P<score>\d{1,3}(?:[.,]\d{1,2})?)\s*(?:/100|%)",
            r"(?P<score>\d{1,3}(?:[.,]\d{1,2})?)\s*(?:/100|%)[^\n\r]{0,18}(?:score\s+fraude|fraud score|fraude)",
        ),
        "score",
    )
    fraud_score_visible = f"{fraud_score_visible.replace('.', ',')}/100" if fraud_score_visible else None
    try:
        fraud_score_value = (
            float(fraud_score_visible.replace("/100", "").replace(",", "."))
            if fraud_score_visible
            else None
        )
    except ValueError:
        fraud_score_value = None

    anomaly_score_visible = _find_first_group_across_texts(
        source_texts,
        (
            r"(?:score\s+anomalie|anomaly score|anomalie)[^\d]{0,18}(?P<score>\d{1,3}(?:[.,]\d{1,2})?)\s*(?:/100|%)",
            r"(?P<score>\d{1,3}(?:[.,]\d{1,2})?)\s*(?:/100|%)[^\n\r]{0,18}(?:score\s+anomalie|anomaly score|anomalie)",
        ),
        "score",
    )
    anomaly_score_visible = f"{anomaly_score_visible.replace('.', ',')}/100" if anomaly_score_visible else None
    try:
        anomaly_score_value = (
            float(anomaly_score_visible.replace("/100", "").replace(",", "."))
            if anomaly_score_visible
            else None
        )
    except ValueError:
        anomaly_score_value = None

    optimization_score_visible = _find_first_group_across_texts(
        source_texts,
        (
            r"(?:score\s+optimisation|optimization score|score\s+optimization|optimisation)[^\d]{0,22}(?P<score>\d{1,3}(?:[.,]\d{1,2})?)\s*(?:/100|%)",
            r"(?P<score>\d{1,3}(?:[.,]\d{1,2})?)\s*(?:/100|%)[^\n\r]{0,22}(?:score\s+optimisation|optimization score|score\s+optimization|optimisation)",
        ),
        "score",
    )
    optimization_score_visible = (
        f"{optimization_score_visible.replace('.', ',')}/100"
        if optimization_score_visible
        else None
    )
    try:
        optimization_score_value = (
            float(optimization_score_visible.replace("/100", "").replace(",", "."))
            if optimization_score_visible
            else None
        )
    except ValueError:
        optimization_score_value = None

    cost_score_visible = _find_first_group_across_texts(
        source_texts,
        (
            r"(?:score\s+cout|score\s+couts|cost score|score\s+cost)[^\d]{0,22}(?P<score>\d{1,3}(?:[.,]\d{1,2})?)\s*(?:/100|%)",
            r"(?P<score>\d{1,3}(?:[.,]\d{1,2})?)\s*(?:/100|%)[^\n\r]{0,22}(?:score\s+cout|score\s+couts|cost score|score\s+cost)",
        ),
        "score",
    )
    cost_score_visible = (
        f"{cost_score_visible.replace('.', ',')}/100"
        if cost_score_visible
        else None
    )
    try:
        cost_score_value = (
            float(cost_score_visible.replace("/100", "").replace(",", "."))
            if cost_score_visible
            else None
        )
    except ValueError:
        cost_score_value = None

    max_risk_scores = tuple(
        _dedupe_items(
            [
                _normalize_score_token(match.group("score"))
                for text in source_texts
                for match in re.finditer(
                    r"(?P<score>\d{1,3}\s*/\s*100)",
                    text,
                    flags=re.IGNORECASE,
                )
            ],
            8,
        )
    )

    risk_level: str | None = None
    if (
        (critical_alerts or 0) >= 1000
        or any(score == "100/100" for score in max_risk_scores)
    ):
        risk_level = "critical"
    elif (
        (revenue_at_risk_value_mad or 0.0) >= 1_000_000
        or (at_risk_clients_count or 0) >= 1000
        or (estimated_impact_value_mad or 0.0) >= 150_000
        or (churn_rate_pct or 0.0) >= 50.0
        or (exposure_rate_pct or 0.0) >= 50.0
        or (fraud_score_value or 0.0) >= 60.0
        or (anomaly_score_value or 0.0) >= 50.0
        or (cost_score_value or 0.0) >= 55.0
    ):
        risk_level = "high"
    elif any(
        (
            critical_alerts is not None,
            at_risk_clients_count is not None,
            exposure_rate_pct is not None,
            churn_rate_pct is not None,
            revenue_at_risk_value_mad is not None,
            estimated_impact_value_mad is not None,
            average_score_value is not None,
            fraud_score_value is not None,
            anomaly_score_value is not None,
            optimization_score_value is not None,
            cost_score_value is not None,
        )
    ):
        risk_level = "medium"

    return AlertDashboardKpis(
        critical_alerts=critical_alerts,
        at_risk_clients_count=at_risk_clients_count,
        department_risk=department_risk,
        contract_exposed=contract_exposed,
        exposure_rate=exposure_rate,
        exposure_rate_pct=exposure_rate_pct,
        financial_impact_mad=financial_impact_mad,
        financial_impact_value_mad=financial_impact_value_mad,
        revenue_at_risk_mad=revenue_at_risk_mad,
        revenue_at_risk_value_mad=revenue_at_risk_value_mad,
        estimated_impact_mad=estimated_impact_mad,
        estimated_impact_value_mad=estimated_impact_value_mad,
        churn_rate=churn_rate,
        churn_rate_pct=churn_rate_pct,
        roi_estimated=roi_estimated,
        roi_estimated_pct=roi_estimated_pct,
        priority_actions_count=priority_actions_count,
        average_score=average_score,
        average_score_value=average_score_value,
        fraud_score_visible=fraud_score_visible,
        fraud_score_value=fraud_score_value,
        anomaly_score_visible=anomaly_score_visible,
        anomaly_score_value=anomaly_score_value,
        optimization_score_visible=optimization_score_visible,
        optimization_score_value=optimization_score_value,
        cost_score_visible=cost_score_visible,
        cost_score_value=cost_score_value,
        max_risk_scores=max_risk_scores,
        risk_level=risk_level,
    )


def _extract_decimal_near_keywords(
    lines: list[str],
    keywords: tuple[str, ...],
) -> tuple[str | None, float | None]:
    candidate_line = _find_alert_line(lines, keywords)
    if not candidate_line:
        return (None, None)
    match = re.search(r"(?<!\d)(\d{1,3}(?:[.,]\d{1,2})?)(?!\d)", candidate_line)
    if not match:
        return (None, None)
    decimal_value = match.group(1).replace(".", ",")
    try:
        return decimal_value, float(match.group(1).replace(",", "."))
    except ValueError:
        return (decimal_value, None)


def _extract_count_near_keywords(lines: list[str], keywords: tuple[str, ...]) -> int | None:
    candidate_line = _find_alert_line(lines, keywords)
    if not candidate_line:
        return None
    return _extract_integer_value(candidate_line)


def _extract_score_lines(lines: list[str]) -> list[str]:
    return _dedupe_items(
        [
            " ".join(line.split()).strip()
            for line in lines
            if re.search(r"\b100\s*/\s*100\b", line)
        ],
        6,
    )


def _extract_status_lines(lines: list[str]) -> list[str]:
    status_keywords = (
        "critique",
        "critical",
        "active",
        "actif",
        "open",
        "bloque",
        "blocked",
        "warning",
        "fraude",
        "risque",
        "anomal",
    )
    return _dedupe_items(
        [
            " ".join(line.split()).strip()
            for line in lines
            if len(line.split()) <= 12
            and any(keyword in _normalize_invoice_text(line) for keyword in status_keywords)
        ],
        6,
    )


def _extract_alert_anomaly_lines(lines: list[str]) -> list[str]:
    anomaly_keywords = (
        "anomal",
        "alerte",
        "critique",
        "fraude",
        "suspect",
        "impact financier",
        "exposition",
        "score",
    )
    return _dedupe_items(
        [
            " ".join(line.split()).strip()
            for line in lines
            if len(line.split()) <= 18
            and any(keyword in _normalize_invoice_text(line) for keyword in anomaly_keywords)
        ],
        8,
    )


def _is_invoice_total_line(normalized_line: str) -> bool:
    return any(
        keyword in normalized_line
        for keyword in (
            "montant ht",
            "total ht",
            "hors taxe",
            "tva",
            "vat",
            "montant ttc",
            "total ttc",
            "net a payer",
            "montant total",
            "total a payer",
            "total facture",
            "sous total",
        )
    )


def _categorize_invoice_cost_item(label: str) -> str | None:
    normalized_label = _normalize_invoice_text(label)
    if "roaming" in normalized_label:
        return "roaming"
    if any(
        keyword in normalized_label
        for keyword in (
            "depassement",
            "hors forfait",
            "surconsommation",
            "extra data",
            "data",
            "quota",
            "internet mobile",
        )
    ):
        return "data_overage"
    if any(
        keyword in normalized_label
        for keyword in (
            "forfait",
            "abonnement",
            "business",
            "pack",
            "option voix",
            "illimite",
        )
    ):
        return "plan"
    if any(
        keyword in normalized_label
        for keyword in (
            "prestation",
            "service",
            "option",
            "redevance",
            "supplement",
            "frais",
        )
    ):
        return "service"
    if any(
        keyword in normalized_label
        for keyword in ("appel", "communication", "sms", "international")
    ):
        return "usage"
    return None


def _build_invoice_cost_label(line: str) -> str:
    without_amount = re.sub(
        r"(?<!\d)\d{1,3}(?:[ .]\d{3})*(?:[.,]\d{2})?\s*(?:MAD|DHS|DH)?",
        "",
        line,
        flags=re.IGNORECASE,
    )
    without_amount = re.sub(r"\b(?:mad|dhs|dh)\b", "", without_amount, flags=re.IGNORECASE)
    compact_label = " ".join(without_amount.replace("|", " ").split()).strip(" -:;,.")
    return compact_label or "Poste facture"


def _collect_invoice_cost_items(
    *,
    invoice_details: InvoiceDocumentDetails,
    ocr_result: OcrExtractionResult,
    total_amount_value: float | None,
) -> list[InvoiceCostItem]:
    candidate_lines = [
        *invoice_details.additional_fees,
        *invoice_details.overage_items,
        *ocr_result.visible_tables,
        *ocr_result.lines,
    ]
    items_by_label: dict[str, InvoiceCostItem] = {}
    for line in candidate_lines:
        compact_line = " ".join(line.split()).strip()
        if not compact_line:
            continue
        amount_value = _extract_invoice_amount_value(compact_line)
        if amount_value is None or amount_value <= 0:
            continue
        normalized_line = _normalize_invoice_text(compact_line)
        if _is_invoice_total_line(normalized_line):
            continue

        category = _categorize_invoice_cost_item(compact_line)
        is_explicit_fee = compact_line in invoice_details.additional_fees or compact_line in invoice_details.overage_items
        if category is None and not is_explicit_fee:
            continue

        label = _build_invoice_cost_label(compact_line)
        normalized_label = _normalize_invoice_text(label)
        if not normalized_label:
            continue
        share_of_total_pct = (
            round((amount_value / total_amount_value) * 100, 1)
            if total_amount_value and total_amount_value > 0
            else None
        )
        item = InvoiceCostItem(
            label=label,
            amount_mad=_format_invoice_amount(amount_value) or compact_line,
            amount_value_mad=round(amount_value, 2),
            share_of_total_pct=share_of_total_pct,
            category=category or "service",
            is_critical=(share_of_total_pct or 0.0) >= 30.0,
        )
        current_item = items_by_label.get(normalized_label)
        if current_item is None or (item.amount_value_mad or 0.0) > (current_item.amount_value_mad or 0.0):
            items_by_label[normalized_label] = item

    return sorted(
        items_by_label.values(),
        key=lambda item: item.amount_value_mad or 0.0,
        reverse=True,
    )[:8]


def analyze_invoice_context(ocr_result: OcrExtractionResult) -> InvoiceDocumentDetails | None:
    invoice_details = ocr_result.invoice_details
    if invoice_details is None:
        return None

    total_amount_value = _extract_invoice_amount_value(
        invoice_details.total_amount_mad
        or invoice_details.amount_ttc_mad
        or invoice_details.amount_ht_mad
    )
    cost_items = _collect_invoice_cost_items(
        invoice_details=invoice_details,
        ocr_result=ocr_result,
        total_amount_value=total_amount_value,
    )
    if total_amount_value is None and cost_items:
        total_amount_value = sum(item.amount_value_mad or 0.0 for item in cost_items)

    if total_amount_value and cost_items and any(item.share_of_total_pct is None for item in cost_items):
        cost_items = [
            replace(
                item,
                share_of_total_pct=round(((item.amount_value_mad or 0.0) / total_amount_value) * 100, 1),
                is_critical=(((item.amount_value_mad or 0.0) / total_amount_value) * 100) >= 30.0,
            )
            for item in cost_items
        ]

    critical_items = [item for item in cost_items if item.is_critical][:3]
    roaming_items = [item for item in cost_items if item.category == "roaming"]
    overage_items = [item for item in cost_items if item.category == "data_overage"]
    variable_cost_share = sum(item.share_of_total_pct or 0.0 for item in [*roaming_items, *overage_items])
    variable_cost_value = sum(item.amount_value_mad or 0.0 for item in [*roaming_items, *overage_items])
    top_item = cost_items[0] if cost_items else None

    anomalies: list[str] = []
    if roaming_items:
        top_roaming = roaming_items[0]
        top_roaming_share = _format_share_pct(top_roaming.share_of_total_pct) or "part significative du total"
        anomalies.append(
            f"Le roaming apparait comme un poste de cout visible a {top_roaming.amount_mad}, soit {top_roaming_share} du total."
        )
    if overage_items:
        top_overage = overage_items[0]
        top_overage_share = _format_share_pct(top_overage.share_of_total_pct) or "un niveau significatif"
        anomalies.append(
            f"Des depassements data sont factures a {top_overage.amount_mad}, soit {top_overage_share} du total."
        )
    if top_item is not None and (top_item.share_of_total_pct or 0.0) >= 30.0:
        anomalies.append(
            f"Le poste {top_item.label} concentre {_format_share_pct(top_item.share_of_total_pct) or 'une part elevee'} de la facture."
        )
    if len(cost_items) >= 2 and (cost_items[0].share_of_total_pct or 0.0) >= 25.0:
        anomalies.append(
            "La structure de cout reste concentree sur un nombre limite de prestations visibles."
        )

    risk_level = "low"
    if top_item is not None and (top_item.share_of_total_pct or 0.0) >= 45.0:
        risk_level = "critical"
    elif (top_item is not None and (top_item.share_of_total_pct or 0.0) >= 30.0) or variable_cost_share >= 28.0:
        risk_level = "high"
    elif cost_items or anomalies:
        risk_level = "medium"

    primary_risk: str | None = None
    if top_item is not None and top_item.share_of_total_pct is not None:
        primary_risk = (
            f"{top_item.label} represente {_format_share_pct(top_item.share_of_total_pct)} du total TTC, "
            "ce qui en fait le principal poste de vigilance budgetaire."
        )
    elif roaming_items:
        primary_risk = "Le roaming international figure parmi les postes de cout les plus sensibles de la facture."

    estimated_savings: str | None = None
    if total_amount_value and variable_cost_value > 0:
        variable_ratio = variable_cost_value / total_amount_value
        if variable_ratio >= 0.3:
            estimated_savings = "15% a 25% sur les couts roaming et depassements"
        elif variable_ratio >= 0.15:
            estimated_savings = "8% a 18% sur les couts variables visibles"

    return replace(
        invoice_details,
        anomalies=_dedupe_items(anomalies + invoice_details.anomalies, 6),
        cost_items=cost_items,
        critical_items=critical_items,
        primary_risk=primary_risk,
        estimated_savings=estimated_savings,
        risk_level=risk_level,
    )


def _build_invoice_decision_recommendations(
    invoice_details: InvoiceDocumentDetails,
) -> RecommendationEngineResult:
    recommendations: list[DecisionRecommendation] = []
    cost_items = invoice_details.cost_items
    critical_items = invoice_details.critical_items
    top_item = cost_items[0] if cost_items else None
    roaming_item = next((item for item in cost_items if item.category == "roaming"), None)
    overage_item = next((item for item in cost_items if item.category == "data_overage"), None)
    plan_item = next((item for item in cost_items if item.category == "plan"), None)

    if roaming_item is not None:
        recommendations.append(
            DecisionRecommendation(
                title="Activer un forfait roaming entreprise",
                priority="critical" if (roaming_item.share_of_total_pct or 0.0) >= 30.0 else "high",
                impact="economies",
                estimated_saving=invoice_details.estimated_savings,
                reason=(
                    f"Le roaming visible sur la facture atteint {roaming_item.amount_mad}"
                    + (
                        f", soit {_format_share_pct(roaming_item.share_of_total_pct)} du total TTC."
                        if roaming_item.share_of_total_pct is not None
                        else "."
                    )
                ),
            )
        )

    if overage_item is not None:
        recommendations.append(
            DecisionRecommendation(
                title="Ajouter des alertes avant depassement data",
                priority="high",
                impact="prevention",
                estimated_saving=invoice_details.estimated_savings,
                reason=(
                    f"Le poste {overage_item.label} est facture a {overage_item.amount_mad}"
                    + (
                        f", soit {_format_share_pct(overage_item.share_of_total_pct)} du total TTC."
                        if overage_item.share_of_total_pct is not None
                        else "."
                    )
                ),
            )
        )

    if top_item is not None:
        recommendations.append(
            DecisionRecommendation(
                title=f"Auditer les lignes liees a {top_item.label}",
                priority="high" if top_item.is_critical else "medium",
                impact="risk",
                estimated_saving=None,
                reason=(
                    f"Le poste {top_item.label} concentre {top_item.amount_mad}"
                    + (
                        f", soit {_format_share_pct(top_item.share_of_total_pct)} du total TTC."
                        if top_item.share_of_total_pct is not None
                        else "."
                    )
                ),
            )
        )

    if plan_item is not None:
        recommendations.append(
            DecisionRecommendation(
                title=f"Optimiser le forfait {plan_item.label}",
                priority="medium",
                impact="optimization",
                estimated_saving=invoice_details.estimated_savings,
                reason=(
                    f"Le forfait {plan_item.label} apparait a {plan_item.amount_mad}"
                    + (
                        f", soit {_format_share_pct(plan_item.share_of_total_pct)} du total TTC."
                        if plan_item.share_of_total_pct is not None
                        else "."
                    )
                ),
            )
        )

    if not recommendations and critical_items:
        lead_item = critical_items[0]
        recommendations.append(
            DecisionRecommendation(
                title=f"Verifier le poste {lead_item.label}",
                priority="high",
                impact="risk",
                estimated_saving=None,
                reason=(
                    f"Ce poste atteint {lead_item.amount_mad}"
                    + (
                        f", soit {_format_share_pct(lead_item.share_of_total_pct)} du total TTC."
                        if lead_item.share_of_total_pct is not None
                        else "."
                    )
                ),
            )
        )

    variable_cost_share = sum(
        item.share_of_total_pct or 0.0
        for item in cost_items
        if item.category in {"roaming", "data_overage"}
    )
    cost_score = min(100, round(max((top_item.share_of_total_pct or 0.0) * 1.8 if top_item else 0.0, variable_cost_share * 2.0)))
    optimization_score = min(100, round(variable_cost_share * 2.2))
    anomaly_score = min(100, round(len(invoice_details.anomalies) * 18 + (top_item.share_of_total_pct or 0.0 if top_item else 0.0)))
    risk_level = invoice_details.risk_level or (
        "high" if critical_items or variable_cost_share >= 28.0 else "medium" if cost_items else "low"
    )

    return RecommendationEngineResult(
        recommendations=recommendations[:4],
        recommendation_notice=(
            "Les recommandations privilegient les montants, postes de cout et anomalies visibles sur la facture."
            if recommendations
            else "Le document ne montre pas encore assez de postes chiffrables pour arbitrer une action budgetaire precise."
        ),
        risk_level=risk_level,
        optimization_score=optimization_score,
        anomaly_score=anomaly_score,
        fraud_score=0,
        cost_score=cost_score,
    )


def analyze_alert_dashboard_context(
    ocr_result: OcrExtractionResult,
    *,
    vision_text: str = "",
) -> IncidentDocumentDetails | None:
    incident_details = ocr_result.incident_details
    alert_kpis = extract_alert_dashboard_kpis(
        ocr_text="\n".join(
            [
                ocr_result.text,
                *ocr_result.lines,
                *ocr_result.alerts,
                *ocr_result.kpis,
                *ocr_result.amounts_mad,
            ]
        ),
        vision_text=vision_text,
    )
    normalized_text = _normalize_invoice_text(
        " ".join(item for item in [ocr_result.text, vision_text] if item)
    )
    alert_keywords_detected = any(
        keyword in normalized_text
        for keyword in (
            "alerte",
            "alertes critiques",
            "previsions et alertes",
            "fraude",
            "impact financier",
            "taux d'exposition",
            "score de risque",
            "anomal",
            "log",
            "trace",
        )
    )
    if incident_details is None and not alert_keywords_detected and not alert_kpis.has_visible_kpis():
        return None

    lines = ocr_result.lines
    critical_alert_count = alert_kpis.critical_alerts or _extract_count_near_keywords(
        lines,
        ("alertes critiques", "alerte critique", "critical alerts", "critique"),
    )
    at_risk_clients_count = alert_kpis.at_risk_clients_count or _extract_count_near_keywords(
        lines,
        ("clients a risque", "clients at risk", "utilisateurs a risque"),
    )
    department_risk = alert_kpis.department_risk or (
        ocr_result.departments[0] if ocr_result.departments else None
    )
    contract_exposed = alert_kpis.contract_exposed or _extract_contract_exposure_across_texts(
        ["\n".join(lines), ocr_result.text, vision_text]
    )
    exposure_rate, exposure_rate_pct = _extract_percentage_near_keywords(
        lines,
        ("taux d'exposition", "exposition", "exposure rate", "risk exposure"),
    )
    exposure_rate = exposure_rate or alert_kpis.exposure_rate
    exposure_rate_pct = exposure_rate_pct or alert_kpis.exposure_rate_pct
    churn_rate, churn_rate_pct = _extract_percentage_near_keywords(
        lines,
        ("taux churn", "churn", "churn rate"),
    )
    churn_rate = churn_rate or alert_kpis.churn_rate
    churn_rate_pct = churn_rate_pct or alert_kpis.churn_rate_pct
    average_risk_score, average_risk_score_value = _extract_decimal_near_keywords(
        lines,
        ("score moyen", "score global", "score moyen risque", "average score"),
    )
    average_risk_score = average_risk_score or alert_kpis.average_score
    average_risk_score_value = (
        average_risk_score_value
        if average_risk_score_value is not None
        else alert_kpis.average_score_value
    )
    revenue_at_risk_source = _find_alert_line(
        lines,
        ("revenu a risque", "revenue at risk", "exposition portefeuille", "portfolio exposure"),
    )
    revenue_at_risk_value_mad = (
        _extract_invoice_amount_value(revenue_at_risk_source)
        or alert_kpis.revenue_at_risk_value_mad
    )
    revenue_at_risk_mad = (
        _format_invoice_amount(revenue_at_risk_value_mad)
        or revenue_at_risk_source
        or alert_kpis.revenue_at_risk_mad
    )
    financial_impact_source = _find_alert_line(
        lines,
        ("impact estime", "impact estimé", "impact financier", "financial impact", "estimated impact", "perte potentielle", "cout expose", "exposition financiere"),
    )
    if financial_impact_source is None and any(
        keyword in normalized_text
        for keyword in ("impact estime", "impact estime", "impact financier", "financial impact", "exposition financiere", "perte potentielle")
    ):
        financial_impact_source = next(
            (item for item in ocr_result.amounts_mad if "mad" in item.lower()),
            None,
        )
    estimated_impact_value_mad = (
        _extract_invoice_amount_value(financial_impact_source)
        or alert_kpis.estimated_impact_value_mad
    )
    estimated_impact_mad = (
        _format_invoice_amount(estimated_impact_value_mad)
        or financial_impact_source
        or alert_kpis.estimated_impact_mad
    )
    financial_impact_value_mad = revenue_at_risk_value_mad or estimated_impact_value_mad or alert_kpis.financial_impact_value_mad
    financial_impact_mad = revenue_at_risk_mad or estimated_impact_mad or alert_kpis.financial_impact_mad
    roi_estimated = alert_kpis.roi_estimated
    roi_estimated_pct = alert_kpis.roi_estimated_pct
    priority_actions_count = alert_kpis.priority_actions_count
    fraud_score_visible = alert_kpis.fraud_score_visible
    fraud_score_value = alert_kpis.fraud_score_value
    anomaly_score_visible = alert_kpis.anomaly_score_visible
    anomaly_score_value = alert_kpis.anomaly_score_value
    optimization_score_visible = alert_kpis.optimization_score_visible
    optimization_score_value = alert_kpis.optimization_score_value
    cost_score_visible = alert_kpis.cost_score_visible
    cost_score_value = alert_kpis.cost_score_value
    score_lines = _extract_score_lines(lines)
    max_risk_scores = tuple(
        _dedupe_items(
            [
                *score_lines,
                *list(alert_kpis.max_risk_scores),
            ],
            6,
        )
    )
    risk_score = next((score for score in max_risk_scores if score == "100/100"), None) or (
        max_risk_scores[0] if max_risk_scores else None
    )
    visible_statuses = _extract_status_lines(lines)
    repeated_anomalies = _extract_alert_anomaly_lines(lines)

    if incident_details is not None and incident_details.line_reference and not score_lines:
        risky_entities = [incident_details.line_reference]
    elif at_risk_clients_count is not None and at_risk_clients_count > 0 and not score_lines:
        risky_entities = [f"{at_risk_clients_count} clients a risque"]
    else:
        risky_entities = score_lines[:4]
    if contract_exposed:
        risky_entities = _dedupe_items([*risky_entities, contract_exposed], 4)

    critical_signals: list[str] = []
    if critical_alert_count is not None:
        critical_signals.append(f"{critical_alert_count} alertes critiques actives")
    if at_risk_clients_count is not None:
        critical_signals.append(f"{at_risk_clients_count} clients a risque visibles")
    if exposure_rate is not None:
        critical_signals.append(f"Taux d'exposition visible a {exposure_rate}")
    if churn_rate is not None:
        critical_signals.append(f"Taux de churn visible a {churn_rate}")
    if revenue_at_risk_mad is not None:
        critical_signals.append(f"Revenu a risque visible a {revenue_at_risk_mad}")
    if financial_impact_mad is not None:
        critical_signals.append(f"Impact financier visible a {financial_impact_mad}")
    if estimated_impact_mad is not None and estimated_impact_mad != financial_impact_mad:
        critical_signals.append(f"Impact estime visible a {estimated_impact_mad}")
    if average_risk_score is not None:
        critical_signals.append(f"Score moyen visible a {average_risk_score}")
    if department_risk is not None:
        critical_signals.append(f"Departement le plus expose: {department_risk}")
    if contract_exposed is not None:
        critical_signals.append(f"Contrat expose: {contract_exposed}")
    if fraud_score_visible is not None:
        critical_signals.append(f"Risque fraude a {fraud_score_visible}")
    if anomaly_score_visible is not None:
        critical_signals.append(f"Risque anomalie a {anomaly_score_visible}")
    if optimization_score_visible is not None:
        critical_signals.append(f"Risque optimisation a {optimization_score_visible}")
    if cost_score_visible is not None:
        critical_signals.append(f"Risque cout a {cost_score_visible}")
    if roi_estimated is not None:
        critical_signals.append(f"ROI estime visible a {roi_estimated}")
    if priority_actions_count is not None:
        critical_signals.append(f"{priority_actions_count} actions prioritaires visibles")
    if "100/100" in max_risk_scores and (len(max_risk_scores) >= 2 or len(score_lines) >= 2):
        critical_signals.append("Plusieurs utilisateurs presentent un score de risque maximal de 100/100")
    elif "100/100" in max_risk_scores:
        critical_signals.append("Un score de risque maximal de 100/100 est visible")
    if repeated_anomalies:
        critical_signals.extend(repeated_anomalies[:2])

    severity = incident_details.severity if incident_details is not None else None
    priority = incident_details.priority if incident_details is not None else None
    risk_level = alert_kpis.risk_level or "medium"
    if (
        any(score == "100/100" for score in max_risk_scores)
        or (
            critical_alert_count is not None
            and critical_alert_count >= 1000
            and (exposure_rate_pct or 0.0) >= 40.0
        )
    ):
        risk_level = "critical"
        severity = "critique"
        priority = "immediate"
    elif (
        (revenue_at_risk_value_mad or 0.0) >= 1_000_000
        or (at_risk_clients_count or 0) >= 1000
        or (estimated_impact_value_mad or 0.0) >= 150_000
        or (financial_impact_value_mad or 0.0) >= 250_000
        or (critical_alert_count is not None and critical_alert_count >= 100)
        or (churn_rate_pct or 0.0) >= 50.0
        or (exposure_rate_pct or 0.0) >= 25.0
        or len(max_risk_scores) == 1
        or (fraud_score_value or 0.0) >= 60.0
        or (anomaly_score_value or 0.0) >= 50.0
        or (cost_score_value or 0.0) >= 55.0
    ):
        risk_level = "high"
        severity = severity or "elevee"
        priority = priority or "haute"
    elif (
        critical_alert_count is not None
        or at_risk_clients_count is not None
        or exposure_rate_pct is not None
        or churn_rate_pct is not None
        or average_risk_score_value is not None
        or repeated_anomalies
    ):
        risk_level = "medium"
        severity = severity or "moyenne"
        priority = priority or "normale"

    alert_type = incident_details.alert_type if incident_details is not None else "alerte"
    is_alert_dashboard = (
        "previsions et alertes" in normalized_text
        or exposure_rate_pct is not None
        or churn_rate_pct is not None
        or financial_impact_value_mad is not None
        or revenue_at_risk_value_mad is not None
        or estimated_impact_value_mad is not None
        or average_risk_score_value is not None
        or fraud_score_value is not None
        or anomaly_score_value is not None
        or (critical_alert_count is not None and len(max_risk_scores) >= 1)
    )
    if incident_details is None and not is_alert_dashboard and not (
        max_risk_scores
        or any(
            keyword in normalized_text
            for keyword in (
                "fraude",
                "simbox",
                "appel suspect",
                "depassement quota",
                "hors forfait",
                "syslog",
                "trace",
                "exception",
                "service unavailable",
                "ligne +",
            )
        )
    ):
        return None
    if is_alert_dashboard:
        alert_type = "alert_dashboard"

    probable_causes = _dedupe_items(
        [
            (
                "la supervision semble surchargee par un volume eleve d'alertes critiques"
                if critical_alert_count is not None and critical_alert_count >= 100
                else ""
            ),
            (
                "le portefeuille expose est deja massif, avec un nombre eleve de clients a risque"
                if at_risk_clients_count is not None and at_risk_clients_count >= 1000
                else ""
            ),
            (
                f"le departement {department_risk} concentre la pression risque la plus lisible du dashboard"
                if department_risk
                else ""
            ),
            (
                "plusieurs utilisateurs atteignent un score de risque maximal, ce qui traduit des comportements fortement anormaux"
                if "100/100" in max_risk_scores
                else ""
            ),
            (
                "le revenu a risque visible depasse le seuil de vigilance mensuel et doit etre traite en priorite"
                if (revenue_at_risk_value_mad or 0.0) > 1_000_000
                else ""
            ),
            (
                "la pression churn visible augmente le risque de perte de revenu si les alertes ne sont pas traitees rapidement"
                if (churn_rate_pct or 0.0) >= 50.0
                else ""
            ),
            (
                f"la base visible {contract_exposed} reste vulnerable si les contrats mensuels ne sont pas recadres rapidement"
                if contract_exposed
                else ""
            ),
            (
                "les risques fraude et anomalie traduisent deja une exposition elevee sur les usages suspects"
                if (fraud_score_value or 0.0) >= 60.0 or (anomaly_score_value or 0.0) >= 50.0
                else ""
            ),
            (
                "le risque cout confirme une pression budgetaire deja elevee sur le portefeuille surveille"
                if (cost_score_value or 0.0) >= 55.0
                else ""
            ),
            (
                "des anomalies ou alertes repetitives restent presentes sur la capture"
                if repeated_anomalies
                else ""
            ),
            *(
                incident_details.probable_causes
                if incident_details is not None
                else []
            ),
        ],
        6,
    )

    summary_parts: list[str] = []
    if critical_alert_count is not None:
        summary_parts.append(f"{critical_alert_count} alertes critiques sont actives")
    if at_risk_clients_count is not None:
        summary_parts.append(f"{at_risk_clients_count} clients a risque sont identifies")
    if department_risk is not None:
        summary_parts.append(f"le departement {department_risk} apparait comme le plus expose")
    if contract_exposed is not None:
        summary_parts.append(f"{contract_exposed} restent identifies dans le portefeuille surveille")
    if exposure_rate is not None:
        summary_parts.append(f"le taux d'exposition atteint {exposure_rate}")
    if churn_rate is not None:
        summary_parts.append(f"le taux de churn atteint {churn_rate}")
    if revenue_at_risk_mad is not None:
        summary_parts.append(f"le revenu a risque atteint {revenue_at_risk_mad}")
    if financial_impact_mad is not None:
        summary_parts.append(f"l'impact financier potentiel atteint {financial_impact_mad}")
    if estimated_impact_mad is not None and estimated_impact_mad != financial_impact_mad:
        summary_parts.append(f"l'impact estime atteint {estimated_impact_mad}")
    if average_risk_score is not None:
        summary_parts.append(f"le score moyen est de {average_risk_score}")
    if roi_estimated is not None:
        summary_parts.append(f"le ROI estime atteint {roi_estimated}")
    if priority_actions_count is not None:
        summary_parts.append(f"{priority_actions_count} actions prioritaires sont deja identifiees")
    if fraud_score_visible is not None:
        summary_parts.append(f"le risque fraude ressort a {fraud_score_visible}")
    if anomaly_score_visible is not None:
        summary_parts.append(f"le risque anomalie ressort a {anomaly_score_visible}")
    if optimization_score_visible is not None:
        summary_parts.append(f"le risque optimisation ressort a {optimization_score_visible}")
    if cost_score_visible is not None:
        summary_parts.append(f"le risque cout ressort a {cost_score_visible}")
    if "100/100" in max_risk_scores:
        summary_parts.append(
            "des scores de risque 100/100 apparaissent sur plusieurs profils"
            if len(max_risk_scores) >= 2 or len(score_lines) >= 2
            else "un score de risque 100/100 apparait sur un profil"
        )
    if not summary_parts and incident_details is not None and incident_details.summary:
        summary_parts.append(incident_details.summary)

    summary = (
        "Le tableau d'alertes met en evidence "
        + ", ".join(summary_parts[:-1])
        + (" et " + summary_parts[-1] if len(summary_parts) > 1 else summary_parts[0] if summary_parts else "")
        + "."
        if summary_parts
        else (incident_details.summary if incident_details is not None else None)
    )

    result = IncidentDocumentDetails(
        alert_type=alert_type,
        severity=severity,
        detected_at=incident_details.detected_at if incident_details is not None else None,
        operator=incident_details.operator if incident_details is not None else (ocr_result.operators[0] if ocr_result.operators else None),
        line_reference=incident_details.line_reference if incident_details is not None else None,
        suspect_cost_mad=incident_details.suspect_cost_mad if incident_details is not None else None,
        call_volume=incident_details.call_volume if incident_details is not None else None,
        data_overage=incident_details.data_overage if incident_details is not None else None,
        error_message=incident_details.error_message if incident_details is not None else None,
        priority=priority,
        summary=summary,
        critical_alert_count=critical_alert_count,
        at_risk_clients_count=at_risk_clients_count,
        department_risk=department_risk,
        contract_exposed=contract_exposed,
        exposure_rate=exposure_rate,
        exposure_rate_pct=exposure_rate_pct,
        financial_impact_mad=financial_impact_mad,
        financial_impact_value_mad=financial_impact_value_mad,
        churn_rate=churn_rate,
        churn_rate_pct=churn_rate_pct,
        estimated_impact_mad=estimated_impact_mad,
        estimated_impact_value_mad=estimated_impact_value_mad,
        revenue_at_risk_mad=revenue_at_risk_mad,
        revenue_at_risk_value_mad=revenue_at_risk_value_mad,
        roi_estimated=roi_estimated,
        roi_estimated_pct=roi_estimated_pct,
        priority_actions_count=priority_actions_count,
        average_score=average_risk_score,
        average_score_value=average_risk_score_value,
        fraud_score_visible=fraud_score_visible,
        fraud_score_value=fraud_score_value,
        anomaly_score_visible=anomaly_score_visible,
        anomaly_score_value=anomaly_score_value,
        optimization_score_visible=optimization_score_visible,
        optimization_score_value=optimization_score_value,
        cost_score_visible=cost_score_visible,
        cost_score_value=cost_score_value,
        risk_score=risk_score,
        max_risk_scores=list(max_risk_scores),
        risky_entities=risky_entities,
        repeated_anomalies=repeated_anomalies[:5],
        visible_statuses=visible_statuses[:5],
        critical_signals=_dedupe_items(critical_signals, 6),
        probable_causes=probable_causes,
    )
    MULTIMODAL_LOGGER.info(
        "event=alert_dashboard_kpis_extracted risk_level=%s critical_alerts=%s at_risk_clients=%s revenue_at_risk=%s estimated_impact=%s churn_rate=%s average_score=%s fraud_score=%s anomaly_score=%s",
        risk_level,
        critical_alert_count,
        at_risk_clients_count,
        revenue_at_risk_mad,
        estimated_impact_mad,
        churn_rate,
        average_risk_score,
        fraud_score_visible,
        anomaly_score_visible,
    )
    return result


def _build_alert_decision_recommendations(
    incident_details: IncidentDocumentDetails,
) -> RecommendationEngineResult:
    recommendations: list[DecisionRecommendation] = []
    critical_alert_count = incident_details.critical_alert_count or 0
    at_risk_clients_count = incident_details.at_risk_clients_count or 0
    financial_impact_value_mad = (
        incident_details.revenue_at_risk_value_mad
        or incident_details.financial_impact_value_mad
        or 0.0
    )
    estimated_impact_value_mad = incident_details.estimated_impact_value_mad or 0.0
    exposure_rate_pct = max(
        incident_details.exposure_rate_pct or 0.0,
        incident_details.churn_rate_pct or 0.0,
    )
    fraud_score_visible = incident_details.fraud_score_value or 0.0
    anomaly_score_visible = incident_details.anomaly_score_value or 0.0
    risky_entities = incident_details.risky_entities[:4]
    max_risk_scores = incident_details.max_risk_scores or (
        [incident_details.risk_score] if incident_details.risk_score else []
    )

    if max_risk_scores and "100/100" in max_risk_scores:
        recommendations.append(
            DecisionRecommendation(
                title="Auditer les utilisateurs avec score 100/100",
                priority="critical",
                impact="risk",
                estimated_saving=None,
                reason=(
                    "Plusieurs profils atteignent 100/100, ce qui en fait la priorite de controle la plus immediate."
                    if len(risky_entities) >= 2 or len(max_risk_scores) >= 2
                    else "Le score de risque atteint 100/100 sur un profil, ce qui justifie un audit cible."
                ),
            )
        )

    if financial_impact_value_mad > 0:
        recommendations.append(
            DecisionRecommendation(
                title="Auditer les lignes a fort impact financier",
                priority="critical" if financial_impact_value_mad > 1_000_000 else "high",
                impact="economies",
                estimated_saving=None,
                reason=(
                    f"L'impact financier atteint {incident_details.financial_impact_mad}, ce qui impose une priorisation immediate."
                ),
            )
        )

    if at_risk_clients_count > 0:
        recommendations.append(
            DecisionRecommendation(
                title="Prioriser les clients a risque les plus exposes",
                priority="critical" if at_risk_clients_count >= 1000 else "high",
                impact="risk",
                estimated_saving=None,
                reason=(
                    f"{at_risk_clients_count} clients a risque sont visibles, ce qui impose une revue immediate des segments les plus fragiles."
                ),
            )
        )

    if critical_alert_count > 0:
        recommendations.append(
            DecisionRecommendation(
                title="Traiter les alertes critiques en premier",
                priority="critical" if critical_alert_count >= 1000 else "high",
                impact="supervision",
                estimated_saving=None,
                reason=(
                    f"La capture affiche {critical_alert_count} alertes critiques actives, ce qui traduit une surcharge de supervision."
                ),
            )
        )

    if incident_details.alert_type in {"fraude", "alert_dashboard", "alerte", "appel_suspect"}:
        recommendations.append(
            DecisionRecommendation(
                title="Activer des seuils de blocage automatique",
                priority="critical" if incident_details.alert_type == "fraude" else "high",
                impact="fraud",
                estimated_saving=None,
                reason=(
                    "La capture montre des signaux fraude ou anomalie repetes qui doivent etre contenus avant propagation."
                ),
            )
        )
        recommendations.append(
            DecisionRecommendation(
                title="Verifier les comportements suspects",
                priority="high",
                impact="fraud",
                estimated_saving=None,
                reason=(
                    "Les alertes visibles appellent une surveillance plus reactive sur les usages a haut risque."
                ),
            )
        )

    if (incident_details.churn_rate_pct or 0.0) >= 50.0:
        recommendations.append(
            DecisionRecommendation(
                title="Traiter en priorite les segments a fort churn",
                priority="high",
                impact="economies",
                estimated_saving=None,
                reason=(
                    f"Le taux de churn visible atteint {incident_details.churn_rate}, avec un risque direct sur le revenu recurrent."
                ),
            )
        )

    if incident_details.contract_exposed:
        recommendations.append(
            DecisionRecommendation(
                title="Revoir les contrats mensuels les plus exposes",
                priority="high" if (incident_details.churn_rate_pct or 0.0) >= 40.0 else "medium",
                impact="retention",
                estimated_saving=None,
                reason=(
                    f"La base visible {incident_details.contract_exposed} doit etre requalifiee pour limiter la perte de revenu et le churn."
                ),
            )
        )

    if incident_details.department_risk:
        recommendations.append(
            DecisionRecommendation(
                title=f"Auditer en priorite le departement {incident_details.department_risk}",
                priority="high",
                impact="governance",
                estimated_saving=None,
                reason=(
                    f"Le departement {incident_details.department_risk} apparait comme le perimetre le plus expose dans le dashboard."
                ),
            )
        )

    if incident_details.data_overage:
        recommendations.append(
            DecisionRecommendation(
                title="Optimiser forfait data",
                priority="critical" if incident_details.severity == "critique" else "high",
                impact="economies",
                estimated_saving=None,
                reason=(
                    f"Le depassement visible ({incident_details.data_overage}) montre que le forfait data n'absorbe plus l'usage courant."
                ),
            )
        )
        recommendations.append(
            DecisionRecommendation(
                title="Ajouter des alertes avant depassement data",
                priority="high",
                impact="prevention",
                estimated_saving=None,
                reason=(
                    f"Le depassement visible ({incident_details.data_overage}) doit etre traite avant escalation budgetaire."
                ),
            )
        )

    anomaly_score = min(
        100,
        round(
            min(critical_alert_count / 40, 55)
            + min(at_risk_clients_count / 80, 18)
            + min(len(incident_details.repeated_anomalies) * 10, 25)
            + min(anomaly_score_visible * 0.35, 22)
            + (12 if "100/100" in max_risk_scores else 0)
        ),
    )
    fraud_score = min(
        100,
        round(
            max(fraud_score_visible, 25 if incident_details.alert_type in {"fraude", "appel_suspect"} else 0)
            + min(len(risky_entities) * 18, 54)
            + min(exposure_rate_pct * 0.45, 21)
        ),
    )
    cost_score = min(
        100,
        round(
            min(financial_impact_value_mad / 40_000, 70)
            + min(estimated_impact_value_mad / 50_000, 18)
            + min(exposure_rate_pct * 0.35, 20)
        ),
    )
    optimization_score = min(
        100,
        round(
            min(exposure_rate_pct * 1.1, 50)
            + min(max(critical_alert_count, at_risk_clients_count) / 60, 35)
        ),
    )
    risk_level = (
        "critical"
        if incident_details.severity == "critique"
        or financial_impact_value_mad > 1_000_000
        or "100/100" in max_risk_scores
        else "high"
        if incident_details.severity == "elevee"
        or critical_alert_count >= 100
        or at_risk_clients_count >= 1000
        or fraud_score_visible >= 60
        or anomaly_score_visible >= 50
        or exposure_rate_pct >= 25.0
        else "medium"
        if recommendations
        else "low"
    )

    return RecommendationEngineResult(
        recommendations=recommendations[:5],
        recommendation_notice=(
            "Les recommandations priorisent les KPI, statuts et signaux critiques visibles dans la capture."
            if recommendations
            else "La capture ne remonte pas encore assez de leviers visibles pour arbitrer une action immediate."
        ),
        risk_level=risk_level,
        optimization_score=optimization_score,
        anomaly_score=anomaly_score,
        fraud_score=fraud_score,
        cost_score=cost_score,
    )


def _build_dashboard_strict_recommendations(
    *,
    ocr_result: OcrExtractionResult,
    parsed_answer: FinalImageAnswer,
    vision_result: VisionAnalysisResult,
) -> RecommendationEngineResult:
    context_text = _normalize_invoice_text(
        " ".join(
            [
                ocr_result.text,
                vision_result.analysis,
                *ocr_result.kpis,
                *parsed_answer.detected_kpis,
                *parsed_answer.detected_anomalies,
            ]
        )
    )
    recommendations: list[DecisionRecommendation] = []
    visible_amount = next((item for item in ocr_result.amounts_mad if item), None)
    visible_department = next((item for item in ocr_result.departments if item), None)
    visible_operator = next((item for item in ocr_result.operators if item), None)
    score_100_detected = bool(re.search(r"\b100\s*/\s*100\b", context_text))
    critical_alert_line = next(
        (item for item in [*ocr_result.alerts, *ocr_result.kpis] if "alert" in _normalize_invoice_text(item) or "critique" in _normalize_invoice_text(item)),
        None,
    )

    if critical_alert_line:
        recommendations.append(
            DecisionRecommendation(
                title="Traiter les alertes critiques visibles en premier",
                priority="critical" if "critique" in _normalize_invoice_text(critical_alert_line) else "high",
                impact="risk",
                estimated_saving=None,
                reason=f"La capture met en avant {critical_alert_line.lower()}, ce qui impose une priorisation immediate.",
            )
        )
    if score_100_detected:
        recommendations.append(
            DecisionRecommendation(
                title="Auditer les profils au risque maximal",
                priority="critical",
                impact="fraud",
                estimated_saving=None,
                reason="Des scores de risque a 100/100 sont visibles sur le dashboard, ce qui justifie un audit cible.",
            )
        )
    if visible_amount:
        recommendations.append(
            DecisionRecommendation(
                title=(
                    f"Verifier le poste visible sur {visible_department}"
                    if visible_department
                    else "Prioriser la revue du cout visible"
                ),
                priority="high",
                impact="economies",
                estimated_saving=None,
                reason=(
                    f"Le montant visible {visible_amount}"
                    + (
                        f" apparait dans le perimetre {visible_department}."
                        if visible_department
                        else " appelle une revue budgetaire directe."
                    )
                ),
            )
        )
    if "fraude" in context_text or "suspect" in context_text or "anomal" in context_text:
        recommendations.append(
            DecisionRecommendation(
                title="Renforcer la surveillance sur les signaux suspects visibles",
                priority="high",
                impact="fraud",
                estimated_saving=None,
                reason="Les mots-cles fraude ou anomalie sont visibles sur la capture et doivent etre suivis sans delai.",
            )
        )
    if visible_operator and not recommendations:
        recommendations.append(
            DecisionRecommendation(
                title=f"Auditer les KPI visibles chez {visible_operator}",
                priority="medium",
                impact="optimization",
                estimated_saving=None,
                reason="L'analyse se limite aux indicateurs directement lisibles sur la capture partagee.",
            )
        )

    strongest_recommendations = recommendations[:4]
    risk_level = (
        "critical"
        if score_100_detected or (critical_alert_line is not None and "critique" in _normalize_invoice_text(critical_alert_line))
        else "high"
        if strongest_recommendations
        else "medium"
    )
    anomaly_score = min(100, 58 + (18 if critical_alert_line else 0) + (12 if score_100_detected else 0))
    fraud_score = min(100, 62 + (22 if score_100_detected else 0) + (10 if "fraude" in context_text else 0))
    cost_score = min(100, 68 if visible_amount else 42)
    optimization_score = min(100, 60 if visible_department or visible_operator else 44)

    return RecommendationEngineResult(
        recommendations=strongest_recommendations,
        recommendation_notice=(
            "Les recommandations sont alignees sur les KPI et signaux lisibles directement sur la capture."
            if strongest_recommendations
            else "Les indicateurs consolides restent trop limites pour arbitrer des actions plus fines."
        ),
        risk_level=risk_level,
        optimization_score=optimization_score,
        anomaly_score=anomaly_score,
        fraud_score=fraud_score,
        cost_score=cost_score,
    )


def _extract_pdf_text_content(pdf_bytes: bytes) -> tuple[str, list[str], list[str], int, bytes | None]:
    if fitz is None and pdfplumber is None:
        raise VisionUnavailableError(
            "Le serveur ne dispose pas encore des dependances PDF necessaires a l'analyse documentaire."
        )

    extracted_pages: list[str] = []
    visible_tables: list[str] = []
    page_count = 0
    first_page_image_bytes: bytes | None = None

    if fitz is not None:
        document = fitz.open(stream=pdf_bytes, filetype="pdf")
        try:
            page_count = document.page_count
            for page_index in range(min(document.page_count, 6)):
                page = document.load_page(page_index)
                page_text = page.get_text("text") or ""
                if page_text.strip():
                    extracted_pages.append(page_text)
                if page_index == 0:
                    pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
                    first_page_image_bytes = pixmap.tobytes("png")
        finally:
            document.close()

    if pdfplumber is not None:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as document:
            page_count = max(page_count, len(document.pages))
            for page in document.pages[:6]:
                page_text = page.extract_text() or ""
                if page_text.strip():
                    extracted_pages.append(page_text)
                try:
                    for table in page.extract_tables() or []:
                        for row in table or []:
                            row_values = [str(value).strip() for value in row if value]
                            if row_values:
                                visible_tables.append(" | ".join(row_values))
                except Exception:
                    continue

    merged_text = "\n".join(text for text in extracted_pages if text.strip())
    merged_lines = [
        compact_line
        for compact_line in (" ".join(line.split()).strip() for line in merged_text.splitlines())
        if compact_line
    ]
    return (
        merged_text,
        merged_lines,
        _dedupe_items(visible_tables, 12),
        page_count,
        first_page_image_bytes,
    )


def _build_pdf_ocr_result(
    *,
    extracted_text: str,
    extracted_lines: list[str],
    visible_tables: list[str],
    ocr_fallback_results: list[OcrExtractionResult],
) -> OcrExtractionResult:
    ocr_texts = [result.text for result in ocr_fallback_results if result.text.strip()]
    merged_text = "\n".join(
        item for item in [extracted_text.strip(), *ocr_texts] if item
    )
    merged_lines = _dedupe_items(
        [
            *extracted_lines,
            *visible_tables,
            *[line for result in ocr_fallback_results for line in result.lines],
        ],
        240,
    )
    amount_matches = re.findall(
        r"(?<!\d)(\d{1,3}(?:[ .]\d{3})*(?:[.,]\d{2})?|\d+(?:[.,]\d{2})?)\s*(?:MAD|DHS|DH)",
        merged_text,
        flags=re.IGNORECASE,
    )
    amounts_mad = _dedupe_items([f"{match} MAD" for match in amount_matches], 18)
    operators = _detect_operators(merged_text)
    departments = _detect_departments(merged_text)
    alerts = _detect_alert_lines(merged_lines)
    kpis = _detect_kpis(merged_lines)
    tables = _dedupe_items(
        [
            *visible_tables,
            *[line for result in ocr_fallback_results for line in result.visible_tables],
        ],
        12,
    )
    confidence_candidates = [result.confidence for result in ocr_fallback_results if result.confidence > 0]
    confidence = (
        max(0.74, min(0.98, 0.86 if extracted_text.strip() else (sum(confidence_candidates) / len(confidence_candidates))))
        if confidence_candidates or extracted_text.strip()
        else 0.42
    )
    merged_ocr_result = OcrExtractionResult(
        text=merged_text,
        lines=merged_lines,
        text_regions=[],
        amounts_mad=amounts_mad,
        operators=operators,
        departments=departments,
        alerts=alerts,
        kpis=kpis,
        visible_tables=tables,
        confidence=confidence,
        incident_details=_extract_incident_details(merged_lines, merged_text, operators, confidence),
        workflow_details=None,
        equipment_details=None,
        ui_details=None,
        invoice_details=_extract_invoice_details(merged_lines, merged_text, operators, confidence),
    )
    return replace(
        merged_ocr_result,
        invoice_details=analyze_invoice_context(merged_ocr_result),
        incident_details=analyze_alert_dashboard_context(merged_ocr_result)
        or merged_ocr_result.incident_details,
    )


async def _extract_pdf_document(
    pdf_bytes: bytes,
    *,
    filename: str | None,
) -> PdfExtractionResult:
    started_at = time.perf_counter()
    extracted_text, extracted_lines, visible_tables, page_count, first_page_image_bytes = _extract_pdf_text_content(
        pdf_bytes
    )
    ocr_fallback_results: list[OcrExtractionResult] = []
    if (not extracted_text.strip() or len(extracted_lines) < 8) and first_page_image_bytes is not None:
        try:
            ocr_fallback_results.append(
                await _extract_image_ocr_with_timeout(
                    first_page_image_bytes,
                    filename=f"{filename or 'document'}.page-1.png",
                )
            )
        except Exception:
            MULTIMODAL_LOGGER.exception(
                "event=pdf_ocr_fallback_failed filename=%s",
                filename,
            )

    ocr_result = _build_pdf_ocr_result(
        extracted_text=extracted_text,
        extracted_lines=extracted_lines,
        visible_tables=visible_tables,
        ocr_fallback_results=ocr_fallback_results,
    )
    MULTIMODAL_LOGGER.info(
        "event=pdf_extract_completed filename=%s page_count=%s text_length=%s confidence=%s duration_ms=%s",
        filename,
        page_count,
        len(ocr_result.text),
        round(ocr_result.confidence, 4),
        round((time.perf_counter() - started_at) * 1000),
    )
    return PdfExtractionResult(
        text=ocr_result.text,
        lines=ocr_result.lines,
        visible_tables=ocr_result.visible_tables,
        page_count=page_count,
        first_page_image_bytes=first_page_image_bytes,
        ocr_result=ocr_result,
    )


def _build_vision_fallback_result(
    *,
    question: str,
    ocr_result: OcrExtractionResult,
    error_message: str,
    prepared_image: PreparedImage | None = None,
    filename: str | None = None,
) -> VisionAnalysisResult:
    inferred_type = "capture_interface"
    if ocr_result.invoice_details is not None:
        inferred_type = "facture"
    elif ocr_result.incident_details is not None and ocr_result.incident_details.alert_type:
        inferred_type = ocr_result.incident_details.alert_type
    elif ocr_result.workflow_details is not None:
        inferred_type = "workflow"
    elif ocr_result.equipment_details is not None:
        inferred_type = "equipement"
    elif (
        _question_targets_physical_equipment(question)
        or _has_physical_equipment_signals(
            question=question,
            history=None,
            ocr_result=ocr_result,
            vision_result=VisionAnalysisResult(
                image_type="equipement",
                analysis="",
                detected_kpis=[],
                recommendations=[],
                confidence=max(ocr_result.confidence or 0.0, 0.56),
                model="vision-fallback",
            ),
        )
    ):
        inferred_type = "equipement"
    elif ocr_result.visible_tables:
        inferred_type = "tableau"

    fallback_lines = [
        "Lecture metier consolidee sur les indicateurs disponibles.",
        f"Point de lecture prioritaire: {_truncate(question, 100)}",
    ]
    if ocr_result.kpis:
        fallback_lines.append(f"KPI visibles: {', '.join(ocr_result.kpis[:3])}")
    if ocr_result.alerts:
        fallback_lines.append(f"Alertes reperees: {', '.join(ocr_result.alerts[:2])}")
    fallback_lines.append(error_message)

    detected_objects: list[str] = []
    detected_operators: list[str] = []
    sim_types: list[str] = []
    primary_equipment: str | None = None
    apparent_condition: str | None = None
    probable_usage: str | None = None
    replacement_signals: list[str] = []

    if inferred_type == "equipement":
        provisional_result = VisionAnalysisResult(
            image_type="equipement",
            analysis=" ".join(fallback_lines),
            detected_kpis=[],
            recommendations=[],
            confidence=max(0.56, min(ocr_result.confidence or 0.58, 0.72)),
            model="vision-fallback",
            raw_output=ocr_result.text,
        )
        detected_objects = _build_detected_equipment_objects(
            question=question,
            ocr_result=ocr_result,
            vision_result=provisional_result,
        )
        if not detected_objects and not _has_telecom_equipment_fallback_hints(
            ocr_result=ocr_result,
            vision_result=provisional_result,
        ):
            detected_objects = _infer_generic_visible_fallback_objects(
                prepared_image=prepared_image,
                filename=filename,
                ocr_result=ocr_result,
            )
        detected_operators = _extract_equipment_operators_from_text(ocr_result.text)
        sim_types = _extract_sim_types_from_text(ocr_result.text)
        primary_equipment = detected_objects[0] if detected_objects else None
        apparent_condition = (
            ocr_result.equipment_details.visible_condition
            if ocr_result.equipment_details is not None and ocr_result.equipment_details.visible_condition
            else "non confirme visuellement"
        )
        probable_usage = (
            ocr_result.equipment_details.usage_summary
            if ocr_result.equipment_details is not None and ocr_result.equipment_details.usage_summary
            else None
        )
        replacement_signals = (
            ocr_result.equipment_details.detected_issues[:3]
            if ocr_result.equipment_details is not None and ocr_result.equipment_details.detected_issues
            else []
        )

    return VisionAnalysisResult(
        image_type=inferred_type,
        analysis=" ".join(fallback_lines),
        detected_kpis=ocr_result.kpis[:5],
        recommendations=[],
        confidence=(
            max(0.56, min(ocr_result.confidence or 0.58, 0.72))
            if inferred_type == "equipement"
            else max(0.35, min(ocr_result.confidence or 0.4, 0.74))
        ),
        model="vision-fallback",
        detected_objects=detected_objects,
        detected_operators=detected_operators,
        sim_types=sim_types,
        primary_equipment=primary_equipment,
        apparent_condition=apparent_condition,
        probable_usage=probable_usage,
        replacement_signals=replacement_signals,
        raw_output=ocr_result.text,
    )


def _build_quick_vision_result(
    *,
    question: str,
    ocr_result: OcrExtractionResult,
) -> VisionAnalysisResult:
    fallback_result = _build_vision_fallback_result(
        question=question,
        ocr_result=ocr_result,
        error_message=(
            "Premiere lecture metier produite a partir des indicateurs les plus fiables "
            "de la capture."
        ),
    )
    return replace(
        fallback_result,
        analysis=(
            "Lecture metier consolidee. "
            + fallback_result.analysis.replace(
                "Lecture metier consolidee sur les indicateurs disponibles.",
                "Lecture croisee des KPI detectes et du contexte metier disponible.",
            )
        ),
        model="ocr-quick",
    )


def _has_usable_ocr_fallback(ocr_result: OcrExtractionResult) -> bool:
    if ocr_result.status != "ok":
        return False
    if (ocr_result.confidence or 0.0) >= 0.18 and ocr_result.text.strip():
        return True
    return any(
        (
            ocr_result.kpis,
            ocr_result.alerts,
            ocr_result.visible_tables,
            ocr_result.invoice_details is not None,
            ocr_result.incident_details is not None,
            ocr_result.workflow_details is not None,
            ocr_result.equipment_details is not None,
        )
    )


def _should_run_dashboard_analysis(
    *,
    analysis_mode: str,
    inferred_image_type: str,
) -> bool:
    if analysis_mode == "dashboard_analysis":
        return True
    return inferred_image_type in {"dashboard", "graphe", "tableau"}


def _build_dashboard_answer(
    dashboard_analysis: DashboardAnalysisResult,
) -> FinalImageAnswer:
    radar_summary = ", ".join(
        f"{axis.label} {axis.value}/100" for axis in dashboard_analysis.radar_axes[:6]
    )
    visible_kpis = _prioritize_visible_business_kpis(dashboard_analysis.visible_kpis, 6)
    weak_axis_count = len(dashboard_analysis.weak_axes)
    if dashboard_analysis.asymmetry_score >= 34 or weak_axis_count >= 3:
        dashboard_risk_label = "Eleve"
    elif dashboard_analysis.asymmetry_score >= 24 or weak_axis_count >= 2:
        dashboard_risk_label = "Moyen a eleve"
    else:
        dashboard_risk_label = "Moyen"
    executive_summary_parts = []
    if dashboard_analysis.dominant_axes:
        executive_summary_parts.append(
            f"Les axes dominants sont {', '.join(dashboard_analysis.dominant_axes[:2])}."
        )
    if dashboard_analysis.weak_axes:
        executive_summary_parts.append(
            f"Les axes les plus faibles sont {', '.join(dashboard_analysis.weak_axes[:3])}."
        )
    if dashboard_analysis.asymmetry_score >= 28:
        executive_summary_parts.append(
            "Le radar montre un desequilibre marque entre les sous-scores IA."
        )
    executive_summary = " ".join(executive_summary_parts).strip()
    if not executive_summary:
        executive_summary = (
            "Le dashboard montre des variations nettes entre les dimensions observees."
        )
    risk_main = (
        dashboard_analysis.critical_zones[0]
        if dashboard_analysis.critical_zones
        else "Le desequilibre global du dashboard appelle une revue plus selective des priorites."
    )
    under_supervision = (
        f"La dimension {dashboard_analysis.weak_axes[0]} reste en retrait et signale une supervision a renforcer."
        if dashboard_analysis.weak_axes
        else "Certaines zones restent moins visibles que les axes les plus suivis et doivent etre consolidees."
    )
    stable_signal = (
        f"La dimension {dashboard_analysis.dominant_axes[0]} reste le point d'appui le plus lisible du dashboard."
        if dashboard_analysis.dominant_axes
        else "Aucun axe ne ressort comme base suffisamment stable pour considerer l'equilibre acquis."
    )
    optimization_opportunity = (
        dashboard_analysis.recommendations[0]
        if dashboard_analysis.recommendations
        else "Recentrer le pilotage sur les KPI les plus faibles avant d'etendre le suivi."
    )

    answer_lines = [
        "Resume executif",
        (
            "Le dashboard FleetConnect AI met en evidence des ecarts de maitrise entre les dimensions "
            "suivies et appelle un arbitrage plus direct sur les zones les plus exposees."
        ),
        executive_summary,
    ]
    if dashboard_analysis.text_readability_notice:
        answer_lines.append(dashboard_analysis.text_readability_notice)
    answer_lines.extend(
        [
            "",
            "Impact financier estime",
            "- Impact financier: Moyen a eleve si les dimensions faibles restent sous-pilotees.",
            f"- Signal budgetaire principal: {risk_main}",
            "",
            "KPI critiques detectes",
            *(
                [f"- {item}" for item in visible_kpis]
                or [f"- {item}" for item in dashboard_analysis.critical_zones[:4]]
            ),
            "",
            "Risques metier",
            *([f"- {item}" for item in dashboard_analysis.business_risks[:4]] or [f"- {under_supervision}"]),
            "",
            "Causes probables",
            *([f"- {item}" for item in dashboard_analysis.explainability_points[:4]] or [f"- {stable_signal}"]),
            "",
            "Niveau de criticite",
            f"- Criticite globale: {dashboard_risk_label}",
            (
                "- Priorite immediate: Immediate"
                if dashboard_analysis.weak_axes
                else "- Priorite immediate: Haute"
            ),
            "",
            "Actions immediates recommandees",
            *[
                f"{index}. {item}"
                for index, item in enumerate(dashboard_analysis.recommendations[:3], start=1)
            ],
            "",
            "Recommandations IA",
            *[f"- {item}" for item in dashboard_analysis.recommendations[:4]],
            "",
            "Score IA metier",
            f"- Risque IA: {max(58, min(92, 52 + dashboard_analysis.asymmetry_score))}%",
            "- Impact financier: Moyen a eleve",
            f"- Criticite: {dashboard_risk_label}",
            f"- Confiance OCR: {round(dashboard_analysis.confidence * 100)}%",
            (
                f"Lecture radar retenue: {radar_summary}."
                if radar_summary
                else "Lecture radar retenue: sous-scores partiellement visibles."
            ),
        ]
    )

    return FinalImageAnswer(
        answer="\n".join(line for line in answer_lines if line),
        detected_kpis=_dedupe_items(
            [
                *visible_kpis,
                *[f"{axis.label} {axis.value}/100 ({axis.level})" for axis in dashboard_analysis.radar_axes],
            ],
            10,
        ),
        recommendations=dashboard_analysis.recommendations[:5],
        detected_anomalies=dashboard_analysis.critical_zones[:5],
        probable_causes=dashboard_analysis.business_risks[:5],
        severity=None,
        treatment_priority="haute" if dashboard_analysis.weak_axes else "normale",
        alert_summary=(
            "Dashboard desequilibre avec sous-scores faibles sur plusieurs dimensions."
            if dashboard_analysis.weak_axes
            else "Dashboard relativement coherent."
        ),
        confidence=dashboard_analysis.confidence,
    )


def _append_notice(base_notice: str | None, notice: str | None) -> str | None:
    parts = [item.strip() for item in [base_notice, notice] if item and item.strip()]
    if not parts:
        return None
    return " ".join(_dedupe_items(parts, 4))


def _build_processing_message(
    *,
    analysis_mode: str,
    advanced_analysis_completed: bool,
    stage_notices: list[str],
) -> tuple[str, str]:
    normalized_notices = _dedupe_items(stage_notices, 6)
    if analysis_mode in {"advanced", "dashboard_analysis"}:
        if advanced_analysis_completed:
            return (
                "success",
                "Analyse IA consolidee avec priorisation des risques."
                if analysis_mode == "dashboard_analysis"
                else "Analyse multimodale consolidee avec interpretation metier.",
            )
        if normalized_notices:
            return "fallback", normalized_notices[0]
        return (
            "fallback",
            "Les indicateurs consolides permettent deja d'orienter les priorites de traitement."
            if analysis_mode == "dashboard_analysis"
            else "Les indicateurs consolides permettent deja d'orienter les actions essentielles.",
        )

    if normalized_notices:
        return "fallback", normalized_notices[0]
    return "success", "Lecture decisionnelle consolidee."


def _format_image_type_label(image_type: str) -> str:
    image_labels = {
        "dashboard": "Dashboard",
        "graphe": "Graphe",
        "tableau": "Tableau",
        "facture": "Facture télécom",
        "capture_interface": "Capture interface",
        "anomalie": "Anomalie",
        "alerte": "Alerte",
        "alert_dashboard": "Dashboard alertes",
        "log": "Log",
        "fraude": "Fraude",
        "appel_suspect": "Appel suspect",
        "depassement_quota": "Depassement quota",
        "erreur_systeme": "Erreur systeme",
        "workflow": "Workflow",
        "organigramme": "Organigramme",
        "diagramme_technique": "Diagramme technique",
        "architecture": "Architecture",
        "processus_metier": "Processus metier",
        "equipement": "Equipement telecom",
        "smartphone": "Smartphone",
        "routeur": "Routeur",
        "routeur_wifi": "Routeur Wi-Fi",
        "modem": "Modem",
        "sim": "Carte SIM",
        "switch": "Switch",
        "borne_wifi": "Borne WiFi",
        "antenne": "Antenne",
        "appareil_inconnu": "Equipement non identifie",
    }
    return image_labels.get(image_type, image_type.replace("_", " ").title())


def _format_severity_label(severity: str | None) -> str | None:
    severity_labels = {
        "critique": "critique",
        "elevee": "elevee",
        "moyenne": "moyenne",
        "faible": "faible",
    }
    normalized_severity = (severity or "").strip().lower()
    return severity_labels.get(normalized_severity)


def _format_priority_label(priority: str | None) -> str | None:
    priority_labels = {
        "immediate": "immediate",
        "haute": "haute",
        "normale": "normale",
        "basse": "basse",
    }
    normalized_priority = (priority or "").strip().lower()
    return priority_labels.get(normalized_priority)


def _format_risk_level_label(risk_level: str | None) -> str:
    risk_labels = {
        "critical": "Critique",
        "high": "Eleve",
        "medium": "Moyen",
        "low": "Faible",
    }
    return risk_labels.get((risk_level or "").strip().lower(), "Moyen")


def _format_priority_display(priority: str | None) -> str:
    priority_labels = {
        "immediate": "Immediate",
        "haute": "Haute",
        "normale": "Normale",
        "basse": "Basse",
    }
    return priority_labels.get((priority or "").strip().lower(), "Normale")


def _truncate_sentence(value: str, limit: int = 150) -> str:
    compact_value = " ".join(value.split()).strip()
    if len(compact_value) <= limit:
        return compact_value
    return f"{compact_value[:limit].rstrip()}..."


def _build_consultant_summary(
    *,
    image_type: str,
    ocr_result: OcrExtractionResult,
    vision_result: VisionAnalysisResult,
) -> str:
    invoice_details = ocr_result.invoice_details
    incident_details = ocr_result.incident_details
    workflow_details = ocr_result.workflow_details
    equipment_details = ocr_result.equipment_details

    if image_type == "facture" and invoice_details is not None:
        operator = invoice_details.operator or "operateur non confirme"
        amount = (
            invoice_details.total_amount_mad
            or invoice_details.amount_ttc_mad
            or "montant non consolide"
        )
        return (
            f"Le document analyse correspond a une facture telecom {operator} qui appelle un "
            f"rapprochement entre le total visible ({amount}) et les frais additionnels susceptibles "
            "de peser sur le budget."
        )
    if image_type == "workflow" and workflow_details is not None:
        return (
            "Le schema met en evidence un workflow telecom dont plusieurs etapes paraissent concentrer "
            "la complexite, la validation et le risque de ralentissement operationnel."
        )
    if image_type == "equipement" and equipment_details is not None:
        return (
            "L'equipement observe presente des signaux qui doivent etre rapproches de sa criticite "
            "operationnelle, de son etat apparent et de son exposition au risque de service."
        )
    if incident_details is not None:
        visible_metrics = _dedupe_items(
            [
                (
                    f"{incident_details.critical_alert_count} alertes critiques"
                    if incident_details.critical_alert_count is not None
                    else ""
                ),
                (
                    f"un taux d'exposition de {incident_details.exposure_rate}"
                    if incident_details.exposure_rate
                    else ""
                ),
                (
                    f"un impact financier de {incident_details.financial_impact_mad}"
                    if incident_details.financial_impact_mad
                    else ""
                ),
                (
                    "des scores de risque 100/100 sur plusieurs profils"
                    if len(incident_details.risky_entities) >= 2 and incident_details.risk_score == "100/100"
                    else "un score de risque 100/100 visible"
                    if incident_details.risk_score == "100/100"
                    else ""
                ),
            ],
            4,
        )
        if visible_metrics:
            return (
                "La capture d'alertes met en evidence "
                + ", ".join(visible_metrics[:-1])
                + (" et " + visible_metrics[-1] if len(visible_metrics) > 1 else visible_metrics[0])
                + ", ce qui justifie une priorisation immediate de la supervision."
            )
        return (
            "La capture correspond a une alerte telecom qui justifie une priorisation rapide compte tenu "
            "de son impact potentiel sur les couts, la supervision ou la continuite de service."
        )
    if image_type == "dashboard":
        visible_metrics = _prioritize_visible_business_kpis(
            [*ocr_result.kpis, *ocr_result.amounts_mad, *vision_result.detected_kpis],
            3,
        )
        if visible_metrics:
            return (
                "Le dashboard met en avant des KPI visibles qui appellent une decision rapide : "
                + ", ".join(visible_metrics[:2])
                + (f", {visible_metrics[2]}" if len(visible_metrics) > 2 else "")
                + "."
            )
        return (
            "Le dashboard partage montre des ecarts nets entre KPI, avec des zones mieux maitrisees que d'autres "
            "et un besoin de decision plus rapide sur les indicateurs les plus exposes."
        )
    if image_type == "graphe":
        return (
            "Le graphique analyse met en evidence une lecture non uniforme des indicateurs, avec des "
            "ecarts suffisamment visibles pour orienter une priorisation metier."
        )
    return (
        "La capture partagee contient des signaux telecom exploitables qui appellent une lecture croisee "
        "des risques, des couts et du niveau de supervision."
    )


def _build_key_findings(
    *,
    image_type: str,
    parsed_answer: FinalImageAnswer,
    ocr_result: OcrExtractionResult,
    vision_result: VisionAnalysisResult,
) -> list[str]:
    findings: list[str] = []
    invoice_details = ocr_result.invoice_details
    incident_details = ocr_result.incident_details
    workflow_details = ocr_result.workflow_details
    equipment_details = ocr_result.equipment_details

    findings.extend(_clean_business_items(parsed_answer.detected_anomalies[:3], 3))
    findings.extend(
        _prioritize_visible_business_kpis(
            [
                *parsed_answer.detected_kpis,
                *ocr_result.kpis,
                *ocr_result.amounts_mad,
                *vision_result.detected_kpis,
            ],
            4,
        )
    )

    if image_type == "workflow" and workflow_details is not None:
        findings.append(
            f"Complexite workflow estimee a {workflow_details.complexity_score}/100 "
            f"({workflow_details.complexity_level or 'niveau en revue'})."
        )
        findings.extend(workflow_details.critical_steps[:2])
    elif image_type == "equipement" and equipment_details is not None:
        findings.append(
            f"Etat equipement {equipment_details.condition_score}/100 avec criticite "
            f"{equipment_details.criticality_score}/100."
        )
        findings.extend(equipment_details.detected_issues[:2])
    elif image_type == "facture" and invoice_details is not None:
        if invoice_details.total_amount_mad:
            findings.append(f"Total visible sur le document: {invoice_details.total_amount_mad}.")
        findings.extend(invoice_details.anomalies[:2])
    elif incident_details is not None:
        if incident_details.critical_alert_count is not None:
            findings.append(f"{incident_details.critical_alert_count} alertes critiques actives.")
        if incident_details.exposure_rate:
            findings.append(f"Taux d'exposition visible: {incident_details.exposure_rate}.")
        if incident_details.financial_impact_mad:
            findings.append(f"Impact financier visible: {incident_details.financial_impact_mad}.")
        if incident_details.revenue_at_risk_mad:
            findings.append(f"Revenu a risque: {incident_details.revenue_at_risk_mad}.")
        if incident_details.fraud_score_visible:
            findings.append(f"Risque fraude: {incident_details.fraud_score_visible}.")
        if incident_details.anomaly_score_visible:
            findings.append(f"Risque anomalie: {incident_details.anomaly_score_visible}.")
        if incident_details.optimization_score_visible:
            findings.append(f"Risque optimisation: {incident_details.optimization_score_visible}.")
        if incident_details.cost_score_visible:
            findings.append(f"Risque cout: {incident_details.cost_score_visible}.")
        if incident_details.risk_score == "100/100":
            findings.append(
                "Des scores utilisateurs a 100/100 figurent parmi les signaux les plus critiques."
            )
        if incident_details.line_reference:
            findings.append(f"Ligne concernee: {incident_details.line_reference}.")
        if incident_details.suspect_cost_mad:
            findings.append(f"Cout suspect repere: {incident_details.suspect_cost_mad}.")
        findings.extend(incident_details.critical_signals[:2])

    if vision_result.analysis and not any(_score_visible_business_kpi(item) >= 82 for item in findings):
        findings.append(_truncate_sentence(vision_result.analysis, 140))
    return _clean_business_items(findings, 5)


def _build_default_probable_causes(
    *,
    image_type: str,
    parsed_answer: FinalImageAnswer,
    ocr_result: OcrExtractionResult,
    decision_engine_result: RecommendationEngineResult,
) -> list[str]:
    causes = list(parsed_answer.probable_causes)
    if causes:
        return _clean_business_items(causes, 4)

    if image_type == "facture":
        causes.extend(
            [
                "des frais additionnels ou depassements potentiellement non absorbes par le forfait",
                "une trajectoire budgetaire peu alignee avec les consommations visibles",
            ]
        )
    elif image_type == "workflow":
        causes.extend(
            [
                "une surcharge de validations manuelles ou d'etapes de controle",
                "des dependances entre equipes qui ralentissent le traitement",
            ]
        )
    elif image_type == "equipement":
        causes.extend(
            [
                "un niveau d'usure ou d'obsolescence qui fragilise l'exploitation",
                "une supervision materielle insuffisante sur les equipements les plus sensibles",
            ]
        )
    elif ocr_result.incident_details is not None:
        incident = ocr_result.incident_details
        causes.extend(
            [
                (
                    "une surcharge de supervision face au volume d'alertes critiques visibles"
                    if incident.critical_alert_count is not None and incident.critical_alert_count >= 100
                    else "une anomalie de consommation ou un comportement d'usage non absorbe a temps"
                ),
                (
                    "plusieurs profils atteignent un niveau de risque maximal et exigent une revue immediate"
                    if incident.risk_score == "100/100"
                    else "une couverture de detection qui doit etre renforcee sur les lignes a risque"
                ),
            ]
        )
    elif image_type in {"dashboard", "graphe", "tableau"}:
        causes.extend(
            [
                "un desequilibre entre les dimensions suivies, avec certaines zones sur-pilotees et d'autres sous-supervisees",
                "une priorisation encore insuffisante sur les indicateurs les plus faibles ou les plus volatils",
            ]
        )
    else:
        causes.extend(
            [
                "une couverture partielle des signaux de supervision visibles dans la capture",
                "une gouvernance des priorites qui reste a reequilibrer autour des points de tension",
            ]
        )

    if decision_engine_result.fraud_score >= 70:
        causes.append("un niveau de pression fraude qui justifie un renforcement des controles")
    if decision_engine_result.cost_score >= 70:
        causes.append("une pression budgetaire visible sur les postes les plus exposes")
    return _clean_business_items(causes, 4)


def _build_priority_actions(
    *,
    parsed_answer: FinalImageAnswer,
    decision_engine_result: RecommendationEngineResult,
) -> list[str]:
    priority_actions = [
        recommendation.title
        for recommendation in decision_engine_result.recommendations[:3]
    ]
    if not priority_actions:
        priority_actions = parsed_answer.recommendations[:3]
    return _dedupe_items(priority_actions, 3)


def _build_recommendation_lines(
    *,
    parsed_answer: FinalImageAnswer,
    decision_engine_result: RecommendationEngineResult,
) -> list[str]:
    recommendation_lines = [
        recommendation.reason
        for recommendation in decision_engine_result.recommendations[:3]
        if recommendation.reason
    ]
    recommendation_lines.extend(parsed_answer.recommendations[:3])
    return _clean_business_items(recommendation_lines, 4)


def _build_impact_potential(
    *,
    image_type: str,
    risk_level: str | None,
    decision_engine_result: RecommendationEngineResult,
) -> str:
    risk_label = _format_risk_level_label(risk_level)
    if image_type == "workflow":
        return (
            f"Si la situation reste en l'etat, l'impact le plus probable est un allongement des delais "
            f"de traitement et une baisse de fluidite operationnelle. Niveau de vigilance: {risk_label}."
        )
    if image_type == "equipement":
        return (
            f"L'impact potentiel porte d'abord sur la continuite de service, la maintenance corrective "
            f"et la fiabilite du parc. Niveau de vigilance: {risk_label}."
        )
    if image_type == "facture":
        return (
            f"L'impact potentiel se situe principalement sur la trajectoire budgetaire et sur la qualite "
            f"du controle de facture en amont du paiement. Niveau de vigilance: {risk_label}."
        )
    if image_type in {"dashboard", "graphe", "tableau"}:
        return (
            f"L'impact potentiel concerne surtout la priorisation des risques et la qualite du pilotage "
            f"si les dimensions faibles restent sous-surveillees. Niveau de vigilance: {risk_label}."
        )
    if image_type in ALERT_FOCUSED_IMAGE_TYPES:
        return (
            f"L'impact potentiel porte sur une hausse des couts, une propagation des comportements suspects "
            f"et une surcharge des equipes de supervision si les alertes critiques ne sont pas traitees rapidement. "
            f"Niveau de vigilance: {risk_label}."
        )
    if decision_engine_result.fraud_score >= 70:
        return (
            f"L'impact potentiel peut se traduire par une sous-detection des usages anormaux et une hausse "
            f"de l'exposition sur les segments les plus sensibles. Niveau de vigilance: {risk_label}."
        )
    return (
        f"L'impact potentiel porte a la fois sur les couts, la supervision et la vitesse de decision "
        f"si les indicateurs critiques ne sont pas traites rapidement. Niveau de vigilance: {risk_label}."
    )


def _build_stable_signal_line(
    *,
    image_type: str,
    parsed_answer: FinalImageAnswer,
    ocr_result: OcrExtractionResult,
) -> str:
    if image_type == "facture" and ocr_result.invoice_details is not None:
        invoice = ocr_result.invoice_details
        if invoice.total_amount_mad:
            return (
                f"Le montant total visible ({invoice.total_amount_mad}) fournit un point de controle "
                "fiable pour le rapprochement budgetaire."
            )
        if invoice.billing_period:
            return (
                f"La periode {invoice.billing_period} constitue le repere le plus stable pour cadrer "
                "la verification de facture."
            )
    if image_type == "workflow" and ocr_result.workflow_details is not None:
        workflow = ocr_result.workflow_details
        if workflow.complexity_score <= 45:
            return (
                f"La complexite workflow reste contenue a {workflow.complexity_score}/100, ce qui offre "
                "une base saine pour renforcer l'automatisation."
            )
    if image_type == "equipement" and ocr_result.equipment_details is not None:
        equipment = ocr_result.equipment_details
        if equipment.condition_score >= 70:
            return (
                f"L'etat visible de l'equipement ({equipment.condition_score}/100) reste le signal le plus "
                "stable pour planifier la maintenance."
            )
    if parsed_answer.detected_kpis:
        return (
            f"Le repere le plus exploitable a ce stade reste {parsed_answer.detected_kpis[0]}, utile "
            "comme point d'appui pour la decision."
        )
    return "Les indicateurs les plus lisibles doivent servir de base au pilotage avant extension de l'analyse."


def _build_priority_hierarchy_lines(
    *,
    image_type: str,
    parsed_answer: FinalImageAnswer,
    ocr_result: OcrExtractionResult,
    key_findings: list[str],
    probable_causes: list[str],
    priority_actions: list[str],
    recommendation_lines: list[str],
) -> list[str]:
    risk_main = (
        key_findings[0]
        if key_findings
        else "Les indicateurs critiques appellent une verification prioritaire avant toute decision engageante."
    )
    under_supervision = (
        probable_causes[0]
        if probable_causes
        else "La couverture de supervision apparait partielle sur les zones les plus sensibles."
    )
    stable_signal = _build_stable_signal_line(
        image_type=image_type,
        parsed_answer=parsed_answer,
        ocr_result=ocr_result,
    )
    optimization_opportunity = (
        recommendation_lines[0]
        if recommendation_lines
        else "Concentrer l'effort sur les indicateurs les plus exposes avant d'etendre l'analyse."
    )
    immediate_priority = (
        priority_actions[0]
        if priority_actions
        else "Consolider les points visibles les plus critiques avant arbitrage."
    )
    return [
        f"🔴 Risque principal : {risk_main}",
        f"🟠 Zone sous-supervisee : {under_supervision}",
        f"🟢 KPI stable : {stable_signal}",
        f"📈 Opportunite d'optimisation : {optimization_opportunity}",
        f"⚠️ Priorite immediate : {immediate_priority}",
    ]


def _dashboard_should_use_incident_narrative(
    *,
    image_type: str,
    ocr_result: OcrExtractionResult,
) -> bool:
    incident = ocr_result.incident_details
    if incident is None:
        return False
    if image_type in ALERT_FOCUSED_IMAGE_TYPES:
        return True
    if image_type != "dashboard":
        return False
    return bool(
        incident.at_risk_clients_count is not None
        or incident.churn_rate
        or incident.revenue_at_risk_mad
        or incident.financial_impact_mad
        or incident.critical_alert_count is not None
        or incident.fraud_score_visible
        or incident.anomaly_score_visible
        or incident.max_risk_scores
        or ocr_result.departments
    )


def _dashboard_has_strict_kpi_mode(
    *,
    image_type: str,
    ocr_result: OcrExtractionResult,
) -> bool:
    if image_type not in {"dashboard", "alerte", "alert_dashboard"}:
        return False
    incident = ocr_result.incident_details
    if incident is None:
        return False
    return bool(
        incident.at_risk_clients_count is not None
        or incident.churn_rate
        or incident.revenue_at_risk_mad
        or incident.financial_impact_mad
        or incident.department_risk
        or incident.contract_exposed
        or incident.average_score
        or incident.fraud_score_visible
        or incident.anomaly_score_visible
        or ocr_result.departments
    )


def _resolve_incident_visible_department(
    *,
    incident_details: IncidentDocumentDetails,
    ocr_result: OcrExtractionResult,
) -> str | None:
    return incident_details.department_risk or next(
        (item for item in ocr_result.departments if item),
        None,
    )


def _answer_mentions_incident_kpis(
    *,
    answer: str,
    ocr_result: OcrExtractionResult,
) -> bool:
    incident = ocr_result.incident_details
    if incident is None:
        return True
    anchors = _clean_business_items(
        [
            str(incident.critical_alert_count) if incident.critical_alert_count is not None else "",
            str(incident.at_risk_clients_count) if incident.at_risk_clients_count is not None else "",
            incident.exposure_rate or "",
            incident.churn_rate or "",
            incident.revenue_at_risk_mad or "",
            incident.financial_impact_mad or "",
            incident.estimated_impact_mad or "",
            incident.average_score or "",
            incident.fraud_score_visible or "",
            incident.anomaly_score_visible or "",
            incident.department_risk or "",
            incident.contract_exposed or "",
            *(ocr_result.departments[:2] if ocr_result.departments else []),
        ],
        8,
    )
    if len(anchors) < 2:
        return True
    normalized_answer = _normalize_invoice_text(answer)
    return sum(1 for anchor in anchors if _normalize_invoice_text(anchor) in normalized_answer) >= 2


def _compose_invoice_consultant_answer(
    *,
    invoice_details: InvoiceDocumentDetails,
    ocr_result: OcrExtractionResult,
    decision_engine_result: RecommendationEngineResult,
) -> str:
    resolved_risk_level = _resolve_business_risk_level(
        initial_risk_level=decision_engine_result.risk_level or invoice_details.risk_level,
        image_type="facture",
        ocr_result=ocr_result,
        decision_engine_result=decision_engine_result,
    )
    resolved_priority = _resolve_business_priority(
        initial_priority="haute",
        resolved_risk_level=resolved_risk_level,
        image_type="facture",
        ocr_result=ocr_result,
        decision_engine_result=decision_engine_result,
    )
    total_amount = invoice_details.total_amount_mad or invoice_details.amount_ttc_mad
    period = invoice_details.billing_period or invoice_details.invoice_date
    operator = invoice_details.operator or "operateur telecom"
    main_items = invoice_details.cost_items[:3]
    top_item = invoice_details.cost_items[0] if invoice_details.cost_items else None
    visible_anomalies = _clean_business_items(invoice_details.anomalies[:4], 4)
    probable_causes = _clean_business_items(
        [
            (
                "des usages roaming internationaux encore insuffisamment encadres"
                if any(item.category == "roaming" for item in invoice_details.cost_items)
                else ""
            ),
            (
                "des depassements data ou hors forfait repetes sur des lignes visibles"
                if any(item.category == "data_overage" for item in invoice_details.cost_items)
                else ""
            ),
            (
                "une concentration des couts sur un nombre limite de postes facturees"
                if invoice_details.critical_items
                else ""
            ),
        ],
        4,
    )
    priority_actions = _clean_business_items(
        [recommendation.title for recommendation in decision_engine_result.recommendations[:4]],
        4,
    )
    recommendation_lines = [
        recommendation.reason
        for recommendation in decision_engine_result.recommendations[:4]
        if recommendation.reason
    ]
    recommendation_lines = _clean_business_items(recommendation_lines, 4)
    impact_statement = (
        invoice_details.primary_risk
        or (
            f"La concentration de cout sur {top_item.label.lower()} peut peser durablement sur le budget telecom."
            if top_item is not None
            else "La facture appelle un controle des postes variables avant validation."
        )
    )
    if invoice_details.estimated_savings:
        impact_statement += f" Economie potentielle estimee: {invoice_details.estimated_savings}."

    summary_line = f"La facture {operator} analysee"
    if total_amount:
        summary_line += f" presente un montant total de {total_amount}"
    if period:
        summary_line += f" pour la periode {period}"
    summary_line += "."
    impact_lines = _clean_business_items(
        [
            (
                f"- Montant total visible: {total_amount}."
                if total_amount
                else ""
            ),
            (
                f"- TVA visible: {invoice_details.vat_amount_mad}."
                if invoice_details.vat_amount_mad
                else ""
            ),
            (
                f"- Economie potentielle estimee: {invoice_details.estimated_savings}."
                if invoice_details.estimated_savings
                else ""
            ),
            (
                f"- Poste principal: {top_item.label} a {top_item.amount_mad}"
                + (
                    f" ({_format_share_pct(top_item.share_of_total_pct)} du total TTC)."
                    if top_item and top_item.share_of_total_pct is not None
                    else "."
                )
                if top_item is not None
                else ""
            ),
        ],
        4,
    )
    business_risks = _clean_business_items(
        [
            impact_statement,
            (
                "Les frais variables visibles peuvent accelerer la derive budgetaire si les usages roaming ou hors forfait ne sont pas recalibres."
                if any(item.category in {"roaming", "data_overage"} for item in invoice_details.cost_items)
                else "La structure de cout visible doit etre rapprochee des usages reels pour eviter le gaspillage forfaitaire."
            ),
        ],
        4,
    )

    lines = [
        "Resume executif",
        summary_line,
        "",
        "Impact financier estime",
        *(
            impact_lines
            or ["- Le document confirme une pression budgetaire qui doit etre rapprochee des postes de cout visibles."]
        ),
        "",
        "KPI critiques detectes",
        *(
            [
                (
                    f"- {item.label}: {item.amount_mad}"
                    + (
                        f" ({_format_share_pct(item.share_of_total_pct)} du total TTC)"
                        if item.share_of_total_pct is not None
                        else ""
                    )
                )
                for item in main_items
            ]
            or ["- Aucun poste de cout structurant n'a pu etre consolide."]
        ),
        *([f"- {item}" for item in visible_anomalies] if visible_anomalies else []),
        "",
        "Risques metier",
        *([f"- {item}" for item in business_risks] or ["- La facture requiert un arbitrage budgetaire sur les postes les plus sensibles."]),
        "",
        "Causes probables",
        *([f"- {item}" for item in probable_causes] or ["- Les postes variables visibles appellent un audit cible des usages et forfaits."]),
        "",
        "Niveau de criticite",
        f"- Criticite globale: {_format_risk_level_label(resolved_risk_level)}",
        f"- Pression budgetaire: {_derive_financial_impact_level(image_type='facture', ocr_result=ocr_result, decision_engine_result=decision_engine_result)}",
        "",
        "Actions immediates recommandees",
        f"- Priorite immediate: {_format_priority_display(resolved_priority)}",
        *(
            [f"{index}. {item}" for index, item in enumerate(priority_actions, start=1)]
            or ["1. Verifier les postes de cout visibles avant validation de la facture."]
        ),
        "",
        "Recommandations IA",
        *(
            [f"- {item}" for item in recommendation_lines]
            or ["- Prioriser un audit des postes les plus eleves de la facture."]
        ),
        "",
        *_build_score_ia_section(
            image_type="facture",
            ocr_result=ocr_result,
            decision_engine_result=decision_engine_result,
            resolved_risk_level=resolved_risk_level,
        ),
    ]
    return _polish_business_answer(
        answer="\n".join(item for item in lines if item),
        image_type="facture",
        ocr_result=ocr_result,
        decision_engine_result=decision_engine_result,
    )


def _compose_dashboard_kpi_strict_answer(
    *,
    incident_details: IncidentDocumentDetails,
    ocr_result: OcrExtractionResult,
    decision_engine_result: RecommendationEngineResult,
) -> str:
    risk_level = _resolve_business_risk_level(
        initial_risk_level=decision_engine_result.risk_level,
        image_type=incident_details.alert_type or "dashboard",
        ocr_result=ocr_result,
        decision_engine_result=decision_engine_result,
    )
    resolved_priority = _resolve_business_priority(
        initial_priority=incident_details.priority,
        resolved_risk_level=risk_level,
        image_type=incident_details.alert_type or "dashboard",
        ocr_result=ocr_result,
        decision_engine_result=decision_engine_result,
    )
    visible_department = _resolve_incident_visible_department(
        incident_details=incident_details,
        ocr_result=ocr_result,
    )
    financial_impact_level = _derive_financial_impact_level(
        image_type="dashboard",
        ocr_result=ocr_result,
        decision_engine_result=decision_engine_result,
    )
    opening_line = (
        "Oui, cette alerte est critique pour la flotte telecom."
        if risk_level in {"high", "critical"}
        else "Oui, cette alerte reste prioritaire pour la flotte telecom."
    )
    summary_line = _clean_business_items(
        [
            (
                f"{incident_details.critical_alert_count} alertes critiques restent actives"
                if incident_details.critical_alert_count is not None
                else ""
            ),
            (
                f"{incident_details.at_risk_clients_count} clients a risque sont deja identifies"
                if incident_details.at_risk_clients_count is not None
                else ""
            ),
            (
                f"le taux d'exposition atteint {incident_details.exposure_rate}"
                if incident_details.exposure_rate
                else ""
            ),
            f"le churn atteint {incident_details.churn_rate}" if incident_details.churn_rate else "",
            (
                f"le revenu expose atteint {incident_details.revenue_at_risk_mad}"
                if incident_details.revenue_at_risk_mad
                else ""
            ),
            (
                f"le departement {visible_department} concentre le risque principal"
                if visible_department
                else ""
            ),
        ],
        5,
    )
    kpi_lines = _clean_business_items(
        [
            (
                f"{incident_details.critical_alert_count} alertes critiques"
                if incident_details.critical_alert_count is not None
                else ""
            ),
            (
                f"{incident_details.at_risk_clients_count} clients a risque"
                if incident_details.at_risk_clients_count is not None
                else ""
            ),
            (
                f"un taux d'exposition de {incident_details.exposure_rate}"
                if incident_details.exposure_rate
                else ""
            ),
            f"un churn eleve de {incident_details.churn_rate}" if incident_details.churn_rate else "",
            (
                f"un revenu expose estime a {incident_details.revenue_at_risk_mad}"
                if incident_details.revenue_at_risk_mad
                else ""
            ),
            (
                f"un impact estime de {incident_details.estimated_impact_mad}"
                if incident_details.estimated_impact_mad
                else ""
            ),
            (
                f"un impact financier potentiel de {incident_details.financial_impact_mad}"
                if incident_details.financial_impact_mad
                else ""
            ),
            (
                f"un departement {visible_department} fortement expose"
                if visible_department
                else ""
            ),
            (
                f"{incident_details.contract_exposed} a surveiller"
                if incident_details.contract_exposed
                else ""
            ),
            (
                f"un score moyen visible de {incident_details.average_score}"
                if incident_details.average_score
                else ""
            ),
            (
                f"un risque fraude de {incident_details.fraud_score_visible}"
                if incident_details.fraud_score_visible
                else ""
            ),
            (
                f"un risque anomalie de {incident_details.anomaly_score_visible}"
                if incident_details.anomaly_score_visible
                else ""
            ),
            (
                f"un risque cout de {incident_details.cost_score_visible}"
                if incident_details.cost_score_visible
                else ""
            ),
        ],
        8,
    )
    impact_lines = _clean_business_items(
        [
            (
                f"L'impact financier potentiel est de {incident_details.financial_impact_mad}."
                if incident_details.financial_impact_mad
                else ""
            ),
            (
                f"Le taux d'exposition atteint {incident_details.exposure_rate}."
                if incident_details.exposure_rate
                else ""
            ),
            (
                f"Le revenu expose de {incident_details.revenue_at_risk_mad} place deja la retention et le chiffre d'affaires sous pression."
                if incident_details.revenue_at_risk_mad
                else ""
            ),
            (
                f"Le churn a {incident_details.churn_rate} indique un risque de perte de revenus a court terme."
                if incident_details.churn_rate
                else ""
            ),
            (
                f"La base de {incident_details.contract_exposed} augmente l'exposition budgetaire si aucune action de retention n'est lancee."
                if incident_details.contract_exposed
                else ""
            ),
            (
                f"Le departement {visible_department} concentre une part importante du risque business."
                if visible_department
                else ""
            ),
            (
                f"Les scores fraude et anomalie ({incident_details.fraud_score_visible} / {incident_details.anomaly_score_visible}) renforcent le risque de churn subi et de pertes evitables."
                if incident_details.fraud_score_visible and incident_details.anomaly_score_visible
                else ""
            ),
        ],
        5,
    )
    business_risks = _clean_business_items(
        [
            (
                f"Un portefeuille expose a {incident_details.revenue_at_risk_mad} cree un risque eleve de perte de revenus."
                if incident_details.revenue_at_risk_mad
                else ""
            ),
            (
                f"Le churn a {incident_details.churn_rate} augmente la probabilite de resiliation et de baisse du revenu recurrent."
                if incident_details.churn_rate
                else ""
            ),
            (
                f"Le departement {visible_department} doit etre traite en priorite pour limiter l'attrition."
                if visible_department
                else ""
            ),
            (
                "Les scores fraude et anomalie eleves confirment un risque combine de perte client et d'usages suspects."
                if incident_details.fraud_score_visible or incident_details.anomaly_score_visible
                else ""
            ),
        ],
        4,
    )
    probable_causes = _clean_business_items(
        [
            (
                f"une forte concentration des clients a risque dans le departement {visible_department}"
                if visible_department
                else ""
            ),
            (
                "une base mensuelle deja exposee a la resiliation ou au churn"
                if incident_details.contract_exposed
                else ""
            ),
            (
                "une pression combinee entre churn, risque fraude et anomalies"
                if incident_details.churn_rate
                and (incident_details.fraud_score_visible or incident_details.anomaly_score_visible)
                else ""
            ),
            (
                f"un score moyen de {incident_details.average_score} qui confirme une derive deja materialisee"
                if incident_details.average_score
                else ""
            ),
        ],
        4,
    )
    priority_actions = _clean_business_items(
        [
            (
                "Traiter les clients P1 et les lignes a risque en premier"
                if incident_details.at_risk_clients_count is not None
                else ""
            ),
            (
                "Lancer une campagne de retention sur le departement le plus expose"
                if visible_department
                else ""
            ),
            (
                "Auditer les contrats mensuels les plus exposes"
                if incident_details.contract_exposed
                else ""
            ),
            (
                "Renforcer immediatement les controles fraude et churn"
                if incident_details.fraud_score_visible or incident_details.anomaly_score_visible
                else ""
            ),
            *[recommendation.title for recommendation in decision_engine_result.recommendations[:3]],
        ],
        5,
    )
    recommendation_lines = _clean_business_items(
        [
            (
                f"Le churn a {incident_details.churn_rate} justifie une action immediate de retention ciblee."
                if incident_details.churn_rate
                else ""
            ),
            (
                f"Le revenu expose de {incident_details.revenue_at_risk_mad} doit etre securise en priorisant les clients les plus sensibles."
                if incident_details.revenue_at_risk_mad
                else ""
            ),
            (
                f"Le departement {visible_department} doit etre place sous surveillance renforcee tant que les indicateurs ne se normalisent pas."
                if visible_department
                else ""
            ),
            *[
                recommendation.reason
                for recommendation in decision_engine_result.recommendations[:3]
                if recommendation.reason
            ],
        ],
        5,
    )

    lines = [
        opening_line,
        "",
        "Resume executif",
        *(
            [f"- {item}." for item in summary_line]
            or ["- Les KPI dashboard montrent une pression immediate sur les revenus et la retention."]
        ),
        "",
        "KPI detectes",
        *([f"- {item}." for item in kpi_lines] or ["- Les KPI consolides confirment une exposition business immediate."]),
        "",
        "Impact financier",
        *([f"- {item}" for item in impact_lines] or ["- L'impact financier est eleve et appelle une reponse immediate."]),
        "",
        "Risques metier",
        *([f"- {item}" for item in business_risks] or ["- Le dashboard montre un risque combine sur les revenus, la retention et la supervision."]),
        "",
        "Causes probables",
        *([f"- {item}." for item in probable_causes] or ["- Les KPI consolides confirment une pression combinee sur la retention et les revenus."]),
        "",
        "Actions immediates recommandees",
        *(
            [f"- {item}" for item in priority_actions]
            or ["- Prioriser les clients et lignes les plus exposes."]
        ),
        "",
        "Recommandations IA",
        *([f"- {item}" for item in recommendation_lines] or ["- Prioriser les comptes les plus exposes avant toute escalation plus large."]),
        "",
        "Niveau de criticite",
        f"- Criticite globale: {_format_risk_level_label(risk_level)}",
        f"- Impact financier: {financial_impact_level}",
        f"- Priorite immediate: {_format_priority_display(resolved_priority)}",
        "",
        *_build_score_ia_section(
            image_type="dashboard",
            ocr_result=ocr_result,
            decision_engine_result=decision_engine_result,
            resolved_risk_level=risk_level,
        ),
    ]
    return _polish_business_answer(
        answer="\n".join(item for item in lines if item),
        image_type="dashboard",
        ocr_result=ocr_result,
        decision_engine_result=decision_engine_result,
    )


def _compose_alert_consultant_answer(
    *,
    incident_details: IncidentDocumentDetails,
    ocr_result: OcrExtractionResult,
    decision_engine_result: RecommendationEngineResult,
    display_image_type: str | None = None,
) -> str:
    if _dashboard_has_strict_kpi_mode(
        image_type=display_image_type or incident_details.alert_type or "",
        ocr_result=ocr_result,
    ):
        return _compose_dashboard_kpi_strict_answer(
            incident_details=incident_details,
            ocr_result=ocr_result,
            decision_engine_result=decision_engine_result,
        )

    max_risk_scores = incident_details.max_risk_scores or (
        [incident_details.risk_score] if incident_details.risk_score else []
    )
    visible_department = _resolve_incident_visible_department(
        incident_details=incident_details,
        ocr_result=ocr_result,
    )
    alert_label = (
        "ce dashboard de risque FleetConnect AI"
        if display_image_type == "dashboard"
        else
        "cette page d'alertes FleetConnect AI"
        if incident_details.alert_type in {"alert_dashboard", "alerte", "fraude", "anomalie"}
        else "ce log telecom"
        if incident_details.alert_type == "log"
        else "cette capture d'alerte telecom"
    )
    summary_parts = _clean_business_items(
        [
            (
                f"Le dashboard affiche {incident_details.critical_alert_count} alertes critiques actives"
                if incident_details.critical_alert_count is not None
                else ""
            ),
            (
                f"le taux d'exposition atteint {incident_details.exposure_rate}"
                if incident_details.exposure_rate
                else ""
            ),
            (
                f"l'impact financier potentiel atteint {incident_details.financial_impact_mad}"
                if incident_details.financial_impact_mad
                else ""
            ),
            (
                f"le score moyen visible est de {incident_details.average_score}"
                if incident_details.average_score
                else ""
            ),
            (
                f"{incident_details.contract_exposed} restent exposes sur le dashboard"
                if incident_details.contract_exposed
                else ""
            ),
            (
                f"le departement {visible_department} apparait comme le plus expose"
                if visible_department
                else ""
            ),
            (
                "plusieurs utilisateurs presentent un score de risque maximal de 100/100"
                if (len(incident_details.risky_entities) >= 2 or len(max_risk_scores) >= 2)
                and "100/100" in max_risk_scores
                else "un utilisateur presente un score de risque maximal de 100/100"
                if "100/100" in max_risk_scores
                else ""
            ),
        ],
        5,
    )
    risk_level = _resolve_business_risk_level(
        initial_risk_level=decision_engine_result.risk_level,
        image_type=incident_details.alert_type or "alerte",
        ocr_result=ocr_result,
        decision_engine_result=decision_engine_result,
    )
    resolved_priority = _resolve_business_priority(
        initial_priority=incident_details.priority,
        resolved_risk_level=risk_level,
        image_type=incident_details.alert_type or "alerte",
        ocr_result=ocr_result,
        decision_engine_result=decision_engine_result,
    )
    risk_label = _format_risk_level_label(risk_level).lower()
    summary_line = (
        (
            f"L'analyse de {alert_label} revele une situation de risque business {risk_label}."
            if display_image_type == "dashboard"
            else f"L'analyse de {alert_label} revele une situation de risque operationnel {risk_label}."
        )
    )
    if summary_parts:
        summary_line += " " + ", ".join(summary_parts[:-1]) + (
            (" et " + summary_parts[-1]) if len(summary_parts) > 1 else summary_parts[0]
        ) + "."
    lead_line = (
        f"L'impact financier potentiel est de {incident_details.financial_impact_mad}."
        if incident_details.financial_impact_mad
        else f"L'exposition portefeuille est de {incident_details.revenue_at_risk_mad}."
        if incident_details.revenue_at_risk_mad
        else summary_line
    )
    rationale_line = _clean_business_items(
        [
            (
                f"{incident_details.critical_alert_count} alertes critiques"
                if incident_details.critical_alert_count is not None
                else ""
            ),
            (
                f"un taux d'exposition de {incident_details.exposure_rate}"
                if incident_details.exposure_rate
                else ""
            ),
            (
                "plusieurs profils avec un score de risque de 100/100"
                if (len(incident_details.risky_entities) >= 2 or len(max_risk_scores) >= 2)
                and "100/100" in max_risk_scores
                else "un profil avec un score de risque de 100/100"
                if "100/100" in max_risk_scores
                else ""
            ),
        ],
        4,
    )
    criticality_line = (
        "Ce montant est critique car il est associe a "
        + ", ".join(rationale_line[:-1])
        + (" et " + rationale_line[-1] if len(rationale_line) > 1 else rationale_line[0])
        + "."
        if incident_details.financial_impact_mad and rationale_line
        else summary_line
    )

    points_critiques = _clean_business_items(
        [
            (
                f"Exposition portefeuille a {incident_details.revenue_at_risk_mad}"
                if incident_details.revenue_at_risk_mad
                else ""
            ),
            (
                f"Impact estime a {incident_details.estimated_impact_mad}"
                if incident_details.estimated_impact_mad
                else ""
            ),
            (
                f"Risque fraude a {incident_details.fraud_score_visible}"
                if incident_details.fraud_score_visible
                else ""
            ),
            (
                f"Risque anomalie a {incident_details.anomaly_score_visible}"
                if incident_details.anomaly_score_visible
                else ""
            ),
            (
                f"Risque optimisation a {incident_details.optimization_score_visible}"
                if incident_details.optimization_score_visible
                else ""
            ),
            (
                f"Risque cout a {incident_details.cost_score_visible}"
                if incident_details.cost_score_visible
                else ""
            ),
            (
                f"Contrat expose: {incident_details.contract_exposed}"
                if incident_details.contract_exposed
                else ""
            ),
            (
                f"Departement le plus expose: {visible_department}"
                if visible_department
                else ""
            ),
            *incident_details.critical_signals[:4],
            *incident_details.repeated_anomalies[:2],
            *incident_details.visible_statuses[:2],
        ],
        8,
    )
    priority_actions = _clean_business_items(
        [recommendation.title for recommendation in decision_engine_result.recommendations[:5]],
        5,
    )
    recommendation_lines = _clean_business_items(
        [
        recommendation.reason
        for recommendation in decision_engine_result.recommendations[:5]
        if recommendation.reason
        ],
        5,
    )
    probable_causes = _clean_business_items(incident_details.probable_causes[:4], 4)
    business_risks = _clean_business_items(
        [
            (
                f"Une exposition portefeuille de {incident_details.revenue_at_risk_mad} place deja le budget telecom sous tension."
                if incident_details.revenue_at_risk_mad
                else ""
            ),
            (
                f"Un impact estime de {incident_details.estimated_impact_mad} montre qu'une partie materielle du revenu ou des couts reste exposee."
                if incident_details.estimated_impact_mad
                else ""
            ),
            (
                f"Le volume de {incident_details.critical_alert_count} alertes critiques peut saturer la supervision et retarder le traitement des cas prioritaires."
                if incident_details.critical_alert_count is not None
                else ""
            ),
            (
                f"Un taux d'exposition de {incident_details.exposure_rate} indique qu'une part significative du portefeuille reste sous tension."
                if incident_details.exposure_rate
                else ""
            ),
            (
                f"Le risque fraude a {incident_details.fraud_score_visible} augmente la probabilite d'usages suspects ou de fraude CDR."
                if incident_details.fraud_score_visible
                else ""
            ),
            (
                f"Le risque anomalie a {incident_details.anomaly_score_visible} signale des comportements repetitifs a auditer rapidement."
                if incident_details.anomaly_score_visible
                else ""
            ),
            (
                f"Le risque cout a {incident_details.cost_score_visible} confirme une pression budgetaire deja elevee."
                if incident_details.cost_score_visible
                else ""
            ),
            (
                "Plusieurs profils atteignent 100/100, ce qui traduit un niveau de risque maximal sur des lignes deja exposees."
                if "100/100" in max_risk_scores
                else ""
            ),
        ],
        5,
    )
    impact_lines = _clean_business_items(
        [
            (
                f"- Exposition portefeuille: {incident_details.revenue_at_risk_mad}."
                if incident_details.revenue_at_risk_mad
                else ""
            ),
            (
                f"- Impact financier potentiel: {incident_details.financial_impact_mad}."
                if incident_details.financial_impact_mad
                else ""
            ),
            (
                f"- Impact estime: {incident_details.estimated_impact_mad}."
                if incident_details.estimated_impact_mad
                else ""
            ),
            (
                f"- Taux d'exposition: {incident_details.exposure_rate}."
                if incident_details.exposure_rate
                else ""
            ),
            (
                f"- Taux de churn: {incident_details.churn_rate}."
                if incident_details.churn_rate
                else ""
            ),
            (
                f"- Clients ou lignes a risque: {incident_details.at_risk_clients_count}."
                if incident_details.at_risk_clients_count is not None
                else ""
            ),
            (
                f"- Base sous contrat exposee: {incident_details.contract_exposed}."
                if incident_details.contract_exposed
                else ""
            ),
            (
                f"- Score moyen de risque: {incident_details.average_score}."
                if incident_details.average_score
                else ""
            ),
            (
                f"- Risque fraude: {incident_details.fraud_score_visible}."
                if incident_details.fraud_score_visible
                else ""
            ),
            (
                f"- Risque anomalie: {incident_details.anomaly_score_visible}."
                if incident_details.anomaly_score_visible
                else ""
            ),
            (
                f"- Risque cout: {incident_details.cost_score_visible}."
                if incident_details.cost_score_visible
                else ""
            ),
            (
                f"- Utilisateurs ou lignes a risque: {', '.join(incident_details.risky_entities[:3])}."
                if incident_details.risky_entities
                else ""
            ),
            (
                f"- Departement le plus expose: {visible_department}."
                if visible_department
                else ""
            ),
        ],
        8,
    )
    if not priority_actions:
        priority_actions = _clean_business_items(
            [
                (
                    "Auditer les profils avec score 100/100"
                    if "100/100" in max_risk_scores
                    else ""
                ),
                (
                    "Auditer les lignes a plus fort impact financier"
                    if incident_details.financial_impact_mad or incident_details.revenue_at_risk_mad
                    else ""
                ),
                (
                    "Traiter en premier les alertes critiques visibles"
                    if incident_details.critical_alert_count is not None
                    else ""
                ),
                (
                    "Renforcer la surveillance sur les usages suspects visibles"
                    if incident_details.fraud_score_visible or incident_details.anomaly_score_visible
                    else ""
                ),
                (
                    f"Auditer en priorite le departement {visible_department}"
                    if visible_department
                    else ""
                ),
            ],
            4,
        )
    if not recommendation_lines:
        recommendation_lines = _clean_business_items(
            [
                (
                    f"Le portefeuille visible deja expose ({incident_details.revenue_at_risk_mad}) justifie un audit prioritaire des lignes les plus sensibles."
                    if incident_details.revenue_at_risk_mad
                    else ""
                ),
                (
                    f"L'impact estime visible ({incident_details.estimated_impact_mad}) doit etre securise avant toute derive supplementaire."
                    if incident_details.estimated_impact_mad
                    else ""
                ),
                (
                    f"Les scores fraude et anomalie visibles ({incident_details.fraud_score_visible} / {incident_details.anomaly_score_visible}) imposent un controle renforce."
                    if incident_details.fraud_score_visible and incident_details.anomaly_score_visible
                    else ""
                ),
            ],
            4,
        )

    lines = [
        "Resume executif",
        lead_line,
        "",
        summary_line,
        "",
        "Impact financier estime",
        *(
            impact_lines
            or ["- Les KPI visibles montrent une exposition financiere et operationnelle a traiter sans delai."]
        ),
        "",
        "KPI critiques detectes",
        *(
            [f"- {item}" for item in points_critiques]
            or ["- Les KPI visibles imposent une priorisation immediate des lignes et alertes les plus exposees."]
        ),
        "",
        "Risques metier",
        *(
            [f"- {item}" for item in business_risks]
            or ["- Les KPI visibles montrent un risque budgetaire et operationnel deja materialise."]
        ),
        "",
        "Causes probables",
        *(
            [f"- {item}" for item in probable_causes]
            or ["- Les indicateurs consolides suggerent deja une concentration d'alertes et de profils a traiter en priorite."]
        ),
        "",
        "Niveau de criticite",
        f"- Criticite globale: {_format_risk_level_label(risk_level)}",
        f"- Priorite immediate: {_format_priority_display(resolved_priority)}",
        "",
        "Actions immediates recommandees",
        *(
            [f"{index}. {item}" for index, item in enumerate(priority_actions, start=1)]
            or ["1. Consolider les alertes visibles puis prioriser les lignes les plus exposees."]
        ),
        "",
        "Recommandations IA",
        *(
            [f"- {item}" for item in recommendation_lines]
            or ["- Renforcer la supervision sur les alertes visibles avant escalation."]
        ),
        "",
        *_build_score_ia_section(
            image_type=incident_details.alert_type or "alerte",
            ocr_result=ocr_result,
            decision_engine_result=decision_engine_result,
            resolved_risk_level=risk_level,
        ),
        "",
        "Synthese de criticite",
        criticality_line,
    ]
    return _polish_business_answer(
        answer="\n".join(item for item in lines if item),
        image_type=incident_details.alert_type or "alerte",
        ocr_result=ocr_result,
        decision_engine_result=decision_engine_result,
    )


def _compose_equipment_consultant_answer(
    *,
    question: str,
    parsed_answer: FinalImageAnswer,
    ocr_result: OcrExtractionResult,
    vision_result: VisionAnalysisResult,
    decision_engine_result: RecommendationEngineResult,
    routing_mode: str,
) -> str:
    equipment_details = ocr_result.equipment_details
    inventory = _build_visual_equipment_inventory(
        question=question,
        ocr_result=ocr_result,
        vision_result=vision_result,
    )
    router_only_inventory = _inventory_is_strict_router_visible_only(inventory)
    issues = equipment_details.detected_issues if equipment_details is not None else []
    replacement_signals = vision_result.replacement_signals
    recommendations = _dedupe_items(
        [
            *(equipment_details.maintenance_recommendations if equipment_details is not None else []),
            *parsed_answer.recommendations,
            *(recommendation.title for recommendation in decision_engine_result.recommendations[:3]),
        ],
        5,
    )
    if routing_mode == EQUIPMENT_ROUTING_MODE_VISION_ONLY:
        recommendations = _dedupe_items(
            [
                *(equipment_details.maintenance_recommendations if equipment_details is not None else []),
                *parsed_answer.recommendations,
            ],
            5,
        )
    recommendations = _filter_equipment_recommendations_for_visual_evidence(
        recommendations,
        issues=issues,
        replacement_signals=replacement_signals,
    )
    if router_only_inventory:
        recommendations = _filter_router_only_non_visible_entries(recommendations)
    answer = _build_equipment_visual_report_answer(
        question=question,
        ocr_result=ocr_result,
        vision_result=vision_result,
        equipment_details=equipment_details,
        recommendations=recommendations or ["Confirmer la reference exacte avant arbitrage technique."],
    )
    if routing_mode == EQUIPMENT_ROUTING_MODE_FUSION:
        fusion_points = _dedupe_items(
            [
                *parsed_answer.detected_kpis,
                *(recommendation.reason for recommendation in decision_engine_result.recommendations[:2]),
            ],
            3,
        )
        if fusion_points:
            answer = "\n\n".join(
                [
                    answer,
                    "Croisement metier\n" + "\n".join(f"- {item}" for item in fusion_points),
                ]
            )
    return _polish_business_answer(
        answer=answer,
        image_type="equipement",
        ocr_result=ocr_result,
        decision_engine_result=decision_engine_result,
    )


def _compose_consultant_image_answer(
    *,
    question: str,
    image_type: str,
    parsed_answer: FinalImageAnswer,
    ocr_result: OcrExtractionResult,
    vision_result: VisionAnalysisResult,
    decision_engine_result: RecommendationEngineResult,
    routing_mode: str = "standard",
) -> str:
    if image_type == "facture" and ocr_result.invoice_details is not None:
        return _compose_invoice_consultant_answer(
            invoice_details=ocr_result.invoice_details,
            ocr_result=ocr_result,
            decision_engine_result=decision_engine_result,
        )
    if image_type == "equipement" and ocr_result.equipment_details is not None:
        return _compose_equipment_consultant_answer(
            question=question,
            parsed_answer=parsed_answer,
            ocr_result=ocr_result,
            vision_result=vision_result,
            decision_engine_result=decision_engine_result,
            routing_mode=routing_mode,
        )
    if _dashboard_should_use_incident_narrative(
        image_type=image_type,
        ocr_result=ocr_result,
    ):
        return _compose_alert_consultant_answer(
            incident_details=ocr_result.incident_details,
            ocr_result=ocr_result,
            decision_engine_result=decision_engine_result,
            display_image_type=image_type,
        )

    risk_level = _resolve_business_risk_level(
        initial_risk_level=decision_engine_result.risk_level,
        image_type=image_type,
        ocr_result=ocr_result,
        decision_engine_result=decision_engine_result,
        parsed_severity=parsed_answer.severity,
    )
    resolved_priority = _resolve_business_priority(
        initial_priority=parsed_answer.treatment_priority,
        resolved_risk_level=risk_level,
        image_type=image_type,
        ocr_result=ocr_result,
        decision_engine_result=decision_engine_result,
    )

    summary = _build_consultant_summary(
        image_type=image_type,
        ocr_result=ocr_result,
        vision_result=vision_result,
    )
    key_findings = _build_key_findings(
        image_type=image_type,
        parsed_answer=parsed_answer,
        ocr_result=ocr_result,
        vision_result=vision_result,
    )
    probable_causes = _build_default_probable_causes(
        image_type=image_type,
        parsed_answer=parsed_answer,
        ocr_result=ocr_result,
        decision_engine_result=decision_engine_result,
    )
    priority_actions = _build_priority_actions(
        parsed_answer=parsed_answer,
        decision_engine_result=decision_engine_result,
    )
    recommendation_lines = _build_recommendation_lines(
        parsed_answer=parsed_answer,
        decision_engine_result=decision_engine_result,
    )
    impact_potential = _build_impact_potential(
        image_type=image_type,
        risk_level=risk_level,
        decision_engine_result=decision_engine_result,
    )

    sections = [
        "Resume executif",
        summary,
        "",
        "Impact financier estime",
        f"- Niveau d'impact financier: {_derive_financial_impact_level(image_type=image_type, ocr_result=ocr_result, decision_engine_result=decision_engine_result)}.",
        f"- {impact_potential}",
        "",
        "KPI critiques detectes",
        *([f"- {item}" for item in key_findings] or ["- Les indicateurs les plus visibles appellent une priorisation ciblee."]),
        "",
        "Risques metier",
        *(
            [f"- {item}" for item in _clean_business_items([impact_potential, *probable_causes[:2]], 3)]
            or ["- Les ecarts visibles peuvent ralentir le pilotage et accroitre le risque budgetaire."]
        ),
        "",
        "Causes probables",
        *([f"- {item}" for item in probable_causes] or ["- Les ecarts visibles renvoient a une supervision ou une priorisation a recalibrer."]),
        "",
        "Niveau de criticite",
        f"- Criticite globale: {_format_risk_level_label(risk_level)}",
        f"- Priorite immediate: {_format_priority_display(resolved_priority)}",
        "",
        "Actions immediates recommandees",
        *(
            [f"{index}. {item}" for index, item in enumerate(priority_actions, start=1)]
            or ["1. Prioriser les indicateurs critiques avant toute decision structurante."]
        ),
        "",
        "Recommandations IA",
        *(
            [f"- {item}" for item in recommendation_lines]
            or ["- Poursuivre la verification sur les zones les plus exposees."]
        ),
        "",
        *_build_score_ia_section(
            image_type=image_type,
            ocr_result=ocr_result,
            decision_engine_result=decision_engine_result,
            resolved_risk_level=risk_level,
        ),
    ]
    return _polish_business_answer(
        answer="\n".join(section for section in sections if section),
        image_type=image_type,
        ocr_result=ocr_result,
        decision_engine_result=decision_engine_result,
    )


def _build_strict_visible_kpi_fallback_answer(
    *,
    image_type: str,
    ocr_result: OcrExtractionResult,
    vision_result: VisionAnalysisResult,
    decision_engine_result: RecommendationEngineResult,
) -> str:
    visible_kpis = _collect_visible_pipeline_kpis(ocr_result, vision_result)
    if _dashboard_has_strict_kpi_mode(
        image_type=image_type,
        ocr_result=ocr_result,
    ) and ocr_result.incident_details is not None:
        return _compose_dashboard_kpi_strict_answer(
            incident_details=ocr_result.incident_details,
            ocr_result=ocr_result,
            decision_engine_result=decision_engine_result,
        )
    if _dashboard_should_use_incident_narrative(
        image_type=image_type,
        ocr_result=ocr_result,
    ):
        incident = ocr_result.incident_details
        visible_department = next((item for item in ocr_result.departments if item), None)
        risk_level = _resolve_business_risk_level(
            initial_risk_level=decision_engine_result.risk_level,
            image_type=incident.alert_type or "alerte",
            ocr_result=ocr_result,
            decision_engine_result=decision_engine_result,
        )
        resolved_priority = _resolve_business_priority(
            initial_priority=incident.priority,
            resolved_risk_level=risk_level,
            image_type=incident.alert_type or "alerte",
            ocr_result=ocr_result,
            decision_engine_result=decision_engine_result,
        )
        priority_actions = _clean_business_items(
            [recommendation.title for recommendation in decision_engine_result.recommendations[:4]],
            4,
        )
        lines = [
            "Resume executif",
            (
                f"L'impact financier potentiel visible est de {incident.financial_impact_mad}."
                if incident.financial_impact_mad
                else f"L'exposition portefeuille visible est de {incident.revenue_at_risk_mad}."
                if incident.revenue_at_risk_mad
                else f"{incident.critical_alert_count} alertes critiques sont visibles."
                if incident.critical_alert_count is not None
                else f"Le KPI visible le plus structurant est {visible_kpis[0]}."
                if visible_kpis
                else "Les indicateurs visibles appellent une priorisation immediate."
            ),
            "",
            "KPI critiques detectes",
            *(
                [
                    f"- {item}"
                    for item in _clean_business_items(
                        [
                            (
                                f"Exposition portefeuille {incident.revenue_at_risk_mad}"
                                if incident.revenue_at_risk_mad
                                else ""
                            ),
                            (
                                f"Impact estime {incident.estimated_impact_mad}"
                                if incident.estimated_impact_mad
                                else ""
                            ),
                            (
                                f"{incident.critical_alert_count} alertes critiques"
                                if incident.critical_alert_count is not None
                                else ""
                            ),
                            (
                                f"{incident.at_risk_clients_count} clients ou lignes a risque"
                                if incident.at_risk_clients_count is not None
                                else ""
                            ),
                            (
                                incident.contract_exposed
                                if incident.contract_exposed
                                else ""
                            ),
                            (
                                f"Taux d'exposition {incident.exposure_rate}"
                                if incident.exposure_rate
                                else ""
                            ),
                            (
                                f"Taux de churn {incident.churn_rate}"
                                if incident.churn_rate
                                else ""
                            ),
                            (
                                f"Risque fraude {incident.fraud_score_visible}"
                                if incident.fraud_score_visible
                                else ""
                            ),
                            (
                                f"Risque anomalie {incident.anomaly_score_visible}"
                                if incident.anomaly_score_visible
                                else ""
                            ),
                            (
                                f"Risque cout {incident.cost_score_visible}"
                                if incident.cost_score_visible
                                else ""
                            ),
                            (
                                f"Departement le plus expose {visible_department}"
                                if visible_department
                                else ""
                            ),
                            *incident.max_risk_scores[:2],
                        ],
                        6,
                    )
                ]
                or [f"- {visible_kpis[0]}"]
            ),
            "",
            "Niveau de criticite",
            f"- Criticite globale: {_format_risk_level_label(risk_level)}",
            f"- Priorite immediate: {_format_priority_display(resolved_priority)}",
            "",
            "Actions immediates recommandees",
            *(
                [f"{index}. {item}" for index, item in enumerate(priority_actions, start=1)]
                or ["1. Auditer en premier les profils et lignes les plus exposes."]
            ),
            "",
            *_build_score_ia_section(
                image_type=incident.alert_type or "alerte",
                ocr_result=ocr_result,
                decision_engine_result=decision_engine_result,
                resolved_risk_level=risk_level,
            ),
        ]
        return _polish_business_answer(
            answer="\n".join(item for item in lines if item),
            image_type=incident.alert_type or "alerte",
            ocr_result=ocr_result,
            decision_engine_result=decision_engine_result,
        )

    if image_type == "facture" and ocr_result.invoice_details is not None:
        invoice = ocr_result.invoice_details
        total_amount = invoice.total_amount_mad or invoice.amount_ttc_mad
        top_items = _clean_business_items(
            [
                (
                    f"{item.label}: {item.amount_mad}"
                    + (
                        f" ({_format_share_pct(item.share_of_total_pct)} du total TTC)"
                        if item.share_of_total_pct is not None
                        else ""
                    )
                )
                for item in invoice.cost_items[:3]
            ],
            3,
        )
        return "\n".join(
            item
            for item in [
                "Resume executif",
                (
                    f"Le montant total visible sur la facture est de {total_amount}."
                    if total_amount
                    else f"Le poste visible le plus structurant est {visible_kpis[0]}."
                    if visible_kpis
                    else "La facture appelle une revue des postes visibles."
                ),
                "",
                "KPI critiques detectes",
                *([f"- {item}" for item in top_items] or [f"- {visible_kpis[0]}"] if visible_kpis else []),
            ]
            if item
        )

    return (
        f"Le KPI visible le plus structurant est {visible_kpis[0]}."
        if visible_kpis
        else "Les indicateurs visibles permettent deja une priorisation metier exploitable."
    )


def _postprocess_consultant_answer_strict(
    *,
    image_type: str,
    answer: str,
    ocr_result: OcrExtractionResult,
    vision_result: VisionAnalysisResult,
    decision_engine_result: RecommendationEngineResult,
) -> tuple[str, list[str]]:
    extracted_values = _build_strict_extracted_values(
        ocr_result=ocr_result,
        vision_result=vision_result,
    )
    visible_kpis = _collect_visible_pipeline_kpis(ocr_result, vision_result)
    filtered_answer, removed_claims = filter_unverified_claims(answer, extracted_values)
    if _dashboard_should_use_incident_narrative(
        image_type=image_type,
        ocr_result=ocr_result,
    ) and not _answer_mentions_incident_kpis(
        answer=filtered_answer,
        ocr_result=ocr_result,
    ):
        MULTIMODAL_LOGGER.info(
            "GENERIC FALLBACK BLOCKED image_type=%s reason=missing_incident_kpis",
            image_type,
        )
        if filtered_answer.strip():
            removed_claims.append(filtered_answer.strip())
        filtered_answer = _build_strict_visible_kpi_fallback_answer(
            image_type=image_type,
            ocr_result=ocr_result,
            vision_result=vision_result,
            decision_engine_result=decision_engine_result,
        )
    if len(visible_kpis) >= VISIBLE_KPI_STRICT_THRESHOLD and (
        not filtered_answer.strip() or _is_generic_multimodal_answer(filtered_answer)
    ):
        MULTIMODAL_LOGGER.info(
            "GENERIC FALLBACK BLOCKED image_type=%s reason=generic_answer_detected visible_kpis=%s",
            image_type,
            len(visible_kpis),
        )
        if filtered_answer.strip():
            removed_claims.append(filtered_answer.strip())
        filtered_answer = _build_strict_visible_kpi_fallback_answer(
            image_type=image_type,
            ocr_result=ocr_result,
            vision_result=vision_result,
            decision_engine_result=decision_engine_result,
        )
    elif not filtered_answer.strip():
        filtered_answer = "Les indicateurs visibles permettent deja une priorisation metier exploitable."
    return filtered_answer, _dedupe_items(removed_claims, 16)


def _infer_image_type(
    question: str,
    ocr_result: OcrExtractionResult,
    vision_result: VisionAnalysisResult,
) -> str:
    if ocr_result.invoice_details is not None:
        return "facture"
    if ocr_result.workflow_details is not None:
        return "workflow"
    if ocr_result.equipment_details is not None:
        return "equipement"

    candidates = [
        vision_result.image_type,
        question,
        ocr_result.text,
        vision_result.analysis,
    ]
    combined_text = " \n ".join(candidates).lower()

    if ocr_result.incident_details is not None and ocr_result.incident_details.alert_type:
        incident = ocr_result.incident_details
        is_generic_dashboard_signal = (
            incident.alert_type in {"alerte", "anomalie"}
            and any(keyword in combined_text for keyword in ["dashboard", "kpi", "tableau de bord"])
            and incident.critical_alert_count is None
            and not incident.exposure_rate
            and not incident.financial_impact_mad
            and not incident.risk_score
            and not incident.line_reference
            and not incident.error_message
            and not incident.data_overage
        )
        if not is_generic_dashboard_signal:
            return incident.alert_type

    if any(keyword in combined_text for keyword in ["facture", "invoice", "montant total", "tva"]):
        return "facture"
    if any(keyword in combined_text for keyword in ["dashboard", "kpi", "tableau de bord"]):
        return "dashboard"
    if any(keyword in combined_text for keyword in ["graphique", "courbe", "histogramme", "graphe"]):
        return "graphe"
    if any(keyword in combined_text for keyword in ["fraude", "fraud", "simbox"]):
        return "fraude"
    if any(keyword in combined_text for keyword in ["appel suspect", "calls suspect", "numero suspect", "premium"]):
        return "appel_suspect"
    if any(keyword in combined_text for keyword in ["depassement quota", "hors forfait", "surconsommation", "data overage"]):
        return "depassement_quota"
    if any(keyword in combined_text for keyword in ["error", "erreur", "exception", "traceback", "stack trace"]):
        return "erreur_systeme"
    if any(keyword in combined_text for keyword in ["syslog", "journal", "log", "trace"]):
        return "log"
    if any(keyword in combined_text for keyword in ["alerte", "critique", "warning"]):
        return "alerte"
    if any(keyword in combined_text for keyword in ["anomalie", "fraude", "suspect"]):
        return "anomalie"
    if any(
        keyword in combined_text
        for keyword in [
            "smartphone",
            "telephone",
            "iphone",
            "galaxy",
            "routeur",
            "router",
            "modem",
            "sim",
            "iccid",
            "switch",
            "wifi",
            "borne wifi",
            "antenne",
            "battery",
            "batterie",
            "equipment",
            "equipement",
            "materiel",
            "appareil",
            "ordinateur",
            "pc",
            "laptop",
            "imprimante",
            "serveur",
            "server",
            "vehicule",
            "vehicle",
            "machine",
            "infrastructure",
            "cle 4g",
            "dongle",
        ]
    ):
        return "equipement"
    if ocr_result.visible_tables:
        return "tableau"
    if vision_result.image_type:
        return vision_result.image_type
    return "capture_interface"


def _build_history_block(history: list[ChatContextMessage]) -> str:
    if not history:
        return "Aucun historique utile."

    return "\n".join(
        f"- {message.role}: {_truncate(message.text, 220)}"
        for message in history[-8:]
    )


def _build_ocr_block(ocr_result: OcrExtractionResult) -> str:
    lines: list[str] = []
    if ocr_result.text:
        lines.append(f"Texte visible:\n{_limit_text(ocr_result.text, 2500)}")
    if ocr_result.amounts_mad:
        lines.append(f"Montants detectes: {', '.join(ocr_result.amounts_mad[:8])}")
    if ocr_result.operators:
        lines.append(f"Operateurs detectes: {', '.join(ocr_result.operators)}")
    if ocr_result.departments:
        lines.append(f"Departements detectes: {', '.join(ocr_result.departments)}")
    if ocr_result.alerts:
        lines.append("Alertes visibles:\n" + "\n".join(f"- {item}" for item in ocr_result.alerts[:6]))
    if ocr_result.visible_tables:
        lines.append("Lignes de tableau visibles:\n" + "\n".join(f"- {item}" for item in ocr_result.visible_tables[:6]))
    if ocr_result.invoice_details is not None:
        invoice = ocr_result.invoice_details
        lines.append(
            "Champs facture detectes:\n"
            + "\n".join(
                item
                for item in [
                    f"- Operateur: {invoice.operator}" if invoice.operator else "",
                    f"- Numero facture: {invoice.invoice_number}" if invoice.invoice_number else "",
                    f"- Date: {invoice.invoice_date}" if invoice.invoice_date else "",
                    f"- Periode: {invoice.billing_period}" if invoice.billing_period else "",
                    f"- Montant HT: {invoice.amount_ht_mad}" if invoice.amount_ht_mad else "",
                    f"- TVA: {invoice.vat_amount_mad}" if invoice.vat_amount_mad else "",
                    f"- Montant TTC: {invoice.amount_ttc_mad}" if invoice.amount_ttc_mad else "",
                    f"- Total: {invoice.total_amount_mad}" if invoice.total_amount_mad else "",
                ]
                if item
            )
        )
    if ocr_result.incident_details is not None:
        incident = ocr_result.incident_details
        lines.append(
            "Champs alerte/log detectes:\n"
            + "\n".join(
                item
                for item in [
                    (
                        f"- Type alerte: {_format_image_type_label(incident.alert_type)}"
                        if incident.alert_type
                        else ""
                    ),
                    f"- Gravite: {incident.severity}" if incident.severity else "",
                    f"- Date/heure: {incident.detected_at}" if incident.detected_at else "",
                    f"- Operateur: {incident.operator}" if incident.operator else "",
                    f"- Ligne: {incident.line_reference}" if incident.line_reference else "",
                    f"- Cout suspect: {incident.suspect_cost_mad}" if incident.suspect_cost_mad else "",
                    f"- Volume appels: {incident.call_volume}" if incident.call_volume else "",
                    f"- Depassement data: {incident.data_overage}" if incident.data_overage else "",
                    (
                        f"- Alertes critiques visibles: {incident.critical_alert_count}"
                        if incident.critical_alert_count is not None
                        else ""
                    ),
                    (
                        f"- Clients a risque visibles: {incident.at_risk_clients_count}"
                        if incident.at_risk_clients_count is not None
                        else ""
                    ),
                    f"- Taux d'exposition: {incident.exposure_rate}" if incident.exposure_rate else "",
                    f"- Taux de churn: {incident.churn_rate}" if incident.churn_rate else "",
                    (
                        f"- Revenu a risque: {incident.revenue_at_risk_mad}"
                        if incident.revenue_at_risk_mad
                        else ""
                    ),
                    (
                        f"- Impact financier: {incident.financial_impact_mad}"
                        if incident.financial_impact_mad
                        else ""
                    ),
                    (
                        f"- Impact estime: {incident.estimated_impact_mad}"
                        if incident.estimated_impact_mad
                        else ""
                    ),
                    f"- ROI estime: {incident.roi_estimated}" if incident.roi_estimated else "",
                    (
                        f"- Actions prioritaires visibles: {incident.priority_actions_count}"
                        if incident.priority_actions_count is not None
                        else ""
                    ),
                    f"- Score moyen visible: {incident.average_score}" if incident.average_score else "",
                    (
                        f"- Risque fraude: {incident.fraud_score_visible}"
                        if incident.fraud_score_visible
                        else ""
                    ),
                    (
                        f"- Risque anomalie: {incident.anomaly_score_visible}"
                        if incident.anomaly_score_visible
                        else ""
                    ),
                    (
                        f"- Risque optimisation: {incident.optimization_score_visible}"
                        if incident.optimization_score_visible
                        else ""
                    ),
                    (
                        f"- Risque cout: {incident.cost_score_visible}"
                        if incident.cost_score_visible
                        else ""
                    ),
                    f"- Score de risque visible: {incident.risk_score}" if incident.risk_score else "",
                    f"- Erreur visible: {incident.error_message}" if incident.error_message else "",
                    f"- Priorite: {incident.priority}" if incident.priority else "",
                    f"- Resume documentaire: {incident.summary}" if incident.summary else "",
                ]
                if item
            )
        )
        if incident.critical_signals:
            lines.append(
                "Signaux critiques visibles:\n"
                + "\n".join(f"- {item}" for item in incident.critical_signals[:6])
            )
        if incident.max_risk_scores:
            lines.append(
                "Scores maximaux visibles:\n"
                + "\n".join(f"- {item}" for item in incident.max_risk_scores[:6])
            )
        if incident.risky_entities:
            lines.append(
                "Utilisateurs ou lignes a risque:\n"
                + "\n".join(f"- {item}" for item in incident.risky_entities[:6])
            )
        if incident.probable_causes:
            lines.append(
                "Causes probables visibles:\n"
                + "\n".join(f"- {item}" for item in incident.probable_causes[:6])
            )
    if ocr_result.workflow_details is not None:
        workflow = ocr_result.workflow_details
        lines.append(
            "Champs workflow detectes:\n"
            + "\n".join(
                item
                for item in [
                    (
                        f"- Type workflow: {_format_image_type_label(workflow.workflow_type)}"
                        if workflow.workflow_type
                        else ""
                    ),
                    f"- Complexite: {workflow.complexity_score}/100" if workflow.complexity_score else "",
                    f"- Niveau: {workflow.complexity_level}" if workflow.complexity_level else "",
                    (
                        f"- Departements: {', '.join(workflow.departments[:4])}"
                        if workflow.departments
                        else ""
                    ),
                    (
                        f"- Roles: {', '.join(workflow.roles[:4])}"
                        if workflow.roles
                        else ""
                    ),
                    f"- Resume documentaire: {workflow.summary}" if workflow.summary else "",
                ]
                if item
            )
        )
        if workflow.critical_steps:
            lines.append(
                "Etapes critiques reperees:\n"
                + "\n".join(f"- {item}" for item in workflow.critical_steps[:6])
            )
        if workflow.automation_opportunities:
            lines.append(
                "Opportunites d'automatisation reperees:\n"
                + "\n".join(f"- {item}" for item in workflow.automation_opportunities[:4])
            )
    if ocr_result.equipment_details is not None:
        equipment = ocr_result.equipment_details
        lines.append(
            "Champs equipement detectes:\n"
            + "\n".join(
                item
                for item in [
                    (
                        f"- Type equipement: {_format_image_type_label(equipment.equipment_type)}"
                        if equipment.equipment_type
                        else ""
                    ),
                    f"- Marque: {equipment.brand}" if equipment.brand else "",
                    (
                        f"- Modele: {equipment.model}"
                        if equipment.model
                        else "- Modele: Equipement non identifie avec certitude"
                    ),
                    f"- Numero serie: {equipment.serial_number}" if equipment.serial_number else "",
                    f"- Etat visible: {equipment.visible_condition}" if equipment.visible_condition else "",
                    f"- Score etat: {equipment.condition_score}/100",
                    f"- Score criticite: {equipment.criticality_score}/100",
                    f"- Score obsolescence: {equipment.obsolescence_score}/100",
                    f"- Score maintenance: {equipment.maintenance_score}/100",
                    f"- Resume documentaire: {equipment.summary}" if equipment.summary else "",
                ]
                if item
            )
        )
        if equipment.detected_issues:
            lines.append(
                "Anomalies equipement reperees:\n"
                + "\n".join(f"- {item}" for item in equipment.detected_issues[:5])
            )
    return "\n\n".join(lines) if lines else "Aucun texte OCR consolide n'a pu etre stabilise."


def _extract_json_payload(raw_answer: str) -> dict[str, object] | None:
    cleaned_answer = raw_answer.strip()
    if not cleaned_answer:
        return None

    fenced_match = re.search(r"```(?:json)?\s*(\{.*\})\s*```", cleaned_answer, flags=re.DOTALL)
    candidate = fenced_match.group(1) if fenced_match else cleaned_answer
    start_index = candidate.find("{")
    end_index = candidate.rfind("}")
    if start_index < 0 or end_index <= start_index:
        return None

    try:
        payload = json.loads(candidate[start_index : end_index + 1])
    except json.JSONDecodeError:
        return None

    return payload if isinstance(payload, dict) else None


def _is_generic_multimodal_answer(answer: str) -> bool:
    normalized_answer = _normalize_invoice_text(answer)
    return any(
        snippet in normalized_answer
        for snippet in GENERIC_MULTIMODAL_ANSWER_SNIPPETS
    )


def _build_invoice_details_block(invoice_details: InvoiceDocumentDetails | None) -> str:
    if invoice_details is None:
        return "Aucune structure facture exploitable."

    detail_lines = [
        f"- Operateur: {invoice_details.operator}" if invoice_details.operator else "",
        f"- Numero facture: {invoice_details.invoice_number}" if invoice_details.invoice_number else "",
        f"- Date facture: {invoice_details.invoice_date}" if invoice_details.invoice_date else "",
        f"- Periode: {invoice_details.billing_period}" if invoice_details.billing_period else "",
        f"- Montant HT: {invoice_details.amount_ht_mad}" if invoice_details.amount_ht_mad else "",
        f"- TVA: {invoice_details.vat_amount_mad}" if invoice_details.vat_amount_mad else "",
        f"- Montant TTC: {invoice_details.amount_ttc_mad}" if invoice_details.amount_ttc_mad else "",
        f"- Total facture: {invoice_details.total_amount_mad}" if invoice_details.total_amount_mad else "",
        f"- Risque principal: {invoice_details.primary_risk}" if invoice_details.primary_risk else "",
    ]

    if invoice_details.cost_items:
        detail_lines.append(
            "- Postes de cout visibles:\n"
            + "\n".join(
                (
                    f"  - {item.label}: {item.amount_mad}"
                    + (
                        f" ({_format_share_pct(item.share_of_total_pct)} du total)"
                        if item.share_of_total_pct is not None
                        else ""
                    )
                )
                for item in invoice_details.cost_items[:5]
            )
        )
    if invoice_details.additional_fees:
        detail_lines.append(
            "- Frais supplementaires:\n"
            + "\n".join(f"  - {item}" for item in invoice_details.additional_fees[:4])
        )
    if invoice_details.overage_items:
        detail_lines.append(
            "- Depassements detectes:\n"
            + "\n".join(f"  - {item}" for item in invoice_details.overage_items[:4])
        )
    if invoice_details.anomalies:
        detail_lines.append(
            "- Anomalies visibles:\n"
            + "\n".join(f"  - {item}" for item in invoice_details.anomalies[:4])
        )

    return "\n".join(item for item in detail_lines if item)


def _build_incident_details_block(incident_details: IncidentDocumentDetails | None) -> str:
    if incident_details is None:
        return "Aucune structure alerte/log exploitable."

    detail_lines = [
        (
            f"- Type detecte: {_format_image_type_label(incident_details.alert_type)}"
            if incident_details.alert_type
            else ""
        ),
        f"- Gravite: {incident_details.severity}" if incident_details.severity else "",
        f"- Date/heure: {incident_details.detected_at}" if incident_details.detected_at else "",
        f"- Operateur: {incident_details.operator}" if incident_details.operator else "",
        f"- Ligne concernee: {incident_details.line_reference}" if incident_details.line_reference else "",
        (
            f"- Cout suspect: {incident_details.suspect_cost_mad}"
            if incident_details.suspect_cost_mad
            else ""
        ),
        f"- Volume appels: {incident_details.call_volume}" if incident_details.call_volume else "",
        f"- Depassement data: {incident_details.data_overage}" if incident_details.data_overage else "",
        (
            f"- Alertes critiques visibles: {incident_details.critical_alert_count}"
            if incident_details.critical_alert_count is not None
            else ""
        ),
        f"- Taux d'exposition: {incident_details.exposure_rate}" if incident_details.exposure_rate else "",
        (
            f"- Impact financier: {incident_details.financial_impact_mad}"
            if incident_details.financial_impact_mad
            else ""
        ),
        f"- Departement a risque: {incident_details.department_risk}" if incident_details.department_risk else "",
        f"- Contrat expose: {incident_details.contract_exposed}" if incident_details.contract_exposed else "",
        f"- Score moyen: {incident_details.average_score}" if incident_details.average_score else "",
        (
            f"- Risque fraude: {incident_details.fraud_score_visible}"
            if incident_details.fraud_score_visible
            else ""
        ),
        (
            f"- Risque anomalie: {incident_details.anomaly_score_visible}"
            if incident_details.anomaly_score_visible
            else ""
        ),
        (
            f"- Risque optimisation: {incident_details.optimization_score_visible}"
            if incident_details.optimization_score_visible
            else ""
        ),
        (
            f"- Risque cout: {incident_details.cost_score_visible}"
            if incident_details.cost_score_visible
            else ""
        ),
        f"- Score de risque: {incident_details.risk_score}" if incident_details.risk_score else "",
        f"- Message erreur: {incident_details.error_message}" if incident_details.error_message else "",
        f"- Priorite: {incident_details.priority}" if incident_details.priority else "",
        f"- Resume documentaire: {incident_details.summary}" if incident_details.summary else "",
    ]

    if incident_details.critical_signals:
        detail_lines.append(
            "- Signaux critiques visibles:\n"
            + "\n".join(f"  - {item}" for item in incident_details.critical_signals[:4])
        )
    if incident_details.risky_entities:
        detail_lines.append(
            "- Utilisateurs/lignes a risque:\n"
            + "\n".join(f"  - {item}" for item in incident_details.risky_entities[:4])
        )
    if incident_details.max_risk_scores:
        detail_lines.append(
            "- Scores de risque maximaux visibles:\n"
            + "\n".join(f"  - {item}" for item in incident_details.max_risk_scores[:4])
        )
    if incident_details.probable_causes:
        detail_lines.append(
            "- Causes probables:\n"
            + "\n".join(f"  - {item}" for item in incident_details.probable_causes[:4])
        )

    return "\n".join(item for item in detail_lines if item)


def _build_alert_dashboard_kpi_prompt_block(
    incident_details: IncidentDocumentDetails | None,
) -> str:
    if incident_details is None:
        return ""
    
    # Build comprehensive KPI payload with ALL visible metrics
    payload = {
        "critical_alerts": incident_details.critical_alert_count,
        "at_risk_clients": incident_details.at_risk_clients_count,
        "department_risk": incident_details.department_risk,
        "contract_exposed": incident_details.contract_exposed,
        "exposure_rate": incident_details.exposure_rate,
        "churn_rate": incident_details.churn_rate,
        "revenue_at_risk_mad": incident_details.revenue_at_risk_mad,
        "financial_impact_mad": incident_details.financial_impact_mad,
        "estimated_impact_mad": incident_details.estimated_impact_mad,
        "average_score": incident_details.average_score,
        "fraud_score": incident_details.fraud_score_visible,
        "anomaly_score": incident_details.anomaly_score_visible,
        "optimization_score": incident_details.optimization_score_visible,
        "cost_score": incident_details.cost_score_visible,
        "roi_estimated": incident_details.roi_estimated,
        "priority_actions": incident_details.priority_actions_count,
        "max_scores": incident_details.max_risk_scores,
        "critical_signals": incident_details.critical_signals[:5] if incident_details.critical_signals else None,
        "risk_level": (
            "critical"
            if incident_details.severity == "critique"
            else "high"
            if incident_details.severity == "elevee"
            else "medium"
            if incident_details.severity == "moyenne"
            else "low"
            if incident_details.severity == "faible"
            else incident_details.risk_level
            if hasattr(incident_details, 'risk_level') and incident_details.risk_level
            else None
        ),
    }
    
    # Filter out None values to create visible payload
    visible_payload = {key: value for key, value in payload.items() if value not in (None, [], "")}
    
    if not visible_payload:
        return ""
    
    # Log the KPI block being built for debugging
    MULTIMODAL_LOGGER.debug(
        "event=building_kpi_prompt_block visible_kpis=%d fields=%s",
        len(visible_payload),
        ", ".join(visible_payload.keys()),
    )
    
    return "alert_dashboard_kpis = " + json.dumps(visible_payload, ensure_ascii=True, indent=2)


def _has_visible_alert_kpis(incident_details: IncidentDocumentDetails | None) -> bool:
    if incident_details is None:
        return False
    
    # Check for ANY visible KPI field - comprehensive check of all possible KPI types
    return any(
        (
            incident_details.critical_alert_count is not None,
            incident_details.at_risk_clients_count is not None,
            bool(incident_details.exposure_rate),
            bool(incident_details.exposure_rate_pct),
            bool(incident_details.churn_rate),
            bool(incident_details.churn_rate_pct),
            bool(incident_details.financial_impact_mad),
            bool(incident_details.financial_impact_value_mad),
            bool(incident_details.revenue_at_risk_mad),
            bool(incident_details.revenue_at_risk_value_mad),
            bool(incident_details.estimated_impact_mad),
            bool(incident_details.estimated_impact_value_mad),
            bool(incident_details.average_score),
            bool(incident_details.fraud_score_visible),
            bool(incident_details.fraud_score_value),
            bool(incident_details.anomaly_score_visible),
            bool(incident_details.anomaly_score_value),
            bool(incident_details.optimization_score_visible),
            bool(incident_details.optimization_score_value),
            bool(incident_details.cost_score_visible),
            bool(incident_details.cost_score_value),
            bool(incident_details.max_risk_scores),
            bool(incident_details.risk_score),
            bool(incident_details.roi_estimated),
            incident_details.priority_actions_count is not None,
            bool(incident_details.critical_signals),
        )
    )


def _sanitize_stage_notices_for_alert_kpis(
    stage_notices: list[str],
    incident_details: IncidentDocumentDetails | None,
) -> list[str]:
    if not _has_visible_alert_kpis(incident_details):
        return stage_notices
    blocked_snippets = (
        "texte insuffisant",
        "fiabilite a confirmer",
        "lecture partielle",
        "indicateurs insuffisants",
        "partielle",
    )
    return [
        notice
        for notice in stage_notices
        if all(snippet not in _normalize_invoice_text(notice) for snippet in blocked_snippets)
    ]


def _build_workflow_details_block(workflow_details: WorkflowDocumentDetails | None) -> str:
    if workflow_details is None:
        return "Aucune structure workflow exploitable."

    detail_lines = [
        (
            f"- Type workflow: {_format_image_type_label(workflow_details.workflow_type)}"
            if workflow_details.workflow_type
            else ""
        ),
        f"- Score complexite: {workflow_details.complexity_score}/100",
        f"- Niveau complexite: {workflow_details.complexity_level}",
        (
            f"- Departements detectes: {', '.join(workflow_details.departments[:5])}"
            if workflow_details.departments
            else ""
        ),
        f"- Niveaux hierarchiques: {workflow_details.hierarchy_levels}" if workflow_details.hierarchy_levels else "",
        f"- Resume documentaire: {workflow_details.summary}" if workflow_details.summary else "",
    ]

    if workflow_details.step_names:
        detail_lines.append(
            "- Etapes visibles:\n"
            + "\n".join(f"  - {item}" for item in workflow_details.step_names[:8])
        )
    if workflow_details.critical_steps:
        detail_lines.append(
            "- Etapes critiques:\n"
            + "\n".join(f"  - {item}" for item in workflow_details.critical_steps[:6])
        )
    if workflow_details.bottlenecks:
        detail_lines.append(
            "- Points de blocage:\n"
            + "\n".join(f"  - {item}" for item in workflow_details.bottlenecks[:5])
        )
    if workflow_details.automation_opportunities:
        detail_lines.append(
            "- Opportunites d'automatisation:\n"
            + "\n".join(f"  - {item}" for item in workflow_details.automation_opportunities[:4])
        )

    return "\n".join(item for item in detail_lines if item)


def _infer_equipment_type_from_text(text: str) -> str | None:
    normalized_text = text.lower()
    def contains_equipment_keyword(keyword: str) -> bool:
        return re.search(rf"(?<!\w){re.escape(keyword)}(?!\w)", normalized_text) is not None

    equipment_rules = [
        ("smartphone", ("smartphone", "telephone", "iphone", "galaxy", "android", "ios")),
        ("routeur", ("routeur", "router", "gateway", "cpe")),
        ("modem", ("modem", "ont", "adsl", "fibre", "fiber", "4g box", "5g box")),
        ("sim", ("sim", "usim", "iccid", "imsi")),
        ("switch", ("switch", "ethernet switch", "catalyst", "ports")),
        ("borne_wifi", ("borne wifi", "access point", "wifi", "wi-fi", "wlan", "hotspot")),
        ("antenne", ("antenne", "antenna", "radio")),
        ("ordinateur", ("ordinateur", "pc", "laptop", "notebook", "poste de travail")),
        ("imprimante", ("imprimante", "printer")),
        ("serveur", ("serveur", "server", "rack", "baie reseau")),
        ("vehicule", ("vehicule", "vehicle", "voiture", "camion")),
        ("machine", ("machine", "terminal industriel", "automate")),
        ("infrastructure", ("infrastructure", "site technique", "armoire telecom")),
    ]
    for equipment_type, keywords in equipment_rules:
        if any(contains_equipment_keyword(keyword.strip()) for keyword in keywords):
            return equipment_type
    return None


def _normalize_equipment_routing_text(text: str) -> str:
    return " ".join(
        re.sub(r"[^a-z0-9]+", " ", _normalize_invoice_text(text)).split()
    )


def _question_targets_physical_equipment(question: str) -> bool:
    normalized_question = _normalize_equipment_routing_text(question)
    if not normalized_question:
        return False
    if any(phrase in normalized_question for phrase in VISUAL_EQUIPMENT_DETECTION_PHRASES):
        return True
    has_object_reference = any(
        keyword in normalized_question for keyword in PHYSICAL_EQUIPMENT_OBJECT_KEYWORDS
    )
    if has_object_reference and any(
        phrase in normalized_question for phrase in PHYSICAL_EQUIPMENT_IDENTIFICATION_PHRASES
    ):
        if any(
            phrase in normalized_question for phrase in PHYSICAL_EQUIPMENT_VISUAL_CONTEXT_PHRASES
        ) or any(keyword in normalized_question for keyword in ("present", "visible", "photo", "image")):
            return True
    has_equipment_intent = any(
        phrase in normalized_question for phrase in PHYSICAL_EQUIPMENT_INTENT_PHRASES
    )
    return has_object_reference and has_equipment_intent


def _has_physical_equipment_signals(
    *,
    question: str,
    history: list[ChatContextMessage] | None,
    ocr_result: OcrExtractionResult,
    vision_result: VisionAnalysisResult,
) -> bool:
    if _question_targets_physical_equipment(question):
        return True

    combined_text = _normalize_equipment_routing_text(
        " ".join(
            item
            for item in [
                question,
                *(
                    message.text
                    for message in (history or [])[-4:]
                    if message.role == "user"
                ),
                ocr_result.text,
                vision_result.analysis,
                vision_result.raw_output,
                vision_result.primary_equipment or "",
                *vision_result.detected_objects,
                *vision_result.detected_brands,
                *vision_result.detected_operators,
                *vision_result.sim_types,
            ]
            if item
        )
    )
    if not combined_text:
        return False

    direct_equipment_cues = bool(
        ocr_result.equipment_details is not None
        or vision_result.primary_equipment
        or vision_result.detected_objects
        or vision_result.detected_brands
        or vision_result.detected_operators
        or vision_result.sim_types
    )
    if direct_equipment_cues:
        return True

    if _infer_equipment_type_from_text(combined_text) is not None:
        return True

    detected_keyword_count = sum(
        1 for keyword in PHYSICAL_EQUIPMENT_OBJECT_KEYWORDS if keyword in combined_text
    )
    has_visual_hint = any(
        keyword in combined_text for keyword in PHYSICAL_EQUIPMENT_VISUAL_ROUTING_HINTS
    )
    has_dashboard_bias = any(
        keyword in combined_text
        for keyword in (
            "dashboard",
            "tableau de bord",
            "kpi",
            "graphique",
            "graphe",
            "alerte",
            "alertes",
            "log",
            "traceback",
            "exception",
            "budget",
            "roaming",
        )
    )
    return (detected_keyword_count >= 2 and has_visual_hint) or (
        detected_keyword_count >= 3 and not has_dashboard_bias
    )


def _find_brand_near_keywords(
    text: str,
    *,
    keywords: tuple[str, ...],
    brand_hints: tuple[str, ...] = EQUIPMENT_BRAND_HINTS,
) -> str | None:
    normalized_text = text.lower()
    for keyword in keywords:
        for match in re.finditer(re.escape(keyword.lower()), normalized_text):
            window = normalized_text[max(0, match.start() - 60) : match.end() + 60]
            for brand in brand_hints:
                if brand.lower() in window:
                    return brand
    for brand in brand_hints:
        if brand.lower() in normalized_text:
            return brand
    return None


def _extract_equipment_operators_from_text(text: str) -> list[str]:
    normalized_text = text.lower()
    return _dedupe_items(
        [operator for operator in EQUIPMENT_OPERATOR_HINTS if operator.lower() in normalized_text],
        4,
    )


def _extract_sim_types_from_text(text: str) -> list[str]:
    normalized_text = text.lower().replace("-", " ")
    detected_types: list[str] = []
    if re.search(r"(?<!\w)nano sim(?!\w)", normalized_text):
        detected_types.append("Nano SIM")
    if re.search(r"(?<!\w)micro sim(?!\w)", normalized_text):
        detected_types.append("Micro SIM")
    if re.search(r"(?<!\w)mini sim(?!\w)", normalized_text):
        detected_types.append("Mini SIM")
    if re.search(r"(?<!\w)(?:esim|e sim)(?!\w)", normalized_text):
        detected_types.append("eSIM")
    if "triple decoupe" in normalized_text and "Nano SIM" not in detected_types:
        detected_types.append("Nano SIM")
    return _dedupe_items(detected_types, 4)


def _extract_primary_equipment_brand(
    primary_equipment: str | None,
    *,
    fallback_text: str,
) -> str | None:
    if primary_equipment:
        for brand in EQUIPMENT_BRAND_HINTS:
            if brand.lower() in primary_equipment.lower():
                return brand
    combined_text = " ".join(item for item in [primary_equipment, fallback_text] if item)
    for brand in EQUIPMENT_BRAND_HINTS:
        if brand.lower() in combined_text.lower():
            return brand
    return None


def _build_generation_hint(text: str, *, keywords: tuple[str, ...]) -> str:
    normalized_text = text.lower()
    match_positions = [
        match.start()
        for keyword in keywords
        for match in re.finditer(re.escape(keyword.lower()), normalized_text)
    ]
    if not match_positions:
        scope = normalized_text
    else:
        start = max(0, min(match_positions) - 80)
        end = min(len(normalized_text), max(match_positions) + 120)
        scope = normalized_text[start:end]
    if "4g" in scope and "5g" in scope:
        return " 4G/5G"
    if "5g" in scope:
        return " 5G"
    if "4g" in scope or "lte" in scope:
        return " 4G LTE"
    return ""


def _classify_equipment_visual_type(raw_label: str) -> tuple[str | None, str]:
    normalized_label = _normalize_invoice_text(raw_label)
    if (
        "routeur wi-fi apparent" in normalized_label
        or "routeur wi fi apparent" in normalized_label
        or "routeur wifi apparent" in normalized_label
    ):
        return "routeur_wifi", "Routeur Wi-Fi"
    if "antennes reseau visibles" in normalized_label:
        return "antennes_reseau", "Antennes reseau"
    if "boitier reseau visible" in normalized_label:
        return "boitier_reseau", "Boitier reseau"
    if "voyants ou ports apparents" in normalized_label:
        return "voyant_ports", "Voyants ou ports"
    if "vehicule apparent" in normalized_label or "voiture apparente" in normalized_label:
        return "vehicule", "Vehicule"
    if "roues visibles" in normalized_label:
        return "roue", "Roue"
    if "carrosserie visible" in normalized_label:
        return "carrosserie", "Carrosserie"
    if "zone de stationnement visible" in normalized_label:
        return "stationnement", "Zone de stationnement"
    if "environnement exterieur visible" in normalized_label:
        return "environnement_exterieur", "Environnement exterieur"
    if "mobilier apparent" in normalized_label:
        return "mobilier", "Mobilier"
    if "materiel informatique apparent" in normalized_label:
        return "materiel_informatique", "Materiel informatique"
    if "machine ou equipement industriel apparent" in normalized_label:
        return "machine_industrielle", "Equipement industriel"
    if "ecran ou surface d affichage visible" in normalized_label:
        return "materiel_informatique", "Materiel informatique"
    if "poste de travail ou support visible" in normalized_label:
        return "materiel_informatique", "Materiel informatique"
    if "surface ou plan de travail visible" in normalized_label:
        return "mobilier", "Mobilier"
    if "zone technique ou atelier visible" in normalized_label:
        return "machine_industrielle", "Equipement industriel"
    uncertain_markers = (
        "?",
        "carte bancaire",
        "adaptateur sim",
        "objet non identifie",
        "objet inconnu",
        "non identifie",
        "non confirme",
        "incertain",
        "possible",
    )
    if any(marker in normalized_label for marker in uncertain_markers):
        return None, EQUIPMENT_UNKNOWN_OBJECT_LABEL
    if "smartphone" in normalized_label or "telephone" in normalized_label or "iphone" in normalized_label:
        return "smartphone", "Smartphone"
    if any(keyword in normalized_label for keyword in ("routeur", "router", "gateway", "cpe")):
        return "routeur", "Routeur"
    if "boitier de connectivite mobile" in normalized_label:
        return "modem_usb", "Modem USB"
    if "modem usb" in normalized_label or "dongle" in normalized_label:
        return "modem_usb", "Modem USB"
    if "modem" in normalized_label:
        return "modem", "Modem"
    if "nano sim" in normalized_label:
        return "nano_sim", "Nano SIM"
    if "micro sim" in normalized_label:
        return "micro_sim", "Micro SIM"
    if "mini sim" in normalized_label:
        return "mini_sim", "Mini SIM"
    if "carte sim" in normalized_label or normalized_label == "sim":
        return "sim", "Carte SIM"
    if re.search(r"(?<![a-z0-9])e\s*sim(?![a-z0-9])", normalized_label):
        return "esim", "eSIM"
    if any(keyword in normalized_label for keyword in ("ordinateur", "laptop", "notebook", "pc")):
        return "ordinateur", "Ordinateur"
    if "imprimante" in normalized_label or "printer" in normalized_label:
        return "imprimante", "Imprimante"
    if "serveur" in normalized_label or "server" in normalized_label or "rack" in normalized_label:
        return "serveur", "Serveur"
    if "vehicule" in normalized_label or "vehicle" in normalized_label:
        return "vehicule", "Vehicule"
    if "machine" in normalized_label or "terminal industriel" in normalized_label:
        return "machine", "Machine"
    if "infrastructure" in normalized_label or "baie reseau" in normalized_label:
        return "infrastructure", "Infrastructure telecom"
    if "cable usb" in normalized_label or "usb cable" in normalized_label:
        return "cable_usb", "Cable USB"
    if "antenne" in normalized_label or "antenna" in normalized_label:
        return "antenne", "Antenne telecom"
    if "switch" in normalized_label:
        return "switch", "Switch reseau"
    if "borne wifi" in normalized_label or "access point" in normalized_label:
        return "borne_wifi", "Borne WiFi"
    if "accessoire" in normalized_label:
        return "accessoire", "Accessoire telecom"
    return None, EQUIPMENT_UNKNOWN_OBJECT_LABEL


def _extract_equipment_brand_from_label(
    raw_label: str,
    *,
    fallback_operators: list[str],
) -> str | None:
    combined_candidates = [*EQUIPMENT_BRAND_HINTS, *fallback_operators]
    for candidate in combined_candidates:
        if candidate.lower() in raw_label.lower():
            return candidate
    return None


def _resolve_inventory_item_usage(
    *,
    raw_label: str | None,
    type_key: str | None,
    vision_result: VisionAnalysisResult,
    is_primary_equipment: bool,
) -> str:
    if is_primary_equipment and vision_result.probable_usage:
        return vision_result.probable_usage
    normalized_raw_label = _normalize_invoice_text(raw_label or "")
    if type_key == "modem_usb" and "boitier de connectivite mobile" in normalized_raw_label:
        return "Il peut fournir une connexion Internet a un ordinateur compatible."
    usage_map = {
        "smartphone": "Communication mobile et applications metier.",
        "routeur": "Connectivite mobile et Internet d'entreprise.",
        "routeur_wifi": "Le routeur permet de distribuer la connexion Internet ou Wi-Fi.",
        "antennes_reseau": "Les antennes servent a ameliorer la couverture reseau.",
        "boitier_reseau": "Le boitier reseau regroupe l'electronique de connectivite.",
        "voyant_ports": "Les voyants ou ports servent au suivi de l'etat de connexion et au raccordement.",
        "modem_usb": "Le modem USB permet l'acces au reseau mobile via un port USB.",
        "modem": "Acces data operateur pour la connectivite locale.",
        "sim": "Acces au reseau mobile pour la voix, la data ou la telemetrie.",
        "nano_sim": "Format de carte SIM pour un terminal mobile compact.",
        "micro_sim": "Format de carte SIM pour un terminal mobile.",
        "mini_sim": "Format de carte SIM pour un equipement legacy.",
        "esim": "Profil SIM dematerialise pour un terminal compatible.",
        "ordinateur": "Poste de travail ou terminal informatique d'exploitation.",
        "imprimante": "Edition locale de documents, tickets ou etiquettes.",
        "serveur": "Hebergement local de services, supervision ou applications reseau.",
        "vehicule": "Le vehicule sert au transport ou au deplacement professionnel.",
        "roue": "Element roulant visible associe a un vehicule ou a un equipement mobile.",
        "carrosserie": "Structure exterieure visible d'un vehicule ou d'un objet mobile.",
        "stationnement": "La zone de stationnement sert a l'arret ou au rangement du vehicule.",
        "environnement_exterieur": "L'environnement exterieur correspond a la zone de circulation ou de stationnement visible.",
        "mobilier": "Mobilier ou support physique d'usage courant.",
        "materiel_informatique": "Poste informatique ou support numerique d'exploitation.",
        "machine_industrielle": "Equipement operationnel ou industriel visible.",
        "machine": "Equipement operationnel ou industriel relie au reseau.",
        "infrastructure": "Element d'infrastructure telecom ou reseau de site.",
        "cable_usb": "Alimentation ou transfert local de donnees entre equipements.",
        "switch": "Distribution de la connectivite reseau filaire.",
        "borne_wifi": "Diffusion de la connectivite WiFi sur site.",
        "antenne": "Couverture radio ou liaison d'acces telecom.",
        "accessoire": "Support physique ou connectique telecom.",
    }
    return usage_map.get(type_key, EQUIPMENT_GENERIC_USAGE_NOTICE)


def _resolve_equipment_confidence_label(
    *,
    raw_label: str,
    type_key: str | None,
    brand: str | None,
    vision_confidence: float,
) -> str:
    normalized_label = _normalize_invoice_text(raw_label)
    if type_key is None:
        return EQUIPMENT_CONFIDENCE_UNCERTAIN
    if any(
        marker in normalized_label
        for marker in ("possible", "incertain", "non confirme", "objet non identifie", "adaptateur", "carte bancaire")
    ):
        return EQUIPMENT_CONFIDENCE_UNCERTAIN
    if type_key in {"sim", "nano_sim", "micro_sim", "mini_sim", "esim", "cable_usb", "accessoire"}:
        return EQUIPMENT_CONFIDENCE_PROBABLE if vision_confidence >= 0.45 else EQUIPMENT_CONFIDENCE_UNCERTAIN
    if type_key in {
        "smartphone",
        "routeur",
        "routeur_wifi",
        "antennes_reseau",
        "boitier_reseau",
        "voyant_ports",
        "modem_usb",
        "modem",
        "switch",
        "borne_wifi",
        "antenne",
        "ordinateur",
        "imprimante",
        "serveur",
        "vehicule",
        "roue",
        "carrosserie",
        "stationnement",
        "environnement_exterieur",
        "mobilier",
        "materiel_informatique",
        "machine_industrielle",
        "machine",
        "infrastructure",
    }:
        if vision_confidence >= 0.72 and (brand is not None or type_key in {"modem_usb", "antenne"}):
            return EQUIPMENT_CONFIDENCE_CONFIRMED
        if vision_confidence >= 0.52:
            return EQUIPMENT_CONFIDENCE_PROBABLE
    return EQUIPMENT_CONFIDENCE_UNCERTAIN


def _build_visual_equipment_inventory(
    *,
    question: str,
    ocr_result: OcrExtractionResult,
    vision_result: VisionAnalysisResult,
) -> list[EquipmentVisualInventoryItem]:
    detected_objects = _build_detected_equipment_objects(
        question=question,
        ocr_result=ocr_result,
        vision_result=vision_result,
    )
    raw_items = detected_objects or ([vision_result.primary_equipment] if vision_result.primary_equipment else [])
    primary_label = vision_result.primary_equipment or (raw_items[0] if raw_items else None)
    inventory: list[EquipmentVisualInventoryItem] = []

    for raw_label in raw_items:
        type_key, type_label = _classify_equipment_visual_type(raw_label)
        brand = _extract_equipment_brand_from_label(
            raw_label,
            fallback_operators=vision_result.detected_operators,
        )
        confidence_label = _resolve_equipment_confidence_label(
            raw_label=raw_label,
            type_key=type_key,
            brand=brand,
            vision_confidence=vision_result.confidence,
        )
        is_primary_equipment = primary_label is not None and raw_label == primary_label
        usage_probable = _resolve_inventory_item_usage(
            raw_label=raw_label,
            type_key=type_key,
            vision_result=vision_result,
            is_primary_equipment=is_primary_equipment,
        )
        if confidence_label == EQUIPMENT_CONFIDENCE_UNCERTAIN:
            inventory.append(
                EquipmentVisualInventoryItem(
                    raw_label=raw_label,
                    type_key=None,
                    type_label=EQUIPMENT_UNKNOWN_OBJECT_LABEL,
                    brand=None,
                    confidence_label=EQUIPMENT_CONFIDENCE_UNCERTAIN,
                    usage_probable=EQUIPMENT_GENERIC_USAGE_NOTICE,
                )
            )
            continue
        inventory.append(
            EquipmentVisualInventoryItem(
                raw_label=raw_label,
                type_key=type_key,
                type_label=type_label,
                brand=brand,
                confidence_label=confidence_label,
                usage_probable=usage_probable,
            )
        )

    generic_inventory_needed = (
        vision_result.image_type == "equipement"
        and (
            not inventory
            or all(item.type_label == EQUIPMENT_UNKNOWN_OBJECT_LABEL for item in inventory)
        )
    )
    if generic_inventory_needed:
        generic_inventory = _build_generic_equipment_inventory(
            telecom_hints_confirmed=_has_telecom_equipment_fallback_hints(
                ocr_result=ocr_result,
                vision_result=vision_result,
            )
        )
        return _dedupe_equipment_inventory_by_label([*generic_inventory, *inventory])

    return inventory


def _dedupe_equipment_inventory_by_label(
    inventory: list[EquipmentVisualInventoryItem],
) -> list[EquipmentVisualInventoryItem]:
    deduped_inventory: list[EquipmentVisualInventoryItem] = []
    seen_labels: set[str] = set()
    for item in inventory:
        normalized_label = _normalize_invoice_text(item.raw_label or item.type_label)
        if not normalized_label or normalized_label in seen_labels:
            continue
        seen_labels.add(normalized_label)
        deduped_inventory.append(item)
    return deduped_inventory


def _format_equipment_detection_count(inventory: list[EquipmentVisualInventoryItem]) -> str:
    total_objects = len(inventory)
    if total_objects == 0:
        return "0"

    ambiguous_count = sum(
        1
        for item in inventory
        if item.confidence_label in {EQUIPMENT_CONFIDENCE_PROBABLE, EQUIPMENT_CONFIDENCE_UNCERTAIN}
    )
    confirmed_count = sum(1 for item in inventory if item.confidence_label == EQUIPMENT_CONFIDENCE_CONFIRMED)
    if ambiguous_count == 0:
        return str(total_objects)

    lower_bound = max(confirmed_count, total_objects - ((ambiguous_count + 1) // 2))
    lower_bound = min(lower_bound, total_objects)
    if lower_bound >= total_objects:
        lower_bound = max(1, total_objects - 1)
    return f"{lower_bound} a {total_objects}"


def _describe_equipment_detection_count(inventory: list[EquipmentVisualInventoryItem]) -> str:
    if _has_generic_telecom_equipment_inventory(inventory):
        return "Plusieurs equipements telecom sont visibles"
    if _has_neutral_generic_equipment_inventory(inventory):
        return EQUIPMENT_NEUTRAL_PRIMARY_VISIBLE_LABEL
    if _has_non_telecom_visible_inventory(inventory):
        return f"{len(inventory)} elements visuels identifies"
    count_value = _format_equipment_detection_count(inventory)
    if count_value == "0":
        return "0 objet telecom detecte"
    return f"{count_value} objets telecom detectes"


def _has_visual_replacement_evidence(*, issues: list[str], replacement_signals: list[str]) -> bool:
    visible_evidence = " ".join([*issues, *replacement_signals]).lower()
    return any(
        keyword in visible_evidence
        for keyword in (
            "batterie gonflee",
            "ecran casse",
            "surchauffe",
            "obsolete",
            "ancien",
            "endommage",
            "defaut",
            "fault",
            "offline",
            "replace",
            "remplac",
        )
    )


def _is_hardware_replacement_recommendation(recommendation: str) -> bool:
    normalized_recommendation = _normalize_invoice_text(recommendation)
    return any(
        keyword in normalized_recommendation
        for keyword in (
            "remplacement",
            "remplacer",
            "renouvellement",
            "routeur 5g",
            "smartphone neuf",
            "materiel neuf",
            "nouveau terminal",
        )
    )


def _filter_equipment_recommendations_for_visual_evidence(
    recommendations: list[str],
    *,
    issues: list[str],
    replacement_signals: list[str],
) -> list[str]:
    if _has_visual_replacement_evidence(issues=issues, replacement_signals=replacement_signals):
        return _dedupe_items(recommendations, 6)
    return _dedupe_items(
        [
            recommendation
            for recommendation in recommendations
            if not _is_hardware_replacement_recommendation(recommendation)
        ],
        6,
    )


def _sanitize_vision_only_equipment_answer(
    *,
    parsed_answer: FinalImageAnswer,
    question: str,
    ocr_result: OcrExtractionResult,
    vision_result: VisionAnalysisResult,
) -> FinalImageAnswer:
    equipment_details = ocr_result.equipment_details
    issues = equipment_details.detected_issues if equipment_details is not None else []
    replacement_signals = vision_result.replacement_signals
    inventory = _build_visual_equipment_inventory(
        question=question,
        ocr_result=ocr_result,
        vision_result=vision_result,
    )
    router_only_inventory = _inventory_is_strict_router_visible_only(inventory)
    filtered_recommendations = _filter_equipment_recommendations_for_visual_evidence(
        parsed_answer.recommendations,
        issues=issues,
        replacement_signals=replacement_signals,
    )
    if router_only_inventory:
        filtered_recommendations = _filter_router_only_non_visible_entries(filtered_recommendations)
    if not _has_visual_replacement_evidence(issues=issues, replacement_signals=replacement_signals):
        filtered_recommendations = _dedupe_items(
            [*filtered_recommendations, EQUIPMENT_NO_REPLACEMENT_NOTICE],
            6,
        )

    count_kpi = _describe_equipment_detection_count(inventory) if inventory else ""
    filtered_kpis = [
        item
        for item in parsed_answer.detected_kpis
        if not _normalize_invoice_text(item).startswith("equipements detectes")
    ]
    filtered_anomalies = parsed_answer.detected_anomalies
    filtered_probable_causes = parsed_answer.probable_causes
    if router_only_inventory:
        filtered_kpis = _filter_router_only_non_visible_entries(filtered_kpis)
        filtered_anomalies = _filter_router_only_non_visible_entries(filtered_anomalies)
        filtered_probable_causes = _filter_router_only_non_visible_entries(filtered_probable_causes)
    if count_kpi:
        filtered_kpis.insert(0, count_kpi)
    if inventory:
        filtered_kpis.insert(1, f"Confiance Vision {round(vision_result.confidence * 100)}%")
    sanitized_answer = replace(
        parsed_answer,
        detected_kpis=_dedupe_items(filtered_kpis, 10),
        recommendations=filtered_recommendations,
        detected_anomalies=_dedupe_items(filtered_anomalies, 8),
        probable_causes=_dedupe_items(filtered_probable_causes, 8),
    )
    return _sanitize_network_equipment_objects(
        parsed_answer=sanitized_answer,
        inventory=inventory,
    )


def _build_detected_equipment_objects(
    *,
    question: str,
    ocr_result: OcrExtractionResult,
    vision_result: VisionAnalysisResult,
) -> list[str]:
    if vision_result.detected_objects:
        return _dedupe_items(vision_result.detected_objects, 10)

    combined_text = " ".join(
        item
        for item in [
            ocr_result.text,
            vision_result.analysis,
            vision_result.raw_output,
        ]
        if item
    )
    normalized_text = combined_text.lower()
    detected_objects: list[str] = []

    if any(keyword in normalized_text for keyword in ("smartphone", "telephone", "iphone", "galaxy")):
        smartphone_brand = _find_brand_near_keywords(
            combined_text,
            keywords=("smartphone", "telephone", "iphone", "galaxy"),
            brand_hints=("Samsung", "Apple", "Xiaomi", "Oppo", "Vivo", "Lenovo"),
        )
        detected_objects.append(
            f"Smartphone {smartphone_brand}".strip() if smartphone_brand else "Smartphone"
        )

    if any(keyword in normalized_text for keyword in ("routeur", "router", "gateway", "cpe")):
        router_brand = _find_brand_near_keywords(
            combined_text,
            keywords=("routeur", "router", "gateway", "cpe"),
            brand_hints=("Huawei", "Cisco", "ZTE", "Nokia", "TP-Link", "Netgear", "D-Link", "Ubiquiti"),
        )
        detected_objects.append(
            f"Routeur {router_brand or ''}{_build_generation_hint(combined_text, keywords=('routeur', 'router', 'gateway', 'cpe'))}".strip()
            or "Routeur"
        )

    if any(keyword in normalized_text for keyword in ("modem", "dongle", "usb", "4g lite", "lte modem")):
        modem_brand = _find_brand_near_keywords(
            combined_text,
            keywords=("modem", "dongle", "usb", "lte modem"),
            brand_hints=("Huawei", "ZTE", "Nokia", "Samsung"),
        )
        modem_label = f"Modem USB {modem_brand}".strip() if modem_brand else "Modem USB"
        if "4g" in normalized_text or "lte" in normalized_text:
            modem_label = f"{modem_label} 4G LTE"
        detected_objects.append(modem_label.strip())

    if any(keyword in normalized_text for keyword in ("sim", "usim", "nano sim", "micro sim", "iccid", "imsi")):
        operators = vision_result.detected_operators or _extract_equipment_operators_from_text(combined_text)
        if operators:
            detected_objects.extend(f"Carte SIM {operator}" for operator in operators[:3])
        else:
            detected_objects.append("Carte SIM")
        detected_objects.extend(vision_result.sim_types or _extract_sim_types_from_text(combined_text))

    if any(keyword in normalized_text for keyword in ("antenne", "antenna")):
        detected_objects.append("Antenne telecom")
    if any(keyword in normalized_text for keyword in ("switch", "ethernet switch", "catalyst")):
        switch_brand = _find_brand_near_keywords(
            combined_text,
            keywords=("switch", "ethernet switch", "catalyst"),
            brand_hints=("Cisco", "Juniper", "Aruba", "TP-Link", "Netgear"),
        )
        detected_objects.append(f"Switch {switch_brand}".strip() if switch_brand else "Switch reseau")
    if any(keyword in normalized_text for keyword in ("access point", "borne wifi", "wifi", "wi-fi")):
        detected_objects.append("Borne WiFi")

    return _dedupe_items(detected_objects, 10)


def _decode_prepared_image_for_generic_heuristics(
    prepared_image: PreparedImage | None,
):
    if np is None or prepared_image is None or not prepared_image.processed_bytes:
        return None
    if cv2 is not None:
        try:
            image_array = np.frombuffer(prepared_image.processed_bytes, dtype=np.uint8)
            if image_array.size == 0:
                return None
            decoded = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
            if decoded is None or decoded.size == 0:
                return None
            return decoded
        except Exception:
            return None
    if PilImage is None:
        return None
    try:
        pil_image = PilImage.open(io.BytesIO(prepared_image.processed_bytes)).convert("RGB")
        decoded = np.array(pil_image)
        if decoded.size == 0:
            return None
        return decoded
    except (UnidentifiedImageError, OSError, ValueError):
        return None


def _extract_usb_modem_visual_cues(
    prepared_image: PreparedImage | None,
) -> dict[str, bool | float | int]:
    cues = {
        "main_object_vertical": False,
        "main_object_narrow": False,
        "main_object_ratio": 0.0,
        "main_object_width_ratio": 0.0,
        "main_object_height_ratio": 0.0,
        "main_object_area_ratio": 0.0,
        "main_object_detected": False,
        "router_horizontal_detected": False,
        "rj45_visible": False,
        "antenna_visible": False,
        "compact_body_detected": False,
        "rounded_extremity_detected": False,
        "dongle_shape_detected": False,
        "image_width": int(prepared_image.processed_width or prepared_image.width or 0) if prepared_image is not None else 0,
        "image_height": int(prepared_image.processed_height or prepared_image.height or 0) if prepared_image is not None else 0,
        "main_object_x": 0,
        "main_object_y": 0,
        "main_object_width": 0,
        "main_object_height": 0,
    }
    router_cues = _extract_network_equipment_visual_cues(prepared_image)
    antenna_detected = bool(
        router_cues.get("vertical_antennas_detected", False)
        or float(router_cues.get("antenna_score", 0.0) or 0.0) > 0.0
        or int(router_cues.get("router_antenna_count", 0) or 0) > 0
    )
    cues["antenna_visible"] = antenna_detected

    decoded = _decode_prepared_image_for_generic_heuristics(prepared_image)
    if decoded is None or np is None:
        cues["rj45_visible"] = bool(router_cues.get("status_ports_detected", False))
        cues["router_horizontal_detected"] = bool(
            router_cues.get("router_body_detected", False)
            or router_cues.get("network_shape_detected", False)
            or float(router_cues.get("router_confidence", 0.0) or 0.0) >= 0.72
        )
        return cues
    try:
        rgb_array = (
            cv2.cvtColor(decoded, cv2.COLOR_BGR2RGB)
            if cv2 is not None
            else decoded
        )
        height, width = rgb_array.shape[:2]
        if height < 80 or width < 80:
            return cues

        corner_span_y = max(10, height // 12)
        corner_span_x = max(10, width // 12)
        background_samples = np.concatenate(
            [
                rgb_array[:corner_span_y, :corner_span_x].reshape(-1, 3),
                rgb_array[:corner_span_y, -corner_span_x:].reshape(-1, 3),
                rgb_array[-corner_span_y:, :corner_span_x].reshape(-1, 3),
                rgb_array[-corner_span_y:, -corner_span_x:].reshape(-1, 3),
            ],
            axis=0,
        )
        background_color = np.median(background_samples, axis=0)
        delta = rgb_array.astype(np.float32) - background_color.reshape(1, 1, 3)
        foreground_distance = np.sqrt(np.square(delta).sum(axis=2))
        foreground_mask = foreground_distance >= 26.0

        if cv2 is not None:
            foreground_mask = cv2.morphologyEx(
                foreground_mask.astype(np.uint8),
                cv2.MORPH_OPEN,
                np.ones((5, 5), dtype=np.uint8),
            ).astype(bool)

        rows = np.where(foreground_mask.any(axis=1))[0]
        columns = np.where(foreground_mask.any(axis=0))[0]
        if rows.size == 0 or columns.size == 0:
            return cues

        min_row = int(rows.min())
        max_row = int(rows.max())
        min_column = int(columns.min())
        max_column = int(columns.max())
        object_height = max_row - min_row + 1
        object_width = max_column - min_column + 1
        object_ratio = round(float(object_height / max(object_width, 1)), 2)
        width_ratio = round(float(object_width / max(width, 1)), 2)
        height_ratio = round(float(object_height / max(height, 1)), 2)
        area_ratio = round(float((object_width * object_height) / max(width * height, 1)), 2)
        main_object_vertical = object_ratio > 1.5
        main_object_narrow = width_ratio <= 0.42
        main_object_detected = bool(
            object_height >= height * 0.18
            and object_width >= width * 0.05
            and height_ratio <= 0.92
        )
        object_mask = foreground_mask[min_row : max_row + 1, min_column : max_column + 1]
        corner_span_y = max(4, object_height // 8)
        corner_span_x = max(4, object_width // 8)
        top_left = object_mask[:corner_span_y, :corner_span_x]
        top_right = object_mask[:corner_span_y, -corner_span_x:]
        bottom_left = object_mask[-corner_span_y:, :corner_span_x]
        bottom_right = object_mask[-corner_span_y:, -corner_span_x:]
        center_band = object_mask[
            max(0, object_height // 3) : min(object_height, (object_height * 2) // 3),
            max(0, object_width // 4) : min(object_width, (object_width * 3) // 4),
        ]
        corner_density = float(
            np.mean(
                np.concatenate(
                    [
                        top_left.reshape(-1),
                        top_right.reshape(-1),
                        bottom_left.reshape(-1),
                        bottom_right.reshape(-1),
                    ]
                )
            )
        )
        center_density = float(center_band.mean()) if center_band.size else 0.0
        rounded_extremity_detected = bool(
            center_density >= 0.66
            and corner_density <= max(0.48, center_density - 0.18)
        )
        compact_body_detected = bool(
            main_object_detected
            and width_ratio <= 0.38
            and height_ratio <= 0.82
            and area_ratio <= 0.30
        )
        router_horizontal_detected = bool(
            (
                router_cues.get("router_body_detected", False)
                or router_cues.get("network_shape_detected", False)
            )
            and width_ratio >= 0.28
            and object_ratio <= 1.25
        ) or bool(
            float(router_cues.get("router_confidence", 0.0) or 0.0) >= 0.78
            and width_ratio >= 0.28
            and object_ratio <= 1.25
        )
        rj45_visible = bool(
            router_cues.get("status_ports_detected", False)
            and width_ratio >= 0.24
            and object_ratio <= 1.35
        )
        dongle_shape_detected = bool(
            compact_body_detected
            and rounded_extremity_detected
            and not antenna_detected
            and not rj45_visible
        )
        cues.update(
            {
                "main_object_vertical": main_object_vertical,
                "main_object_narrow": main_object_narrow,
                "main_object_ratio": object_ratio,
                "main_object_width_ratio": width_ratio,
                "main_object_height_ratio": height_ratio,
                "main_object_area_ratio": area_ratio,
                "main_object_detected": main_object_detected,
                "router_horizontal_detected": router_horizontal_detected,
                "rj45_visible": rj45_visible,
                "compact_body_detected": compact_body_detected,
                "rounded_extremity_detected": rounded_extremity_detected,
                "dongle_shape_detected": dongle_shape_detected,
                "image_width": width,
                "image_height": height,
                "main_object_x": min_column,
                "main_object_y": min_row,
                "main_object_width": object_width,
                "main_object_height": object_height,
            }
        )
        return cues
    except Exception:
        cues["rj45_visible"] = bool(router_cues.get("status_ports_detected", False))
        cues["router_horizontal_detected"] = bool(
            router_cues.get("router_body_detected", False)
            or router_cues.get("network_shape_detected", False)
            or float(router_cues.get("router_confidence", 0.0) or 0.0) >= 0.72
        )
        return cues


def _extract_vehicle_visual_cues_from_rgb_array(rgb_array) -> dict[str, bool]:
    cues = {
        "wheel_pair_detected": False,
        "body_shape_detected": False,
        "parking_surface_detected": False,
        "horizontal_vehicle_mass_detected": False,
    }
    if np is None or rgb_array is None:
        return cues
    try:
        height, width = rgb_array.shape[:2]
        if height < 80 or width < 80:
            return cues

        max_channel = rgb_array.max(axis=2)
        min_channel = rgb_array.min(axis=2)
        brightness = rgb_array.mean(axis=2)
        saturation_proxy = max_channel - min_channel

        lower_start = int(height * 0.62)
        lower_band = rgb_array[lower_start:, :, :]
        lower_brightness = brightness[lower_start:, :]
        lower_saturation = saturation_proxy[lower_start:, :]
        if lower_band.size > 0:
            gray_surface_mask = (
                (lower_saturation <= 26)
                & (lower_brightness >= 55)
                & (lower_brightness <= 205)
            )
            cues["parking_surface_detected"] = float(gray_surface_mask.mean()) >= 0.18

        lower_half_start = int(height * 0.45)
        dark_mask = brightness[lower_half_start:, :] <= 82
        if dark_mask.size > 0:
            column_density = dark_mask.mean(axis=0)
            wheel_segments: list[tuple[int, int]] = []
            segment_start: int | None = None
            for column_index, density in enumerate(column_density):
                if density >= 0.16:
                    if segment_start is None:
                        segment_start = column_index
                elif segment_start is not None:
                    wheel_segments.append((segment_start, column_index - 1))
                    segment_start = None
            if segment_start is not None:
                wheel_segments.append((segment_start, len(column_density) - 1))

            filtered_segments = [
                segment
                for segment in wheel_segments
                if width * 0.04 <= (segment[1] - segment[0] + 1) <= width * 0.22
            ]
            if len(filtered_segments) >= 2:
                for left_index, left_segment in enumerate(filtered_segments[:-1]):
                    for right_segment in filtered_segments[left_index + 1 :]:
                        horizontal_gap = right_segment[0] - left_segment[1]
                        if horizontal_gap >= width * 0.08:
                            cues["wheel_pair_detected"] = True
                            break
                    if cues["wheel_pair_detected"]:
                        break

        central_top = int(height * 0.24)
        central_bottom = int(height * 0.74)
        body_mask = (
            (saturation_proxy >= 34)
            & (brightness >= 45)
            & (brightness <= 235)
        )
        body_mask[:central_top, :] = False
        body_mask[central_bottom:, :] = False
        body_rows, body_columns = np.where(body_mask)
        if body_rows.size > 0 and body_columns.size > 0:
            min_row = int(body_rows.min())
            max_row = int(body_rows.max())
            min_column = int(body_columns.min())
            max_column = int(body_columns.max())
            body_width = max_column - min_column + 1
            body_height = max_row - min_row + 1
            body_ratio = body_width / max(body_height, 1)
            body_area_ratio = float(body_mask.mean())
            center_x = min_column + body_width / 2
            if (
                body_ratio >= 1.35
                and body_width >= width * 0.28
                and body_height >= height * 0.12
                and body_height <= height * 0.52
                and abs(center_x - (width / 2)) <= width * 0.24
                and body_area_ratio >= 0.035
            ):
                cues["body_shape_detected"] = True
                if body_width >= width * 0.38:
                    cues["horizontal_vehicle_mass_detected"] = True
        return cues
    except Exception:
        return cues


def _extract_network_equipment_visual_cues_from_rgb_array(rgb_array) -> dict[str, bool | float]:
    cues = {
        "router_body_detected": False,
        "vertical_antennas_detected": False,
        "status_ports_detected": False,
        "network_shape_detected": False,
        "antenna_score": 0.0,
        "antenna_candidate_score": 0.0,
        "router_confidence": 0.0,
        "router_antenna_left_detected": False,
        "router_antenna_right_detected": False,
        "router_antenna_count": 0,
    }
    if np is None or rgb_array is None:
        return cues
    try:
        height, width = rgb_array.shape[:2]
        if height < 80 or width < 80:
            return cues

        rgb_float = rgb_array.astype(float)
        brightness = rgb_float.mean(axis=2)
        saturation_proxy = rgb_float.max(axis=2) - rgb_float.min(axis=2)
        dark_mask = brightness <= 108
        body_top = int(height * 0.28)
        body_bottom = int(height * 0.78)
        central_dark = dark_mask[body_top:body_bottom, :]
        body_rows, body_columns = np.where(central_dark)
        if body_rows.size > 0 and body_columns.size > 0:
            min_row = int(body_rows.min()) + body_top
            max_row = int(body_rows.max()) + body_top
            min_column = int(body_columns.min())
            max_column = int(body_columns.max())
            body_width = max_column - min_column + 1
            body_height = max_row - min_row + 1
            body_ratio = body_width / max(body_height, 1)
            center_x = min_column + body_width / 2
            center_y = min_row + body_height / 2
            if (
                body_ratio >= 1.7
                and body_width >= width * 0.24
                and body_height >= height * 0.08
                and body_height <= height * 0.52
                and abs(center_x - (width / 2)) <= width * 0.26
                and center_y >= height * 0.30
                and center_y <= height * 0.74
            ):
                cues["router_body_detected"] = True
                cues["network_shape_detected"] = True
                body_anchor_left = min_column
                body_anchor_right = max_column
                body_anchor_top = min_row
                body_anchor_bottom = max_row
                router_band = dark_mask[min_row : max_row + 1, min_column : max_column + 1]
                if router_band.size > 0:
                    row_density = router_band.mean(axis=1)
                    dense_row_threshold = max(0.18, float(row_density.max()) * 0.55)
                    dense_rows = np.where(row_density >= dense_row_threshold)[0]
                    if dense_rows.size > 0:
                        body_anchor_top = min_row + int(dense_rows.min())
                        body_anchor_bottom = min_row + int(dense_rows.max())
                        dense_band = router_band[dense_rows.min() : dense_rows.max() + 1, :]
                        if dense_band.size > 0:
                            col_density = dense_band.mean(axis=0)
                            dense_col_threshold = max(0.22, float(col_density.max()) * 0.58)
                            dense_columns = np.where(col_density >= dense_col_threshold)[0]
                            if dense_columns.size > 0:
                                body_anchor_left = min_column + int(dense_columns.min())
                                body_anchor_right = min_column + int(dense_columns.max())
                body_anchor_width = max(body_anchor_right - body_anchor_left + 1, 1)
                body_anchor_height = max(body_anchor_bottom - body_anchor_top + 1, 1)

                antenna_search_left = max(0, body_anchor_left - int(width * 0.08))
                antenna_search_right = min(width, body_anchor_right + int(width * 0.08))
                antenna_search_top = max(0, body_anchor_top - int(height * 0.34))
                antenna_search_bottom = min(
                    height,
                    max(body_anchor_top + int(body_anchor_height * 0.16), body_anchor_top + 1),
                )
                antenna_brightness = brightness[
                    antenna_search_top:antenna_search_bottom,
                    antenna_search_left:antenna_search_right,
                ]
                antenna_saturation = saturation_proxy[
                    antenna_search_top:antenna_search_bottom,
                    antenna_search_left:antenna_search_right,
                ]
                antenna_dark = dark_mask[
                    antenna_search_top:antenna_search_bottom,
                    antenna_search_left:antenna_search_right,
                ]
                antenna_neutral = (
                    (antenna_saturation <= 42)
                    & (antenna_brightness >= 28)
                    & (antenna_brightness <= 248)
                )
                if antenna_brightness.size > 0:
                    row_reference = np.median(antenna_brightness, axis=1, keepdims=True)
                    antenna_contrast = antenna_neutral & (
                        np.abs(antenna_brightness - row_reference) >= 18
                    )
                    antenna_region = antenna_dark | antenna_contrast
                else:
                    antenna_region = antenna_dark
                if antenna_region.size > 0:
                    antenna_density = antenna_region.mean(axis=0)
                    min_segment_width = max(2, int(width * 0.008))
                    max_segment_width = max(min_segment_width + 1, int(width * 0.05))
                    segments: list[tuple[int, int]] = []
                    segment_start: int | None = None
                    for column_index, density in enumerate(antenna_density):
                        if density >= 0.22:
                            if segment_start is None:
                                segment_start = column_index
                        elif segment_start is not None:
                            segments.append((segment_start, column_index - 1))
                            segment_start = None
                    if segment_start is not None:
                        segments.append((segment_start, len(antenna_density) - 1))

                    antenna_score = 0.0
                    antenna_candidate_score = 0.0
                    strong_left_detected = False
                    strong_right_detected = False
                    for segment_start, segment_end in segments:
                        segment_width = segment_end - segment_start + 1
                        if segment_width < min_segment_width or segment_width > max_segment_width:
                            continue
                        segment_slice = antenna_region[:, segment_start : segment_end + 1]
                        segment_rows = np.where(segment_slice.any(axis=1))[0]
                        if segment_rows.size == 0:
                            continue
                        segment_height = int(segment_rows.max() - segment_rows.min() + 1)
                        segment_center = antenna_search_left + (segment_start + segment_end) / 2
                        segment_aspect_ratio = segment_height / max(segment_width, 1)
                        near_router_edge = (
                            segment_center <= body_anchor_left + body_anchor_width * 0.28
                            or segment_center >= body_anchor_right - body_anchor_width * 0.28
                        )
                        above_router = (
                            antenna_search_top + int(segment_rows.max())
                            <= body_anchor_top + int(body_anchor_height * 0.12)
                        )
                        candidate_height_ok = segment_height >= max(12, int(body_anchor_height * 0.1))
                        candidate_aspect_ok = segment_aspect_ratio >= 1.8
                        candidate_position_ok = near_router_edge or above_router
                        if candidate_height_ok and candidate_aspect_ok and candidate_position_ok:
                            candidate_height_score = min(
                                1.0,
                                segment_height / max(body_anchor_height * 0.42, 1),
                            )
                            candidate_aspect_score = min(1.0, segment_aspect_ratio / 5.5)
                            candidate_position_score = 1.0 if near_router_edge else 0.72
                            antenna_candidate_score = max(
                                antenna_candidate_score,
                                (candidate_height_score * 0.45)
                                + (candidate_aspect_score * 0.25)
                                + (candidate_position_score * 0.30),
                            )
                        if (
                            segment_height >= max(18, int(body_anchor_height * 0.15))
                            and segment_aspect_ratio >= 2.6
                            and (near_router_edge or above_router)
                        ):
                            if segment_center <= body_anchor_left + body_anchor_width * 0.20:
                                strong_left_detected = True
                            if segment_center >= body_anchor_right - body_anchor_width * 0.20:
                                strong_right_detected = True
                            height_score = min(
                                1.0,
                                segment_height / max(body_anchor_height * 0.55, 1),
                            )
                            aspect_score = min(1.0, segment_aspect_ratio / 7.5)
                            position_score = 1.0 if near_router_edge else 0.72
                            antenna_score = max(
                                antenna_score,
                                (height_score * 0.5) + (aspect_score * 0.25) + (position_score * 0.25),
                            )

                    def _detect_side_antenna(side: str) -> tuple[bool, float]:
                        edge_inner_ratio = 0.18
                        edge_outer_margin = int(width * 0.10)
                        if side == "left":
                            side_abs_left = max(0, body_anchor_left - edge_outer_margin)
                            side_abs_right = min(
                                width,
                                body_anchor_left + int(body_anchor_width * edge_inner_ratio),
                            )
                        else:
                            side_abs_left = max(
                                0,
                                body_anchor_right - int(body_anchor_width * edge_inner_ratio),
                            )
                            side_abs_right = min(width, body_anchor_right + edge_outer_margin)

                        roi_left = max(0, side_abs_left - antenna_search_left)
                        roi_right = min(antenna_region.shape[1], side_abs_right - antenna_search_left)
                        if roi_right - roi_left < min_segment_width:
                            return False, 0.0

                        side_region = antenna_region[:, roi_left:roi_right]
                        if side_region.size == 0:
                            return False, 0.0
                        side_density = side_region.mean(axis=0)
                        side_segments: list[tuple[int, int]] = []
                        segment_start: int | None = None
                        for column_index, density in enumerate(side_density):
                            if density >= 0.12:
                                if segment_start is None:
                                    segment_start = column_index
                            elif segment_start is not None:
                                side_segments.append((segment_start, column_index - 1))
                                segment_start = None
                        if segment_start is not None:
                            side_segments.append((segment_start, len(side_density) - 1))

                        best_score = 0.0
                        for segment_start, segment_end in side_segments:
                            segment_width = segment_end - segment_start + 1
                            if segment_width < 1 or segment_width > max(min_segment_width + 3, int(width * 0.035)):
                                continue
                            segment_slice = side_region[:, segment_start : segment_end + 1]
                            segment_rows = np.where(segment_slice.any(axis=1))[0]
                            if segment_rows.size == 0:
                                continue
                            segment_height = int(segment_rows.max() - segment_rows.min() + 1)
                            segment_center_abs = (
                                antenna_search_left
                                + roi_left
                                + (segment_start + segment_end) / 2
                            )
                            segment_aspect_ratio = segment_height / max(segment_width, 1)
                            segment_fill_ratio = float(segment_slice.mean())
                            segment_bottom_abs = antenna_search_top + int(segment_rows.max())
                            near_extremity = (
                                segment_center_abs <= body_anchor_left + body_anchor_width * 0.10
                                if side == "left"
                                else segment_center_abs >= body_anchor_right - body_anchor_width * 0.10
                            )
                            rises_from_body_edge = (
                                segment_bottom_abs <= body_anchor_top + int(body_anchor_height * 0.18)
                            )
                            if (
                                segment_height >= max(16, int(body_anchor_height * 0.22))
                                and segment_aspect_ratio >= 2.4
                                and segment_fill_ratio >= 0.18
                                and near_extremity
                                and rises_from_body_edge
                            ):
                                height_score = min(
                                    1.0,
                                    segment_height / max(body_anchor_height * 0.7, 1),
                                )
                                aspect_score = min(1.0, segment_aspect_ratio / 8.0)
                                fill_score = min(1.0, segment_fill_ratio / 0.55)
                                best_score = max(
                                    best_score,
                                    (height_score * 0.4) + (aspect_score * 0.3) + (fill_score * 0.3),
                                )
                        return best_score >= 0.34, round(float(best_score), 3)

                    left_detected, left_score = _detect_side_antenna("left")
                    right_detected, right_score = _detect_side_antenna("right")
                    left_detected = bool(left_detected or strong_left_detected)
                    right_detected = bool(right_detected or strong_right_detected)
                    antenna_count = int(left_detected) + int(right_detected)
                    cues["router_antenna_left_detected"] = left_detected
                    cues["router_antenna_right_detected"] = right_detected
                    cues["router_antenna_count"] = antenna_count
                    if antenna_count >= 2:
                        antenna_score = max(antenna_score, round((left_score + right_score) / 2, 3), 0.62)
                        antenna_candidate_score = max(
                            antenna_candidate_score,
                            round(max(left_score, right_score), 3),
                            0.58,
                        )

                    cues["antenna_score"] = round(float(antenna_score), 3)
                    cues["antenna_candidate_score"] = round(float(antenna_candidate_score), 3)
                    cues["vertical_antennas_detected"] = antenna_score >= 0.42 or antenna_count >= 2

                body_brightness = brightness[min_row : max_row + 1, min_column : max_column + 1]
                if body_brightness.size > 0:
                    lower_body_start = int(body_height * 0.46)
                    lower_body = body_brightness[lower_body_start:, :]
                    if lower_body.size > 0:
                        median_brightness = float(np.median(body_brightness))
                        contrast_mask = np.abs(lower_body - median_brightness) >= 18
                        cues["status_ports_detected"] = float(contrast_mask.mean()) >= 0.018
                router_confidence = 0.0
                if cues["router_body_detected"]:
                    router_confidence += 0.48
                if cues["network_shape_detected"]:
                    router_confidence += 0.17
                if cues["status_ports_detected"]:
                    router_confidence += 0.15
                router_confidence += min(
                    0.20,
                    max(float(cues["antenna_score"]), float(cues["antenna_candidate_score"])) * 0.20,
                )
                cues["router_confidence"] = round(min(router_confidence, 1.0), 3)
        return cues
    except Exception:
        return cues


def _extract_vehicle_visual_cues(prepared_image: PreparedImage | None) -> dict[str, bool]:
    cues = {
        "wheel_pair_detected": False,
        "body_shape_detected": False,
        "parking_surface_detected": False,
        "horizontal_vehicle_mass_detected": False,
    }
    decoded = _decode_prepared_image_for_generic_heuristics(prepared_image)
    if decoded is None:
        return cues
    if cv2 is None:
        return _extract_vehicle_visual_cues_from_rgb_array(decoded)
    try:
        height, width = decoded.shape[:2]
        if height < 80 or width < 80:
            return cues
        gray = cv2.cvtColor(decoded, cv2.COLOR_BGR2GRAY)
        blurred = cv2.medianBlur(gray, 5)
        circles = cv2.HoughCircles(
            blurred,
            cv2.HOUGH_GRADIENT,
            dp=1.2,
            minDist=max(24, width // 7),
            param1=90,
            param2=24,
            minRadius=max(10, min(height, width) // 28),
            maxRadius=max(28, min(height, width) // 5),
        )
        if circles is not None:
            detected_circles = circles[0]
            lower_circles = [
                circle
                for circle in detected_circles
                if circle[1] >= height * 0.35
            ]
            if len(lower_circles) >= 2:
                lower_circles = sorted(lower_circles, key=lambda circle: circle[0])
                for first_index, first_circle in enumerate(lower_circles[:-1]):
                    for second_circle in lower_circles[first_index + 1 :]:
                        radius_delta = abs(first_circle[2] - second_circle[2])
                        horizontal_gap = abs(first_circle[0] - second_circle[0])
                        if (
                            radius_delta <= max(8, min(first_circle[2], second_circle[2]) * 0.45)
                            and horizontal_gap >= width * 0.18
                        ):
                            cues["wheel_pair_detected"] = True
                            break
                    if cues["wheel_pair_detected"]:
                        break

        edges = cv2.Canny(gray, 70, 180)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (9, 5))
        closed_edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel, iterations=2)
        contours, _ = cv2.findContours(closed_edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            x, y, contour_width, contour_height = cv2.boundingRect(contour)
            area = contour_width * contour_height
            if area < (width * height) * 0.04:
                continue
            aspect_ratio = contour_width / max(contour_height, 1)
            center_x = x + contour_width / 2
            center_y = y + contour_height / 2
            if (
                aspect_ratio >= 1.35
                and contour_width >= width * 0.28
                and contour_height >= height * 0.12
                and contour_height <= height * 0.52
                and abs(center_x - (width / 2)) <= width * 0.24
                and center_y >= height * 0.28
                and center_y <= height * 0.72
            ):
                cues["body_shape_detected"] = True
                if contour_width >= width * 0.4:
                    cues["horizontal_vehicle_mass_detected"] = True
                break

        hsv = cv2.cvtColor(decoded, cv2.COLOR_BGR2HSV)
        lower_band = hsv[int(height * 0.62) :, :]
        if lower_band.size > 0:
            low_saturation = lower_band[:, :, 1] <= 55
            mid_value = (lower_band[:, :, 2] >= 45) & (lower_band[:, :, 2] <= 215)
            gray_surface_ratio = float((low_saturation & mid_value).mean())
            cues["parking_surface_detected"] = gray_surface_ratio >= 0.32

        if not any(cues.values()):
            rgb_decoded = cv2.cvtColor(decoded, cv2.COLOR_BGR2RGB)
            rgb_cues = _extract_vehicle_visual_cues_from_rgb_array(rgb_decoded)
            if any(rgb_cues.values()):
                return rgb_cues
        return cues
    except Exception:
        return _extract_vehicle_visual_cues_from_rgb_array(decoded)


def _extract_network_equipment_visual_cues(prepared_image: PreparedImage | None) -> dict[str, bool | float]:
    cues = {
        "router_body_detected": False,
        "vertical_antennas_detected": False,
        "status_ports_detected": False,
        "network_shape_detected": False,
        "router_antenna_left_detected": False,
        "router_antenna_right_detected": False,
        "router_antenna_count": 0,
    }
    decoded = _decode_prepared_image_for_generic_heuristics(prepared_image)
    if decoded is None:
        return cues
    if cv2 is None:
        return _extract_network_equipment_visual_cues_from_rgb_array(decoded)
    try:
        rgb_decoded = cv2.cvtColor(decoded, cv2.COLOR_BGR2RGB)
        return _extract_network_equipment_visual_cues_from_rgb_array(rgb_decoded)
    except Exception:
        return _extract_network_equipment_visual_cues_from_rgb_array(decoded)


def _image_likely_contains_vehicle(prepared_image: PreparedImage | None) -> bool:
    cues = _extract_vehicle_visual_cues(prepared_image)
    return (
        (cues["wheel_pair_detected"] and cues["body_shape_detected"])
        or (cues["wheel_pair_detected"] and cues["parking_surface_detected"])
        or (
            cues["body_shape_detected"]
            and cues["horizontal_vehicle_mass_detected"]
            and cues["parking_surface_detected"]
        )
    )


def _image_likely_contains_network_equipment(prepared_image: PreparedImage | None) -> bool:
    cues = _extract_network_equipment_visual_cues(prepared_image)
    return (
        (cues["router_body_detected"] and cues["vertical_antennas_detected"])
        or (cues["router_body_detected"] and cues["status_ports_detected"])
        or (
            cues["network_shape_detected"]
            and cues["vertical_antennas_detected"]
            and cues["status_ports_detected"]
        )
    )


def _build_network_equipment_fallback_objects(
    *,
    prepared_image: PreparedImage | None,
) -> list[str]:
    cues = _extract_network_equipment_visual_cues(prepared_image)
    router_confidence = float(cues.get("router_confidence", 0.0) or 0.0)
    antenna_score = float(cues.get("antenna_score", 0.0) or 0.0)
    antenna_left_detected = bool(cues.get("router_antenna_left_detected", False))
    antenna_right_detected = bool(cues.get("router_antenna_right_detected", False))
    antenna_count = int(cues.get("router_antenna_count", 0) or 0)
    antenna_detected = bool(
        cues["vertical_antennas_detected"]
        or antenna_score > 0.0
        or antenna_count >= 1
        or router_confidence >= 0.85
    )
    MULTIMODAL_LOGGER.info(
        "ROUTER_CONFIDENCE=%s ROUTER_ANTENNA_SCORE=%s ROUTER_ANTENNA_DETECTED=%s",
        router_confidence,
        antenna_score,
        antenna_detected,
    )
    MULTIMODAL_LOGGER.info("ROUTER_ANTENNA_LEFT_DETECTED=%s", antenna_left_detected)
    MULTIMODAL_LOGGER.info("ROUTER_ANTENNA_RIGHT_DETECTED=%s", antenna_right_detected)
    MULTIMODAL_LOGGER.info("ROUTER_ANTENNA_COUNT=%s", antenna_count)
    has_router_profile = cues["router_body_detected"] or cues["network_shape_detected"]
    if not has_router_profile:
        return []

    detected_objects = [GENERIC_VISIBLE_WIFI_ROUTER_LABEL]
    MULTIMODAL_LOGGER.info("DETECTED_OBJECTS_BEFORE_ANTENNA=%s", detected_objects)
    if antenna_detected:
        detected_objects.append(GENERIC_VISIBLE_NETWORK_ANTENNAS_LABEL)
    if cues["router_body_detected"] or cues["network_shape_detected"]:
        detected_objects.append(GENERIC_VISIBLE_NETWORK_CHASSIS_LABEL)
    if cues["status_ports_detected"]:
        detected_objects.append(GENERIC_VISIBLE_NETWORK_PORTS_LABEL)
    MULTIMODAL_LOGGER.info("DETECTED_OBJECTS_AFTER_ANTENNA=%s", detected_objects)
    return detected_objects


def _ensure_router_antennas_visible_object(
    *,
    prepared_image: PreparedImage | None,
    detected_objects: list[str],
) -> list[str]:
    if GENERIC_VISIBLE_WIFI_ROUTER_LABEL not in detected_objects:
        return detected_objects
    if GENERIC_VISIBLE_NETWORK_ANTENNAS_LABEL in detected_objects:
        return detected_objects

    cues = _extract_network_equipment_visual_cues(prepared_image)
    router_confidence = float(cues.get("router_confidence", 0.0) or 0.0)
    antenna_score = float(cues.get("antenna_score", 0.0) or 0.0)
    antenna_count = int(cues.get("router_antenna_count", 0) or 0)
    if not (
        cues["vertical_antennas_detected"]
        or antenna_score > 0.0
        or antenna_count >= 1
        or router_confidence >= 0.85
    ):
        return detected_objects

    insertion_index = detected_objects.index(GENERIC_VISIBLE_WIFI_ROUTER_LABEL) + 1
    return [
        *detected_objects[:insertion_index],
        GENERIC_VISIBLE_NETWORK_ANTENNAS_LABEL,
        *detected_objects[insertion_index:],
    ]


def _contains_router_only_non_visible_keyword(text: str) -> bool:
    normalized_text = _normalize_equipment_routing_text(text)
    return any(keyword in normalized_text for keyword in STRICT_ROUTER_ONLY_NON_VISIBLE_KEYWORDS)


def _normalize_router_only_removed_object_label(raw_label: str) -> str | None:
    normalized_label = _normalize_equipment_routing_text(raw_label)
    for label, keywords in STRICT_ROUTER_ONLY_REMOVAL_LABELS:
        if any(keyword in normalized_label for keyword in keywords):
            return label
    return None


def _vision_result_indicates_router_network_profile(
    vision_result: VisionAnalysisResult,
) -> bool:
    primary_equipment = vision_result.primary_equipment or ""
    primary_type, _ = _classify_equipment_visual_type(primary_equipment)
    normalized_text = _normalize_equipment_routing_text(
        " ".join(
            item
            for item in [
                primary_equipment,
                vision_result.analysis,
                vision_result.raw_output,
                *vision_result.detected_objects[:8],
            ]
            if item
        )
    )
    if primary_type in {"routeur", "routeur_wifi"}:
        return True
    if any(
        keyword in normalized_text
        for keyword in ("modem routeur", "routeur modem", "modem router", "router modem")
    ):
        return True
    if (
        primary_type == "modem"
        and any(keyword in normalized_text for keyword in ("wifi", "wi fi", "routeur", "router", "gateway", "cpe"))
    ):
        return True
    return any(
        _classify_equipment_visual_type(item)[0] in {"routeur", "routeur_wifi"}
        for item in vision_result.detected_objects
        if item
    )


def _vision_result_has_non_router_companion_objects(
    vision_result: VisionAnalysisResult,
) -> bool:
    router_only_related_types = {
        None,
        "routeur",
        "routeur_wifi",
        "antennes_reseau",
        "boitier_reseau",
        "voyant_ports",
        "modem_usb",
        "modem",
        "sim",
        "nano_sim",
        "micro_sim",
        "mini_sim",
        "esim",
        "switch",
        "borne_wifi",
        "antenne",
    }
    return any(
        _classify_equipment_visual_type(item)[0] not in router_only_related_types
        for item in vision_result.detected_objects
        if item
    )


def _extract_usb_modem_reclassification_brand(vision_result: VisionAnalysisResult) -> str | None:
    return _extract_usb_modem_reclassification_brand_from_context(vision_result=vision_result, ocr_result=None)


def _extract_usb_modem_reclassification_brand_from_context(
    *,
    vision_result: VisionAnalysisResult,
    ocr_result: OcrExtractionResult | None,
) -> str | None:
    normalized_text = _normalize_equipment_routing_text(
        " ".join(
            item
            for item in [
                *vision_result.detected_brands,
                vision_result.primary_equipment or "",
                vision_result.analysis,
                vision_result.raw_output,
                ocr_result.text if ocr_result is not None else "",
                *([region.text for region in ocr_result.text_regions[:8]] if ocr_result is not None else []),
            ]
            if item
        )
    )
    for brand, aliases in USB_MODEM_RECLASSIFICATION_BRAND_ALIASES.items():
        if any(alias in normalized_text for alias in aliases):
            return brand
    return None


def _llava_contains_usb_modem_hints(vision_result: VisionAnalysisResult) -> bool:
    normalized_text = _normalize_equipment_routing_text(
        " ".join(
            item
            for item in [
                vision_result.analysis,
                vision_result.raw_output,
                vision_result.primary_equipment or "",
                *vision_result.detected_objects[:8],
            ]
            if item
        )
    )
    return any(hint in normalized_text for hint in USB_MODEM_LLAVA_HINTS)


def _build_reclassified_usb_modem_raw_output(
    *,
    detected_objects: list[str],
    detected_brands: list[str],
    apparent_condition: str | None,
    detected_kpis: list[str],
    replacement_signals: list[str],
    recommendations: list[str],
) -> str:
    raw_output_lines = [
        "TYPE_IMAGE: modem_usb",
        "DETECTED_OBJECTS:",
        *(f"- {item}" for item in detected_objects),
    ]
    if detected_brands:
        raw_output_lines.append("BRANDS:")
        raw_output_lines.extend(f"- {brand}" for brand in detected_brands[:4])
    raw_output_lines.extend(
        [
            f"PRIMARY_EQUIPMENT: {GENERIC_VISIBLE_USB_MODEM_LABEL}",
            (
                f"APPARENT_CONDITION: {apparent_condition}"
                if apparent_condition
                else "APPARENT_CONDITION: non confirme visuellement"
            ),
            f"PROBABLE_USAGE: {_build_equipment_usage_summary('modem_usb')}",
        ]
    )
    if detected_kpis:
        raw_output_lines.append("KPI:")
        raw_output_lines.extend(f"- {item}" for item in detected_kpis[:4])
    if replacement_signals:
        raw_output_lines.append("REPLACEMENT_SIGNALS:")
        raw_output_lines.extend(f"- {item}" for item in replacement_signals[:4])
    if recommendations:
        raw_output_lines.append("RECOMMENDATIONS:")
        raw_output_lines.extend(f"- {item}" for item in recommendations[:4])
    return "\n".join(raw_output_lines)


def _compute_usb_modem_reclassification_score(
    *,
    brand: str | None,
    usb_modem_cues: dict[str, bool | float | int],
    router_only_objects: bool,
    llava_usb_hint_detected: bool,
    antenna_count: int,
) -> float:
    score = 0.0
    main_object_ratio = float(usb_modem_cues.get("main_object_ratio", 0.0) or 0.0)
    main_object_width_ratio = float(usb_modem_cues.get("main_object_width_ratio", 0.0) or 0.0)
    main_object_height_ratio = float(usb_modem_cues.get("main_object_height_ratio", 0.0) or 0.0)
    antenna_detected = bool(usb_modem_cues.get("antenna_visible", False))
    rj45_visible = bool(usb_modem_cues.get("rj45_visible", False))
    router_horizontal_detected = bool(usb_modem_cues.get("router_horizontal_detected", False))
    dongle_shape_detected = bool(usb_modem_cues.get("dongle_shape_detected", False))

    if brand in USB_MODEM_RECLASSIFICATION_BRANDS:
        score += 0.45
    if main_object_ratio > 2.0:
        score += 0.35
    if dongle_shape_detected:
        score += 0.35
    if llava_usb_hint_detected:
        score += 0.25
    if router_only_objects:
        score += 0.10
    if not antenna_detected and antenna_count == 0:
        score += 0.10
    if main_object_width_ratio <= 0.22 and main_object_height_ratio <= 0.82:
        score += 0.10

    if antenna_detected or antenna_count > 0:
        score -= 0.60
    if rj45_visible:
        score -= 0.10
    if router_horizontal_detected:
        score -= 0.15
    if main_object_width_ratio >= 0.52:
        score -= 0.20

    return max(0.0, min(round(score, 2), 1.0))


def _reclassify_network_device(
    *,
    vision_result: VisionAnalysisResult,
    prepared_image: PreparedImage | None,
    detected_objects: list[str],
    ocr_result: OcrExtractionResult | None = None,
) -> VisionAnalysisResult:
    original_objects = _dedupe_items([item for item in detected_objects if item], 8)
    original_image_type = vision_result.image_type
    brand = _extract_usb_modem_reclassification_brand_from_context(
        vision_result=vision_result,
        ocr_result=ocr_result,
    )
    usb_modem_cues = _extract_usb_modem_visual_cues(prepared_image)
    router_cues = _extract_network_equipment_visual_cues(prepared_image)
    antenna_count = int(router_cues.get("router_antenna_count", 0) or 0)
    antenna_detected = bool(usb_modem_cues.get("antenna_visible", False))
    rj45_visible = bool(usb_modem_cues.get("rj45_visible", False))
    router_horizontal_detected = bool(usb_modem_cues.get("router_horizontal_detected", False))
    main_object_ratio = float(usb_modem_cues.get("main_object_ratio", 0.0) or 0.0)
    main_object_width = int(usb_modem_cues.get("main_object_width", 0) or 0)
    main_object_height = int(usb_modem_cues.get("main_object_height", 0) or 0)
    image_width = int(usb_modem_cues.get("image_width", 0) or 0)
    image_height = int(usb_modem_cues.get("image_height", 0) or 0)
    main_object_bbox = (
        int(usb_modem_cues.get("main_object_x", 0) or 0),
        int(usb_modem_cues.get("main_object_y", 0) or 0),
        main_object_width,
        main_object_height,
    )
    dongle_shape_detected = bool(usb_modem_cues.get("dongle_shape_detected", False))
    llava_usb_hint_detected = _llava_contains_usb_modem_hints(vision_result)
    router_profile_detected = _vision_result_indicates_router_network_profile(vision_result)
    has_non_router_companions = _vision_result_has_non_router_companion_objects(vision_result)
    router_only_objects = (
        len(original_objects) == 2
        and set(original_objects) == {GENERIC_VISIBLE_WIFI_ROUTER_LABEL, GENERIC_VISIBLE_NETWORK_CHASSIS_LABEL}
    )
    usb_modem_score = _compute_usb_modem_reclassification_score(
        brand=brand,
        usb_modem_cues=usb_modem_cues,
        router_only_objects=router_only_objects,
        llava_usb_hint_detected=llava_usb_hint_detected,
        antenna_count=antenna_count,
    )
    MULTIMODAL_LOGGER.info(
        "USB_MODEM_RECLASSIFIER_START image_type=%s original_objects=%s",
        original_image_type,
        original_objects,
    )
    MULTIMODAL_LOGGER.info(
        "USB_MODEM_CLASSIFIER_START brand=%s original_image_type=%s original_objects=%s",
        brand or "none",
        original_image_type,
        original_objects,
    )
    reclassification_triggered = bool(
        router_profile_detected
        and not has_non_router_companions
        and usb_modem_score >= USB_MODEM_RECLASSIFICATION_SCORE_THRESHOLD
    )
    reason = (
        f"brand={brand or 'none'}; antenna_detected={antenna_detected}; antenna_count={antenna_count}; "
        f"rj45_visible={rj45_visible}; router_horizontal_detected={router_horizontal_detected}; "
        f"router_profile_detected={router_profile_detected}; has_non_router_companions={has_non_router_companions}; "
        f"router_only_objects={router_only_objects}; main_object_detected={usb_modem_cues.get('main_object_detected', False)}; "
        f"main_object_ratio={main_object_ratio}; main_object_narrow={usb_modem_cues.get('main_object_narrow', False)}; "
        f"dongle_shape_detected={dongle_shape_detected}; llava_usb_hint_detected={llava_usb_hint_detected}; "
        f"image_width={image_width}; image_height={image_height}; main_object_bbox={main_object_bbox}; "
        f"object_width={main_object_width}; object_height={main_object_height}"
    )
    MULTIMODAL_LOGGER.info("USB_MODEM_BRAND_DETECTED=%s", brand or "none")
    MULTIMODAL_LOGGER.info("USB_MODEM_RATIO=%s", main_object_ratio)
    MULTIMODAL_LOGGER.info("USB_MODEM_SCORE=%s", usb_modem_score)
    if not reclassification_triggered:
        MULTIMODAL_LOGGER.info("USB_MODEM_CLASSIFIER_DECISION=%s", "keep_router_profile")
        MULTIMODAL_LOGGER.info("USB_MODEM_CLASSIFIER_REASON=%s", reason)
        MULTIMODAL_LOGGER.info("USB_MODEM_RECLASSIFICATION_TRIGGERED=%s", reclassification_triggered)
        MULTIMODAL_LOGGER.info("USB_MODEM_REASON=%s", reason)
        MULTIMODAL_LOGGER.info("ORIGINAL_IMAGE_TYPE=%s", original_image_type)
        MULTIMODAL_LOGGER.info("NEW_IMAGE_TYPE=%s", original_image_type)
        MULTIMODAL_LOGGER.info("ORIGINAL_OBJECTS=%s", original_objects)
        MULTIMODAL_LOGGER.info("NEW_OBJECTS=%s", original_objects)
        return vision_result

    new_objects = [
        GENERIC_VISIBLE_USB_MODEM_LABEL,
        GENERIC_VISIBLE_MOBILE_CONNECTIVITY_CHASSIS_LABEL,
    ]
    reclassified_result = replace(
        vision_result,
        image_type="modem_usb",
        analysis="Le visuel montre un modem USB avec un boitier de connectivite mobile visible.",
        detected_objects=new_objects,
        primary_equipment=GENERIC_VISIBLE_USB_MODEM_LABEL,
        probable_usage=_build_equipment_usage_summary("modem_usb"),
        raw_output=_build_reclassified_usb_modem_raw_output(
            detected_objects=new_objects,
            detected_brands=vision_result.detected_brands,
            apparent_condition=vision_result.apparent_condition,
            detected_kpis=vision_result.detected_kpis,
            replacement_signals=vision_result.replacement_signals,
            recommendations=vision_result.recommendations,
        ),
    )
    MULTIMODAL_LOGGER.info("USB_MODEM_CLASSIFIER_DECISION=%s", "reclassify_modem_usb")
    MULTIMODAL_LOGGER.info("USB_MODEM_CLASSIFIER_REASON=%s", reason)
    MULTIMODAL_LOGGER.info("USB_MODEM_RECLASSIFICATION_TRIGGERED=%s", reclassification_triggered)
    MULTIMODAL_LOGGER.info("USB_MODEM_REASON=%s", reason)
    MULTIMODAL_LOGGER.info("ORIGINAL_IMAGE_TYPE=%s", original_image_type)
    MULTIMODAL_LOGGER.info("NEW_IMAGE_TYPE=%s", reclassified_result.image_type)
    MULTIMODAL_LOGGER.info("ORIGINAL_OBJECTS=%s", original_objects)
    MULTIMODAL_LOGGER.info("NEW_OBJECTS=%s", new_objects)
    return reclassified_result


def sanitize_equipment_detected_objects(
    *,
    question_type: str,
    prepared_image: PreparedImage | None,
    ocr_result: OcrExtractionResult,
    vision_result: VisionAnalysisResult,
) -> tuple[list[str], list[str], list[str], bool]:
    raw_objects = _dedupe_items(
        [item for item in vision_result.detected_objects if item],
        8,
    )
    MULTIMODAL_LOGGER.info("RAW_VISION_OBJECTS=%s", raw_objects)
    if (
        question_type != QUESTION_TYPE_EQUIPMENT_DETECTION
        or vision_result.image_type not in {"equipement", "routeur_wifi"}
        or vision_result.model == "vision-fallback"
    ):
        MULTIMODAL_LOGGER.info("SANITIZED_VISION_OBJECTS=%s", raw_objects)
        return raw_objects, raw_objects, [], False

    visible_text = _normalize_equipment_routing_text(
        " ".join(
            item
            for item in [
                ocr_result.text,
                *ocr_result.lines[:12],
            ]
            if item
        )
    )
    if any(keyword in visible_text for keyword in STRICT_ROUTER_ONLY_EXTRA_VISIBLE_HINTS):
        MULTIMODAL_LOGGER.info("SANITIZED_VISION_OBJECTS=%s", raw_objects)
        return raw_objects, raw_objects, [], False

    router_visible_objects = _detect_router_only_visible_objects(
        prepared_image=prepared_image,
        ocr_result=ocr_result,
    )
    router_profile_detected = bool(router_visible_objects) or (
        _vision_result_indicates_router_network_profile(vision_result)
        and not _vision_result_has_non_router_companion_objects(vision_result)
    )
    if not router_profile_detected:
        MULTIMODAL_LOGGER.info("SANITIZED_VISION_OBJECTS=%s", raw_objects)
        return raw_objects, raw_objects, [], False

    if not router_visible_objects:
        router_visible_objects = [GENERIC_VISIBLE_WIFI_ROUTER_LABEL]

    removed_hallucinated_objects = _dedupe_items(
        [
            normalized_label
            for normalized_label in (
                _normalize_router_only_removed_object_label(item)
                for item in raw_objects
            )
            if normalized_label
        ],
        8,
    )
    sanitized_objects = _dedupe_items(
        _ensure_router_antennas_visible_object(
            prepared_image=prepared_image,
            detected_objects=router_visible_objects,
        ),
        8,
    )
    MULTIMODAL_LOGGER.info("SANITIZED_VISION_OBJECTS=%s", sanitized_objects)
    if removed_hallucinated_objects:
        MULTIMODAL_LOGGER.info(
            "REMOVED_HALLUCINATED_OBJECTS=%s",
            removed_hallucinated_objects,
        )
    return raw_objects, sanitized_objects, removed_hallucinated_objects, True


def _detect_router_only_visible_objects(
    *,
    prepared_image: PreparedImage | None,
    ocr_result: OcrExtractionResult,
) -> list[str]:
    router_visible_objects = _build_network_equipment_fallback_objects(
        prepared_image=prepared_image,
    )
    if not router_visible_objects:
        return []

    visible_text = _normalize_equipment_routing_text(
        " ".join(
            item
            for item in [
                ocr_result.text,
                *ocr_result.lines[:12],
            ]
            if item
        )
    )
    if any(keyword in visible_text for keyword in STRICT_ROUTER_ONLY_EXTRA_VISIBLE_HINTS):
        return []
    return router_visible_objects


def _inventory_is_strict_router_visible_only(
    inventory: list[EquipmentVisualInventoryItem],
) -> bool:
    type_keys = {
        item.type_key
        for item in inventory
        if item.type_key is not None
    }
    return bool(type_keys) and "routeur_wifi" in type_keys and type_keys.issubset(STRICT_ROUTER_ONLY_VISIBLE_TYPE_KEYS)


def _filter_router_only_non_visible_entries(entries: list[str]) -> list[str]:
    return _dedupe_items(
        [
            entry
            for entry in entries
            if entry and not _contains_router_only_non_visible_keyword(entry)
        ],
        8,
    )


def _sanitize_router_only_answer_text(answer: str) -> str:
    fallback_answer = "Le visuel montre un routeur Wi-Fi avec des composants reseau visibles."
    if not answer.strip():
        return fallback_answer

    kept_lines = [
        line.strip()
        for line in answer.splitlines()
        if line.strip() and not _contains_router_only_non_visible_keyword(line)
    ]
    sanitized_answer = "\n".join(kept_lines).strip()
    if sanitized_answer and not _contains_router_only_non_visible_keyword(sanitized_answer):
        return sanitized_answer
    return fallback_answer


def _sanitize_router_only_alert_summary(alert_summary: str | None) -> str | None:
    if not alert_summary:
        return alert_summary
    if _contains_router_only_non_visible_keyword(alert_summary):
        return "Routeur Wi-Fi visible avec composants reseau apparents."
    return alert_summary


def _sanitize_router_only_equipment_details(
    *,
    equipment_details: EquipmentDocumentDetails | None,
    inventory: list[EquipmentVisualInventoryItem],
    vision_result: VisionAnalysisResult,
) -> EquipmentDocumentDetails | None:
    if equipment_details is None or not _inventory_is_strict_router_visible_only(inventory):
        return equipment_details

    sanitized_detected_issues = _filter_router_only_non_visible_entries(
        equipment_details.detected_issues,
    )
    sanitized_maintenance_recommendations = _filter_router_only_non_visible_entries(
        equipment_details.maintenance_recommendations,
    )
    if not _has_visual_replacement_evidence(
        issues=sanitized_detected_issues,
        replacement_signals=vision_result.replacement_signals,
    ):
        sanitized_maintenance_recommendations = _dedupe_items(
            [
                *sanitized_maintenance_recommendations,
                EQUIPMENT_NO_REPLACEMENT_NOTICE,
            ],
            4,
        )

    visible_condition = (
        equipment_details.visible_condition
        if equipment_details.visible_condition
        and not _contains_router_only_non_visible_keyword(equipment_details.visible_condition)
        else vision_result.apparent_condition or "non confirme visuellement"
    )
    summary = (
        f"{_describe_equipment_detection_count(inventory)}, "
        f"principal {GENERIC_VISIBLE_WIFI_ROUTER_LABEL}, "
        f"etat {visible_condition}, "
        f"criticite {equipment_details.criticality_score}/100."
    )
    return replace(
        equipment_details,
        equipment_type="routeur_wifi",
        operator=None,
        sim_information=None,
        label_information=", ".join(item.raw_label for item in inventory[:4]) or None,
        usage_summary=_build_equipment_usage_summary("routeur_wifi"),
        detected_issues=sanitized_detected_issues,
        maintenance_recommendations=sanitized_maintenance_recommendations[:4],
        summary=summary,
    )


def _sanitize_network_equipment_objects(
    *,
    parsed_answer: FinalImageAnswer,
    inventory: list[EquipmentVisualInventoryItem],
) -> FinalImageAnswer:
    if not _inventory_is_strict_router_visible_only(inventory):
        return parsed_answer

    return replace(
        parsed_answer,
        answer=_sanitize_router_only_answer_text(parsed_answer.answer),
        detected_kpis=_filter_router_only_non_visible_entries(parsed_answer.detected_kpis),
        recommendations=_filter_router_only_non_visible_entries(parsed_answer.recommendations),
        detected_anomalies=_filter_router_only_non_visible_entries(parsed_answer.detected_anomalies),
        probable_causes=_filter_router_only_non_visible_entries(parsed_answer.probable_causes),
        alert_summary=_sanitize_router_only_alert_summary(parsed_answer.alert_summary),
    )


def _build_router_only_sanitized_vision_result(
    *,
    vision_result: VisionAnalysisResult,
    router_visible_objects: list[str],
) -> VisionAnalysisResult:
    apparent_condition = (
        vision_result.apparent_condition
        if vision_result.apparent_condition
        and not _contains_router_only_non_visible_keyword(vision_result.apparent_condition)
        else None
    )
    detected_brands = _dedupe_items(
        [
            brand
            for brand in vision_result.detected_brands
            if brand and not _contains_router_only_non_visible_keyword(brand)
        ],
        3,
    )
    sanitized_kpis = _filter_router_only_non_visible_entries(vision_result.detected_kpis)
    sanitized_recommendations = _filter_router_only_non_visible_entries(vision_result.recommendations)
    sanitized_replacement_signals = _filter_router_only_non_visible_entries(vision_result.replacement_signals)
    raw_output_lines = [
        "TYPE_IMAGE: equipement",
        "DETECTED_OBJECTS:",
        *(f"- {item}" for item in router_visible_objects),
        f"PRIMARY_EQUIPMENT: {GENERIC_VISIBLE_WIFI_ROUTER_LABEL}",
        (
            f"APPARENT_CONDITION: {apparent_condition}"
            if apparent_condition
            else "APPARENT_CONDITION: non confirme visuellement"
        ),
        f"PROBABLE_USAGE: {_build_equipment_usage_summary('routeur_wifi')}",
    ]
    if sanitized_kpis:
        raw_output_lines.append("KPI:")
        raw_output_lines.extend(f"- {item}" for item in sanitized_kpis)
    if sanitized_replacement_signals:
        raw_output_lines.append("REPLACEMENT_SIGNALS:")
        raw_output_lines.extend(f"- {item}" for item in sanitized_replacement_signals)
    if sanitized_recommendations:
        raw_output_lines.append("RECOMMENDATIONS:")
        raw_output_lines.extend(f"- {item}" for item in sanitized_recommendations)

    return replace(
        vision_result,
        analysis="Le visuel montre un routeur Wi-Fi avec des composants reseau visibles.",
        detected_kpis=sanitized_kpis,
        detected_objects=router_visible_objects,
        detected_operators=[],
        sim_types=[],
        primary_equipment=GENERIC_VISIBLE_WIFI_ROUTER_LABEL,
        apparent_condition=apparent_condition,
        probable_usage=_build_equipment_usage_summary("routeur_wifi"),
        replacement_signals=sanitized_replacement_signals,
        recommendations=sanitized_recommendations,
        raw_output="\n".join(raw_output_lines),
    )


def _post_process_equipment_direct_vision_result(
    *,
    question_type: str,
    prepared_image: PreparedImage | None,
    ocr_result: OcrExtractionResult,
    vision_result: VisionAnalysisResult,
) -> tuple[VisionAnalysisResult, list[str], bool]:
    raw_objects, sanitized_objects, removed_hallucinated_objects, sanitizer_applied = (
        sanitize_equipment_detected_objects(
            question_type=question_type,
            prepared_image=prepared_image,
            ocr_result=ocr_result,
            vision_result=vision_result,
        )
    )
    if not sanitizer_applied:
        return vision_result, [], False
    sanitized_result = _build_router_only_sanitized_vision_result(
        vision_result=vision_result,
        router_visible_objects=sanitized_objects,
    )
    if removed_hallucinated_objects or raw_objects != sanitized_result.detected_objects:
        MULTIMODAL_LOGGER.info(
            "event=image_vision_equipment_postprocessed profile=router_visible_only removed_objects=%s detected_objects=%s",
            removed_hallucinated_objects,
            sanitized_result.detected_objects,
        )
    MULTIMODAL_LOGGER.info("DIRECT_VISION_SANITIZER_APPLIED = TRUE")
    MULTIMODAL_LOGGER.info(
        "REMOVED_UNCONFIRMED_OBJECTS = %s",
        removed_hallucinated_objects,
    )
    MULTIMODAL_LOGGER.info(
        "FINAL_EQUIPMENT_OBJECTS = %s",
        sanitized_result.detected_objects,
    )
    return sanitized_result, removed_hallucinated_objects, True


def _sanitize_direct_vision_equipment_context(
    *,
    question: str,
    ocr_result: OcrExtractionResult,
    vision_result: VisionAnalysisResult,
) -> OcrExtractionResult:
    inventory = _build_visual_equipment_inventory(
        question=question,
        ocr_result=ocr_result,
        vision_result=vision_result,
    )
    sanitized_equipment_details = _sanitize_router_only_equipment_details(
        equipment_details=ocr_result.equipment_details,
        inventory=inventory,
        vision_result=vision_result,
    )
    if sanitized_equipment_details is ocr_result.equipment_details:
        return ocr_result
    return replace(
        ocr_result,
        equipment_details=sanitized_equipment_details,
    )


def _infer_generic_visible_fallback_objects(
    *,
    prepared_image: PreparedImage | None,
    filename: str | None,
    ocr_result: OcrExtractionResult,
) -> list[str]:
    normalized_context = _normalize_equipment_routing_text(
        " ".join(
            item
            for item in [
                filename or "",
                ocr_result.text,
                *ocr_result.lines[:12],
            ]
            if item
        )
    )

    if _image_likely_contains_vehicle(prepared_image) or any(
        hint in normalized_context for hint in GENERIC_FALLBACK_FILENAME_HINTS["vehicule"]
    ):
        return [
            GENERIC_VISIBLE_VEHICLE_LABEL,
            GENERIC_VISIBLE_WHEELS_LABEL,
            GENERIC_VISIBLE_BODY_LABEL,
            GENERIC_VISIBLE_PARKING_LABEL,
            GENERIC_VISIBLE_OUTDOOR_LABEL,
        ]

    network_objects = _build_network_equipment_fallback_objects(
        prepared_image=prepared_image,
    )
    if network_objects:
        return network_objects

    if any(hint in normalized_context for hint in GENERIC_FALLBACK_FILENAME_HINTS["informatique"]):
        return [
            GENERIC_VISIBLE_IT_LABEL,
            "Ecran ou surface d'affichage visible",
            "Poste de travail ou support visible",
        ]

    if any(hint in normalized_context for hint in GENERIC_FALLBACK_FILENAME_HINTS["mobilier"]):
        return [
            GENERIC_VISIBLE_FURNITURE_LABEL,
            "Surface ou plan de travail visible",
        ]

    if any(hint in normalized_context for hint in GENERIC_FALLBACK_FILENAME_HINTS["industriel"]):
        return [
            GENERIC_VISIBLE_INDUSTRIAL_LABEL,
            "Zone technique ou atelier visible",
        ]

    if any(hint in normalized_context for hint in GENERIC_FALLBACK_FILENAME_HINTS["exterieur"]):
        return [
            EQUIPMENT_NEUTRAL_CONTEXT_VISIBLE_LABEL,
            GENERIC_VISIBLE_OUTDOOR_LABEL,
        ]

    return []


def _is_telecom_equipment_type(type_key: str | None) -> bool:
    return type_key in {
        "smartphone",
        "routeur",
        "routeur_wifi",
        "antennes_reseau",
        "boitier_reseau",
        "voyant_ports",
        "modem_usb",
        "modem",
        "sim",
        "nano_sim",
        "micro_sim",
        "mini_sim",
        "esim",
        "cable_usb",
        "switch",
        "borne_wifi",
        "antenne",
        "accessoire",
        "infrastructure",
    }


def _has_non_telecom_visible_inventory(inventory: list[EquipmentVisualInventoryItem]) -> bool:
    return any(
        item.type_key is not None
        and not _is_telecom_equipment_type(item.type_key)
        and item.raw_label not in {EQUIPMENT_NEUTRAL_PRIMARY_VISIBLE_LABEL, EQUIPMENT_NEUTRAL_CONTEXT_VISIBLE_LABEL}
        for item in inventory
    )


def _has_telecom_equipment_fallback_hints(
    *,
    ocr_result: OcrExtractionResult,
    vision_result: VisionAnalysisResult,
) -> bool:
    visible_text = " ".join(
        item
        for item in [
            ocr_result.text,
            *ocr_result.lines[:12],
            vision_result.primary_equipment or "",
            *vision_result.detected_objects[:8],
            *vision_result.detected_brands[:6],
            *vision_result.detected_operators[:6],
            *vision_result.sim_types[:6],
            (
                ocr_result.equipment_details.brand
                if ocr_result.equipment_details is not None and ocr_result.equipment_details.brand
                else ""
            ),
            (
                ocr_result.equipment_details.model
                if ocr_result.equipment_details is not None and ocr_result.equipment_details.model
                else ""
            ),
            (
                ocr_result.equipment_details.operator
                if ocr_result.equipment_details is not None and ocr_result.equipment_details.operator
                else ""
            ),
            (
                ocr_result.equipment_details.sim_information
                if ocr_result.equipment_details is not None and ocr_result.equipment_details.sim_information
                else ""
            ),
        ]
        if item
    )
    normalized_visible_text = _normalize_equipment_routing_text(visible_text)
    if any(hint in normalized_visible_text for hint in TELECOM_EQUIPMENT_VISIBLE_HINTS):
        return True
    if vision_result.detected_operators or vision_result.sim_types:
        return True
    detected_type_keys = [
        _classify_equipment_visual_type(item)[0]
        for item in [
            vision_result.primary_equipment or "",
            *vision_result.detected_objects,
        ]
        if item
    ]
    return any(_is_telecom_equipment_type(type_key) for type_key in detected_type_keys)


def _build_generic_equipment_inventory(
    *,
    telecom_hints_confirmed: bool,
) -> list[EquipmentVisualInventoryItem]:
    if telecom_hints_confirmed:
        return [
            EquipmentVisualInventoryItem(
                raw_label="Terminal mobile identifie visuellement",
                type_key="terminal_mobile_probable",
                type_label="Terminal mobile",
                brand=None,
                confidence_label=EQUIPMENT_CONFIDENCE_PROBABLE,
                usage_probable="Appels, messagerie et applications professionnelles.",
            ),
            EquipmentVisualInventoryItem(
                raw_label="Routeur ou modem reseau apparent",
                type_key="routeur_modem_reseau_probable",
                type_label="Routeur ou modem reseau",
                brand=None,
                confidence_label=EQUIPMENT_CONFIDENCE_PROBABLE,
                usage_probable="Distribution de la connexion Internet ou Wi-Fi.",
            ),
            EquipmentVisualInventoryItem(
                raw_label="Modem USB / cle 4G apparent",
                type_key="modem_usb_4g_probable",
                type_label="Modem USB / cle 4G",
                brand=None,
                confidence_label=EQUIPMENT_CONFIDENCE_PROBABLE,
                usage_probable="Acces Internet mobile ponctuel ou de secours.",
            ),
            EquipmentVisualInventoryItem(
                raw_label="Carte SIM ou support SIM visible",
                type_key="carte_sim_support_probable",
                type_label="Carte SIM ou support SIM",
                brand=None,
                confidence_label=EQUIPMENT_CONFIDENCE_PROBABLE,
                usage_probable="Identification de la ligne mobile et acces au reseau operateur.",
            ),
            EquipmentVisualInventoryItem(
                raw_label="Accessoires telecom visibles",
                type_key="accessoire_probable",
                type_label="Accessoire telecom",
                brand=None,
                confidence_label=EQUIPMENT_CONFIDENCE_PROBABLE,
                usage_probable="Support de connexion, d'alimentation ou d'activation.",
            ),
        ]
    return [
        EquipmentVisualInventoryItem(
            raw_label=EQUIPMENT_NEUTRAL_PRIMARY_VISIBLE_LABEL,
            type_key="objet_visible_non_confirme",
            type_label="Objet principal visible",
            brand=None,
            confidence_label=EQUIPMENT_CONFIDENCE_PROBABLE,
            usage_probable=EQUIPMENT_NEUTRAL_USAGE_NOTICE,
        ),
        EquipmentVisualInventoryItem(
            raw_label=EQUIPMENT_NEUTRAL_CONTEXT_VISIBLE_LABEL,
            type_key="support_visible",
            type_label="Environnement ou support",
            brand=None,
            confidence_label=EQUIPMENT_CONFIDENCE_PROBABLE,
            usage_probable=EQUIPMENT_NEUTRAL_USAGE_NOTICE,
        ),
    ]


def _resolve_primary_equipment_label(
    *,
    equipment_type: str | None,
    brand: str | None,
    vision_result: VisionAnalysisResult,
    detected_objects: list[str],
) -> str:
    if vision_result.primary_equipment:
        return vision_result.primary_equipment
    if equipment_type == "routeur" and brand:
        return f"Routeur {brand}".strip()
    if equipment_type == "smartphone" and brand:
        return f"Smartphone {brand}".strip()
    if equipment_type == "modem" and brand:
        return f"Modem {brand}".strip()
    if detected_objects:
        return detected_objects[0]
    return _format_image_type_label(equipment_type or "appareil_inconnu")


def _build_equipment_visible_condition(
    *,
    issues: list[str],
    vision_result: VisionAnalysisResult,
) -> str:
    if vision_result.apparent_condition:
        return vision_result.apparent_condition
    if issues:
        return "etat physique suspect"
    return "fonctionnel"


def _build_equipment_maintenance_recommendations(
    *,
    detected_objects: list[str],
    issues: list[str],
    primary_equipment: str,
    sim_types: list[str],
    replacement_signals: list[str],
) -> list[str]:
    recommendations: list[str] = []
    normalized_objects = " ".join(detected_objects).lower()
    normalized_signals = " ".join(replacement_signals).lower()
    has_visual_replacement_evidence = _has_visual_replacement_evidence(
        issues=issues,
        replacement_signals=replacement_signals,
    )

    if any("batterie gonflee" in issue.lower() for issue in issues):
        recommendations.append("Isoler l'appareil et remplacer la batterie sans delai.")
    if any("ecran casse" in issue.lower() for issue in issues):
        recommendations.append("Planifier une reparation ecran ou un renouvellement du terminal.")
    if any("surchauffe" in issue.lower() for issue in issues):
        recommendations.append("Verifier temperature, ventilation, chargeur et alimentation.")
    if "modem usb" in normalized_objects or "modem" in normalized_objects:
        recommendations.append("Verifier l'anciennete du modem USB.")
    if "carte sim" in normalized_objects or sim_types:
        recommendations.append("Controler la consommation et l'affectation des cartes SIM visibles.")
    if any("obsolete" in issue.lower() or "ancien" in issue.lower() for issue in issues) or "obsolete" in normalized_signals:
        recommendations.append("Verifier compatibilite et planifier un remplacement cible si l'obsolescence visuelle est confirmee.")
    if not has_visual_replacement_evidence:
        recommendations.append(EQUIPMENT_NO_REPLACEMENT_NOTICE)
    if not recommendations:
        recommendations.append("Planifier un controle preventif physique et logiciel de l'equipement.")
    return _dedupe_items(recommendations, 4)


def _describe_equipment_confidence_level(
    *,
    confidence: float,
    inventory: list[EquipmentVisualInventoryItem],
) -> str:
    has_confirmed = any(item.confidence_label == EQUIPMENT_CONFIDENCE_CONFIRMED for item in inventory)
    has_uncertain = any(item.confidence_label == EQUIPMENT_CONFIDENCE_UNCERTAIN for item in inventory)
    if confidence >= 0.82 and has_confirmed and not has_uncertain:
        return "Eleve"
    if confidence >= 0.58:
        return "Moyen a eleve"
    return "Moyen"


def _compute_equipment_visual_quality_score(
    *,
    ocr_result: OcrExtractionResult,
    vision_result: VisionAnalysisResult,
) -> float:
    return max(
        max(vision_result.confidence or 0.0, 0.0),
        _effective_ocr_confidence(ocr_result, vision_result),
    )


def _should_suggest_clearer_equipment_view(
    *,
    ocr_result: OcrExtractionResult,
    vision_result: VisionAnalysisResult,
) -> bool:
    quality_score = _compute_equipment_visual_quality_score(
        ocr_result=ocr_result,
        vision_result=vision_result,
    )
    has_readable_reference_cues = bool(
        ocr_result.text_regions
        or len(ocr_result.lines) >= 3
        or vision_result.detected_brands
        or vision_result.detected_operators
        or vision_result.sim_types
        or (vision_result.primary_equipment or "").strip()
    )
    return quality_score < EQUIPMENT_LOW_QUALITY_SCORE_THRESHOLD and not has_readable_reference_cues


def _has_generic_telecom_equipment_inventory(inventory: list[EquipmentVisualInventoryItem]) -> bool:
    return any(
        item.raw_label
        in {
            "Terminal mobile identifie visuellement",
            "Routeur ou modem reseau apparent",
            "Modem USB / cle 4G apparent",
            "Carte SIM ou support SIM visible",
            "Accessoires telecom visibles",
        }
        for item in inventory
    )


def _has_neutral_generic_equipment_inventory(inventory: list[EquipmentVisualInventoryItem]) -> bool:
    return any(
        item.raw_label in {EQUIPMENT_NEUTRAL_PRIMARY_VISIBLE_LABEL, EQUIPMENT_NEUTRAL_CONTEXT_VISIBLE_LABEL}
        for item in inventory
    )


def _has_generic_equipment_inventory(inventory: list[EquipmentVisualInventoryItem]) -> bool:
    return _has_generic_telecom_equipment_inventory(inventory) or _has_neutral_generic_equipment_inventory(
        inventory
    )


def _resolve_equipment_detected_image_category(
    inventory: list[EquipmentVisualInventoryItem],
) -> str:
    if any(
        item.raw_label
        in {
            GENERIC_VISIBLE_WIFI_ROUTER_LABEL,
            GENERIC_VISIBLE_NETWORK_ANTENNAS_LABEL,
            GENERIC_VISIBLE_NETWORK_CHASSIS_LABEL,
            GENERIC_VISIBLE_NETWORK_PORTS_LABEL,
        }
        for item in inventory
    ):
        return "routeur_wifi"
    modem_usb_focused_inventory = any(item.type_key == "modem_usb" for item in inventory) and not any(
        item.type_key is not None and item.type_key not in {"modem_usb", "cable_usb", "accessoire"}
        for item in inventory
    )
    if modem_usb_focused_inventory:
        return "modem_usb"
    if _has_generic_telecom_equipment_inventory(inventory) or any(
        _is_telecom_equipment_type(item.type_key) for item in inventory if item.type_key
    ):
        return "telecom"
    if any(item.type_key == "vehicule" for item in inventory):
        return "vehicule"
    if any(item.type_key in {"materiel_informatique", "ordinateur", "imprimante", "serveur"} for item in inventory):
        return "informatique"
    if any(item.type_key in {"mobilier"} for item in inventory):
        return "mobilier"
    if any(item.type_key in {"machine_industrielle", "machine", "infrastructure"} for item in inventory):
        return "industriel"
    if any(item.type_key in {"environnement_exterieur", "stationnement"} for item in inventory):
        return "environnement_exterieur"
    if _has_neutral_generic_equipment_inventory(inventory):
        return "objet_non_confirme"
    if inventory:
        return "equipement_physique"
    return "aucune_categorie_confirmee"


def _resolve_equipment_fallback_template_used(
    *,
    inventory: list[EquipmentVisualInventoryItem],
    vision_result: VisionAnalysisResult,
) -> str:
    if vision_result.model != "vision-fallback":
        return "direct_vision_analysis"
    if any(
        item.raw_label
        in {
            GENERIC_VISIBLE_WIFI_ROUTER_LABEL,
            GENERIC_VISIBLE_NETWORK_ANTENNAS_LABEL,
            GENERIC_VISIBLE_NETWORK_CHASSIS_LABEL,
            GENERIC_VISIBLE_NETWORK_PORTS_LABEL,
        }
        for item in inventory
    ):
        return "network_equipment_fallback"
    if _has_generic_telecom_equipment_inventory(inventory) or any(
        _is_telecom_equipment_type(item.type_key) for item in inventory if item.type_key
    ):
        return "telecom_visible_fallback"
    if any(item.type_key == "vehicule" for item in inventory):
        return "vehicle_fallback"
    if any(item.type_key in {"materiel_informatique", "ordinateur", "imprimante", "serveur"} for item in inventory):
        return "it_visible_fallback"
    if any(item.type_key in {"mobilier"} for item in inventory):
        return "furniture_visible_fallback"
    if any(item.type_key in {"machine_industrielle", "machine", "infrastructure"} for item in inventory):
        return "industrial_visible_fallback"
    if _has_neutral_generic_equipment_inventory(inventory):
        return "neutral_generic_fallback"
    if inventory:
        return "generic_visible_fallback"
    return "empty_visible_fallback"


def _log_equipment_visual_diagnostics(
    *,
    inventory: list[EquipmentVisualInventoryItem],
    vision_result: VisionAnalysisResult,
) -> None:
    fallback_template = _resolve_equipment_fallback_template_used(
        inventory=inventory,
        vision_result=vision_result,
    )
    detected_image_category = _resolve_equipment_detected_image_category(inventory)
    detected_objects = [item.raw_label for item in inventory[:8]]
    MULTIMODAL_LOGGER.info(
        "event=image_vision_fallback_selected model=%s fallback_template=%s detected_image_category=%s detected_objects=%s",
        vision_result.model,
        fallback_template,
        detected_image_category,
        detected_objects,
    )
    MULTIMODAL_LOGGER.info(
        "FALLBACK_TEMPLATE_USED = %s",
        fallback_template,
    )
    MULTIMODAL_LOGGER.info(
        "DETECTED_IMAGE_CATEGORY = %s",
        detected_image_category,
    )
    MULTIMODAL_LOGGER.info(
        "DETECTED_OBJECTS = %s",
        detected_objects,
    )


def _format_equipment_usage_line_label(item: EquipmentVisualInventoryItem) -> str:
    generic_usage_labels = {
        "Terminal mobile identifie visuellement": "Terminal mobile",
        "Routeur ou modem reseau apparent": "Routeur/modem",
        GENERIC_VISIBLE_WIFI_ROUTER_LABEL: "Routeur Wi-Fi",
        GENERIC_VISIBLE_NETWORK_ANTENNAS_LABEL: "Antennes reseau",
        GENERIC_VISIBLE_NETWORK_CHASSIS_LABEL: "Boitier reseau",
        GENERIC_VISIBLE_NETWORK_PORTS_LABEL: "Voyants/ports",
        "Modem USB / cle 4G apparent": "Modem USB/cle 4G",
        "Carte SIM ou support SIM visible": "Carte SIM/support SIM",
        "Accessoires telecom visibles": "Accessoires",
        EQUIPMENT_NEUTRAL_PRIMARY_VISIBLE_LABEL: "Objet principal",
        EQUIPMENT_NEUTRAL_CONTEXT_VISIBLE_LABEL: "Environnement ou support",
        GENERIC_VISIBLE_VEHICLE_LABEL: "Vehicule",
        GENERIC_VISIBLE_WHEELS_LABEL: "Roues",
        GENERIC_VISIBLE_BODY_LABEL: "Carrosserie",
        GENERIC_VISIBLE_PARKING_LABEL: "Zone de stationnement",
        GENERIC_VISIBLE_OUTDOOR_LABEL: "Environnement exterieur",
        GENERIC_VISIBLE_FURNITURE_LABEL: "Mobilier",
        GENERIC_VISIBLE_IT_LABEL: "Materiel informatique",
        GENERIC_VISIBLE_INDUSTRIAL_LABEL: "Equipement industriel",
        "Ecran ou surface d'affichage visible": "Ecran",
        "Poste de travail ou support visible": "Poste de travail",
        "Surface ou plan de travail visible": "Plan de travail",
        "Zone technique ou atelier visible": "Zone technique",
    }
    return generic_usage_labels.get(item.raw_label, item.raw_label or item.type_label)


def _build_equipment_visual_report_answer(
    *,
    question: str,
    ocr_result: OcrExtractionResult,
    vision_result: VisionAnalysisResult,
    equipment_details: EquipmentDocumentDetails | None,
    recommendations: list[str],
    opening_notice: str | None = None,
) -> str:
    inventory = _build_visual_equipment_inventory(
        question=question,
        ocr_result=ocr_result,
        vision_result=vision_result,
    )
    confirmed_items = [item for item in inventory if item.confidence_label == EQUIPMENT_CONFIDENCE_CONFIRMED]
    probable_items = [item for item in inventory if item.confidence_label == EQUIPMENT_CONFIDENCE_PROBABLE]
    uncertain_items = [item for item in inventory if item.confidence_label == EQUIPMENT_CONFIDENCE_UNCERTAIN]
    generic_inventory_detected = _has_generic_equipment_inventory(inventory)
    telecom_generic_inventory_detected = _has_generic_telecom_equipment_inventory(inventory)
    neutral_generic_inventory_detected = _has_neutral_generic_equipment_inventory(inventory)
    non_telecom_visible_inventory = _has_non_telecom_visible_inventory(inventory)
    issues = equipment_details.detected_issues if equipment_details is not None else []
    has_replacement_evidence = _has_visual_replacement_evidence(
        issues=issues,
        replacement_signals=vision_result.replacement_signals,
    )
    visible_state = (
        equipment_details.visible_condition
        if equipment_details is not None and equipment_details.visible_condition
        else vision_result.apparent_condition
        or "non confirme visuellement"
    )
    filtered_recommendations = _filter_equipment_recommendations_for_visual_evidence(
        recommendations,
        issues=issues,
        replacement_signals=vision_result.replacement_signals,
    )

    inventory_lines: list[str] = ["Inventaire visuel"]
    if confirmed_items:
        inventory_lines.append("Confirme")
        inventory_lines.extend(
            f"- {item.raw_label}" if item.raw_label else f"- {item.type_label}"
            for item in confirmed_items
        )
    if probable_items:
        inventory_lines.append("Probable")
        if telecom_generic_inventory_detected:
            inventory_lines.append("- Plusieurs equipements telecom sont visibles.")
        inventory_lines.extend(
            f"- {item.raw_label}" if item.raw_label else f"- {item.type_label}"
            for item in probable_items
        )
    if uncertain_items:
        inventory_lines.append("Incertain")
        inventory_lines.extend(
            (
                f"- {item.raw_label}"
                if item.raw_label and item.raw_label != EQUIPMENT_UNKNOWN_OBJECT_LABEL
                else f"- {EQUIPMENT_UNKNOWN_OBJECT_LABEL}"
            )
            for item in uncertain_items
        )
    if not inventory:
        inventory_lines.append("Incertain")
        inventory_lines.append(f"- {EQUIPMENT_UNKNOWN_OBJECT_LABEL}")

    usage_lines = [
        "Utilisation probable des equipements",
    ]
    if neutral_generic_inventory_detected:
        usage_lines.append(f"- {EQUIPMENT_NEUTRAL_USAGE_NOTICE}")
    else:
        usage_items = _dedupe_items(
            [
                (
                    f"{_format_equipment_usage_line_label(item)}: {item.usage_probable}"
                    if item.raw_label and item.usage_probable
                    else ""
                )
                for item in inventory
                if item.confidence_label in {
                    EQUIPMENT_CONFIDENCE_CONFIRMED,
                    EQUIPMENT_CONFIDENCE_PROBABLE,
                }
            ],
            5,
        )
        if usage_items:
            usage_lines.extend(f"- {item}" for item in usage_items)
        elif equipment_details is not None and equipment_details.usage_summary:
            usage_lines.append(f"- Equipement principal probable: {equipment_details.usage_summary}")
        else:
            usage_lines.append("- Le role exact de chaque equipement ne peut pas etre confirme uniquement a partir de l'image.")

    state_lines = [
        "Etat apparent",
    ]
    if issues:
        state_lines.append(
            "- Des points de vigilance visuels sont observes : "
            + "; ".join(issue.rstrip(".") for issue in issues[:3])
            + "."
        )
    elif vision_result.model == "vision-fallback" and neutral_generic_inventory_detected:
        state_lines.append("- Aucun dommage visible confirme.")
    elif vision_result.model == "vision-fallback" and non_telecom_visible_inventory:
        state_lines.append("- Aucun dommage visible confirme.")
    elif vision_result.model == "vision-fallback" and telecom_generic_inventory_detected:
        state_lines.append("- Aucun dommage visible confirme sur les equipements apparemment visibles.")
        state_lines.append(f"- {EQUIPMENT_GENERIC_FALLBACK_NOTICE}")
    elif vision_result.image_type == "modem_usb":
        state_lines.append("- Aucun dommage visible confirme.")
    else:
        state_lines.append("- Les equipements semblent visuellement fonctionnels, sans dommage visible apparent.")
    state_lines.append(f"- Etat dominant retenu : {visible_state}.")
    if not issues:
        if vision_result.model == "vision-fallback" and neutral_generic_inventory_detected:
            state_lines.append("- L'etat reel ne peut pas etre confirme uniquement par l'image.")
        elif vision_result.model == "vision-fallback" and any(item.type_key == "vehicule" for item in inventory):
            state_lines.append("- L'etat mecanique reel ne peut pas etre confirme uniquement par l'image.")
        elif vision_result.model == "vision-fallback" and non_telecom_visible_inventory:
            state_lines.append("- L'etat reel ne peut pas etre confirme uniquement par l'image.")
        elif vision_result.model == "vision-fallback" and telecom_generic_inventory_detected:
            state_lines.append("- Le fonctionnement reel ne peut pas etre confirme uniquement a partir de l'image.")
        else:
            state_lines.append("- Aucun voyant ni interface active ne permet toutefois de confirmer le fonctionnement en temps reel.")

    modernization_lines = [
        "Modernisation potentielle",
    ]
    if has_replacement_evidence:
        modernization_lines.extend(
            f"- {item}"
            for item in (
                filtered_recommendations[:3]
                or ["Un remplacement cible peut etre etudie uniquement sur les equipements montrant un defaut visible."]
            )
        )
    else:
        modernization_lines.append(f"- {EQUIPMENT_NO_REPLACEMENT_NOTICE}")
        modernization_lines.append(
            f"- {EQUIPMENT_CONDITIONAL_MODERNIZATION_NOTICE}"
            if not non_telecom_visible_inventory
            else f"- {VISIBLE_ONLY_FALLBACK_MODERNIZATION_NOTICE}"
        )
        modernization_lines.extend(
            f"- {item}"
            for item in filtered_recommendations
            if item
            not in {
                EQUIPMENT_NO_REPLACEMENT_NOTICE,
                EQUIPMENT_CONDITIONAL_MODERNIZATION_NOTICE,
                VISIBLE_ONLY_FALLBACK_MODERNIZATION_NOTICE,
            }
        )

    confidence_lines = [
        "Niveau de confiance",
        f"- Niveau global : {_describe_equipment_confidence_level(confidence=vision_result.confidence, inventory=inventory)} ({round(vision_result.confidence * 100)}%).",
        "- L'analyse repose uniquement sur les elements visibles et le texte lisible dans l'image.",
    ]
    if neutral_generic_inventory_detected:
        confidence_lines.append(f"- {EQUIPMENT_NEUTRAL_CONFIDENCE_NOTICE}")
    elif vision_result.model == "vision-fallback":
        confidence_lines.append(f"- {EQUIPMENT_GENERIC_CATEGORY_NOTICE}")
    elif generic_inventory_detected:
        confidence_lines.append(f"- {EQUIPMENT_GENERIC_CATEGORY_NOTICE}")
    if uncertain_items or not inventory:
        confidence_lines.append("- Certains equipements restent partiellement identificables sur cette image.")

    sections = [
        opening_notice or "",
        "\n".join(inventory_lines),
        "\n".join(usage_lines),
        "\n".join(state_lines),
        "\n".join(modernization_lines),
        "\n".join(confidence_lines),
    ]
    return "\n\n".join(section for section in sections if section)


def _build_equipment_usage_summary(equipment_type: str | None) -> str:
    usage_map = {
        "smartphone": "Terminal mobile professionnel pour la voix, la data et les applications metier.",
        "routeur": "Assure la connectivite WAN/LAN du site ou des lignes de flotte.",
        "routeur_wifi": "Le routeur permet de distribuer la connexion Internet ou Wi-Fi.",
        "antennes_reseau": "Les antennes servent a ameliorer la couverture reseau.",
        "boitier_reseau": "Le boitier reseau regroupe l'electronique de connectivite et de distribution.",
        "voyant_ports": "Les voyants ou ports servent au suivi de l'etat de connexion et au raccordement.",
        "modem_usb": "Le modem USB permet l'acces au reseau mobile via un port USB.",
        "modem": "Fournit l'acces fibre, ADSL ou 4G/5G vers le reseau operateur.",
        "sim": "Carte d'acces reseau mobile pour la voix, la data ou la telemetrie.",
        "switch": "Distribue la connectivite reseau filaire entre les equipements.",
        "borne_wifi": "Diffuse la connectivite WiFi pour les utilisateurs et terminaux.",
        "antenne": "Assure la couverture radio ou la liaison d'acces du site.",
        "ordinateur": "Poste de travail pour l'exploitation, la configuration ou le support local.",
        "imprimante": "Impression de documents, tickets, etiquettes ou rapports operationnels.",
        "serveur": "Hebergement local de services, d'outils de supervision ou d'applications reseau.",
        "vehicule": "Le vehicule sert au transport ou au deplacement professionnel.",
        "roue": "Element roulant visible associe au deplacement d'un vehicule ou d'un support mobile.",
        "carrosserie": "Structure exterieure visible de protection ou de transport.",
        "stationnement": "La zone de stationnement sert a l'arret ou au rangement du vehicule.",
        "environnement_exterieur": "Environnement exterieur ou zone de circulation visible.",
        "mobilier": "Mobilier servant a l'amenagement, au support ou au rangement.",
        "materiel_informatique": "Equipement informatique pour l'affichage, la saisie ou l'exploitation.",
        "machine_industrielle": "Equipement operationnel ou industriel visible sur site.",
        "machine": "Equipement operationnel ou industriel pilote via le reseau ou la telemetrie.",
        "infrastructure": "Element d'infrastructure telecom ou reseau contribuant a la connectivite du site.",
        "appareil_inconnu": EQUIPMENT_GENERIC_USAGE_NOTICE,
    }
    return usage_map.get(
        equipment_type or "",
        EQUIPMENT_GENERIC_USAGE_NOTICE,
    )


def _resolve_equipment_details(
    *,
    question: str,
    ocr_result: OcrExtractionResult,
    vision_result: VisionAnalysisResult,
) -> EquipmentDocumentDetails | None:
    if ocr_result.equipment_details is not None:
        return ocr_result.equipment_details

    detected_objects = _build_detected_equipment_objects(
        question=question,
        ocr_result=ocr_result,
        vision_result=vision_result,
    )
    equipment_inventory = _build_visual_equipment_inventory(
        question=question,
        ocr_result=ocr_result,
        vision_result=vision_result,
    )
    combined_text = " ".join(
        item
        for item in [
            question,
            ocr_result.text,
            vision_result.image_type,
            vision_result.analysis,
            vision_result.raw_output,
            vision_result.primary_equipment or "",
            *detected_objects,
            *vision_result.detected_brands,
            *vision_result.detected_operators,
            *vision_result.sim_types,
            *vision_result.replacement_signals,
        ]
        if item
    )
    primary_equipment_hint = vision_result.primary_equipment or next(
        (
            item
            for item in detected_objects
            if any(
                keyword in item.lower()
                for keyword in ("routeur", "router", "gateway", "cpe", "modem", "switch", "antenne", "borne wifi")
            )
        ),
        detected_objects[0]
        if detected_objects
        else (equipment_inventory[0].raw_label if equipment_inventory else ""),
    )
    inferred_equipment_type = _infer_equipment_type_from_text(primary_equipment_hint or combined_text)
    if inferred_equipment_type is None:
        inferred_equipment_type = _infer_equipment_type_from_text(combined_text)
    if inferred_equipment_type is None and vision_result.image_type != "equipement" and not detected_objects:
        return None

    operators = _dedupe_items(
        [
            *ocr_result.operators,
            *vision_result.detected_operators,
            *_extract_equipment_operators_from_text(combined_text),
        ],
        4,
    )
    sim_types = _dedupe_items(
        [*vision_result.sim_types, *_extract_sim_types_from_text(combined_text)],
        4,
    )
    primary_brand = _extract_primary_equipment_brand(
        vision_result.primary_equipment,
        fallback_text=combined_text,
    )
    detected_brands = _dedupe_items(
        [
            primary_brand or "",
            *vision_result.detected_brands,
            *[brand for brand in EQUIPMENT_BRAND_HINTS if brand.lower() in combined_text.lower()],
        ],
        5,
    )
    brand = primary_brand or (detected_brands[0] if detected_brands else None)

    model: str | None = None
    if brand:
        model_match = re.search(
            rf"{re.escape(brand)}\s+([A-Z0-9][A-Z0-9._/-]{{1,20}})",
            " ".join(item for item in [ocr_result.text, vision_result.raw_output] if item),
            flags=re.IGNORECASE,
        )
        if model_match:
            candidate = model_match.group(1).strip(".,;:()[]")
            if (
                candidate.lower() not in {"4g", "5g", "lte", "wifi", "wan", "lan"}
                and not re.fullmatch(r"(?:4g|5g|4g/5g|4g_lte|lte|wifi|wan|lan)", candidate.lower())
            ):
                model = candidate

    normalized_text = combined_text.lower()
    replacement_signals = _dedupe_items(vision_result.replacement_signals, 4)
    issues: list[str] = []
    if any(keyword in normalized_text for keyword in ("batterie gonflee", "swollen battery", "battery swollen")):
        issues.append("Batterie gonflee visible ou fortement suspectee.")
    if any(keyword in normalized_text for keyword in ("ecran casse", "crack", "screen broken", "fissure")):
        issues.append("Ecran casse ou fissure visible.")
    if any(keyword in normalized_text for keyword in ("surchauffe", "overheat", "temperature haute")):
        issues.append("Surchauffe visible ou suspectee.")
    if any(keyword in normalized_text for keyword in ("obsolete", "obsol", "legacy", "ancien", "old model")):
        issues.append("Materiel ancien ou potentiellement obsolete.")
    if any(keyword in normalized_text for keyword in ("port down", "wan", "link down", "offline", "fault")):
        issues.append("Anomalie reseau visible sur l'equipement ou ses voyants.")
    if not issues and replacement_signals:
        issues.extend(replacement_signals[:2])

    base_condition = 84
    has_specific_visual_cues = bool(
        detected_objects
        or vision_result.primary_equipment
        or vision_result.detected_brands
        or vision_result.detected_operators
        or vision_result.sim_types
    )
    if vision_result.model == "vision-fallback" and not has_specific_visual_cues and not ocr_result.text.strip():
        base_condition = 78
    if vision_result.apparent_condition:
        apparent_condition_text = vision_result.apparent_condition.lower()
        if any(keyword in apparent_condition_text for keyword in ("fonctionnel", "normal", "correct")):
            base_condition = 86
        elif any(keyword in apparent_condition_text for keyword in ("endommage", "defaut", "suspect", "obsolete")):
            base_condition = 62
    criticality_score = {
        "routeur": 46,
        "switch": 44,
        "borne_wifi": 40,
        "antenne": 42,
        "modem": 36,
        "smartphone": 28,
        "sim": 18,
        "ordinateur": 26,
        "imprimante": 20,
        "serveur": 48,
        "vehicule": 30,
        "machine": 34,
        "infrastructure": 44,
    }.get(inferred_equipment_type or "", 24)
    obsolescence_score = 22
    maintenance_score = 24

    if any("batterie gonflee" in issue.lower() for issue in issues):
        base_condition -= 40
        criticality_score += 30
        maintenance_score += 34
    if any("ecran casse" in issue.lower() for issue in issues):
        base_condition -= 24
        criticality_score += 18
        maintenance_score += 18
    if any("surchauffe" in issue.lower() for issue in issues):
        base_condition -= 22
        criticality_score += 22
        maintenance_score += 22
    if any("obsolete" in issue.lower() or "ancien" in issue.lower() for issue in issues):
        obsolescence_score += 36
    if any("anomalie reseau" in issue.lower() for issue in issues):
        criticality_score += 16
        maintenance_score += 12
    if replacement_signals:
        obsolescence_score += 18
        maintenance_score += 12

    condition_score = max(0, min(base_condition, 100))
    criticality_score = max(0, min(criticality_score, 100))
    obsolescence_score = max(0, min(obsolescence_score, 100))
    maintenance_score = max(0, min(maintenance_score, 100))
    replacement_needed = (
        condition_score <= 45
        or criticality_score >= 80
        or obsolescence_score >= 75
        or any("batterie gonflee" in issue.lower() for issue in issues)
        or any(
            keyword in " ".join(replacement_signals).lower()
            for keyword in ("replace", "remplac", "obsolete", "endommage", "defaut")
        )
    )

    primary_equipment = _resolve_primary_equipment_label(
        equipment_type=inferred_equipment_type,
        brand=brand,
        vision_result=vision_result,
        detected_objects=detected_objects,
    )
    if not detected_objects and equipment_inventory and primary_equipment == _format_image_type_label("appareil_inconnu"):
        primary_equipment = equipment_inventory[0].raw_label
    maintenance_recommendations = _build_equipment_maintenance_recommendations(
        detected_objects=detected_objects,
        issues=issues,
        primary_equipment=primary_equipment,
        sim_types=sim_types,
        replacement_signals=replacement_signals,
    )
    visible_condition = _build_equipment_visible_condition(
        issues=issues,
        vision_result=vision_result,
    )
    if vision_result.model == "vision-fallback" and not has_specific_visual_cues and not issues:
        visible_condition = "non confirme visuellement"
    usage_summary = vision_result.probable_usage or _build_equipment_usage_summary(
        inferred_equipment_type or "appareil_inconnu"
    )
    sim_information = None
    if operators or sim_types:
        sim_information = ", ".join(
            item for item in [", ".join(operators) if operators else "", ", ".join(sim_types) if sim_types else ""] if item
        )
    label_information = (
        ", ".join(detected_objects[:6])
        if detected_objects
        else ", ".join(item.raw_label for item in equipment_inventory[:4]) if equipment_inventory else None
    )
    generic_inventory_detected = _has_generic_equipment_inventory(equipment_inventory)
    telecom_generic_inventory_detected = _has_generic_telecom_equipment_inventory(equipment_inventory)
    neutral_generic_inventory_detected = _has_neutral_generic_equipment_inventory(equipment_inventory)
    summary = (
        (
            "Plusieurs equipements telecom sont visibles, "
            f"{EQUIPMENT_GENERIC_CATEGORY_NOTICE.lower()}, "
            f"etat {visible_condition}, criticite {criticality_score}/100."
        )
        if telecom_generic_inventory_detected
        else (
            "Des objets physiques restent visibles, "
            f"{EQUIPMENT_NEUTRAL_CONFIDENCE_NOTICE.lower()}, "
            f"etat {visible_condition}, criticite {criticality_score}/100."
        )
        if neutral_generic_inventory_detected
        else (
            f"{_describe_equipment_detection_count(equipment_inventory)}, "
            f"principal {primary_equipment}, etat {visible_condition}, criticite {criticality_score}/100."
        )
    )

    return EquipmentDocumentDetails(
        equipment_type=inferred_equipment_type or "appareil_inconnu",
        brand=brand,
        model=model,
        serial_number=None,
        operator=", ".join(operators) if operators else None,
        visible_condition=visible_condition,
        device_version=None,
        sim_information=sim_information,
        label_information=label_information,
        usage_summary=usage_summary,
        detected_issues=issues,
        maintenance_recommendations=maintenance_recommendations[:4],
        replacement_needed=replacement_needed,
        condition_score=condition_score,
        criticality_score=criticality_score,
        obsolescence_score=obsolescence_score,
        maintenance_score=maintenance_score,
        summary=summary,
    )


def _build_equipment_details_block(equipment_details: EquipmentDocumentDetails | None) -> str:
    if equipment_details is None:
        return "Aucune structure equipement exploitable."

    detail_lines = [
        (
            f"- Type equipement: {_format_image_type_label(equipment_details.equipment_type)}"
            if equipment_details.equipment_type
            else ""
        ),
        f"- Marque: {equipment_details.brand}" if equipment_details.brand else "",
        (
            f"- Modele: {equipment_details.model}"
            if equipment_details.model
            else "- Modele: Equipement non identifie avec certitude"
        ),
        f"- Numero serie: {equipment_details.serial_number}" if equipment_details.serial_number else "",
        f"- Operateur: {equipment_details.operator}" if equipment_details.operator else "",
        f"- Etat visible: {equipment_details.visible_condition}" if equipment_details.visible_condition else "",
        f"- Version: {equipment_details.device_version}" if equipment_details.device_version else "",
        f"- Informations SIM: {equipment_details.sim_information}" if equipment_details.sim_information else "",
        f"- Score etat: {equipment_details.condition_score}/100",
        f"- Score criticite: {equipment_details.criticality_score}/100",
        f"- Score obsolescence: {equipment_details.obsolescence_score}/100",
        f"- Score maintenance: {equipment_details.maintenance_score}/100",
        f"- Remplacement necessaire: {'oui' if equipment_details.replacement_needed else 'non'}",
        f"- Usage: {equipment_details.usage_summary}" if equipment_details.usage_summary else "",
        f"- Resume documentaire: {equipment_details.summary}" if equipment_details.summary else "",
    ]

    if equipment_details.detected_issues:
        detail_lines.append(
            "- Anomalies equipement:\n"
            + "\n".join(f"  - {item}" for item in equipment_details.detected_issues[:5])
        )
    if equipment_details.maintenance_recommendations:
        detail_lines.append(
            "- Recommandations maintenance:\n"
            + "\n".join(f"  - {item}" for item in equipment_details.maintenance_recommendations[:4])
        )

    return "\n".join(item for item in detail_lines if item)


def _detect_image_question_type(question: str) -> str:
    if _question_targets_physical_equipment(question):
        return QUESTION_TYPE_EQUIPMENT_DETECTION
    return QUESTION_TYPE_STANDARD


def _resolve_image_routing_mode(
    *,
    question: str,
    history: list[ChatContextMessage],
    image_type: str,
    ocr_result: OcrExtractionResult,
    vision_result: VisionAnalysisResult,
) -> str:
    question_type = _detect_image_question_type(question)
    has_physical_equipment_signals = _has_physical_equipment_signals(
        question=question,
        history=history,
        ocr_result=ocr_result,
        vision_result=vision_result,
    )
    if should_use_strict_mode(image_type):
        return "image_strict"
    if question_type == QUESTION_TYPE_EQUIPMENT_DETECTION or has_physical_equipment_signals:
        return EQUIPMENT_ROUTING_MODE_VISION_ONLY
    if image_type != "equipement":
        return "standard"
    return EQUIPMENT_ROUTING_MODE_VISION_ONLY


def _build_equipment_vision_block(
    *,
    question: str,
    ocr_result: OcrExtractionResult,
    vision_result: VisionAnalysisResult,
) -> str:
    inventory = _build_visual_equipment_inventory(
        question=question,
        ocr_result=ocr_result,
        vision_result=vision_result,
    )
    lines = [
        "Lecture visuelle equipement:",
        *(
            [
                (
                    f"- Type: {item.type_label} | Marque: {item.brand or 'Non visible'} | "
                    f"Confiance: {item.confidence_label} | Usage probable: {item.usage_probable}"
                )
                for item in inventory[:8]
            ]
            or ["- Objet visible: non confirme visuellement"]
        ),
        *([f"- Marque visible: {item}" for item in vision_result.detected_brands[:4]]),
        *([f"- Operateur visible: {item}" for item in vision_result.detected_operators[:3]]),
        *([f"- Format SIM visible: {item}" for item in vision_result.sim_types[:3]]),
        f"- Confiance Vision: {round(vision_result.confidence * 100)}%",
        f"- Equipement principal: {vision_result.primary_equipment}" if vision_result.primary_equipment else "",
        f"- Etat apparent: {vision_result.apparent_condition}" if vision_result.apparent_condition else "",
        f"- Usage probable: {vision_result.probable_usage}" if vision_result.probable_usage else "",
        *([f"- Signal de remplacement: {item}" for item in vision_result.replacement_signals[:4]]),
    ]
    return "\n".join(item for item in lines if item)


def _build_equipment_visual_kpis(
    *,
    question: str = "",
    ocr_result: OcrExtractionResult,
    vision_result: VisionAnalysisResult,
) -> list[str]:
    inventory = _build_visual_equipment_inventory(
        question=question,
        ocr_result=ocr_result,
        vision_result=vision_result,
    )
    generic_inventory_detected = _has_generic_equipment_inventory(inventory)
    neutral_generic_inventory_detected = _has_neutral_generic_equipment_inventory(inventory)
    detected_objects = [item.raw_label for item in inventory]
    primary_equipment = vision_result.primary_equipment or (detected_objects[0] if detected_objects else "")
    return _dedupe_items(
        [
            _describe_equipment_detection_count(inventory) if detected_objects else "",
            (
                f"Equipement principal {primary_equipment}"
                if primary_equipment and not generic_inventory_detected
                else ""
            ),
            (
                EQUIPMENT_NEUTRAL_CONFIDENCE_NOTICE
                if neutral_generic_inventory_detected
                else EQUIPMENT_GENERIC_CATEGORY_NOTICE
                if generic_inventory_detected
                else ""
            ),
            f"Confiance Vision {round(vision_result.confidence * 100)}%" if detected_objects else "",
            f"Etat apparent {vision_result.apparent_condition}" if vision_result.apparent_condition else "",
        ],
        4,
    )


def _score_to_equipment_risk_level(score: int) -> str:
    if score >= 85:
        return "critical"
    if score >= 70:
        return "high"
    if score >= 45:
        return "medium"
    return "low"


def _build_vision_only_equipment_decision_recommendations(
    *,
    equipment_details: EquipmentDocumentDetails | None,
    model_recommendations: list[str],
) -> RecommendationEngineResult:
    if equipment_details is None:
        return RecommendationEngineResult(
            recommendations=[],
            recommendation_notice="L'analyse reste centree sur les objets visibles de l'image.",
            risk_level="low",
            optimization_score=0,
            anomaly_score=0,
            fraud_score=0,
            cost_score=0,
        )

    recommendations: list[DecisionRecommendation] = []
    issues = equipment_details.detected_issues or []
    replacement_evidence = _has_visual_replacement_evidence(
        issues=issues,
        replacement_signals=[],
    )
    filtered_model_recommendations = _filter_equipment_recommendations_for_visual_evidence(
        model_recommendations,
        issues=issues,
        replacement_signals=[],
    )
    if equipment_details.replacement_needed and replacement_evidence:
        recommendations.append(
            DecisionRecommendation(
                title="Remplacer equipement a risque",
                priority="critical" if (equipment_details.criticality_score or 0) >= 75 else "high",
                impact="risk",
                estimated_saving=None,
                reason=equipment_details.summary or "L'equipement visible presente un risque materiel.",
            )
        )
    maintenance_actions = [
        item
        for item in equipment_details.maintenance_recommendations
        if item != EQUIPMENT_NO_REPLACEMENT_NOTICE
    ]
    if maintenance_actions:
        recommendations.append(
            DecisionRecommendation(
                title=maintenance_actions[0][:90],
                priority="high" if (equipment_details.maintenance_score or 0) >= 60 else "medium",
                impact="prevention",
                estimated_saving=None,
                reason="Action deduite exclusivement des signaux visibles sur l'image.",
            )
        )
    for recommendation in filtered_model_recommendations[:2]:
        recommendations.append(
            DecisionRecommendation(
                title=recommendation[:90],
                priority="medium",
                impact="analysis",
                estimated_saving=None,
                reason="Suggestion visuelle basee sur les objets detectes sur la photo.",
            )
        )

    deduped_recommendations: list[DecisionRecommendation] = []
    seen_titles: set[str] = set()
    for recommendation in recommendations:
        normalized_title = " ".join(recommendation.title.lower().split())
        if not normalized_title or normalized_title in seen_titles:
            continue
        seen_titles.add(normalized_title)
        deduped_recommendations.append(recommendation)

    equipment_risk_score = max(
        equipment_details.criticality_score or 0,
        equipment_details.obsolescence_score or 0,
        equipment_details.maintenance_score or 0,
        100 - (equipment_details.condition_score or 100),
    )
    return RecommendationEngineResult(
        recommendations=deduped_recommendations[:5],
        recommendation_notice="Analyse fondee uniquement sur l'image et les equipements visibles.",
        risk_level=_score_to_equipment_risk_level(equipment_risk_score),
        optimization_score=max(0, min(100 - (equipment_details.condition_score or 100), 100)),
        anomaly_score=max(0, min((equipment_details.maintenance_score or 0), 100)),
        fraud_score=0,
        cost_score=0,
    )


def _build_equipment_visual_fallback_answer(
    *,
    question: str,
    ocr_result: OcrExtractionResult,
    vision_result: VisionAnalysisResult,
) -> str:
    equipment_details = _resolve_equipment_details(
        question=question,
        ocr_result=ocr_result,
        vision_result=vision_result,
    )
    should_suggest_clearer_view = _should_suggest_clearer_equipment_view(
        ocr_result=ocr_result,
        vision_result=vision_result,
    )
    recommendations = _dedupe_items(
        [
            *(equipment_details.maintenance_recommendations if equipment_details is not None else []),
            *vision_result.recommendations,
            EQUIPMENT_QUALITY_REVIEW_NOTICE if should_suggest_clearer_view else "",
        ],
        6,
    )
    return _build_equipment_visual_report_answer(
        question=question,
        ocr_result=ocr_result,
        vision_result=vision_result,
        equipment_details=equipment_details,
        recommendations=recommendations,
        opening_notice=EQUIPMENT_VISUAL_READING_NOTICE,
    )


def _extract_visible_text_snippets(ocr_result: OcrExtractionResult) -> list[str]:
    region_texts = [
        region.text.strip()
        for region in ocr_result.text_regions
        if region.text and region.text.strip()
    ]
    line_texts = [line.strip() for line in ocr_result.lines if line and line.strip()]
    return _dedupe_items(
        [
            *region_texts[:4],
            *line_texts[:4],
            *ocr_result.visible_tables[:3],
        ],
        5,
    )


def _has_exploitable_visible_elements(
    *,
    ocr_result: OcrExtractionResult,
    vision_result: VisionAnalysisResult,
) -> bool:
    return any(
        (
            bool(ocr_result.text.strip()),
            bool(ocr_result.lines),
            bool(ocr_result.text_regions),
            bool(ocr_result.amounts_mad),
            bool(ocr_result.operators),
            bool(ocr_result.departments),
            bool(ocr_result.alerts),
            bool(ocr_result.kpis),
            bool(ocr_result.visible_tables),
            ocr_result.invoice_details is not None,
            ocr_result.incident_details is not None,
            ocr_result.workflow_details is not None,
            ocr_result.equipment_details is not None,
            bool(vision_result.detected_objects),
            bool(vision_result.detected_kpis),
            bool(vision_result.detected_brands),
            bool(vision_result.detected_operators),
            bool(vision_result.sim_types),
            bool((vision_result.primary_equipment or "").strip()),
        )
    )


def _should_force_visible_only_fallback_response(
    *,
    question: str,
    question_type: str,
    image_type: str,
    routing_mode: str,
    ocr_result: OcrExtractionResult,
    vision_result: VisionAnalysisResult,
) -> bool:
    if not _has_exploitable_visible_elements(ocr_result=ocr_result, vision_result=vision_result):
        return False
    if vision_result.model == "vision-fallback":
        if image_type in {"equipement", "capture_interface", "tableau", "graphe", "workflow"}:
            return True
        if image_type == "dashboard" and ocr_result.visible_tables and ocr_result.incident_details is None:
            return True
        return False
    if (
        image_type != "equipement"
        and question_type != QUESTION_TYPE_EQUIPMENT_DETECTION
        and routing_mode != EQUIPMENT_ROUTING_MODE_VISION_ONLY
    ):
        return False
    classified_detected_objects = [
        _classify_equipment_visual_type(item)[0]
        for item in vision_result.detected_objects
        if item and item != EQUIPMENT_UNKNOWN_OBJECT_LABEL
    ]
    has_specific_visible_cues = bool(
        ocr_result.text.strip()
        or (
            ocr_result.equipment_details is not None
            and any(
                [
                    ocr_result.equipment_details.brand,
                    ocr_result.equipment_details.model,
                    ocr_result.equipment_details.serial_number,
                    ocr_result.equipment_details.operator,
                ]
            )
        )
        or vision_result.primary_equipment
        or vision_result.detected_brands
        or vision_result.detected_operators
        or vision_result.sim_types
        or any(classified_detected_objects)
    )
    return (vision_result.confidence or 0.0) < 0.52 and not has_specific_visible_cues


def _describe_visible_only_confidence_level(
    *,
    confidence: float,
    confirmed_count: int,
    probable_count: int,
) -> str:
    if confidence >= 0.78 and confirmed_count > 0:
        return "Elevee"
    if confidence >= 0.45 or probable_count > 0:
        return "Moyenne"
    return "Faible"


def _build_visible_only_fallback_answer(
    *,
    question: str,
    image_type: str,
    ocr_result: OcrExtractionResult,
    vision_result: VisionAnalysisResult,
) -> str:
    if (
        image_type == "equipement"
        or _detect_image_question_type(question) == QUESTION_TYPE_EQUIPMENT_DETECTION
        or _has_physical_equipment_signals(
            question=question,
            history=None,
            ocr_result=ocr_result,
            vision_result=vision_result,
        )
    ):
        return _build_equipment_visual_fallback_answer(
            question=question,
            ocr_result=ocr_result,
            vision_result=vision_result,
        )

    visible_kpis = _collect_visible_pipeline_kpis(ocr_result, vision_result)
    visible_snippets = _extract_visible_text_snippets(ocr_result)
    confirmed_items: list[str] = []
    probable_items: list[str] = []
    uncertain_items: list[str] = []

    if image_type == "facture" or ocr_result.invoice_details is not None:
        confirmed_items.append("Document de facturation telecom probable")
        invoice_details = ocr_result.invoice_details
        probable_items.extend(
            item
            for item in [
                f"Operateur visible: {invoice_details.operator}" if invoice_details and invoice_details.operator else "",
                (
                    f"Montant visible: {invoice_details.total_amount_mad or invoice_details.amount_ttc_mad}"
                    if invoice_details and (invoice_details.total_amount_mad or invoice_details.amount_ttc_mad)
                    else ""
                ),
                f"Periode visible: {invoice_details.billing_period}" if invoice_details and invoice_details.billing_period else "",
            ]
            if item
        )
    elif image_type == "workflow" or ocr_result.workflow_details is not None:
        confirmed_items.append("Schema ou workflow probable")
        workflow_details = ocr_result.workflow_details
        probable_items.extend(
            workflow_details.critical_steps[:3]
            if workflow_details is not None and workflow_details.critical_steps
            else workflow_details.step_names[:3]
            if workflow_details is not None
            else []
        )
    elif image_type in ALERT_FOCUSED_IMAGE_TYPES or image_type == "dashboard" or ocr_result.incident_details is not None:
        confirmed_items.append("Capture de supervision ou tableau de bord probable")
        probable_items.extend(visible_kpis[:3] or ocr_result.alerts[:2] or visible_snippets[:2])
    elif image_type in {"tableau", "graphe"} or ocr_result.visible_tables:
        confirmed_items.append("Tableau ou graphique probable")
        probable_items.extend(ocr_result.visible_tables[:2] or visible_snippets[:2] or visible_kpis[:2])
    else:
        probable_items.append("Elements visuels telecom partiellement exploitables")
        probable_items.extend(visible_snippets[:2] or visible_kpis[:2])

    if not confirmed_items and not probable_items and visible_snippets:
        probable_items.extend(f"Texte visible: {_truncate(item, 90)}" for item in visible_snippets[:3])
    if not confirmed_items and not probable_items:
        probable_items.append("Elements visuels partiellement exploitables")
    if not visible_snippets and not visible_kpis:
        uncertain_items.append(EQUIPMENT_UNKNOWN_OBJECT_LABEL)

    confidence_score = max(
        vision_result.confidence or 0.0,
        _effective_ocr_confidence(ocr_result, vision_result),
    )
    confidence_level = _describe_visible_only_confidence_level(
        confidence=confidence_score,
        confirmed_count=len(confirmed_items),
        probable_count=len(probable_items),
    )

    inventory_lines = ["Inventaire visuel"]
    if confirmed_items:
        inventory_lines.append("Confirme")
        inventory_lines.extend(f"- {item}" for item in confirmed_items[:4])
    if probable_items:
        inventory_lines.append("Probable")
        inventory_lines.extend(f"- {item}" for item in probable_items[:5])
    if uncertain_items:
        inventory_lines.append("Incertain")
        inventory_lines.extend(f"- {item}" for item in uncertain_items[:2])

    state_lines = [
        "Etat apparent",
        (
            "- Le support reste partiellement lisible et plusieurs elements textuels ou structurels restent exploitables."
            if image_type in {"facture", "dashboard", "tableau", "graphe", "workflow"}
            or ocr_result.visible_tables
            or visible_snippets
            else "- Aucun dommage visible confirme, mais le niveau de detail reste partiel."
        ),
        "- Le fonctionnement reel, l'origine exacte ou le contexte complet ne peuvent pas etre confirmes uniquement a partir de cette image.",
    ]

    modernization_lines = [
        "Modernisation potentielle",
        f"- {EQUIPMENT_NO_REPLACEMENT_NOTICE}",
        f"- {VISIBLE_ONLY_FALLBACK_MODERNIZATION_NOTICE}",
        f"- {VISIBLE_ONLY_FALLBACK_REVIEW_NOTICE}",
    ]

    confidence_lines = [
        "Niveau de confiance",
        f"- Niveau global : {confidence_level} ({round(confidence_score * 100)}%).",
        "- Analyse prudente car la vision approfondie n'a pas pu etre finalisee.",
    ]
    if uncertain_items:
        confidence_lines.append("- Certains elements restent seulement partiellement identifiables sur ce visuel.")

    return "\n\n".join(
        [
            EQUIPMENT_FALLBACK_PARTIAL_NOTICE,
            "\n".join(inventory_lines),
            "\n".join(state_lines),
            "\n".join(modernization_lines),
            "\n".join(confidence_lines),
        ]
    )


def _build_visible_only_fallback_recommendations(
    *,
    image_type: str,
    ocr_result: OcrExtractionResult,
    vision_result: VisionAnalysisResult,
) -> list[str]:
    if image_type == "equipement":
        equipment_details = _resolve_equipment_details(
            question="",
            ocr_result=ocr_result,
            vision_result=vision_result,
        )
        if equipment_details is not None:
            return _dedupe_items(
                [
                    *equipment_details.maintenance_recommendations,
                    EQUIPMENT_NO_REPLACEMENT_NOTICE,
                    EQUIPMENT_CONDITIONAL_MODERNIZATION_NOTICE,
                    VISIBLE_ONLY_FALLBACK_REVIEW_NOTICE,
                ],
                6,
            )
    return _dedupe_items(
        [
            EQUIPMENT_NO_REPLACEMENT_NOTICE,
            VISIBLE_ONLY_FALLBACK_MODERNIZATION_NOTICE,
            VISIBLE_ONLY_FALLBACK_REVIEW_NOTICE,
            "Confirmer les elements les moins lisibles avant toute decision technique ou budgetaire.",
        ],
        6,
    )


def _build_visible_only_fallback_anomalies(
    *,
    ocr_result: OcrExtractionResult,
) -> list[str]:
    if ocr_result.equipment_details is not None and ocr_result.equipment_details.detected_issues:
        return _dedupe_items(ocr_result.equipment_details.detected_issues, 6)
    if ocr_result.invoice_details is not None and ocr_result.invoice_details.anomalies:
        return _dedupe_items(list(ocr_result.invoice_details.anomalies), 6)
    if ocr_result.workflow_details is not None and ocr_result.workflow_details.bottlenecks:
        return _dedupe_items(list(ocr_result.workflow_details.bottlenecks), 6)
    if ocr_result.incident_details is not None and ocr_result.incident_details.critical_signals:
        return _dedupe_items(list(ocr_result.incident_details.critical_signals), 6)
    return _dedupe_items(list(ocr_result.alerts), 4)


def _build_visible_only_fallback_response(
    *,
    question: str,
    question_type: str,
    summary_updated_at: str,
    analysis_mode: str,
    started_at,
    image_type: str,
    ocr_result: OcrExtractionResult,
    vision_result: VisionAnalysisResult,
    analysis_error_type: str | None,
    advanced_analysis_available: bool,
    advanced_analysis_completed: bool,
    vision_timeout_detected: bool,
    cached: bool = False,
) -> ChatImageResponse:
    is_equipment_visual_mode = (
        image_type == "equipement"
        or question_type == QUESTION_TYPE_EQUIPMENT_DETECTION
        or _has_physical_equipment_signals(
            question=question,
            history=None,
            ocr_result=ocr_result,
            vision_result=vision_result,
        )
    )
    answer = _build_visible_only_fallback_answer(
        question=question,
        image_type=image_type,
        ocr_result=ocr_result,
        vision_result=vision_result,
    )
    visible_kpis = _dedupe_items(
        _collect_visible_pipeline_kpis(ocr_result, vision_result),
        8,
    )
    recommendations = _build_visible_only_fallback_recommendations(
        image_type=image_type,
        ocr_result=ocr_result,
        vision_result=vision_result,
    )
    anomalies = _build_visible_only_fallback_anomalies(ocr_result=ocr_result)
    confidence = max(
        vision_result.confidence or 0.0,
        _effective_ocr_confidence(ocr_result, vision_result),
    )
    detected_operator = (
        ocr_result.invoice_details.operator
        if ocr_result.invoice_details is not None and ocr_result.invoice_details.operator
        else ocr_result.incident_details.operator
        if ocr_result.incident_details is not None and ocr_result.incident_details.operator
        else ocr_result.equipment_details.operator
        if ocr_result.equipment_details is not None and ocr_result.equipment_details.operator
        else ocr_result.operators[0]
        if ocr_result.operators
        else None
    )
    response = ChatImageResponse(
        answer=answer,
        model=get_settings().ollama_model,
        title_hint=_derive_title_hint(question),
        sources=[
            "multimodal:image",
            f"analysis-mode:{analysis_mode}",
            f"ocr:easyocr:{ocr_result.status}",
            f"vision:{vision_result.model}",
            f"question-type:{question_type.lower()}",
            f"image-type:{image_type}",
            f"vision-timeout:{str(vision_timeout_detected).lower()}",
            "global-context-blocked:true",
        ],
        summary_updated_at=summary_updated_at,
        cached=cached,
        fallback_used=True,
        duration_ms=_elapsed_ms(started_at),
        image_type=image_type,
        ocr_text=_limit_text(ocr_result.text, 6000),
        vision_analysis=_limit_text(vision_result.analysis, 5000),
        analysis_mode=analysis_mode,
        analysis_status="fallback",
        advanced_analysis_available=advanced_analysis_available,
        advanced_analysis_completed=advanced_analysis_completed,
        processing_message=(
            EQUIPMENT_FALLBACK_PARTIAL_NOTICE
            if vision_timeout_detected
            else EQUIPMENT_VISUAL_READING_NOTICE
            if is_equipment_visual_mode
            else EQUIPMENT_FALLBACK_PARTIAL_NOTICE
        ),
        processing_notices=_dedupe_items(
            [
                EQUIPMENT_VISUAL_READING_NOTICE if is_equipment_visual_mode else "",
                "Analyse visible uniquement: contexte metier global bloque.",
                "La reponse reste fondee sur les elements visibles ou lisibles dans l'image.",
            ],
            4,
        ),
        error_type=analysis_error_type or ("image_timeout" if vision_timeout_detected else "vision_unavailable"),
        fallback_answer=answer,
        detected_kpis=visible_kpis,
        recommendations=recommendations,
        confidence=confidence,
        ocr_confidence=_effective_ocr_confidence(ocr_result, vision_result),
        detected_operator=detected_operator,
        detected_anomalies=anomalies,
        analysis_metadata=ChatImageAnalysisMetadata(
            source_mode=VISIBLE_ONLY_FALLBACK_SOURCE_MODE,
            visible_kpis_used=visible_kpis,
            blocked_global_context=True,
            removed_unverified_claims=[],
            filtered_numbers=[],
            confidence_score=confidence,
        ),
        invoice_details=None,
        incident_details=None,
        alert_intelligence=None,
        workflow_details=None,
        equipment_details=None,
        ui_details=None,
        highlighted_image=None,
        annotations=[],
        decision_recommendations=[],
        recommendation_notice="Analyse fondee uniquement sur les elements visibles de l'image.",
        risk_level=None,
        optimization_score=0,
        anomaly_score=0,
        fraud_score=0,
        cost_score=0,
    )
    return polish_chat_image_response(response)


def _build_visual_detection_failure_response(
    *,
    question: str,
    summary_updated_at: str,
    analysis_mode: str,
    started_at,
    ocr_result: OcrExtractionResult,
    vision_result: VisionAnalysisResult,
    analysis_error_type: str | None,
    advanced_analysis_available: bool,
    advanced_analysis_completed: bool,
    question_type: str,
    vision_timeout_detected: bool,
    cached: bool = False,
) -> ChatImageResponse:
    equipment_details = _resolve_equipment_details(
        question=question,
        ocr_result=ocr_result,
        vision_result=vision_result,
    )
    inventory = _build_visual_equipment_inventory(
        question=question,
        ocr_result=ocr_result,
        vision_result=vision_result,
    )
    should_suggest_clearer_view = _should_suggest_clearer_equipment_view(
        ocr_result=ocr_result,
        vision_result=vision_result,
    )
    answer = _build_equipment_visual_fallback_answer(
        question=question,
        ocr_result=ocr_result,
        vision_result=vision_result,
    )
    recommendations = _dedupe_items(
        [
            *(equipment_details.maintenance_recommendations if equipment_details is not None else []),
            EQUIPMENT_CONDITIONAL_MODERNIZATION_NOTICE,
            EQUIPMENT_QUALITY_REVIEW_NOTICE if should_suggest_clearer_view else "",
        ],
        6,
    )
    decision_engine_result = _build_vision_only_equipment_decision_recommendations(
        equipment_details=equipment_details,
        model_recommendations=recommendations,
    )
    processing_message = (
        EQUIPMENT_FALLBACK_PARTIAL_NOTICE
        if vision_timeout_detected
        else EQUIPMENT_VISUAL_READING_NOTICE
    )
    processing_notices = _dedupe_items(
        [
            EQUIPMENT_VISUAL_READING_NOTICE,
            "Analyse visuelle uniquement: contexte metier global bloque.",
            "La reponse reste fondee sur les objets visibles et le texte lisible de l'image.",
        ],
        4,
    )
    MULTIMODAL_LOGGER.info("QUESTION_TYPE = %s", question_type)
    MULTIMODAL_LOGGER.info("VISION_ONLY_MODE = TRUE")
    MULTIMODAL_LOGGER.info("VISION_TIMEOUT = %s", "TRUE" if vision_timeout_detected else "FALSE")
    MULTIMODAL_LOGGER.info("GLOBAL_CONTEXT_BLOCKED = TRUE")
    _log_equipment_visual_diagnostics(
        inventory=inventory,
        vision_result=vision_result,
    )
    response = ChatImageResponse(
        answer=answer,
        model=get_settings().ollama_model,
        title_hint=_derive_title_hint(question),
        sources=[
            "multimodal:image",
            f"analysis-mode:{analysis_mode}",
            f"ocr:easyocr:{ocr_result.status}",
            f"vision:{vision_result.model}",
            f"question-type:{question_type.lower()}",
            f"vision-timeout:{str(vision_timeout_detected).lower()}",
            "global-context-blocked:true",
        ],
        summary_updated_at=summary_updated_at,
        cached=cached,
        fallback_used=True,
        duration_ms=_elapsed_ms(started_at),
        image_type="equipement",
        ocr_text=_limit_text(ocr_result.text, 6000),
        vision_analysis=_limit_text(vision_result.analysis, 5000),
        analysis_mode=analysis_mode,
        analysis_status="fallback",
        advanced_analysis_available=advanced_analysis_available,
        advanced_analysis_completed=advanced_analysis_completed,
        processing_message=processing_message,
        processing_notices=processing_notices,
        error_type=analysis_error_type or ("image_timeout" if vision_timeout_detected else "vision_unavailable"),
        fallback_answer=answer,
        detected_kpis=[],
        recommendations=recommendations,
        confidence=max(vision_result.confidence, _effective_ocr_confidence(ocr_result, vision_result)),
        ocr_confidence=_effective_ocr_confidence(ocr_result, vision_result),
        detected_operator=equipment_details.operator if equipment_details is not None else None,
        detected_anomalies=[],
        analysis_metadata=ChatImageAnalysisMetadata(
            source_mode=EQUIPMENT_ROUTING_MODE_VISION_ONLY,
            visible_kpis_used=[],
            blocked_global_context=True,
            removed_unverified_claims=[],
            filtered_numbers=[],
            confidence_score=max(vision_result.confidence, _effective_ocr_confidence(ocr_result, vision_result)),
        ),
        invoice_details=None,
        incident_details=None,
        alert_intelligence=None,
        workflow_details=None,
        equipment_details=(
            ChatEquipmentDetails(
                equipment_type=equipment_details.equipment_type,
                brand=equipment_details.brand,
                model=equipment_details.model,
                serial_number=equipment_details.serial_number,
                operator=equipment_details.operator,
                visible_condition=equipment_details.visible_condition,
                device_version=equipment_details.device_version,
                sim_information=equipment_details.sim_information,
                label_information=equipment_details.label_information,
                usage_summary=equipment_details.usage_summary,
                detected_issues=equipment_details.detected_issues,
                maintenance_recommendations=equipment_details.maintenance_recommendations,
                replacement_needed=equipment_details.replacement_needed,
                condition_score=equipment_details.condition_score,
                criticality_score=equipment_details.criticality_score,
                obsolescence_score=equipment_details.obsolescence_score,
                maintenance_score=equipment_details.maintenance_score,
                summary=equipment_details.summary,
            )
            if equipment_details is not None
            else None
        ),
        ui_details=None,
        highlighted_image=None,
        annotations=[],
        decision_recommendations=_polish_decision_recommendations(decision_engine_result.recommendations),
        recommendation_notice=decision_engine_result.recommendation_notice,
        risk_level=decision_engine_result.risk_level,
        optimization_score=decision_engine_result.optimization_score,
        anomaly_score=decision_engine_result.anomaly_score,
        fraud_score=0,
        cost_score=0,
    )
    return polish_chat_image_response(response)


def _apply_image_routing_metadata(
    *,
    parsed_answer: FinalImageAnswer,
    routing_mode: str,
) -> FinalImageAnswer:
    metadata = parsed_answer.analysis_metadata or ImageAnalysisMetadata(
        source_mode="standard",
        visible_kpis_used=[],
        blocked_global_context=False,
        removed_unverified_claims=[],
        filtered_numbers=[],
        confidence_score=parsed_answer.confidence,
    )

    if routing_mode == EQUIPMENT_ROUTING_MODE_VISION_ONLY:
        metadata = replace(
            metadata,
            source_mode=EQUIPMENT_ROUTING_MODE_VISION_ONLY,
            blocked_global_context=True,
        )
    elif routing_mode == EQUIPMENT_ROUTING_MODE_FUSION:
        metadata = replace(
            metadata,
            source_mode=EQUIPMENT_ROUTING_MODE_FUSION,
            blocked_global_context=False,
        )

    return replace(parsed_answer, analysis_metadata=metadata)


def _parse_final_model_answer(
    raw_answer: str,
    *,
    analysis_mode: str,
    image_type: str,
    ocr_result: OcrExtractionResult,
    vision_result: VisionAnalysisResult,
    summary_recommendations: list[str],
    dashboard_analysis: DashboardAnalysisResult | None = None,
) -> FinalImageAnswer:
    if (
        analysis_mode == "dashboard_analysis"
        and image_type == "dashboard"
        and dashboard_analysis is not None
    ):
        return _build_dashboard_answer(dashboard_analysis)

    payload = _extract_json_payload(raw_answer)
    invoice_details = ocr_result.invoice_details
    incident_details = ocr_result.incident_details
    workflow_details = ocr_result.workflow_details
    equipment_details = ocr_result.equipment_details
    invoice_visible_kpis = (
        _dedupe_items(
            [
                *(
                    [
                        value
                        for value in [
                            invoice_details.total_amount_mad,
                            invoice_details.amount_ttc_mad,
                            invoice_details.amount_ht_mad,
                            invoice_details.vat_amount_mad,
                        ]
                        if value
                    ]
                ),
                *(
                    [
                        (
                            f"{item.label}: {item.amount_mad}"
                            + (
                                f" ({_format_share_pct(item.share_of_total_pct)} du total)"
                                if item.share_of_total_pct is not None
                                else ""
                            )
                        )
                        for item in invoice_details.cost_items[:5]
                    ]
                    if invoice_details is not None
                    else []
                ),
            ],
            10,
        )
        if invoice_details is not None
        else []
    )
    invoice_recommendations = (
        _dedupe_items(
            [
                (
                    "Activer un forfait roaming entreprise."
                    if any(item.category == "roaming" for item in invoice_details.cost_items)
                    else ""
                ),
                (
                    "Ajouter des alertes avant depassement data."
                    if any(item.category == "data_overage" for item in invoice_details.cost_items)
                    else ""
                ),
                (
                    f"Auditer les lignes liees a {invoice_details.cost_items[0].label}."
                    if invoice_details.cost_items
                    else ""
                ),
                (
                    f"Optimiser le forfait {next((item.label for item in invoice_details.cost_items if item.category == 'plan'), '')} selon l'usage reel."
                    if any(item.category == "plan" for item in invoice_details.cost_items)
                    else ""
                ),
            ],
            4,
        )
        if invoice_details is not None
        else []
    )
    invoice_probable_causes = (
        _dedupe_items(
            [
                (
                    "une concentration des couts sur un nombre limite de postes visibles"
                    if invoice_details.critical_items
                    else ""
                ),
                (
                    "des usages roaming internationaux factures a un niveau eleve"
                    if any(item.category == "roaming" for item in invoice_details.cost_items)
                    else ""
                ),
                (
                    "des depassements data ou hors forfait visibles sur la facture"
                    if any(item.category == "data_overage" for item in invoice_details.cost_items)
                    else ""
                ),
            ],
            4,
        )
        if invoice_details is not None
        else []
    )
    alert_visible_kpis = (
        _dedupe_items(
            [
                (
                    f"{incident_details.critical_alert_count} alertes critiques"
                    if incident_details is not None and incident_details.critical_alert_count is not None
                    else ""
                ),
                (
                    f"Taux d'exposition {incident_details.exposure_rate}"
                    if incident_details is not None and incident_details.exposure_rate
                    else ""
                ),
                (
                    f"Impact financier {incident_details.financial_impact_mad}"
                    if incident_details is not None and incident_details.financial_impact_mad
                    else ""
                ),
                (
                    f"Score moyen {incident_details.average_score}"
                    if incident_details is not None and incident_details.average_score
                    else ""
                ),
                (
                    f"Score de risque {incident_details.risk_score}"
                    if incident_details is not None and incident_details.risk_score
                    else ""
                ),
                *(
                    incident_details.max_risk_scores[:4]
                    if incident_details is not None
                    else []
                ),
                *(
                    incident_details.risky_entities[:4]
                    if incident_details is not None
                    else []
                ),
                *(
                    incident_details.critical_signals[:4]
                    if incident_details is not None
                    else []
                ),
            ],
            10,
        )
        if incident_details is not None and image_type in ALERT_FOCUSED_IMAGE_TYPES
        else []
    )
    alert_visible_recommendations = (
        _dedupe_items(
            [
                (
                    "Auditer les utilisateurs avec score 100/100."
                    if incident_details is not None
                    and (
                        incident_details.risk_score == "100/100"
                        or "100/100" in incident_details.max_risk_scores
                    )
                    else ""
                ),
                (
                    "Auditer les lignes a fort impact financier."
                    if incident_details is not None and incident_details.financial_impact_mad
                    else ""
                ),
                (
                    "Traiter les alertes critiques en premier."
                    if incident_details is not None and incident_details.critical_alert_count is not None
                    else ""
                ),
                (
                    "Activer des seuils de blocage automatique."
                    if incident_details is not None
                    and incident_details.alert_type in {"fraude", "alert_dashboard", "alerte", "appel_suspect"}
                    else ""
                ),
                (
                    "Verifier les comportements suspects."
                    if incident_details is not None
                    and incident_details.alert_type in {"fraude", "alert_dashboard", "alerte", "appel_suspect"}
                    else ""
                ),
            ],
            5,
        )
        if incident_details is not None and image_type in ALERT_FOCUSED_IMAGE_TYPES
        else []
    )
    alert_visible_anomalies = (
        _dedupe_items(
            [
                *(
                    incident_details.critical_signals[:4]
                    if incident_details is not None
                    else []
                ),
                *(
                    incident_details.repeated_anomalies[:4]
                    if incident_details is not None
                    else []
                ),
                *(
                    incident_details.visible_statuses[:3]
                    if incident_details is not None
                    else []
                ),
            ],
            8,
        )
        if incident_details is not None and image_type in ALERT_FOCUSED_IMAGE_TYPES
        else []
    )
    merged_kpis = _clean_business_items(
        [
            *(
                []
                if image_type == "facture" and invoice_details is not None
                else [item for item in payload.get("detected_kpis", []) if isinstance(item, str)]
                if payload
                else []
            ),
            *ocr_result.kpis,
            *vision_result.detected_kpis,
            *ocr_result.amounts_mad,
            *invoice_visible_kpis,
            *(
                [
                    f"Complexite workflow {workflow_details.complexity_score}/100",
                    *(workflow_details.critical_steps[:2] if workflow_details is not None else []),
                ]
                if workflow_details is not None
                else []
            ),
            *(
                [
                    f"Etat equipement {equipment_details.condition_score}/100",
                    f"Criticite equipement {equipment_details.criticality_score}/100",
                    equipment_details.brand or "",
                    equipment_details.model or "",
                    *(
                        _build_equipment_visual_kpis(
                            ocr_result=ocr_result,
                            vision_result=vision_result,
                        )
                    ),
                ]
                if equipment_details is not None
                else []
            ),
            *alert_visible_kpis,
        ],
        10,
    )
    merged_recommendations = _clean_business_items(
        (
            invoice_recommendations
            if image_type == "facture" and invoice_details is not None
            else alert_visible_recommendations
            + (
                [item for item in payload.get("recommendations", []) if isinstance(item, str)]
                if payload and image_type in ALERT_FOCUSED_IMAGE_TYPES
                else []
            )
            + (
                vision_result.recommendations
                if image_type in ALERT_FOCUSED_IMAGE_TYPES
                else []
            )
            if image_type in ALERT_FOCUSED_IMAGE_TYPES and incident_details is not None
            else [
                *([item for item in payload.get("recommendations", []) if isinstance(item, str)] if payload else []),
                *vision_result.recommendations,
                # STRICT MODE: Ne pas injecter les recommandations globales CSV pour les images structurées
                # *(summary_recommendations[:3] if not should_use_strict_mode(image_type) else [])
            ]
        ),
        6,
    )
    merged_anomalies = _clean_business_items(
        (
            list(invoice_details.anomalies)
            if image_type == "facture" and invoice_details is not None
            else alert_visible_anomalies
            + (
                [item for item in payload.get("detected_anomalies", []) if isinstance(item, str)]
                if payload and image_type in ALERT_FOCUSED_IMAGE_TYPES
                else []
            )
            + (
                [item for item in payload.get("anomalies", []) if isinstance(item, str)]
                if payload and image_type in ALERT_FOCUSED_IMAGE_TYPES
                else []
            )
            if image_type in ALERT_FOCUSED_IMAGE_TYPES and incident_details is not None
            else [
                *(
                    [item for item in payload.get("detected_anomalies", []) if isinstance(item, str)]
                    if payload
                    else []
                ),
                *(
                    [item for item in payload.get("anomalies", []) if isinstance(item, str)]
                    if payload
                    else []
                ),
                *(invoice_details.anomalies if invoice_details is not None else []),
                *(workflow_details.bottlenecks if workflow_details is not None else []),
                *(equipment_details.detected_issues if equipment_details is not None else []),
            ]
        ),
        8,
    )
    merged_probable_causes = _clean_business_items(
        (
            invoice_probable_causes
            if image_type == "facture" and invoice_details is not None
            else [
                *(
                    [item for item in payload.get("probable_causes", []) if isinstance(item, str)]
                    if payload and image_type in ALERT_FOCUSED_IMAGE_TYPES
                    else []
                ),
                *(incident_details.probable_causes if incident_details is not None else []),
            ]
            if image_type in ALERT_FOCUSED_IMAGE_TYPES and incident_details is not None
            else [
                *(
                    [item for item in payload.get("probable_causes", []) if isinstance(item, str)]
                    if payload
                    else []
                ),
                *(incident_details.probable_causes if incident_details is not None else []),
            ]
        ),
        6,
    )
    parsed_severity = _format_severity_label(
        str(payload.get("severity") or "").strip() if payload else None
    ) or _format_severity_label(incident_details.severity if incident_details is not None else None)
    parsed_priority = _format_priority_label(
        str(payload.get("treatment_priority") or "").strip() if payload else None
    ) or _format_priority_label(incident_details.priority if incident_details is not None else None)
    alert_summary = (
        str(payload.get("alert_summary") or "").strip() if payload else ""
    ) or (incident_details.summary if incident_details is not None else None)
    alert_summary = alert_summary or None
    default_incident_recommendation = (
        merged_recommendations[0]
        if merged_recommendations
        else "Verifier la ligne concernee et confirmer l'action prioritaire avant escalation."
    )

    answer = str(payload.get("answer") or "").strip() if payload else ""
    if not answer:
        if image_type == "equipement" and equipment_details is not None:
            default_equipment_recommendation = (
                merged_recommendations[0]
                if merged_recommendations
                else "Verifier l'etat physique et planifier la maintenance ou le remplacement si necessaire."
            )
            answer = (
                "Analyse equipement telecom\n"
                f"- Type detecte : {_format_image_type_label(equipment_details.equipment_type or 'appareil_inconnu')}\n"
                f"- Modele : {equipment_details.model or 'Equipement non identifie avec certitude'}\n"
                f"- Etat : {equipment_details.condition_score}/100, criticite {equipment_details.criticality_score}/100\n"
                f"Insight: l'etat physique et l'obsolescence doivent etre rapproches du risque d'usage.\n"
                f"Recommandation: {default_equipment_recommendation}"
            )
        elif image_type == "workflow" and workflow_details is not None:
            answer = (
                "Analyse workflow telecom\n"
                f"- Type detecte : {_format_image_type_label(workflow_details.workflow_type or 'workflow')}\n"
                f"- Complexite : {workflow_details.complexity_score}/100 ({workflow_details.complexity_level})\n"
                f"- Etapes critiques : {', '.join(workflow_details.critical_steps[:3]) or 'Etape non lisible avec certitude'}\n"
                f"Insight: le schema montre un niveau de dependance et de validation a simplifier.\n"
                f"Recommandation: {(merged_recommendations[0] if merged_recommendations else 'Verifier les validations repetitives et les points de blocage visibles.')}"
            )
        elif image_type == "facture" and invoice_details is not None:
            main_items = [
                f"- {item.label}: {item.amount_mad}"
                for item in invoice_details.cost_items[:3]
            ]
            answer = (
                "Resume intelligent\n"
                f"La facture {invoice_details.operator or 'telecom'} "
                + (
                    f"presente un total de {invoice_details.total_amount_mad or invoice_details.amount_ttc_mad} "
                    if (invoice_details.total_amount_mad or invoice_details.amount_ttc_mad)
                    else "presente plusieurs postes de cout visibles "
                )
                + (
                    f"pour la periode {invoice_details.billing_period}.\n\n"
                    if invoice_details.billing_period
                    else ".\n\n"
                )
                + "Postes critiques detectes\n"
                + ("\n".join(main_items) if main_items else "- Aucun poste critique n'a pu etre consolide.\n")
                + "\n\nRecommandations IA\n"
                + (
                    f"- {merged_recommendations[0]}"
                    if merged_recommendations
                    else "- Verifier les postes de cout visibles avant validation de la facture."
                )
            )
        elif incident_details is not None:
            answer = (
                "Resume intelligent\n"
                "La capture met en evidence une alerte telecom qui appelle une priorisation rapide.\n\n"
                "Points critiques detectes\n"
                f"- Gravite visible: {parsed_severity or 'non lisible avec certitude'}\n"
                f"- Resume: {alert_summary or _truncate(vision_result.analysis, 120)}\n\n"
                "Recommandations IA\n"
                f"- {default_incident_recommendation}"
            )
        else:
            answer = (
                "Resume intelligent\n"
                "La capture partagee met en evidence des signaux telecom qui appellent une priorisation metier.\n\n"
                "Points critiques detectes\n"
                f"- Type de visuel: {_format_image_type_label(image_type)}\n"
                f"- Lecture retenue: {_truncate(vision_result.analysis, 120)}\n\n"
                "Recommandations IA\n"
                f"- {(merged_recommendations[0] if merged_recommendations else 'Verifier les KPI detectes puis confirmer les actions sur les lignes a risque.')}"
            )

    payload_confidence = payload.get("confidence") if payload else None
    try:
        parsed_confidence = float(payload_confidence)
    except (TypeError, ValueError):
        parsed_confidence = (vision_result.confidence * 0.6) + (ocr_result.confidence * 0.4)

    # MODE STRICT: Construire les valeurs extraites et appliquer le filtrage
    extracted_values = build_extracted_values_from_ocr(
        ocr_result.text,
        ocr_amounts_mad=[str(a) for a in ocr_result.amounts_mad],
        ocr_kpis=ocr_result.kpis,
        operators=ocr_result.operators,
        departments=ocr_result.departments,
        vision_analysis=vision_result.analysis,
        vision_kpis=vision_result.detected_kpis,
        image_metadata=[
            invoice_details.total_amount_mad if invoice_details is not None and invoice_details.total_amount_mad else "",
            invoice_details.amount_ttc_mad if invoice_details is not None and invoice_details.amount_ttc_mad else "",
            incident_details.financial_impact_mad if incident_details is not None and incident_details.financial_impact_mad else "",
            incident_details.exposure_rate if incident_details is not None and incident_details.exposure_rate else "",
            incident_details.average_score if incident_details is not None and incident_details.average_score else "",
            incident_details.risk_score if incident_details is not None and incident_details.risk_score else "",
            *(
                incident_details.max_risk_scores
                if incident_details is not None
                else []
            ),
        ],
    )
    visible_pipeline_kpis = _collect_visible_pipeline_kpis(ocr_result, vision_result)

    # Appliquer le filtrage des affirmations non vérifiées en mode strict
    filtered_answer = answer
    removed_claims: list[str] = []
    filtered_recommendations = merged_recommendations
    if should_use_strict_mode(image_type):
        filtered_answer, removed_claims = filter_unverified_claims(answer, extracted_values)
        filtered_recommendations, removed_recommendations = filter_recommendation_strings(
            merged_recommendations,
            extracted_values,
        )
        removed_claims.extend(removed_recommendations)
        if (
            len(visible_pipeline_kpis) >= VISIBLE_KPI_STRICT_THRESHOLD
            and (not filtered_answer.strip() or _is_generic_multimodal_answer(filtered_answer))
        ):
            if filtered_answer.strip():
                removed_claims.append(filtered_answer.strip())
            filtered_answer = _build_strict_visible_kpi_fallback_answer(
                image_type=image_type,
                ocr_result=ocr_result,
                vision_result=vision_result,
                decision_engine_result=RecommendationEngineResult(
                    recommendations=[],
                    recommendation_notice="La priorisation reste centree sur les KPI visibles.",
                    risk_level=(
                        "critical"
                        if incident_details is not None and incident_details.severity == "critique"
                        else "high"
                        if incident_details is not None and incident_details.severity == "elevee"
                        else "medium"
                        if incident_details is not None and incident_details.severity == "moyenne"
                        else "low"
                        if incident_details is not None and incident_details.severity == "faible"
                        else None
                    ),
                    optimization_score=0,
                    anomaly_score=incident_details.anomaly_score_value or 0 if incident_details is not None else 0,
                    fraud_score=incident_details.fraud_score_value or 0 if incident_details is not None else 0,
                    cost_score=incident_details.cost_score_value or 0 if incident_details is not None else 0,
                ),
            )
        elif not filtered_answer.strip():
            filtered_answer = _build_strict_visible_kpi_fallback_answer(
                image_type=image_type,
                ocr_result=ocr_result,
                vision_result=vision_result,
                decision_engine_result=RecommendationEngineResult(
                    recommendations=[],
                    recommendation_notice="La priorisation reste centree sur les KPI visibles.",
                    risk_level=(
                        "critical"
                        if incident_details is not None and incident_details.severity == "critique"
                        else "high"
                        if incident_details is not None and incident_details.severity == "elevee"
                        else "medium"
                        if incident_details is not None and incident_details.severity == "moyenne"
                        else "low"
                        if incident_details is not None and incident_details.severity == "faible"
                        else None
                    ),
                    optimization_score=0,
                    anomaly_score=incident_details.anomaly_score_value or 0 if incident_details is not None else 0,
                    fraud_score=incident_details.fraud_score_value or 0 if incident_details is not None else 0,
                    cost_score=incident_details.cost_score_value or 0 if incident_details is not None else 0,
                ),
            )
    
    # Construire les métadonnées d'analyse
    visible_kpis_used = _dedupe_items(
        [
            *ocr_result.kpis,
            *vision_result.detected_kpis,
            *invoice_visible_kpis,
            *alert_visible_kpis,
            *visible_pipeline_kpis,
        ],
        10,
    )
    analysis_metadata = build_image_analysis_metadata(
        image_type=image_type,
        ocr_result=ocr_result,
        extracted_values=extracted_values,
        removed_claims=removed_claims,
        visible_kpis_used=visible_kpis_used,
        confidence_score=max(0.0, min(parsed_confidence, 1.0)),
    )

    return FinalImageAnswer(
        answer=filtered_answer,
        detected_kpis=merged_kpis,
        recommendations=filtered_recommendations,
        detected_anomalies=merged_anomalies,
        probable_causes=merged_probable_causes,
        severity=parsed_severity,
        treatment_priority=parsed_priority,
        alert_summary=alert_summary,
        confidence=max(0.0, min(parsed_confidence, 1.0)),
        analysis_metadata=analysis_metadata,
    )


def _build_multimodal_prompt(
    *,
    question: str,
    history: list[ChatContextMessage],
    summary_context: str,
    image_type: str,
    ocr_result: OcrExtractionResult,
    vision_result: VisionAnalysisResult,
) -> str:
    return (
        "Tu es un assistant IA expert en gestion de flotte télécom.\n"
        "Ta mission est de produire une réponse fiable, concise et orientée décision.\n"
        "Règles:\n"
        "- Utiliser uniquement les données fournies.\n"
        "- Ne jamais inventer de chiffres.\n"
        "- Si une donnée est incertaine, dire estimation.\n"
        "- Réponse courte et professionnelle.\n"
        "- Toujours inclure 1 insight métier et 1 recommandation.\n\n"
        "Question utilisateur:\n"
        f"{question.strip()}\n\n"
        "Historique récent:\n"
        f"{_build_history_block(history)}\n\n"
        "Type d'image détecté:\n"
        f"{image_type}\n\n"
        "Lecture documentaire:\n"
        f"{_build_ocr_block(ocr_result)}\n\n"
        "Lecture visuelle:\n"
        f"{_limit_text(vision_result.analysis, 2500)}\n\n"
        "Données métier existantes:\n"
        f"{summary_context}\n\n"
        "Réponds STRICTEMENT en JSON valide:\n"
        "{\n"
        '  "answer": "réponse finale en français, max 7 lignes",\n'
        '  "detected_kpis": ["kpi 1", "kpi 2"],\n'
        '  "recommendations": ["action 1", "action 2"],\n'
        '  "confidence": 0.0\n'
        "}"
    )


def _build_multimodal_prompt_v2(
    *,
    question: str,
    history: list[ChatContextMessage],
    summary_context: str,
    image_type: str,
    ocr_result: OcrExtractionResult,
    vision_result: VisionAnalysisResult,
) -> str:
    routing_mode = _resolve_image_routing_mode(
        question=question,
        history=history,
        image_type=image_type,
        ocr_result=ocr_result,
        vision_result=vision_result,
    )
    visible_pipeline_kpis = _collect_visible_pipeline_kpis(ocr_result, vision_result)
    visible_kpi_section = (
        "\nIndicateurs visibles prioritaire:\n"
        + "\n".join(f"- {item}" for item in visible_pipeline_kpis[:10])
        + "\n\n"
        if visible_pipeline_kpis
        else ""
    )
    invoice_section = (
        "\nAnalyse facture/document operateur:\n"
        f"{_build_invoice_details_block(ocr_result.invoice_details)}\n\n"
        if image_type == "facture"
        else ""
    )
    incident_section = (
        "\nAnalyse alerte/log capture:\n"
        f"{_build_incident_details_block(ocr_result.incident_details)}\n\n"
        if ocr_result.incident_details is not None
        else ""
    )
    alert_kpi_section = (
        "\nKPI alerte consolides:\n"
        f"{_build_alert_dashboard_kpi_prompt_block(ocr_result.incident_details)}\n\n"
        if image_type in ALERT_FOCUSED_IMAGE_TYPES
        and ocr_result.incident_details is not None
        and _build_alert_dashboard_kpi_prompt_block(ocr_result.incident_details)
        else ""
    )
    workflow_section = (
        "\nAnalyse workflow / organigramme:\n"
        f"{_build_workflow_details_block(ocr_result.workflow_details)}\n\n"
        if ocr_result.workflow_details is not None
        else ""
    )
    equipment_section = (
        "\nAnalyse equipement telecom:\n"
        f"{_build_equipment_details_block(ocr_result.equipment_details)}\n\n"
        if ocr_result.equipment_details is not None
        else ""
    )
    equipment_vision_section = (
        "\nDetection visuelle equipement:\n"
        f"{_build_equipment_vision_block(question=question, ocr_result=ocr_result, vision_result=vision_result)}\n\n"
        if image_type == "equipement"
        else ""
    )
    if image_type == "facture":
        context_block = (
            "Contexte secondaire:\n"
            "- Pour une facture telecom, fonder l'analyse uniquement sur les montants, postes et alertes visibles sur le document.\n"
            "- Ne jamais utiliser de statistiques CSV globales comme preuve principale pour une facture.\n\n"
        )
    elif image_type in ALERT_FOCUSED_IMAGE_TYPES:
        context_block = (
            "Contexte secondaire:\n"
            "- Pour une capture d'alerte, de fraude, de log ou de dashboard securite, utiliser prioritairement les KPI visibles dans l'image.\n"
            "- Ne jamais citer de chiffres CSV globaux si ces chiffres ne figurent pas dans la capture.\n"
            "- Si plusieurs scores 100/100 sont visibles, en faire le signal critique principal.\n"
            "- Si l'impact financier visible depasse 1 000 000 MAD, classer le risque financier comme critique.\n\n"
        )
    elif routing_mode == EQUIPMENT_ROUTING_MODE_VISION_ONLY:
        context_block = (
            "Mode vision-only equipement:\n"
            "- Utiliser uniquement les objets visibles, les marques lisibles, les cartes SIM, les accessoires et l'etat apparent.\n"
            "- Interdiction totale d'utiliser les datasets telecom, les KPI globaux, les couts, le roaming, les anomalies historiques ou les CSV comme preuve.\n"
            "- Si une information n'est pas visible, ecrire exactement: non confirme visuellement.\n"
            "- Repondre comme une analyse photo d'equipements telecom, pas comme un tableau de bord metier.\n\n"
        )
    elif routing_mode == EQUIPMENT_ROUTING_MODE_FUSION:
        context_block = (
            "Mode fusion image + metier:\n"
            "- Commencer par identifier les equipements visibles, puis croiser avec le contexte metier uniquement si la question le demande.\n"
            "- Les objets visibles restent la preuve principale. Les donnees metier servent seulement de contexte secondaire.\n"
            f"Donnees metier existantes:\n{summary_context}\n\n"
        )
    else:
        context_block = f"Donnees metier existantes:\n{summary_context}\n\n"
    return (
        "Tu es un consultant IA entreprise specialise en gestion de flotte telecom.\n"
        "Tu combines lecture visuelle, contexte metier et logique d'audit pour produire une analyse credible.\n"
        "Regles:\n"
        "- Utiliser uniquement les donnees fournies.\n"
        "- Ne jamais inventer de chiffres.\n"
        "- Si une donnee est incertaine, l'omettre plutot que de la formuler comme une pseudo-certitude.\n"
        "- Si une alerte, un log ou une erreur n'est pas lisible, ecrire exactement: non lisible avec certitude.\n"
        "- Si une etape workflow n'est pas lisible, ecrire exactement: Etape non lisible avec certitude.\n"
        "- Si un modele equipement n'est pas lisible, ecrire exactement: Equipement non identifie avec certitude.\n"
        "- Interdire tout vocabulaire pipeline ou technique de type OCR, fallback, analyse rapide terminee, synthese locale.\n"
        "- Parler comme un analyste telecom et un auditeur decisionnel, pas comme un moteur technique.\n"
        "- Relier chaque recommandation a un element visible, un score, un KPI ou un risque observable.\n"
        "- Si le document est une facture telecom, citer uniquement les montants HT, TVA, TTC, la periode et les postes de cout vraiment visibles.\n"
        "- Si le document montre roaming international, depassement data ou un poste > 30% du total, en faire le point de vigilance prioritaire.\n"
        "- Si le document est une page d'alertes, un log, une capture fraude ou un dashboard securite, ne retenir que les KPI visibles sur la capture comme preuve principale.\n"
        "- Si alert_dashboard_kpis est fourni, utiliser ce bloc comme base factuelle prioritaire avant toute formulation.\n"
        "- Pour une page d'alertes, citer explicitement le nombre d'alertes critiques, le taux d'exposition, l'impact financier, les scores 100/100 et les statuts critiques lorsqu'ils sont visibles.\n"
        "- Si le visuel montre un dashboard ou un graphe, interpreter les desequilibres, pics, ecarts, concentrations et problemes de supervision visibles.\n"
        "- Reponse concise, professionnelle, naturelle et credible.\n\n"
        "Question utilisateur:\n"
        f"{question.strip()}\n\n"
        "Historique recent:\n"
        f"{_build_history_block(history)}\n\n"
        "Type d'image detecte:\n"
        f"{image_type}\n\n"
        "Lecture documentaire:\n"
        f"{_build_ocr_block(ocr_result)}\n\n"
        f"{invoice_section}"
        f"{incident_section}"
        f"{alert_kpi_section}"
        f"{visible_kpi_section}"
        f"{workflow_section}"
        f"{equipment_section}"
        f"{equipment_vision_section}"
        "Lecture visuelle:\n"
        f"{_limit_text(vision_result.analysis, 2500)}\n\n"
        f"{context_block}"
        "Reponds STRICTEMENT en JSON valide:\n"
        "{\n"
        '  "answer": "note de synthese metier en francais, ton consultant, sans jargon technique interne",\n'
        '  "detected_kpis": ["kpi 1", "kpi 2"],\n'
        '  "detected_anomalies": ["anomalie 1"],\n'
        '  "probable_causes": ["cause 1"],\n'
        '  "severity": "faible|moyenne|elevee|critique",\n'
        '  "treatment_priority": "basse|normale|haute|immediate",\n'
        '  "alert_summary": "resume court",\n'
        '  "recommendations": ["action 1", "action 2"],\n'
        '  "confidence": 0.0\n'
        "}"
    )


async def generate_image_chat_response(
    request: Request,
    db: Session,
    *,
    question: str,
    history: list[ChatContextMessage],
    image_bytes: bytes,
    filename: str | None,
    content_type: str | None,
    analysis_mode: str | None = "advanced",
    conversation_id: str | None = None,
) -> ChatImageResponse:
    started_at = _utcnow()
    question_preview = _truncate(question, 140)
    resolved_analysis_mode = _resolve_analysis_mode(analysis_mode)
    question_type = _detect_image_question_type(question)
    stage_notices: list[str] = []
    analysis_error_type: str | None = None
    advanced_analysis_available = True
    advanced_analysis_completed = False
    vision_timeout_detected = False
    used_cached_vision = False

    _log_chat_event(
        logging.INFO,
        "chat_question_sent",
        mode="image",
        question=question_preview,
        history_size=len(history),
        conversation_id=conversation_id,
        filename=filename,
        analysis_mode=resolved_analysis_mode,
    )

    try:
        await _ensure_request_connected(request)
        MULTIMODAL_LOGGER.info(
            "event=image_request_received filename=%s content_type=%s size_bytes=%s conversation_id=%s analysis_mode=%s",
            filename,
            content_type,
            len(image_bytes),
            conversation_id,
            resolved_analysis_mode,
        )
        MULTIMODAL_LOGGER.info("QUESTION_TYPE = %s", question_type)
        MULTIMODAL_LOGGER.info(
            "VISION_ONLY_MODE = %s",
            "TRUE" if question_type == QUESTION_TYPE_EQUIPMENT_DETECTION else "FALSE",
        )

        summary = get_data_summary(db)
        preprocess_started_at = time.perf_counter()
        try:
            prepared_image = prepare_image_for_analysis(
                image_bytes,
                filename=filename,
                content_type=content_type,
                max_side=get_settings().image_analysis_max_side,
            )
        except TypeError as exc:
            if "max_side" not in str(exc):
                raise
            prepared_image = prepare_image_for_analysis(
                image_bytes,
                filename=filename,
                content_type=content_type,
            )
        MULTIMODAL_LOGGER.info(
            "event=image_preprocess_completed filename=%s media_type=%s width=%s height=%s processed_width=%s processed_height=%s input_bytes=%s output_bytes=%s duration_ms=%s is_long_screenshot=%s number_of_chunks=%s chunk_sizes=%s",
            filename,
            prepared_image.media_type,
            prepared_image.width,
            prepared_image.height,
            prepared_image.processed_width,
            prepared_image.processed_height,
            len(prepared_image.original_bytes),
            len(prepared_image.processed_bytes),
            round((time.perf_counter() - preprocess_started_at) * 1000),
            prepared_image.is_long_screenshot,
            len(prepared_image.chunks),
            [
                {
                    "index": chunk.index,
                    "width": chunk.processed_width,
                    "height": chunk.processed_height,
                }
                for chunk in prepared_image.chunks
            ],
        )
        MULTIMODAL_LOGGER.info(
            "VISION_IMAGE_PREPARATION_DURATION_MS=%s",
            round((time.perf_counter() - preprocess_started_at) * 1000),
        )
        vision_image_hash = _compute_image_content_hash(
            prepared_image.processed_bytes or prepared_image.original_bytes
        )
        vision_cache_key = _build_vision_analysis_cache_key(
            conversation_id=conversation_id,
            image_hash=vision_image_hash,
        )

        await _ensure_request_connected(request)
        MULTIMODAL_LOGGER.info("event=image_ocr_started filename=%s", filename)
        ocr_result, chunk_ocr_results = await _extract_prepared_image_ocr(
            prepared_image,
            filename=filename,
        )
        if ocr_result.error_message:
            stage_notices.append(ocr_result.error_message)
        if ocr_result.status == "timeout":
            analysis_error_type = analysis_error_type or "image_timeout"
        elif ocr_result.status != "ok":
            analysis_error_type = analysis_error_type or "ocr_unavailable"
        pre_vision_image_type = _resolve_pre_vision_image_type(
            question_type=question_type,
            ocr_result=ocr_result,
        )
        pre_vision_routing = _resolve_pre_vision_routing(
            question=question,
            question_type=question_type,
            image_type=pre_vision_image_type,
        )
        vision_prompt_profile_override = _resolve_image_vision_prompt_profile_override(
            question=question,
            question_type=question_type,
            ocr_result=ocr_result,
            image_type=pre_vision_image_type,
            vision_routing=pre_vision_routing,
        )
        MULTIMODAL_LOGGER.info("QUESTION_TYPE=%s", question_type)
        MULTIMODAL_LOGGER.info("IMAGE_TYPE=%s", pre_vision_image_type or "unknown")
        MULTIMODAL_LOGGER.info("VISION_ROUTING=%s", pre_vision_routing)

        await _ensure_request_connected(request)
        vision_result: VisionAnalysisResult | None = None
        vision_succeeded = False
        cached_vision_analysis = _get_cached_vision_analysis(vision_cache_key)
        if cached_vision_analysis is not None:
            vision_result = cached_vision_analysis.vision_result
            used_cached_vision = True
            vision_succeeded = vision_result.model != "vision-fallback"
            if vision_succeeded:
                advanced_analysis_completed = True
            MULTIMODAL_LOGGER.info(
                "event=image_vision_cache_hit filename=%s conversation_id=%s image_hash=%s model=%s detected_objects=%s",
                filename,
                conversation_id,
                vision_image_hash,
                vision_result.model,
                list(cached_vision_analysis.detected_objects[:8]),
            )
        elif resolved_analysis_mode == "quick":
            MULTIMODAL_LOGGER.info(
                "event=image_quick_mode_selected filename=%s strategy=ocr_first",
                filename,
            )
            if question_type != QUESTION_TYPE_EQUIPMENT_DETECTION and _has_usable_ocr_fallback(ocr_result):
                vision_result = _build_quick_vision_result(
                    question=question,
                    ocr_result=ocr_result,
                )
            else:
                try:
                    MULTIMODAL_LOGGER.info(
                        "event=image_quick_visual_pass_started filename=%s timeout_seconds=%s",
                        filename,
                        min(18, get_settings().image_analysis_vision_timeout_seconds),
                    )
                    vision_result = await _analyze_prepared_image_with_vision(
                        question=question,
                        prepared_image=prepared_image,
                        chunk_ocr_results=chunk_ocr_results,
                        timeout_seconds=min(18, get_settings().image_analysis_vision_timeout_seconds),
                        analysis_mode="quick",
                        filename=filename,
                        prompt_profile_override=vision_prompt_profile_override,
                        question_type=question_type,
                        image_type=pre_vision_image_type,
                        vision_routing=pre_vision_routing,
                    )
                    vision_succeeded = True
                except (ImageAnalysisTimeoutError, VisionUnavailableError, LocalModelUnavailableError) as exc:
                    if isinstance(exc, ImageAnalysisTimeoutError):
                        vision_timeout_detected = True
                    stage_notices.append(
                        "Certaines donnees restent partielles, mais les KPI detectes permettent deja d'identifier les risques prioritaires."
                    )
                    vision_result = _build_vision_fallback_result(
                        question=question,
                        ocr_result=ocr_result,
                        error_message=EQUIPMENT_FALLBACK_PARTIAL_NOTICE,
                        prepared_image=prepared_image,
                        filename=filename,
                    )
                except Exception:
                    analysis_error_type = analysis_error_type or "vision_unavailable"
                    MULTIMODAL_LOGGER.exception(
                        "event=image_quick_visual_pass_failed filename=%s",
                        filename,
                    )
                    stage_notices.append(
                        "Certaines donnees detaillees n'ont pas pu etre consolidees, mais les indicateurs les plus fiables confirment les priorites de traitement."
                    )
                    vision_result = _build_vision_fallback_result(
                        question=question,
                        ocr_result=ocr_result,
                        error_message=EQUIPMENT_FALLBACK_PARTIAL_NOTICE,
                        prepared_image=prepared_image,
                        filename=filename,
                    )
        elif resolved_analysis_mode in {"advanced", "dashboard_analysis"}:
            advanced_analysis_available, availability_message = await is_vision_model_available()
            if not advanced_analysis_available:
                analysis_error_type = analysis_error_type or "vision_unavailable"
                stage_notices.append(
                        (
                            "L'analyse conserve suffisamment d'indicateurs pour prioriser les alertes et les actions immediates."
                            if resolved_analysis_mode == "dashboard_analysis"
                            else "Les indicateurs consolides suffisent pour orienter l'analyse et les actions immediates."
                        )
                    )
                vision_result = _build_vision_fallback_result(
                    question=question,
                    ocr_result=ocr_result,
                    error_message=(
                        availability_message
                        or "Les indicateurs les plus fiables ont ete conserves pour maintenir la priorisation metier."
                    ),
                    prepared_image=prepared_image,
                    filename=filename,
                )
            else:
                try:
                    vision_timeout_seconds = (
                        _resolve_image_vision_timeout_seconds(
                            question_type=question_type,
                            ocr_result=ocr_result,
                        )
                    )
                    MULTIMODAL_LOGGER.info(
                        "event=image_vision_started filename=%s model=%s timeout_seconds=%s original_size=%sx%s processed_size=%sx%s input_bytes=%s output_bytes=%s",
                        filename,
                        get_settings().ollama_vision_model,
                        vision_timeout_seconds,
                        prepared_image.width,
                        prepared_image.height,
                        prepared_image.processed_width,
                        prepared_image.processed_height,
                        len(prepared_image.original_bytes),
                        len(prepared_image.processed_bytes),
                    )
                    try:
                        vision_result = await _analyze_prepared_image_with_vision(
                            question=question,
                            prepared_image=prepared_image,
                            chunk_ocr_results=chunk_ocr_results,
                            timeout_seconds=vision_timeout_seconds,
                            analysis_mode=resolved_analysis_mode,
                            filename=filename,
                            prompt_profile_override=vision_prompt_profile_override,
                            question_type=question_type,
                            image_type=pre_vision_image_type,
                            vision_routing=pre_vision_routing,
                        )
                    except TypeError as exc:
                        if "timeout_seconds" not in str(exc):
                            raise
                        vision_result = await _analyze_prepared_image_with_vision(
                            question=question,
                            prepared_image=prepared_image,
                            chunk_ocr_results=chunk_ocr_results,
                            analysis_mode=resolved_analysis_mode,
                            timeout_seconds=vision_timeout_seconds,
                            filename=filename,
                            prompt_profile_override=vision_prompt_profile_override,
                            question_type=question_type,
                            image_type=pre_vision_image_type,
                            vision_routing=pre_vision_routing,
                        )
                    advanced_analysis_completed = True
                    vision_succeeded = True
                    MULTIMODAL_LOGGER.info(
                        "event=image_vision_completed filename=%s model=%s image_type=%s confidence=%s fallback_used=false",
                        filename,
                        vision_result.model,
                        vision_result.image_type,
                        round(vision_result.confidence, 4),
                    )
                except ImageAnalysisTimeoutError as exc:
                    analysis_error_type = analysis_error_type or "image_timeout"
                    vision_timeout_detected = True
                    stage_notices.append(
                        (
                            "L'audit visuel complet a depasse la fenetre de traitement ; l'analyse reste basee sur les KPI deja detectes."
                            if resolved_analysis_mode == "dashboard_analysis"
                            else "Le traitement visuel detaille a pris trop de temps ; la synthese reste centree sur les indicateurs deja detectes."
                        )
                    )
                    MULTIMODAL_LOGGER.warning(
                        "event=image_vision_timeout filename=%s model=%s timeout_seconds=%s message=%s",
                        filename,
                        get_settings().ollama_vision_model,
                        vision_timeout_seconds,
                        exc.user_message,
                    )
                    vision_result = _build_vision_fallback_result(
                        question=question,
                        ocr_result=ocr_result,
                        error_message=EQUIPMENT_FALLBACK_PARTIAL_NOTICE,
                        prepared_image=prepared_image,
                        filename=filename,
                    )
                except (VisionUnavailableError, LocalModelUnavailableError) as exc:
                    analysis_error_type = analysis_error_type or (
                        "vision_unavailable" if exc.code == "VISION_UNAVAILABLE" else "ollama_unavailable"
                    )
                    stage_notices.append(
                        (
                            "L'audit visuel complet n'etait pas disponible ; la decision reste basee sur les signaux deja consolides."
                            if resolved_analysis_mode == "dashboard_analysis"
                            else "Le traitement visuel detaille n'etait pas disponible ; la synthese reste centree sur les indicateurs detectes."
                        )
                    )
                    MULTIMODAL_LOGGER.warning(
                        "event=image_vision_failed filename=%s model=%s timeout_seconds=%s code=%s message=%s",
                        filename,
                        get_settings().ollama_vision_model,
                        vision_timeout_seconds,
                        exc.code,
                        exc.user_message,
                    )
                    if exc.code in {"VISION_UNAVAILABLE", "OLLAMA_OFFLINE"}:
                        advanced_analysis_available = False
                    vision_result = _build_vision_fallback_result(
                        question=question,
                        ocr_result=ocr_result,
                        error_message="Analyse visuelle avancee indisponible ; conclusions bornees aux elements visibles et lisibles.",
                        prepared_image=prepared_image,
                        filename=filename,
                    )
                except Exception:
                    analysis_error_type = analysis_error_type or "vision_unavailable"
                    stage_notices.append(
                        (
                            "L'audit visuel complet a rencontre un incident technique ; la priorisation reste basee sur les signaux deja consolides."
                            if resolved_analysis_mode == "dashboard_analysis"
                            else "Le traitement visuel detaille a rencontre un incident technique ; la synthese reste disponible sur les indicateurs les plus stables."
                        )
                    )
                    MULTIMODAL_LOGGER.exception(
                        "event=image_vision_unexpected_failure filename=%s analysis_mode=%s",
                        filename,
                        resolved_analysis_mode,
                    )
                    vision_result = _build_vision_fallback_result(
                        question=question,
                        ocr_result=ocr_result,
                        error_message=(
                            "Le traitement visuel detaille a rencontre un incident technique ; les conclusions restent bornees aux indicateurs exploitables."
                        ),
                        prepared_image=prepared_image,
                        filename=filename,
                    )
        else:
            try:
                vision_timeout_seconds = (
                    _resolve_image_vision_timeout_seconds(
                        question_type=question_type,
                        ocr_result=ocr_result,
                    )
                )
                MULTIMODAL_LOGGER.info(
                    "event=image_vision_started filename=%s model=%s timeout_seconds=%s original_size=%sx%s processed_size=%sx%s input_bytes=%s output_bytes=%s",
                    filename,
                    get_settings().ollama_vision_model,
                    vision_timeout_seconds,
                    prepared_image.width,
                    prepared_image.height,
                    prepared_image.processed_width,
                    prepared_image.processed_height,
                    len(prepared_image.original_bytes),
                    len(prepared_image.processed_bytes),
                )
                try:
                    vision_result = await analyze_image_with_llava(
                        question=question,
                        image_base64=prepared_image.vision_base64_payload,
                        timeout_seconds=vision_timeout_seconds,
                        analysis_mode=resolved_analysis_mode,
                        prompt_profile_override=vision_prompt_profile_override,
                        question_type=question_type,
                        image_type=pre_vision_image_type,
                        vision_routing=pre_vision_routing,
                    )
                except TypeError as exc:
                    if "timeout_seconds" not in str(exc):
                        raise
                    vision_result = await analyze_image_with_llava(
                        question=question,
                        image_base64=prepared_image.vision_base64_payload,
                        analysis_mode=resolved_analysis_mode,
                        prompt_profile_override=vision_prompt_profile_override,
                        question_type=question_type,
                        image_type=pre_vision_image_type,
                        vision_routing=pre_vision_routing,
                    )
                vision_succeeded = True
                MULTIMODAL_LOGGER.info(
                    "event=image_vision_completed filename=%s model=%s image_type=%s confidence=%s fallback_used=false",
                    filename,
                    vision_result.model,
                    vision_result.image_type,
                    round(vision_result.confidence, 4),
                )
            except ImageAnalysisTimeoutError as exc:
                analysis_error_type = analysis_error_type or "image_timeout"
                vision_timeout_detected = True
                stage_notices.append(
                    "La lecture visuelle a pris trop de temps ; une synthese de priorisation reste toutefois disponible."
                )
                MULTIMODAL_LOGGER.warning(
                    "event=image_vision_timeout filename=%s model=%s timeout_seconds=%s message=%s",
                    filename,
                    get_settings().ollama_vision_model,
                    vision_timeout_seconds,
                    exc.user_message,
                )
                vision_result = _build_vision_fallback_result(
                    question=question,
                    ocr_result=ocr_result,
                    error_message=EQUIPMENT_FALLBACK_PARTIAL_NOTICE,
                    prepared_image=prepared_image,
                    filename=filename,
                )
            except (VisionUnavailableError, LocalModelUnavailableError) as exc:
                analysis_error_type = analysis_error_type or (
                    "vision_unavailable" if exc.code == "VISION_UNAVAILABLE" else "ollama_unavailable"
                )
                stage_notices.append(
                    "La lecture visuelle n'etait pas disponible ; la decision s'appuie sur les signaux deja consolides."
                )
                MULTIMODAL_LOGGER.warning(
                    "event=image_vision_failed filename=%s model=%s timeout_seconds=%s code=%s message=%s",
                    filename,
                    get_settings().ollama_vision_model,
                    vision_timeout_seconds,
                    exc.code,
                    exc.user_message,
                )
                if exc.code in {"VISION_UNAVAILABLE", "OLLAMA_OFFLINE"}:
                    advanced_analysis_available = False
                vision_result = _build_vision_fallback_result(
                    question=question,
                    ocr_result=ocr_result,
                    error_message="Analyse visuelle avancee indisponible ; conclusions bornees aux elements visibles et lisibles.",
                    prepared_image=prepared_image,
                    filename=filename,
                )
            except Exception:
                analysis_error_type = analysis_error_type or "vision_unavailable"
                stage_notices.append(
                    "La lecture visuelle a rencontre un incident technique ; une synthese borne reste toutefois disponible."
                )
                MULTIMODAL_LOGGER.exception(
                    "event=image_vision_unexpected_failure filename=%s analysis_mode=%s",
                    filename,
                    resolved_analysis_mode,
                )
                vision_result = _build_vision_fallback_result(
                    question=question,
                    ocr_result=ocr_result,
                    error_message=(
                        "La lecture visuelle n'a pas abouti ; l'analyse retient uniquement les signaux les plus robustes."
                    ),
                    prepared_image=prepared_image,
                    filename=filename,
                )

        if vision_result is None:
            analysis_error_type = analysis_error_type or "vision_unavailable"
            stage_notices.append(
                "La lecture visuelle detaillee n'a pas pu etre consolidee ; l'analyse reste disponible sur les KPI detectes."
            )
            vision_result = _build_vision_fallback_result(
                question=question,
                ocr_result=ocr_result,
                error_message=(
                    "La lecture visuelle detaillee n'etait pas disponible ; les conclusions restent basees sur les signaux exploitables."
                ),
                prepared_image=prepared_image,
                filename=filename,
            )

        if vision_result.model != "vision-fallback":
            vision_result = _reclassify_network_device(
                vision_result=vision_result,
                prepared_image=prepared_image,
                detected_objects=vision_result.detected_objects,
                ocr_result=ocr_result,
            )

        provisional_image_type = _infer_image_type(question, ocr_result, vision_result)
        provisional_routing_mode = _resolve_image_routing_mode(
            question=question,
            history=history,
            image_type=provisional_image_type,
            ocr_result=ocr_result,
            vision_result=vision_result,
        )
        if (
            provisional_routing_mode == EQUIPMENT_ROUTING_MODE_VISION_ONLY
            and provisional_image_type == "capture_interface"
            and _has_physical_equipment_signals(
                question=question,
                history=history,
                ocr_result=ocr_result,
                vision_result=vision_result,
            )
        ):
            provisional_image_type = "equipement"
        if (
            provisional_image_type == "equipement"
            and provisional_routing_mode == EQUIPMENT_ROUTING_MODE_VISION_ONLY
            and (not vision_succeeded or vision_result.model == "vision-fallback")
        ):
            response = _build_visual_detection_failure_response(
                question=question,
                summary_updated_at=summary.updated_at,
                analysis_mode=resolved_analysis_mode,
                started_at=started_at,
                ocr_result=ocr_result,
                vision_result=vision_result,
                analysis_error_type=analysis_error_type,
                advanced_analysis_available=advanced_analysis_available,
                advanced_analysis_completed=advanced_analysis_completed,
                question_type=question_type,
                vision_timeout_detected=vision_timeout_detected,
                cached=used_cached_vision,
            )
            _store_cached_vision_analysis(
                vision_cache_key,
                vision_result=vision_result,
                previous_response=response.answer,
            )
            _log_chat_event(
                logging.INFO,
                "chat_response_completed",
                mode="image",
                cached=response.cached,
                duration_ms=response.duration_ms,
                question=question_preview,
                conversation_id=conversation_id,
                image_type=response.image_type,
                analysis_mode=resolved_analysis_mode,
            )
            return response

        await _ensure_request_connected(request)
        equipment_details = _resolve_equipment_details(
            question=question,
            ocr_result=ocr_result,
            vision_result=vision_result,
        )
        provisional_ocr_result = (
            replace(ocr_result, equipment_details=equipment_details)
            if equipment_details is not None and ocr_result.equipment_details is None
            else ocr_result
        )
        provisional_image_type = _infer_image_type(question, provisional_ocr_result, vision_result)
        enriched_invoice_details = (
            analyze_invoice_context(ocr_result)
            if provisional_image_type != "equipement"
            else ocr_result.invoice_details
        )
        enriched_incident_details = (
            None
            if provisional_image_type == "equipement"
            else analyze_alert_dashboard_context(
                ocr_result,
                vision_text="\n".join(
                    [
                        vision_result.analysis,
                        *vision_result.detected_kpis,
                        *vision_result.recommendations,
                    ]
                ),
            )
        )
        # Log enriched KPI for debugging
        if enriched_incident_details is not None:
            MULTIMODAL_LOGGER.info(
                "event=enriched_incident_details_verified critical_alerts=%s at_risk_clients=%s churn_rate=%s revenue_at_risk=%s fraud_score=%s anomaly_score=%s critical_signals_count=%d",
                enriched_incident_details.critical_alert_count,
                enriched_incident_details.at_risk_clients_count,
                enriched_incident_details.churn_rate,
                enriched_incident_details.revenue_at_risk_mad,
                enriched_incident_details.fraud_score_visible,
                enriched_incident_details.anomaly_score_visible,
                len(enriched_incident_details.critical_signals) if enriched_incident_details.critical_signals else 0,
            )
        if equipment_details is not None and ocr_result.equipment_details is None:
            enriched_ocr_result = replace(
                ocr_result,
                equipment_details=equipment_details,
                invoice_details=enriched_invoice_details or ocr_result.invoice_details,
                incident_details=enriched_incident_details or ocr_result.incident_details,
            )
        elif enriched_invoice_details is not None:
            enriched_ocr_result = replace(
                ocr_result,
                invoice_details=enriched_invoice_details,
                incident_details=enriched_incident_details or ocr_result.incident_details,
            )
        elif enriched_incident_details is not None:
            enriched_ocr_result = replace(
                ocr_result,
                incident_details=enriched_incident_details,
            )
        else:
            enriched_ocr_result = ocr_result
        provisional_image_type = _infer_image_type(question, enriched_ocr_result, vision_result)
        preliminary_kpis = _collect_visible_pipeline_kpis(enriched_ocr_result, vision_result)
        if (
            _should_use_dashboard_kpi_strict_response(provisional_image_type)
            and enriched_ocr_result.status != "ok"
            and len(preliminary_kpis) < VISIBLE_KPI_STRICT_THRESHOLD
        ):
            dashboard_fallback_snapshot = _build_dashboard_fallback_snapshot()
            if dashboard_fallback_snapshot is not None:
                MULTIMODAL_LOGGER.info(
                    "STRICT KPI RESPONSE USED image_type=%s visible_kpis_before=%s",
                    provisional_image_type,
                    len(preliminary_kpis),
                )
                MULTIMODAL_LOGGER.info("ANSWER_SOURCE = %s", dashboard_fallback_snapshot.source)
                enriched_ocr_result = _apply_dashboard_fallback_snapshot(
                    ocr_result=enriched_ocr_result,
                    snapshot=dashboard_fallback_snapshot,
                )
                stage_notices = [
                    notice
                    for notice in stage_notices
                    if all(
                        blocked not in _normalize_invoice_text(notice)
                        for blocked in (
                            "lecture documentaire locale indisponible",
                            "lecture ocr",
                            "lecture visuelle approfondie",
                            "analyse exploitable",
                            "capture doit etre enrichie",
                            "capture a enrichir",
                        )
                    )
                ]
                analysis_error_type = None
                preliminary_kpis = _collect_visible_pipeline_kpis(enriched_ocr_result, vision_result)
        if (
            len(preliminary_kpis) >= VISIBLE_KPI_STRICT_THRESHOLD
            and (enriched_ocr_result.confidence or 0.0) < OCR_CONFIDENCE_STRONG_KPI_FLOOR
        ):
            MULTIMODAL_LOGGER.info(
                "event=ocr_confidence_floor_applied filename=%s previous_confidence=%s new_confidence=%s visible_kpis=%d",
                filename,
                round((enriched_ocr_result.confidence or 0.0) * 100, 1),
                round(OCR_CONFIDENCE_STRONG_KPI_FLOOR * 100, 1),
                len(preliminary_kpis),
            )
            enriched_ocr_result = replace(
                enriched_ocr_result,
                confidence=OCR_CONFIDENCE_STRONG_KPI_FLOOR,
            )
        stage_notices = _normalize_stage_notices(stage_notices)
        stage_notices = _sanitize_stage_notices_for_alert_kpis(
            stage_notices,
            enriched_ocr_result.incident_details,
        )
        image_type = _infer_image_type(question, enriched_ocr_result, vision_result)
        image_routing_mode = _resolve_image_routing_mode(
            question=question,
            history=history,
            image_type=image_type,
            ocr_result=enriched_ocr_result,
            vision_result=vision_result,
        )
        direct_vision_removed_hallucinated_objects: list[str] = []
        direct_vision_sanitizer_applied = False
        if (
            image_routing_mode == EQUIPMENT_ROUTING_MODE_VISION_ONLY
            and image_type == "capture_interface"
            and _has_physical_equipment_signals(
                question=question,
                history=history,
                ocr_result=enriched_ocr_result,
                vision_result=vision_result,
            )
        ):
            image_type = "equipement"
        if (
            image_type == "equipement"
            and image_routing_mode == EQUIPMENT_ROUTING_MODE_VISION_ONLY
            and question_type == QUESTION_TYPE_EQUIPMENT_DETECTION
        ):
            vision_result, direct_vision_removed_hallucinated_objects, direct_vision_sanitizer_applied = _post_process_equipment_direct_vision_result(
                question_type=question_type,
                prepared_image=prepared_image,
                ocr_result=enriched_ocr_result,
                vision_result=vision_result,
            )
            enriched_ocr_result = _sanitize_direct_vision_equipment_context(
                question=question,
                ocr_result=enriched_ocr_result,
                vision_result=vision_result,
            )
        visible_pipeline_kpis = _collect_visible_pipeline_kpis(enriched_ocr_result, vision_result)
        force_visible_only_fallback = _should_force_visible_only_fallback_response(
            question=question,
            question_type=question_type,
            image_type=image_type,
            routing_mode=image_routing_mode,
            ocr_result=enriched_ocr_result,
            vision_result=vision_result,
        )
        stage_notices = _sanitize_stage_notices_for_visible_kpis(
            stage_notices,
            visible_pipeline_kpis,
        )
        stage_notices = _sanitize_stage_notices_for_dashboard_kpi_strict_response(
            stage_notices,
            image_type,
        )
        MULTIMODAL_LOGGER.info(
            "event=image_pipeline_order filename=%s analysis_mode=%s image_type=%s order=ocr->kpi->business_analysis->prompt->llm->post_processing",
            filename,
            resolved_analysis_mode,
            image_type,
        )
        MULTIMODAL_LOGGER.info(
            "event=image_routing_resolved filename=%s image_type=%s routing_mode=%s",
            filename,
            image_type,
            image_routing_mode,
        )
        MULTIMODAL_LOGGER.info("IMAGE_TYPE=%s", image_type)
        if image_routing_mode == EQUIPMENT_ROUTING_MODE_VISION_ONLY:
            MULTIMODAL_LOGGER.info("VISION_ROUTING = EQUIPMENT")
            MULTIMODAL_LOGGER.info("VISION_ROUTING=EQUIPMENT")
            MULTIMODAL_LOGGER.info("VISION_ROUTING_REASON = physical_objects_detected")
        else:
            MULTIMODAL_LOGGER.info("VISION_ROUTING=STANDARD")
        MULTIMODAL_LOGGER.info(
            "VISION_TIMEOUT = %s",
            "TRUE" if vision_timeout_detected else "FALSE",
        )
        MULTIMODAL_LOGGER.info(
            "GLOBAL_CONTEXT_BLOCKED = %s",
            (
                "TRUE"
                if image_routing_mode == EQUIPMENT_ROUTING_MODE_VISION_ONLY or force_visible_only_fallback
                else "FALSE"
            ),
        )
        _log_kpi_pipeline_debug(
            question=question,
            image_type=image_type,
            analysis_mode=resolved_analysis_mode,
            ocr_result=enriched_ocr_result,
            vision_result=vision_result,
        )
        if force_visible_only_fallback:
            response = (
                _build_visual_detection_failure_response(
                    question=question,
                    summary_updated_at=summary.updated_at,
                    analysis_mode=resolved_analysis_mode,
                    started_at=started_at,
                    ocr_result=enriched_ocr_result,
                    vision_result=vision_result,
                    analysis_error_type=analysis_error_type or "vision_low_confidence",
                    advanced_analysis_available=advanced_analysis_available,
                    advanced_analysis_completed=advanced_analysis_completed,
                    question_type=question_type,
                    vision_timeout_detected=vision_timeout_detected,
                    cached=used_cached_vision,
                )
                if image_type == "equipement"
                or question_type == QUESTION_TYPE_EQUIPMENT_DETECTION
                or image_routing_mode == EQUIPMENT_ROUTING_MODE_VISION_ONLY
                else _build_visible_only_fallback_response(
                    question=question,
                    question_type=question_type,
                    summary_updated_at=summary.updated_at,
                    analysis_mode=resolved_analysis_mode,
                    started_at=started_at,
                    image_type=image_type,
                    ocr_result=enriched_ocr_result,
                    vision_result=vision_result,
                    analysis_error_type=analysis_error_type or "vision_low_confidence",
                    advanced_analysis_available=advanced_analysis_available,
                    advanced_analysis_completed=advanced_analysis_completed,
                    vision_timeout_detected=vision_timeout_detected,
                    cached=used_cached_vision,
                )
            )
            _store_cached_vision_analysis(
                vision_cache_key,
                vision_result=vision_result,
                previous_response=response.answer,
            )
            _log_chat_event(
                logging.INFO,
                "chat_response_completed",
                mode="image",
                cached=response.cached,
                duration_ms=response.duration_ms,
                question=question_preview,
                conversation_id=conversation_id,
                image_type=response.image_type,
                analysis_mode=resolved_analysis_mode,
            )
            return response
        dashboard_analysis = (
            analyze_dashboard_image(
                question=question,
                ocr_result=enriched_ocr_result,
                vision_result=vision_result,
                summary=summary,
            )
            if _should_run_dashboard_analysis(
                analysis_mode=resolved_analysis_mode,
                inferred_image_type=image_type,
            )
            else None
        )
        if (
            dashboard_analysis is not None
            and _should_run_dashboard_analysis(
                analysis_mode=resolved_analysis_mode,
                inferred_image_type=image_type,
            )
        ):
            image_type = "dashboard"
        skip_business_model_for_direct_vision = bool(
            image_type == "equipement"
            and image_routing_mode == EQUIPMENT_ROUTING_MODE_VISION_ONLY
            and question_type == QUESTION_TYPE_EQUIPMENT_DETECTION
            and vision_result.model != "vision-fallback"
        )
        raw_answer = ""
        if skip_business_model_for_direct_vision:
            advanced_analysis_completed = True
            MULTIMODAL_LOGGER.info(
                "event=image_business_model_skipped filename=%s analysis_mode=%s strategy=vision_only_direct_response",
                filename,
                resolved_analysis_mode,
            )
            _log_llm_prompt_debug(
                analysis_mode=resolved_analysis_mode,
                image_type=image_type,
                visible_kpis=visible_pipeline_kpis,
                prompt=None,
                skipped_reason="vision_only_direct_response",
            )
        elif resolved_analysis_mode == "quick":
            MULTIMODAL_LOGGER.info(
                "event=image_business_model_skipped filename=%s analysis_mode=%s strategy=ocr_first",
                filename,
                resolved_analysis_mode,
            )
            _log_llm_prompt_debug(
                analysis_mode=resolved_analysis_mode,
                image_type=image_type,
                visible_kpis=visible_pipeline_kpis,
                prompt=None,
                skipped_reason="quick_mode_ocr_first",
            )
        else:
            multimodal_prompt = _build_multimodal_prompt_v2(
                question=question,
                history=history,
                summary_context=summary.prompt_context,
                image_type=image_type,
                ocr_result=enriched_ocr_result,
                vision_result=vision_result,
            )
            
            # Log the final prompt for debugging - show if KPI section is included
            if "alert_dashboard_kpis" in multimodal_prompt:
                MULTIMODAL_LOGGER.debug(
                    "event=final_prompt_built_image prompt_includes_kpis=true image_type=%s incident_details_present=%s",
                    image_type,
                    enriched_ocr_result.incident_details is not None,
                )
            else:
                MULTIMODAL_LOGGER.info(
                    "event=final_prompt_built_image prompt_includes_kpis=false image_type=%s incident_details_present=%s",
                    image_type,
                    enriched_ocr_result.incident_details is not None,
                )
            _log_llm_prompt_debug(
                analysis_mode=resolved_analysis_mode,
                image_type=image_type,
                visible_kpis=visible_pipeline_kpis,
                prompt=multimodal_prompt,
            )
            
            try:
                MULTIMODAL_LOGGER.info(
                    "event=image_business_model_started filename=%s image_type=%s timeout_seconds=%s",
                    filename,
                    image_type,
                    get_settings().image_analysis_llm_timeout_seconds,
                )
                try:
                    raw_answer = await _generate_with_ollama(
                        multimodal_prompt,
                        timeout_seconds=get_settings().image_analysis_llm_timeout_seconds,
                    )
                except TypeError as exc:
                    if "timeout_seconds" not in str(exc):
                        raise
                    raw_answer = await _generate_with_ollama(multimodal_prompt)
                MULTIMODAL_LOGGER.info(
                    "event=image_business_model_completed filename=%s response_length=%s",
                    filename,
                    len(raw_answer),
                )
            except ChatServiceError as exc:
                MULTIMODAL_LOGGER.warning(
                    "event=image_business_model_failed filename=%s code=%s message=%s",
                    filename,
                    exc.code,
                    exc.user_message,
                )
                if exc.code == "TIMEOUT":
                    analysis_error_type = analysis_error_type or "model_timeout"
                    stage_notices.append(
                        "La note finale a ete recentree sur les priorites les plus materielles pour accelerer la decision."
                    )
                elif exc.code == "OLLAMA_OFFLINE":
                    analysis_error_type = analysis_error_type or "ollama_unavailable"
                    stage_notices.append(
                        "La consolidation redactionnelle n'etait pas disponible ; l'analyse retient une lecture decisionnelle plus directe."
                    )
                else:
                    stage_notices.append(
                        "La synthese detaillee n'etait pas disponible ; les priorites visibles ont ete conservees."
                    )
                raw_answer = ""
        _log_llm_response_debug(
            analysis_mode=resolved_analysis_mode,
            image_type=image_type,
            raw_answer=raw_answer,
            skipped_reason=(
                "vision_only_direct_response"
                if skip_business_model_for_direct_vision
                else "quick_mode_ocr_first"
                if resolved_analysis_mode == "quick"
                else None
            ),
        )

        parsed_answer = _parse_final_model_answer(
            raw_answer,
            analysis_mode=resolved_analysis_mode,
            image_type=image_type,
            ocr_result=enriched_ocr_result,
            vision_result=vision_result,
            summary_recommendations=summary.recommendations,
            dashboard_analysis=dashboard_analysis,
        )
        parsed_answer = _apply_image_routing_metadata(
            parsed_answer=parsed_answer,
            routing_mode=image_routing_mode,
        )
        if image_type == "equipement" and image_routing_mode == EQUIPMENT_ROUTING_MODE_VISION_ONLY:
            parsed_answer = _sanitize_vision_only_equipment_answer(
                parsed_answer=parsed_answer,
                question=question,
                ocr_result=enriched_ocr_result,
                vision_result=vision_result,
            )
        try:
            if image_type == "facture" and enriched_ocr_result.invoice_details is not None:
                decision_engine_result = _build_invoice_decision_recommendations(
                    enriched_ocr_result.invoice_details
                )
            elif image_type == "equipement" and image_routing_mode == EQUIPMENT_ROUTING_MODE_VISION_ONLY:
                decision_engine_result = _build_vision_only_equipment_decision_recommendations(
                    equipment_details=enriched_ocr_result.equipment_details,
                    model_recommendations=parsed_answer.recommendations,
                )
            elif (
                image_type in ALERT_FOCUSED_IMAGE_TYPES
                and enriched_ocr_result.incident_details is not None
            ):
                decision_engine_result = _build_alert_decision_recommendations(
                    enriched_ocr_result.incident_details
                )
            elif should_use_strict_mode(image_type):
                decision_engine_result = _build_dashboard_strict_recommendations(
                    ocr_result=enriched_ocr_result,
                    parsed_answer=parsed_answer,
                    vision_result=vision_result,
                )
            else:
                decision_engine_result = build_decision_recommendations(
                    summary=summary,
                    image_type=image_type,
                    ocr_result=enriched_ocr_result,
                    detected_anomalies=parsed_answer.detected_anomalies,
                    model_recommendations=parsed_answer.recommendations,
                    dashboard_analysis=dashboard_analysis,
                )
        except Exception:
            MULTIMODAL_LOGGER.exception(
                "event=image_recommendation_engine_failed filename=%s image_type=%s",
                filename,
                image_type,
            )
            stage_notices.append("Generation recommandations IA indisponible.")
            decision_engine_result = RecommendationEngineResult(
                recommendations=[],
                recommendation_notice="La recommandation privilegie les indicateurs visibles les plus structurants.",
                risk_level=None,
                optimization_score=0,
                anomaly_score=0,
                fraud_score=0,
                cost_score=0,
            )

        detected_operator = (
            enriched_ocr_result.invoice_details.operator
            if enriched_ocr_result.invoice_details is not None
            else (
                enriched_ocr_result.incident_details.operator
                if enriched_ocr_result.incident_details is not None
                else (
                    enriched_ocr_result.equipment_details.operator
                    if enriched_ocr_result.equipment_details is not None
                    else (enriched_ocr_result.operators[0] if enriched_ocr_result.operators else None)
                )
            )
        )
        annotation_result = ImageAnnotationResult(highlighted_image=None, annotations=[])
        if vision_succeeded:
            try:
                annotation_result = build_image_annotations(
                    prepared_image,
                    ocr_result=enriched_ocr_result,
                    image_type=image_type,
                    detected_kpis=parsed_answer.detected_kpis,
                    detected_anomalies=parsed_answer.detected_anomalies,
                    detected_operator=detected_operator,
                )
            except MemoryPressureError:
                raise
            except Exception:
                MULTIMODAL_LOGGER.exception(
                    "event=image_annotation_failed filename=%s image_type=%s",
                    filename,
                    image_type,
                )
                stage_notices.append(
                    "Les zones d'attention n'ont pas pu etre annotees, sans impact sur la lecture metier principale."
                )

        if not (
            resolved_analysis_mode == "dashboard_analysis"
            and image_type == "dashboard"
            and dashboard_analysis is not None
        ):
            consultant_answer = _compose_consultant_image_answer(
                question=question,
                image_type=image_type,
                parsed_answer=parsed_answer,
                ocr_result=enriched_ocr_result,
                vision_result=vision_result,
                decision_engine_result=decision_engine_result,
                routing_mode=image_routing_mode,
            )
            consultant_removed_claims: list[str] = []
            if should_use_strict_mode(image_type):
                consultant_answer, consultant_removed_claims = _postprocess_consultant_answer_strict(
                    image_type=image_type,
                    answer=consultant_answer,
                    ocr_result=enriched_ocr_result,
                    vision_result=vision_result,
                    decision_engine_result=decision_engine_result,
                )
            updated_metadata = parsed_answer.analysis_metadata
            if updated_metadata is not None and consultant_removed_claims:
                updated_metadata = replace(
                    updated_metadata,
                    removed_unverified_claims=_dedupe_items(
                        [
                            *updated_metadata.removed_unverified_claims,
                            *consultant_removed_claims,
                        ],
                        24,
                    ),
                )
            parsed_answer = replace(
                parsed_answer,
                answer=consultant_answer,
                analysis_metadata=updated_metadata,
            )

        analysis_status, processing_message = _build_processing_message(
            analysis_mode=resolved_analysis_mode,
            advanced_analysis_completed=advanced_analysis_completed,
            stage_notices=stage_notices,
        )
        normalized_stage_notices = _dedupe_items(stage_notices, 6)
        if image_routing_mode == EQUIPMENT_ROUTING_MODE_VISION_ONLY:
            finalized_answer = (
                parsed_answer.answer.strip()
                or _build_equipment_visual_fallback_answer(
                    question=question,
                    ocr_result=enriched_ocr_result,
                    vision_result=vision_result,
                )
            )
        else:
            finalized_answer = _finalize_answer(question, parsed_answer.answer, summary)
        allow_max_risk_score = _multimodal_allows_max_risk_score(enriched_ocr_result.incident_details)
        finalized_answer = polish_business_text(
            finalized_answer,
            exceptional_scores=allow_max_risk_score,
        )
        parsed_answer = replace(
            parsed_answer,
            answer=finalized_answer,
            detected_kpis=polish_business_items(
                parsed_answer.detected_kpis,
                limit=14,
                exceptional_scores=allow_max_risk_score,
            ),
            recommendations=polish_business_items(
                parsed_answer.recommendations,
                limit=8,
                exceptional_scores=allow_max_risk_score,
            ),
            detected_anomalies=polish_business_items(
                parsed_answer.detected_anomalies,
                limit=8,
                exceptional_scores=allow_max_risk_score,
            ),
            probable_causes=polish_business_items(
                parsed_answer.probable_causes,
                limit=6,
                exceptional_scores=allow_max_risk_score,
            ),
            alert_summary=polish_business_text(
                parsed_answer.alert_summary,
                exceptional_scores=allow_max_risk_score,
            )
            or parsed_answer.alert_summary,
        )
        normalized_stage_notices = polish_business_items(
            normalized_stage_notices,
            limit=6,
            exceptional_scores=allow_max_risk_score,
        )
        _log_final_answer_debug(
            analysis_mode=resolved_analysis_mode,
            image_type=image_type,
            visible_kpis=visible_pipeline_kpis,
            final_answer=finalized_answer,
        )

        include_summary_sources = image_routing_mode != EQUIPMENT_ROUTING_MODE_VISION_ONLY
        sources = _dedupe_items(
            [
                *(summary.sources if include_summary_sources else []),
                "multimodal:image",
                f"analysis-mode:{resolved_analysis_mode}",
                f"ocr:easyocr:{enriched_ocr_result.status}",
                f"vision:{vision_result.model}",
                *(
                    [f"decision-engine:{decision_engine_result.risk_level}"]
                    if decision_engine_result.risk_level
                    else []
                ),
                *(
                    [f"annotation:opencv:{len(annotation_result.annotations)}"]
                    if annotation_result.annotations
                    else []
                ),
                *(
                    [f"workflow:{enriched_ocr_result.workflow_details.workflow_type or 'workflow'}"]
                    if enriched_ocr_result.workflow_details is not None
                    else []
                ),
                *(
                    [f"equipment:{enriched_ocr_result.equipment_details.equipment_type or 'appareil_inconnu'}"]
                    if enriched_ocr_result.equipment_details is not None
                    else []
                ),
            ],
            20,
        )
        recommendation_notice = _append_notice(
            decision_engine_result.recommendation_notice,
            " ".join(normalized_stage_notices) if normalized_stage_notices else None,
        )
        recommendation_notice = (
            polish_business_text(
                recommendation_notice,
                exceptional_scores=allow_max_risk_score,
            )
            or recommendation_notice
        )
        resolved_response_risk_level = _resolve_business_risk_level(
            initial_risk_level=decision_engine_result.risk_level,
            image_type=image_type,
            ocr_result=enriched_ocr_result,
            decision_engine_result=decision_engine_result,
            parsed_severity=parsed_answer.severity,
        )
        resolved_response_priority = _resolve_business_priority(
            initial_priority=parsed_answer.treatment_priority
            or (
                enriched_ocr_result.incident_details.priority
                if enriched_ocr_result.incident_details is not None
                else None
            ),
            resolved_risk_level=resolved_response_risk_level,
            image_type=image_type,
            ocr_result=enriched_ocr_result,
            decision_engine_result=decision_engine_result,
        )
        alert_intelligence = _build_alert_intelligence(
            incident_details=enriched_ocr_result.incident_details,
            decision_engine_result=decision_engine_result,
            ocr_confidence=_effective_ocr_confidence(enriched_ocr_result, vision_result),
        )
        alert_intelligence = _polish_alert_intelligence(
            alert_intelligence,
            exceptional_scores=allow_max_risk_score,
        )

        response = ChatImageResponse(
            answer=finalized_answer,
            model=get_settings().ollama_model,
            title_hint=_derive_title_hint(question),
            sources=sources,
            summary_updated_at=summary.updated_at,
            cached=used_cached_vision,
            fallback_used=(
                vision_result.model == "vision-fallback"
                or (
                    raw_answer == ""
                    and resolved_analysis_mode != "quick"
                    and not skip_business_model_for_direct_vision
                )
                or analysis_status == "fallback"
            ),
            duration_ms=_elapsed_ms(started_at),
            image_type=image_type,
            ocr_text=_limit_text(enriched_ocr_result.text, 6000),
            vision_analysis=_limit_text(vision_result.analysis, 5000),
            analysis_mode=resolved_analysis_mode,
            analysis_status=analysis_status,
            advanced_analysis_available=advanced_analysis_available,
            advanced_analysis_completed=advanced_analysis_completed,
            processing_message=processing_message,
            processing_notices=normalized_stage_notices,
            error_type=analysis_error_type,
            fallback_answer=finalized_answer if analysis_status == "fallback" else None,
            detected_kpis=parsed_answer.detected_kpis,
            recommendations=parsed_answer.recommendations,
            confidence=parsed_answer.confidence,
            ocr_confidence=_effective_ocr_confidence(enriched_ocr_result, vision_result),
            detected_operator=detected_operator,
            detected_anomalies=parsed_answer.detected_anomalies,
            analysis_metadata=(
                ChatImageAnalysisMetadata(
                    source_mode=parsed_answer.analysis_metadata.source_mode if parsed_answer.analysis_metadata else "standard",
                    visible_kpis_used=parsed_answer.analysis_metadata.visible_kpis_used if parsed_answer.analysis_metadata else [],
                    blocked_global_context=parsed_answer.analysis_metadata.blocked_global_context if parsed_answer.analysis_metadata else False,
                    removed_unverified_claims=parsed_answer.analysis_metadata.removed_unverified_claims if parsed_answer.analysis_metadata else [],
                    filtered_numbers=parsed_answer.analysis_metadata.filtered_numbers if parsed_answer.analysis_metadata else [],
                    confidence_score=parsed_answer.analysis_metadata.confidence_score if parsed_answer.analysis_metadata else 0.0,
                )
                if parsed_answer.analysis_metadata
                else None
            ),
            invoice_details=(
                ChatInvoiceDetails(
                    operator=enriched_ocr_result.invoice_details.operator,
                    invoice_number=enriched_ocr_result.invoice_details.invoice_number,
                    invoice_date=enriched_ocr_result.invoice_details.invoice_date,
                    billing_period=enriched_ocr_result.invoice_details.billing_period,
                    amount_ht_mad=enriched_ocr_result.invoice_details.amount_ht_mad,
                    vat_amount_mad=enriched_ocr_result.invoice_details.vat_amount_mad,
                    amount_ttc_mad=enriched_ocr_result.invoice_details.amount_ttc_mad,
                    total_amount_mad=enriched_ocr_result.invoice_details.total_amount_mad,
                    billed_lines=enriched_ocr_result.invoice_details.billed_lines,
                    additional_fees=enriched_ocr_result.invoice_details.additional_fees,
                    overage_items=enriched_ocr_result.invoice_details.overage_items,
                    anomalies=enriched_ocr_result.invoice_details.anomalies,
                    cost_items=[
                        ChatInvoiceCostItem(
                            label=item.label,
                            amount_mad=item.amount_mad,
                            amount_value_mad=item.amount_value_mad,
                            share_of_total_pct=item.share_of_total_pct,
                            category=item.category,
                            is_critical=item.is_critical,
                        )
                        for item in enriched_ocr_result.invoice_details.cost_items
                    ],
                    critical_items=[
                        ChatInvoiceCostItem(
                            label=item.label,
                            amount_mad=item.amount_mad,
                            amount_value_mad=item.amount_value_mad,
                            share_of_total_pct=item.share_of_total_pct,
                            category=item.category,
                            is_critical=item.is_critical,
                        )
                        for item in enriched_ocr_result.invoice_details.critical_items
                    ],
                    primary_risk=enriched_ocr_result.invoice_details.primary_risk,
                    estimated_savings=enriched_ocr_result.invoice_details.estimated_savings,
                    risk_level=enriched_ocr_result.invoice_details.risk_level,
                )
                if enriched_ocr_result.invoice_details is not None
                else None
            ),
            incident_details=(
                ChatIncidentDetails(
                    alert_type=enriched_ocr_result.incident_details.alert_type,
                    severity=parsed_answer.severity or enriched_ocr_result.incident_details.severity,
                    detected_at=enriched_ocr_result.incident_details.detected_at,
                    operator=enriched_ocr_result.incident_details.operator,
                    line_reference=enriched_ocr_result.incident_details.line_reference,
                    suspect_cost_mad=enriched_ocr_result.incident_details.suspect_cost_mad,
                    call_volume=enriched_ocr_result.incident_details.call_volume,
                    data_overage=enriched_ocr_result.incident_details.data_overage,
                    error_message=enriched_ocr_result.incident_details.error_message,
                    priority=resolved_response_priority,
                    summary=parsed_answer.alert_summary or enriched_ocr_result.incident_details.summary,
                    critical_alert_count=enriched_ocr_result.incident_details.critical_alert_count,
                    exposure_rate=enriched_ocr_result.incident_details.exposure_rate,
                    exposure_rate_pct=enriched_ocr_result.incident_details.exposure_rate_pct,
                    financial_impact_mad=enriched_ocr_result.incident_details.financial_impact_mad,
                    financial_impact_value_mad=enriched_ocr_result.incident_details.financial_impact_value_mad,
                    at_risk_clients_count=enriched_ocr_result.incident_details.at_risk_clients_count,
                    department_risk=enriched_ocr_result.incident_details.department_risk,
                    contract_exposed=enriched_ocr_result.incident_details.contract_exposed,
                    churn_rate=enriched_ocr_result.incident_details.churn_rate,
                    churn_rate_pct=enriched_ocr_result.incident_details.churn_rate_pct,
                    estimated_impact_mad=enriched_ocr_result.incident_details.estimated_impact_mad,
                    estimated_impact_value_mad=enriched_ocr_result.incident_details.estimated_impact_value_mad,
                    revenue_at_risk_mad=enriched_ocr_result.incident_details.revenue_at_risk_mad,
                    revenue_at_risk_value_mad=enriched_ocr_result.incident_details.revenue_at_risk_value_mad,
                    roi_estimated=enriched_ocr_result.incident_details.roi_estimated,
                    roi_estimated_pct=enriched_ocr_result.incident_details.roi_estimated_pct,
                    priority_actions_count=enriched_ocr_result.incident_details.priority_actions_count,
                    average_score=enriched_ocr_result.incident_details.average_score,
                    average_score_value=enriched_ocr_result.incident_details.average_score_value,
                    risk_score=normalize_business_score_label(
                        enriched_ocr_result.incident_details.risk_score,
                        exceptional=allow_max_risk_score,
                    ),
                    fraud_score_visible=normalize_business_score_label(
                        enriched_ocr_result.incident_details.fraud_score_visible,
                        exceptional=allow_max_risk_score,
                    ),
                    fraud_score_value=enriched_ocr_result.incident_details.fraud_score_value,
                    anomaly_score_visible=normalize_business_score_label(
                        enriched_ocr_result.incident_details.anomaly_score_visible,
                        exceptional=allow_max_risk_score,
                    ),
                    anomaly_score_value=enriched_ocr_result.incident_details.anomaly_score_value,
                    optimization_score_visible=normalize_business_score_label(
                        enriched_ocr_result.incident_details.optimization_score_visible,
                        exceptional=allow_max_risk_score,
                    ),
                    optimization_score_value=enriched_ocr_result.incident_details.optimization_score_value,
                    cost_score_visible=normalize_business_score_label(
                        enriched_ocr_result.incident_details.cost_score_visible,
                        exceptional=allow_max_risk_score,
                    ),
                    cost_score_value=enriched_ocr_result.incident_details.cost_score_value,
                    max_risk_scores=[
                        normalize_business_score_label(score, exceptional=allow_max_risk_score) or score
                        for score in enriched_ocr_result.incident_details.max_risk_scores
                    ],
                    risky_entities=enriched_ocr_result.incident_details.risky_entities,
                    repeated_anomalies=enriched_ocr_result.incident_details.repeated_anomalies,
                    visible_statuses=enriched_ocr_result.incident_details.visible_statuses,
                    critical_signals=polish_business_items(
                        enriched_ocr_result.incident_details.critical_signals,
                        limit=8,
                        exceptional_scores=allow_max_risk_score,
                    ),
                    probable_causes=parsed_answer.probable_causes,
                )
                if enriched_ocr_result.incident_details is not None
                else None
            ),
            alert_intelligence=alert_intelligence,
            workflow_details=(
                ChatWorkflowDetails(
                    workflow_type=enriched_ocr_result.workflow_details.workflow_type,
                    complexity_score=enriched_ocr_result.workflow_details.complexity_score,
                    complexity_level=enriched_ocr_result.workflow_details.complexity_level,
                    critical_steps=enriched_ocr_result.workflow_details.critical_steps,
                    detected_departments=enriched_ocr_result.workflow_details.departments,
                    detected_roles=enriched_ocr_result.workflow_details.roles,
                    automation_opportunities=enriched_ocr_result.workflow_details.automation_opportunities,
                    bottlenecks=enriched_ocr_result.workflow_details.bottlenecks,
                    repeated_validations=enriched_ocr_result.workflow_details.repeated_validations,
                    summary=enriched_ocr_result.workflow_details.summary,
                )
                if enriched_ocr_result.workflow_details is not None
                else None
            ),
            equipment_details=(
                ChatEquipmentDetails(
                    equipment_type=enriched_ocr_result.equipment_details.equipment_type,
                    brand=enriched_ocr_result.equipment_details.brand,
                    model=enriched_ocr_result.equipment_details.model,
                    serial_number=enriched_ocr_result.equipment_details.serial_number,
                    operator=enriched_ocr_result.equipment_details.operator,
                    visible_condition=enriched_ocr_result.equipment_details.visible_condition,
                    device_version=enriched_ocr_result.equipment_details.device_version,
                    sim_information=enriched_ocr_result.equipment_details.sim_information,
                    label_information=enriched_ocr_result.equipment_details.label_information,
                    usage_summary=enriched_ocr_result.equipment_details.usage_summary,
                    detected_issues=enriched_ocr_result.equipment_details.detected_issues,
                    maintenance_recommendations=enriched_ocr_result.equipment_details.maintenance_recommendations,
                    replacement_needed=enriched_ocr_result.equipment_details.replacement_needed,
                    condition_score=enriched_ocr_result.equipment_details.condition_score,
                    criticality_score=enriched_ocr_result.equipment_details.criticality_score,
                    obsolescence_score=enriched_ocr_result.equipment_details.obsolescence_score,
                    maintenance_score=enriched_ocr_result.equipment_details.maintenance_score,
                    summary=enriched_ocr_result.equipment_details.summary,
                )
                if enriched_ocr_result.equipment_details is not None
                else None
            ),
            highlighted_image=annotation_result.highlighted_image,
            annotations=[
                ChatImageAnnotation(
                    label=annotation.label,
                    type=annotation.type,
                    bbox=list(annotation.bbox),
                    confidence=annotation.confidence,
                )
                for annotation in annotation_result.annotations
            ],
            decision_recommendations=_polish_decision_recommendations(
                decision_engine_result.recommendations,
                exceptional_scores=allow_max_risk_score,
            ),
            recommendation_notice=recommendation_notice,
            risk_level=resolved_response_risk_level,
            optimization_score=normalize_business_risk_score(
                decision_engine_result.optimization_score,
                exceptional=allow_max_risk_score,
            ),
            anomaly_score=normalize_business_risk_score(
                decision_engine_result.anomaly_score,
                exceptional=allow_max_risk_score,
            ),
            fraud_score=normalize_business_risk_score(
                decision_engine_result.fraud_score,
                exceptional=allow_max_risk_score,
            ),
            cost_score=normalize_business_risk_score(
                decision_engine_result.cost_score,
                exceptional=allow_max_risk_score,
            ),
        )
        if image_type == "equipement" and image_routing_mode == EQUIPMENT_ROUTING_MODE_VISION_ONLY:
            _log_equipment_visual_diagnostics(
                inventory=_build_visual_equipment_inventory(
                    question=question,
                    ocr_result=enriched_ocr_result,
                    vision_result=vision_result,
                ),
                vision_result=vision_result,
            )

        _log_chat_event(
            logging.INFO,
            "chat_response_completed",
            mode="image",
            cached=response.cached,
            duration_ms=response.duration_ms,
            question=question_preview,
            conversation_id=conversation_id,
            image_type=image_type,
            analysis_mode=resolved_analysis_mode,
        )
        response = polish_chat_image_response(
            response,
            exceptional_scores=allow_max_risk_score,
        )
        if (
            image_type == "equipement"
            and image_routing_mode == EQUIPMENT_ROUTING_MODE_VISION_ONLY
            and direct_vision_sanitizer_applied
        ):
            MULTIMODAL_LOGGER.info("FINAL_EQUIPMENT_OBJECTS = %s", vision_result.detected_objects)
            MULTIMODAL_LOGGER.info(
                "REMOVED_HALLUCINATED_OBJECTS = %s",
                direct_vision_removed_hallucinated_objects,
            )
            MULTIMODAL_LOGGER.info("FINAL_ANSWER_SANITIZED = %s", response.answer)
        _store_cached_vision_analysis(
            vision_cache_key,
            vision_result=vision_result,
            previous_response=response.answer,
        )
        return response
    except RequestCancelledError as exc:
        _log_chat_event(
            logging.INFO,
            "chat_request_cancelled",
            mode="image",
            duration_ms=_elapsed_ms(started_at),
            question=question_preview,
            code=exc.code,
            conversation_id=conversation_id,
        )
        raise
    except ChatServiceError as exc:
        MULTIMODAL_LOGGER.warning(
            "event=chat_backend_error mode=image duration_ms=%s question=%s conversation_id=%s code=%s message=%s",
            _elapsed_ms(started_at),
            question_preview,
            conversation_id,
            exc.code,
            exc.log_message,
        )
        raise
    except Exception:
        MULTIMODAL_LOGGER.exception(
            "event=chat_backend_error mode=image duration_ms=%s question=%s conversation_id=%s",
            _elapsed_ms(started_at),
            question_preview,
            conversation_id,
        )
        raise ChatServerError() from None


async def generate_pdf_chat_response(
    request: Request,
    db: Session,
    *,
    question: str,
    history: list[ChatContextMessage],
    pdf_bytes: bytes,
    filename: str | None,
    content_type: str | None,
    analysis_mode: str | None = None,
    conversation_id: str | None = None,
) -> ChatImageResponse:
    started_at = _utcnow()
    question_preview = _truncate(question, 140)
    resolved_analysis_mode = _resolve_analysis_mode(analysis_mode)
    stage_notices: list[str] = []
    analysis_error_type: str | None = None
    advanced_analysis_available = True
    advanced_analysis_completed = False

    _log_chat_event(
        logging.INFO,
        "chat_question_sent",
        mode="pdf",
        question=question_preview,
        conversation_id=conversation_id,
        analysis_mode=resolved_analysis_mode,
    )

    try:
        await _ensure_request_connected(request)
        MULTIMODAL_LOGGER.info(
            "event=pdf_request_received filename=%s content_type=%s size_bytes=%s conversation_id=%s analysis_mode=%s",
            filename,
            content_type,
            len(pdf_bytes),
            conversation_id,
            resolved_analysis_mode,
        )

        if not (content_type or "").lower().endswith("/pdf") and not (filename or "").lower().endswith(".pdf"):
            raise InvalidImageError("Format PDF non supporte.")

        summary = get_data_summary(db)
        pdf_result = await _extract_pdf_document(
            pdf_bytes,
            filename=filename,
        )
        ocr_result = pdf_result.ocr_result
        if not ocr_result.text.strip():
            stage_notices.append(
                "Le document reste peu lisible textuellement ; l'analyse retient d'abord les elements structurants disponibles."
            )

        vision_result: VisionAnalysisResult | None = None
        vision_succeeded = False
        first_page_prepared_image = None
        if pdf_result.first_page_image_bytes is not None:
            try:
                first_page_prepared_image = prepare_image_for_analysis(
                    pdf_result.first_page_image_bytes,
                    filename="pdf-page-1.png",
                    content_type="image/png",
                    max_side=get_settings().image_analysis_max_side,
                )
            except TypeError as exc:
                if "max_side" not in str(exc):
                    raise
                first_page_prepared_image = prepare_image_for_analysis(
                    pdf_result.first_page_image_bytes,
                    filename="pdf-page-1.png",
                    content_type="image/png",
                )

        if resolved_analysis_mode == "quick":
            vision_result = _build_quick_vision_result(
                question=question,
                ocr_result=ocr_result,
            )
        elif first_page_prepared_image is not None:
            advanced_analysis_available, availability_message = await is_vision_model_available()
            if not advanced_analysis_available:
                analysis_error_type = analysis_error_type or "vision_unavailable"
                stage_notices.append(
                    "La lecture visuelle detaillee du PDF n'etait pas disponible ; l'analyse reste fondee sur le texte et les tableaux extraits."
                )
                vision_result = _build_vision_fallback_result(
                    question=question,
                    ocr_result=ocr_result,
                    error_message=availability_message or "Lecture visuelle PDF indisponible.",
                )
            else:
                try:
                    vision_result = await analyze_image_with_llava(
                        question=question,
                        image_base64=first_page_prepared_image.vision_base64_payload,
                        timeout_seconds=min(35, get_settings().image_analysis_vision_timeout_seconds),
                        analysis_mode=resolved_analysis_mode,
                    )
                    vision_succeeded = True
                    advanced_analysis_completed = True
                except (ImageAnalysisTimeoutError, VisionUnavailableError, LocalModelUnavailableError) as exc:
                    analysis_error_type = analysis_error_type or exc.code.lower()
                    stage_notices.append(
                        "La lecture visuelle detaillee du PDF a ete ecourtee ; l'analyse conserve les KPI documentaires les plus fiables."
                    )
                    if exc.code in {"VISION_UNAVAILABLE", "OLLAMA_OFFLINE"}:
                        advanced_analysis_available = False
                    vision_result = _build_vision_fallback_result(
                        question=question,
                        ocr_result=ocr_result,
                        error_message=exc.user_message,
                    )
        else:
            vision_result = _build_vision_fallback_result(
                question=question,
                ocr_result=ocr_result,
                error_message="Le PDF ne fournissait pas de page preview exploitable pour la lecture visuelle.",
            )

        if vision_result is None:
            vision_result = _build_vision_fallback_result(
                question=question,
                ocr_result=ocr_result,
                error_message="Analyse PDF consolidee a partir des elements textuels les plus fiables.",
            )

        await _ensure_request_connected(request)
        equipment_details = _resolve_equipment_details(
            question=question,
            ocr_result=ocr_result,
            vision_result=vision_result,
        )
        enriched_invoice_details = analyze_invoice_context(ocr_result)
        enriched_incident_details = analyze_alert_dashboard_context(
            ocr_result,
            vision_text="\n".join(
                [
                    vision_result.analysis,
                    *vision_result.detected_kpis,
                    *vision_result.recommendations,
                ]
            ),
        )
        enriched_ocr_result = replace(
            ocr_result,
            invoice_details=enriched_invoice_details or ocr_result.invoice_details,
            incident_details=enriched_incident_details or ocr_result.incident_details,
            equipment_details=equipment_details or ocr_result.equipment_details,
        )
        preliminary_kpis = _collect_visible_pipeline_kpis(enriched_ocr_result, vision_result)
        if (
            len(preliminary_kpis) >= VISIBLE_KPI_STRICT_THRESHOLD
            and (enriched_ocr_result.confidence or 0.0) < OCR_CONFIDENCE_STRONG_KPI_FLOOR
        ):
            MULTIMODAL_LOGGER.info(
                "event=pdf_ocr_confidence_floor_applied filename=%s previous_confidence=%s new_confidence=%s visible_kpis=%d",
                filename,
                round((enriched_ocr_result.confidence or 0.0) * 100, 1),
                round(OCR_CONFIDENCE_STRONG_KPI_FLOOR * 100, 1),
                len(preliminary_kpis),
            )
            enriched_ocr_result = replace(
                enriched_ocr_result,
                confidence=OCR_CONFIDENCE_STRONG_KPI_FLOOR,
            )
        stage_notices = _normalize_stage_notices(stage_notices)
        stage_notices = _sanitize_stage_notices_for_alert_kpis(
            stage_notices,
            enriched_ocr_result.incident_details,
        )
        image_type = _infer_image_type(question, enriched_ocr_result, vision_result)
        visible_pipeline_kpis = _collect_visible_pipeline_kpis(enriched_ocr_result, vision_result)
        stage_notices = _sanitize_stage_notices_for_visible_kpis(
            stage_notices,
            visible_pipeline_kpis,
        )
        MULTIMODAL_LOGGER.info(
            "event=pdf_pipeline_order filename=%s analysis_mode=%s image_type=%s order=ocr->kpi->business_analysis->prompt->llm->post_processing",
            filename,
            resolved_analysis_mode,
            image_type,
        )
        _log_kpi_pipeline_debug(
            question=question,
            image_type=image_type,
            analysis_mode=resolved_analysis_mode,
            ocr_result=enriched_ocr_result,
            vision_result=vision_result,
        )
        dashboard_analysis = (
            analyze_dashboard_image(
                question=question,
                ocr_result=enriched_ocr_result,
                vision_result=vision_result,
                summary=summary,
            )
            if _should_run_dashboard_analysis(
                analysis_mode=resolved_analysis_mode,
                inferred_image_type=image_type,
            )
            else None
        )
        if dashboard_analysis is not None and _should_run_dashboard_analysis(
            analysis_mode=resolved_analysis_mode,
            inferred_image_type=image_type,
        ):
            image_type = "dashboard"

        raw_answer = ""
        if resolved_analysis_mode != "quick":
            multimodal_prompt = _build_multimodal_prompt_v2(
                question=question,
                history=history,
                summary_context=summary.prompt_context,
                image_type=image_type,
                ocr_result=enriched_ocr_result,
                vision_result=vision_result,
            )
            
            # Log the final prompt for debugging - show if KPI section is included
            if "alert_dashboard_kpis" in multimodal_prompt:
                MULTIMODAL_LOGGER.debug(
                    "event=final_prompt_built_pdf prompt_includes_kpis=true image_type=%s incident_details_present=%s",
                    image_type,
                    enriched_ocr_result.incident_details is not None,
                )
            else:
                MULTIMODAL_LOGGER.info(
                    "event=final_prompt_built_pdf prompt_includes_kpis=false image_type=%s incident_details_present=%s",
                    image_type,
                    enriched_ocr_result.incident_details is not None,
                )
            _log_llm_prompt_debug(
                analysis_mode=resolved_analysis_mode,
                image_type=image_type,
                visible_kpis=visible_pipeline_kpis,
                prompt=multimodal_prompt,
            )
            
            try:
                raw_answer = await _generate_with_ollama(multimodal_prompt)
            except ChatServiceError as exc:
                if exc.code == "TIMEOUT":
                    analysis_error_type = analysis_error_type or "image_timeout"
                    stage_notices.append(
                        "La synthese detaillee du PDF a depasse la fenetre de traitement ; les priorites documentaires restent disponibles."
                    )
                elif exc.code == "OLLAMA_OFFLINE":
                    analysis_error_type = analysis_error_type or "ollama_unavailable"
                    stage_notices.append(
                        "La consolidation redactionnelle locale n'etait pas disponible ; l'analyse retient une note metier plus directe."
                    )
                raw_answer = ""
        else:
            _log_llm_prompt_debug(
                analysis_mode=resolved_analysis_mode,
                image_type=image_type,
                visible_kpis=visible_pipeline_kpis,
                prompt=None,
                skipped_reason="quick_mode_ocr_first",
            )
        _log_llm_response_debug(
            analysis_mode=resolved_analysis_mode,
            image_type=image_type,
            raw_answer=raw_answer,
            skipped_reason="quick_mode_ocr_first" if resolved_analysis_mode == "quick" else None,
        )

        parsed_answer = _parse_final_model_answer(
            raw_answer,
            analysis_mode=resolved_analysis_mode,
            image_type=image_type,
            ocr_result=enriched_ocr_result,
            vision_result=vision_result,
            summary_recommendations=summary.recommendations,
            dashboard_analysis=dashboard_analysis,
        )
        decision_engine_result = (
            _build_invoice_decision_recommendations(enriched_ocr_result.invoice_details)
            if image_type == "facture" and enriched_ocr_result.invoice_details is not None
            else _build_alert_decision_recommendations(enriched_ocr_result.incident_details)
            if image_type in ALERT_FOCUSED_IMAGE_TYPES
            and enriched_ocr_result.incident_details is not None
            else _build_dashboard_strict_recommendations(
                ocr_result=enriched_ocr_result,
                parsed_answer=parsed_answer,
                vision_result=vision_result,
            )
            if should_use_strict_mode(image_type)
            else build_decision_recommendations(
                summary=summary,
                image_type=image_type,
                ocr_result=enriched_ocr_result,
                detected_anomalies=parsed_answer.detected_anomalies,
                model_recommendations=parsed_answer.recommendations,
                dashboard_analysis=dashboard_analysis,
            )
        )

        consultant_answer = _compose_consultant_image_answer(
            question=question,
            image_type=image_type,
            parsed_answer=parsed_answer,
            ocr_result=enriched_ocr_result,
            vision_result=vision_result,
            decision_engine_result=decision_engine_result,
            routing_mode=_resolve_image_routing_mode(
                question=question,
                history=history,
                image_type=image_type,
                ocr_result=enriched_ocr_result,
                vision_result=vision_result,
            ),
        )
        consultant_removed_claims: list[str] = []
        if should_use_strict_mode(image_type):
            consultant_answer, consultant_removed_claims = _postprocess_consultant_answer_strict(
                image_type=image_type,
                answer=consultant_answer,
                ocr_result=enriched_ocr_result,
                vision_result=vision_result,
                decision_engine_result=decision_engine_result,
            )
        updated_metadata = parsed_answer.analysis_metadata
        if updated_metadata is not None and consultant_removed_claims:
            updated_metadata = replace(
                updated_metadata,
                removed_unverified_claims=_dedupe_items(
                    [
                        *updated_metadata.removed_unverified_claims,
                        *consultant_removed_claims,
                    ],
                    24,
                ),
            )

        parsed_answer = replace(
            parsed_answer,
            answer=consultant_answer,
            analysis_metadata=updated_metadata,
        )

        base_response = _build_response(
            question=question,
            answer=parsed_answer.answer,
            summary=summary,
            duration_ms=_elapsed_ms(started_at),
        )
        analysis_status, processing_message = _build_processing_message(
            analysis_mode=resolved_analysis_mode,
            advanced_analysis_completed=advanced_analysis_completed,
            stage_notices=(
                [f"Document PDF multi-pages: {pdf_result.page_count} page(s) lue(s)."] + stage_notices
            ),
        )
        normalized_stage_notices = _dedupe_items(
            [f"Document PDF multi-pages: {pdf_result.page_count} page(s) lue(s).", *stage_notices],
            6,
        )
        finalized_answer = _finalize_answer(question, base_response.answer, summary)
        allow_max_risk_score = _multimodal_allows_max_risk_score(enriched_ocr_result.incident_details)
        finalized_answer = polish_business_text(
            finalized_answer,
            exceptional_scores=allow_max_risk_score,
        )
        parsed_answer = replace(
            parsed_answer,
            answer=finalized_answer,
            detected_kpis=polish_business_items(
                parsed_answer.detected_kpis,
                limit=14,
                exceptional_scores=allow_max_risk_score,
            ),
            recommendations=polish_business_items(
                parsed_answer.recommendations,
                limit=8,
                exceptional_scores=allow_max_risk_score,
            ),
            detected_anomalies=polish_business_items(
                parsed_answer.detected_anomalies,
                limit=8,
                exceptional_scores=allow_max_risk_score,
            ),
            probable_causes=polish_business_items(
                parsed_answer.probable_causes,
                limit=6,
                exceptional_scores=allow_max_risk_score,
            ),
            alert_summary=polish_business_text(
                parsed_answer.alert_summary,
                exceptional_scores=allow_max_risk_score,
            )
            or parsed_answer.alert_summary,
        )
        normalized_stage_notices = polish_business_items(
            normalized_stage_notices,
            limit=6,
            exceptional_scores=allow_max_risk_score,
        )
        _log_final_answer_debug(
            analysis_mode=resolved_analysis_mode,
            image_type=image_type,
            visible_kpis=visible_pipeline_kpis,
            final_answer=finalized_answer,
        )
        detected_operator = (
            enriched_ocr_result.invoice_details.operator
            if enriched_ocr_result.invoice_details is not None
            else (enriched_ocr_result.operators[0] if enriched_ocr_result.operators else None)
        )

        sources = _dedupe_items(
            [
                *base_response.sources,
                "multimodal:pdf",
                f"analysis-mode:{resolved_analysis_mode}",
                *(
                    [f"vision:{vision_result.model}"]
                    if vision_result.model
                    else []
                ),
                *(
                    [f"decision-engine:{decision_engine_result.risk_level}"]
                    if decision_engine_result.risk_level
                    else []
                ),
            ],
            20,
        )
        resolved_response_risk_level = _resolve_business_risk_level(
            initial_risk_level=decision_engine_result.risk_level,
            image_type=image_type,
            ocr_result=enriched_ocr_result,
            decision_engine_result=decision_engine_result,
            parsed_severity=parsed_answer.severity,
        )
        resolved_response_priority = _resolve_business_priority(
            initial_priority=parsed_answer.treatment_priority
            or (
                enriched_ocr_result.incident_details.priority
                if enriched_ocr_result.incident_details is not None
                else None
            ),
            resolved_risk_level=resolved_response_risk_level,
            image_type=image_type,
            ocr_result=enriched_ocr_result,
            decision_engine_result=decision_engine_result,
        )
        alert_intelligence = _build_alert_intelligence(
            incident_details=enriched_ocr_result.incident_details,
            decision_engine_result=decision_engine_result,
            ocr_confidence=_effective_ocr_confidence(enriched_ocr_result, vision_result),
        )
        alert_intelligence = _polish_alert_intelligence(
            alert_intelligence,
            exceptional_scores=allow_max_risk_score,
        )

        response = ChatImageResponse(
            answer=finalized_answer,
            model=base_response.model,
            title_hint=base_response.title_hint or _derive_title_hint(question),
            sources=sources,
            summary_updated_at=base_response.summary_updated_at,
            cached=False,
            fallback_used=(
                base_response.fallback_used
                or vision_result.model == "vision-fallback"
                or (raw_answer == "" and resolved_analysis_mode != "quick")
                or analysis_status == "fallback"
            ),
            duration_ms=base_response.duration_ms,
            image_type=image_type,
            ocr_text=_limit_text(enriched_ocr_result.text, 8000),
            vision_analysis=_limit_text(vision_result.analysis, 5000),
            analysis_mode=resolved_analysis_mode,
            analysis_status=analysis_status,
            advanced_analysis_available=advanced_analysis_available,
            advanced_analysis_completed=advanced_analysis_completed,
            processing_message=processing_message,
            processing_notices=normalized_stage_notices,
            error_type=analysis_error_type,
            fallback_answer=finalized_answer if analysis_status == "fallback" else None,
            detected_kpis=parsed_answer.detected_kpis,
            recommendations=parsed_answer.recommendations,
            confidence=parsed_answer.confidence,
            ocr_confidence=_effective_ocr_confidence(enriched_ocr_result, vision_result),
            detected_operator=detected_operator,
            detected_anomalies=parsed_answer.detected_anomalies,
            analysis_metadata=(
                ChatImageAnalysisMetadata(
                    source_mode=parsed_answer.analysis_metadata.source_mode if parsed_answer.analysis_metadata else "standard",
                    visible_kpis_used=parsed_answer.analysis_metadata.visible_kpis_used if parsed_answer.analysis_metadata else [],
                    blocked_global_context=parsed_answer.analysis_metadata.blocked_global_context if parsed_answer.analysis_metadata else False,
                    removed_unverified_claims=parsed_answer.analysis_metadata.removed_unverified_claims if parsed_answer.analysis_metadata else [],
                    filtered_numbers=parsed_answer.analysis_metadata.filtered_numbers if parsed_answer.analysis_metadata else [],
                    confidence_score=parsed_answer.analysis_metadata.confidence_score if parsed_answer.analysis_metadata else 0.0,
                )
                if parsed_answer.analysis_metadata
                else None
            ),
            invoice_details=(
                ChatInvoiceDetails(
                    operator=enriched_ocr_result.invoice_details.operator,
                    invoice_number=enriched_ocr_result.invoice_details.invoice_number,
                    invoice_date=enriched_ocr_result.invoice_details.invoice_date,
                    billing_period=enriched_ocr_result.invoice_details.billing_period,
                    amount_ht_mad=enriched_ocr_result.invoice_details.amount_ht_mad,
                    vat_amount_mad=enriched_ocr_result.invoice_details.vat_amount_mad,
                    amount_ttc_mad=enriched_ocr_result.invoice_details.amount_ttc_mad,
                    total_amount_mad=enriched_ocr_result.invoice_details.total_amount_mad,
                    billed_lines=enriched_ocr_result.invoice_details.billed_lines,
                    additional_fees=enriched_ocr_result.invoice_details.additional_fees,
                    overage_items=enriched_ocr_result.invoice_details.overage_items,
                    anomalies=enriched_ocr_result.invoice_details.anomalies,
                    cost_items=[
                        ChatInvoiceCostItem(
                            label=item.label,
                            amount_mad=item.amount_mad,
                            amount_value_mad=item.amount_value_mad,
                            share_of_total_pct=item.share_of_total_pct,
                            category=item.category,
                            is_critical=item.is_critical,
                        )
                        for item in enriched_ocr_result.invoice_details.cost_items
                    ],
                    critical_items=[
                        ChatInvoiceCostItem(
                            label=item.label,
                            amount_mad=item.amount_mad,
                            amount_value_mad=item.amount_value_mad,
                            share_of_total_pct=item.share_of_total_pct,
                            category=item.category,
                            is_critical=item.is_critical,
                        )
                        for item in enriched_ocr_result.invoice_details.critical_items
                    ],
                    primary_risk=enriched_ocr_result.invoice_details.primary_risk,
                    estimated_savings=enriched_ocr_result.invoice_details.estimated_savings,
                    risk_level=enriched_ocr_result.invoice_details.risk_level,
                )
                if enriched_ocr_result.invoice_details is not None
                else None
            ),
            incident_details=(
                ChatIncidentDetails(
                    alert_type=enriched_ocr_result.incident_details.alert_type,
                    severity=parsed_answer.severity or enriched_ocr_result.incident_details.severity,
                    detected_at=enriched_ocr_result.incident_details.detected_at,
                    operator=enriched_ocr_result.incident_details.operator,
                    line_reference=enriched_ocr_result.incident_details.line_reference,
                    suspect_cost_mad=enriched_ocr_result.incident_details.suspect_cost_mad,
                    call_volume=enriched_ocr_result.incident_details.call_volume,
                    data_overage=enriched_ocr_result.incident_details.data_overage,
                    error_message=enriched_ocr_result.incident_details.error_message,
                    priority=resolved_response_priority,
                    summary=parsed_answer.alert_summary or enriched_ocr_result.incident_details.summary,
                    critical_alert_count=enriched_ocr_result.incident_details.critical_alert_count,
                    exposure_rate=enriched_ocr_result.incident_details.exposure_rate,
                    exposure_rate_pct=enriched_ocr_result.incident_details.exposure_rate_pct,
                    financial_impact_mad=enriched_ocr_result.incident_details.financial_impact_mad,
                    financial_impact_value_mad=enriched_ocr_result.incident_details.financial_impact_value_mad,
                    at_risk_clients_count=enriched_ocr_result.incident_details.at_risk_clients_count,
                    churn_rate=enriched_ocr_result.incident_details.churn_rate,
                    churn_rate_pct=enriched_ocr_result.incident_details.churn_rate_pct,
                    estimated_impact_mad=enriched_ocr_result.incident_details.estimated_impact_mad,
                    estimated_impact_value_mad=enriched_ocr_result.incident_details.estimated_impact_value_mad,
                    revenue_at_risk_mad=enriched_ocr_result.incident_details.revenue_at_risk_mad,
                    revenue_at_risk_value_mad=enriched_ocr_result.incident_details.revenue_at_risk_value_mad,
                    roi_estimated=enriched_ocr_result.incident_details.roi_estimated,
                    roi_estimated_pct=enriched_ocr_result.incident_details.roi_estimated_pct,
                    priority_actions_count=enriched_ocr_result.incident_details.priority_actions_count,
                    average_score=enriched_ocr_result.incident_details.average_score,
                    average_score_value=enriched_ocr_result.incident_details.average_score_value,
                    fraud_score_visible=normalize_business_score_label(
                        enriched_ocr_result.incident_details.fraud_score_visible,
                        exceptional=allow_max_risk_score,
                    ),
                    fraud_score_value=enriched_ocr_result.incident_details.fraud_score_value,
                    anomaly_score_visible=normalize_business_score_label(
                        enriched_ocr_result.incident_details.anomaly_score_visible,
                        exceptional=allow_max_risk_score,
                    ),
                    anomaly_score_value=enriched_ocr_result.incident_details.anomaly_score_value,
                    optimization_score_visible=normalize_business_score_label(
                        enriched_ocr_result.incident_details.optimization_score_visible,
                        exceptional=allow_max_risk_score,
                    ),
                    optimization_score_value=enriched_ocr_result.incident_details.optimization_score_value,
                    cost_score_visible=normalize_business_score_label(
                        enriched_ocr_result.incident_details.cost_score_visible,
                        exceptional=allow_max_risk_score,
                    ),
                    cost_score_value=enriched_ocr_result.incident_details.cost_score_value,
                    risk_score=normalize_business_score_label(
                        enriched_ocr_result.incident_details.risk_score,
                        exceptional=allow_max_risk_score,
                    ),
                    max_risk_scores=[
                        normalize_business_score_label(score, exceptional=allow_max_risk_score) or score
                        for score in enriched_ocr_result.incident_details.max_risk_scores
                    ],
                    risky_entities=enriched_ocr_result.incident_details.risky_entities,
                    repeated_anomalies=enriched_ocr_result.incident_details.repeated_anomalies,
                    visible_statuses=enriched_ocr_result.incident_details.visible_statuses,
                    critical_signals=polish_business_items(
                        enriched_ocr_result.incident_details.critical_signals,
                        limit=8,
                        exceptional_scores=allow_max_risk_score,
                    ),
                    probable_causes=parsed_answer.probable_causes,
                )
                if enriched_ocr_result.incident_details is not None
                else None
            ),
            alert_intelligence=alert_intelligence,
            workflow_details=None,
            equipment_details=None,
            highlighted_image=None,
            annotations=[],
            decision_recommendations=_polish_decision_recommendations(
                decision_engine_result.recommendations,
                exceptional_scores=allow_max_risk_score,
            ),
            recommendation_notice=(
                polish_business_text(
                    decision_engine_result.recommendation_notice,
                    exceptional_scores=allow_max_risk_score,
                )
                or decision_engine_result.recommendation_notice
            ),
            risk_level=resolved_response_risk_level,
            optimization_score=normalize_business_risk_score(
                decision_engine_result.optimization_score,
                exceptional=allow_max_risk_score,
            ),
            anomaly_score=normalize_business_risk_score(
                decision_engine_result.anomaly_score,
                exceptional=allow_max_risk_score,
            ),
            fraud_score=normalize_business_risk_score(
                decision_engine_result.fraud_score,
                exceptional=allow_max_risk_score,
            ),
            cost_score=normalize_business_risk_score(
                decision_engine_result.cost_score,
                exceptional=allow_max_risk_score,
            ),
        )
        _log_chat_event(
            logging.INFO,
            "chat_response_completed",
            mode="pdf",
            cached=False,
            duration_ms=response.duration_ms,
            question=question_preview,
            conversation_id=conversation_id,
            image_type=image_type,
            analysis_mode=resolved_analysis_mode,
        )
        return polish_chat_image_response(
            response,
            exceptional_scores=allow_max_risk_score,
        )
    except RequestCancelledError:
        raise
    except ChatServiceError:
        raise
    except Exception:
        MULTIMODAL_LOGGER.exception(
            "event=chat_backend_error mode=pdf duration_ms=%s question=%s conversation_id=%s",
            _elapsed_ms(started_at),
            question_preview,
            conversation_id,
        )
        raise ChatServerError() from None
