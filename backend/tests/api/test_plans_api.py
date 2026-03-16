from fastapi.testclient import TestClient


def test_active_user_can_list_default_plans(
    client: TestClient,
    manager_headers: dict[str, str],
) -> None:
    response = client.get("/api/v1/plans/", headers=manager_headers)

    assert response.status_code == 200
    body = response.json()
    assert len(body) >= 3
    assert any(plan["name"] == "Standard 20Go" for plan in body)


def test_active_user_can_read_plan_details(
    client: TestClient,
    manager_headers: dict[str, str],
) -> None:
    list_response = client.get("/api/v1/plans/", headers=manager_headers)
    first_plan_id = list_response.json()[0]["id"]

    response = client.get(f"/api/v1/plans/{first_plan_id}", headers=manager_headers)

    assert response.status_code == 200
    assert response.json()["id"] == first_plan_id


def test_admin_can_create_update_and_delete_plan(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    create_response = client.post(
        "/api/v1/plans/",
        headers=admin_headers,
        json={
            "name": "Enterprise 200Go",
            "operator_name": "inwi",
            "monthly_price": 750,
            "voice_quota": "Illimite",
            "data_quota": "200Go",
            "sms_quota": "Illimite",
            "roaming_zone": "Monde",
            "active_lines": 12,
            "description": "Forfait entreprise a tres forte capacite.",
        },
    )

    assert create_response.status_code == 201
    created_plan = create_response.json()
    assert created_plan["name"] == "Enterprise 200Go"

    update_response = client.put(
        f"/api/v1/plans/{created_plan['id']}",
        headers=admin_headers,
        json={
            "monthly_price": 790,
            "active_lines": 18,
            "description": "Forfait entreprise mis a jour.",
        },
    )

    assert update_response.status_code == 200
    updated_plan = update_response.json()
    assert updated_plan["monthly_price"] == 790
    assert updated_plan["active_lines"] == 18
    assert updated_plan["description"] == "Forfait entreprise mis a jour."

    delete_response = client.delete(
        f"/api/v1/plans/{created_plan['id']}",
        headers=admin_headers,
    )

    assert delete_response.status_code == 204

    after_delete_response = client.get(
        f"/api/v1/plans/{created_plan['id']}",
        headers=admin_headers,
    )
    assert after_delete_response.status_code == 404


def test_admin_cannot_create_duplicate_plan_name(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    response = client.post(
        "/api/v1/plans/",
        headers=admin_headers,
        json={
            "name": "Standard 20Go",
            "operator_name": "Orange Maroc",
            "monthly_price": 120,
            "voice_quota": "2h",
            "data_quota": "20Go",
            "sms_quota": "Illimite",
            "roaming_zone": "Maghreb",
            "active_lines": 85,
            "description": "Duplicate plan.",
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "A plan with this name already exists"
