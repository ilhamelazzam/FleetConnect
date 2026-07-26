from io import BytesIO

from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import create_application


def _build_form_data() -> dict[str, object]:
    return {
        "responsible_full_name": "Amina El Idrissi",
        "responsible_phone": "+212600000001",
        "job_title": "Responsable IT",
        "requested_role": "ADMIN",
        "responsible_email": "responsable@entreprise.ma",
        "password": "SecurePass123",
        "company_name": "Atlas Telecom Fleet",
        "sector": "Telecom",
        "city": "Casablanca",
        "company_phone": "+212522000000",
        "operators": ["Maroc Telecom"],
        "coverage_zones": "Casablanca",
    }


def _build_files():
    return [
        (
            "legal_representative_cin",
            ("cin.pdf", BytesIO(b"fake-pdf"), "application/pdf"),
        ),
        (
            "commercial_register",
            ("rc.pdf", BytesIO(b"fake-register"), "application/pdf"),
        ),
    ]


def test_development_unhandled_exception_returns_debug_payload(
    monkeypatch,
) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "app_env", "development")

    def _raise_unexpected_error(*args, **kwargs):
        raise RuntimeError("simulated failure for debug payload")

    monkeypatch.setattr(
        "app.api.routes.company_registration.create_company_registration_request",
        _raise_unexpected_error,
    )

    with TestClient(create_application(), raise_server_exceptions=False) as client:
        response = client.post(
            "/api/v1/company-registration/request",
            data=_build_form_data(),
            files=_build_files(),
        )

    assert response.status_code == 500
    body = response.json()
    assert body["success"] is False
    assert body["error"] == "RuntimeError"
    assert body["message"] == "simulated failure for debug payload"
    assert body["file"] is not None
    assert body["function"] == "submit_company_registration_request"
    assert isinstance(body["line"], int)
