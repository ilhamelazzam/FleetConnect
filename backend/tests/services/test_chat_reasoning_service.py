import pytest
from sqlalchemy.orm import Session

from app.services.chat_reasoning_service import (
    BusinessReasoningSnapshot,
    CountryReasoningMetric,
    DeviceCategoryReasoningMetric,
    LineReasoningMetric,
    PlanReasoningMetric,
    ScopedReasoningMetric,
    build_business_reasoning_result,
)
from app.services.chat_service import DataSummary, SummaryCriticalLine, SummaryMetric, SummaryPlan


def _build_summary() -> DataSummary:
    return DataSummary(
        prompt_context="Resume metier de test",
        sources=["fleet_ai_results_morocco.csv", "phone_lines", "plans"],
        updated_at="2026-05-05T15:47:00+00:00",
        signature="reasoning-summary-test",
        total_lines=20,
        active_lines=17,
        free_lines=2,
        assigned_lines=15,
        in_progress_lines=1,
        suspended_lines=2,
        inactive_lines=1,
        total_monthly_cost_mad=18200,
        projected_monthly_cost_mad=20100,
        alert_count=16,
        critical_alert_count=7,
        budget_alert_count=8,
        mobile_alert_count=3,
        mobile_device_total=24,
        mobile_critical_count=5,
        fraud_alert_count=4,
        total_call_count=110,
        suspicious_call_count=12,
        suspicious_call_cost_mad=4560.0,
        high_cost_call_count=7,
        over_quota_count=6,
        anomaly_count=3,
        roaming_line_count=4,
        roaming_alert_count=3,
        expensive_operators=[
            SummaryMetric(label="Maroc Telecom", monthly_cost_mad=9200, risk_score=76, alert_count=6),
            SummaryMetric(label="Orange", monthly_cost_mad=6100, risk_score=58, alert_count=4),
        ],
        risky_departments=[
            SummaryMetric(label="Finance", monthly_cost_mad=6400, risk_score=71, alert_count=5),
            SummaryMetric(label="IT", monthly_cost_mad=4200, risk_score=43, alert_count=2),
        ],
        expensive_plans=[
            SummaryPlan(
                operator="Maroc Telecom",
                plan="Business XL",
                average_cost_mad=510,
                line_count=6,
                alert_count=3,
            )
        ],
        critical_lines=[
            SummaryCriticalLine(
                label="+212600000777",
                operator="Maroc Telecom",
                department="Finance",
                status="active",
                risk_score=84,
                usage_label="48.0/50.0 Go",
                monthly_cost_mad=510,
                action="Verifier le quota et la legitimite de l'usage.",
            )
        ],
        recommendations=["Arbitrer les forfaits Business XL sur les usages moderes."],
        roaming_geo_highlights=["Espagne: 2 200 MAD, 4 signal(s), 2 alerte(s)"],
    )


def _build_snapshot() -> BusinessReasoningSnapshot:
    return BusinessReasoningSnapshot(
        operators={
            "maroc telecom": ScopedReasoningMetric(
                label="Maroc Telecom",
                monthly_cost_mad=9200,
                projected_monthly_cost_mad=10350,
                risk_score=76,
                alert_count=6,
                line_count=9,
                over_quota_count=4,
                anomaly_count=2,
                roaming_count=1,
                suspicious_call_count=5,
                suspicious_call_cost_mad=2100,
                equipment_alert_count=1,
            ),
            "orange": ScopedReasoningMetric(
                label="Orange",
                monthly_cost_mad=6100,
                projected_monthly_cost_mad=6500,
                risk_score=58,
                alert_count=4,
                line_count=6,
                over_quota_count=2,
                anomaly_count=1,
                roaming_count=0,
                suspicious_call_count=2,
                suspicious_call_cost_mad=640,
                equipment_alert_count=1,
            ),
        },
        departments={
            "finance": ScopedReasoningMetric(
                label="Finance",
                monthly_cost_mad=6400,
                projected_monthly_cost_mad=7300,
                risk_score=71,
                alert_count=5,
                line_count=7,
                over_quota_count=3,
                anomaly_count=2,
                roaming_count=1,
                suspicious_call_count=4,
                suspicious_call_cost_mad=1700,
                equipment_alert_count=1,
            ),
            "it": ScopedReasoningMetric(
                label="IT",
                monthly_cost_mad=4200,
                projected_monthly_cost_mad=4500,
                risk_score=43,
                alert_count=2,
                line_count=5,
                over_quota_count=1,
                anomaly_count=0,
                roaming_count=0,
                suspicious_call_count=1,
                suspicious_call_cost_mad=220,
                equipment_alert_count=0,
            ),
        },
        plans={
            "maroc telecom::business xl": PlanReasoningMetric(
                label="Business XL",
                operator="Maroc Telecom",
                average_cost_mad=510,
                total_cost_mad=3060,
                line_count=6,
                alert_count=3,
                over_quota_count=2,
                average_usage_ratio=0.76,
            )
        },
        countries={
            "espagne": CountryReasoningMetric(
                label="Espagne",
                total_cost_mad=2200,
                alert_count=2,
                suspicious_call_count=2,
                event_count=4,
            )
        },
        lines={
            "212600000777": LineReasoningMetric(
                label="+212600000777",
                operator="Maroc Telecom",
                department="Finance",
                plan="Business XL",
                status="active",
                monthly_cost_mad=510,
                risk_score=84,
                usage_gb=48.0,
                quota_gb=50.0,
                roaming=False,
            ),
            "212600000778": LineReasoningMetric(
                label="+212600000778",
                operator="Maroc Telecom",
                department="Finance",
                plan="Business XL",
                status="libre",
                monthly_cost_mad=510,
                risk_score=61,
                usage_gb=4.0,
                quota_gb=50.0,
                roaming=False,
            ),
            "212600000779": LineReasoningMetric(
                label="+212600000779",
                operator="Maroc Telecom",
                department="Finance",
                plan="Business XL",
                status="active",
                monthly_cost_mad=510,
                risk_score=52,
                usage_gb=8.0,
                quota_gb=50.0,
                roaming=False,
            ),
        },
        device_categories={
            "haut de gamme": DeviceCategoryReasoningMetric(
                label="Haut de gamme",
                estimated_cost_mad=13500,
                average_risk_score=74,
                alert_count=3,
                critical_count=2,
                device_count=4,
            ),
            "milieu de gamme": DeviceCategoryReasoningMetric(
                label="Milieu de gamme",
                estimated_cost_mad=9600,
                average_risk_score=41,
                alert_count=1,
                critical_count=0,
                device_count=6,
            ),
        },
    )


def test_build_business_reasoning_result_builds_department_comparison(
    db_session: Session,
    monkeypatch,
) -> None:
    summary = _build_summary()
    snapshot = _build_snapshot()

    monkeypatch.setattr(
        "app.services.chat_reasoning_service._get_snapshot",
        lambda summary, db: snapshot,
    )

    result = build_business_reasoning_result(
        db_session,
        question="Compare Finance et IT",
        history=[],
        summary=summary,
    )

    assert result.request_type == "comparison"
    assert result.strategy_key == "budget:comparison"
    assert result.validation_passed is True
    assert "Resume executif" in result.answer
    assert "Tableau comparatif" in result.answer
    assert "Comparaison departements - Finance vs IT" in result.answer
    assert "Actions recommandees" in result.answer
    assert "Indice de confiance" in result.answer
    assert "Perimetre le plus tendu: Finance" in result.answer
    assert result.entities[:2] == ["Finance", "IT"]


def test_build_business_reasoning_result_builds_country_roaming_answer(
    db_session: Session,
    monkeypatch,
) -> None:
    summary = _build_summary()
    snapshot = _build_snapshot()

    monkeypatch.setattr(
        "app.services.chat_reasoning_service._get_snapshot",
        lambda summary, db: snapshot,
    )

    result = build_business_reasoning_result(
        db_session,
        question="Quel risque roaming vois-tu en Espagne ?",
        history=[],
        summary=summary,
    )

    assert result.primary_domain == "roaming"
    assert result.validation_passed is True
    assert "Resume executif" in result.answer
    assert "Analyse roaming - Espagne" in result.answer
    assert "Analyse et justification" in result.answer
    assert "Actions recommandees" in result.answer
    assert "Indice de confiance" in result.answer
    assert "Cout roaming 2 200 MAD" in result.answer
    assert "2 appels suspects" in result.answer


def test_build_business_reasoning_result_distinguishes_budget_optimization_from_estimation(
    db_session: Session,
    monkeypatch,
) -> None:
    summary = _build_summary()
    snapshot = _build_snapshot()

    monkeypatch.setattr(
        "app.services.chat_reasoning_service._get_snapshot",
        lambda summary, db: snapshot,
    )

    optimization_result = build_business_reasoning_result(
        db_session,
        question="Comment optimiser le budget de Maroc Telecom ?",
        history=[],
        summary=summary,
    )
    estimation_result = build_business_reasoning_result(
        db_session,
        question="Quelle estimation budgetaire pour Maroc Telecom le mois prochain ?",
        history=[],
        summary=summary,
    )

    assert optimization_result.primary_domain == "budget"
    assert estimation_result.primary_domain == "budget"
    assert optimization_result.request_type == "optimization"
    assert estimation_result.request_type == "estimation"
    assert optimization_result.strategy_key == "budget:optimization"
    assert estimation_result.strategy_key == "budget:estimation"
    assert optimization_result.answer != estimation_result.answer
    assert "Resume executif" in optimization_result.answer
    assert "Optimisation budgetaire - Maroc Telecom" in optimization_result.answer
    assert "Vision strategique" in optimization_result.answer
    assert "Indice de confiance" in optimization_result.answer
    assert "lignes sous-utilisees" in optimization_result.answer
    assert "Resume executif" in estimation_result.answer
    assert "Estimation budgetaire - Maroc Telecom" in estimation_result.answer
    assert "Projection et impact" in estimation_result.answer
    assert "Indice de confiance" in estimation_result.answer
    assert "Ecart projete" in estimation_result.answer


@pytest.mark.parametrize(
    ("question", "expected_intent", "expected_handler", "expected_domain"),
    [
        ("Ou dois-je reduire les couts telecom ?", "cost_optimization", "handle_cost_optimization_intent", "budget"),
        ("Quelles economies potentielles sur Maroc Telecom ?", "potential_savings", "handle_potential_savings_intent", "budget"),
        ("Quels forfaits sont surdimensionnes ?", "oversized_plans", "handle_oversized_plans_intent", "plans"),
        ("Quelles lignes depassent leur quota data ?", "quota_overruns", "handle_quota_overruns_intent", "consumption"),
        ("Analyse les signaux de fraude sur la flotte", "fraud", "handle_fraud_intent", "fraud"),
        ("Classe les appels suspects a auditer", "suspicious_calls", "handle_suspicious_calls_intent", "fraud"),
        ("Quel risque roaming vois-tu en Espagne ?", "roaming", "handle_roaming_intent", "roaming"),
        ("Quels equipements doivent etre renouveles ?", "maintenance", "handle_maintenance_intent", "equipment"),
        ("Donne l inventaire des equipements", "equipment", "handle_equipment_intent", "equipment"),
        ("Analyse la consommation des lignes", "consumption", "handle_consumption_intent", "consumption"),
        ("Quel operateur coute le plus cher ?", "operators", "handle_operators_intent", "budget"),
        ("Quel departement consomme le plus ?", "departments", "handle_departments_intent", "budget"),
        ("Quelle tendance vois-tu sur les couts ?", "trends", "handle_trends_intent", "budget"),
        ("Quelle prevision budgetaire pour le mois prochain ?", "forecasts", "handle_forecasts_intent", "budget"),
        ("Compare Finance et IT", "comparison", "handle_comparison_intent", "budget"),
        ("Donne les KPI de la flotte", "kpi", "handle_kpi_intent", "performance"),
        ("Quelles recommandations prioritaires proposes-tu ?", "recommendations", "handle_recommendations_intent", "planning"),
        ("Priorise les actions de la semaine", "prioritization", "handle_prioritization_intent", "planning"),
        ("Genere un plan d action pour la flotte", "action_plan", "handle_action_plan_intent", "planning"),
        ("Lance un audit telecom cible", "audit", "handle_audit_intent", "audit"),
        ("Analyse la conformite des lignes et forfaits", "compliance", "handle_compliance_intent", "audit"),
    ],
)
def test_build_business_reasoning_result_routes_specialized_intents(
    db_session: Session,
    monkeypatch,
    question: str,
    expected_intent: str,
    expected_handler: str,
    expected_domain: str,
) -> None:
    summary = _build_summary()
    snapshot = _build_snapshot()

    monkeypatch.setattr(
        "app.services.chat_reasoning_service._get_snapshot",
        lambda summary, db: snapshot,
    )

    result = build_business_reasoning_result(
        db_session,
        question=question,
        history=[],
        summary=summary,
    )

    assert result.intent_category == expected_intent
    assert result.intent_handler == expected_handler
    assert result.primary_domain == expected_domain
    assert result.intent_fallback_used is False
    assert result.intent_confidence >= 0.42
    assert result.validation_passed is True
    assert "Resume executif" in result.answer
    assert "Actions recommandees" in result.answer
    assert "Indice de confiance" in result.answer


def test_build_business_reasoning_result_uses_generic_only_as_last_resort(
    db_session: Session,
    monkeypatch,
) -> None:
    summary = _build_summary()
    snapshot = _build_snapshot()

    monkeypatch.setattr(
        "app.services.chat_reasoning_service._get_snapshot",
        lambda summary, db: snapshot,
    )

    result = build_business_reasoning_result(
        db_session,
        question="Quel est le churn actuel ?",
        history=[],
        summary=summary,
    )

    assert result.intent_category == "generic_summary"
    assert result.intent_handler == "handle_generic_summary_intent"
    assert result.intent_fallback_used is True
    assert result.intent_match_mode == "generic_fallback"
    assert result.analysis_strategy == "executive_summary"
    assert result.data_gaps
    assert "churn" in result.data_gaps[0]
    assert "Cadre d'analyse" in result.answer
    assert "Donnees partielles" in result.answer


def test_build_business_reasoning_result_infers_executive_detail_and_explainability(
    db_session: Session,
    monkeypatch,
) -> None:
    summary = _build_summary()
    snapshot = _build_snapshot()

    monkeypatch.setattr(
        "app.services.chat_reasoning_service._get_snapshot",
        lambda summary, db: snapshot,
    )

    result = build_business_reasoning_result(
        db_session,
        question="Que doit retenir un DAF avant la revue mensuelle ?",
        history=[],
        summary=summary,
    )

    assert result.detail_level == "executive"
    assert result.analysis_strategy == "executive_summary"
    assert result.business_goal is not None
    assert "lecture decisionnelle rapide" in result.business_goal
    assert "fleet_ai_results_morocco.csv" in result.selected_sources
    assert "Cadre d'analyse" in result.answer
    assert "Sources mobilisees" in result.answer
    assert "Criteres appliques" in result.answer


def test_build_business_reasoning_result_selects_multiple_sources_for_cross_risk_priority(
    db_session: Session,
    monkeypatch,
) -> None:
    summary = _build_summary()
    snapshot = _build_snapshot()

    monkeypatch.setattr(
        "app.services.chat_reasoning_service._get_snapshot",
        lambda summary, db: snapshot,
    )

    result = build_business_reasoning_result(
        db_session,
        question="Quelle priorite entre roaming et appels suspects ?",
        history=[],
        summary=summary,
    )

    assert result.analysis_strategy == "action_prioritization"
    assert "telecom_cdr_fraud_fleetconnect_enriched.csv" in result.selected_sources
    assert "decision_prioritization" in result.selected_sources
    assert "roaming" in result.secondary_domains or result.primary_domain in {"fraud", "roaming"}
    assert result.source_reasons
    assert "Cadre d'analyse" in result.answer
    assert "Fusion des sources" in result.answer
