from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.core.middleware import configure_middlewares


def create_test_client(settings: Settings) -> TestClient:
    app = FastAPI()
    configure_middlewares(app, settings)

    @app.post("/login")
    def login() -> dict[str, bool]:
        return {"ok": True}

    return TestClient(app)


def test_development_cors_allows_localhost_dev_ports() -> None:
    settings = Settings(
        app_env="development",
        cors_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        trusted_hosts=["testserver", "localhost", "127.0.0.1"],
    )

    with create_test_client(settings) as client:
        response = client.options(
            "/login",
            headers={
                "Origin": "http://localhost:5174",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5174"


def test_development_cors_allows_private_network_dev_origin() -> None:
    settings = Settings(
        app_env="development",
        cors_origins=["http://localhost:5173", "http://192.168.0.131:5173"],
        trusted_hosts=["testserver", "localhost", "127.0.0.1", "192.168.0.131"],
    )

    with create_test_client(settings) as client:
        response = client.options(
            "/login",
            headers={
                "Origin": "http://192.168.0.131:5174",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://192.168.0.131:5174"


def test_production_cors_rejects_unlisted_localhost_port() -> None:
    settings = Settings(
        app_env="production",
        secret_key="production-secret",
        refresh_secret_key="production-refresh-secret",
        cors_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        trusted_hosts=["testserver", "localhost", "127.0.0.1"],
    )

    with create_test_client(settings) as client:
        response = client.options(
            "/login",
            headers={
                "Origin": "http://localhost:5174",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )

    assert response.status_code == 400


def test_security_headers_allow_microphone_and_geolocation_for_self() -> None:
    settings = Settings(
        app_env="development",
        cors_origins=["http://localhost:5173"],
        trusted_hosts=["testserver", "localhost", "127.0.0.1"],
    )

    with create_test_client(settings) as client:
        response = client.post("/login")

    assert response.status_code == 200
    assert response.headers["permissions-policy"] == "camera=(), geolocation=(self), microphone=(self)"
