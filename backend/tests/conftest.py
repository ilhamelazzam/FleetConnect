# ruff: noqa: E402

import os
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

DEFAULT_TEST_DATABASE_PATH = Path(__file__).resolve().parent / f"test-{uuid4().hex}.db"
TEST_DATABASE_PATH = Path(
    os.environ.get("TEST_DATABASE_PATH", DEFAULT_TEST_DATABASE_PATH.as_posix())
).resolve()
os.environ["APP_ENV"] = "test"
os.environ["AUTO_CREATE_TABLES"] = "true"
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DATABASE_PATH.as_posix()}"
os.environ["FRONTEND_URL"] = "http://localhost:5173"
os.environ["CORS_ORIGINS"] = (
    "http://localhost:5173,"
    "http://localhost:5174,"
    "http://127.0.0.1:5173,"
    "http://127.0.0.1:5174"
)
os.environ["TRUSTED_HOSTS"] = "testserver,localhost,127.0.0.1"

from app.core.config import get_settings

get_settings.cache_clear()

import app.models  # noqa: F401
from app.core.rate_limit import rate_limiter
from app.db.base import Base
from app.db.session import SessionLocal, engine
from app.main import create_application
from app.schemas.user import UserCreate
from app.services.auth_service import ensure_default_admin
from app.services.user_service import create_user


def _reset_test_database_file() -> None:
    engine.dispose()
    if TEST_DATABASE_PATH.exists():
        TEST_DATABASE_PATH.unlink()


@pytest.fixture(autouse=True)
def reset_database():
    _reset_test_database_file()
    Base.metadata.create_all(bind=engine)
    rate_limiter.clear()
    ensure_default_admin()
    yield
    rate_limiter.clear()
    _reset_test_database_file()


@pytest.fixture
def db_session():
    with SessionLocal() as session:
        yield session


@pytest.fixture
def client():
    with TestClient(create_application()) as test_client:
        yield test_client


@pytest.fixture
def admin_headers(client: TestClient) -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/login",
        json={
            "email": "admin@bcskills.ma",
            "password": "Admin123!",
        },
    )
    access_token = response.json()["access_token"]
    return {"Authorization": f"Bearer {access_token}"}


@pytest.fixture
def super_admin_headers(client: TestClient) -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/admin/login",
        json={
            "email": "elazzamilham2@gmail.com",
            "password": "Ilham12345678",
        },
    )
    access_token = response.json()["access_token"]
    return {"Authorization": f"Bearer {access_token}"}


@pytest.fixture
def manager_user(db_session):
    return create_user(
        db_session,
        UserCreate(
            full_name="Manager Test",
            email="manager@test.com",
            password="Manager123!",
            role="manager",
            is_active=True,
        ),
    )


@pytest.fixture
def manager_headers(client: TestClient, manager_user) -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/login",
        json={
            "email": manager_user.email,
            "password": "Manager123!",
        },
    )
    access_token = response.json()["access_token"]
    return {"Authorization": f"Bearer {access_token}"}


@pytest.fixture
def analyst_user(db_session):
    return create_user(
        db_session,
        UserCreate(
            full_name="Analyst Test",
            email="analyst@test.com",
            password="Analyst123!",
            role="analyst",
            is_active=True,
        ),
    )


@pytest.fixture
def analyst_headers(client: TestClient, analyst_user) -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/login",
        json={
            "email": analyst_user.email,
            "password": "Analyst123!",
        },
    )
    access_token = response.json()["access_token"]
    return {"Authorization": f"Bearer {access_token}"}
