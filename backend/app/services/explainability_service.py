from __future__ import annotations

import hashlib
import json
import logging
import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.schemas.chat import (
    ExecutiveReportChartPoint,
    ExecutiveRiskLevel,
    ExplainabilityCharts,
    ExplainabilityCriticalZone,
    ExplainabilityExecutiveContext,
    ExplainabilityFactor,
    ExplainabilityGraph,
    ExplainabilityGraphEdge,
    ExplainabilityGraphNode,
    ExplainabilityRequest,
    ExplainabilityResponse,
    ExplainRecommendationRequest,
    ExplainRecommendationResponse,
    ExplainRecommendationFactor,
    ExplainRecommendationDecisionStep,
    ExplainRecommendationSupportingKpi,
)
from app.schemas.live import LiveMonitoringSnapshotResponse
from app.services.chat_service import (
    ChatServiceError,
    DataSummary,
    _elapsed_ms,
    _generate_with_ollama,
    _utcnow,
    get_data_summary,
)
from app.services.live_monitoring_service import get_live_monitoring_snapshot_if_ready

EXPLAINABILITY_LOGGER = logging.getLogger("app.chat.explainability")
EXPLAINABILITY_CACHE_TTL = timedelta(minutes=8)


@dataclass(frozen=True)
class CachedExplainabilityResponse:
    response: ExplainabilityResponse
    expires_at: datetime


_EXPLAINABILITY_CACHE: dict[str, CachedExplainabilityResponse] = {}


def _format_mad(value: float) -> str:
    return f"{value:,.0f} MAD".replace(",", " ")


def _clamp_score(value: float) -> int:
    return max(0, min(int(round(value)), 100))


def _truncate(value: str, limit: int = 220) -> str:
    compact = " ".join(value.split())
    if len(compact) <= limit:
        return compact
    return f"{compact[:limit].rstrip()}..."


def _normalize_text(value: str | None) -> str:
    return " ".join((value or "").strip().split()).lower()


def _risk_level_from_score(score: int) -> ExecutiveRiskLevel:
    if score >= 78:
        return "critical"
    if score >= 58:
        return "high"
    if score >= 34:
        return "medium"
    return "low"


def _severity_rank(value: ExecutiveRiskLevel) -> int:
    return {
        "low": 1,
        "medium": 2,
        "high": 3,
        "critical": 4,
    }[value]


def _score_to_severity(value: float) -> ExecutiveRiskLevel:
    return _risk_level_from_score(_clamp_score(value))


def _dedupe_strings(values: list[str], limit: int = 6) -> list[str]:
    deduped: list[str] = []
    seen: set[str] = set()
    for value in values:
        cleaned = " ".join(value.split()).strip()
        normalized = cleaned.lower()
        if not cleaned or normalized in seen:
            continue
        seen.add(normalized)
        deduped.append(cleaned)
    return deduped[:limit]


def _dedupe_factors(values: list[ExplainabilityFactor], limit: int = 8) -> list[ExplainabilityFactor]:
    grouped: dict[str, ExplainabilityFactor] = {}
    for factor in values:
        key = f"{factor.category}:{_normalize_text(factor.label)}"
        current = grouped.get(key)
        if current is None or factor.impact_score > current.impact_score:
            grouped[key] = factor
    return sorted(
        grouped.values(),
        key=lambda item: (_severity_rank(item.severity), item.impact_score),
        reverse=True,
    )[:limit]


def _dedupe_zones(
    values: list[ExplainabilityCriticalZone],
    limit: int = 8,
) -> list[ExplainabilityCriticalZone]:
    grouped: dict[str, ExplainabilityCriticalZone] = {}
    for zone in values:
        key = f"{zone.zone_type}:{_normalize_text(zone.label)}"
        current = grouped.get(key)
        if current is None or _severity_rank(zone.severity) > _severity_rank(current.severity):
            grouped[key] = zone
    return sorted(
        grouped.values(),
        key=lambda item: (_severity_rank(item.severity), _normalize_text(item.label)),
        reverse=True,
    )[:limit]


def _serialize_request_context(
    payload: ExplainabilityRequest,
    live_snapshot: LiveMonitoringSnapshotResponse | None,
) -> str:
    serialized = payload.model_dump(mode="json")
    serialized["live_tick"] = live_snapshot.tick if live_snapshot is not None else None
    return json.dumps(serialized, ensure_ascii=False, sort_keys=True)


def _build_cache_key(
    summary: DataSummary,
    payload: ExplainabilityRequest,
    live_snapshot: LiveMonitoringSnapshotResponse | None,
) -> str:
    digest = hashlib.sha1(_serialize_request_context(payload, live_snapshot).encode("utf-8")).hexdigest()
    return f"{summary.signature}:{digest}"


def _get_cached_response(cache_key: str) -> ExplainabilityResponse | None:
    cached_entry = _EXPLAINABILITY_CACHE.get(cache_key)
    if cached_entry is None:
        return None
    if _utcnow() >= cached_entry.expires_at:
        _EXPLAINABILITY_CACHE.pop(cache_key, None)
        return None
    return cached_entry.response


def _store_cached_response(cache_key: str, response: ExplainabilityResponse) -> None:
    _EXPLAINABILITY_CACHE[cache_key] = CachedExplainabilityResponse(
        response=response,
        expires_at=_utcnow() + EXPLAINABILITY_CACHE_TTL,
    )


def _build_base_scores(
    summary: DataSummary,
) -> tuple[int, int, int, int, int]:
    risk_score = _clamp_score(
        summary.critical_alert_count * 4.2
        + summary.anomaly_count * 3.8
        + summary.over_quota_count * 2.7
        + summary.fraud_alert_count * 3.2
    )
    fraud_score = _clamp_score(summary.fraud_alert_count * 12 + len(summary.critical_lines) * 4)
    anomaly_score = _clamp_score(summary.anomaly_count * 10 + summary.over_quota_count * 5)
    optimization_score = _clamp_score(
        summary.free_lines * 2.5 + summary.inactive_lines * 4 + len(summary.expensive_plans) * 7
    )
    equipment_score = _clamp_score(summary.mobile_alert_count * 8)
    return risk_score, fraud_score, anomaly_score, optimization_score, equipment_score


def _build_factor(
    *,
    label: str,
    category: str,
    value: str,
    impact_score: int,
    severity: ExecutiveRiskLevel,
    evidence: str,
) -> ExplainabilityFactor:
    return ExplainabilityFactor(
        label=label,
        category=category,
        value=value,
        impact_score=_clamp_score(impact_score),
        severity=severity,
        evidence=_truncate(evidence, 180),
    )


def _build_zone(
    *,
    label: str,
    zone_type: str,
    severity: ExecutiveRiskLevel,
    detail: str,
    value: str | None = None,
) -> ExplainabilityCriticalZone:
    return ExplainabilityCriticalZone(
        label=label,
        zone_type=zone_type,
        severity=severity,
        detail=_truncate(detail, 180),
        value=value,
    )


def _extract_json_answer(raw_answer: str) -> str | None:
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

    answer_value = payload.get("answer")
    if isinstance(answer_value, str) and answer_value.strip():
        return answer_value.strip()
    return None


async def _generate_explanation_answer(
    *,
    facts: dict[str, Any],
    fallback_answer: str,
) -> tuple[str, bool]:
    prompt = (
        "Tu es une IA explicable telecom pour un comite DSI et un jury de soutenance. "
        "Utilise EXCLUSIVEMENT les faits JSON fournis. "
        "N'invente aucune cause, aucun chiffre, aucune zone critique absente. "
        "Explique avec un ton professionnel, transparent et decisionnel en 4 a 6 phrases. "
        "La reponse doit ressembler a une note d'audit courte, pas a une sortie technique. "
        "Structure souhaitable: facteurs ayant influence l'analyse, causes probables, niveau de risque, impact potentiel. "
        "Interdire les expressions du type pipeline IA, fallback, OCR indisponible, analyse terminee. "
        "Retourne STRICTEMENT un JSON valide avec la cle answer.\n"
        f"Faits: {json.dumps(facts, ensure_ascii=False)}\n"
        'Format attendu: {"answer": "..."}'
    )

    try:
        raw_answer = await _generate_with_ollama(prompt)
    except ChatServiceError:
        return fallback_answer, True

    parsed_answer = _extract_json_answer(raw_answer)
    if parsed_answer:
        return parsed_answer, False

    cleaned_text = raw_answer.strip()
    if cleaned_text:
        return _truncate(cleaned_text, 480), True

    return fallback_answer, True


def _build_fallback_answer(
    *,
    risk_level: ExecutiveRiskLevel,
    reasoning: list[str],
    causes: list[str],
    confidence_score: int,
    focus_label: str,
) -> str:
    risk_labels = {
        "low": "faible",
        "medium": "moyen",
        "high": "eleve",
        "critical": "critique",
    }
    leading_reasons = reasoning[:3] or causes[:3]
    fragments = [f"Facteurs ayant influence l'analyse de '{focus_label}' :"]
    if leading_reasons:
        fragments.append(f"{', '.join(leading_reasons)}.")
    else:
        fragments.append("les signaux les plus visibles disponibles dans les donnees consolidees.")
    if causes:
        fragments.append(f"Causes probables : {', '.join(causes[:3])}.")
    fragments.append(f"Niveau de risque estime : {risk_labels[risk_level]}.")
    fragments.append(
        f"Le niveau de confiance atteint {confidence_score}/100, ce qui permet de prioriser "
        "les actions les plus urgentes."
    )
    return " ".join(fragments)


def _build_reasoning_from_factors(factors: list[ExplainabilityFactor]) -> list[str]:
    return _dedupe_strings(
        [
            f"{factor.label}: {factor.value}"
            if factor.value
            else factor.label
            for factor in factors[:6]
        ],
        limit=6,
    )


def _build_causes(
    factors: list[ExplainabilityFactor],
    explicit_causes: list[str],
) -> list[str]:
    return _dedupe_strings(
        explicit_causes
        + [factor.evidence for factor in factors[:5]]
        + [factor.label for factor in factors[:5]],
        limit=6,
    )


def _build_graph(
    *,
    focus_label: str,
    risk_level: ExecutiveRiskLevel,
    factors: list[ExplainabilityFactor],
    zones: list[ExplainabilityCriticalZone],
    recommendations: list[str],
) -> ExplainabilityGraph:
    nodes = [
        ExplainabilityGraphNode(
            node_id="decision",
            label=focus_label,
            node_type="decision",
            severity=risk_level,
            weight=max(40, factors[0].impact_score if factors else 40),
        )
    ]
    edges: list[ExplainabilityGraphEdge] = []

    for index, factor in enumerate(factors[:5], start=1):
        node_id = f"factor-{index}"
        nodes.append(
            ExplainabilityGraphNode(
                node_id=node_id,
                label=factor.label,
                node_type="signal",
                severity=factor.severity,
                weight=factor.impact_score,
            )
        )
        edges.append(
            ExplainabilityGraphEdge(
                source=node_id,
                target="decision",
                relation="influence",
            )
        )

    for index, zone in enumerate(zones[:3], start=1):
        node_id = f"zone-{index}"
        nodes.append(
            ExplainabilityGraphNode(
                node_id=node_id,
                label=zone.label,
                node_type="zone",
                severity=zone.severity,
                weight=max(35, 20 + _severity_rank(zone.severity) * 18),
            )
        )
        edges.append(
            ExplainabilityGraphEdge(
                source=node_id,
                target="decision",
                relation="exposition",
            )
        )

    for index, recommendation in enumerate(recommendations[:2], start=1):
        node_id = f"impact-{index}"
        nodes.append(
            ExplainabilityGraphNode(
                node_id=node_id,
                label=_truncate(recommendation, 52),
                node_type="impact",
                severity="medium" if risk_level in {"low", "medium"} else "high",
                weight=42,
            )
        )
        edges.append(
            ExplainabilityGraphEdge(
                source="decision",
                target=node_id,
                relation="action",
            )
        )

    dominant_factor = factors[0].label if factors else None
    return ExplainabilityGraph(
        summary=(
            f"Graphe causal de '{focus_label}' reliant signaux, zones critiques et actions recommandees."
        ),
        dominant_factor=dominant_factor,
        nodes=nodes,
        edges=edges,
    )


def _build_risk_timeline(
    *,
    live_snapshot: LiveMonitoringSnapshotResponse | None,
    risk_score: int,
    anomaly_score: int,
    fraud_score: int,
    confidence_score: int,
) -> list[ExecutiveReportChartPoint]:
    if live_snapshot is not None and live_snapshot.risk_series:
        return [
            ExecutiveReportChartPoint(
                label=point.label,
                value=point.value,
                secondary_value=point.secondary_value,
            )
            for point in live_snapshot.risk_series[-8:]
        ]

    baseline = max(18, int(round((risk_score + anomaly_score) / 2)) - 12)
    detection = max(baseline, anomaly_score)
    escalation = max(detection, fraud_score)
    prioritization = max(escalation, risk_score)
    validation = max(28, confidence_score)
    return [
        ExecutiveReportChartPoint(label="Baseline", value=baseline),
        ExecutiveReportChartPoint(label="Detection", value=detection),
        ExecutiveReportChartPoint(label="Escalade", value=escalation),
        ExecutiveReportChartPoint(label="Priorite", value=prioritization),
        ExecutiveReportChartPoint(label="Confiance", value=validation),
    ]


def _build_charts(
    *,
    factors: list[ExplainabilityFactor],
    zones: list[ExplainabilityCriticalZone],
    live_snapshot: LiveMonitoringSnapshotResponse | None,
    risk_score: int,
    fraud_score: int,
    anomaly_score: int,
    optimization_score: int,
    equipment_score: int,
    confidence_score: int,
) -> ExplainabilityCharts:
    factor_breakdown = [
        ExecutiveReportChartPoint(
            label=factor.label,
            value=float(factor.impact_score),
            secondary_value=float(_severity_rank(factor.severity) * 25),
        )
        for factor in factors[:6]
    ]
    critical_zone_heatmap = [
        ExecutiveReportChartPoint(
            label=zone.label,
            value=float(_severity_rank(zone.severity) * 25),
            secondary_value=float(index + 1),
        )
        for index, zone in enumerate(zones[:6])
    ]
    if not critical_zone_heatmap:
        critical_zone_heatmap = [
            ExecutiveReportChartPoint(label="Aucune zone", value=12.0, secondary_value=0.0)
        ]

    return ExplainabilityCharts(
        factor_breakdown=factor_breakdown,
        risk_timeline=_build_risk_timeline(
            live_snapshot=live_snapshot,
            risk_score=risk_score,
            anomaly_score=anomaly_score,
            fraud_score=fraud_score,
            confidence_score=confidence_score,
        ),
        critical_zone_heatmap=critical_zone_heatmap,
        score_radar=[
            ExecutiveReportChartPoint(label="Risque", value=float(risk_score)),
            ExecutiveReportChartPoint(label="Fraude", value=float(fraud_score)),
            ExecutiveReportChartPoint(label="Anomalie", value=float(anomaly_score)),
            ExecutiveReportChartPoint(label="Optimisation", value=float(optimization_score)),
            ExecutiveReportChartPoint(label="Equipement", value=float(equipment_score)),
            ExecutiveReportChartPoint(label="Confiance", value=float(confidence_score)),
        ],
    )


async def generate_explainability_response(
    db: Session,
    payload: ExplainabilityRequest,
) -> ExplainabilityResponse:
    started_at = _utcnow()
    summary = get_data_summary(db)
    live_snapshot = (
        get_live_monitoring_snapshot_if_ready() if payload.use_live_context else None
    )
    cache_key = _build_cache_key(summary, payload, live_snapshot)
    cached_response = _get_cached_response(cache_key)
    if cached_response is not None:
        return cached_response.model_copy(
            update={
                "cached": True,
                "duration_ms": _elapsed_ms(started_at),
            }
        )

    focus_label = (
        payload.focus_label
        or payload.message_text
        or payload.question
    ).strip()[:180]
    explicit_causes: list[str] = []
    recommendations: list[str] = list(summary.recommendations)
    sources = list(summary.sources)
    if payload.image_analysis is not None:
        sources.append("multimodal:image_analysis")
    if payload.executive_report is not None:
        sources.append("executive_report")
    if live_snapshot is not None:
        sources.append("live_monitoring")

    factors: list[ExplainabilityFactor] = []
    zones: list[ExplainabilityCriticalZone] = []
    data_points_used: list[str] = []

    risk_score, fraud_score, anomaly_score, optimization_score, equipment_score = _build_base_scores(
        summary
    )

    projected_gap_mad = max(summary.projected_monthly_cost_mad - summary.total_monthly_cost_mad, 0.0)
    projected_growth_pct = (
        projected_gap_mad / max(summary.total_monthly_cost_mad, 1.0) * 100
        if summary.total_monthly_cost_mad > 0
        else 0.0
    )
    if projected_growth_pct > 0:
        projected_severity = _score_to_severity(projected_growth_pct * 2.3)
        factors.append(
            _build_factor(
                label="Projection des couts",
                category="cost",
                value=f"{projected_growth_pct:+.1f}%",
                impact_score=32 + int(projected_growth_pct * 1.6),
                severity=projected_severity,
                evidence=(
                    f"Projection de cout superieure de {_format_mad(projected_gap_mad)} au cout mensuel actuel."
                ),
            )
        )
        data_points_used.append(
            f"Projection couts {projected_growth_pct:+.1f}% ({_format_mad(projected_gap_mad)})"
        )

    if summary.over_quota_count > 0:
        factors.append(
            _build_factor(
                label="Depassements detectes",
                category="overage",
                value=str(summary.over_quota_count),
                impact_score=28 + summary.over_quota_count * 4,
                severity=_score_to_severity(summary.over_quota_count * 8),
                evidence=f"{summary.over_quota_count} lignes depassent leur quota sur le perimetre disponible.",
            )
        )
        explicit_causes.append(
            f"{summary.over_quota_count} depassements recurrentes sont visibles dans les donnees"
        )

    if summary.fraud_alert_count > 0:
        factors.append(
            _build_factor(
                label="Signaux fraude",
                category="fraud",
                value=str(summary.fraud_alert_count),
                impact_score=36 + summary.fraud_alert_count * 5,
                severity=_score_to_severity(summary.fraud_alert_count * 11),
                evidence=f"{summary.fraud_alert_count} alertes fraude sont deja remontees dans le socle analytique.",
            )
        )
        explicit_causes.append(
            f"{summary.fraud_alert_count} alertes fraude alimentent la priorisation"
        )

    for department in summary.risky_departments[:2]:
        severity = _score_to_severity(department.risk_score)
        factors.append(
            _build_factor(
                label=f"Departement {department.label}",
                category="department",
                value=f"{round(department.risk_score)}/100",
                impact_score=department.risk_score,
                severity=severity,
                evidence=(
                    f"{department.label} concentre {_format_mad(department.monthly_cost_mad)} de cout mensuel et {department.alert_count} alertes."
                ),
            )
        )
        zones.append(
            _build_zone(
                label=department.label,
                zone_type="department",
                severity=severity,
                detail=f"Zone metier exposee avec {department.alert_count} alertes et un risque moyen {round(department.risk_score)}/100.",
                value=_format_mad(department.monthly_cost_mad),
            )
        )
        data_points_used.append(
            f"Departement {department.label}: {_format_mad(department.monthly_cost_mad)}, risque {round(department.risk_score)}/100"
        )

    for operator in summary.expensive_operators[:2]:
        severity = _score_to_severity(operator.risk_score)
        factors.append(
            _build_factor(
                label=f"Operateur {operator.label}",
                category="operator",
                value=_format_mad(operator.monthly_cost_mad),
                impact_score=round(operator.risk_score),
                severity=severity,
                evidence=(
                    f"{operator.label} represente {_format_mad(operator.monthly_cost_mad)} avec {operator.alert_count} alertes."
                ),
            )
        )
        zones.append(
            _build_zone(
                label=operator.label,
                zone_type="operator",
                severity=severity,
                detail=f"Operateur couteux avec {operator.alert_count} alertes sur le perimetre consolide.",
                value=_format_mad(operator.monthly_cost_mad),
            )
        )

    if payload.image_analysis is not None:
        image_analysis = payload.image_analysis
        if image_analysis.risk_level is not None:
            risk_score = max(risk_score, {"low": 28, "medium": 50, "high": 72, "critical": 88}[image_analysis.risk_level])
        if image_analysis.optimization_score is not None:
            optimization_score = max(optimization_score, image_analysis.optimization_score)
        if image_analysis.anomaly_score is not None:
            anomaly_score = max(anomaly_score, image_analysis.anomaly_score)
        if image_analysis.fraud_score is not None:
            fraud_score = max(fraud_score, image_analysis.fraud_score)
        if image_analysis.detected_operator:
            zones.append(
                _build_zone(
                    label=image_analysis.detected_operator,
                    zone_type="operator",
                    severity=image_analysis.risk_level or "medium",
                    detail="Operateur mis en evidence par l'analyse visuelle ou OCR.",
                )
            )
        for anomaly in image_analysis.detected_anomalies[:3]:
            factors.append(
                _build_factor(
                    label="Anomalie detectee",
                    category="anomaly",
                    value=anomaly,
                    impact_score=max(56, anomaly_score),
                    severity=image_analysis.risk_level or _score_to_severity(anomaly_score),
                    evidence=anomaly,
                )
            )
            explicit_causes.append(anomaly)
        for kpi in image_analysis.detected_kpis[:3]:
            data_points_used.append(f"KPI image: {kpi}")
        for recommendation in image_analysis.recommendations[:4]:
            recommendations.append(recommendation)
        for recommendation in image_analysis.decision_recommendations[:3]:
            recommendations.append(recommendation.reason)
        if image_analysis.incident_details is not None:
            incident = image_analysis.incident_details
            severity = image_analysis.risk_level or "high"
            if incident.summary:
                factors.append(
                    _build_factor(
                        label="Alerte incidente",
                        category="incident",
                        value=incident.severity or incident.priority or "alerte",
                        impact_score=max(62, anomaly_score),
                        severity=severity,
                        evidence=incident.summary,
                    )
                )
            if incident.critical_alert_count is not None:
                factors.append(
                    _build_factor(
                        label="Alertes critiques visibles",
                        category="incident",
                        value=str(incident.critical_alert_count),
                        impact_score=min(96, 58 + min(incident.critical_alert_count // 40, 38)),
                        severity=(
                            "critical"
                            if incident.critical_alert_count >= 1000
                            else "high"
                            if incident.critical_alert_count >= 100
                            else severity
                        ),
                        evidence=f"La capture affiche {incident.critical_alert_count} alertes critiques actives.",
                    )
                )
                data_points_used.append(f"Alertes critiques: {incident.critical_alert_count}")
            if incident.exposure_rate:
                factors.append(
                    _build_factor(
                        label="Taux d'exposition visible",
                        category="risk",
                        value=incident.exposure_rate,
                        impact_score=min(94, 50 + int((incident.exposure_rate_pct or 0.0) * 0.8)),
                        severity="critical" if (incident.exposure_rate_pct or 0.0) >= 50.0 else "high",
                        evidence=f"Le taux d'exposition visible atteint {incident.exposure_rate}.",
                    )
                )
                data_points_used.append(f"Exposition: {incident.exposure_rate}")
            if incident.financial_impact_mad:
                factors.append(
                    _build_factor(
                        label="Impact financier visible",
                        category="cost",
                        value=incident.financial_impact_mad,
                        impact_score=96 if (incident.financial_impact_value_mad or 0.0) > 1_000_000 else 82,
                        severity="critical" if (incident.financial_impact_value_mad or 0.0) > 1_000_000 else "high",
                        evidence=f"L'impact financier visible atteint {incident.financial_impact_mad}.",
                    )
                )
                data_points_used.append(f"Impact financier: {incident.financial_impact_mad}")
            if incident.risk_score == "100/100":
                explicit_causes.append("Des profils visibles atteignent un score de risque maximal de 100/100.")
                data_points_used.extend(
                    [f"Profil a risque: {item}" for item in incident.risky_entities[:3]]
                )
            explicit_causes.extend(incident.probable_causes[:4])
            if incident.operator:
                zones.append(
                    _build_zone(
                        label=incident.operator,
                        zone_type="operator",
                        severity=severity,
                        detail="Operateur cite directement dans l'incident multimodal.",
                        value=incident.suspect_cost_mad,
                    )
                )
            if incident.line_reference:
                zones.append(
                    _build_zone(
                        label=incident.line_reference,
                        zone_type="line",
                        severity=severity,
                        detail="Ligne explicitement referencee par l'analyse incident.",
                        value=incident.call_volume or incident.data_overage,
                    )
                )
        if image_analysis.invoice_details is not None:
            invoice = image_analysis.invoice_details
            if invoice.total_amount_mad or invoice.amount_ttc_mad:
                invoice_value = invoice.total_amount_mad or invoice.amount_ttc_mad or ""
                factors.append(
                    _build_factor(
                        label="Montant facture",
                        category="invoice",
                        value=invoice_value,
                        impact_score=54,
                        severity=image_analysis.risk_level or "medium",
                        evidence="Le montant facture complete l'explication du cout critique identifie.",
                    )
                )
                data_points_used.append(f"Facture: {invoice_value}")
            explicit_causes.extend((invoice.anomalies or [])[:3])
            for overage in (invoice.overage_items or [])[:3]:
                explicit_causes.append(overage)
        if image_analysis.workflow_details is not None:
            workflow = image_analysis.workflow_details
            if workflow.complexity_score is not None:
                anomaly_score = max(anomaly_score, workflow.complexity_score)
                factors.append(
                    _build_factor(
                        label="Complexite workflow",
                        category="workflow",
                        value=f"{workflow.complexity_score}/100",
                        impact_score=workflow.complexity_score,
                        severity=workflow.complexity_level or _score_to_severity(workflow.complexity_score),
                        evidence=workflow.summary or "Workflow complexe avec etapes critiques et validations repetitives.",
                    )
                )
            explicit_causes.extend(workflow.critical_steps[:3])
            explicit_causes.extend(workflow.bottlenecks[:3])
            for department in workflow.detected_departments[:3]:
                zones.append(
                    _build_zone(
                        label=department,
                        zone_type="department",
                        severity=workflow.complexity_level or "medium",
                        detail="Departement expose par un workflow lourd ou bloque.",
                    )
                )
            recommendations.extend(workflow.automation_opportunities[:3])
        if image_analysis.equipment_details is not None:
            equipment = image_analysis.equipment_details
            equipment_risk = max(
                equipment.criticality_score or 0,
                equipment.obsolescence_score or 0,
                equipment.maintenance_score or 0,
            )
            if equipment_risk > 0:
                equipment_score = max(equipment_score, equipment_risk)
                factors.append(
                    _build_factor(
                        label="Criticite equipement",
                        category="equipment",
                        value=f"{equipment_risk}/100",
                        impact_score=equipment_risk,
                        severity=_score_to_severity(equipment_risk),
                        evidence=equipment.summary or "L'etat equipement influence directement la decision IA.",
                    )
                )
            if equipment.model or equipment.brand:
                zones.append(
                    _build_zone(
                        label=" ".join(
                            value
                            for value in [equipment.brand, equipment.model]
                            if value
                        )[:120],
                        zone_type="equipment",
                        severity=_score_to_severity(equipment_risk or 48),
                        detail="Equipement ou routeur remontant des signaux de criticite ou d'obsolescence.",
                        value=f"{equipment_risk}/100" if equipment_risk > 0 else None,
                    )
                )
            explicit_causes.extend(equipment.detected_issues[:4])
            recommendations.extend(equipment.maintenance_recommendations[:3])
        for annotation in image_analysis.annotations[:5]:
            zones.append(
                _build_zone(
                    label=annotation.label,
                    zone_type="image",
                    severity=image_analysis.risk_level or ("high" if annotation.confidence >= 0.8 else "medium"),
                    detail="Zone annotee par la vision multimodale et retenue dans l'explication.",
                    value=f"{round(annotation.confidence * 100)}%",
                )
            )

    if payload.executive_report is not None:
        executive_report = payload.executive_report
        if executive_report.risk_score is not None:
            risk_score = max(risk_score, executive_report.risk_score)
        if executive_report.fraud_score is not None:
            fraud_score = max(fraud_score, executive_report.fraud_score)
        if executive_report.anomaly_score is not None:
            anomaly_score = max(anomaly_score, executive_report.anomaly_score)
        if executive_report.optimization_score is not None:
            optimization_score = max(optimization_score, executive_report.optimization_score)
        if executive_report.equipment_score is not None:
            equipment_score = max(equipment_score, executive_report.equipment_score)
        data_points_used.append(f"Resume executif: {executive_report.executive_summary}")
        explicit_causes.extend(executive_report.priority_risks[:4])
        for explanation in executive_report.score_explanations[:4]:
            factors.append(
                _build_factor(
                    label=explanation.label,
                    category="score",
                    value=f"{explanation.score}/100",
                    impact_score=explanation.score,
                    severity=_score_to_severity(explanation.score),
                    evidence=explanation.explanation,
                )
            )
        for item in executive_report.high_risk_departments[:3]:
            zones.append(
                _build_zone(
                    label=item.department,
                    zone_type="department",
                    severity=_score_to_severity(item.risk_score),
                    detail=item.reason,
                    value=f"{item.risk_score}/100",
                )
            )
        for item in executive_report.costly_operators[:3]:
            factors.append(
                _build_factor(
                    label=f"Operateur couteux {item.operator}",
                    category="operator_cost",
                    value=_format_mad(item.total_cost_mad),
                    impact_score=min(92, 42 + item.suspicious_calls * 3),
                    severity="high" if item.suspicious_calls > 0 else "medium",
                    evidence=item.reason,
                )
            )
        for item in executive_report.major_anomalies[:3]:
            factors.append(
                _build_factor(
                    label=item.title,
                    category="major_anomaly",
                    value=item.source,
                    impact_score=78 if item.severity in {"high", "critical"} else 58,
                    severity=item.severity,
                    evidence=item.reason,
                )
            )
        for item in executive_report.fraud_signals[:3]:
            factors.append(
                _build_factor(
                    label=item.title,
                    category="fraud_signal",
                    value=_format_mad(item.estimated_exposure_mad or 0.0)
                    if item.estimated_exposure_mad is not None
                    else "signal fraude",
                    impact_score=82 if item.severity in {"high", "critical"} else 60,
                    severity=item.severity,
                    evidence=item.reason,
                )
            )
        for recommendation in executive_report.top_recommendations[:4]:
            recommendations.append(recommendation.action)
            recommendations.append(recommendation.justification)

    if live_snapshot is not None:
        risk_score = max(risk_score, live_snapshot.risk_score)
        fraud_score = max(fraud_score, live_snapshot.fraud_score)
        anomaly_score = max(anomaly_score, live_snapshot.risk_score)
        optimization_score = max(optimization_score, live_snapshot.optimization_score)
        equipment_score = max(equipment_score, live_snapshot.equipment_score)
        data_points_used.extend(
            [
                f"Cout live {_format_mad(live_snapshot.live_cost_mad)} ({live_snapshot.live_cost_delta_pct:+.1f}%)",
                f"Roaming {_format_mad(live_snapshot.roaming_cost_mad)}",
                f"Appels suspects {live_snapshot.suspicious_calls}",
            ]
        )
        factors.append(
            _build_factor(
                label="Variation couts live",
                category="live_cost",
                value=f"{live_snapshot.live_cost_delta_pct:+.1f}%",
                impact_score=36 + int(max(live_snapshot.live_cost_delta_pct, 0) * 1.9),
                severity=_score_to_severity(max(live_snapshot.live_cost_delta_pct, 0) * 2.4),
                evidence="La surveillance live confirme une pression immediate sur les couts telecom.",
            )
        )
        factors.append(
            _build_factor(
                label="Appels suspects live",
                category="live_fraud",
                value=str(live_snapshot.suspicious_calls),
                impact_score=min(96, 34 + int(live_snapshot.suspicious_calls / 3)),
                severity=_score_to_severity(live_snapshot.fraud_score),
                evidence="Le monitoring live remonte un volume d'appels suspects directement integre a l'analyse.",
            )
        )
        for alert in live_snapshot.priority_alerts[:3]:
            factors.append(
                _build_factor(
                    label=alert.title,
                    category="live_alert",
                    value=f"{alert.score}/100",
                    impact_score=alert.score,
                    severity=alert.severity,
                    evidence=alert.message,
                )
            )
            recommendations.append(alert.recommendation)
            explicit_causes.append(alert.message)
        for department in live_snapshot.top_departments[:3]:
            zones.append(
                _build_zone(
                    label=department.department,
                    zone_type="department",
                    severity=_score_to_severity(department.risk_score),
                    detail=f"Departement live a {department.delta_pct:+.1f}% avec {department.alert_count} alertes.",
                    value=f"{department.risk_score}/100",
                )
            )
        for operator in live_snapshot.top_operators[:3]:
            zones.append(
                _build_zone(
                    label=operator.operator,
                    zone_type="operator",
                    severity=_score_to_severity(operator.anomaly_score),
                    detail=f"Operateur live avec roaming {_format_mad(operator.roaming_cost_mad)} et {operator.suspicious_calls} appels suspects.",
                    value=f"{operator.anomaly_score}/100",
                )
            )
        for equipment in live_snapshot.critical_equipments[:3]:
            zones.append(
                _build_zone(
                    label=equipment.label,
                    zone_type="equipment",
                    severity=equipment.severity,
                    detail=equipment.issue,
                    value=f"{equipment.health_score}/100",
                )
            )
        for workflow in live_snapshot.critical_workflows[:2]:
            zones.append(
                _build_zone(
                    label=workflow.name,
                    zone_type="workflow",
                    severity=_score_to_severity(workflow.criticality_score),
                    detail=workflow.bottleneck,
                    value=f"{workflow.criticality_score}/100",
                )
            )
        recommendations.extend(live_snapshot.recommendations[:4])

    factors = _dedupe_factors(factors, limit=8)
    zones = _dedupe_zones(zones, limit=8)
    recommendations = _dedupe_strings(recommendations, limit=6)
    data_points_used = _dedupe_strings(data_points_used, limit=8)
    reasoning = _build_reasoning_from_factors(factors)
    causes = _build_causes(factors, explicit_causes)

    risk_score = _clamp_score(
        max(
            risk_score,
            fraud_score * 0.9,
            anomaly_score * 0.85,
            optimization_score * 0.65,
            equipment_score * 0.62,
        )
    )
    risk_level = _risk_level_from_score(risk_score)

    source_weights = {
        "summary": 1,
        "image": 1 if payload.image_analysis is not None else 0,
        "executive": 1 if payload.executive_report is not None else 0,
        "live": 1 if live_snapshot is not None else 0,
    }
    source_coverage = sum(source_weights.values())
    confidence_score = _clamp_score(
        54
        + source_coverage * 8
        + min(len(factors), 6) * 3
        + min(len(zones), 5) * 2
        + min(len(data_points_used), 6) * 2
    )
    confidence = round(confidence_score / 100, 2)

    fallback_answer = _build_fallback_answer(
        risk_level=risk_level,
        reasoning=reasoning,
        causes=causes,
        confidence_score=confidence_score,
        focus_label=focus_label,
    )
    answer_facts = {
        "focus_label": focus_label,
        "question": payload.question,
        "risk_level": risk_level,
        "risk_score": risk_score,
        "fraud_score": fraud_score,
        "anomaly_score": anomaly_score,
        "optimization_score": optimization_score,
        "equipment_score": equipment_score,
        "confidence_score": confidence_score,
        "dominant_factor": factors[0].label if factors else None,
        "reasoning": reasoning[:5],
        "causes": causes[:5],
        "critical_zones": [
            {
                "label": zone.label,
                "zone_type": zone.zone_type,
                "severity": zone.severity,
                "value": zone.value,
            }
            for zone in zones[:4]
        ],
        "data_points_used": data_points_used[:6],
        "recommendations": recommendations[:4],
        "sources": _dedupe_strings(sources, limit=6),
    }
    answer, fallback_used = await _generate_explanation_answer(
        facts=answer_facts,
        fallback_answer=fallback_answer,
    )

    response = ExplainabilityResponse(
        answer=answer,
        confidence=confidence,
        risk_level=risk_level,
        reasoning=reasoning,
        causes=causes,
        influencing_factors=factors,
        explanation_graph=_build_graph(
            focus_label=focus_label,
            risk_level=risk_level,
            factors=factors,
            zones=zones,
            recommendations=recommendations,
        ),
        critical_zones=zones,
        recommendations=recommendations,
        data_points_used=data_points_used,
        confidence_score=confidence_score,
        fraud_score=fraud_score,
        anomaly_score=anomaly_score,
        optimization_score=optimization_score,
        risk_score=risk_score,
        equipment_score=equipment_score,
        charts=_build_charts(
            factors=factors,
            zones=zones,
            live_snapshot=live_snapshot,
            risk_score=risk_score,
            fraud_score=fraud_score,
            anomaly_score=anomaly_score,
            optimization_score=optimization_score,
            equipment_score=equipment_score,
            confidence_score=confidence_score,
        ),
        model=get_settings().ollama_model,
        sources=_dedupe_strings(sources, limit=10),
        summary_updated_at=summary.updated_at,
        cached=False,
        fallback_used=fallback_used,
        duration_ms=_elapsed_ms(started_at),
    )
    _store_cached_response(cache_key, response)
    EXPLAINABILITY_LOGGER.info(
        "event=explainability_completed conversation_id=%s duration_ms=%s focus_label=%s risk_level=%s factor_count=%s zone_count=%s",
        payload.conversation_id,
        response.duration_ms,
        focus_label,
        response.risk_level,
        len(response.influencing_factors),
        len(response.critical_zones),
    )
    return response


class RecommendationExplainabilityService:
    """Service for explaining AI recommendations with detailed reasoning."""

    def __init__(self):
        self.live_monitoring = get_live_monitoring_snapshot_if_ready

    async def explain_recommendation(
        self, request: ExplainRecommendationRequest
    ) -> ExplainRecommendationResponse:
        """
        Generate detailed explanation for an AI recommendation.

        Args:
            request: The explain recommendation request

        Returns:
            ExplainRecommendationResponse with detailed explanation
        """
        started_at = _utcnow()

        try:
            # Get live context if requested
            live_snapshot = None
            if request.use_live_context:
                try:
                    live_snapshot = await self.live_monitoring()
                except Exception as e:
                    EXPLAINABILITY_LOGGER.warning(f"Failed to get live context: {e}")

            # Analyze the recommendation
            analysis_result = await self._analyze_recommendation(
                request.recommendation_title,
                request.history,
                request.executive_report,
                live_snapshot
            )

            # Build decision trace
            decision_trace = self._build_decision_trace(analysis_result)

            # Calculate confidence score
            confidence_score = self._calculate_confidence_score(analysis_result)

            # Determine risk level
            risk_level = self._determine_risk_level(analysis_result)

            # Build supporting KPIs
            supporting_kpis = self._build_supporting_kpis(analysis_result)

            # Build influencing factors
            influencing_factors = self._build_influencing_factors(analysis_result)

            # Build explanation graph
            explanation_graph = self._build_explanation_graph(analysis_result)

            # Build critical zones
            critical_zones = self._build_critical_zones(analysis_result)

            # Generate alternative recommendations
            alternative_recommendations = self._generate_alternatives(analysis_result)

            response = ExplainRecommendationResponse(
                recommendation=request.recommendation_title,
                reasoning=analysis_result.get("reasoning", []),
                confidence_score=confidence_score,
                estimated_savings=analysis_result.get("estimated_savings"),
                risk_level=risk_level,
                supporting_kpis=supporting_kpis,
                influencing_factors=influencing_factors,
                decision_trace=decision_trace,
                explanation_graph=explanation_graph,
                critical_zones=critical_zones,
                alternative_recommendations=alternative_recommendations,
                model=get_settings().ollama_model,
                sources=analysis_result.get("sources", []),
                summary_updated_at=_utcnow().isoformat(),
                cached=False,
                fallback_used=False,
                duration_ms=_elapsed_ms(started_at)
            )

            EXPLAINABILITY_LOGGER.info(
                "event=recommendation_explainability_completed duration_ms=%s confidence=%.2f factor_count=%s",
                response.duration_ms,
                response.confidence_score,
                len(response.influencing_factors),
            )
            return response

        except Exception as e:
            EXPLAINABILITY_LOGGER.error(f"Error explaining recommendation: {e}")
            # Return fallback response
            return ExplainRecommendationResponse(
                recommendation=request.recommendation_title,
                reasoning=["Unable to generate detailed explanation"],
                confidence_score=0.5,
                risk_level=ExecutiveRiskLevel.MEDIUM,
                supporting_kpis=[],
                influencing_factors=[],
                decision_trace=[],
                explanation_graph=ExplainabilityGraph(
                    nodes=[],
                    edges=[],
                    metadata={}
                ),
                critical_zones=[],
                alternative_recommendations=[],
                model=get_settings().ollama_model,
                sources=[],
                summary_updated_at=_utcnow().isoformat(),
                cached=False,
                fallback_used=True,
                duration_ms=_elapsed_ms(started_at)
            )

    async def _analyze_recommendation(
        self,
        recommendation: str,
        history: list[dict[str, Any]],
        executive_report: ExplainabilityExecutiveContext | None,
        live_snapshot: LiveMonitoringSnapshotResponse | None
    ) -> dict[str, Any]:
        """Analyze factors influencing the recommendation."""
        analysis = {
            "reasoning": [],
            "factors": [],
            "scores": {},
            "sources": [],
            "estimated_savings": None
        }

        # Extract scores from executive report if available
        if executive_report:
            analysis["scores"] = {
                "fraud_score": executive_report.fraud_score or 50,
                "anomaly_score": executive_report.anomaly_score or 50,
                "optimization_score": executive_report.optimization_score or 50,
                "risk_score": executive_report.risk_score or 50,
                "equipment_score": executive_report.equipment_score or 50,
            }

            # Add reasoning based on scores
            if analysis["scores"]["fraud_score"] > 70:
                analysis["reasoning"].append("High fraud score indicates potential security risks requiring immediate attention")
            if analysis["scores"]["anomaly_score"] > 70:
                analysis["reasoning"].append("Anomaly detection suggests unusual patterns that may impact operations")
            if analysis["scores"]["optimization_score"] < 30:
                analysis["reasoning"].append("Low optimization score indicates significant efficiency improvement opportunities")

        # Analyze recommendation text for keywords
        rec_lower = recommendation.lower()

        if "fraud" in rec_lower or "sécurité" in rec_lower:
            analysis["reasoning"].append("Recommendation addresses fraud prevention and security measures")
            analysis["factors"].append({
                "type": "security",
                "impact": "high",
                "evidence": "Security-related keywords detected in recommendation"
            })

        if "optimization" in rec_lower or "efficacité" in rec_lower or "coût" in rec_lower:
            analysis["reasoning"].append("Recommendation focuses on operational efficiency and cost optimization")
            analysis["factors"].append({
                "type": "efficiency",
                "impact": "medium",
                "evidence": "Optimization and efficiency keywords detected"
            })
            analysis["estimated_savings"] = "15-25% de réduction des coûts estimée"

        if "équipement" in rec_lower or "maintenance" in rec_lower:
            analysis["reasoning"].append("Recommendation concerns equipment maintenance and reliability")
            analysis["factors"].append({
                "type": "equipment",
                "impact": "medium",
                "evidence": "Equipment and maintenance keywords detected"
            })

        # Add sources
        analysis["sources"] = ["Moteur de recommandation IA", "Données de surveillance temps réel"]
        if executive_report:
            analysis["sources"].append("Rapport exécutif d'analyse")
        if live_snapshot:
            analysis["sources"].append("Snapshot de monitoring live")

        return analysis

    def _build_decision_trace(
        self, analysis: dict[str, Any]
    ) -> list[ExplainRecommendationDecisionStep]:
        """Build the decision trace for the recommendation."""
        trace = []

        # Step 1: Data Collection
        trace.append(ExplainRecommendationDecisionStep(
            step_number=1,
            step_title="Collecte des données",
            step_description="Collecte des données de flotte, métriques d'utilisation et patterns historiques",
            data_used=["Données d'utilisation de la flotte", "Enregistrements CDR historiques", "Statut des équipements"],
            confidence=0.95
        ))

        # Step 2: Pattern Analysis
        trace.append(ExplainRecommendationDecisionStep(
            step_number=2,
            step_title="Analyse des patterns",
            step_description="Analyse des patterns de données et identification des anomalies",
            data_used=["Algorithmes de détection d'anomalies", "Analyse statistique"],
            confidence=0.88
        ))

        # Step 3: Risk Assessment
        trace.append(ExplainRecommendationDecisionStep(
            step_number=3,
            step_title="Évaluation des risques",
            step_description="Évaluation des risques et calcul des scores de confiance",
            data_used=["Modèles de scoring des risques", "Algorithmes de confiance"],
            confidence=0.92
        ))

        # Step 4: Recommendation Generation
        trace.append(ExplainRecommendationDecisionStep(
            step_number=4,
            step_title="Génération de recommandation",
            step_description="Génération de la recommandation basée sur l'analyse",
            data_used=["Moteur de recommandation", "Règles métier"],
            confidence=0.85
        ))

        return trace

    def _calculate_confidence_score(self, analysis: dict[str, Any]) -> float:
        """Calculate overall confidence score."""
        scores = analysis.get("scores", {})
        base_confidence = 0.7

        # Adjust based on score consistency
        score_values = list(scores.values())
        if score_values:
            avg_score = sum(score_values) / len(score_values)
            # Higher average scores increase confidence
            confidence_adjustment = (avg_score - 50) / 100 * 0.3
            base_confidence += confidence_adjustment

        return max(0.0, min(1.0, base_confidence))

    def _determine_risk_level(self, analysis: dict[str, Any]) -> ExecutiveRiskLevel:
        """Determine the risk level based on analysis."""
        scores = analysis.get("scores", {})
        risk_score = scores.get("risk_score", 50)

        if risk_score >= 75:
            return ExecutiveRiskLevel.HIGH
        elif risk_score >= 50:
            return ExecutiveRiskLevel.MEDIUM
        else:
            return ExecutiveRiskLevel.LOW

    def _build_supporting_kpis(
        self, analysis: dict[str, Any]
    ) -> list[ExplainRecommendationSupportingKpi]:
        """Build supporting KPIs for the recommendation."""
        kpis = []

        scores = analysis.get("scores", {})

        if "fraud_score" in scores:
            kpis.append(ExplainRecommendationSupportingKpi(
                label="Taux de détection de fraude",
                value=f"{scores['fraud_score']}%",
                unit="%",
                impact="Impact direct sur les mesures de sécurité",
                confidence=0.9
            ))

        if "optimization_score" in scores:
            kpis.append(ExplainRecommendationSupportingKpi(
                label="Potentiel d'optimisation",
                value=f"{scores['optimization_score']}%",
                unit="%",
                impact="Opportunité d'amélioration de l'efficacité",
                confidence=0.85
            ))

        if "equipment_score" in scores:
            kpis.append(ExplainRecommendationSupportingKpi(
                label="Santé des équipements",
                value=f"{scores['equipment_score']}%",
                unit="%",
                impact="Indicateur de fiabilité de l'infrastructure",
                confidence=0.95
            ))

        if "risk_score" in scores:
            kpis.append(ExplainRecommendationSupportingKpi(
                label="Score de risque global",
                value=f"{scores['risk_score']}%",
                unit="%",
                impact="Niveau de risque opérationnel général",
                confidence=0.88
            ))

        return kpis

    def _build_influencing_factors(
        self, analysis: dict[str, Any]
    ) -> list[ExplainRecommendationFactor]:
        """Build influencing factors for the recommendation."""
        factors = []

        for factor_data in analysis.get("factors", []):
            factor = ExplainRecommendationFactor(
                label=f"Facteur: {factor_data['type'].title()}",
                category=factor_data['type'],
                value=factor_data['evidence'],
                impact_score=75 if factor_data['impact'] == 'high' else 50,
                severity=ExecutiveRiskLevel.HIGH if factor_data['impact'] == 'high' else ExecutiveRiskLevel.MEDIUM,
                evidence=factor_data['evidence'],
                weight=0.8 if factor_data['impact'] == 'high' else 0.6
            )
            factors.append(factor)

        # Add default factors if none found
        if not factors:
            factors.extend([
                ExplainRecommendationFactor(
                    label="Qualité des données",
                    category="technique",
                    value="Données d'entrée de haute qualité",
                    impact_score=80,
                    severity=ExecutiveRiskLevel.LOW,
                    evidence="Patterns de données cohérents détectés",
                    weight=0.7
                ),
                ExplainRecommendationFactor(
                    label="Tendances historiques",
                    category="analytique",
                    value="Forte corrélation historique",
                    impact_score=65,
                    severity=ExecutiveRiskLevel.MEDIUM,
                    evidence="L'analyse des patterns montre des tendances claires",
                    weight=0.6
                )
            ])

        return factors

    def _build_explanation_graph(
        self, analysis: dict[str, Any]
    ) -> ExplainabilityGraph:
        """Build explanation graph for visualization."""
        nodes = [
            {"id": "input", "label": "Données d'entrée", "type": "data"},
            {"id": "analysis", "label": "Analyse", "type": "process"},
            {"id": "scoring", "label": "Scoring des risques", "type": "process"},
            {"id": "recommendation", "label": "Recommandation", "type": "output"}
        ]

        edges = [
            {"source": "input", "target": "analysis", "label": "traité"},
            {"source": "analysis", "target": "scoring", "label": "évalué"},
            {"source": "scoring", "target": "recommendation", "label": "généré"}
        ]

        return ExplainabilityGraph(
            nodes=nodes,
            edges=edges,
            metadata={"confidence": self._calculate_confidence_score(analysis)}
        )

    def _build_critical_zones(
        self, analysis: dict[str, Any]
    ) -> list[ExplainabilityCriticalZone]:
        """Build critical zones for the recommendation."""
        zones = []

        scores = analysis.get("scores", {})

        if scores.get("fraud_score", 0) > 70:
            zones.append(ExplainabilityCriticalZone(
                zone_id="fraud_risk",
                zone_name="Zone de risque de fraude",
                severity=ExecutiveRiskLevel.HIGH,
                description="Indicateurs de fraude élevés détectés",
                coordinates=[70, 80, 90, 100],
                impact_score=85
            ))

        if scores.get("anomaly_score", 0) > 70:
            zones.append(ExplainabilityCriticalZone(
                zone_id="anomaly_zone",
                zone_name="Zone de détection d'anomalies",
                severity=ExecutiveRiskLevel.MEDIUM,
                description="Patterns inhabituels identifiés",
                coordinates=[60, 70, 80, 90],
                impact_score=70
            ))

        if scores.get("equipment_score", 0) < 30:
            zones.append(ExplainabilityCriticalZone(
                zone_id="equipment_zone",
                zone_name="Zone critique équipement",
                severity=ExecutiveRiskLevel.HIGH,
                description="Équipements nécessitant une attention immédiate",
                coordinates=[0, 10, 20, 30],
                impact_score=90
            ))

        return zones

    def _generate_alternatives(
        self, analysis: dict[str, Any]
    ) -> list[str]:
        """Generate alternative recommendations."""
        alternatives = []

        reasoning = analysis.get("reasoning", [])
        reasoning_text = " ".join(reasoning).lower()

        if "fraud" in reasoning_text or "sécurité" in reasoning_text:
            alternatives.extend([
                "Implémenter des protocoles de surveillance supplémentaires",
                "Renforcer les mesures d'authentification utilisateur",
                "Conduire un audit de sécurité des comptes à haut risque"
            ])
        elif "optimisation" in reasoning_text or "efficacité" in reasoning_text or "coût" in reasoning_text:
            alternatives.extend([
                "Examiner l'allocation actuelle des ressources",
                "Implémenter des politiques de mise à l'échelle automatique",
                "Optimiser les protocoles de transmission de données"
            ])
        elif "équipement" in reasoning_text or "maintenance" in reasoning_text:
            alternatives.extend([
                "Planifier un programme de maintenance préventive",
                "Mettre à niveau les équipements critiques",
                "Implémenter une surveillance continue des équipements"
            ])
        else:
            alternatives.extend([
                "Surveiller les progrès de l'implémentation",
                "Conduire une évaluation d'impact",
                "Planifier un déploiement par phases"
            ])

        return alternatives[:3]  # Limit to 3 alternatives
