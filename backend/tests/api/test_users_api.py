from urllib.parse import parse_qs, urlparse

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.models.company import Company
from app.models.fleet_access import Department
from app.models.user import User
from app.models.user_invitation import UserInvitation
from app.schemas.user import UserCreate
from app.services.user_service import create_user


def create_department(
    db_session,
    *,
    name: str,
    code: str,
    is_active: bool = True,
) -> Department:
    department = Department(name=name, code=code, is_active=is_active)
    db_session.add(department)
    db_session.commit()
    db_session.refresh(department)
    return department


def create_company(
    db_session,
    *,
    name: str,
) -> Company:
    company = Company(
        name=name,
        sector="Technologie",
        city="Casablanca",
        phone="+212600000000",
        status="active",
    )
    db_session.add(company)
    db_session.commit()
    db_session.refresh(company)
    return company


def login_headers(client: TestClient, email: str, password: str) -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/login",
        json={
            "email": email,
            "password": password,
        },
    )
    access_token = response.json()["access_token"]
    return {"Authorization": f"Bearer {access_token}"}


def create_company_admin_headers(
    client: TestClient,
    db_session,
    *,
    company: Company,
    email: str,
    password: str = "CompanyAdmin123!",
) -> dict[str, str]:
    create_user(
        db_session,
        UserCreate(
            full_name="Company Admin",
            email=email,
            password=password,
            role="company_admin",
            company_id=company.id,
            is_active=True,
        ),
    )
    return login_headers(client, email, password)


def extract_invitation_token(invitation_url: str) -> str:
    return parse_qs(urlparse(invitation_url).query)["token"][0]


def test_non_admin_cannot_access_admin_user_management_endpoints(
    client: TestClient,
    manager_headers: dict[str, str],
    manager_user,
) -> None:
    detail_response = client.get(
        f"/api/v1/users/{manager_user.id}",
        headers=manager_headers,
    )
    assert detail_response.status_code == 403

    status_response = client.patch(
        f"/api/v1/users/{manager_user.id}/status",
        headers=manager_headers,
        json={"status": "suspended"},
    )
    assert status_response.status_code == 403


def test_admin_can_filter_users_by_role_status_department_and_search(
    client: TestClient,
    db_session,
    admin_headers: dict[str, str],
) -> None:
    commercial = create_department(db_session, name="Commercial Test", code="COMT")
    finance = create_department(db_session, name="Finance Test", code="FINT")

    create_user(
        db_session,
        UserCreate(
            full_name="Alice Manager",
            email="alice.manager@test.com",
            password="StrongPass123!",
            role="manager",
            department_id=commercial.id,
            is_active=True,
        ),
    )
    create_user(
        db_session,
        UserCreate(
            full_name="Bob Manager",
            email="bob.manager@test.com",
            password="StrongPass123!",
            role="manager",
            department_id=finance.id,
            is_active=False,
        ),
    )
    create_user(
        db_session,
        UserCreate(
            full_name="Carla Analyst",
            email="carla.analyst@test.com",
            password="StrongPass123!",
            role="analyst",
            department_id=commercial.id,
            is_active=True,
        ),
    )

    response = client.get(
        f"/api/v1/users/?role=manager&status=active&department_id={commercial.id}&search=alice",
        headers=admin_headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["email"] == "alice.manager@test.com"
    assert body[0]["department_name"] == "Commercial Test"
    assert body[0]["status"] == "active"


def test_admin_can_change_user_role_and_account_status(
    client: TestClient,
    db_session,
    admin_headers: dict[str, str],
) -> None:
    operations = create_department(db_session, name="Operations Test", code="OPST")
    created_user = create_user(
        db_session,
        UserCreate(
            full_name="Role Switch",
            email="role-switch@test.com",
            password="StrongPass123!",
            role="user",
            department_id=operations.id,
            is_active=True,
        ),
    )

    role_response = client.patch(
        f"/api/v1/users/{created_user.id}/role",
        headers=admin_headers,
        json={"role": "analyst"},
    )
    assert role_response.status_code == 200
    assert role_response.json()["role"] == "analyst"

    deactivate_response = client.patch(
        f"/api/v1/users/{created_user.id}/deactivate",
        headers=admin_headers,
    )
    assert deactivate_response.status_code == 200
    assert deactivate_response.json()["is_active"] is False
    assert deactivate_response.json()["status"] == "suspended"

    reactivate_response = client.patch(
        f"/api/v1/users/{created_user.id}/status",
        headers=admin_headers,
        json={"status": "active"},
    )
    assert reactivate_response.status_code == 200
    assert reactivate_response.json()["is_active"] is True
    assert reactivate_response.json()["status"] == "active"


def test_admin_cannot_change_own_role_or_deactivate_self(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    role_response = client.patch(
        "/api/v1/users/1/role",
        headers=admin_headers,
        json={"role": "manager"},
    )
    assert role_response.status_code == 400
    assert role_response.json()["detail"] == "You cannot change your own role"

    status_response = client.patch(
        "/api/v1/users/1/status",
        headers=admin_headers,
        json={"status": "suspended"},
    )
    assert status_response.status_code == 400
    assert status_response.json()["detail"] == "You cannot deactivate your own account"

    deactivate_response = client.patch(
        "/api/v1/users/1/deactivate",
        headers=admin_headers,
    )
    assert deactivate_response.status_code == 400
    assert deactivate_response.json()["detail"] == "You cannot deactivate your own account"


def test_admin_can_read_user_detail_with_department_metadata(
    client: TestClient,
    db_session,
    admin_headers: dict[str, str],
) -> None:
    direction = create_department(db_session, name="Direction Test", code="DIRT")
    created_user = create_user(
        db_session,
        UserCreate(
            full_name="Detail User",
            email="detail-user@test.com",
            password="StrongPass123!",
            role="manager",
            department_id=direction.id,
            is_active=False,
        ),
    )

    response = client.get(f"/api/v1/users/{created_user.id}", headers=admin_headers)

    assert response.status_code == 200
    body = response.json()
    assert body["department_id"] == direction.id
    assert body["department_name"] == "Direction Test"
    assert body["status"] == "suspended"


def test_company_admin_can_create_invitation_for_new_email(
    client: TestClient,
    db_session,
    monkeypatch,
) -> None:
    company = create_company(db_session, name="BC Skills Invite")
    company_admin_headers = create_company_admin_headers(
        client,
        db_session,
        company=company,
        email="company-admin-invite@example.com",
    )
    monkeypatch.setattr("app.services.invitation_service.send_email", lambda **kwargs: None)

    response = client.post(
        "/api/v1/users/invitations",
        headers=company_admin_headers,
        json={
            "full_name": "Nouveau Collaborateur",
            "email": "new.collaborator@test.com",
            "phone": "+212611111111",
            "department": "Finance",
            "job_title": "Analyste",
            "expiration": "7_days",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["code"] == "INVITATION_SENT"
    assert body["message"] == "Invitation envoyee avec succes."
    assert body["invitation"]["email"] == "new.collaborator@test.com"
    assert "/register?token=" in body["invitation"]["invitation_url"]


def test_company_admin_cannot_invite_existing_active_member(
    client: TestClient,
    db_session,
    monkeypatch,
) -> None:
    company = create_company(db_session, name="BC Skills Existing Member")
    company_admin_headers = create_company_admin_headers(
        client,
        db_session,
        company=company,
        email="company-admin-member@example.com",
    )
    create_user(
        db_session,
        UserCreate(
            full_name="Membre Actif",
            email="member.active@test.com",
            password="StrongPass123!",
            role="user",
            company_id=company.id,
            is_active=True,
        ),
    )
    monkeypatch.setattr("app.services.invitation_service.send_email", lambda **kwargs: None)

    response = client.post(
        "/api/v1/users/invitations",
        headers=company_admin_headers,
        json={
            "full_name": "Membre Actif",
            "email": "member.active@test.com",
            "phone": None,
            "department": "Finance",
            "job_title": "Analyste",
            "expiration": "7_days",
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"] == {
        "code": "INVITATION_ALREADY_MEMBER",
        "message": "Cet utilisateur appartient deja a votre entreprise.",
    }


def test_company_admin_cannot_invite_user_from_other_company(
    client: TestClient,
    db_session,
    monkeypatch,
) -> None:
    company = create_company(db_session, name="BC Skills Source")
    other_company = create_company(db_session, name="BC Skills Target")
    company_admin_headers = create_company_admin_headers(
        client,
        db_session,
        company=company,
        email="company-admin-cross-company@example.com",
    )
    create_user(
        db_session,
        UserCreate(
            full_name="User Other Company",
            email="other.company@test.com",
            password="StrongPass123!",
            role="user",
            company_id=other_company.id,
            is_active=True,
        ),
    )
    monkeypatch.setattr("app.services.invitation_service.send_email", lambda **kwargs: None)

    response = client.post(
        "/api/v1/users/invitations",
        headers=company_admin_headers,
        json={
            "full_name": "User Other Company",
            "email": "other.company@test.com",
            "phone": None,
            "department": "Finance",
            "job_title": "Analyste",
            "expiration": "7_days",
        },
    )

    assert response.status_code == 403
    assert response.json()["detail"] == {
        "code": "INVITATION_OTHER_ORGANIZATION",
        "message": "Cet utilisateur appartient deja a une autre organisation.",
    }


def test_company_admin_returns_already_sent_when_pending_invitation_exists(
    client: TestClient,
    db_session,
    monkeypatch,
) -> None:
    company = create_company(db_session, name="BC Skills Pending Invite")
    company_admin_headers = create_company_admin_headers(
        client,
        db_session,
        company=company,
        email="company-admin-pending@example.com",
    )
    monkeypatch.setattr("app.services.invitation_service.send_email", lambda **kwargs: None)
    payload = {
        "full_name": "Pending Invite",
        "email": "pending.invite@test.com",
        "phone": None,
        "department": "Finance",
        "job_title": "Analyste",
        "expiration": "7_days",
    }

    first_response = client.post(
        "/api/v1/users/invitations",
        headers=company_admin_headers,
        json=payload,
    )
    second_response = client.post(
        "/api/v1/users/invitations",
        headers=company_admin_headers,
        json=payload,
    )

    assert first_response.status_code == 201
    assert second_response.status_code == 200
    second_body = second_response.json()
    assert second_body["code"] == "INVITATION_ALREADY_SENT"
    assert second_body["message"] == "Une invitation est deja en attente pour cet utilisateur."

    invitations = list(
        db_session.scalars(
            select(UserInvitation).where(
                UserInvitation.company_id == company.id,
                UserInvitation.email == "pending.invite@test.com",
            )
        )
    )
    assert len(invitations) == 1


def test_existing_user_without_company_is_attached_when_invitation_is_accepted(
    client: TestClient,
    db_session,
    monkeypatch,
) -> None:
    company = create_company(db_session, name="BC Skills Attach Account")
    company_admin_headers = create_company_admin_headers(
        client,
        db_session,
        company=company,
        email="company-admin-attach@example.com",
    )
    existing_user = create_user(
        db_session,
        UserCreate(
            full_name="Compte Existant",
            email="existing.orphan@test.com",
            password="StrongPass123!",
            role="user",
            company_id=None,
            is_active=True,
        ),
    )
    monkeypatch.setattr("app.services.invitation_service.send_email", lambda **kwargs: None)

    invitation_response = client.post(
        "/api/v1/users/invitations",
        headers=company_admin_headers,
        json={
            "full_name": "Compte Existant",
            "email": "existing.orphan@test.com",
            "phone": "+212622222222",
            "department": "Finance",
            "job_title": "Analyste",
            "expiration": "7_days",
        },
    )

    assert invitation_response.status_code == 201
    invitation_body = invitation_response.json()
    token = extract_invitation_token(invitation_body["invitation"]["invitation_url"])

    accept_response = client.post(
        "/api/v1/invitations/accept",
        json={
            "token": token,
            "password": "UpdatedPass123!",
            "phone": "+212633333333",
        },
    )

    assert accept_response.status_code == 200
    db_session.expire_all()

    refreshed_user = db_session.get(User, existing_user.id)
    assert refreshed_user is not None
    assert refreshed_user.company_id == company.id
    assert refreshed_user.phone == "+212633333333"
    assert refreshed_user.requested_department == "Finance"
    assert refreshed_user.job_profile == "Analyste"
    assert refreshed_user.is_active is True

    matched_users = list(
        db_session.scalars(select(User).where(User.email == "existing.orphan@test.com"))
    )
    assert len(matched_users) == 1

    refreshed_invitation = db_session.get(UserInvitation, invitation_body["invitation"]["id"])
    assert refreshed_invitation is not None
    assert refreshed_invitation.status == "accepted"


def test_company_admin_gets_explicit_invalid_email_error_for_invitation(
    client: TestClient,
    db_session,
    monkeypatch,
) -> None:
    company = create_company(db_session, name="BC Skills Invalid Email")
    company_admin_headers = create_company_admin_headers(
        client,
        db_session,
        company=company,
        email="company-admin-invalid-email@example.com",
    )
    monkeypatch.setattr("app.services.invitation_service.send_email", lambda **kwargs: None)

    response = client.post(
        "/api/v1/users/invitations",
        headers=company_admin_headers,
        json={
            "full_name": "Email Invalide",
            "email": "invalid-email",
            "phone": None,
            "department": "Finance",
            "job_title": "Analyste",
            "expiration": "7_days",
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == {
        "code": "INVITATION_INVALID_EMAIL",
        "message": "Email professionnel invalide.",
    }
