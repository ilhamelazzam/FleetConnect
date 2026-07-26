import json
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.schemas.chat import (
    ChatActionPlanResponse,
    ChatDecisionRecommendation,
    ChatEquipmentDetails,
    ChatImageAnnotation,
    ChatImageAnalysisMetadata,
    ChatImageResponse,
    ChatIncidentDetails,
    ChatWorkflowDetails,
    ExplainRecommendationResponse,
    ChatResponse,
    ExplainabilityResponse,
    ExecutiveReportResponse,
)
from app.services.chat_service import (
    AudioTooLargeError,
    ChatTimeoutError,
    ImageAnalysisTimeoutError,
    InvalidImageError,
    LocalModelUnavailableError,
    TtsUnavailableError,
)
from app.services.voice_conversation_service import VoiceConversationResponse
from app.services.voice_service import VoiceSpeechResult, VoiceTranscriptionResult


def test_chat_route_returns_structured_ollama_offline_error(
    client: TestClient,
    admin_headers: dict[str, str],
    monkeypatch,
) -> None:
    async def fake_generate_chat_response(db, *, question: str, history):
        raise LocalModelUnavailableError(
            "Le modèle IA local n’est pas lancé. Lancez Ollama puis réessayez."
        )

    monkeypatch.setattr(
        "app.api.routes.chat.generate_chat_response",
        fake_generate_chat_response,
    )

    response = client.post(
        "/api/v1/chat",
        headers=admin_headers,
        json={"question": "Quel opérateur coûte le plus cher ?", "history": []},
    )

    assert response.status_code == 503
    assert response.json() == {
        "success": False,
        "code": "OLLAMA_OFFLINE",
        "error_type": "ollama_offline",
        "message": "Le modèle IA local n’est pas lancé. Lancez Ollama puis réessayez.",
    }


def test_chat_route_returns_structured_timeout_error(
    client: TestClient,
    admin_headers: dict[str, str],
    monkeypatch,
) -> None:
    async def fake_generate_chat_response(db, *, question: str, history):
        raise ChatTimeoutError()

    monkeypatch.setattr(
        "app.api.routes.chat.generate_chat_response",
        fake_generate_chat_response,
    )

    response = client.post(
        "/api/v1/chat",
        headers=admin_headers,
        json={"question": "Quel opérateur coûte le plus cher ?", "history": []},
    )

    assert response.status_code == 504
    assert response.json() == {
        "success": False,
        "code": "TIMEOUT",
        "error_type": "timeout",
        "message": "La réponse prend trop de temps. Veuillez réessayer.",
    }


def test_copilot_action_plan_route_returns_structured_response(
    client: TestClient,
    admin_headers: dict[str, str],
    monkeypatch,
) -> None:
    def fake_generate_copilot_action_plan(db, *, history=None):
        return ChatActionPlanResponse(
            plan_title="Plan d'action IA hebdomadaire",
            subtitle="Synthèse opérationnelle de la flotte.",
            answer="Plan generé.",
            model="ollama",
            sources=["fleet_ai_results_morocco.csv"],
            summary_updated_at="2025-01-01T00:00:00Z",
            actions=[
                {
                    "day": "Priorite 1",
                    "title": "Verifier les alertes",
                    "detail": "Analyse des alertes prioritaires.",
                    "priority": "high",
                    "reason": "Hausse des alertes critiques sur la flotte.",
                    "impact": "Reduire le risque d'escalade.",
                    "deadline": "Cette semaine",
                    "type": "consumption",
                    "status": "todo",
                }
            ],
            weekly_actions=[
                {
                    "day": "Priorite 1",
                    "title": "Verifier les alertes",
                    "detail": "Analyse des alertes prioritaires.",
                    "priority": "high",
                    "reason": "Hausse des alertes critiques sur la flotte.",
                    "impact": "Reduire le risque d'escalade.",
                    "deadline": "Cette semaine",
                    "type": "consumption",
                    "status": "todo",
                }
            ],
            recommendations=["Prioriser les actions critiques."],
            cached=False,
            duration_ms=None,
        )

    monkeypatch.setattr(
        "app.api.routes.chat.generate_copilot_action_plan",
        fake_generate_copilot_action_plan,
    )

    response = client.post(
        "/api/v1/chat/copilot/actions",
        headers=admin_headers,
        json={"history": []},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["plan_title"] == "Plan d'action IA hebdomadaire"
    assert payload["actions"][0]["day"] == "Priorite 1"
    assert payload["actions"][0]["reason"] == "Hausse des alertes critiques sur la flotte."
    assert payload["recommendations"][0] == "Prioriser les actions critiques."


def test_chat_stream_returns_structured_error_event(
    client: TestClient,
    admin_headers: dict[str, str],
    monkeypatch,
) -> None:
    async def fake_stream_chat_response(request, db, *, question: str, history):
        yield (
            "event: error\n"
            f"data: {json.dumps({'code': 'TIMEOUT', 'message': 'La réponse prend trop de temps. Veuillez réessayer.'}, ensure_ascii=False)}\n\n"
        )

    monkeypatch.setattr(
        "app.api.routes.chat.stream_chat_response",
        fake_stream_chat_response,
    )

    with client.stream(
        "POST",
        "/api/v1/chat/stream",
        headers=admin_headers,
        json={"question": "Quel opérateur coûte le plus cher ?", "history": []},
    ) as response:
        body = "".join(response.iter_text())

    assert response.status_code == 200
    assert "event: error" in body
    assert '"code": "TIMEOUT"' in body


def test_chat_executive_report_route_returns_structured_payload(
    client: TestClient,
    admin_headers: dict[str, str],
    monkeypatch,
) -> None:
    async def fake_generate_executive_report(
        db,
        *,
        history,
        image_analyses,
        conversation_id: str | None = None,
    ) -> ExecutiveReportResponse:
        assert conversation_id == "conv-executive-1"
        assert len(history) == 1
        assert len(image_analyses) == 1
        return ExecutiveReportResponse(
            executive_summary=(
                "La flotte presente un risque moyen avec une pression budgetaire concentree sur IT "
                "et une exposition roaming a surveiller."
            ),
            fleet_health_score=82,
            fleet_health_level="bon",
            risk_level="medium",
            risk_score=58,
            fraud_score=42,
            optimization_score=79,
            anomaly_score=61,
            equipment_score=74,
            critical_costs=[],
            high_risk_departments=[],
            costly_operators=[],
            major_anomalies=[],
            fraud_signals=[],
            priority_risks=["Roaming a surveiller"],
            optimization_opportunities=[],
            top_recommendations=[],
            estimated_savings="184 000 MAD",
            estimated_savings_mad=184000.0,
            multimodal_highlights=["2 analyses multimodales consolidees"],
            multimodal_analysis_count=1,
            score_explanations=[],
            charts={
                "cost_evolution": [],
                "department_risk": [],
                "operator_costs": [],
                "score_breakdown": [],
            },
            model="llama3.2:3b",
            sources=["fleet_ai_results_morocco.csv", "cdr_analytics"],
            summary_updated_at="2026-05-09T11:10:00+00:00",
            cached=False,
            fallback_used=False,
            duration_ms=1680,
        )

    monkeypatch.setattr(
        "app.api.routes.chat.generate_executive_report",
        fake_generate_executive_report,
    )

    response = client.post(
        "/api/v1/chat/executive-report",
        headers=admin_headers,
        json={
            "conversation_id": "conv-executive-1",
            "history": [
                {
                    "role": "user",
                    "text": "Genere un rapport executif IA de la flotte.",
                }
            ],
            "image_analyses": [
                {
                    "image_type": "workflow",
                    "detected_kpis": ["Complexite workflow 78/100"],
                    "workflow_details": {
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
                }
            ],
        },
    )

    assert response.status_code == 200
    assert response.json()["fleet_health_score"] == 82
    assert response.json()["risk_level"] == "medium"
    assert response.json()["estimated_savings"] == "184 000 MAD"
    assert response.json()["multimodal_analysis_count"] == 1


def test_chat_explain_route_returns_structured_payload(
    client: TestClient,
    admin_headers: dict[str, str],
    monkeypatch,
) -> None:
    async def fake_generate_explainability_response(
        db,
        payload,
    ) -> ExplainabilityResponse:
        assert payload.focus_label == "Alerte roaming IT"
        return ExplainabilityResponse(
            answer=(
                "Cette alerte est classee critique car la hausse roaming, les appels suspects "
                "et le departement IT concentre plusieurs signaux convergents."
            ),
            confidence=0.91,
            risk_level="high",
            reasoning=["Hausse roaming +27%", "Depassements repetes", "Appels suspects detectes"],
            causes=["Roaming en hausse", "Departement IT expose"],
            influencing_factors=[
                {
                    "label": "Hausse roaming",
                    "category": "cost",
                    "value": "+27%",
                    "impact_score": 84,
                    "severity": "high",
                    "evidence": "Le roaming progresse fortement sur le perimetre IT.",
                }
            ],
            explanation_graph={
                "summary": "Graphe causal simplifie",
                "dominant_factor": "Hausse roaming",
                "nodes": [
                    {
                        "node_id": "decision",
                        "label": "Alerte roaming IT",
                        "node_type": "decision",
                        "severity": "high",
                        "weight": 84,
                    }
                ],
                "edges": [],
            },
            critical_zones=[
                {
                    "label": "IT",
                    "zone_type": "department",
                    "severity": "high",
                    "detail": "Zone la plus exposee",
                    "value": "84/100",
                }
            ],
            recommendations=["Verifier les lignes roaming IT"],
            data_points_used=["Roaming +27%", "147 appels suspects"],
            confidence_score=91,
            fraud_score=72,
            anomaly_score=76,
            optimization_score=58,
            risk_score=81,
            equipment_score=44,
            charts={
                "factor_breakdown": [{"label": "Roaming", "value": 84, "secondary_value": 75}],
                "risk_timeline": [{"label": "T0", "value": 81, "secondary_value": 3}],
                "critical_zone_heatmap": [{"label": "IT", "value": 75, "secondary_value": 1}],
                "score_radar": [{"label": "Risque", "value": 81, "secondary_value": None}],
            },
            model="llama3.2:3b",
            sources=["fleet_ai_results_morocco.csv", "live_monitoring"],
            summary_updated_at="2026-05-09T11:10:00+00:00",
            cached=False,
            fallback_used=False,
            duration_ms=980,
        )

    monkeypatch.setattr(
        "app.api.routes.chat.generate_explainability_response",
        fake_generate_explainability_response,
    )

    response = client.post(
        "/api/v1/chat/explain",
        headers=admin_headers,
        json={
            "question": "Pourquoi cette alerte ?",
            "focus_label": "Alerte roaming IT",
            "message_text": "Le departement IT presente une hausse roaming inhabituelle.",
            "history": [{"role": "user", "text": "Analyse cette alerte."}],
            "image_analysis": {
                "image_type": "alerte",
                "detected_operator": "Maroc Telecom",
                "detected_anomalies": ["Hausse roaming +27%"],
                "risk_level": "high",
            },
        },
    )

    assert response.status_code == 200
    assert response.json()["confidence"] == 0.91
    assert response.json()["risk_level"] == "high"
    assert response.json()["reasoning"][0] == "Hausse roaming +27%"
    assert response.json()["critical_zones"][0]["label"] == "IT"


def test_chat_explain_recommendation_route_returns_structured_payload(
    client: TestClient,
    admin_headers: dict[str, str],
    monkeypatch,
) -> None:
    async def fake_explain_recommendation(self, payload) -> ExplainRecommendationResponse:
        assert payload.recommendation_title == "Reduire forfait XL"
        return ExplainRecommendationResponse(
            recommendation="Reduire forfait XL",
            answer=(
                "La recommandation est maintenue car le cout, les depassements et le roaming "
                "restent les facteurs dominants dans les donnees consolidees."
            ),
            reasoning={
                "factors": ["Cout eleve", "Depassements recurrents", "Roaming excessif"],
                "kpis": ["Risque optimisation: 82 /100"],
                "risks": ["IT: departement le plus expose sur ce levier."],
                "impact": "La recommandation agit sur une pression budgetaire deja visible.",
                "business_explanation": "Le cout, les depassements et le roaming convergent vers la meme action.",
            },
            confidence_score=0.91,
            estimated_savings="12 000 MAD/an",
            risk_level="medium",
            impact_score=84,
            risk_score=66,
            fraud_score=38,
            anomaly_score=61,
            optimization_score=82,
            equipment_score=32,
            supporting_kpis=[
                {
                    "label": "Risque optimisation",
                    "value": "82",
                    "unit": "/100",
                    "impact": "Confirme le potentiel de rationalisation.",
                    "confidence": 0.9,
                }
            ],
            influencing_factors=[
                {
                    "label": "Cout eleve",
                    "category": "cost",
                    "value": "+17.0%",
                    "impact_score": 82,
                    "severity": "high",
                    "evidence": "La projection mensuelle depasse le cout actuel.",
                    "weight": 0.84,
                }
            ],
            decision_trace=[
                {
                    "step_number": 1,
                    "step_title": "Detection cout eleve",
                    "step_description": "Le moteur detecte une pression budgetaire superieure a la normale.",
                    "data_used": ["Projection couts +17.0%"],
                    "confidence": 0.92,
                }
            ],
            explanation_graph={
                "summary": "Graphe causal simplifie",
                "dominant_factor": "Cout eleve",
                "nodes": [
                    {
                        "node_id": "decision",
                        "label": "Reduire forfait XL",
                        "node_type": "decision",
                        "severity": "medium",
                        "weight": 84,
                    }
                ],
                "edges": [],
            },
            critical_zones=[
                {
                    "label": "IT",
                    "zone_type": "department",
                    "severity": "high",
                    "detail": "Departement le plus expose sur ce levier.",
                    "value": "76/100",
                }
            ],
            alternative_recommendations=["Verifier le roaming sur les lignes internationales."],
            data_points_used=["Projection couts +17.0%", "4 depassements de quota"],
            model="llama3.2:3b",
            sources=["fleet_ai_results_morocco.csv", "executive_report"],
            summary_updated_at="2026-05-09T11:10:00+00:00",
            cached=False,
            fallback_used=False,
            duration_ms=720,
        )

    monkeypatch.setattr(
        "app.api.routes.chat.RecommendationExplainabilityService.explain_recommendation",
        fake_explain_recommendation,
    )

    response = client.post(
        "/api/v1/chat/explain-recommendation",
        headers=admin_headers,
        json={
            "recommendation_title": "Reduire forfait XL",
            "conversation_id": "conv-xai-1",
            "history": [{"role": "user", "text": "Pourquoi l'IA recommande cela ?"}],
            "use_live_context": True,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["recommendation"] == "Reduire forfait XL"
    assert payload["answer"].startswith("La recommandation est maintenue")
    assert payload["confidence_score"] == 0.91
    assert payload["impact_score"] == 84
    assert payload["reasoning"]["factors"][0] == "Cout eleve"
    assert payload["critical_zones"][0]["label"] == "IT"


def test_chat_image_route_returns_multimodal_payload(
    client: TestClient,
    admin_headers: dict[str, str],
    monkeypatch,
) -> None:
    async def fake_generate_image_chat_response(
        request,
        db,
        *,
        question: str,
        history,
        image_bytes: bytes,
        filename: str | None,
        content_type: str | None,
        conversation_id: str | None = None,
    ) -> ChatImageResponse:
        assert question == "Analyse cette capture telecom"
        assert filename == "capture.png"
        assert content_type == "image/png"
        assert conversation_id == "conv-image-1"
        assert image_bytes == b"fake-image"
        return ChatImageResponse(
            answer="Resume intelligent\nLe visuel met en evidence une convergence entre budget et alertes sur Finance.\nRecommandations IA\n- Auditer Finance.",
            model="llama3.2:3b",
            title_hint="Analyse capture telecom",
            sources=["multimodal:image", "vision:llava"],
            summary_updated_at="2026-05-05T15:47:00+00:00",
            cached=False,
            fallback_used=False,
            duration_ms=1420,
            image_type="dashboard",
            ocr_text="Finance 12 500 MAD 6 alertes critiques",
            vision_analysis="Dashboard telecom avec alertes critiques visibles.",
            detected_kpis=["12 500 MAD", "6 alertes critiques"],
            recommendations=["Auditer Finance"],
            confidence=0.91,
            ocr_confidence=0.82,
            detected_operator="Maroc Telecom",
            detected_anomalies=["6 alertes critiques"],
            incident_details=ChatIncidentDetails(
                alert_type="alerte",
                severity="critique",
                detected_at="06/05/2026 11:42",
                operator="Maroc Telecom",
                line_reference="+212600000111",
                priority="immediate",
                summary="6 alertes critiques visibles sur la flotte Finance.",
                probable_causes=["Plusieurs alertes critiques semblent concentrees sur Finance."],
            ),
            highlighted_image="data:image/png;base64,fake-annotated-image",
            annotations=[
                ChatImageAnnotation(
                    label="Alerte critique",
                    type="alert",
                    bbox=[120, 80, 160, 36],
                    confidence=0.88,
                )
            ],
            decision_recommendations=[
                ChatDecisionRecommendation(
                    title="Surveiller departement Finance",
                    priority="critical",
                    impact="risk",
                    estimated_saving=None,
                    reason="Finance concentre les alertes les plus severes.",
                )
            ],
            recommendation_notice=None,
            risk_level="critical",
            optimization_score=78,
            anomaly_score=92,
            fraud_score=68,
            cost_score=84,
        )

    monkeypatch.setattr(
        "app.api.routes.chat.generate_image_chat_response",
        fake_generate_image_chat_response,
    )

    response = client.post(
        "/api/v1/chat/image",
        headers=admin_headers,
        data={
            "question": "Analyse cette capture telecom",
            "conversation_id": "conv-image-1",
            "history_json": "[]",
        },
        files={"image": ("capture.png", b"fake-image", "image/png")},
    )

    assert response.status_code == 200
    assert response.json()["image_type"] == "dashboard"
    assert response.json()["confidence"] == 0.91
    assert response.json()["ocr_confidence"] == 0.82
    assert response.json()["detected_operator"] == "Maroc Telecom"
    assert response.json()["detected_kpis"] == ["12 500 MAD", "6 alertes critiques"]
    assert response.json()["incident_details"]["severity"] == "critique"
    assert response.json()["highlighted_image"] == "data:image/png;base64,fake-annotated-image"
    assert response.json()["annotations"][0]["label"] == "Alerte critique"
    assert response.json()["decision_recommendations"][0]["title"] == "Surveiller departement Finance"
    assert response.json()["risk_level"] == "critical"


def test_chat_pdf_route_returns_multimodal_payload(
    client: TestClient,
    admin_headers: dict[str, str],
    monkeypatch,
) -> None:
    async def fake_generate_document_chat_response(
        request,
        db,
        *,
        question: str,
        history,
        document_bytes: bytes,
        filename: str | None,
        content_type: str | None,
        analysis_mode: str | None = None,
        conversation_id: str | None = None,
    ) -> ChatImageResponse:
        assert question == "Analyse cette facture PDF"
        assert filename == "facture.pdf"
        assert content_type == "application/pdf"
        assert conversation_id == "conv-pdf-1"
        assert analysis_mode == "advanced"
        assert document_bytes.startswith(b"%PDF")
        return ChatImageResponse(
            answer=(
                "La facture PDF presente un total de 48 320 MAD TTC sur la periode analysee. "
                "Le roaming international constitue le premier poste de cout."
            ),
            model="llama3.2:3b",
            title_hint="Analyse facture PDF",
            sources=["multimodal:pdf", "vision:llava"],
            summary_updated_at="2026-05-18T10:15:00+00:00",
            cached=False,
            fallback_used=False,
            duration_ms=1880,
            image_type="facture",
            ocr_text="Total TTC 48 320 MAD\nRoaming International 15 600 MAD",
            vision_analysis="Lecture documentaire PDF multi-pages consolidee.",
            analysis_mode="advanced",
            analysis_status="success",
            advanced_analysis_available=True,
            advanced_analysis_completed=True,
            processing_message="Lecture du document PDF terminee.",
            processing_notices=["Document PDF multi-pages: 3 page(s) lue(s)."],
            detected_kpis=["Total TTC 48 320 MAD", "Roaming International 15 600 MAD"],
            recommendations=["Activer un forfait roaming entreprise"],
            confidence=0.94,
            detected_operator="Maroc Telecom",
            detected_anomalies=["Roaming international eleve"],
            decision_recommendations=[
                ChatDecisionRecommendation(
                    title="Activer un forfait roaming entreprise",
                    priority="high",
                    impact="cost",
                    estimated_saving="15% a 25%",
                    reason="Le roaming represente la part dominante du total TTC visible.",
                )
            ],
            risk_level="high",
            cost_score=88,
        )

    monkeypatch.setattr(
        "app.api.routes.chat.generate_document_chat_response",
        fake_generate_document_chat_response,
    )

    response = client.post(
        "/api/v1/chat/upload-pdf",
        headers=admin_headers,
        data={
            "question": "Analyse cette facture PDF",
            "analysis_mode": "advanced",
            "conversation_id": "conv-pdf-1",
            "history_json": "[]",
        },
        files={
            "pdf": ("facture.pdf", b"%PDF-1.7\nfake-pdf-content", "application/pdf"),
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["image_type"] == "facture"
    assert payload["analysis_mode"] == "advanced"
    assert payload["sources"][0] == "multimodal:pdf"
    assert payload["detected_kpis"] == ["Total TTC 48 320 MAD", "Roaming International 15 600 MAD"]
    assert payload["decision_recommendations"][0]["title"] == "Activer un forfait roaming entreprise"
    assert payload["risk_level"] == "high"


def test_chat_document_route_accepts_csv_upload(
    client: TestClient,
    admin_headers: dict[str, str],
    monkeypatch,
) -> None:
    async def fake_generate_document_chat_response(
        request,
        db,
        *,
        question: str,
        history,
        document_bytes: bytes,
        filename: str | None,
        content_type: str | None,
        analysis_mode: str | None = None,
        conversation_id: str | None = None,
    ) -> ChatImageResponse:
        assert question == "Analyse ce CSV"
        assert filename == "fleet.csv"
        assert content_type == "text/csv"
        assert conversation_id == "conv-doc-csv-1"
        assert analysis_mode == "advanced"
        assert b"monthly_cost_mad" in document_bytes
        return ChatImageResponse(
            answer="Le CSV met en evidence plusieurs lignes a cout atypique et des depassements de quota.",
            model="llama3.2:3b",
            title_hint="Analyse document CSV",
            sources=["tabular:document", "parser:pandas"],
            summary_updated_at="2026-05-18T10:15:00+00:00",
            cached=False,
            fallback_used=False,
            duration_ms=940,
            image_type="tableur",
            ocr_text="Colonnes: operator, monthly_cost_mad, quota_gb",
            vision_analysis="Analyse tabulaire pandas sur document CSV.",
            analysis_mode="advanced",
            analysis_status="success",
            advanced_analysis_available=True,
            advanced_analysis_completed=True,
            processing_message="Analyse tabulaire pandas et synthese IA terminees.",
            processing_notices=["Document CSV analyse avec pandas."],
            detected_kpis=["Colonnes cout identifiees: monthly_cost_mad", "Lignes a risque: 2"],
            recommendations=["Auditer les lignes a cout atypique", "Recalibrer les forfaits data"],
            confidence=0.91,
            detected_operator="Maroc Telecom",
            detected_anomalies=["2 lignes cumulent des flags et des depassements de quota."],
            decision_recommendations=[
                ChatDecisionRecommendation(
                    title="Auditer les lignes a cout atypique",
                    priority="high",
                    impact="cost",
                    estimated_saving="2 500 MAD",
                    reason="Les couts visibles sont anormalement concentres sur quelques lignes.",
                )
            ],
            risk_level="high",
            cost_score=84,
            anomaly_score=78,
            fraud_score=42,
            optimization_score=69,
        )

    monkeypatch.setattr(
        "app.api.routes.chat.generate_document_chat_response",
        fake_generate_document_chat_response,
    )

    response = client.post(
        "/api/v1/chat/upload-document",
        headers=admin_headers,
        data={
            "question": "Analyse ce CSV",
            "analysis_mode": "advanced",
            "conversation_id": "conv-doc-csv-1",
            "history_json": "[]",
        },
        files={
            "document": (
                "fleet.csv",
                b"operator,monthly_cost_mad,quota_gb\nMaroc Telecom,3200,10\nOrange,950,12\n",
                "text/csv",
            ),
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["image_type"] == "tableur"
    assert payload["sources"][0] == "tabular:document"
    assert payload["detected_operator"] == "Maroc Telecom"
    assert payload["decision_recommendations"][0]["title"] == "Auditer les lignes a cout atypique"


def test_chat_document_route_polishes_payload_before_api_return(
    client: TestClient,
    admin_headers: dict[str, str],
    monkeypatch,
) -> None:
    async def fake_generate_document_chat_response(
        request,
        db,
        *,
        question: str,
        history,
        document_bytes: bytes,
        filename: str | None,
        content_type: str | None,
        analysis_mode: str | None = None,
        conversation_id: str | None = None,
    ) -> ChatImageResponse:
        return ChatImageResponse(
            answer=(
                "Risque global: 100/100 (Critique).\n"
                "Les annotations confirment les points de vigilance.\n"
                "L'analyse revele 14 lignes utilisent moins de 20% de leur capacite.\n"
                "1 ressources inactives restent facturees."
            ),
            model="llama3.2:3b",
            title_hint="Analyse document CSV",
            sources=["tabular:document", "parser:pandas"],
            summary_updated_at="2026-05-18T10:15:00+00:00",
            cached=False,
            fallback_used=False,
            duration_ms=910,
            image_type="tableur",
            ocr_text="Colonnes: operator, monthly_cost_mad, quota_gb",
            vision_analysis="Analyse exploitable a partir des signaux visibles.",
            analysis_mode="advanced",
            analysis_status="success",
            advanced_analysis_available=True,
            advanced_analysis_completed=True,
            processing_message="Les annotations confirment les points de vigilance.",
            processing_notices=[
                "Lecture visuelle detaillee terminee.",
                "Risque optimisation: 100/100 (Critique).",
            ],
            detected_kpis=[
                "Risque global: 100/100 (Critique)",
                "Les annotations confirment les points de vigilance.",
            ],
            recommendations=[
                "Auditer les lignes avec score 100/100.",
                "Les annotations confirment une vigilance immediate.",
            ],
            confidence=0.91,
            detected_operator="Maroc Telecom",
            detected_anomalies=[
                "L'analyse revele 14 lignes utilisent moins de 20% de leur capacite.",
                "1 ressources inactives restent facturees.",
            ],
            analysis_metadata=ChatImageAnalysisMetadata(
                source_mode="tabular_pandas",
                visible_kpis_used=["Risque global: 100/100 (Critique)"],
                blocked_global_context=True,
                removed_unverified_claims=["Les annotations confirment les points de vigilance."],
                filtered_numbers=["100/100"],
                confidence_score=0.91,
            ),
            decision_recommendations=[
                ChatDecisionRecommendation(
                    title="Auditer les lignes avec score 100/100",
                    priority="high",
                    impact="cost",
                    estimated_saving="100/100",
                    reason="1 ressources inactives restent facturees.",
                )
            ],
            risk_level="high",
            cost_score=100,
            anomaly_score=100,
            fraud_score=42,
            optimization_score=100,
        )

    monkeypatch.setattr(
        "app.api.routes.chat.generate_document_chat_response",
        fake_generate_document_chat_response,
    )

    response = client.post(
        "/api/v1/chat/upload-document",
        headers=admin_headers,
        data={
            "question": "Analyse ce CSV",
            "analysis_mode": "advanced",
            "conversation_id": "conv-doc-polish-api-1",
            "history_json": "[]",
        },
        files={
            "document": (
                "fleet.csv",
                b"operator,monthly_cost_mad,quota_gb\nMaroc Telecom,3200,10\n",
                "text/csv",
            ),
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert "100/100" not in payload["answer"]
    assert "Les annotations confirment" not in payload["answer"]
    assert "L'analyse revele 14 lignes utilisent" not in payload["answer"]
    assert "L'analyse revele que 14 lignes utilisent moins de 20% de leur capacite." in payload["answer"]
    assert "1 ressource inactive reste facturee." in payload["answer"]
    assert all("100/100" not in item for item in payload["detected_kpis"])
    assert all("annotations confirment" not in item.lower() for item in payload["recommendations"])
    assert all("lecture visuelle" not in item.lower() for item in payload["processing_notices"])
    assert payload["analysis_metadata"]["visible_kpis_used"][0] == "Risque global: 94/100 (Critique)"
    assert payload["analysis_metadata"]["filtered_numbers"][0] == "94/100"
    assert payload["decision_recommendations"][0]["reason"] == "1 ressource inactive reste facturee."
    assert payload["optimization_score"] == 94


def test_chat_document_route_accepts_xlsx_upload(
    client: TestClient,
    admin_headers: dict[str, str],
    monkeypatch,
) -> None:
    async def fake_generate_document_chat_response(
        request,
        db,
        *,
        question: str,
        history,
        document_bytes: bytes,
        filename: str | None,
        content_type: str | None,
        analysis_mode: str | None = None,
        conversation_id: str | None = None,
    ) -> ChatImageResponse:
        assert question == "Analyse ce fichier Excel"
        assert filename == "fleet.xlsx"
        assert (
            content_type
            == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )
        assert conversation_id == "conv-doc-xlsx-1"
        assert analysis_mode == "advanced"
        assert len(document_bytes) > 8
        return ChatImageResponse(
            answer="Le workbook XLSX montre une concentration de cout sur l'operateur Orange.",
            model="llama3.2:3b",
            title_hint="Analyse document XLSX",
            sources=["tabular:document", "parser:pandas", "sheet:Fleet"],
            summary_updated_at="2026-05-18T10:15:00+00:00",
            cached=False,
            fallback_used=False,
            duration_ms=1120,
            image_type="tableur",
            ocr_text="Colonnes: operator, department, monthly_cost_mad",
            vision_analysis="Analyse tabulaire pandas sur document XLSX.",
            analysis_mode="advanced",
            analysis_status="success",
            advanced_analysis_available=True,
            advanced_analysis_completed=True,
            processing_message="Analyse tabulaire pandas et synthese IA terminees.",
            processing_notices=["Document XLSX analyse avec pandas.", "Feuille analysee: Fleet."],
            detected_kpis=["Operateur le plus couteux: Orange", "Total monthly_cost_mad: 3 370 MAD"],
            recommendations=["Renegocier le poste de cout concentre chez Orange"],
            confidence=0.9,
            detected_operator="Orange",
            detected_anomalies=["Une ligne depasse le seuil atypique de cout."],
            decision_recommendations=[
                ChatDecisionRecommendation(
                    title="Renegocier le poste de cout concentre chez Orange",
                    priority="medium",
                    impact="cost",
                    estimated_saving=None,
                    reason="Orange concentre la majorite du cout principal visible.",
                )
            ],
            risk_level="medium",
            cost_score=68,
            anomaly_score=42,
            fraud_score=18,
            optimization_score=55,
        )

    monkeypatch.setattr(
        "app.api.routes.chat.generate_document_chat_response",
        fake_generate_document_chat_response,
    )

    response = client.post(
        "/api/v1/chat/upload-document",
        headers=admin_headers,
        data={
            "question": "Analyse ce fichier Excel",
            "analysis_mode": "advanced",
            "conversation_id": "conv-doc-xlsx-1",
            "history_json": "[]",
        },
        files={
            "document": (
                "fleet.xlsx",
                b"PK\x03\x04fake-xlsx-content",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            ),
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["image_type"] == "tableur"
    assert payload["sources"][0] == "tabular:document"
    assert payload["detected_operator"] == "Orange"
    assert payload["processing_notices"][1] == "Feuille analysee: Fleet."


def test_chat_image_route_returns_structured_timeout_error(
    client: TestClient,
    admin_headers: dict[str, str],
    monkeypatch,
) -> None:
    async def fake_generate_image_chat_response(
        request,
        db,
        *,
        question: str,
        history,
        image_bytes: bytes,
        filename: str | None,
        content_type: str | None,
        conversation_id: str | None = None,
    ) -> ChatImageResponse:
        raise ImageAnalysisTimeoutError()

    monkeypatch.setattr(
        "app.api.routes.chat.generate_image_chat_response",
        fake_generate_image_chat_response,
    )

    response = client.post(
        "/api/v1/chat/image",
        headers=admin_headers,
        data={
            "question": "Analyse cette capture telecom",
            "conversation_id": "conv-image-timeout",
            "history_json": "[]",
        },
        files={"image": ("capture.png", b"fake-image", "image/png")},
    )

    assert response.status_code == 504
    assert response.json() == {
        "success": False,
        "code": "TIMEOUT",
        "error_type": "timeout",
        "message": "Analyse image trop longue.",
        "fallback_answer": "Relancez l'analyse ou utilisez une lecture de premier niveau pour obtenir une premiere priorisation.",
    }


def test_chat_image_route_returns_service_unavailable_error_with_fallback(
    client: TestClient,
    admin_headers: dict[str, str],
    monkeypatch,
) -> None:
    async def fake_generate_image_chat_response(
        request,
        db,
        *,
        question: str,
        history,
        image_bytes: bytes,
        filename: str | None,
        content_type: str | None,
        conversation_id: str | None = None,
    ) -> ChatImageResponse:
        raise LocalModelUnavailableError("Ollama non lance ou inaccessible.")

    monkeypatch.setattr(
        "app.api.routes.chat.generate_image_chat_response",
        fake_generate_image_chat_response,
    )

    response = client.post(
        "/api/v1/chat/image",
        headers=admin_headers,
        data={
            "question": "Analyse cette capture telecom",
            "conversation_id": "conv-image-ollama-offline",
            "history_json": "[]",
        },
        files={"image": ("capture.png", b"fake-image", "image/png")},
    )

    assert response.status_code == 503
    assert response.json() == {
        "success": False,
        "code": "OLLAMA_OFFLINE",
        "error_type": "service_unavailable",
        "message": "Ollama non lance ou inaccessible.",
        "fallback_answer": "Le traitement approfondi n'etait pas disponible ; une nouvelle tentative permettra d'affiner la priorisation.",
    }


def test_chat_image_route_returns_structured_invalid_image_error(
    client: TestClient,
    admin_headers: dict[str, str],
    monkeypatch,
) -> None:
    async def fake_generate_image_chat_response(
        request,
        db,
        *,
        question: str,
        history,
        image_bytes: bytes,
        filename: str | None,
        content_type: str | None,
        conversation_id: str | None = None,
    ) -> ChatImageResponse:
        raise InvalidImageError("Format image non supporté.")

    monkeypatch.setattr(
        "app.api.routes.chat.generate_image_chat_response",
        fake_generate_image_chat_response,
    )

    response = client.post(
        "/api/v1/chat/image",
        headers=admin_headers,
        data={
            "question": "Analyse cette capture telecom",
            "conversation_id": "conv-image-invalid",
            "history_json": "[]",
        },
        files={"image": ("capture.txt", b"not-an-image", "text/plain")},
    )

    assert response.status_code == 415
    assert response.json() == {
        "success": False,
        "code": "IMAGE_INVALID",
        "error_type": "image_invalid",
        "message": "Format image non supporté.",
    }


def test_chat_image_route_returns_workflow_payload(
    client: TestClient,
    admin_headers: dict[str, str],
    monkeypatch,
) -> None:
    async def fake_generate_image_chat_response(
        request,
        db,
        *,
        question: str,
        history,
        image_bytes: bytes,
        filename: str | None,
        content_type: str | None,
        conversation_id: str | None = None,
    ) -> ChatImageResponse:
        return ChatImageResponse(
            answer="Analyse workflow telecom\n- Complexite elevee.\nInsight: les validations manuelles ralentissent le flux.\nRecommandation: simplifier le circuit.",
            model="llama3.2:3b",
            title_hint="Analyse workflow telecom",
            sources=["multimodal:image", "vision:llava", "workflow:processus_metier"],
            summary_updated_at="2026-05-05T15:47:00+00:00",
            cached=False,
            fallback_used=False,
            duration_ms=1310,
            image_type="workflow",
            ocr_text="Workflow gestion flotte Validation manager Controle manuel",
            vision_analysis="Workflow metier avec dependances et controles manuels.",
            detected_kpis=["Complexite workflow 78/100"],
            recommendations=["Automatiser les validations repetitives."],
            confidence=0.9,
            ocr_confidence=0.83,
            workflow_details=ChatWorkflowDetails(
                workflow_type="processus_metier",
                complexity_score=78,
                complexity_level="high",
                critical_steps=["Validation manager", "Controle manuel"],
                detected_departments=["IT", "Finance"],
                detected_roles=["Manager", "Direction"],
                automation_opportunities=["Automatiser les validations repetitives visibles dans le schema."],
                bottlenecks=["Controle manuel"],
                repeated_validations=["Validation manager"],
                summary="4 etapes visibles, complexite elevee.",
            ),
            highlighted_image="data:image/png;base64,fake-workflow-image",
            annotations=[
                ChatImageAnnotation(
                    label="Etape critique",
                    type="alert",
                    bbox=[120, 90, 180, 40],
                    confidence=0.9,
                )
            ],
            decision_recommendations=[
                ChatDecisionRecommendation(
                    title="Simplifier workflow multi-etapes",
                    priority="high",
                    impact="optimization",
                    estimated_saving=None,
                    reason="Le workflow presente plusieurs validations et points de blocage.",
                )
            ],
            recommendation_notice=None,
            risk_level="high",
            optimization_score=86,
            anomaly_score=74,
            fraud_score=40,
            cost_score=28,
        )

    monkeypatch.setattr(
        "app.api.routes.chat.generate_image_chat_response",
        fake_generate_image_chat_response,
    )

    response = client.post(
        "/api/v1/chat/image",
        headers=admin_headers,
        data={
            "question": "Explique ce workflow telecom",
            "conversation_id": "conv-workflow-1",
            "history_json": "[]",
        },
        files={"image": ("workflow.png", b"fake-workflow", "image/png")},
    )

    assert response.status_code == 200
    assert response.json()["image_type"] == "workflow"
    assert response.json()["workflow_details"]["workflow_type"] == "processus_metier"
    assert response.json()["workflow_details"]["complexity_score"] == 78
    assert response.json()["annotations"][0]["label"] == "Etape critique"
    assert response.json()["decision_recommendations"][0]["title"] == "Simplifier workflow multi-etapes"


def test_chat_image_route_returns_equipment_payload(
    client: TestClient,
    admin_headers: dict[str, str],
    monkeypatch,
) -> None:
    async def fake_generate_image_chat_response(
        request,
        db,
        *,
        question: str,
        history,
        image_bytes: bytes,
        filename: str | None,
        content_type: str | None,
        conversation_id: str | None = None,
    ) -> ChatImageResponse:
        return ChatImageResponse(
            answer="Analyse equipement telecom\n- Routeur a risque detecte.\nInsight: la batterie visible doit etre traitee rapidement.\nRecommandation: isoler puis remplacer.",
            model="llama3.2:3b",
            title_hint="Analyse equipement telecom",
            sources=["multimodal:image", "vision:llava", "equipment:routeur"],
            summary_updated_at="2026-05-05T15:47:00+00:00",
            cached=False,
            fallback_used=False,
            duration_ms=1480,
            image_type="equipement",
            ocr_text="Cisco RV340 Serial FTX12345 Batterie gonflee visible",
            vision_analysis="Routeur Cisco avec dommage physique visible.",
            detected_kpis=["Etat equipement 38/100", "Criticite equipement 84/100"],
            recommendations=["Isoler puis remplacer l'equipement."],
            confidence=0.92,
            ocr_confidence=0.84,
            detected_operator=None,
            detected_anomalies=["Batterie gonflee visible ou fortement suspectee."],
            equipment_details=ChatEquipmentDetails(
                equipment_type="routeur",
                brand="Cisco",
                model="RV340",
                serial_number="FTX12345",
                visible_condition="batterie gonflee suspectee",
                device_version="1.0.3",
                usage_summary="Assure la connectivite WAN/LAN du site ou des lignes de flotte.",
                detected_issues=["Batterie gonflee visible ou fortement suspectee."],
                maintenance_recommendations=["Isoler l'appareil et remplacer la batterie sans delai."],
                replacement_needed=True,
                condition_score=38,
                criticality_score=84,
                obsolescence_score=46,
                maintenance_score=82,
                summary="Equipement routeur, etat batterie gonflee suspectee, criticite 84/100.",
            ),
            highlighted_image="data:image/png;base64,fake-equipment-image",
            annotations=[
                ChatImageAnnotation(
                    label="Defaut visible",
                    type="risk",
                    bbox=[220, 180, 240, 44],
                    confidence=0.91,
                )
            ],
            decision_recommendations=[
                ChatDecisionRecommendation(
                    title="Remplacer equipement a risque",
                    priority="critical",
                    impact="risk",
                    estimated_saving=None,
                    reason="La batterie gonflee rend l'equipement non fiable pour la production.",
                )
            ],
            recommendation_notice=None,
            risk_level="critical",
            optimization_score=61,
            anomaly_score=88,
            fraud_score=40,
            cost_score=28,
        )

    monkeypatch.setattr(
        "app.api.routes.chat.generate_image_chat_response",
        fake_generate_image_chat_response,
    )

    response = client.post(
        "/api/v1/chat/image",
        headers=admin_headers,
        data={
            "question": "Quel est cet equipement ?",
            "conversation_id": "conv-equipment-1",
            "history_json": "[]",
        },
        files={"image": ("equipement.png", b"fake-equipment", "image/png")},
    )

    assert response.status_code == 200
    assert response.json()["image_type"] == "equipement"
    assert response.json()["equipment_details"]["equipment_type"] == "routeur"
    assert response.json()["equipment_details"]["brand"] == "Cisco"
    assert response.json()["equipment_details"]["replacement_needed"] is True
    assert response.json()["annotations"][0]["label"] == "Defaut visible"


def test_chat_voice_transcribe_route_returns_transcript(
    client: TestClient,
    admin_headers: dict[str, str],
    monkeypatch,
) -> None:
    async def fake_transcribe_voice_message(
        audio_bytes: bytes,
        *,
        filename: str | None = None,
        content_type: str | None = None,
    ) -> VoiceTranscriptionResult:
        assert filename == "question.webm"
        assert content_type == "audio/webm"
        assert audio_bytes == b"voice-bytes"
        return VoiceTranscriptionResult(
            transcript="Quels couts dois-je optimiser ?",
            language="fr",
            confidence=0.92,
            provider="faster-whisper",
            model="base",
            duration_ms=142,
            audio_duration_ms=1880,
        )

    monkeypatch.setattr(
        "app.api.routes.chat.transcribe_voice_message",
        fake_transcribe_voice_message,
    )

    response = client.post(
        "/api/v1/chat/voice/transcribe",
        headers=admin_headers,
        files={"audio": ("question.webm", b"voice-bytes", "audio/webm")},
    )

    assert response.status_code == 200
    assert response.json() == {
        "success": True,
        "text": "Quels couts dois-je optimiser ?",
        "transcript": "Quels couts dois-je optimiser ?",
        "language": "fr",
        "confidence": 0.92,
        "provider": "faster-whisper",
        "model": "base",
        "duration_ms": 142,
        "audio_duration_ms": 1880,
    }


def test_chat_voice_transcribe_route_returns_structured_audio_error(
    client: TestClient,
    admin_headers: dict[str, str],
    monkeypatch,
) -> None:
    async def fake_transcribe_voice_message(
        audio_bytes: bytes,
        *,
        filename: str | None = None,
        content_type: str | None = None,
    ) -> VoiceTranscriptionResult:
        raise AudioTooLargeError()

    monkeypatch.setattr(
        "app.api.routes.chat.transcribe_voice_message",
        fake_transcribe_voice_message,
    )

    response = client.post(
        "/api/v1/chat/voice/transcribe",
        headers=admin_headers,
        files={"audio": ("question.webm", b"voice-bytes", "audio/webm")},
    )

    assert response.status_code == 413
    assert response.json() == {
        "success": False,
        "code": "AUDIO_TOO_LARGE",
        "error_type": "audio_too_large",
        "message": "Fichier audio trop lourd.",
    }


def test_chat_voice_health_route_returns_backend_status(
    client: TestClient,
    admin_headers: dict[str, str],
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        "app.api.routes.chat.get_voice_transcription_health",
        lambda check_runtime=True: SimpleNamespace(
            enabled=True,
            ready=True,
            status="ready",
            provider="faster-whisper",
            model="base",
            language="fr",
            device="cpu",
            compute_type="int8",
            runtime_available=True,
            model_loaded=True,
            ffmpeg_available=False,
            message="Le moteur de transcription vocale est pret.",
            details={"configured_provider": "auto"},
        ),
    )

    response = client.get("/api/v1/chat/voice/health", headers=admin_headers)

    assert response.status_code == 200
    assert response.json() == {
        "success": True,
        "enabled": True,
        "ready": True,
        "status": "ready",
        "provider": "faster-whisper",
        "model": "base",
        "language": "fr",
        "device": "cpu",
        "compute_type": "int8",
        "runtime_available": True,
        "model_loaded": True,
        "ffmpeg_available": False,
        "message": "Le moteur de transcription vocale est pret.",
        "details": {"configured_provider": "auto"},
    }


def test_chat_voice_speak_route_returns_audio_payload(
    client: TestClient,
    admin_headers: dict[str, str],
    monkeypatch,
) -> None:
    async def fake_synthesize_voice_response(text: str) -> VoiceSpeechResult:
        assert text == "Reponse IA a lire"
        return VoiceSpeechResult(
            audio_url="data:audio/mpeg;base64,ZmFrZQ==",
            duration=4.2,
            media_type="audio/mpeg",
        )

    monkeypatch.setattr(
        "app.api.routes.chat.synthesize_voice_response",
        fake_synthesize_voice_response,
    )

    response = client.post(
        "/api/v1/chat/voice/speak",
        headers=admin_headers,
        json={"text": "Reponse IA a lire"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "audio_url": "data:audio/mpeg;base64,ZmFrZQ==",
        "duration": 4.2,
        "format": "audio/mpeg",
    }


def test_chat_voice_speak_route_returns_structured_tts_error(
    client: TestClient,
    admin_headers: dict[str, str],
    monkeypatch,
) -> None:
    async def fake_synthesize_voice_response(text: str) -> VoiceSpeechResult:
        raise TtsUnavailableError()

    monkeypatch.setattr(
        "app.api.routes.chat.synthesize_voice_response",
        fake_synthesize_voice_response,
    )

    response = client.post(
        "/api/v1/chat/voice/speak",
        headers=admin_headers,
        json={"text": "Reponse IA a lire"},
    )

    assert response.status_code == 503
    assert response.json() == {
        "success": False,
        "code": "TTS_UNAVAILABLE",
        "error_type": "tts_unavailable",
        "message": "Lecture audio indisponible.",
    }


def test_chat_voice_respond_route_returns_full_voice_payload(
    client: TestClient,
    admin_headers: dict[str, str],
    monkeypatch,
) -> None:
    async def fake_generate_voice_chat_response(
        db,
        *,
        history,
        audio_bytes: bytes | None = None,
        filename: str | None = None,
        content_type: str | None = None,
        transcript: str | None = None,
    ) -> VoiceConversationResponse:
        assert filename == "question.webm"
        assert content_type == "audio/webm"
        assert audio_bytes == b"voice-bytes"
        assert transcript is None
        assert len(history) == 1
        return VoiceConversationResponse(
            transcript="Analyse ma flotte actuelle",
            language="fr",
            confidence=0.94,
            answer=ChatResponse(
                answer="Votre flotte presente un risque moyen et trois alertes budget prioritaires.",
                model="llama3.2:3b",
                title_hint="Analyse flotte vocale",
                sources=["cdr_analytics", "mobile_fleet_reports"],
                summary_updated_at="2026-05-10T09:18:00+00:00",
                cached=False,
                fallback_used=False,
                duration_ms=1280,
            ),
            speech=VoiceSpeechResult(
                audio_url="data:audio/mpeg;base64,ZmFrZQ==",
                duration=5.6,
                media_type="audio/mpeg",
            ),
        )

    monkeypatch.setattr(
        "app.api.routes.chat.generate_voice_chat_response",
        fake_generate_voice_chat_response,
    )

    response = client.post(
        "/api/v1/chat/voice/respond",
        headers=admin_headers,
        data={
            "history_json": json.dumps(
                [{"role": "user", "text": "Analyse ma flotte actuelle"}],
                ensure_ascii=False,
            )
        },
        files={"audio": ("question.webm", b"voice-bytes", "audio/webm")},
    )

    assert response.status_code == 200
    assert response.json() == {
        "transcript": "Analyse ma flotte actuelle",
        "language": "fr",
        "confidence": 0.94,
        "answer": "Votre flotte presente un risque moyen et trois alertes budget prioritaires.",
        "audio_url": "data:audio/mpeg;base64,ZmFrZQ==",
        "duration": 5.6,
        "format": "audio/mpeg",
        "model": "llama3.2:3b",
        "sources": ["cdr_analytics", "mobile_fleet_reports"],
        "summary_updated_at": "2026-05-10T09:18:00+00:00",
        "cached": False,
        "fallback_used": False,
        "duration_ms": 1280,
    }


def test_chat_voice_respond_route_returns_structured_multipart_error(
    client: TestClient,
    admin_headers: dict[str, str],
    monkeypatch,
) -> None:
    async def fake_generate_voice_chat_response(
        db,
        *,
        history,
        audio_bytes: bytes | None = None,
        filename: str | None = None,
        content_type: str | None = None,
        transcript: str | None = None,
    ) -> VoiceConversationResponse:
        raise ValueError("Audio ou transcription manquants.")

    monkeypatch.setattr(
        "app.api.routes.chat.generate_voice_chat_response",
        fake_generate_voice_chat_response,
    )

    response = client.post(
        "/api/v1/chat/voice/respond",
        headers=admin_headers,
        data={"history_json": "[]"},
    )

    assert response.status_code == 422
    assert response.json() == {
        "success": False,
        "code": "MULTIPART_INVALID",
        "error_type": "multipart_invalid",
        "message": "Audio ou transcription manquants.",
    }


def test_chat_voice_stream_route_returns_stage_and_audio_events(
    client: TestClient,
    admin_headers: dict[str, str],
    monkeypatch,
) -> None:
    async def fake_stream_voice_chat_response(
        request,
        db,
        *,
        history,
        audio_bytes: bytes | None = None,
        filename: str | None = None,
        content_type: str | None = None,
        transcript: str | None = None,
    ):
        assert filename == "question.webm"
        assert content_type == "audio/webm"
        assert audio_bytes == b"voice-bytes"
        assert len(history) == 1
        yield 'event: stage\ndata: {"stage":"transcribing","label":"Transcription en cours..."}\n\n'
        yield 'event: transcript\ndata: {"transcript":"Analyse ma flotte actuelle","language":"fr","confidence":0.94}\n\n'
        yield 'event: token\ndata: {"text":"Bonjour "}\n\n'
        yield 'event: done\ndata: {"answer":"Bonjour","model":"llama3.2:3b","title_hint":null,"sources":[],"summary_updated_at":"2026-05-10T09:18:00+00:00","cached":false,"fallback_used":false,"duration_ms":920}\n\n'
        yield 'event: audio\ndata: {"audio_url":"data:audio/mpeg;base64,ZmFrZQ==","duration":2.4,"format":"audio/mpeg"}\n\n'

    monkeypatch.setattr(
        "app.api.routes.chat.stream_voice_chat_response",
        fake_stream_voice_chat_response,
    )

    with client.stream(
        "POST",
        "/api/v1/chat/voice/stream",
        headers=admin_headers,
        data={
            "history_json": json.dumps(
                [{"role": "user", "text": "Analyse ma flotte actuelle"}],
                ensure_ascii=False,
            )
        },
        files={"audio": ("question.webm", b"voice-bytes", "audio/webm")},
    ) as response:
        body = "".join(response.iter_text())

    assert response.status_code == 200
    assert 'event: stage' in body
    assert 'event: transcript' in body
    assert 'event: token' in body
    assert 'event: done' in body
    assert 'event: audio' in body
