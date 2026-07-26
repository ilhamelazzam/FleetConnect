import asyncio
from dataclasses import replace
from io import BytesIO
import json
import logging

from openpyxl import Workbook
from PIL import Image, ImageDraw
import pytest
from sqlalchemy.orm import Session

from app.services import chat_service
from app.services.document_chat_service import generate_document_chat_response
from app.services.image_annotation_service import ImageAnnotation, ImageAnnotationResult
from app.services.image_preprocessing_service import PreparedImage, PreparedImageChunk
from app.services.multimodal_chat_service import (
    GENERIC_VISIBLE_NETWORK_ANTENNAS_LABEL,
    GENERIC_VISIBLE_NETWORK_CHASSIS_LABEL,
    GENERIC_VISIBLE_NETWORK_PORTS_LABEL,
    GENERIC_VISIBLE_MOBILE_CONNECTIVITY_CHASSIS_LABEL,
    GENERIC_VISIBLE_USB_MODEM_LABEL,
    GENERIC_VISIBLE_WIFI_ROUTER_LABEL,
    QUESTION_TYPE_EQUIPMENT_DETECTION,
    EquipmentVisualInventoryItem,
    FinalImageAnswer,
    _build_network_equipment_fallback_objects,
    _detect_image_question_type,
    _resolve_image_vision_prompt_profile_override,
    _build_alert_intelligence,
    _reclassify_network_device,
    _sanitize_network_equipment_objects,
    sanitize_equipment_detected_objects,
    PdfExtractionResult,
    analyze_alert_dashboard_context,
    extract_alert_dashboard_kpis,
    generate_image_chat_response,
    generate_pdf_chat_response,
)
from app.services.recommendation_engine_service import DecisionRecommendation, RecommendationEngineResult
from app.services.ocr_service import (
    EquipmentDocumentDetails,
    IncidentDocumentDetails,
    InvoiceDocumentDetails,
    OcrExtractionResult,
    OcrTextRegion,
    WorkflowDocumentDetails,
    _calibrate_ocr_confidence,
    _detect_kpis,
)
from app.services.chat_service import (
    ChatTimeoutError,
    DEFAULT_UNAVAILABLE_MESSAGE,
    DataSummary,
    ImageAnalysisTimeoutError,
    LocalModelUnavailableError,
    SummaryCriticalLine,
    SummaryMetric,
    SummaryPlan,
    VisionUnavailableError,
    _answer_from_data_summary,
    _build_timeout_fallback_answer,
    generate_chat_response,
    stream_chat_response,
)
from app.services.chat_reasoning_service import BusinessReasoningResult
from app.services.vision_service import (
    VisionAnalysisResult,
    VisionRadarAxis,
    _build_vision_prompt,
    analyze_image_with_llava,
)


async def _collect_async_chunks(iterator) -> list[str]:
    chunks: list[str] = []
    async for chunk in iterator:
        chunks.append(chunk)
    return chunks


def build_summary() -> DataSummary:
    return DataSummary(
        prompt_context="Resume metier de test",
        sources=["fleet_ai_results_morocco.csv", "phone_lines"],
        updated_at="2026-05-05T15:47:00+00:00",
        signature="summary-signature-test",
        total_lines=12,
        active_lines=10,
        free_lines=2,
        assigned_lines=8,
        in_progress_lines=1,
        suspended_lines=1,
        inactive_lines=1,
        total_monthly_cost_mad=12500,
        projected_monthly_cost_mad=13900,
        alert_count=14,
        critical_alert_count=6,
        budget_alert_count=7,
        mobile_alert_count=3,
        mobile_device_total=18,
        mobile_critical_count=4,
        fraud_alert_count=4,
        total_call_count=86,
        suspicious_call_count=11,
        suspicious_call_cost_mad=3840.0,
        high_cost_call_count=6,
        over_quota_count=5,
        anomaly_count=2,
        roaming_line_count=3,
        roaming_alert_count=2,
        expensive_operators=[
            SummaryMetric(
                label="Maroc Telecom",
                monthly_cost_mad=5400,
                risk_score=74,
                alert_count=5,
            )
        ],
        risky_departments=[
            SummaryMetric(
                label="Finance",
                monthly_cost_mad=3600,
                risk_score=69,
                alert_count=4,
            )
        ],
        expensive_plans=[
            SummaryPlan(
                operator="Maroc Telecom",
                plan="Business XL",
                average_cost_mad=450,
                line_count=4,
                alert_count=3,
            )
        ],
        critical_lines=[
            SummaryCriticalLine(
                label="+212600000111",
                operator="Maroc Telecom",
                department="Finance",
                status="active",
                risk_score=82,
                usage_label="48.0/50.0 Go",
                monthly_cost_mad=450,
                action="Surveiller la consommation et ajuster le forfait si besoin.",
            )
        ],
        recommendations=["Migrer les lignes en depassement vers un forfait superieur"],
    )


@pytest.mark.parametrize(
    ("question", "expected"),
    [
        ("Identifie tous les equipements presents sur cette image", QUESTION_TYPE_EQUIPMENT_DETECTION),
        ("Detecte les objets visibles sur cette photo.", QUESTION_TYPE_EQUIPMENT_DETECTION),
        ("Que vois-tu sur cette image ?", QUESTION_TYPE_EQUIPMENT_DETECTION),
        ("Quels equipements sont visibles ?", QUESTION_TYPE_EQUIPMENT_DETECTION),
        ("Quel est l'équipement présent sur cette photo ?", QUESTION_TYPE_EQUIPMENT_DETECTION),
        ("Analyse cette image telecom.", QUESTION_TYPE_EQUIPMENT_DETECTION),
        ("Quel appareil est visible sur la photo ?", QUESTION_TYPE_EQUIPMENT_DETECTION),
        ("A quoi servent les differents equipements visibles ?", QUESTION_TYPE_EQUIPMENT_DETECTION),
        ("Decris le role de chaque equipement.", QUESTION_TYPE_EQUIPMENT_DETECTION),
        ("Explique l'utilisation de ce materiel.", QUESTION_TYPE_EQUIPMENT_DETECTION),
        ("Analyse le materiel present.", QUESTION_TYPE_EQUIPMENT_DETECTION),
    ],
)
def test_detect_image_question_type_flags_visual_equipment_detection(
    question: str,
    expected: str,
) -> None:
    assert _detect_image_question_type(question) == expected


def test_build_vision_prompt_for_physical_objects_uses_compact_visible_template() -> None:
    prompt = _build_vision_prompt(
        "Quels equipements sont visibles sur cette image de voiture ?",
        analysis_mode="advanced",
    )

    assert "Identify only the physical objects directly visible in this telecom image." in prompt
    assert "Never invent equipment." in prompt
    assert "Routeur Wi-Fi" in prompt
    assert "Modem USB" in prompt
    assert "Return JSON only:" in prompt
    assert '"detected_objects":[],"equipment_type":"inconnu","brand":"inconnu","confidence":0.0' in prompt
    assert "WIDGETS:" not in prompt
    assert "RADAR_AXES:" not in prompt
    assert len(prompt) < 550


def test_router_uses_physical_objects_profile() -> None:
    assert (
        _resolve_image_vision_prompt_profile_override(
            question="Quels equipements sont visibles ?",
            question_type=QUESTION_TYPE_EQUIPMENT_DETECTION,
            ocr_result=OcrExtractionResult(
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
                status="ok",
                error_message=None,
            ),
        )
        == "physical_objects"
    )


def test_equipment_uses_physical_objects_profile(
    monkeypatch,
    caplog,
) -> None:
    class DummyResponse:
        status_code = 200

        @staticmethod
        def json() -> dict[str, object]:
            return {
                "response": (
                    '{"detected_objects":["Modem USB apparent"],'
                    '"equipment_type":"Modem USB apparent",'
                    '"brand":"Huawei","confidence":0.94}'
                ),
                "eval_count": 22,
            }

    class DummySettings:
        ollama_base_url = "http://localhost:11434"
        ollama_vision_model = "llava"
        ollama_vision_timeout_seconds = 30
        ollama_vision_retry_count = 0

    monkeypatch.setattr(
        "app.services.vision_service.get_settings",
        lambda: DummySettings(),
    )
    monkeypatch.setattr(
        "app.services.vision_service._post_ollama_generate",
        lambda *args, **kwargs: DummyResponse(),
    )
    caplog.set_level(logging.INFO, logger="app.chat.vision")

    result = asyncio.run(
        analyze_image_with_llava(
            question="Quel est l'équipement présent sur cette photo ?",
            image_base64="huawei-usb-modem-base64",
            analysis_mode="advanced",
            question_type=QUESTION_TYPE_EQUIPMENT_DETECTION,
            image_type="equipement",
            vision_routing="EQUIPMENT",
        )
    )

    assert result.image_type == "equipement"
    assert result.primary_equipment == "Modem USB apparent"
    assert result.detected_objects == ["Modem USB apparent"]
    assert result.detected_brands == ["Huawei"]
    assert "VISION_PROFILE_SELECTED=physical_objects" in caplog.text
    assert "VISION_PROFILE_REASON=equipment_detection" in caplog.text
    assert "QUESTION_TYPE=EQUIPMENT_DETECTION" in caplog.text
    assert "IMAGE_TYPE=equipement" in caplog.text
    assert "VISION_ROUTING=EQUIPMENT" in caplog.text
    assert "VISION_PROFILE_SELECTED=business_visual" not in caplog.text


def test_router_reduces_num_predict(
    monkeypatch,
    caplog,
) -> None:
    class DummyResponse:
        status_code = 200

        @staticmethod
        def json() -> dict[str, object]:
            return {
                "response": '{"objects":["modern router"],"confidence":0.88}',
                "eval_count": 18,
            }

    class DummySettings:
        ollama_base_url = "http://localhost:11434"
        ollama_vision_model = "llava"
        ollama_vision_timeout_seconds = 30
        ollama_vision_retry_count = 0

    monkeypatch.setattr(
        "app.services.vision_service.get_settings",
        lambda: DummySettings(),
    )
    monkeypatch.setattr(
        "app.services.vision_service._post_ollama_generate",
        lambda *args, **kwargs: DummyResponse(),
    )
    caplog.set_level(logging.INFO, logger="app.chat.vision")

    asyncio.run(
        analyze_image_with_llava(
            question="Quels equipements sont visibles ?",
            image_base64="router-image-base64",
            analysis_mode="advanced",
        )
    )

    assert "VISION_NUM_PREDICT=32" in caplog.text


def test_router_does_not_use_business_visual(
    monkeypatch,
    caplog,
) -> None:
    class DummyResponse:
        status_code = 200

        @staticmethod
        def json() -> dict[str, object]:
            return {
                "response": '{"objects":["modern router"],"confidence":0.88}',
                "eval_count": 18,
            }

    class DummySettings:
        ollama_base_url = "http://localhost:11434"
        ollama_vision_model = "llava"
        ollama_vision_timeout_seconds = 30
        ollama_vision_retry_count = 0

    monkeypatch.setattr(
        "app.services.vision_service.get_settings",
        lambda: DummySettings(),
    )
    monkeypatch.setattr(
        "app.services.vision_service._post_ollama_generate",
        lambda *args, **kwargs: DummyResponse(),
    )
    caplog.set_level(logging.INFO, logger="app.chat.vision")

    asyncio.run(
        analyze_image_with_llava(
            question="Quels equipements sont visibles ?",
            image_base64="router-image-base64",
            analysis_mode="advanced",
        )
    )

    assert "VISION_PROFILE_SELECTED=physical_objects" in caplog.text
    assert "VISION_PROFILE_SELECTED=business_visual" not in caplog.text


@pytest.mark.parametrize(
    "question",
    [
        "Quel routeur est visible sur cette photo ?",
        "Quel modem USB est visible sur cette photo ?",
        "Quel smartphone est visible sur cette photo ?",
        "Quelle carte SIM est visible sur cette photo ?",
        "Quel switch est visible sur cette photo ?",
    ],
)
def test_equipment_categories_do_not_use_business_visual(
    monkeypatch,
    caplog,
    question: str,
) -> None:
    class DummyResponse:
        status_code = 200

        @staticmethod
        def json() -> dict[str, object]:
            return {
                "response": (
                    '{"detected_objects":["Objet non identifie avec certitude"],'
                    '"equipment_type":"Objet non identifie avec certitude",'
                    '"brand":"inconnu","confidence":0.61}'
                ),
                "eval_count": 17,
            }

    class DummySettings:
        ollama_base_url = "http://localhost:11434"
        ollama_vision_model = "llava"
        ollama_vision_timeout_seconds = 30
        ollama_vision_retry_count = 0

    monkeypatch.setattr(
        "app.services.vision_service.get_settings",
        lambda: DummySettings(),
    )
    monkeypatch.setattr(
        "app.services.vision_service._post_ollama_generate",
        lambda *args, **kwargs: DummyResponse(),
    )
    caplog.set_level(logging.INFO, logger="app.chat.vision")

    asyncio.run(
        analyze_image_with_llava(
            question=question,
            image_base64="equipment-base64",
            analysis_mode="advanced",
        )
    )

    assert "VISION_PROFILE_SELECTED=physical_objects" in caplog.text
    assert "VISION_PROFILE_SELECTED=business_visual" not in caplog.text


def test_analyze_image_with_llava_parses_router_visible_objects_from_raw_response(
    monkeypatch,
    caplog,
) -> None:
    class DummyResponse:
        status_code = 200

        @staticmethod
        def json() -> dict[str, object]:
            return {
                "response": (
                    '{"objects":["modern router","multiple antennas","Ethernet ports"],'
                    '"confidence":0.91}'
                ),
                "total_duration": 4_200_000_000,
                "load_duration": 900_000_000,
                "prompt_eval_duration": 700_000_000,
                "eval_duration": 2_100_000_000,
                "prompt_eval_count": 211,
                "eval_count": 46,
            }

    class DummySettings:
        ollama_base_url = "http://localhost:11434"
        ollama_vision_model = "llava"
        ollama_vision_timeout_seconds = 30
        ollama_vision_retry_count = 0

    monkeypatch.setattr(
        "app.services.vision_service.get_settings",
        lambda: DummySettings(),
    )
    monkeypatch.setattr(
        "app.services.vision_service._post_ollama_generate",
        lambda *args, **kwargs: DummyResponse(),
    )
    caplog.set_level(logging.INFO, logger="app.chat.vision")

    result = asyncio.run(
        analyze_image_with_llava(
            question="Quels equipements sont visibles ?",
            image_base64="router-image-base64",
            analysis_mode="advanced",
        )
    )

    assert result.image_type == "routeur_wifi"
    assert result.primary_equipment == "Routeur Wi-Fi apparent"
    assert result.detected_objects == [
        "Routeur Wi-Fi apparent",
        "Antennes reseau visibles",
        "Boitier reseau visible",
        "Voyants ou ports apparents",
    ]
    assert 'RAW_LLAVA_RESPONSE={"objects":["modern router","multiple antennas","Ethernet ports"],"confidence":0.91}' in caplog.text
    assert "VISION_PROFILE_SELECTED=physical_objects" in caplog.text
    assert "VISION_NUM_PREDICT=32" in caplog.text
    assert "VISION_PROMPT_CHARS=" in caplog.text
    assert "ROUTER_KEYWORDS_FOUND=['router']" in caplog.text
    assert "PORTS_KEYWORDS_FOUND=['ethernet port', 'ethernet ports']" in caplog.text
    assert "ANTENNA_KEYWORDS_FOUND=['multiple antennas', 'antennas', 'antenna']" in caplog.text
    assert "NETWORK_DEVICE_KEYWORDS_FOUND=[]" in caplog.text
    assert "VISION_REQUEST_DURATION_MS=" in caplog.text
    assert "VISION_GENERATION_DURATION_MS=2100" in caplog.text
    assert "VISION_TOTAL_DURATION_MS=" in caplog.text
    assert "event=vision_response_metrics" in caplog.text
    assert "prompt_eval_count=211" in caplog.text
    assert "eval_count=46" in caplog.text
    assert "PARSED_DETECTED_OBJECTS=['Routeur Wi-Fi apparent', 'Antennes reseau visibles', 'Boitier reseau visible', 'Voyants ou ports apparents']" in caplog.text
    assert "VISION_IMAGE_TYPE=routeur_wifi" in caplog.text
    assert "VISION_CONFIDENCE=0.91" in caplog.text


def test_analyze_image_with_llava_keeps_huawei_router_json_as_router_before_post_vision_reclassification(
    monkeypatch,
    caplog,
) -> None:
    class DummyResponse:
        status_code = 200

        @staticmethod
        def json() -> dict[str, object]:
            return {
                "response": (
                    '{"objects":[{"type":"router","brand":"Huawei"}],'
                    '"confidence":0.92}'
                ),
                "total_duration": 3_900_000_000,
                "load_duration": 850_000_000,
                "prompt_eval_duration": 640_000_000,
                "eval_duration": 2_000_000_000,
                "prompt_eval_count": 188,
                "eval_count": 42,
            }

    class DummySettings:
        ollama_base_url = "http://localhost:11434"
        ollama_vision_model = "llava"
        ollama_vision_timeout_seconds = 30
        ollama_vision_retry_count = 0

    monkeypatch.setattr(
        "app.services.vision_service.get_settings",
        lambda: DummySettings(),
    )
    monkeypatch.setattr(
        "app.services.vision_service._post_ollama_generate",
        lambda *args, **kwargs: DummyResponse(),
    )
    caplog.set_level(logging.INFO, logger="app.chat.vision")

    result = asyncio.run(
        analyze_image_with_llava(
            question="Quels equipements sont visibles ?",
            image_base64="huawei-router-like-image-base64",
            analysis_mode="advanced",
        )
    )

    assert result.image_type == "routeur_wifi"
    assert result.primary_equipment == "Routeur Wi-Fi apparent"
    assert result.detected_brands == ["Huawei"]
    assert result.detected_objects == [
        "Routeur Wi-Fi apparent",
        "Boitier reseau visible",
    ]
    assert "Modem USB apparent" not in result.detected_objects
    assert "PARSED_DETECTED_OBJECTS=['Routeur Wi-Fi apparent', 'Boitier reseau visible']" in caplog.text
    assert "VISION_IMAGE_TYPE=routeur_wifi" in caplog.text


def test_analyze_image_with_llava_parses_asus_router_with_visible_antennas_from_physical_objects_payload(
    monkeypatch,
    caplog,
) -> None:
    class DummyResponse:
        status_code = 200

        @staticmethod
        def json() -> dict[str, object]:
            return {
                "response": (
                    '{"detected_objects":["Routeur Wi-Fi apparent","Antennes reseau visibles"],'
                    '"equipment_type":"Routeur Wi-Fi apparent",'
                    '"brand":"ASUS","confidence":0.95}'
                ),
                "total_duration": 3_600_000_000,
                "load_duration": 800_000_000,
                "prompt_eval_duration": 610_000_000,
                "eval_duration": 1_900_000_000,
                "prompt_eval_count": 177,
                "eval_count": 39,
            }

    class DummySettings:
        ollama_base_url = "http://localhost:11434"
        ollama_vision_model = "llava"
        ollama_vision_timeout_seconds = 30
        ollama_vision_retry_count = 0

    monkeypatch.setattr(
        "app.services.vision_service.get_settings",
        lambda: DummySettings(),
    )
    monkeypatch.setattr(
        "app.services.vision_service._post_ollama_generate",
        lambda *args, **kwargs: DummyResponse(),
    )
    caplog.set_level(logging.INFO, logger="app.chat.vision")

    result = asyncio.run(
        analyze_image_with_llava(
            question="Quels equipements sont visibles ?",
            image_base64="asus-router-base64",
            analysis_mode="advanced",
            question_type=QUESTION_TYPE_EQUIPMENT_DETECTION,
            image_type="equipement",
            vision_routing="EQUIPMENT",
        )
    )

    assert result.image_type == "routeur_wifi"
    assert result.primary_equipment == "Routeur Wi-Fi apparent"
    assert result.detected_brands == ["ASUS"]
    assert "Routeur Wi-Fi apparent" in result.detected_objects
    assert "Antennes reseau visibles" in result.detected_objects
    assert "VISION_PROFILE_SELECTED=physical_objects" in caplog.text
    assert "VISION_IMAGE_TYPE=routeur_wifi" in caplog.text


def test_analyze_image_with_llava_keeps_mixed_equipment_detected_objects_when_router_is_not_alone(
    monkeypatch,
) -> None:
    class DummyResponse:
        status_code = 200

        @staticmethod
        def json() -> dict[str, object]:
            return {
                "response": (
                    "DETECTED_OBJECTS:\n"
                    "- Smartphone Samsung\n"
                    "- Routeur Huawei\n"
                    "- Carte SIM\n"
                )
            }

    class DummySettings:
        ollama_base_url = "http://localhost:11434"
        ollama_vision_model = "llava"
        ollama_vision_timeout_seconds = 30
        ollama_vision_retry_count = 0

    monkeypatch.setattr(
        "app.services.vision_service.get_settings",
        lambda: DummySettings(),
    )
    monkeypatch.setattr(
        "app.services.vision_service._post_ollama_generate",
        lambda *args, **kwargs: DummyResponse(),
    )

    result = asyncio.run(
        analyze_image_with_llava(
            question="Quels equipements sont visibles ?",
            image_base64="mixed-image-base64",
            analysis_mode="advanced",
        )
    )

    assert result.detected_objects == [
        "Smartphone Samsung",
        "Routeur Huawei",
        "Carte SIM",
    ]


def test_analyze_image_with_llava_parses_french_modem_routeur_network_response(
    monkeypatch,
    caplog,
) -> None:
    class DummyResponse:
        status_code = 200

        @staticmethod
        def json() -> dict[str, object]:
            return {
                "response": (
                    "L'image montre un equipement de reseau informatique, "
                    "probablement un modem-routeur, "
                    "avec des ports Ethernet sur la face avant."
                )
            }

    class DummySettings:
        ollama_base_url = "http://localhost:11434"
        ollama_vision_model = "llava"
        ollama_vision_timeout_seconds = 30
        ollama_vision_retry_count = 0

    monkeypatch.setattr(
        "app.services.vision_service.get_settings",
        lambda: DummySettings(),
    )
    monkeypatch.setattr(
        "app.services.vision_service._post_ollama_generate",
        lambda *args, **kwargs: DummyResponse(),
    )
    caplog.set_level(logging.INFO, logger="app.chat.vision")

    result = asyncio.run(
        analyze_image_with_llava(
            question="Quels equipements sont visibles ?",
            image_base64="router-image-fr-base64",
            analysis_mode="advanced",
        )
    )

    assert result.image_type == "routeur_wifi"
    assert result.detected_objects == [
        "Routeur Wi-Fi apparent",
        "Boitier reseau visible",
        "Voyants ou ports apparents",
    ]
    assert "ROUTER_KEYWORDS_FOUND=['routeur', 'modem routeur']" in caplog.text
    assert "PORTS_KEYWORDS_FOUND=['ports ethernet']" in caplog.text
    assert "NETWORK_DEVICE_KEYWORDS_FOUND=['equipement de reseau', 'equipement de reseau informatique']" in caplog.text
    assert "PARSED_DETECTED_OBJECTS=['Routeur Wi-Fi apparent', 'Boitier reseau visible', 'Voyants ou ports apparents']" in caplog.text


def _setup_equipment_photo_pipeline(
    monkeypatch,
    *,
    summary: DataSummary,
    llm_response: dict[str, object] | None = None,
    vision_result: VisionAnalysisResult | None = None,
) -> tuple[object, dict[str, str]]:
    class FakeRequest:
        async def is_disconnected(self) -> bool:
            return False

    captured_prompt: dict[str, str] = {}

    monkeypatch.setattr(
        "app.services.multimodal_chat_service.get_data_summary",
        lambda db: summary,
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.prepare_image_for_analysis",
        lambda image_bytes, filename, content_type: PreparedImage(
            original_bytes=image_bytes,
            processed_bytes=b"processed-equipment-photo",
            media_type="image/png",
            width=1280,
            height=860,
        ),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.extract_image_ocr",
        lambda image_bytes: OcrExtractionResult(
            text="",
            lines=[],
            text_regions=[],
            amounts_mad=[],
            operators=[],
            departments=[],
            alerts=[],
            kpis=[],
            visible_tables=[],
            confidence=0.22,
            invoice_details=None,
            incident_details=None,
            workflow_details=None,
            equipment_details=None,
            ui_details=None,
            status="ok",
            error_message=None,
        ),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.analyze_image_with_llava",
        lambda **kwargs: asyncio.sleep(
            0,
            result=vision_result
            or VisionAnalysisResult(
                image_type="equipement",
                analysis=(
                    "Photo d'equipements telecom avec un smartphone Samsung, "
                    "un routeur Huawei, un modem USB 4G LTE et plusieurs cartes SIM."
                ),
                detected_kpis=["Equipements detectes 6", "Etat apparent fonctionnel"],
                recommendations=[
                    "Verifier l'anciennete du modem USB.",
                    "Controler la consommation et l'affectation des cartes SIM visibles.",
                    "Evaluer un remplacement par un routeur 5G si la charge ou la couverture l'exige.",
                ],
                confidence=0.93,
                model="llava",
                detected_objects=[
                    "Smartphone Samsung",
                    "Routeur Huawei 4G/5G",
                    "Modem USB 4G LTE",
                    "Carte SIM Maroc Telecom",
                    "Carte SIM Inwi",
                    "Nano SIM",
                ],
                detected_brands=["Samsung", "Huawei"],
                detected_operators=["Maroc Telecom", "Inwi"],
                sim_types=["Nano SIM"],
                primary_equipment="Routeur Huawei 4G/5G",
                apparent_condition="fonctionnel",
                probable_usage="Connectivite mobile et Internet d'entreprise",
                replacement_signals=[],
                raw_output=(
                    "TYPE_IMAGE: equipement\n"
                    "DETECTED_OBJECTS:\n"
                    "- Smartphone Samsung\n"
                    "- Routeur Huawei 4G/5G\n"
                    "- Modem USB 4G LTE\n"
                    "- Carte SIM Maroc Telecom\n"
                    "- Carte SIM Inwi\n"
                    "- Nano SIM\n"
                    "PRIMARY_EQUIPMENT: Routeur Huawei 4G/5G\n"
                    "APPARENT_CONDITION: fonctionnel\n"
                    "PROBABLE_USAGE: Connectivite mobile et Internet d'entreprise\n"
                ),
            ),
        ),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.build_image_annotations",
        lambda *args, **kwargs: ImageAnnotationResult(
            highlighted_image=None,
            annotations=[],
        ),
    )

    async def fake_generate_with_ollama(prompt: str, timeout_seconds: int | None = None) -> str:
        captured_prompt["prompt"] = prompt
        return json.dumps(
            llm_response
            or {
                "answer": "Les objets visibles confirment un petit parc telecom physique.",
                "detected_kpis": ["Equipements detectes 6"],
                "recommendations": [
                    "Verifier l'anciennete du modem USB.",
                    "Controler la consommation et l'affectation des cartes SIM visibles.",
                ],
                "confidence": 0.9,
            }
        )

    monkeypatch.setattr(
        "app.services.multimodal_chat_service._generate_with_ollama",
        fake_generate_with_ollama,
    )

    return FakeRequest(), captured_prompt


def _build_equipment_photo_ocr_result(
    text: str = (
        "Smartphone Samsung Routeur Huawei Modem USB 4G LTE Carte SIM Maroc Telecom Inwi Carte SIM Triple decoupe Nano SIM"
    ),
) -> OcrExtractionResult:
    return OcrExtractionResult(
        text=text,
        lines=text.split(),
        text_regions=[],
        amounts_mad=[],
        operators=[],
        departments=[],
        alerts=[],
        kpis=[],
        visible_tables=[],
        confidence=0.41,
        invoice_details=None,
        incident_details=None,
        workflow_details=None,
        equipment_details=None,
        ui_details=None,
        status="ok",
        error_message=None,
    )


def _build_router_only_vision_result(brand: str) -> VisionAnalysisResult:
    return VisionAnalysisResult(
        image_type="routeur_wifi",
        analysis=f"Le visuel montre un routeur {brand}.",
        detected_kpis=[],
        recommendations=[],
        confidence=0.92,
        model="llava",
        detected_objects=[
            GENERIC_VISIBLE_WIFI_ROUTER_LABEL,
            GENERIC_VISIBLE_NETWORK_CHASSIS_LABEL,
        ],
        detected_brands=[brand],
        detected_operators=[],
        sim_types=[],
        primary_equipment=GENERIC_VISIBLE_WIFI_ROUTER_LABEL,
        apparent_condition="fonctionnel",
        probable_usage="Connectivite reseau",
        replacement_signals=[],
        raw_output=(
            "TYPE_IMAGE: routeur_wifi\n"
            "DETECTED_OBJECTS:\n"
            f"- {GENERIC_VISIBLE_WIFI_ROUTER_LABEL}\n"
            f"- {GENERIC_VISIBLE_NETWORK_CHASSIS_LABEL}\n"
            f"BRANDS:\n- {brand}\n"
            f"PRIMARY_EQUIPMENT: {GENERIC_VISIBLE_WIFI_ROUTER_LABEL}\n"
            "APPARENT_CONDITION: fonctionnel\n"
            "PROBABLE_USAGE: Connectivite reseau\n"
        ),
    )


def _build_synthetic_vehicle_scene_bytes() -> bytes:
    image = Image.new("RGB", (640, 360), (220, 232, 244))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 250, 640, 360), fill=(118, 118, 124))
    draw.rectangle((135, 165, 500, 248), fill=(30, 110, 210), outline=(15, 15, 20), width=4)
    draw.polygon(
        [(210, 165), (275, 125), (390, 125), (445, 165)],
        fill=(35, 118, 220),
        outline=(15, 15, 20),
    )
    draw.rectangle((245, 135, 310, 164), fill=(175, 215, 245))
    draw.rectangle((320, 135, 380, 164), fill=(175, 215, 245))
    draw.ellipse((180, 220, 260, 300), fill=(20, 20, 20), outline=(70, 70, 78), width=6)
    draw.ellipse((370, 220, 450, 300), fill=(20, 20, 20), outline=(70, 70, 78), width=6)
    draw.rectangle((20, 120, 115, 250), fill=(205, 205, 210))
    draw.rectangle((525, 100, 620, 240), fill=(212, 212, 216))
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _build_synthetic_router_scene_bytes() -> bytes:
    image = Image.new("RGB", (640, 360), (234, 223, 208))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((150, 135, 495, 255), radius=18, fill=(48, 54, 66), outline=(24, 28, 38), width=4)
    draw.rectangle((205, 55, 220, 135), fill=(36, 40, 48))
    draw.rectangle((420, 48, 435, 135), fill=(36, 40, 48))
    draw.rectangle((160, 146, 485, 170), fill=(66, 74, 88))
    for x0 in (215, 255, 295, 335, 375):
        draw.ellipse((x0, 210, x0 + 11, 221), fill=(112, 255, 158))
    for x0 in (395, 420, 445):
        draw.rectangle((x0, 222, x0 + 14, 232), fill=(12, 16, 20))
    draw.rectangle((0, 280, 640, 360), fill=(178, 158, 136))
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _build_synthetic_router_without_antennas_scene_bytes() -> bytes:
    image = Image.new("RGB", (640, 360), (234, 223, 208))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((150, 135, 495, 255), radius=18, fill=(48, 54, 66), outline=(24, 28, 38), width=4)
    draw.rectangle((160, 146, 485, 170), fill=(66, 74, 88))
    for x0 in (215, 255, 295, 335, 375):
        draw.ellipse((x0, 210, x0 + 11, 221), fill=(112, 255, 158))
    for x0 in (395, 420, 445):
        draw.rectangle((x0, 222, x0 + 14, 232), fill=(12, 16, 20))
    draw.rectangle((0, 280, 640, 360), fill=(178, 158, 136))
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _build_synthetic_usb_modem_scene_bytes() -> bytes:
    image = Image.new("RGB", (640, 360), (242, 236, 228))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((278, 92, 362, 304), radius=14, fill=(58, 64, 78), outline=(24, 28, 34), width=4)
    draw.rectangle((300, 52, 340, 92), fill=(198, 202, 208), outline=(122, 126, 132), width=2)
    draw.rectangle((294, 170, 346, 188), fill=(86, 92, 108))
    draw.ellipse((308, 266, 332, 278), fill=(108, 225, 152))
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _build_synthetic_vertical_usb_modem_scene_bytes() -> bytes:
    image = Image.new("RGB", (360, 700), (242, 236, 228))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((136, 170, 224, 510), radius=18, fill=(58, 64, 78), outline=(24, 28, 34), width=4)
    draw.rectangle((153, 118, 207, 170), fill=(198, 202, 208), outline=(122, 126, 132), width=2)
    draw.rectangle((145, 298, 215, 322), fill=(86, 92, 108))
    draw.ellipse((159, 455, 199, 475), fill=(108, 225, 152))
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _build_synthetic_unknown_scene_bytes() -> bytes:
    image = Image.new("RGB", (640, 360), (244, 244, 238))
    draw = ImageDraw.Draw(image)
    draw.rectangle((180, 80, 320, 230), fill=(162, 118, 92), outline=(80, 60, 45), width=4)
    draw.rectangle((330, 120, 420, 280), fill=(96, 146, 172), outline=(55, 72, 84), width=4)
    draw.rectangle((0, 300, 640, 360), fill=(232, 228, 220))
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def test_answer_from_data_summary_explains_important_alerts() -> None:
    summary = build_summary()

    answer = _answer_from_data_summary(
        "Donne une explication des alertes importantes",
        summary,
    )

    assert answer is not None
    assert "Alerte importante" in answer
    assert "14 alertes, dont 6 critiques" in answer
    assert "7 budget, 3 equipements, 4 fraude ou haut cout" in answer
    assert "Insight:" in answer
    assert "Recommandation:" in answer


def test_timeout_fallback_returns_partial_business_answer() -> None:
    summary = build_summary()

    answer = _build_timeout_fallback_answer("Quel est le churn actuel ?", summary)

    assert answer != DEFAULT_UNAVAILABLE_MESSAGE
    assert "Selon les donnees disponibles" in answer
    assert "Estimation basee" in answer
    assert "12 lignes" in answer
    assert "Insight:" in answer
    assert "Recommandation:" in answer


def test_answer_from_data_summary_adds_insight_and_recommendation_for_free_lines() -> None:
    summary = build_summary()

    answer = _answer_from_data_summary("Combien de lignes sont libres ?", summary)

    assert answer is not None
    assert "Lignes libres" in answer
    assert "2 lignes libres sur 12" in answer
    assert "Insight:" in answer
    assert "Recommandation:" in answer


def test_answer_from_data_summary_returns_fleet_health_score(monkeypatch) -> None:
    summary = build_summary()

    monkeypatch.setattr(
        "app.services.live_monitoring_service.get_live_monitoring_snapshot_if_ready",
        lambda: None,
    )

    answer = _answer_from_data_summary("Quel est l'etat global de ma flotte ?", summary)

    assert answer is not None
    assert "Fleet Health Score" in answer
    assert "risque global" in answer
    assert "Insight:" in answer
    assert "Recommandation:" in answer


def test_answer_from_data_summary_explains_how_to_improve_fleet_health_score(monkeypatch) -> None:
    summary = build_summary()

    monkeypatch.setattr(
        "app.services.live_monitoring_service.get_live_monitoring_snapshot_if_ready",
        lambda: None,
    )

    answer = _answer_from_data_summary("Comment ameliorer le Fleet Health Score ?", summary)

    assert answer is not None
    assert "Comment ameliorer le Fleet Health Score" in answer
    assert "Priorites:" in answer
    assert "Recommandation:" in answer


def test_answer_from_data_summary_returns_operational_copilot_plan(monkeypatch) -> None:
    summary = build_summary()

    monkeypatch.setattr(
        "app.services.chat_service._get_live_monitoring_snapshot_if_available",
        lambda: None,
    )

    answer = _answer_from_data_summary("Que dois-je faire cette semaine ?", summary)

    assert answer is not None
    assert "Plan d'action IA" in answer
    assert "Insight:" in answer
    assert "Recommandation:" in answer


def test_generate_copilot_action_plan_returns_weekly_actions(
    db_session: Session,
    monkeypatch,
) -> None:
    summary = build_summary()

    async def fake_generate_with_ollama(prompt: str) -> str:
        return json.dumps(
            {
                "subtitle": "Plan priorise pour la semaine.",
                "answer": "Cette semaine, traitez les depassements roaming puis la fraude.",
                "weekly_actions": [
                    {
                        "title": "Verifier les depassements roaming Finance",
                        "reason": "Le roaming Finance remonte dans les alertes disponibles.",
                        "impact": "Reduire les surcouts roaming.",
                        "detail": "Verifier les depassements roaming Finance et corriger les usages.",
                    }
                ],
                "recommendations": ["Traiter le roaming avant la renegociation des forfaits."],
            }
        )

    monkeypatch.setattr(chat_service, "get_data_summary", lambda db: summary)
    monkeypatch.setattr(chat_service, "_get_live_monitoring_snapshot_if_available", lambda: None)
    monkeypatch.setattr(chat_service, "_generate_with_ollama", fake_generate_with_ollama)

    response = asyncio.run(chat_service.generate_copilot_action_plan(db_session, history=[]))

    assert response["plan_title"] == "Plan d'action IA hebdomadaire"
    assert response["weekly_actions"]
    assert response["weekly_actions"][0]["title"] == "Verifier les depassements roaming Finance"
    assert response["weekly_actions"][0]["status"] == "todo"
    assert response["fallback_used"] is False


def test_generate_chat_response_replaces_unavailable_model_answer(
    db_session: Session,
    monkeypatch,
) -> None:
    summary = build_summary()
    chat_service._CHAT_ANSWER_CACHE.clear()

    async def fake_generate_with_ollama(prompt: str) -> str:
        return DEFAULT_UNAVAILABLE_MESSAGE

    monkeypatch.setattr(chat_service, "get_data_summary", lambda db: summary)
    monkeypatch.setattr(chat_service, "_get_reasoning_result", lambda db, question, history, summary: None)
    monkeypatch.setattr(chat_service, "_generate_with_ollama", fake_generate_with_ollama)

    response = asyncio.run(
        generate_chat_response(
            db_session,
            question="Quel est le churn actuel ?",
            history=[],
        )
    )

    assert response.answer != DEFAULT_UNAVAILABLE_MESSAGE
    assert "Selon les donnees disponibles" in response.answer
    assert "12 lignes" in response.answer


def test_generate_chat_response_returns_timeout_fallback(
    db_session: Session,
    monkeypatch,
) -> None:
    summary = build_summary()
    chat_service._CHAT_ANSWER_CACHE.clear()

    async def fake_generate_with_ollama(prompt: str) -> str:
        raise ChatTimeoutError()

    monkeypatch.setattr(chat_service, "get_data_summary", lambda db: summary)
    monkeypatch.setattr(chat_service, "_get_reasoning_result", lambda db, question, history, summary: None)
    monkeypatch.setattr(chat_service, "_generate_with_ollama", fake_generate_with_ollama)
    monkeypatch.setattr(chat_service, "_answer_from_data_summary", lambda question, summary: None)

    response = asyncio.run(
        generate_chat_response(
            db_session,
            question="Quelle est la tendance globale ?",
            history=[],
        )
    )

    assert response.fallback_used is True
    assert response.cached is False
    assert response.duration_ms is not None
    assert response.answer == _build_timeout_fallback_answer(
        "Quelle est la tendance globale ?",
        summary,
    )


def test_stream_chat_response_returns_timeout_fallback_done_event(
    db_session: Session,
    monkeypatch,
) -> None:
    summary = build_summary()
    chat_service._CHAT_ANSWER_CACHE.clear()

    class FakeRequest:
        async def is_disconnected(self) -> bool:
            return False

    async def fake_stream_with_ollama(prompt: str):
        if False:
            yield ""
        raise ChatTimeoutError()

    monkeypatch.setattr(chat_service, "get_data_summary", lambda db: summary)
    monkeypatch.setattr(chat_service, "_get_reasoning_result", lambda db, question, history, summary: None)
    monkeypatch.setattr(chat_service, "_answer_from_data_summary", lambda question, summary: None)
    monkeypatch.setattr(chat_service, "_build_prompt", lambda *args, **kwargs: "prompt")
    monkeypatch.setattr(chat_service, "_stream_with_ollama", fake_stream_with_ollama)

    chunks = asyncio.run(
        _collect_async_chunks(
            stream_chat_response(
                FakeRequest(),
                db_session,
                question="Quelle est la tendance globale ?",
                history=[],
            )
        )
    )
    payload = "".join(chunks)

    assert "event: done" in payload
    assert '"fallback_used": true' in payload
    assert "fallback_rapide" in payload


def test_generate_chat_response_uses_reasoning_answer_before_llm(
    db_session: Session,
    monkeypatch,
) -> None:
    summary = build_summary()
    chat_service._CHAT_ANSWER_CACHE.clear()

    async def fail_generate_with_ollama(prompt: str) -> str:
        raise AssertionError("LLM should not be called when reasoning is already validated.")

    reasoning_result = BusinessReasoningResult(
        answer=(
            "Comparaison departements - Finance vs IT\n"
            "- Finance: 3 600 MAD | risque 69/100 | 4 alertes\n"
            "- IT: 2 400 MAD | risque 44/100 | 2 alertes\n"
            "- Ecart budgetaire 1 200 MAD\n"
            "Analyse: Finance combine plus de cout et de criticite que IT.\n"
            "Recommandation: Traiter Finance avant de lisser le budget IT."
        ),
        primary_domain="budget",
        analysis_mode="comparison",
        selected_sources=["fleet_ai_results_morocco.csv", "phone_lines"],
        entities=["Finance", "IT"],
        needs_inference=False,
        validation_passed=True,
        confidence=0.91,
    )

    monkeypatch.setattr(chat_service, "get_data_summary", lambda db: summary)
    monkeypatch.setattr(chat_service, "_answer_from_data_summary", lambda question, summary: None)
    monkeypatch.setattr(
        chat_service,
        "_get_reasoning_result",
        lambda db, question, history, summary: reasoning_result,
    )
    monkeypatch.setattr(chat_service, "_generate_with_ollama", fail_generate_with_ollama)

    response = asyncio.run(
        generate_chat_response(
            db_session,
            question="Compare Finance et IT",
            history=[],
        )
    )

    assert response.fallback_used is False
    assert "Comparaison departements - Finance vs IT" in response.answer
    assert "Finance combine plus de cout et de criticite que IT." in response.answer


def test_build_prompt_includes_reasoning_strategy_metadata() -> None:
    summary = build_summary()
    reasoning_result = BusinessReasoningResult(
        answer="Resume executif\nAnalyse et justification\nActions recommandees\nIndice de confiance",
        primary_domain="budget",
        request_type="summary",
        strategy_key="budget:summary",
        response_shape="summary",
        selected_sources=["fleet_ai_results_morocco.csv", "aggregated_kpis"],
        entities=["Finance"],
        needs_inference=False,
        validation_passed=True,
        confidence=0.89,
        intent_category="kpi",
        intent_handler="handle_kpi_intent",
        intent_fallback_used=False,
        intent_match_mode="semantic",
        intent_confidence=0.71,
        analysis_strategy="executive_summary",
        business_goal="donner une lecture decisionnelle rapide",
        detail_level="executive",
        context_scope="Vue globale de la flotte",
        applied_criteria=["cout actuel vs projection budgetaire", "lecture croisee des KPI, volumes et alertes"],
        data_gaps=["Aucune limite critique supplementaire detectee"],
    )

    prompt = chat_service._build_prompt(
        "Que doit retenir un DAF avant la revue mensuelle ?",
        [],
        summary,
        reasoning_result=reasoning_result,
    )

    assert "- Strategie d'analyse: executive_summary" in prompt
    assert "- Objectif decisionnel: donner une lecture decisionnelle rapide" in prompt
    assert "- Niveau de detail: executive" in prompt
    assert "- Contexte cible: Vue globale de la flotte" in prompt
    assert "- Criteres appliques: cout actuel vs projection budgetaire; lecture croisee des KPI, volumes et alertes" in prompt
    assert "- Limites de donnees: Aucune limite critique supplementaire detectee" in prompt


def test_get_reasoning_result_logs_intent_routing(
    db_session: Session,
    monkeypatch,
    caplog,
) -> None:
    summary = build_summary()
    caplog.set_level(logging.INFO, logger="app.chat")

    monkeypatch.setattr(
        chat_service,
        "build_business_reasoning_result",
        lambda db, question, history, summary: BusinessReasoningResult(
            answer="Resume executif\nAnalyse courte\nActions recommandees\nIndice de confiance",
            primary_domain="budget",
            request_type="optimization",
            strategy_key="budget:optimization",
            response_shape="recommendation",
            selected_sources=["fleet_ai_results_morocco.csv", "phone_lines"],
            entities=["Maroc Telecom"],
            needs_inference=False,
            validation_passed=True,
            confidence=0.91,
            intent_category="cost_optimization",
            intent_handler="handle_cost_optimization_intent",
            intent_fallback_used=False,
            intent_match_mode="lexical",
            intent_confidence=0.94,
        ),
    )

    result = chat_service._get_reasoning_result(
        db_session,
        question="Ou dois-je reduire les couts telecom ?",
        history=[],
        summary=summary,
    )

    assert result is not None
    assert result.intent_category == "cost_optimization"
    assert "event=INTENT_DETECTED" in caplog.text
    assert "event=INTENT_CONFIDENCE" in caplog.text
    assert "event=INTENT_HANDLER" in caplog.text
    assert "event=FALLBACK_USED" in caplog.text
    assert 'intent="cost_optimization"' in caplog.text
    assert 'handler="handle_cost_optimization_intent"' in caplog.text
    assert "fallback_used=false" in caplog.text


def test_generate_chat_response_raises_ollama_offline_error(
    db_session: Session,
    monkeypatch,
) -> None:
    summary = build_summary()
    chat_service._CHAT_ANSWER_CACHE.clear()

    async def fake_generate_with_ollama(prompt: str) -> str:
        raise LocalModelUnavailableError(
            "Le modèle IA local n’est pas lancé. Lancez Ollama puis réessayez."
        )

    monkeypatch.setattr(chat_service, "get_data_summary", lambda db: summary)
    monkeypatch.setattr(chat_service, "_generate_with_ollama", fake_generate_with_ollama)

    try:
        asyncio.run(
            generate_chat_response(
                db_session,
                question="Quelle est la tendance globale ?",
                history=[],
            )
        )
    except LocalModelUnavailableError as exc:
        assert exc.code == "OLLAMA_OFFLINE"
    else:
        raise AssertionError("LocalModelUnavailableError attendue")


def test_generate_image_chat_response_combines_ocr_vision_and_business_data(
    db_session: Session,
    monkeypatch,
) -> None:
    summary = build_summary()

    class FakeRequest:
        async def is_disconnected(self) -> bool:
            return False

    monkeypatch.setattr(
        "app.services.multimodal_chat_service.get_data_summary",
        lambda db: summary,
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.prepare_image_for_analysis",
        lambda image_bytes, filename, content_type: PreparedImage(
            original_bytes=image_bytes,
            processed_bytes=b"processed-image",
            media_type="image/png",
            width=1200,
            height=800,
        ),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.extract_image_ocr",
        lambda image_bytes: OcrExtractionResult(
            text="Dashboard Finance Maroc Telecom 12 500 MAD 6 alertes critiques",
            lines=["Dashboard Finance", "12 500 MAD", "6 alertes critiques"],
            text_regions=[
                OcrTextRegion(text="Dashboard Finance", bbox=(12, 10, 180, 36), confidence=0.9),
                OcrTextRegion(text="12 500 MAD", bbox=(220, 88, 140, 38), confidence=0.93),
                OcrTextRegion(text="6 alertes critiques", bbox=(220, 132, 180, 38), confidence=0.92),
            ],
            amounts_mad=["12 500 MAD"],
            operators=["Maroc Telecom"],
            departments=["Finance"],
            alerts=["6 alertes critiques"],
            kpis=["Budget mensuel 12 500 MAD", "6 alertes critiques"],
            visible_tables=["Finance | 12 500 MAD | 6 alertes"],
            confidence=0.88,
            invoice_details=None,
            incident_details=None,
        ),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.build_image_annotations",
        lambda *args, **kwargs: ImageAnnotationResult(
            highlighted_image="data:image/png;base64,fake-dashboard-annotation",
            annotations=[
                ImageAnnotation(
                    label="Cout eleve",
                    type="risk",
                    bbox=(220, 88, 140, 38),
                    confidence=0.9,
                )
            ],
        ),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.analyze_image_with_llava",
        lambda **kwargs: asyncio.sleep(
            0,
            result=VisionAnalysisResult(
                image_type="dashboard",
                analysis="Le dashboard montre un budget eleve sur Finance avec 6 alertes critiques.",
                detected_kpis=["Budget mensuel 12 500 MAD", "6 alertes critiques"],
                recommendations=["Prioriser l'audit des lignes Finance."],
                confidence=0.91,
                model="llava",
            ),
        ),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service._generate_with_ollama",
        lambda prompt: asyncio.sleep(
            0,
            result=json.dumps(
                {
                    "answer": "Resume intelligent\nLe dashboard met en evidence une concentration du risque sur Finance.\nPoints critiques detectes\n- Budget eleve\n- Alertes critiques visibles\nRecommandations IA\n- Prioriser l'audit des lignes Finance.",
                    "detected_kpis": ["Budget mensuel 12 500 MAD", "6 alertes critiques"],
                    "recommendations": ["Prioriser l'audit des lignes Finance."],
                    "confidence": 0.93,
                }
            ),
        ),
    )

    response = asyncio.run(
        generate_image_chat_response(
            FakeRequest(),
            db_session,
            question="Analyse ce dashboard telecom",
            history=[],
            image_bytes=b"fake-image",
            filename="dashboard.png",
            content_type="image/png",
            analysis_mode="advanced",
            conversation_id="conv-image-1",
        )
    )

    assert response.image_type == "dashboard"
    assert response.confidence == 0.93
    assert "Resume executif" in response.answer
    assert "Score IA metier" in response.answer
    assert "Impact financier" in response.answer
    assert "Risques metier" in response.answer
    assert "Finance" in response.answer
    assert "Budget mensuel 12 500 MAD" in response.detected_kpis
    assert "- Impact financier: Moyen" in response.answer
    assert "- Criticite: " in response.answer
    assert response.recommendations[0] == "Prioriser l'audit des lignes Finance."
    assert response.analysis_metadata is not None
    assert response.analysis_metadata.source_mode == "image_strict"
    assert response.analysis_metadata.blocked_global_context is True
    assert "multimodal:image" in response.sources
    assert response.highlighted_image == "data:image/png;base64,fake-dashboard-annotation"
    assert response.annotations[0].label == "Cout eleve"
    assert response.risk_level in {"high", "critical"}
    assert response.optimization_score is not None
    assert any(
        recommendation.title == "Traiter les alertes critiques visibles en premier"
        for recommendation in response.decision_recommendations
    )


def test_generate_image_chat_response_quick_mode_skips_vision_and_business_llm(
    db_session: Session,
    monkeypatch,
) -> None:
    summary = build_summary()

    class FakeRequest:
        async def is_disconnected(self) -> bool:
            return False

    monkeypatch.setattr(
        "app.services.multimodal_chat_service.get_data_summary",
        lambda db: summary,
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.prepare_image_for_analysis",
        lambda image_bytes, filename, content_type: PreparedImage(
            original_bytes=image_bytes,
            processed_bytes=b"processed-image",
            media_type="image/png",
            width=1200,
            height=800,
        ),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.extract_image_ocr",
        lambda image_bytes: OcrExtractionResult(
            text="Dashboard Finance Maroc Telecom 12 500 MAD 6 alertes critiques",
            lines=["Dashboard Finance", "12 500 MAD", "6 alertes critiques"],
            text_regions=[
                OcrTextRegion(text="Dashboard Finance", bbox=(12, 10, 180, 36), confidence=0.9),
                OcrTextRegion(text="12 500 MAD", bbox=(220, 88, 140, 38), confidence=0.93),
            ],
            amounts_mad=["12 500 MAD"],
            operators=["Maroc Telecom"],
            departments=["Finance"],
            alerts=["6 alertes critiques"],
            kpis=["Budget mensuel 12 500 MAD", "6 alertes critiques"],
            visible_tables=["Finance | 12 500 MAD | 6 alertes"],
            confidence=0.88,
            invoice_details=None,
            incident_details=None,
        ),
    )

    async def fail_vision(**kwargs):
        raise AssertionError("vision should not run in quick mode")

    async def fail_business_llm(*args, **kwargs):
        raise AssertionError("business llm should not run in quick mode")

    monkeypatch.setattr(
        "app.services.multimodal_chat_service.analyze_image_with_llava",
        fail_vision,
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service._generate_with_ollama",
        fail_business_llm,
    )

    response = asyncio.run(
        generate_image_chat_response(
            FakeRequest(),
            db_session,
            question="Analyse cette capture telecom",
            history=[],
            image_bytes=b"fake-image",
            filename="capture.png",
            content_type="image/png",
            analysis_mode="quick",
            conversation_id="conv-image-quick",
        )
    )

    assert response.analysis_mode == "quick"
    assert response.analysis_status == "success"
    assert response.processing_message == "Lecture decisionnelle consolidee."
    assert response.fallback_used is False
    assert "vision:ocr-quick" in response.sources
    assert response.advanced_analysis_completed is False
    assert response.advanced_analysis_available is True
    assert response.detected_operator == "Maroc Telecom"
    assert response.detected_kpis
    assert response.vision_analysis.startswith("Lecture metier consolidee.")


def test_generate_image_chat_response_dashboard_analysis_builds_grounded_radar_audit(
    db_session: Session,
    monkeypatch,
) -> None:
    summary = build_summary()

    class FakeRequest:
        async def is_disconnected(self) -> bool:
            return False

    monkeypatch.setattr(
        "app.services.multimodal_chat_service.get_data_summary",
        lambda db: summary,
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.prepare_image_for_analysis",
        lambda image_bytes, filename, content_type: PreparedImage(
            original_bytes=image_bytes,
            processed_bytes=b"processed-dashboard",
            media_type="image/png",
            width=1440,
            height=900,
        ),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.extract_image_ocr",
        lambda image_bytes: OcrExtractionResult(
            text="FleetConnect AI Workflow Equipements Fraude Roaming",
            lines=[
                "FleetConnect AI",
                "Workflow",
                "Equipements",
                "Fraude",
                "Roaming",
            ],
            text_regions=[],
            amounts_mad=[],
            operators=[],
            departments=["Finance"],
            alerts=["3 alertes critiques"],
            kpis=["Fleet Health 61/100", "Workflow 92/100"],
            visible_tables=[],
            confidence=0.28,
            invoice_details=None,
            incident_details=None,
            workflow_details=None,
            equipment_details=None,
            ui_details=None,
            status="ok",
            error_message=None,
        ),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.is_vision_model_available",
        lambda: asyncio.sleep(0, result=(True, None)),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.analyze_image_with_llava",
        lambda **kwargs: asyncio.sleep(
            0,
            result=VisionAnalysisResult(
                image_type="dashboard",
                analysis=(
                    "Dashboard FleetConnect avec radar, cartes KPI, jauge et alertes visibles. "
                    "Workflow tres eleve, Equipements et Fraude tres faibles."
                ),
                detected_kpis=["Fleet Health 61/100", "Workflow 92/100", "Equipements 24/100"],
                recommendations=["Renforcer la supervision equipements."],
                confidence=0.9,
                model="llava",
                widgets=["radar chart", "kpi cards", "gauge", "alert cards"],
                charts=["radar chart", "bar chart"],
                critical_zones=[
                    "Workflow domine nettement le radar.",
                    "Fraude et Equipements sont sous le seuil de maitrise.",
                ],
                radar_axes=[
                    VisionRadarAxis(key="workflow_score", label="Workflow", value=92),
                    VisionRadarAxis(key="equipment_score", label="Equipements", value=24),
                    VisionRadarAxis(key="fraud_score", label="Fraude", value=18),
                    VisionRadarAxis(key="cost_score", label="Couts", value=57),
                    VisionRadarAxis(key="roaming_score", label="Roaming", value=26),
                    VisionRadarAxis(key="anomaly_score", label="Anomalies", value=41),
                    VisionRadarAxis(key="optimization_score", label="Optimisation", value=48),
                    VisionRadarAxis(key="risk_score", label="Risque", value=33),
                ],
                raw_output="RADAR_AXES: Workflow=92 Equipements=24 Fraude=18 Couts=57 Roaming=26",
            ),
        ),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.build_image_annotations",
        lambda *args, **kwargs: ImageAnnotationResult(
            highlighted_image=None,
            annotations=[],
        ),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service._generate_with_ollama",
        lambda prompt: asyncio.sleep(
            0,
            result=json.dumps(
                {
                    "answer": "Analyse generee.",
                    "detected_kpis": ["Fleet Health 61/100"],
                    "recommendations": ["Renforcer la supervision equipements."],
                    "confidence": 0.88,
                }
            ),
        ),
    )

    response = asyncio.run(
        generate_image_chat_response(
            FakeRequest(),
            db_session,
            question="Analyse ce dashboard FleetConnect AI",
            history=[],
            image_bytes=b"fake-dashboard",
            filename="fleetconnect-dashboard.png",
            content_type="image/png",
            analysis_mode="dashboard_analysis",
            conversation_id="conv-dashboard-analysis",
        )
    )

    assert response.image_type == "dashboard"
    assert response.analysis_mode == "dashboard_analysis"
    assert "Resume executif" in response.answer
    assert "Impact financier estime" in response.answer
    assert "KPI critiques detectes" in response.answer
    assert "Risques metier" in response.answer
    assert "Actions immediates recommandees" in response.answer
    assert "Score IA metier" in response.answer
    assert "Workflow 92/100" in response.answer
    assert "Equipements 24/100" in response.answer
    assert "Fraude 18/100" in response.answer
    assert "Roaming 26/100" in response.answer
    assert "Impact financier: Moyen a eleve" in response.answer
    assert "OCR 0%" not in response.answer
    assert "100/100" not in response.answer
    assert any(
        recommendation == "Renforcer la supervision equipements et consolider les alertes materiel."
        for recommendation in response.recommendations
    )


def test_generate_image_chat_response_structures_invoice_details(
    db_session: Session,
    monkeypatch,
) -> None:
    summary = build_summary()

    class FakeRequest:
        async def is_disconnected(self) -> bool:
            return False

    monkeypatch.setattr(
        "app.services.multimodal_chat_service.get_data_summary",
        lambda db: summary,
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.prepare_image_for_analysis",
        lambda image_bytes, filename, content_type: PreparedImage(
            original_bytes=image_bytes,
            processed_bytes=b"processed-image",
            media_type="image/png",
            width=1200,
            height=800,
        ),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.extract_image_ocr",
        lambda image_bytes: OcrExtractionResult(
            text="Facture Maroc Telecom Ref F-2026-0045 Date 04/05/2026 Periode du 01/04/2026 au 30/04/2026 Total 12 500 MAD TVA 2 100 MAD",
            lines=[
                "Facture Maroc Telecom",
                "Ref F-2026-0045",
                "Date 04/05/2026",
                "Periode du 01/04/2026 au 30/04/2026",
                "Montant HT 10 400 MAD",
                "TVA 2 100 MAD",
                "Total 12 500 MAD",
                "Frais roaming 350 MAD",
            ],
            text_regions=[
                OcrTextRegion(text="Facture Maroc Telecom", bbox=(16, 16, 220, 32), confidence=0.89),
                OcrTextRegion(text="Total 12 500 MAD", bbox=(320, 220, 180, 42), confidence=0.94),
            ],
            amounts_mad=["10 400 MAD", "2 100 MAD", "12 500 MAD", "350 MAD"],
            operators=["Maroc Telecom"],
            departments=[],
            alerts=["Frais roaming 350 MAD"],
            kpis=["Total 12 500 MAD", "TVA 2 100 MAD"],
            visible_tables=[],
            confidence=0.9,
            invoice_details=InvoiceDocumentDetails(
                operator="Maroc Telecom",
                invoice_number="F-2026-0045",
                invoice_date="04/05/2026",
                billing_period="du 01/04/2026 au 30/04/2026",
                amount_ht_mad="10 400 MAD",
                vat_amount_mad="2 100 MAD",
                amount_ttc_mad="12 500 MAD",
                total_amount_mad="12 500 MAD",
                billed_lines=["+212600000111"],
                additional_fees=["Frais roaming 350 MAD"],
                overage_items=[],
                anomalies=["Frais supplementaires detectes sur la facture."],
            ),
            incident_details=None,
        ),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.analyze_image_with_llava",
        lambda **kwargs: asyncio.sleep(
            0,
            result=VisionAnalysisResult(
                image_type="facture",
                analysis="Facture telecom avec total et frais roaming visibles.",
                detected_kpis=["Total 12 500 MAD"],
                recommendations=["Verifier le roaming et comparer au budget mensuel."],
                confidence=0.87,
                model="llava",
            ),
        ),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service._generate_with_ollama",
        lambda prompt: asyncio.sleep(
            0,
            result=json.dumps(
                {
                    "answer": (
                        "Resume intelligent\nLa facture appelle un rapprochement entre montant visible et frais roaming.\n"
                        "Recommandations IA\n- Verifier le roaming et comparer au budget mensuel.\n"
                        "- Forfait XL 830 MAD sur 1159 lignes."
                    ),
                    "detected_kpis": ["Total 12 500 MAD", "TVA 2 100 MAD"],
                    "detected_anomalies": ["Frais roaming a confirmer."],
                    "recommendations": [
                        "Verifier le roaming et comparer au budget mensuel.",
                        "Migrer vers forfait moins cher.",
                    ],
                    "confidence": 0.94,
                }
            ),
        ),
    )

    response = asyncio.run(
        generate_image_chat_response(
            FakeRequest(),
            db_session,
            question="Resume cette facture telecom",
            history=[],
            image_bytes=b"fake-invoice",
            filename="facture-maroc-telecom.png",
            content_type="image/png",
            analysis_mode="advanced",
            conversation_id="conv-invoice-1",
        )
    )

    assert response.image_type == "facture"
    assert response.detected_operator == "Maroc Telecom"
    assert response.ocr_confidence == 0.9
    assert response.invoice_details is not None
    assert response.invoice_details.total_amount_mad == "12 500 MAD"
    assert response.invoice_details.billing_period == "du 01/04/2026 au 30/04/2026"
    assert response.analysis_metadata is not None
    assert response.analysis_metadata.source_mode == "image_strict"
    assert response.analysis_metadata.blocked_global_context is True
    assert "Resume executif" in response.answer
    assert "Score IA metier" in response.answer
    assert "Impact financier" in response.answer
    assert "Niveau de criticite" in response.answer
    assert "Actions immediates recommandees" in response.answer
    assert "1159" not in response.answer
    assert "a confirmer" not in response.answer.lower()
    assert any(
        "1159 lignes" in item or "Migrer vers forfait moins cher." in item
        for item in response.analysis_metadata.removed_unverified_claims
    )
    assert any("roaming" in anomaly.lower() for anomaly in response.detected_anomalies)
    assert response.decision_recommendations


def test_generate_pdf_chat_response_structures_invoice_document(
    db_session: Session,
    monkeypatch,
) -> None:
    summary = build_summary()

    class FakeRequest:
        async def is_disconnected(self) -> bool:
            return False

    ocr_result = OcrExtractionResult(
        text=(
            "Maroc Telecom Facture F-2026-0411 Periode du 01/04/2026 au 30/04/2026 "
            "Total HT 41 720 MAD TVA 8 344 MAD Total TTC 48 320 MAD "
            "Roaming International 15 600 MAD Depassement Data 7 800 MAD "
            "Forfait Business XL 12 500 MAD"
        ),
        lines=[
            "Maroc Telecom",
            "Facture F-2026-0411",
            "Periode du 01/04/2026 au 30/04/2026",
            "Total HT 41 720 MAD",
            "TVA 8 344 MAD",
            "Total TTC 48 320 MAD",
            "Roaming International 15 600 MAD",
            "Depassement Data 7 800 MAD",
            "Forfait Business XL 12 500 MAD",
        ],
        text_regions=[],
        amounts_mad=[
            "41 720 MAD",
            "8 344 MAD",
            "48 320 MAD",
            "15 600 MAD",
            "7 800 MAD",
            "12 500 MAD",
        ],
        operators=["Maroc Telecom"],
        departments=[],
        alerts=["Roaming International 15 600 MAD", "Depassement Data 7 800 MAD"],
        kpis=["Total TTC 48 320 MAD", "Roaming International 15 600 MAD"],
        visible_tables=[
            "Poste | Montant",
            "Roaming International | 15 600 MAD",
            "Depassement Data | 7 800 MAD",
            "Forfait Business XL | 12 500 MAD",
        ],
        confidence=0.93,
        invoice_details=InvoiceDocumentDetails(
            operator="Maroc Telecom",
            invoice_number="F-2026-0411",
            invoice_date="30/04/2026",
            billing_period="du 01/04/2026 au 30/04/2026",
            amount_ht_mad="41 720 MAD",
            vat_amount_mad="8 344 MAD",
            amount_ttc_mad="48 320 MAD",
            total_amount_mad="48 320 MAD",
            billed_lines=[],
            additional_fees=["Roaming International 15 600 MAD"],
            overage_items=["Depassement Data 7 800 MAD"],
            anomalies=["Roaming international eleve sur la periode."],
        ),
        incident_details=None,
        workflow_details=None,
        equipment_details=None,
        ui_details=None,
    )

    monkeypatch.setattr(
        "app.services.multimodal_chat_service.get_data_summary",
        lambda db: summary,
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service._extract_pdf_document",
        lambda pdf_bytes, filename=None: asyncio.sleep(
            0,
            result=PdfExtractionResult(
                text=ocr_result.text,
                lines=ocr_result.lines,
                visible_tables=ocr_result.visible_tables,
                page_count=3,
                first_page_image_bytes=b"fake-pdf-page",
                ocr_result=ocr_result,
            ),
        ),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.prepare_image_for_analysis",
        lambda image_bytes, filename, content_type, max_side=None: PreparedImage(
            original_bytes=image_bytes,
            processed_bytes=b"processed-pdf-page",
            media_type="image/png",
            width=1240,
            height=1754,
        ),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.is_vision_model_available",
        lambda: asyncio.sleep(0, result=(True, None)),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.analyze_image_with_llava",
        lambda **kwargs: asyncio.sleep(
            0,
            result=VisionAnalysisResult(
                image_type="facture",
                analysis="Facture PDF telecom avec roaming international dominant.",
                detected_kpis=["Total TTC 48 320 MAD", "Roaming International 15 600 MAD"],
                recommendations=["Activer un forfait roaming entreprise."],
                confidence=0.92,
                model="llava",
            ),
        ),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service._generate_with_ollama",
        lambda prompt: asyncio.sleep(
            0,
            result=json.dumps(
                {
                    "answer": (
                        "Resume intelligent\nLa facture PDF concentre le risque sur le roaming "
                        "international et les depassements data.\nRecommandations IA\n"
                        "- Activer un forfait roaming entreprise.\n"
                        "- Forfait XL 830 MAD sur 1159 lignes."
                    ),
                    "detected_kpis": [
                        "Total TTC 48 320 MAD",
                        "Roaming International 15 600 MAD",
                        "Depassement Data 7 800 MAD",
                    ],
                    "detected_anomalies": [
                        "Roaming international eleve sur la periode.",
                        "Depassement Data visible sur la facture.",
                    ],
                    "recommendations": [
                        "Activer un forfait roaming entreprise.",
                        "Migrer vers forfait moins cher.",
                        "Ajouter une alerte avant depassement data.",
                    ],
                    "confidence": 0.95,
                }
            ),
        ),
    )

    response = asyncio.run(
        generate_pdf_chat_response(
            FakeRequest(),
            db_session,
            question="Analyse cette facture PDF",
            history=[],
            pdf_bytes=b"%PDF-1.7 fake-pdf-content",
            filename="facture-maroc-telecom.pdf",
            content_type="application/pdf",
            analysis_mode="advanced",
            conversation_id="conv-pdf-service-1",
        )
    )

    assert response.image_type == "facture"
    assert response.detected_operator == "Maroc Telecom"
    assert response.analysis_mode == "advanced"
    assert response.advanced_analysis_completed is True
    assert response.invoice_details is not None
    assert response.invoice_details.total_amount_mad == "48 320 MAD"
    assert response.invoice_details.billing_period == "du 01/04/2026 au 30/04/2026"
    assert response.analysis_metadata is not None
    assert response.analysis_metadata.source_mode == "image_strict"
    assert response.analysis_metadata.blocked_global_context is True
    assert "48 320 MAD" in response.answer
    assert "1159" not in response.answer
    assert response.sources[0] == "fleet_ai_results_morocco.csv"
    assert "multimodal:pdf" in response.sources
    assert response.processing_notices is not None
    assert any("3 page(s)" in notice for notice in response.processing_notices)
    assert any(
        "roaming" in recommendation.title.lower()
        for recommendation in response.decision_recommendations
    )
    assert response.risk_level in {"high", "critical"}


def test_generate_document_chat_response_structures_csv_analysis(
    db_session: Session,
    monkeypatch,
) -> None:
    summary = build_summary()

    class FakeRequest:
        async def is_disconnected(self) -> bool:
            return False

    csv_content = """operator,department,monthly_cost_mad,data_usage_gb,quota_gb,anomaly_flag,risk_score_100,roaming_flag,status
Maroc Telecom,IT,3200,14,10,1,91,1,active
Maroc Telecom,Finance,900,5,8,0,36,0,active
Orange,Support,650,4,8,0,28,0,free
Inwi,Sales,4200,18,12,1,87,1,active
"""

    monkeypatch.setattr(
        "app.services.document_chat_service.get_data_summary",
        lambda db: summary,
    )
    monkeypatch.setattr(
        "app.services.document_chat_service._generate_with_ollama",
        lambda prompt, timeout_seconds=35: asyncio.sleep(
            0,
            result=json.dumps(
                {
                    "answer": (
                        "Le CSV met en avant deux lignes a cout atypique, du roaming et des "
                        "depassements de quota a traiter en priorite."
                    ),
                    "detected_kpis": [
                        "Total monthly_cost_mad: 8 950 MAD",
                        "Operateur le plus couteux: Maroc Telecom",
                    ],
                    "detected_anomalies": [
                        "2 lignes presentent un risque eleve.",
                        "Roaming detecte sur plusieurs lignes.",
                    ],
                    "recommendations": [
                        "Auditer les lignes a cout atypique",
                        "Recalibrer les forfaits data",
                    ],
                    "confidence": 0.92,
                }
            ),
        ),
    )

    response = asyncio.run(
        generate_document_chat_response(
            FakeRequest(),
            db_session,
            question="Analyse ce fichier CSV telecom",
            history=[],
            document_bytes=csv_content.encode("utf-8"),
            filename="flotte.csv",
            content_type="text/csv",
            analysis_mode="advanced",
            conversation_id="conv-doc-csv-1",
        )
    )

    assert response.image_type == "tableur"
    assert response.analysis_mode == "advanced"
    assert response.detected_operator == "Maroc Telecom"
    assert response.advanced_analysis_completed is True
    assert "tabular:document" in response.sources
    assert "parser:pandas" in response.sources
    assert response.detected_kpis
    assert any("cout" in item.lower() for item in response.detected_kpis)
    assert any("roaming" in item.lower() for item in response.detected_anomalies)
    assert response.decision_recommendations
    assert response.risk_level in {"high", "critical"}


def test_generate_document_chat_response_polishes_final_payload_fields(
    db_session: Session,
    monkeypatch,
) -> None:
    summary = build_summary()

    class FakeRequest:
        async def is_disconnected(self) -> bool:
            return False

    csv_content = """operator,department,monthly_cost_mad,data_usage_gb,quota_gb,anomaly_flag,risk_score_100,roaming_flag,status
Maroc Telecom,IT,4200,1,20,1,100,1,active
Orange,Finance,980,0,12,0,99,0,inactive
"""

    monkeypatch.setattr(
        "app.services.document_chat_service.get_data_summary",
        lambda db: summary,
    )
    monkeypatch.setattr(
        "app.services.document_chat_service._generate_with_ollama",
        lambda prompt, timeout_seconds=35: asyncio.sleep(
            0,
            result=json.dumps(
                {
                    "answer": (
                        "L'analyse revele 14 lignes utilisent moins de 20% de leur capacite.\n"
                        "1 ressources inactives restent facturees.\n"
                        "Les annotations confirment les points de vigilance sur la capture.\n"
                        "Risque global: 100/100 (Critique)."
                    ),
                    "detected_kpis": [
                        "Risque global: 100/100 (Critique)",
                        "Les annotations confirment les points de vigilance.",
                    ],
                    "detected_anomalies": [
                        "L'analyse revele 14 lignes utilisent moins de 20% de leur capacite.",
                        "1 ressources inactives restent facturees.",
                    ],
                    "recommendations": [
                        "Auditer les lignes avec score 100/100.",
                        "Les annotations confirment une vigilance immediate.",
                    ],
                    "confidence": 0.95,
                }
            ),
        ),
    )

    response = asyncio.run(
        generate_document_chat_response(
            FakeRequest(),
            db_session,
            question="Analyse ce CSV flotte telecom",
            history=[],
            document_bytes=csv_content.encode("utf-8"),
            filename="flotte-polish.csv",
            content_type="text/csv",
            analysis_mode="advanced",
            conversation_id="conv-doc-polish-1",
        )
    )

    assert "100/100" not in response.answer
    assert "Les annotations confirment" not in response.answer
    assert "L'analyse revele 14 lignes utilisent" not in response.answer
    assert all("100/100" not in item for item in response.detected_kpis)
    assert all("annotations confirment" not in item.lower() for item in response.detected_kpis)
    assert all("100/100" not in item for item in response.detected_anomalies)
    assert any(
        item == "L'analyse revele que 14 lignes utilisent moins de 20% de leur capacite."
        for item in response.detected_anomalies
    )
    assert any(item == "1 ressource inactive reste facturee." for item in response.detected_anomalies)
    assert all("annotations confirment" not in item.lower() for item in response.recommendations)
    assert response.analysis_metadata is not None
    assert all("100/100" not in item for item in response.analysis_metadata.visible_kpis_used)
    assert response.decision_recommendations
    assert all("100/100" not in recommendation.reason for recommendation in response.decision_recommendations)
    assert all("annotations confirment" not in recommendation.reason.lower() for recommendation in response.decision_recommendations)


def test_generate_document_chat_response_reads_xlsx_workbook(
    db_session: Session,
    monkeypatch,
) -> None:
    summary = build_summary()

    class FakeRequest:
        async def is_disconnected(self) -> bool:
            return False

    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = "Fleet"
    worksheet.append(
        [
            "operator",
            "department",
            "monthly_cost_mad",
            "data_usage_gb",
            "quota_gb",
            "anomaly_flag",
            "status",
        ]
    )
    worksheet.append(["Orange", "IT", 1800, 12, 8, 1, "active"])
    worksheet.append(["Orange", "Support", 650, 3, 8, 0, "inactive"])
    worksheet.append(["Maroc Telecom", "Finance", 920, 4, 6, 0, "active"])
    buffer = BytesIO()
    workbook.save(buffer)

    monkeypatch.setattr(
        "app.services.document_chat_service.get_data_summary",
        lambda db: summary,
    )

    response = asyncio.run(
        generate_document_chat_response(
            FakeRequest(),
            db_session,
            question="Analyse ce fichier Excel telecom",
            history=[],
            document_bytes=buffer.getvalue(),
            filename="flotte.xlsx",
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            analysis_mode="quick",
            conversation_id="conv-doc-xlsx-1",
        )
    )

    assert response.image_type == "tableur"
    assert response.analysis_mode == "quick"
    assert response.detected_operator == "Orange"
    assert any("pandas" in source for source in response.sources)
    assert any("Feuille analysee: Fleet." in notice for notice in response.processing_notices)
    assert response.detected_kpis
    assert response.decision_recommendations


def test_generate_image_chat_response_structures_alert_capture_details(
    db_session: Session,
    monkeypatch,
) -> None:
    summary = build_summary()

    class FakeRequest:
        async def is_disconnected(self) -> bool:
            return False

    monkeypatch.setattr(
        "app.services.multimodal_chat_service.get_data_summary",
        lambda db: summary,
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.prepare_image_for_analysis",
        lambda image_bytes, filename, content_type: PreparedImage(
            original_bytes=image_bytes,
            processed_bytes=b"processed-image",
            media_type="image/png",
            width=1024,
            height=768,
        ),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.extract_image_ocr",
        lambda image_bytes: OcrExtractionResult(
            text=(
                "ALERTE CRITIQUE 06/05/2026 11:42 Ligne +212600000111 "
                "Depassement quota data 18.4 Go Cout suspect 1 250 MAD Maroc Telecom"
            ),
            lines=[
                "ALERTE CRITIQUE",
                "06/05/2026 11:42",
                "Ligne +212600000111",
                "Depassement quota data 18.4 Go",
                "Cout suspect 1 250 MAD",
                "Maroc Telecom",
            ],
            text_regions=[
                OcrTextRegion(text="ALERTE CRITIQUE", bbox=(24, 18, 190, 34), confidence=0.95),
                OcrTextRegion(text="Depassement quota data 18.4 Go", bbox=(24, 108, 280, 36), confidence=0.9),
                OcrTextRegion(text="Cout suspect 1 250 MAD", bbox=(24, 156, 220, 36), confidence=0.91),
            ],
            amounts_mad=["1 250 MAD"],
            operators=["Maroc Telecom"],
            departments=[],
            alerts=["ALERTE CRITIQUE", "Depassement quota data 18.4 Go"],
            kpis=["1 250 MAD", "18.4 Go"],
            visible_tables=[],
            confidence=0.86,
            invoice_details=None,
            incident_details=IncidentDocumentDetails(
                alert_type="depassement_quota",
                severity="critique",
                detected_at="06/05/2026 11:42",
                operator="Maroc Telecom",
                line_reference="+212600000111",
                suspect_cost_mad="1 250 MAD",
                call_volume=None,
                data_overage="Depassement quota data 18.4 Go",
                error_message=None,
                priority="immediate",
                summary="Depassement quota data visible sur la ligne +212600000111.",
                probable_causes=[
                    "Un depassement data ou hors forfait semble present.",
                    "Un montant suspect apparait dans la capture et doit etre confirme.",
                ],
            ),
        ),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.analyze_image_with_llava",
        lambda **kwargs: asyncio.sleep(
            0,
            result=VisionAnalysisResult(
                image_type="depassement_quota",
                analysis="Capture d'alerte telecom montrant un depassement data critique sur une ligne.",
                detected_kpis=["18.4 Go", "1 250 MAD"],
                recommendations=["Bloquer temporairement la ligne si le depassement continue."],
                confidence=0.9,
                model="llava",
            ),
        ),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service._generate_with_ollama",
        lambda prompt: asyncio.sleep(
            0,
            result=json.dumps(
                {
                    "answer": "Resume intelligent\nL'alerte visible appelle une priorisation immediate sur la ligne concernee.\nRecommandations IA\n- Verifier la ligne puis appliquer une limitation de quota.",
                    "detected_kpis": ["18.4 Go", "1 250 MAD"],
                    "detected_anomalies": ["Depassement quota data visible."],
                    "probable_causes": ["Consommation data hors forfait probable."],
                    "severity": "critique",
                    "treatment_priority": "immediate",
                    "alert_summary": "Depassement data visible sur la ligne +212600000111.",
                    "recommendations": ["Verifier la ligne puis appliquer une limitation de quota."],
                    "confidence": 0.92,
                }
            ),
        ),
    )

    response = asyncio.run(
        generate_image_chat_response(
            FakeRequest(),
            db_session,
            question="Cette alerte est-elle critique ?",
            history=[],
            image_bytes=b"fake-alert",
            filename="alerte-quota.png",
            content_type="image/png",
            analysis_mode="advanced",
            conversation_id="conv-alert-1",
        )
    )

    assert response.image_type == "depassement_quota"
    assert response.detected_operator == "Maroc Telecom"
    assert response.incident_details is not None
    assert response.incident_details.severity == "critique"
    assert response.incident_details.priority == "immediate"
    assert response.incident_details.line_reference == "+212600000111"
    assert response.incident_details.data_overage == "Depassement quota data 18.4 Go"
    assert "Consommation data hors forfait probable." in response.incident_details.probable_causes
    assert response.risk_level == "critical"
    assert any(
        recommendation.title == "Optimiser forfait data"
        for recommendation in response.decision_recommendations
    )


def test_generate_image_chat_response_alert_dashboard_uses_visible_kpis_only(
    db_session: Session,
    monkeypatch,
) -> None:
    summary = build_summary()

    class FakeRequest:
        async def is_disconnected(self) -> bool:
            return False

    monkeypatch.setattr(
        "app.services.multimodal_chat_service.get_data_summary",
        lambda db: summary,
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.prepare_image_for_analysis",
        lambda image_bytes, filename, content_type: PreparedImage(
            original_bytes=image_bytes,
            processed_bytes=b"processed-alert-dashboard",
            media_type="image/png",
            width=1600,
            height=900,
        ),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.extract_image_ocr",
        lambda image_bytes: OcrExtractionResult(
            text=(
                "Previsions et alertes 3047 alertes critiques Taux d'exposition 56,5% "
                "Revenu a risque 2 198 990 MAD Impact estime 648 124,54 MAD "
                "Score fraude 62/100 Score anomalie 58/100 Score cout 64/100 "
                "Utilisateur A score 100/100 Utilisateur B score 100/100 Maroc Telecom"
            ),
            lines=[
                "Previsions et alertes",
                "3047 alertes critiques",
                "Taux d'exposition 56,5%",
                "Revenu a risque 2 198 990 MAD",
                "Impact estime 648 124,54 MAD",
                "Score fraude 62/100",
                "Score anomalie 58/100",
                "Score cout 64/100",
                "Utilisateur A score 100/100",
                "Utilisateur B score 100/100",
                "Fraude",
                "Anomalies repetitives",
                "Maroc Telecom",
            ],
            text_regions=[
                OcrTextRegion(text="3047 alertes critiques", bbox=(20, 40, 320, 36), confidence=0.95),
                OcrTextRegion(text="Taux d'exposition 56,5%", bbox=(20, 92, 300, 36), confidence=0.92),
                OcrTextRegion(text="Revenu a risque 2 198 990 MAD", bbox=(20, 144, 360, 36), confidence=0.94),
            ],
            amounts_mad=["2 198 990 MAD", "648 124,54 MAD"],
            operators=["Maroc Telecom"],
            departments=[],
            alerts=["3047 alertes critiques", "Fraude", "Anomalies repetitives"],
            kpis=[
                "3047 alertes critiques",
                "56,5%",
                "2 198 990 MAD",
                "648 124,54 MAD",
                "62/100",
                "58/100",
                "64/100",
                "100/100",
            ],
            visible_tables=[],
            confidence=0.9,
            invoice_details=None,
            incident_details=None,
        ),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.analyze_image_with_llava",
        lambda **kwargs: asyncio.sleep(
            0,
            result=VisionAnalysisResult(
                image_type="dashboard",
                analysis=(
                    "Page d'alertes avec criticite elevee, revenu a risque 2 198 990 MAD, "
                    "impact estime 648 124,54 MAD, score fraude 62/100, score anomalie 58/100 "
                    "et utilisateurs fortement exposes."
                ),
                detected_kpis=[
                    "3047 alertes critiques",
                    "56,5%",
                    "2 198 990 MAD",
                    "648 124,54 MAD",
                    "62/100",
                    "58/100",
                ],
                recommendations=["Verifier les utilisateurs a risque maximal."],
                confidence=0.93,
                model="llava",
            ),
        ),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service._generate_with_ollama",
        lambda prompt: asyncio.sleep(
            0,
            result=json.dumps(
                {
                    "answer": "",
                    "detected_kpis": [
                        "3047 alertes critiques",
                        "56,5%",
                        "2 198 990 MAD",
                        "648 124,54 MAD",
                        "62/100",
                        "58/100",
                    ],
                    "detected_anomalies": ["Plusieurs scores 100/100 sont visibles."],
                    "probable_causes": ["Les alertes critiques et l'impact financier dominent la capture."],
                    "severity": "critique",
                    "treatment_priority": "immediate",
                    "alert_summary": "Le tableau d'alertes montre un niveau de risque critique.",
                    "recommendations": [
                        "Auditer les utilisateurs avec score 100/100.",
                        "Migrer vers forfait moins cher.",
                        "1624 depassements quota sont visibles.",
                    ],
                    "confidence": 0.95,
                }
            ),
        ),
    )

    response = asyncio.run(
        generate_image_chat_response(
            FakeRequest(),
            db_session,
            question="Analyse cette page d'alertes",
            history=[],
            image_bytes=b"fake-alert-dashboard",
            filename="alertes.png",
            content_type="image/png",
            analysis_mode="advanced",
            conversation_id="conv-alert-dashboard-1",
        )
    )

    assert response.image_type == "alert_dashboard"
    assert response.risk_level == "critical"
    assert response.analysis_metadata is not None
    assert response.analysis_metadata.source_mode == "image_strict"
    assert response.analysis_metadata.blocked_global_context is True
    assert response.incident_details is not None
    assert response.incident_details.critical_alert_count == 3047
    assert response.incident_details.exposure_rate == "56,5%"
    assert response.incident_details.financial_impact_mad == "2 198 990 MAD"
    assert response.incident_details.revenue_at_risk_mad == "2 198 990 MAD"
    assert response.incident_details.estimated_impact_mad == "648 124,54 MAD"
    assert response.incident_details.fraud_score_visible == "62/100"
    assert response.incident_details.anomaly_score_visible == "58/100"
    assert response.incident_details.cost_score_visible == "64/100"
    assert response.incident_details.average_score == "49,3" or response.incident_details.average_score is None
    assert response.incident_details.risk_score == "94/100"
    assert len(response.incident_details.risky_entities) >= 2
    assert response.alert_intelligence is not None
    assert response.alert_intelligence.criticity == "critical"
    assert response.alert_intelligence.ai_risk_score is not None
    assert response.alert_intelligence.ai_risk_score >= 88
    assert response.alert_intelligence.financial_exposure_mad == "2 198 990 MAD"
    assert response.incident_details.priority == "immediate"
    assert response.answer.startswith("Oui, cette alerte est critique pour la flotte telecom.")
    assert "Resume executif" in response.answer
    assert "Score IA metier" in response.answer
    assert "Impact financier" in response.answer
    assert "Niveau de criticite" in response.answer
    assert "Risques metier" in response.answer
    assert "Actions immediates recommandees" in response.answer
    assert "L'impact financier potentiel est de 2 198 990 MAD." in response.answer
    assert "un revenu expose estime a 2 198 990 MAD" in response.answer
    assert "un impact estime de 648 124,54 MAD" in response.answer
    assert "un risque fraude de 62/100" in response.answer
    assert "un risque anomalie de 58/100" in response.answer
    assert "- Impact financier: Eleve" in response.answer
    assert "- Priorite immediate: Immediate" in response.answer
    assert "- Impact financier: Faible" not in response.answer
    assert "3047 alertes critiques" in response.answer
    assert "56,5%" in response.answer
    assert "2 198 990 MAD" in response.answer
    assert "648 124,54 MAD" in response.answer
    assert "62/100" in response.answer
    assert "58/100" in response.answer
    assert "100/100" not in response.answer
    assert "94/100" in response.answer or "91/100" in response.answer
    assert "1159 lignes" not in response.answer
    assert "1624 depassements quota" not in response.answer
    assert "roaming" not in response.answer.lower()
    assert "appliquer les recommandations ia" not in response.answer.lower()
    assert "capture a enrichir" not in response.answer.lower()
    assert "lecture approfondie" not in response.answer.lower()
    assert "analyse exploitable" not in response.answer.lower()
    assert "signaux visibles" not in response.answer.lower()
    assert "ocr non exploitable" not in response.answer.lower()
    assert "texte insuffisant" not in response.answer.lower()
    assert "indicateurs insuffisants" not in response.answer.lower()
    assert "lecture partielle" not in response.answer.lower()
    assert not any("moins cher" in recommendation.lower() for recommendation in response.recommendations)
    assert any(
        "1624 depassements quota sont visibles." in item
        or "Migrer vers forfait moins cher." in item
        for item in response.analysis_metadata.removed_unverified_claims
    )
    assert any("94/100" in item or "91/100" in item for item in response.analysis_metadata.removed_unverified_claims)
    assert all("100/100" not in item for item in response.analysis_metadata.removed_unverified_claims)
    assert any(
        recommendation.title.startswith("Auditer les utilisateurs avec score")
        for recommendation in response.decision_recommendations
    )


def test_generate_image_chat_response_dashboard_risk_uses_visible_customer_kpis(
    db_session: Session,
    monkeypatch,
) -> None:
    summary = build_summary()

    class FakeRequest:
        async def is_disconnected(self) -> bool:
            return False

    monkeypatch.setattr(
        "app.services.multimodal_chat_service.get_data_summary",
        lambda db: summary,
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.prepare_image_for_analysis",
        lambda image_bytes, filename, content_type, max_side=None: PreparedImage(
            original_bytes=image_bytes,
            processed_bytes=b"processed-risk-dashboard",
            media_type="image/png",
            width=1600,
            height=900,
        ),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.extract_image_ocr",
        lambda image_bytes: OcrExtractionResult(
            text=(
                "Dashboard risque client 3047 clients a risque Taux churn 56,5% "
                "Revenu a risque 2 198 990 MAD Commercial 1989 clients sur contrat mensuel "
                "Score fraude 62/100 Score anomalie 58/100"
            ),
            lines=[
                "Dashboard risque client",
                "3047 clients a risque",
                "Taux churn 56,5%",
                "Revenu a risque 2 198 990 MAD",
                "Commercial",
                "1989 clients sur contrat mensuel",
                "Score fraude 62/100",
                "Score anomalie 58/100",
            ],
            text_regions=[],
            amounts_mad=["2 198 990 MAD"],
            operators=[],
            departments=["Commercial"],
            alerts=["3047 clients a risque"],
            kpis=[
                "3047 clients a risque",
                "56,5%",
                "2 198 990 MAD",
                "1989 clients sur contrat mensuel",
                "62/100",
                "58/100",
            ],
            visible_tables=[],
            confidence=0.78,
            invoice_details=None,
            incident_details=None,
        ),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.analyze_image_with_llava",
        lambda **kwargs: asyncio.sleep(
            0,
            result=VisionAnalysisResult(
                image_type="dashboard",
                analysis=(
                    "Dashboard risque client avec 3047 clients a risque, churn 56,5%, "
                    "revenu a risque 2 198 990 MAD et departement Commercial expose."
                ),
                detected_kpis=[
                    "3047 clients a risque",
                    "56,5%",
                    "2 198 990 MAD",
                    "Commercial",
                    "62/100",
                    "58/100",
                ],
                recommendations=["Traiter les segments a fort churn en priorite."],
                confidence=0.91,
                model="llava",
            ),
        ),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.analyze_dashboard_image",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service._generate_with_ollama",
        lambda prompt, timeout_seconds=None: asyncio.sleep(
            0,
            result=json.dumps(
                {
                    "answer": (
                        "Resume executif\n"
                        "La capture partagee contient une lecture croisee des risques et une gouvernance des priorites a revoir.\n"
                        "Risques metier\n"
                        "- Pilotage heterogene.\n"
                        "- Zones sous-supervisees.\n"
                    ),
                    "detected_kpis": ["3047 clients a risque", "56,5%", "2 198 990 MAD"],
                    "detected_anomalies": [],
                    "probable_causes": [],
                    "severity": "moyenne",
                    "treatment_priority": "normale",
                    "alert_summary": "",
                    "recommendations": [],
                    "confidence": 0.61,
                }
            ),
        ),
    )

    response = asyncio.run(
        generate_image_chat_response(
            FakeRequest(),
            db_session,
            question="Analyse ce dashboard risque client",
            history=[],
            image_bytes=b"fake-risk-dashboard",
            filename="risk-dashboard.png",
            content_type="image/png",
            analysis_mode="advanced",
            conversation_id="conv-risk-dashboard-1",
        )
    )

    assert response.answer
    assert response.answer.startswith("Oui, cette alerte est critique pour la flotte telecom.")
    assert "3047" in response.answer
    assert "56,5%" in response.answer
    assert "2 198 990 MAD" in response.answer
    assert "Commercial" in response.answer
    assert "1989" in response.answer
    assert "Criticite globale: Critique" in response.answer or "Criticite globale: Elevee" in response.answer
    assert "Impact financier: Eleve" in response.answer
    assert "lecture croisee" not in response.answer.lower()
    assert "zones sous-supervisees" not in response.answer.lower()
    assert "pilotage heterogene" not in response.answer.lower()
    assert "capture a enrichir" not in response.answer.lower()
    assert "lecture approfondie" not in response.answer.lower()
    assert "analyse exploitable" not in response.answer.lower()
    assert "signaux visibles" not in response.answer.lower()
    assert "ocr non exploitable" not in response.answer.lower()


def test_generate_image_chat_response_dashboard_strict_fallback_blocks_generic_ocr_notices(
    db_session: Session,
    monkeypatch,
    caplog,
) -> None:
    summary = build_summary()

    class FakeRequest:
        async def is_disconnected(self) -> bool:
            return False

    monkeypatch.setattr(
        "app.services.multimodal_chat_service.get_data_summary",
        lambda db: summary,
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.prepare_image_for_analysis",
        lambda image_bytes, filename, content_type, max_side=None: PreparedImage(
            original_bytes=image_bytes,
            processed_bytes=b"processed-strict-dashboard",
            media_type="image/png",
            width=1600,
            height=900,
        ),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service._extract_prepared_image_ocr",
        lambda prepared_image, filename=None: asyncio.sleep(
            0,
            result=(
                OcrExtractionResult(
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
                ),
                [],
            ),
        ),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.is_vision_model_available",
        lambda: asyncio.sleep(0, result=(False, "Vision locale indisponible.")),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.get_customer_churn_overview",
        lambda: {
            "kpis": {
                "high_risk_customers": 3047,
                "churn_rate_pct": 56.5,
                "revenue_at_risk_mad": 2_198_990.0,
                "average_risk_score": 49.3,
            },
            "risk_by_department": [
                {
                    "label": "Commercial",
                    "revenue_at_risk_mad": 2_198_990.0,
                    "predicted_high_risk_customers": 3047,
                    "average_risk_score": 68.0,
                }
            ],
            "churn_by_contract": [
                {
                    "label": "mensuel",
                    "revenue_at_risk_mad": 2_198_990.0,
                    "predicted_high_risk_customers": 1989,
                    "total_customers": 1989,
                    "average_risk_score": 64.0,
                }
            ],
        },
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.get_cdr_overview",
        lambda: {
            "kpis": {
                "critical_alerts": 3047,
                "average_risk_score": 62.0,
            }
        },
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.get_mobile_fleet_overview",
        lambda: {
            "kpis": {
                "average_budget_risk_score": 58.0,
            }
        },
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.analyze_dashboard_image",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service._generate_with_ollama",
        lambda prompt, timeout_seconds=None: asyncio.sleep(
            0,
            result=json.dumps(
                {
                    "answer": (
                        "La lecture OCR n'a pas permis de consolider un texte exploitable sur l'image. "
                        "La capture doit etre enrichie. "
                        "La lecture visuelle approfondie reste exploitable. "
                        "Consolider les signaux visibles."
                    ),
                    "detected_kpis": [],
                    "recommendations": [],
                    "confidence": 0.31,
                }
            ),
        ),
    )

    caplog.set_level(logging.INFO, logger="app.chat.multimodal")

    response = asyncio.run(
        generate_image_chat_response(
            FakeRequest(),
            db_session,
            question="Analyse ce dashboard churn et revenu a risque",
            history=[],
            image_bytes=b"fake-strict-dashboard",
            filename="strict-dashboard.png",
            content_type="image/png",
            analysis_mode="advanced",
            conversation_id="conv-strict-dashboard-fallback",
        )
    )

    assert response.answer.startswith("Oui, cette alerte est critique pour la flotte telecom.")
    assert "3047" in response.answer
    assert "56,5%" in response.answer
    assert "2 198 990 MAD" in response.answer
    assert "Commercial" in response.answer
    assert "1989" in response.answer
    assert "La lecture OCR n'a pas permis" not in response.answer
    assert "capture doit etre enrichie" not in response.answer.lower()
    assert "lecture visuelle approfondie" not in response.answer.lower()
    assert "analyse exploitable" not in response.answer.lower()
    assert "consolider les signaux visibles" not in response.answer.lower()
    assert "STRICT KPI RESPONSE USED" in caplog.text
    assert "ANSWER_SOURCE = dashboard_fallback_data" in caplog.text


def test_analyze_alert_dashboard_context_extracts_split_visible_kpis() -> None:
    incident_details = analyze_alert_dashboard_context(
        OcrExtractionResult(
            text=(
                "Previsions et alertes Impact financier 2 198 990 MAD "
                "3047 alertes critiques Taux d'exposition 56,5% Score moyen 49,3 "
                "Utilisateur A score 100/100 Utilisateur B score 100/100"
            ),
            lines=[
                "Previsions et alertes",
                "Impact financier",
                "2 198 990 MAD",
                "3047 alertes critiques",
                "Taux d'exposition",
                "56,5%",
                "Score moyen",
                "49,3",
                "Utilisateur A score 100/100",
                "Utilisateur B score 100/100",
                "Fraude",
            ],
            text_regions=[],
            amounts_mad=["2 198 990 MAD"],
            operators=[],
            departments=[],
            alerts=["3047 alertes critiques", "Fraude"],
            kpis=["2 198 990 MAD", "56,5%", "49,3", "100/100"],
            visible_tables=[],
            confidence=0.86,
            invoice_details=None,
            incident_details=None,
        )
    )

    assert incident_details is not None
    assert incident_details.alert_type == "alert_dashboard"
    assert incident_details.critical_alert_count == 3047
    assert incident_details.exposure_rate == "56,5%"
    assert incident_details.financial_impact_mad == "2 198 990 MAD"
    assert incident_details.risk_score == "100/100"
    assert incident_details.severity == "critique"
    assert incident_details.priority == "immediate"
    assert any("Score moyen visible a 49,3" == item for item in incident_details.critical_signals)


def test_extract_alert_dashboard_kpis_uses_ocr_and_vision_sources() -> None:
    extracted = extract_alert_dashboard_kpis(
        ocr_text=(
            "Previsions et alertes 3047 clients a risque "
            "Impact financier potentiel 2 198 990 MAD "
            "Taux d'exposition 56,5% Score moyen 49,3 Commercial 1989 clients sur contrat mensuel "
            "Score optimisation 71/100 Score cout 64/100"
        ),
        vision_text=(
            "Dashboard alerte avec plusieurs profils a 100/100, impact financier potentiel 2 198 990 MAD "
            "et taux d'exposition 56,5%. Score fraude 62/100. Score anomalie 58/100."
        ),
    )

    assert extracted.at_risk_clients_count == 3047
    assert extracted.exposure_rate == "56,5%"
    assert extracted.financial_impact_mad == "2 198 990 MAD"
    assert extracted.average_score == "49,3"
    assert extracted.department_risk == "Commercial"
    assert extracted.contract_exposed == "1989 clients sur contrat mensuel"
    assert extracted.fraud_score_visible == "62/100"
    assert extracted.anomaly_score_visible == "58/100"
    assert extracted.optimization_score_visible == "71/100"
    assert extracted.cost_score_visible == "64/100"
    assert "100/100" in extracted.max_risk_scores
    assert extracted.risk_level == "critical"


def test_detect_kpis_merges_split_dashboard_metrics() -> None:
    detected_kpis = _detect_kpis(
        [
            "Exposition portefeuille",
            "2 198 990 MAD",
            "Impact estime",
            "648 124 MAD",
            "Score fraude",
            "62/100",
            "Score anomalie",
            "58/100",
            "Roaming suspect",
            "12,5%",
        ]
    )

    assert "Exposition portefeuille: 2 198 990 MAD" in detected_kpis
    assert "Impact estime: 648 124 MAD" in detected_kpis
    assert "Score fraude: 62/100" in detected_kpis
    assert "Score anomalie: 58/100" in detected_kpis
    assert "Roaming suspect: 12,5%" in detected_kpis


def test_detect_kpis_merges_value_first_dashboard_cards() -> None:
    detected_kpis = _detect_kpis(
        [
            "3047",
            "Clients a risque",
            "56,5%",
            "Taux churn",
            "2 198 990 MAD",
            "Revenu a risque",
            "49,3",
            "Score moyen",
        ]
    )

    assert "Clients a risque: 3047" in detected_kpis
    assert "Taux churn: 56,5%" in detected_kpis
    assert "Revenu a risque: 2 198 990 MAD" in detected_kpis
    assert "Score moyen: 49,3" in detected_kpis


def test_calibrate_ocr_confidence_avoids_zero_for_partial_dashboard_kpis() -> None:
    calibrated_confidence = _calibrate_ocr_confidence(
        raw_confidence=0.28,
        text="Exposition portefeuille 2 198 990 MAD Impact estime 648 124 MAD Score fraude 62/100",
        lines=[
            "Exposition portefeuille",
            "2 198 990 MAD",
            "Impact estime",
            "648 124 MAD",
            "Score fraude",
            "62/100",
        ],
        detected_kpis=[
            "Exposition portefeuille: 2 198 990 MAD",
            "Impact estime: 648 124 MAD",
            "Score fraude: 62/100",
        ],
        amounts_mad=["2 198 990 MAD", "648 124 MAD"],
    )

    assert calibrated_confidence >= 0.6
    assert calibrated_confidence <= 0.8


def test_analyze_alert_dashboard_context_uses_vision_when_ocr_is_poor() -> None:
    incident_details = analyze_alert_dashboard_context(
        OcrExtractionResult(
            text="Previsions et alertes",
            lines=["Previsions et alertes"],
            text_regions=[],
            amounts_mad=[],
            operators=[],
            departments=[],
            alerts=[],
            kpis=[],
            visible_tables=[],
            confidence=0.31,
            invoice_details=None,
            incident_details=None,
        ),
        vision_text=(
            "Impact financier potentiel 2 198 990 MAD. "
            "3047 alertes critiques. "
            "Taux d'exposition 56,5%. "
            "Score moyen 49,3. "
            "Plusieurs profils presentent un score de risque 100/100."
        ),
    )

    assert incident_details is not None
    assert incident_details.financial_impact_mad == "2 198 990 MAD"
    assert incident_details.critical_alert_count == 3047
    assert incident_details.exposure_rate == "56,5%"
    assert incident_details.average_score == "49,3"
    assert incident_details.risk_score == "100/100"
    assert incident_details.severity == "critique"


def test_build_alert_intelligence_scores_critical_dashboards() -> None:
    alert_intelligence = _build_alert_intelligence(
        incident_details=IncidentDocumentDetails(
            alert_type="alert_dashboard",
            severity="critique",
            detected_at=None,
            operator="Maroc Telecom",
            line_reference=None,
            suspect_cost_mad=None,
            call_volume=None,
            data_overage=None,
            error_message=None,
            priority="immediate",
            summary="Synthese visible",
            critical_alert_count=3047,
            exposure_rate="56,5%",
            exposure_rate_pct=56.5,
            financial_impact_mad="2 198 990 MAD",
            financial_impact_value_mad=2_198_990,
            average_score="49,3",
            average_score_value=49.3,
            risk_score="100/100",
            max_risk_scores=["100/100", "100/100"],
            risky_entities=["Ligne A", "Ligne B"],
            repeated_anomalies=["Alertes fraude repetitives"],
            visible_statuses=["Critique"],
            critical_signals=["3047 alertes critiques actives"],
            probable_causes=["La supervision est surchargee"],
        ),
        decision_engine_result=RecommendationEngineResult(
            recommendations=[
                DecisionRecommendation(
                    title="Auditer les utilisateurs avec score 100/100",
                    priority="critical",
                    impact="risk",
                    estimated_saving=None,
                    reason="Les profils 100/100 doivent etre audites en premier.",
                )
            ],
            recommendation_notice=None,
            risk_level="critical",
            optimization_score=32,
            anomaly_score=91,
            fraud_score=88,
            cost_score=84,
        ),
        ocr_confidence=0.91,
    )

    assert alert_intelligence is not None
    assert alert_intelligence.criticity == "critical"
    assert alert_intelligence.ai_risk_score is not None
    assert alert_intelligence.ai_risk_score >= 88
    assert alert_intelligence.ocr_confidence_score == 91
    assert alert_intelligence.financial_exposure_mad == "2 198 990 MAD"
    assert "3047 alertes critiques" in alert_intelligence.priority_kpis
    assert "Ligne A" in alert_intelligence.at_risk_entities
    assert any(item.label == "Impact financier" for item in alert_intelligence.alert_timeline)
    assert alert_intelligence.immediate_actions[0] == "Auditer les utilisateurs avec score 100/100"


def test_build_alert_intelligence_supports_logs_without_financial_amount() -> None:
    alert_intelligence = _build_alert_intelligence(
        incident_details=IncidentDocumentDetails(
            alert_type="log",
            severity="elevee",
            detected_at="2026-05-19 09:14",
            operator=None,
            line_reference="+212600000111",
            suspect_cost_mad=None,
            call_volume=None,
            data_overage=None,
            error_message="HTTP 503 sur passerelle supervision",
            priority="haute",
            summary="Erreurs repetitives sur la passerelle",
            critical_alert_count=12,
            exposure_rate=None,
            exposure_rate_pct=None,
            financial_impact_mad=None,
            financial_impact_value_mad=None,
            average_score=None,
            average_score_value=None,
            risk_score="72/100",
            max_risk_scores=["72/100"],
            risky_entities=["Gateway supervision"],
            repeated_anomalies=["503 repete", "Timeout supervision"],
            visible_statuses=["Erreur"],
            critical_signals=["Logs d'erreur repetitifs"],
            probable_causes=["La passerelle supervision semble instable"],
        ),
        decision_engine_result=RecommendationEngineResult(
            recommendations=[
                DecisionRecommendation(
                    title="Stabiliser la passerelle de supervision",
                    priority="high",
                    impact="analysis",
                    estimated_saving=None,
                    reason="Les erreurs repetitives peuvent degrader la continuite de service.",
                )
            ],
            recommendation_notice=None,
            risk_level="high",
            optimization_score=18,
            anomaly_score=67,
            fraud_score=18,
            cost_score=22,
        ),
        ocr_confidence=0.73,
    )

    assert alert_intelligence is not None
    assert alert_intelligence.criticity == "high"
    assert alert_intelligence.financial_exposure_mad is None
    assert alert_intelligence.business_risk is not None
    assert "continuite de service" in alert_intelligence.business_risk.lower()
    assert alert_intelligence.alert_timeline[-1].label == "Action immediate"


def test_generate_image_chat_response_logs_debug_pipeline_for_visible_kpis(
    monkeypatch,
    db_session: Session,
    caplog,
) -> None:
    summary = build_summary()

    class FakeRequest:
        async def is_disconnected(self) -> bool:
            return False

    monkeypatch.setattr(
        "app.services.multimodal_chat_service.get_data_summary",
        lambda db: summary,
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.prepare_image_for_analysis",
        lambda image_bytes, filename, content_type, max_side=None: PreparedImage(
            original_bytes=image_bytes,
            processed_bytes=b"processed-alert-debug",
            media_type="image/png",
            width=1600,
            height=900,
        ),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.extract_image_ocr",
        lambda image_bytes: OcrExtractionResult(
            text=(
                "Previsions et alertes 3047 clients a risque Taux churn 56,5% "
                "Revenu a risque 2 198 990 MAD Impact estime 648 124,54 MAD "
                "Score fraude 62/100 Score anomalie 58/100 Score optimisation 71/100 "
                "Score cout 64/100 Utilisateur A score 100/100 "
                "Utilisateur B score 100/100"
            ),
            lines=[
                "Previsions et alertes",
                "3047 clients a risque",
                "Taux churn 56,5%",
                "Revenu a risque 2 198 990 MAD",
                "Impact estime 648 124,54 MAD",
                "Score fraude 62/100",
                "Score anomalie 58/100",
                "Score optimisation 71/100",
                "Score cout 64/100",
                "Utilisateur A score 100/100",
                "Utilisateur B score 100/100",
            ],
            text_regions=[],
            amounts_mad=["2 198 990 MAD", "648 124,54 MAD"],
            operators=["Maroc Telecom"],
            departments=[],
            alerts=["3047 clients a risque", "Fraude"],
            kpis=[
                "3047 clients a risque",
                "56,5%",
                "2 198 990 MAD",
                "648 124,54 MAD",
                "62/100",
                "58/100",
                "71/100",
                "64/100",
                "100/100",
            ],
            visible_tables=[],
            confidence=0.42,
            invoice_details=None,
            incident_details=None,
        ),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.analyze_image_with_llava",
        lambda **kwargs: asyncio.sleep(
            0,
            result=VisionAnalysisResult(
                image_type="dashboard",
                analysis=(
                    "Dashboard alerte avec 3047 clients a risque, churn 56,5%, revenu a risque 2 198 990 MAD, "
                    "impact estime 648 124,54 MAD, score fraude 62/100, score anomalie 58/100 et plusieurs 100/100."
                ),
                detected_kpis=[
                    "3047 clients a risque",
                    "56,5%",
                    "2 198 990 MAD",
                    "648 124,54 MAD",
                    "62/100",
                    "58/100",
                    "100/100",
                ],
                recommendations=["Auditer les profils 100/100 et l'impact financier visible."],
                confidence=0.9,
                model="llava",
            ),
        ),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service._generate_with_ollama",
        lambda prompt, timeout_seconds=None: asyncio.sleep(
            0,
            result=json.dumps(
                {
                    "answer": "Resume intelligent\nLa capture met en evidence une alerte telecom.\nRecommandations IA\n- Prioriser l'audit.",
                    "detected_kpis": ["3047 clients a risque", "2 198 990 MAD", "648 124,54 MAD"],
                    "recommendations": ["Auditer les profils 100/100."],
                    "severity": "critique",
                    "treatment_priority": "immediate",
                    "alert_summary": "Les KPI visibles appellent une priorisation immediate.",
                    "confidence": 0.88,
                }
            ),
        ),
    )

    caplog.set_level(logging.INFO, logger="app.chat.multimodal")

    response = asyncio.run(
        generate_image_chat_response(
            FakeRequest(),
            db_session,
            question="Quel est l'impact financier potentiel de ces alertes ?",
            history=[],
            image_bytes=b"fake-alert-debug",
            filename="alert-debug.png",
            content_type="image/png",
            analysis_mode="advanced",
            conversation_id="conv-alert-debug",
        )
    )

    assert response.ocr_confidence is not None
    assert response.ocr_confidence >= 0.7
    assert response.incident_details is not None
    assert response.incident_details.optimization_score_visible == "71/100"
    assert response.incident_details.cost_score_visible == "64/100"
    assert "L'impact financier potentiel est de 2 198 990 MAD." in response.answer
    assert "- un revenu expose estime a 2 198 990 MAD." in response.answer
    assert "- un impact estime de 648 124,54 MAD." in response.answer
    assert "- un risque fraude de 62/100." in response.answer
    assert "- un risque anomalie de 58/100." in response.answer
    assert "roaming" not in response.answer.lower()
    assert "appliquer les recommandations ia" not in response.answer.lower()
    assert "=== TEXTE OCR ===" in caplog.text
    assert "=== KPI DETECTES ===" in caplog.text
    assert "=== KPI EXTRAITS ===" in caplog.text
    assert "KPI detectes avec succes" in caplog.text
    assert "=== PROMPT FINAL LLM ===" in caplog.text
    assert "alert_dashboard_kpis" in caplog.text
    assert "=== REPONSE BRUTE LLM ===" in caplog.text
    assert "=== REPONSE FINALE ===" in caplog.text
    assert "2 198 990 MAD" in caplog.text


def test_generate_image_chat_response_long_screenshot_survives_vision_socket_failure(
    monkeypatch,
    db_session: Session,
) -> None:
    summary = build_summary()

    class FakeRequest:
        async def is_disconnected(self) -> bool:
            return False

    monkeypatch.setattr(
        "app.services.multimodal_chat_service.get_data_summary",
        lambda db: summary,
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.prepare_image_for_analysis",
        lambda image_bytes, filename, content_type, max_side=None: PreparedImage(
            original_bytes=b"original-long",
            processed_bytes=b"processed-long",
            media_type="image/jpeg",
            width=1200,
            height=8219,
            processed_width=1200,
            processed_height=1600,
            is_long_screenshot=True,
            chunks=(
                PreparedImageChunk(
                    index=0,
                    offset_y=0,
                    original_bytes=b"chunk-1-original",
                    processed_bytes=b"chunk-1-processed",
                    media_type="image/jpeg",
                    width=1200,
                    height=1600,
                    processed_width=1200,
                    processed_height=1600,
                ),
                PreparedImageChunk(
                    index=1,
                    offset_y=1480,
                    original_bytes=b"chunk-2-original",
                    processed_bytes=b"chunk-2-processed",
                    media_type="image/jpeg",
                    width=1200,
                    height=1600,
                    processed_width=1200,
                    processed_height=1600,
                ),
            ),
        ),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service._extract_prepared_image_ocr",
        lambda prepared_image, filename: asyncio.sleep(
            0,
            result=(
                OcrExtractionResult(
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
                    status="unavailable",
                    error_message="La lecture OCR n'a pas permis de consolider un texte exploitable sur l'image.",
                ),
                [],
            ),
        ),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.is_vision_model_available",
        lambda: asyncio.sleep(0, result=(True, None)),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.analyze_image_with_llava",
        lambda **kwargs: (_ for _ in ()).throw(OSError("WinError 10055")),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service._generate_with_ollama",
        lambda prompt, timeout_seconds=None: asyncio.sleep(
            0,
            result=json.dumps(
                {
                    "answer": "",
                    "detected_kpis": [],
                    "detected_anomalies": [],
                    "probable_causes": [],
                    "severity": "moyenne",
                    "treatment_priority": "normale",
                    "alert_summary": "",
                    "recommendations": [],
                    "confidence": 0.4,
                }
            ),
        ),
    )

    response = asyncio.run(
        generate_image_chat_response(
            FakeRequest(),
            db_session,
            question="Quelle impact financier de ces alertes sur notre systeme",
            history=[],
            image_bytes=b"fake-long-dashboard",
            filename="image.jpg",
            content_type="image/jpeg",
            analysis_mode="advanced",
            conversation_id="conv-long-socket-failure",
        )
    )

    assert response.answer
    assert "Connexion backend impossible" not in response.answer
    assert response.processing_notices is not None
    assert response.image_type in {"capture_interface", "dashboard", "alert_dashboard", "alerte"}


def test_generate_image_chat_response_structures_workflow_analysis(
    db_session: Session,
    monkeypatch,
) -> None:
    summary = build_summary()

    class FakeRequest:
        async def is_disconnected(self) -> bool:
            return False

    monkeypatch.setattr(
        "app.services.multimodal_chat_service.get_data_summary",
        lambda db: summary,
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.prepare_image_for_analysis",
        lambda image_bytes, filename, content_type: PreparedImage(
            original_bytes=image_bytes,
            processed_bytes=b"processed-workflow",
            media_type="image/png",
            width=1400,
            height=900,
        ),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.extract_image_ocr",
        lambda image_bytes: OcrExtractionResult(
            text=(
                "Workflow gestion flotte Validation manager Decision budget Support IT "
                "Finance Escalade Direction Controle manuel"
            ),
            lines=[
                "Workflow gestion flotte",
                "Support IT -> Validation manager",
                "Decision budget",
                "Controle manuel",
                "Escalade Direction",
                "Finance",
            ],
            text_regions=[
                OcrTextRegion(text="Workflow gestion flotte", bbox=(24, 18, 220, 36), confidence=0.94),
                OcrTextRegion(text="Support IT -> Validation manager", bbox=(24, 96, 320, 40), confidence=0.91),
                OcrTextRegion(text="Decision budget", bbox=(420, 96, 180, 40), confidence=0.9),
                OcrTextRegion(text="Controle manuel", bbox=(420, 182, 180, 40), confidence=0.89),
            ],
            amounts_mad=[],
            operators=[],
            departments=["IT", "Finance", "Direction"],
            alerts=[],
            kpis=[],
            visible_tables=[],
            confidence=0.9,
            invoice_details=None,
            incident_details=None,
            workflow_details=WorkflowDocumentDetails(
                workflow_type="processus_metier",
                step_names=[
                    "Support IT -> Validation manager",
                    "Decision budget",
                    "Controle manuel",
                    "Escalade Direction",
                ],
                departments=["IT", "Finance", "Direction"],
                roles=["Validation manager", "Direction"],
                decisions=["Decision budget"],
                validations=["Support IT -> Validation manager"],
                actions=["Controle manuel", "Escalade Direction"],
                relations=["Support IT -> Validation manager"],
                hierarchy_levels=3,
                critical_steps=["Support IT -> Validation manager", "Controle manuel"],
                bottlenecks=["Controle manuel", "Escalade Direction"],
                automation_opportunities=[
                    "Automatiser les validations repetitives visibles dans le schema.",
                    "Remplacer les transferts manuels par un workflow outille.",
                ],
                repeated_validations=["Support IT -> Validation manager"],
                complexity_score=78,
                complexity_level="high",
                summary="4 etape(s) visibles, 1 validation(s), 1 dependance(s) textuelles, complexite high",
            ),
        ),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.build_image_annotations",
        lambda *args, **kwargs: ImageAnnotationResult(
            highlighted_image="data:image/png;base64,fake-workflow-annotation",
            annotations=[
                ImageAnnotation(
                    label="Zone complexe",
                    type="risk",
                    bbox=(420, 182, 180, 40),
                    confidence=0.9,
                )
            ],
        ),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.analyze_image_with_llava",
        lambda **kwargs: asyncio.sleep(
            0,
            result=VisionAnalysisResult(
                image_type="workflow",
                analysis="Workflow metier avec validation manager, controle manuel et escalade Direction.",
                detected_kpis=["Validation manager", "Controle manuel"],
                recommendations=["Simplifier les validations et supprimer les controles manuels."],
                confidence=0.89,
                model="llava",
            ),
        ),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service._generate_with_ollama",
        lambda prompt: asyncio.sleep(
            0,
            result=json.dumps(
                {
                    "answer": "Resume intelligent\nLe workflow montre une complexite elevee et des validations trop presentes.\nRecommandations IA\n- Automatiser les validations et reduire l'escalade.",
                    "detected_kpis": ["Complexite workflow 78/100"],
                    "detected_anomalies": ["Controle manuel sur une etape critique."],
                    "recommendations": ["Automatiser les validations et reduire l'escalade."],
                    "confidence": 0.91,
                }
            ),
        ),
    )

    response = asyncio.run(
        generate_image_chat_response(
            FakeRequest(),
            db_session,
            question="Explique ce workflow telecom",
            history=[],
            image_bytes=b"fake-workflow",
            filename="workflow-telecom.png",
            content_type="image/png",
            analysis_mode="advanced",
            conversation_id="conv-workflow-1",
        )
    )

    assert response.image_type == "workflow"
    assert response.workflow_details is not None
    assert response.workflow_details.workflow_type == "processus_metier"
    assert response.workflow_details.complexity_score == 78
    assert "Support IT -> Validation manager" in response.workflow_details.critical_steps
    assert response.annotations[0].label == "Zone complexe"
    assert any(
        recommendation.title == "Simplifier workflow multi-etapes"
        for recommendation in response.decision_recommendations
    )
    assert any(
        recommendation.title == "Traiter points de blocage du workflow"
        for recommendation in response.decision_recommendations
    )


def test_generate_image_chat_response_structures_equipment_analysis(
    db_session: Session,
    monkeypatch,
) -> None:
    summary = build_summary()

    class FakeRequest:
        async def is_disconnected(self) -> bool:
            return False

    monkeypatch.setattr(
        "app.services.multimodal_chat_service.get_data_summary",
        lambda db: summary,
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.prepare_image_for_analysis",
        lambda image_bytes, filename, content_type: PreparedImage(
            original_bytes=image_bytes,
            processed_bytes=b"processed-equipment",
            media_type="image/png",
            width=1280,
            height=860,
        ),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.extract_image_ocr",
        lambda image_bytes: OcrExtractionResult(
            text="Cisco Router RV340 Serial FTX12345 Batterie gonflee visible Firmware 1.0.3",
            lines=[
                "Cisco Router RV340",
                "Serial FTX12345",
                "Batterie gonflee visible",
                "Firmware 1.0.3",
            ],
            text_regions=[
                OcrTextRegion(text="Cisco Router RV340", bbox=(24, 20, 260, 38), confidence=0.93),
                OcrTextRegion(text="Serial FTX12345", bbox=(24, 86, 200, 34), confidence=0.89),
                OcrTextRegion(text="Batterie gonflee visible", bbox=(320, 220, 260, 40), confidence=0.91),
            ],
            amounts_mad=[],
            operators=[],
            departments=[],
            alerts=[],
            kpis=[],
            visible_tables=[],
            confidence=0.9,
            invoice_details=None,
            incident_details=None,
            workflow_details=None,
            equipment_details=EquipmentDocumentDetails(
                equipment_type="routeur",
                brand="Cisco",
                model="RV340",
                serial_number="FTX12345",
                operator=None,
                visible_condition="batterie gonflee suspectee",
                device_version="1.0.3",
                sim_information=None,
                label_information="Cisco RV340",
                usage_summary="Assure la connectivite WAN/LAN du site ou des lignes de flotte.",
                detected_issues=["Batterie gonflee visible ou fortement suspectee."],
                maintenance_recommendations=["Isoler l'appareil et remplacer la batterie sans delai."],
                replacement_needed=True,
                condition_score=38,
                criticality_score=84,
                obsolescence_score=46,
                maintenance_score=82,
                summary="Equipement routeur, etat batterie gonflee suspectee, criticite 84/100.",
            ),
        ),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.build_image_annotations",
        lambda *args, **kwargs: ImageAnnotationResult(
            highlighted_image="data:image/png;base64,fake-equipment-annotation",
            annotations=[
                ImageAnnotation(
                    label="Defaut visible",
                    type="risk",
                    bbox=(320, 220, 260, 40),
                    confidence=0.92,
                )
            ],
        ),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.analyze_image_with_llava",
        lambda **kwargs: asyncio.sleep(
            0,
            result=VisionAnalysisResult(
                image_type="equipement",
                analysis="Routeur Cisco avec batterie gonflee visible et risque materiel eleve.",
                detected_kpis=["Etat equipement 38/100", "Criticite equipement 84/100"],
                recommendations=["Remplacer le routeur ou la batterie avant remise en service."],
                confidence=0.9,
                model="llava",
            ),
        ),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service._generate_with_ollama",
        lambda prompt: asyncio.sleep(
            0,
            result=json.dumps(
                {
                    "answer": "Resume intelligent\nL'equipement presente un risque materiel eleve qui peut affecter la continuite de service.\nRecommandations IA\n- Isoler puis remplacer l'equipement.",
                    "detected_kpis": ["Etat equipement 38/100", "Criticite equipement 84/100"],
                    "detected_anomalies": ["Batterie gonflee visible ou fortement suspectee."],
                    "recommendations": ["Isoler puis remplacer l'equipement."],
                    "confidence": 0.94,
                }
            ),
        ),
    )

    response = asyncio.run(
        generate_image_chat_response(
            FakeRequest(),
            db_session,
            question="Ce routeur semble-t-il endommage ?",
            history=[],
            image_bytes=b"fake-equipment",
            filename="routeur-cisco.png",
            content_type="image/png",
            analysis_mode="advanced",
            conversation_id="conv-equipment-1",
        )
    )

    assert response.image_type == "equipement"
    assert response.equipment_details is not None
    assert response.equipment_details.brand == "Cisco"
    assert response.equipment_details.model == "RV340"
    assert response.equipment_details.replacement_needed is True
    assert response.equipment_details.condition_score == 38
    assert response.annotations[0].label == "Defaut visible"
    assert response.risk_level == "critical"
    assert any(
        recommendation.title == "Remplacer equipement a risque"
        for recommendation in response.decision_recommendations
    )


def test_generate_image_chat_response_equipment_photo_answers_what_do_you_see_from_visible_objects_only(
    db_session: Session,
    monkeypatch,
) -> None:
    request, captured_prompt = _setup_equipment_photo_pipeline(
        monkeypatch,
        summary=build_summary(),
    )

    response = asyncio.run(
        generate_image_chat_response(
            request,
            db_session,
            question="Que vois-tu sur cette image ?",
            history=[],
            image_bytes=b"fake-equipment-photo",
            filename="telecom-photo.png",
            content_type="image/png",
            analysis_mode="advanced",
            conversation_id="conv-equipment-vision-1",
        )
    )

    assert response.image_type == "equipement"
    assert response.analysis_metadata is not None
    assert response.analysis_metadata.source_mode == "vision_only"
    assert response.analysis_metadata.blocked_global_context is True
    assert "prompt" not in captured_prompt
    assert "Inventaire visuel" in response.answer
    assert "Etat apparent" in response.answer
    assert "Modernisation potentielle" in response.answer
    assert "Niveau de confiance" in response.answer
    assert "- Smartphone Samsung" in response.answer
    assert "- Routeur Huawei 4G/5G" in response.answer
    assert "- Modem USB 4G LTE" in response.answer
    assert "- Carte SIM Maroc Telecom" in response.answer
    assert "- Carte SIM Inwi" in response.answer
    assert "- Nano SIM" in response.answer
    assert "93%" in response.answer
    assert "roaming" not in response.answer.lower()
    assert "forfait" not in response.answer.lower()
    assert "budget" not in response.answer.lower()
    assert "fleet_ai_results_morocco.csv" not in response.sources
    assert "phone_lines" not in response.sources
    assert response.equipment_details is not None
    assert response.equipment_details.brand == "Huawei"
    assert response.equipment_details.visible_condition == "fonctionnel"


def test_generate_image_chat_response_equipment_photo_answers_identification_without_dataset_leakage(
    db_session: Session,
    monkeypatch,
) -> None:
    request, _captured_prompt = _setup_equipment_photo_pipeline(
        monkeypatch,
        summary=build_summary(),
    )

    response = asyncio.run(
        generate_image_chat_response(
            request,
            db_session,
            question="Identifie les equipements presents sur cette image.",
            history=[],
            image_bytes=b"fake-equipment-photo",
            filename="telecom-photo.png",
            content_type="image/png",
            analysis_mode="advanced",
            conversation_id="conv-equipment-vision-2",
        )
    )

    assert response.answer.count("Carte SIM") >= 2
    assert "Inventaire visuel" in response.answer
    assert "Etat apparent" in response.answer
    assert "Modernisation potentielle" in response.answer
    assert "Niveau de confiance" in response.answer
    assert "Verifier l'anciennete du modem USB." in response.answer
    assert "Controler la consommation et l'affectation des cartes SIM visibles." in response.answer
    assert "Aucun signe visuel ne justifie un remplacement immediat." in response.answer
    assert "Une modernisation peut etre etudiee uniquement si les besoins de debit, de couverture ou de disponibilite le justifient." in response.answer
    assert "routeur 5g" not in response.answer.lower()
    assert "- Routeur Huawei 4G/5G" in response.answer
    assert "- Smartphone Samsung" in response.answer
    assert "roaming_line_count" not in response.answer
    assert "anomalie_count" not in response.answer
    assert response.analysis_metadata is not None
    assert response.analysis_metadata.source_mode == "vision_only"


def test_generate_image_chat_response_equipment_photo_keeps_vision_only_when_question_mentions_role_of_visible_equipment(
    db_session: Session,
    monkeypatch,
    caplog,
) -> None:
    request, captured_prompt = _setup_equipment_photo_pipeline(
        monkeypatch,
        summary=build_summary(),
        llm_response={
            "answer": (
                "Inventaire visuel\n"
                "Confirme\n"
                "- Smartphone Samsung\n"
                "- Routeur Huawei 4G/5G\n\n"
                "Utilisation probable des equipements\n"
                "- Smartphone Samsung: Communication mobile et applications metier.\n"
                "- Routeur Huawei 4G/5G: Connectivite mobile et Internet d'entreprise.\n"
            ),
            "detected_kpis": ["KPI visuel inutile a ignorer"],
            "recommendations": ["Decrire le role du routeur et du smartphone."],
            "confidence": 0.88,
        },
    )
    caplog.set_level(logging.INFO, logger="app.chat.multimodal")

    response = asyncio.run(
        generate_image_chat_response(
            request,
            db_session,
            question="A quoi servent les differents equipements visibles ?",
            history=[],
            image_bytes=b"fake-equipment-photo",
            filename="telecom-photo.png",
            content_type="image/png",
            analysis_mode="advanced",
            conversation_id="conv-equipment-vision-role-1",
        )
    )

    assert response.analysis_metadata is not None
    assert response.analysis_metadata.source_mode == "vision_only"
    assert response.analysis_metadata.blocked_global_context is True
    assert "prompt" not in captured_prompt
    assert "fleet_ai_results_morocco.csv" not in response.sources
    assert "phone_lines" not in response.sources
    assert "Utilisation probable des equipements" in response.answer
    assert "- Routeur Huawei 4G/5G" in response.answer
    assert "Impact financier estime" not in response.answer
    assert "Optimiser forfait data" not in response.answer
    assert "Migrer vers forfait moins cher" not in response.answer
    assert "Alertes critiques" not in response.answer
    assert "Risque fraude" not in response.answer
    assert "image_business_model_started" not in caplog.text
    assert "QUESTION_TYPE=EQUIPMENT_DETECTION" in caplog.text
    assert "IMAGE_TYPE=equipement" in caplog.text
    assert "VISION_ROUTING=EQUIPMENT" in caplog.text
    assert "VISION_ROUTING = EQUIPMENT" in caplog.text
    assert "VISION_ROUTING_REASON = physical_objects_detected" in caplog.text


def test_generate_image_chat_response_equipment_photo_marks_ambiguous_object_as_uncertain(
    db_session: Session,
    monkeypatch,
) -> None:
    request, _captured_prompt = _setup_equipment_photo_pipeline(
        monkeypatch,
        summary=build_summary(),
        vision_result=VisionAnalysisResult(
            image_type="equipement",
            analysis="Photo telecom avec routeur, smartphone, cartes SIM et un petit objet ambigu.",
            detected_kpis=["Equipements detectes 5"],
            recommendations=["Verifier les references visibles avant arbitrage technique."],
            confidence=0.87,
            model="llava",
            detected_objects=[
                "Smartphone Samsung",
                "Routeur Huawei 4G/5G",
                "Carte SIM Maroc Telecom",
                "Cable USB",
                "Carte bancaire ou adaptateur SIM",
            ],
            detected_brands=["Samsung", "Huawei"],
            detected_operators=["Maroc Telecom"],
            sim_types=["Nano SIM"],
            primary_equipment="Routeur Huawei 4G/5G",
            apparent_condition="fonctionnel",
            probable_usage="Connectivite mobile et Internet d'entreprise",
            replacement_signals=[],
            raw_output=(
                "TYPE_IMAGE: equipement\n"
                "DETECTED_OBJECTS:\n"
                "- Smartphone Samsung\n"
                "- Routeur Huawei 4G/5G\n"
                "- Carte SIM Maroc Telecom\n"
                "- Cable USB\n"
                "- Carte bancaire ou adaptateur SIM\n"
                "PRIMARY_EQUIPMENT: Routeur Huawei 4G/5G\n"
                "APPARENT_CONDITION: fonctionnel\n"
                "PROBABLE_USAGE: Connectivite mobile et Internet d'entreprise\n"
            ),
        ),
    )

    response = asyncio.run(
        generate_image_chat_response(
            request,
            db_session,
            question="Identifie les equipements presents sur cette image.",
            history=[],
            image_bytes=b"fake-equipment-photo",
            filename="telecom-photo-ambiguous.png",
            content_type="image/png",
            analysis_mode="advanced",
            conversation_id="conv-equipment-vision-ambiguous",
        )
    )

    assert "Inventaire visuel" in response.answer
    assert "Probable" in response.answer
    assert "Incertain" in response.answer
    assert "- Cable USB" in response.answer
    assert "- Carte bancaire ou adaptateur SIM" in response.answer
    assert "87%" in response.answer


def test_generate_image_chat_response_equipment_detection_timeout_blocks_business_fallback(
    db_session: Session,
    monkeypatch,
    caplog,
) -> None:
    request, _captured_prompt = _setup_equipment_photo_pipeline(
        monkeypatch,
        summary=build_summary(),
    )
    llm_called = False

    async def raise_image_timeout(**kwargs):
        raise ImageAnalysisTimeoutError()

    async def track_generate_with_ollama(prompt: str, timeout_seconds: int | None = None) -> str:
        nonlocal llm_called
        llm_called = True
        return json.dumps({"answer": "Ne devrait jamais etre appele."})

    monkeypatch.setattr(
        "app.services.multimodal_chat_service.analyze_image_with_llava",
        raise_image_timeout,
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.extract_image_ocr",
        lambda image_bytes: _build_equipment_photo_ocr_result(),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service._generate_with_ollama",
        track_generate_with_ollama,
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.extract_image_ocr",
        lambda image_bytes: _build_equipment_photo_ocr_result(),
    )
    caplog.set_level(logging.INFO, logger="app.chat.multimodal")

    response = asyncio.run(
        generate_image_chat_response(
            request,
            db_session,
            question="Identifie tous les equipements presents sur cette image",
            history=[],
            image_bytes=b"fake-equipment-photo",
            filename="telecom-photo-timeout.png",
            content_type="image/png",
            analysis_mode="advanced",
            conversation_id="conv-equipment-vision-timeout",
        )
    )

    assert "Analyse visuelle indisponible actuellement" not in response.answer
    assert "Voici une lecture visuelle prudente des equipements visibles." in response.answer
    assert "L'analyse approfondie n'a pas pu etre finalisee" not in response.answer
    assert "vision approfondie" not in response.answer.lower()
    assert "Inventaire visuel" in response.answer
    assert "Etat apparent" in response.answer
    assert "Modernisation potentielle" in response.answer
    assert "Niveau de confiance" in response.answer
    assert "- Smartphone Samsung" in response.answer
    assert "- Routeur Huawei" in response.answer
    assert "- Carte SIM Maroc Telecom" in response.answer
    assert "Aucun signe visuel ne justifie un remplacement immediat." in response.answer
    assert "photo plus nette" not in response.answer.lower()
    assert response.answer.strip() != ""
    assert response.analysis_metadata is not None
    assert response.analysis_metadata.source_mode == "vision_only"
    assert response.analysis_metadata.blocked_global_context is True
    assert "roaming" not in response.answer.lower()
    assert "cout" not in response.answer.lower()
    assert "fraude" not in response.answer.lower()
    assert response.detected_kpis == []
    assert response.recommendation_notice is not None
    assert "image et les equipements visibles" in response.recommendation_notice.lower()
    assert "fleet_ai_results_morocco.csv" not in response.sources
    assert "phone_lines" not in response.sources
    assert "vision:vision-fallback" in response.sources
    assert response.processing_message == (
        "Analyse visuelle avancee indisponible, reponse basee sur une detection visuelle limitee."
    )
    assert llm_called is False
    assert "QUESTION_TYPE = EQUIPMENT_DETECTION" in caplog.text
    assert "VISION_ONLY_MODE = TRUE" in caplog.text
    assert "VISION_TIMEOUT = TRUE" in caplog.text
    assert "GLOBAL_CONTEXT_BLOCKED = TRUE" in caplog.text
    assert "timeout_seconds=120" in caplog.text
    assert "FALLBACK_TEMPLATE_USED = telecom_visible_fallback" in caplog.text
    assert "DETECTED_IMAGE_CATEGORY = telecom" in caplog.text
    assert "DETECTED_OBJECTS =" in caplog.text
    assert "event=image_vision_fallback_selected" in caplog.text
    assert "image_business_model_started" not in caplog.text
    assert "routing_mode=standard" not in caplog.text


def test_generate_image_chat_response_equipment_detection_unavailable_blocks_business_fallback(
    db_session: Session,
    monkeypatch,
    caplog,
) -> None:
    request, _captured_prompt = _setup_equipment_photo_pipeline(
        monkeypatch,
        summary=build_summary(),
    )
    llm_called = False

    async def raise_vision_unavailable(**kwargs):
        raise VisionUnavailableError("Analyse visuelle indisponible.")

    async def track_generate_with_ollama(prompt: str, timeout_seconds: int | None = None) -> str:
        nonlocal llm_called
        llm_called = True
        return json.dumps({"answer": "Ne devrait jamais etre appele."})

    monkeypatch.setattr(
        "app.services.multimodal_chat_service.analyze_image_with_llava",
        raise_vision_unavailable,
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service._generate_with_ollama",
        track_generate_with_ollama,
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.extract_image_ocr",
        lambda image_bytes: _build_equipment_photo_ocr_result(),
    )
    caplog.set_level(logging.INFO, logger="app.chat.multimodal")

    response = asyncio.run(
        generate_image_chat_response(
            request,
            db_session,
            question="Identifie tous les equipements presents sur cette image",
            history=[],
            image_bytes=b"fake-equipment-photo",
            filename="telecom-photo-unavailable.png",
            content_type="image/png",
            analysis_mode="advanced",
            conversation_id="conv-equipment-vision-unavailable",
        )
    )

    assert "Analyse visuelle indisponible actuellement" not in response.answer
    assert "Voici une lecture visuelle prudente des equipements visibles." in response.answer
    assert "L'analyse approfondie n'a pas pu etre finalisee" not in response.answer
    assert "vision approfondie" not in response.answer.lower()
    assert "- Smartphone Samsung" in response.answer
    assert "- Routeur Huawei" in response.answer
    assert "photo plus nette" not in response.answer.lower()
    assert response.analysis_metadata is not None
    assert response.analysis_metadata.source_mode == "vision_only"
    assert response.analysis_metadata.blocked_global_context is True
    assert response.detected_kpis == []
    assert "fleet_ai_results_morocco.csv" not in response.sources
    assert "phone_lines" not in response.sources
    assert llm_called is False
    assert "QUESTION_TYPE = EQUIPMENT_DETECTION" in caplog.text
    assert "VISION_ONLY_MODE = TRUE" in caplog.text
    assert "VISION_TIMEOUT = FALSE" in caplog.text
    assert "GLOBAL_CONTEXT_BLOCKED = TRUE" in caplog.text
    assert "image_business_model_started" not in caplog.text
    assert "routing_mode=standard" not in caplog.text


def test_generate_image_chat_response_equipment_modernization_timeout_stays_prudent_and_visual_only(
    db_session: Session,
    monkeypatch,
) -> None:
    request, _captured_prompt = _setup_equipment_photo_pipeline(
        monkeypatch,
        summary=build_summary(),
    )

    async def raise_image_timeout(**kwargs):
        raise ImageAnalysisTimeoutError()

    monkeypatch.setattr(
        "app.services.multimodal_chat_service.analyze_image_with_llava",
        raise_image_timeout,
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.extract_image_ocr",
        lambda image_bytes: _build_equipment_photo_ocr_result(),
    )

    response = asyncio.run(
        generate_image_chat_response(
            request,
            db_session,
            question="Quels equipements pourraient etre remplaces ou modernises ?",
            history=[],
            image_bytes=b"fake-equipment-photo-modernization",
            filename="telecom-photo-modernization.png",
            content_type="image/png",
            analysis_mode="advanced",
            conversation_id="conv-equipment-vision-modernization-timeout",
        )
    )

    assert "Aucun signe visuel ne justifie un remplacement immediat." in response.answer
    assert "Une modernisation peut etre etudiee uniquement si les besoins de debit, de couverture ou de disponibilite le justifient." in response.answer
    assert "roaming" not in response.answer.lower()
    assert "cout" not in response.answer.lower()
    assert "fraude" not in response.answer.lower()


def test_generate_image_chat_response_equipment_role_question_timeout_stays_visual_only(
    db_session: Session,
    monkeypatch,
) -> None:
    request, _captured_prompt = _setup_equipment_photo_pipeline(
        monkeypatch,
        summary=build_summary(),
    )

    async def raise_image_timeout(**kwargs):
        raise ImageAnalysisTimeoutError()

    monkeypatch.setattr(
        "app.services.multimodal_chat_service.analyze_image_with_llava",
        raise_image_timeout,
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.extract_image_ocr",
        lambda image_bytes: _build_equipment_photo_ocr_result(),
    )

    response = asyncio.run(
        generate_image_chat_response(
            request,
            db_session,
            question="Explique l'utilisation de ce materiel.",
            history=[],
            image_bytes=b"fake-equipment-photo-role-timeout",
            filename="telecom-photo-role-timeout.png",
            content_type="image/png",
            analysis_mode="advanced",
            conversation_id="conv-equipment-vision-role-timeout",
        )
    )

    assert response.image_type == "equipement"
    assert response.analysis_metadata is not None
    assert response.analysis_metadata.source_mode == "vision_only"
    assert response.analysis_metadata.blocked_global_context is True
    assert "Utilisation probable des equipements" in response.answer
    assert "Voici une lecture visuelle prudente des equipements visibles." in response.answer
    assert (
        "- Smartphone Samsung: Communication mobile et applications metier." in response.answer
        or "- Terminal mobile: Appels, messagerie et applications professionnelles." in response.answer
    )
    assert (
        "- Routeur Huawei 4G LTE: Connectivite mobile et Internet d'entreprise." in response.answer
        or "- Routeur/modem: Distribution de la connexion Internet ou Wi-Fi." in response.answer
    )
    assert (
        "- Modem USB Huawei 4G LTE: Le modem USB permet l'acces au reseau mobile via un port USB." in response.answer
        or "- Modem USB Huawei 4G LTE: Acces data mobile via une liaison USB." in response.answer
        or "- Modem USB/cle 4G: Acces Internet mobile ponctuel ou de secours." in response.answer
    )
    assert (
        "- Carte SIM Maroc Telecom: Acces au reseau mobile pour la voix, la data ou la telemetrie." in response.answer
        or "- Carte SIM/support SIM: Identification de la ligne mobile et acces au reseau operateur." in response.answer
    )
    assert "Equipement telecom principal probable" not in response.answer
    assert "1 a 3 objets telecom detectes" not in response.answer
    assert "Impact financier estime" not in response.answer
    assert "Alertes critiques" not in response.answer
    assert "Risque fraude" not in response.answer
    assert "analyse approfondie" not in response.answer.lower()
    assert "vision approfondie" not in response.answer.lower()
    assert "photo plus nette" not in response.answer.lower()
    assert "roaming" not in response.answer.lower()
    assert "cout" not in response.answer.lower()


def test_generate_image_chat_response_equipment_usage_question_timeout_uses_category_roles(
    db_session: Session,
    monkeypatch,
) -> None:
    request, _captured_prompt = _setup_equipment_photo_pipeline(
        monkeypatch,
        summary=build_summary(),
    )

    async def raise_image_timeout(**kwargs):
        raise ImageAnalysisTimeoutError()

    monkeypatch.setattr(
        "app.services.multimodal_chat_service.analyze_image_with_llava",
        raise_image_timeout,
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.extract_image_ocr",
        lambda image_bytes: _build_equipment_photo_ocr_result(),
    )

    response = asyncio.run(
        generate_image_chat_response(
            request,
            db_session,
            question="A quoi servent les equipements visibles ?",
            history=[],
            image_bytes=b"fake-equipment-photo-usage-timeout",
            filename="telecom-photo-usage-timeout.png",
            content_type="image/png",
            analysis_mode="advanced",
            conversation_id="conv-equipment-vision-usage-timeout",
        )
    )

    assert "Utilisation probable des equipements" in response.answer
    assert "Voici une lecture visuelle prudente des equipements visibles." in response.answer
    assert (
        "- Smartphone Samsung: Communication mobile et applications metier." in response.answer
        or "- Terminal mobile: Appels, messagerie et applications professionnelles." in response.answer
    )
    assert (
        "- Routeur Huawei" in response.answer
        and "Connectivite mobile et Internet d'entreprise." in response.answer
    ) or "- Routeur/modem: Distribution de la connexion Internet ou Wi-Fi." in response.answer
    assert (
        "- Modem USB" in response.answer and "Le modem USB permet l'acces au reseau mobile via un port USB." in response.answer
    ) or (
        "- Modem USB" in response.answer and "Acces data mobile via une liaison USB." in response.answer
    ) or "- Modem USB/cle 4G: Acces Internet mobile ponctuel ou de secours." in response.answer
    assert (
        "- Carte SIM Maroc Telecom: Acces au reseau mobile pour la voix, la data ou la telemetrie."
        in response.answer
        or "- Carte SIM/support SIM: Identification de la ligne mobile et acces au reseau operateur."
        in response.answer
    )
    assert "1 a 3 objets telecom detectes" not in response.answer
    assert "Equipement non identifie" not in response.answer
    assert "analyse approfondie" not in response.answer.lower()
    assert "vision approfondie" not in response.answer.lower()
    assert "photo plus nette" not in response.answer.lower()
    assert "roaming" not in response.answer.lower()
    assert "cout" not in response.answer.lower()
    assert "fraude" not in response.answer.lower()


def test_generate_image_chat_response_equipment_timeout_with_blank_ocr_uses_neutral_visual_fallback(
    db_session: Session,
    monkeypatch,
) -> None:
    request, _captured_prompt = _setup_equipment_photo_pipeline(
        monkeypatch,
        summary=build_summary(),
    )
    captured_timeout: int | None = None

    async def raise_image_timeout(**kwargs):
        nonlocal captured_timeout
        captured_timeout = kwargs.get("timeout_seconds")
        raise ImageAnalysisTimeoutError()

    monkeypatch.setattr(
        "app.services.multimodal_chat_service.analyze_image_with_llava",
        raise_image_timeout,
    )

    response = asyncio.run(
        generate_image_chat_response(
            request,
            db_session,
            question="Quels equipements sont visibles sur cette image ?",
            history=[],
            image_bytes=b"fake-equipment-photo-blank-ocr",
            filename="telecom-photo-blank-ocr-timeout.png",
            content_type="image/png",
            analysis_mode="advanced",
            conversation_id="conv-equipment-vision-blank-ocr-timeout",
        )
    )

    assert "Inventaire visuel" in response.answer
    assert "Voici une lecture visuelle prudente des equipements visibles." in response.answer
    assert "- Objet principal visible non confirme automatiquement" in response.answer
    assert "- Environnement ou support visible" in response.answer
    assert "- Fonction exacte non confirmee automatiquement a partir de l'image." in response.answer
    assert "0 objet telecom detecte" not in response.answer
    assert "1 a 3 objets telecom detectes" not in response.answer
    assert "Objet non identifie avec certitude" not in response.answer
    assert "Etiquette equipement non lisible ou absente" not in response.answer
    assert "Equipement telecom principal probable" not in response.answer
    assert "Terminal de communication probable" not in response.answer
    assert "Terminal mobile identifie visuellement" not in response.answer
    assert "Routeur ou modem reseau apparent" not in response.answer
    assert "Modem USB / cle 4G apparent" not in response.answer
    assert "Carte SIM ou support SIM visible" not in response.answer
    assert "Aucun signe visuel ne justifie un remplacement immediat." in response.answer
    assert "analyse approfondie" not in response.answer.lower()
    assert "vision approfondie" not in response.answer.lower()
    assert "photo plus nette" not in response.answer.lower()
    assert "roaming" not in response.answer.lower()
    assert "cout" not in response.answer.lower()
    assert "fraude" not in response.answer.lower()
    assert captured_timeout is not None
    assert captured_timeout == 120
    assert response.confidence >= 0.56
    assert response.equipment_details is not None
    assert response.equipment_details.detected_issues == []
    assert "objets physiques restent visibles" in (response.equipment_details.summary or "").lower()
    assert "etiquette equipement non lisible ou absente" not in " ".join(
        response.equipment_details.detected_issues
    ).lower()
    assert response.processing_message == (
        "Analyse visuelle avancee indisponible, reponse basee sur une detection visuelle limitee."
    )


def test_generate_image_chat_response_equipment_low_confidence_still_returns_prudent_visual_inventory(
    db_session: Session,
    monkeypatch,
) -> None:
    request, _captured_prompt = _setup_equipment_photo_pipeline(
        monkeypatch,
        summary=build_summary(),
        vision_result=VisionAnalysisResult(
            image_type="equipement",
            analysis="Photo telecom partiellement interpretable avec un objet principal peu detaille.",
            detected_kpis=[],
            recommendations=[],
            confidence=0.31,
            model="llava",
            detected_objects=["Objet non identifie avec certitude"],
            detected_brands=[],
            detected_operators=[],
            sim_types=[],
            primary_equipment=None,
            apparent_condition="non confirme visuellement",
            probable_usage=None,
            replacement_signals=[],
            raw_output="TYPE_IMAGE: equipement\nDETECTED_OBJECTS:\n- Objet non identifie avec certitude",
        ),
    )

    response = asyncio.run(
        generate_image_chat_response(
            request,
            db_session,
            question="Quels equipements sont visibles sur cette image ?",
            history=[],
            image_bytes=b"fake-equipment-photo-low-confidence",
            filename="telecom-photo-low-confidence.png",
            content_type="image/png",
            analysis_mode="advanced",
            conversation_id="conv-equipment-vision-low-confidence",
        )
    )

    assert response.fallback_used is True
    assert "Inventaire visuel" in response.answer
    assert "- Objet principal visible non confirme automatiquement" in response.answer
    assert "- Environnement ou support visible" in response.answer
    assert "Aucun signe visuel ne justifie un remplacement immediat." in response.answer
    assert "Equipement telecom principal probable" not in response.answer
    assert "Terminal de communication probable" not in response.answer
    assert "Routeur ou modem reseau apparent" not in response.answer
    assert response.analysis_metadata is not None
    assert response.analysis_metadata.source_mode == "vision_only"
    assert response.analysis_metadata.blocked_global_context is True
    assert "fleet_ai_results_morocco.csv" not in response.sources
    assert "phone_lines" not in response.sources


def test_generate_image_chat_response_vehicle_timeout_does_not_invent_telecom_equipment(
    db_session: Session,
    monkeypatch,
    caplog,
) -> None:
    request, _captured_prompt = _setup_equipment_photo_pipeline(
        monkeypatch,
        summary=build_summary(),
    )

    async def raise_image_timeout(**kwargs):
        raise ImageAnalysisTimeoutError()

    monkeypatch.setattr(
        "app.services.multimodal_chat_service.analyze_image_with_llava",
        raise_image_timeout,
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.extract_image_ocr",
        lambda image_bytes: _build_equipment_photo_ocr_result(text=""),
    )
    vehicle_image_bytes = _build_synthetic_vehicle_scene_bytes()
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.prepare_image_for_analysis",
        lambda image_bytes, filename, content_type, max_side=None: PreparedImage(
            original_bytes=vehicle_image_bytes,
            processed_bytes=vehicle_image_bytes,
            media_type="image/png",
            width=640,
            height=360,
        ),
    )
    caplog.set_level(logging.INFO, logger="app.chat.multimodal")

    response = asyncio.run(
        generate_image_chat_response(
            request,
            db_session,
            question="Quels equipements sont visibles ?",
            history=[],
            image_bytes=b"fake-vehicle-photo-timeout",
            filename="scene-timeout.png",
            content_type="image/png",
            analysis_mode="advanced",
            conversation_id="conv-equipment-vehicle-timeout",
        )
    )

    assert "Inventaire visuel" in response.answer
    assert "- Vehicule apparent" in response.answer
    assert "- Roues visibles" in response.answer
    assert "- Carrosserie visible" in response.answer
    assert "- Zone de stationnement visible" in response.answer
    assert "- Environnement exterieur visible" in response.answer
    assert "Le vehicule sert au transport ou au deplacement professionnel." in response.answer
    assert "Routeur" not in response.answer
    assert "Carte SIM" not in response.answer
    assert "Modem USB" not in response.answer
    assert "Smartphone" not in response.answer
    assert response.processing_message == (
        "Analyse visuelle avancee indisponible, reponse basee sur une detection visuelle limitee."
    )
    assert "FALLBACK_TEMPLATE_USED = vehicle_fallback" in caplog.text
    assert "DETECTED_IMAGE_CATEGORY = vehicule" in caplog.text
    assert "DETECTED_OBJECTS = ['Vehicule apparent'" in caplog.text


def test_generate_image_chat_response_router_timeout_uses_network_equipment_fallback(
    db_session: Session,
    monkeypatch,
    caplog,
) -> None:
    request, _captured_prompt = _setup_equipment_photo_pipeline(
        monkeypatch,
        summary=build_summary(),
    )

    async def raise_image_timeout(**kwargs):
        raise ImageAnalysisTimeoutError()

    monkeypatch.setattr(
        "app.services.multimodal_chat_service.analyze_image_with_llava",
        raise_image_timeout,
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.extract_image_ocr",
        lambda image_bytes: _build_equipment_photo_ocr_result(text=""),
    )
    router_image_bytes = _build_synthetic_router_scene_bytes()
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.prepare_image_for_analysis",
        lambda image_bytes, filename, content_type, max_side=None: PreparedImage(
            original_bytes=router_image_bytes,
            processed_bytes=router_image_bytes,
            media_type="image/png",
            width=640,
            height=360,
        ),
    )
    caplog.set_level(logging.INFO, logger="app.chat.multimodal")

    response = asyncio.run(
        generate_image_chat_response(
            request,
            db_session,
            question="Quels equipements sont visibles ?",
            history=[],
            image_bytes=b"fake-router-photo-timeout",
            filename="scene-routeur-timeout.png",
            content_type="image/png",
            analysis_mode="advanced",
            conversation_id="conv-equipment-router-timeout",
        )
    )

    assert "Inventaire visuel" in response.answer
    assert "- Routeur Wi-Fi apparent" in response.answer
    assert "- Antennes reseau visibles" in response.answer
    assert "- Boitier reseau visible" in response.answer
    assert "- Voyants ou ports apparents" in response.answer
    assert "- Routeur Wi-Fi: Le routeur permet de distribuer la connexion Internet ou Wi-Fi." in response.answer
    assert "- Antennes reseau: Les antennes servent a ameliorer la couverture reseau." in response.answer
    assert "- Voyants/ports: Les voyants ou ports servent au suivi de l'etat de connexion et au raccordement." in response.answer
    assert "non confirme visuellement" in response.answer.lower()
    assert "Vehicule apparent" not in response.answer
    assert "Roues visibles" not in response.answer
    assert "Carrosserie visible" not in response.answer
    assert "Modem USB" not in response.answer
    assert "Carte SIM" not in response.answer
    assert "Switch" not in response.answer
    assert "Borne WiFi" not in response.answer
    assert "Antenne telecom" not in response.answer
    assert "Cable reseau" not in response.answer
    assert "roaming" not in response.answer.lower()
    assert "cout" not in response.answer.lower()
    assert "fraude" not in response.answer.lower()
    assert response.processing_message == (
        "Analyse visuelle avancee indisponible, reponse basee sur une detection visuelle limitee."
    )
    assert "ROUTER_CONFIDENCE=" in caplog.text
    assert "ROUTER_ANTENNA_SCORE=" in caplog.text
    assert "ROUTER_ANTENNA_DETECTED=True" in caplog.text
    assert "ROUTER_ANTENNA_LEFT_DETECTED=True" in caplog.text
    assert "ROUTER_ANTENNA_RIGHT_DETECTED=True" in caplog.text
    assert "ROUTER_ANTENNA_COUNT=2" in caplog.text
    assert "DETECTED_OBJECTS_AFTER_ANTENNA=['Routeur Wi-Fi apparent', 'Antennes reseau visibles', 'Boitier reseau visible', 'Voyants ou ports apparents']" in caplog.text
    assert "FALLBACK_TEMPLATE_USED = network_equipment_fallback" in caplog.text
    assert "DETECTED_IMAGE_CATEGORY = routeur_wifi" in caplog.text
    assert "DETECTED_OBJECTS = ['Routeur Wi-Fi apparent', 'Antennes reseau visibles', 'Boitier reseau visible', 'Voyants ou ports apparents']" in caplog.text


def test_generate_image_chat_response_router_without_antennas_does_not_add_antenna_label(
    db_session: Session,
    monkeypatch,
    caplog,
) -> None:
    request, _captured_prompt = _setup_equipment_photo_pipeline(
        monkeypatch,
        summary=build_summary(),
    )

    async def raise_image_timeout(**kwargs):
        raise ImageAnalysisTimeoutError()

    monkeypatch.setattr(
        "app.services.multimodal_chat_service.analyze_image_with_llava",
        raise_image_timeout,
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.extract_image_ocr",
        lambda image_bytes: _build_equipment_photo_ocr_result(text=""),
    )
    router_image_bytes = _build_synthetic_router_without_antennas_scene_bytes()
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.prepare_image_for_analysis",
        lambda image_bytes, filename, content_type, max_side=None: PreparedImage(
            original_bytes=router_image_bytes,
            processed_bytes=router_image_bytes,
            media_type="image/png",
            width=640,
            height=360,
        ),
    )
    caplog.set_level(logging.INFO, logger="app.chat.multimodal")

    response = asyncio.run(
        generate_image_chat_response(
            request,
            db_session,
            question="Quels equipements sont visibles ?",
            history=[],
            image_bytes=b"fake-router-photo-no-antennas",
            filename="scene-routeur-sans-antennes.png",
            content_type="image/png",
            analysis_mode="advanced",
            conversation_id="conv-equipment-router-no-antennas",
        )
    )

    assert "- Routeur Wi-Fi apparent" in response.answer
    assert "- Boitier reseau visible" in response.answer
    assert "- Voyants ou ports apparents" in response.answer
    assert "- Antennes reseau visibles" not in response.answer
    assert "Modem USB" not in response.answer
    assert "Carte SIM" not in response.answer
    assert "Switch" not in response.answer
    assert "Cable reseau" not in response.answer
    assert "ROUTER_CONFIDENCE=" in caplog.text
    assert "ROUTER_ANTENNA_SCORE=" in caplog.text
    assert "ROUTER_ANTENNA_DETECTED=False" in caplog.text
    assert "ROUTER_ANTENNA_LEFT_DETECTED=False" in caplog.text
    assert "ROUTER_ANTENNA_RIGHT_DETECTED=False" in caplog.text
    assert "ROUTER_ANTENNA_COUNT=0" in caplog.text
    assert "FALLBACK_TEMPLATE_USED = network_equipment_fallback" in caplog.text


def test_sanitize_network_equipment_objects_strips_non_visible_router_claims() -> None:
    parsed_answer = FinalImageAnswer(
        answer="Le visuel montre un routeur avec modem USB, borne WiFi et antenne telecom.",
        detected_kpis=[
            "Routeur visible",
            "Modem USB visible",
            "Antenne telecom visible",
        ],
        recommendations=[
            "Verifier l'anciennete du modem USB.",
            "Verifier l'etat de la borne WiFi.",
            "Confirmer l'etat du routeur visible.",
        ],
        detected_anomalies=[
            "Modem USB a verifier",
            "Antenne telecom a verifier",
        ],
        probable_causes=[
            "Modem USB potentiellement ancien",
            "Borne WiFi possiblement ancienne",
        ],
        severity="moyenne",
        treatment_priority="normale",
        alert_summary="Routeur avec modem USB et borne WiFi visibles.",
        confidence=0.88,
    )
    inventory = [
        EquipmentVisualInventoryItem(
            raw_label=GENERIC_VISIBLE_WIFI_ROUTER_LABEL,
            type_key="routeur_wifi",
            type_label="Routeur Wi-Fi",
            brand=None,
            confidence_label="Probable",
            usage_probable="Le routeur permet de distribuer la connexion Internet ou Wi-Fi.",
        ),
        EquipmentVisualInventoryItem(
            raw_label=GENERIC_VISIBLE_NETWORK_ANTENNAS_LABEL,
            type_key="antennes_reseau",
            type_label="Antennes reseau",
            brand=None,
            confidence_label="Probable",
            usage_probable="Les antennes servent a ameliorer la couverture reseau.",
        ),
        EquipmentVisualInventoryItem(
            raw_label=GENERIC_VISIBLE_NETWORK_CHASSIS_LABEL,
            type_key="boitier_reseau",
            type_label="Boitier reseau",
            brand=None,
            confidence_label="Probable",
            usage_probable="Le boitier reseau regroupe l'electronique de connectivite.",
        ),
        EquipmentVisualInventoryItem(
            raw_label=GENERIC_VISIBLE_NETWORK_PORTS_LABEL,
            type_key="voyant_ports",
            type_label="Voyants ou ports",
            brand=None,
            confidence_label="Probable",
            usage_probable="Les voyants ou ports servent au suivi de l'etat de connexion et au raccordement.",
        ),
    ]

    sanitized = _sanitize_network_equipment_objects(
        parsed_answer=parsed_answer,
        inventory=inventory,
    )

    assert sanitized.answer == "Le visuel montre un routeur Wi-Fi avec des composants reseau visibles."
    assert sanitized.recommendations == [
        "Confirmer l'etat du routeur visible.",
    ]
    assert sanitized.probable_causes == []
    assert sanitized.detected_anomalies == []
    assert sanitized.detected_kpis == ["Routeur visible"]
    assert sanitized.alert_summary == "Routeur Wi-Fi visible avec composants reseau apparents."


def test_build_network_equipment_fallback_objects_detects_dual_side_antennas_on_asus_like_router_scene(
    caplog,
) -> None:
    router_image_bytes = _build_synthetic_router_scene_bytes()
    prepared_image = PreparedImage(
        original_bytes=router_image_bytes,
        processed_bytes=router_image_bytes,
        media_type="image/png",
        width=640,
        height=360,
    )
    caplog.set_level(logging.INFO, logger="app.chat.multimodal")

    detected_objects = _build_network_equipment_fallback_objects(prepared_image=prepared_image)

    assert detected_objects == [
        "Routeur Wi-Fi apparent",
        "Antennes reseau visibles",
        "Boitier reseau visible",
        "Voyants ou ports apparents",
    ]
    assert "ROUTER_ANTENNA_LEFT_DETECTED=True" in caplog.text
    assert "ROUTER_ANTENNA_RIGHT_DETECTED=True" in caplog.text
    assert "ROUTER_ANTENNA_COUNT=2" in caplog.text


def test_build_network_equipment_fallback_objects_adds_antennas_with_high_router_confidence(
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        "app.services.multimodal_chat_service._extract_network_equipment_visual_cues",
        lambda prepared_image: {
            "router_body_detected": True,
            "vertical_antennas_detected": False,
            "status_ports_detected": True,
            "network_shape_detected": True,
            "antenna_score": 0.0,
            "antenna_candidate_score": 0.18,
            "router_confidence": 0.87,
        },
    )

    detected_objects = _build_network_equipment_fallback_objects(prepared_image=None)

    assert detected_objects == [
        "Routeur Wi-Fi apparent",
        "Antennes reseau visibles",
        "Boitier reseau visible",
        "Voyants ou ports apparents",
    ]
    assert "Modem USB" not in detected_objects
    assert "Carte SIM" not in detected_objects
    assert "Switch" not in detected_objects
    assert "Borne WiFi" not in detected_objects
    assert "Antenne telecom" not in detected_objects
    assert "Cable reseau" not in detected_objects


def test_build_network_equipment_fallback_objects_adds_antennas_when_single_side_detected(
    monkeypatch,
    caplog,
) -> None:
    monkeypatch.setattr(
        "app.services.multimodal_chat_service._extract_network_equipment_visual_cues",
        lambda prepared_image: {
            "router_body_detected": True,
            "vertical_antennas_detected": False,
            "status_ports_detected": True,
            "network_shape_detected": True,
            "antenna_score": 0.0,
            "antenna_candidate_score": 0.0,
            "router_confidence": 0.8,
            "router_antenna_left_detected": True,
            "router_antenna_right_detected": False,
            "router_antenna_count": 1,
        },
    )
    caplog.set_level(logging.INFO, logger="app.chat.multimodal")

    detected_objects = _build_network_equipment_fallback_objects(prepared_image=None)

    assert detected_objects == [
        "Routeur Wi-Fi apparent",
        "Antennes reseau visibles",
        "Boitier reseau visible",
        "Voyants ou ports apparents",
    ]
    assert "ROUTER_ANTENNA_COUNT=1" in caplog.text
    assert "DETECTED_OBJECTS_BEFORE_ANTENNA=['Routeur Wi-Fi apparent']" in caplog.text
    assert "DETECTED_OBJECTS_AFTER_ANTENNA=['Routeur Wi-Fi apparent', 'Antennes reseau visibles', 'Boitier reseau visible', 'Voyants ou ports apparents']" in caplog.text


def test_sanitize_equipment_detected_objects_router_direct_vision_replaces_forbidden_labels(
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        "app.services.multimodal_chat_service._extract_network_equipment_visual_cues",
        lambda prepared_image: {
            "router_body_detected": True,
            "vertical_antennas_detected": True,
            "status_ports_detected": True,
            "network_shape_detected": True,
            "antenna_score": 0.91,
            "antenna_candidate_score": 0.22,
            "router_confidence": 0.9,
        },
    )
    ocr_result = _build_equipment_photo_ocr_result(text="")
    vision_result = VisionAnalysisResult(
        image_type="equipement",
        analysis="Le visuel montre un routeur avec modem USB et antenne telecom.",
        detected_kpis=[],
        recommendations=[],
        confidence=0.91,
        model="llava",
        detected_objects=["Routeur", "Modem USB", "Antenne telecom", "Borne WiFi"],
        detected_brands=[],
        detected_operators=[],
        sim_types=[],
        primary_equipment="Routeur",
        apparent_condition="fonctionnel",
        probable_usage="Connectivite reseau",
        replacement_signals=[],
        raw_output="TYPE_IMAGE: equipement",
    )

    raw_objects, sanitized_objects, removed_objects, sanitizer_applied = sanitize_equipment_detected_objects(
        question_type=QUESTION_TYPE_EQUIPMENT_DETECTION,
        prepared_image=None,
        ocr_result=ocr_result,
        vision_result=vision_result,
    )

    assert sanitizer_applied is True
    assert raw_objects == ["Routeur", "Modem USB", "Antenne telecom", "Borne WiFi"]
    assert sanitized_objects == [
        "Routeur Wi-Fi apparent",
        "Antennes reseau visibles",
        "Boitier reseau visible",
        "Voyants ou ports apparents",
    ]
    assert removed_objects == [
        "Modem USB",
        "Antenne telecom",
        "Borne WiFi",
    ]


def test_sanitize_equipment_detected_objects_router_and_modem_only_still_returns_strict_router_inventory(
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        "app.services.multimodal_chat_service._extract_network_equipment_visual_cues",
        lambda prepared_image: {
            "router_body_detected": True,
            "vertical_antennas_detected": True,
            "status_ports_detected": True,
            "network_shape_detected": True,
            "antenna_score": 0.9,
            "antenna_candidate_score": 0.22,
            "router_confidence": 0.9,
        },
    )
    ocr_result = _build_equipment_photo_ocr_result(text="")
    vision_result = VisionAnalysisResult(
        image_type="equipement",
        analysis="Le visuel montre un routeur avec modem USB.",
        detected_kpis=[],
        recommendations=[],
        confidence=0.9,
        model="llava",
        detected_objects=["Routeur", "Modem USB"],
        detected_brands=[],
        detected_operators=[],
        sim_types=[],
        primary_equipment="Routeur",
        apparent_condition="fonctionnel",
        probable_usage="Connectivite reseau",
        replacement_signals=[],
        raw_output="TYPE_IMAGE: equipement",
    )

    raw_objects, sanitized_objects, removed_objects, sanitizer_applied = sanitize_equipment_detected_objects(
        question_type=QUESTION_TYPE_EQUIPMENT_DETECTION,
        prepared_image=None,
        ocr_result=ocr_result,
        vision_result=vision_result,
    )

    assert sanitizer_applied is True
    assert raw_objects == ["Routeur", "Modem USB"]
    assert sanitized_objects == [
        "Routeur Wi-Fi apparent",
        "Antennes reseau visibles",
        "Boitier reseau visible",
        "Voyants ou ports apparents",
    ]
    assert removed_objects == ["Modem USB"]


def test_generate_image_chat_response_router_direct_vision_filters_non_visible_llava_objects(
    db_session: Session,
    monkeypatch,
    caplog,
) -> None:
    request, _captured_prompt = _setup_equipment_photo_pipeline(
        monkeypatch,
        summary=build_summary(),
        vision_result=VisionAnalysisResult(
            image_type="equipement",
            analysis="Le visuel montre un routeur avec un modem USB, une antenne telecom et une borne WiFi.",
            detected_kpis=[
                "Equipements detectes 4",
                "Routeur avec modem USB visible",
                "Antenne telecom visible",
                "Borne WiFi visible",
            ],
            recommendations=[
                "Verifier l'anciennete du modem USB.",
                "Verifier l'etat de la borne WiFi.",
                "Verifier l'alignement de l'antenne telecom.",
                "Confirmer l'etat du routeur visible.",
            ],
            confidence=0.9,
            model="llava",
            detected_objects=[
                "Routeur",
                "Modem USB",
                "Antenne telecom",
                "Borne WiFi",
            ],
            detected_brands=["Huawei"],
            detected_operators=[],
            sim_types=[],
            primary_equipment="Routeur",
            apparent_condition="fonctionnel",
            probable_usage="Distribution Internet via routeur, borne WiFi et modem USB.",
            replacement_signals=[
                "Verifier le modem USB visible.",
                "Verifier la borne WiFi visible.",
                "Verifier l'antenne telecom visible.",
            ],
            raw_output=(
                "TYPE_IMAGE: equipement\n"
                "DETECTED_OBJECTS:\n"
                "- Routeur\n"
                "- Modem USB\n"
                "- Antenne telecom\n"
                "- Borne WiFi\n"
                "PRIMARY_EQUIPMENT: Routeur\n"
                "APPARENT_CONDITION: fonctionnel\n"
                "PROBABLE_USAGE: Distribution Internet via routeur, borne WiFi et modem USB.\n"
                "REPLACEMENT_SIGNALS:\n"
                "- Verifier le modem USB visible.\n"
                "- Verifier la borne WiFi visible.\n"
                "- Verifier l'antenne telecom visible.\n"
            ),
        ),
        llm_response={
            "answer": "Le visuel montre un routeur avec modem USB, borne WiFi et antenne telecom.",
            "detected_kpis": [
                "Routeur avec modem USB visible",
                "Antenne telecom visible",
                "Borne WiFi visible",
            ],
            "detected_anomalies": [
                "Anciennete du modem USB a verifier",
                "Borne WiFi a verifier",
                "Antenne telecom a verifier",
            ],
            "probable_causes": [
                "Modem USB potentiellement ancien",
                "Borne WiFi possiblement ancienne",
                "Antenne telecom a verifier",
            ],
            "recommendations": [
                "Verifier l'anciennete du modem USB.",
                "Verifier l'etat de la borne WiFi.",
                "Verifier l'alignement de l'antenne telecom.",
                "Confirmer l'etat du routeur visible.",
            ],
            "confidence": 0.88,
        },
    )

    router_image_bytes = _build_synthetic_router_scene_bytes()
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.extract_image_ocr",
        lambda image_bytes: _build_equipment_photo_ocr_result(text=""),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.prepare_image_for_analysis",
        lambda image_bytes, filename, content_type, max_side=None: PreparedImage(
            original_bytes=router_image_bytes,
            processed_bytes=router_image_bytes,
            media_type="image/png",
            width=640,
            height=360,
        ),
    )
    caplog.set_level(logging.INFO, logger="app.chat.multimodal")

    response = asyncio.run(
        generate_image_chat_response(
            request,
            db_session,
            question="Quels equipements sont visibles ?",
            history=[],
            image_bytes=b"fake-router-photo-direct-vision",
            filename="scene-routeur-direct.png",
            content_type="image/png",
            analysis_mode="advanced",
            conversation_id="conv-equipment-router-direct-vision",
        )
    )

    assert "- Routeur Wi-Fi apparent" in response.answer
    assert "- Antennes reseau visibles" in response.answer
    assert "- Boitier reseau visible" in response.answer
    assert "- Voyants ou ports apparents" in response.answer
    assert "Modem USB" not in response.answer
    assert "Carte SIM" not in response.answer
    assert "Switch" not in response.answer
    assert "Borne WiFi" not in response.answer
    assert "Antenne telecom" not in response.answer
    assert "Cable reseau" not in response.answer
    assert "cartes sim" not in response.answer.lower()
    assert "modem usb" not in response.vision_analysis.lower()
    assert "borne wifi" not in response.vision_analysis.lower()
    assert "antenne telecom" not in response.vision_analysis.lower()
    assert all("modem usb" not in item.lower() for item in response.recommendations)
    assert all("borne wifi" not in item.lower() for item in response.recommendations)
    assert all("antenne telecom" not in item.lower() for item in response.recommendations)
    assert all("modem usb" not in item.title.lower() for item in response.decision_recommendations)
    assert all("borne wifi" not in item.title.lower() for item in response.decision_recommendations)
    assert all("antenne telecom" not in item.title.lower() for item in response.decision_recommendations)
    assert all("modem usb" not in item.lower() for item in response.detected_anomalies)
    assert all("borne wifi" not in item.lower() for item in response.detected_anomalies)
    assert all("antenne telecom" not in item.lower() for item in response.detected_anomalies)
    assert response.equipment_details is not None
    assert "modem usb" not in (response.equipment_details.label_information or "").lower()
    assert "borne wifi" not in (response.equipment_details.label_information or "").lower()
    assert "antenne telecom" not in (response.equipment_details.label_information or "").lower()
    assert all(
        "modem usb" not in item.lower()
        and "borne wifi" not in item.lower()
        and "antenne telecom" not in item.lower()
        for item in response.equipment_details.maintenance_recommendations
    )
    assert "modem usb" not in (response.equipment_details.summary or "").lower()
    assert "borne wifi" not in (response.equipment_details.summary or "").lower()
    assert "antenne telecom" not in (response.equipment_details.summary or "").lower()
    assert "image_business_model_started" not in caplog.text
    assert "FALLBACK_TEMPLATE_USED = direct_vision_analysis" in caplog.text
    assert "DETECTED_IMAGE_CATEGORY = routeur_wifi" in caplog.text
    assert "DETECTED_OBJECTS = ['Routeur Wi-Fi apparent'" in caplog.text
    assert "RAW_VISION_OBJECTS=['Routeur', 'Modem USB', 'Antenne telecom', 'Borne WiFi']" in caplog.text
    assert "SANITIZED_VISION_OBJECTS=['Routeur Wi-Fi apparent', 'Antennes reseau visibles', 'Boitier reseau visible', 'Voyants ou ports apparents']" in caplog.text
    assert "REMOVED_HALLUCINATED_OBJECTS=['Modem USB', 'Antenne telecom', 'Borne WiFi']" in caplog.text
    assert "DIRECT_VISION_SANITIZER_APPLIED = TRUE" in caplog.text
    assert "REMOVED_UNCONFIRMED_OBJECTS = ['Modem USB', 'Antenne telecom', 'Borne WiFi']" in caplog.text
    assert "FINAL_EQUIPMENT_OBJECTS = ['Routeur Wi-Fi apparent'" in caplog.text
    assert "FINAL_ANSWER_SANITIZED = Inventaire visuel" in caplog.text
    assert "event=image_vision_equipment_postprocessed profile=router_visible_only" in caplog.text


def test_generate_image_chat_response_router_direct_vision_with_routeur_and_modem_only_keeps_strict_router_labels(
    db_session: Session,
    monkeypatch,
    caplog,
) -> None:
    request, _captured_prompt = _setup_equipment_photo_pipeline(
        monkeypatch,
        summary=build_summary(),
        vision_result=VisionAnalysisResult(
            image_type="equipement",
            analysis="Le visuel montre un routeur avec modem USB.",
            detected_kpis=[
                "Equipements detectes 2",
                "Routeur visible",
                "Modem USB visible",
            ],
            recommendations=[
                "Verifier l'anciennete du modem USB.",
                "Confirmer l'etat du routeur visible.",
            ],
            confidence=0.9,
            model="llava",
            detected_objects=["Routeur", "Modem USB"],
            detected_brands=["Huawei"],
            detected_operators=[],
            sim_types=[],
            primary_equipment="Routeur",
            apparent_condition="fonctionnel",
            probable_usage="Distribution Internet via routeur et modem USB.",
            replacement_signals=["Verifier le modem USB visible."],
            raw_output=(
                "TYPE_IMAGE: equipement\n"
                "DETECTED_OBJECTS:\n"
                "- Routeur\n"
                "- Modem USB\n"
                "PRIMARY_EQUIPMENT: Routeur\n"
                "APPARENT_CONDITION: fonctionnel\n"
                "PROBABLE_USAGE: Distribution Internet via routeur et modem USB.\n"
                "REPLACEMENT_SIGNALS:\n"
                "- Verifier le modem USB visible.\n"
            ),
        ),
        llm_response={
            "answer": "Le visuel montre un routeur avec modem USB.",
            "detected_kpis": ["Routeur visible", "Modem USB visible"],
            "detected_anomalies": ["Anciennete du modem USB a verifier"],
            "probable_causes": ["Modem USB potentiellement ancien"],
            "recommendations": [
                "Verifier l'anciennete du modem USB.",
                "Confirmer l'etat du routeur visible.",
            ],
            "confidence": 0.88,
        },
    )
    router_image_bytes = _build_synthetic_router_scene_bytes()
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.extract_image_ocr",
        lambda image_bytes: _build_equipment_photo_ocr_result(text=""),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.prepare_image_for_analysis",
        lambda image_bytes, filename, content_type, max_side=None: PreparedImage(
            original_bytes=router_image_bytes,
            processed_bytes=router_image_bytes,
            media_type="image/png",
            width=640,
            height=360,
        ),
    )
    caplog.set_level(logging.INFO, logger="app.chat.multimodal")

    response = asyncio.run(
        generate_image_chat_response(
            request,
            db_session,
            question="Quels equipements sont visibles ?",
            history=[],
            image_bytes=b"fake-router-photo-direct-vision-routeur-modem",
            filename="scene-routeur-direct-routeur-modem.png",
            content_type="image/png",
            analysis_mode="advanced",
            conversation_id="conv-equipment-router-direct-vision-routeur-modem",
        )
    )

    assert "- Routeur Wi-Fi apparent" in response.answer
    assert "- Antennes reseau visibles" in response.answer
    assert "- Boitier reseau visible" in response.answer
    assert "- Voyants ou ports apparents" in response.answer
    assert "Modem USB" not in response.answer
    assert all("modem usb" not in item.lower() for item in response.recommendations)
    assert all("modem usb" not in item.lower() for item in response.detected_anomalies)
    assert response.equipment_details is not None
    assert all(
        "modem usb" not in item.lower()
        for item in response.equipment_details.maintenance_recommendations
    )
    assert "modem usb" not in (response.equipment_details.summary or "").lower()
    assert "RAW_VISION_OBJECTS=['Routeur', 'Modem USB']" in caplog.text
    assert "SANITIZED_VISION_OBJECTS=['Routeur Wi-Fi apparent', 'Antennes reseau visibles', 'Boitier reseau visible', 'Voyants ou ports apparents']" in caplog.text
    assert "REMOVED_HALLUCINATED_OBJECTS=['Modem USB']" in caplog.text
    assert "FINAL_ANSWER_SANITIZED = Inventaire visuel" in caplog.text


def test_huawei_usb_dongle_reclassified_from_router(
    db_session: Session,
    monkeypatch,
    caplog,
) -> None:
    request, _captured_prompt = _setup_equipment_photo_pipeline(
        monkeypatch,
        summary=build_summary(),
    )

    usb_modem_image_bytes = _build_synthetic_vertical_usb_modem_scene_bytes()
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.prepare_image_for_analysis",
        lambda image_bytes, filename, content_type, max_side=None: PreparedImage(
            original_bytes=usb_modem_image_bytes,
            processed_bytes=usb_modem_image_bytes,
            media_type="image/png",
            width=360,
            height=700,
        ),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.extract_image_ocr",
        lambda image_bytes: _build_equipment_photo_ocr_result(text="Huawei USB Dongle 4G LTE"),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.analyze_image_with_llava",
        lambda **kwargs: asyncio.sleep(0, result=_build_router_only_vision_result("HUAWEI")),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service._extract_network_equipment_visual_cues",
        lambda prepared_image: {
            "router_body_detected": False,
            "vertical_antennas_detected": False,
            "status_ports_detected": False,
            "network_shape_detected": False,
            "router_antenna_left_detected": False,
            "router_antenna_right_detected": False,
            "router_antenna_count": 0,
        },
    )
    caplog.set_level(logging.INFO, logger="app.chat.multimodal")

    response = asyncio.run(
        generate_image_chat_response(
            request,
            db_session,
            question="Quels equipements sont visibles ?",
            history=[],
            image_bytes=b"fake-huawei-usb-modem",
            filename="huawei-usb-modem.png",
            content_type="image/png",
            analysis_mode="advanced",
            conversation_id="conv-equipment-huawei-usb-modem",
        )
    )

    assert "USB_MODEM_CLASSIFIER_START brand=HUAWEI" in caplog.text
    assert "USB_MODEM_BRAND_DETECTED=HUAWEI" in caplog.text
    assert "USB_MODEM_SCORE=" in caplog.text
    assert "USB_MODEM_RATIO=" in caplog.text
    assert "USB_MODEM_CLASSIFIER_DECISION=reclassify_modem_usb" in caplog.text
    assert "USB_MODEM_CLASSIFIER_REASON=" in caplog.text
    assert "brand=HUAWEI" in caplog.text
    assert "antenna_count=0" in caplog.text
    assert "rj45_visible=False" in caplog.text
    assert "router_horizontal_detected=False" in caplog.text
    assert "main_object_ratio=" in caplog.text
    assert "dongle_shape_detected=True" in caplog.text
    assert "USB_MODEM_RECLASSIFICATION_TRIGGERED=True" in caplog.text
    assert "ORIGINAL_IMAGE_TYPE=routeur_wifi" in caplog.text
    assert "NEW_IMAGE_TYPE=modem_usb" in caplog.text
    assert "ORIGINAL_OBJECTS=['Routeur Wi-Fi apparent', 'Boitier reseau visible']" in caplog.text
    assert (
        "NEW_OBJECTS=['Modem USB apparent', 'Boitier de connectivite mobile visible']"
        in caplog.text
    )
    assert "RAW_VISION_OBJECTS=['Modem USB apparent', 'Boitier de connectivite mobile visible']" in caplog.text
    assert "DETECTED_IMAGE_CATEGORY = modem_usb" in caplog.text
    assert "DETECTED_OBJECTS = ['Modem USB apparent', 'Boitier de connectivite mobile visible']" in caplog.text
    assert "- Modem USB apparent" in response.answer
    assert "- Boitier de connectivite mobile visible" in response.answer
    assert "Le modem USB permet l'acces au reseau mobile via un port USB." in response.answer
    assert "Il peut fournir une connexion Internet a un ordinateur compatible." in response.answer
    assert "- Routeur Wi-Fi apparent" not in response.answer
    assert "- Antennes reseau visibles" not in response.answer
    assert "Borne WiFi" not in response.answer
    assert "Switch" not in response.answer
    assert "Carte SIM" not in response.answer
    assert "Cable reseau" not in response.answer
    assert "DIRECT_VISION_SANITIZER_APPLIED = TRUE" not in caplog.text


def test_huawei_usb_modem_is_not_detected_as_router(
    monkeypatch,
    caplog,
) -> None:
    usb_modem_image_bytes = _build_synthetic_vertical_usb_modem_scene_bytes()
    prepared_image = PreparedImage(
        original_bytes=usb_modem_image_bytes,
        processed_bytes=usb_modem_image_bytes,
        media_type="image/png",
        width=1200,
        height=800,
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service._extract_network_equipment_visual_cues",
        lambda prepared_image: {
            "router_body_detected": False,
            "vertical_antennas_detected": False,
            "status_ports_detected": True,
            "network_shape_detected": True,
            "router_confidence": 0.73,
            "router_antenna_left_detected": False,
            "router_antenna_right_detected": False,
            "router_antenna_count": 0,
            "antenna_score": 0.0,
        },
    )
    caplog.set_level(logging.INFO, logger="app.chat.multimodal")
    original_result = replace(
        _build_router_only_vision_result("HUAWEI"),
        analysis="Le visuel montre un routeur.",
        detected_brands=[],
        raw_output=(
            "TYPE_IMAGE: routeur_wifi\n"
            "DETECTED_OBJECTS:\n"
            f"- {GENERIC_VISIBLE_WIFI_ROUTER_LABEL}\n"
            f"- {GENERIC_VISIBLE_NETWORK_CHASSIS_LABEL}\n"
            f"PRIMARY_EQUIPMENT: {GENERIC_VISIBLE_WIFI_ROUTER_LABEL}\n"
            "APPARENT_CONDITION: fonctionnel\n"
            "PROBABLE_USAGE: Connectivite reseau\n"
        ),
    )

    reclassified_result = _reclassify_network_device(
        vision_result=original_result,
        prepared_image=prepared_image,
        detected_objects=original_result.detected_objects,
        ocr_result=_build_equipment_photo_ocr_result(text="Huawei USB Dongle 4G LTE"),
    )

    assert reclassified_result.image_type == "modem_usb"
    assert reclassified_result.detected_objects == [
        GENERIC_VISIBLE_USB_MODEM_LABEL,
        GENERIC_VISIBLE_MOBILE_CONNECTIVITY_CHASSIS_LABEL,
    ]
    assert GENERIC_VISIBLE_WIFI_ROUTER_LABEL not in reclassified_result.detected_objects
    assert GENERIC_VISIBLE_NETWORK_ANTENNAS_LABEL not in reclassified_result.detected_objects
    assert GENERIC_VISIBLE_NETWORK_CHASSIS_LABEL not in reclassified_result.detected_objects
    assert GENERIC_VISIBLE_NETWORK_PORTS_LABEL not in reclassified_result.detected_objects
    assert "USB_MODEM_CLASSIFIER_START brand=HUAWEI" in caplog.text
    assert "USB_MODEM_BRAND_DETECTED=HUAWEI" in caplog.text
    assert "USB_MODEM_SCORE=" in caplog.text
    assert "USB_MODEM_RATIO=" in caplog.text
    assert "USB_MODEM_CLASSIFIER_DECISION=reclassify_modem_usb" in caplog.text
    assert "router_horizontal_detected=False" in caplog.text
    assert "USB_MODEM_RECLASSIFICATION_TRIGGERED=True" in caplog.text
    assert "main_object_ratio=" in caplog.text
    assert "dongle_shape_detected=True" in caplog.text


def test_zte_usb_dongle_reclassified_from_router(
    monkeypatch,
    caplog,
) -> None:
    usb_modem_image_bytes = _build_synthetic_vertical_usb_modem_scene_bytes()
    prepared_image = PreparedImage(
        original_bytes=usb_modem_image_bytes,
        processed_bytes=usb_modem_image_bytes,
        media_type="image/png",
        width=360,
        height=700,
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service._extract_network_equipment_visual_cues",
        lambda prepared_image: {
            "router_body_detected": False,
            "vertical_antennas_detected": False,
            "status_ports_detected": False,
            "network_shape_detected": False,
            "router_antenna_left_detected": False,
            "router_antenna_right_detected": False,
            "router_antenna_count": 0,
        },
    )
    caplog.set_level(logging.INFO, logger="app.chat.multimodal")

    reclassified_result = _reclassify_network_device(
        vision_result=_build_router_only_vision_result("ZTE"),
        prepared_image=prepared_image,
        detected_objects=[
            GENERIC_VISIBLE_WIFI_ROUTER_LABEL,
            GENERIC_VISIBLE_NETWORK_CHASSIS_LABEL,
        ],
    )

    assert reclassified_result.image_type == "modem_usb"
    assert reclassified_result.detected_objects == [
        GENERIC_VISIBLE_USB_MODEM_LABEL,
        GENERIC_VISIBLE_MOBILE_CONNECTIVITY_CHASSIS_LABEL,
    ]
    assert reclassified_result.primary_equipment == GENERIC_VISIBLE_USB_MODEM_LABEL
    assert "USB_MODEM_CLASSIFIER_START brand=ZTE" in caplog.text
    assert "USB_MODEM_CLASSIFIER_DECISION=reclassify_modem_usb" in caplog.text
    assert "brand=ZTE" in caplog.text
    assert "NEW_IMAGE_TYPE=modem_usb" in caplog.text


def test_real_router_not_reclassified(
    monkeypatch,
    caplog,
) -> None:
    router_image_bytes = _build_synthetic_router_scene_bytes()
    prepared_image = PreparedImage(
        original_bytes=router_image_bytes,
        processed_bytes=router_image_bytes,
        media_type="image/png",
        width=640,
        height=360,
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service._extract_network_equipment_visual_cues",
        lambda prepared_image: {
            "router_body_detected": True,
            "vertical_antennas_detected": True,
            "status_ports_detected": True,
            "network_shape_detected": True,
            "router_antenna_left_detected": True,
            "router_antenna_right_detected": True,
            "router_antenna_count": 2,
        },
    )
    caplog.set_level(logging.INFO, logger="app.chat.multimodal")
    original_result = _build_router_only_vision_result("HUAWEI")

    reclassified_result = _reclassify_network_device(
        vision_result=original_result,
        prepared_image=prepared_image,
        detected_objects=original_result.detected_objects,
    )

    assert reclassified_result == original_result
    assert "USB_MODEM_CLASSIFIER_START brand=HUAWEI" in caplog.text
    assert "USB_MODEM_CLASSIFIER_DECISION=keep_router_profile" in caplog.text
    assert "brand=HUAWEI" in caplog.text
    assert "antenna_count=2" in caplog.text
    assert "NEW_IMAGE_TYPE=routeur_wifi" in caplog.text


def test_generate_image_chat_response_office_timeout_uses_it_visible_fallback(
    db_session: Session,
    monkeypatch,
) -> None:
    request, _captured_prompt = _setup_equipment_photo_pipeline(
        monkeypatch,
        summary=build_summary(),
    )

    async def raise_image_timeout(**kwargs):
        raise ImageAnalysisTimeoutError()

    monkeypatch.setattr(
        "app.services.multimodal_chat_service.analyze_image_with_llava",
        raise_image_timeout,
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.extract_image_ocr",
        lambda image_bytes: _build_equipment_photo_ocr_result(text=""),
    )

    response = asyncio.run(
        generate_image_chat_response(
            request,
            db_session,
            question="Analyse le materiel present.",
            history=[],
            image_bytes=b"fake-office-photo-timeout",
            filename="computer-desk-photo-timeout.png",
            content_type="image/png",
            analysis_mode="advanced",
            conversation_id="conv-equipment-office-timeout",
        )
    )

    assert "Inventaire visuel" in response.answer
    assert "- Materiel informatique apparent" in response.answer
    assert "Routeur" not in response.answer
    assert "Carte SIM" not in response.answer
    assert "Modem USB" not in response.answer


def test_generate_image_chat_response_unknown_timeout_keeps_neutral_generic_fallback(
    db_session: Session,
    monkeypatch,
    caplog,
) -> None:
    request, _captured_prompt = _setup_equipment_photo_pipeline(
        monkeypatch,
        summary=build_summary(),
    )

    async def raise_image_timeout(**kwargs):
        raise ImageAnalysisTimeoutError()

    monkeypatch.setattr(
        "app.services.multimodal_chat_service.analyze_image_with_llava",
        raise_image_timeout,
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.extract_image_ocr",
        lambda image_bytes: _build_equipment_photo_ocr_result(text=""),
    )
    unknown_scene_bytes = _build_synthetic_unknown_scene_bytes()
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.prepare_image_for_analysis",
        lambda image_bytes, filename, content_type, max_side=None: PreparedImage(
            original_bytes=unknown_scene_bytes,
            processed_bytes=unknown_scene_bytes,
            media_type="image/png",
            width=640,
            height=360,
        ),
    )
    caplog.set_level(logging.INFO, logger="app.chat.multimodal")

    response = asyncio.run(
        generate_image_chat_response(
            request,
            db_session,
            question="Quels equipements sont visibles ?",
            history=[],
            image_bytes=b"fake-unknown-photo-timeout",
            filename="scene-generic-timeout.png",
            content_type="image/png",
            analysis_mode="advanced",
            conversation_id="conv-equipment-unknown-timeout",
        )
    )

    assert "- Objet principal visible non confirme automatiquement" in response.answer
    assert "- Environnement ou support visible" in response.answer
    assert "- Vehicule apparent" not in response.answer
    assert "FALLBACK_TEMPLATE_USED = neutral_generic_fallback" in caplog.text
    assert "DETECTED_IMAGE_CATEGORY = objet_non_confirme" in caplog.text


def test_generate_image_chat_response_reuses_cached_vision_for_same_image_and_conversation(
    db_session: Session,
    monkeypatch,
) -> None:
    request, _captured_prompt = _setup_equipment_photo_pipeline(
        monkeypatch,
        summary=build_summary(),
    )
    vision_call_count = 0

    async def track_vision(**kwargs):
        nonlocal vision_call_count
        vision_call_count += 1
        return VisionAnalysisResult(
            image_type="equipement",
            analysis="Photo d'equipements telecom avec smartphone, routeur, modem USB et cartes SIM.",
            detected_kpis=[],
            recommendations=["Verifier l'anciennete du modem USB."],
            confidence=0.91,
            model="llava",
            detected_objects=[
                "Smartphone Samsung",
                "Routeur Huawei 4G/5G",
                "Modem USB 4G LTE",
                "Carte SIM Maroc Telecom",
            ],
            detected_brands=["Samsung", "Huawei"],
            detected_operators=["Maroc Telecom"],
            sim_types=["Nano SIM"],
            primary_equipment="Routeur Huawei 4G/5G",
            apparent_condition="fonctionnel",
            probable_usage="Connectivite mobile et Internet d'entreprise",
            replacement_signals=[],
            raw_output="TYPE_IMAGE: equipement",
        )

    monkeypatch.setattr(
        "app.services.multimodal_chat_service.analyze_image_with_llava",
        track_vision,
    )

    first_response = asyncio.run(
        generate_image_chat_response(
            request,
            db_session,
            question="Quels equipements sont visibles ?",
            history=[],
            image_bytes=b"cached-equipment-photo",
            filename="telecom-photo-cache.png",
            content_type="image/png",
            analysis_mode="advanced",
            conversation_id="conv-equipment-vision-cache-1",
        )
    )
    second_response = asyncio.run(
        generate_image_chat_response(
            request,
            db_session,
            question="Quels equipements pourraient etre modernises ?",
            history=[],
            image_bytes=b"cached-equipment-photo",
            filename="telecom-photo-cache.png",
            content_type="image/png",
            analysis_mode="advanced",
            conversation_id="conv-equipment-vision-cache-1",
        )
    )

    assert vision_call_count == 1
    assert first_response.answer.strip() != ""
    assert second_response.answer.strip() != ""
    assert second_response.cached is True


def test_generate_image_chat_response_falls_back_to_ocr_when_vision_unavailable(
    db_session: Session,
    monkeypatch,
) -> None:
    summary = build_summary()

    class FakeRequest:
        async def is_disconnected(self) -> bool:
            return False

    monkeypatch.setattr(
        "app.services.multimodal_chat_service.get_data_summary",
        lambda db: summary,
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.prepare_image_for_analysis",
        lambda image_bytes, filename, content_type: PreparedImage(
            original_bytes=image_bytes,
            processed_bytes=b"processed-image",
            media_type="image/png",
            width=1200,
            height=800,
        ),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.extract_image_ocr",
        lambda image_bytes: OcrExtractionResult(
            text="Dashboard Finance 12 500 MAD",
            lines=["Dashboard Finance", "12 500 MAD"],
            text_regions=[],
            amounts_mad=["12 500 MAD"],
            operators=["Maroc Telecom"],
            departments=["Finance"],
            alerts=[],
            kpis=["Budget mensuel 12 500 MAD"],
            visible_tables=["Finance | 12 500 MAD"],
            confidence=0.84,
            invoice_details=None,
            incident_details=None,
            workflow_details=None,
            equipment_details=None,
            ui_details=None,
            status="ok",
            error_message=None,
        ),
    )

    async def raise_vision_unavailable(**kwargs):
        raise VisionUnavailableError("Analyse visuelle indisponible.")

    monkeypatch.setattr(
        "app.services.multimodal_chat_service.analyze_image_with_llava",
        raise_vision_unavailable,
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service._generate_with_ollama",
        lambda prompt: asyncio.sleep(
            0,
            result=json.dumps(
                {
                    "answer": "Resume intelligent\nLe visuel met en evidence une pression budgetaire visible sur Finance.\nRecommandations IA\n- Auditer Finance.",
                    "detected_kpis": ["Budget mensuel 12 500 MAD"],
                    "recommendations": ["Auditer Finance."],
                    "confidence": 0.72,
                }
            ),
        ),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.build_image_annotations",
        lambda *args, **kwargs: ImageAnnotationResult(
            highlighted_image=None,
            annotations=[],
        ),
    )

    response = asyncio.run(
        generate_image_chat_response(
            FakeRequest(),
            db_session,
            question="Analyse ce dashboard telecom",
            history=[],
            image_bytes=b"fake-image",
            filename="dashboard.png",
            content_type="image/png",
            analysis_mode="advanced",
            conversation_id="conv-image-fallback",
        )
    )

    assert response.image_type == "dashboard"
    assert response.fallback_used is True
    assert "vision:vision-fallback" in response.sources
    assert response.recommendation_notice is not None
    assert "elements visibles de l'image" in response.recommendation_notice.lower()
    assert response.analysis_metadata is not None
    assert response.analysis_metadata.blocked_global_context is True
    assert "Inventaire visuel" in response.answer


def test_generate_image_chat_response_generic_visible_only_fallback_blocks_global_context(
    db_session: Session,
    monkeypatch,
) -> None:
    summary = build_summary()
    llm_called = False

    class FakeRequest:
        async def is_disconnected(self) -> bool:
            return False

    monkeypatch.setattr(
        "app.services.multimodal_chat_service.get_data_summary",
        lambda db: summary,
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.prepare_image_for_analysis",
        lambda image_bytes, filename, content_type: PreparedImage(
            original_bytes=image_bytes,
            processed_bytes=b"processed-visible-table",
            media_type="image/png",
            width=1200,
            height=800,
        ),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.extract_image_ocr",
        lambda image_bytes: OcrExtractionResult(
            text="Departement Consommation Commercial 420 Support 180",
            lines=["Departement Consommation", "Commercial 420", "Support 180"],
            text_regions=[],
            amounts_mad=[],
            operators=[],
            departments=["Commercial", "Support"],
            alerts=[],
            kpis=["Commercial 420", "Support 180"],
            visible_tables=["Departement | Consommation", "Commercial | 420", "Support | 180"],
            confidence=0.73,
            invoice_details=None,
            incident_details=None,
            workflow_details=None,
            equipment_details=None,
            ui_details=None,
            status="ok",
            error_message=None,
        ),
    )

    async def raise_vision_unavailable(**kwargs):
        raise VisionUnavailableError("Analyse visuelle indisponible.")

    async def track_generate_with_ollama(prompt: str, timeout_seconds: int | None = None) -> str:
        nonlocal llm_called
        llm_called = True
        return json.dumps({"answer": "Ne devrait pas etre appele."})

    monkeypatch.setattr(
        "app.services.multimodal_chat_service.analyze_image_with_llava",
        raise_vision_unavailable,
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service._generate_with_ollama",
        track_generate_with_ollama,
    )

    response = asyncio.run(
        generate_image_chat_response(
            FakeRequest(),
            db_session,
            question="Analyse ce tableau telecom",
            history=[],
            image_bytes=b"fake-visible-table-image",
            filename="visible-table.png",
            content_type="image/png",
            analysis_mode="advanced",
            conversation_id="conv-visible-only-table-fallback",
        )
    )

    assert response.fallback_used is True
    assert response.image_type in {"tableau", "dashboard"}
    assert "Inventaire visuel" in response.answer
    assert "Etat apparent" in response.answer
    assert "Modernisation potentielle" in response.answer
    assert "Niveau de confiance" in response.answer
    assert (
        "Tableau ou graphique probable" in response.answer
        or "Capture de supervision ou tableau de bord probable" in response.answer
    )
    assert response.analysis_metadata is not None
    assert response.analysis_metadata.source_mode == "visible_only_fallback"
    assert response.analysis_metadata.blocked_global_context is True
    assert "fleet_ai_results_morocco.csv" not in response.sources
    assert "phone_lines" not in response.sources
    assert llm_called is False


def test_generate_image_chat_response_falls_back_on_timeout_without_ocr_fallback(
    db_session: Session,
    monkeypatch,
) -> None:
    summary = build_summary()

    class FakeRequest:
        async def is_disconnected(self) -> bool:
            return False

    monkeypatch.setattr(
        "app.services.multimodal_chat_service.get_data_summary",
        lambda db: summary,
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.prepare_image_for_analysis",
        lambda image_bytes, filename, content_type: PreparedImage(
            original_bytes=image_bytes,
            processed_bytes=b"processed-image",
            media_type="image/png",
            width=1200,
            height=800,
        ),
    )
    monkeypatch.setattr(
        "app.services.multimodal_chat_service.extract_image_ocr",
        lambda image_bytes: OcrExtractionResult(
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
            error_message="La lecture OCR n'a pas permis de consolider un texte exploitable sur l'image.",
        ),
    )

    async def raise_image_timeout(**kwargs):
        raise ImageAnalysisTimeoutError()

    monkeypatch.setattr(
        "app.services.multimodal_chat_service.analyze_image_with_llava",
        raise_image_timeout,
    )

    response = asyncio.run(
        generate_image_chat_response(
            FakeRequest(),
            db_session,
            question="Analyse cette capture telecom",
            history=[],
            image_bytes=b"fake-image",
            filename="capture.png",
            content_type="image/png",
            analysis_mode="advanced",
            conversation_id="conv-image-timeout",
        )
    )

    assert response.fallback_used is True
    assert "vision:vision-fallback" in response.sources
    assert response.recommendation_notice is not None
    assert "la lecture detaillee a ete limitee" in response.recommendation_notice.lower()
