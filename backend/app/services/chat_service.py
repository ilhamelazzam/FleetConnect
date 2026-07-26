from __future__ import annotations

import asyncio
import csv
import hashlib
import json
import logging
import re
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, AsyncIterator, Literal

import httpx
from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import AI_OUTPUT_DIR, get_settings
from app.models.phone_line import PhoneLine
from app.models.plan import Plan
from app.schemas.chat import ChatContextMessage, ChatErrorCode, ChatResponse
from app.services.chat_reasoning_service import (
    BusinessReasoningResult,
    build_business_reasoning_result,
)
from app.services.fleet_scoring_service import (
    build_fleet_health_answer,
    build_fleet_health_department_answer,
    build_fleet_health_payload,
    build_fleet_health_improvement_answer,
    build_fleet_health_why_score_answer,
)
from app.services.mobile_fleet_advanced_kpi_service import get_mobile_fleet_advanced_kpis
from app.services.phone_line_service import compute_occupation_status

FLEET_RESULTS_FILE = AI_OUTPUT_DIR / "fleet_ai_results_morocco.csv"
MOBILE_FLEET_FILE = AI_OUTPUT_DIR / "fleetconnect_ai_output.csv"
FRAUD_RESULTS_FILE = AI_OUTPUT_DIR / "telecom_cdr_fraud_fleetconnect_enriched.csv"
ADVANCED_KPI_FILE = AI_OUTPUT_DIR / "fleetconnect_advanced_kpi.csv"
DEFAULT_UNAVAILABLE_MESSAGE = "Cette information n'est pas disponible dans les donnees actuelles."
CHAT_LOGGER = logging.getLogger("app.chat")


class ChatDataUnavailableError(RuntimeError):
    pass


class ChatServiceError(RuntimeError):
    def __init__(
        self,
        *,
        code: ChatErrorCode,
        user_message: str,
        status_code: int = 500,
        log_message: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(user_message)
        self.code = code
        self.user_message = user_message
        self.status_code = status_code
        self.log_message = log_message or user_message
        self.details = details or None


class LocalModelUnavailableError(ChatServiceError):
    def __init__(self, user_message: str, log_message: str | None = None) -> None:
        super().__init__(
            code="OLLAMA_OFFLINE",
            user_message=user_message,
            status_code=503,
            log_message=log_message,
        )


class ChatTimeoutError(ChatServiceError):
    def __init__(
        self,
        user_message: str = "La réponse prend trop de temps. Veuillez réessayer.",
        log_message: str = "Generation Ollama trop lente.",
    ) -> None:
        super().__init__(
            code="TIMEOUT",
            user_message=user_message,
            status_code=504,
            log_message=log_message,
        )


class RequestCancelledError(ChatServiceError):
    def __init__(self) -> None:
        super().__init__(
            code="REQUEST_CANCELLED",
            user_message="Réponse interrompue.",
            status_code=499,
            log_message="La requête chat a été annulée.",
        )


class ChatServerError(ChatServiceError):
    def __init__(self, user_message: str = "Une erreur est survenue côté serveur.") -> None:
        super().__init__(
            code="SERVER_ERROR",
            user_message=user_message,
            status_code=500,
            log_message=user_message,
        )


class ImageAnalysisTimeoutError(ChatServiceError):
    def __init__(self, user_message: str = "Analyse image trop longue.") -> None:
        super().__init__(
            code="TIMEOUT",
            user_message=user_message,
            status_code=504,
            log_message=user_message,
        )


class InvalidImageError(ChatServiceError):
    def __init__(
        self,
        user_message: str = "Format image non supporté.",
        *,
        code: ChatErrorCode = "IMAGE_INVALID",
        status_code: int = 415,
        log_message: str | None = None,
    ) -> None:
        super().__init__(
            code=code,
            user_message=user_message,
            status_code=status_code,
            log_message=log_message or user_message,
        )


class InvalidAudioError(ChatServiceError):
    def __init__(
        self,
        user_message: str = "Format audio non supporte.",
        *,
        status_code: int = 400,
        log_message: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(
            code="AUDIO_INVALID",
            user_message=user_message,
            status_code=status_code,
            log_message=log_message or user_message,
            details=details,
        )


class AudioTooLargeError(ChatServiceError):
    def __init__(self, user_message: str = "Fichier audio trop lourd.") -> None:
        super().__init__(
            code="AUDIO_TOO_LARGE",
            user_message=user_message,
            status_code=413,
            log_message=user_message,
        )


class ImageTooLargeError(ChatServiceError):
    def __init__(self, user_message: str = "Image trop lourde pour analyse.") -> None:
        super().__init__(
            code="IMAGE_TOO_LARGE",
            user_message=user_message,
            status_code=413,
            log_message=user_message,
        )


class NoAudioDetectedError(ChatServiceError):
    def __init__(self, user_message: str = "Aucun son detecte.") -> None:
        super().__init__(
            code="NO_AUDIO_DETECTED",
            user_message=user_message,
            status_code=422,
            log_message=user_message,
        )


class OcrUnavailableError(ChatServiceError):
    def __init__(
        self,
        user_message: str = "La capture ne contient pas assez de texte exploitable pour une lecture fiable.",
    ) -> None:
        super().__init__(
            code="OCR_UNAVAILABLE",
            user_message=user_message,
            status_code=503,
            log_message=user_message,
        )


class TranscriptionUnavailableError(ChatServiceError):
    def __init__(
        self,
        user_message: str = "Transcription impossible.",
        *,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(
            code="TRANSCRIPTION_UNAVAILABLE",
            user_message=user_message,
            status_code=503,
            log_message=user_message,
            details=details,
        )


class VoiceSttDisabledError(ChatServiceError):
    def __init__(
        self,
        user_message: str = "La transcription vocale est desactivee sur ce serveur.",
        *,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(
            code="VOICE_STT_DISABLED",
            user_message=user_message,
            status_code=503,
            log_message=user_message,
            details=details,
        )


class VoiceSttUnavailableError(ChatServiceError):
    def __init__(
        self,
        user_message: str = "Le moteur de transcription vocale est indisponible.",
        *,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(
            code="VOICE_STT_UNAVAILABLE",
            user_message=user_message,
            status_code=503,
            log_message=user_message,
            details=details,
        )


class VisionUnavailableError(ChatServiceError):
    def __init__(self, user_message: str = "Analyse visuelle indisponible.") -> None:
        super().__init__(
            code="VISION_UNAVAILABLE",
            user_message=user_message,
            status_code=503,
            log_message=user_message,
        )


class TtsUnavailableError(ChatServiceError):
    def __init__(self, user_message: str = "Lecture audio indisponible.") -> None:
        super().__init__(
            code="TTS_UNAVAILABLE",
            user_message=user_message,
            status_code=503,
            log_message=user_message,
        )


class MemoryPressureError(ChatServiceError):
    def __init__(self, user_message: str = "Mémoire insuffisante pour analyser l’image.") -> None:
        super().__init__(
            code="MEMORY_ERROR",
            user_message=user_message,
            status_code=507,
            log_message=user_message,
        )


def _resolve_fleet_results_file() -> Path:
    source = get_settings().resolve_customer_churn_output_source()
    return source.path or source.configured_path or FLEET_RESULTS_FILE


def _resolve_mobile_fleet_file() -> Path:
    source = get_settings().resolve_mobile_fleet_source()
    return source.path or source.configured_path or MOBILE_FLEET_FILE


def _resolve_fraud_results_file() -> Path:
    source = get_settings().resolve_cdr_analytics_source()
    return source.path or source.configured_path or FRAUD_RESULTS_FILE


@dataclass(frozen=True)
class CsvContextSummary:
    prompt_context: str
    sources: list[str]
    updated_at: str


@dataclass(frozen=True)
class SummaryMetric:
    label: str
    monthly_cost_mad: float
    risk_score: float
    alert_count: int


@dataclass(frozen=True)
class SummaryPlan:
    operator: str
    plan: str
    average_cost_mad: float
    line_count: int
    alert_count: int


@dataclass(frozen=True)
class SummaryCriticalLine:
    label: str
    operator: str
    department: str
    status: str
    risk_score: float
    usage_label: str
    monthly_cost_mad: float
    action: str


@dataclass(frozen=True)
class DataSummary:
    prompt_context: str
    sources: list[str]
    updated_at: str
    signature: str
    total_lines: int
    active_lines: int
    free_lines: int
    assigned_lines: int
    in_progress_lines: int
    suspended_lines: int
    inactive_lines: int
    total_monthly_cost_mad: float
    projected_monthly_cost_mad: float
    alert_count: int
    critical_alert_count: int
    budget_alert_count: int
    mobile_alert_count: int
    mobile_device_total: int
    mobile_critical_count: int
    fraud_alert_count: int
    total_call_count: int
    suspicious_call_count: int
    suspicious_call_cost_mad: float
    high_cost_call_count: int
    over_quota_count: int
    anomaly_count: int
    roaming_line_count: int
    roaming_alert_count: int
    expensive_operators: list[SummaryMetric]
    risky_departments: list[SummaryMetric]
    expensive_plans: list[SummaryPlan]
    critical_lines: list[SummaryCriticalLine]
    recommendations: list[str]
    roaming_geo_highlights: list[str] = field(default_factory=list)
    advanced_kpi_context: str = ""


@dataclass(frozen=True)
class CopilotActionCandidate:
    title: str
    reason: str
    impact: str
    priority: Literal["low", "medium", "high", "critical"]
    action_type: Literal["cost", "fraud", "equipment", "workflow", "consumption"]
    deadline: str
    status: Literal["todo", "in_progress", "done"]
    score: float


@dataclass
class CachedChatAnswer:
    response: ChatResponse
    expires_at: datetime


_CSV_CONTEXT_CACHE: CsvContextSummary | None = None
_CSV_CONTEXT_SIGNATURE: tuple[tuple[str, int, int], ...] | None = None
_DATA_SUMMARY_CACHE: DataSummary | None = None
_DATA_SUMMARY_CACHE_EXPIRES_AT: datetime | None = None
_CHAT_ANSWER_CACHE: dict[str, CachedChatAnswer] = {}

DATA_SUMMARY_TTL = timedelta(seconds=30)
CHAT_CACHE_TTL = timedelta(minutes=30)


def _normalize_text(value: str | None) -> str:
    if value is None:
        return ""

    return (
        value.strip()
        .lower()
        .replace("Ã©", "e")
        .replace("Ã¨", "e")
        .replace("Ãª", "e")
        .replace("Ã", "a")
        .replace("â€™", "'")
        .replace("â€", '"')
    )


def _clean_label(value: str | None, fallback: str = "Non renseigne") -> str:
    normalized_value = (value or "").strip()
    return normalized_value or fallback


def _to_float(value: str | None) -> float:
    if value is None:
        return 0.0

    normalized_value = value.strip().replace(" ", "").replace(",", ".")
    if normalized_value == "":
        return 0.0

    try:
        return float(normalized_value)
    except ValueError:
        return 0.0


def _is_truthy_flag(value: str | None) -> bool:
    normalized_value = _normalize_text(value)
    return normalized_value in {"1", "true", "yes", "oui"}


def _format_mad(value: float) -> str:
    return f"{value:,.0f} MAD".replace(",", " ")


def _format_score(value: float) -> str:
    return f"{round(value)}/100"


def _format_risk_level_label(value: str | None) -> str:
    normalized_value = (value or "").strip().lower()
    if normalized_value == "critical":
        return "critique"
    if normalized_value == "high":
        return "eleve"
    if normalized_value == "medium":
        return "moyen"
    if normalized_value == "low":
        return "faible"
    return "non precise"


def _format_usage(current_usage_gb: float, quota_gb: float) -> str:
    return f"{current_usage_gb:.1f}/{quota_gb:.1f} Go"


def _truncate(value: str, limit: int = 96) -> str:
    compact_value = " ".join(value.split())
    if len(compact_value) <= limit:
        return compact_value
    return f"{compact_value[:limit].rstrip()}..."


def _format_ratio(part: int, total: int) -> str:
    if total <= 0:
        return "0%"
    return f"{round((part / total) * 100)}%"


def _build_structured_answer(
    heading: str,
    metrics: list[str],
    insight: str,
    recommendation: str,
) -> str:
    lines = [heading]
    lines.extend(f"- {metric}" for metric in metrics[:4])
    lines.append(f"Insight: {insight}")
    lines.append(f"Recommandation: {recommendation}")
    return "\n".join(lines[:7])


def _priority_rank(value: str) -> int:
    if value == "critical":
        return 4
    if value == "high":
        return 3
    if value == "medium":
        return 2
    return 1


def _action_deadline_from_priority(
    priority: Literal["low", "medium", "high", "critical"],
) -> str:
    if priority == "critical":
        return "Sous 24h"
    if priority == "high":
        return "Cette semaine"
    if priority == "medium":
        return "Sous 7 jours"
    return "A planifier"


def _build_action_detail(reason: str, impact: str) -> str:
    normalized_reason = " ".join(reason.split())
    normalized_impact = " ".join(impact.split())
    if not normalized_impact:
        return normalized_reason
    if normalized_impact.lower() in normalized_reason.lower():
        return normalized_reason
    return f"{normalized_reason} Impact: {normalized_impact}"


def _detect_action_type_from_text(
    value: str,
) -> Literal["cost", "fraud", "equipment", "workflow", "consumption"]:
    normalized_value = _normalize_question_text(value)
    if any(keyword in normalized_value for keyword in ["fraude", "suspect", "appel"]):
        return "fraud"
    if any(keyword in normalized_value for keyword in ["equipement", "materiel", "terminal"]):
        return "equipment"
    if any(keyword in normalized_value for keyword in ["workflow", "process", "validation"]):
        return "workflow"
    if any(keyword in normalized_value for keyword in ["quota", "roaming", "consomm", "depassement"]):
        return "consumption"
    return "cost"


def _build_copilot_candidate(
    *,
    title: str,
    reason: str,
    impact: str,
    priority: Literal["low", "medium", "high", "critical"],
    action_type: Literal["cost", "fraud", "equipment", "workflow", "consumption"],
    signal_strength: float,
) -> CopilotActionCandidate:
    return CopilotActionCandidate(
        title=title,
        reason=reason,
        impact=impact,
        priority=priority,
        action_type=action_type,
        deadline=_action_deadline_from_priority(priority),
        status="todo",
        score=_priority_rank(priority) * 100 + signal_strength,
    )


def _serialize_copilot_action(
    action: CopilotActionCandidate,
    *,
    index: int,
) -> dict[str, object]:
    return {
        "day": f"Priorite {index}",
        "title": action.title,
        "detail": _build_action_detail(action.reason, action.impact),
        "priority": action.priority,
        "reason": action.reason,
        "impact": action.impact,
        "deadline": action.deadline,
        "type": action.action_type,
        "status": action.status,
    }


def _extract_json_object(raw_answer: str) -> dict[str, object] | None:
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

    if isinstance(payload, dict):
        return payload
    return None


def _is_optional_data_source(path: Path) -> bool:
    return path in {_resolve_mobile_fleet_file(), _resolve_fraud_results_file()}


def _build_file_signature(path: Path, *, allow_missing: bool = False) -> tuple[str, int, int]:
    if not path.exists():
        if allow_missing:
            return (path.name, -1, -1)
        raise ChatDataUnavailableError(f"Fichier introuvable: {path.name}")

    stat_result = path.stat()
    return (path.name, stat_result.st_mtime_ns, stat_result.st_size)


def _detect_csv_delimiter(sample: str) -> str:
    try:
        return csv.Sniffer().sniff(sample, delimiters=";,").delimiter
    except csv.Error:
        return ";" if sample.count(";") >= sample.count(",") else ","


def _read_csv_rows(path: Path, *, allow_missing: bool = False) -> list[dict[str, str]]:
    if not path.exists():
        if allow_missing:
            return []
        raise ChatDataUnavailableError(f"Fichier introuvable: {path.name}")

    with path.open("r", encoding="utf-8-sig", errors="ignore", newline="") as file_handle:
        sample = file_handle.read(4096)
        file_handle.seek(0)
        delimiter = _detect_csv_delimiter(sample)
        reader = csv.DictReader(file_handle, delimiter=delimiter)
        return [
            {str(key): (value or "").strip() for key, value in row.items() if key is not None}
            for row in reader
        ]


def _summarize_fleet_rows(rows: list[dict[str, str]]) -> tuple[str, Counter[str]]:
    operator_totals: dict[str, dict[str, float]] = defaultdict(
        lambda: {"cost": 0.0, "risk_sum": 0.0, "count": 0.0, "alerts": 0.0}
    )
    department_totals: dict[str, dict[str, float]] = defaultdict(
        lambda: {"cost": 0.0, "risk_sum": 0.0, "count": 0.0, "alerts": 0.0}
    )
    plan_totals: dict[str, dict[str, float | str]] = defaultdict(
        lambda: {"avg_cost_sum": 0.0, "count": 0.0, "alerts": 0.0, "operator": "", "plan": ""}
    )
    recommendation_counts: Counter[str] = Counter()
    critical_rows: list[dict[str, float | str]] = []
    total_monthly_cost = 0.0
    total_future_cost = 0.0
    over_quota_count = 0
    anomaly_count = 0
    alert_count = 0

    for row in rows:
        operator = _clean_label(row.get("operator"))
        department = _clean_label(row.get("department"))
        plan = _clean_label(row.get("plan"))
        monthly_cost = _to_float(row.get("monthly_cost_mad"))
        future_cost = _to_float(row.get("future_cost_pred_mad") or row.get("future_cost_mad"))
        risk_score = _to_float(row.get("risk_score_100"))
        current_usage = _to_float(row.get("data_usage_gb"))
        quota_gb = _to_float(row.get("quota_gb"))
        is_alert = _is_truthy_flag(row.get("alert_flag"))
        is_over_quota = _is_truthy_flag(row.get("over_quota_flag"))
        is_anomaly = _is_truthy_flag(row.get("anomaly_flag"))
        recommendation = _clean_label(row.get("recommendation"), fallback="")

        total_monthly_cost += monthly_cost
        total_future_cost += future_cost
        alert_count += int(is_alert)
        over_quota_count += int(is_over_quota)
        anomaly_count += int(is_anomaly)

        operator_entry = operator_totals[operator]
        operator_entry["cost"] += monthly_cost
        operator_entry["risk_sum"] += risk_score
        operator_entry["count"] += 1
        operator_entry["alerts"] += int(is_alert or is_anomaly or is_over_quota)

        department_entry = department_totals[department]
        department_entry["cost"] += monthly_cost
        department_entry["risk_sum"] += risk_score
        department_entry["count"] += 1
        department_entry["alerts"] += int(is_alert or is_anomaly or is_over_quota)

        plan_key = f"{operator}::{plan}"
        plan_entry = plan_totals[plan_key]
        plan_entry["avg_cost_sum"] += monthly_cost
        plan_entry["count"] += 1
        plan_entry["alerts"] += int(is_alert or is_over_quota)
        plan_entry["operator"] = operator
        plan_entry["plan"] = plan

        if recommendation and _normalize_text(recommendation) not in {"ras", "none", "non renseigne"}:
            recommendation_counts[recommendation] += 1

        if is_alert or is_anomaly or is_over_quota or risk_score >= 80:
            critical_rows.append(
                {
                    "operator": operator,
                    "department": department,
                    "plan": plan,
                    "risk_score": risk_score,
                    "monthly_cost": monthly_cost,
                    "usage": _format_usage(current_usage, quota_gb) if quota_gb > 0 else f"{current_usage:.1f} Go",
                    "recommendation": recommendation or DEFAULT_UNAVAILABLE_MESSAGE,
                }
            )

    top_operators = sorted(
        operator_totals.items(),
        key=lambda item: (item[1]["cost"], item[1]["alerts"], item[1]["risk_sum"]),
        reverse=True,
    )[:5]
    top_departments = sorted(
        department_totals.items(),
        key=lambda item: (item[1]["cost"], item[1]["alerts"], item[1]["risk_sum"]),
        reverse=True,
    )[:5]
    top_expensive_plans = sorted(
        plan_totals.values(),
        key=lambda entry: (
            (entry["avg_cost_sum"] / entry["count"]) if entry["count"] else 0,
            entry["alerts"],
        ),
        reverse=True,
    )[:5]
    top_critical_rows = sorted(
        critical_rows,
        key=lambda entry: (float(entry["risk_score"]), float(entry["monthly_cost"])),
        reverse=True,
    )[:5]

    lines = [
        "Synthese IA des couts telecom:",
        f"- {len(rows)} lignes analysees, cout mensuel estime {_format_mad(total_monthly_cost)}, projection future {_format_mad(total_future_cost)}.",
        f"- {alert_count} alertes budget, {over_quota_count} depassements de quota, {anomaly_count} anomalies.",
    ]

    if top_operators:
        lines.append("Top operateurs a surveiller:")
        for index, (operator, values) in enumerate(top_operators, start=1):
            average_risk = values["risk_sum"] / values["count"] if values["count"] else 0.0
            lines.append(
                f"{index}. {operator} - cout {_format_mad(values['cost'])}, risque moyen {_format_score(average_risk)}, alertes {int(values['alerts'])}."
            )

    if top_departments:
        lines.append("Top departements a risque:")
        for index, (department, values) in enumerate(top_departments, start=1):
            average_risk = values["risk_sum"] / values["count"] if values["count"] else 0.0
            lines.append(
                f"{index}. {department} - cout {_format_mad(values['cost'])}, risque moyen {_format_score(average_risk)}, alertes {int(values['alerts'])}."
            )

    if top_expensive_plans:
        lines.append("Forfaits les plus chers:")
        for index, plan_entry in enumerate(top_expensive_plans, start=1):
            average_cost = (
                float(plan_entry["avg_cost_sum"]) / float(plan_entry["count"])
                if plan_entry["count"]
                else 0.0
            )
            lines.append(
                f"{index}. {plan_entry['operator']} / {plan_entry['plan']} - cout moyen {_format_mad(average_cost)}, lignes {int(plan_entry['count'])}, alertes {int(plan_entry['alerts'])}."
            )

    if top_critical_rows:
        lines.append("Dossiers critiques issus des fichiers IA:")
        for index, row in enumerate(top_critical_rows, start=1):
            lines.append(
                f"{index}. {row['operator']} / {row['department']} / forfait {row['plan']} - score {_format_score(float(row['risk_score']))}, cout {_format_mad(float(row['monthly_cost']))}, usage {row['usage']}, action {_truncate(str(row['recommendation']))}."
            )

    return "\n".join(lines), recommendation_counts


def _summarize_mobile_rows(rows: list[dict[str, str]]) -> tuple[str, Counter[str]]:
    department_risk: dict[str, dict[str, float]] = defaultdict(
        lambda: {"risk_sum": 0.0, "count": 0.0, "cost": 0.0, "alerts": 0.0}
    )
    operator_risk: dict[str, dict[str, float]] = defaultdict(
        lambda: {"risk_sum": 0.0, "count": 0.0, "cost": 0.0, "alerts": 0.0}
    )
    flagged_devices: list[dict[str, float | str]] = []
    recommendation_counts: Counter[str] = Counter()
    alert_count = 0
    total_estimated_price = 0.0

    for row in rows:
        operator = _clean_label(row.get("operator"))
        department = _clean_label(row.get("department"))
        employee_profile = _clean_label(row.get("employee_profile"))
        device_category = _clean_label(row.get("device_category"))
        estimated_price = _to_float(row.get("estimated_price_mad"))
        risk_score = _to_float(row.get("budget_risk_score"))
        recommendation = _clean_label(row.get("recommendation"), fallback="")
        is_alert = _is_truthy_flag(row.get("alert_flag"))
        risk_level = _clean_label(row.get("risk_level"))

        total_estimated_price += estimated_price
        alert_count += int(is_alert)

        department_entry = department_risk[department]
        department_entry["risk_sum"] += risk_score
        department_entry["count"] += 1
        department_entry["cost"] += estimated_price
        department_entry["alerts"] += int(is_alert)

        operator_entry = operator_risk[operator]
        operator_entry["risk_sum"] += risk_score
        operator_entry["count"] += 1
        operator_entry["cost"] += estimated_price
        operator_entry["alerts"] += int(is_alert)

        if recommendation and _normalize_text(recommendation) not in {"ras", "none", "non renseigne"}:
            recommendation_counts[recommendation] += 1

        if is_alert or risk_score >= 70:
            flagged_devices.append(
                {
                    "operator": operator,
                    "department": department,
                    "employee_profile": employee_profile,
                    "device_category": device_category,
                    "estimated_price": estimated_price,
                    "risk_score": risk_score,
                    "risk_level": risk_level,
                    "recommendation": recommendation or DEFAULT_UNAVAILABLE_MESSAGE,
                }
            )

    top_departments = sorted(
        department_risk.items(),
        key=lambda item: (
            (item[1]["risk_sum"] / item[1]["count"]) if item[1]["count"] else 0,
            item[1]["cost"],
        ),
        reverse=True,
    )[:5]
    top_operators = sorted(
        operator_risk.items(),
        key=lambda item: (
            (item[1]["risk_sum"] / item[1]["count"]) if item[1]["count"] else 0,
            item[1]["cost"],
        ),
        reverse=True,
    )[:5]
    top_flagged_devices = sorted(
        flagged_devices,
        key=lambda row: (float(row["risk_score"]), float(row["estimated_price"])),
        reverse=True,
    )[:5]

    average_estimated_price = total_estimated_price / len(rows) if rows else 0.0
    lines = [
        "Synthese des recommandations equipements mobiles:",
        f"- {len(rows)} equipements analyses, budget moyen {_format_mad(average_estimated_price)}, {alert_count} alertes budget.",
    ]

    if top_departments:
        lines.append("Departements avec le plus de risque budget:")
        for index, (department, values) in enumerate(top_departments, start=1):
            average_risk = values["risk_sum"] / values["count"] if values["count"] else 0.0
            lines.append(
                f"{index}. {department} - risque moyen {_format_score(average_risk)}, budget {_format_mad(values['cost'])}, alertes {int(values['alerts'])}."
            )

    if top_operators:
        lines.append("Operateurs avec le plus de tension budget:")
        for index, (operator, values) in enumerate(top_operators, start=1):
            average_risk = values["risk_sum"] / values["count"] if values["count"] else 0.0
            lines.append(
                f"{index}. {operator} - risque moyen {_format_score(average_risk)}, budget {_format_mad(values['cost'])}, alertes {int(values['alerts'])}."
            )

    if top_flagged_devices:
        lines.append("Equipements prioritaires:")
        for index, row in enumerate(top_flagged_devices, start=1):
            lines.append(
                f"{index}. {row['operator']} / {row['department']} / {row['device_category']} ({row['employee_profile']}) - prix {_format_mad(float(row['estimated_price']))}, score {_format_score(float(row['risk_score']))}, niveau {row['risk_level']}, action {_truncate(str(row['recommendation']))}."
            )

    return "\n".join(lines), recommendation_counts


def _summarize_fraud_rows(rows: list[dict[str, str]]) -> str:
    operator_risk: dict[str, dict[str, float]] = defaultdict(
        lambda: {"count": 0.0, "risk_sum": 0.0, "cost": 0.0}
    )
    department_risk: dict[str, dict[str, float]] = defaultdict(
        lambda: {"count": 0.0, "risk_sum": 0.0, "cost": 0.0}
    )
    suspicious_calls: list[dict[str, float | str]] = []
    fraud_count = 0
    high_cost_count = 0
    international_count = 0
    suspicious_cost = 0.0

    for row in rows:
        operator = _clean_label(row.get("operator_maroc"))
        department = _clean_label(row.get("department"))
        call_zone = _clean_label(row.get("call_zone"))
        fraud_type = _clean_label(row.get("fraud_type"), fallback="none")
        transaction_status = _clean_label(row.get("transaction_status"))
        risk_score = _to_float(row.get("fraud_risk_score_100"))
        call_cost = _to_float(row.get("call_cost_mad"))
        is_fraud = _is_truthy_flag(row.get("fraud_flag"))
        is_high_cost = _is_truthy_flag(row.get("high_cost_flag"))
        is_international = _is_truthy_flag(row.get("international_flag"))

        fraud_count += int(is_fraud)
        high_cost_count += int(is_high_cost)
        international_count += int(is_international)
        suspicious_cost += call_cost if (is_fraud or risk_score >= 80) else 0.0

        if is_fraud or risk_score >= 70:
            operator_entry = operator_risk[operator]
            operator_entry["count"] += 1
            operator_entry["risk_sum"] += risk_score
            operator_entry["cost"] += call_cost

            department_entry = department_risk[department]
            department_entry["count"] += 1
            department_entry["risk_sum"] += risk_score
            department_entry["cost"] += call_cost

            suspicious_calls.append(
                {
                    "operator": operator,
                    "department": department,
                    "call_zone": call_zone,
                    "fraud_type": fraud_type,
                    "transaction_status": transaction_status,
                    "risk_score": risk_score,
                    "call_cost": call_cost,
                }
            )

    top_operators = sorted(
        operator_risk.items(),
        key=lambda item: (item[1]["count"], item[1]["risk_sum"], item[1]["cost"]),
        reverse=True,
    )[:5]
    top_departments = sorted(
        department_risk.items(),
        key=lambda item: (item[1]["count"], item[1]["risk_sum"], item[1]["cost"]),
        reverse=True,
    )[:5]
    top_suspicious_calls = sorted(
        suspicious_calls,
        key=lambda row: (float(row["risk_score"]), float(row["call_cost"])),
        reverse=True,
    )[:5]

    lines = [
        "Synthese fraude et anomalies appels:",
        f"- {len(rows)} appels controles, {fraud_count} fraudes detectees, {high_cost_count} appels a cout eleve, {international_count} appels internationaux.",
        f"- Exposition couts suspects {_format_mad(suspicious_cost)}.",
    ]

    if top_operators:
        lines.append("Operateurs avec le plus de risque fraude:")
        for index, (operator, values) in enumerate(top_operators, start=1):
            average_risk = values["risk_sum"] / values["count"] if values["count"] else 0.0
            lines.append(
                f"{index}. {operator} - incidents {int(values['count'])}, risque moyen {_format_score(average_risk)}, cout suspect {_format_mad(values['cost'])}."
            )

    if top_departments:
        lines.append("Departements a surveiller pour les appels suspects:")
        for index, (department, values) in enumerate(top_departments, start=1):
            average_risk = values["risk_sum"] / values["count"] if values["count"] else 0.0
            lines.append(
                f"{index}. {department} - incidents {int(values['count'])}, risque moyen {_format_score(average_risk)}, cout suspect {_format_mad(values['cost'])}."
            )

    if top_suspicious_calls:
        lines.append("Appels suspects prioritaires:")
        for index, row in enumerate(top_suspicious_calls, start=1):
            lines.append(
                f"{index}. {row['operator']} / {row['department']} / zone {row['call_zone']} - type {row['fraud_type']}, score {_format_score(float(row['risk_score']))}, cout {_format_mad(float(row['call_cost']))}, statut {row['transaction_status']}."
            )

    return "\n".join(lines)


def _summarize_recommendations(
    recommendation_counts: Counter[str],
) -> str:
    top_recommendations = recommendation_counts.most_common(5)
    if not top_recommendations:
        return (
            "Recommandations prioritaires:\n"
            "- Cette information n'est pas disponible dans les donnees actuelles."
        )

    lines = ["Recommandations prioritaires a appliquer:"]
    for index, (recommendation, count) in enumerate(top_recommendations, start=1):
        lines.append(f"{index}. {recommendation} - {count} occurrence(s).")
    return "\n".join(lines)


def _get_live_plan_price_map(plans: list[Plan]) -> dict[tuple[str, str], int]:
    plan_price_map: dict[tuple[str, str], int] = {}
    for plan in plans:
        plan_price_map[(plan.operator_name.strip().lower(), plan.name.strip().lower())] = (
            plan.monthly_price
        )
    return plan_price_map


def _ensure_aware_datetime(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _utcnow() -> datetime:
    return datetime.now(tz=UTC)


def _elapsed_ms(started_at: datetime) -> int:
    return int((_utcnow() - started_at).total_seconds() * 1000)


def _log_chat_event(level: int, event: str, **fields: object) -> None:
    serialized_fields = " ".join(
        f"{key}={json.dumps(value, ensure_ascii=False)}"
        for key, value in fields.items()
    )
    CHAT_LOGGER.log(level, "event=%s %s", event, serialized_fields)


async def _ensure_request_connected(request: Request) -> None:
    if await request.is_disconnected():
        raise RequestCancelledError()


def _normalize_question_text(value: str) -> str:
    normalized_value = unicodedata.normalize("NFD", value.lower())
    normalized_value = "".join(
        character for character in normalized_value if unicodedata.category(character) != "Mn"
    )
    normalized_value = re.sub(r"[^a-z0-9\s]", " ", normalized_value)
    return " ".join(normalized_value.split())


def _build_signature(parts: list[str]) -> str:
    return hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()


def _prune_chat_answer_cache() -> None:
    now = _utcnow()
    expired_keys = [
        cache_key
        for cache_key, cached_answer in _CHAT_ANSWER_CACHE.items()
        if cached_answer.expires_at <= now
    ]
    for cache_key in expired_keys:
        _CHAT_ANSWER_CACHE.pop(cache_key, None)


def _build_cache_key(
    question: str,
    history: list[ChatContextMessage],
    summary: DataSummary,
) -> str:
    history_signature = "::".join(
        f"{message.role}:{_normalize_question_text(_truncate(message.text, 180))}"
        for message in history[-2:]
    )
    return _build_signature(
        [
            summary.signature,
            _normalize_question_text(question),
            history_signature,
        ]
    )


def _get_cached_answer(cache_key: str) -> ChatResponse | None:
    _prune_chat_answer_cache()
    cached_answer = _CHAT_ANSWER_CACHE.get(cache_key)
    if cached_answer is None:
        return None

    return cached_answer.response.model_copy(
        update={
            "cached": True,
        }
    )


def _store_cached_answer(cache_key: str, response: ChatResponse) -> None:
    _prune_chat_answer_cache()
    _CHAT_ANSWER_CACHE[cache_key] = CachedChatAnswer(
        response=response.model_copy(update={"cached": False}),
        expires_at=_utcnow() + CHAT_CACHE_TTL,
    )


def _extract_top_recommendations(recommendation_counts: Counter[str]) -> list[str]:
    return [recommendation for recommendation, _ in recommendation_counts.most_common(5)]


def _format_metric_line(metric: SummaryMetric) -> str:
    return (
        f"{metric.label} - cout {_format_mad(metric.monthly_cost_mad)}, "
        f"risque {_format_score(metric.risk_score)}, alertes {metric.alert_count}"
    )


def _format_plan_line(plan: SummaryPlan) -> str:
    return (
        f"{plan.operator} / {plan.plan} - cout moyen {_format_mad(plan.average_cost_mad)}, "
        f"lignes {plan.line_count}, alertes {plan.alert_count}"
    )


def _format_critical_line(critical_line: SummaryCriticalLine) -> str:
    return (
        f"{critical_line.label} - {critical_line.operator} / {critical_line.department}, "
        f"statut {critical_line.status}, score {_format_score(critical_line.risk_score)}, "
        f"usage {critical_line.usage_label}, cout {_format_mad(critical_line.monthly_cost_mad)}"
    )


def _build_alerts_explanation_answer(summary: DataSummary) -> str:
    critical_ratio = (
        round((summary.critical_alert_count / summary.alert_count) * 100)
        if summary.alert_count > 0
        else 0
    )
    top_operator = summary.expensive_operators[0] if summary.expensive_operators else None
    top_line = summary.critical_lines[0] if summary.critical_lines else None
    recommendation = (
        summary.recommendations[0]
        if summary.recommendations
        else "Traiter d'abord les alertes critiques puis reevaluer les forfaits exposes."
    )
    metrics = [
        (
            f"{summary.alert_count} alertes, dont {summary.critical_alert_count} critiques "
            f"({critical_ratio}% du volume)"
        ),
        (
            f"Repartition: {summary.budget_alert_count} budget, {summary.mobile_alert_count} equipements, "
            f"{summary.fraud_alert_count} fraude ou haut cout"
        ),
        (
            f"Causes visibles: {summary.over_quota_count} depassements de quota "
            f"et {summary.anomaly_count} anomalies"
        ),
    ]
    if top_operator is not None:
        metrics.append(
            f"Priorite operateur: {top_operator.label}, {_format_mad(top_operator.monthly_cost_mad)}, "
            f"{top_operator.alert_count} alertes"
        )

    insight = (
        f"La pression se concentre sur {top_line.label} ({top_line.usage_label})"
        if top_line is not None
        else "Le risque se concentre sur les usages et couts les plus eleves"
    )
    return _build_structured_answer(
        "Alerte importante",
        metrics,
        insight,
        recommendation,
    )


def _build_partial_data_answer(question: str, summary: DataSummary) -> str:
    top_operator = summary.expensive_operators[0] if summary.expensive_operators else None
    recommendation = (
        summary.recommendations[0]
        if summary.recommendations
        else "Prioriser les alertes critiques et les forfaits les plus couteux."
    )
    metrics = [
        f"Estimation basee sur les indicateurs proches de la flotte",
        (
            f"Flotte: {summary.total_lines} lignes, {summary.free_lines} libres, "
            f"{summary.active_lines} actives"
        ),
        (
            f"Budget: {_format_mad(summary.total_monthly_cost_mad)} mensuels, "
            f"projection {_format_mad(summary.projected_monthly_cost_mad)}"
        ),
        f"Risque: {summary.alert_count} alertes dont {summary.critical_alert_count} critiques",
    ]

    insight = (
        f"{top_operator.label} reste le principal poste a surveiller"
        if top_operator is not None
        else "Les alertes restent le meilleur proxy de risque"
    )
    return _build_structured_answer(
        "Selon les donnees disponibles",
        metrics,
        insight,
        recommendation,
    )


def _build_summary_prompt_context(summary: DataSummary) -> str:
    lines = [
        "Vue metier compacte:",
        (
            f"- Lignes: {summary.total_lines} total, {summary.free_lines} libres, "
            f"{summary.assigned_lines} attribuees, {summary.in_progress_lines} en cours, "
            f"{summary.suspended_lines} suspendues, {summary.inactive_lines} inactives."
        ),
        (
            f"- Cout mensuel estime {_format_mad(summary.total_monthly_cost_mad)}, "
            f"projection {_format_mad(summary.projected_monthly_cost_mad)}."
        ),
        (
            f"- Alertes: {summary.alert_count} au total, {summary.critical_alert_count} critiques, "
            f"{summary.budget_alert_count} budget flotte, {summary.mobile_alert_count} equipements, "
            f"{summary.fraud_alert_count} fraude ou appels a cout eleve."
        ),
        (
            f"- Signaux de consommation: {summary.over_quota_count} depassements de quota, "
            f"{summary.anomaly_count} anomalies."
        ),
    ]

    if summary.expensive_operators:
        lines.append("Operateurs les plus couteux:")
        lines.extend(
            f"{index}. {_format_metric_line(metric)}"
            for index, metric in enumerate(summary.expensive_operators[:3], start=1)
        )

    if summary.risky_departments:
        lines.append("Departements les plus exposes:")
        lines.extend(
            f"{index}. {_format_metric_line(metric)}"
            for index, metric in enumerate(summary.risky_departments[:3], start=1)
        )

    if summary.expensive_plans:
        lines.append("Forfaits les plus chers:")
        lines.extend(
            f"{index}. {_format_plan_line(plan)}"
            for index, plan in enumerate(summary.expensive_plans[:3], start=1)
        )

    if summary.critical_lines:
        lines.append("Lignes critiques prioritaires:")
        lines.extend(
            f"{index}. {_format_critical_line(critical_line)}"
            for index, critical_line in enumerate(summary.critical_lines[:3], start=1)
        )

    if summary.roaming_geo_highlights:
        lines.append("Geographie roaming dominante:")
        lines.extend(
            f"{index}. {highlight}"
            for index, highlight in enumerate(summary.roaming_geo_highlights[:3], start=1)
        )

    if summary.advanced_kpi_context:
        lines.append("KPI consolides parc mobile:")
        lines.append(summary.advanced_kpi_context)

    if summary.recommendations:
        lines.append("Recommandations prioritaires:")
        lines.extend(
            f"{index}. {recommendation}"
            for index, recommendation in enumerate(summary.recommendations[:4], start=1)
        )

    try:
        from app.services.live_monitoring_service import build_live_monitoring_prompt_context

        live_context = build_live_monitoring_prompt_context()
    except Exception:
        live_context = None

    if live_context:
        lines.append(live_context)

    return "\n".join(lines)


def get_data_summary(db: Session) -> DataSummary:
    global _DATA_SUMMARY_CACHE, _DATA_SUMMARY_CACHE_EXPIRES_AT
    global _CSV_CONTEXT_CACHE, _CSV_CONTEXT_SIGNATURE

    now = _utcnow()
    if (
        _DATA_SUMMARY_CACHE is not None
        and _DATA_SUMMARY_CACHE_EXPIRES_AT is not None
        and now < _DATA_SUMMARY_CACHE_EXPIRES_AT
    ):
        return _DATA_SUMMARY_CACHE

    fleet_results_file = _resolve_fleet_results_file()
    mobile_fleet_file = _resolve_mobile_fleet_file()
    fraud_results_file = _resolve_fraud_results_file()
    advanced_kpi_source = get_settings().resolve_mobile_fleet_advanced_kpi_source()
    advanced_kpi_file = (
        advanced_kpi_source.path
        or advanced_kpi_source.configured_path
        or ADVANCED_KPI_FILE
    )
    source_files = [fleet_results_file, mobile_fleet_file, fraud_results_file, advanced_kpi_file]
    file_signatures = tuple(
        _build_file_signature(path, allow_missing=_is_optional_data_source(path))
        for path in source_files
    )
    existing_source_files = [path for path in source_files if path.exists()]
    fleet_rows = _read_csv_rows(fleet_results_file)
    mobile_rows = _read_csv_rows(mobile_fleet_file, allow_missing=True)
    fraud_rows = _read_csv_rows(fraud_results_file, allow_missing=True)

    operator_totals: dict[str, dict[str, float]] = defaultdict(
        lambda: {"cost": 0.0, "risk_sum": 0.0, "count": 0.0, "alerts": 0.0}
    )
    department_totals: dict[str, dict[str, float]] = defaultdict(
        lambda: {"cost": 0.0, "risk_sum": 0.0, "count": 0.0, "alerts": 0.0}
    )
    plan_totals: dict[str, dict[str, float | str]] = defaultdict(
        lambda: {"avg_cost_sum": 0.0, "count": 0.0, "alerts": 0.0, "operator": "", "plan": ""}
    )
    recommendation_counts: Counter[str] = Counter()
    total_monthly_cost = 0.0
    projected_monthly_cost = 0.0
    budget_alert_count = 0
    over_quota_count = 0
    anomaly_count = 0
    roaming_line_count = 0
    roaming_alert_count = 0

    for row in fleet_rows:
        operator = _clean_label(row.get("operator"))
        department = _clean_label(row.get("department"))
        plan = _clean_label(row.get("plan"))
        monthly_cost = _to_float(row.get("monthly_cost_mad"))
        future_cost = _to_float(row.get("future_cost_pred_mad") or row.get("future_cost_mad"))
        risk_score = _to_float(row.get("risk_score_100"))
        is_alert = _is_truthy_flag(row.get("alert_flag"))
        is_over_quota = _is_truthy_flag(row.get("over_quota_flag"))
        is_anomaly = _is_truthy_flag(row.get("anomaly_flag"))
        is_roaming = _is_truthy_flag(row.get("roaming_flag"))
        recommendation = _clean_label(row.get("recommendation"), fallback="")

        total_monthly_cost += monthly_cost
        projected_monthly_cost += future_cost
        budget_alert_count += int(is_alert)
        over_quota_count += int(is_over_quota)
        anomaly_count += int(is_anomaly)
        roaming_line_count += int(is_roaming)
        roaming_alert_count += int(is_roaming and (is_alert or is_over_quota or is_anomaly))

        operator_entry = operator_totals[operator]
        operator_entry["cost"] += monthly_cost
        operator_entry["risk_sum"] += risk_score
        operator_entry["count"] += 1
        operator_entry["alerts"] += int(is_alert or is_anomaly or is_over_quota)

        department_entry = department_totals[department]
        department_entry["cost"] += monthly_cost
        department_entry["risk_sum"] += risk_score
        department_entry["count"] += 1
        department_entry["alerts"] += int(is_alert or is_anomaly or is_over_quota)

        plan_key = f"{operator}::{plan}"
        plan_entry = plan_totals[plan_key]
        plan_entry["avg_cost_sum"] += monthly_cost
        plan_entry["count"] += 1
        plan_entry["alerts"] += int(is_alert or is_over_quota)
        plan_entry["operator"] = operator
        plan_entry["plan"] = plan

        if recommendation and _normalize_text(recommendation) not in {"ras", "none", "non renseigne"}:
            recommendation_counts[recommendation] += 1

    mobile_alert_count = 0
    mobile_device_total = len(mobile_rows)
    mobile_critical_count = 0
    for row in mobile_rows:
        recommendation = _clean_label(row.get("recommendation"), fallback="")
        if recommendation and _normalize_text(recommendation) not in {"ras", "none", "non renseigne"}:
            recommendation_counts[recommendation] += 1

        mobile_alert_count += int(_is_truthy_flag(row.get("alert_flag")))
        mobile_risk_score = _to_float(row.get("budget_risk_score"))
        mobile_risk_level = _normalize_text(row.get("risk_level"))
        if mobile_risk_level in {"critique", "critical"} or mobile_risk_score >= 80:
            mobile_critical_count += 1

    fraud_alert_count = 0
    total_call_count = len(fraud_rows)
    suspicious_call_count = 0
    suspicious_call_cost_mad = 0.0
    high_cost_call_count = 0
    roaming_country_totals: dict[str, dict[str, float]] = defaultdict(
        lambda: {"cost": 0.0, "count": 0.0, "alerts": 0.0}
    )
    for row in fraud_rows:
        is_fraud_flag = _is_truthy_flag(row.get("fraud_flag"))
        is_high_cost_flag = _is_truthy_flag(row.get("high_cost_flag"))
        is_roaming_flag = _is_truthy_flag(row.get("roaming_flag")) or _normalize_text(
            str(row.get("call_zone") or "")
        ) == "roaming"
        call_cost_mad = _to_float(row.get("call_cost_mad"))
        is_suspicious_call = is_fraud_flag or is_high_cost_flag

        fraud_alert_count += int(is_fraud_flag)
        fraud_alert_count += int(is_high_cost_flag)
        high_cost_call_count += int(is_high_cost_flag)
        suspicious_call_count += int(is_suspicious_call)
        suspicious_call_cost_mad += call_cost_mad if is_suspicious_call else 0.0

        if is_roaming_flag:
            country_label = _clean_label(
                row.get("country_origin") or row.get("country_dest"),
                fallback="Inconnu",
            )
            country_entry = roaming_country_totals[country_label]
            country_entry["cost"] += call_cost_mad
            country_entry["count"] += 1
            country_entry["alerts"] += int(is_suspicious_call)

    phone_lines = list(db.scalars(select(PhoneLine)))
    plans = list(db.scalars(select(Plan)))
    plan_price_map = _get_live_plan_price_map(plans)
    occupation_counts = Counter(compute_occupation_status(phone_line) for phone_line in phone_lines)
    critical_lines: list[SummaryCriticalLine] = []
    latest_live_timestamps = [
        timestamp
        for timestamp in [
            *(_ensure_aware_datetime(line.updated_at) for line in phone_lines),
            *(_ensure_aware_datetime(plan.updated_at) for plan in plans),
        ]
        if timestamp is not None
    ]

    for phone_line in phone_lines:
        usage_rate = (
            phone_line.current_data_usage_gb / phone_line.monthly_limit
            if phone_line.monthly_limit not in (None, 0)
            else None
        )
        risk_score = 0.0

        if usage_rate is not None:
            risk_score += min(usage_rate, 1.5) * 70
        if phone_line.status == "suspended":
            risk_score += 25
        elif phone_line.status == "inactive":
            risk_score += 12
        elif not phone_line.assigned_to:
            risk_score += 8

        if phone_line.previous_data_usage_gb > 0:
            growth = (
                (phone_line.current_data_usage_gb - phone_line.previous_data_usage_gb)
                / phone_line.previous_data_usage_gb
            ) * 100
            risk_score += max(growth, 0) * 0.25

        if (
            phone_line.status in {"suspended", "inactive"}
            or (usage_rate is not None and usage_rate >= 0.85)
            or risk_score >= 65
        ):
            monthly_price = float(
                plan_price_map.get(
                    (
                        phone_line.operator_name.strip().lower(),
                        phone_line.plan_name.strip().lower(),
                    ),
                    0,
                )
            )
            critical_lines.append(
                SummaryCriticalLine(
                    label=phone_line.phone_number,
                    operator=phone_line.operator_name,
                    department=_clean_label(phone_line.department, "Sans departement"),
                    status=phone_line.status,
                    risk_score=risk_score,
                    usage_label=(
                        _format_usage(
                            phone_line.current_data_usage_gb,
                            float(phone_line.monthly_limit),
                        )
                        if phone_line.monthly_limit not in (None, 0)
                        else f"{phone_line.current_data_usage_gb:.1f} Go"
                    ),
                    monthly_cost_mad=monthly_price,
                    action="Surveiller la consommation et ajuster le forfait si besoin.",
                )
            )

    expensive_operators = [
        SummaryMetric(
            label=label,
            monthly_cost_mad=values["cost"],
            risk_score=(values["risk_sum"] / values["count"]) if values["count"] else 0.0,
            alert_count=int(values["alerts"]),
        )
        for label, values in sorted(
            operator_totals.items(),
            key=lambda item: (item[1]["cost"], item[1]["alerts"], item[1]["risk_sum"]),
            reverse=True,
        )[:5]
    ]
    risky_departments = [
        SummaryMetric(
            label=label,
            monthly_cost_mad=values["cost"],
            risk_score=(values["risk_sum"] / values["count"]) if values["count"] else 0.0,
            alert_count=int(values["alerts"]),
        )
        for label, values in sorted(
            department_totals.items(),
            key=lambda item: (item[1]["cost"], item[1]["alerts"], item[1]["risk_sum"]),
            reverse=True,
        )[:5]
    ]
    expensive_plans = [
        SummaryPlan(
            operator=str(values["operator"]),
            plan=str(values["plan"]),
            average_cost_mad=(
                float(values["avg_cost_sum"]) / float(values["count"])
                if values["count"]
                else 0.0
            ),
            line_count=int(values["count"]),
            alert_count=int(values["alerts"]),
        )
        for values in sorted(
            plan_totals.values(),
            key=lambda entry: (
                (entry["avg_cost_sum"] / entry["count"]) if entry["count"] else 0.0,
                entry["alerts"],
            ),
            reverse=True,
        )[:5]
    ]
    critical_lines = sorted(
        critical_lines,
        key=lambda row: (row.risk_score, row.monthly_cost_mad),
        reverse=True,
    )[:5]

    total_lines = len(phone_lines)
    free_lines = occupation_counts.get("libre", 0)
    assigned_lines = occupation_counts.get("attribuee", 0)
    in_progress_lines = occupation_counts.get("en_cours", 0)
    suspended_lines = occupation_counts.get("suspendue", 0)
    inactive_lines = occupation_counts.get("inactive", 0)
    active_lines = max(total_lines - suspended_lines - inactive_lines, 0)
    alert_count = budget_alert_count + mobile_alert_count + fraud_alert_count
    critical_alert_count = over_quota_count + anomaly_count + fraud_alert_count + len(critical_lines)
    sources = [path.name for path in existing_source_files] + ["phone_lines", "plans"]
    updated_at_candidates = [
        *(
            datetime.fromtimestamp(path.stat().st_mtime, tz=UTC)
            for path in existing_source_files
        ),
        *latest_live_timestamps,
    ]
    updated_at = max(updated_at_candidates) if updated_at_candidates else now

    roaming_geo_highlights = [
        (
            f"{country}: {_format_mad(values['cost'])}, "
            f"{int(values['count'])} signal(s), {int(values['alerts'])} alerte(s)"
        )
        for country, values in sorted(
            roaming_country_totals.items(),
            key=lambda item: (item[1]["cost"], item[1]["alerts"], item[1]["count"]),
            reverse=True,
        )[:3]
    ]
    advanced_kpis = get_mobile_fleet_advanced_kpis()
    advanced_kpi_context = ""
    if advanced_kpis["total_devices"] > 0:
        devices_to_review = (
            advanced_kpis["unfit_devices"]
            or advanced_kpis["oversized_devices"] + advanced_kpis["undersized_devices"]
        )
        advanced_kpi_context = (
            f"{advanced_kpis['total_devices']} appareils, budget estime "
            f"{_format_mad(advanced_kpis['total_estimated_budget_mad'])}, TCO 12 mois "
            f"{_format_mad(advanced_kpis['total_cost_12_months_mad'])}, Fleet Health Score "
            f"{_format_score(advanced_kpis['fleet_health_score'])}, adequation moyenne "
            f"{_format_score(advanced_kpis['average_fit_score'])}, "
            f"{advanced_kpis['adapted_devices']} adaptes, {devices_to_review} a revoir, "
            f"economie potentielle {_format_mad(advanced_kpis['potential_savings_mad'])}."
        )
        if advanced_kpis["alerts_summary"]:
            advanced_kpi_context = (
                f"{advanced_kpi_context} Alertes consolidees: {advanced_kpis['alerts_summary']}."
            )

    summary = DataSummary(
        prompt_context="",
        sources=sources,
        updated_at=updated_at.isoformat(),
        signature=_build_signature(
            [
                *(f"{name}:{mtime_ns}:{size}" for name, mtime_ns, size in file_signatures),
                str(total_lines),
                str(free_lines),
                str(active_lines),
                str(alert_count),
                str(updated_at.timestamp()),
            ]
        ),
        total_lines=total_lines,
        active_lines=active_lines,
        free_lines=free_lines,
        assigned_lines=assigned_lines,
        in_progress_lines=in_progress_lines,
        suspended_lines=suspended_lines,
        inactive_lines=inactive_lines,
        total_monthly_cost_mad=total_monthly_cost,
        projected_monthly_cost_mad=projected_monthly_cost,
        alert_count=alert_count,
        critical_alert_count=critical_alert_count,
        budget_alert_count=budget_alert_count,
        mobile_alert_count=mobile_alert_count,
        mobile_device_total=mobile_device_total,
        mobile_critical_count=mobile_critical_count,
        fraud_alert_count=fraud_alert_count,
        total_call_count=total_call_count,
        suspicious_call_count=suspicious_call_count,
        suspicious_call_cost_mad=suspicious_call_cost_mad,
        high_cost_call_count=high_cost_call_count,
        over_quota_count=over_quota_count,
        anomaly_count=anomaly_count,
        roaming_line_count=roaming_line_count,
        roaming_alert_count=roaming_alert_count,
        expensive_operators=expensive_operators,
        risky_departments=risky_departments,
        expensive_plans=expensive_plans,
        critical_lines=critical_lines,
        recommendations=_extract_top_recommendations(recommendation_counts),
        roaming_geo_highlights=roaming_geo_highlights,
        advanced_kpi_context=advanced_kpi_context,
    )
    summary = DataSummary(
        **{
            **summary.__dict__,
            "prompt_context": _build_summary_prompt_context(summary),
        }
    )

    _DATA_SUMMARY_CACHE = summary
    _DATA_SUMMARY_CACHE_EXPIRES_AT = now + DATA_SUMMARY_TTL
    _CSV_CONTEXT_CACHE = CsvContextSummary(
        prompt_context=summary.prompt_context,
        sources=summary.sources,
        updated_at=summary.updated_at,
    )
    _CSV_CONTEXT_SIGNATURE = file_signatures
    return summary


def getDataSummary(db: Session) -> DataSummary:
    return get_data_summary(db)


def _build_copilot_action_plan(summary: DataSummary) -> dict[str, object]:
    return {
        "plan_title": "Plan d'action IA hebdomadaire",
        "subtitle": (
            "Un plan opérationnel structuré pour traiter les alertes, optimiser les coûts "
            f"et prioriser les actions sur {summary.total_lines} lignes." 
        ),
        "answer": (
            "Voici un plan d'action hebdomadaire basé sur l'analyse de la flotte, "
            f"les {summary.alert_count} alertes détectées et les recommandations issues des {len(summary.sources)} sources." 
        ),
        "model": get_settings().ollama_model,
        "sources": summary.sources,
        "summary_updated_at": summary.updated_at,
        "actions": [
            {
                "day": "Jour 1",
                "title": "Diagnostiquer les alertes prioritaires",
                "detail": (
                    f"Vérifier les {summary.critical_alert_count} alertes critiques, analyser les lignes à risque et valider les sources de données." 
                ),
                "priority": "critical",
            },
            {
                "day": "Jour 2",
                "title": "Auditer les opérateurs et forfaits chers",
                "detail": (
                    f"Examiner les opérateurs les plus coûteux et les forfaits surévalués pour préparer des optimisations concrètes." 
                ),
                "priority": "high",
            },
            {
                "day": "Jour 3",
                "title": "Traiter les dépassements de quota",
                "detail": (
                    f"Identifier les {summary.over_quota_count} dépassements de quota et définir des actions immédiates de correction." 
                ),
                "priority": "high",
            },
            {
                "day": "Jour 4",
                "title": "Vérifier les signaux de fraude et anomalies",
                "detail": (
                    f"Analyser les {summary.fraud_alert_count} alertes fraude et {summary.anomaly_count} anomalies pour éviter les risques opérationnels." 
                ),
                "priority": "high",
            },
            {
                "day": "Jour 5",
                "title": "Optimiser les lignes inactives et libres",
                "detail": (
                    f"Revoir les {summary.inactive_lines} lignes inactives et {summary.free_lines} lignes libres pour réduire les coûts inutiles." 
                ),
                "priority": "medium",
            },
            {
                "day": "Jour 6",
                "title": "Coordonner les actions par département",
                "detail": (
                    f"Prioriser la réponse aux départements les plus exposés et aligner les solutions avec les responsables métier." 
                ),
                "priority": "medium",
            },
            {
                "day": "Jour 7",
                "title": "Suivre l'impact et préparer le point de revue",
                "detail": (
                    "Mesurer les premiers résultats, enregistrer les économies potentielles et préparer une synthèse de suivi." 
                ),
                "priority": "medium",
            },
        ],
        "recommendations": summary.recommendations[:6],
        "cached": False,
        "duration_ms": None,
    }


def generate_copilot_action_plan(db: Session) -> dict[str, object]:
    summary = get_data_summary(db)
    return _build_copilot_action_plan(summary)


def _get_live_monitoring_snapshot_if_available():
    try:
        from app.services.live_monitoring_service import get_live_monitoring_snapshot_if_ready

        return get_live_monitoring_snapshot_if_ready()
    except Exception:
        return None


def _build_copilot_action_candidates(
    summary: DataSummary,
    *,
    fleet_payload: dict[str, object],
    live_snapshot=None,
) -> list[CopilotActionCandidate]:
    scores = fleet_payload.get("scores")
    if not isinstance(scores, dict):
        scores = {}

    fleet_health_score = int(fleet_payload.get("fleet_health_score") or 0)
    global_risk = str(fleet_payload.get("global_risk") or "medium")
    cost_score = int(scores.get("cost_score") or 0)
    fraud_score = int(scores.get("fraud_score") or 0)
    equipment_score = int(scores.get("equipment_score") or 0)
    workflow_score = int(scores.get("workflow_score") or 0)
    roaming_score = int(scores.get("roaming_score") or 0)
    risk_score = int(scores.get("risk_score") or 0)

    priority_alerts = list(getattr(live_snapshot, "priority_alerts", []) or [])
    top_departments = list(getattr(live_snapshot, "top_departments", []) or [])
    top_operators = list(getattr(live_snapshot, "top_operators", []) or [])
    critical_equipments = list(getattr(live_snapshot, "critical_equipments", []) or [])
    critical_workflows = list(getattr(live_snapshot, "critical_workflows", []) or [])

    top_department = top_departments[0] if top_departments else None
    top_department_label = getattr(top_department, "department", None)
    if not top_department_label and summary.risky_departments:
        top_department_label = summary.risky_departments[0].label

    top_operator = top_operators[0] if top_operators else None
    top_operator_label = getattr(top_operator, "operator", None)
    top_operator_cost = float(getattr(top_operator, "live_cost_mad", 0.0) or 0.0)
    top_operator_alerts = int(getattr(top_operator, "suspicious_calls", 0) or 0)
    top_operator_anomaly_score = int(getattr(top_operator, "anomaly_score", 0) or 0)
    if not top_operator_label and summary.expensive_operators:
        top_operator_metric = summary.expensive_operators[0]
        top_operator_label = top_operator_metric.label
        top_operator_cost = top_operator_metric.monthly_cost_mad
        top_operator_alerts = top_operator_metric.alert_count
        top_operator_anomaly_score = round(top_operator_metric.risk_score)

    candidates: list[CopilotActionCandidate] = []

    critical_alert_volume = max(
        summary.critical_alert_count,
        len(priority_alerts),
        sum(1 for alert in priority_alerts if getattr(alert, "severity", None) == "critical"),
    )
    if critical_alert_volume > 0:
        if priority_alerts:
            top_alert = priority_alerts[0]
            owner = getattr(top_alert, "department", None) or getattr(top_alert, "operator", None) or "la flotte"
            reason = f"{len(priority_alerts)} alertes live prioritaires, dont {top_alert.title} sur {owner}."
        else:
            reason = f"{summary.critical_alert_count} alertes critiques sur {summary.alert_count} alertes detectees."
        candidates.append(
            _build_copilot_candidate(
                title="Controler les alertes critiques de la flotte",
                reason=reason,
                impact="Reduire le risque d'escalade et securiser les incidents urgents.",
                priority="critical" if critical_alert_volume >= 4 else "high",
                action_type="consumption",
                signal_strength=critical_alert_volume * 5 + max(0, 100 - risk_score),
            )
        )

    if (
        summary.roaming_alert_count > 0
        or summary.roaming_line_count > 0
        or float(getattr(live_snapshot, "roaming_cost_mad", 0.0) or 0.0) > 0.0
    ):
        if top_department is not None and getattr(top_department, "roaming_pct", None) is not None:
            reason = (
                f"{top_department.department} atteint {top_department.roaming_pct:.1f}% de roaming "
                f"avec {summary.roaming_alert_count} alertes consolidees."
            )
        else:
            reason = (
                f"{summary.roaming_alert_count} alertes roaming et {summary.roaming_line_count} lignes exposees "
                "dans la flotte."
            )
        title = (
            f"Verifier les depassements roaming du departement {top_department_label}"
            if top_department_label
            else "Verifier les depassements roaming de la flotte"
        )
        roaming_priority: Literal["low", "medium", "high", "critical"]
        if roaming_score < 55 or summary.roaming_alert_count >= 5:
            roaming_priority = "critical"
        elif roaming_score < 75 or summary.roaming_line_count > 0:
            roaming_priority = "high"
        else:
            roaming_priority = "medium"
        candidates.append(
            _build_copilot_candidate(
                title=title,
                reason=reason,
                impact="Reduire les surcouts internationaux et limiter les depassements de quota.",
                priority=roaming_priority,
                action_type="consumption",
                signal_strength=(100 - roaming_score) + summary.roaming_alert_count * 8,
            )
        )

    if top_operator_label:
        if top_operator_cost > 0:
            reason = (
                f"{top_operator_label} concentre {_format_mad(top_operator_cost)} avec un risque anomalie "
                f"de {_format_score(top_operator_anomaly_score)} et {top_operator_alerts} signaux a verifier."
            )
        else:
            reason = (
                f"{top_operator_label} ressort comme operateur principal avec {top_operator_alerts} signaux "
                "et une pression budgetaire a confirmer."
            )
        candidates.append(
            _build_copilot_candidate(
                title=f"Auditer les couts et anomalies {top_operator_label}",
                reason=reason,
                impact="Cibler le premier levier de reduction budgetaire sans casser le service.",
                priority="high" if cost_score < 78 or top_operator_alerts >= 4 else "medium",
                action_type="cost",
                signal_strength=(100 - cost_score) + top_operator_alerts * 6,
            )
        )

    if summary.expensive_plans or summary.inactive_lines > 0 or summary.free_lines > 0:
        if summary.expensive_plans:
            top_plan = summary.expensive_plans[0]
            title = f"Reduire les forfaits {top_plan.plan} surdimensionnes"
            reason = (
                f"{top_plan.line_count} lignes sur {top_plan.plan} a {_format_mad(top_plan.average_cost_mad)} "
                f"avec {top_plan.alert_count} alertes."
            )
            signal_strength = top_plan.line_count * 6 + top_plan.alert_count * 8
        else:
            title = "Reaffecter les lignes inactives et forfaits sous-utilises"
            reason = (
                f"{summary.inactive_lines} lignes inactives et {summary.free_lines} lignes libres "
                "restent a arbitrer."
            )
            signal_strength = summary.inactive_lines * 8 + summary.free_lines * 4
        candidates.append(
            _build_copilot_candidate(
                title=title,
                reason=reason,
                impact="Liberer de la capacite et reduire les couts mensuels inutiles.",
                priority=(
                    "high"
                    if summary.inactive_lines + summary.free_lines >= 4 or summary.over_quota_count >= 3
                    else "medium"
                ),
                action_type="cost",
                signal_strength=signal_strength,
            )
        )

    suspicious_calls_live = int(getattr(live_snapshot, "suspicious_calls", 0) or 0)
    fraud_exposure_live = float(getattr(live_snapshot, "fraud_exposure_mad", 0.0) or 0.0)
    if summary.fraud_alert_count > 0 or summary.suspicious_call_count > 0 or suspicious_calls_live > 0:
        if suspicious_calls_live > 0:
            reason = (
                f"{suspicious_calls_live} appels suspects et une exposition fraude de "
                f"{_format_mad(fraud_exposure_live)}."
            )
        else:
            reason = (
                f"{summary.fraud_alert_count} alertes fraude, {summary.suspicious_call_count} appels suspects "
                f"et {_format_mad(summary.suspicious_call_cost_mad)} de cout suspect."
            )
        candidates.append(
            _build_copilot_candidate(
                title="Controler les alertes fraude et appels suspects",
                reason=reason,
                impact="Limiter les pertes et confirmer rapidement les faux positifs.",
                priority=(
                    "critical"
                    if fraud_score < 60 or summary.fraud_alert_count >= 4 or suspicious_calls_live >= 40
                    else "high"
                ),
                action_type="fraud",
                signal_strength=(100 - fraud_score) + max(summary.fraud_alert_count, suspicious_calls_live // 10) * 9,
            )
        )

    equipment_alerts_live = int(getattr(live_snapshot, "equipment_alerts", 0) or 0)
    if equipment_alerts_live > 0 or summary.mobile_critical_count > 0 or equipment_score < 78:
        if critical_equipments:
            top_equipment = critical_equipments[0]
            site_label = getattr(top_equipment, "site", None) or "site prioritaire"
            reason = (
                f"{equipment_alerts_live} alertes equipement; {top_equipment.label} sur {site_label} "
                f"affiche un health score de {_format_score(getattr(top_equipment, 'health_score', 0))}."
            )
        else:
            reason = (
                f"{summary.mobile_critical_count} equipements critiques detectes; le detail d'obsolescence "
                "doit etre confirme dans la vue equipements."
            )
        candidates.append(
            _build_copilot_candidate(
                title="Verifier les equipements critiques du parc",
                reason=reason,
                impact="Eviter les incidents materiels et preparer les remplacements necessaires.",
                priority=(
                    "high"
                    if equipment_score < 70 or equipment_alerts_live >= 3 or summary.mobile_critical_count >= 4
                    else "medium"
                ),
                action_type="equipment",
                signal_strength=(100 - equipment_score) + equipment_alerts_live * 7 + summary.mobile_critical_count * 5,
            )
        )

    workflow_critical_count = int(getattr(live_snapshot, "workflow_critical_count", 0) or 0)
    if workflow_critical_count > 0 or workflow_score < 78:
        if critical_workflows:
            top_workflow = critical_workflows[0]
            reason = (
                f"{workflow_critical_count} workflows critiques; {top_workflow.name} bloque "
                f"{top_workflow.waiting_steps} etapes sur {top_workflow.bottleneck}."
            )
        else:
            reason = (
                f"Le workflow score ressort a {_format_score(workflow_score)}, signe de complexite "
                "operationnelle a reduire."
            )
        candidates.append(
            _build_copilot_candidate(
                title="Debloquer les workflows critiques",
                reason=reason,
                impact="Accelerer le traitement des demandes et reduire les escalades manuelles.",
                priority="high" if workflow_score < 68 or workflow_critical_count >= 2 else "medium",
                action_type="workflow",
                signal_strength=(100 - workflow_score) + workflow_critical_count * 10,
            )
        )

    main_risks = [
        risk
        for risk in fleet_payload.get("main_risks", [])
        if isinstance(risk, str) and risk.strip()
    ]
    if fleet_health_score < 72 or len(candidates) < 5:
        risk_excerpt = ", ".join(main_risks[:2]) if main_risks else "plusieurs signaux restent a corriger"
        candidates.append(
            _build_copilot_candidate(
                title="Traiter les facteurs qui degradent le Fleet Health Score",
                reason=(
                    f"Fleet Health Score a {_format_score(fleet_health_score)} avec un risque "
                    f"{_format_risk_level_label(global_risk)}; points dominants: {risk_excerpt}."
                ),
                impact="Ameliorer la sante globale de la flotte et aligner les priorites DSI.",
                priority="high" if fleet_health_score < 72 else "medium",
                action_type="consumption",
                signal_strength=(100 - fleet_health_score) + len(main_risks) * 4,
            )
        )

    deduped_candidates: list[CopilotActionCandidate] = []
    seen_titles: set[str] = set()
    for candidate in candidates:
        normalized_title = _normalize_question_text(candidate.title)
        if normalized_title in seen_titles:
            continue
        seen_titles.add(normalized_title)
        deduped_candidates.append(candidate)

    return sorted(
        deduped_candidates,
        key=lambda candidate: (candidate.score, _priority_rank(candidate.priority)),
        reverse=True,
    )


def _build_copilot_action_plan_payload(
    summary: DataSummary,
    *,
    live_snapshot=None,
) -> dict[str, object]:
    fleet_payload = build_fleet_health_payload(summary, live_snapshot=live_snapshot)
    candidates = _build_copilot_action_candidates(
        summary,
        fleet_payload=fleet_payload,
        live_snapshot=live_snapshot,
    )

    combined_recommendations: list[str] = []
    for recommendation in [
        *summary.recommendations,
        *[
            value
            for value in fleet_payload.get("recommendations", [])
            if isinstance(value, str) and value.strip()
        ],
    ]:
        cleaned_recommendation = " ".join(recommendation.split())
        if cleaned_recommendation and cleaned_recommendation not in combined_recommendations:
            combined_recommendations.append(cleaned_recommendation)

    if len(candidates) < 5:
        for recommendation in combined_recommendations:
            if len(candidates) >= 5:
                break
            candidates.append(
                _build_copilot_candidate(
                    title=_truncate(recommendation.replace("Verifier ", "").replace("Controler ", ""), 76),
                    reason=f"Action issue des recommandations existantes: {recommendation}",
                    impact="Transformer une recommandation deja identifiee en tache exploitable cette semaine.",
                    priority="medium",
                    action_type=_detect_action_type_from_text(recommendation),
                    signal_strength=25,
                )
            )

    if len(candidates) < 5:
        candidates.append(
            _build_copilot_candidate(
                title="Consolider les donnees critiques de la flotte",
                reason=(
                    "Certaines vues restent agregees; confirmer le detail departement, equipement et roaming "
                    "avant arbitrage final."
                ),
                impact="Fiabiliser le prochain plan d'action et eviter les priorites mal classees.",
                priority="medium",
                action_type="workflow",
                signal_strength=18,
            )
        )

    deduped_candidates: list[CopilotActionCandidate] = []
    seen_titles: set[str] = set()
    for candidate in candidates:
        normalized_title = _normalize_question_text(candidate.title)
        if normalized_title in seen_titles:
            continue
        seen_titles.add(normalized_title)
        deduped_candidates.append(candidate)

    top_actions = [
        _serialize_copilot_action(candidate, index=index)
        for index, candidate in enumerate(deduped_candidates[:5], start=1)
    ]
    top_titles = [str(action["title"]) for action in top_actions[:4]]
    fleet_health_score = int(fleet_payload.get("fleet_health_score") or 0)
    global_risk = str(fleet_payload.get("global_risk") or "medium")
    trend = str(fleet_payload.get("trend") or "stable")

    answer_lines = [
        f"Cette semaine, traitez d'abord {top_titles[0]}."
        if top_titles
        else "Cette semaine, demarrez par les alertes critiques et le roaming."
    ]
    answer_lines.extend(f"- {title}" for title in top_titles[1:4])
    answer_lines.append(
        f"Insight: Fleet Health Score a {_format_score(fleet_health_score)} avec un risque {_format_risk_level_label(global_risk)}."
    )
    answer_lines.append(
        "Recommandation: lancez en premier les actions critiques, puis convertissez les optimisations budgetaires en tickets suivis."
    )

    return {
        "plan_title": "Plan d'action IA hebdomadaire",
        "subtitle": (
            f"{len(top_actions)} actions priorisees a partir des alertes, du Fleet Health Score "
            f"({_format_score(fleet_health_score)}) et des recommandations deja disponibles."
        ),
        "answer": "\n".join(answer_lines[:6]),
        "model": get_settings().ollama_model,
        "sources": [
            *summary.sources,
            *(["live_monitoring"] if live_snapshot is not None else []),
        ],
        "summary_updated_at": summary.updated_at,
        "fleet_health_score": fleet_health_score,
        "global_risk": global_risk,
        "trend": trend,
        "actions": top_actions,
        "weekly_actions": top_actions,
        "recommendations": combined_recommendations[:6],
        "cached": False,
        "fallback_used": False,
        "duration_ms": None,
    }


def _build_copilot_action_plan_prompt(
    plan_payload: dict[str, object],
    *,
    history: list[ChatContextMessage],
    summary: DataSummary,
) -> str:
    facts = {
        "total_lines": summary.total_lines,
        "alert_count": summary.alert_count,
        "critical_alert_count": summary.critical_alert_count,
        "fraud_alert_count": summary.fraud_alert_count,
        "over_quota_count": summary.over_quota_count,
        "inactive_lines": summary.inactive_lines,
        "free_lines": summary.free_lines,
        "roaming_alert_count": summary.roaming_alert_count,
        "roaming_line_count": summary.roaming_line_count,
        "suspicious_call_count": summary.suspicious_call_count,
        "suspicious_call_cost_mad": round(summary.suspicious_call_cost_mad, 2),
        "mobile_critical_count": summary.mobile_critical_count,
        "sources": summary.sources,
        "fleet_health_score": plan_payload.get("fleet_health_score"),
        "global_risk": plan_payload.get("global_risk"),
        "trend": plan_payload.get("trend"),
    }
    return (
        "Tu es un AI Operational Assistant telecom.\n"
        "Tu dois reformuler un plan d'action hebdomadaire en JSON strict, sans inventer aucune donnee.\n"
        "Regles obligatoires:\n"
        "- Utilise uniquement les chiffres, entites et faits presents dans FACTS et BASE_PLAN.\n"
        "- Ne modifie pas le nombre d'actions.\n"
        "- Conserve strictement priority, type, status et deadline de chaque action.\n"
        "- Tu peux seulement ameliorer title, reason, impact et detail avec une formulation plus claire.\n"
        "- Si un detail manque, ecris clairement 'detail a confirmer'.\n"
        "- Reponds uniquement avec un objet JSON valide.\n"
        "- Format attendu: {\"subtitle\":\"...\",\"answer\":\"...\",\"weekly_actions\":[...],\"recommendations\":[...]}\n\n"
        f"HISTORIQUE:\n{_build_history_block(history)}\n\n"
        f"FACTS:\n{json.dumps(facts, ensure_ascii=False)}\n\n"
        f"BASE_PLAN:\n{json.dumps(plan_payload, ensure_ascii=False)}\n"
    )


def _merge_refined_copilot_plan(
    base_payload: dict[str, object],
    refined_payload: dict[str, object] | None,
) -> dict[str, object]:
    if not refined_payload:
        return {
            **base_payload,
            "fallback_used": True,
        }

    merged_payload = {
        **base_payload,
        "subtitle": refined_payload.get("subtitle")
        if isinstance(refined_payload.get("subtitle"), str) and str(refined_payload.get("subtitle")).strip()
        else base_payload["subtitle"],
        "answer": refined_payload.get("answer")
        if isinstance(refined_payload.get("answer"), str) and str(refined_payload.get("answer")).strip()
        else base_payload["answer"],
        "recommendations": [
            value
            for value in refined_payload.get("recommendations", [])
            if isinstance(value, str) and value.strip()
        ][:6]
        or base_payload["recommendations"],
    }

    refined_actions = refined_payload.get("weekly_actions")
    if not isinstance(refined_actions, list):
        refined_actions = refined_payload.get("actions")
    if not isinstance(refined_actions, list):
        refined_actions = []
    base_actions = list(base_payload.get("actions", []))
    merged_actions: list[dict[str, object]] = []

    for index, base_action in enumerate(base_actions):
        next_action = dict(base_action)
        if index < len(refined_actions) and isinstance(refined_actions[index], dict):
            refined_action = refined_actions[index]
            refined_title = refined_action.get("title")
            refined_reason = refined_action.get("reason")
            refined_impact = refined_action.get("impact")
            refined_detail = refined_action.get("detail")
            if isinstance(refined_title, str) and refined_title.strip():
                next_action["title"] = _truncate(refined_title.strip(), 92)
            if isinstance(refined_reason, str) and refined_reason.strip():
                next_action["reason"] = " ".join(refined_reason.split())
            if isinstance(refined_impact, str) and refined_impact.strip():
                next_action["impact"] = " ".join(refined_impact.split())
            if isinstance(refined_detail, str) and refined_detail.strip():
                next_action["detail"] = " ".join(refined_detail.split())
            else:
                next_action["detail"] = _build_action_detail(
                    str(next_action["reason"]),
                    str(next_action["impact"]),
                )
        merged_actions.append(next_action)

    merged_payload["actions"] = merged_actions
    merged_payload["weekly_actions"] = merged_actions
    merged_payload["fallback_used"] = False
    return merged_payload


async def _build_copilot_action_plan(
    summary: DataSummary,
    *,
    history: list[ChatContextMessage] | None = None,
) -> dict[str, object]:
    live_snapshot = _get_live_monitoring_snapshot_if_available()
    base_payload = _build_copilot_action_plan_payload(summary, live_snapshot=live_snapshot)
    prompt = _build_copilot_action_plan_prompt(
        base_payload,
        history=history or [],
        summary=summary,
    )

    try:
        raw_answer = await _generate_with_ollama(prompt)
        refined_payload = _extract_json_object(raw_answer)
    except ChatServiceError as exc:
        CHAT_LOGGER.warning("event=copilot_action_plan_fallback reason=%s", exc.code)
        refined_payload = None
    except Exception:
        CHAT_LOGGER.exception("event=copilot_action_plan_unexpected_fallback")
        refined_payload = None

    return _merge_refined_copilot_plan(base_payload, refined_payload)


def _build_copilot_action_plan_answer(summary: DataSummary) -> str:
    live_snapshot = _get_live_monitoring_snapshot_if_available()
    payload = _build_copilot_action_plan_payload(summary, live_snapshot=live_snapshot)
    actions = payload.get("actions", [])
    if not isinstance(actions, list) or not actions:
        return DEFAULT_UNAVAILABLE_MESSAGE

    formatted_actions = [
        str(action.get("title"))
        for action in actions[:4]
        if isinstance(action, dict) and action.get("title")
    ]
    return _build_structured_answer(
        "Plan d'action IA",
        formatted_actions,
        (
            f"Le Fleet Health Score est a {_format_score(int(payload.get('fleet_health_score') or 0))} "
            f"avec un risque {_format_risk_level_label(str(payload.get('global_risk') or 'medium'))}."
        ),
        (
            str(formatted_actions[0])
            if formatted_actions
            else "Commencer par les alertes critiques et les depassements roaming."
        ),
    )


async def generate_copilot_action_plan(
    db: Session,
    *,
    history: list[ChatContextMessage] | None = None,
) -> dict[str, object]:
    summary = get_data_summary(db)
    return await _build_copilot_action_plan(summary, history=history)


def _get_cached_csv_context() -> CsvContextSummary:
    global _CSV_CONTEXT_CACHE, _CSV_CONTEXT_SIGNATURE

    fleet_results_file = _resolve_fleet_results_file()
    mobile_fleet_file = _resolve_mobile_fleet_file()
    fraud_results_file = _resolve_fraud_results_file()
    source_files = [fleet_results_file, mobile_fleet_file, fraud_results_file]
    signature = tuple(
        _build_file_signature(path, allow_missing=_is_optional_data_source(path))
        for path in source_files
    )
    if _CSV_CONTEXT_CACHE is not None and signature == _CSV_CONTEXT_SIGNATURE:
        return _CSV_CONTEXT_CACHE

    fleet_rows = _read_csv_rows(fleet_results_file)
    mobile_rows = _read_csv_rows(mobile_fleet_file, allow_missing=True)
    fraud_rows = _read_csv_rows(fraud_results_file, allow_missing=True)
    existing_source_files = [path for path in source_files if path.exists()]

    fleet_section, fleet_recommendations = _summarize_fleet_rows(fleet_rows)
    mobile_section, mobile_recommendations = _summarize_mobile_rows(mobile_rows)
    fraud_section = _summarize_fraud_rows(fraud_rows)
    combined_recommendations = fleet_recommendations + mobile_recommendations
    recommendations_section = _summarize_recommendations(combined_recommendations)
    updated_at = (
        max(
            datetime.fromtimestamp(path.stat().st_mtime, tz=UTC)
            for path in existing_source_files
        ).isoformat()
        if existing_source_files
        else _utcnow().isoformat()
    )

    context = CsvContextSummary(
        prompt_context="\n\n".join(
            [fleet_section, mobile_section, fraud_section, recommendations_section]
        ),
        sources=[path.name for path in existing_source_files],
        updated_at=updated_at,
    )
    _CSV_CONTEXT_CACHE = context
    _CSV_CONTEXT_SIGNATURE = signature
    return context


def _build_history_block(history: list[ChatContextMessage]) -> str:
    if not history:
        return "Aucun contexte precedent utile."

    formatted_messages: list[str] = []
    for message in history[-4:]:
        role_label = "Utilisateur" if message.role == "user" else "Assistant"
        formatted_messages.append(f"{role_label}: {_truncate(message.text, 180)}")

    return "\n".join(formatted_messages)


def _get_reasoning_result(
    db: Session,
    *,
    question: str,
    history: list[ChatContextMessage],
    summary: DataSummary,
) -> BusinessReasoningResult | None:
    try:
        reasoning_result = build_business_reasoning_result(
            db,
            question=question,
            history=history,
            summary=summary,
        )
    except Exception as exc:
        CHAT_LOGGER.exception("event=chat_reasoning_failed error=%s", str(exc))
        return None

    _log_chat_event(
        logging.INFO,
        "INTENT_DETECTED",
        question=_truncate(question, 140),
        intent=reasoning_result.intent_category,
        match_mode=reasoning_result.intent_match_mode,
        primary_domain=reasoning_result.primary_domain,
        request_type=reasoning_result.request_type,
    )
    _log_chat_event(
        logging.INFO,
        "INTENT_CONFIDENCE",
        question=_truncate(question, 140),
        intent=reasoning_result.intent_category,
        confidence=reasoning_result.intent_confidence,
    )
    _log_chat_event(
        logging.INFO,
        "INTENT_HANDLER",
        question=_truncate(question, 140),
        intent=reasoning_result.intent_category,
        handler=reasoning_result.intent_handler,
    )
    _log_chat_event(
        logging.INFO,
        "FALLBACK_USED",
        question=_truncate(question, 140),
        intent=reasoning_result.intent_category,
        fallback_used=reasoning_result.intent_fallback_used,
    )
    _log_chat_event(
        logging.INFO,
        "CHAT_REASONING_READY",
        question=_truncate(question, 140),
        primary_domain=reasoning_result.primary_domain,
        request_type=reasoning_result.request_type,
        strategy_key=reasoning_result.strategy_key,
        response_shape=reasoning_result.response_shape,
        confidence=reasoning_result.confidence,
        intent_category=reasoning_result.intent_category,
        intent_handler=reasoning_result.intent_handler,
        intent_confidence=reasoning_result.intent_confidence,
        intent_match_mode=reasoning_result.intent_match_mode,
        intent_fallback_used=reasoning_result.intent_fallback_used,
        analysis_strategy=reasoning_result.analysis_strategy,
        business_goal=reasoning_result.business_goal,
        detail_level=reasoning_result.detail_level,
        context_scope=reasoning_result.context_scope,
        secondary_domains=reasoning_result.secondary_domains,
        secondary_request_types=reasoning_result.secondary_request_types,
        validation_passed=reasoning_result.validation_passed,
        needs_inference=reasoning_result.needs_inference,
        entities=reasoning_result.entities,
        selected_sources=reasoning_result.selected_sources,
        applied_criteria=reasoning_result.applied_criteria,
        data_gaps=reasoning_result.data_gaps,
    )
    return reasoning_result


def _answer_from_reasoning(
    db: Session,
    *,
    question: str,
    history: list[ChatContextMessage],
    summary: DataSummary,
    reasoning_result: BusinessReasoningResult | None = None,
) -> str | None:
    resolved_reasoning = reasoning_result or _get_reasoning_result(
        db,
        question=question,
        history=history,
        summary=summary,
    )
    if resolved_reasoning is None:
        return _answer_from_data_summary(question, summary)
    if resolved_reasoning.validation_passed and resolved_reasoning.answer.strip():
        return resolved_reasoning.answer
    return _answer_from_data_summary(question, summary)


def _build_prompt(
    question: str,
    history: list[ChatContextMessage],
    summary: DataSummary,
    *,
    reasoning_result: BusinessReasoningResult | None = None,
) -> str:
    reasoning_answer = (
        reasoning_result.answer.strip()
        if reasoning_result is not None and reasoning_result.answer.strip()
        else _build_partial_data_answer(question, summary)
    )
    detected_domain = reasoning_result.primary_domain if reasoning_result is not None else "general"
    detected_request_type = reasoning_result.request_type if reasoning_result is not None else "summary"
    detected_strategy = reasoning_result.strategy_key if reasoning_result is not None else "general:summary"
    detected_shape = reasoning_result.response_shape if reasoning_result is not None else "summary"
    detected_intent = reasoning_result.intent_category if reasoning_result is not None else "generic_summary"
    detected_handler = reasoning_result.intent_handler if reasoning_result is not None else "handle_generic_summary_intent"
    detected_analysis_strategy = reasoning_result.analysis_strategy if reasoning_result is not None else "executive_summary"
    detected_business_goal = (
        reasoning_result.business_goal
        if reasoning_result is not None and reasoning_result.business_goal
        else "donner une reponse exploitable avec les donnees disponibles"
    )
    detected_detail_level = reasoning_result.detail_level if reasoning_result is not None else "standard"
    detected_context_scope = (
        reasoning_result.context_scope
        if reasoning_result is not None and reasoning_result.context_scope
        else "Vue globale de la flotte"
    )
    selected_sources = (
        reasoning_result.selected_sources
        if reasoning_result is not None and reasoning_result.selected_sources
        else summary.sources
    )
    detected_entities = (
        ", ".join(reasoning_result.entities[:3])
        if reasoning_result is not None and reasoning_result.entities
        else "Aucune entite cible"
    )
    applied_criteria = (
        "; ".join(reasoning_result.applied_criteria[:4])
        if reasoning_result is not None and reasoning_result.applied_criteria
        else "Couts, alertes, usages et perimetres visibles"
    )
    data_gaps = (
        "; ".join(reasoning_result.data_gaps[:2])
        if reasoning_result is not None and reasoning_result.data_gaps
        else "Aucune limite critique supplementaire detectee"
    )
    return (
        "Tu es un copilote IA specialise en gestion de flotte telecom.\n"
        "Le raisonnement metier est deja calcule et valide avant toi.\n"
        "Regles obligatoires:\n"
        "- Tu reformules uniquement l'analyse calculee ci-dessous.\n"
        "- N'invente aucun chiffre, aucune entite ni aucune recommandation supplementaire.\n"
        "- Ne change jamais les montants, volumes, scores ou comparaisons deja calcules.\n"
        "- Tu peux rendre le texte plus fluide, plus clair et plus professionnel, sans changer le fond.\n"
        "- Si l'analyse indique une inference, conserve cette nuance et ne la transforme pas en certitude.\n"
        "- Reponds en francais, de facon structuree, chiffre et orientee decision.\n"
        "- Preserve les sections presentes, en particulier Resume executif, Analyse et justification, Actions recommandees et Indice de confiance.\n"
        "- N'aplatis pas la structure en une reponse courte generique.\n\n"
        "Cadre de raisonnement detecte:\n"
        f"- Domaine metier: {detected_domain}\n"
        f"- Type de demande: {detected_request_type}\n"
        f"- Intention metier: {detected_intent}\n"
        f"- Handler metier: {detected_handler}\n"
        f"- Strategie d'analyse: {detected_analysis_strategy}\n"
        f"- Objectif decisionnel: {detected_business_goal}\n"
        f"- Niveau de detail: {detected_detail_level}\n"
        f"- Contexte cible: {detected_context_scope}\n"
        f"- Strategie metier: {detected_strategy}\n"
        f"- Structure attendue: {detected_shape}\n"
        f"- Entites cibles: {detected_entities}\n"
        f"- Sources prioritaires: {', '.join(selected_sources)}\n"
        f"- Criteres appliques: {applied_criteria}\n"
        f"- Limites de donnees: {data_gaps}\n\n"
        "Synthese des donnees:\n"
        f"{summary.prompt_context}\n\n"
        "Historique recent:\n"
        f"{_build_history_block(history)}\n\n"
        "Question utilisateur:\n"
        f"{question.strip()}\n\n"
        "Analyse metier calculee et validee:\n"
        f"{reasoning_answer}\n\n"
        "Ta reponse finale doit reprendre cette analyse sans en changer le contenu:"
    )


def _derive_title_hint(question: str) -> str | None:
    normalized_question = " ".join(question.split()).strip()
    if not normalized_question:
        return None

    if len(normalized_question) <= 68:
        return normalized_question
    return f"{normalized_question[:68].rstrip()}..."


def _match_metric_from_question(
    question: str,
    metrics: list[SummaryMetric],
) -> SummaryMetric | None:
    normalized_question = _normalize_question_text(question)

    for metric in metrics:
        normalized_label = _normalize_question_text(metric.label)
        if normalized_label and normalized_label in normalized_question:
            return metric

    return None


def _match_critical_line_from_question(
    question: str,
    critical_lines: list[SummaryCriticalLine],
) -> SummaryCriticalLine | None:
    normalized_question = _normalize_question_text(question)

    for critical_line in critical_lines:
        normalized_label = _normalize_question_text(critical_line.label)
        if normalized_label and normalized_label in normalized_question:
            return critical_line

    return None


def _answer_from_data_summary(question: str, summary: DataSummary) -> str | None:
    normalized_question = _normalize_question_text(question)

    if any(
        keyword in normalized_question
        for keyword in [
            "fleet health score",
            "score global",
            "etat global de ma flotte",
            "etat global de la flotte",
            "sante globale de la flotte",
            "sante de la flotte",
        ]
    ) and not any(
        keyword in normalized_question
        for keyword in ["comment", "ameliorer", "pourquoi", "departement"]
    ):
        try:
            from app.services.live_monitoring_service import get_live_monitoring_snapshot_if_ready

            live_snapshot = get_live_monitoring_snapshot_if_ready()
        except Exception:
            live_snapshot = None
        return build_fleet_health_answer(summary, live_snapshot=live_snapshot)

    if any(
        keyword in normalized_question
        for keyword in [
            "niveau de risque actuel",
            "risque global actuel",
            "risque actuel de la flotte",
        ]
    ):
        try:
            from app.services.live_monitoring_service import get_live_monitoring_snapshot_if_ready

            live_snapshot = get_live_monitoring_snapshot_if_ready()
        except Exception:
            live_snapshot = None
        return build_fleet_health_answer(summary, live_snapshot=live_snapshot)

    if "pourquoi" in normalized_question and "score" in normalized_question:
        try:
            from app.services.live_monitoring_service import get_live_monitoring_snapshot_if_ready

            live_snapshot = get_live_monitoring_snapshot_if_ready()
        except Exception:
            live_snapshot = None
        return build_fleet_health_why_score_answer(summary, live_snapshot=live_snapshot)

    if (
        "departement" in normalized_question
        and "score" in normalized_question
        and any(
            keyword in normalized_question
            for keyword in ["impacte", "penalise", "influence", "degrade"]
        )
    ):
        try:
            from app.services.live_monitoring_service import get_live_monitoring_snapshot_if_ready

            live_snapshot = get_live_monitoring_snapshot_if_ready()
        except Exception:
            live_snapshot = None
        return build_fleet_health_department_answer(summary, live_snapshot=live_snapshot)

    if any(
        keyword in normalized_question
        for keyword in [
            "comment ameliorer le fleet health score",
            "comment ameliorer le score",
            "ameliorer le fleet health score",
        ]
    ):
        try:
            from app.services.live_monitoring_service import get_live_monitoring_snapshot_if_ready

            live_snapshot = get_live_monitoring_snapshot_if_ready()
        except Exception:
            live_snapshot = None
        return build_fleet_health_improvement_answer(summary, live_snapshot=live_snapshot)

    if any(
        keyword in normalized_question
        for keyword in [
            "que dois je faire cette semaine",
            "que faire cette semaine",
            "quelles sont mes priorites",
            "quelles actions dois je traiter en premier",
            "plan d action recommande",
            "plan d'action recommande",
            "plan d action ia",
            "priorites de la semaine",
        ]
    ):
        return _build_copilot_action_plan_answer(summary)

    if "ligne" in normalized_question and "libre" in normalized_question:
        return _build_structured_answer(
            "Lignes libres",
            [
                (
                    f"{summary.free_lines} lignes libres sur {summary.total_lines} "
                    f"({_format_ratio(summary.free_lines, summary.total_lines)})"
                ),
            ],
            "Le stock disponible est limite si le taux libre est bas.",
            "Reaffecter ou reactiver en priorite les lignes inactives avant nouvel achat.",
        )

    if "ligne" in normalized_question and "active" in normalized_question:
        return _build_structured_answer(
            "Etat des lignes",
            [
                f"{summary.active_lines} lignes actives",
                f"{summary.suspended_lines} suspendues et {summary.inactive_lines} inactives",
            ],
            "Les lignes non actives representent une capacite ou un cout a reevaluer.",
            "Traiter d'abord les lignes suspendues a forte valeur puis nettoyer les inactives.",
        )

    if "ligne" in normalized_question and "attribu" in normalized_question:
        return _build_structured_answer(
            "Attribution des lignes",
            [
                (
                    f"{summary.assigned_lines} lignes attribuees sur {summary.total_lines} "
                    f"({_format_ratio(summary.assigned_lines, summary.total_lines)})"
                ),
            ],
            "Un taux d'attribution eleve reduit la marge pour absorber de nouveaux besoins.",
            "Suivre les lignes peu utilisees pour recuperer de la capacite sans depense supplementaire.",
        )

    if any(
        keyword in normalized_question
        for keyword in ["cout total", "cout global", "budget total", "depense totale"]
    ):
        gap_value = max(summary.projected_monthly_cost_mad - summary.total_monthly_cost_mad, 0.0)
        return _build_structured_answer(
            "Budget flotte",
            [
                f"Cout mensuel estime: {_format_mad(summary.total_monthly_cost_mad)}",
                f"Projection: {_format_mad(summary.projected_monthly_cost_mad)}",
                f"Ecart projete: {_format_mad(gap_value)}",
            ],
            "La projection mesure la pression budgetaire a court terme.",
            "Prioriser les lignes en alerte et les forfaits les plus chers pour contenir l'ecart.",
        )

    if "departement" in normalized_question and any(
        keyword in normalized_question for keyword in ["consomme le plus", "plus couteux", "plus de cout", "leader"]
    ):
        top_department = summary.risky_departments[0] if summary.risky_departments else None
        if top_department is None:
            return DEFAULT_UNAVAILABLE_MESSAGE

        return _build_structured_answer(
            "Departement prioritaire",
            [
                f"{top_department.label} porte {_format_mad(top_department.monthly_cost_mad)}",
                f"Risque moyen {_format_score(top_department.risk_score)}",
                f"{top_department.alert_count} alertes associees",
            ],
            "Le departement leader concentre le meilleur levier de reduction rapide.",
            f"Cibler {top_department.label} en premier pour arbitrer usages et forfaits.",
        )

    if "operateur" in normalized_question and any(
        keyword in normalized_question for keyword in ["plus couteux", "depasse", "plus cher", "budget"]
    ):
        top_operator = summary.expensive_operators[0] if summary.expensive_operators else None
        if top_operator is None:
            return DEFAULT_UNAVAILABLE_MESSAGE

        return _build_structured_answer(
            "Operateur le plus couteux",
            [
                f"{top_operator.label}: {_format_mad(top_operator.monthly_cost_mad)}",
                f"Risque moyen {_format_score(top_operator.risk_score)}",
                f"{top_operator.alert_count} alertes prioritaires",
            ],
            "Le poids budgetaire et le volume d'alertes convergent sur le meme operateur.",
            f"Negocier ou resegmenter en priorite les lignes {top_operator.label}.",
        )

    if "pourquoi" in normalized_question and "budget" in normalized_question:
        operator_metric = _match_metric_from_question(question, summary.expensive_operators)
        top_operator = operator_metric or (summary.expensive_operators[0] if summary.expensive_operators else None)
        if top_operator is None:
            return DEFAULT_UNAVAILABLE_MESSAGE

        return _build_structured_answer(
            "Cause de depassement",
            [
                f"{top_operator.label} concentre {_format_mad(top_operator.monthly_cost_mad)}",
                f"Risque moyen {_format_score(top_operator.risk_score)}",
                f"{top_operator.alert_count} alertes detectees",
            ],
            "Le depassement vient d'un cumul cout plus risque plus alertes.",
            f"Auditer d'abord les lignes {top_operator.label} avec consommation ou cout anormal.",
        )

    if any(
        keyword in normalized_question
        for keyword in ["alerte", "alertes", "anomalie", "anomalies", "fraude", "suspect"]
    ):
        return _build_alerts_explanation_answer(summary)

    if "forfait" in normalized_question and any(
        keyword in normalized_question for keyword in ["trop cher", "plus cher", "chers", "couteux"]
    ):
        if not summary.expensive_plans:
            return DEFAULT_UNAVAILABLE_MESSAGE

        return _build_structured_answer(
            "Forfaits les plus chers",
            [_format_plan_line(plan) for plan in summary.expensive_plans[:3]],
            "Les forfaits premium sont le premier gisement d'optimisation quand les alertes persistent.",
            "Verifier l'adaptation usage/quota avant tout changement de plan.",
        )

    if "ligne" in normalized_question and any(
        keyword in normalized_question
        for keyword in ["critique", "prioritaire", "a surveiller", "premier", "premiere", "traiter"]
    ):
        if not summary.critical_lines:
            return DEFAULT_UNAVAILABLE_MESSAGE

        direct_line = _match_critical_line_from_question(question, summary.critical_lines)
        if direct_line is not None:
            return _build_structured_answer(
                "Ligne critique",
                [
                    f"{direct_line.label} - score {_format_score(direct_line.risk_score)}",
                    f"Usage {direct_line.usage_label}",
                    f"Cout {_format_mad(direct_line.monthly_cost_mad)}",
                ],
                "Cette ligne combine risque d'usage et impact budgetaire.",
                "Controler l'usage puis ajuster le forfait si le depassement se repete.",
            )

        if any(
            keyword in normalized_question
            for keyword in ["premier", "premiere", "traiter", "prioritaire"]
        ):
            top_line = summary.critical_lines[0]
            return _build_structured_answer(
                "Ligne a traiter en premier",
                [
                    f"{top_line.label} - score {_format_score(top_line.risk_score)}",
                    f"Usage {top_line.usage_label}",
                    f"Cout {_format_mad(top_line.monthly_cost_mad)}",
                ],
                "C'est la ligne avec le couple risque/cout le plus sensible.",
                "Declencher un controle rapide et revoir le forfait si la tendance persiste.",
            )

        return _build_structured_answer(
            "Lignes critiques prioritaires",
            [_format_critical_line(critical_line) for critical_line in summary.critical_lines[:3]],
            "Les lignes critiques concentrent le risque immediate de depassement ou de rupture de service.",
            "Traiter d'abord les trois premieres lignes avant une action globale sur les forfaits.",
        )

    if any(
        keyword in normalized_question
        for keyword in ["recommandation", "optimisation", "meilleure action", "amelioration"]
    ):
        if not summary.recommendations:
            return DEFAULT_UNAVAILABLE_MESSAGE

        return _build_structured_answer(
            "Actions prioritaires",
            summary.recommendations[:3],
            "Les recommandations les plus frequentes refletent les leviers les plus actionnables.",
            summary.recommendations[0],
        )

    return None


def _build_timeout_fallback_answer(
    question: str,
    summary: DataSummary,
    *,
    db: Session | None = None,
    history: list[ChatContextMessage] | None = None,
    reasoning_result: BusinessReasoningResult | None = None,
) -> str:
    if db is not None:
        reasoned_answer = _answer_from_reasoning(
            db,
            question=question,
            history=history or [],
            summary=summary,
            reasoning_result=reasoning_result,
        )
        if reasoned_answer is not None and not _is_unavailable_only_answer(reasoned_answer):
            return reasoned_answer

    quick_answer = _answer_from_data_summary(question, summary)
    if quick_answer is not None and not _is_unavailable_only_answer(quick_answer):
        return quick_answer

    return _build_partial_data_answer(question, summary)


def _is_unavailable_only_answer(answer: str) -> bool:
    normalized_answer = _normalize_question_text(answer)
    normalized_default = _normalize_question_text(DEFAULT_UNAVAILABLE_MESSAGE)
    if normalized_answer == normalized_default:
        return True

    return (
        "information" in normalized_answer
        and "pas disponible" in normalized_answer
        and len(normalized_answer.split()) <= 16
    )


def _finalize_answer(
    question: str,
    answer: str,
    summary: DataSummary,
    *,
    db: Session | None = None,
    history: list[ChatContextMessage] | None = None,
    reasoning_result: BusinessReasoningResult | None = None,
) -> str:
    cleaned_answer = answer.strip()
    if not cleaned_answer:
        return _build_timeout_fallback_answer(
            question,
            summary,
            db=db,
            history=history,
            reasoning_result=reasoning_result,
        )

    if _is_unavailable_only_answer(cleaned_answer):
        if db is not None:
            reasoned_answer = _answer_from_reasoning(
                db,
                question=question,
                history=history or [],
                summary=summary,
                reasoning_result=reasoning_result,
            )
            if reasoned_answer is not None and not _is_unavailable_only_answer(reasoned_answer):
                return reasoned_answer

        quick_answer = _answer_from_data_summary(question, summary)
        if quick_answer is not None and not _is_unavailable_only_answer(quick_answer):
            return quick_answer

        return _build_partial_data_answer(question, summary)

    return cleaned_answer


def _build_response(
    *,
    question: str,
    answer: str,
    summary: DataSummary,
    cached: bool = False,
    fallback_used: bool = False,
    duration_ms: int | None = None,
    db: Session | None = None,
    history: list[ChatContextMessage] | None = None,
    reasoning_result: BusinessReasoningResult | None = None,
) -> ChatResponse:
    final_answer = _finalize_answer(
        question,
        answer,
        summary,
        db=db,
        history=history,
        reasoning_result=reasoning_result,
    )
    sources = list(summary.sources)
    if cached:
        sources.append("cache_reponse")
    if fallback_used:
        sources.append("fallback_rapide")

    return ChatResponse(
        answer=final_answer,
        model=get_settings().ollama_model,
        title_hint=_derive_title_hint(question),
        sources=sources,
        summary_updated_at=summary.updated_at,
        cached=cached,
        fallback_used=fallback_used,
        duration_ms=duration_ms,
    )


def _build_timeout_fallback_response(
    *,
    question: str,
    summary: DataSummary,
    started_at: datetime,
    db: Session | None = None,
    history: list[ChatContextMessage] | None = None,
    reasoning_result: BusinessReasoningResult | None = None,
) -> ChatResponse:
    return _build_response(
        question=question,
        answer=_build_timeout_fallback_answer(
            question,
            summary,
            db=db,
            history=history,
            reasoning_result=reasoning_result,
        ),
        summary=summary,
        fallback_used=True,
        duration_ms=_elapsed_ms(started_at),
        db=db,
        history=history,
        reasoning_result=reasoning_result,
    )


def _build_ollama_timeout(timeout_seconds: float | None = None) -> httpx.Timeout:
    settings = get_settings()
    resolved_timeout = timeout_seconds or settings.ollama_timeout_seconds
    return httpx.Timeout(
        timeout=resolved_timeout,
        connect=3.0,
        write=5.0,
        read=resolved_timeout,
    )


def _build_ollama_payload(prompt: str, *, stream: bool) -> dict[str, object]:
    settings = get_settings()
    return {
        "model": settings.ollama_model,
        "prompt": prompt,
        "stream": stream,
        "options": {
            "temperature": 0.3,
            "top_p": 0.35,
            "num_predict": 200,
        },
    }


def _handle_ollama_error_payload(response_payload: dict[str, object], status_code: int) -> None:
    error_detail = str(response_payload.get("error") or "").strip()
    if status_code == 404 or "model" in error_detail.lower():
        raise LocalModelUnavailableError(
            "Le modèle IA local n’est pas lancé. Lancez Ollama puis réessayez.",
            log_message=(
                "Le modele IA local llama3.2:3b n'est pas disponible. "
                "Executez `ollama pull llama3.2:3b` puis reessayez."
            ),
        )
    raise LocalModelUnavailableError(
        "Le modèle IA local n’est pas lancé. Lancez Ollama puis réessayez.",
        log_message=error_detail or "Le modele IA local n'est pas lance. Lancez Ollama.",
    )


async def _generate_with_ollama(prompt: str, *, timeout_seconds: float | None = None) -> str:
    settings = get_settings()
    request_url = f"{settings.ollama_base_url.rstrip('/')}/api/generate"
    started_at = _utcnow()
    _log_chat_event(
        logging.INFO,
        "OLLAMA_REQUEST_STARTED",
        stream=False,
        model=settings.ollama_model,
        request_url=request_url,
        prompt_chars=len(prompt),
        timeout_seconds=timeout_seconds or settings.ollama_timeout_seconds,
    )

    try:
        async with httpx.AsyncClient(timeout=_build_ollama_timeout(timeout_seconds)) as client:
            response = await client.post(
                request_url,
                json=_build_ollama_payload(prompt, stream=False),
            )
    except httpx.TimeoutException as exc:
        raise ChatTimeoutError() from exc
    except httpx.RequestError as exc:
        raise LocalModelUnavailableError(
            "Le modèle IA local n’est pas lancé. Lancez Ollama puis réessayez.",
            log_message="Le modele IA local n'est pas lance. Lancez Ollama.",
        ) from exc

    try:
        response_payload = response.json()
    except ValueError as exc:
        raise ChatServerError(
            "Une erreur est survenue côté serveur."
        ) from exc

    if response.status_code >= 400:
        _handle_ollama_error_payload(response_payload, response.status_code)

    answer = str(response_payload.get("response") or "").strip()
    if not answer:
        raise ChatServerError(
            "Une erreur est survenue côté serveur."
        )

    _log_chat_event(
        logging.INFO,
        "OLLAMA_RESPONSE_RECEIVED",
        stream=False,
        model=settings.ollama_model,
        status_code=response.status_code,
        duration_ms=_elapsed_ms(started_at),
        answer_chars=len(answer),
    )
    return answer


async def _stream_with_ollama(prompt: str) -> AsyncIterator[str]:
    settings = get_settings()
    request_url = f"{settings.ollama_base_url.rstrip('/')}/api/generate"
    started_at = _utcnow()
    _log_chat_event(
        logging.INFO,
        "OLLAMA_REQUEST_STARTED",
        stream=True,
        model=settings.ollama_model,
        request_url=request_url,
        prompt_chars=len(prompt),
        timeout_seconds=settings.ollama_timeout_seconds,
    )

    try:
        async with httpx.AsyncClient(timeout=_build_ollama_timeout()) as client:
            async with client.stream(
                "POST",
                request_url,
                json=_build_ollama_payload(prompt, stream=True),
            ) as response:
                if response.status_code >= 400:
                    raw_body = await response.aread()
                    try:
                        response_payload = json.loads(raw_body.decode("utf-8"))
                    except (UnicodeDecodeError, json.JSONDecodeError):
                        response_payload = {"error": raw_body.decode("utf-8", errors="ignore")}
                    _handle_ollama_error_payload(response_payload, response.status_code)

                _log_chat_event(
                    logging.INFO,
                    "OLLAMA_RESPONSE_RECEIVED",
                    stream=True,
                    model=settings.ollama_model,
                    status_code=response.status_code,
                    duration_ms=_elapsed_ms(started_at),
                )

                async for raw_line in response.aiter_lines():
                    if not raw_line:
                        continue

                    try:
                        payload = json.loads(raw_line)
                    except json.JSONDecodeError:
                        continue

                    chunk = str(payload.get("response") or "")
                    if chunk:
                        yield chunk

                    if payload.get("done") is True:
                        break
    except httpx.TimeoutException as exc:
        raise ChatTimeoutError() from exc
    except httpx.RequestError as exc:
        raise LocalModelUnavailableError(
            "Le modèle IA local n’est pas lancé. Lancez Ollama puis réessayez.",
            log_message="Le modele IA local n'est pas lance. Lancez Ollama.",
        ) from exc


def _to_sse_event(event_name: str, payload: dict[str, object]) -> str:
    return f"event: {event_name}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _stream_text_chunks(text: str) -> list[str]:
    return re.findall(r"\S+\s*", text)


async def stream_chat_response(
    request: Request,
    db: Session,
    *,
    question: str,
    history: list[ChatContextMessage],
) -> AsyncIterator[str]:
    started_at = _utcnow()
    question_preview = _truncate(question, 140)
    summary: DataSummary | None = None
    reasoning_result: BusinessReasoningResult | None = None

    _log_chat_event(
        logging.INFO,
        "CHAT_REQUEST_RECEIVED",
        mode="stream",
        question=question_preview,
        history_size=len(history),
    )
    _log_chat_event(
        logging.INFO,
        "chat_question_sent",
        mode="stream",
        question=question_preview,
        history_size=len(history),
    )

    try:
        await _ensure_request_connected(request)

        summary = get_data_summary(db)
        cache_key = _build_cache_key(question, history, summary)

        yield _to_sse_event(
            "meta",
            {
                "model": get_settings().ollama_model,
                "summary_updated_at": summary.updated_at,
                "sources": summary.sources,
            },
        )

        cached_response = _get_cached_answer(cache_key)
        if cached_response is not None:
            completed_response = cached_response.model_copy(
                update={
                    "duration_ms": _elapsed_ms(started_at),
                    "cached": True,
                }
            )
            for chunk in _stream_text_chunks(completed_response.answer):
                await _ensure_request_connected(request)
                yield _to_sse_event("token", {"text": chunk})
                await asyncio.sleep(0.008)

            _log_chat_event(
                logging.INFO,
                "chat_response_completed",
                mode="stream",
                cached=True,
                duration_ms=completed_response.duration_ms,
                question=question_preview,
            )
            _log_chat_event(
                logging.INFO,
                "CHAT_DURATION_MS",
                mode="stream",
                duration_ms=completed_response.duration_ms,
                fallback_used=False,
                question=question_preview,
            )
            yield _to_sse_event("done", completed_response.model_dump(mode="json"))
            return

        reasoning_result = _get_reasoning_result(
            db,
            question=question,
            history=history,
            summary=summary,
        )
        quick_answer = _answer_from_reasoning(
            db,
            question=question,
            history=history,
            summary=summary,
            reasoning_result=reasoning_result,
        )
        if quick_answer is not None:
            completed_response = _build_response(
                question=question,
                answer=quick_answer,
                summary=summary,
                duration_ms=_elapsed_ms(started_at),
                db=db,
                history=history,
                reasoning_result=reasoning_result,
            )
            _store_cached_answer(cache_key, completed_response)
            for chunk in _stream_text_chunks(completed_response.answer):
                await _ensure_request_connected(request)
                yield _to_sse_event("token", {"text": chunk})
                await asyncio.sleep(0.01)

            _log_chat_event(
                logging.INFO,
                "chat_response_completed",
                mode="stream",
                cached=False,
                quick_answer=True,
                duration_ms=completed_response.duration_ms,
                question=question_preview,
            )
            _log_chat_event(
                logging.INFO,
                "CHAT_DURATION_MS",
                mode="stream",
                duration_ms=completed_response.duration_ms,
                fallback_used=False,
                question=question_preview,
            )
            yield _to_sse_event("done", completed_response.model_dump(mode="json"))
            return

        prompt = _build_prompt(
            question,
            history,
            summary,
            reasoning_result=reasoning_result,
        )
        chunks: list[str] = []

        async for chunk in _stream_with_ollama(prompt):
            await _ensure_request_connected(request)
            chunks.append(chunk)
            yield _to_sse_event("token", {"text": chunk})

        completed_response = _build_response(
            question=question,
            answer="".join(chunks),
            summary=summary,
            duration_ms=_elapsed_ms(started_at),
            db=db,
            history=history,
            reasoning_result=reasoning_result,
        )
        _store_cached_answer(cache_key, completed_response)
        _log_chat_event(
            logging.INFO,
            "chat_response_completed",
            mode="stream",
            cached=False,
            quick_answer=False,
            duration_ms=completed_response.duration_ms,
            question=question_preview,
        )
        _log_chat_event(
            logging.INFO,
            "CHAT_DURATION_MS",
            mode="stream",
            duration_ms=completed_response.duration_ms,
            fallback_used=False,
            question=question_preview,
        )
        yield _to_sse_event("done", completed_response.model_dump(mode="json"))
    except RequestCancelledError as exc:
        _log_chat_event(
            logging.INFO,
            "chat_request_cancelled",
            mode="stream",
            duration_ms=_elapsed_ms(started_at),
            question=question_preview,
            code=exc.code,
        )
        return
    except ChatTimeoutError as exc:
        if summary is None:
            raise
        fallback_response = _build_timeout_fallback_response(
            question=question,
            summary=summary,
            started_at=started_at,
            db=db,
            history=history,
            reasoning_result=reasoning_result,
        )
        _log_chat_event(
            logging.WARNING,
            "CHAT_TIMEOUT",
            mode="stream",
            duration_ms=fallback_response.duration_ms,
            question=question_preview,
            code=exc.code,
            fallback_used=True,
        )
        _log_chat_event(
            logging.INFO,
            "CHAT_DURATION_MS",
            mode="stream",
            duration_ms=fallback_response.duration_ms,
            fallback_used=True,
            question=question_preview,
        )
        yield _to_sse_event("done", fallback_response.model_dump(mode="json"))
        return
    except ChatServiceError as exc:
        _log_chat_event(
            logging.WARNING,
            "CHAT_EXCEPTION",
            mode="stream",
            duration_ms=_elapsed_ms(started_at),
            question=question_preview,
            code=exc.code,
            message=exc.log_message,
        )
        _log_chat_event(
            logging.WARNING,
            "chat_backend_error",
            mode="stream",
            duration_ms=_elapsed_ms(started_at),
            question=question_preview,
            code=exc.code,
            message=exc.log_message,
        )
        yield _to_sse_event(
            "error",
            {
                "code": exc.code,
                "message": exc.user_message,
            },
        )
        return
    except Exception as exc:
        _log_chat_event(
            logging.ERROR,
            "CHAT_EXCEPTION",
            mode="stream",
            duration_ms=_elapsed_ms(started_at),
            question=question_preview,
            code="SERVER_ERROR",
            message=str(exc),
        )
        CHAT_LOGGER.exception(
            "event=chat_backend_error mode=stream duration_ms=%s question=%s code=%s",
            _elapsed_ms(started_at),
            question_preview,
            "SERVER_ERROR",
        )
        yield _to_sse_event(
            "error",
            {
                "code": "SERVER_ERROR",
                "message": "Une erreur est survenue côté serveur.",
            },
        )
        return


async def generate_chat_response(
    db: Session,
    *,
    question: str,
    history: list[ChatContextMessage],
) -> ChatResponse:
    started_at = _utcnow()
    question_preview = _truncate(question, 140)
    summary: DataSummary | None = None
    reasoning_result: BusinessReasoningResult | None = None

    _log_chat_event(
        logging.INFO,
        "CHAT_REQUEST_RECEIVED",
        mode="request",
        question=question_preview,
        history_size=len(history),
    )
    _log_chat_event(
        logging.INFO,
        "chat_question_sent",
        mode="request",
        question=question_preview,
        history_size=len(history),
    )

    try:
        summary = get_data_summary(db)
        cache_key = _build_cache_key(question, history, summary)

        cached_response = _get_cached_answer(cache_key)
        if cached_response is not None:
            response = cached_response.model_copy(
                update={
                    "duration_ms": _elapsed_ms(started_at),
                    "cached": True,
                }
            )
            _log_chat_event(
                logging.INFO,
                "chat_response_completed",
                mode="request",
                cached=True,
                duration_ms=response.duration_ms,
                question=question_preview,
            )
            _log_chat_event(
                logging.INFO,
                "CHAT_DURATION_MS",
                mode="request",
                duration_ms=response.duration_ms,
                fallback_used=False,
                question=question_preview,
            )
            return response

        reasoning_result = _get_reasoning_result(
            db,
            question=question,
            history=history,
            summary=summary,
        )
        quick_answer = _answer_from_reasoning(
            db,
            question=question,
            history=history,
            summary=summary,
            reasoning_result=reasoning_result,
        )
        if quick_answer is not None:
            response = _build_response(
                question=question,
                answer=quick_answer,
                summary=summary,
                duration_ms=_elapsed_ms(started_at),
                db=db,
                history=history,
                reasoning_result=reasoning_result,
            )
            _store_cached_answer(cache_key, response)
            _log_chat_event(
                logging.INFO,
                "chat_response_completed",
                mode="request",
                cached=False,
                quick_answer=True,
                duration_ms=response.duration_ms,
                question=question_preview,
            )
            _log_chat_event(
                logging.INFO,
                "CHAT_DURATION_MS",
                mode="request",
                duration_ms=response.duration_ms,
                fallback_used=False,
                question=question_preview,
            )
            return response

        prompt = _build_prompt(
            question,
            history,
            summary,
            reasoning_result=reasoning_result,
        )
        answer = await _generate_with_ollama(prompt)
        response = _build_response(
            question=question,
            answer=answer,
            summary=summary,
            fallback_used=False,
            duration_ms=_elapsed_ms(started_at),
            db=db,
            history=history,
            reasoning_result=reasoning_result,
        )
        _store_cached_answer(cache_key, response)
        _log_chat_event(
            logging.INFO,
            "chat_response_completed",
            mode="request",
            cached=False,
            quick_answer=False,
            duration_ms=response.duration_ms,
            question=question_preview,
        )
        _log_chat_event(
            logging.INFO,
            "CHAT_DURATION_MS",
            mode="request",
            duration_ms=response.duration_ms,
            fallback_used=False,
            question=question_preview,
        )
        return response
    except ChatTimeoutError as exc:
        if summary is None:
            raise
        response = _build_timeout_fallback_response(
            question=question,
            summary=summary,
            started_at=started_at,
            db=db,
            history=history,
            reasoning_result=reasoning_result,
        )
        _log_chat_event(
            logging.WARNING,
            "CHAT_TIMEOUT",
            mode="request",
            duration_ms=response.duration_ms,
            question=question_preview,
            code=exc.code,
            fallback_used=True,
        )
        _log_chat_event(
            logging.INFO,
            "CHAT_DURATION_MS",
            mode="request",
            duration_ms=response.duration_ms,
            fallback_used=True,
            question=question_preview,
        )
        return response
    except ChatServiceError as exc:
        _log_chat_event(
            logging.WARNING,
            "CHAT_EXCEPTION",
            mode="request",
            duration_ms=_elapsed_ms(started_at),
            question=question_preview,
            code=exc.code,
            message=exc.log_message,
        )
        _log_chat_event(
            logging.WARNING,
            "chat_backend_error",
            mode="request",
            duration_ms=_elapsed_ms(started_at),
            question=question_preview,
            code=exc.code,
            message=exc.log_message,
        )
        raise
    except Exception as exc:
        _log_chat_event(
            logging.ERROR,
            "CHAT_EXCEPTION",
            mode="request",
            duration_ms=_elapsed_ms(started_at),
            question=question_preview,
            code="SERVER_ERROR",
            message=str(exc),
        )
        CHAT_LOGGER.exception(
            "event=chat_backend_error mode=request duration_ms=%s question=%s code=%s",
            _elapsed_ms(started_at),
            question_preview,
            "SERVER_ERROR",
        )
        raise ChatServerError() from exc
