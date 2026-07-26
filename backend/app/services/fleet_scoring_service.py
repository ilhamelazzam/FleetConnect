from __future__ import annotations

from typing import TYPE_CHECKING

from app.services.fleet_kpi_weighting_service import (
    KpiContribution,
    WeightedKpi,
    score_weighted_kpis,
    severity_from_pressure,
)
from app.services.fleet_risk_aggregation_service import (
    aggregate_health_scores,
    blend_health_scores,
    factor_severity_from_score,
    global_risk_from_health_score,
    health_level_from_score,
    trend_from_signals,
)

if TYPE_CHECKING:
    from app.schemas.live import LiveMonitoringSnapshotResponse
    from app.services.chat_service import DataSummary, SummaryMetric


def _clamp_score(value: float) -> int:
    return max(0, min(int(round(value)), 100))


def _ratio(part: float, total: float) -> float:
    if total <= 0:
        return 0.0
    return max(part, 0.0) / total


def _format_mad(value: float) -> str:
    return f"{value:,.0f} MAD".replace(",", " ")


def _format_pct(value: float) -> str:
    return f"{value * 100:.1f}%"


def _join_labels(labels: list[str]) -> str:
    filtered = [label for label in labels if label]
    if not filtered:
        return "plusieurs signaux convergents"
    if len(filtered) == 1:
        return filtered[0]
    if len(filtered) == 2:
        return f"{filtered[0]} et {filtered[1]}"
    return f"{', '.join(filtered[:-1])} et {filtered[-1]}"


def _domain_label(domain_key: str) -> str:
    labels = {
        "cost_score": "Couts telecom",
        "fraud_score": "Fraude",
        "anomaly_score": "Anomalies",
        "optimization_score": "Optimisation",
        "equipment_score": "Equipements",
        "workflow_score": "Workflows",
        "risk_score": "Risques departements",
        "roaming_score": "Roaming",
    }
    return labels.get(domain_key, domain_key)


def _top_metric(metrics: list["SummaryMetric"]) -> "SummaryMetric | None":
    return metrics[0] if metrics else None


def _average_metric_risk(metrics: list["SummaryMetric"], limit: int = 3) -> float:
    selected_metrics = metrics[:limit]
    if not selected_metrics:
        return 0.0
    return sum(metric.risk_score for metric in selected_metrics) / len(selected_metrics)


def _build_cost_kpis(
    summary: "DataSummary",
    *,
    projected_gap_ratio: float,
    top_operator_share: float,
    top_operator: "SummaryMetric | None",
) -> list[WeightedKpi]:
    operator_label = top_operator.label if top_operator is not None else "Operateur principal"
    operator_risk = (top_operator.risk_score / 100) if top_operator is not None else 0.0

    return [
        WeightedKpi(
            key="projected_gap",
            label="Projection budgetaire",
            category="cost",
            value=projected_gap_ratio,
            threshold=0.18,
            weight=0.32,
            display_value=_format_pct(projected_gap_ratio),
            evidence=(
                f"La projection depasse le cout actuel de {_format_pct(projected_gap_ratio)} "
                f"({_format_mad(max(summary.projected_monthly_cost_mad - summary.total_monthly_cost_mad, 0.0))})."
            ),
        ),
        WeightedKpi(
            key="budget_alert_ratio",
            label="Alertes budgetaires",
            category="cost",
            value=_ratio(summary.budget_alert_count, max(summary.total_lines, 1)),
            threshold=0.08,
            weight=0.22,
            display_value=f"{summary.budget_alert_count} alertes",
            evidence=(
                f"{summary.budget_alert_count} alertes budgetaires affectent actuellement la flotte."
            ),
        ),
        WeightedKpi(
            key="operator_concentration",
            label=f"Cout concentre chez {operator_label}",
            category="cost",
            value=top_operator_share,
            threshold=0.45,
            weight=0.22,
            display_value=_format_pct(top_operator_share),
            evidence=(
                f"{operator_label} concentre {_format_pct(top_operator_share)} du cout telecom analyse."
            ),
        ),
        WeightedKpi(
            key="operator_cost_risk",
            label=f"Pression cout {operator_label}",
            category="cost",
            value=operator_risk,
            threshold=0.72,
            weight=0.24,
            display_value=f"{round(operator_risk * 100)}/100",
            evidence=(
                f"Le score de risque moyen de {operator_label} reste eleve sur le perimetre cout."
            ),
        ),
    ]


def _build_fraud_kpis(
    summary: "DataSummary",
) -> list[WeightedKpi]:
    total_calls = max(summary.total_call_count, 1)
    total_cost = max(summary.total_monthly_cost_mad, 1.0)
    suspicious_call_ratio = _ratio(summary.suspicious_call_count, total_calls)
    suspicious_cost_share = _ratio(summary.suspicious_call_cost_mad, total_cost)

    return [
        WeightedKpi(
            key="suspicious_calls",
            label="Appels suspects",
            category="fraud",
            value=suspicious_call_ratio,
            threshold=0.08,
            weight=0.3,
            display_value=f"{summary.suspicious_call_count} appels",
            evidence=(
                f"{summary.suspicious_call_count} appels suspects ont ete detectes sur {summary.total_call_count} appels."
            ),
        ),
        WeightedKpi(
            key="fraud_alerts",
            label="Alertes fraude",
            category="fraud",
            value=_ratio(summary.fraud_alert_count, max(summary.total_lines, 1)),
            threshold=0.05,
            weight=0.25,
            display_value=f"{summary.fraud_alert_count} alertes",
            evidence=f"{summary.fraud_alert_count} signaux fraude ou haut cout ont ete remontes.",
        ),
        WeightedKpi(
            key="fraud_cost_share",
            label="Exposition fraude",
            category="fraud",
            value=suspicious_cost_share,
            threshold=0.1,
            weight=0.25,
            display_value=_format_mad(summary.suspicious_call_cost_mad),
            evidence=(
                f"L'exposition financiere liee aux appels suspects atteint {_format_mad(summary.suspicious_call_cost_mad)}."
            ),
        ),
        WeightedKpi(
            key="high_cost_calls",
            label="Appels haut cout",
            category="fraud",
            value=_ratio(summary.high_cost_call_count, total_calls),
            threshold=0.12,
            weight=0.2,
            display_value=f"{summary.high_cost_call_count} appels",
            evidence=(
                f"{summary.high_cost_call_count} appels a haut cout augmentent la pression fraude."
            ),
        ),
    ]


def _build_anomaly_kpis(
    summary: "DataSummary",
    *,
    live_snapshot: "LiveMonitoringSnapshotResponse | None",
    top_operator: "SummaryMetric | None",
) -> list[WeightedKpi]:
    operator_instability = (
        (live_snapshot.operator_anomaly_count / 4)
        if live_snapshot is not None
        else ((top_operator.risk_score / 100) if top_operator is not None else 0.0)
    )
    operator_label = top_operator.label if top_operator is not None else "Operateur principal"

    return [
        WeightedKpi(
            key="over_quota",
            label="Surconsommation",
            category="anomaly",
            value=_ratio(summary.over_quota_count, max(summary.total_lines, 1)),
            threshold=0.1,
            weight=0.32,
            display_value=f"{summary.over_quota_count} lignes",
            evidence=f"{summary.over_quota_count} lignes depassent leur quota data.",
        ),
        WeightedKpi(
            key="anomaly_flags",
            label="Anomalies detectees",
            category="anomaly",
            value=_ratio(summary.anomaly_count, max(summary.total_lines, 1)),
            threshold=0.08,
            weight=0.3,
            display_value=f"{summary.anomaly_count} anomalies",
            evidence=f"{summary.anomaly_count} anomalies ont ete detectees dans les donnees disponibles.",
        ),
        WeightedKpi(
            key="critical_alerts",
            label="Alertes critiques",
            category="anomaly",
            value=_ratio(summary.critical_alert_count, max(summary.total_lines, 1)),
            threshold=0.16,
            weight=0.22,
            display_value=f"{summary.critical_alert_count} alertes",
            evidence=(
                f"{summary.critical_alert_count} alertes critiques ou signaux convergents diminuent la sante globale."
            ),
        ),
        WeightedKpi(
            key="operator_instability",
            label=f"Instabilite operateur {operator_label}",
            category="anomaly",
            value=operator_instability,
            threshold=0.75,
            weight=0.16,
            display_value=f"{round(operator_instability * 100)}/100",
            evidence=(
                f"L'operateur {operator_label} concentre une part importante des anomalies ou tensions reseau."
            ),
        ),
    ]


def _build_optimization_kpis(
    summary: "DataSummary",
    *,
    projected_gap_ratio: float,
    top_operator_share: float,
) -> list[WeightedKpi]:
    expensive_plan_lines = sum(plan.line_count for plan in summary.expensive_plans)
    return [
        WeightedKpi(
            key="inactive_lines",
            label="Lignes inactives",
            category="optimization",
            value=_ratio(summary.inactive_lines, max(summary.total_lines, 1)),
            threshold=0.1,
            weight=0.3,
            display_value=f"{summary.inactive_lines} lignes",
            evidence=f"{summary.inactive_lines} lignes inactives restent a rationaliser.",
        ),
        WeightedKpi(
            key="free_lines",
            label="Lignes libres",
            category="optimization",
            value=_ratio(summary.free_lines, max(summary.total_lines, 1)),
            threshold=0.16,
            weight=0.14,
            display_value=f"{summary.free_lines} lignes",
            evidence=f"{summary.free_lines} lignes libres peuvent etre reaffectees ou redimensionnees.",
        ),
        WeightedKpi(
            key="expensive_plans",
            label="Forfaits a optimiser",
            category="optimization",
            value=_ratio(expensive_plan_lines, max(summary.total_lines, 1)),
            threshold=0.25,
            weight=0.28,
            display_value=f"{len(summary.expensive_plans)} forfaits",
            evidence=(
                f"{len(summary.expensive_plans)} forfaits concentrent une charge budgetaire significative."
            ),
        ),
        WeightedKpi(
            key="projected_budget_pressure",
            label="Projection cout a contenir",
            category="optimization",
            value=projected_gap_ratio,
            threshold=0.18,
            weight=0.14,
            display_value=_format_pct(projected_gap_ratio),
            evidence="La trajectoire budgetaire montre un besoin d'optimisation a court terme.",
        ),
        WeightedKpi(
            key="operator_dependency",
            label="Dependance operateur",
            category="optimization",
            value=top_operator_share,
            threshold=0.45,
            weight=0.14,
            display_value=_format_pct(top_operator_share),
            evidence="Une forte concentration operateur limite les leviers d'optimisation rapides.",
        ),
    ]


def _build_equipment_kpis(
    summary: "DataSummary",
    *,
    live_snapshot: "LiveMonitoringSnapshotResponse | None",
) -> list[WeightedKpi]:
    maintenance_pressure = 0.0
    critical_equipment_count = 0
    if live_snapshot is not None and live_snapshot.critical_equipments:
        critical_equipment_count = len(live_snapshot.critical_equipments)
        average_health = sum(
            equipment.health_score for equipment in live_snapshot.critical_equipments
        ) / critical_equipment_count
        maintenance_pressure = max(0.0, (100 - average_health) / 100)

    return [
        WeightedKpi(
            key="mobile_alert_devices",
            label="Equipements en alerte",
            category="equipment",
            value=_ratio(summary.mobile_alert_count, max(summary.mobile_device_total, 1)),
            threshold=0.18,
            weight=0.3,
            display_value=f"{summary.mobile_alert_count} equipements",
            evidence=(
                f"{summary.mobile_alert_count} equipements ou terminaux mobiles sont signales en alerte."
            ),
        ),
        WeightedKpi(
            key="critical_mobile_devices",
            label="Equipements critiques",
            category="equipment",
            value=_ratio(summary.mobile_critical_count, max(summary.mobile_device_total, 1)),
            threshold=0.12,
            weight=0.24,
            display_value=f"{summary.mobile_critical_count} equipements",
            evidence=(
                f"{summary.mobile_critical_count} equipements a risque eleve tirent le score maintenance vers le bas."
            ),
        ),
        WeightedKpi(
            key="critical_lines_proxy",
            label="Lignes critiques associees",
            category="equipment",
            value=_ratio(len(summary.critical_lines), max(summary.total_lines, 1)),
            threshold=0.1,
            weight=0.26,
            display_value=f"{len(summary.critical_lines)} lignes",
            evidence=(
                f"{len(summary.critical_lines)} lignes critiques peuvent traduire un probleme d'equipement ou de configuration."
            ),
        ),
        WeightedKpi(
            key="maintenance_live",
            label="Maintenance equipements",
            category="equipment",
            value=maintenance_pressure,
            threshold=0.4,
            weight=0.2,
            display_value=(
                f"{critical_equipment_count} equipements"
                if critical_equipment_count > 0
                else "Pas de signal live"
            ),
            evidence=(
                "Le monitoring live remonte des equipements critiques a maintenir."
                if critical_equipment_count > 0
                else "Aucun signal live supplementaire n'est disponible pour la maintenance equipement."
            ),
        ),
    ]


def _build_workflow_kpis(
    summary: "DataSummary",
    *,
    live_snapshot: "LiveMonitoringSnapshotResponse | None",
) -> list[WeightedKpi]:
    workflow_pressure = (
        min(live_snapshot.workflow_critical_count / 6, 1.0)
        if live_snapshot is not None
        else 0.0
    )
    return [
        WeightedKpi(
            key="in_progress_lines",
            label="Flux en cours",
            category="workflow",
            value=_ratio(summary.in_progress_lines, max(summary.total_lines, 1)),
            threshold=0.08,
            weight=0.3,
            display_value=f"{summary.in_progress_lines} flux",
            evidence=(
                f"{summary.in_progress_lines} lignes ou traitements restent en cours dans le cycle operationnel."
            ),
        ),
        WeightedKpi(
            key="critical_lines_workflow",
            label="Traitements critiques a absorber",
            category="workflow",
            value=_ratio(len(summary.critical_lines), max(summary.total_lines, 1)),
            threshold=0.1,
            weight=0.22,
            display_value=f"{len(summary.critical_lines)} cas",
            evidence="Le volume de cas critiques ralentit la fluidite des workflows de gestion.",
        ),
        WeightedKpi(
            key="critical_alerts_workflow",
            label="Escalades critiques",
            category="workflow",
            value=_ratio(summary.critical_alert_count, max(summary.total_lines, 1)),
            threshold=0.16,
            weight=0.2,
            display_value=f"{summary.critical_alert_count} escalades",
            evidence="Les escalades critiques augmentent la charge de coordination et de validation.",
        ),
        WeightedKpi(
            key="workflow_live_pressure",
            label="Workflows complexes",
            category="workflow",
            value=workflow_pressure,
            threshold=0.5,
            weight=0.28,
            display_value=(
                f"{live_snapshot.workflow_critical_count} workflows"
                if live_snapshot is not None
                else "Pas de signal live"
            ),
            evidence=(
                "Le monitoring live remonte plusieurs workflows critiques ou a goulots."
                if live_snapshot is not None and live_snapshot.workflow_critical_count > 0
                else "Aucun signal live supplementaire n'est disponible sur la complexite workflow."
            ),
        ),
    ]


def _build_risk_kpis(
    summary: "DataSummary",
    *,
    top_operator: "SummaryMetric | None",
) -> list[WeightedKpi]:
    department_risk = _average_metric_risk(summary.risky_departments) / 100
    top_operator_risk = (top_operator.risk_score / 100) if top_operator is not None else 0.0
    top_department = summary.risky_departments[0].label if summary.risky_departments else "Departement principal"

    return [
        WeightedKpi(
            key="department_risk",
            label=f"Risque departement {top_department}",
            category="risk",
            value=department_risk,
            threshold=0.7,
            weight=0.34,
            display_value=f"{round(department_risk * 100)}/100",
            evidence=(
                f"Le departement {top_department} et les departements leaders concentrent les principaux signaux de risque."
            ),
        ),
        WeightedKpi(
            key="critical_alert_density",
            label="Densite alertes critiques",
            category="risk",
            value=_ratio(summary.critical_alert_count, max(summary.total_lines, 1)),
            threshold=0.16,
            weight=0.24,
            display_value=f"{summary.critical_alert_count} alertes",
            evidence="La densite d'alertes critiques augmente le risque global de flotte.",
        ),
        WeightedKpi(
            key="operator_risk",
            label="Stabilite operateurs",
            category="risk",
            value=top_operator_risk,
            threshold=0.72,
            weight=0.22,
            display_value=f"{round(top_operator_risk * 100)}/100",
            evidence="Le score moyen des operateurs les plus exposes reste a surveiller.",
        ),
        WeightedKpi(
            key="suspicious_call_density",
            label="Incidents critiques",
            category="risk",
            value=_ratio(summary.suspicious_call_count, max(summary.total_call_count, 1)),
            threshold=0.08,
            weight=0.2,
            display_value=f"{summary.suspicious_call_count} appels",
            evidence="Le volume d'appels suspects renforce le niveau de risque entreprise.",
        ),
    ]


def _build_roaming_kpis(
    summary: "DataSummary",
    *,
    live_snapshot: "LiveMonitoringSnapshotResponse | None",
) -> list[WeightedKpi]:
    live_roaming_share = (
        _ratio(live_snapshot.roaming_cost_mad, max(live_snapshot.live_cost_mad, 1.0))
        if live_snapshot is not None
        else 0.0
    )

    return [
        WeightedKpi(
            key="roaming_lines",
            label="Depassements roaming",
            category="roaming",
            value=_ratio(summary.roaming_line_count, max(summary.total_lines, 1)),
            threshold=0.18,
            weight=0.4,
            display_value=f"{summary.roaming_line_count} lignes",
            evidence=(
                f"{summary.roaming_line_count} lignes utilisent du roaming dans les donnees analysees."
            ),
        ),
        WeightedKpi(
            key="roaming_alerts",
            label="Roaming a risque",
            category="roaming",
            value=_ratio(summary.roaming_alert_count, max(summary.total_lines, 1)),
            threshold=0.08,
            weight=0.28,
            display_value=f"{summary.roaming_alert_count} alertes",
            evidence=(
                f"{summary.roaming_alert_count} lignes cumulent roaming et alerte de depassement ou anomalie."
            ),
        ),
        WeightedKpi(
            key="live_roaming_cost",
            label="Cout roaming live",
            category="roaming",
            value=live_roaming_share,
            threshold=0.12,
            weight=0.32,
            display_value=(
                _format_mad(live_snapshot.roaming_cost_mad)
                if live_snapshot is not None
                else "Pas de signal live"
            ),
            evidence=(
                f"Le monitoring live evalue le cout roaming a {_format_mad(live_snapshot.roaming_cost_mad)}."
                if live_snapshot is not None
                else "Aucun cout roaming live supplementaire n'est disponible."
            ),
        ),
    ]


def _build_domain_strengths(scores: dict[str, int]) -> list[str]:
    strengths: list[str] = []
    strength_labels = {
        "cost_score": "La pression budgetaire reste contenue sur le perimetre disponible.",
        "fraud_score": "Les signaux fraude restent globalement maitrises.",
        "anomaly_score": "Les anomalies telecom restent sous controle relatif.",
        "optimization_score": "Le potentiel d'optimisation immediat reste pilotable.",
        "equipment_score": "La maintenance equipement reste relativement stable.",
        "workflow_score": "Les workflows telecom restent fluides sur la majorite des cas.",
        "risk_score": "L'exposition departementale reste sous un seuil acceptable.",
        "roaming_score": "Le roaming reste globalement sous controle.",
    }

    for domain_key, score in sorted(scores.items(), key=lambda item: item[1], reverse=True):
        if score >= 76 and domain_key in strength_labels:
            strengths.append(strength_labels[domain_key])
        if len(strengths) == 3:
            break
    return strengths


def _build_recommendations(
    scores: dict[str, int],
    *,
    summary: "DataSummary",
) -> list[str]:
    top_operator = _top_metric(summary.expensive_operators)
    top_department = _top_metric(summary.risky_departments)
    domain_actions = {
        "cost_score": (
            f"Renegocier ou resegmenter en priorite les couts portes par {top_operator.label}."
            if top_operator is not None
            else "Renegocier les couts telecom les plus concentres."
        ),
        "fraud_score": "Renforcer le filtrage des appels suspects et confirmer les signaux de fraude prioritaires.",
        "anomaly_score": "Traiter d'abord les lignes en surconsommation et les anomalies de quota repetitives.",
        "optimization_score": "Nettoyer les lignes inactives et revoir les forfaits les plus chers avant nouvel achat.",
        "equipment_score": "Auditer les equipements en alerte et prioriser la maintenance des cas critiques.",
        "workflow_score": "Simplifier les flux en cours et reduire les points de blocage critiques detectes.",
        "risk_score": (
            f"Traiter en premier le departement {top_department.label} avec un plan d'action cible."
            if top_department is not None
            else "Lancer un plan d'action cible sur les departements les plus exposes."
        ),
        "roaming_score": "Verifier les options roaming et verrouiller les lignes en depassement hors forfait.",
    }

    actions = [
        domain_actions[domain_key]
        for domain_key, score in sorted(scores.items(), key=lambda item: item[1])
        if score <= 72 and domain_key in domain_actions
    ]
    return actions[:4]


def _build_explanation(
    top_contributions: list[KpiContribution],
) -> str:
    main_labels = [contribution.label.lower() for contribution in top_contributions[:4]]
    return (
        "Le score global diminue principalement a cause de : "
        f"{_join_labels(main_labels)}."
    )


def _to_key_factor(contribution: KpiContribution) -> dict[str, object]:
    return {
        "label": contribution.label,
        "category": contribution.category,
        "value": contribution.display_value,
        "impact_score": contribution.impact_score,
        "severity": severity_from_pressure(contribution.normalized_pressure),
        "evidence": contribution.evidence,
    }


def _live_cost_health(snapshot: "LiveMonitoringSnapshotResponse | None") -> int | None:
    if snapshot is None:
        return None
    return _clamp_score(
        84
        - max(snapshot.live_cost_delta_pct, 0.0) * 1.25
        - snapshot.overage_lines * 0.9
        - snapshot.operator_anomaly_count * 2.4
    )


def _live_fraud_health(snapshot: "LiveMonitoringSnapshotResponse | None") -> int | None:
    if snapshot is None:
        return None
    return _clamp_score(
        92
        - snapshot.fraud_score * 0.54
        - max(snapshot.suspicious_calls - 60, 0) * 0.08
    )


def _live_anomaly_health(snapshot: "LiveMonitoringSnapshotResponse | None") -> int | None:
    if snapshot is None:
        return None
    return _clamp_score(
        90
        - snapshot.overage_lines * 2.8
        - snapshot.operator_anomaly_count * 6.0
        - max(snapshot.data_delta_pct, 0.0) * 0.45
    )


def _live_workflow_health(snapshot: "LiveMonitoringSnapshotResponse | None") -> int | None:
    if snapshot is None:
        return None
    return _clamp_score(88 - snapshot.workflow_critical_count * 9.5)


def _live_roaming_health(snapshot: "LiveMonitoringSnapshotResponse | None") -> int | None:
    if snapshot is None:
        return None
    roaming_share = _ratio(snapshot.roaming_cost_mad, max(snapshot.live_cost_mad, 1.0))
    return _clamp_score(92 - roaming_share * 180 - snapshot.overage_lines * 0.6)


def build_fleet_health_payload(
    summary: "DataSummary",
    *,
    live_snapshot: "LiveMonitoringSnapshotResponse | None" = None,
) -> dict[str, object]:
    total_lines = max(summary.total_lines, 1)
    total_cost = max(summary.total_monthly_cost_mad, 1.0)
    projected_gap_ratio = _ratio(
        max(summary.projected_monthly_cost_mad - summary.total_monthly_cost_mad, 0.0),
        total_cost,
    )
    top_operator = _top_metric(summary.expensive_operators)
    top_operator_share = (
        _ratio(top_operator.monthly_cost_mad, total_cost) if top_operator is not None else 0.0
    )

    cost_score, cost_contributions = score_weighted_kpis(
        _build_cost_kpis(
            summary,
            projected_gap_ratio=projected_gap_ratio,
            top_operator_share=top_operator_share,
            top_operator=top_operator,
        )
    )
    fraud_score, fraud_contributions = score_weighted_kpis(_build_fraud_kpis(summary))
    anomaly_score, anomaly_contributions = score_weighted_kpis(
        _build_anomaly_kpis(
            summary,
            live_snapshot=live_snapshot,
            top_operator=top_operator,
        )
    )
    optimization_score, optimization_contributions = score_weighted_kpis(
        _build_optimization_kpis(
            summary,
            projected_gap_ratio=projected_gap_ratio,
            top_operator_share=top_operator_share,
        )
    )
    equipment_score, equipment_contributions = score_weighted_kpis(
        _build_equipment_kpis(
            summary,
            live_snapshot=live_snapshot,
        )
    )
    workflow_score, workflow_contributions = score_weighted_kpis(
        _build_workflow_kpis(
            summary,
            live_snapshot=live_snapshot,
        )
    )
    risk_score, risk_contributions = score_weighted_kpis(
        _build_risk_kpis(
            summary,
            top_operator=top_operator,
        )
    )
    roaming_score, roaming_contributions = score_weighted_kpis(
        _build_roaming_kpis(
            summary,
            live_snapshot=live_snapshot,
        )
    )

    cost_score = blend_health_scores(cost_score, _live_cost_health(live_snapshot), live_weight=0.2)
    fraud_score = blend_health_scores(
        fraud_score,
        _live_fraud_health(live_snapshot),
        live_weight=0.24,
    )
    anomaly_score = blend_health_scores(
        anomaly_score,
        _live_anomaly_health(live_snapshot),
        live_weight=0.22,
    )
    optimization_score = blend_health_scores(
        optimization_score,
        live_snapshot.optimization_score if live_snapshot is not None else None,
        live_weight=0.2,
    )
    equipment_score = blend_health_scores(
        equipment_score,
        live_snapshot.equipment_score if live_snapshot is not None else None,
        live_weight=0.22,
    )
    workflow_score = blend_health_scores(
        workflow_score,
        _live_workflow_health(live_snapshot),
        live_weight=0.24,
    )
    risk_score = blend_health_scores(
        risk_score,
        _clamp_score(100 - (live_snapshot.risk_score * 0.55)) if live_snapshot is not None else None,
        live_weight=0.24,
    )
    roaming_score = blend_health_scores(
        roaming_score,
        _live_roaming_health(live_snapshot),
        live_weight=0.24,
    )

    scores = {
        "cost_score": cost_score,
        "fraud_score": fraud_score,
        "anomaly_score": anomaly_score,
        "optimization_score": optimization_score,
        "equipment_score": equipment_score,
        "workflow_score": workflow_score,
        "risk_score": risk_score,
        "roaming_score": roaming_score,
    }
    fleet_health_score = aggregate_health_scores(
        [
            (cost_score, 0.18),
            (fraud_score, 0.15),
            (anomaly_score, 0.15),
            (optimization_score, 0.12),
            (equipment_score, 0.12),
            (workflow_score, 0.1),
            (risk_score, 0.1),
            (roaming_score, 0.08),
        ]
    )
    fleet_health_score = blend_health_scores(
        fleet_health_score,
        live_snapshot.fleet_health_score if live_snapshot is not None else None,
        live_weight=0.18,
    )
    fleet_health_level = health_level_from_score(fleet_health_score)
    global_risk = global_risk_from_health_score(fleet_health_score)
    trend = trend_from_signals(
        projected_gap_ratio=projected_gap_ratio,
        live_cost_delta_pct=live_snapshot.live_cost_delta_pct if live_snapshot is not None else None,
    )

    all_contributions = sorted(
        [
            *cost_contributions,
            *fraud_contributions,
            *anomaly_contributions,
            *optimization_contributions,
            *equipment_contributions,
            *workflow_contributions,
            *risk_contributions,
            *roaming_contributions,
        ],
        key=lambda contribution: (
            contribution.weighted_pressure,
            contribution.normalized_pressure,
        ),
        reverse=True,
    )
    key_factors = [_to_key_factor(contribution) for contribution in all_contributions[:8]]
    main_risks = [contribution.evidence for contribution in all_contributions[:4]]
    main_strengths = _build_domain_strengths(scores)
    recommendations = _build_recommendations(scores, summary=summary)
    explanation = _build_explanation(all_contributions)

    score_breakdown = [
        {"label": _domain_label(domain_key), "value": domain_score}
        for domain_key, domain_score in scores.items()
    ]

    return {
        "fleet_health_score": fleet_health_score,
        "fleet_health_level": fleet_health_level,
        "global_risk": global_risk,
        "trend": trend,
        "scores": scores,
        "risk_score": risk_score,
        "cost_score": cost_score,
        "fraud_score": fraud_score,
        "anomaly_score": anomaly_score,
        "optimization_score": optimization_score,
        "equipment_score": equipment_score,
        "workflow_score": workflow_score,
        "roaming_score": roaming_score,
        "main_risks": main_risks,
        "main_strengths": main_strengths,
        "recommendations": recommendations,
        "explanation": explanation,
        "score_breakdown": score_breakdown,
        "key_factors": key_factors,
        "summary_updated_at": summary.updated_at,
        "sources": [
            *summary.sources,
            *(["live_monitoring"] if live_snapshot is not None else []),
        ],
        "cached": False,
        "fallback_used": False,
        "duration_ms": None,
    }


def build_fleet_health_answer(summary: "DataSummary", *, live_snapshot: "LiveMonitoringSnapshotResponse | None" = None) -> str:
    payload = build_fleet_health_payload(summary, live_snapshot=live_snapshot)
    scores = payload["scores"]
    assert isinstance(scores, dict)

    top_department = summary.risky_departments[0] if summary.risky_departments else None
    recommendations = payload["recommendations"]
    assert isinstance(recommendations, list)

    lines = [
        "Fleet Health Score",
        (
            f"- {payload['fleet_health_score']}/100 - niveau {payload['fleet_health_level']} - "
            f"risque global {payload['global_risk']}"
        ),
        (
            f"- Sous pression: roaming {scores['roaming_score']}/100, "
            f"anomalies {scores['anomaly_score']}/100, couts {scores['cost_score']}/100"
        ),
    ]

    if top_department is not None:
        lines.append(
            f"- Departement le plus exposé: {top_department.label} ({round(top_department.risk_score)}/100)"
        )

    lines.append(f"Insight: {payload['explanation']}")
    if recommendations:
        lines.append(f"Recommandation: {recommendations[0]}")
    return "\n".join(lines[:6])


def build_fleet_health_why_score_answer(
    summary: "DataSummary",
    *,
    live_snapshot: "LiveMonitoringSnapshotResponse | None" = None,
) -> str:
    payload = build_fleet_health_payload(summary, live_snapshot=live_snapshot)
    risk_items = payload["main_risks"]
    recommendations = payload["recommendations"]
    assert isinstance(risk_items, list)
    assert isinstance(recommendations, list)

    lines = [
        "Pourquoi le score diminue",
        f"- Score actuel: {payload['fleet_health_score']}/100",
    ]
    lines.extend(f"- {item}" for item in risk_items[:3])
    lines.append(f"Insight: {payload['explanation']}")
    if recommendations:
        lines.append(f"Recommandation: {recommendations[0]}")
    return "\n".join(lines[:7])


def build_fleet_health_improvement_answer(
    summary: "DataSummary",
    *,
    live_snapshot: "LiveMonitoringSnapshotResponse | None" = None,
) -> str:
    payload = build_fleet_health_payload(summary, live_snapshot=live_snapshot)
    recommendations = payload["recommendations"]
    scores = payload["scores"]
    assert isinstance(recommendations, list)
    assert isinstance(scores, dict)

    lines = [
        "Comment ameliorer le Fleet Health Score",
        (
            f"- Priorites: roaming {scores['roaming_score']}/100, couts {scores['cost_score']}/100, "
            f"equipements {scores['equipment_score']}/100"
        ),
    ]
    lines.extend(f"- {item}" for item in recommendations[:3])
    lines.append("Insight: les leviers les plus rapides sont ceux qui combinent cout, roaming et nettoyage des lignes critiques.")
    lines.append(
        f"Recommandation: {recommendations[0] if recommendations else 'Traiter les poches de risque les plus faibles du score.'}"
    )
    return "\n".join(lines[:7])


def build_fleet_health_department_answer(
    summary: "DataSummary",
    *,
    live_snapshot: "LiveMonitoringSnapshotResponse | None" = None,
) -> str:
    payload = build_fleet_health_payload(summary, live_snapshot=live_snapshot)
    department = summary.risky_departments[0] if summary.risky_departments else None

    if department is None:
        return (
            "Departement le plus impactant\n"
            "- Aucun departement prioritaire n'est disponible.\n"
            "Insight: le classement departemental n'est pas exploitable sur les donnees actuelles.\n"
            "Recommandation: consolider les alertes par departement avant arbitrage."
        )

    lines = [
        "Departement qui impacte le score",
        f"- {department.label} porte {_format_mad(department.monthly_cost_mad)}",
        f"- Risque moyen {round(department.risk_score)}/100 avec {department.alert_count} alertes",
        f"Insight: {payload['explanation']}",
        f"Recommandation: Traiter d'abord {department.label} avant d'etendre les actions au reste de la flotte.",
    ]
    return "\n".join(lines[:6])
