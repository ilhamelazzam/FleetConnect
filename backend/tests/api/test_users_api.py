from fastapi.testclient import TestClient

from app.models.fleet_access import Department
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
