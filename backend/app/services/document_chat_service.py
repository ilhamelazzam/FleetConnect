from __future__ import annotations

import csv
import io
import json
import logging
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi import Request
from sqlalchemy.orm import Session

from app.schemas.chat import (
    ChatContextMessage,
    ChatDecisionRecommendation,
    ChatImageAnalysisMetadata,
    ChatImageResponse,
)
from app.services.business_answer_quality_service import (
    normalize_business_risk_score,
    polish_chat_image_response,
    polish_business_items,
    polish_business_text,
)
from app.services.chat_service import (
    ChatServerError,
    ChatTimeoutError,
    InvalidImageError,
    LocalModelUnavailableError,
    _build_response,
    _elapsed_ms,
    _ensure_request_connected,
    _generate_with_ollama,
    _log_chat_event,
    _truncate,
    _utcnow,
    get_data_summary,
)
from app.services.multimodal_chat_service import generate_pdf_chat_response

DOCUMENT_LOGGER = logging.getLogger("app.chat.document")

try:  # pragma: no cover - dependency validated through runtime/tests
    import pandas as pd
except ImportError:  # pragma: no cover - graceful runtime guard
    pd = None

SUPPORTED_DOCUMENT_TYPES = {
    ".pdf": "pdf",
    ".csv": "csv",
    ".xlsx": "xlsx",
    ".xls": "xls",
}
SUPPORTED_DOCUMENT_MIME_TYPES = {
    "application/pdf": "pdf",
    "text/csv": "csv",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.ms-excel": "xls",
}
CSV_ENCODINGS = ("utf-8-sig", "utf-8", "latin1")
CSV_SEPARATORS: tuple[str | None, ...] = (None, ";", ",", "\t")
EMPTY_TEXT_MARKERS = {"", "na", "nan", "n a", "n d", "nd", "none", "null"}
TRUTHY_VALUES = {
    "1",
    "active",
    "actif",
    "activa",
    "alert",
    "anomaly",
    "critical",
    "critique",
    "enabled",
    "high",
    "on",
    "oui",
    "true",
    "vrai",
    "warning",
    "x",
    "yes",
}
FALSY_VALUES = {
    "0",
    "aucun",
    "disabled",
    "false",
    "faux",
    "inactive",
    "inactif",
    "no",
    "non",
    "none",
    "off",
    "suspendu",
    "suspendue",
    "without",
}
INACTIVE_STATUSES = {
    "closed",
    "disabled",
    "free",
    "inactive",
    "inactif",
    "inutilise",
    "libre",
    "resilie",
    "suspendu",
    "suspendue",
    "terminated",
}
CRITICAL_SEVERITY_VALUES = {
    "critical",
    "critique",
    "error",
    "fatal",
    "haute",
    "high",
    "major",
    "p1",
    "p2",
    "severe",
}
WARNING_SEVERITY_VALUES = {
    "alerte",
    "anomaly",
    "anomalie",
    "attention",
    "incident",
    "medium",
    "minor",
    "moyen",
    "moyenne",
    "p3",
    "warning",
}
RISK_LEVEL_LABELS_FR = {
    "low": "Faible",
    "medium": "Moyen",
    "high": "Eleve",
    "critical": "Critique",
}
RISK_METRIC_LABELS_FR = {
    "global": "Risque global",
    "optimisation": "Risque optimisation",
    "cout": "Risque cout",
    "anomalie": "Risque anomalie",
    "fraude": "Risque fraude",
    "sous_utilisation": "Risque sous-utilisation",
    "rentabilite": "Risque rentabilite",
}
RISK_SCORE_LEGEND_FR = (
    "0-30 = Faible | 31-50 = Moyen | 51-70 = Eleve | "
    "71-95 = Critique | 100 = cas exceptionnel"
)
NUMBER_PATTERN = re.compile(
    r"(?<!\d)(-?\d{1,3}(?:[ .]\d{3})*(?:[.,]\d+)?|-?\d+(?:[.,]\d+)?)"
)


@dataclass(frozen=True)
class ColumnRule:
    keywords: tuple[str, ...]
    preferred: tuple[str, ...] = ()
    blocked_terms: tuple[str, ...] = ()
    numeric: bool = False
    min_density: float = 0.0
    limit: int = 3
    threshold: float = 2.4


BUSINESS_COLUMN_RULES: dict[str, ColumnRule] = {
    "cout_total": ColumnRule(
        keywords=(
            "amount",
            "bill",
            "billing",
            "charge",
            "charges",
            "cost",
            "cout",
            "depense",
            "expense",
            "facture",
            "mad",
            "monthly charges",
            "monthly cost",
            "montant",
            "price",
            "prix",
            "spend",
            "total charges",
            "total cost",
        ),
        preferred=(
            "monthly",
            "mensuel",
            "recurring",
            "current",
            "amount",
            "montant",
            "cost",
            "cout",
        ),
        blocked_terms=("flag", "score", "level", "range", "label"),
        numeric=True,
        min_density=0.25,
        limit=5,
        threshold=2.8,
    ),
    "cout_roaming": ColumnRule(
        keywords=(
            "cout roaming",
            "itin cost",
            "itinerance cost",
            "intl cost",
            "roaming charge",
            "roaming cost",
            "roaming fee",
        ),
        preferred=("roaming", "itin", "international"),
        blocked_terms=("flag", "score", "status"),
        numeric=True,
        min_density=0.2,
        limit=3,
        threshold=2.8,
    ),
    "consommation_data": ColumnRule(
        keywords=(
            "conso data",
            "consommation data",
            "data",
            "data consumed",
            "data usage",
            "gb used",
            "go used",
            "internet usage",
            "mobile data",
            "usage data",
            "volume data",
        ),
        preferred=("usage", "consommation", "gb", "go", "data"),
        blocked_terms=("flag", "score", "level", "status"),
        numeric=True,
        min_density=0.2,
        limit=4,
        threshold=2.5,
    ),
    "quota_data": ColumnRule(
        keywords=(
            "allowance",
            "data limit",
            "data quota",
            "fair use",
            "limit",
            "plafond",
            "quota",
            "quota data",
        ),
        preferred=("quota", "allowance", "limit", "plafond", "gb", "go"),
        blocked_terms=("flag", "score", "level", "status"),
        numeric=True,
        min_density=0.2,
        limit=4,
        threshold=2.4,
    ),
    "consommation_appels": ColumnRule(
        keywords=(
            "appel",
            "call",
            "calls",
            "minute",
            "minutes",
            "talk",
            "voice",
            "voice usage",
        ),
        preferred=("usage", "consommation", "minutes", "voice"),
        blocked_terms=("facture", "flag", "invoice", "level", "montant", "revenue", "score", "status"),
        numeric=True,
        min_density=0.15,
        limit=4,
        threshold=2.6,
    ),
    "quota_appels": ColumnRule(
        keywords=(
            "call allowance",
            "call quota",
            "minute quota",
            "minutes incluses",
            "voice quota",
        ),
        preferred=("quota", "allowance", "minutes", "voice"),
        blocked_terms=("flag", "score", "level", "status"),
        numeric=True,
        min_density=0.15,
        limit=3,
        threshold=2.8,
    ),
    "consommation_sms": ColumnRule(
        keywords=("message", "messages", "sms", "text"),
        preferred=("usage", "consommation", "sms", "message"),
        blocked_terms=("flag", "score", "level", "status"),
        numeric=True,
        min_density=0.15,
        limit=4,
        threshold=2.5,
    ),
    "quota_sms": ColumnRule(
        keywords=("message quota", "messages inclus", "sms allowance", "sms quota", "text quota"),
        preferred=("quota", "allowance", "sms", "message"),
        blocked_terms=("flag", "score", "level", "status"),
        numeric=True,
        min_density=0.15,
        limit=3,
        threshold=2.8,
    ),
    "roaming": ColumnRule(
        keywords=("international", "itin", "itinerance", "roaming"),
        preferred=("flag", "active", "enabled", "roaming"),
        numeric=False,
        limit=4,
        threshold=2.4,
    ),
    "consommation_roaming": ColumnRule(
        keywords=("international usage", "roaming data", "roaming usage", "usage roaming"),
        preferred=("roaming", "usage", "data", "international"),
        numeric=True,
        min_density=0.15,
        limit=3,
        threshold=2.8,
    ),
    "utilisateur": ColumnRule(
        keywords=(
            "assigned to",
            "assignee",
            "collaborateur",
            "employee",
            "employee name",
            "full name",
            "owner",
            "subscriber",
            "user",
            "utilisateur",
        ),
        preferred=("employee", "collaborateur", "user", "owner"),
        blocked_terms=("profile", "profil", "category", "categorie", "segment", "type", "usage"),
        numeric=False,
        limit=3,
        threshold=2.5,
    ),
    "departement": ColumnRule(
        keywords=(
            "business unit",
            "cost center",
            "department",
            "departement",
            "direction",
            "pole",
            "team",
        ),
        preferred=("department", "departement", "direction", "service", "business unit"),
        blocked_terms=("phone service", "internet service", "online service", "streaming service"),
        numeric=False,
        limit=3,
        threshold=2.4,
    ),
    "forfait": ColumnRule(
        keywords=(
            "bundle",
            "offer",
            "package",
            "plan",
            "plan name",
            "subscription",
            "tariff",
            "forfait",
        ),
        preferred=("plan", "forfait", "package", "offer"),
        numeric=False,
        limit=4,
        threshold=2.4,
    ),
    "engagement": ColumnRule(
        keywords=("commitment", "contract", "contrat", "engagement", "tenure", "term"),
        preferred=("contract", "contrat", "engagement", "term"),
        numeric=False,
        limit=3,
        threshold=2.3,
    ),
    "facture": ColumnRule(
        keywords=(
            "bill date",
            "bill number",
            "billing period",
            "facture",
            "invoice",
            "invoice date",
            "invoice no",
            "invoice number",
            "numero facture",
        ),
        preferred=("invoice", "facture", "billing", "number"),
        numeric=False,
        limit=3,
        threshold=2.5,
    ),
    "revenu": ColumnRule(
        keywords=("arr", "chiffre affaire", "mrr", "revenue", "revenu"),
        preferred=("revenue", "revenu", "mrr", "arr"),
        blocked_terms=("flag", "score", "risk", "quota"),
        numeric=True,
        min_density=0.2,
        limit=3,
        threshold=2.8,
    ),
    "ligne": ColumnRule(
        keywords=("line id", "line reference", "ligne", "msisdn", "sim", "subscription id"),
        preferred=("line", "ligne", "msisdn", "sim"),
        blocked_terms=(
            "date",
            "event",
            "multiple lines",
            "online security",
            "online backup",
            "streaming tv",
            "streaming movies",
            "time",
            "timestamp",
        ),
        numeric=False,
        limit=4,
        threshold=2.4,
    ),
    "telephone": ColumnRule(
        keywords=("cell", "mobile", "numero", "phone number", "telephone"),
        preferred=("telephone", "phone", "mobile", "numero"),
        blocked_terms=("date", "event", "phone service", "internet service", "time", "timestamp"),
        numeric=False,
        limit=4,
        threshold=2.3,
    ),
    "operateur": ColumnRule(
        keywords=("carrier", "network", "operateur", "operator", "provider"),
        preferred=("operator", "operateur", "carrier"),
        numeric=False,
        limit=3,
        threshold=2.3,
    ),
    "statut": ColumnRule(
        keywords=("etat", "state", "status", "statut"),
        preferred=("status", "statut", "etat"),
        numeric=False,
        limit=3,
        threshold=2.3,
    ),
    "anomalie": ColumnRule(
        keywords=(
            "alert",
            "alerte",
            "anomaly",
            "anomalie",
            "critical",
            "critique",
            "error",
            "flag",
            "failure",
            "incident",
            "outlier",
            "suspect",
            "warning",
        ),
        preferred=("flag", "alert", "anomaly", "critical"),
        numeric=False,
        limit=5,
        threshold=2.4,
    ),
    "risque": ColumnRule(
        keywords=(
            "proba",
            "probability",
            "risk",
            "risk level",
            "risk score",
            "risque",
            "score",
        ),
        preferred=("risk score", "score", "proba", "risque"),
        numeric=False,
        limit=5,
        threshold=2.5,
    ),
    "fraude": ColumnRule(
        keywords=("abuse", "fraud", "fraude", "simbox", "suspect"),
        preferred=("fraud", "fraude", "suspect"),
        numeric=False,
        limit=4,
        threshold=2.4,
    ),
    "depassement_quota": ColumnRule(
        keywords=("depasse", "depassement", "exceed", "over quota", "overage", "out of bundle"),
        preferred=("over quota", "depassement", "overage"),
        numeric=False,
        limit=4,
        threshold=2.5,
    ),
    "incident": ColumnRule(
        keywords=(
            "alert type",
            "code incident",
            "error",
            "event",
            "event type",
            "exception",
            "failure",
            "incident",
            "issue",
            "log",
        ),
        preferred=("incident", "event", "error", "alert", "issue", "log"),
        blocked_terms=("date", "time", "timestamp"),
        numeric=False,
        limit=4,
        threshold=2.3,
    ),
    "gravite": ColumnRule(
        keywords=("criticality", "criticite", "gravite", "priority", "severity", "severity level"),
        preferred=("severity", "priority", "criticite", "criticality", "level"),
        blocked_terms=("risk score", "risk level"),
        numeric=False,
        limit=3,
        threshold=2.4,
    ),
    "horodatage": ColumnRule(
        keywords=(
            "created at",
            "date",
            "datetime",
            "event time",
            "heure",
            "logged at",
            "time",
            "timestamp",
        ),
        preferred=("timestamp", "date", "time", "heure"),
        numeric=False,
        limit=3,
        threshold=2.3,
    ),
}

BUSINESS_COLUMN_MAPPING: dict[str, tuple[str, ...]] = {
    "cout": BUSINESS_COLUMN_RULES["cout_total"].keywords,
    "quota": BUSINESS_COLUMN_RULES["quota_data"].keywords + BUSINESS_COLUMN_RULES["quota_appels"].keywords + BUSINESS_COLUMN_RULES["quota_sms"].keywords,
    "usage": BUSINESS_COLUMN_RULES["consommation_data"].keywords
    + BUSINESS_COLUMN_RULES["consommation_appels"].keywords
    + BUSINESS_COLUMN_RULES["consommation_sms"].keywords,
    "roaming": BUSINESS_COLUMN_RULES["roaming"].keywords + BUSINESS_COLUMN_RULES["cout_roaming"].keywords,
    "departement": BUSINESS_COLUMN_RULES["departement"].keywords,
    "forfait": BUSINESS_COLUMN_RULES["forfait"].keywords,
    "utilisateur": BUSINESS_COLUMN_RULES["utilisateur"].keywords,
    "ligne_mobile": BUSINESS_COLUMN_RULES["ligne"].keywords + BUSINESS_COLUMN_RULES["telephone"].keywords,
}

CORE_MAPPING_KEYS = (
    "cout_total",
    "consommation_data",
    "quota_data",
    "roaming",
    "departement",
    "forfait",
)


@dataclass(frozen=True)
class LoadedDocument:
    dataframe: Any
    document_type: str
    selected_sheet: str | None
    parse_notice: str | None
    parse_debug: dict[str, Any]


@dataclass(frozen=True)
class PreparedDataframe:
    dataframe: Any
    header_row_index: int | None
    header_detected: bool
    strategy: str
    quality_score: float


@dataclass(frozen=True)
class CsvParseCandidate:
    dataframe: Any
    encoding: str
    separator: str | None
    strategy: str
    score: float
    row_count: int
    column_count: int
    header_detected: bool
    header_row_index: int | None


@dataclass(frozen=True)
class TabularInsights:
    row_count: int
    column_count: int
    columns: list[str]
    column_profiles: dict[str, str]
    document_profile: str
    business_mapping: dict[str, list[str]]
    primary_cost_column: str | None
    total_primary_cost: float | None
    mean_primary_cost: float | None
    max_primary_cost: float | None
    average_cost_per_user: float | None
    average_cost_per_department: float | None
    top_operator: str | None
    top_operator_cost: float | None
    top_operator_share: float | None
    top_department: str | None
    top_department_cost: float | None
    top_plan: str | None
    top_plan_cost: float | None
    top_user: str | None
    top_user_cost: float | None
    top_operators: list[tuple[str, float, int]]
    top_departments: list[tuple[str, float, int]]
    top_plans: list[tuple[str, float, int]]
    top_users: list[tuple[str, float, int]]
    underutilized_count: int
    oversized_plan_count: int
    useless_roaming_count: int
    over_quota_count: int
    roaming_count: int
    anomaly_count: int
    outlier_count: int
    high_risk_count: int
    fraud_signal_count: int
    inactive_billed_count: int
    incident_count: int
    critical_incident_count: int
    cost_score: int
    anomaly_score: int
    fraud_score: int
    optimization_score: int
    underutilization_score: int
    profitability_score: int
    score_labels: dict[str, str]
    risk_level: str
    confidence: float
    estimated_savings_mad: float | None
    detected_kpis: list[str]
    detected_anomalies: list[str]
    decision_recommendations: list[ChatDecisionRecommendation]
    recommendation_texts: list[str]
    dataframe_preview_lines: list[str]
    business_answer: str


def _dedupe_items(values: list[str], limit: int) -> list[str]:
    unique_values: list[str] = []
    seen_values = set()
    for raw_value in values:
        normalized_value = raw_value.strip()
        if not normalized_value:
            continue
        dedupe_key = _normalize_text(normalized_value) or normalized_value.lower()
        if dedupe_key in seen_values:
            continue
        seen_values.add(dedupe_key)
        unique_values.append(normalized_value)
        if len(unique_values) >= limit:
            break
    return unique_values


def _clamp_score(value: float) -> int:
    return max(0, min(int(round(value)), 100))


def _score_to_level(value: int) -> str:
    if value >= 71:
        return "critical"
    if value >= 51:
        return "high"
    if value >= 31:
        return "medium"
    return "low"


def _score_to_level_fr(value: int) -> str:
    return RISK_LEVEL_LABELS_FR[_score_to_level(value)]


def _resolve_analysis_mode(raw_mode: str | None) -> str:
    normalized_mode = (raw_mode or "advanced").strip().lower()
    if normalized_mode == "dashboard_analysis":
        return "dashboard_analysis"
    return "advanced" if normalized_mode == "advanced" else "quick"


def _normalize_text(value: str | None) -> str:
    raw_value = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", (value or "").strip())
    normalized_value = unicodedata.normalize("NFD", raw_value.lower())
    normalized_value = "".join(
        character for character in normalized_value if unicodedata.category(character) != "Mn"
    )
    return re.sub(r"[^a-z0-9]+", " ", normalized_value).strip()


def _resolve_document_type(filename: str | None, content_type: str | None) -> str:
    extension = Path(filename or "document").suffix.lower()
    if extension in SUPPORTED_DOCUMENT_TYPES:
        return SUPPORTED_DOCUMENT_TYPES[extension]

    normalized_type = (content_type or "").split(";", 1)[0].strip().lower()
    if normalized_type in SUPPORTED_DOCUMENT_MIME_TYPES:
        return SUPPORTED_DOCUMENT_MIME_TYPES[normalized_type]

    raise InvalidImageError(
        "Format de document non supporte. Utilisez PDF, CSV ou Excel.",
        status_code=415,
    )


def _format_mad(value: float) -> str:
    return f"{value:,.0f} MAD".replace(",", " ")


def _normalize_numeric_token(token: str) -> str:
    normalized = token.replace(" ", "").replace("\u00a0", "")
    if "," in normalized and "." in normalized:
        if normalized.rfind(",") > normalized.rfind("."):
            normalized = normalized.replace(".", "").replace(",", ".")
        else:
            normalized = normalized.replace(",", "")
        return normalized
    if normalized.count(",") > 1:
        return normalized.replace(",", "")
    if normalized.count(".") > 1:
        return normalized.replace(".", "")
    if "," in normalized:
        decimal_part = normalized.split(",")[-1]
        return normalized.replace(",", "") if len(decimal_part) == 3 else normalized.replace(",", ".")
    if "." in normalized:
        decimal_part = normalized.split(".")[-1]
        return normalized.replace(".", "") if len(decimal_part) == 3 else normalized
    return normalized


def _extract_numeric_value(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return float(value)
    if isinstance(value, (int, float)):
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    raw_text = str(value).strip()
    if not raw_text:
        return None

    match = NUMBER_PATTERN.search(raw_text.replace("\u00a0", " "))
    if not match:
        return None

    normalized_token = _normalize_numeric_token(match.group(1))
    try:
        return float(normalized_token)
    except ValueError:
        return None


def _series_to_numeric(series: Any) -> Any:
    return series.map(_extract_numeric_value)


def _matches_keywords(column_name: str, keywords: tuple[str, ...]) -> bool:
    normalized_name = _normalize_text(column_name)
    return any(keyword in normalized_name for keyword in keywords)


def _safe_text(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def _looks_like_phone_identifier(value: str | None) -> bool:
    digits = re.sub(r"\D+", "", value or "")
    return len(digits) >= 8


def _clean_cell(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, str):
        cleaned = value.strip()
        return cleaned or None
    return value


def _is_empty_text(value: Any) -> bool:
    return _normalize_text(_safe_text(value)) in EMPTY_TEXT_MARKERS


def _is_generic_column_name(column_name: str) -> bool:
    return bool(re.fullmatch(r"colonne_\d+", column_name.strip().lower()))


def _build_unique_column_names(
    raw_values: list[Any],
    *,
    force_generic_numeric: bool = False,
) -> list[str]:
    renamed_columns: list[str] = []
    seen_columns: dict[str, int] = {}
    for index, raw_column in enumerate(raw_values, start=1):
        base_name = str(raw_column).strip()
        if (
            not base_name
            or base_name.lower().startswith("unnamed:")
            or _is_empty_text(base_name)
            or (
                force_generic_numeric
                and _extract_numeric_value(base_name) is not None
                and not any(character.isalpha() for character in base_name)
            )
        ):
            base_name = f"colonne_{index}"
        base_name = re.sub(r"\s+", " ", base_name)
        occurrence = seen_columns.get(base_name, 0)
        seen_columns[base_name] = occurrence + 1
        renamed_columns.append(base_name if occurrence == 0 else f"{base_name}_{occurrence + 1}")
    return renamed_columns


def _header_row_quality_score(dataframe: Any, row_index: int) -> float:
    if dataframe.empty or row_index < 0 or row_index >= len(dataframe.index):
        return -9999.0

    row_values = list(dataframe.iloc[row_index].tolist())
    non_empty_values = [value for value in row_values if not _is_empty_text(value)]
    non_empty_count = len(non_empty_values)
    if non_empty_count < 2:
        return -9999.0

    rendered_values = [_safe_text(value) for value in non_empty_values]
    normalized_values = [_normalize_text(value) for value in rendered_values]
    unique_ratio = len({value for value in normalized_values if value}) / max(non_empty_count, 1)
    textual_count = sum(
        1
        for value in rendered_values
        if any(character.isalpha() for character in value) or "_" in value or "/" in value or "-" in value
    )
    numeric_only_count = sum(
        1
        for value in rendered_values
        if _extract_numeric_value(value) is not None and not any(character.isalpha() for character in value)
    )
    long_text_count = sum(1 for value in rendered_values if len(value) >= 60)
    business_hits = _count_business_header_hits(rendered_values)

    score = 0.0
    score += non_empty_count * 2.4
    score += unique_ratio * 12
    score += textual_count * 1.5
    score += business_hits * 5.5
    score -= numeric_only_count * 4.2
    score -= long_text_count * 2.8
    if non_empty_count > 0 and (textual_count / non_empty_count) < 0.5:
        score -= 10
    if business_hits == 0 and textual_count < max(2, int(non_empty_count * 0.6)):
        score -= 6

    sample_after = dataframe.iloc[row_index + 1 : row_index + 5]
    if not sample_after.empty:
        flattened_values = [
            _safe_text(value)
            for row_values_after in sample_after.itertuples(index=False, name=None)
            for value in row_values_after
            if not _is_empty_text(value)
        ]
        if flattened_values:
            sample_numeric_ratio = sum(
                1
                for value in flattened_values
                if _extract_numeric_value(value) is not None and not any(character.isalpha() for character in value)
            ) / max(len(flattened_values), 1)
            sample_business_hits = _count_business_header_hits(flattened_values[: min(len(flattened_values), 20)])
            score += sample_numeric_ratio * 6
            if business_hits > sample_business_hits:
                score += 3

    if row_index > 0:
        score -= row_index * 0.8
    return score


def _score_prepared_dataframe(
    dataframe: Any,
    *,
    header_detected: bool,
    header_row_index: int | None,
    decoded_text: str | None = None,
    separator: str | None = None,
) -> float:
    row_count = int(len(dataframe.index))
    column_count = int(len(dataframe.columns))
    if column_count <= 0:
        return -9999.0

    non_empty_ratio = 0.0
    if row_count > 0 and column_count > 0:
        non_empty_ratio = float(dataframe.notna().mean().mean())

    generic_columns = sum(1 for column_name in dataframe.columns if _is_generic_column_name(str(column_name)))
    numeric_headers = sum(
        1
        for column_name in dataframe.columns
        if _extract_numeric_value(column_name) is not None and not any(character.isalpha() for character in str(column_name))
    )
    long_headers = sum(1 for column_name in dataframe.columns if len(str(column_name).strip()) >= 60)

    score = 0.0
    score += min(row_count, 500) * 0.06
    score += min(column_count, 40) * 4.5
    score += non_empty_ratio * 22
    score += _count_business_header_hits([str(column_name) for column_name in dataframe.columns]) * 6.0
    score += 8.0 if header_detected else 0.0
    score -= generic_columns * 2.0
    score -= numeric_headers * 4.0
    score -= long_headers * 1.5
    if column_count > 1:
        score += 18
    else:
        score -= 35

    if header_detected and header_row_index and header_row_index > 0:
        score += min(header_row_index, 4) * 1.2

    if decoded_text:
        non_empty_lines = [line for line in decoded_text.splitlines() if line.strip()]
        header_line = non_empty_lines[0] if non_empty_lines else ""
        delimiter_counts = {candidate: header_line.count(candidate) for candidate in (";", ",", "\t")}
        likely_separator = max(delimiter_counts, key=delimiter_counts.get) if delimiter_counts else None
        if likely_separator and delimiter_counts.get(likely_separator, 0) > 0 and likely_separator == separator:
            score += 8
        if column_count == 1 and not dataframe.empty:
            sample_values = dataframe.iloc[: min(row_count, 8), 0].fillna("").astype(str).tolist()
            fused_cells = sum(
                1
                for cell_value in sample_values
                if any(candidate in cell_value for candidate in (";", ",", "\t"))
            )
            score -= fused_cells * 5
            if any(delimiter_counts.values()):
                score -= 20

    return score


def _materialize_prepared_dataframe(
    source_dataframe: Any,
    *,
    header_row_index: int | None,
    strategy: str,
) -> PreparedDataframe:
    working_frame = source_dataframe.copy()
    if header_row_index is None:
        working_frame.columns = _build_unique_column_names(
            list(working_frame.columns),
            force_generic_numeric=True,
        )
    else:
        header_values = list(working_frame.iloc[header_row_index].tolist())
        working_frame = working_frame.iloc[header_row_index + 1 :].copy()
        working_frame.columns = _build_unique_column_names(header_values)

    for column_name in working_frame.columns:
        working_frame[column_name] = working_frame[column_name].map(_clean_cell)

    working_frame = working_frame.dropna(axis=0, how="all").dropna(axis=1, how="all")
    if len(working_frame.columns) >= 4:
        minimum_cells = 2
        sparse_row_mask = working_frame.notna().sum(axis=1) >= minimum_cells
        if sparse_row_mask.any():
            working_frame = working_frame.loc[sparse_row_mask]

    prepared_dataframe = working_frame.reset_index(drop=True)
    quality_score = _score_prepared_dataframe(
        prepared_dataframe,
        header_detected=header_row_index is not None,
        header_row_index=header_row_index,
    )
    return PreparedDataframe(
        dataframe=prepared_dataframe,
        header_row_index=header_row_index,
        header_detected=header_row_index is not None,
        strategy=strategy,
        quality_score=quality_score,
    )


def _prepare_dataframe(dataframe: Any) -> PreparedDataframe:
    trimmed = dataframe.dropna(axis=0, how="all").dropna(axis=1, how="all").copy()
    if trimmed.empty:
        return PreparedDataframe(
            dataframe=trimmed.reset_index(drop=True),
            header_row_index=None,
            header_detected=False,
            strategy="empty",
            quality_score=-9999.0,
        )

    candidates = [
        _materialize_prepared_dataframe(
            trimmed,
            header_row_index=None,
            strategy="synthetic_header",
        )
    ]
    max_rows_to_probe = min(8, len(trimmed.index))
    header_candidates = sorted(
        (
            (_header_row_quality_score(trimmed, row_index), row_index)
            for row_index in range(max_rows_to_probe)
        ),
        reverse=True,
    )
    for header_score, row_index in header_candidates[:2]:
        if header_score < 14.0:
            continue
        candidates.append(
            _materialize_prepared_dataframe(
                trimmed,
                header_row_index=row_index,
                strategy="detected_header" if row_index == 0 else "detected_header_after_preamble",
            )
        )

    return max(
        candidates,
        key=lambda candidate: (
            candidate.quality_score,
            len(candidate.dataframe.columns),
            len(candidate.dataframe.index),
        ),
    )


def _separator_label(separator: str | None) -> str:
    if separator is None:
        return "auto"
    if separator == "\t":
        return "tab"
    return separator


def _sniff_csv_separator(decoded_text: str) -> str | None:
    sample_lines = [line for line in decoded_text.splitlines()[:10] if line.strip()]
    sample = "\n".join(sample_lines)
    if not sample:
        return None
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=";,\t")
        return dialect.delimiter
    except csv.Error:
        first_line = sample_lines[0] if sample_lines else ""
        delimiter_counts = {separator: first_line.count(separator) for separator in (";", ",", "\t")}
        best_separator = max(delimiter_counts, key=delimiter_counts.get)
        return best_separator if delimiter_counts[best_separator] > 0 else None


def _count_business_header_hits(columns: list[str]) -> int:
    hits = 0
    for column_name in columns:
        normalized_name = _normalize_text(column_name)
        if not normalized_name:
            continue
        if any(
            _normalize_text(keyword) in normalized_name
            for rule in BUSINESS_COLUMN_RULES.values()
            for keyword in rule.keywords
        ):
            hits += 1
    return hits


def _score_csv_candidate(
    prepared: PreparedDataframe,
    decoded_text: str,
    separator: str | None,
) -> float:
    return _score_prepared_dataframe(
        prepared.dataframe,
        header_detected=prepared.header_detected,
        header_row_index=prepared.header_row_index,
        decoded_text=decoded_text,
        separator=separator,
    )


def _load_csv_dataframe(document_bytes: bytes) -> LoadedDocument:
    if pd is None:
        raise ChatServerError("Le moteur pandas d'analyse tabulaire est indisponible cote serveur.")

    candidates: list[CsvParseCandidate] = []
    last_error: Exception | None = None
    for encoding in CSV_ENCODINGS:
        strict_decode_ok = True
        try:
            document_bytes.decode(encoding)
        except UnicodeDecodeError:
            strict_decode_ok = False
        decoded_text = document_bytes.decode(encoding, errors="ignore")

        sniffed_separator = _sniff_csv_separator(decoded_text)
        attempted_separators: list[str | None] = []
        for separator in CSV_SEPARATORS:
            if separator in attempted_separators:
                continue
            attempted_separators.append(separator)
        if sniffed_separator is not None and sniffed_separator not in attempted_separators:
            attempted_separators.insert(1, sniffed_separator)

        for separator in attempted_separators:
            try:
                dataframe = pd.read_csv(
                    io.BytesIO(document_bytes),
                    sep=separator,
                    engine="python",
                    header=None,
                    dtype=object,
                    encoding=encoding,
                    encoding_errors="ignore",
                    on_bad_lines="skip",
                )
                prepared_dataframe = _prepare_dataframe(dataframe)
                selected_separator = separator if separator is not None else sniffed_separator
                score = _score_csv_candidate(prepared_dataframe, decoded_text, selected_separator)
                score += 5.0 if strict_decode_ok else -3.0
                candidate = CsvParseCandidate(
                    dataframe=prepared_dataframe.dataframe,
                    encoding=encoding,
                    separator=selected_separator,
                    strategy=prepared_dataframe.strategy if separator is None else f"fallback:{prepared_dataframe.strategy}",
                    score=score,
                    row_count=int(len(prepared_dataframe.dataframe.index)),
                    column_count=int(len(prepared_dataframe.dataframe.columns)),
                    header_detected=prepared_dataframe.header_detected,
                    header_row_index=prepared_dataframe.header_row_index,
                )
                candidates.append(candidate)
                DOCUMENT_LOGGER.info(
                    "event=document_csv_candidate encoding=%s separator=%s strategy=%s strict_decode_ok=%s header_detected=%s header_row=%s rows=%s cols=%s score=%.2f",
                    encoding,
                    _separator_label(selected_separator),
                    candidate.strategy,
                    strict_decode_ok,
                    candidate.header_detected,
                    None if candidate.header_row_index is None else candidate.header_row_index + 1,
                    candidate.row_count,
                    candidate.column_count,
                    candidate.score,
                )
            except Exception as exc:  # pragma: no cover - parser fallback chain
                last_error = exc
                DOCUMENT_LOGGER.info(
                    "event=document_csv_parse_failed encoding=%s separator=%s error=%s",
                    encoding,
                    _separator_label(separator),
                    str(exc),
                )

    if not candidates:
        raise InvalidImageError(
            "Le fichier CSV n'a pas pu etre lu.",
            status_code=422,
            log_message=str(last_error) if last_error is not None else None,
        )

    best_candidate = max(
        candidates,
        key=lambda candidate: (
            candidate.score,
            candidate.column_count,
            candidate.row_count,
        ),
    )
    DOCUMENT_LOGGER.info(
        "event=document_csv_selected encoding=%s separator=%s strategy=%s header_detected=%s header_row=%s rows=%s cols=%s score=%.2f",
        best_candidate.encoding,
        _separator_label(best_candidate.separator),
        best_candidate.strategy,
        best_candidate.header_detected,
        None if best_candidate.header_row_index is None else best_candidate.header_row_index + 1,
        best_candidate.row_count,
        best_candidate.column_count,
        best_candidate.score,
    )
    separator_notice = (
        "tabulation" if best_candidate.separator == "\t" else _separator_label(best_candidate.separator)
    )
    parse_notice = f"CSV charge avec encodage {best_candidate.encoding} et separateur {separator_notice}."
    if best_candidate.header_detected:
        parse_notice += (
            f" Ligne d'entete detectee: {int(best_candidate.header_row_index or 0) + 1}."
        )
    return LoadedDocument(
        dataframe=best_candidate.dataframe,
        document_type="csv",
        selected_sheet=None,
        parse_notice=parse_notice,
        parse_debug={
            "encoding": best_candidate.encoding,
            "separator": _separator_label(best_candidate.separator),
            "strategy": best_candidate.strategy,
            "rows": best_candidate.row_count,
            "columns": best_candidate.column_count,
            "score": round(best_candidate.score, 2),
            "header_detected": best_candidate.header_detected,
            "header_row": None
            if best_candidate.header_row_index is None
            else int(best_candidate.header_row_index) + 1,
        },
    )


def _load_excel_dataframe(document_bytes: bytes, document_type: str) -> LoadedDocument:
    if pd is None:
        raise ChatServerError("Le moteur pandas d'analyse tabulaire est indisponible cote serveur.")

    engine = "openpyxl" if document_type == "xlsx" else "xlrd"
    try:
        excel_file = pd.ExcelFile(io.BytesIO(document_bytes), engine=engine)
    except ImportError as exc:  # pragma: no cover - runtime dependency guard
        raise ChatServerError(
            "Le moteur Excel cote serveur est incomplet pour ce type de fichier."
        ) from exc
    except Exception as exc:
        raise InvalidImageError(
            "Le fichier Excel n'a pas pu etre lu.",
            status_code=422,
            log_message=str(exc),
        ) from exc

    selected_sheet: str | None = None
    selected_prepared: PreparedDataframe | None = None
    best_score = -9999.0
    for sheet_name in excel_file.sheet_names:
        candidate_prepared = _prepare_dataframe(
            excel_file.parse(
                sheet_name=sheet_name,
                header=None,
                dtype=object,
            )
        )
        score = _score_prepared_dataframe(
            candidate_prepared.dataframe,
            header_detected=candidate_prepared.header_detected,
            header_row_index=candidate_prepared.header_row_index,
        )
        DOCUMENT_LOGGER.info(
            "event=document_excel_candidate sheet=%s header_detected=%s header_row=%s strategy=%s rows=%s cols=%s score=%.2f",
            sheet_name,
            candidate_prepared.header_detected,
            None if candidate_prepared.header_row_index is None else candidate_prepared.header_row_index + 1,
            candidate_prepared.strategy,
            len(candidate_prepared.dataframe.index),
            len(candidate_prepared.dataframe.columns),
            score,
        )
        if score > best_score:
            selected_sheet = sheet_name
            selected_prepared = candidate_prepared
            best_score = score

    if selected_prepared is None:
        raise InvalidImageError(
            "Le fichier Excel ne contient aucune feuille exploitable.",
            status_code=422,
        )

    DOCUMENT_LOGGER.info(
        "event=document_excel_selected sheet=%s rows=%s cols=%s engine=%s header_detected=%s header_row=%s score=%.2f",
        selected_sheet,
        len(selected_prepared.dataframe.index),
        len(selected_prepared.dataframe.columns),
        engine,
        selected_prepared.header_detected,
        None if selected_prepared.header_row_index is None else selected_prepared.header_row_index + 1,
        best_score,
    )
    parse_notice = f"Feuille analysee: {selected_sheet}." if selected_sheet else None
    if parse_notice and selected_prepared.header_detected:
        parse_notice += (
            f" Ligne d'entete detectee: {int(selected_prepared.header_row_index or 0) + 1}."
        )
    return LoadedDocument(
        dataframe=selected_prepared.dataframe,
        document_type=document_type,
        selected_sheet=selected_sheet,
        parse_notice=parse_notice,
        parse_debug={
            "sheet": selected_sheet,
            "rows": int(len(selected_prepared.dataframe.index)),
            "columns": int(len(selected_prepared.dataframe.columns)),
            "engine": engine,
            "score": round(best_score, 2),
            "header_detected": selected_prepared.header_detected,
            "header_row": None
            if selected_prepared.header_row_index is None
            else int(selected_prepared.header_row_index) + 1,
        },
    )


def _load_tabular_document(
    document_bytes: bytes,
    *,
    document_type: str,
) -> LoadedDocument:
    if document_type == "csv":
        return _load_csv_dataframe(document_bytes)
    if document_type in {"xlsx", "xls"}:
        return _load_excel_dataframe(document_bytes, document_type)
    raise InvalidImageError("Format de document tabulaire non supporte.", status_code=415)


def _build_outlier_mask(series: Any) -> Any:
    if pd is None:
        raise ChatServerError("Le moteur pandas d'analyse tabulaire est indisponible cote serveur.")

    numeric_series = series.dropna()
    if len(numeric_series.index) < 4:
        return pd.Series(False, index=series.index)

    first_quartile = numeric_series.quantile(0.25)
    third_quartile = numeric_series.quantile(0.75)
    inter_quartile_range = third_quartile - first_quartile
    upper_bound = (
        third_quartile + (1.5 * inter_quartile_range)
        if inter_quartile_range > 0
        else numeric_series.quantile(0.9)
    )
    return series.fillna(float("-inf")) > upper_bound


def _normalize_response_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _build_dataframe_preview(dataframe: Any) -> list[str]:
    preview_lines: list[str] = []
    preview_frame = dataframe.head(3).fillna("")
    visible_columns = list(preview_frame.columns[:5])
    for _index, row in preview_frame.iterrows():
        cells = [f"{column}={_safe_text(row[column])[:28]}" for column in visible_columns if _safe_text(row[column])]
        if cells:
            preview_lines.append(" | ".join(cells))
    return preview_lines[:3]


def _is_truthy_cell(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        try:
            return float(value) > 0
        except (TypeError, ValueError):
            return False

    normalized_value = _normalize_text(str(value))
    if normalized_value in TRUTHY_VALUES:
        return True
    if normalized_value in FALSY_VALUES:
        return False
    return any(
        keyword in normalized_value
        for keyword in (
            "alert",
            "anomaly",
            "critical",
            "critique",
            "error",
            "failure",
            "fraud",
            "high",
            "incident",
            "roaming",
            "warning",
        )
    )


def _series_to_flag_mask(series: Any) -> Any:
    return series.map(_is_truthy_cell).fillna(False).astype(bool)


def _series_to_status_mask(series: Any, target_statuses: set[str]) -> Any:
    normalized = series.map(lambda value: _normalize_text(_safe_text(value))).fillna("")
    return normalized.isin(target_statuses)


def _series_to_severity_mask(series: Any) -> Any:
    normalized = series.map(lambda value: _normalize_text(_safe_text(value))).fillna("")
    return normalized.isin(CRITICAL_SEVERITY_VALUES)


def _has_phone_like_values(series: Any) -> bool:
    sample_values = []
    for value in series.dropna().head(20).tolist():
        raw_value = _safe_text(value)
        if not raw_value:
            continue
        if ":" in raw_value or re.search(r"\d{4}[-/]\d{1,2}[-/]\d{1,2}", raw_value):
            continue
        digits = re.sub(r"\D+", "", raw_value)
        if digits:
            sample_values.append(digits)
    return bool(sample_values) and sum(len(value) >= 8 for value in sample_values) >= max(1, len(sample_values) // 2)


def _series_unique_ratio(series: Any) -> float:
    non_null = series.dropna()
    if len(non_null.index) == 0:
        return 0.0
    return float(non_null.astype(str).nunique() / max(len(non_null.index), 1))


def _score_column_for_rule(
    category: str,
    column_name: str,
    rule: ColumnRule,
    series: Any,
    numeric_series: Any,
) -> float:
    normalized_name = _normalize_text(column_name)
    if not normalized_name:
        return 0.0
    if any(_normalize_text(blocked_term) in normalized_name for blocked_term in rule.blocked_terms):
        return 0.0

    score = 0.0
    matched_name = False
    numeric_density = float(numeric_series.notna().mean()) if len(numeric_series.index) > 0 else 0.0
    tokens = set(normalized_name.split())
    if category == "departement" and normalized_name in {"service", "direction"}:
        score += 3.0
        matched_name = True
    if category == "ligne" and normalized_name in {"line", "ligne"}:
        score += 3.0
        matched_name = True
    if category == "telephone" and normalized_name in {"phone", "mobile", "telephone", "numero"}:
        score += 3.0
        matched_name = True
    for keyword in rule.keywords:
        normalized_keyword = _normalize_text(keyword)
        if not normalized_keyword:
            continue
        if normalized_keyword == normalized_name:
            score += 4.0
            matched_name = True
        elif normalized_keyword in normalized_name:
            score += 2.2
            matched_name = True
        elif normalized_keyword in tokens:
            score += 1.7
            matched_name = True
    for preferred_keyword in rule.preferred:
        normalized_preferred = _normalize_text(preferred_keyword)
        if normalized_preferred and normalized_preferred in normalized_name:
            score += 1.1

    status_values: set[str] = set()
    if category == "statut":
        status_values = {_normalize_text(_safe_text(value)) for value in series.dropna().head(25).tolist()}
    if not matched_name:
        if category in {"ligne", "telephone"} and _has_phone_like_values(series):
            score += 2.8
        elif category == "statut" and status_values & (INACTIVE_STATUSES | {"active", "actif"}):
            score += 2.6
        else:
            return 0.0

    if rule.numeric:
        score += numeric_density * 3.0
        if numeric_density < rule.min_density:
            score -= 2.2
    else:
        if numeric_density <= 0.2:
            score += 0.8
        elif numeric_density >= 0.8:
            score -= 1.0
    if (
        category
        in {
            "cout_total",
            "cout_roaming",
            "consommation_data",
            "quota_data",
            "consommation_appels",
            "quota_appels",
            "consommation_sms",
            "quota_sms",
            "revenu",
        }
        and any(term in normalized_name for term in ("flag", "alert", "score", "level", "risk", "status"))
    ):
        score -= 2.8

    unique_ratio = _series_unique_ratio(series)
    if category == "utilisateur" and 0.35 <= unique_ratio <= 1.0:
        score += 1.2
    if category == "utilisateur" and unique_ratio < 0.15:
        score -= 2.6
    if category in {"departement", "forfait", "operateur", "statut"} and 0.01 < unique_ratio <= 0.5:
        score += 1.0
    if category in {"departement", "forfait", "operateur"} and numeric_density >= 0.6:
        score -= 2.0
    if category in {"ligne", "telephone"} and _has_phone_like_values(series):
        score += 2.0
    if category in {"roaming", "anomalie", "fraude", "depassement_quota"}:
        unique_values = {_normalize_text(_safe_text(value)) for value in series.dropna().head(25).tolist()}
        if unique_values and unique_values <= (TRUTHY_VALUES | FALSY_VALUES | {"high", "critical", "critique"}):
            score += 1.5
    if category == "statut":
        if status_values & (INACTIVE_STATUSES | {"active", "actif"}):
            score += 1.8
    if category == "risque" and numeric_density >= 0.2:
        score += 1.2

    return score


def _detect_business_columns(
    dataframe: Any,
    numeric_series_by_column: dict[str, Any],
) -> dict[str, list[str]]:
    mapping: dict[str, list[str]] = {}
    for category, rule in BUSINESS_COLUMN_RULES.items():
        ranked_columns: list[tuple[float, str]] = []
        for column_name in dataframe.columns:
            score = _score_column_for_rule(
                category,
                str(column_name),
                rule,
                dataframe[column_name],
                numeric_series_by_column[str(column_name)],
            )
            if score >= rule.threshold:
                ranked_columns.append((score, str(column_name)))

        ranked_columns.sort(
            key=lambda item: (
                item[0],
                float(numeric_series_by_column[item[1]].notna().mean()),
                -len(item[1]),
            ),
            reverse=True,
        )
        mapping[category] = [column_name for _score, column_name in ranked_columns[: rule.limit]]
    return mapping


def _infer_column_profiles(
    dataframe: Any,
    numeric_series_by_column: dict[str, Any],
) -> dict[str, str]:
    profiles: dict[str, str] = {}
    for column_name in dataframe.columns:
        series = dataframe[column_name]
        numeric_series = numeric_series_by_column[str(column_name)]
        numeric_density = float(numeric_series.notna().mean()) if len(series.index) > 0 else 0.0
        unique_ratio = _series_unique_ratio(series)
        if numeric_density >= 0.85:
            profiles[str(column_name)] = "numeric"
        elif numeric_density >= 0.4:
            profiles[str(column_name)] = "mixed_numeric"
        elif unique_ratio <= 0.25:
            profiles[str(column_name)] = "categorical"
        elif _has_phone_like_values(series):
            profiles[str(column_name)] = "identifier"
        else:
            profiles[str(column_name)] = "text"
    return profiles


def _pick_column(
    candidates: list[str],
    preferred_keywords: tuple[str, ...],
    numeric_series_by_column: dict[str, Any],
) -> str | None:
    if not candidates:
        return None
    return max(
        candidates,
        key=lambda column_name: (
            sum(1 for keyword in preferred_keywords if _normalize_text(keyword) in _normalize_text(column_name)),
            float(numeric_series_by_column[column_name].notna().mean()),
            -len(column_name),
        ),
    )


def _empty_numeric_series(index: Any) -> Any:
    return pd.Series([float("nan")] * len(index), index=index, dtype=float)


def _empty_bool_series(index: Any) -> Any:
    return pd.Series(False, index=index, dtype=bool)


def _combine_numeric_columns(
    columns: list[str],
    numeric_series_by_column: dict[str, Any],
    index: Any,
) -> Any:
    if not columns:
        return _empty_numeric_series(index)
    combined = pd.concat([numeric_series_by_column[column_name] for column_name in columns], axis=1)
    return combined.max(axis=1, skipna=True)


def _combine_flag_columns(
    columns: list[str],
    dataframe: Any,
    numeric_series_by_column: dict[str, Any],
    index: Any,
) -> Any:
    if not columns:
        return _empty_bool_series(index)
    combined_mask = _empty_bool_series(index)
    for column_name in columns:
        numeric_density = float(numeric_series_by_column[column_name].notna().mean())
        if numeric_density >= 0.35:
            combined_mask = combined_mask | numeric_series_by_column[column_name].fillna(0).map(lambda value: value > 0)
        else:
            combined_mask = combined_mask | _series_to_flag_mask(dataframe[column_name])
    return combined_mask.fillna(False).astype(bool)


def _normalize_score_series(series: Any) -> Any:
    normalized = series.copy()
    if len(normalized.dropna().index) == 0:
        return normalized
    max_value = float(normalized.dropna().max())
    if max_value <= 1.0:
        return normalized * 100.0
    return normalized


def _aggregate_top_costs(
    dataframe: Any,
    group_column: str | None,
    cost_series: Any,
    limit: int = 3,
) -> list[tuple[str, float, int]]:
    if group_column is None or cost_series is None:
        return []
    working_frame = pd.DataFrame(
        {
            "group": dataframe[group_column].map(_safe_text),
            "cost": cost_series,
        }
    )
    working_frame = working_frame[(working_frame["group"] != "") & working_frame["cost"].notna()]
    if working_frame.empty:
        return []
    grouped = (
        working_frame.groupby("group", dropna=True)["cost"]
        .agg(["sum", "count"])
        .sort_values("sum", ascending=False)
        .head(limit)
    )
    return [
        (str(label), float(row["sum"]), int(row["count"]))
        for label, row in grouped.iterrows()
    ]


def _compute_average_cost_per_entity(
    dataframe: Any,
    group_column: str | None,
    cost_series: Any,
) -> float | None:
    if group_column is None or cost_series is None:
        return None
    working_frame = pd.DataFrame(
        {
            "group": dataframe[group_column].map(_safe_text),
            "cost": cost_series,
        }
    )
    working_frame = working_frame[(working_frame["group"] != "") & working_frame["cost"].notna()]
    if working_frame.empty:
        return None
    grouped = working_frame.groupby("group", dropna=True)["cost"].sum()
    if grouped.empty:
        return None
    return float(grouped.mean())


def _estimate_underutilized_savings(cost_series: Any, usage_ratio: Any, underutilized_mask: Any) -> float:
    if cost_series is None:
        return 0.0
    potential = cost_series.fillna(0) * (0.18 + (0.30 - usage_ratio.fillna(0)).clip(lower=0, upper=0.30))
    potential = potential.clip(lower=0)
    return float(potential[underutilized_mask].sum())


def _estimate_oversized_savings(cost_series: Any, oversized_mask: Any) -> float:
    if cost_series is None:
        return 0.0
    return float((cost_series.fillna(0) * 0.12)[oversized_mask].sum())


def _estimate_roaming_savings(
    cost_series: Any,
    useless_roaming_mask: Any,
    roaming_cost_series: Any,
) -> float:
    if cost_series is None:
        return 0.0
    explicit_roaming_savings = 0.0
    if roaming_cost_series is not None:
        explicit_roaming_savings = float((roaming_cost_series.fillna(0) * 0.85)[useless_roaming_mask].sum())
    fallback_savings = float((cost_series.fillna(0) * 0.08)[useless_roaming_mask].sum())
    return max(explicit_roaming_savings, fallback_savings)


def _estimate_inactive_savings(cost_series: Any, inactive_billed_mask: Any) -> float:
    if cost_series is None:
        return 0.0
    return float(cost_series[inactive_billed_mask].fillna(0).sum())


def _estimate_overquota_savings(cost_series: Any, over_quota_mask: Any) -> float:
    if cost_series is None:
        return 0.0
    return float((cost_series.fillna(0) * 0.07)[over_quota_mask].sum())


def _safe_ratio(numerator: float, denominator: float) -> float:
    if denominator <= 0:
        return 0.0
    return numerator / denominator


def _build_score_labels(
    *,
    cost_score: int,
    anomaly_score: int,
    fraud_score: int,
    optimization_score: int,
    underutilization_score: int,
    profitability_score: int,
) -> dict[str, str]:
    return {
        "cout": _score_to_level_fr(cost_score),
        "anomalie": _score_to_level_fr(anomaly_score),
        "fraude": _score_to_level_fr(fraud_score),
        "optimisation": _score_to_level_fr(optimization_score),
        "sous_utilisation": _score_to_level_fr(underutilization_score),
        "rentabilite": _score_to_level_fr(profitability_score),
    }


def _detect_document_profile(
    business_mapping: dict[str, list[str]],
    *,
    primary_cost_column: str | None,
    incident_count: int,
    critical_incident_count: int,
) -> str:
    telecom_signals = sum(
        1
        for key in (
            "consommation_data",
            "quota_data",
            "consommation_appels",
            "quota_appels",
            "consommation_sms",
            "quota_sms",
            "roaming",
            "forfait",
            "ligne",
            "telephone",
            "operateur",
        )
        if business_mapping.get(key)
    )
    finance_signals = sum(
        1
        for key in ("cout_total", "facture", "revenu", "engagement", "departement")
        if business_mapping.get(key)
    )
    log_signals = sum(
        1
        for key in ("incident", "gravite", "horodatage", "anomalie")
        if business_mapping.get(key)
    )
    hr_signals = sum(
        1
        for key in ("utilisateur", "departement", "engagement")
        if business_mapping.get(key)
    )
    if log_signals >= 2 and (incident_count > 0 or critical_incident_count > 0):
        return "logs_incidents"
    if telecom_signals >= 3:
        return "telecom_usage"
    if finance_signals >= 2 and primary_cost_column is not None:
        return "finance_operations"
    if hr_signals >= 2 and telecom_signals < 2:
        return "hr_operations"
    return "business_table"


def _document_label(document_profile: str) -> str:
    return {
        "business_table": "tableau",
        "finance_operations": "tableau financier",
        "hr_operations": "tableau RH",
        "logs_incidents": "journal d'incidents",
        "telecom_usage": "tableau telecom",
    }.get(document_profile, "tableau")


def _resource_label(document_profile: str) -> str:
    return "lignes" if document_profile == "telecom_usage" else "ressources"


def _resource_labels(document_profile: str) -> tuple[str, str]:
    if document_profile == "telecom_usage":
        return ("ligne", "lignes")
    return ("ressource", "ressources")


def _priority_treatment_label(score: int) -> str:
    if score >= 80:
        return "Immediate"
    if score >= 60:
        return "Haute"
    if score >= 35:
        return "Moyenne"
    return "Normale"


def _primary_financial_label(primary_cost_column: str | None) -> str:
    normalized_column = _normalize_text(primary_cost_column)
    if any(token in normalized_column for token in ("revenue", "revenu", "arr", "mrr")):
        return "revenus"
    if any(token in normalized_column for token in ("facture", "invoice", "bill", "billing")):
        return "facturation"
    if any(token in normalized_column for token in ("amount", "montant", "price", "prix", "tariff", "tarif")):
        return "montants"
    return "couts"


def _risk_narrative_label(value: str) -> str:
    return {
        "low": "faible",
        "medium": "modere",
        "high": "eleve",
        "critical": "critique",
    }.get(value, "modere")


def _cost_period_label(primary_cost_column: str | None) -> str:
    normalized_column = _normalize_text(primary_cost_column)
    if any(token in normalized_column for token in ("monthly", "mensuel", "month")):
        return "mois"
    if "annual" in normalized_column or "year" in normalized_column:
        return "an"
    return "cycle de facturation"


def _format_risk_metric(metric_key: str, score: int, level_label: str) -> str:
    metric_label = RISK_METRIC_LABELS_FR.get(metric_key, metric_key.title())
    return f"- {metric_label}: {score}/100 ({level_label})"


def _count_noun(count: int, singular: str, plural: str | None = None) -> str:
    resolved_plural = plural or f"{singular}s"
    noun = singular if count == 1 else resolved_plural
    return f"{count} {noun}"


def _document_allows_max_risk_score(
    *,
    row_count: int,
    fraud_signal_count: int,
    critical_incident_count: int,
) -> bool:
    row_denominator = max(row_count, 1)
    return (
        fraud_signal_count >= max(6, row_denominator // 5)
        or critical_incident_count >= max(5, row_denominator // 8)
    )


def _build_direction_summary(insights: TabularInsights) -> list[str]:
    resource_singular, resource_plural = _resource_labels(insights.document_profile)
    cost_period = _cost_period_label(insights.primary_cost_column)
    financial_label = _primary_financial_label(insights.primary_cost_column)

    concentration_parts: list[str] = []
    if insights.top_department and insights.top_department_cost is not None:
        concentration_parts.append(
            f"le departement {insights.top_department} avec {_format_mad(insights.top_department_cost)}"
        )
    if insights.top_plan and insights.top_plan_cost is not None:
        concentration_parts.append(
            f"le forfait {insights.top_plan} avec {_format_mad(insights.top_plan_cost)}"
        )
    if insights.top_user and insights.top_user_cost is not None:
        entity_label = "la ligne" if _looks_like_phone_identifier(insights.top_user) else "le profil"
        concentration_parts.append(f"{entity_label} {insights.top_user} avec {_format_mad(insights.top_user_cost)}")

    summary_lines: list[str] = []
    if concentration_parts and insights.total_primary_cost is not None:
        summary_lines.append(
            f"Les donnees montrent une concentration des {financial_label} sur "
            + ", ".join(concentration_parts[:3])
            + "."
        )
    elif insights.incident_count > 0:
        incident_sentence = (
            f"L'analyse revele que {_count_noun(insights.incident_count, 'incident', 'incidents')} ou evenements doivent etre surveilles"
            if insights.incident_count > 1
            else "L'analyse revele qu'un incident ou evenement doit etre surveille"
        )
        if insights.critical_incident_count > 0:
            incident_sentence += f", dont {insights.critical_incident_count} deja a criticite elevee"
        summary_lines.append(incident_sentence + ".")
    else:
        summary_lines.append(
            "Les indicateurs mettent en evidence plusieurs leviers d'arbitrage sur les couts, les usages et les risques."
        )

    optimization_fragments: list[str] = []
    if insights.underutilized_count > 0:
        optimization_fragments.append(
            (
                f"{_count_noun(insights.underutilized_count, resource_singular, resource_plural)} "
                + ("reste fortement sous-utilisee" if insights.underutilized_count == 1 else "restent fortement sous-utilisees")
            )
        )
    if insights.oversized_plan_count > 0:
        optimization_fragments.append(
            (
                "1 forfait apparait surdimensionne par rapport a l'usage reel observe"
                if insights.oversized_plan_count == 1
                else (
                    f"{insights.oversized_plan_count} forfaits apparaissent surdimensionnes "
                    "par rapport a l'usage reel observe"
                )
            )
        )
    if insights.useless_roaming_count > 0:
        optimization_fragments.append(
            (
                "1 ligne conserve du roaming sans usage justifiant le surcout"
                if insights.useless_roaming_count == 1
                else f"{insights.useless_roaming_count} lignes conservent du roaming sans usage justifiant le surcout"
            )
        )
    if insights.inactive_billed_count > 0:
        optimization_fragments.append(
            (
                "1 ressource inactive continue d'etre facturee"
                if insights.inactive_billed_count == 1
                else f"{insights.inactive_billed_count} ressources inactives continuent d'etre facturees"
            )
        )
    if insights.over_quota_count > 0:
        optimization_fragments.append(
            (
                f"1 {resource_singular} affiche un depassement recurrent"
                if insights.over_quota_count == 1
                else f"{insights.over_quota_count} {resource_plural} affichent des depassements recurrents"
            )
        )
    if optimization_fragments:
        if len(optimization_fragments) == 1:
            summary_lines.append(f"L'analyse revele que {optimization_fragments[0]}.")
        else:
            summary_lines.append(
                "L'analyse revele plusieurs leviers d'optimisation: "
                + ", ".join(optimization_fragments[:3])
                + "."
            )
    elif insights.anomaly_count == 0 and insights.critical_incident_count == 0:
        summary_lines.append(
            "Aucune derive critique immediate n'a ete detectee, mais la surveillance des couts et des usages doit rester active."
        )

    if insights.estimated_savings_mad is not None and insights.estimated_savings_mad > 0:
        action_fragments: list[str] = []
        if insights.underutilized_count > 0:
            action_fragments.append("le redimensionnement des forfaits sous-utilises")
        if insights.useless_roaming_count > 0:
            action_fragments.append("la rationalisation des options roaming")
        if insights.inactive_billed_count > 0:
            action_fragments.append("la suppression des ressources inactives facturees")
        lead_action = ", ".join(action_fragments[:3]) if action_fragments else "un plan d'optimisation cible"
        summary_lines.append(
            f"Une optimisation ciblee permettrait de reduire l'exposition financiere d'environ "
            f"{_format_mad(insights.estimated_savings_mad)} par {cost_period}, en priorisant {lead_action}."
        )
    elif insights.fraud_signal_count > 0 or insights.high_risk_count > 0:
        summary_lines.append(
            "Les depassements detectes suggerent un audit prioritaire des profils les plus exposes et un renforcement du controle."
        )
    elif insights.critical_incident_count > 0:
        summary_lines.append(
            "Le traitement prioritaire des incidents critiques limiterait le risque operationnel sur les prochains cycles."
        )

    return polish_business_items(
        summary_lines,
        limit=3,
        exceptional_scores=_document_allows_max_risk_score(
            row_count=insights.row_count,
            fraud_signal_count=insights.fraud_signal_count,
            critical_incident_count=insights.critical_incident_count,
        ),
    )


def _build_business_answer(question: str, insights: TabularInsights) -> str:
    risk_label = _risk_narrative_label(insights.risk_level)
    cost_period = _cost_period_label(insights.primary_cost_column)
    resource_singular, resource_plural = _resource_labels(insights.document_profile)
    financial_label = _primary_financial_label(insights.primary_cost_column)
    overall_risk_score = max(
        insights.cost_score,
        insights.anomaly_score,
        insights.fraud_score,
        insights.optimization_score,
        insights.underutilization_score,
        insights.profitability_score,
    )
    first_sentence = (
        f"Les donnees analysees mettent en evidence un niveau de risque {risk_label} "
        f"a partir de {insights.row_count} enregistrements exploitables."
    )
    if insights.total_primary_cost is not None and insights.primary_cost_column:
        first_sentence += (
            f" L'exposition financiere principale sur les {financial_label} atteint {_format_mad(insights.total_primary_cost)} "
            f"sur la colonne {insights.primary_cost_column}."
        )
    elif insights.incident_count > 0:
        first_sentence += f" {insights.incident_count} incidents ou evenements significatifs ont ete consolides."
        if insights.critical_incident_count > 0:
            first_sentence += f" {insights.critical_incident_count} portent deja une criticite elevee."

    concentration_parts: list[str] = []
    if insights.top_department and insights.top_department_cost is not None:
        concentration_parts.append(
            f"le departement {insights.top_department} concentre {_format_mad(insights.top_department_cost)}"
        )
    if insights.top_plan and insights.top_plan_cost is not None:
        concentration_parts.append(
            f"le forfait {insights.top_plan} porte {_format_mad(insights.top_plan_cost)}"
        )
    if insights.top_user and insights.top_user_cost is not None:
        entity_label = "la ligne mobile" if _looks_like_phone_identifier(insights.top_user) else "l'entite"
        concentration_parts.append(
            f"{entity_label} {insights.top_user} represente {_format_mad(insights.top_user_cost)}"
        )
    concentration_sentence = ""
    if concentration_parts:
        lead_label = "Le principal facteur de cout reste " if len(concentration_parts) == 1 else "Les principaux facteurs de cout restent "
        concentration_sentence = " " + lead_label + ", ".join(concentration_parts) + "."

    operational_findings: list[str] = []
    if insights.underutilized_count > 0:
        operational_findings.append(
            (
                "1 ligne utilise moins de 20% de sa capacite"
                if insights.underutilized_count == 1 and insights.document_profile == "telecom_usage"
                else (
                    "1 ressource utilise moins de 20% de sa capacite"
                    if insights.underutilized_count == 1
                    else f"{insights.underutilized_count} {resource_plural} utilisent moins de 20% de leur capacite"
                )
            )
        )
    if insights.oversized_plan_count > 0:
        operational_findings.append(
            (
                "1 forfait apparait surdimensionne par rapport a l'usage reel observe"
                if insights.oversized_plan_count == 1
                else (
                    f"{insights.oversized_plan_count} forfaits apparaissent surdimensionnes "
                    "par rapport a l'usage reel observe"
                )
            )
        )
    if insights.over_quota_count > 0:
        operational_findings.append(
            (
                f"1 {resource_singular} depasse son quota ou son seuil"
                if insights.over_quota_count == 1
                else f"{insights.over_quota_count} {resource_plural} depassent leur quota ou leur seuil"
            )
        )
    if insights.useless_roaming_count > 0:
        operational_findings.append(
            (
                "1 ligne conserve du roaming sans usage reel exploitable"
                if insights.useless_roaming_count == 1
                else f"{insights.useless_roaming_count} lignes conservent du roaming sans usage reel exploitable"
            )
        )
    if insights.inactive_billed_count > 0:
        operational_findings.append(
            (
                "1 ressource inactive reste facturee"
                if insights.inactive_billed_count == 1
                else f"{insights.inactive_billed_count} ressources inactives restent facturees"
            )
        )
    if insights.anomaly_count > 0:
        operational_findings.append(
            (
                "1 enregistrement cumule des signaux d'anomalie ou de risque"
                if insights.anomaly_count == 1
                else f"{insights.anomaly_count} enregistrements cumulent des signaux d'anomalie ou de risque"
            )
        )
    if insights.critical_incident_count > 0:
        operational_findings.append(
            (
                "1 incident porte une severite critique ou haute"
                if insights.critical_incident_count == 1
                else f"{insights.critical_incident_count} incidents portent une severite critique ou haute"
            )
        )
    findings_sentence = ""
    if operational_findings:
        if len(operational_findings) == 1:
            findings_sentence = f" L'analyse revele que {operational_findings[0]}."
        else:
            findings_sentence = (
                " L'analyse revele plusieurs points de vigilance: "
                + "; ".join(operational_findings)
                + "."
            )

    savings_sentence = ""
    if insights.estimated_savings_mad is not None and insights.estimated_savings_mad > 0:
        savings_sentence = (
            f" Economie potentielle estimee: environ {_format_mad(insights.estimated_savings_mad)} par {cost_period}."
        )

    score_lines = [
        _format_risk_metric("global", overall_risk_score, RISK_LEVEL_LABELS_FR[insights.risk_level]),
        _format_risk_metric("optimisation", insights.optimization_score, insights.score_labels["optimisation"]),
        _format_risk_metric("cout", insights.cost_score, insights.score_labels["cout"]),
        _format_risk_metric("anomalie", insights.anomaly_score, insights.score_labels["anomalie"]),
        _format_risk_metric("fraude", insights.fraud_score, insights.score_labels["fraude"]),
        _format_risk_metric(
            "sous_utilisation",
            insights.underutilization_score,
            insights.score_labels["sous_utilisation"],
        ),
        _format_risk_metric("rentabilite", insights.profitability_score, insights.score_labels["rentabilite"]),
        f"- Niveau de criticite: {RISK_LEVEL_LABELS_FR[insights.risk_level]}",
        f"- Priorite traitement: {_priority_treatment_label(overall_risk_score)}",
    ]
    recommendation_lines = [f"- {item}" for item in insights.recommendation_texts[:4]]
    direction_summary_lines = _build_direction_summary(insights)

    answer_lines = [first_sentence + concentration_sentence + findings_sentence + savings_sentence]
    if direction_summary_lines:
        answer_lines.append("Synthese direction")
        answer_lines.extend(direction_summary_lines)
    if insights.average_cost_per_department is not None or insights.average_cost_per_user is not None:
        answer_lines.append("KPI business")
        if insights.average_cost_per_department is not None:
            answer_lines.append(
                f"- Cout moyen par departement: {_format_mad(insights.average_cost_per_department)}"
            )
        if insights.average_cost_per_user is not None:
            answer_lines.append(
                f"- Cout moyen par utilisateur: {_format_mad(insights.average_cost_per_user)}"
            )
    answer_lines.append("Risques IA")
    answer_lines.extend(score_lines)
    answer_lines.append(f"Legende risque: {RISK_SCORE_LEGEND_FR}")
    answer_lines.append("Recommandations IA")
    answer_lines.extend(
        recommendation_lines if recommendation_lines else ["- Mettre le suivi tabulaire sous pilotage mensuel."]
    )
    return polish_business_text(
        "\n".join(answer_lines),
        exceptional_scores=_document_allows_max_risk_score(
            row_count=insights.row_count,
            fraud_signal_count=insights.fraud_signal_count,
            critical_incident_count=insights.critical_incident_count,
        ),
    )


def _looks_actionable_llm_answer(candidate_answer: str) -> bool:
    normalized_answer = _normalize_text(candidate_answer)
    if len(candidate_answer.strip()) < 80:
        return False
    generic_patterns = (
        "le document contient",
        "aucune anomalie detectee",
        "lignes et colonnes",
        "2 colonnes detectees",
        "annotations confirment les points de vigilance",
        "annotations visuelles restent secondaires",
        "analyse reste fondee sur les indicateurs detectes",
        "capture conserve des kpi visibles",
        "texte de l image reste insuffisant",
        "metriques verifiees restent stables",
        "analyse se limite aux indicateurs visibles",
        "synthese approfondie a ete raccourcie",
    )
    return not any(pattern in normalized_answer for pattern in generic_patterns)


def _is_materially_distinct_answer(candidate_answer: str, base_answer: str) -> bool:
    normalized_candidate = _normalize_text(candidate_answer)
    normalized_base = _normalize_text(base_answer)
    if not normalized_candidate:
        return False
    if normalized_candidate in normalized_base or normalized_base in normalized_candidate:
        return False
    candidate_tokens = set(normalized_candidate.split())
    if not candidate_tokens:
        return False
    overlap_ratio = len(candidate_tokens & set(normalized_base.split())) / len(candidate_tokens)
    return overlap_ratio < 0.72


def _build_tabular_answer(question: str, insights: TabularInsights) -> str:
    return insights.business_answer


def _build_tabular_prompt(
    *,
    question: str,
    history: list[ChatContextMessage],
    summary_context: str,
    filename: str | None,
    document_type: str,
    insights: TabularInsights,
    parse_notice: str | None,
) -> str:
    history_lines = [
        f"- {message.role}: {message.text.strip()}"
        for message in history[-4:]
        if message.text.strip()
    ]
    non_empty_mapping = {
        key: value
        for key, value in insights.business_mapping.items()
        if value
    }
    lines = [
        "Tu es FleetConnect IA, assistant analytique business, finance, operations et telecom.",
        "Les calculs pandas ci-dessous sont la verite de reference.",
        "Interdiction de repondre de facon generique ou de redire seulement le nombre de lignes et colonnes.",
        "Interdiction d'inventer des colonnes, montants, anomalies ou economies.",
        "Adopte un ton d'analyste telecom, FinOps et aide a la decision, clair, naturel et sans jargon technique interne.",
        "Utilise le vocabulaire Risque optimisation, Risque cout, Risque anomalie, Risque fraude, Risque sous-utilisation et Risque rentabilite.",
        (
            "La lecture des risques suit la regle 0 = bon, 100 = critique. "
            "Legende: 0-30 Faible, 31-50 Moyen, 51-70 Eleve, 71-95 Critique, 100 cas exceptionnel."
        ),
        "Evite toute repetition et n'ajoute une synthese complementaire que si elle apporte un angle decisionnel nouveau.",
        f"Question utilisateur: {question}",
        f"Fichier: {filename or 'document'} ({document_type.upper()})",
        f"Profil tabulaire detecte: {_document_label(insights.document_profile)}",
        f"Dimensions verifiees: {insights.row_count} ligne(s), {insights.column_count} colonne(s).",
        f"Colonnes detectees: {', '.join(insights.columns[:16])}",
        f"Mapping metier verifie: {json.dumps(non_empty_mapping, ensure_ascii=True)}",
    ]
    if parse_notice:
        lines.append(f"Contexte de lecture: {parse_notice}")
    if insights.primary_cost_column and insights.total_primary_cost is not None:
        lines.append(
            f"Exposition financiere verifiee: {insights.primary_cost_column} = {_format_mad(insights.total_primary_cost)}"
        )
    if insights.top_department and insights.top_department_cost is not None:
        lines.append(
            f"Departement le plus couteux: {insights.top_department} ({_format_mad(insights.top_department_cost)})"
        )
    if insights.top_plan and insights.top_plan_cost is not None:
        lines.append(f"Forfait le plus couteux: {insights.top_plan} ({_format_mad(insights.top_plan_cost)})")
    if insights.top_user and insights.top_user_cost is not None:
        top_user_label = "Ligne mobile" if _looks_like_phone_identifier(insights.top_user) else "Entite"
        lines.append(
            f"{top_user_label} le plus couteux: {insights.top_user} ({_format_mad(insights.top_user_cost)})"
        )
    lines.append(
        f"Comptages verifies: sous_utilisation={insights.underutilized_count}, surdimensionnement={insights.oversized_plan_count}, depassement_quota={insights.over_quota_count}, roaming_inutile={insights.useless_roaming_count}, anomalies={insights.anomaly_count}"
    )
    lines.append(
        f"Incidents verifies: total={insights.incident_count}, critiques={insights.critical_incident_count}"
    )
    if insights.estimated_savings_mad is not None:
        lines.append(f"Economie potentielle verifiee: {_format_mad(insights.estimated_savings_mad)}")
    lines.append("Risques verifies (0 = bon, 100 = critique):")
    lines.extend(
        [
            f"- Risque optimisation: {insights.optimization_score}/100 ({insights.score_labels['optimisation']})",
            f"- Risque cout: {insights.cost_score}/100 ({insights.score_labels['cout']})",
            f"- Risque anomalie: {insights.anomaly_score}/100 ({insights.score_labels['anomalie']})",
            f"- Risque fraude: {insights.fraud_score}/100 ({insights.score_labels['fraude']})",
            (
                f"- Risque sous-utilisation: {insights.underutilization_score}/100 "
                f"({insights.score_labels['sous_utilisation']})"
            ),
            f"- Risque rentabilite: {insights.profitability_score}/100 ({insights.score_labels['rentabilite']})",
        ]
    )
    lines.append("KPI verifies:")
    lines.extend(f"- {item}" for item in insights.detected_kpis[:8])
    lines.append("Anomalies verifiees:")
    lines.extend(f"- {item}" for item in insights.detected_anomalies[:8])
    lines.append("Recommandations heuristiques verifiees:")
    lines.extend(f"- {item}" for item in insights.recommendation_texts[:5])
    if insights.dataframe_preview_lines:
        lines.append("Extraits verifies:")
        lines.extend(f"- {preview_line}" for preview_line in insights.dataframe_preview_lines)
    if history_lines:
        lines.append("Historique recent:")
        lines.extend(history_lines)
    if summary_context.strip():
        lines.append("Contexte interne utile:")
        lines.append(summary_context.strip()[:1600])
    lines.append(
        'Reponds uniquement en JSON avec les cles "answer", "detected_kpis", "detected_anomalies", "recommendations", "confidence".'
    )
    lines.append("L'answer doit etre executive, citer les montants verifies et rester exploitable pour une direction.")
    lines.append("La cle confidence doit etre un nombre entre 0 et 1.")
    return "\n".join(lines)


def _parse_model_answer(raw_answer: str) -> dict[str, Any] | None:
    if not raw_answer.strip():
        return None

    candidate_text = raw_answer.strip()
    if not candidate_text.startswith("{"):
        json_match = re.search(r"\{.*\}", candidate_text, flags=re.DOTALL)
        if json_match is None:
            return {
                "answer": candidate_text,
                "detected_kpis": [],
                "detected_anomalies": [],
                "recommendations": [],
                "confidence": None,
            }
        candidate_text = json_match.group(0)

    try:
        payload = json.loads(candidate_text)
    except json.JSONDecodeError:
        return {
            "answer": raw_answer.strip(),
            "detected_kpis": [],
            "detected_anomalies": [],
            "recommendations": [],
            "confidence": None,
        }

    if not isinstance(payload, dict):
        return None
    return payload


def _analyze_dataframe(dataframe: Any) -> TabularInsights:
    if pd is None:
        raise ChatServerError("Le moteur pandas d'analyse tabulaire est indisponible cote serveur.")

    row_count = int(len(dataframe.index))
    column_count = int(len(dataframe.columns))
    columns = [str(column) for column in dataframe.columns]
    if row_count <= 0 or column_count <= 0:
        raise InvalidImageError(
            "Le document ne contient aucune ligne exploitable.",
            status_code=422,
        )

    numeric_series_by_column: dict[str, Any] = {}
    for column_name in columns:
        numeric_series_by_column[column_name] = _series_to_numeric(dataframe[column_name])

    column_profiles = _infer_column_profiles(dataframe, numeric_series_by_column)
    business_mapping = _detect_business_columns(dataframe, numeric_series_by_column)
    column_types = {column_name: str(dataframe[column_name].dtype) for column_name in columns}
    recognized_columns = {
        column_name
        for mapped_columns in business_mapping.values()
        for column_name in mapped_columns
    }
    ignored_columns = [column_name for column_name in columns if column_name not in recognized_columns]
    DOCUMENT_LOGGER.info(
        "event=document_columns count=%s columns=%s profiles=%s dtypes=%s",
        len(columns),
        json.dumps(columns, ensure_ascii=True),
        json.dumps(column_profiles, ensure_ascii=True),
        json.dumps(column_types, ensure_ascii=True),
    )
    DOCUMENT_LOGGER.info(
        "event=document_business_mapping mapping=%s ignored_columns=%s",
        json.dumps(
            {key: value for key, value in business_mapping.items() if value},
            ensure_ascii=True,
        ),
        json.dumps(ignored_columns, ensure_ascii=True),
    )

    primary_cost_column = _pick_column(
        business_mapping["cout_total"],
        ("mad", "dh", "monthly cost", "monthly", "mensuel", "recurring", "cost", "cout", "charge", "amount", "montant"),
        numeric_series_by_column,
    )
    primary_cost_series = (
        numeric_series_by_column[primary_cost_column]
        if primary_cost_column is not None
        else _empty_numeric_series(dataframe.index)
    )
    total_primary_cost = (
        float(primary_cost_series.fillna(0).sum())
        if primary_cost_column is not None
        else None
    )
    mean_primary_cost = (
        float(primary_cost_series.dropna().mean())
        if primary_cost_column is not None and len(primary_cost_series.dropna().index) > 0
        else None
    )
    max_primary_cost = (
        float(primary_cost_series.dropna().max())
        if primary_cost_column is not None and len(primary_cost_series.dropna().index) > 0
        else None
    )

    data_usage_column = _pick_column(
        business_mapping["consommation_data"],
        ("usage", "consommation", "gb", "go", "data"),
        numeric_series_by_column,
    )
    data_quota_column = _pick_column(
        business_mapping["quota_data"],
        ("quota", "allowance", "limit", "plafond", "gb", "go"),
        numeric_series_by_column,
    )
    calls_usage_column = _pick_column(
        business_mapping["consommation_appels"],
        ("usage", "consommation", "call", "voice", "minute"),
        numeric_series_by_column,
    )
    calls_quota_column = _pick_column(
        business_mapping["quota_appels"],
        ("quota", "allowance", "call", "voice", "minute"),
        numeric_series_by_column,
    )
    sms_usage_column = _pick_column(
        business_mapping["consommation_sms"],
        ("usage", "consommation", "sms", "message"),
        numeric_series_by_column,
    )
    sms_quota_column = _pick_column(
        business_mapping["quota_sms"],
        ("quota", "allowance", "sms", "message"),
        numeric_series_by_column,
    )
    roaming_flag_column = _pick_column(
        business_mapping["roaming"],
        ("flag", "active", "enabled", "roaming"),
        numeric_series_by_column,
    )
    roaming_cost_column = _pick_column(
        business_mapping["cout_roaming"],
        ("roaming", "itin", "international", "cost"),
        numeric_series_by_column,
    )
    roaming_usage_column = _pick_column(
        business_mapping["consommation_roaming"],
        ("roaming", "usage", "data", "international"),
        numeric_series_by_column,
    )
    user_column = _pick_column(
        business_mapping["utilisateur"],
        ("employee", "collaborateur", "user", "owner", "subscriber"),
        numeric_series_by_column,
    )
    department_column = _pick_column(
        business_mapping["departement"],
        ("department", "departement", "direction", "service"),
        numeric_series_by_column,
    )
    plan_column = _pick_column(
        business_mapping["forfait"],
        ("plan", "forfait", "package", "offer"),
        numeric_series_by_column,
    )
    operator_column = _pick_column(
        business_mapping["operateur"],
        ("operator", "operateur", "carrier", "provider"),
        numeric_series_by_column,
    )
    status_column = _pick_column(
        business_mapping["statut"],
        ("status", "statut", "etat"),
        numeric_series_by_column,
    )
    line_column = _pick_column(
        [*business_mapping["telephone"], *business_mapping["ligne"]],
        ("telephone", "phone", "mobile", "line", "msisdn", "sim"),
        numeric_series_by_column,
    )
    line_identifier_column = (
        line_column
        if line_column is not None and _has_phone_like_values(dataframe[line_column])
        else None
    )
    incident_column = _pick_column(
        business_mapping["incident"],
        ("incident", "event", "error", "alert", "issue", "log"),
        numeric_series_by_column,
    )
    severity_column = _pick_column(
        business_mapping["gravite"],
        ("severity", "priority", "criticite", "criticality", "level"),
        numeric_series_by_column,
    )
    timestamp_column = _pick_column(
        business_mapping["horodatage"],
        ("timestamp", "date", "time", "heure"),
        numeric_series_by_column,
    )

    risk_columns = business_mapping["risque"]
    fraud_columns = business_mapping["fraude"]
    anomaly_columns = business_mapping["anomalie"]
    over_quota_columns = business_mapping["depassement_quota"]

    risk_numeric_columns = [
        column_name
        for column_name in risk_columns
        if float(numeric_series_by_column[column_name].notna().mean()) >= 0.2
    ]
    fraud_numeric_columns = [
        column_name
        for column_name in fraud_columns
        if float(numeric_series_by_column[column_name].notna().mean()) >= 0.2
    ]
    risk_score_series = _normalize_score_series(
        _combine_numeric_columns(risk_numeric_columns, numeric_series_by_column, dataframe.index)
    )
    fraud_score_series = _normalize_score_series(
        _combine_numeric_columns(fraud_numeric_columns, numeric_series_by_column, dataframe.index)
    )

    data_usage_series = (
        numeric_series_by_column[data_usage_column]
        if data_usage_column is not None
        else _empty_numeric_series(dataframe.index)
    )
    data_quota_series = (
        numeric_series_by_column[data_quota_column]
        if data_quota_column is not None
        else _empty_numeric_series(dataframe.index)
    )
    calls_usage_series = (
        numeric_series_by_column[calls_usage_column]
        if calls_usage_column is not None
        else _empty_numeric_series(dataframe.index)
    )
    calls_quota_series = (
        numeric_series_by_column[calls_quota_column]
        if calls_quota_column is not None
        else _empty_numeric_series(dataframe.index)
    )
    sms_usage_series = (
        numeric_series_by_column[sms_usage_column]
        if sms_usage_column is not None
        else _empty_numeric_series(dataframe.index)
    )
    sms_quota_series = (
        numeric_series_by_column[sms_quota_column]
        if sms_quota_column is not None
        else _empty_numeric_series(dataframe.index)
    )
    roaming_cost_series = (
        numeric_series_by_column[roaming_cost_column]
        if roaming_cost_column is not None
        else _empty_numeric_series(dataframe.index)
    )
    roaming_usage_series = (
        numeric_series_by_column[roaming_usage_column]
        if roaming_usage_column is not None
        else _empty_numeric_series(dataframe.index)
    )
    roaming_flag_mask = (
        _combine_flag_columns([roaming_flag_column], dataframe, numeric_series_by_column, dataframe.index)
        if roaming_flag_column is not None
        else _empty_bool_series(dataframe.index)
    )
    roaming_mask = (
        roaming_flag_mask
        | roaming_cost_series.fillna(0).map(lambda value: value > 0)
        | roaming_usage_series.fillna(0).map(lambda value: value > 0)
    )

    anomaly_flag_mask = _combine_flag_columns(
        anomaly_columns,
        dataframe,
        numeric_series_by_column,
        dataframe.index,
    )
    explicit_over_quota_mask = _combine_flag_columns(
        over_quota_columns,
        dataframe,
        numeric_series_by_column,
        dataframe.index,
    )
    explicit_fraud_mask = _combine_flag_columns(
        fraud_columns,
        dataframe,
        numeric_series_by_column,
        dataframe.index,
    )
    incident_mask = (
        dataframe[incident_column].map(lambda value: _safe_text(value) != "").fillna(False).astype(bool)
        if incident_column is not None
        else _empty_bool_series(dataframe.index)
    )
    severity_mask = (
        _series_to_severity_mask(dataframe[severity_column]).fillna(False).astype(bool)
        if severity_column is not None
        else _empty_bool_series(dataframe.index)
    )

    data_ratio = _empty_numeric_series(dataframe.index)
    if data_usage_column is not None and data_quota_column is not None:
        valid_quota_mask = data_quota_series.fillna(0) > 0
        data_ratio.loc[valid_quota_mask] = (
            data_usage_series[valid_quota_mask] / data_quota_series[valid_quota_mask]
        )

    calls_ratio = _empty_numeric_series(dataframe.index)
    if calls_usage_column is not None and calls_quota_column is not None:
        valid_call_quota_mask = calls_quota_series.fillna(0) > 0
        calls_ratio.loc[valid_call_quota_mask] = (
            calls_usage_series[valid_call_quota_mask] / calls_quota_series[valid_call_quota_mask]
        )

    sms_ratio = _empty_numeric_series(dataframe.index)
    if sms_usage_column is not None and sms_quota_column is not None:
        valid_sms_quota_mask = sms_quota_series.fillna(0) > 0
        sms_ratio.loc[valid_sms_quota_mask] = (
            sms_usage_series[valid_sms_quota_mask] / sms_quota_series[valid_sms_quota_mask]
        )

    ratio_frame = pd.concat(
        [data_ratio.rename("data"), calls_ratio.rename("calls"), sms_ratio.rename("sms")],
        axis=1,
    )
    usage_ratio = ratio_frame.mean(axis=1, skipna=True)
    usage_ratio = usage_ratio.where(usage_ratio.notna(), float("nan"))

    over_quota_mask = explicit_over_quota_mask.copy()
    if data_usage_column is not None and data_quota_column is not None:
        over_quota_mask = over_quota_mask | (
            (data_quota_series.fillna(0) > 0) & (data_usage_series > data_quota_series)
        )
    if calls_usage_column is not None and calls_quota_column is not None:
        over_quota_mask = over_quota_mask | (
            (calls_quota_series.fillna(0) > 0) & (calls_usage_series > calls_quota_series)
        )
    if sms_usage_column is not None and sms_quota_column is not None:
        over_quota_mask = over_quota_mask | (
            (sms_quota_series.fillna(0) > 0) & (sms_usage_series > sms_quota_series)
        )

    underutilized_mask = (
        usage_ratio.notna()
        & (usage_ratio <= 0.20)
        & primary_cost_series.fillna(0).map(lambda value: value > 0)
    )
    oversized_plan_mask = (
        usage_ratio.notna()
        & (usage_ratio <= 0.35)
        & (
            primary_cost_series.fillna(0) >= (
            float(primary_cost_series.dropna().median())
            if len(primary_cost_series.dropna().index) > 0
            else 0.0
        )
        )
    )
    useless_roaming_mask = (
        roaming_flag_mask
        & roaming_cost_series.fillna(0).le(0)
        & roaming_usage_series.fillna(0).le(0)
    )

    cost_outlier_mask = (
        _build_outlier_mask(primary_cost_series)
        if primary_cost_column is not None
        else _empty_bool_series(dataframe.index)
    )
    high_risk_mask = risk_score_series.fillna(float("-inf")) >= 80
    if not risk_columns:
        high_risk_mask = _empty_bool_series(dataframe.index)
    if not risk_numeric_columns and risk_columns:
        for column_name in risk_columns:
            normalized_text_values = dataframe[column_name].map(lambda value: _normalize_text(_safe_text(value)))
            high_risk_mask = high_risk_mask | normalized_text_values.isin({"high", "eleve", "elevee", "critical", "critique"})

    fraud_signal_mask = (
        explicit_fraud_mask
        | fraud_score_series.fillna(float("-inf")).ge(80)
        | (high_risk_mask & (roaming_mask | over_quota_mask | cost_outlier_mask))
    )
    inactive_billed_mask = _empty_bool_series(dataframe.index)
    if status_column is not None:
        inactive_billed_mask = _series_to_status_mask(dataframe[status_column], INACTIVE_STATUSES)
        inactive_billed_mask = inactive_billed_mask & primary_cost_series.fillna(0).map(lambda value: value > 0)

    anomaly_mask = (
        anomaly_flag_mask
        | cost_outlier_mask
        | high_risk_mask
        | over_quota_mask
        | useless_roaming_mask
        | inactive_billed_mask
        | severity_mask
    )
    incident_alert_mask = incident_mask & (severity_mask | anomaly_flag_mask | high_risk_mask)
    anomaly_mask = anomaly_mask | incident_alert_mask

    top_operators = _aggregate_top_costs(dataframe, operator_column, primary_cost_series)
    top_departments = _aggregate_top_costs(dataframe, department_column, primary_cost_series)
    top_plans = _aggregate_top_costs(dataframe, plan_column, primary_cost_series)
    top_users = _aggregate_top_costs(dataframe, user_column or line_identifier_column, primary_cost_series)
    top_operator = top_operators[0][0] if top_operators else None
    top_operator_cost = top_operators[0][1] if top_operators else None
    top_operator_share = (
        _safe_ratio(top_operator_cost or 0.0, total_primary_cost or 0.0)
        if top_operator_cost is not None and total_primary_cost is not None
        else None
    )
    top_department = top_departments[0][0] if top_departments else None
    top_department_cost = top_departments[0][1] if top_departments else None
    top_plan = top_plans[0][0] if top_plans else None
    top_plan_cost = top_plans[0][1] if top_plans else None
    top_user = top_users[0][0] if top_users else None
    top_user_cost = top_users[0][1] if top_users else None

    average_cost_per_user = _compute_average_cost_per_entity(
        dataframe,
        user_column or line_identifier_column,
        primary_cost_series,
    )
    average_cost_per_department = _compute_average_cost_per_entity(
        dataframe,
        department_column,
        primary_cost_series,
    )

    underutilized_count = int(underutilized_mask.sum())
    oversized_plan_count = int(oversized_plan_mask.sum())
    useless_roaming_count = int(useless_roaming_mask.sum())
    over_quota_count = int(over_quota_mask.sum())
    roaming_count = int(roaming_mask.sum())
    anomaly_count = int(anomaly_mask.sum())
    outlier_count = int(cost_outlier_mask.sum())
    high_risk_count = int(high_risk_mask.sum())
    fraud_signal_count = int(fraud_signal_mask.sum())
    inactive_billed_count = int(inactive_billed_mask.sum())
    incident_count = int((incident_mask | severity_mask).sum())
    critical_incident_count = int((incident_mask & severity_mask).sum() if incident_column is not None else severity_mask.sum())
    document_profile = _detect_document_profile(
        business_mapping,
        primary_cost_column=primary_cost_column,
        incident_count=incident_count,
        critical_incident_count=critical_incident_count,
    )

    row_denominator = max(row_count, 1)
    underutilized_ratio = underutilized_count / row_denominator
    oversized_ratio = oversized_plan_count / row_denominator
    over_quota_ratio = over_quota_count / row_denominator
    anomaly_ratio = anomaly_count / row_denominator
    fraud_ratio = fraud_signal_count / row_denominator
    outlier_ratio = outlier_count / row_denominator
    inactive_ratio = inactive_billed_count / row_denominator
    concentration_ratio = max(
        (
            value
            for value in (
                top_operator_share if top_operator_share is not None else 0.0,
                _safe_ratio(top_department_cost or 0.0, total_primary_cost or 0.0) if top_department_cost is not None and total_primary_cost is not None else 0.0,
                _safe_ratio(top_plan_cost or 0.0, total_primary_cost or 0.0) if top_plan_cost is not None and total_primary_cost is not None else 0.0,
            )
        ),
        default=0.0,
    )

    estimated_savings_mad = None
    if primary_cost_column is not None:
        estimated_savings_mad = (
            _estimate_underutilized_savings(primary_cost_series, usage_ratio, underutilized_mask)
            + _estimate_oversized_savings(primary_cost_series, oversized_plan_mask)
            + _estimate_roaming_savings(primary_cost_series, useless_roaming_mask, roaming_cost_series)
            + _estimate_inactive_savings(primary_cost_series, inactive_billed_mask)
            + _estimate_overquota_savings(primary_cost_series, over_quota_mask)
        )
        if estimated_savings_mad <= 0:
            estimated_savings_mad = None

    savings_ratio = _safe_ratio(estimated_savings_mad or 0.0, total_primary_cost or 0.0)
    cost_score = _clamp_score(
        24
        + (concentration_ratio * 42)
        + (outlier_ratio * 34)
        + (over_quota_ratio * 18)
        + (savings_ratio * 52)
    )
    anomaly_score = _clamp_score(
        20
        + (anomaly_ratio * 44)
        + (outlier_ratio * 28)
        + ((high_risk_count / row_denominator) * 28)
        + (over_quota_ratio * 18)
        + ((critical_incident_count / row_denominator) * 26)
    )
    fraud_score = _clamp_score(
        10
        + (fraud_ratio * 52)
        + ((roaming_count / row_denominator) * 16)
        + ((high_risk_count / row_denominator) * 22)
        + ((critical_incident_count / row_denominator) * 18)
    )
    optimization_score = _clamp_score(
        18
        + (underutilized_ratio * 78)
        + (oversized_ratio * 52)
        + (over_quota_ratio * 66)
        + ((useless_roaming_count / row_denominator) * 58)
        + (inactive_ratio * 82)
        + (savings_ratio * 48)
        + ((incident_count / row_denominator) * 14)
    )
    underutilization_score = _clamp_score(
        14
        + (underutilized_ratio * 86)
        + (oversized_ratio * 48)
        + (savings_ratio * 32)
    )
    profitability_score = _clamp_score(
        (cost_score * 0.34)
        + (optimization_score * 0.24)
        + (anomaly_score * 0.20)
        + (fraud_score * 0.14)
    )
    allow_max_risk_score = _document_allows_max_risk_score(
        row_count=row_count,
        fraud_signal_count=fraud_signal_count,
        critical_incident_count=critical_incident_count,
    )
    cost_score = normalize_business_risk_score(cost_score, exceptional=allow_max_risk_score) or 0
    anomaly_score = normalize_business_risk_score(anomaly_score, exceptional=allow_max_risk_score) or 0
    fraud_score = normalize_business_risk_score(fraud_score, exceptional=allow_max_risk_score) or 0
    optimization_score = normalize_business_risk_score(
        optimization_score,
        exceptional=allow_max_risk_score,
    ) or 0
    underutilization_score = normalize_business_risk_score(
        underutilization_score,
        exceptional=allow_max_risk_score,
    ) or 0
    profitability_score = normalize_business_risk_score(
        profitability_score,
        exceptional=allow_max_risk_score,
    ) or 0
    overall_risk_score = max(
        cost_score,
        anomaly_score,
        fraud_score,
        optimization_score,
        underutilization_score,
        profitability_score,
    )
    risk_level = _score_to_level(overall_risk_score)
    score_labels = _build_score_labels(
        cost_score=cost_score,
        anomaly_score=anomaly_score,
        fraud_score=fraud_score,
        optimization_score=optimization_score,
        underutilization_score=underutilization_score,
        profitability_score=profitability_score,
    )

    detected_kpis: list[str] = []
    detected_kpis.append(f"Profil tabulaire detecte: {_document_label(document_profile)}")
    if total_primary_cost is not None and primary_cost_column:
        detected_kpis.append(
            f"Exposition financiere visible: {_format_mad(total_primary_cost)} sur {primary_cost_column}"
        )
    if top_department and top_department_cost is not None:
        detected_kpis.append(
            f"Departement le plus couteux: {top_department} ({_format_mad(top_department_cost)})"
        )
    if top_plan and top_plan_cost is not None:
        detected_kpis.append(f"Forfait le plus couteux: {top_plan} ({_format_mad(top_plan_cost)})")
    if top_user and top_user_cost is not None:
        top_user_label = "Ligne mobile" if _looks_like_phone_identifier(top_user) else "Collaborateur"
        detected_kpis.append(
            f"{top_user_label} le plus couteux: {top_user} ({_format_mad(top_user_cost)})"
        )
    if average_cost_per_user is not None:
        detected_kpis.append(f"Cout moyen par utilisateur: {_format_mad(average_cost_per_user)}")
    if average_cost_per_department is not None:
        detected_kpis.append(f"Cout moyen par departement: {_format_mad(average_cost_per_department)}")
    if incident_count > 0:
        detected_kpis.append(f"Incidents ou evenements surveilles: {incident_count}")
    if critical_incident_count > 0:
        detected_kpis.append(f"Incidents critiques: {critical_incident_count}")
    if underutilized_count > 0:
        detected_kpis.append(f"Lignes <20% du quota: {underutilized_count}")
    if over_quota_count > 0:
        detected_kpis.append(f"Depassements de quota: {over_quota_count} lignes")
    if estimated_savings_mad is not None:
        detected_kpis.append(f"Economie potentielle estimee: {_format_mad(estimated_savings_mad)}")
    detected_kpis.extend(
        [
            _format_risk_metric("global", overall_risk_score, RISK_LEVEL_LABELS_FR[risk_level])[2:],
            _format_risk_metric("optimisation", optimization_score, score_labels["optimisation"])[2:],
            _format_risk_metric("cout", cost_score, score_labels["cout"])[2:],
            _format_risk_metric("anomalie", anomaly_score, score_labels["anomalie"])[2:],
            _format_risk_metric("fraude", fraud_score, score_labels["fraude"])[2:],
            _format_risk_metric(
                "sous_utilisation",
                underutilization_score,
                score_labels["sous_utilisation"],
            )[2:],
            _format_risk_metric("rentabilite", profitability_score, score_labels["rentabilite"])[2:],
            f"Niveau de criticite: {RISK_LEVEL_LABELS_FR[risk_level]}",
            f"Priorite traitement: {_priority_treatment_label(overall_risk_score)}",
        ]
    )

    detected_anomalies: list[str] = []
    if outlier_count > 0:
        detected_anomalies.append(
            f"{outlier_count} lignes presentent un cout atypique superieur au seuil interquartile."
        )
    if underutilized_count > 0:
        detected_anomalies.append(
            f"{underutilized_count} lignes utilisent moins de 20% de leur quota visible."
        )
    if oversized_plan_count > 0:
        detected_anomalies.append(
            f"{oversized_plan_count} forfaits sont probablement surdimensionnes au regard de l'usage observe."
        )
    if over_quota_count > 0:
        detected_anomalies.append(
            f"{over_quota_count} lignes depassent leur quota data, appels ou SMS."
        )
    if useless_roaming_count > 0:
        detected_anomalies.append(
            f"{useless_roaming_count} lignes conservent le roaming sans trafic reel detecte."
        )
    if inactive_billed_count > 0:
        detected_anomalies.append(
            f"{inactive_billed_count} lignes inactives continuent de porter du cout."
        )
    if high_risk_count > 0:
        detected_anomalies.append(
            f"{high_risk_count} lignes atteignent un score de risque superieur ou egal a 80/100."
        )
    if fraud_signal_count > 0:
        detected_anomalies.append(
            f"{fraud_signal_count} profils cumulent des signaux de fraude ou de comportement suspect."
        )
    if critical_incident_count > 0:
        detected_anomalies.append(
            f"{critical_incident_count} incidents ou logs portent une severite critique ou haute."
        )
    if incident_count > 0 and timestamp_column is not None:
        detected_anomalies.append(
            f"{incident_count} evenements sont horodates et peuvent etre traces dans la colonne {timestamp_column}."
        )
    if not detected_anomalies:
        detected_anomalies.append(
            "Aucune derive critique immediate n'a ete detectee, mais plusieurs usages meritent un suivi regulier pour confirmer la tendance."
        )

    decision_recommendations: list[ChatDecisionRecommendation] = []
    if underutilized_count > 0:
        decision_recommendations.append(
            ChatDecisionRecommendation(
                title=(
                    "Migrer les lignes sous-utilisees vers des forfaits intermediaires"
                    if document_profile == "telecom_usage"
                    else "Redimensionner les ressources sous-utilisees"
                ),
                priority="critical" if underutilized_ratio >= 0.20 else "high",
                impact="cost",
                estimated_saving=(
                    _format_mad(_estimate_underutilized_savings(primary_cost_series, usage_ratio, underutilized_mask))
                    if primary_cost_column is not None
                    else None
                ),
                reason=(
                    f"{underutilized_count} ressources utilisent moins de 20% de leur capacite visible, "
                    "ce qui signale un surdimensionnement direct des allocations."
                ),
            )
        )
    if useless_roaming_count > 0:
        decision_recommendations.append(
            ChatDecisionRecommendation(
                title="Desactiver les options roaming sans usage",
                priority="high",
                impact="optimization",
                estimated_saving=(
                    _format_mad(_estimate_roaming_savings(primary_cost_series, useless_roaming_mask, roaming_cost_series))
                    if primary_cost_column is not None
                    else None
                ),
                reason=(
                    "Des lignes gardent le roaming actif alors qu'aucun trafic international exploitable n'est visible."
                ),
            )
        )
    if over_quota_count > 0:
        decision_recommendations.append(
            ChatDecisionRecommendation(
                title=(
                    "Recalibrer les lignes en depassement recurrent de quota"
                    if document_profile == "telecom_usage"
                    else "Recalibrer les ressources en depassement recurrent"
                ),
                priority="high",
                impact="optimization",
                estimated_saving=(
                    _format_mad(_estimate_overquota_savings(primary_cost_series, over_quota_mask))
                    if primary_cost_column is not None
                    else None
                ),
                reason=(
                    "Les depassements montrent un mauvais alignement entre usage reel et structure de forfait."
                ),
            )
        )
    if inactive_billed_count > 0:
        decision_recommendations.append(
            ChatDecisionRecommendation(
                title=(
                    "Couper ou reaffecter les lignes inactives facturees"
                    if document_profile == "telecom_usage"
                    else "Desactiver ou reaffecter les ressources inactives facturees"
                ),
                priority="high" if inactive_ratio >= 0.08 else "medium",
                impact="cost",
                estimated_saving=(
                    _format_mad(_estimate_inactive_savings(primary_cost_series, inactive_billed_mask))
                    if primary_cost_column is not None
                    else None
                ),
                reason=(
                    "Des lignes suspendues, libres ou inactives continuent a generer du cout mensuel."
                ),
            )
        )
    if top_department and top_department_cost is not None and concentration_ratio >= 0.35:
        decision_recommendations.append(
            ChatDecisionRecommendation(
                title=(
                    f"Renegocier les forfaits concentres sur {top_department}"
                    if document_profile == "telecom_usage"
                    else f"Auditer la concentration budgetaire sur {top_department}"
                ),
                priority="medium" if concentration_ratio < 0.5 else "high",
                impact="cost",
                estimated_saving=None,
                reason=(
                    f"Le departement {top_department} concentre une part importante du cout visible et doit etre audite en priorite."
                ),
            )
        )
    if fraud_signal_count > 0 or high_risk_count > 0:
        decision_recommendations.append(
            ChatDecisionRecommendation(
                title=(
                    "Auditer les lignes a score de risque critique"
                    if document_profile == "telecom_usage"
                    else "Auditer les enregistrements a criticite elevee"
                ),
                priority="critical" if high_risk_count > 0 else "high",
                impact="fraud",
                estimated_saving=None,
                reason=(
                    "Les signaux de risque et de fraude visibles justifient une revue immediate des lignes les plus sensibles."
                ),
            )
        )
    if critical_incident_count > 0:
        decision_recommendations.append(
            ChatDecisionRecommendation(
                title="Traiter les incidents critiques repetes",
                priority="critical" if critical_incident_count >= max(3, row_denominator // 10) else "high",
                impact="workflow",
                estimated_saving=None,
                reason=(
                    "La severite visible sur plusieurs incidents ou logs indique un risque operationnel qui doit etre traite sans delai."
                ),
            )
        )
    if not decision_recommendations:
        decision_recommendations.append(
            ChatDecisionRecommendation(
                title="Mettre le suivi tabulaire sous pilotage mensuel",
                priority="medium",
                impact="optimization",
                estimated_saving=None,
                reason=(
                    "Le fichier est exploitable et doit alimenter un suivi recurrent des couts, anomalies et signaux metier."
                ),
            )
        )

    recommendation_texts = polish_business_items(
        [recommendation.title for recommendation in decision_recommendations],
        limit=5,
        exceptional_scores=allow_max_risk_score,
    )

    core_mapping_hits = sum(1 for key in CORE_MAPPING_KEYS if business_mapping.get(key))
    confidence = max(
        0.45,
        min(
            0.98,
            0.44
            + (core_mapping_hits * 0.06)
            + (0.14 if primary_cost_column is not None else 0.0)
            + (0.10 if data_usage_column is not None and data_quota_column is not None else 0.0)
            + (0.08 if incident_column is not None or severity_column is not None else 0.0)
            + (0.06 if user_column is not None or department_column is not None else 0.0)
            + (0.05 if row_count >= 5 else 0.0),
        ),
    )

    DOCUMENT_LOGGER.info(
        "event=document_scores cost_score=%s anomaly_score=%s fraud_score=%s optimization_score=%s underutilization_score=%s profitability_score=%s risk_level=%s priority=%s estimated_savings_mad=%s",
        cost_score,
        anomaly_score,
        fraud_score,
        optimization_score,
        underutilization_score,
        profitability_score,
        risk_level,
        _priority_treatment_label(overall_risk_score),
        round(estimated_savings_mad or 0.0, 2),
    )
    DOCUMENT_LOGGER.info(
        "event=document_anomalies underutilized=%s oversized=%s useless_roaming=%s over_quota=%s anomaly_rows=%s outliers=%s high_risk=%s fraud=%s inactive_billed=%s incidents=%s critical_incidents=%s",
        underutilized_count,
        oversized_plan_count,
        useless_roaming_count,
        over_quota_count,
        anomaly_count,
        outlier_count,
        high_risk_count,
        fraud_signal_count,
        inactive_billed_count,
        incident_count,
        critical_incident_count,
    )
    DOCUMENT_LOGGER.info(
        "event=document_profile profile=%s primary_cost_column=%s incident_column=%s severity_column=%s timestamp_column=%s",
        document_profile,
        primary_cost_column,
        incident_column,
        severity_column,
        timestamp_column,
    )
    DOCUMENT_LOGGER.info(
        "event=document_kpis detected=%s anomalies=%s recommendations=%s",
        json.dumps(
            polish_business_items(
                detected_kpis,
                limit=12,
                exceptional_scores=allow_max_risk_score,
            ),
            ensure_ascii=True,
        ),
        json.dumps(
            polish_business_items(
                detected_anomalies,
                limit=10,
                exceptional_scores=allow_max_risk_score,
            ),
            ensure_ascii=True,
        ),
        json.dumps(
            polish_business_items(
                recommendation_texts,
                limit=5,
                exceptional_scores=allow_max_risk_score,
            ),
            ensure_ascii=True,
        ),
    )

    insights = TabularInsights(
        row_count=row_count,
        column_count=column_count,
        columns=columns,
        column_profiles=column_profiles,
        document_profile=document_profile,
        business_mapping=business_mapping,
        primary_cost_column=primary_cost_column,
        total_primary_cost=total_primary_cost,
        mean_primary_cost=mean_primary_cost,
        max_primary_cost=max_primary_cost,
        average_cost_per_user=average_cost_per_user,
        average_cost_per_department=average_cost_per_department,
        top_operator=top_operator,
        top_operator_cost=top_operator_cost,
        top_operator_share=top_operator_share,
        top_department=top_department,
        top_department_cost=top_department_cost,
        top_plan=top_plan,
        top_plan_cost=top_plan_cost,
        top_user=top_user,
        top_user_cost=top_user_cost,
        top_operators=top_operators,
        top_departments=top_departments,
        top_plans=top_plans,
        top_users=top_users,
        underutilized_count=underutilized_count,
        oversized_plan_count=oversized_plan_count,
        useless_roaming_count=useless_roaming_count,
        over_quota_count=over_quota_count,
        roaming_count=roaming_count,
        anomaly_count=anomaly_count,
        outlier_count=outlier_count,
        high_risk_count=high_risk_count,
        fraud_signal_count=fraud_signal_count,
        inactive_billed_count=inactive_billed_count,
        incident_count=incident_count,
        critical_incident_count=critical_incident_count,
        cost_score=cost_score,
        anomaly_score=anomaly_score,
        fraud_score=fraud_score,
        optimization_score=optimization_score,
        underutilization_score=underutilization_score,
        profitability_score=profitability_score,
        score_labels=score_labels,
        risk_level=risk_level,
        confidence=confidence,
        estimated_savings_mad=estimated_savings_mad,
        detected_kpis=polish_business_items(
            detected_kpis,
            limit=12,
            exceptional_scores=allow_max_risk_score,
        ),
        detected_anomalies=polish_business_items(
            detected_anomalies,
            limit=10,
            exceptional_scores=allow_max_risk_score,
        ),
        decision_recommendations=decision_recommendations[:5],
        recommendation_texts=polish_business_items(
            recommendation_texts,
            limit=5,
            exceptional_scores=allow_max_risk_score,
        ),
        dataframe_preview_lines=_build_dataframe_preview(dataframe),
        business_answer="",
    )
    business_answer = _build_business_answer("", insights)
    return TabularInsights(
        **{
            **insights.__dict__,
            "business_answer": business_answer,
        }
    )


async def generate_document_chat_response(
    request: Request,
    db: Session,
    *,
    question: str,
    history: list[ChatContextMessage],
    document_bytes: bytes,
    filename: str | None,
    content_type: str | None,
    analysis_mode: str | None = None,
    conversation_id: str | None = None,
) -> ChatImageResponse:
    document_type = _resolve_document_type(filename, content_type)
    if document_type == "pdf":
        return await generate_pdf_chat_response(
            request,
            db,
            question=question,
            history=history,
            pdf_bytes=document_bytes,
            filename=filename,
            content_type=content_type,
            analysis_mode=analysis_mode,
            conversation_id=conversation_id,
        )

    return await generate_tabular_chat_response(
        request,
        db,
        question=question,
        history=history,
        document_bytes=document_bytes,
        filename=filename,
        content_type=content_type,
        document_type=document_type,
        analysis_mode=analysis_mode,
        conversation_id=conversation_id,
    )


async def generate_tabular_chat_response(
    request: Request,
    db: Session,
    *,
    question: str,
    history: list[ChatContextMessage],
    document_bytes: bytes,
    filename: str | None,
    content_type: str | None,
    document_type: str,
    analysis_mode: str | None = None,
    conversation_id: str | None = None,
) -> ChatImageResponse:
    started_at = _utcnow()
    question_preview = _truncate(question, 140)
    resolved_analysis_mode = _resolve_analysis_mode(analysis_mode)

    _log_chat_event(
        logging.INFO,
        "chat_question_sent",
        mode="document",
        question=question_preview,
        conversation_id=conversation_id,
        analysis_mode=resolved_analysis_mode,
    )

    await _ensure_request_connected(request)
    DOCUMENT_LOGGER.info(
        "event=document_request_received filename=%s content_type=%s document_type=%s size_bytes=%s conversation_id=%s analysis_mode=%s",
        filename,
        content_type,
        document_type,
        len(document_bytes),
        conversation_id,
        resolved_analysis_mode,
    )

    loaded_document = _load_tabular_document(
        document_bytes,
        document_type=document_type,
    )
    DOCUMENT_LOGGER.info(
        "event=document_parse_debug document_type=%s parse_debug=%s",
        document_type,
        json.dumps(loaded_document.parse_debug, ensure_ascii=True),
    )
    insights = _analyze_dataframe(loaded_document.dataframe)
    allow_max_risk_score = _document_allows_max_risk_score(
        row_count=insights.row_count,
        fraud_signal_count=insights.fraud_signal_count,
        critical_incident_count=insights.critical_incident_count,
    )
    summary = get_data_summary(db)
    answer_text = _build_business_answer(question, insights)
    use_internal_summary_context = insights.document_profile == "telecom_usage"

    stage_notices = [
        f"Document {document_type.upper()} analyse avec pandas.",
        f"Dimensions: {insights.row_count} ligne(s), {insights.column_count} colonne(s).",
        f"Profil metier detecte: {_document_label(insights.document_profile)}.",
    ]
    if loaded_document.parse_notice:
        stage_notices.append(loaded_document.parse_notice)

    advanced_analysis_available = True
    advanced_analysis_completed = False
    analysis_status = "success"
    fallback_used = False

    llm_detected_kpis: list[str] = []
    llm_detected_anomalies: list[str] = []
    llm_recommendations: list[str] = []
    confidence = insights.confidence

    if resolved_analysis_mode != "quick":
        prompt = _build_tabular_prompt(
            question=question,
            history=history,
            summary_context=summary.prompt_context if use_internal_summary_context else "",
            filename=filename,
            document_type=document_type,
            insights=insights,
            parse_notice=loaded_document.parse_notice,
        )
        try:
            raw_answer = await _generate_with_ollama(prompt, timeout_seconds=35)
            parsed_answer = _parse_model_answer(raw_answer)
            if parsed_answer is not None:
                advanced_analysis_completed = True
                candidate_answer = str(parsed_answer.get("answer") or "").strip()
                if (
                    candidate_answer
                    and _looks_actionable_llm_answer(candidate_answer)
                    and _is_materially_distinct_answer(candidate_answer, answer_text)
                ):
                    answer_text = (
                        f"{answer_text}\n\nSynthese IA complementaire\n"
                        f"{polish_business_text(candidate_answer, exceptional_scores=allow_max_risk_score)}"
                    )
                llm_detected_kpis = _normalize_response_list(parsed_answer.get("detected_kpis"))
                llm_detected_anomalies = _normalize_response_list(
                    parsed_answer.get("detected_anomalies")
                )
                llm_recommendations = _normalize_response_list(parsed_answer.get("recommendations"))
                raw_confidence = parsed_answer.get("confidence")
                if isinstance(raw_confidence, (int, float)):
                    confidence = max(insights.confidence, min(float(raw_confidence), 1.0))
        except LocalModelUnavailableError:
            advanced_analysis_available = False
            analysis_status = "fallback"
            fallback_used = True
            stage_notices.append(
                "La synthese complementaire n'etait pas disponible ; la note decisionnelle issue de l'analyse tabulaire a ete conservee."
            )
        except ChatTimeoutError:
            analysis_status = "fallback"
            fallback_used = True
            stage_notices.append(
                "La synthese complementaire a ete interrompue ; les priorites metier deja consolidees restent disponibles."
            )

    answer_text = polish_business_text(answer_text, exceptional_scores=allow_max_risk_score)
    detected_kpis = polish_business_items(
        [*insights.detected_kpis, *llm_detected_kpis],
        limit=14,
        exceptional_scores=allow_max_risk_score,
    )
    detected_anomalies = polish_business_items(
        [*insights.detected_anomalies, *llm_detected_anomalies],
        limit=10,
        exceptional_scores=allow_max_risk_score,
    )
    recommendation_texts = polish_business_items(
        [*insights.recommendation_texts, *llm_recommendations],
        limit=6,
        exceptional_scores=allow_max_risk_score,
    )
    stage_notices = polish_business_items(
        stage_notices,
        limit=6,
        exceptional_scores=allow_max_risk_score,
    )

    processing_message = (
        "Analyse tabulaire metier et synthese IA terminees."
        if resolved_analysis_mode != "quick" and advanced_analysis_completed
        else "Analyse tabulaire metier pandas terminee."
    )

    base_response = _build_response(
        question=question,
        answer=answer_text,
        summary=summary,
        fallback_used=fallback_used,
        duration_ms=_elapsed_ms(started_at),
    )

    response_sources = _dedupe_items(
        [
            "tabular:document",
            "parser:pandas",
            "mapping:business",
            f"document-type:{document_type}",
            f"profile:{insights.document_profile}",
            f"analysis-mode:{resolved_analysis_mode}",
            *(base_response.sources if use_internal_summary_context else []),
            *(
                [f"sheet:{loaded_document.selected_sheet}"]
                if loaded_document.selected_sheet
                else []
            ),
        ],
        20,
    )

    visible_mapping = [
        f"{key}={','.join(value)}"
        for key, value in insights.business_mapping.items()
        if value and key in CORE_MAPPING_KEYS
    ]
    ocr_lines = [
        f"Profil: {_document_label(insights.document_profile)}",
        f"Colonnes: {', '.join(insights.columns[:16])}",
    ]
    if visible_mapping:
        ocr_lines.append(f"Mapping metier: {' ; '.join(visible_mapping)}")
    ocr_lines.extend(insights.dataframe_preview_lines)

    response = ChatImageResponse(
        answer=base_response.answer,
        model=base_response.model,
        title_hint=base_response.title_hint,
        sources=response_sources,
        summary_updated_at=base_response.summary_updated_at,
        cached=False,
        fallback_used=base_response.fallback_used,
        duration_ms=base_response.duration_ms,
        mode="advanced" if resolved_analysis_mode != "quick" else "fast",
        image_type="tableur",
        ocr_text="\n".join(ocr_lines),
        vision_analysis=(
            f"Analyse tabulaire metier sur document {document_type.upper()} "
            f"avec profil {insights.document_profile}, mapping de colonnes, scoring et detection des anomalies."
        ),
        analysis_mode=resolved_analysis_mode,
        analysis_status=analysis_status,
        advanced_analysis_available=advanced_analysis_available,
        advanced_analysis_completed=advanced_analysis_completed,
        can_run_advanced=advanced_analysis_available,
        processing_message=processing_message,
        processing_notices=stage_notices,
        warning=None,
        error_type=None if analysis_status == "success" else "tabular_fallback",
        fallback_answer=answer_text if fallback_used else None,
        detected_kpis=detected_kpis,
        recommendations=recommendation_texts,
        confidence=max(0.0, min(confidence, 1.0)),
        ocr_confidence=max(0.0, min(insights.confidence, 1.0)),
        detected_operator=insights.top_operator,
        detected_anomalies=detected_anomalies,
        analysis_metadata=ChatImageAnalysisMetadata(
            source_mode="tabular_pandas",
            visible_kpis_used=detected_kpis[:8],
            blocked_global_context=not use_internal_summary_context,
            removed_unverified_claims=[],
            filtered_numbers=[],
            confidence_score=max(0.0, min(confidence, 1.0)),
        ),
        decision_recommendations=insights.decision_recommendations,
        recommendation_notice=(
            f"Economie cible potentielle: {_format_mad(insights.estimated_savings_mad)}"
            if insights.estimated_savings_mad is not None
            else None
        ),
        risk_level=insights.risk_level,
        optimization_score=insights.optimization_score,
        anomaly_score=insights.anomaly_score,
        fraud_score=insights.fraud_score,
        cost_score=insights.cost_score,
    )
    return polish_chat_image_response(
        response,
        exceptional_scores=allow_max_risk_score,
    )
