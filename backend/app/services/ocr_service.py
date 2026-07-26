from __future__ import annotations

import logging
import re
import unicodedata
from dataclasses import dataclass, field

from app.core.config import get_settings

OCR_LOGGER = logging.getLogger("app.chat.ocr")

try:  # pragma: no cover - optional runtime dependency
    import easyocr  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover - optional runtime dependency
    easyocr = None

try:  # pragma: no cover - optional runtime dependency
    import cv2  # type: ignore[import-not-found]
    import numpy as np  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover - optional runtime dependency
    cv2 = None
    np = None

try:  # pragma: no cover - optional runtime dependency
    import pytesseract  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover - optional runtime dependency
    pytesseract = None

_OCR_READER = None

OPERATORS = [
    "Maroc Telecom",
    "Orange",
    "Inwi",
]

DEPARTMENTS = [
    "Finance",
    "RH",
    "IT",
    "Support",
    "Commercial",
    "Marketing",
    "Direction",
    "Operations",
    "Logistique",
]

ROLE_KEYWORDS = [
    "manager",
    "responsable",
    "directeur",
    "direction",
    "admin",
    "administrateur",
    "analyste",
    "support",
    "utilisateur",
    "client",
    "agent",
    "superviseur",
]

WORKFLOW_ACTION_KEYWORDS = (
    "creer",
    "creation",
    "attribuer",
    "attribution",
    "activer",
    "activation",
    "analyser",
    "analyse",
    "traiter",
    "traitement",
    "verifier",
    "verification",
    "controler",
    "controle",
    "escalader",
    "escalade",
    "cloturer",
    "cloture",
    "resoudre",
    "resolution",
    "support",
    "ticket",
    "demande",
    "incident",
    "fraude",
    "budget",
    "facturation",
)

WORKFLOW_DECISION_KEYWORDS = (
    "decision",
    "si ",
    "if ",
    "oui",
    "non",
    "yes",
    "no",
    "go/no go",
    "choix",
)

WORKFLOW_VALIDATION_KEYWORDS = (
    "validation",
    "valider",
    "approbation",
    "approve",
    "approval",
    "review",
    "controle",
    "checkpoint",
)

WORKFLOW_RELATION_TOKENS = (
    "->",
    "=>",
    "-->",
    "<->",
    "vers",
    "then",
    "next",
    "suite",
    "apres",
    "sinon",
    "depend",
)

WORKFLOW_BOTTLENECK_KEYWORDS = (
    "attente",
    "manual",
    "manuel",
    "validation",
    "approbation",
    "review",
    "controle",
    "escalade",
    "exception",
    "pending",
    "backlog",
    "queue",
    "blocage",
)

WORKFLOW_AUTOMATION_KEYWORDS = (
    "manuel",
    "manual",
    "excel",
    "email",
    "mail",
    "copier",
    "saisie",
    "validation",
    "review",
    "controle",
    "ticket",
)

EQUIPMENT_BRANDS = [
    "Cisco",
    "Huawei",
    "ZTE",
    "Nokia",
    "Ericsson",
    "Juniper",
    "Ubiquiti",
    "MikroTik",
    "TP-Link",
    "D-Link",
    "Netgear",
    "Fortinet",
    "Aruba",
    "HPE",
    "HP",
    "Apple",
    "Samsung",
    "Xiaomi",
    "Oppo",
    "Vivo",
    "Lenovo",
    "Dell",
]

EQUIPMENT_DAMAGE_KEYWORDS = (
    "casse",
    "fissure",
    "crack",
    "broken",
    "endommage",
    "damage",
    "gonflee",
    "swollen",
    "surchauffe",
    "overheat",
    "brule",
    "burn",
)

NETWORK_ANOMALY_KEYWORDS = (
    "no signal",
    "signal faible",
    "wan",
    "port down",
    "offline",
    "link down",
    "alarm",
    "fault",
    "antenna",
    "antenne",
)

UI_BUTTON_KEYWORDS = (
    "envoyer",
    "send",
    "modifier",
    "save",
    "sauvegarder",
    "valider",
    "submit",
    "filtrer",
    "filtres",
    "filter",
    "telecharger",
    "download",
    "copier",
    "regenerer",
    "login",
    "connexion",
    "continuer",
    "suivant",
    "retour",
    "ajouter",
    "delete",
    "supprimer",
)

UI_MENU_KEYWORDS = (
    "dashboard",
    "tableau de bord",
    "lignes",
    "forfaits",
    "support",
    "analytics",
    "rapports",
    "parametres",
    "administration",
    "notifications",
    "menu",
    "chatbot",
    "assistant ia",
)

UI_TITLE_KEYWORDS = (
    "tableau de bord",
    "dashboard",
    "assistant ia",
    "analytics",
    "rapport",
    "analyse",
    "gestion",
    "vue d'ensemble",
    "formulaire",
    "support",
)

UI_ERROR_KEYWORDS = (
    "erreur",
    "error",
    "failed",
    "warning",
    "alerte",
    "required",
    "obligatoire",
    "invalid",
    "invalide",
    "timeout",
)


@dataclass(frozen=True)
class InvoiceCostItem:
    label: str
    amount_mad: str
    amount_value_mad: float | None = None
    share_of_total_pct: float | None = None
    category: str | None = None
    is_critical: bool = False


@dataclass(frozen=True)
class InvoiceDocumentDetails:
    operator: str | None
    invoice_number: str | None
    invoice_date: str | None
    billing_period: str | None
    amount_ht_mad: str | None
    vat_amount_mad: str | None
    amount_ttc_mad: str | None
    total_amount_mad: str | None
    billed_lines: list[str]
    additional_fees: list[str]
    overage_items: list[str]
    anomalies: list[str]
    cost_items: list[InvoiceCostItem] = field(default_factory=list)
    critical_items: list[InvoiceCostItem] = field(default_factory=list)
    primary_risk: str | None = None
    estimated_savings: str | None = None
    risk_level: str | None = None


@dataclass(frozen=True)
class IncidentDocumentDetails:
    alert_type: str | None
    severity: str | None
    detected_at: str | None
    operator: str | None
    line_reference: str | None
    suspect_cost_mad: str | None
    call_volume: str | None
    data_overage: str | None
    error_message: str | None
    priority: str | None
    summary: str | None
    critical_alert_count: int | None = None
    exposure_rate: str | None = None
    exposure_rate_pct: float | None = None
    financial_impact_mad: str | None = None
    financial_impact_value_mad: float | None = None
    at_risk_clients_count: int | None = None
    department_risk: str | None = None
    contract_exposed: str | None = None
    churn_rate: str | None = None
    churn_rate_pct: float | None = None
    estimated_impact_mad: str | None = None
    estimated_impact_value_mad: float | None = None
    revenue_at_risk_mad: str | None = None
    revenue_at_risk_value_mad: float | None = None
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
    risk_score: str | None = None
    max_risk_scores: list[str] = field(default_factory=list)
    risky_entities: list[str] = field(default_factory=list)
    repeated_anomalies: list[str] = field(default_factory=list)
    visible_statuses: list[str] = field(default_factory=list)
    critical_signals: list[str] = field(default_factory=list)
    probable_causes: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class WorkflowDocumentDetails:
    workflow_type: str | None
    step_names: list[str]
    departments: list[str]
    roles: list[str]
    decisions: list[str]
    validations: list[str]
    actions: list[str]
    relations: list[str]
    hierarchy_levels: int | None
    critical_steps: list[str]
    bottlenecks: list[str]
    automation_opportunities: list[str]
    repeated_validations: list[str]
    complexity_score: int
    complexity_level: str
    summary: str | None


@dataclass(frozen=True)
class EquipmentDocumentDetails:
    equipment_type: str | None
    brand: str | None
    model: str | None
    serial_number: str | None
    operator: str | None
    visible_condition: str | None
    device_version: str | None
    sim_information: str | None
    label_information: str | None
    usage_summary: str | None
    detected_issues: list[str]
    maintenance_recommendations: list[str]
    replacement_needed: bool
    condition_score: int
    criticality_score: int
    obsolescence_score: int
    maintenance_score: int
    summary: str | None


@dataclass(frozen=True)
class UiDocumentDetails:
    ui_type: str | None
    button_labels: list[str]
    menu_labels: list[str]
    titles: list[str]
    error_messages: list[str]
    dense_zones: list[str]
    visible_kpis: list[str]
    detected_issues: list[str]
    recommendations: list[str]
    strong_points: list[str]
    dark_mode_detected: bool
    mobile_interface: bool
    ux_score: int
    readability_score: int
    accessibility_score: int
    density_score: int
    modern_ui_score: int
    summary: str | None


@dataclass(frozen=True)
class OcrTextRegion:
    text: str
    bbox: tuple[int, int, int, int]
    confidence: float


@dataclass(frozen=True)
class OcrExtractionResult:
    text: str
    lines: list[str]
    text_regions: list[OcrTextRegion]
    amounts_mad: list[str]
    operators: list[str]
    departments: list[str]
    alerts: list[str]
    kpis: list[str]
    visible_tables: list[str]
    confidence: float
    invoice_details: InvoiceDocumentDetails | None
    incident_details: IncidentDocumentDetails | None
    workflow_details: WorkflowDocumentDetails | None = None
    equipment_details: EquipmentDocumentDetails | None = None
    ui_details: UiDocumentDetails | None = None
    status: str = "ok"
    error_message: str | None = None


@dataclass(frozen=True)
class RawOcrCandidate:
    engine: str
    lines: list[str]
    text_regions: list[OcrTextRegion]
    confidence: float


def _get_reader():
    global _OCR_READER

    if easyocr is None:  # pragma: no cover - optional runtime dependency
        return None

    if _OCR_READER is None:
        _OCR_READER = easyocr.Reader(get_settings().image_ocr_languages, gpu=False)
    return _OCR_READER


def is_ocr_runtime_available() -> bool:
    if easyocr is not None:
        return True
    return _is_tesseract_runtime_available()


def _is_tesseract_runtime_available() -> bool:
    if pytesseract is None:
        return False
    try:  # pragma: no cover - runtime path
        pytesseract.get_tesseract_version()
        return True
    except Exception:
        return False


def _extract_unique_matches(pattern: str, text: str) -> list[str]:
    matches = re.findall(pattern, text, flags=re.IGNORECASE)
    unique_matches: list[str] = []
    seen = set()
    for match in matches:
        normalized = match.strip()
        key = normalized.lower()
        if not normalized or key in seen:
            continue
        seen.add(key)
        unique_matches.append(normalized)
    return unique_matches


def _dedupe_non_empty(values: list[str], limit: int) -> list[str]:
    unique_values: list[str] = []
    seen = set()
    for value in values:
        normalized = " ".join(value.split()).strip()
        key = normalized.lower()
        if not normalized or key in seen:
            continue
        seen.add(key)
        unique_values.append(normalized)
    return unique_values[:limit]


def _normalize_for_matching(value: str) -> str:
    normalized_value = unicodedata.normalize("NFD", value.lower())
    normalized_value = "".join(
        character for character in normalized_value if unicodedata.category(character) != "Mn"
    )
    return " ".join(normalized_value.split())


def _extract_first_match(pattern: str, text: str) -> str | None:
    match = re.search(pattern, text, flags=re.IGNORECASE)
    if not match:
        return None

    if match.lastindex:
        return match.group(match.lastindex).strip()
    return match.group(0).strip()


def _bbox_from_points(points: object) -> tuple[int, int, int, int] | None:
    if not isinstance(points, (list, tuple)) or len(points) < 4:
        return None

    try:
        x_values = [float(point[0]) for point in points[:4]]
        y_values = [float(point[1]) for point in points[:4]]
    except (TypeError, ValueError, IndexError):
        return None

    min_x = max(0, int(min(x_values)))
    min_y = max(0, int(min(y_values)))
    max_x = max(min_x, int(max(x_values)))
    max_y = max(min_y, int(max(y_values)))
    return (min_x, min_y, max_x - min_x, max_y - min_y)


def _find_amount_near_keywords(lines: list[str], keywords: tuple[str, ...]) -> str | None:
    amount_pattern = (
        r"(?<!\d)(\d{1,3}(?:[ .]\d{3})*(?:[.,]\d{2})?|\d+(?:[.,]\d{2})?)\s*(?:MAD|DHS|DH)?"
    )
    normalized_keywords = tuple(_normalize_for_matching(keyword) for keyword in keywords)

    for index, line in enumerate(lines):
        normalized_line = _normalize_for_matching(line)
        if not any(keyword in normalized_line for keyword in normalized_keywords):
            continue

        direct_amount = _extract_first_match(amount_pattern, line)
        if direct_amount:
            return direct_amount

        if index + 1 < len(lines):
            next_amount = _extract_first_match(amount_pattern, lines[index + 1])
            if next_amount:
                return next_amount

    return None


def _find_line_near_keywords(lines: list[str], keywords: tuple[str, ...]) -> str | None:
    normalized_keywords = tuple(_normalize_for_matching(keyword) for keyword in keywords)
    for index, line in enumerate(lines):
        normalized_line = _normalize_for_matching(line)
        if not any(keyword in normalized_line for keyword in normalized_keywords):
            continue

        compact_line = " ".join(line.split()).strip()
        if compact_line:
            return compact_line

        if index + 1 < len(lines):
            next_line = " ".join(lines[index + 1].split()).strip()
            if next_line:
                return next_line
    return None


def _parse_amount_to_float(value: str | None) -> float | None:
    if value is None:
        return None

    normalized_value = (
        value.replace("MAD", "")
        .replace("DHS", "")
        .replace("DH", "")
        .replace(" ", "")
        .replace(",", ".")
        .strip()
    )
    if not normalized_value:
        return None

    try:
        return float(normalized_value)
    except ValueError:
        return None


def _detect_operators(text: str) -> list[str]:
    normalized_text = text.lower()
    return [operator for operator in OPERATORS if operator.lower() in normalized_text]


def _detect_departments(text: str) -> list[str]:
    normalized_text = _normalize_for_matching(text)
    detected_departments: list[str] = []
    for department in DEPARTMENTS:
        normalized_department = _normalize_for_matching(department)
        if re.search(rf"\b{re.escape(normalized_department)}\b", normalized_text):
            detected_departments.append(department)
    return detected_departments


def _detect_alert_lines(lines: list[str]) -> list[str]:
    alert_keywords = ("alerte", "critique", "anomal", "depasse", "fraude", "risque")
    return [line for line in lines if any(keyword in line.lower() for keyword in alert_keywords)][:8]


def _detect_kpis_legacy(lines: list[str]) -> list[str]:
    kpis: list[str] = []
    for line in lines:
        normalized_line = " ".join(line.split())
        if len(normalized_line) > 120:
            continue
        if re.search(r"\b\d+(?:[.,]\d+)?\s*(?:mad|%|go|gb|lignes?)\b", normalized_line, flags=re.IGNORECASE):
            kpis.append(normalized_line)
        elif re.search(r"\b(kpi|budget|cout|coût|consommation|quota|roaming|facture)\b", normalized_line, flags=re.IGNORECASE):
            kpis.append(normalized_line)

    unique_kpis: list[str] = []
    seen = set()
    for kpi in kpis:
        key = kpi.lower()
        if key in seen:
            continue
        seen.add(key)
        unique_kpis.append(kpi)
    return unique_kpis[:10]


VISIBLE_KPI_KEYWORDS = (
    "score",
    "fraude",
    "anomal",
    "churn",
    "revenu",
    "client",
    "clients",
    "contrat",
    "mensuel",
    "roaming",
    "exposition",
    "portfolio",
    "portefeuille",
    "impact",
    "budget",
    "cout",
    "coût",
    "consommation",
    "quota",
    "depassement",
    "dépassement",
    "lignes",
    "ligne",
    "alertes",
    "alerte",
    "volume",
    "risque",
    "forfait",
    "fleet health",
    "kpi",
)


def _contains_visible_kpi_keyword(line: str) -> bool:
    normalized_line = _normalize_for_matching(line)
    return any(keyword in normalized_line for keyword in VISIBLE_KPI_KEYWORDS)


def _has_visible_kpi_value(line: str) -> bool:
    return bool(
        re.search(
            r"\b\d{1,3}(?:[ .]\d{3})*(?:[.,]\d+)?\s*(?:mad|dhs|dh|%|go|gb|mo|to)\b|\b\d{1,3}\s*/\s*100\b|\b\d+(?:[.,]\d+)?\b",
            line,
            flags=re.IGNORECASE,
        )
    )


def _merge_split_kpi_lines(lines: list[str]) -> list[str]:
    merged_lines: list[str] = []
    compact_lines = [" ".join(line.split()).strip() for line in lines if " ".join(line.split()).strip()]
    skip_indexes: set[int] = set()

    for index, line in enumerate(compact_lines):
        if index in skip_indexes:
            continue
        if (
            _contains_visible_kpi_keyword(line)
            and not _has_visible_kpi_value(line)
            and index + 1 < len(compact_lines)
        ):
            next_line = compact_lines[index + 1]
            if _has_visible_kpi_value(next_line):
                merged_lines.append(f"{line}: {next_line}")
                skip_indexes.add(index + 1)
                continue
        if (
            _has_visible_kpi_value(line)
            and index + 1 < len(compact_lines)
        ):
            next_line = compact_lines[index + 1]
            if _contains_visible_kpi_keyword(next_line) and not _has_visible_kpi_value(next_line):
                merged_lines.append(f"{next_line}: {line}")
                skip_indexes.add(index + 1)
                continue
        merged_lines.append(line)

    return merged_lines


def _calibrate_ocr_confidence(
    *,
    raw_confidence: float,
    text: str,
    lines: list[str],
    detected_kpis: list[str],
    amounts_mad: list[str],
) -> float:
    if not text.strip() and not lines:
        return 0.0

    bounded_confidence = max(0.0, min(raw_confidence, 1.0))
    readable_length = len(text.strip())
    evidence_count = len(detected_kpis) + len(amounts_mad)
    dense_text = len(lines) >= 6 or readable_length >= 80
    strong_text = len(lines) >= 10 or readable_length >= 140

    if bounded_confidence >= 0.8 or (strong_text and evidence_count >= 4):
        return max(0.8, min(max(bounded_confidence, 0.84), 0.95))
    if bounded_confidence >= 0.45 or evidence_count >= 2 or dense_text:
        floor = 0.62 if evidence_count >= 3 or strong_text else 0.46
        ceiling = 0.8 if floor >= 0.6 else 0.6
        return max(floor, min(max(bounded_confidence, floor), ceiling))
    return max(0.45, min(max(bounded_confidence, 0.45), 0.6))


def _detect_kpis(lines: list[str]) -> list[str]:
    kpis: list[str] = []
    for line in _merge_split_kpi_lines(lines):
        normalized_line = " ".join(line.split()).strip()
        if not normalized_line or len(normalized_line) > 140:
            continue
        if _contains_visible_kpi_keyword(normalized_line) and _has_visible_kpi_value(normalized_line):
            kpis.append(normalized_line)
            continue
        if re.search(
            r"\b\d{1,3}\s*/\s*100\b|\b\d{1,3}(?:[.,]\d{1,2})?\s*%\b|\b\d{1,3}(?:[ .]\d{3})*(?:[.,]\d+)?\s*(?:mad|dhs|dh)\b",
            normalized_line,
            flags=re.IGNORECASE,
        ) and _contains_visible_kpi_keyword(normalized_line):
            kpis.append(normalized_line)
            continue
        if re.search(
            r"\b\d{1,3}(?:[ .]\d{3})*\b",
            normalized_line,
            flags=re.IGNORECASE,
        ) and any(
            keyword in _normalize_for_matching(normalized_line)
            for keyword in ("alertes", "alerte", "anomal", "depassement", "lignes", "volume")
        ):
            kpis.append(normalized_line)

    unique_kpis: list[str] = []
    seen = set()
    for kpi in kpis:
        key = kpi.lower()
        if key in seen:
            continue
        seen.add(key)
        unique_kpis.append(kpi)
    return unique_kpis[:12]


def _detect_visible_tables(lines: list[str]) -> list[str]:
    table_like_lines: list[str] = []
    for line in lines:
        if len(re.findall(r"\d", line)) >= 2 and len(line.split()) >= 3:
            table_like_lines.append(" ".join(line.split()))
        elif "|" in line or "\t" in line:
            table_like_lines.append(" ".join(line.split()))
    return table_like_lines[:8]


def _extract_invoice_date(lines: list[str], text: str) -> str | None:
    for line in lines:
        normalized_line = _normalize_for_matching(line)
        if "date" in normalized_line and "facture" in normalized_line:
            match = re.search(r"\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b", line)
            if match:
                return match.group(0)

    return _extract_first_match(r"\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b", text)


def _extract_billing_period(lines: list[str], text: str) -> str | None:
    period_pattern = (
        r"\bdu\s+\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\s+au\s+\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b"
    )
    period_match = _extract_first_match(period_pattern, text)
    if period_match:
        return period_match

    return _find_line_near_keywords(lines, ("periode", "periode de facturation", "billing period"))


def _extract_invoice_number(lines: list[str], text: str) -> str | None:
    direct_match = _extract_first_match(
        r"(?:numero\s+facture|n\s*facture|reference|référence|ref|invoice\s+number)[^A-Za-z0-9]{0,6}([A-Za-z0-9./_-]{4,})",
        text,
    )
    if direct_match:
        return direct_match

    candidate_line = _find_line_near_keywords(
        lines,
        ("numero facture", "n facture", "reference facture", "invoice number"),
    )
    if not candidate_line:
        return None

    return _extract_first_match(r"([A-Za-z0-9./_-]{4,})", candidate_line)


def _extract_billed_lines(lines: list[str]) -> list[str]:
    detected_lines = _extract_unique_matches(r"(\+212\d{9}|0\d{9})", "\n".join(lines))
    if detected_lines:
        return detected_lines[:8]

    return [
        " ".join(line.split())
        for line in lines
        if any(keyword in _normalize_for_matching(line) for keyword in ("ligne", "numero", "msisdn"))
    ][:8]


def _extract_fee_lines(lines: list[str], keywords: tuple[str, ...]) -> list[str]:
    normalized_keywords = tuple(_normalize_for_matching(keyword) for keyword in keywords)
    return [
        " ".join(line.split())
        for line in lines
        if any(keyword in _normalize_for_matching(line) for keyword in normalized_keywords)
    ][:8]


def _detect_incident_type(text: str) -> str | None:
    normalized_text = _normalize_for_matching(text)
    incident_type_rules = [
        ("fraude", ("fraude", "fraud", "simbox", "premium rate", "surtaxe")),
        (
            "appel_suspect",
            (
                "appel suspect",
                "appels suspects",
                "numero suspect",
                "call burst",
                "premium",
                "international",
            ),
        ),
        (
            "depassement_quota",
            ("depassement quota", "quota", "hors forfait", "surconsommation", "data overage"),
        ),
        (
            "erreur_systeme",
            ("erreur systeme", "error", "exception", "stack trace", "traceback", "service unavailable"),
        ),
        ("log", ("log", "journal", "trace", "syslog")),
        ("alerte", ("alerte", "warning", "critical", "criticite", "seuil")),
        ("anomalie", ("anomalie", "anormal", "risque")),
    ]

    for incident_type, keywords in incident_type_rules:
        if any(keyword in normalized_text for keyword in keywords):
            return incident_type
    return None


def _detect_severity(text: str) -> str | None:
    normalized_text = _normalize_for_matching(text)
    severity_rules = [
        ("critique", ("critique", "critical", "urgent", "p1", "sev1", "bloquant")),
        ("elevee", ("elevee", "high", "majeur", "severe", "p2", "sev2")),
        ("moyenne", ("moyenne", "medium", "warning", "moderate", "p3", "sev3")),
        ("faible", ("faible", "low", "info", "informational", "p4", "sev4")),
    ]

    for severity, keywords in severity_rules:
        if any(keyword in normalized_text for keyword in keywords):
            return severity
    return None


def _extract_detected_timestamp(text: str) -> str | None:
    patterns = (
        r"(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\s+\d{1,2}:\d{2}(?::\d{2})?)",
        r"(\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}(?::\d{2})?)",
        r"(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})",
    )
    for pattern in patterns:
        match = _extract_first_match(pattern, text)
        if match:
            return match
    return None


def _extract_line_reference(lines: list[str], text: str) -> str | None:
    detected_lines = _extract_unique_matches(r"(\+212\d{9}|0\d{9})", text)
    if detected_lines:
        return detected_lines[0]

    candidate_line = _find_line_near_keywords(
        lines,
        ("ligne", "numero", "msisdn", "line", "caller", "callee"),
    )
    if not candidate_line:
        return None
    return candidate_line


def _extract_call_volume(lines: list[str], text: str) -> str | None:
    candidate_line = _find_line_near_keywords(
        lines,
        ("volume d'appels", "volume appels", "calls", "minutes", "min", "appels"),
    )
    if candidate_line:
        return candidate_line
    return _extract_first_match(r"(\d+\s*(?:appels?|calls?|minutes?|min))", text)


def _extract_data_overage(lines: list[str], text: str) -> str | None:
    candidate_line = _find_line_near_keywords(
        lines,
        ("quota", "data", "go", "gb", "hors forfait", "depassement", "surconsommation"),
    )
    if candidate_line:
        return candidate_line
    return _extract_first_match(
        r"(\d+(?:[.,]\d+)?\s*(?:go|gb|mo|mb)\s*(?:sur|hors|depasse|used|utilises?)?)",
        text,
    )


def _extract_error_message(lines: list[str]) -> str | None:
    return _find_line_near_keywords(
        lines,
        ("error", "erreur", "exception", "failed", "timeout", "denied", "unavailable", "traceback"),
    )


def _derive_incident_priority(severity: str | None) -> str | None:
    priority_map = {
        "critique": "immediate",
        "elevee": "haute",
        "moyenne": "normale",
        "faible": "basse",
    }
    return priority_map.get((severity or "").strip().lower())


def _build_incident_probable_causes(
    text: str,
    *,
    alert_type: str | None,
    error_message: str | None,
    data_overage: str | None,
    suspect_cost_mad: str | None,
) -> list[str]:
    normalized_text = _normalize_for_matching(text)
    causes: list[str] = []

    if alert_type == "fraude":
        causes.append("Un comportement de fraude ou de trafic premium semble visible.")
    if alert_type == "appel_suspect":
        causes.append("Le volume ou la destination des appels semble anormal.")
    if alert_type == "depassement_quota":
        causes.append("Un depassement data ou hors forfait semble present.")
    if alert_type == "erreur_systeme":
        causes.append("Une erreur technique ou un incident applicatif semble remonter.")
    if "roaming" in normalized_text:
        causes.append("Des usages roaming ou hors zone peuvent expliquer l'alerte.")
    if "international" in normalized_text:
        causes.append("Des appels internationaux peuvent contribuer au risque ou au surcout.")
    if suspect_cost_mad:
        causes.append("Un montant suspect apparait dans la capture et doit etre confirme.")
    if data_overage:
        causes.append("La capture montre un volume data a verifier contre le quota.")
    if error_message and "timeout" in _normalize_for_matching(error_message):
        causes.append("Le delai de reponse du service semble depasse.")

    return _extract_unique_matches(r"(.+)", "\n".join(causes))[:6]


def _extract_incident_details(
    lines: list[str],
    text: str,
    operators: list[str],
    confidence: float,
) -> IncidentDocumentDetails | None:
    incident_type = _detect_incident_type(text)
    if incident_type is None:
        return None

    severity = _detect_severity(text)
    suspect_cost_mad = _find_amount_near_keywords(
        lines,
        ("montant", "cout suspect", "surcout", "depassement", "hors forfait", "fraude", "premium"),
    )
    data_overage = _extract_data_overage(lines, text)
    error_message = _extract_error_message(lines)
    summary = _find_line_near_keywords(
        lines,
        ("alerte", "critical", "warning", "fraude", "suspect", "quota", "error", "exception"),
    )
    probable_causes = _build_incident_probable_causes(
        text,
        alert_type=incident_type,
        error_message=error_message,
        data_overage=data_overage,
        suspect_cost_mad=suspect_cost_mad,
    )

    return IncidentDocumentDetails(
        alert_type=incident_type,
        severity=severity,
        detected_at=_extract_detected_timestamp(text),
        operator=operators[0] if operators else None,
        line_reference=_extract_line_reference(lines, text),
        suspect_cost_mad=suspect_cost_mad,
        call_volume=_extract_call_volume(lines, text),
        data_overage=data_overage,
        error_message=error_message,
        priority=_derive_incident_priority(severity),
        summary=summary,
        probable_causes=_dedupe_non_empty(probable_causes, 6),
    )


def _extract_invoice_details(
    lines: list[str],
    text: str,
    operators: list[str],
    confidence: float,
) -> InvoiceDocumentDetails | None:
    normalized_text = _normalize_for_matching(text)
    invoice_keywords = (
        "facture",
        "invoice",
        "tva",
        "ttc",
        "hors taxe",
        "hors forfait",
        "net a payer",
    )
    if not any(keyword in normalized_text for keyword in invoice_keywords):
        return None

    operator = operators[0] if operators else None
    invoice_number = _extract_invoice_number(lines, text)
    invoice_date = _extract_invoice_date(lines, text)
    billing_period = _extract_billing_period(lines, text)
    amount_ht_mad = _find_amount_near_keywords(lines, ("montant ht", "total ht", "hors taxe", "ht"))
    vat_amount_mad = _find_amount_near_keywords(lines, ("tva", "vat"))
    amount_ttc_mad = _find_amount_near_keywords(lines, ("ttc", "total ttc", "montant ttc"))
    total_amount_mad = _find_amount_near_keywords(
        lines,
        ("net a payer", "montant total", "total a payer", "total mad", "total facture"),
    )
    billed_lines = _extract_billed_lines(lines)
    additional_fees = _extract_fee_lines(
        lines,
        ("frais", "service", "options", "roaming", "redevance", "supplement"),
    )
    overage_items = _extract_fee_lines(
        lines,
        ("depassement", "depasse", "hors forfait", "surconsommation", "extra data"),
    )

    anomalies: list[str] = []
    if additional_fees:
        anomalies.append("Frais supplementaires detectes sur la facture.")
    if overage_items:
        anomalies.append("Depassements ou hors forfait detectes.")

    amount_ht_float = _parse_amount_to_float(amount_ht_mad)
    vat_amount_float = _parse_amount_to_float(vat_amount_mad)
    amount_ttc_float = _parse_amount_to_float(amount_ttc_mad or total_amount_mad)
    if (
        amount_ht_float is not None
        and vat_amount_float is not None
        and amount_ttc_float is not None
        and abs((amount_ht_float + vat_amount_float) - amount_ttc_float) > 3.0
    ):
        anomalies.append("Ecart possible entre HT + TVA et le total TTC lu par OCR.")

    return InvoiceDocumentDetails(
        operator=operator,
        invoice_number=invoice_number,
        invoice_date=invoice_date,
        billing_period=billing_period,
        amount_ht_mad=amount_ht_mad,
        vat_amount_mad=vat_amount_mad,
        amount_ttc_mad=amount_ttc_mad,
        total_amount_mad=total_amount_mad,
        billed_lines=billed_lines,
        additional_fees=additional_fees,
        overage_items=overage_items,
        anomalies=anomalies[:8],
    )


def _contains_any_keyword(normalized_text: str, keywords: tuple[str, ...] | list[str]) -> bool:
    return any(keyword in normalized_text for keyword in keywords)


def _detect_workflow_type(text: str) -> str | None:
    normalized_text = _normalize_for_matching(text)
    workflow_type_rules = [
        (
            "organigramme",
            ("organigramme", "organigram", "hierarchie", "reporting", "direction", "manager"),
        ),
        (
            "architecture",
            ("architecture", "serveur", "server", "database", "db", "api", "gateway", "microservice"),
        ),
        (
            "diagramme_technique",
            ("diagramme technique", "schema technique", "infra", "integration", "proxy", "bus"),
        ),
        (
            "processus_metier",
            ("processus", "workflow", "process", "validation", "approbation", "support it"),
        ),
        (
            "workflow",
            ("workflow", "diagramme", "schema", "etape", "decision", "validation"),
        ),
    ]

    for workflow_type, keywords in workflow_type_rules:
        if any(keyword in normalized_text for keyword in keywords):
            return workflow_type
    return None


def _is_workflow_candidate(lines: list[str], text: str) -> bool:
    normalized_text = _normalize_for_matching(text)
    keyword_hits = sum(
        1
        for keyword in (
            "workflow",
            "processus",
            "diagramme",
            "schema",
            "validation",
            "approbation",
            "decision",
            "hierarchie",
            "architecture",
        )
        if keyword in normalized_text
    )
    relation_hits = sum(
        1 for line in lines if _contains_any_keyword(_normalize_for_matching(line), WORKFLOW_RELATION_TOKENS)
    )
    return _detect_workflow_type(text) is not None or keyword_hits >= 2 or relation_hits >= 2


def _is_probable_workflow_step_line(line: str) -> bool:
    compact_line = " ".join(line.split()).strip()
    normalized_line = _normalize_for_matching(compact_line)
    if not compact_line or len(compact_line) > 96:
        return False
    if re.fullmatch(r"[\d\s./:,-]+", compact_line):
        return False
    if _extract_first_match(r"\b\d+(?:[.,]\d+)?\s*(?:mad|dhs|dh)\b", compact_line):
        return False
    if any(keyword in normalized_line for keyword in ("facture", "montant ht", "tva", "ttc", "traceback")):
        return False
    if _contains_any_keyword(normalized_line, WORKFLOW_ACTION_KEYWORDS):
        return True
    if _contains_any_keyword(normalized_line, WORKFLOW_DECISION_KEYWORDS):
        return True
    if _contains_any_keyword(normalized_line, WORKFLOW_VALIDATION_KEYWORDS):
        return True
    if _contains_any_keyword(normalized_line, WORKFLOW_RELATION_TOKENS):
        return True
    return 2 <= len(compact_line.split()) <= 7 and any(character.isalpha() for character in compact_line)


def _extract_workflow_step_names(lines: list[str]) -> list[str]:
    return _dedupe_non_empty(
        [
            " ".join(line.split()).strip()
            for line in lines
            if _is_probable_workflow_step_line(line)
        ],
        14,
    )


def _extract_workflow_roles(lines: list[str]) -> list[str]:
    detected_roles: list[str] = []
    for line in lines:
        normalized_line = _normalize_for_matching(line)
        if not any(keyword in normalized_line for keyword in ROLE_KEYWORDS):
            continue
        compact_line = " ".join(line.split()).strip()
        if compact_line:
            detected_roles.append(compact_line)
    return _dedupe_non_empty(detected_roles, 8)


def _extract_workflow_decisions(lines: list[str]) -> list[str]:
    detected_decisions = [
        " ".join(line.split()).strip()
        for line in lines
        if _contains_any_keyword(_normalize_for_matching(line), WORKFLOW_DECISION_KEYWORDS)
    ]
    return _dedupe_non_empty(detected_decisions, 8)


def _extract_workflow_validations(lines: list[str]) -> list[str]:
    detected_validations = [
        " ".join(line.split()).strip()
        for line in lines
        if _contains_any_keyword(_normalize_for_matching(line), WORKFLOW_VALIDATION_KEYWORDS)
    ]
    return _dedupe_non_empty(detected_validations, 8)


def _extract_workflow_actions(lines: list[str]) -> list[str]:
    detected_actions = [
        " ".join(line.split()).strip()
        for line in lines
        if _contains_any_keyword(_normalize_for_matching(line), WORKFLOW_ACTION_KEYWORDS)
    ]
    return _dedupe_non_empty(detected_actions, 10)


def _extract_workflow_relations(lines: list[str]) -> list[str]:
    detected_relations = [
        " ".join(line.split()).strip()
        for line in lines
        if _contains_any_keyword(_normalize_for_matching(line), WORKFLOW_RELATION_TOKENS)
    ]
    return _dedupe_non_empty(detected_relations, 8)


def _estimate_hierarchy_levels(text_regions: list[OcrTextRegion]) -> int | None:
    if not text_regions:
        return None

    centers = sorted(int(region.bbox[1] + (region.bbox[3] / 2)) for region in text_regions if region.confidence >= 0.45)
    if not centers:
        return None

    levels: list[int] = []
    for center in centers:
        if not levels or abs(center - levels[-1]) >= 58:
            levels.append(center)
    return max(1, min(len(levels), 8))


def _extract_workflow_bottlenecks(lines: list[str]) -> list[str]:
    detected_bottlenecks = [
        " ".join(line.split()).strip()
        for line in lines
        if _contains_any_keyword(_normalize_for_matching(line), WORKFLOW_BOTTLENECK_KEYWORDS)
    ]
    return _dedupe_non_empty(detected_bottlenecks, 8)


def _extract_repeated_validations(validations: list[str]) -> list[str]:
    if len(validations) < 2:
        return []
    return _dedupe_non_empty(validations, 4)


def _extract_automation_opportunities(
    *,
    lines: list[str],
    validations: list[str],
    bottlenecks: list[str],
    departments: list[str],
) -> list[str]:
    opportunities: list[str] = []
    normalized_lines = [_normalize_for_matching(line) for line in lines]

    if len(validations) >= 2:
        opportunities.append("Automatiser les validations repetitives visibles dans le schema.")
    if any(_contains_any_keyword(line, WORKFLOW_AUTOMATION_KEYWORDS) for line in normalized_lines):
        opportunities.append("Remplacer les transferts manuels par un workflow outille.")
    if len(departments) >= 3:
        opportunities.append("Reduire les handoffs entre departements pour accelerer le flux.")
    if len(bottlenecks) >= 2:
        opportunities.append("Supprimer les files d'attente ou controles manuels sur les etapes critiques.")

    return _dedupe_non_empty(opportunities, 4)


def _build_workflow_complexity_score(
    *,
    step_count: int,
    decision_count: int,
    validation_count: int,
    relation_count: int,
    hierarchy_levels: int | None,
    bottleneck_count: int,
    repeated_validation_count: int,
) -> tuple[int, str]:
    complexity_score = max(
        0,
        min(
            int(
                round(
                    (step_count * 6)
                    + (decision_count * 7)
                    + (validation_count * 9)
                    + (relation_count * 5)
                    + ((hierarchy_levels or 1) * 5)
                    + (bottleneck_count * 10)
                    + (repeated_validation_count * 9)
                )
            ),
            100,
        ),
    )
    if complexity_score >= 80:
        complexity_level = "critical"
    elif complexity_score >= 60:
        complexity_level = "high"
    elif complexity_score >= 35:
        complexity_level = "medium"
    else:
        complexity_level = "low"
    return complexity_score, complexity_level


def _extract_workflow_details(
    *,
    lines: list[str],
    text: str,
    text_regions: list[OcrTextRegion],
    departments: list[str],
    confidence: float,
) -> WorkflowDocumentDetails | None:
    if not _is_workflow_candidate(lines, text):
        return None

    workflow_type = _detect_workflow_type(text) or "workflow"
    step_names = _extract_workflow_step_names(lines)
    roles = _extract_workflow_roles(lines)
    decisions = _extract_workflow_decisions(lines)
    validations = _extract_workflow_validations(lines)
    actions = _extract_workflow_actions(lines)
    relations = _extract_workflow_relations(lines)
    hierarchy_levels = _estimate_hierarchy_levels(text_regions)
    bottlenecks = _extract_workflow_bottlenecks(lines)
    repeated_validations = _extract_repeated_validations(validations)
    automation_opportunities = _extract_automation_opportunities(
        lines=lines,
        validations=validations,
        bottlenecks=bottlenecks,
        departments=departments,
    )

    visible_step_names = step_names if step_names else ["Etape non lisible avec certitude"]
    complexity_score, complexity_level = _build_workflow_complexity_score(
        step_count=0 if visible_step_names == ["Etape non lisible avec certitude"] else len(visible_step_names),
        decision_count=len(decisions),
        validation_count=len(validations),
        relation_count=len(relations),
        hierarchy_levels=hierarchy_levels,
        bottleneck_count=len(bottlenecks),
        repeated_validation_count=len(repeated_validations),
    )

    critical_steps = _dedupe_non_empty(
        [
            *bottlenecks,
            *repeated_validations,
            *decisions,
            *[
                step
                for step in visible_step_names
                if _contains_any_keyword(
                    _normalize_for_matching(step),
                    (
                        "critique",
                        "blocage",
                        "validation",
                        "approbation",
                        "incident",
                        "fraude",
                        "budget",
                        "escalade",
                    ),
                )
            ],
        ],
        8,
    )

    summary_parts = [
        f"{0 if visible_step_names == ['Etape non lisible avec certitude'] else len(visible_step_names)} etape(s) visibles",
        f"{len(validations)} validation(s)",
        f"{len(relations)} dependance(s) textuelles",
        f"complexite {complexity_level}",
    ]
    if confidence < 0.65:
        summary_parts.append("OCR partiel: confirmer les etapes critiques.")

    return WorkflowDocumentDetails(
        workflow_type=workflow_type,
        step_names=visible_step_names,
        departments=_dedupe_non_empty(departments, 8),
        roles=roles,
        decisions=decisions,
        validations=validations,
        actions=actions,
        relations=relations,
        hierarchy_levels=hierarchy_levels,
        critical_steps=critical_steps,
        bottlenecks=bottlenecks,
        automation_opportunities=automation_opportunities,
        repeated_validations=repeated_validations,
        complexity_score=complexity_score,
        complexity_level=complexity_level,
        summary=", ".join(summary_parts),
    )


def _detect_ui_type(text: str) -> str | None:
    normalized_text = _normalize_for_matching(text)
    ui_type_rules = [
        ("chatbot", ("chatbot", "assistant ia", "regenerer", "voir source ia", "analyse en cours")),
        ("formulaire", ("formulaire", "form", "email", "mot de passe", "password", "valider", "submit")),
        ("page_analytics", ("analytics", "analyse", "rapport", "filtres", "trend", "insights")),
        ("dashboard", ("dashboard", "tableau de bord", "vue d'ensemble", "widgets", "kpi")),
        ("tableau", ("tableau", "colonnes", "lignes", "tri", "export", "csv")),
        ("interface_mobile", ("mobile", "android", "ios", "ecran mobile", "bottom bar")),
    ]
    for ui_type, keywords in ui_type_rules:
        if any(keyword in normalized_text for keyword in keywords):
            return ui_type
    return None


def _is_probable_button_label(line: str) -> bool:
    compact_line = " ".join(line.split()).strip()
    normalized_line = _normalize_for_matching(compact_line)
    if not compact_line or len(compact_line) > 28:
        return False
    if re.fullmatch(r"[\d\s./:,-]+", compact_line):
        return False
    word_count = len(compact_line.split())
    return word_count <= 4 and _contains_any_keyword(normalized_line, UI_BUTTON_KEYWORDS)


def _extract_button_labels(lines: list[str]) -> list[str]:
    return _dedupe_non_empty(
        [
            " ".join(line.split()).strip()
            for line in lines
            if _is_probable_button_label(line)
        ],
        10,
    )


def _extract_menu_labels(lines: list[str]) -> list[str]:
    menu_labels = [
        " ".join(line.split()).strip()
        for line in lines
        if 1 <= len(line.split()) <= 5
        and _contains_any_keyword(_normalize_for_matching(line), UI_MENU_KEYWORDS)
    ]
    return _dedupe_non_empty(menu_labels, 10)


def _extract_ui_titles(lines: list[str]) -> list[str]:
    candidate_titles: list[str] = []
    for line in lines[:8]:
        compact_line = " ".join(line.split()).strip()
        normalized_line = _normalize_for_matching(compact_line)
        if not compact_line or len(compact_line) > 64:
            continue
        if _contains_any_keyword(normalized_line, UI_TITLE_KEYWORDS) or (
            2 <= len(compact_line.split()) <= 7 and compact_line[:1].isupper()
        ):
            candidate_titles.append(compact_line)
    return _dedupe_non_empty(candidate_titles, 6)


def _extract_ui_error_messages(lines: list[str]) -> list[str]:
    return _dedupe_non_empty(
        [
            " ".join(line.split()).strip()
            for line in lines
            if _contains_any_keyword(_normalize_for_matching(line), UI_ERROR_KEYWORDS)
        ],
        6,
    )


def _extract_ui_dense_zones(
    *,
    lines: list[str],
    visible_tables: list[str],
) -> list[str]:
    dense_zone_candidates = [
        " ".join(line.split()).strip()
        for line in lines
        if 5 <= len(line.split()) <= 14 and len(line) >= 28
    ]
    dense_zone_candidates.extend(visible_tables[:4])
    return _dedupe_non_empty(dense_zone_candidates, 8)


def _is_ui_capture_candidate(
    *,
    lines: list[str],
    text: str,
    visible_tables: list[str],
    kpis: list[str],
) -> bool:
    normalized_text = _normalize_for_matching(text)
    short_label_count = sum(1 for line in lines if 1 <= len(line.split()) <= 4 and len(line) <= 28)
    ui_keyword_hits = sum(
        1
        for keyword in (
            "dashboard",
            "tableau de bord",
            "kpi",
            "analytics",
            "filtres",
            "menu",
            "formulaire",
            "assistant ia",
            "chatbot",
            "telecharger",
        )
        if keyword in normalized_text
    )
    return (
        _detect_ui_type(text) is not None
        or ui_keyword_hits >= 2
        or (len(kpis) >= 2 and short_label_count >= 4)
        or (len(visible_tables) >= 1 and short_label_count >= 4)
        or len(_extract_menu_labels(lines)) >= 3
        or len(_extract_button_labels(lines)) >= 3
    )


def _build_ui_scores(
    *,
    button_count: int,
    menu_count: int,
    title_count: int,
    error_count: int,
    dense_zone_count: int,
    visible_kpi_count: int,
    mobile_interface: bool,
    dark_mode_detected: bool,
    confidence: float,
) -> tuple[int, int, int, int, int]:
    ux_score = 82
    readability_score = 80
    accessibility_score = 79
    density_score = 78
    modern_ui_score = 76

    if title_count == 0:
        ux_score -= 8
        readability_score -= 12
        modern_ui_score -= 8
    if dense_zone_count >= 3:
        ux_score -= 18
        readability_score -= 12
        density_score -= 28
    elif dense_zone_count >= 1:
        ux_score -= 8
        density_score -= 14
    if menu_count >= 5:
        ux_score -= 8
        density_score -= 10
    if error_count >= 1:
        ux_score -= 8
        accessibility_score -= 8
        modern_ui_score -= 6
    if button_count == 0:
        ux_score -= 6
        accessibility_score -= 5
    elif button_count >= 2:
        ux_score += 4
        accessibility_score += 4
    if visible_kpi_count >= 2:
        ux_score += 6
        readability_score += 4
    if mobile_interface:
        accessibility_score -= 4
        density_score -= 6
    if dark_mode_detected:
        accessibility_score -= 4
        readability_score -= 4
    if confidence < 0.65:
        ux_score -= 6
        readability_score -= 6
        accessibility_score -= 6

    return tuple(
        max(0, min(score, 100))
        for score in (
            ux_score,
            readability_score,
            accessibility_score,
            density_score,
            modern_ui_score,
        )
    )


def _extract_ui_details(
    *,
    lines: list[str],
    text: str,
    visible_tables: list[str],
    kpis: list[str],
    confidence: float,
) -> UiDocumentDetails | None:
    if not _is_ui_capture_candidate(lines=lines, text=text, visible_tables=visible_tables, kpis=kpis):
        return None

    normalized_text = _normalize_for_matching(text)
    ui_type = _detect_ui_type(text) or ("tableau" if visible_tables else "capture_interface")
    button_labels = _extract_button_labels(lines)
    menu_labels = _extract_menu_labels(lines)
    titles = _extract_ui_titles(lines)
    error_messages = _extract_ui_error_messages(lines)
    dense_zones = _extract_ui_dense_zones(lines=lines, visible_tables=visible_tables)
    visible_kpis = _dedupe_non_empty([*kpis, *visible_tables], 8)
    dark_mode_detected = "dark mode" in normalized_text
    mobile_interface = any(keyword in normalized_text for keyword in ("mobile", "android", "ios", "smartphone"))

    detected_issues: list[str] = []
    strong_points: list[str] = []
    recommendations: list[str] = []

    if dense_zones:
        detected_issues.append("Surcharge visuelle probable sur une ou plusieurs zones de contenu.")
        recommendations.append("Reduire la densite visuelle et espacer les blocs d'information.")
    if len(menu_labels) >= 5:
        detected_issues.append("Navigation chargee avec plusieurs entrees visibles simultanement.")
        recommendations.append("Simplifier la navigation et reduire les elements secondaires visibles.")
    if not titles:
        detected_issues.append("Hierarchie visuelle des titres peu nette sur la capture.")
        recommendations.append("Ameliorer la hierarchie des titres et sous-titres.")
    if error_messages:
        detected_issues.append("Messages d'erreur ou d'alerte visibles dans l'interface.")
        recommendations.append("Clarifier les messages d'erreur et mieux les isoler visuellement.")
    if visible_tables and len(visible_kpis) >= 3:
        detected_issues.append("KPI et tableaux semblent rapproches, avec un risque de lecture plus lente.")
        recommendations.append("Mieux separer les KPI, tableaux et actions principales.")
    if mobile_interface:
        detected_issues.append("Espace mobile potentiellement contraint pour la lecture ou les actions tactiles.")
        recommendations.append("Verifier le responsive et les zones tactiles de l'interface mobile.")
    if dark_mode_detected:
        detected_issues.append("Le dark mode doit etre confirme visuellement sur le contraste des contenus.")
        recommendations.append("Ameliorer le contraste du dark mode sur les zones textuelles et actions.")

    if titles:
        strong_points.append("Titres principaux identifies dans l'interface.")
    if button_labels:
        strong_points.append("Actions visibles et reperees dans la capture.")
    if visible_kpis:
        strong_points.append("KPI ou blocs d'information detectes rapidement.")
    if not error_messages and len(dense_zones) <= 1:
        strong_points.append("La capture reste globalement lisible sur les zones OCR detectees.")

    ux_score, readability_score, accessibility_score, density_score, modern_ui_score = _build_ui_scores(
        button_count=len(button_labels),
        menu_count=len(menu_labels),
        title_count=len(titles),
        error_count=len(error_messages),
        dense_zone_count=len(dense_zones),
        visible_kpi_count=len(visible_kpis),
        mobile_interface=mobile_interface,
        dark_mode_detected=dark_mode_detected,
        confidence=confidence,
    )

    summary_parts = [
        f"type {ui_type}",
        f"{len(titles)} titre(s)",
        f"{len(button_labels)} action(s)",
        f"{len(visible_kpis)} KPI/bloc(s)",
        f"UX {ux_score}/100",
    ]
    if dense_zones:
        summary_parts.append("densite a surveiller")
    if error_messages:
        summary_parts.append("messages d'erreur visibles")

    return UiDocumentDetails(
        ui_type=ui_type,
        button_labels=button_labels,
        menu_labels=menu_labels,
        titles=titles,
        error_messages=error_messages,
        dense_zones=dense_zones,
        visible_kpis=visible_kpis,
        detected_issues=_dedupe_non_empty(detected_issues, 8),
        recommendations=_dedupe_non_empty(recommendations, 6),
        strong_points=_dedupe_non_empty(strong_points, 6),
        dark_mode_detected=dark_mode_detected,
        mobile_interface=mobile_interface,
        ux_score=ux_score,
        readability_score=readability_score,
        accessibility_score=accessibility_score,
        density_score=density_score,
        modern_ui_score=modern_ui_score,
        summary=", ".join(summary_parts),
    )


def _detect_equipment_brand(text: str) -> str | None:
    normalized_text = _normalize_for_matching(text)
    for brand in EQUIPMENT_BRANDS:
        if _normalize_for_matching(brand) in normalized_text:
            return brand
    return None


def _detect_equipment_type(text: str) -> str | None:
    normalized_text = _normalize_for_matching(text)
    def contains_equipment_keyword(keyword: str) -> bool:
        return re.search(rf"(?<!\w){re.escape(keyword)}(?!\w)", normalized_text) is not None

    equipment_rules = [
        ("smartphone", ("smartphone", "telephone", "mobile", "iphone", "galaxy", "android", "ios")),
        ("routeur", ("routeur", "router", "gateway", "cpe")),
        ("modem", ("modem", "ont", "adsl", "fiber", "fibre", "4g box", "5g box")),
        ("sim", ("sim", "usim", "nano sim", "micro sim", "iccid", "imsi")),
        ("switch", ("switch", "ethernet switch", "catalyst", "port 1", "port 2")),
        ("borne_wifi", ("borne wifi", "access point", "ap ", "wi-fi", "wifi", "wlan")),
        ("antenne", ("antenne", "antenna", "radio", "sector", "rf")),
    ]
    for equipment_type, keywords in equipment_rules:
        if any(contains_equipment_keyword(keyword.strip()) for keyword in keywords):
            return equipment_type
    return None


def _is_equipment_candidate(lines: list[str], text: str) -> bool:
    normalized_text = _normalize_for_matching(text)
    return (
        _detect_equipment_type(text) is not None
        or _detect_equipment_brand(text) is not None
        or any(
            keyword in normalized_text
            for keyword in (
                "serial",
                "s/n",
                "imei",
                "iccid",
                "imsi",
                "model",
                "modele",
                "firmware",
                "battery",
                "batterie",
                "wifi",
                "switch",
                "routeur",
                "modem",
            )
        )
        or any(_normalize_for_matching(line).startswith("sn") for line in lines)
    )


def _extract_equipment_model(lines: list[str], text: str, brand: str | None) -> str | None:
    direct_model = _extract_first_match(
        r"(?:modele|model|model no|model number|product|pn|part number|ref)[^A-Za-z0-9]{0,6}([A-Za-z0-9][A-Za-z0-9./ _-]{2,28})",
        text,
    )
    if direct_model:
        return " ".join(direct_model.split()).strip()

    if brand:
        brand_pattern = re.compile(
            rf"{re.escape(brand)}\s+([A-Za-z0-9][A-Za-z0-9./_-]{{1,28}}(?:\s+[A-Za-z0-9./_-]{{1,28}})?)",
            flags=re.IGNORECASE,
        )
        for line in lines:
            match = brand_pattern.search(line)
            if match:
                candidate = " ".join(match.group(1).split()).strip()
                if candidate:
                    return candidate

    for line in lines:
        compact_line = " ".join(line.split()).strip()
        if len(compact_line) > 64:
            continue
        if re.search(r"\b[A-Z]{1,4}[- ]?\d{2,5}[A-Z0-9-]*\b", compact_line):
            return compact_line
    return None


def _extract_equipment_serial(text: str) -> str | None:
    patterns = (
        r"(?:serial|serial number|s/?n|sn)[^A-Za-z0-9]{0,6}([A-Z0-9-]{5,})",
        r"(?:imei)[^A-Za-z0-9]{0,6}([0-9]{10,20})",
        r"(?:iccid)[^A-Za-z0-9]{0,6}([0-9]{10,24})",
    )
    for pattern in patterns:
        match = _extract_first_match(pattern, text)
        if match:
            return match
    return None


def _extract_equipment_version(lines: list[str], text: str) -> str | None:
    version_pattern = r"(?:version|firmware|fw|ios|android|v)[^A-Za-z0-9]{0,6}([A-Za-z0-9._-]{2,20})"
    direct_version = _extract_first_match(version_pattern, text)
    if direct_version:
        return direct_version
    return _find_line_near_keywords(lines, ("version", "firmware", "android", "ios", "fw"))


def _extract_sim_information(lines: list[str], text: str) -> str | None:
    sim_line = _find_line_near_keywords(lines, ("sim", "usim", "iccid", "imsi", "msisdn"))
    if sim_line:
        return sim_line
    return _extract_first_match(r"((?:ICCID|IMSI|MSISDN)[^,\n]{4,32})", text)


def _extract_equipment_label_information(lines: list[str], brand: str | None, model: str | None) -> str | None:
    if brand and model:
        return f"{brand} {model}".strip()
    if brand:
        return brand
    for line in lines:
        compact_line = " ".join(line.split()).strip()
        if 4 <= len(compact_line) <= 52:
            return compact_line
    return None


def _build_equipment_usage_summary(equipment_type: str | None) -> str | None:
    usage_map = {
        "smartphone": "Terminal mobile professionnel pour la voix, la data et les applications metier.",
        "routeur": "Assure la connectivite WAN/LAN du site ou des lignes de flotte.",
        "modem": "Fournit l'acces fibre, ADSL ou 4G/5G vers le reseau operateur.",
        "sim": "Carte d'acces reseau mobile pour la voix, la data ou la telemetrie.",
        "switch": "Distribue la connectivite reseau filaire entre les equipements.",
        "borne_wifi": "Diffuse la connectivite WiFi aux utilisateurs et terminaux.",
        "antenne": "Assure la couverture radio ou la liaison d'acces du site.",
        "appareil_inconnu": "Usage exact non confirme visuellement.",
    }
    return usage_map.get(equipment_type or "", "Usage exact non confirme visuellement.")


def _extract_equipment_issues(
    *,
    text: str,
    brand: str | None,
    model: str | None,
    serial_number: str | None,
) -> list[str]:
    normalized_text = _normalize_for_matching(text)
    issues: list[str] = []

    if any(keyword in normalized_text for keyword in ("batterie gonflee", "swollen battery", "battery swollen")):
        issues.append("Batterie gonflee visible ou fortement suspectee.")
    if any(keyword in normalized_text for keyword in ("ecran casse", "crack", "screen broken", "fissure")):
        issues.append("Ecran casse ou fissure visible.")
    if any(keyword in normalized_text for keyword in ("surchauffe", "overheat", "temperature haute", "hot surface")):
        issues.append("Surchauffe visible ou suspectee.")
    if any(keyword in normalized_text for keyword in ("obsolete", "obsol", "legacy", "ancien modele", "old model")):
        issues.append("Materiel ancien ou potentiellement obsolete.")
    if any(keyword in normalized_text for keyword in NETWORK_ANOMALY_KEYWORDS):
        issues.append("Anomalie reseau visible sur l'equipement ou son etiquette.")
    if any(keyword in normalized_text for keyword in ("damage", "endommage", "casse", "fissure", "burn", "brule")):
        issues.append("Etat physique suspect ou endommage.")

    return _dedupe_non_empty(issues, 8)


def _build_equipment_visible_condition(issues: list[str]) -> str:
    issue_text = _normalize_for_matching(" ".join(issues))
    if "batterie gonflee" in issue_text:
        return "batterie gonflee suspectee"
    if "ecran casse" in issue_text:
        return "ecran endommage"
    if "surchauffe" in issue_text:
        return "surchauffe suspectee"
    if "etat physique suspect" in issue_text or "endommage" in issue_text:
        return "etat physique suspect"
    if "obsolete" in issue_text or "ancien" in issue_text:
        return "materiel ancien"
    return "etat apparent correct"


def _build_equipment_scores(
    *,
    equipment_type: str | None,
    text: str,
    issues: list[str],
    confidence: float,
) -> tuple[int, int, int, int]:
    normalized_text = _normalize_for_matching(text)
    condition_score = 88
    criticality_score = {
        "routeur": 48,
        "switch": 46,
        "borne_wifi": 42,
        "antenne": 44,
        "modem": 38,
        "smartphone": 28,
        "sim": 18,
    }.get(equipment_type or "", 24)
    obsolescence_score = 18
    maintenance_score = 20

    if any("batterie gonflee" in issue.lower() for issue in issues):
        condition_score -= 42
        criticality_score += 32
        maintenance_score += 34
    if any("ecran casse" in issue.lower() for issue in issues):
        condition_score -= 28
        criticality_score += 20
        maintenance_score += 18
    if any("surchauffe" in issue.lower() for issue in issues):
        condition_score -= 24
        criticality_score += 26
        maintenance_score += 24
    if any("etat physique suspect" in issue.lower() or "endommage" in issue.lower() for issue in issues):
        condition_score -= 18
        criticality_score += 14
        maintenance_score += 12
    if any("obsolete" in issue.lower() or "ancien" in issue.lower() for issue in issues):
        obsolescence_score += 42
        maintenance_score += 10
    if any("anomalie reseau" in issue.lower() for issue in issues):
        criticality_score += 18
        maintenance_score += 16

    year_match = re.search(r"\b(20\d{2})\b", normalized_text)
    if year_match:
        try:
            year_value = int(year_match.group(1))
        except ValueError:
            year_value = 0
        if year_value and year_value <= 2019:
            obsolescence_score += 20

    if any(keyword in normalized_text for keyword in ("3g", "adsl", "legacy", "obsolete")):
        obsolescence_score += 18
    if confidence < 0.6:
        condition_score -= 6
        maintenance_score += 6

    return (
        max(0, min(condition_score, 100)),
        max(0, min(criticality_score, 100)),
        max(0, min(obsolescence_score, 100)),
        max(0, min(maintenance_score, 100)),
    )


def _build_equipment_maintenance_recommendations(
    *,
    issues: list[str],
    equipment_type: str | None,
    replacement_needed: bool,
) -> list[str]:
    recommendations: list[str] = []
    normalized_issue_text = _normalize_for_matching(" ".join(issues))

    if "batterie gonflee" in normalized_issue_text:
        recommendations.append("Isoler l'appareil et remplacer la batterie sans delai.")
    if "ecran casse" in normalized_issue_text:
        recommendations.append("Planifier la reparation de l'ecran ou le remplacement du terminal.")
    if "surchauffe" in normalized_issue_text:
        recommendations.append("Couper l'alimentation et verifier ventilation, chargeur et temperature.")
    if "anomalie reseau" in normalized_issue_text:
        recommendations.append("Verifier les voyants, ports et la compatibilite reseau de l'equipement.")
    if replacement_needed:
        recommendations.append("Evaluer un remplacement rapide pour limiter le risque operationnel.")
    elif equipment_type in {"routeur", "modem", "switch", "borne_wifi"}:
        recommendations.append("Planifier un controle preventif des ports, de l'alimentation et du firmware.")
    elif equipment_type == "smartphone":
        recommendations.append("Verifier batterie, mise a jour OS et coque de protection du terminal.")
    else:
        recommendations.append("Realiser un controle physique et documentaire de l'equipement.")

    return _dedupe_non_empty(recommendations, 5)


def _extract_equipment_details(
    *,
    lines: list[str],
    text: str,
    operators: list[str],
    confidence: float,
) -> EquipmentDocumentDetails | None:
    if not _is_equipment_candidate(lines, text):
        return None

    equipment_type = _detect_equipment_type(text) or "appareil_inconnu"
    brand = _detect_equipment_brand(text)
    model = _extract_equipment_model(lines, text, brand)
    serial_number = _extract_equipment_serial(text)
    device_version = _extract_equipment_version(lines, text)
    sim_information = _extract_sim_information(lines, text)
    label_information = _extract_equipment_label_information(lines, brand, model)
    issues = _extract_equipment_issues(
        text=text,
        brand=brand,
        model=model,
        serial_number=serial_number,
    )
    visible_condition = _build_equipment_visible_condition(issues)
    condition_score, criticality_score, obsolescence_score, maintenance_score = _build_equipment_scores(
        equipment_type=equipment_type,
        text=text,
        issues=issues,
        confidence=confidence,
    )
    replacement_needed = (
        condition_score <= 45
        or criticality_score >= 80
        or obsolescence_score >= 75
        or any("batterie gonflee" in issue.lower() for issue in issues)
    )
    maintenance_recommendations = _build_equipment_maintenance_recommendations(
        issues=issues,
        equipment_type=equipment_type,
        replacement_needed=replacement_needed,
    )
    usage_summary = _build_equipment_usage_summary(equipment_type)

    return EquipmentDocumentDetails(
        equipment_type=equipment_type,
        brand=brand,
        model=model,
        serial_number=serial_number,
        operator=operators[0] if operators else None,
        visible_condition=visible_condition,
        device_version=device_version,
        sim_information=sim_information,
        label_information=label_information,
        usage_summary=usage_summary,
        detected_issues=issues,
        maintenance_recommendations=maintenance_recommendations,
        replacement_needed=replacement_needed,
        condition_score=condition_score,
        criticality_score=criticality_score,
        obsolescence_score=obsolescence_score,
        maintenance_score=maintenance_score,
        summary=(
            f"Equipement {equipment_type}, etat {visible_condition}, "
            f"criticite {criticality_score}/100, obsolescence {obsolescence_score}/100."
        ),
    )


def _candidate_quality(candidate: RawOcrCandidate | None) -> float:
    if candidate is None:
        return -1.0
    return (
        candidate.confidence * 45
        + min(len(candidate.lines), 24) * 1.5
        + min(sum(len(line) for line in candidate.lines), 400) / 22
    )


def _decode_image_for_ocr(image_bytes: bytes):
    if cv2 is None or np is None:
        return None
    image_array = np.frombuffer(image_bytes, dtype=np.uint8)
    if image_array.size == 0:
        return None
    return cv2.imdecode(image_array, cv2.IMREAD_COLOR)


def _build_ocr_variants(image_bytes: bytes) -> list[tuple[str, object]]:
    decoded = _decode_image_for_ocr(image_bytes)
    if decoded is None or cv2 is None:
        return [("original", image_bytes)]

    variants: list[tuple[str, object]] = [("original", decoded)]
    grayscale = cv2.cvtColor(decoded, cv2.COLOR_BGR2GRAY)
    variants.append(("grayscale", grayscale))

    clahe = cv2.createCLAHE(clipLimit=2.8, tileGridSize=(8, 8))
    contrasted = clahe.apply(grayscale)
    sharpen_kernel = np.array([[0, -1, 0], [-1, 5.4, -1], [0, -1, 0]], dtype=np.float32)
    sharpened = cv2.filter2D(contrasted, -1, sharpen_kernel)
    variants.append(("sharpened", sharpened))

    thresholded = cv2.adaptiveThreshold(
        sharpened,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        31,
        12,
    )
    variants.append(("thresholded", thresholded))

    height, width = thresholded.shape[:2]
    if max(height, width) < 2200:
        upscaled = cv2.resize(
            thresholded,
            (max(1, width * 2), max(1, height * 2)),
            interpolation=cv2.INTER_CUBIC,
        )
        variants.append(("thresholded_x2", upscaled))

    return variants


def _encode_cv_variant(image) -> bytes | None:
    if cv2 is None:
        return None
    success, encoded = cv2.imencode(".png", image)
    if not success:
        return None
    return encoded.tobytes()


def _prepare_dashboard_card_for_ocr(image):
    if cv2 is None or np is None:
        return image
    height, width = image.shape[:2]
    upscaled = cv2.resize(
        image,
        (max(1, width * 2), max(1, height * 2)),
        interpolation=cv2.INTER_CUBIC,
    )
    grayscale = cv2.cvtColor(upscaled, cv2.COLOR_BGR2GRAY)
    denoised = cv2.fastNlMeansDenoising(grayscale, None, 10, 7, 21)
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    contrasted = clahe.apply(denoised)
    sharpen_kernel = np.array([[0, -1, 0], [-1, 5.6, -1], [0, -1, 0]], dtype=np.float32)
    sharpened = cv2.filter2D(contrasted, -1, sharpen_kernel)
    return cv2.adaptiveThreshold(
        sharpened,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        31,
        10,
    )


def _extract_dashboard_card_boxes(decoded_image) -> list[tuple[int, int, int, int]]:
    if cv2 is None or np is None or decoded_image is None:
        return []

    height, width = decoded_image.shape[:2]
    if height <= 0 or width <= 0:
        return []

    focus_height = max(1, min(height, int(height * 0.44)))
    focus_region = decoded_image[:focus_height, :]
    grayscale = cv2.cvtColor(focus_region, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(grayscale, (5, 5), 0)
    thresholded = cv2.adaptiveThreshold(
        blurred,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        31,
        8,
    )
    kernel = np.ones((5, 5), dtype=np.uint8)
    closed = cv2.morphologyEx(thresholded, cv2.MORPH_CLOSE, kernel, iterations=2)
    contours, _hierarchy = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    boxes: list[tuple[int, int, int, int]] = []
    min_area = max(6000, int(width * focus_height * 0.01))
    for contour in contours:
        x, y, box_width, box_height = cv2.boundingRect(contour)
        area = box_width * box_height
        aspect_ratio = box_width / max(box_height, 1)
        if area < min_area:
            continue
        if box_width < int(width * 0.12) or box_width > int(width * 0.6):
            continue
        if box_height < int(focus_height * 0.08) or box_height > int(focus_height * 0.42):
            continue
        if not 1.1 <= aspect_ratio <= 8.5:
            continue
        margin_x = max(8, int(box_width * 0.04))
        margin_y = max(8, int(box_height * 0.08))
        x0 = max(0, x - margin_x)
        y0 = max(0, y - margin_y)
        x1 = min(width, x + box_width + margin_x)
        y1 = min(focus_height, y + box_height + margin_y)
        boxes.append((x0, y0, x1, y1))

    boxes.sort(key=lambda item: (item[1], item[0]))
    deduped_boxes: list[tuple[int, int, int, int]] = []
    for box in boxes:
        x0, y0, x1, y1 = box
        overlaps_existing = False
        for existing in deduped_boxes:
            ex0, ey0, ex1, ey1 = existing
            overlap_width = max(0, min(x1, ex1) - max(x0, ex0))
            overlap_height = max(0, min(y1, ey1) - max(y0, ey0))
            overlap_area = overlap_width * overlap_height
            box_area = max(1, (x1 - x0) * (y1 - y0))
            if overlap_area / box_area >= 0.6:
                overlaps_existing = True
                break
        if not overlaps_existing:
            deduped_boxes.append(box)

    if len(deduped_boxes) >= 3:
        return deduped_boxes[:8]

    fallback_boxes: list[tuple[int, int, int, int]] = []
    columns = 4 if width >= 1400 else 3 if width >= 960 else 2
    rows = 2
    cell_width = width // columns
    cell_height = max(1, focus_height // rows)
    for row in range(rows):
        for column in range(columns):
            x0 = column * cell_width
            x1 = width if column == columns - 1 else (column + 1) * cell_width
            y0 = row * cell_height
            y1 = focus_height if row == rows - 1 else (row + 1) * cell_height
            fallback_boxes.append((x0, y0, x1, y1))
    return fallback_boxes[:8]


def _extract_dashboard_card_lines(image_bytes: bytes, reader) -> tuple[list[str], list[str]]:
    if cv2 is None or np is None:
        return ([], [])
    decoded = _decode_image_for_ocr(image_bytes)
    if decoded is None:
        return ([], [])

    boxes = _extract_dashboard_card_boxes(decoded)
    if not boxes:
        return ([], [])

    extracted_lines: list[str] = []
    extracted_kpis: list[str] = []
    successful_cards = 0
    for card_index, (x0, y0, x1, y1) in enumerate(boxes):
        card_image = decoded[y0:y1, x0:x1]
        if card_image.size == 0:
            continue
        prepared_card = _prepare_dashboard_card_for_ocr(card_image)
        encoded_card = _encode_cv_variant(prepared_card)
        if encoded_card is None:
            continue
        variants = _build_ocr_variants(encoded_card)
        easy_candidate = _extract_with_easyocr(reader, variants) if reader is not None else None
        tesseract_candidate = _extract_with_tesseract(variants)
        candidate = _select_best_ocr_candidate(easy_candidate, tesseract_candidate)
        if candidate is None or not candidate.lines:
            continue
        successful_cards += 1
        card_lines = _dedupe_non_empty(candidate.lines, 12)
        card_kpis = _detect_kpis(card_lines)
        extracted_lines.extend(card_lines)
        extracted_kpis.extend(card_kpis)
        OCR_LOGGER.info(
            "event=dashboard_card_ocr_completed card_index=%s lines=%s kpis=%s",
            card_index,
            len(card_lines),
            len(card_kpis),
        )

    OCR_LOGGER.info(
        "event=dashboard_card_ocr_summary detected_cards=%s extracted_lines=%s extracted_kpis=%s",
        successful_cards,
        len(extracted_lines),
        len(extracted_kpis),
    )
    return (_dedupe_non_empty(extracted_lines, 80), _dedupe_non_empty(extracted_kpis, 24))


def _normalize_easyocr_results(raw_results: list[object]) -> RawOcrCandidate:
    lines: list[str] = []
    text_regions: list[OcrTextRegion] = []
    confidence_scores: list[float] = []

    for raw_result in raw_results:
        if not isinstance(raw_result, (list, tuple)) or len(raw_result) < 3:
            continue
        raw_points, raw_text, raw_confidence = raw_result[:3]
        cleaned_text = " ".join(str(raw_text).split()).strip()
        if not cleaned_text:
            continue
        lines.append(cleaned_text)
        try:
            region_confidence = float(raw_confidence)
        except (TypeError, ValueError):
            region_confidence = 0.0
        confidence_scores.append(max(0.0, min(region_confidence, 1.0)))

        region_bbox = _bbox_from_points(raw_points)
        if region_bbox is not None:
            text_regions.append(
                OcrTextRegion(
                    text=cleaned_text,
                    bbox=region_bbox,
                    confidence=max(0.0, min(region_confidence, 1.0)),
                )
            )

    confidence = sum(confidence_scores) / len(confidence_scores) if confidence_scores else 0.0
    return RawOcrCandidate(
        engine="easyocr",
        lines=lines,
        text_regions=text_regions,
        confidence=confidence,
    )


def _extract_with_easyocr(reader, variants: list[tuple[str, object]]) -> RawOcrCandidate | None:
    best_candidate: RawOcrCandidate | None = None
    for variant_name, variant in variants:
        try:
            raw_results = reader.readtext(variant, detail=1, paragraph=False)
        except Exception:  # pragma: no cover - runtime path
            OCR_LOGGER.debug("event=easyocr_variant_failed variant=%s", variant_name, exc_info=True)
            continue
        candidate = _normalize_easyocr_results(raw_results)
        if _candidate_quality(candidate) > _candidate_quality(best_candidate):
            best_candidate = candidate
    return best_candidate


def _extract_with_tesseract(variants: list[tuple[str, object]]) -> RawOcrCandidate | None:
    if not _is_tesseract_runtime_available():
        return None

    best_candidate: RawOcrCandidate | None = None
    for variant_name, variant in variants:
        if cv2 is None or np is None:
            continue
        if isinstance(variant, bytes):
            decoded = _decode_image_for_ocr(variant)
            if decoded is None:
                continue
            image_for_tesseract = decoded
        else:
            image_for_tesseract = variant

        try:  # pragma: no cover - runtime path
            raw_data = pytesseract.image_to_data(
                image_for_tesseract,
                output_type=pytesseract.Output.DICT,
                config="--oem 3 --psm 6",
            )
        except Exception:
            OCR_LOGGER.debug("event=tesseract_variant_failed variant=%s", variant_name, exc_info=True)
            continue

        word_count = len(raw_data.get("text", []))
        grouped_lines: dict[tuple[int, int, int], list[tuple[int, str, OcrTextRegion]]] = {}
        confidence_scores: list[float] = []
        for index in range(word_count):
            raw_text = str(raw_data["text"][index] or "")
            cleaned_text = " ".join(raw_text.split()).strip()
            if not cleaned_text:
                continue
            try:
                raw_confidence = float(raw_data["conf"][index])
            except (TypeError, ValueError):
                raw_confidence = -1.0
            if raw_confidence < 0:
                continue
            normalized_confidence = max(0.0, min(raw_confidence / 100.0, 1.0))
            confidence_scores.append(normalized_confidence)
            try:
                left = max(0, int(raw_data["left"][index]))
                top = max(0, int(raw_data["top"][index]))
                width = max(0, int(raw_data["width"][index]))
                height = max(0, int(raw_data["height"][index]))
            except (TypeError, ValueError):
                continue
            region = OcrTextRegion(
                text=cleaned_text,
                bbox=(left, top, width, height),
                confidence=normalized_confidence,
            )
            line_key = (
                int(raw_data.get("block_num", [0])[index] or 0),
                int(raw_data.get("par_num", [0])[index] or 0),
                int(raw_data.get("line_num", [0])[index] or 0),
            )
            grouped_lines.setdefault(line_key, []).append((left, cleaned_text, region))

        ordered_line_keys = sorted(
            grouped_lines,
            key=lambda item: (
                min(region.bbox[1] for _left, _text, region in grouped_lines[item]),
                item[0],
                item[1],
                item[2],
            ),
        )
        lines: list[str] = []
        text_regions: list[OcrTextRegion] = []
        for line_key in ordered_line_keys:
            grouped_words = sorted(grouped_lines[line_key], key=lambda item: item[0])
            line_text = " ".join(text for _left, text, _region in grouped_words).strip()
            if line_text:
                lines.append(line_text)
            text_regions.extend(region for _left, _text, region in grouped_words)

        candidate = RawOcrCandidate(
            engine="tesseract",
            lines=lines,
            text_regions=text_regions,
            confidence=(
                sum(confidence_scores) / len(confidence_scores) if confidence_scores else 0.0
            ),
        )
        if _candidate_quality(candidate) > _candidate_quality(best_candidate):
            best_candidate = candidate

    return best_candidate


def _select_best_ocr_candidate(
    easy_candidate: RawOcrCandidate | None,
    tesseract_candidate: RawOcrCandidate | None,
) -> RawOcrCandidate | None:
    if easy_candidate is None:
        return tesseract_candidate
    if tesseract_candidate is None:
        return easy_candidate

    easy_quality = _candidate_quality(easy_candidate)
    tesseract_quality = _candidate_quality(tesseract_candidate)
    if tesseract_quality > easy_quality + 6:
        return tesseract_candidate
    return easy_candidate


def extract_image_ocr(image_bytes: bytes) -> OcrExtractionResult:
    reader = _get_reader()
    if reader is None and not _is_tesseract_runtime_available():  # pragma: no cover - optional runtime dependency
        OCR_LOGGER.warning("event=ocr_fallback reason=%s", "easyocr_and_tesseract_unavailable")
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
            status="unavailable",
            error_message="Lecture documentaire locale indisponible sur l'image.",
        )

    variants = _build_ocr_variants(image_bytes)
    easy_candidate = _extract_with_easyocr(reader, variants) if reader is not None else None
    tesseract_candidate = None
    easy_quality = _candidate_quality(easy_candidate)
    if easy_candidate is None or easy_quality < 18:
        tesseract_candidate = _extract_with_tesseract(variants)
    best_candidate = _select_best_ocr_candidate(easy_candidate, tesseract_candidate)

    if best_candidate is None or not best_candidate.lines:
        OCR_LOGGER.warning("event=ocr_failed reason=%s", "no_candidate")
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
            status="failed",
            error_message="Lecture documentaire locale indisponible sur l'image.",
        )

    lines = _dedupe_non_empty(best_candidate.lines, 200)
    dashboard_card_lines, dashboard_card_kpis = _extract_dashboard_card_lines(image_bytes, reader)
    if dashboard_card_lines:
        lines = _dedupe_non_empty([*lines, *dashboard_card_lines], 240)
    text_regions = best_candidate.text_regions
    full_text = "\n".join(lines)
    operators = _detect_operators(full_text)
    amounts_mad = _extract_unique_matches(
        r"\b\d{1,3}(?:[ .]\d{3})*(?:[.,]\d+)?\s*(?:MAD|DHS|DH)\b",
        full_text,
    )
    departments = _detect_departments(full_text)
    confidence = max(0.0, min(best_candidate.confidence, 1.0))
    invoice_details = _extract_invoice_details(lines, full_text, operators, confidence)
    incident_details = _extract_incident_details(lines, full_text, operators, confidence)
    workflow_details = _extract_workflow_details(
        lines=lines,
        text=full_text,
        text_regions=text_regions,
        departments=departments,
        confidence=confidence,
    )
    equipment_details = _extract_equipment_details(
        lines=lines,
        text=full_text,
        operators=operators,
        confidence=confidence,
    )
    ui_details = _extract_ui_details(
        lines=lines,
        text=full_text,
        visible_tables=_detect_visible_tables(lines),
        kpis=_detect_kpis(lines),
        confidence=confidence,
    )
    visible_tables = _detect_visible_tables(lines)
    detected_kpis = _dedupe_non_empty([*_detect_kpis(lines), *dashboard_card_kpis], 24)
    confidence = _calibrate_ocr_confidence(
        raw_confidence=best_candidate.confidence,
        text=full_text,
        lines=lines,
        detected_kpis=detected_kpis,
        amounts_mad=amounts_mad,
    )
    invoice_details = _extract_invoice_details(lines, full_text, operators, confidence)
    incident_details = _extract_incident_details(lines, full_text, operators, confidence)
    workflow_details = _extract_workflow_details(
        lines=lines,
        text=full_text,
        text_regions=text_regions,
        departments=departments,
        confidence=confidence,
    )
    equipment_details = _extract_equipment_details(
        lines=lines,
        text=full_text,
        operators=operators,
        confidence=confidence,
    )
    ui_details = _extract_ui_details(
        lines=lines,
        text=full_text,
        visible_tables=visible_tables,
        kpis=detected_kpis,
        confidence=confidence,
    )

    return OcrExtractionResult(
        text=full_text,
        lines=lines,
        text_regions=text_regions,
        amounts_mad=amounts_mad[:12],
        operators=operators,
        departments=departments,
        alerts=_detect_alert_lines(lines),
        kpis=detected_kpis,
        visible_tables=visible_tables,
        confidence=max(0.0, min(confidence, 1.0)),
        invoice_details=invoice_details,
        incident_details=incident_details,
        workflow_details=workflow_details,
        equipment_details=equipment_details,
        ui_details=ui_details,
        status="ok",
        error_message=(
            "Le texte exploitable reste trop limite pour consolider davantage de KPI documentaires."
            if not detected_kpis and not amounts_mad and confidence < 0.18 and len(lines) < 3
            else None
        ),
    )
