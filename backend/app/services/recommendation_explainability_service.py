from __future__ import annotations

import hashlib
import json
import logging
import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.schemas.chat import (
    ExecutiveRiskLevel,
    ExplainRecommendationDecisionStep,
    ExplainRecommendationFactor,
    ExplainRecommendationRequest,
    ExplainRecommendationReasoning,
    ExplainRecommendationResponse,
    ExplainRecommendationSupportingKpi,
    ExplainabilityCriticalZone,
    ExplainabilityExecutiveContext,
    ExplainabilityGraph,
    ExplainabilityGraphEdge,
    ExplainabilityGraphNode,
)
from app.schemas.live import LiveMonitoringSnapshotResponse
from app.services.chat_service import (
    ChatDataUnavailableError,
    DataSummary,
    _elapsed_ms,
    _utcnow,
    get_data_summary,
)
from app.services.live_monitoring_service import get_live_monitoring_snapshot_if_ready

RECOMMENDATION_EXPLAINABILITY_LOGGER = logging.getLogger("app.chat.recommendation_explainability")
RECOMMENDATION_EXPLAINABILITY_CACHE_TTL = timedelta(minutes=8)


@dataclass(frozen=True)
class CachedRecommendationExplainabilityResponse:
    response: ExplainRecommendationResponse
    expires_at: datetime


_RECOMMENDATION_EXPLAINABILITY_CACHE: dict[str, CachedRecommendationExplainabilityResponse] = {}


def _format_mad(value: float) -> str:
    return f"{value:,.0f} MAD".replace(",", " ")


def _build_default_data_summary() -> DataSummary:
    return DataSummary(
        prompt_context="Synthese de secours pour l'explicabilite des recommandations.",
        sources=["simulation:recommendation-explainability"],
        updated_at=_utcnow().isoformat(),
        signature="recommendation-explainability-fallback",
        total_lines=0,
        active_lines=0,
        free_lines=0,
        assigned_lines=0,
        in_progress_lines=0,
        suspended_lines=0,
        inactive_lines=0,
        total_monthly_cost_mad=0.0,
        projected_monthly_cost_mad=0.0,
        alert_count=0,
        critical_alert_count=0,
        budget_alert_count=0,
        mobile_alert_count=0,
        mobile_device_total=0,
        mobile_critical_count=0,
        fraud_alert_count=0,
        total_call_count=0,
        suspicious_call_count=0,
        suspicious_call_cost_mad=0.0,
        high_cost_call_count=0,
        over_quota_count=0,
        anomaly_count=0,
        roaming_line_count=0,
        roaming_alert_count=0,
        expensive_operators=[],
        risky_departments=[],
        expensive_plans=[],
        critical_lines=[],
        recommendations=[],
        roaming_geo_highlights=[],
    )


def _clamp_score(value: float) -> int:
    return max(0, min(int(round(value)), 100))


def _truncate(value: str, limit: int = 220) -> str:
    compact = " ".join(value.split())
    if len(compact) <= limit:
        return compact
    return f"{compact[:limit].rstrip()}..."


def _fold_text(value: str | None) -> str:
    normalized = unicodedata.normalize("NFKD", value or "")
    stripped = "".join(character for character in normalized if not unicodedata.combining(character))
    return " ".join(stripped.lower().split())


def _contains_any_keyword(value: str, keywords: tuple[str, ...]) -> bool:
    return any(keyword in value for keyword in keywords)


def _severity_rank(value: ExecutiveRiskLevel) -> int:
    return {
        "low": 1,
        "medium": 2,
        "high": 3,
        "critical": 4,
    }[value]


def _risk_level_from_score(score: int) -> ExecutiveRiskLevel:
    if score >= 78:
        return "critical"
    if score >= 58:
        return "high"
    if score >= 34:
        return "medium"
    return "low"


def _score_to_severity(value: float) -> ExecutiveRiskLevel:
    return _risk_level_from_score(_clamp_score(value))


def _average(values: list[float]) -> float:
    if not values:
        return 0.0
    return sum(values) / len(values)


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


def _format_kpi_label(kpi: ExplainRecommendationSupportingKpi) -> str:
    value = kpi.value.strip()
    unit = f" {kpi.unit.strip()}" if kpi.unit else ""
    impact = _truncate(kpi.impact, 120)
    return f"{kpi.label}: {value}{unit} - {impact}"


def _build_recommendation_impact_statement(
    *,
    recommendation_title: str,
    risk_level: ExecutiveRiskLevel,
    impact_score: int,
    estimated_savings: str | None,
    critical_zones: list[ExplainabilityCriticalZone],
) -> str:
    risk_labels = {
        "low": "faible",
        "medium": "moderee",
        "high": "elevee",
        "critical": "critique",
    }
    lead_zone = critical_zones[0].label if critical_zones else "les segments les plus exposes"
    fragments = [
        f"La recommandation '{recommendation_title}' traite une exposition {risk_labels[risk_level]}",
        f"avec un impact potentiel estime a {impact_score}/100",
        f"sur {lead_zone}",
    ]
    if estimated_savings:
        fragments.append(f"et un effet economique deja projete a {estimated_savings}")
    return " ".join(fragments) + "."


def _build_business_explanation(
    *,
    recommendation_title: str,
    factor_labels: list[str],
    risk_level: ExecutiveRiskLevel,
    impact_statement: str,
) -> str:
    priority_labels = {
        "low": "basse",
        "medium": "moderee",
        "high": "elevee",
        "critical": "critique",
    }
    dominant_factors = ", ".join(factor_labels[:3]) or "les KPI telecom consolides"
    return (
        f"La recommandation '{recommendation_title}' est priorisee car {dominant_factors} "
        f"degradent directement le pilotage telecom. La priorite retenue reste "
        f"{priority_labels[risk_level]} car {impact_statement.lower()}"
    )


def _build_recommendation_reasoning_payload(
    *,
    recommendation_title: str,
    reasoning_lines: list[str],
    supporting_kpis: list[ExplainRecommendationSupportingKpi],
    factors: list[ExplainRecommendationFactor],
    critical_zones: list[ExplainabilityCriticalZone],
    risk_level: ExecutiveRiskLevel,
    impact_score: int,
    estimated_savings: str | None,
) -> ExplainRecommendationReasoning:
    factor_items = _dedupe_strings(
        reasoning_lines
        + [f"{factor.label}: {factor.evidence}" for factor in factors[:5]],
        limit=5,
    )
    kpi_items = _dedupe_strings(
        [_format_kpi_label(kpi) for kpi in supporting_kpis[:5]],
        limit=5,
    )
    risk_items = _dedupe_strings(
        [
            f"{zone.label}: {zone.detail}"
            for zone in critical_zones[:4]
            if zone.detail
        ]
        + [
            f"{factor.label}: {factor.evidence}"
            for factor in factors[:4]
            if factor.severity in {"high", "critical"}
        ],
        limit=5,
    )
    impact_statement = _build_recommendation_impact_statement(
        recommendation_title=recommendation_title,
        risk_level=risk_level,
        impact_score=impact_score,
        estimated_savings=estimated_savings,
        critical_zones=critical_zones,
    )
    business_explanation = _build_business_explanation(
        recommendation_title=recommendation_title,
        factor_labels=[factor.label for factor in factors[:4]],
        risk_level=risk_level,
        impact_statement=impact_statement,
    )
    return ExplainRecommendationReasoning(
        factors=factor_items,
        kpis=kpi_items,
        risks=risk_items,
        impact=impact_statement,
        business_explanation=business_explanation,
    )


def _text_overlap_score(left: str, right: str) -> int:
    left_tokens = {token for token in re.findall(r"[a-z0-9]+", _fold_text(left)) if len(token) >= 3}
    right_tokens = {token for token in re.findall(r"[a-z0-9]+", _fold_text(right)) if len(token) >= 3}
    return len(left_tokens & right_tokens)


def _build_base_scores(summary: DataSummary) -> tuple[int, int, int, int, int]:
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


def _dedupe_recommendation_factors(
    factors: list[ExplainRecommendationFactor],
    limit: int = 8,
) -> list[ExplainRecommendationFactor]:
    grouped: dict[str, ExplainRecommendationFactor] = {}
    for factor in factors:
        key = f"{factor.category}:{_fold_text(factor.label)}"
        current = grouped.get(key)
        if current is None or factor.impact_score > current.impact_score:
            grouped[key] = factor
    return sorted(
        grouped.values(),
        key=lambda item: (_severity_rank(item.severity), item.impact_score, item.weight),
        reverse=True,
    )[:limit]


def _dedupe_zones(
    zones: list[ExplainabilityCriticalZone],
    limit: int = 6,
) -> list[ExplainabilityCriticalZone]:
    grouped: dict[str, ExplainabilityCriticalZone] = {}
    for zone in zones:
        key = f"{zone.zone_type}:{_fold_text(zone.label)}"
        current = grouped.get(key)
        if current is None or _severity_rank(zone.severity) > _severity_rank(current.severity):
            grouped[key] = zone
    return sorted(
        grouped.values(),
        key=lambda item: (_severity_rank(item.severity), _fold_text(item.label)),
        reverse=True,
    )[:limit]


def _dedupe_supporting_kpis(
    kpis: list[ExplainRecommendationSupportingKpi],
    limit: int = 10,
) -> list[ExplainRecommendationSupportingKpi]:
    grouped: dict[str, ExplainRecommendationSupportingKpi] = {}
    for kpi in kpis:
        key = _fold_text(kpi.label)
        current = grouped.get(key)
        if current is None or kpi.confidence > current.confidence:
            grouped[key] = kpi
    return list(grouped.values())[:limit]


def _build_recommendation_cache_key(
    summary: DataSummary,
    request: ExplainRecommendationRequest,
    live_snapshot: LiveMonitoringSnapshotResponse | None,
) -> str:
    serialized = request.model_dump(mode="json")
    serialized["live_tick"] = live_snapshot.tick if live_snapshot is not None else None
    digest = hashlib.sha1(
        json.dumps(serialized, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()
    return f"{summary.signature}:{digest}"


def _get_cached_recommendation_response(
    cache_key: str,
) -> ExplainRecommendationResponse | None:
    cached_entry = _RECOMMENDATION_EXPLAINABILITY_CACHE.get(cache_key)
    if cached_entry is None:
        return None
    if _utcnow() >= cached_entry.expires_at:
        _RECOMMENDATION_EXPLAINABILITY_CACHE.pop(cache_key, None)
        return None
    return cached_entry.response


def _store_cached_recommendation_response(
    cache_key: str,
    response: ExplainRecommendationResponse,
) -> None:
    _RECOMMENDATION_EXPLAINABILITY_CACHE[cache_key] = CachedRecommendationExplainabilityResponse(
        response=response,
        expires_at=_utcnow() + RECOMMENDATION_EXPLAINABILITY_CACHE_TTL,
    )


class FactorWeightAnalyzer:
    def __init__(self) -> None:
        self._factors: list[ExplainRecommendationFactor] = []
        self._zones: list[ExplainabilityCriticalZone] = []
        self._kpis: list[ExplainRecommendationSupportingKpi] = []
        self._reasoning: list[str] = []
        self._data_points: list[str] = []

    def add_factor(
        self,
        *,
        label: str,
        category: str,
        value: str,
        impact_score: int,
        severity: ExecutiveRiskLevel,
        evidence: str,
        weight: float,
        reason: str | None = None,
        data_point: str | None = None,
    ) -> None:
        self._factors.append(
            ExplainRecommendationFactor(
                label=label,
                category=category,
                value=value,
                impact_score=_clamp_score(impact_score),
                severity=severity,
                evidence=_truncate(evidence, 180),
                weight=max(0.0, min(weight, 1.0)),
            )
        )
        if reason:
            self._reasoning.append(reason)
        if data_point:
            self._data_points.append(data_point)

    def add_zone(
        self,
        *,
        label: str,
        zone_type: str,
        severity: ExecutiveRiskLevel,
        detail: str,
        value: str | None = None,
    ) -> None:
        self._zones.append(
            ExplainabilityCriticalZone(
                label=label,
                zone_type=zone_type,
                severity=severity,
                detail=_truncate(detail, 180),
                value=value,
            )
        )

    def add_kpi(
        self,
        *,
        label: str,
        value: str,
        impact: str,
        confidence: float,
        unit: str | None = None,
    ) -> None:
        self._kpis.append(
            ExplainRecommendationSupportingKpi(
                label=label,
                value=value,
                unit=unit,
                impact=_truncate(impact, 160),
                confidence=max(0.0, min(confidence, 1.0)),
            )
        )

    def factors(self) -> list[ExplainRecommendationFactor]:
        return _dedupe_recommendation_factors(self._factors)

    def zones(self) -> list[ExplainabilityCriticalZone]:
        return _dedupe_zones(self._zones)

    def kpis(self) -> list[ExplainRecommendationSupportingKpi]:
        return _dedupe_supporting_kpis(self._kpis)

    def reasoning(self) -> list[str]:
        return _dedupe_strings(self._reasoning, limit=6)

    def data_points(self) -> list[str]:
        return _dedupe_strings(self._data_points, limit=10)


class ConfidenceScoringSystem:
    def compute(
        self,
        *,
        factors: list[ExplainRecommendationFactor],
        supporting_kpis: list[ExplainRecommendationSupportingKpi],
        sources: list[str],
        has_direct_match: bool,
        live_snapshot: LiveMonitoringSnapshotResponse | None,
    ) -> float:
        confidence = 0.56
        confidence += min(len(factors), 5) * 0.055
        confidence += min(len(supporting_kpis), 4) * 0.035
        confidence += min(len(set(sources)), 4) * 0.03
        confidence += 0.08 if has_direct_match else 0.0
        confidence += 0.03 if live_snapshot is not None else 0.0
        if len(factors) <= 1:
            confidence -= 0.09
        return round(max(0.42, min(confidence, 0.98)), 2)


class RecommendationReasoningEngine:
    COST_KEYWORDS = (
        "forfait",
        "plan",
        "cout",
        "couts",
        "budget",
        "tarif",
        "xl",
        "mad",
        "optimis",
        "econom",
        "reduction",
    )
    FRAUD_KEYWORDS = ("fraude", "suspect", "appel", "securite", "cdr")
    ROAMING_KEYWORDS = ("roaming", "international")
    EQUIPMENT_KEYWORDS = ("equip", "routeur", "materiel", "maintenance", "batterie", "obsolete")
    WORKFLOW_KEYWORDS = ("workflow", "validation", "process", "flux", "automatis")
    ANOMALY_KEYWORDS = ("anomal", "alerte", "depasse", "surconsomm", "critique")

    def __init__(self, confidence_scoring: ConfidenceScoringSystem) -> None:
        self._confidence_scoring = confidence_scoring

    def analyze(
        self,
        request: ExplainRecommendationRequest,
        summary: DataSummary,
        live_snapshot: LiveMonitoringSnapshotResponse | None,
    ) -> dict[str, Any]:
        normalized_title = _fold_text(request.recommendation_title)
        executive_report = request.executive_report
        image_analysis = request.image_analysis
        risk_score, fraud_score, anomaly_score, optimization_score, equipment_score = (
            self._resolve_scores(
                summary,
                executive_report=executive_report,
                image_analysis=image_analysis,
                live_snapshot=live_snapshot,
            )
        )
        analyzer = FactorWeightAnalyzer()
        sources = list(summary.sources)
        if executive_report is not None:
            sources.append("executive_report")
        if image_analysis is not None:
            sources.append("multimodal:image_analysis")
        if live_snapshot is not None:
            sources.append("live_monitoring")

        direct_match = self._add_direct_context_matches(
            analyzer,
            request=request,
            summary=summary,
            normalized_title=normalized_title,
            executive_report=executive_report,
            image_analysis=image_analysis,
            live_snapshot=live_snapshot,
        )
        self._add_summary_factors(
            analyzer,
            summary=summary,
            normalized_title=normalized_title,
        )
        if executive_report is not None:
            self._add_executive_report_factors(
                analyzer,
                executive_report=executive_report,
                normalized_title=normalized_title,
            )
        if image_analysis is not None:
            self._add_image_analysis_factors(
                analyzer,
                image_analysis=image_analysis,
                normalized_title=normalized_title,
            )
        if live_snapshot is not None:
            self._add_live_factors(
                analyzer,
                live_snapshot=live_snapshot,
                normalized_title=normalized_title,
            )

        factors = analyzer.factors()
        if not factors:
            analyzer.add_factor(
                label="Couverture de donnees disponible",
                category="coverage",
                value=f"{summary.total_lines} lignes analysees",
                impact_score=58,
                severity="medium",
                evidence=(
                    "La recommandation peut etre expliquee a partir des jeux de donnees telecom "
                    "actuellement consolides, sans signal additionnel specifique."
                ),
                weight=0.58,
                reason="L'explication repose sur les donnees consolidees actuellement disponibles.",
                data_point=f"Perimetre analyse: {summary.total_lines} lignes",
            )
            factors = analyzer.factors()

        estimated_savings = self._resolve_estimated_savings(
            request=request,
            executive_report=executive_report,
            normalized_title=normalized_title,
        )
        if estimated_savings is not None:
            analyzer.add_kpi(
                label="Economies possibles",
                value=estimated_savings,
                impact="Impact financier deja chiffre dans le contexte IA.",
                confidence=0.94,
            )

        analyzer.add_kpi(
            label="Score de risque global",
            value=str(risk_score),
            unit="/100",
            impact="Mesure la priorisation globale de la recommandation.",
            confidence=0.92,
        )
        analyzer.add_kpi(
            label="Risque fraude",
            value=str(fraud_score),
            unit="/100",
            impact="Pese sur les recommandations de securite, roaming et appels suspects.",
            confidence=0.88,
        )
        analyzer.add_kpi(
            label="Risque anomalie",
            value=str(anomaly_score),
            unit="/100",
            impact="Releve les depassements, alertes critiques et patterns inhabituels.",
            confidence=0.88,
        )
        analyzer.add_kpi(
            label="Risque optimisation",
            value=str(optimization_score),
            unit="/100",
            impact="Quantifie le potentiel d'economie et de rationalisation.",
            confidence=0.9,
        )
        analyzer.add_kpi(
            label="Score equipement",
            value=str(equipment_score),
            unit="/100",
            impact="Influe sur la priorite si des terminaux ou equipements sont exposes.",
            confidence=0.86,
        )
        if executive_report is not None and executive_report.fleet_health_score is not None:
            analyzer.add_kpi(
                label="Fleet Health Score",
                value=str(executive_report.fleet_health_score),
                unit="/100",
                impact="Cadre la recommandation dans la sante globale de la flotte.",
                confidence=0.93,
            )
        if live_snapshot is not None:
            analyzer.add_kpi(
                label="Variation cout live",
                value=f"{live_snapshot.live_cost_delta_pct:+.1f}",
                unit="%",
                impact="Confirme si la pression budgetaire reste active en temps reel.",
                confidence=0.84,
            )

        supporting_kpis = analyzer.kpis()
        factors = analyzer.factors()
        critical_zones = analyzer.zones()
        reasoning = analyzer.reasoning() or [factor.label for factor in factors[:4]]
        data_points_used = analyzer.data_points()
        impact_score = _clamp_score(
            _average([float(factor.impact_score) for factor in factors[:4]]) * 0.72 + risk_score * 0.28
        )
        severity_candidates = [factor.severity for factor in factors] + [self._risk_level_from_scores(
            risk_score=risk_score,
            fraud_score=fraud_score,
            anomaly_score=anomaly_score,
            optimization_score=optimization_score,
            equipment_score=equipment_score,
        )]
        if executive_report is not None and executive_report.risk_level is not None:
            severity_candidates.append(executive_report.risk_level)
        risk_level = max(severity_candidates, key=_severity_rank)
        confidence_score = self._confidence_scoring.compute(
            factors=factors,
            supporting_kpis=supporting_kpis,
            sources=sources,
            has_direct_match=direct_match,
            live_snapshot=live_snapshot,
        )
        answer = self._build_answer(
            recommendation_title=request.recommendation_title,
            factors=factors,
            risk_level=risk_level,
            confidence_score=confidence_score,
            estimated_savings=estimated_savings,
            sources=sources,
        )
        decision_trace = self._build_decision_trace(
            recommendation_title=request.recommendation_title,
            factors=factors,
            supporting_kpis=supporting_kpis,
            confidence_score=confidence_score,
        )
        explanation_graph = self._build_graph(
            recommendation_title=request.recommendation_title,
            factors=factors,
            critical_zones=critical_zones,
            estimated_savings=estimated_savings,
            risk_level=risk_level,
        )
        alternative_recommendations = self._build_alternatives(
            request=request,
            summary=summary,
            executive_report=executive_report,
            live_snapshot=live_snapshot,
        )

        return {
            "answer": answer,
            "reasoning": reasoning,
            "confidence_score": confidence_score,
            "estimated_savings": estimated_savings,
            "risk_level": risk_level,
            "impact_score": impact_score,
            "risk_score": risk_score,
            "fraud_score": fraud_score,
            "anomaly_score": anomaly_score,
            "optimization_score": optimization_score,
            "equipment_score": equipment_score,
            "supporting_kpis": supporting_kpis,
            "influencing_factors": factors,
            "decision_trace": decision_trace,
            "explanation_graph": explanation_graph,
            "critical_zones": critical_zones,
            "alternative_recommendations": alternative_recommendations,
            "data_points_used": data_points_used,
            "sources": _dedupe_strings(sources, limit=10),
        }

    def build_fallback(
        self,
        request: ExplainRecommendationRequest,
        summary: DataSummary,
        live_snapshot: LiveMonitoringSnapshotResponse | None,
    ) -> dict[str, Any]:
        risk_score, fraud_score, anomaly_score, optimization_score, equipment_score = _build_base_scores(
            summary
        )
        return {
            "answer": (
                f"La recommandation '{request.recommendation_title}' reste supportee par les donnees "
                "telecom consolidees actuellement disponibles. Aucune preuve locale plus detaillee "
                "n'a pu etre structuree automatiquement au moment de la demande."
            ),
            "reasoning": ["Analyse basee sur les KPI telecom consolides disponibles."],
            "confidence_score": 0.61,
            "estimated_savings": None,
            "risk_level": _risk_level_from_score(risk_score),
            "impact_score": risk_score,
            "risk_score": risk_score,
            "fraud_score": fraud_score,
            "anomaly_score": anomaly_score,
            "optimization_score": optimization_score,
            "equipment_score": equipment_score,
            "supporting_kpis": [
                ExplainRecommendationSupportingKpi(
                    label="Lignes analysees",
                    value=str(summary.total_lines),
                    impact="Perimetre actuel de consolidation des donnees.",
                    confidence=0.72,
                )
            ],
            "influencing_factors": [
                ExplainRecommendationFactor(
                    label="Donnees consolidees disponibles",
                    category="coverage",
                    value=f"{summary.total_lines} lignes",
                    impact_score=58,
                    severity="medium",
                    evidence="Le moteur s'appuie uniquement sur les donnees telecom presentes dans le perimetre.",
                    weight=0.58,
                )
            ],
            "decision_trace": [
                ExplainRecommendationDecisionStep(
                    step_number=1,
                    step_title="Lecture du contexte disponible",
                    step_description="Le moteur a relu les KPI et signaux actuellement consolides.",
                    data_used=[f"{summary.total_lines} lignes", *summary.sources[:3]],
                    confidence=0.61,
                )
            ],
            "explanation_graph": ExplainabilityGraph(
                summary="Graphe minimal fonde sur les donnees consolidees disponibles.",
                dominant_factor="Donnees consolidees disponibles",
                nodes=[
                    ExplainabilityGraphNode(
                        node_id="factor-1",
                        label="Donnees consolidees",
                        node_type="signal",
                        severity="medium",
                        weight=58,
                    ),
                    ExplainabilityGraphNode(
                        node_id="decision",
                        label=request.recommendation_title,
                        node_type="decision",
                        severity=_risk_level_from_score(risk_score),
                        weight=max(42, risk_score),
                    ),
                ],
                edges=[
                    ExplainabilityGraphEdge(
                        source="factor-1",
                        target="decision",
                        relation="supporte",
                    )
                ],
            ),
            "critical_zones": [],
            "alternative_recommendations": _dedupe_strings(summary.recommendations, limit=3),
            "data_points_used": [
                f"Perimetre analyse: {summary.total_lines} lignes",
                f"Risque global: {risk_score}/100",
            ],
            "sources": _dedupe_strings(
                [*summary.sources, *(["live_monitoring"] if live_snapshot is not None else [])],
                limit=6,
            ),
        }

    def _resolve_scores(
        self,
        summary: DataSummary,
        *,
        executive_report: ExplainabilityExecutiveContext | None,
        image_analysis,
        live_snapshot: LiveMonitoringSnapshotResponse | None,
    ) -> tuple[int, int, int, int, int]:
        risk_score, fraud_score, anomaly_score, optimization_score, equipment_score = _build_base_scores(
            summary
        )
        if executive_report is not None:
            risk_score = max(risk_score, executive_report.risk_score or 0)
            fraud_score = max(fraud_score, executive_report.fraud_score or 0)
            anomaly_score = max(anomaly_score, executive_report.anomaly_score or 0)
            optimization_score = max(optimization_score, executive_report.optimization_score or 0)
            equipment_score = max(equipment_score, executive_report.equipment_score or 0)
        if image_analysis is not None:
            anomaly_score = max(anomaly_score, image_analysis.anomaly_score or 0)
            fraud_score = max(fraud_score, image_analysis.fraud_score or 0)
            optimization_score = max(optimization_score, image_analysis.optimization_score or 0)
            if (
                image_analysis.equipment_details is not None
                and image_analysis.equipment_details.criticality_score is not None
            ):
                equipment_score = max(
                    equipment_score,
                    image_analysis.equipment_details.criticality_score,
                )
        if live_snapshot is not None:
            risk_score = max(risk_score, live_snapshot.risk_score)
            fraud_score = max(fraud_score, live_snapshot.fraud_score)
            optimization_score = max(optimization_score, live_snapshot.optimization_score)
            equipment_score = max(equipment_score, live_snapshot.equipment_score)
        return (
            _clamp_score(risk_score),
            _clamp_score(fraud_score),
            _clamp_score(anomaly_score),
            _clamp_score(optimization_score),
            _clamp_score(equipment_score),
        )

    def _risk_level_from_scores(
        self,
        *,
        risk_score: int,
        fraud_score: int,
        anomaly_score: int,
        optimization_score: int,
        equipment_score: int,
    ) -> ExecutiveRiskLevel:
        return _risk_level_from_score(
            max(risk_score, fraud_score, anomaly_score, optimization_score, equipment_score)
        )

    def _add_direct_context_matches(
        self,
        analyzer: FactorWeightAnalyzer,
        *,
        request: ExplainRecommendationRequest,
        summary: DataSummary,
        normalized_title: str,
        executive_report: ExplainabilityExecutiveContext | None,
        image_analysis,
        live_snapshot: LiveMonitoringSnapshotResponse | None,
    ) -> bool:
        matched = False
        if executive_report is not None:
            for recommendation in executive_report.top_recommendations:
                overlap_score = max(
                    _text_overlap_score(request.recommendation_title, recommendation.title),
                    _text_overlap_score(request.recommendation_title, recommendation.action),
                )
                if overlap_score < 2:
                    continue
                matched = True
                savings_label = (
                    _format_mad(recommendation.estimated_saving_mad)
                    if recommendation.estimated_saving_mad is not None
                    else None
                )
                analyzer.add_factor(
                    label="Decision IA priorisee",
                    category="recommendation",
                    value=recommendation.priority,
                    impact_score=74 + min(overlap_score * 4, 14),
                    severity=recommendation.priority,
                    evidence=f"{recommendation.justification} Action recommandee: {recommendation.action}",
                    weight=0.84,
                    reason=recommendation.justification,
                    data_point=savings_label if savings_label else recommendation.action,
                )
        if image_analysis is not None:
            for recommendation in image_analysis.decision_recommendations:
                overlap_score = _text_overlap_score(request.recommendation_title, recommendation.title)
                if overlap_score < 2:
                    continue
                matched = True
                analyzer.add_factor(
                    label="Recommandation multimodale",
                    category=recommendation.impact,
                    value=recommendation.priority,
                    impact_score=76 + min(overlap_score * 4, 12),
                    severity=recommendation.priority,
                    evidence=recommendation.reason,
                    weight=0.82,
                    reason=recommendation.reason,
                    data_point=recommendation.estimated_saving or recommendation.title,
                )
        if live_snapshot is not None:
            for recommendation in live_snapshot.recommendations:
                if _text_overlap_score(request.recommendation_title, recommendation) < 2:
                    continue
                matched = True
                analyzer.add_factor(
                    label="Recommendation live",
                    category="live",
                    value=f"tick {live_snapshot.tick}",
                    impact_score=74,
                    severity=_risk_level_from_score(live_snapshot.risk_score),
                    evidence=recommendation,
                    weight=0.78,
                    reason=recommendation,
                    data_point=f"Contexte live tick {live_snapshot.tick}",
                )
        if not matched:
            for recommendation in summary.recommendations:
                if _text_overlap_score(request.recommendation_title, recommendation) < 2:
                    continue
                matched = True
                analyzer.add_factor(
                    label="Recommandation consolidee",
                    category="summary",
                    value="consolidee",
                    impact_score=64,
                    severity="medium",
                    evidence=recommendation,
                    weight=0.7,
                    reason=recommendation,
                    data_point=recommendation,
                )
        return matched

    def _add_summary_factors(
        self,
        analyzer: FactorWeightAnalyzer,
        *,
        summary: DataSummary,
        normalized_title: str,
    ) -> None:
        projected_gap_mad = max(summary.projected_monthly_cost_mad - summary.total_monthly_cost_mad, 0.0)
        projected_growth_pct = (
            projected_gap_mad / max(summary.total_monthly_cost_mad, 1.0) * 100
            if summary.total_monthly_cost_mad > 0
            else 0.0
        )
        cost_focus = _contains_any_keyword(normalized_title, self.COST_KEYWORDS)
        roaming_focus = _contains_any_keyword(normalized_title, self.ROAMING_KEYWORDS)
        fraud_focus = _contains_any_keyword(normalized_title, self.FRAUD_KEYWORDS)
        equipment_focus = _contains_any_keyword(normalized_title, self.EQUIPMENT_KEYWORDS)
        workflow_focus = _contains_any_keyword(normalized_title, self.WORKFLOW_KEYWORDS)
        anomaly_focus = _contains_any_keyword(normalized_title, self.ANOMALY_KEYWORDS)

        if projected_gap_mad > 0 and (cost_focus or anomaly_focus or roaming_focus):
            analyzer.add_factor(
                label="Cout eleve",
                category="cost",
                value=f"{projected_growth_pct:+.1f}%",
                impact_score=68 + int(min(projected_growth_pct, 16) * 1.8),
                severity=_score_to_severity(projected_growth_pct * 2.4),
                evidence=f"La projection mensuelle depasse le cout actuel de {_format_mad(projected_gap_mad)}.",
                weight=0.78,
                reason="La pression budgetaire reste elevee sur le perimetre telecom analyse.",
                data_point=f"Projection couts {projected_growth_pct:+.1f}% ({_format_mad(projected_gap_mad)})",
            )

        if summary.over_quota_count > 0 and (cost_focus or anomaly_focus or roaming_focus):
            analyzer.add_factor(
                label="Depassements recurrents",
                category="overage",
                value=str(summary.over_quota_count),
                impact_score=62 + min(summary.over_quota_count * 5, 24),
                severity=_score_to_severity(summary.over_quota_count * 9),
                evidence=f"{summary.over_quota_count} lignes depassent deja leur quota sur le perimetre disponible.",
                weight=0.72,
                reason="Les depassements repetes renforcent la recommandation de correction ou d'optimisation.",
                data_point=f"{summary.over_quota_count} depassements de quota",
            )

        if (summary.roaming_alert_count > 0 or summary.roaming_line_count > 0) and (
            roaming_focus or cost_focus or fraud_focus
        ):
            analyzer.add_factor(
                label="Roaming excessif",
                category="roaming",
                value=f"{summary.roaming_alert_count} alertes",
                impact_score=66 + min(summary.roaming_alert_count * 6, 22),
                severity=_score_to_severity(summary.roaming_alert_count * 11),
                evidence=f"{summary.roaming_alert_count} alertes roaming sur {summary.roaming_line_count} lignes exposees.",
                weight=0.8,
                reason="Le roaming concentre une part visible de l'exposition actuelle.",
                data_point=f"Roaming: {summary.roaming_alert_count} alertes / {summary.roaming_line_count} lignes",
            )

        if (summary.fraud_alert_count > 0 or summary.suspicious_call_count > 0) and (
            fraud_focus or anomaly_focus or roaming_focus
        ):
            analyzer.add_factor(
                label="Appels suspects",
                category="fraud",
                value=str(summary.suspicious_call_count),
                impact_score=70 + min(summary.fraud_alert_count * 6, 18),
                severity=_score_to_severity(summary.fraud_alert_count * 12 + summary.suspicious_call_count * 0.6),
                evidence=(
                    f"{summary.fraud_alert_count} alertes fraude et {summary.suspicious_call_count} appels suspects sont deja remontes."
                ),
                weight=0.82,
                reason="Les signaux fraude ou haut cout justifient une recommandation de protection ou de controle.",
                data_point=f"Fraude: {summary.fraud_alert_count} alertes / {summary.suspicious_call_count} appels suspects",
            )

        if summary.inactive_lines > 0 and (cost_focus or workflow_focus):
            analyzer.add_factor(
                label="Faible utilisation",
                category="usage",
                value=str(summary.inactive_lines),
                impact_score=58 + min(summary.inactive_lines * 4, 20),
                severity=_score_to_severity(summary.inactive_lines * 7),
                evidence=f"{summary.inactive_lines} lignes inactives restent visibles dans le perimetre consolide.",
                weight=0.66,
                reason="La presence de lignes inactives confirme un potentiel d'optimisation non exploite.",
                data_point=f"{summary.inactive_lines} lignes inactives",
            )

        if summary.free_lines > 0 and cost_focus:
            analyzer.add_factor(
                label="Capacite sous-utilisee",
                category="usage",
                value=str(summary.free_lines),
                impact_score=54 + min(summary.free_lines * 3, 18),
                severity=_score_to_severity(summary.free_lines * 5),
                evidence=f"{summary.free_lines} lignes libres reduisent l'efficacite globale d'allocation des ressources.",
                weight=0.62,
                reason="Des capacites telecom restent non exploitees dans la flotte.",
                data_point=f"{summary.free_lines} lignes libres",
            )

        if summary.mobile_alert_count > 0 and equipment_focus:
            analyzer.add_factor(
                label="Equipement obsolete",
                category="equipment",
                value=str(summary.mobile_alert_count),
                impact_score=64 + min(summary.mobile_alert_count * 5, 18),
                severity=_score_to_severity(summary.mobile_alert_count * 10),
                evidence=f"{summary.mobile_alert_count} alertes equipement sont deja presentes dans les donnees telecom.",
                weight=0.74,
                reason="Les alertes equipement renforcent la priorite de maintenance ou de remplacement.",
                data_point=f"{summary.mobile_alert_count} alertes equipement",
            )

        if summary.anomaly_count > 0 and (anomaly_focus or workflow_focus):
            analyzer.add_factor(
                label="Anomalies detectees",
                category="anomaly",
                value=str(summary.anomaly_count),
                impact_score=60 + min(summary.anomaly_count * 5, 20),
                severity=_score_to_severity(summary.anomaly_count * 10),
                evidence=f"{summary.anomaly_count} anomalies sont deja consolidees dans les jeux de donnees.",
                weight=0.7,
                reason="Les anomalies actuelles soutiennent la recommandation d'action prioritaire.",
                data_point=f"{summary.anomaly_count} anomalies consolidees",
            )

        if summary.expensive_operators and cost_focus:
            top_operator = summary.expensive_operators[0]
            analyzer.add_zone(
                label=top_operator.label,
                zone_type="operator",
                severity=_score_to_severity(top_operator.risk_score),
                detail=(
                    f"Operateur le plus couteux du perimetre avec {_format_mad(top_operator.monthly_cost_mad)} "
                    f"et {top_operator.alert_count} alertes."
                ),
                value=f"{round(top_operator.risk_score)}/100",
            )
        if summary.risky_departments and (anomaly_focus or fraud_focus or workflow_focus):
            top_department = summary.risky_departments[0]
            analyzer.add_zone(
                label=top_department.label,
                zone_type="department",
                severity=_score_to_severity(top_department.risk_score),
                detail=(
                    f"Departement le plus expose avec {top_department.alert_count} alertes "
                    f"et {_format_mad(top_department.monthly_cost_mad)} de cout mensuel."
                ),
                value=f"{round(top_department.risk_score)}/100",
            )

    def _add_executive_report_factors(
        self,
        analyzer: FactorWeightAnalyzer,
        *,
        executive_report: ExplainabilityExecutiveContext,
        normalized_title: str,
    ) -> None:
        if executive_report.high_risk_departments:
            top_department = executive_report.high_risk_departments[0]
            analyzer.add_zone(
                label=top_department.department,
                zone_type="department",
                severity=_score_to_severity(top_department.risk_score),
                detail=top_department.reason,
                value=f"{top_department.risk_score}/100",
            )

        if executive_report.costly_operators and _contains_any_keyword(normalized_title, self.COST_KEYWORDS):
            top_operator = executive_report.costly_operators[0]
            analyzer.add_factor(
                label="Operateur couteux",
                category="operator",
                value=_format_mad(top_operator.total_cost_mad),
                impact_score=62 + min(int(top_operator.total_cost_mad / 15000), 18),
                severity=_score_to_severity(top_operator.suspicious_calls * 5 + top_operator.roaming_lines * 4),
                evidence=top_operator.reason,
                weight=0.68,
                reason="Le poids budgetaire operateur reste determinant dans la recommandation.",
                data_point=f"{top_operator.operator}: {_format_mad(top_operator.total_cost_mad)}",
            )

        for fraud_signal in executive_report.fraud_signals[:3]:
            if not _contains_any_keyword(normalized_title, self.FRAUD_KEYWORDS + self.ROAMING_KEYWORDS):
                continue
            analyzer.add_factor(
                label="Fraude potentielle",
                category="fraud",
                value=(
                    _format_mad(fraud_signal.estimated_exposure_mad)
                    if fraud_signal.estimated_exposure_mad is not None
                    else fraud_signal.severity
                ),
                impact_score=68 + (12 if fraud_signal.severity in {"high", "critical"} else 4),
                severity=fraud_signal.severity,
                evidence=fraud_signal.reason,
                weight=0.76,
                reason=fraud_signal.reason,
                data_point=fraud_signal.title,
            )

        for anomaly in executive_report.major_anomalies[:3]:
            if not _contains_any_keyword(normalized_title, self.ANOMALY_KEYWORDS + self.WORKFLOW_KEYWORDS):
                continue
            analyzer.add_factor(
                label="Anomalie prioritaire",
                category="anomaly",
                value=anomaly.source,
                impact_score=66 + (10 if anomaly.severity in {"high", "critical"} else 4),
                severity=anomaly.severity,
                evidence=anomaly.reason,
                weight=0.72,
                reason=anomaly.reason,
                data_point=anomaly.title,
            )

        for explanation in executive_report.score_explanations[:5]:
            folded_label = _fold_text(explanation.label)
            if "fraude" in folded_label and not _contains_any_keyword(normalized_title, self.FRAUD_KEYWORDS):
                continue
            if "optimisation" in folded_label and not _contains_any_keyword(
                normalized_title,
                self.COST_KEYWORDS + self.WORKFLOW_KEYWORDS,
            ):
                continue
            if "equipement" in folded_label and not _contains_any_keyword(normalized_title, self.EQUIPMENT_KEYWORDS):
                continue
            analyzer.add_factor(
                label=explanation.label,
                category="score",
                value=f"{explanation.score}/100",
                impact_score=explanation.score,
                severity="medium" if explanation.score < 60 else "high",
                evidence=explanation.explanation,
                weight=max(0.52, min(explanation.score / 100, 0.9)),
                reason=explanation.explanation,
                data_point=f"{explanation.label}: {explanation.score}/100",
            )

    def _add_image_analysis_factors(
        self,
        analyzer: FactorWeightAnalyzer,
        *,
        image_analysis,
        normalized_title: str,
    ) -> None:
        if image_analysis.incident_details is not None:
            incident = image_analysis.incident_details
            severity = (
                incident.priority
                if incident.priority in {"low", "medium", "high", "critical"}
                else image_analysis.risk_level
                or "medium"
            )
            analyzer.add_factor(
                label="Alerte critique",
                category="alert",
                value=incident.alert_type or incident.severity or "alerte",
                impact_score=72 + min(len(incident.probable_causes) * 4, 12),
                severity=severity,
                evidence=incident.summary or "Un incident prioritaire est detecte dans l'analyse image.",
                weight=0.82,
                reason=incident.summary or "L'image signale un incident telecom critique.",
                data_point=incident.line_reference or incident.detected_at or "Incident image",
            )
            if incident.critical_alert_count is not None:
                analyzer.add_factor(
                    label="Alertes critiques visibles",
                    category="alert",
                    value=str(incident.critical_alert_count),
                    impact_score=min(96, 58 + min(incident.critical_alert_count // 40, 38)),
                    severity=(
                        "critical"
                        if incident.critical_alert_count >= 1000
                        else "high"
                        if incident.critical_alert_count >= 100
                        else severity
                    ),
                    evidence=(
                        f"La capture affiche {incident.critical_alert_count} alertes critiques actives."
                    ),
                    weight=0.88,
                    reason=(
                        f"Le niveau de risque augmente car {incident.critical_alert_count} alertes critiques sont visibles."
                    ),
                    data_point=f"{incident.critical_alert_count} alertes critiques",
                )
            if incident.exposure_rate:
                analyzer.add_factor(
                    label="Taux d'exposition visible",
                    category="risk",
                    value=incident.exposure_rate,
                    impact_score=min(94, 50 + int((incident.exposure_rate_pct or 0.0) * 0.8)),
                    severity="critical" if (incident.exposure_rate_pct or 0.0) >= 50.0 else "high",
                    evidence=f"Le taux d'exposition visible atteint {incident.exposure_rate}.",
                    weight=0.84,
                    reason=f"Le taux d'exposition visible a {incident.exposure_rate} justifie une priorisation renforcee.",
                    data_point=incident.exposure_rate,
                )
            if incident.financial_impact_mad:
                analyzer.add_factor(
                    label="Impact financier visible",
                    category="cost",
                    value=incident.financial_impact_mad,
                    impact_score=96 if (incident.financial_impact_value_mad or 0.0) > 1_000_000 else 82,
                    severity="critical" if (incident.financial_impact_value_mad or 0.0) > 1_000_000 else "high",
                    evidence=(
                        f"L'impact financier visible atteint {incident.financial_impact_mad}."
                    ),
                    weight=0.9,
                    reason=(
                        f"Le risque financier est eleve car la capture affiche {incident.financial_impact_mad} d'impact potentiel."
                    ),
                    data_point=incident.financial_impact_mad,
                )
            if incident.risk_score == "100/100":
                for entity in incident.risky_entities[:3]:
                    analyzer.add_factor(
                        label="Profil a risque maximal",
                        category="fraud",
                        value="100/100",
                        impact_score=92,
                        severity="critical",
                        evidence=f"{entity} presente un score visible de 100/100.",
                        weight=0.9,
                        reason="Un score de risque maximal visible impose un audit prioritaire.",
                        data_point=entity,
                    )
            for cause in incident.probable_causes[:3]:
                if _contains_any_keyword(_fold_text(cause), self.ROAMING_KEYWORDS):
                    analyzer.add_factor(
                        label="Cause probable roaming",
                        category="roaming",
                        value="image",
                        impact_score=74,
                        severity="high",
                        evidence=cause,
                        weight=0.76,
                        reason=cause,
                        data_point=cause,
                    )

        if image_analysis.workflow_details is not None:
            workflow = image_analysis.workflow_details
            analyzer.add_factor(
                label="Workflow complexe",
                category="workflow",
                value=(
                    f"{workflow.complexity_score}/100"
                    if workflow.complexity_score is not None
                    else workflow.workflow_type or "workflow"
                ),
                impact_score=workflow.complexity_score or 68,
                severity=workflow.complexity_level or "medium",
                evidence=workflow.summary or "Le workflow comporte plusieurs etapes critiques.",
                weight=max(0.6, min((workflow.complexity_score or 68) / 100, 0.9)),
                reason=workflow.summary or "Le workflow detecte augmente la charge de traitement.",
                data_point=(
                    f"{len(workflow.critical_steps)} etapes critiques"
                    if workflow.critical_steps
                    else "Workflow image"
                ),
            )
            for department in workflow.detected_departments[:2]:
                analyzer.add_zone(
                    label=department,
                    zone_type="workflow",
                    severity=workflow.complexity_level or "medium",
                    detail=workflow.summary or "Workflow expose sur plusieurs departements.",
                    value=(
                        f"{workflow.complexity_score}/100"
                        if workflow.complexity_score is not None
                        else None
                    ),
                )

        if image_analysis.equipment_details is not None:
            equipment = image_analysis.equipment_details
            equipment_severity = (
                "critical"
                if equipment.replacement_needed
                else "high"
                if (equipment.criticality_score or 0) >= 70
                else "medium"
            )
            analyzer.add_factor(
                label="Equipement a risque",
                category="equipment",
                value=(
                    f"{equipment.criticality_score}/100"
                    if equipment.criticality_score is not None
                    else equipment.equipment_type or "equipement"
                ),
                impact_score=max(equipment.criticality_score or 0, equipment.maintenance_score or 0, 62),
                severity=equipment_severity,
                evidence=equipment.summary or "L'equipement analyse presente un risque technique.",
                weight=max(
                    0.62,
                    min(
                        max(
                            float(equipment.criticality_score or 0),
                            float(equipment.maintenance_score or 0),
                            62.0,
                        )
                        / 100,
                        0.94,
                    ),
                ),
                reason=equipment.summary or "L'equipement demande une action technique.",
                data_point=equipment.model or equipment.brand or "Equipement image",
            )
            analyzer.add_zone(
                label=equipment.model or equipment.equipment_type or "Equipement",
                zone_type="equipment",
                severity=equipment_severity,
                detail=equipment.summary or "Zone technique critique detectee sur l'image.",
                value=(
                    f"{equipment.criticality_score}/100"
                    if equipment.criticality_score is not None
                    else None
                ),
            )

        for anomaly in image_analysis.detected_anomalies[:3]:
            analyzer.add_factor(
                label="Anomalie image",
                category="anomaly",
                value="multimodal",
                impact_score=64,
                severity=image_analysis.risk_level or "medium",
                evidence=anomaly,
                weight=0.66,
                reason=anomaly,
                data_point=anomaly,
            )

        for kpi in image_analysis.detected_kpis[:3]:
            analyzer.add_kpi(
                label="KPI image",
                value=kpi,
                impact="Mesure extraite par OCR / vision et reutilisee dans la justification.",
                confidence=0.82,
            )

    def _add_live_factors(
        self,
        analyzer: FactorWeightAnalyzer,
        *,
        live_snapshot: LiveMonitoringSnapshotResponse,
        normalized_title: str,
    ) -> None:
        if live_snapshot.priority_alerts:
            top_alert = live_snapshot.priority_alerts[0]
            if _contains_any_keyword(
                normalized_title,
                self.ROAMING_KEYWORDS + self.FRAUD_KEYWORDS + self.ANOMALY_KEYWORDS + self.COST_KEYWORDS,
            ):
                analyzer.add_factor(
                    label="Alerte live prioritaire",
                    category="live",
                    value=f"{top_alert.score}/100",
                    impact_score=top_alert.score,
                    severity=top_alert.severity,
                    evidence=top_alert.message,
                    weight=max(0.66, min(top_alert.score / 100, 0.92)),
                    reason=top_alert.recommendation,
                    data_point=top_alert.title,
                )
                analyzer.add_zone(
                    label=top_alert.department or top_alert.operator or top_alert.title,
                    zone_type=top_alert.category,
                    severity=top_alert.severity,
                    detail=top_alert.message,
                    value=f"{top_alert.score}/100",
                )
        if live_snapshot.roaming_cost_mad > 0 and _contains_any_keyword(normalized_title, self.ROAMING_KEYWORDS):
            analyzer.add_kpi(
                label="Cout roaming live",
                value=_format_mad(live_snapshot.roaming_cost_mad),
                impact="Expose la pression roaming actuelle en temps reel.",
                confidence=0.84,
            )

    def _resolve_estimated_savings(
        self,
        *,
        request: ExplainRecommendationRequest,
        executive_report: ExplainabilityExecutiveContext | None,
        normalized_title: str,
    ) -> str | None:
        if executive_report is None:
            return None
        for recommendation in executive_report.top_recommendations:
            if max(
                _text_overlap_score(request.recommendation_title, recommendation.title),
                _text_overlap_score(request.recommendation_title, recommendation.action),
            ) < 2:
                continue
            if recommendation.estimated_saving_mad is not None:
                return f"{_format_mad(recommendation.estimated_saving_mad)}/an"
        if executive_report.estimated_savings and _contains_any_keyword(
            normalized_title,
            self.COST_KEYWORDS + self.WORKFLOW_KEYWORDS,
        ):
            label = executive_report.estimated_savings.strip()
            return f"{label}/an" if "/an" not in label else label
        return None

    def _build_answer(
        self,
        *,
        recommendation_title: str,
        factors: list[ExplainRecommendationFactor],
        risk_level: ExecutiveRiskLevel,
        confidence_score: float,
        estimated_savings: str | None,
        sources: list[str],
    ) -> str:
        factor_labels = ", ".join(factor.label.lower() for factor in factors[:3])
        answer = (
            f"La recommandation '{recommendation_title}' reste prioritaire car {factor_labels or 'les KPI telecom consolides'} "
            "poussent la decision dans le meme sens et confirment une pression metier qui doit etre traitee "
            f"sans attendre. Le niveau de priorite retenu est {risk_level}."
        )
        if estimated_savings:
            answer += f" L'impact financier deja chiffre est {estimated_savings}."
        if sources:
            source_labels = ", ".join(_dedupe_strings(sources, limit=3))
            answer += f" Cette lecture s'appuie sur les sources consolidees suivantes: {source_labels}."
        return _truncate(answer, 480)

    def _build_decision_trace(
        self,
        *,
        recommendation_title: str,
        factors: list[ExplainRecommendationFactor],
        supporting_kpis: list[ExplainRecommendationSupportingKpi],
        confidence_score: float,
    ) -> list[ExplainRecommendationDecisionStep]:
        trace: list[ExplainRecommendationDecisionStep] = [
            ExplainRecommendationDecisionStep(
                step_number=1,
                step_title="Collecte des donnees",
                step_description=(
                    "Lecture du contexte telecom consolide, des recommandations IA, des scores et des signaux live disponibles."
                ),
                data_used=[kpi.label for kpi in supporting_kpis[:3]] or ["KPI telecom consolides"],
                confidence=min(0.98, confidence_score + 0.08),
            )
        ]
        for index, factor in enumerate(factors[:4], start=2):
            if factor.category in {"cost", "usage", "overage"}:
                step_title = f"Detection {factor.label.lower()}"
            elif factor.category in {"fraud", "roaming"}:
                step_title = f"Evaluation {factor.label.lower()}"
            elif factor.category in {"equipment", "workflow"}:
                step_title = f"Verification {factor.label.lower()}"
            else:
                step_title = f"Analyse {factor.label.lower()}"
            trace.append(
                ExplainRecommendationDecisionStep(
                    step_number=index,
                    step_title=step_title,
                    step_description=(
                        f"Le moteur XAI a retenu '{factor.label}' comme facteur influent pour justifier "
                        f"la recommandation '{recommendation_title}'."
                    ),
                    data_used=[factor.value, factor.evidence],
                    confidence=max(0.52, min(factor.weight + 0.12, 0.97)),
                )
            )
        trace.append(
            ExplainRecommendationDecisionStep(
                step_number=len(trace) + 1,
                step_title="Priorisation de la recommandation",
                step_description=(
                    "Les facteurs dominants ont ete agreges pour confirmer la priorite, l'impact et la confiance de la recommandation."
                ),
                data_used=[factor.label for factor in factors[:4]],
                confidence=confidence_score,
            )
        )
        return trace[:6]

    def _build_graph(
        self,
        *,
        recommendation_title: str,
        factors: list[ExplainRecommendationFactor],
        critical_zones: list[ExplainabilityCriticalZone],
        estimated_savings: str | None,
        risk_level: ExecutiveRiskLevel,
    ) -> ExplainabilityGraph:
        nodes = [
            ExplainabilityGraphNode(
                node_id="decision",
                label=recommendation_title,
                node_type="decision",
                severity=risk_level,
                weight=max(48, factors[0].impact_score if factors else 48),
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
        for index, zone in enumerate(critical_zones[:3], start=1):
            node_id = f"zone-{index}"
            nodes.append(
                ExplainabilityGraphNode(
                    node_id=node_id,
                    label=zone.label,
                    node_type="zone",
                    severity=zone.severity,
                    weight=max(34, 20 + _severity_rank(zone.severity) * 18),
                )
            )
            edges.append(
                ExplainabilityGraphEdge(
                    source=node_id,
                    target="decision",
                    relation="exposition",
                )
            )
        if estimated_savings:
            nodes.append(
                ExplainabilityGraphNode(
                    node_id="impact-1",
                    label=_truncate(estimated_savings, 42),
                    node_type="impact",
                    severity="medium" if risk_level in {"low", "medium"} else "high",
                    weight=56,
                )
            )
            edges.append(
                ExplainabilityGraphEdge(
                    source="decision",
                    target="impact-1",
                    relation="impact",
                )
            )
        return ExplainabilityGraph(
            summary=(
                f"Graphe causal reliant facteurs influents, zones critiques et impacts directs pour '{recommendation_title}'."
            ),
            dominant_factor=factors[0].label if factors else None,
            nodes=nodes,
            edges=edges,
        )

    def _build_alternatives(
        self,
        *,
        request: ExplainRecommendationRequest,
        summary: DataSummary,
        executive_report: ExplainabilityExecutiveContext | None,
        live_snapshot: LiveMonitoringSnapshotResponse | None,
    ) -> list[str]:
        alternatives: list[str] = []
        if executive_report is not None:
            alternatives.extend(
                item.action
                for item in executive_report.top_recommendations
                if _text_overlap_score(request.recommendation_title, item.action) < 2
            )
        alternatives.extend(summary.recommendations)
        if live_snapshot is not None:
            alternatives.extend(live_snapshot.recommendations)
        filtered = [
            alternative
            for alternative in alternatives
            if _text_overlap_score(request.recommendation_title, alternative) < 2
        ]
        return _dedupe_strings(filtered, limit=3)


class RecommendationExplainabilityService:
    def __init__(self, db: Session) -> None:
        self._db = db
        self._confidence_scoring = ConfidenceScoringSystem()
        self._reasoning_engine = RecommendationReasoningEngine(self._confidence_scoring)

    async def explain_recommendation(
        self,
        request: ExplainRecommendationRequest,
    ) -> ExplainRecommendationResponse:
        started_at = _utcnow()
        try:
            summary = get_data_summary(self._db)
        except ChatDataUnavailableError:
            RECOMMENDATION_EXPLAINABILITY_LOGGER.warning(
                "event=recommendation_explainability_summary_fallback recommendation=%s",
                request.recommendation_title,
            )
            summary = _build_default_data_summary()
        live_snapshot = (
            get_live_monitoring_snapshot_if_ready() if request.use_live_context else None
        )
        cache_key = _build_recommendation_cache_key(summary, request, live_snapshot)
        cached_response = _get_cached_recommendation_response(cache_key)
        if cached_response is not None:
            return cached_response.model_copy(
                update={
                    "cached": True,
                    "duration_ms": _elapsed_ms(started_at),
                }
            )

        fallback_used = False
        try:
            analysis_result = self._reasoning_engine.analyze(
                request,
                summary,
                live_snapshot,
            )
        except Exception:  # pragma: no cover - defensive fallback
            RECOMMENDATION_EXPLAINABILITY_LOGGER.exception(
                "event=recommendation_explainability_failed recommendation=%s",
                request.recommendation_title,
            )
            analysis_result = self._reasoning_engine.build_fallback(
                request,
                summary,
                live_snapshot,
            )
            fallback_used = True

        response = ExplainRecommendationResponse(
            recommendation=request.recommendation_title,
            answer=analysis_result["answer"],
            reasoning=_build_recommendation_reasoning_payload(
                recommendation_title=request.recommendation_title,
                reasoning_lines=analysis_result["reasoning"],
                supporting_kpis=analysis_result["supporting_kpis"],
                factors=analysis_result["influencing_factors"],
                critical_zones=analysis_result["critical_zones"],
                risk_level=analysis_result["risk_level"],
                impact_score=analysis_result["impact_score"],
                estimated_savings=analysis_result["estimated_savings"],
            ),
            confidence_score=analysis_result["confidence_score"],
            estimated_savings=analysis_result["estimated_savings"],
            risk_level=analysis_result["risk_level"],
            impact_score=analysis_result["impact_score"],
            risk_score=analysis_result["risk_score"],
            fraud_score=analysis_result["fraud_score"],
            anomaly_score=analysis_result["anomaly_score"],
            optimization_score=analysis_result["optimization_score"],
            equipment_score=analysis_result["equipment_score"],
            supporting_kpis=analysis_result["supporting_kpis"],
            influencing_factors=analysis_result["influencing_factors"],
            decision_trace=analysis_result["decision_trace"],
            explanation_graph=analysis_result["explanation_graph"],
            critical_zones=analysis_result["critical_zones"],
            alternative_recommendations=analysis_result["alternative_recommendations"],
            data_points_used=analysis_result["data_points_used"],
            model=get_settings().ollama_model,
            sources=analysis_result["sources"],
            summary_updated_at=summary.updated_at,
            cached=False,
            fallback_used=fallback_used,
            duration_ms=_elapsed_ms(started_at),
        )
        _store_cached_recommendation_response(cache_key, response)
        RECOMMENDATION_EXPLAINABILITY_LOGGER.info(
            "event=recommendation_explainability_completed recommendation=%s duration_ms=%s confidence=%s factor_count=%s",
            request.recommendation_title,
            response.duration_ms,
            response.confidence_score,
            len(response.influencing_factors),
        )
        return response
