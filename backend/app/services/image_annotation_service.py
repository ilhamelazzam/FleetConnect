from __future__ import annotations

import base64
import logging
import re
import unicodedata
from dataclasses import dataclass

from app.services.image_preprocessing_service import PreparedImage
from app.services.ocr_service import OcrExtractionResult, OcrTextRegion

ANNOTATION_LOGGER = logging.getLogger("app.chat.annotation")

try:  # pragma: no cover - optional runtime dependency
    import cv2  # type: ignore[import-not-found]
    import numpy as np  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover - optional runtime dependency
    cv2 = None
    np = None


@dataclass(frozen=True)
class ImageAnnotation:
    label: str
    type: str
    bbox: tuple[int, int, int, int]
    confidence: float


@dataclass(frozen=True)
class ImageAnnotationResult:
    highlighted_image: str | None
    annotations: list[ImageAnnotation]


@dataclass(frozen=True)
class _AnnotationCandidate:
    label: str
    annotation_type: str
    region: OcrTextRegion
    priority: int
    confidence: float


def _normalize_text(value: str) -> str:
    normalized_value = unicodedata.normalize("NFD", value.lower())
    normalized_value = "".join(
        character for character in normalized_value if unicodedata.category(character) != "Mn"
    )
    return " ".join(normalized_value.split())


def _dedupe_text(values: list[str]) -> list[str]:
    unique_values: list[str] = []
    seen = set()
    for value in values:
        normalized_value = " ".join(value.split()).strip()
        key = normalized_value.lower()
        if not normalized_value or key in seen:
            continue
        seen.add(key)
        unique_values.append(normalized_value)
    return unique_values


def _extract_amount_value(text: str) -> float | None:
    match = re.search(
        r"(?<!\d)(\d{1,3}(?:[ .]\d{3})*(?:[.,]\d{2})?|\d+(?:[.,]\d{2})?)\s*(?:MAD|DHS|DH)\b",
        text,
        flags=re.IGNORECASE,
    )
    if not match:
        return None

    normalized_value = match.group(1).replace(" ", "").replace(",", ".")
    try:
        return float(normalized_value)
    except ValueError:
        return None


def _contains_target(region_text: str, targets: list[str]) -> bool:
    normalized_region = _normalize_text(region_text)
    for target in targets:
        normalized_target = _normalize_text(target)
        if not normalized_target:
            continue
        if normalized_target in normalized_region or normalized_region in normalized_target:
            return True
    return False


def _scale_bbox_to_original(
    bbox: tuple[int, int, int, int],
    prepared_image: PreparedImage,
) -> tuple[int, int, int, int]:
    x, y, width, height = bbox
    source_width = prepared_image.processed_width or prepared_image.width or 1
    source_height = prepared_image.processed_height or prepared_image.height or 1
    target_width = prepared_image.width or source_width
    target_height = prepared_image.height or source_height

    scale_x = target_width / source_width if source_width else 1.0
    scale_y = target_height / source_height if source_height else 1.0

    scaled_x = max(0, int(round(x * scale_x)))
    scaled_y = max(0, int(round(y * scale_y)))
    scaled_width = max(1, int(round(width * scale_x)))
    scaled_height = max(1, int(round(height * scale_y)))
    return (scaled_x, scaled_y, scaled_width, scaled_height)


def _choose_region_matches(
    ocr_result: OcrExtractionResult,
    *,
    detected_kpis: list[str],
    detected_anomalies: list[str],
    detected_operator: str | None,
) -> list[_AnnotationCandidate]:
    if not ocr_result.text_regions:
        return []

    candidates: list[_AnnotationCandidate] = []
    anomaly_targets = _dedupe_text([*ocr_result.alerts, *detected_anomalies])
    kpi_targets = _dedupe_text([*ocr_result.kpis, *detected_kpis])
    department_targets = ocr_result.departments[:2]
    operator_targets = [detected_operator] if detected_operator else []
    workflow_details = ocr_result.workflow_details
    equipment_details = ocr_result.equipment_details
    workflow_critical_targets = (
        _dedupe_text(workflow_details.critical_steps) if workflow_details is not None else []
    )
    workflow_bottleneck_targets = (
        _dedupe_text(workflow_details.bottlenecks) if workflow_details is not None else []
    )
    workflow_validation_targets = (
        _dedupe_text(workflow_details.repeated_validations) if workflow_details is not None else []
    )
    equipment_label_targets = (
        _dedupe_text(
            [
                equipment_details.brand or "",
                equipment_details.model or "",
                equipment_details.serial_number or "",
                equipment_details.sim_information or "",
                equipment_details.label_information or "",
            ]
        )
        if equipment_details is not None
        else []
    )
    equipment_issue_targets = (
        _dedupe_text(equipment_details.detected_issues) if equipment_details is not None else []
    )

    amount_regions: list[tuple[OcrTextRegion, float]] = []
    for region in ocr_result.text_regions:
        amount_value = _extract_amount_value(region.text)
        if amount_value is not None:
            amount_regions.append((region, amount_value))

    highest_amount = max((value for _, value in amount_regions), default=None)

    for region in ocr_result.text_regions:
        normalized_region = _normalize_text(region.text)
        if region.confidence < 0.52:
            continue

        if equipment_issue_targets and _contains_target(region.text, equipment_issue_targets):
            confidence = min(0.97, max(region.confidence, 0.78))
            candidates.append(
                _AnnotationCandidate("Defaut visible", "risk", region, 10, confidence)
            )

        if equipment_label_targets and _contains_target(region.text, equipment_label_targets):
            label = "SIM" if any(
                keyword in normalized_region for keyword in ("sim", "usim", "iccid", "imsi")
            ) else "Composant"
            confidence = min(0.94, max(region.confidence, 0.72))
            candidates.append(
                _AnnotationCandidate(label, "context", region, 6, confidence)
            )

        if workflow_critical_targets and _contains_target(region.text, workflow_critical_targets):
            confidence = min(0.98, max(region.confidence, 0.8))
            candidates.append(
                _AnnotationCandidate("Etape critique", "alert", region, 11, confidence)
            )

        if workflow_validation_targets and _contains_target(region.text, workflow_validation_targets):
            confidence = min(0.96, max(region.confidence, 0.78))
            candidates.append(
                _AnnotationCandidate("Validation repetitive", "risk", region, 10, confidence)
            )

        if workflow_bottleneck_targets and _contains_target(region.text, workflow_bottleneck_targets):
            confidence = min(0.97, max(region.confidence, 0.79))
            candidates.append(
                _AnnotationCandidate("Zone complexe", "risk", region, 10, confidence)
            )

        if (
            _contains_target(region.text, anomaly_targets)
            or any(keyword in normalized_region for keyword in ("critique", "critical", "warning", "alerte"))
        ):
            label = "Alerte critique" if any(
                keyword in normalized_region for keyword in ("critique", "critical", "sev1", "p1")
            ) else "Anomalie"
            confidence = min(0.98, max(region.confidence, 0.78))
            candidates.append(
                _AnnotationCandidate(label, "alert", region, 10, confidence)
            )

        if any(
            keyword in normalized_region
            for keyword in ("depasse", "quota", "hors forfait", "surconsommation", "overage", "roaming")
        ):
            confidence = min(0.97, max(region.confidence, 0.76))
            candidates.append(
                _AnnotationCandidate("Depassement", "risk", region, 9, confidence)
            )

        if any(
            keyword in normalized_region
            for keyword in ("fraude", "suspect", "premium", "simbox", "erreur", "exception", "timeout")
        ):
            confidence = min(0.97, max(region.confidence, 0.75))
            candidates.append(
                _AnnotationCandidate("Anomalie", "risk", region, 8, confidence)
            )

        amount_value = _extract_amount_value(region.text)
        if amount_value is not None and highest_amount is not None:
            if amount_value >= highest_amount * 0.9 or _contains_target(region.text, kpi_targets):
                confidence = min(0.96, max(region.confidence, 0.73))
                candidates.append(
                    _AnnotationCandidate("Cout eleve", "risk", region, 7, confidence)
                )

        if _contains_target(region.text, kpi_targets):
            confidence = min(0.94, max(region.confidence, 0.7))
            candidates.append(
                _AnnotationCandidate("KPI cle", "kpi", region, 6, confidence)
            )

        if department_targets and _contains_target(region.text, department_targets):
            confidence = min(0.92, max(region.confidence, 0.68))
            candidates.append(
                _AnnotationCandidate("Departement expose", "context", region, 5, confidence)
            )

        if operator_targets and _contains_target(region.text, operator_targets):
            confidence = min(0.9, max(region.confidence, 0.66))
            candidates.append(
                _AnnotationCandidate("Operateur", "context", region, 4, confidence)
            )

    candidates.sort(key=lambda item: (item.priority, item.confidence), reverse=True)

    selected: list[_AnnotationCandidate] = []
    used_regions: set[tuple[int, int, int, int]] = set()
    used_labels: set[tuple[str, tuple[int, int, int, int]]] = set()
    for candidate in candidates:
        region_key = candidate.region.bbox
        label_key = (candidate.label, region_key)
        if candidate.confidence < 0.64:
            continue
        if region_key in used_regions and label_key in used_labels:
            continue
        if region_key in used_regions:
            continue
        used_regions.add(region_key)
        used_labels.add(label_key)
        selected.append(candidate)
        if len(selected) >= 8:
            break

    return selected


def _draw_annotations(
    prepared_image: PreparedImage,
    annotations: list[ImageAnnotation],
) -> str | None:
    if not annotations or cv2 is None or np is None:  # pragma: no cover - optional runtime dependency
        return None

    image_array = np.frombuffer(prepared_image.original_bytes, dtype=np.uint8)
    decoded = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
    if decoded is None:
        image_array = np.frombuffer(prepared_image.processed_bytes, dtype=np.uint8)
        decoded = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
    if decoded is None:
        ANNOTATION_LOGGER.warning("event=annotation_decode_failed")
        return None

    colors = {
        "alert": (40, 48, 220),
        "risk": (0, 140, 255),
        "kpi": (226, 112, 0),
        "context": (168, 85, 247),
    }

    for annotation in annotations:
        x, y, width, height = annotation.bbox
        color = colors.get(annotation.type, (0, 140, 255))
        cv2.rectangle(decoded, (x, y), (x + width, y + height), color, 3)

        label_text = annotation.label
        font = cv2.FONT_HERSHEY_SIMPLEX
        font_scale = 0.58
        thickness = 2
        (text_width, text_height), baseline = cv2.getTextSize(label_text, font, font_scale, thickness)
        label_top = max(0, y - text_height - baseline - 10)
        label_bottom = label_top + text_height + baseline + 10
        label_right = min(decoded.shape[1] - 1, x + text_width + 12)
        cv2.rectangle(decoded, (x, label_top), (label_right, label_bottom), color, -1)
        cv2.putText(
            decoded,
            label_text,
            (x + 6, label_bottom - 6),
            font,
            font_scale,
            (255, 255, 255),
            thickness,
            cv2.LINE_AA,
        )

    success, encoded = cv2.imencode(".png", decoded)
    if not success:
        ANNOTATION_LOGGER.warning("event=annotation_encode_failed")
        return None

    payload = base64.b64encode(encoded.tobytes()).decode("utf-8")
    return f"data:image/png;base64,{payload}"


def build_image_annotations(
    prepared_image: PreparedImage,
    *,
    ocr_result: OcrExtractionResult,
    image_type: str,
    detected_kpis: list[str],
    detected_anomalies: list[str],
    detected_operator: str | None,
) -> ImageAnnotationResult:
    if cv2 is None or np is None:  # pragma: no cover - optional runtime dependency
        return ImageAnnotationResult(highlighted_image=None, annotations=[])

    matched_candidates = _choose_region_matches(
        ocr_result,
        detected_kpis=detected_kpis,
        detected_anomalies=detected_anomalies,
        detected_operator=detected_operator,
    )
    annotations = [
        ImageAnnotation(
            label=candidate.label,
            type=candidate.annotation_type,
            bbox=_scale_bbox_to_original(candidate.region.bbox, prepared_image),
            confidence=max(0.0, min(candidate.confidence, 1.0)),
        )
        for candidate in matched_candidates
    ]

    # Reduce low-signal annotations on generic interface captures.
    if image_type == "capture_interface":
        annotations = [annotation for annotation in annotations if annotation.type != "context"][:5]

    highlighted_image = _draw_annotations(prepared_image, annotations)
    if highlighted_image is None:
        return ImageAnnotationResult(highlighted_image=None, annotations=[])

    return ImageAnnotationResult(highlighted_image=highlighted_image, annotations=annotations)
