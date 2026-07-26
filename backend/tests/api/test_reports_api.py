from pathlib import Path

from fastapi.testclient import TestClient

from app.schemas.reports import ReportGenerateResponse
from app.services.report_generation_service import ReportDependenciesUnavailableError


def test_generate_report_route_returns_metadata(
    client: TestClient,
    admin_headers: dict[str, str],
    monkeypatch,
) -> None:
    async def fake_generate_ai_pdf_report(db, payload) -> ReportGenerateResponse:
        assert payload.report_type == "executive"
        assert payload.conversation_id == "conv-report-1"
        return ReportGenerateResponse(
            report_id="report-123",
            pdf_url="/api/v1/reports/report-123/pdf",
            generated_at="2026-05-12T09:10:00+00:00",
            report_type="executive",
            fleet_health_score=82,
        )

    monkeypatch.setattr(
        "app.api.routes.reports.generate_ai_pdf_report",
        fake_generate_ai_pdf_report,
    )

    response = client.post(
        "/api/v1/reports/generate",
        headers=admin_headers,
        json={
            "report_type": "executive",
            "conversation_id": "conv-report-1",
            "history": [{"role": "user", "text": "Genere un rapport IA executif."}],
            "image_analyses": [],
            "images": [],
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "report_id": "report-123",
        "pdf_url": "/api/v1/reports/report-123/pdf",
        "generated_at": "2026-05-12T09:10:00+00:00",
        "report_type": "executive",
        "fleet_health_score": 82,
    }


def test_download_generated_report_pdf_route_returns_pdf(
    client: TestClient,
    admin_headers: dict[str, str],
    monkeypatch,
    tmp_path: Path,
) -> None:
    pdf_path = tmp_path / "report.pdf"
    pdf_path.write_bytes(b"%PDF-1.4\n%test\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF")

    monkeypatch.setattr(
        "app.api.routes.reports.get_generated_report_pdf_path",
        lambda report_id: pdf_path if report_id == "report-123" else None,
    )

    response = client.get(
        "/api/v1/reports/report-123/pdf",
        headers=admin_headers,
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/pdf")
    assert response.content.startswith(b"%PDF-1.4")


def test_generate_report_route_returns_503_when_pdf_dependencies_are_missing(
    client: TestClient,
    admin_headers: dict[str, str],
    monkeypatch,
) -> None:
    async def fake_generate_ai_pdf_report(db, payload) -> ReportGenerateResponse:
        raise ReportDependenciesUnavailableError("Dependances PDF indisponibles.")

    monkeypatch.setattr(
        "app.api.routes.reports.generate_ai_pdf_report",
        fake_generate_ai_pdf_report,
    )

    response = client.post(
        "/api/v1/reports/generate",
        headers=admin_headers,
        json={
            "report_type": "executive",
            "conversation_id": "conv-report-1",
            "history": [{"role": "user", "text": "Genere un rapport IA executif."}],
            "image_analyses": [],
            "images": [],
        },
    )

    assert response.status_code == 503
    assert response.json() == {
        "success": False,
        "code": "SERVER_ERROR",
        "error_type": "dependency_unavailable",
        "message": "Dependances PDF indisponibles.",
    }


def test_download_generated_report_pdf_route_returns_404_when_missing(
    client: TestClient,
    admin_headers: dict[str, str],
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        "app.api.routes.reports.get_generated_report_pdf_path",
        lambda report_id: None,
    )

    response = client.get(
        "/api/v1/reports/unknown-report/pdf",
        headers=admin_headers,
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Rapport PDF introuvable."
