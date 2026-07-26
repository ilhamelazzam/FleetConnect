from types import SimpleNamespace

from app.schemas.live import LiveMonitoringSnapshotResponse, LiveMonitoringStatusResponse


def _build_status() -> LiveMonitoringStatusResponse:
    return LiveMonitoringStatusResponse(
        monitoring_label="Surveillance IA active...",
        connected_clients=2,
        latest_tick=4,
        latest_tick_at="2026-05-11T09:18:00+00:00",
    )


def _build_snapshot() -> LiveMonitoringSnapshotResponse:
    return LiveMonitoringSnapshotResponse(
        generated_at="2026-05-11T09:18:00+00:00",
        tick=4,
        monitoring_label="Surveillance IA active...",
        executive_summary="Le departement IT concentre la pression live et Maroc Telecom reste sous tension roaming.",
        fleet_health_score=74,
        risk_score=68,
        fraud_score=63,
        optimization_score=71,
        equipment_score=66,
        live_cost_mad=304500.0,
        live_cost_delta_pct=14.7,
        data_consumption_tb=8.4,
        data_delta_pct=19.2,
        roaming_cost_mad=34600.0,
        suspicious_calls=147,
        fraud_exposure_mad=22800.0,
        overage_lines=11,
        inactive_lines=24,
        equipment_alerts=5,
        workflow_critical_count=3,
        operator_anomaly_count=2,
        source_status=["Simulation enterprise active"],
        recommendations=["Verifier le roaming IT"],
        priority_alerts=[],
        recent_alerts=[],
        top_departments=[],
        top_operators=[],
        critical_equipments=[],
        critical_workflows=[],
        cost_series=[],
        risk_series=[],
        alerts_series=[],
        operator_heatmap=[],
    )


def test_live_status_route_returns_payload(client, admin_headers, monkeypatch) -> None:
    async def fake_ensure_started() -> None:
        return None

    monkeypatch.setattr("app.api.routes.live.ensure_live_monitoring_started", fake_ensure_started)
    monkeypatch.setattr("app.api.routes.live.get_live_monitoring_status", _build_status)

    response = client.get("/api/v1/live/status", headers=admin_headers)

    assert response.status_code == 200
    assert response.json()["connected_clients"] == 2
    assert response.json()["monitoring_label"] == "Surveillance IA active..."


def test_live_kpis_route_returns_snapshot(client, admin_headers, monkeypatch) -> None:
    async def fake_ensure_started() -> None:
        return None

    monkeypatch.setattr("app.api.routes.live.ensure_live_monitoring_started", fake_ensure_started)
    monkeypatch.setattr("app.api.routes.live.get_live_monitoring_snapshot", _build_snapshot)

    response = client.get("/api/v1/live/kpis", headers=admin_headers)

    assert response.status_code == 200
    assert response.json()["suspicious_calls"] == 147
    assert response.json()["live_cost_delta_pct"] == 14.7


def test_live_stream_websocket_streams_status_and_snapshot(client, admin_headers, monkeypatch) -> None:
    token = admin_headers["Authorization"].split(" ", 1)[1]
    disconnect_calls: list[str] = []

    monkeypatch.setattr(
        "app.api.routes.live._resolve_websocket_user",
        lambda raw_token: SimpleNamespace(id=1, is_active=True) if raw_token == token else None,
    )
    monkeypatch.setattr("app.api.routes.live.get_live_monitoring_status", _build_status)
    monkeypatch.setattr("app.api.routes.live.get_live_monitoring_snapshot", _build_snapshot)

    async def fake_connect(websocket) -> None:
        await websocket.accept()
        await websocket.send_json({"type": "status", "payload": _build_status().model_dump(mode="json")})
        await websocket.send_json({"type": "snapshot", "payload": _build_snapshot().model_dump(mode="json")})

    async def fake_disconnect(websocket) -> None:
        disconnect_calls.append("disconnected")

    monkeypatch.setattr("app.api.routes.live.connect_live_monitoring_client", fake_connect)
    monkeypatch.setattr("app.api.routes.live.disconnect_live_monitoring_client", fake_disconnect)

    with client.websocket_connect(f"/api/v1/live/stream?token={token}") as websocket:
        first_message = websocket.receive_json()
        second_message = websocket.receive_json()
        websocket.send_text("status")
        third_message = websocket.receive_json()

    assert first_message["type"] == "status"
    assert second_message["type"] == "snapshot"
    assert third_message["type"] == "status"
    assert disconnect_calls == ["disconnected"]
