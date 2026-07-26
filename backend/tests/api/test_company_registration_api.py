from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import verify_password
from app.models.company import Company
from app.models.company_registration_request import CompanyRegistrationRequest
from app.models.company_status_history import CompanyStatusHistory
from app.models.user import User
from app.schemas.user import UserCreate
from app.services.user_service import create_user


@pytest.fixture(autouse=True)
def company_registration_upload_dir(tmp_path):
    settings = get_settings()
    previous_value = settings.company_registration_upload_dir
    settings.company_registration_upload_dir = tmp_path.as_posix()
    yield
    settings.company_registration_upload_dir = previous_value


def _build_form_data(
    email: str = "responsable@entreprise.ma",
    requested_role: str = "ADMIN",
    job_title: str = "Responsable IT",
) -> dict[str, object]:
    return {
        "responsible_full_name": "Amina El Idrissi",
        "responsible_phone": "+212600000001",
        "job_title": job_title,
        "requested_role": requested_role,
        "responsible_email": email,
        "password": "SecurePass123",
        "company_name": "Atlas Telecom Fleet",
        "sector": "Telecom",
        "city": "Casablanca",
        "company_phone": "+212522000000",
        "ice": "001122334455667",
        "rc": "RC-998877",
        "tax_id": "IF-112233",
        "cnss": "CNSS-778899",
        "patente": "PAT-556677",
        "website": "https://atlas.example",
        "estimated_phone_lines": "150",
        "employees_count": "320",
        "operators": ["Maroc Telecom", "Orange"],
        "coverage_zones": "Casablanca, Rabat, Marrakech",
    }


def _build_files(include_commercial_register: bool = True):
    files = [
        ("logo", ("logo.png", BytesIO(b"fake-png"), "image/png")),
        (
            "legal_representative_cin",
            ("cin.pdf", BytesIO(b"fake-pdf"), "application/pdf"),
        ),
    ]
    if include_commercial_register:
        files.append(
            (
                "commercial_register",
                ("rc.pdf", BytesIO(b"fake-register"), "application/pdf"),
            )
        )
    files.append(
        (
            "fiscal_document",
            ("fiscal.pdf", BytesIO(b"fake-fiscal"), "application/pdf"),
        )
    )
    return files


def _create_request(
    client: TestClient,
    email: str = "responsable@entreprise.ma",
    requested_role: str = "ADMIN",
):
    return client.post(
        "/api/v1/company-registration/request",
        data=_build_form_data(email, requested_role=requested_role),
        files=_build_files(),
    )


def _login_headers(client: TestClient, email: str, password: str) -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
    )
    access_token = response.json()["access_token"]
    return {"Authorization": f"Bearer {access_token}"}


def _delete_request(
    client: TestClient,
    request_id: int,
    headers: dict[str, str],
    *,
    force: bool = False,
):
    return client.patch(
        f"/api/v1/admin/company-registration/requests/{request_id}/delete",
        headers=headers,
        json={"force": force},
    )


def _reopen_request(
    client: TestClient,
    request_id: int,
    headers: dict[str, str],
    reason: str = "Documents corriges et verifies.",
):
    return client.patch(
        f"/api/v1/admin/company-requests/{request_id}/reopen",
        headers=headers,
        json={"reason": reason},
    )


def test_create_company_registration_request_persists_pending_request(
    client: TestClient,
    db_session: Session,
) -> None:
    response = _create_request(client)

    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "pending"

    stored_request = db_session.scalar(
        select(CompanyRegistrationRequest).where(
            CompanyRegistrationRequest.id == body["request_id"]
        )
    )
    assert stored_request is not None
    assert stored_request.status == "pending"
    assert stored_request.responsible_email == "responsable@entreprise.ma"
    assert stored_request.job_title == "Responsable IT"
    assert stored_request.requested_role == "ADMIN"
    assert stored_request.password_hash != "SecurePass123"
    assert verify_password("SecurePass123", stored_request.password_hash)
    assert stored_request.legal_representative_cin_path.endswith(".pdf")
    assert stored_request.commercial_register_path.endswith(".pdf")


def test_create_company_registration_request_rejects_existing_email(
    client: TestClient,
    db_session: Session,
) -> None:
    create_user(
        db_session,
        UserCreate(
            full_name="Existing User",
            email="responsable@entreprise.ma",
            password="Existing123!",
            role="manager",
            is_active=True,
        ),
    )

    response = _create_request(client)

    assert response.status_code == 409
    assert (
        response.json()["detail"]
        == "Un compte actif existe deja avec cet email. Connectez-vous ou utilisez la recuperation de mot de passe."
    )


def test_create_company_registration_request_rejects_active_pending_request(
    client: TestClient,
) -> None:
    first_response = _create_request(client, email="pending@entreprise.ma")
    assert first_response.status_code == 201

    second_response = _create_request(client, email="pending@entreprise.ma")

    assert second_response.status_code == 409
    assert (
        second_response.json()["detail"]
        == "Une demande est deja en cours de traitement pour cet email."
    )


def test_create_company_registration_request_allows_resubmission_after_rejection(
    client: TestClient,
    db_session: Session,
    super_admin_headers: dict[str, str],
) -> None:
    first_response = _create_request(client, email="resubmit@entreprise.ma")
    rejected_request_id = first_response.json()["request_id"]

    reject_response = client.post(
        f"/api/v1/admin/company-registration/requests/{rejected_request_id}/reject",
        headers=super_admin_headers,
        json={"rejection_reason": "Documents fiscaux incoherents et verification incomplete."},
    )
    assert reject_response.status_code == 200

    second_response = _create_request(client, email="resubmit@entreprise.ma")

    assert second_response.status_code == 201
    second_body = second_response.json()
    assert second_body["request_id"] != rejected_request_id
    assert second_body["previous_request_id"] == rejected_request_id
    assert second_body["resubmission_number"] == 2
    assert "Une precedente demande associee a cet email a ete refusee" in second_body["message"]

    created_request = db_session.scalar(
        select(CompanyRegistrationRequest).where(
            CompanyRegistrationRequest.id == second_body["request_id"]
        )
    )
    assert created_request is not None
    assert created_request.previous_request_id == rejected_request_id
    assert created_request.resubmission_number == 2

    resubmission_audit = db_session.scalar(
        select(CompanyStatusHistory).where(
            CompanyStatusHistory.request_id == created_request.id,
            CompanyStatusHistory.action == "request_resubmitted",
        )
    )
    assert resubmission_audit is not None


def test_create_company_registration_request_allows_resubmission_after_soft_delete(
    client: TestClient,
    db_session: Session,
    super_admin_headers: dict[str, str],
) -> None:
    first_response = _create_request(client, email="deleted@entreprise.ma")
    request_id = first_response.json()["request_id"]

    reject_response = client.post(
        f"/api/v1/admin/company-registration/requests/{request_id}/reject",
        headers=super_admin_headers,
        json={"rejection_reason": "Documents fiscaux incoherents et verification incomplete."},
    )
    assert reject_response.status_code == 200

    delete_response = _delete_request(client, request_id, super_admin_headers)
    assert delete_response.status_code == 200

    second_response = _create_request(client, email="deleted@entreprise.ma")
    assert second_response.status_code == 201
    assert second_response.json()["request_id"] != request_id

    deleted_request = db_session.scalar(
        select(CompanyRegistrationRequest).where(CompanyRegistrationRequest.id == request_id)
    )
    assert deleted_request is not None
    assert deleted_request.is_deleted is True


def test_create_company_registration_request_requires_required_documents(
    client: TestClient,
) -> None:
    response = client.post(
        "/api/v1/company-registration/request",
        data=_build_form_data(),
        files=_build_files(include_commercial_register=False),
    )

    assert response.status_code == 422
    assert "Registre de commerce" in response.json()["detail"]


def test_create_company_registration_request_rejects_super_admin_role(
    client: TestClient,
) -> None:
    response = client.post(
        "/api/v1/company-registration/request",
        data=_build_form_data(requested_role="SUPER_ADMIN"),
        files=_build_files(),
    )

    assert response.status_code == 422


def test_super_admin_can_approve_request_and_company_admin_can_login(
    client: TestClient,
    db_session: Session,
    super_admin_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sent_messages: list[str] = []
    monkeypatch.setattr(
        "app.services.company_registration_service.send_email",
        lambda **kwargs: sent_messages.append(kwargs["subject"]),
    )
    created_response = _create_request(client)
    request_id = created_response.json()["request_id"]

    approve_response = client.post(
        f"/api/v1/admin/company-registration/requests/{request_id}/approve",
        headers=super_admin_headers,
    )

    assert approve_response.status_code == 200
    approve_body = approve_response.json()
    assert approve_body["request"]["decision"]["status"] == "approved"
    assert approve_body["request"]["approved_company_name"] == "Atlas Telecom Fleet"
    assert approve_body["request"]["approved_admin_email"] == "responsable@entreprise.ma"
    assert approve_body["request"]["requested_role"] == "ADMIN"
    assert "Votre compte FleetConnect IA est active" in sent_messages

    company = db_session.scalar(select(Company).where(Company.name == "Atlas Telecom Fleet"))
    assert company is not None

    company_admin = db_session.scalar(
        select(User).where(User.email == "responsable@entreprise.ma")
    )
    assert company_admin is not None
    assert company_admin.role == "company_admin"
    assert company_admin.company_id == company.id
    assert company_admin.job_profile == "Responsable IT"

    login_response = client.post(
        "/api/v1/auth/login",
        json={
            "email": "responsable@entreprise.ma",
            "password": "SecurePass123",
        },
    )
    assert login_response.status_code == 200
    assert login_response.json()["user"]["role"] == "company_admin"


def test_super_admin_can_reject_request(
    client: TestClient,
    super_admin_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sent_messages: list[str] = []
    monkeypatch.setattr(
        "app.services.company_registration_service.send_email",
        lambda **kwargs: sent_messages.append(kwargs["subject"]),
    )
    created_response = _create_request(client, email="refus@entreprise.ma")
    request_id = created_response.json()["request_id"]

    reject_response = client.post(
        f"/api/v1/admin/company-registration/requests/{request_id}/reject",
        headers=super_admin_headers,
        json={"rejection_reason": "Documents fiscaux incoherents et verification incomplete."},
    )

    assert reject_response.status_code == 200
    reject_body = reject_response.json()
    assert reject_body["request"]["decision"]["status"] == "rejected"
    assert (
        reject_body["request"]["decision"]["rejection_reason"]
        == "Documents fiscaux incoherents et verification incomplete."
    )
    assert "Demande d'inscription FleetConnect IA refusee" in sent_messages


def test_super_admin_can_reopen_rejected_request_and_preserve_history(
    client: TestClient,
    db_session: Session,
    super_admin_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sent_messages: list[str] = []
    monkeypatch.setattr(
        "app.services.company_registration_service.send_email",
        lambda **kwargs: sent_messages.append(kwargs["subject"]),
    )
    created_response = _create_request(client, email="reopen@entreprise.ma")
    request_id = created_response.json()["request_id"]
    client.post(
        f"/api/v1/admin/company-registration/requests/{request_id}/reject",
        headers=super_admin_headers,
        json={"rejection_reason": "Documents fiscaux incoherents et verification incomplete."},
    )

    reopen_response = _reopen_request(
        client,
        request_id,
        super_admin_headers,
        "Documents corriges et verifies a nouveau.",
    )

    assert reopen_response.status_code == 200
    reopen_body = reopen_response.json()
    assert reopen_body["request"]["status"] == "under_review"
    assert reopen_body["request"]["decision"]["status"] == "under_review"
    assert reopen_body["request"]["decision"]["rejection_reason"] is None
    assert "Votre demande FleetConnect IA est de nouveau en cours d'examen" in sent_messages

    history_actions = [
        (entry["action"], entry["comment"])
        for entry in reopen_body["request"]["history"]
    ]
    assert ("REQUEST_REOPENED", "Documents corriges et verifies a nouveau.") in history_actions
    assert (
        "request_rejected",
        "Documents fiscaux incoherents et verification incomplete.",
    ) in history_actions

    reopen_audit = db_session.scalar(
        select(CompanyStatusHistory).where(
            CompanyStatusHistory.request_id == request_id,
            CompanyStatusHistory.action == "REQUEST_REOPENED",
        )
    )
    assert reopen_audit is not None
    assert reopen_audit.comment == "Documents corriges et verifies a nouveau."


def test_super_admin_can_approve_reopened_request(
    client: TestClient,
    db_session: Session,
    super_admin_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sent_messages: list[str] = []
    monkeypatch.setattr(
        "app.services.company_registration_service.send_email",
        lambda **kwargs: sent_messages.append(kwargs["subject"]),
    )
    created_response = _create_request(client, email="reapprove@entreprise.ma")
    request_id = created_response.json()["request_id"]
    client.post(
        f"/api/v1/admin/company-registration/requests/{request_id}/reject",
        headers=super_admin_headers,
        json={"rejection_reason": "Documents fiscaux incoherents et verification incomplete."},
    )
    _reopen_request(client, request_id, super_admin_headers, "Decision reevaluee.")

    approve_response = client.patch(
        f"/api/v1/admin/company-requests/{request_id}/approve",
        headers=super_admin_headers,
    )

    assert approve_response.status_code == 200
    approve_body = approve_response.json()
    assert approve_body["request"]["decision"]["status"] == "approved"
    assert approve_body["request"]["approved_company_name"] == "Atlas Telecom Fleet"
    assert "Votre compte FleetConnect IA est active" in sent_messages

    approval_audit = db_session.scalar(
        select(CompanyStatusHistory).where(
            CompanyStatusHistory.request_id == request_id,
            CompanyStatusHistory.action == "REQUEST_APPROVED_AFTER_REOPENING",
        )
    )
    assert approval_audit is not None

    company = db_session.scalar(select(Company).where(Company.name == "Atlas Telecom Fleet"))
    assert company is not None


def test_company_registration_email_eligibility_endpoint_reports_rejected_request_as_resubmittable(
    client: TestClient,
    super_admin_headers: dict[str, str],
) -> None:
    create_response = _create_request(client, email="eligibility@entreprise.ma")
    request_id = create_response.json()["request_id"]
    client.post(
        f"/api/v1/admin/company-registration/requests/{request_id}/reject",
        headers=super_admin_headers,
        json={"rejection_reason": "Documents fiscaux incoherents et verification incomplete."},
    )

    response = client.get(
        "/api/v1/company-registration/request-eligibility",
        params={"email": "eligibility@entreprise.ma"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["can_submit"] is True
    assert body["reason"] == "resubmission_allowed"
    assert body["previous_request_id"] == request_id


@pytest.mark.parametrize(("requested_role",), [("ADMIN",), ("MANAGER",), ("ANALYST",)])
def test_approval_preserves_requested_role_but_forces_first_company_account_to_admin(
    client: TestClient,
    db_session: Session,
    super_admin_headers: dict[str, str],
    requested_role: str,
) -> None:
    response = _create_request(
        client,
        email=f"{requested_role.lower()}@entreprise.ma",
        requested_role=requested_role,
    )
    request_id = response.json()["request_id"]

    approve_response = client.post(
        f"/api/v1/admin/company-registration/requests/{request_id}/approve",
        headers=super_admin_headers,
    )

    assert approve_response.status_code == 200
    approve_body = approve_response.json()
    assert approve_body["request"]["requested_role"] == requested_role
    created_user = db_session.scalar(
        select(User).where(User.email == f"{requested_role.lower()}@entreprise.ma")
    )
    assert created_user is not None
    assert created_user.role == "company_admin"


def test_non_super_admin_cannot_access_super_admin_registration_endpoints(
    client: TestClient,
    db_session: Session,
) -> None:
    regular_admin = create_user(
        db_session,
        UserCreate(
            full_name="Admin Standard",
            email="admin.standard@test.com",
            password="AdminStandard123!",
            role="admin",
            is_active=True,
        ),
    )
    regular_admin_headers = _login_headers(client, regular_admin.email, "AdminStandard123!")

    list_response = client.get(
        "/api/v1/admin/company-registration/requests",
        headers=regular_admin_headers,
    )

    assert list_response.status_code == 403


@pytest.mark.parametrize("fixture_name", ["admin_headers", "manager_headers", "analyst_headers"])
def test_non_super_admin_cannot_delete_registration_request(
    client: TestClient,
    request: pytest.FixtureRequest,
    super_admin_headers: dict[str, str],
    fixture_name: str,
) -> None:
    create_response = _create_request(client, email=f"{fixture_name}@entreprise.ma")
    request_id = create_response.json()["request_id"]
    client.post(
        f"/api/v1/admin/company-registration/requests/{request_id}/reject",
        headers=super_admin_headers,
        json={"rejection_reason": "Documents fiscaux incoherents et verification incomplete."},
    )

    actor_headers = request.getfixturevalue(fixture_name)
    delete_response = _delete_request(client, request_id, actor_headers)

    assert delete_response.status_code == 403


@pytest.mark.parametrize("fixture_name", ["admin_headers", "manager_headers", "analyst_headers"])
def test_non_super_admin_cannot_reopen_registration_request(
    client: TestClient,
    request: pytest.FixtureRequest,
    super_admin_headers: dict[str, str],
    fixture_name: str,
) -> None:
    create_response = _create_request(client, email=f"reopen-{fixture_name}@entreprise.ma")
    request_id = create_response.json()["request_id"]
    client.post(
        f"/api/v1/admin/company-registration/requests/{request_id}/reject",
        headers=super_admin_headers,
        json={"rejection_reason": "Documents fiscaux incoherents et verification incomplete."},
    )

    actor_headers = request.getfixturevalue(fixture_name)
    reopen_response = _reopen_request(client, request_id, actor_headers)

    assert reopen_response.status_code == 403


def test_super_admin_can_soft_delete_rejected_request_and_active_list_hides_it(
    client: TestClient,
    db_session: Session,
    super_admin_headers: dict[str, str],
) -> None:
    create_response = _create_request(client, email="trash@entreprise.ma")
    request_id = create_response.json()["request_id"]
    client.post(
        f"/api/v1/admin/company-registration/requests/{request_id}/reject",
        headers=super_admin_headers,
        json={"rejection_reason": "Documents fiscaux incoherents et verification incomplete."},
    )

    delete_response = _delete_request(client, request_id, super_admin_headers)

    assert delete_response.status_code == 200
    delete_body = delete_response.json()
    assert delete_body["request"]["is_deleted"] is True

    stored_request = db_session.scalar(
        select(CompanyRegistrationRequest).where(CompanyRegistrationRequest.id == request_id)
    )
    assert stored_request is not None
    assert stored_request.is_deleted is True
    assert stored_request.deleted_by is not None

    audit_entry = db_session.scalar(
        select(CompanyStatusHistory).where(
            CompanyStatusHistory.request_id == request_id,
            CompanyStatusHistory.action == "request_deleted",
        )
    )
    assert audit_entry is not None

    active_list_response = client.get(
        "/api/v1/admin/company-registration/requests",
        headers=super_admin_headers,
    )
    assert active_list_response.status_code == 200
    assert active_list_response.json()["items"] == []

    trash_list_response = client.get(
        "/api/v1/admin/company-registration/requests",
        headers=super_admin_headers,
        params={"include_deleted": "true", "deleted_only": "true"},
    )
    assert trash_list_response.status_code == 200
    assert len(trash_list_response.json()["items"]) == 1
    assert trash_list_response.json()["items"][0]["is_deleted"] is True


def test_super_admin_cannot_delete_approved_request_linked_to_active_company(
    client: TestClient,
    super_admin_headers: dict[str, str],
) -> None:
    create_response = _create_request(client, email="approved-delete@entreprise.ma")
    request_id = create_response.json()["request_id"]
    approve_response = client.post(
        f"/api/v1/admin/company-registration/requests/{request_id}/approve",
        headers=super_admin_headers,
    )
    assert approve_response.status_code == 200

    delete_response = _delete_request(client, request_id, super_admin_headers)

    assert delete_response.status_code == 409
    assert (
        delete_response.json()["detail"]
        == "Impossible de supprimer une demande approuvee liee a une entreprise active. Suspendez ou archivez d'abord l'entreprise."
    )


def test_approved_request_cannot_be_reopened(
    client: TestClient,
    super_admin_headers: dict[str, str],
) -> None:
    create_response = _create_request(client, email="approved-reopen@entreprise.ma")
    request_id = create_response.json()["request_id"]
    approve_response = client.post(
        f"/api/v1/admin/company-registration/requests/{request_id}/approve",
        headers=super_admin_headers,
    )
    assert approve_response.status_code == 200

    reopen_response = _reopen_request(client, request_id, super_admin_headers)

    assert reopen_response.status_code == 400
    assert "Transition de statut non autorisee" in reopen_response.json()["detail"]


def test_deleted_request_cannot_be_reopened_until_restored(
    client: TestClient,
    super_admin_headers: dict[str, str],
) -> None:
    create_response = _create_request(client, email="deleted-reopen@entreprise.ma")
    request_id = create_response.json()["request_id"]
    client.post(
        f"/api/v1/admin/company-registration/requests/{request_id}/reject",
        headers=super_admin_headers,
        json={"rejection_reason": "Documents fiscaux incoherents et verification incomplete."},
    )
    delete_response = _delete_request(client, request_id, super_admin_headers)
    assert delete_response.status_code == 200

    reopen_response = _reopen_request(client, request_id, super_admin_headers)

    assert reopen_response.status_code == 400
    assert reopen_response.json()["detail"] == "Deleted requests cannot be reopened"


def test_reopen_is_blocked_when_a_newer_active_request_exists_for_the_same_email(
    client: TestClient,
    super_admin_headers: dict[str, str],
) -> None:
    first_response = _create_request(client, email="history-collision@entreprise.ma")
    first_request_id = first_response.json()["request_id"]
    client.post(
        f"/api/v1/admin/company-registration/requests/{first_request_id}/reject",
        headers=super_admin_headers,
        json={"rejection_reason": "Documents fiscaux incoherents et verification incomplete."},
    )
    second_response = _create_request(client, email="history-collision@entreprise.ma")
    assert second_response.status_code == 201

    reopen_response = _reopen_request(client, first_request_id, super_admin_headers)

    assert reopen_response.status_code == 409
    assert (
        reopen_response.json()["detail"]
        == "Une nouvelle demande active existe deja pour cet email. Veuillez traiter la demande la plus recente."
    )
