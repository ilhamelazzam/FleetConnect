"""Guards multimodal answers against unsupported image claims."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class ExtractedValues:
    ocr_text: str = ""
    context_text: str = ""
    detected_numbers: list[str] = field(default_factory=list)
    detected_amounts_mad: list[float] = field(default_factory=list)
    detected_percentages: list[float] = field(default_factory=list)
    kpi_labels: list[str] = field(default_factory=list)
    visible_statuses: list[str] = field(default_factory=list)
    operators: list[str] = field(default_factory=list)
    departments: list[str] = field(default_factory=list)
    risk_scores: list[str] = field(default_factory=list)
    alert_types: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class ImageAnalysisMetadata:
    source_mode: str = "image_strict"
    visible_kpis_used: list[str] = field(default_factory=list)
    blocked_global_context: bool = False
    removed_unverified_claims: list[str] = field(default_factory=list)
    filtered_numbers: list[str] = field(default_factory=list)
    confidence_score: float = 0.0


STRICT_IMAGE_TYPES = {
    "alerte",
    "alert_dashboard",
    "fraude",
    "log",
    "appel_suspect",
    "depassement_quota",
    "erreur_systeme",
    "anomalie",
    "facture",
    "invoice",
    "dashboard",
}

GENERIC_CLAIM_SNIPPETS = (
    "lecture metier partielle",
    "lecture partielle",
    "fiabilite a confirmer",
    "texte insuffisant",
    "indicateurs insuffisants",
    "ocr insuffisant",
    "ocr non exploitable",
    "ocr indisponible",
    "lecture ocr",
    "capture insuffisante",
    "capture a enrichir",
    "capture doit etre enrichie",
    "analyse rapide",
    "analyse basee sur la capture",
    "analyse basee sur les kpi visibles",
    "analyse basee sur les indicateurs visibles",
    "analyse exploitable",
    "lecture approfondie",
    "lecture visuelle",
    "signaux visibles",
    "zones exposees",
    "lecture decisionnelle priorisee",
    "consolider les signaux visibles",
    "synthese locale",
    "donnees partiellement exploitables",
    "question prioritaire tronquee",
    "analyse preliminaire",
    "resultats partiels",
    "donnees limitees",
    "priorisation fondee sur les signaux visuels",
    "priorisation fondee sur signaux visuels",
    "appliquer les recommandations ia",
)

RECOMMENDATION_MARKERS = (
    "auditer",
    "optimiser",
    "migrer",
    "verifier",
    "prioriser",
    "activer",
    "renforcer",
    "surveiller",
    "bloquer",
    "traiter",
    "controler",
    "reduire",
    "analyser",
)

KNOWN_DEPARTMENTS = (
    "commercial",
    "finance",
    "support",
    "marketing",
    "operations",
    "rh",
    "it",
    "technique",
)

KNOWN_OPERATORS = ("maroc telecom", "orange", "inwi")


def _normalize_text(value: str) -> str:
    normalized_value = unicodedata.normalize("NFD", value.lower())
    normalized_value = "".join(
        character for character in normalized_value if unicodedata.category(character) != "Mn"
    )
    return " ".join(normalized_value.split())


def _dedupe_strings(values: list[str]) -> list[str]:
    items: list[str] = []
    seen = set()
    for value in values:
        cleaned_value = " ".join(value.split()).strip()
        normalized_key = _normalize_text(cleaned_value)
        if not cleaned_value or normalized_key in seen:
            continue
        seen.add(normalized_key)
        items.append(cleaned_value)
    return items


def _normalize_numeric_token(value: str) -> str:
    normalized = value.replace(" ", "").replace(",", ".").strip()
    if normalized.endswith(".0"):
        normalized = normalized[:-2]
    return normalized


def extract_all_numbers(text: str) -> list[str]:
    if not text:
        return []
    matches = re.findall(r"\b\d+(?:\s?\d{3})*(?:[.,]\d+)?\b", text)
    return [_normalize_numeric_token(match) for match in matches if match.strip()]


def extract_amounts_mad(text: str) -> list[float]:
    if not text:
        return []
    pattern = r"(?<!\w)(\d{1,3}(?:\s?\d{3})*(?:[.,]\d{2})?)\s*(?:MAD|DH|DHS|\$)"
    matches = re.findall(pattern, text, re.IGNORECASE)
    amounts: list[float] = []
    for match in matches:
        cleaned = match.replace(" ", "").replace(",", ".")
        try:
            amounts.append(float(cleaned))
        except ValueError:
            continue
    return amounts


def extract_percentages(text: str) -> list[float]:
    if not text:
        return []
    pattern = r"(\d{1,3}(?:[.,]\d{1,2})?)\s*%"
    matches = re.findall(pattern, text)
    percentages: list[float] = []
    for match in matches:
        cleaned = match.replace(",", ".")
        try:
            percentages.append(float(cleaned))
        except ValueError:
            continue
    return percentages


def extract_risk_scores(text: str) -> list[str]:
    if not text:
        return []
    scores: list[str] = []
    matches = re.findall(r"(\d{1,3})/100|score\s+(\d{1,3})", text, re.IGNORECASE)
    for match in matches:
        score = match[0] or match[1]
        if score:
            scores.append(f"{score}/100")
    return _dedupe_strings(scores)


def build_extracted_values_from_ocr(
    ocr_text: str,
    ocr_amounts_mad: list[str] | None = None,
    ocr_kpis: list[str] | None = None,
    operators: list[str] | None = None,
    departments: list[str] | None = None,
    vision_analysis: str | None = None,
    vision_kpis: list[str] | None = None,
    question: str | None = None,
    image_metadata: list[str] | None = None,
) -> ExtractedValues:
    all_kpis = _dedupe_strings([*(ocr_kpis or []), *(vision_kpis or [])])
    context_parts = [
        ocr_text,
        vision_analysis or "",
        question or "",
        *all_kpis,
        *(ocr_amounts_mad or []),
        *(operators or []),
        *(departments or []),
        *(image_metadata or []),
    ]
    context_text = "\n".join(part for part in context_parts if part and part.strip())
    normalized_context = _normalize_text(context_text)

    visible_statuses = _dedupe_strings(
        [
            status
            for status in ("critique", "eleve", "moyen", "faible", "active", "bloque", "fraude", "anomalie")
            if status in normalized_context
        ]
    )
    alert_types = _dedupe_strings(
        [
            item
            for item in ("alerte", "fraude", "log", "depassement quota", "facture", "dashboard")
            if item in normalized_context
        ]
    )

    return ExtractedValues(
        ocr_text=ocr_text,
        context_text=context_text,
        detected_numbers=extract_all_numbers(context_text),
        detected_amounts_mad=extract_amounts_mad(context_text),
        detected_percentages=extract_percentages(context_text),
        kpi_labels=all_kpis,
        visible_statuses=visible_statuses,
        operators=operators or [],
        departments=departments or [],
        risk_scores=extract_risk_scores(context_text),
        alert_types=alert_types,
    )


def _is_generic_claim(text: str) -> bool:
    normalized_text = _normalize_text(text)
    return any(snippet in normalized_text for snippet in GENERIC_CLAIM_SNIPPETS)


def _contains_context_keyword(normalized_context: str, keywords: tuple[str, ...]) -> bool:
    return any(keyword in normalized_context for keyword in keywords)


def _is_supported_context_line(line: str, extracted_values: ExtractedValues) -> bool:
    normalized_line = _normalize_text(line)
    normalized_context = _normalize_text(extracted_values.context_text or extracted_values.ocr_text)
    operator_names = tuple(_normalize_text(item) for item in extracted_values.operators)
    department_names = tuple(_normalize_text(item) for item in extracted_values.departments)

    if "forfait" in normalized_line or "moins cher" in normalized_line or "migrer" in normalized_line:
        return _contains_context_keyword(
            normalized_context,
            ("forfait", "quota", "data", "depassement", "hors forfait", "plan"),
        )
    if "roaming" in normalized_line:
        return _contains_context_keyword(
            normalized_context,
            ("roaming", "itin", "international"),
        )
    if any(keyword in normalized_line for keyword in ("fraude", "suspect", "blocage", "surveillance renforcee")):
        return _contains_context_keyword(
            normalized_context,
            ("fraude", "suspect", "anomal", "100/100", "alertes critiques", "critique"),
        )
    if "impact financier" in normalized_line or "cout" in normalized_line or "budget" in normalized_line:
        return _contains_context_keyword(
            normalized_context,
            ("impact financier", "mad", "cout", "budget", "montant", "ttc", "ht"),
        )
    for department in KNOWN_DEPARTMENTS:
        if department in normalized_line and department not in department_names and department not in normalized_context:
            return False
    for operator in KNOWN_OPERATORS:
        if operator in normalized_line and operator not in operator_names and operator not in normalized_context:
            return False
    return True


def filter_unverified_claims(
    answer: str,
    extracted_values: ExtractedValues,
) -> tuple[str, list[str]]:
    if not answer:
        return answer, []

    removed_claims: list[str] = []
    filtered_lines: list[str] = []
    valid_numbers = {_normalize_numeric_token(item) for item in extracted_values.detected_numbers}
    valid_amounts = {
        _normalize_numeric_token(str(int(amount)) if amount == int(amount) else str(amount))
        for amount in extracted_values.detected_amounts_mad
    }
    valid_percentages = {
        _normalize_numeric_token(str(int(percentage)) if percentage == int(percentage) else str(percentage))
        for percentage in extracted_values.detected_percentages
    }

    for label in extracted_values.kpi_labels:
        valid_numbers.update(_normalize_numeric_token(item) for item in extract_all_numbers(label))
    valid_numbers.update(_normalize_numeric_token(item) for item in extract_all_numbers(extracted_values.context_text))

    for line in answer.split("\n"):
        stripped_line = line.strip()
        if not stripped_line:
            filtered_lines.append(line)
            continue

        if _is_generic_claim(stripped_line):
            removed_claims.append(stripped_line)
            continue

        line_numbers = extract_all_numbers(stripped_line)
        line_amounts = extract_amounts_mad(stripped_line)
        line_percentages = extract_percentages(stripped_line)

        if line_numbers or line_amounts or line_percentages:
            has_valid_number = any(
                _normalize_numeric_token(number) in valid_numbers for number in line_numbers
            )
            if not has_valid_number:
                has_valid_number = any(
                    _normalize_numeric_token(str(int(amount)) if amount == int(amount) else str(amount))
                    in valid_amounts
                    for amount in line_amounts
                )
            if not has_valid_number:
                has_valid_number = any(
                    _normalize_numeric_token(
                        str(int(percentage)) if percentage == int(percentage) else str(percentage)
                    )
                    in valid_percentages
                    for percentage in line_percentages
                )
            if not has_valid_number:
                removed_claims.append(stripped_line)
                continue

        normalized_line = _normalize_text(stripped_line)
        if any(marker in normalized_line for marker in RECOMMENDATION_MARKERS) and not _is_supported_context_line(
            stripped_line,
            extracted_values,
        ):
            removed_claims.append(stripped_line)
            continue

        filtered_lines.append(line)

    filtered_answer = "\n".join(filtered_lines).strip()
    return filtered_answer, _dedupe_strings(removed_claims)


def filter_recommendation_strings(
    recommendations: list[str],
    extracted_values: ExtractedValues,
) -> tuple[list[str], list[str]]:
    filtered_text, removed_claims = filter_unverified_claims(
        "\n".join(recommendations),
        extracted_values,
    )
    filtered_recommendations = [
        item.strip()
        for item in filtered_text.splitlines()
        if item.strip()
    ]
    return filtered_recommendations, removed_claims


def should_use_strict_mode(image_type: str) -> bool:
    return _normalize_text(image_type) in STRICT_IMAGE_TYPES


def build_image_analysis_metadata(
    image_type: str,
    ocr_result: Any,
    extracted_values: ExtractedValues,
    removed_claims: list[str],
    visible_kpis_used: list[str] | None = None,
    confidence_score: float = 0.0,
) -> ImageAnalysisMetadata:
    return ImageAnalysisMetadata(
        source_mode="image_strict" if should_use_strict_mode(image_type) else "standard",
        visible_kpis_used=_dedupe_strings(visible_kpis_used or []),
        blocked_global_context=should_use_strict_mode(image_type),
        removed_unverified_claims=_dedupe_strings(removed_claims),
        filtered_numbers=_dedupe_strings(extracted_values.detected_numbers),
        confidence_score=confidence_score,
    )
