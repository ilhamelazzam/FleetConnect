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


def test_manager_cannot_create_update_or_delete_plan(
    client: TestClient,
    manager_headers: dict[str, str],
) -> None:
    create_response = client.post(
        "/api/v1/plans/",
        headers=manager_headers,
        json={
            "name": "Manager Forbidden Plan",
            "operator_name": "inwi",
            "monthly_price": 500,
            "voice_quota": "5h",
            "data_quota": "80Go",
            "sms_quota": "Illimite",
            "roaming_zone": "Maghreb",
            "active_lines": 6,
            "description": "Should be forbidden.",
        },
    )

    assert create_response.status_code == 403

    list_response = client.get("/api/v1/plans/", headers=manager_headers)
    first_plan_id = list_response.json()[0]["id"]

    update_response = client.put(
        f"/api/v1/plans/{first_plan_id}",
        headers=manager_headers,
        json={"monthly_price": 999},
    )
    delete_response = client.delete(
        f"/api/v1/plans/{first_plan_id}",
        headers=manager_headers,
    )

    assert update_response.status_code == 403
    assert delete_response.status_code == 403


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


def test_manager_can_activate_plan_directly(
    client: TestClient,
    admin_headers: dict[str, str],
    manager_headers: dict[str, str],
    manager_user,
) -> None:
    create_response = client.post(
        "/api/v1/plans/",
        headers=admin_headers,
        json={
            "name": "Starter 5Go",
            "operator_name": "inwi",
            "monthly_price": 90,
            "voice_quota": "1h",
            "data_quota": "5Go",
            "sms_quota": "500",
            "roaming_zone": "Aucun",
            "active_lines": 0,
            "description": "Forfait a activer manuellement.",
        },
    )
    assert create_response.status_code == 201
    created_plan = create_response.json()
    assert created_plan["activation_status"] == "inactive"

    activation_response = client.post(
        "/api/v1/plans/activate-plan",
        headers=manager_headers,
        json={"plan_id": created_plan["id"]},
    )
    assert activation_response.status_code == 200

    payload = activation_response.json()
    assert payload["action"] == "Activation forfait"
    assert payload["message"] == "Forfait active avec succes"
    assert payload["activated_by_user_id"] == manager_user.id
    assert payload["activated_by_name"] == manager_user.full_name
    assert payload["phone_line"] is None
    assert payload["plan"]["activation_status"] == "active"
    assert payload["plan"]["activated_by_user_id"] == manager_user.id
    assert payload["plan"]["activated_at"] is not None


def test_manager_can_activate_plan_for_assigned_line(
    client: TestClient,
    admin_headers: dict[str, str],
    manager_headers: dict[str, str],
) -> None:
    create_line_response = client.post(
        "/api/v1/phone-lines/",
        headers=admin_headers,
        json={
            "phone_number": "+212600300001",
            "operator_name": "Orange Maroc",
            "plan_name": "Standard 20Go",
            "assigned_to": "Sara Amrani",
            "department": "Finance",
            "status": "suspended",
            "monthly_limit": 20,
        },
    )
    assert create_line_response.status_code == 201
    phone_line_id = create_line_response.json()["id"]

    create_plan_response = client.post(
        "/api/v1/plans/",
        headers=admin_headers,
        json={
            "name": "Executive 80Go",
            "operator_name": "Maroc Telecom",
            "monthly_price": 460,
            "voice_quota": "Illimite",
            "data_quota": "80Go",
            "sms_quota": "Illimite",
            "roaming_zone": "International",
            "active_lines": 0,
            "description": "Forfait cible pour activation directe.",
        },
    )
    assert create_plan_response.status_code == 201
    target_plan = create_plan_response.json()

    activation_response = client.post(
        "/api/v1/plans/activate-plan",
        headers=manager_headers,
        json={
            "plan_id": target_plan["id"],
            "phone_line_id": phone_line_id,
        },
    )
    assert activation_response.status_code == 200

    payload = activation_response.json()
    assert payload["plan"]["activation_status"] == "active"
    assert payload["phone_line"]["plan_name"] == "Executive 80Go"
    assert payload["phone_line"]["operator_name"] == "Maroc Telecom"
    assert payload["phone_line"]["status"] == "active"
    assert payload["phone_line"]["occupation_status"] == "attribuee"
    assert payload["phone_line"]["monthly_limit"] == 80


def test_manager_can_preview_and_deactivate_low_impact_plan(
    client: TestClient,
    admin_headers: dict[str, str],
    manager_headers: dict[str, str],
) -> None:
    create_response = client.post(
        "/api/v1/plans/",
        headers=admin_headers,
        json={
            "name": "Essentiel 8Go",
            "operator_name": "inwi",
            "monthly_price": 110,
            "voice_quota": "2h",
            "data_quota": "8Go",
            "sms_quota": "500",
            "roaming_zone": "Aucun",
            "active_lines": 3,
            "description": "Forfait facilement desactivable.",
        },
    )
    assert create_response.status_code == 201
    created_plan = create_response.json()

    preview_response = client.get(
        f"/api/v1/plans/{created_plan['id']}/lifecycle-impact",
        headers=manager_headers,
    )
    assert preview_response.status_code == 200
    preview_payload = preview_response.json()
    assert preview_payload["impacted_lines"] == 3
    assert preview_payload["can_deactivate"] is True
    assert preview_payload["coverage_impact_label"] == "Faible"

    deactivate_response = client.patch(
        f"/api/v1/plans/{created_plan['id']}/deactivate",
        headers=manager_headers,
    )
    assert deactivate_response.status_code == 200
    deactivate_payload = deactivate_response.json()
    assert deactivate_payload["message"] == "Forfait desactive avec succes"
    assert deactivate_payload["plan"]["activation_status"] == "inactive"
    assert deactivate_payload["impact"]["impacted_lines"] == 3


def test_manager_cannot_deactivate_critical_plan_without_reassignment(
    client: TestClient,
    admin_headers: dict[str, str],
    manager_headers: dict[str, str],
) -> None:
    create_response = client.post(
        "/api/v1/plans/",
        headers=admin_headers,
        json={
            "name": "Critique 120Go",
            "operator_name": "Maroc Telecom",
            "monthly_price": 640,
            "voice_quota": "Illimite",
            "data_quota": "120Go",
            "sms_quota": "Illimite",
            "roaming_zone": "Monde",
            "active_lines": 31,
            "description": "Forfait critique a proteger.",
        },
    )
    assert create_response.status_code == 201
    created_plan = create_response.json()

    preview_response = client.get(
        f"/api/v1/plans/{created_plan['id']}/lifecycle-impact",
        headers=manager_headers,
    )
    assert preview_response.status_code == 200
    preview_payload = preview_response.json()
    assert preview_payload["can_deactivate"] is False
    assert preview_payload["is_critical"] is True
    assert preview_payload["blocking_reason"] == "Veuillez reaffecter les lignes avant desactivation"

    deactivate_response = client.patch(
        f"/api/v1/plans/{created_plan['id']}/deactivate",
        headers=manager_headers,
    )
    assert deactivate_response.status_code == 409
    assert deactivate_response.json()["detail"] == "Veuillez reaffecter les lignes avant desactivation"


def test_manager_can_replace_active_plan_and_reassign_linked_lines(
    client: TestClient,
    admin_headers: dict[str, str],
    manager_headers: dict[str, str],
) -> None:
    source_plan_response = client.post(
        "/api/v1/plans/",
        headers=admin_headers,
        json={
            "name": "Business 70Go",
            "operator_name": "Orange Maroc",
            "monthly_price": 320,
            "voice_quota": "Illimite",
            "data_quota": "70Go",
            "sms_quota": "Illimite",
            "roaming_zone": "International",
            "active_lines": 2,
            "description": "Forfait a remplacer.",
        },
    )
    assert source_plan_response.status_code == 201
    source_plan = source_plan_response.json()

    replacement_plan_response = client.post(
        "/api/v1/plans/",
        headers=admin_headers,
        json={
            "name": "Business 25Go",
            "operator_name": "Orange Maroc",
            "monthly_price": 180,
            "voice_quota": "4h",
            "data_quota": "25Go",
            "sms_quota": "Illimite",
            "roaming_zone": "Maghreb",
            "active_lines": 0,
            "description": "Forfait cible de remplacement.",
        },
    )
    assert replacement_plan_response.status_code == 201
    replacement_plan = replacement_plan_response.json()

    create_line_1_response = client.post(
        "/api/v1/phone-lines/",
        headers=admin_headers,
        json={
            "phone_number": "+212611000001",
            "operator_name": "Orange Maroc",
            "plan_name": "Business 70Go",
            "assigned_to": "Nadia Saidi",
            "department": "Commercial",
            "status": "active",
            "monthly_limit": 70,
        },
    )
    assert create_line_1_response.status_code == 201
    line_1 = create_line_1_response.json()

    create_line_2_response = client.post(
        "/api/v1/phone-lines/",
        headers=admin_headers,
        json={
            "phone_number": "+212611000002",
            "operator_name": "Orange Maroc",
            "plan_name": "Business 70Go",
            "assigned_to": "Yassine El Fassi",
            "department": "Support",
            "status": "active",
            "monthly_limit": 70,
        },
    )
    assert create_line_2_response.status_code == 201
    line_2 = create_line_2_response.json()

    replace_response = client.post(
        f"/api/v1/plans/{source_plan['id']}/replace",
        headers=manager_headers,
        json={"replacement_plan_id": replacement_plan["id"]},
    )
    assert replace_response.status_code == 200
    replace_payload = replace_response.json()
    assert replace_payload["message"] == "Forfait remplace avec succes"
    assert replace_payload["previous_plan"]["activation_status"] == "inactive"
    assert replace_payload["replacement_plan"]["activation_status"] == "active"
    assert replace_payload["impact"]["impacted_lines"] == 2
    assert replace_payload["reassigned_lines"] == 2

    refreshed_line_1 = client.get(f"/api/v1/phone-lines/{line_1['id']}", headers=manager_headers)
    refreshed_line_2 = client.get(f"/api/v1/phone-lines/{line_2['id']}", headers=manager_headers)
    assert refreshed_line_1.status_code == 200
    assert refreshed_line_2.status_code == 200
    assert refreshed_line_1.json()["plan_name"] == "Business 25Go"
    assert refreshed_line_1.json()["monthly_limit"] == 25
    assert refreshed_line_2.json()["plan_name"] == "Business 25Go"
    assert refreshed_line_2.json()["monthly_limit"] == 25
