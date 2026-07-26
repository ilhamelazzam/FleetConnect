from urllib.parse import unquote_plus

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.config import get_settings
from app.core.security import decode_token, hash_password, verify_password
from app.models.company import Company
from app.models.user import User
from app.services.auth_service import ensure_default_admin


def test_login_success_returns_access_and_refresh_tokens(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/login",
        json={
            "email": "admin@bcskills.ma",
            "password": "Admin123!",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["access_token"]
    assert body["refresh_token"]


def test_register_returns_tokens_and_creates_standard_user_account(client: TestClient) -> None:
    photo_url = "data:image/png;base64,cmVnaXN0ZXItcGhvdG8="

    response = client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "Ilham Elazzam",
            "email": "ilham.elazzam@emsi-edu.ma",
            "password": "StrongPass123!",
            "photo_url": photo_url,
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["access_token"]
    assert body["refresh_token"]
    assert body["user"]["email"] == "ilham.elazzam@emsi-edu.ma"
    assert body["user"]["role"] == "user"
    assert body["user"]["photo_url"] == photo_url


def test_register_duplicate_email_returns_409(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "Admin Duplicate",
            "email": "admin@bcskills.ma",
            "password": "StrongPass123!",
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "A user with this email already exists"


def test_register_rejects_admin_role_assignment(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "Admin Public",
            "email": "public-admin@test.com",
            "password": "StrongPass123!",
            "role": "admin",
        },
    )

    assert response.status_code == 403
    assert (
        response.json()["detail"]
        == "Administrator role can only be assigned by an existing administrator"
    )


def test_register_request_company_match_detects_company_from_email_domain(
    client: TestClient,
    db_session,
) -> None:
    company = Company(
        name="Atlas Telecom Fleet",
        sector="Telecom",
        city="Casablanca",
        phone="+212522000000",
        website="https://atlas.ma",
        operators_json='["Orange"]',
        coverage_zones_json='["Casablanca"]',
    )
    db_session.add(company)
    db_session.commit()

    response = client.post(
        "/api/v1/auth/register-request/company-match",
        json={"email": "nora@atlas.ma"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["matched"] is True
    assert body["company_name"] == "Atlas Telecom Fleet"
    assert body["source"] == "email_domain"
    assert body["invitation_code_required"] is False


def test_register_request_creates_pending_user_and_blocks_login(
    client: TestClient,
    db_session,
) -> None:
    company = Company(
        name="Atlas Telecom Fleet",
        sector="Telecom",
        city="Casablanca",
        phone="+212522000000",
        website="https://atlas.ma",
        operators_json='["Orange"]',
        coverage_zones_json='["Casablanca"]',
    )
    db_session.add(company)
    db_session.commit()
    db_session.refresh(company)

    response = client.post(
        "/api/v1/auth/register-request",
        json={
            "full_name": "Nora Amrani",
            "email": "nora@atlas.ma",
            "phone": "+212600000123",
            "requested_department": "Finance",
            "job_profile": "Analyste Telecom",
            "password": "SecurePass123",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["company_name"] == "Atlas Telecom Fleet"
    assert body["account_status"] == "pending"

    created_user = db_session.scalar(select(User).where(User.email == "nora@atlas.ma"))
    assert created_user is not None
    assert created_user.company_id == company.id
    assert created_user.account_status == "pending"
    assert created_user.is_active is False
    assert created_user.phone == "+212600000123"
    assert created_user.requested_department == "Finance"
    assert created_user.job_profile == "Analyste Telecom"

    db_session.expire_all()
    refreshed_company = db_session.scalar(select(Company).where(Company.id == company.id))
    assert refreshed_company is not None
    assert refreshed_company.join_code is not None

    login_response = client.post(
        "/api/v1/auth/login",
        json={
            "email": "nora@atlas.ma",
            "password": "SecurePass123",
        },
    )

    assert login_response.status_code == 403
    assert (
        login_response.json()["detail"]
        == "Compte en attente de validation par l'administrateur de votre entreprise."
    )


def test_forgot_password_returns_reset_token_and_sends_email(
    client: TestClient,
    monkeypatch,
) -> None:
    sent_email: dict[str, str] = {}

    def fake_send_password_reset_email(*, recipient_email: str, recipient_name: str, code: str) -> None:
        sent_email["recipient_email"] = recipient_email
        sent_email["recipient_name"] = recipient_name
        sent_email["code"] = code

    monkeypatch.setattr(
        "app.services.password_reset_service.send_password_reset_email",
        fake_send_password_reset_email,
    )

    response = client.post(
        "/api/v1/auth/forgot-password",
        json={"email": "admin@bcskills.ma"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["reset_token"]
    assert body["expires_in_seconds"] == 900
    assert sent_email["recipient_email"] == "admin@bcskills.ma"
    assert sent_email["recipient_name"] == "Admin BC Skills"
    assert len(sent_email["code"]) == 6


def test_verify_reset_code_accepts_valid_code(
    client: TestClient,
    monkeypatch,
) -> None:
    sent_email: dict[str, str] = {}

    def fake_send_password_reset_email(*, recipient_email: str, recipient_name: str, code: str) -> None:
        sent_email["code"] = code

    monkeypatch.setattr(
        "app.services.password_reset_service.send_password_reset_email",
        fake_send_password_reset_email,
    )

    forgot_response = client.post(
        "/api/v1/auth/forgot-password",
        json={"email": "admin@bcskills.ma"},
    )

    response = client.post(
        "/api/v1/auth/verify-reset-code",
        json={
            "reset_token": forgot_response.json()["reset_token"],
            "code": sent_email["code"],
        },
    )

    assert response.status_code == 200
    assert response.json()["message"] == "Verification code confirmed."


def test_reset_password_updates_credentials(
    client: TestClient,
    monkeypatch,
) -> None:
    sent_email: dict[str, str] = {}

    def fake_send_password_reset_email(*, recipient_email: str, recipient_name: str, code: str) -> None:
        sent_email["code"] = code

    monkeypatch.setattr(
        "app.services.password_reset_service.send_password_reset_email",
        fake_send_password_reset_email,
    )

    forgot_response = client.post(
        "/api/v1/auth/forgot-password",
        json={"email": "admin@bcskills.ma"},
    )

    reset_response = client.post(
        "/api/v1/auth/reset-password",
        json={
            "reset_token": forgot_response.json()["reset_token"],
            "code": sent_email["code"],
            "new_password": "UpdatedPass123!",
        },
    )

    assert reset_response.status_code == 200
    assert reset_response.json()["message"] == "Password has been reset successfully."

    login_response = client.post(
        "/api/v1/auth/login",
        json={
            "email": "admin@bcskills.ma",
            "password": "UpdatedPass123!",
        },
    )

    assert login_response.status_code == 200
    assert login_response.json()["access_token"]


def test_google_login_redirects_back_to_frontend_when_oauth_is_not_configured(
    client: TestClient,
    monkeypatch,
) -> None:
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "")
    monkeypatch.setenv("GOOGLE_REDIRECT_URI", "")
    get_settings.cache_clear()

    try:
        response = client.get("/api/v1/auth/google/login", follow_redirects=False)
    finally:
        get_settings.cache_clear()

    assert response.status_code == 302
    assert "localhost:5173/login" in response.headers["location"]
    assert "oauth_error=" in response.headers["location"]


def test_google_login_treats_example_credentials_as_not_configured(
    client: TestClient,
    monkeypatch,
) -> None:
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "your-google-client-id.apps.googleusercontent.com")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "your-google-client-secret")
    monkeypatch.setenv(
        "GOOGLE_REDIRECT_URI",
        "http://127.0.0.1:8000/api/v1/auth/google/callback",
    )
    get_settings.cache_clear()

    try:
        response = client.get("/api/v1/auth/google/login", follow_redirects=False)
    finally:
        get_settings.cache_clear()

    assert response.status_code == 302
    location = unquote_plus(response.headers["location"])
    assert "oauth_error=" in response.headers["location"]
    assert "GOOGLE_CLIENT_ID" in location
    assert "backend/.env" in location


def test_oauth_providers_status_reports_configured_and_missing_providers(
    client: TestClient,
    monkeypatch,
) -> None:
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "google-client-id.apps.googleusercontent.com")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "google-client-secret")
    monkeypatch.setenv(
        "GOOGLE_REDIRECT_URI",
        "http://127.0.0.1:8000/api/v1/auth/google/callback",
    )
    monkeypatch.setenv("MICROSOFT_CLIENT_ID", "")
    monkeypatch.setenv("MICROSOFT_CLIENT_SECRET", "")
    monkeypatch.setenv(
        "MICROSOFT_REDIRECT_URI",
        "http://127.0.0.1:8000/api/v1/auth/microsoft/callback",
    )
    monkeypatch.setenv("MICROSOFT_TENANT_ID", "common")
    get_settings.cache_clear()

    try:
        response = client.get("/api/v1/auth/oauth/providers")
    finally:
        get_settings.cache_clear()

    assert response.status_code == 200
    assert response.json() == {
        "google": {"configured": True},
        "microsoft": {"configured": False},
    }


def test_oauth_providers_status_reports_microsoft_when_fully_configured(
    client: TestClient,
    monkeypatch,
) -> None:
    monkeypatch.setenv("MICROSOFT_CLIENT_ID", "microsoft-client-id")
    monkeypatch.setenv("MICROSOFT_CLIENT_SECRET", "microsoft-client-secret")
    monkeypatch.setenv(
        "MICROSOFT_REDIRECT_URI",
        "http://127.0.0.1:8000/api/v1/auth/microsoft/callback",
    )
    monkeypatch.setenv("MICROSOFT_TENANT_ID", "common")
    get_settings.cache_clear()

    try:
        response = client.get("/api/v1/auth/oauth/providers")
    finally:
        get_settings.cache_clear()

    assert response.status_code == 200
    assert response.json()["microsoft"] == {"configured": True}


def test_microsoft_login_redirects_back_to_frontend_when_oauth_is_not_configured(
    client: TestClient,
    monkeypatch,
) -> None:
    monkeypatch.setenv("MICROSOFT_CLIENT_ID", "")
    monkeypatch.setenv("MICROSOFT_CLIENT_SECRET", "")
    monkeypatch.setenv("MICROSOFT_REDIRECT_URI", "")
    get_settings.cache_clear()

    try:
        response = client.get("/api/v1/auth/microsoft/login", follow_redirects=False)
    finally:
        get_settings.cache_clear()

    assert response.status_code == 302
    assert "localhost:5173/login" in response.headers["location"]
    assert "oauth_error=" in response.headers["location"]


def test_login_failure_with_wrong_password_returns_401(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/login",
        json={
            "email": "admin@bcskills.ma",
            "password": "WrongPassword1!",
        },
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid credentials"


def test_super_admin_login_succeeds_with_dedicated_default_account(
    client: TestClient,
) -> None:
    response = client.post(
        "/api/v1/auth/admin/login",
        json={
            "email": "elazzamilham2@gmail.com",
            "password": "Ilham12345678",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["access_token"]
    assert body["refresh_token"]
    assert body["user"]["email"] == "elazzamilham2@gmail.com"
    assert body["user"]["role"] == "super_admin"
    payload = decode_token(body["access_token"])
    assert payload["sub"] == str(body["user"]["id"])
    assert payload["user_id"] == body["user"]["id"]
    assert payload["email"] == "elazzamilham2@gmail.com"
    assert payload["role"] == "super_admin"


def test_admin_login_returns_explicit_message_when_user_does_not_exist(
    client: TestClient,
) -> None:
    response = client.post(
        "/api/v1/auth/admin/login",
        json={
            "email": "missing.superadmin@test.com",
            "password": "Ilham12345678",
        },
    )

    assert response.status_code == 401
    assert response.json()["detail"] == {
        "code": "USER_NOT_FOUND",
        "message": "Utilisateur inexistant",
    }


def test_admin_login_returns_explicit_message_when_password_is_invalid(
    client: TestClient,
) -> None:
    response = client.post(
        "/api/v1/auth/admin/login",
        json={
            "email": "elazzamilham2@gmail.com",
            "password": "WrongPassword1!",
        },
    )

    assert response.status_code == 401
    assert response.json()["detail"] == {
        "code": "INVALID_PASSWORD",
        "message": "Mot de passe incorrect",
    }


def test_admin_login_rejects_non_super_admin_role(
    client: TestClient,
    manager_user,
) -> None:
    response = client.post(
        "/api/v1/auth/admin/login",
        json={
            "email": manager_user.email,
            "password": "Manager123!",
        },
    )

    assert response.status_code == 403
    assert response.json()["detail"] == {
        "code": "SUPER_ADMIN_ONLY",
        "message": "Acces reserve au Super Administrateur",
    }


def test_ensure_default_admin_repairs_super_admin_credentials_and_role(db_session) -> None:
    super_admin = db_session.scalar(
        select(User).where(User.email == "elazzamilham2@gmail.com")
    )
    assert super_admin is not None

    super_admin.full_name = "Ancien Compte"
    super_admin.role = "admin"
    super_admin.is_active = False
    super_admin.account_status = "suspended"
    super_admin.hashed_password = hash_password("WrongPassword1!")
    db_session.add(super_admin)
    db_session.commit()

    ensure_default_admin()

    db_session.expire_all()
    repaired_super_admin = db_session.scalar(
        select(User).where(User.email == "elazzamilham2@gmail.com")
    )
    assert repaired_super_admin is not None
    assert repaired_super_admin.full_name == "Super Administrateur"
    assert repaired_super_admin.role == "super_admin"
    assert repaired_super_admin.is_active is True
    assert repaired_super_admin.account_status == "active"
    assert verify_password("Ilham12345678", repaired_super_admin.hashed_password)


def test_protected_endpoint_without_token_returns_401(client: TestClient) -> None:
    response = client.get("/api/v1/auth/me")

    assert response.status_code == 401


def test_protected_endpoint_with_invalid_token_returns_401(client: TestClient) -> None:
    response = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": "Bearer invalid-token"},
    )

    assert response.status_code == 401


def test_protected_endpoint_with_valid_token_returns_200(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    response = client.get("/api/v1/auth/me", headers=admin_headers)

    assert response.status_code == 200
    assert response.json()["email"] == "admin@bcskills.ma"
    assert response.json()["photo_url"] is None


def test_refresh_returns_new_tokens_for_valid_refresh_token(client: TestClient) -> None:
    login_response = client.post(
        "/api/v1/auth/login",
        json={
            "email": "admin@bcskills.ma",
            "password": "Admin123!",
        },
    )
    refresh_token = login_response.json()["refresh_token"]

    response = client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": refresh_token},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["access_token"]
    assert body["refresh_token"]
    assert body["user"]["email"] == "admin@bcskills.ma"


def test_non_admin_cannot_list_users(
    client: TestClient,
    manager_headers: dict[str, str],
) -> None:
    response = client.get("/api/v1/users/", headers=manager_headers)

    assert response.status_code == 403


def test_admin_can_create_user_with_photo(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    photo_url = "data:image/png;base64,ZmFrZS1pbWFnZS1kYXRh"

    response = client.post(
        "/api/v1/users/",
        headers=admin_headers,
        json={
            "full_name": "User Photo Test",
            "email": "photo@test.com",
            "password": "StrongPass123!",
            "photo_url": photo_url,
            "role": "manager",
            "is_active": True,
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["email"] == "photo@test.com"
    assert body["photo_url"] == photo_url


def test_admin_can_read_update_and_delete_user(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    create_response = client.post(
        "/api/v1/users/",
        headers=admin_headers,
        json={
            "full_name": "CRUD User",
            "email": "crud@test.com",
            "password": "StrongPass123!",
            "role": "manager",
            "is_active": True,
        },
    )

    assert create_response.status_code == 201
    created_user = create_response.json()

    read_response = client.get(f"/api/v1/users/{created_user['id']}", headers=admin_headers)
    assert read_response.status_code == 200
    assert read_response.json()["email"] == "crud@test.com"

    update_response = client.put(
        f"/api/v1/users/{created_user['id']}",
        headers=admin_headers,
        json={
            "full_name": "CRUD User Updated",
            "role": "analyst",
            "photo_url": "data:image/png;base64,dXBkYXRlZA==",
        },
    )

    assert update_response.status_code == 200
    updated_user = update_response.json()
    assert updated_user["full_name"] == "CRUD User Updated"
    assert updated_user["role"] == "analyst"
    assert updated_user["photo_url"] == "data:image/png;base64,dXBkYXRlZA=="

    delete_response = client.delete(
        f"/api/v1/users/{created_user['id']}",
        headers=admin_headers,
    )
    assert delete_response.status_code == 204

    after_delete_response = client.get(
        f"/api/v1/users/{created_user['id']}",
        headers=admin_headers,
    )
    assert after_delete_response.status_code == 404


def test_admin_cannot_delete_own_account(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    response = client.delete("/api/v1/users/1", headers=admin_headers)

    assert response.status_code == 400
    assert response.json()["detail"] == "You cannot delete your own account"


def test_user_cannot_access_another_users_resource(
    client: TestClient,
    manager_headers: dict[str, str],
) -> None:
    response = client.get("/api/v1/users/1", headers=manager_headers)

    assert response.status_code == 403


def test_phone_line_validation_failure_returns_422(
    client: TestClient,
    manager_headers: dict[str, str],
) -> None:
    response = client.post(
        "/api/v1/phone-lines/",
        headers=manager_headers,
        json={
            "phone_number": "abc",
            "operator_name": "Orange",
            "plan_name": "Premium 50Go",
            "assigned_to": "Test User",
            "department": "IT",
            "status": "active",
            "monthly_limit": -1,
        },
    )

    assert response.status_code == 422


def test_manager_can_create_update_and_delete_phone_line(
    client: TestClient,
    manager_headers: dict[str, str],
) -> None:
    create_response = client.post(
        "/api/v1/phone-lines/",
        headers=manager_headers,
        json={
            "phone_number": "+212600000010",
            "operator_name": "Orange Maroc",
            "plan_name": "Standard 20Go",
            "assigned_to": "Ilham Elazzam",
            "department": "Direction",
            "status": "active",
            "monthly_limit": 20,
            "current_data_usage_gb": 14.5,
            "previous_data_usage_gb": 12.9,
            "notes": "Création depuis test API",
        },
    )

    assert create_response.status_code == 201
    created_phone_line = create_response.json()
    assert created_phone_line["plan_name"] == "Standard 20Go"
    assert created_phone_line["current_data_usage_gb"] == 14.5
    assert created_phone_line["previous_data_usage_gb"] == 12.9

    update_response = client.put(
        f"/api/v1/phone-lines/{created_phone_line['id']}",
        headers=manager_headers,
        json={
            "assigned_to": "Ilham Elazzam Update",
            "plan_name": "Business 100Go",
            "monthly_limit": 100,
            "current_data_usage_gb": 68.5,
            "previous_data_usage_gb": 61.2,
        },
    )

    assert update_response.status_code == 200
    updated_phone_line = update_response.json()
    assert updated_phone_line["assigned_to"] == "Ilham Elazzam Update"
    assert updated_phone_line["plan_name"] == "Business 100Go"
    assert updated_phone_line["monthly_limit"] == 100
    assert updated_phone_line["current_data_usage_gb"] == 68.5
    assert updated_phone_line["previous_data_usage_gb"] == 61.2

    delete_response = client.delete(
        f"/api/v1/phone-lines/{created_phone_line['id']}",
        headers=manager_headers,
    )

    assert delete_response.status_code == 204

    read_response = client.get(
        f"/api/v1/phone-lines/{created_phone_line['id']}",
        headers=manager_headers,
    )
    assert read_response.status_code == 404


def test_analyst_cannot_mutate_phone_lines(
    client: TestClient,
    analyst_headers: dict[str, str],
) -> None:
    create_response = client.post(
        "/api/v1/phone-lines/",
        headers=analyst_headers,
        json={
            "phone_number": "+212600000011",
            "operator_name": "Orange Maroc",
            "plan_name": "Standard 20Go",
            "assigned_to": "Analyst User",
            "department": "Finance",
            "status": "active",
            "monthly_limit": 20,
        },
    )

    assert create_response.status_code == 403


def test_login_rate_limit_returns_429_after_repeated_failures(client: TestClient) -> None:
    for _ in range(5):
        response = client.post(
            "/api/v1/auth/login",
            json={
                "email": "admin@bcskills.ma",
                "password": "WrongPassword1!",
            },
        )
        assert response.status_code == 401

    blocked_response = client.post(
        "/api/v1/auth/login",
        json={
            "email": "admin@bcskills.ma",
            "password": "WrongPassword1!",
        },
    )

    assert blocked_response.status_code == 429
