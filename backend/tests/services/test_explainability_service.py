import asyncio

from app.models.phone_line import PhoneLine
from app.models.plan import Plan
from app.schemas.chat import ExplainRecommendationRequest, ExplainabilityRequest
from app.services.chat_service import ChatDataUnavailableError
from app.services.explainability_service import generate_explainability_response
from app.services.recommendation_explainability_service import RecommendationExplainabilityService


def test_generate_explainability_response_uses_available_data(
    db_session,
    monkeypatch,
) -> None:
    db_session.add_all(
        [
            Plan(
                name="Business 100Go",
                operator_name="Maroc Telecom",
                monthly_price=520,
                voice_quota="Illimite",
                data_quota="100Go",
                sms_quota="Illimite",
                roaming_zone="Monde",
                active_lines=1,
                activation_status="active",
            ),
            PhoneLine(
                phone_number="+212600000111",
                operator_name="Maroc Telecom",
                plan_name="Business 100Go",
                assigned_to="Admin Test",
                department="IT",
                status="active",
                monthly_limit=100,
                current_data_usage_gb=18,
                previous_data_usage_gb=16,
            ),
        ]
    )
    db_session.commit()

    async def fake_generate_with_ollama(prompt: str) -> str:
        assert "Format attendu" in prompt
        return (
            '{"answer":'
            '"Cette alerte est justifiee par des couts en hausse, un departement IT expose et des signaux fraude deja presents."}'
        )

    monkeypatch.setattr(
        "app.services.explainability_service._generate_with_ollama",
        fake_generate_with_ollama,
    )

    response = asyncio.run(
        generate_explainability_response(
            db_session,
            ExplainabilityRequest(
                question="Pourquoi cette alerte ?",
                focus_label="Alerte roaming IT",
                message_text="Attention. Le departement IT depasse son roaming.",
                image_analysis={
                    "image_type": "alerte",
                    "detected_operator": "Maroc Telecom",
                    "detected_anomalies": ["Hausse roaming +27%", "Depassements repetes"],
                    "recommendations": ["Verifier les lignes roaming IT"],
                    "risk_level": "high",
                    "anomaly_score": 76,
                    "fraud_score": 61,
                    "incident_details": {
                        "alert_type": "alerte",
                        "severity": "critique",
                        "priority": "immediate",
                        "summary": "Le departement IT presente une hausse roaming inhabituelle.",
                        "probable_causes": ["Hausse roaming +27%", "Depassements repetes"],
                    },
                },
            ),
        )
    )

    assert response.answer.startswith("Cette alerte est justifiee")
    assert 0.0 <= response.confidence <= 1.0
    assert response.risk_level in {"medium", "high", "critical"}
    assert response.influencing_factors
    assert response.critical_zones
    assert response.charts.factor_breakdown
    assert response.charts.score_radar
    assert response.recommendations


def test_explain_recommendation_service_builds_grounded_xai_payload(
    db_session,
) -> None:
    db_session.add_all(
        [
            Plan(
                name="Business XL",
                operator_name="Maroc Telecom",
                monthly_price=890,
                voice_quota="Illimite",
                data_quota="150Go",
                sms_quota="Illimite",
                roaming_zone="Monde",
                active_lines=2,
                activation_status="active",
            ),
            PhoneLine(
                phone_number="+212600000221",
                operator_name="Maroc Telecom",
                plan_name="Business XL",
                assigned_to="Admin Test",
                department="IT",
                status="active",
                monthly_limit=150,
                current_data_usage_gb=126,
                previous_data_usage_gb=121,
            ),
        ]
    )
    db_session.commit()

    service = RecommendationExplainabilityService(db_session)
    response = asyncio.run(
        service.explain_recommendation(
            ExplainRecommendationRequest(
                recommendation_title="Reduire forfait XL",
                history=[{"role": "user", "text": "Pourquoi l'IA recommande cela ?"}],
                executive_report={
                    "executive_summary": "Pression budgetaire sur les forfaits premium.",
                    "fleet_health_score": 78,
                    "risk_level": "medium",
                    "risk_score": 64,
                    "fraud_score": 35,
                    "optimization_score": 84,
                    "anomaly_score": 58,
                    "equipment_score": 31,
                    "estimated_savings": "96 000 MAD",
                    "high_risk_departments": [
                        {
                            "department": "IT",
                            "risk_score": 72,
                            "monthly_cost_mad": 21000.0,
                            "alert_count": 4,
                            "reason": "Le departement concentre les forfaits premium et plusieurs depassements.",
                        }
                    ],
                    "costly_operators": [
                        {
                            "operator": "Maroc Telecom",
                            "total_cost_mad": 46000.0,
                            "suspicious_calls": 1,
                            "roaming_lines": 3,
                            "reason": "Part budgetaire la plus elevee sur les forfaits XL.",
                        }
                    ],
                    "priority_risks": ["Forfaits XL trop chers pour l'usage constate."],
                    "top_recommendations": [
                        {
                            "title": "Reduire forfait XL",
                            "priority": "high",
                            "justification": (
                                "Le cout des forfaits XL reste eleve, plusieurs depassements et du roaming "
                                "persistent concentrent la depense sur IT."
                            ),
                            "action": "Basculer les profils moyens vers un forfait plus cible.",
                            "estimated_saving_mad": 12000.0,
                        }
                    ],
                    "score_explanations": [
                        {
                            "label": "Optimisation",
                            "score": 84,
                            "level": "critique",
                            "direction": "higher_is_worse",
                            "explanation": "Les forfaits premium restent surdimensionnes par rapport a l'usage.",
                        }
                    ],
                },
                use_live_context=False,
            )
        )
    )

    assert response.recommendation == "Reduire forfait XL"
    assert response.answer
    assert response.estimated_savings == "12 000 MAD/an"
    assert response.confidence_score >= 0.7
    assert response.impact_score >= 70
    assert response.optimization_score >= 80
    assert response.reasoning.factors
    assert response.reasoning.kpis
    assert response.reasoning.risks
    assert response.reasoning.impact
    assert response.reasoning.business_explanation
    assert any(factor.label in {"Cout eleve", "Decision IA priorisee"} for factor in response.influencing_factors)
    assert response.decision_trace
    assert response.supporting_kpis
    assert response.sources


def test_explain_recommendation_service_falls_back_when_summary_data_is_unavailable(
    db_session,
    monkeypatch,
) -> None:
    def fake_get_data_summary(_db):
        raise ChatDataUnavailableError("Fichier introuvable: fleet_ai_results_morocco.csv")

    monkeypatch.setattr(
        "app.services.recommendation_explainability_service.get_data_summary",
        fake_get_data_summary,
    )

    service = RecommendationExplainabilityService(db_session)
    response = asyncio.run(
        service.explain_recommendation(
            ExplainRecommendationRequest(
                recommendation_title="Verifier le roaming international",
                history=[{"role": "user", "text": "Pourquoi cette recommandation ?"}],
                use_live_context=False,
            )
        )
    )

    assert response.recommendation == "Verifier le roaming international"
    assert response.answer
    assert response.reasoning.business_explanation
    assert response.sources
    assert response.duration_ms is not None
