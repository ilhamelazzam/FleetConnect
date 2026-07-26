from __future__ import annotations

import re
from dataclasses import dataclass

from app.services.dashboard_analysis_service import DashboardAnalysisResult
from app.services.chat_service import DataSummary
from app.services.ocr_service import OcrExtractionResult


@dataclass(frozen=True)
class DecisionRecommendation:
    title: str
    priority: str
    impact: str
    estimated_saving: str | None
    reason: str


@dataclass(frozen=True)
class RecommendationEngineResult:
    recommendations: list[DecisionRecommendation]
    recommendation_notice: str | None
    risk_level: str | None
    optimization_score: int
    anomaly_score: int
    fraud_score: int
    cost_score: int


def _format_mad(value: float) -> str:
    return f"{value:,.0f} MAD".replace(",", " ")


def _clamp_score(value: float) -> int:
    return max(0, min(int(round(value)), 100))


def _ratio(numerator: float, denominator: float) -> float:
    if denominator <= 0:
        return 0.0
    return max(0.0, numerator / denominator)


def _weighted_score(components: list[tuple[float, float]]) -> int:
    valid_components = [
        (max(0.0, min(value, 100.0)), weight)
        for value, weight in components
        if weight > 0
    ]
    total_weight = sum(weight for _value, weight in valid_components)
    if total_weight <= 0:
        return 0
    return _clamp_score(
        sum(value * weight for value, weight in valid_components) / total_weight
    )


def _score_to_level(value: int) -> str:
    if value >= 80:
        return "critical"
    if value >= 60:
        return "high"
    if value >= 35:
        return "medium"
    return "low"


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


def _build_estimation_label(value: float | None, period: str = "/ mois") -> str | None:
    if value is None or value <= 0:
        return None
    return f"Estimation {_format_mad(value)} {period}".replace("  ", " ").strip()


def _dedupe_recommendations(
    recommendations: list[DecisionRecommendation],
) -> list[DecisionRecommendation]:
    unique_recommendations: list[DecisionRecommendation] = []
    seen_titles = set()
    for recommendation in recommendations:
        normalized_title = recommendation.title.strip().lower()
        if not normalized_title or normalized_title in seen_titles:
            continue
        seen_titles.add(normalized_title)
        unique_recommendations.append(recommendation)
    return unique_recommendations


def _priority_rank(priority: str) -> int:
    return {
        "critical": 4,
        "high": 3,
        "medium": 2,
        "low": 1,
    }.get(priority, 0)


def _dashboard_axis_value(
    dashboard_analysis: DashboardAnalysisResult | None,
    axis_key: str,
) -> int | None:
    if dashboard_analysis is None:
        return None
    for axis in dashboard_analysis.radar_axes:
        if axis.key == axis_key:
            return axis.value
    return None


def _blend_dashboard_pressure(
    base_score: int,
    dashboard_axis_health: int | None,
    *,
    dashboard_weight: float = 0.42,
) -> int:
    if dashboard_axis_health is None:
        return base_score
    dashboard_pressure = _clamp_score(100 - dashboard_axis_health)
    return _weighted_score(
        [
            (base_score, 1.0 - dashboard_weight),
            (dashboard_pressure, dashboard_weight),
        ]
    )


def build_decision_recommendations(
    *,
    summary: DataSummary,
    image_type: str,
    ocr_result: OcrExtractionResult,
    detected_anomalies: list[str],
    model_recommendations: list[str],
    dashboard_analysis: DashboardAnalysisResult | None = None,
) -> RecommendationEngineResult:
    highest_operator = summary.expensive_operators[0] if summary.expensive_operators else None
    highest_department = summary.risky_departments[0] if summary.risky_departments else None
    highest_plan = summary.expensive_plans[0] if summary.expensive_plans else None
    highest_critical_line = summary.critical_lines[0] if summary.critical_lines else None

    invoice_details = ocr_result.invoice_details
    incident_details = ocr_result.incident_details
    workflow_details = ocr_result.workflow_details
    equipment_details = ocr_result.equipment_details

    highest_amount_detected = max(
        (_extract_amount(amount) or 0.0 for amount in ocr_result.amounts_mad),
        default=0.0,
    )
    invoice_extra_fees_total = sum(
        (_extract_amount(value) or 0.0)
        for value in (
            (invoice_details.additional_fees if invoice_details is not None else [])
            + (invoice_details.overage_items if invoice_details is not None else [])
        )
    )
    incident_cost = (
        _extract_amount(incident_details.suspect_cost_mad)
        if incident_details is not None
        else None
    )

    average_line_cost = summary.total_monthly_cost_mad / max(summary.total_lines, 1)
    cost_score = _weighted_score(
        [
            (_ratio(summary.budget_alert_count, max(summary.total_lines, 1)) * 180, 0.36),
            (min(average_line_cost / 10, 100), 0.18),
            (
                _ratio(
                    highest_operator.monthly_cost_mad if highest_operator else 0.0,
                    max(summary.total_monthly_cost_mad, 1.0),
                )
                * 100,
                0.24,
            ),
            (min(highest_amount_detected / 60, 100), 0.22),
        ]
    )
    anomaly_score = _weighted_score(
        [
            (_ratio(summary.critical_alert_count, max(summary.total_lines, 1)) * 180, 0.24),
            (_ratio(summary.anomaly_count, max(summary.total_lines, 1)) * 200, 0.16),
            (len(detected_anomalies) * 14, 0.18),
            (
                82.0
                if image_type in {"alerte", "anomalie", "log", "erreur_systeme"}
                else 0.0,
                0.12,
            ),
            (
                100.0
                if incident_details and incident_details.severity == "critique"
                else 72.0
                if incident_details and incident_details.severity == "elevee"
                else 0.0,
                0.12,
            ),
            (
                len(workflow_details.bottlenecks) * 18 if workflow_details is not None else 0.0,
                0.10,
            ),
            (
                len(workflow_details.repeated_validations) * 14
                if workflow_details is not None
                else 0.0,
                0.04,
            ),
            (
                max(
                    len(equipment_details.detected_issues) * 12,
                    equipment_details.criticality_score * 0.8,
                )
                if equipment_details is not None
                else 0.0,
                0.14,
            ),
        ]
    )
    fraud_score = _weighted_score(
        [
            (_ratio(summary.fraud_alert_count, max(summary.total_lines, 1)) * 220, 0.42),
            (84.0 if image_type in {"fraude", "appel_suspect"} else 0.0, 0.18),
            (
                88.0
                if incident_details and incident_details.alert_type in {"fraude", "appel_suspect"}
                else 0.0,
                0.18,
            ),
            (min((incident_cost or 0.0) / 35, 100), 0.22),
        ]
    )
    optimization_score = _weighted_score(
        [
            (_ratio(summary.inactive_lines, max(summary.total_lines, 1)) * 200, 0.24),
            (_ratio(summary.free_lines, max(summary.total_lines, 1)) * 160, 0.14),
            (_ratio(summary.over_quota_count, max(summary.total_lines, 1)) * 180, 0.20),
            (76.0 if highest_plan else 0.0, 0.10),
            (min(invoice_extra_fees_total / 35, 100), 0.10),
            (72.0 if incident_details and incident_details.data_overage else 0.0, 0.08),
            (
                workflow_details.complexity_score
                if workflow_details is not None
                else 0.0,
                0.08,
            ),
            (
                len(workflow_details.automation_opportunities) * 16
                if workflow_details is not None
                else 0.0,
                0.03,
            ),
            (
                max(0, 100 - equipment_details.condition_score)
                if equipment_details is not None
                else 0.0,
                0.03,
            ),
        ]
    )

    cost_score = _blend_dashboard_pressure(
        cost_score,
        _dashboard_axis_value(dashboard_analysis, "cost_score"),
    )
    anomaly_score = _blend_dashboard_pressure(
        anomaly_score,
        _dashboard_axis_value(dashboard_analysis, "anomaly_score"),
    )
    fraud_score = _blend_dashboard_pressure(
        fraud_score,
        _dashboard_axis_value(dashboard_analysis, "fraud_score"),
    )
    optimization_score = _blend_dashboard_pressure(
        optimization_score,
        _dashboard_axis_value(dashboard_analysis, "optimization_score"),
    )

    workflow_risk_score = workflow_details.complexity_score if workflow_details is not None else 0
    equipment_risk_score = (
        max(
            equipment_details.criticality_score,
            equipment_details.obsolescence_score,
            equipment_details.maintenance_score,
            100 - equipment_details.condition_score,
        )
        if equipment_details is not None
        else 0
    )
    dashboard_imbalance_score = (
        dashboard_analysis.asymmetry_score if dashboard_analysis is not None else 0
    )
    incident_risk_floor = (
        92
        if incident_details is not None and incident_details.severity == "critique"
        else 84
        if incident_details is not None and incident_details.priority == "immediate"
        else 0
    )
    risk_level = _score_to_level(
        max(
            cost_score,
            anomaly_score,
            fraud_score,
            workflow_risk_score,
            equipment_risk_score,
            dashboard_imbalance_score,
            incident_risk_floor,
        )
    )
    recommendations: list[DecisionRecommendation] = []

    if summary.inactive_lines > 0:
        average_line_cost = summary.total_monthly_cost_mad / max(summary.active_lines, 1)
        estimated_saving = _build_estimation_label(average_line_cost * summary.inactive_lines)
        recommendations.append(
            DecisionRecommendation(
                title="Suspendre ligne inactive",
                priority="high" if summary.inactive_lines >= 2 else "medium",
                impact="economies",
                estimated_saving=estimated_saving,
                reason=(
                    f"{summary.inactive_lines} ligne(s) inactive(s) apparaissent dans la synthese, "
                    "avec un cout moyen estime a partir du parc actif."
                ),
            )
        )

    if highest_department is not None:
        recommendations.append(
            DecisionRecommendation(
                title=f"Surveiller departement {highest_department.label}",
                priority="critical" if highest_department.risk_score >= 75 else "high",
                impact="risk",
                estimated_saving=None,
                reason=(
                    f"{highest_department.label} concentre {highest_department.alert_count} alerte(s) "
                    f"et un score de risque de {round(highest_department.risk_score)}/100."
                ),
            )
        )

    if highest_operator is not None:
        recommendations.append(
            DecisionRecommendation(
                title=f"Verifier anomalies {highest_operator.label}",
                priority="high" if highest_operator.alert_count >= 4 else "medium",
                impact="cost",
                estimated_saving=None,
                reason=(
                    f"{highest_operator.label} porte {_format_mad(highest_operator.monthly_cost_mad)} / mois "
                    f"et {highest_operator.alert_count} alerte(s) visibles."
                ),
            )
        )

    if dashboard_analysis is not None:
        weak_axis_keys = {
            axis.key
            for axis in dashboard_analysis.radar_axes
            if axis.value <= 45
        }
        if "equipment_score" in weak_axis_keys:
            recommendations.append(
                DecisionRecommendation(
                    title="Renforcer supervision equipements",
                    priority="critical",
                    impact="risk",
                    estimated_saving=None,
                    reason=(
                        "Le radar du dashboard place les equipements parmi les dimensions "
                        "les plus faibles, ce qui signale un deficit de visibilite materielle."
                    ),
                )
            )
        if "fraud_score" in weak_axis_keys:
            recommendations.append(
                DecisionRecommendation(
                    title="Renforcer detection fraude",
                    priority="critical",
                    impact="fraud",
                    estimated_saving=None,
                    reason=(
                        "Le radar montre une faiblesse nette sur la fraude, avec un risque "
                        "de sous-detection des signaux anormaux."
                    ),
                )
            )
        if "roaming_score" in weak_axis_keys:
            recommendations.append(
                DecisionRecommendation(
                    title="Ajouter monitoring roaming temps reel",
                    priority="high",
                    impact="prevention",
                    estimated_saving=None,
                    reason=(
                        "Le roaming figure parmi les dimensions faibles du dashboard, ce qui "
                        "augmente le risque de couts internationaux non controles."
                    ),
                )
            )
        if (
            dashboard_analysis.asymmetry_score >= 28
            and dashboard_analysis.radar_axes
            and dashboard_analysis.radar_axes[0].key == "workflow_score"
        ):
            recommendations.append(
                DecisionRecommendation(
                    title="Reequilibrer le pilotage workflow",
                    priority="high",
                    impact="optimization",
                    estimated_saving=None,
                    reason=(
                        "Le workflow domine nettement le radar par rapport aux autres axes, "
                        "ce qui traduit un dispositif trop desequilibre."
                    ),
                )
            )

    if highest_plan is not None:
        plan_saving_estimate = highest_plan.average_cost_mad * highest_plan.line_count * 0.12
        recommendations.append(
            DecisionRecommendation(
                title="Migrer vers forfait moins cher",
                priority="high" if highest_plan.alert_count >= 3 else "medium",
                impact="optimization",
                estimated_saving=_build_estimation_label(plan_saving_estimate),
                reason=(
                    f"Le forfait {highest_plan.plan} coute en moyenne {_format_mad(highest_plan.average_cost_mad)} "
                    f"sur {highest_plan.line_count} ligne(s), avec {highest_plan.alert_count} alerte(s)."
                ),
            )
        )

    if summary.over_quota_count > 0 or (incident_details and incident_details.data_overage):
        overage_saving = incident_cost if incident_cost is not None else invoice_extra_fees_total or None
        recommendations.append(
            DecisionRecommendation(
                title="Optimiser forfait data",
                priority="critical" if summary.over_quota_count >= 4 else "high",
                impact="economies",
                estimated_saving=_build_estimation_label(overage_saving, period=" a eviter"),
                reason=(
                    f"{summary.over_quota_count} depassement(s) quota sont presents dans la synthese"
                    + (
                        " et la capture confirme un hors forfait data."
                        if incident_details and incident_details.data_overage
                        else "."
                    )
                ),
            )
        )
        recommendations.append(
            DecisionRecommendation(
                title="Verifier depassements recurrents",
                priority="high",
                impact="prevention",
                estimated_saving=None,
                reason=(
                    "Les surconsommations paraissent recurrentes et peuvent degrader le budget si elles ne sont pas traitees."
                ),
            )
        )

    if invoice_details is not None and invoice_extra_fees_total > 0:
        fee_reason = (
            f"La facture contient des frais supplementaires ou depassements pour {_format_mad(invoice_extra_fees_total)}."
        )
        recommendations.append(
            DecisionRecommendation(
                title="Reduire consommation roaming",
                priority="high",
                impact="economies",
                estimated_saving=_build_estimation_label(invoice_extra_fees_total, period=" a recuperer"),
                reason=fee_reason,
            )
        )

    if incident_details is not None and incident_details.alert_type in {"fraude", "appel_suspect"}:
        recommendations.append(
            DecisionRecommendation(
                title="Analyser appels suspects",
                priority="critical" if incident_details.severity == "critique" else "high",
                impact="fraud",
                estimated_saving=_build_estimation_label(incident_cost, period=" d'exposition"),
                reason=(
                    incident_details.summary
                    or "La capture signale un trafic potentiellement suspect ou un comportement fraude."
                ),
            )
        )
        recommendations.append(
            DecisionRecommendation(
                title="Controler volume fraude",
                priority="critical" if summary.fraud_alert_count >= 3 else "high",
                impact="fraud",
                estimated_saving=None,
                reason=(
                    f"{summary.fraud_alert_count} alerte(s) fraude sont deja presentes dans les donnees, "
                    "ce qui justifie un controle immediat."
                ),
            )
        )

    if incident_details is not None and incident_details.alert_type == "depassement_quota":
        recommendations.append(
            DecisionRecommendation(
                title="Calculer priorites de traitement",
                priority="critical" if incident_details.severity == "critique" else "high",
                impact="risk",
                estimated_saving=None,
                reason=(
                    f"L'alerte {incident_details.alert_type} est qualifiee {incident_details.severity or 'non lisible'} "
                    "et doit etre traitee avant escalation."
                ),
            )
        )

    if highest_critical_line is not None and highest_critical_line.status in {"inactive", "suspended"}:
        recommendations.append(
            DecisionRecommendation(
                title="Verifier ligne critique",
                priority="high",
                impact="risk",
                estimated_saving=_build_estimation_label(highest_critical_line.monthly_cost_mad, period="/ mois exposes"),
                reason=(
                    f"La ligne {highest_critical_line.label} cumule un score de risque de "
                    f"{round(highest_critical_line.risk_score)}/100 et un cout de {_format_mad(highest_critical_line.monthly_cost_mad)}."
                ),
            )
        )

    if workflow_details is not None:
        if workflow_details.complexity_score >= 60:
            recommendations.append(
                DecisionRecommendation(
                    title="Simplifier workflow multi-etapes",
                    priority=(
                        "critical"
                        if workflow_details.complexity_score >= 70
                        or workflow_details.complexity_level == "critical"
                        or image_type == "workflow"
                        else "high"
                    ),
                    impact="optimization",
                    estimated_saving=None,
                    reason=(
                        f"Le workflow presente un score de complexite de {workflow_details.complexity_score}/100 "
                        f"avec {len(workflow_details.step_names)} etape(s) et {len(workflow_details.validations)} validation(s)."
                    ),
                )
            )

        if workflow_details.repeated_validations:
            recommendations.append(
                DecisionRecommendation(
                    title="Automatiser validations repetitives",
                    priority="high",
                    impact="optimization",
                    estimated_saving=None,
                    reason=(
                        f"{len(workflow_details.repeated_validations)} validation(s) repetitives sont visibles dans le schema, "
                        "ce qui rallonge le cycle de traitement."
                    ),
                )
            )

        if workflow_details.bottlenecks:
            recommendations.append(
                DecisionRecommendation(
                    title="Traiter points de blocage du workflow",
                    priority="critical" if len(workflow_details.bottlenecks) >= 2 else "high",
                    impact="risk",
                    estimated_saving=None,
                    reason=(
                        f"{len(workflow_details.bottlenecks)} point(s) de blocage ou de controle manuel semblent visibles "
                        "dans le workflow."
                    ),
                )
            )

        if len(workflow_details.departments) >= 3:
            recommendations.append(
                DecisionRecommendation(
                    title="Reduire dependances inter-departements",
                    priority="high",
                    impact="prevention",
                    estimated_saving=None,
                    reason=(
                        f"{len(workflow_details.departments)} departement(s) apparaissent dans le workflow, "
                        "ce qui augmente le risque de handoff et de retard."
                    ),
                )
            )

        for opportunity in workflow_details.automation_opportunities[:2]:
            recommendations.append(
                DecisionRecommendation(
                    title=opportunity[:90],
                    priority="medium",
                    impact="analysis",
                    estimated_saving=None,
                    reason="Opportunite d'automatisation deduite des etapes visibles sur le workflow.",
                )
            )

    if equipment_details is not None:
        if equipment_details.replacement_needed:
            recommendations.append(
                DecisionRecommendation(
                    title="Remplacer equipement a risque",
                    priority="critical" if equipment_details.criticality_score >= 75 else "high",
                    impact="risk",
                    estimated_saving=None,
                    reason=(
                        f"L'equipement {equipment_details.brand or ''} {equipment_details.model or ''}".strip()
                        + " presente un niveau de criticite ou d'obsolescence justifiant un renouvellement."
                    ),
                )
            )

        if equipment_details.maintenance_score >= 45 or equipment_details.detected_issues:
            recommendations.append(
                DecisionRecommendation(
                    title="Planifier maintenance preventive equipement",
                    priority="high",
                    impact="prevention",
                    estimated_saving=None,
                    reason=(
                        f"{len(equipment_details.detected_issues)} anomalie(s) visible(s) et un score maintenance de "
                        f"{equipment_details.maintenance_score}/100 suggerent une intervention preventive."
                    ),
                )
            )

        if equipment_details.obsolescence_score >= 60:
            recommendations.append(
                DecisionRecommendation(
                    title="Verifier obsolescence materiel",
                    priority="high",
                    impact="optimization",
                    estimated_saving=None,
                    reason=(
                        f"Le score d'obsolescence atteint {equipment_details.obsolescence_score}/100, "
                        "ce qui peut limiter la compatibilite et le support."
                    ),
                )
            )

        if equipment_details.equipment_type in {"routeur", "modem", "switch", "borne_wifi"}:
            recommendations.append(
                DecisionRecommendation(
                    title="Verifier compatibilite reseau equipement",
                    priority="medium",
                    impact="analysis",
                    estimated_saving=None,
                    reason=(
                        "Cet equipement reseau doit etre confirme contre les besoins de connectivite, "
                        "de firmware et de capacite du site."
                    ),
                )
            )

    for raw_recommendation in model_recommendations[:3]:
        normalized = raw_recommendation.strip()
        if not normalized:
            continue
        recommendations.append(
            DecisionRecommendation(
                title=normalized[:90],
                priority="medium",
                impact="analysis",
                estimated_saving=None,
                reason="Suggestion complementaire issue du contexte metier et de l'analyse IA.",
            )
        )

    ordered_recommendations = sorted(
        _dedupe_recommendations(recommendations),
        key=lambda recommendation: (_priority_rank(recommendation.priority), bool(recommendation.estimated_saving)),
        reverse=True,
    )[:6]

    recommendation_notice = None
    if not ordered_recommendations:
        recommendation_notice = "Analyse insuffisante pour recommandation fiable."

    return RecommendationEngineResult(
        recommendations=ordered_recommendations,
        recommendation_notice=recommendation_notice,
        risk_level=risk_level,
        optimization_score=optimization_score,
        anomaly_score=anomaly_score,
        fraud_score=fraud_score,
        cost_score=cost_score,
    )
