from fastapi.testclient import TestClient


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


def test_register_returns_tokens_and_creates_manager_account(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "Ilham Elazzam",
            "email": "ilham.elazzam@emsi-edu.ma",
            "password": "StrongPass123!",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["access_token"]
    assert body["refresh_token"]
    assert body["user"]["email"] == "ilham.elazzam@emsi-edu.ma"
    assert body["user"]["role"] == "manager"


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
) -> None:
    response = client.get("/api/v1/auth/google/login", follow_redirects=False)

    assert response.status_code == 302
    assert "localhost:5173/login" in response.headers["location"]
    assert "oauth_error=" in response.headers["location"]


def test_microsoft_login_redirects_back_to_frontend_when_oauth_is_not_configured(
    client: TestClient,
) -> None:
    response = client.get("/api/v1/auth/microsoft/login", follow_redirects=False)

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


def test_non_admin_can_list_users(
    client: TestClient,
    manager_headers: dict[str, str],
) -> None:
    response = client.get("/api/v1/users/", headers=manager_headers)

    assert response.status_code == 200
    assert len(response.json()) >= 2


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
            "notes": "Création depuis test API",
        },
    )

    assert create_response.status_code == 201
    created_phone_line = create_response.json()
    assert created_phone_line["plan_name"] == "Standard 20Go"

    update_response = client.put(
        f"/api/v1/phone-lines/{created_phone_line['id']}",
        headers=manager_headers,
        json={
            "assigned_to": "Ilham Elazzam Update",
            "plan_name": "Business 100Go",
            "monthly_limit": 100,
        },
    )

    assert update_response.status_code == 200
    updated_phone_line = update_response.json()
    assert updated_phone_line["assigned_to"] == "Ilham Elazzam Update"
    assert updated_phone_line["plan_name"] == "Business 100Go"
    assert updated_phone_line["monthly_limit"] == 100

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
