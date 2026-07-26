from pathlib import Path

import pytest

from app.schemas.chat import ChatActionPlanResponse, ExecutiveReportResponse, ExplainabilityResponse
from app.schemas.reports import ReportGenerateRequest
from app.services import report_generation_service


def _build_executive_report_response() -> ExecutiveReportResponse:
    return ExecutiveReportResponse(
        executive_summary=(
            "La flotte reste globalement stable mais le roaming IT, les alertes fraude "
            "et plusieurs equipements obsoletes maintiennent une pression operationnelle."
        ),
        fleet_health_score=82,
        fleet_health_level="bon",
        risk_level="medium",
        risk_score=58,
        fraud_score=64,
        optimization_score=77,
        anomaly_score=61,
        equipment_score=69,
        critical_costs=[],
        high_risk_departments=[],
        costly_operators=[],
        major_anomalies=[],
        fraud_signals=[],
        priority_risks=["Roaming IT a surveiller", "Equipements obsoletes"],
        optimization_opportunities=[],
        top_recommendations=[],
        estimated_savings="184 000 MAD",
        estimated_savings_mad=184000.0,
        multimodal_highlights=["2 analyses OCR / vision consolidees"],
        multimodal_analysis_count=2,
        score_explanations=[],
        charts={
            "cost_evolution": [
                {"label": "S-3", "value": 780000.0},
                {"label": "S-2", "value": 802000.0},
                {"label": "S-1", "value": 790000.0},
            ],
            "department_risk": [
                {"label": "IT", "value": 74.0},
                {"label": "Finance", "value": 48.0},
            ],
            "operator_costs": [
                {"label": "Maroc Telecom", "value": 410000.0},
                {"label": "Orange", "value": 220000.0},
            ],
            "score_breakdown": [
                {"label": "Fraude", "value": 64.0},
                {"label": "Optimisation", "value": 77.0},
                {"label": "Equipement", "value": 69.0},
            ],
        },
        model="llama3.2:3b",
        sources=["fleet_ai_results_morocco.csv", "cdr_analytics"],
        summary_updated_at="2026-05-12T08:30:00+00:00",
        cached=False,
        fallback_used=False,
        duration_ms=1480,
    )


def _build_explainability_response() -> ExplainabilityResponse:
    return ExplainabilityResponse(
        answer=(
            "Le score diminue surtout a cause du roaming IT, des signaux fraude et "
            "des equipements critiques detectes sur le perimetre analyse."
        ),
        confidence=0.91,
        risk_level="high",
        reasoning=["Roaming IT en hausse", "Alertes fraude", "Equipements critiques"],
        causes=["Roaming expose", "Obsolescence materielle"],
        influencing_factors=[
            {
                "label": "Roaming IT",
                "category": "cost",
                "value": "+27%",
                "impact_score": 84,
                "severity": "high",
                "evidence": "Hausse constatee sur les consommations roaming IT.",
            }
        ],
        explanation_graph={
            "summary": "Le risque est relie au roaming et a l'obsolescence.",
            "dominant_factor": "Roaming IT",
            "nodes": [
                {
                    "node_id": "roaming",
                    "label": "Roaming IT",
                    "node_type": "signal",
                    "severity": "high",
                    "weight": 84,
                }
            ],
            "edges": [],
        },
        critical_zones=[
            {
                "label": "Departement IT",
                "zone_type": "department",
                "severity": "high",
                "detail": "Expose au roaming et aux alertes critiques.",
                "value": "74/100",
            }
        ],
        recommendations=["Controler les lignes roaming critiques"],
        data_points_used=["fleet_ai_results_morocco.csv", "OCR vision"],
        confidence_score=91,
        fraud_score=64,
        anomaly_score=61,
        optimization_score=77,
        risk_score=58,
        equipment_score=69,
        charts={
            "factor_breakdown": [{"label": "Roaming IT", "value": 84.0}],
            "risk_timeline": [{"label": "S-1", "value": 58.0}],
            "critical_zone_heatmap": [{"label": "IT", "value": 74.0}],
            "score_radar": [{"label": "Fraude", "value": 64.0}],
        },
        model="llama3.2:3b",
        sources=["executive_report", "live_monitoring"],
        summary_updated_at="2026-05-12T08:40:00+00:00",
        cached=False,
        fallback_used=False,
        duration_ms=980,
    )


def _build_action_plan_response() -> ChatActionPlanResponse:
    return ChatActionPlanResponse(
        plan_title="Plan d'action IA hebdomadaire",
        subtitle="Priorites DSI calculees a partir des alertes et du Fleet Health Score.",
        answer="Trois actions prioritaires ressortent cette semaine.",
        model="llama3.2:3b",
        sources=["fleet_ai_results_morocco.csv"],
        summary_updated_at="2026-05-12T08:45:00+00:00",
        fleet_health_score=82,
        global_risk="medium",
        trend="improving",
        actions=[
            {
                "day": "Priorite 1",
                "title": "Verifier les depassements roaming IT",
                "detail": "Controle ciblage des lignes les plus exposees.",
                "priority": "high",
                "reason": "Hausse roaming detectee sur le departement IT.",
                "impact": "Reduction des couts roaming a court terme.",
                "deadline": "Cette semaine",
                "type": "cost",
                "status": "todo",
            }
        ],
        weekly_actions=[
            {
                "day": "Priorite 1",
                "title": "Verifier les depassements roaming IT",
                "detail": "Controle ciblage des lignes les plus exposees.",
                "priority": "high",
                "reason": "Hausse roaming detectee sur le departement IT.",
                "impact": "Reduction des couts roaming a court terme.",
                "deadline": "Cette semaine",
                "type": "cost",
                "status": "todo",
            }
        ],
        recommendations=["Lancer le controle roaming en priorite."],
        cached=False,
        fallback_used=False,
        duration_ms=640,
    )


@pytest.mark.anyio
async def test_generate_ai_pdf_report_creates_pdf_file(tmp_path: Path, monkeypatch) -> None:
    async def fake_generate_copilot_action_plan(db, history=None):
        return _build_action_plan_response()

    monkeypatch.setattr(report_generation_service, "GENERATED_REPORTS_DIR", tmp_path)
    monkeypatch.setattr(
        report_generation_service,
        "generate_copilot_action_plan",
        fake_generate_copilot_action_plan,
    )
    monkeypatch.setattr(
        report_generation_service,
        "get_live_monitoring_snapshot_if_ready",
        lambda: None,
    )

    payload = ReportGenerateRequest(
        report_type="complete",
        history=[{"role": "user", "text": "Genere un rapport IA complet."}],
        executive_report=_build_executive_report_response(),
        explainability=_build_explainability_response(),
        images=[
            {
                "title": "Workflow critique",
                "src": (
                    "data:image/png;base64,"
                    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sotx8sAAAAASUVORK5CYII="
                ),
                "caption": "Zone rouge identifiee sur le workflow.",
            }
        ],
    )

    response = await report_generation_service.generate_ai_pdf_report(None, payload)

    assert response.report_type == "complete"
    assert response.fleet_health_score == 82

    pdf_path = report_generation_service.get_generated_report_pdf_path(response.report_id)
    assert pdf_path is not None
    assert pdf_path.exists()
    assert pdf_path.suffix == ".pdf"
    assert pdf_path.stat().st_size > 0
