from app.schemas.common import (
    HealthCheckResponse,
    HealthChecksResponse,
    HealthResponse,
)


def _build_health_response(status: str = "ok") -> HealthResponse:
    services = HealthChecksResponse(
        root={
            "backend": HealthCheckResponse(
                status="ok",
                message="API FastAPI disponible.",
                details={"api_prefix": "/api/v1"},
            ),
            "postgres": HealthCheckResponse(
                status="ok" if status == "ok" else "error",
                message=(
                    "Base de donnees disponible."
                    if status == "ok"
                    else "Base de donnees inaccessible."
                ),
                details={"dialect": "sqlite"},
            ),
            "ollama_chat": HealthCheckResponse(
                status="ok" if status == "ok" else "degraded",
                message=(
                    "Modele de chat Ollama disponible."
                    if status == "ok"
                    else "Le modele de chat `llama3.2:3b` est absent."
                ),
                details={"base_url": "http://127.0.0.1:11434"},
            ),
            "ollama_vision": HealthCheckResponse(
                status="unavailable",
                message="Vision desactivee.",
                details={"model": "llava"},
            ),
            "cdr_analytics": HealthCheckResponse(
                status="ok",
                message="Source analytique cdr_analytics chargee.",
                details={"rows": 12},
            ),
            "mobile_fleet": HealthCheckResponse(
                status="missing",
                message="La source analytique mobile_fleet n'est pas encore disponible.",
                details={"rows": 0},
            ),
            "websocket": HealthCheckResponse(
                status="ok",
                message="Flux WebSocket disponible.",
                details={"path": "/api/v1/live/stream"},
            ),
        }
    )
    checks = HealthChecksResponse(
        root={
            **services.root,
            "database": services["postgres"],
            "ollama": HealthCheckResponse(
                status="degraded" if status != "ok" else "degraded",
                message="Ollama disponible pour le chat, vision desactivee.",
                details={"base_url": "http://127.0.0.1:11434"},
            ),
            "csv": HealthCheckResponse(
                status="degraded",
                message="Certaines sources CSV optionnelles sont indisponibles.",
                details={"unavailable_sources": ["mobile_fleet"]},
            ),
        }
    )
    return HealthResponse(
        status=status,
        app_name="FleetConnect API",
        environment="test",
        version="0.1.0",
        timestamp="2026-07-16T12:00:00+00:00",
        services=services,
        checks=checks,
    )


def test_health_route_returns_structured_infrastructure_payload(client, monkeypatch) -> None:
    async def fake_collect_health_status() -> HealthResponse:
        return _build_health_response()

    monkeypatch.setattr("app.api.routes.health.collect_health_status", fake_collect_health_status)

    response = client.get("/api/v1/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["services"]["postgres"]["status"] == "ok"
    assert body["services"]["ollama_chat"]["status"] == "ok"
    assert body["services"]["ollama_vision"]["status"] == "unavailable"
    assert body["services"]["websocket"]["details"]["path"] == "/api/v1/live/stream"
    assert body["checks"]["database"]["status"] == "ok"
    assert body["checks"]["csv"]["status"] == "degraded"


def test_health_route_surfaces_degraded_dependencies(client, monkeypatch) -> None:
    async def fake_collect_health_status() -> HealthResponse:
        return _build_health_response(status="degraded")

    monkeypatch.setattr("app.api.routes.health.collect_health_status", fake_collect_health_status)

    response = client.get("/api/v1/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "degraded"
    assert body["services"]["postgres"]["status"] == "error"
    assert body["services"]["ollama_chat"]["status"] == "degraded"
    assert body["checks"]["ollama"]["status"] == "degraded"
