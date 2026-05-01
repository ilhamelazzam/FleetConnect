from fastapi.testclient import TestClient


def test_manager_can_list_phone_lines_with_occupation_status_and_stats(
    client: TestClient,
    admin_headers: dict[str, str],
    manager_headers: dict[str, str],
) -> None:
    create_payloads = [
        {
            "phone_number": "+212600100001",
            "operator_name": "Orange Maroc",
            "plan_name": "Standard 20Go",
            "status": "active",
        },
        {
            "phone_number": "+212600100002",
            "operator_name": "Orange Maroc",
            "plan_name": "Standard 20Go",
            "assigned_to": "Meriem Tazi",
            "status": "active",
        },
        {
            "phone_number": "+212600100003",
            "operator_name": "Orange Maroc",
            "plan_name": "Standard 20Go",
            "assigned_to": "Meriem Tazi",
            "department": "IT",
            "status": "active",
        },
        {
            "phone_number": "+212600100004",
            "operator_name": "Orange Maroc",
            "plan_name": "Standard 20Go",
            "assigned_to": "Karim Alaoui",
            "department": "Support",
            "status": "suspended",
        },
        {
            "phone_number": "+212600100005",
            "operator_name": "Orange Maroc",
            "plan_name": "Standard 20Go",
            "status": "inactive",
        },
    ]

    for payload in create_payloads:
        response = client.post("/api/v1/phone-lines/", headers=admin_headers, json=payload)
        assert response.status_code == 201

    list_response = client.get("/api/v1/phone-lines/", headers=manager_headers)
    assert list_response.status_code == 200

    items = list_response.json()
    statuses_by_number = {item["phone_number"]: item["occupation_status"] for item in items}

    assert statuses_by_number["+212600100001"] == "libre"
    assert statuses_by_number["+212600100002"] == "en_cours"
    assert statuses_by_number["+212600100003"] == "attribuee"
    assert statuses_by_number["+212600100004"] == "suspendue"
    assert statuses_by_number["+212600100005"] == "inactive"

    stats_response = client.get("/api/v1/phone-lines/stats/occupation", headers=manager_headers)
    assert stats_response.status_code == 200

    stats = stats_response.json()
    assert stats["total"] == 5
    assert stats["total_libre"] == 1
    assert stats["total_en_cours"] == 1
    assert stats["total_attribuees"] == 1
    assert stats["total_suspendues"] == 1
    assert stats["total_inactives"] == 1


def test_manager_can_update_phone_line_contact_and_status(
    client: TestClient,
    admin_headers: dict[str, str],
    manager_headers: dict[str, str],
) -> None:
    create_response = client.post(
        "/api/v1/phone-lines/",
        headers=admin_headers,
        json={
            "phone_number": "+212600200001",
            "operator_name": "Orange Maroc",
            "plan_name": "Standard 20Go",
            "assigned_to": "Salma Idrissi",
            "department": "Finance",
            "status": "active",
            "notes": "Suivi mensuel prioritaire",
        },
    )
    assert create_response.status_code == 201
    phone_line_id = create_response.json()["id"]

    update_response = client.put(
        f"/api/v1/phone-lines/{phone_line_id}",
        headers=manager_headers,
        json={
            "assigned_to": "Salma Idrissi Bennani",
            "contact_email": "salma.idrissi@bcskills.ma",
            "department": "Direction Financiere",
            "status": "suspended",
        },
    )
    assert update_response.status_code == 200

    payload = update_response.json()
    assert payload["assigned_to"] == "Salma Idrissi Bennani"
    assert payload["contact_email"] == "salma.idrissi@bcskills.ma"
    assert payload["department"] == "Direction Financiere"
    assert payload["status"] == "suspended"
    assert payload["occupation_status"] == "suspendue"

    detail_response = client.get(f"/api/v1/phone-lines/{phone_line_id}", headers=manager_headers)
    assert detail_response.status_code == 200
    assert detail_response.json()["contact_email"] == "salma.idrissi@bcskills.ma"


def test_manager_can_change_plan_and_suspend_then_reactivate_line(
    client: TestClient,
    admin_headers: dict[str, str],
    manager_headers: dict[str, str],
) -> None:
    create_response = client.post(
        "/api/v1/phone-lines/",
        headers=admin_headers,
        json={
            "phone_number": "+212600200002",
            "operator_name": "Orange Maroc",
            "plan_name": "Standard 20Go",
            "assigned_to": "Youssef Amrani",
            "department": "IT",
            "status": "active",
            "monthly_limit": 20,
        },
    )
    assert create_response.status_code == 201
    phone_line_id = create_response.json()["id"]

    plans_response = client.get("/api/v1/plans/", headers=manager_headers)
    assert plans_response.status_code == 200
    plans = plans_response.json()
    target_plan = next(plan for plan in plans if plan["name"] == "Business 100Go")

    change_plan_response = client.post(
        f"/api/v1/phone-lines/{phone_line_id}/change-plan",
        headers=manager_headers,
        json={"plan_id": target_plan["id"]},
    )
    assert change_plan_response.status_code == 200

    changed_line = change_plan_response.json()
    assert changed_line["plan_name"] == "Business 100Go"
    assert changed_line["operator_name"] == "Maroc Telecom"
    assert changed_line["monthly_limit"] == 100
    assert changed_line["status"] == "active"

    suspend_response = client.post(
        f"/api/v1/phone-lines/{phone_line_id}/suspend",
        headers=manager_headers,
    )
    assert suspend_response.status_code == 200
    assert suspend_response.json()["status"] == "suspended"
    assert suspend_response.json()["occupation_status"] == "suspendue"

    reactivate_response = client.post(
        f"/api/v1/phone-lines/{phone_line_id}/reactivate",
        headers=manager_headers,
    )
    assert reactivate_response.status_code == 200
    assert reactivate_response.json()["status"] == "active"
    assert reactivate_response.json()["occupation_status"] == "attribuee"
