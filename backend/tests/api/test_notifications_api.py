from fastapi.testclient import TestClient


def test_notifications_crud_flow(client: TestClient, admin_headers: dict[str, str]) -> None:
    create_response = client.post(
        "/api/v1/notifications",
        headers=admin_headers,
        json={
            "type": "ai",
            "title": "Depassement data detecte",
            "message": "La ligne 212-600-000 depasse son enveloppe data.",
            "priority": "critical",
            "link_url": "/consommations",
            "ai_recommendation": "Proposer un forfait data superieur.",
            "action_suggeree": "Simuler un changement de forfait.",
            "source_type": "test",
            "source_id": "data-1",
            "source_key": "test:data-1",
        },
    )

    assert create_response.status_code == 201
    created = create_response.json()
    assert created["type"] == "ai"
    assert created["status"] == "unread"
    assert created["ai_recommendation"] == "Proposer un forfait data superieur."

    list_response = client.get("/api/v1/notifications?filter=ai", headers=admin_headers)
    assert list_response.status_code == 200
    list_payload = list_response.json()
    assert list_payload["unread_count"] >= 1
    assert any(item["id"] == created["id"] for item in list_payload["items"])

    unread_response = client.get("/api/v1/notifications/unread", headers=admin_headers)
    assert unread_response.status_code == 200
    assert any(item["id"] == created["id"] for item in unread_response.json())

    read_response = client.put(
        f"/api/v1/notifications/{created['id']}/read",
        headers=admin_headers,
    )
    assert read_response.status_code == 200
    assert read_response.json()["status"] == "read"

    delete_response = client.delete(
        f"/api/v1/notifications/{created['id']}",
        headers=admin_headers,
    )
    assert delete_response.status_code == 204


def test_non_admin_cannot_create_notification_for_other_user(
    client: TestClient,
    manager_headers: dict[str, str],
) -> None:
    response = client.post(
        "/api/v1/notifications",
        headers=manager_headers,
        json={
            "recipient_user_id": 1,
            "type": "info",
            "title": "Notification systeme",
            "message": "Action reservee a l'administrateur.",
            "priority": "medium",
        },
    )

    assert response.status_code == 403
