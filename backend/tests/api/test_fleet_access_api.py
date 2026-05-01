from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.fleet_access import Department, FleetResource
from app.models.user import User
from app.schemas.user import UserCreate
from app.services.user_service import create_user


def _login_headers(client: TestClient, email: str, password: str) -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
    )

    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _create_department(db: Session, name: str, code: str | None = None) -> Department:
    department = Department(
        name=name,
        code=code or "".join(part[0] for part in name.split()).upper()[:6] or "DEP",
        description=f"{name} test department",
        is_active=True,
    )
    db.add(department)
    db.commit()
    db.refresh(department)
    return department


def _create_resource(
    db: Session,
    *,
    department_id: int | None,
    identifier: str = "TAB-TEST-001",
    authorized_profiles: list[str] | None = None,
    is_shareable: bool = False,
    max_assignments: int = 1,
) -> FleetResource:
    resource = FleetResource(
        resource_type="tablet",
        identifier=identifier,
        label=f"Resource {identifier}",
        status="available",
        department_id=department_id,
        is_premium=bool(authorized_profiles),
        is_shareable=is_shareable,
        max_assignments=max_assignments if is_shareable else 1,
        authorized_profiles=authorized_profiles or [],
        notes="Test resource",
    )
    db.add(resource)
    db.commit()
    db.refresh(resource)
    return resource


def _create_employee(
    db: Session,
    *,
    email: str,
    department_id: int,
    job_profile: str,
    role: str = "analyst",
) -> User:
    return create_user(
        db,
        UserCreate(
            full_name=email.split("@")[0].replace(".", " ").title(),
            email=email,
            password="Employee123!",
            role=role,
            department_id=department_id,
            job_profile=job_profile,
            is_active=True,
        ),
    )


def test_admin_can_create_department_and_resource(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    department_response = client.post(
        "/api/v1/fleet-access/departments",
        headers=admin_headers,
        json={
            "name": "Ressources Humaines",
            "code": "rh",
            "description": "Service RH",
            "is_active": True,
        },
    )

    assert department_response.status_code == 201
    department_id = department_response.json()["id"]

    resource_response = client.post(
        "/api/v1/fleet-access/resources",
        headers=admin_headers,
        json={
            "resource_type": "laptop",
            "identifier": "PC-RH-001",
            "label": "PC portable RH",
            "department_id": department_id,
            "is_premium": True,
            "authorized_profiles": ["RH"],
            "notes": "Reserve au service RH.",
        },
    )

    assert resource_response.status_code == 201
    body = resource_response.json()
    assert body["identifier"] == "PC-RH-001"
    assert body["status"] == "available"
    assert body["department_name"] == "Ressources Humaines"
    assert body["authorized_profiles"] == ["RH"]


def test_admin_can_update_and_deactivate_department(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    create_response = client.post(
        "/api/v1/fleet-access/departments",
        headers=admin_headers,
        json={
            "name": "Operations",
            "code": "ops",
            "description": "Pilotage operationnel",
            "is_active": True,
        },
    )

    assert create_response.status_code == 201
    department_id = create_response.json()["id"]
    assert create_response.json()["code"] == "OPS"

    update_response = client.put(
        f"/api/v1/fleet-access/departments/{department_id}",
        headers=admin_headers,
        json={
            "name": "Operations terrain",
            "code": "OPS-TERRAIN",
            "description": "Supervision et coordination terrain",
            "is_active": False,
        },
    )

    assert update_response.status_code == 200
    assert update_response.json()["name"] == "Operations terrain"
    assert update_response.json()["code"] == "OPS-TERRAIN"
    assert update_response.json()["is_active"] is False

    active_departments_response = client.get(
        "/api/v1/fleet-access/departments",
        headers=admin_headers,
    )
    all_departments_response = client.get(
        "/api/v1/fleet-access/departments?include_inactive=true",
        headers=admin_headers,
    )

    assert active_departments_response.status_code == 200
    assert all_departments_response.status_code == 200
    assert department_id not in {item["id"] for item in active_departments_response.json()}
    assert department_id in {item["id"] for item in all_departments_response.json()}


def test_department_delete_is_blocked_when_links_exist(
    client: TestClient,
    admin_headers: dict[str, str],
    db_session: Session,
) -> None:
    department = _create_department(db_session, "Service Client", "SC")
    _create_resource(db_session, department_id=department.id, identifier="TAB-SC-001")

    delete_response = client.delete(
        f"/api/v1/fleet-access/departments/{department.id}",
        headers=admin_headers,
    )

    assert delete_response.status_code == 409
    assert delete_response.json()["detail"] == (
        "Department is still linked to users or resources. Deactivate it instead."
    )


def test_manager_assigns_department_resource_and_user_access_is_scoped(
    client: TestClient,
    db_session: Session,
    manager_user: User,
) -> None:
    it_department = _create_department(db_session, "IT Fleet")
    finance_department = _create_department(db_session, "Finance Fleet")
    manager_user.department_id = it_department.id
    manager_user.job_profile = "Manager"
    db_session.add(manager_user)

    employee = _create_employee(
        db_session,
        email="it.employee@test.com",
        department_id=it_department.id,
        job_profile="Support IT",
    )
    outsider = _create_employee(
        db_session,
        email="finance.employee@test.com",
        department_id=finance_department.id,
        job_profile="Finance",
    )
    resource = _create_resource(
        db_session,
        department_id=it_department.id,
        authorized_profiles=["Support IT"],
    )
    outsider_resource = _create_resource(
        db_session,
        department_id=finance_department.id,
        identifier="PC-FIN-001",
        authorized_profiles=["Finance"],
    )
    db_session.commit()

    manager_headers = _login_headers(client, manager_user.email, "Manager123!")
    visible_response = client.get("/api/v1/fleet-access/resources", headers=manager_headers)

    assert visible_response.status_code == 200
    visible_resource_ids = {item["id"] for item in visible_response.json()}
    assert resource.id in visible_resource_ids
    assert outsider_resource.id not in visible_resource_ids

    assign_response = client.post(
        f"/api/v1/fleet-access/resources/{resource.id}/assign",
        headers=manager_headers,
        json={"user_id": employee.id, "reason": "Dotation support IT"},
    )

    assert assign_response.status_code == 200
    assert assign_response.json()["status"] == "active"

    employee_headers = _login_headers(client, employee.email, "Employee123!")
    employee_resources = client.get("/api/v1/fleet-access/resources", headers=employee_headers)
    assert employee_resources.status_code == 200
    assert [item["id"] for item in employee_resources.json()] == [resource.id]

    access_check = client.get(
        f"/api/v1/fleet-access/resources/{resource.id}/access-check",
        headers=employee_headers,
    )
    assert access_check.status_code == 200
    assert access_check.json()["access_allowed"] is True

    outsider_headers = _login_headers(client, outsider.email, "Employee123!")
    forbidden_response = client.get(
        f"/api/v1/fleet-access/resources/{resource.id}",
        headers=outsider_headers,
    )
    assert forbidden_response.status_code == 403


def test_premium_resource_requires_authorized_profile(
    client: TestClient,
    db_session: Session,
    manager_user: User,
) -> None:
    department = _create_department(db_session, "Commercial Fleet")
    manager_user.department_id = department.id
    manager_user.job_profile = "Manager"
    db_session.add(manager_user)

    employee = _create_employee(
        db_session,
        email="commercial.employee@test.com",
        department_id=department.id,
        job_profile="Back-office",
    )
    resource = _create_resource(
        db_session,
        department_id=department.id,
        identifier="IPH-COM-001",
        authorized_profiles=["Commercial terrain"],
    )
    db_session.commit()

    manager_headers = _login_headers(client, manager_user.email, "Manager123!")
    response = client.post(
        f"/api/v1/fleet-access/resources/{resource.id}/assign",
        headers=manager_headers,
        json={"user_id": employee.id, "reason": "Demande terrain"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Target user profile is not authorized for this resource"


def test_blocked_resource_denies_assigned_user_access(
    client: TestClient,
    db_session: Session,
    manager_user: User,
) -> None:
    department = _create_department(db_session, "Support Fleet")
    manager_user.department_id = department.id
    manager_user.job_profile = "Manager"
    db_session.add(manager_user)

    employee = _create_employee(
        db_session,
        email="support.employee@test.com",
        department_id=department.id,
        job_profile="Support IT",
    )
    resource = _create_resource(
        db_session,
        department_id=department.id,
        identifier="TAB-SUP-001",
        authorized_profiles=["Support IT"],
    )
    db_session.commit()

    manager_headers = _login_headers(client, manager_user.email, "Manager123!")
    assign_response = client.post(
        f"/api/v1/fleet-access/resources/{resource.id}/assign",
        headers=manager_headers,
        json={"user_id": employee.id, "reason": "Besoin support"},
    )
    assert assign_response.status_code == 200

    block_response = client.post(
        f"/api/v1/fleet-access/resources/{resource.id}/block",
        headers=manager_headers,
        json={"status": "suspended", "reason": "Perte declaree"},
    )
    assert block_response.status_code == 200
    assert block_response.json()["status"] == "suspended"

    employee_headers = _login_headers(client, employee.email, "Employee123!")
    access_check = client.get(
        f"/api/v1/fleet-access/resources/{resource.id}/access-check",
        headers=employee_headers,
    )

    assert access_check.status_code == 200
    assert access_check.json()["access_allowed"] is False
    assert access_check.json()["reason"] == "Perte declaree"


def test_shareable_resource_can_be_assigned_to_multiple_users_and_revoked_individually(
    client: TestClient,
    db_session: Session,
    manager_user: User,
) -> None:
    department = _create_department(db_session, "Shared Support Fleet")
    manager_user.department_id = department.id
    manager_user.job_profile = "Manager"
    db_session.add(manager_user)

    employee_one = _create_employee(
        db_session,
        email="shared.one@test.com",
        department_id=department.id,
        job_profile="Support IT",
    )
    employee_two = _create_employee(
        db_session,
        email="shared.two@test.com",
        department_id=department.id,
        job_profile="Support IT",
    )
    resource = _create_resource(
        db_session,
        department_id=department.id,
        identifier="TAB-SHARED-001",
        authorized_profiles=["Support IT"],
        is_shareable=True,
        max_assignments=2,
    )
    db_session.commit()

    manager_headers = _login_headers(client, manager_user.email, "Manager123!")
    assign_response = client.post(
        f"/api/v1/fleet-access/resources/{resource.id}/assign-users",
        headers=manager_headers,
        json={
            "user_ids": [employee_one.id, employee_two.id],
            "assignment_reason": "Tablette partagee support",
        },
    )

    assert assign_response.status_code == 200
    body = assign_response.json()
    assert len(body) == 2
    assert {item["user_id"] for item in body} == {employee_one.id, employee_two.id}
    assert {item["assignment_reason"] for item in body} == {"Tablette partagee support"}

    resource_users = client.get(
        f"/api/v1/fleet-access/resources/{resource.id}/assignments",
        headers=manager_headers,
    )
    assert resource_users.status_code == 200
    assert len(resource_users.json()) == 2

    user_resources = client.get(
        f"/api/v1/fleet-access/users/{employee_one.id}/resources",
        headers=manager_headers,
    )
    assert user_resources.status_code == 200
    assert [item["resource_id"] for item in user_resources.json()] == [resource.id]

    revoke_response = client.post(
        f"/api/v1/fleet-access/assignments/{body[0]['id']}/revoke",
        headers=manager_headers,
        json={"reason": "Fin de pret"},
    )
    assert revoke_response.status_code == 200
    assert revoke_response.json()["status"] == "revoked"

    remaining_assignments = client.get(
        f"/api/v1/fleet-access/resources/{resource.id}/assignments",
        headers=manager_headers,
    )
    assert remaining_assignments.status_code == 200
    assert len(remaining_assignments.json()) == 1

    audit_response = client.get("/api/v1/fleet-access/audit-logs", headers=manager_headers)
    assert audit_response.status_code == 200
    audit_actions = [item["action"] for item in audit_response.json()]
    assert "assignment_created" in audit_actions
    assert "assignment_revoked" in audit_actions


def test_non_shareable_resource_rejects_multiple_assignments(
    client: TestClient,
    db_session: Session,
    manager_user: User,
) -> None:
    department = _create_department(db_session, "Named Devices Fleet")
    manager_user.department_id = department.id
    manager_user.job_profile = "Manager"
    db_session.add(manager_user)

    employee_one = _create_employee(
        db_session,
        email="named.one@test.com",
        department_id=department.id,
        job_profile="Finance",
    )
    employee_two = _create_employee(
        db_session,
        email="named.two@test.com",
        department_id=department.id,
        job_profile="Finance",
    )
    resource = _create_resource(
        db_session,
        department_id=department.id,
        identifier="PC-NAMED-001",
        authorized_profiles=["Finance"],
    )
    db_session.commit()

    manager_headers = _login_headers(client, manager_user.email, "Manager123!")
    assign_response = client.post(
        f"/api/v1/fleet-access/resources/{resource.id}/assign-users",
        headers=manager_headers,
        json={
            "user_ids": [employee_one.id, employee_two.id],
            "assignment_reason": "PC nominatif",
        },
    )

    assert assign_response.status_code == 409
    assert (
        assign_response.json()["detail"]
        == "Resource is not shareable and already has an active assignment"
    )


def test_usage_policy_flags_non_professional_usage_and_creates_alert(
    client: TestClient,
    db_session: Session,
    admin_headers: dict[str, str],
    manager_user: User,
) -> None:
    department = _create_department(db_session, "Usage Governance Fleet")
    manager_user.department_id = department.id
    manager_user.job_profile = "Manager"
    db_session.add(manager_user)

    employee = _create_employee(
        db_session,
        email="usage.employee@test.com",
        department_id=department.id,
        job_profile="Support IT",
    )
    resource = _create_resource(
        db_session,
        department_id=department.id,
        identifier="TAB-GOV-001",
        authorized_profiles=["Support IT"],
        is_shareable=True,
        max_assignments=2,
    )
    db_session.commit()

    manager_headers = _login_headers(client, manager_user.email, "Manager123!")
    assign_response = client.post(
        f"/api/v1/fleet-access/resources/{resource.id}/assign",
        headers=manager_headers,
        json={"user_id": employee.id, "assignment_reason": "Support terrain"},
    )
    assert assign_response.status_code == 200

    policy_response = client.put(
        f"/api/v1/fleet-access/resources/{resource.id}/usage-policy",
        headers=admin_headers,
        json={
            "policy_mode": "professional_only",
            "acceptable_use_rules": "Usage strictement professionnel pour support IT.",
            "security_level": "critical",
            "allowed_activity_categories": ["business", "support"],
            "restricted_activity_categories": ["social_media", "streaming"],
            "exception_roles": [],
            "exception_department_ids": [],
            "monitoring_enabled": True,
            "auto_alert_enabled": True,
            "auto_suspend_on_critical": False,
            "compliance_threshold": 90,
            "restrictions": [
                {
                    "category": "social_media",
                    "action": "alert",
                    "severity": "critical",
                    "exception_roles": [],
                    "exception_department_ids": [],
                    "notes": "Reseaux sociaux interdits.",
                    "is_active": True,
                }
            ],
        },
    )
    assert policy_response.status_code == 200
    assert policy_response.json()["restricted_activity_categories"] == ["social_media", "streaming"]

    usage_response = client.post(
        f"/api/v1/fleet-access/resources/{resource.id}/usage-logs",
        headers=manager_headers,
        json={
            "user_id": employee.id,
            "activity_type": "navigation",
            "activity_category": "social_media",
            "activity_label": "Usage reseaux sociaux hors mission",
            "usage_volume_mb": 250,
            "duration_minutes": 45,
        },
    )
    assert usage_response.status_code == 200
    usage_body = usage_response.json()
    assert usage_body["is_compliant"] is False
    assert usage_body["severity"] == "critical"

    alerts_response = client.get(
        f"/api/v1/fleet-access/compliance-alerts?resource_id={resource.id}",
        headers=manager_headers,
    )
    assert alerts_response.status_code == 200
    alerts = alerts_response.json()
    assert len(alerts) == 1
    assert alerts[0]["severity"] == "critical"
    assert alerts[0]["status"] == "open"
    assert alerts[0]["risk_id"] == f"fleet-compliance-{alerts[0]['id']}"
    assert alerts[0]["ai_recommendation"]
    assert alerts[0]["suggested_action"]

    overview_response = client.get(
        f"/api/v1/fleet-access/resources/{resource.id}/compliance",
        headers=manager_headers,
    )
    assert overview_response.status_code == 200
    overview = overview_response.json()
    assert overview["compliance_status"] == "non_compliant"
    assert overview["compliance_score"] == 0
    assert overview["open_alert_count"] == 1
    assert overview["recommendations"]


def test_user_can_only_read_own_usage_governance_status(
    client: TestClient,
    db_session: Session,
    manager_user: User,
) -> None:
    department = _create_department(db_session, "User Governance Fleet")
    other_department = _create_department(db_session, "Other Governance Fleet")
    manager_user.department_id = department.id
    manager_user.job_profile = "Manager"
    db_session.add(manager_user)

    employee = _create_employee(
        db_session,
        email="usage.self@test.com",
        department_id=department.id,
        job_profile="Support IT",
    )
    outsider = _create_employee(
        db_session,
        email="usage.outsider@test.com",
        department_id=other_department.id,
        job_profile="Finance",
    )
    resource = _create_resource(
        db_session,
        department_id=department.id,
        identifier="TAB-USER-GOV-001",
        authorized_profiles=["Support IT"],
    )
    db_session.commit()

    manager_headers = _login_headers(client, manager_user.email, "Manager123!")
    assign_response = client.post(
        f"/api/v1/fleet-access/resources/{resource.id}/assign",
        headers=manager_headers,
        json={"user_id": employee.id, "assignment_reason": "Support"},
    )
    assert assign_response.status_code == 200

    employee_headers = _login_headers(client, employee.email, "Employee123!")
    own_overview = client.get(
        f"/api/v1/fleet-access/resources/{resource.id}/compliance",
        headers=employee_headers,
    )
    assert own_overview.status_code == 200
    assert own_overview.json()["compliance_status"] == "compliant"

    forbidden_log = client.post(
        f"/api/v1/fleet-access/resources/{resource.id}/usage-logs",
        headers=employee_headers,
        json={
            "user_id": outsider.id,
            "activity_type": "navigation",
            "activity_category": "streaming",
        },
    )
    assert forbidden_log.status_code == 403
