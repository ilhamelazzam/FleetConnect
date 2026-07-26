import asyncio

from app.models.phone_line import PhoneLine
from app.models.plan import Plan
from app.schemas.chat import ExecutiveReportImageContext
from app.services.executive_report_service import generate_executive_report


def test_generate_executive_report_aggregates_available_data(
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
            Plan(
                name="Premium 50Go",
                operator_name="Orange Maroc",
                monthly_price=280,
                voice_quota="Illimite",
                data_quota="50Go",
                sms_quota="Illimite",
                roaming_zone="International",
                active_lines=0,
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
            PhoneLine(
                phone_number="+212600000222",
                operator_name="Orange Maroc",
                plan_name="Premium 50Go",
                assigned_to=None,
                department="Finance",
                status="inactive",
                monthly_limit=50,
                current_data_usage_gb=0,
                previous_data_usage_gb=2,
            ),
        ]
    )
    db_session.commit()

    async def fake_generate_with_ollama(prompt: str) -> str:
        assert "executive_summary" in prompt
        return (
            '{"executive_summary":'
            '"La flotte presente un risque moyen avec un departement IT a surveiller."}'
        )

    monkeypatch.setattr(
        "app.services.executive_report_service._generate_with_ollama",
        fake_generate_with_ollama,
    )

    response = asyncio.run(
        generate_executive_report(
            db_session,
            history=[],
            conversation_id="conv-service-1",
            image_analyses=[
                ExecutiveReportImageContext(
                    image_type="workflow",
                    detected_kpis=["Complexite workflow 78/100"],
                    workflow_details={
                        "workflow_type": "processus_metier",
                        "complexity_score": 78,
                        "complexity_level": "high",
                        "critical_steps": ["Validation manager"],
                        "detected_departments": ["IT"],
                        "detected_roles": ["Manager"],
                        "automation_opportunities": ["Automatiser les validations repetitives"],
                        "bottlenecks": ["Validation manager"],
                        "repeated_validations": ["Validation manager"],
                        "summary": "Workflow telecom complexe",
                    },
                )
            ],
        )
    )

    assert response.executive_summary.startswith("La flotte presente un risque moyen")
    assert 0 <= response.fleet_health_score <= 100
    assert 0 <= response.risk_score <= 100
    assert response.multimodal_analysis_count == 1
    assert response.estimated_savings_mad >= 0
    assert response.charts.score_breakdown
    assert response.top_recommendations
