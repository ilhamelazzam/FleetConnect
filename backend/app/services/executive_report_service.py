from __future__ import annotations

import hashlib
import json
import logging
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.phone_line import PhoneLine
from app.models.plan import Plan
from app.schemas.chat import (
    ChatDecisionRecommendation,
    ExecutiveReportAnomalyItem,
    ExecutiveReportChartPoint,
    ExecutiveReportCharts,
    ExecutiveReportCostItem,
    ExecutiveReportDepartmentItem,
    ExecutiveReportFraudSignalItem,
    ExecutiveReportImageContext,
    ExecutiveReportOpportunityItem,
    ExecutiveReportOperatorItem,
    ExecutiveReportRecommendationItem,
    ExecutiveReportResponse,
    ExecutiveReportScoreExplanation,
    ExecutiveScoreDirection,
    ExecutiveScoreLevel,
    ExecutiveRiskLevel,
)
from app.services.cdr_analytics_service import _load_cdr_rows
from app.services.chat_service import (
    ChatServiceError,
    DataSummary,
    _elapsed_ms,
    _generate_with_ollama,
    _get_live_plan_price_map,
    _utcnow,
    get_data_summary,
)
from app.services.customer_churn_service import _load_customer_churn_rows
from app.services.mobile_fleet_service import _load_mobile_fleet_rows
from app.services.phone_line_service import compute_occupation_status

EXECUTIVE_REPORT_LOGGER = logging.getLogger("app.chat.executive_report")
EXECUTIVE_REPORT_CACHE_TTL = timedelta(minutes=10)


@dataclass(frozen=True)
class CachedExecutiveReport:
    response: ExecutiveReportResponse
    expires_at: datetime


@dataclass(frozen=True)
class SavingsSnapshot:
    inactive_lines_monthly: float
    oversized_plans_monthly: float
    unused_active_plans_monthly: float
    expensive_plan_rationalization_monthly: float

    @property
    def yearly_total(self) -> float:
        return (
            self.inactive_lines_monthly
            + self.oversized_plans_monthly
            + self.unused_active_plans_monthly
            + self.expensive_plan_rationalization_monthly
        ) * 12


@dataclass
class MultimodalAggregate:
    analysis_count: int
    detected_kpis: list[str]
    anomalies: list[str]
    operators: Counter[str]
    incident_alerts: list[dict[str, Any]]
    workflows: list[dict[str, Any]]
    equipments: list[dict[str, Any]]
    invoice_totals: list[dict[str, Any]]
    decision_recommendations: list[ChatDecisionRecommendation]
    recommendation_titles: list[str]


_EXECUTIVE_REPORT_CACHE: dict[str, CachedExecutiveReport] = {}


def _format_mad(value: float) -> str:
    return f"{value:,.0f} MAD".replace(",", " ")


def _normalize_text(value: str | None, fallback: str = "Non renseigne") -> str:
    normalized = (value or "").strip()
    return normalized or fallback


def _truncate(value: str, limit: int = 180) -> str:
    compact = " ".join(value.split())
    if len(compact) <= limit:
        return compact
    return f"{compact[:limit].rstrip()}..."


def _extract_amount(value: str | None) -> float | None:
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


def _clamp_score(value: float) -> int:
    return max(0, min(int(round(value)), 100))


def _average(values: list[float]) -> float:
    if not values:
        return 0.0
    return sum(values) / len(values)


def _dedupe_strings(values: list[str], limit: int) -> list[str]:
    deduped: list[str] = []
    seen = set()
    for value in values:
        cleaned = " ".join(value.split()).strip()
        normalized = cleaned.lower()
        if not cleaned or normalized in seen:
            continue
        seen.add(normalized)
        deduped.append(cleaned)
    return deduped[:limit]


def _priority_rank(priority: ExecutiveRiskLevel) -> int:
    return {
        "critical": 4,
        "high": 3,
        "medium": 2,
        "low": 1,
    }[priority]


def _risk_level_from_score(score: int) -> ExecutiveRiskLevel:
    if score >= 78:
        return "critical"
    if score >= 58:
        return "high"
    if score >= 34:
        return "medium"
    return "low"


def _health_level_from_score(
    score: int,
    *,
    direction: ExecutiveScoreDirection,
) -> ExecutiveScoreLevel:
    if direction == "higher_is_better":
        if score >= 85:
            return "excellent"
        if score >= 70:
            return "bon"
        if score >= 50:
            return "moyen"
        return "critique"

    if score <= 24:
        return "excellent"
    if score <= 44:
        return "bon"
    if score <= 69:
        return "moyen"
    return "critique"


def _build_score_explanation(
    *,
    label: str,
    score: int,
    direction: ExecutiveScoreDirection,
    explanation: str,
) -> ExecutiveReportScoreExplanation:
    return ExecutiveReportScoreExplanation(
        label=label,
        score=score,
        level=_health_level_from_score(score, direction=direction),
        direction=direction,
        explanation=explanation,
    )


def _build_multimodal_signature(image_analyses: list[ExecutiveReportImageContext]) -> str:
    serialized_payload = json.dumps(
        [analysis.model_dump(mode="json") for analysis in image_analyses],
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha1(serialized_payload.encode("utf-8")).hexdigest()


def _build_cache_key(summary: DataSummary, image_analyses: list[ExecutiveReportImageContext]) -> str:
    return f"{summary.signature}:{_build_multimodal_signature(image_analyses)}"


def _get_cached_report(cache_key: str) -> ExecutiveReportResponse | None:
    cached_entry = _EXECUTIVE_REPORT_CACHE.get(cache_key)
    if cached_entry is None:
        return None

    if _utcnow() >= cached_entry.expires_at:
        _EXECUTIVE_REPORT_CACHE.pop(cache_key, None)
        return None

    return cached_entry.response


def _store_cached_report(cache_key: str, response: ExecutiveReportResponse) -> None:
    _EXECUTIVE_REPORT_CACHE[cache_key] = CachedExecutiveReport(
        response=response,
        expires_at=_utcnow() + EXECUTIVE_REPORT_CACHE_TTL,
    )


def _summarize_multimodal_inputs(
    image_analyses: list[ExecutiveReportImageContext],
) -> MultimodalAggregate:
    detected_kpis: list[str] = []
    anomalies: list[str] = []
    incident_alerts: list[dict[str, Any]] = []
    workflows: list[dict[str, Any]] = []
    equipments: list[dict[str, Any]] = []
    invoice_totals: list[dict[str, Any]] = []
    decision_recommendations: list[ChatDecisionRecommendation] = []
    recommendation_titles: list[str] = []
    operators: Counter[str] = Counter()

    for analysis in image_analyses:
        detected_kpis.extend(analysis.detected_kpis)
        anomalies.extend(analysis.detected_anomalies)
        recommendation_titles.extend(analysis.recommendations)
        decision_recommendations.extend(analysis.decision_recommendations)

        if analysis.detected_operator:
            operators[analysis.detected_operator] += 1

        if analysis.invoice_details is not None:
            invoice_total = _extract_amount(
                analysis.invoice_details.total_amount_mad
                or analysis.invoice_details.amount_ttc_mad
                or analysis.invoice_details.amount_ht_mad
            )
            if invoice_total and invoice_total > 0:
                invoice_totals.append(
                    {
                        "operator": analysis.invoice_details.operator or analysis.detected_operator,
                        "amount_mad": invoice_total,
                        "billing_period": analysis.invoice_details.billing_period,
                    }
                )

        if analysis.incident_details is not None:
            incident_alerts.append(
                {
                    "alert_type": analysis.incident_details.alert_type,
                    "severity": analysis.incident_details.severity,
                    "operator": analysis.incident_details.operator or analysis.detected_operator,
                    "line_reference": analysis.incident_details.line_reference,
                    "summary": analysis.incident_details.summary,
                    "suspect_cost_mad": _extract_amount(analysis.incident_details.suspect_cost_mad),
                    "priority": analysis.incident_details.priority,
                }
            )

        if analysis.workflow_details is not None:
            workflows.append(
                {
                    "workflow_type": analysis.workflow_details.workflow_type,
                    "complexity_score": analysis.workflow_details.complexity_score or 0,
                    "complexity_level": analysis.workflow_details.complexity_level,
                    "critical_steps": list(analysis.workflow_details.critical_steps),
                    "departments": list(analysis.workflow_details.detected_departments),
                    "bottlenecks": list(analysis.workflow_details.bottlenecks),
                    "repeated_validations": list(analysis.workflow_details.repeated_validations),
                    "automation_opportunities": list(
                        analysis.workflow_details.automation_opportunities
                    ),
                    "summary": analysis.workflow_details.summary,
                }
            )

        if analysis.equipment_details is not None:
            equipments.append(
                {
                    "equipment_type": analysis.equipment_details.equipment_type,
                    "brand": analysis.equipment_details.brand,
                    "model": analysis.equipment_details.model,
                    "operator": analysis.equipment_details.operator or analysis.detected_operator,
                    "condition_score": analysis.equipment_details.condition_score or 0,
                    "criticality_score": analysis.equipment_details.criticality_score or 0,
                    "obsolescence_score": analysis.equipment_details.obsolescence_score or 0,
                    "maintenance_score": analysis.equipment_details.maintenance_score or 0,
                    "replacement_needed": analysis.equipment_details.replacement_needed,
                    "detected_issues": list(analysis.equipment_details.detected_issues),
                    "maintenance_recommendations": list(
                        analysis.equipment_details.maintenance_recommendations
                    ),
                    "summary": analysis.equipment_details.summary,
                }
            )

    recommendation_titles.extend(
        recommendation.title for recommendation in decision_recommendations
    )
    return MultimodalAggregate(
        analysis_count=len(image_analyses),
        detected_kpis=_dedupe_strings(detected_kpis, 24),
        anomalies=_dedupe_strings(anomalies, 24),
        operators=operators,
        incident_alerts=incident_alerts,
        workflows=workflows,
        equipments=equipments,
        invoice_totals=invoice_totals,
        decision_recommendations=decision_recommendations,
        recommendation_titles=_dedupe_strings(recommendation_titles, 24),
    )


def _collect_line_efficiency_metrics(
    db: Session,
    summary: DataSummary,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[Plan], SavingsSnapshot]:
    phone_lines = list(db.scalars(select(PhoneLine)))
    plans = list(db.scalars(select(Plan)))
    plan_price_map = _get_live_plan_price_map(plans)
    average_monthly_line_cost = (
        summary.total_monthly_cost_mad / max(len(_load_customer_churn_rows()), 1)
        if summary.total_monthly_cost_mad > 0
        else 0.0
    )

    inactive_lines: list[dict[str, Any]] = []
    oversized_lines: list[dict[str, Any]] = []

    for phone_line in phone_lines:
        occupation_status = compute_occupation_status(phone_line)
        monthly_price = float(
            plan_price_map.get(
                (
                    phone_line.operator_name.strip().lower(),
                    phone_line.plan_name.strip().lower(),
                ),
                average_monthly_line_cost,
            )
        )
        usage_ratio = (
            phone_line.current_data_usage_gb / phone_line.monthly_limit
            if phone_line.monthly_limit not in (None, 0)
            else None
        )

        if occupation_status in {"libre", "inactive"} or phone_line.status in {
            "inactive",
            "suspended",
        }:
            inactive_lines.append(
                {
                    "phone_number": phone_line.phone_number,
                    "operator": phone_line.operator_name,
                    "department": phone_line.department,
                    "monthly_price": monthly_price,
                    "status": phone_line.status,
                }
            )

        if (
            usage_ratio is not None
            and phone_line.monthly_limit not in (None, 0)
            and phone_line.status == "active"
            and phone_line.current_data_usage_gb >= 0
            and usage_ratio < 0.35
        ):
            oversized_lines.append(
                {
                    "phone_number": phone_line.phone_number,
                    "operator": phone_line.operator_name,
                    "department": phone_line.department,
                    "usage_ratio": usage_ratio,
                    "monthly_limit": phone_line.monthly_limit,
                    "current_usage_gb": phone_line.current_data_usage_gb,
                    "monthly_price": monthly_price,
                }
            )

    unused_active_plans = [
        plan
        for plan in plans
        if plan.activation_status == "active" and plan.active_lines <= 0
    ]

    expensive_plan_rationalization_monthly = sum(
        plan.average_cost_mad * plan.line_count * 0.08
        for plan in summary.expensive_plans[:2]
    )

    savings_snapshot = SavingsSnapshot(
        inactive_lines_monthly=sum(item["monthly_price"] for item in inactive_lines),
        oversized_plans_monthly=sum(item["monthly_price"] * 0.18 for item in oversized_lines),
        unused_active_plans_monthly=sum(plan.monthly_price for plan in unused_active_plans),
        expensive_plan_rationalization_monthly=expensive_plan_rationalization_monthly,
    )
    return inactive_lines, oversized_lines, unused_active_plans, savings_snapshot


def _build_department_exposure_items(
    *,
    summary: DataSummary,
    churn_rows: list[dict[str, Any]],
    mobile_rows: list[dict[str, Any]],
    cdr_rows: list[dict[str, Any]],
    multimodal: MultimodalAggregate,
) -> list[ExecutiveReportDepartmentItem]:
    department_metrics: dict[str, dict[str, Any]] = defaultdict(
        lambda: {
            "summary_cost": 0.0,
            "summary_risk": 0.0,
            "summary_alerts": 0,
            "monthly_cost": 0.0,
            "revenue_at_risk": 0.0,
            "churn_risk_scores": [],
            "over_quota": 0,
            "roaming_lines": 0,
            "predicted_churn": 0,
            "mobile_budget": 0.0,
            "mobile_critical": 0,
            "cdr_alerts": 0,
            "workflow_hits": 0,
        }
    )

    for metric in summary.risky_departments:
        metrics = department_metrics[metric.label]
        metrics["summary_cost"] += metric.monthly_cost_mad
        metrics["summary_risk"] = max(metrics["summary_risk"], metric.risk_score)
        metrics["summary_alerts"] += metric.alert_count

    for row in churn_rows:
        metrics = department_metrics[row["department"]]
        metrics["monthly_cost"] += row["monthly_cost_mad"]
        metrics["revenue_at_risk"] += row["revenue_at_risk_mad"]
        metrics["churn_risk_scores"].append(row["risk_score_100"])
        metrics["over_quota"] += int(row["over_quota_flag"])
        metrics["roaming_lines"] += int(row["roaming_flag"])
        metrics["predicted_churn"] += int(row["predicted_churn"])

    for row in mobile_rows:
        metrics = department_metrics[row["department"]]
        metrics["mobile_budget"] += row["estimated_price_mad"]
        metrics["mobile_critical"] += int(row["risk_level"] == "Critique")

    for row in cdr_rows:
        if row["is_alert"]:
            department_metrics[row["department"]]["cdr_alerts"] += 1

    for workflow in multimodal.workflows:
        for department in workflow["departments"]:
            department_metrics[department]["workflow_hits"] += 1

    department_items: list[ExecutiveReportDepartmentItem] = []
    for department, metrics in department_metrics.items():
        average_churn_risk = _average(metrics["churn_risk_scores"])
        alert_count = (
            metrics["summary_alerts"]
            + metrics["cdr_alerts"]
            + metrics["mobile_critical"]
            + metrics["workflow_hits"]
        )
        risk_score = _clamp_score(
            metrics["summary_risk"] * 0.35
            + average_churn_risk * 0.22
            + min(metrics["cdr_alerts"] * 1.2, 18)
            + min(metrics["mobile_critical"] * 7, 16)
            + min(metrics["over_quota"] / max(len(churn_rows), 1) * 100 * 1.1, 10)
            + min(metrics["workflow_hits"] * 8, 14)
            + min(metrics["predicted_churn"] / max(len(churn_rows), 1) * 100 * 2.0, 10)
        )

        reason_parts: list[str] = []
        if metrics["summary_cost"] > 0:
            reason_parts.append(
                f"poids budgetaire { _format_mad(metrics['summary_cost']) }".replace("  ", " ")
            )
        if metrics["cdr_alerts"] > 0:
            reason_parts.append(f"{metrics['cdr_alerts']} alerte(s) fraude/CDR")
        if metrics["mobile_critical"] > 0:
            reason_parts.append(f"{metrics['mobile_critical']} equipement(s) mobile critique(s)")
        if average_churn_risk >= 60:
            reason_parts.append(f"risque client moyen {round(average_churn_risk)}/100")
        if metrics["workflow_hits"] > 0:
            reason_parts.append(f"{metrics['workflow_hits']} workflow(s) sensible(s)")

        department_items.append(
            ExecutiveReportDepartmentItem(
                department=department,
                risk_score=risk_score,
                monthly_cost_mad=round(
                    metrics["summary_cost"] or metrics["monthly_cost"],
                    2,
                ),
                alert_count=alert_count,
                reason=_truncate(
                    " ; ".join(reason_parts) or "Exposition budgetaire et operationnelle a suivre.",
                    180,
                ),
            )
        )

    return sorted(
        department_items,
        key=lambda item: (
            item.risk_score,
            item.monthly_cost_mad or 0,
            item.alert_count,
        ),
        reverse=True,
    )[:5]


def _build_operator_items(
    *,
    summary: DataSummary,
    churn_rows: list[dict[str, Any]],
    cdr_rows: list[dict[str, Any]],
) -> list[ExecutiveReportOperatorItem]:
    operator_metrics: dict[str, dict[str, Any]] = defaultdict(
        lambda: {
            "monthly_cost": 0.0,
            "summary_alerts": 0,
            "suspicious_calls": 0,
            "roaming_lines": 0,
        }
    )

    for metric in summary.expensive_operators:
        metrics = operator_metrics[metric.label]
        metrics["monthly_cost"] += metric.monthly_cost_mad
        metrics["summary_alerts"] += metric.alert_count

    for row in churn_rows:
        if row["roaming_flag"]:
            operator_metrics[row["operator"]]["roaming_lines"] += 1

    for row in cdr_rows:
        if row["is_alert"]:
            operator_metrics[row["operator_maroc"]]["suspicious_calls"] += 1

    items: list[ExecutiveReportOperatorItem] = []
    for operator, metrics in operator_metrics.items():
        reason_parts = []
        if metrics["summary_alerts"] > 0:
            reason_parts.append(f"{metrics['summary_alerts']} alerte(s) budget/usage")
        if metrics["suspicious_calls"] > 0:
            reason_parts.append(f"{metrics['suspicious_calls']} appel(s) suspect(s)")
        if metrics["roaming_lines"] > 0:
            reason_parts.append(f"{metrics['roaming_lines']} ligne(s) en roaming")
        items.append(
            ExecutiveReportOperatorItem(
                operator=operator,
                total_cost_mad=round(metrics["monthly_cost"], 2),
                suspicious_calls=metrics["suspicious_calls"],
                roaming_lines=metrics["roaming_lines"],
                reason=_truncate(
                    " ; ".join(reason_parts)
                    or "Operateur a surveiller au regard du poids budgetaire.",
                    160,
                ),
            )
        )

    return sorted(
        items,
        key=lambda item: (item.total_cost_mad, item.suspicious_calls, item.roaming_lines),
        reverse=True,
    )[:5]


def _build_critical_cost_items(
    *,
    summary: DataSummary,
    costly_operators: list[ExecutiveReportOperatorItem],
    roaming_cost_mad: float,
    suspicious_cost_exposure_mad: float,
    mobile_rows: list[dict[str, Any]],
    multimodal: MultimodalAggregate,
) -> list[ExecutiveReportCostItem]:
    cost_items: list[ExecutiveReportCostItem] = []
    projected_gap = max(summary.projected_monthly_cost_mad - summary.total_monthly_cost_mad, 0.0)
    if projected_gap > 0:
        cost_items.append(
            ExecutiveReportCostItem(
                title="Projection de couts en hausse",
                amount_mad=round(projected_gap, 2),
                category="projection",
                owner=None,
                reason=(
                    "Ecart entre le cout mensuel courant et la projection calculee a partir "
                    "des donnees disponibles."
                ),
            )
        )

    if costly_operators:
        top_operator = costly_operators[0]
        cost_items.append(
            ExecutiveReportCostItem(
                title=f"Operateur le plus couteux: {top_operator.operator}",
                amount_mad=round(top_operator.total_cost_mad, 2),
                category="operator",
                owner=top_operator.operator,
                reason=top_operator.reason,
            )
        )

    if roaming_cost_mad > 0:
        cost_items.append(
            ExecutiveReportCostItem(
                title="Exposition roaming",
                amount_mad=round(roaming_cost_mad, 2),
                category="roaming",
                owner=None,
                reason="Somme des couts mensuels associes aux lignes identifiees en roaming.",
            )
        )

    if suspicious_cost_exposure_mad > 0:
        cost_items.append(
            ExecutiveReportCostItem(
                title="Exposition fraude CDR",
                amount_mad=round(suspicious_cost_exposure_mad, 2),
                category="fraud",
                owner=None,
                reason="Cout agrege des appels suspects ou signales par le moteur fraude.",
            )
        )

    mobile_budget_by_department: Counter[str] = Counter()
    for row in mobile_rows:
        if row["risk_level"] == "Critique":
            mobile_budget_by_department[row["department"]] += row["estimated_price_mad"]
    if mobile_budget_by_department:
        department, amount_mad = mobile_budget_by_department.most_common(1)[0]
        cost_items.append(
            ExecutiveReportCostItem(
                title=f"Parc mobile critique: {department}",
                amount_mad=round(float(amount_mad), 2),
                category="devices",
                owner=department,
                reason="Budget estime des terminaux critiques identifies dans le parc mobile.",
            )
        )

    for invoice_item in sorted(
        multimodal.invoice_totals,
        key=lambda item: item["amount_mad"],
        reverse=True,
    )[:2]:
        cost_items.append(
            ExecutiveReportCostItem(
                title="Montant facture OCR detecte",
                amount_mad=round(invoice_item["amount_mad"], 2),
                category="invoice",
                owner=invoice_item["operator"],
                reason=_truncate(
                    (
                        f"Montant OCR sur facture telecom {invoice_item['billing_period'] or ''}"
                    ).strip(),
                    120,
                ),
            )
        )

    return sorted(cost_items, key=lambda item: item.amount_mad, reverse=True)[:6]


def _build_major_anomalies(
    *,
    summary: DataSummary,
    multimodal: MultimodalAggregate,
) -> list[ExecutiveReportAnomalyItem]:
    anomalies: list[ExecutiveReportAnomalyItem] = []

    for critical_line in summary.critical_lines[:3]:
        anomalies.append(
            ExecutiveReportAnomalyItem(
                title=f"Ligne critique {critical_line.label}",
                severity=_risk_level_from_score(_clamp_score(critical_line.risk_score)),
                source="fleet",
                reason=_truncate(
                    f"{critical_line.operator} / {critical_line.department} / {critical_line.usage_label}. "
                    f"Action suggeree: {critical_line.action}",
                    180,
                ),
            )
        )

    for anomaly in multimodal.anomalies[:4]:
        anomalies.append(
            ExecutiveReportAnomalyItem(
                title=_truncate(anomaly, 90),
                severity="high",
                source="multimodal",
                reason="Issue detectee dans une analyse image, OCR ou workflow precedente.",
            )
        )

    for workflow in multimodal.workflows[:2]:
        for bottleneck in workflow["bottlenecks"][:2]:
            anomalies.append(
                ExecutiveReportAnomalyItem(
                    title=_truncate(f"Goulot workflow: {bottleneck}", 90),
                    severity=(
                        "critical"
                        if workflow["complexity_score"] >= 80
                        else "high"
                    ),
                    source="workflow",
                    reason=_truncate(
                        workflow["summary"]
                        or "Workflow complexe avec etapes critiques et validations repetitives.",
                        180,
                    ),
                )
            )

    for equipment in multimodal.equipments[:2]:
        for issue in equipment["detected_issues"][:2]:
            anomalies.append(
                ExecutiveReportAnomalyItem(
                    title=_truncate(f"Equipement: {issue}", 90),
                    severity=(
                        "critical"
                        if equipment["replacement_needed"] or equipment["criticality_score"] >= 75
                        else "medium"
                    ),
                    source="equipment",
                    reason=_truncate(
                        equipment["summary"]
                        or "Probleme detecte sur equipement telecom analyse en vision/OCR.",
                        180,
                    ),
                )
            )

    deduped: list[ExecutiveReportAnomalyItem] = []
    seen = set()
    for anomaly in anomalies:
        normalized = anomaly.title.lower()
        if normalized in seen:
            continue
        seen.add(normalized)
        deduped.append(anomaly)

    return deduped[:6]


def _build_fraud_signals(
    *,
    cdr_rows: list[dict[str, Any]],
    multimodal: MultimodalAggregate,
) -> list[ExecutiveReportFraudSignalItem]:
    alert_rows = sorted(
        [row for row in cdr_rows if row["is_alert"]],
        key=lambda row: (row["fraud_risk_score_100"], row["call_cost_mad"]),
        reverse=True,
    )
    signals: list[ExecutiveReportFraudSignalItem] = []

    for row in alert_rows[:4]:
        signals.append(
            ExecutiveReportFraudSignalItem(
                title=_truncate(
                    f"{row['fraud_type'].replace('_', ' ')} - {row['route_label']}",
                    92,
                ),
                severity=_risk_level_from_score(_clamp_score(row["fraud_risk_score_100"])),
                operator=row["operator_maroc"],
                department=row["department"],
                estimated_exposure_mad=row["call_cost_mad"],
                reason=_truncate(row["recommendation_reason"], 180),
            )
        )

    for incident in multimodal.incident_alerts[:3]:
        alert_type = _normalize_text(incident["alert_type"], "incident")
        if alert_type.lower() not in {"fraude", "appel_suspect", "incident", "alerte"} and not incident[
            "suspect_cost_mad"
        ]:
            continue

        signals.append(
            ExecutiveReportFraudSignalItem(
                title=_truncate(
                    incident["summary"] or f"Signal {alert_type}",
                    92,
                ),
                severity=(
                    "critical"
                    if _normalize_text(incident["severity"], "").lower() == "critique"
                    else "high"
                ),
                operator=incident["operator"],
                department=None,
                estimated_exposure_mad=incident["suspect_cost_mad"],
                reason=_truncate(
                    f"Priorite {incident['priority'] or 'elevee'} - {incident['summary'] or 'Signal issu de l OCR et de l analyse visuelle.'}",
                    180,
                ),
            )
        )

    deduped: list[ExecutiveReportFraudSignalItem] = []
    seen = set()
    for signal in signals:
        normalized = signal.title.lower()
        if normalized in seen:
            continue
        seen.add(normalized)
        deduped.append(signal)
    return deduped[:6]


def _build_multimodal_highlights(multimodal: MultimodalAggregate) -> list[str]:
    highlights: list[str] = []
    if multimodal.analysis_count > 0:
        highlights.append(
            f"{multimodal.analysis_count} analyse(s) multimodale(s) consolidee(s)"
        )
    if multimodal.detected_kpis:
        highlights.append(
            f"{min(len(multimodal.detected_kpis), 12)} KPI visuels / OCR reutilises"
        )
    if multimodal.workflows:
        critical_workflows = sum(
            1 for workflow in multimodal.workflows if workflow["complexity_score"] >= 70
        )
        if critical_workflows > 0:
            highlights.append(f"{critical_workflows} workflow(s) critique(s) detecte(s)")
    if multimodal.equipments:
        obsolete_count = sum(
            1
            for equipment in multimodal.equipments
            if equipment["replacement_needed"] or equipment["obsolescence_score"] >= 70
        )
        if obsolete_count > 0:
            highlights.append(f"{obsolete_count} equipement(s) obsolescent(s) ou a remplacer")
    if multimodal.invoice_totals:
        highlights.append(
            f"{len(multimodal.invoice_totals)} montant(s) facture OCR exploitable(s)"
        )
    return highlights[:6]


def _build_optimization_opportunities(
    *,
    summary: DataSummary,
    inactive_lines: list[dict[str, Any]],
    oversized_lines: list[dict[str, Any]],
    unused_active_plans: list[Plan],
    savings: SavingsSnapshot,
    multimodal: MultimodalAggregate,
    roaming_cost_mad: float,
) -> list[ExecutiveReportOpportunityItem]:
    opportunities: list[ExecutiveReportOpportunityItem] = []

    if inactive_lines:
        opportunities.append(
            ExecutiveReportOpportunityItem(
                title="Suspendre les lignes inactives ou non attribuees",
                estimated_saving_mad=round(savings.inactive_lines_monthly * 12, 2),
                justification=(
                    f"{len(inactive_lines)} ligne(s) live presentent un statut libre, inactive ou suspendu."
                ),
            )
        )

    if oversized_lines:
        opportunities.append(
            ExecutiveReportOpportunityItem(
                title="Redimensionner les forfaits surdimensionnes",
                estimated_saving_mad=round(savings.oversized_plans_monthly * 12, 2),
                justification=(
                    f"{len(oversized_lines)} ligne(s) actives utilisent moins de 35% de leur enveloppe data."
                ),
            )
        )

    if unused_active_plans:
        opportunities.append(
            ExecutiveReportOpportunityItem(
                title="Desactiver les forfaits actifs sans lignes",
                estimated_saving_mad=round(savings.unused_active_plans_monthly * 12, 2),
                justification=(
                    f"{len(unused_active_plans)} forfait(s) actif(s) n'alimentent actuellement aucune ligne."
                ),
            )
        )

    if summary.expensive_plans:
        opportunities.append(
            ExecutiveReportOpportunityItem(
                title="Rationaliser les plans telecom les plus couteux",
                estimated_saving_mad=round(
                    savings.expensive_plan_rationalization_monthly * 12,
                    2,
                ),
                justification=(
                    f"Les plans les plus chers concentrent {sum(plan.line_count for plan in summary.expensive_plans[:2])} ligne(s) et plusieurs alertes budget."
                ),
            )
        )

    workflow_automation_count = sum(
        len(workflow["automation_opportunities"]) for workflow in multimodal.workflows
    )
    if workflow_automation_count > 0:
        opportunities.append(
            ExecutiveReportOpportunityItem(
                title="Automatiser les workflows les plus lourds",
                estimated_saving_mad=None,
                justification=(
                    f"{workflow_automation_count} opportunite(s) d'automatisation ont ete detectees dans les workflows precedents."
                ),
            )
        )

    if roaming_cost_mad > 0:
        opportunities.append(
            ExecutiveReportOpportunityItem(
                title="Encadrer le roaming international",
                estimated_saving_mad=None,
                justification=(
                    f"Le parc affiche {_format_mad(roaming_cost_mad)} de couts associes aux lignes en roaming."
                ),
            )
        )

    return sorted(
        opportunities,
        key=lambda item: item.estimated_saving_mad or 0,
        reverse=True,
    )[:6]


def _build_top_recommendations(
    *,
    high_risk_departments: list[ExecutiveReportDepartmentItem],
    fraud_signals: list[ExecutiveReportFraudSignalItem],
    optimization_opportunities: list[ExecutiveReportOpportunityItem],
    multimodal: MultimodalAggregate,
) -> list[ExecutiveReportRecommendationItem]:
    recommendations: list[ExecutiveReportRecommendationItem] = []

    if high_risk_departments:
        top_department = high_risk_departments[0]
        recommendations.append(
            ExecutiveReportRecommendationItem(
                title=f"Surveiller le departement {top_department.department}",
                priority=(
                    "critical" if top_department.risk_score >= 78 else "high"
                ),
                justification=top_department.reason,
                action="Declencher un audit cible des usages, alertes et affectations.",
                estimated_saving_mad=None,
            )
        )

    for opportunity in optimization_opportunities[:3]:
        recommendations.append(
            ExecutiveReportRecommendationItem(
                title=opportunity.title,
                priority="high" if opportunity.estimated_saving_mad else "medium",
                justification=opportunity.justification,
                action="Lancer une revue telecom et valider les changements de plan ou de statut.",
                estimated_saving_mad=opportunity.estimated_saving_mad,
            )
        )

    if fraud_signals:
        top_signal = fraud_signals[0]
        recommendations.append(
            ExecutiveReportRecommendationItem(
                title="Verifier les signaux fraude prioritaires",
                priority="critical" if top_signal.severity == "critical" else "high",
                justification=top_signal.reason,
                action="Ouvrir une investigation fraude et confirmer la legitimite des appels.",
                estimated_saving_mad=top_signal.estimated_exposure_mad,
            )
        )

    obsolete_equipment_count = sum(
        1
        for equipment in multimodal.equipments
        if equipment["replacement_needed"] or equipment["obsolescence_score"] >= 70
    )
    if obsolete_equipment_count > 0:
        recommendations.append(
            ExecutiveReportRecommendationItem(
                title="Remplacer les equipements obsoletes",
                priority="high",
                justification=(
                    f"{obsolete_equipment_count} equipement(s) presente(nt) un risque d'obsolescence ou un besoin de remplacement."
                ),
                action="Prioriser le renouvellement des materiels a criticite ou maintenance elevee.",
                estimated_saving_mad=None,
            )
        )

    if multimodal.workflows:
        critical_workflow = max(
            multimodal.workflows,
            key=lambda workflow: workflow["complexity_score"],
            default=None,
        )
        if critical_workflow and critical_workflow["complexity_score"] >= 70:
            recommendations.append(
                ExecutiveReportRecommendationItem(
                    title="Simplifier les workflows telecom critiques",
                    priority="high",
                    justification=_truncate(
                        critical_workflow["summary"]
                        or "Workflow complexe avec goulots et validations repetitives.",
                        180,
                    ),
                    action="Supprimer les validations redondantes et industrialiser les etapes manuelles.",
                    estimated_saving_mad=None,
                )
            )

    deduped: list[ExecutiveReportRecommendationItem] = []
    seen = set()
    for recommendation in recommendations:
        normalized = recommendation.title.lower()
        if normalized in seen:
            continue
        seen.add(normalized)
        deduped.append(recommendation)

    return sorted(
        deduped,
        key=lambda item: (_priority_rank(item.priority), item.estimated_saving_mad or 0),
        reverse=True,
    )[:6]


def _build_priority_risks(
    *,
    risk_score: int,
    fraud_score: int,
    anomaly_score: int,
    optimization_score: int,
    equipment_score: int,
    high_risk_departments: list[ExecutiveReportDepartmentItem],
    fraud_signals: list[ExecutiveReportFraudSignalItem],
    multimodal: MultimodalAggregate,
) -> list[str]:
    risks: list[str] = []

    if high_risk_departments:
        top_department = high_risk_departments[0]
        risks.append(
            f"Departement {top_department.department} a risque {top_department.risk_score}/100"
        )
    if fraud_signals:
        risks.append("Fraude telecom et appels suspects a investiguer")
    if fraud_score >= 55:
        risks.append("Exposition fraude au-dessus du seuil de vigilance")
    if anomaly_score >= 55:
        risks.append("Depassements et anomalies d'usage recurrents")
    if optimization_score >= 55:
        risks.append("Potentiel d'optimisation telecom eleve")
    if equipment_score >= 55:
        risks.append("Dette equipement et renouvellement a piloter")
    if multimodal.workflows:
        risks.append("Workflows telecom trop complexes pour un traitement fluide")
    if risk_score >= 70:
        risks.append("Risque global de flotte eleve sur le perimetre disponible")

    return _dedupe_strings(risks, 6)


def _build_charts(
    *,
    summary: DataSummary,
    high_risk_departments: list[ExecutiveReportDepartmentItem],
    costly_operators: list[ExecutiveReportOperatorItem],
    risk_score: int,
    fraud_score: int,
    optimization_score: int,
    anomaly_score: int,
    equipment_score: int,
    suspicious_cost_exposure_mad: float,
    roaming_cost_mad: float,
    mobile_budget_mad: float,
) -> ExecutiveReportCharts:
    return ExecutiveReportCharts(
        cost_evolution=[
            ExecutiveReportChartPoint(
                label="Mensuel actuel",
                value=round(summary.total_monthly_cost_mad, 2),
            ),
            ExecutiveReportChartPoint(
                label="Projection",
                value=round(summary.projected_monthly_cost_mad, 2),
            ),
            ExecutiveReportChartPoint(
                label="Roaming",
                value=round(roaming_cost_mad, 2),
            ),
            ExecutiveReportChartPoint(
                label="Fraude exposee",
                value=round(suspicious_cost_exposure_mad, 2),
            ),
            ExecutiveReportChartPoint(
                label="Budget terminaux",
                value=round(mobile_budget_mad, 2),
            ),
        ],
        department_risk=[
            ExecutiveReportChartPoint(
                label=item.department,
                value=item.risk_score,
                secondary_value=item.monthly_cost_mad,
            )
            for item in high_risk_departments
        ],
        operator_costs=[
            ExecutiveReportChartPoint(
                label=item.operator,
                value=round(item.total_cost_mad, 2),
                secondary_value=float(item.suspicious_calls),
            )
            for item in costly_operators
        ],
        score_breakdown=[
            ExecutiveReportChartPoint(label="Risque", value=float(risk_score)),
            ExecutiveReportChartPoint(label="Fraude", value=float(fraud_score)),
            ExecutiveReportChartPoint(label="Optimisation", value=float(optimization_score)),
            ExecutiveReportChartPoint(label="Anomalie", value=float(anomaly_score)),
            ExecutiveReportChartPoint(label="Equipement", value=float(equipment_score)),
        ],
    )


def _build_executive_summary_fallback(
    *,
    risk_level: ExecutiveRiskLevel,
    fleet_health_score: int,
    high_risk_departments: list[ExecutiveReportDepartmentItem],
    costly_operators: list[ExecutiveReportOperatorItem],
    roaming_cost_mad: float,
    suspicious_cost_exposure_mad: float,
    multimodal: MultimodalAggregate,
) -> str:
    risk_labels = {
        "low": "faible",
        "medium": "moyen",
        "high": "eleve",
        "critical": "critique",
    }
    summary_parts = [
        f"La flotte presente un risque {risk_labels[risk_level]} avec un Fleet Health Score de {fleet_health_score}/100."
    ]

    if high_risk_departments:
        summary_parts.append(
            f"Le departement le plus expose est {high_risk_departments[0].department}."
        )

    if costly_operators:
        summary_parts.append(
            f"{costly_operators[0].operator} porte la charge operateur la plus couteuse."
        )

    if roaming_cost_mad > 0:
        summary_parts.append(
            f"Le roaming represente {_format_mad(roaming_cost_mad)} sur le perimetre disponible."
        )

    if suspicious_cost_exposure_mad > 0:
        summary_parts.append(
            f"L'exposition fraude immediate atteint {_format_mad(suspicious_cost_exposure_mad)}."
        )

    if multimodal.analysis_count > 0 and multimodal.workflows:
        summary_parts.append("Les analyses multimodales confirment des workflows et equipements a prioriser.")

    return " ".join(summary_parts[:5])


def _extract_json_summary(raw_answer: str) -> str | None:
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

    summary_value = payload.get("executive_summary")
    if isinstance(summary_value, str) and summary_value.strip():
        return summary_value.strip()
    return None


async def _generate_executive_summary(
    *,
    facts: dict[str, Any],
    fallback_summary: str,
) -> tuple[str, bool]:
    prompt = (
        "Tu es un directeur telecom et consultant DSI. "
        "Utilise EXCLUSIVEMENT les faits JSON ci-dessous. "
        "N'invente aucun chiffre, n'ajoute aucune source externe, n'extrapole pas de tendance absente. "
        "Rends un resume executif professionnel en francais, 2 a 3 phrases maximum, ton corporate. "
        "Retourne STRICTEMENT un JSON valide avec la cle executive_summary.\n"
        f"Faits: {json.dumps(facts, ensure_ascii=False)}\n"
        'Format attendu: {"executive_summary": "..."}'
    )

    try:
        raw_answer = await _generate_with_ollama(prompt)
    except ChatServiceError:
        return fallback_summary, True

    summary_text = _extract_json_summary(raw_answer)
    if summary_text:
        return summary_text, False

    cleaned_text = raw_answer.strip()
    if cleaned_text:
        return _truncate(cleaned_text, 320), True

    return fallback_summary, True


async def generate_executive_report(
    db: Session,
    *,
    history: list[Any] | None = None,
    image_analyses: list[ExecutiveReportImageContext] | None = None,
    conversation_id: str | None = None,
) -> ExecutiveReportResponse:
    started_at = _utcnow()
    history = history or []
    image_analyses = image_analyses or []

    EXECUTIVE_REPORT_LOGGER.info(
        "event=executive_report_started conversation_id=%s history_size=%s multimodal_count=%s",
        conversation_id,
        len(history),
        len(image_analyses),
    )

    summary = get_data_summary(db)
    cache_key = _build_cache_key(summary, image_analyses)
    cached_response = _get_cached_report(cache_key)
    if cached_response is not None:
        return cached_response.model_copy(
            update={
                "cached": True,
                "duration_ms": _elapsed_ms(started_at),
            }
        )

    churn_rows = _load_customer_churn_rows()
    mobile_rows = _load_mobile_fleet_rows()
    cdr_rows = _load_cdr_rows()
    multimodal = _summarize_multimodal_inputs(image_analyses)

    inactive_lines, oversized_lines, unused_active_plans, savings = _collect_line_efficiency_metrics(
        db,
        summary,
    )
    total_churn_rows = max(len(churn_rows), 1)
    budget_alert_ratio = summary.budget_alert_count / total_churn_rows * 100
    over_quota_ratio = summary.over_quota_count / total_churn_rows * 100
    anomaly_ratio = summary.anomaly_count / total_churn_rows * 100
    projected_growth_pct = (
        max(summary.projected_monthly_cost_mad - summary.total_monthly_cost_mad, 0.0)
        / max(summary.total_monthly_cost_mad, 1.0)
        * 100
    )

    suspicious_rows = [row for row in cdr_rows if row["is_alert"]]
    suspicious_call_ratio = len(suspicious_rows) / max(len(cdr_rows), 1) * 100
    average_fraud_risk = _average([row["fraud_risk_score_100"] for row in suspicious_rows])
    suspicious_cost_exposure_mad = sum(row["call_cost_mad"] for row in suspicious_rows)
    suspicious_cost_share_pct = (
        suspicious_cost_exposure_mad / max(summary.total_monthly_cost_mad, 1.0) * 100
    )
    roaming_alert_ratio = (
        sum(1 for row in suspicious_rows if row["roaming_flag"]) / max(len(suspicious_rows), 1) * 100
    )
    roaming_cost_mad = sum(row["monthly_cost_mad"] for row in churn_rows if row["roaming_flag"])
    roaming_line_ratio = sum(1 for row in churn_rows if row["roaming_flag"]) / total_churn_rows * 100

    mobile_critical_ratio = (
        sum(1 for row in mobile_rows if row["risk_level"] == "Critique")
        / max(len(mobile_rows), 1)
        * 100
    )
    workflow_complexity_average = _average(
        [float(workflow["complexity_score"]) for workflow in multimodal.workflows]
    )
    workflow_bottleneck_count = sum(
        len(workflow["bottlenecks"]) + len(workflow["repeated_validations"])
        for workflow in multimodal.workflows
    )
    workflow_automation_count = sum(
        len(workflow["automation_opportunities"]) for workflow in multimodal.workflows
    )
    equipment_obsolete_count = sum(
        1
        for equipment in multimodal.equipments
        if equipment["replacement_needed"] or equipment["obsolescence_score"] >= 70
    )
    average_equipment_obsolescence = _average(
        [float(equipment["obsolescence_score"]) for equipment in multimodal.equipments]
    )
    average_equipment_criticality = _average(
        [float(equipment["criticality_score"]) for equipment in multimodal.equipments]
    )
    average_equipment_maintenance = _average(
        [float(equipment["maintenance_score"]) for equipment in multimodal.equipments]
    )
    multimodal_anomaly_pressure = min(len(multimodal.anomalies) * 4, 20)
    invoice_pressure = sum(item["amount_mad"] for item in multimodal.invoice_totals)
    top_operator_share_pct = (
        (summary.expensive_operators[0].monthly_cost_mad / max(summary.total_monthly_cost_mad, 1.0) * 100)
        if summary.expensive_operators
        else 0.0
    )

    cost_pressure_score = _clamp_score(
        projected_growth_pct * 1.1
        + budget_alert_ratio * 0.85
        + over_quota_ratio * 0.95
        + top_operator_share_pct * 0.45
        + roaming_line_ratio * 0.4
        + min(invoice_pressure / max(summary.total_monthly_cost_mad, 1.0) * 100 * 0.35, 12)
    )
    fraud_score = _clamp_score(
        suspicious_call_ratio * 0.28
        + average_fraud_risk * 0.24
        + roaming_alert_ratio * 0.18
        + suspicious_cost_share_pct * 0.16
        + min(len(multimodal.incident_alerts) * 6, 12)
    )
    anomaly_score = _clamp_score(
        anomaly_ratio * 0.9
        + min(summary.critical_alert_count / total_churn_rows * 100 * 0.45, 12)
        + workflow_complexity_average * 0.22
        + min(workflow_bottleneck_count * 2.8, 18)
        + multimodal_anomaly_pressure
        + min(equipment_obsolete_count * 6, 18)
    )
    optimization_score = _clamp_score(
        min(summary.free_lines * 8, 18)
        + min(summary.inactive_lines * 9, 20)
        + min(len(oversized_lines) * 5, 22)
        + min(len(unused_active_plans) * 10, 18)
        + min(workflow_automation_count * 4, 14)
        + min(top_operator_share_pct * 0.2, 8)
    )
    equipment_score = _clamp_score(
        mobile_critical_ratio * 0.28
        + average_equipment_obsolescence * 0.35
        + average_equipment_criticality * 0.24
        + average_equipment_maintenance * 0.15
        + min(equipment_obsolete_count * 10, 25)
    )

    high_risk_departments = _build_department_exposure_items(
        summary=summary,
        churn_rows=churn_rows,
        mobile_rows=mobile_rows,
        cdr_rows=cdr_rows,
        multimodal=multimodal,
    )
    costly_operators = _build_operator_items(
        summary=summary,
        churn_rows=churn_rows,
        cdr_rows=cdr_rows,
    )
    department_pressure = _average(
        [float(item.risk_score) for item in high_risk_departments[:3]]
    )
    risk_score = _clamp_score(
        cost_pressure_score * 0.22
        + fraud_score * 0.24
        + anomaly_score * 0.22
        + optimization_score * 0.12
        + equipment_score * 0.10
        + department_pressure * 0.16
    )
    fleet_health_score = _clamp_score(
        100
        - (
            risk_score * 0.24
            + cost_pressure_score * 0.16
            + fraud_score * 0.12
            + anomaly_score * 0.12
            + optimization_score * 0.10
            + equipment_score * 0.08
        )
    )
    risk_level = _risk_level_from_score(risk_score)

    critical_costs = _build_critical_cost_items(
        summary=summary,
        costly_operators=costly_operators,
        roaming_cost_mad=roaming_cost_mad,
        suspicious_cost_exposure_mad=suspicious_cost_exposure_mad,
        mobile_rows=mobile_rows,
        multimodal=multimodal,
    )
    major_anomalies = _build_major_anomalies(summary=summary, multimodal=multimodal)
    fraud_signals = _build_fraud_signals(cdr_rows=cdr_rows, multimodal=multimodal)
    optimization_opportunities = _build_optimization_opportunities(
        summary=summary,
        inactive_lines=inactive_lines,
        oversized_lines=oversized_lines,
        unused_active_plans=unused_active_plans,
        savings=savings,
        multimodal=multimodal,
        roaming_cost_mad=roaming_cost_mad,
    )
    top_recommendations = _build_top_recommendations(
        high_risk_departments=high_risk_departments,
        fraud_signals=fraud_signals,
        optimization_opportunities=optimization_opportunities,
        multimodal=multimodal,
    )
    priority_risks = _build_priority_risks(
        risk_score=risk_score,
        fraud_score=fraud_score,
        anomaly_score=anomaly_score,
        optimization_score=optimization_score,
        equipment_score=equipment_score,
        high_risk_departments=high_risk_departments,
        fraud_signals=fraud_signals,
        multimodal=multimodal,
    )
    multimodal_highlights = _build_multimodal_highlights(multimodal)
    estimated_savings_mad = round(max(savings.yearly_total, 0.0), 2)
    charts = _build_charts(
        summary=summary,
        high_risk_departments=high_risk_departments,
        costly_operators=costly_operators,
        risk_score=risk_score,
        fraud_score=fraud_score,
        optimization_score=optimization_score,
        anomaly_score=anomaly_score,
        equipment_score=equipment_score,
        suspicious_cost_exposure_mad=suspicious_cost_exposure_mad,
        roaming_cost_mad=roaming_cost_mad,
        mobile_budget_mad=sum(row["estimated_price_mad"] for row in mobile_rows),
    )

    fallback_summary = _build_executive_summary_fallback(
        risk_level=risk_level,
        fleet_health_score=fleet_health_score,
        high_risk_departments=high_risk_departments,
        costly_operators=costly_operators,
        roaming_cost_mad=roaming_cost_mad,
        suspicious_cost_exposure_mad=suspicious_cost_exposure_mad,
        multimodal=multimodal,
    )
    model_summary_facts = {
        "fleet_health_score": fleet_health_score,
        "risk_level": risk_level,
        "risk_score": risk_score,
        "fraud_score": fraud_score,
        "optimization_score": optimization_score,
        "anomaly_score": anomaly_score,
        "equipment_score": equipment_score,
        "top_department": high_risk_departments[0].department if high_risk_departments else None,
        "top_operator": costly_operators[0].operator if costly_operators else None,
        "projected_gap_mad": round(
            max(summary.projected_monthly_cost_mad - summary.total_monthly_cost_mad, 0.0),
            2,
        ),
        "roaming_cost_mad": round(roaming_cost_mad, 2),
        "suspicious_cost_exposure_mad": round(suspicious_cost_exposure_mad, 2),
        "estimated_savings_mad": estimated_savings_mad,
        "multimodal_highlights": multimodal_highlights,
        "priority_risks": priority_risks[:4],
    }
    executive_summary, fallback_used = await _generate_executive_summary(
        facts=model_summary_facts,
        fallback_summary=fallback_summary,
    )

    score_explanations = [
        _build_score_explanation(
            label="Fleet Health",
            score=fleet_health_score,
            direction="higher_is_better",
            explanation=(
                "Synthese globale de la sante de flotte, construite a partir de la pression cout, "
                "des risques fraude, des anomalies, du potentiel d'optimisation et de la dette equipement."
            ),
        ),
        _build_score_explanation(
            label="Risque global",
            score=risk_score,
            direction="higher_is_worse",
            explanation=(
                "Score transverse agregeant les departements exposes, les couts sensibles et les signaux critiques."
            ),
        ),
        _build_score_explanation(
            label="Fraude",
            score=fraud_score,
            direction="higher_is_worse",
            explanation=(
                "Base sur le ratio d'appels suspects, la severite fraude moyenne, le roaming suspect et le cout expose."
            ),
        ),
        _build_score_explanation(
            label="Optimisation",
            score=optimization_score,
            direction="higher_is_worse",
            explanation=(
                "Mesure la pression d'optimisation restante: lignes inactives, forfaits surdimensionnes, plans peu exploites et workflows lourds."
            ),
        ),
        _build_score_explanation(
            label="Anomalie",
            score=anomaly_score,
            direction="higher_is_worse",
            explanation=(
                "Reflete les depassements, alertes critiques, bottlenecks workflow et anomalies remontees par le multimodal."
            ),
        ),
        _build_score_explanation(
            label="Equipement",
            score=equipment_score,
            direction="higher_is_worse",
            explanation=(
                "Base sur la criticite mobile, l'obsolescence detectee, la maintenance et les remplacements necessaires."
            ),
        ),
    ]

    response = ExecutiveReportResponse(
        executive_summary=executive_summary,
        fleet_health_score=fleet_health_score,
        fleet_health_level=_health_level_from_score(
            fleet_health_score,
            direction="higher_is_better",
        ),
        risk_level=risk_level,
        risk_score=risk_score,
        fraud_score=fraud_score,
        optimization_score=optimization_score,
        anomaly_score=anomaly_score,
        equipment_score=equipment_score,
        critical_costs=critical_costs,
        high_risk_departments=high_risk_departments,
        costly_operators=costly_operators,
        major_anomalies=major_anomalies,
        fraud_signals=fraud_signals,
        priority_risks=priority_risks,
        optimization_opportunities=optimization_opportunities,
        top_recommendations=top_recommendations,
        estimated_savings=_format_mad(estimated_savings_mad),
        estimated_savings_mad=estimated_savings_mad,
        multimodal_highlights=multimodal_highlights,
        multimodal_analysis_count=multimodal.analysis_count,
        score_explanations=score_explanations,
        charts=charts,
        model=get_settings().ollama_model,
        sources=[
            *summary.sources,
            "customer_churn",
            "mobile_fleet",
            "cdr_analytics",
            f"multimodal:{multimodal.analysis_count}",
        ],
        summary_updated_at=summary.updated_at,
        cached=False,
        fallback_used=fallback_used,
        duration_ms=_elapsed_ms(started_at),
    )
    _store_cached_report(cache_key, response)
    EXECUTIVE_REPORT_LOGGER.info(
        "event=executive_report_completed conversation_id=%s duration_ms=%s fleet_health_score=%s risk_level=%s multimodal_count=%s",
        conversation_id,
        response.duration_ms,
        response.fleet_health_score,
        response.risk_level,
        multimodal.analysis_count,
    )
    return response
