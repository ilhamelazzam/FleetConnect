# ruff: noqa: E402

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

TEST_DATABASE_PATH = Path(__file__).resolve().parent / "test.db"
os.environ["APP_ENV"] = "test"
os.environ["AUTO_CREATE_TABLES"] = "true"
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DATABASE_PATH.as_posix()}"
os.environ["CORS_ORIGINS"] = "http://localhost:5173,http://127.0.0.1:5173"
os.environ["TRUSTED_HOSTS"] = "testserver,localhost,127.0.0.1"

from app.core.config import get_settings

get_settings.cache_clear()

from app.core.rate_limit import rate_limiter
from app.db.base import Base
from app.db.session import SessionLocal, engine
from app.main import create_application
from app.schemas.user import UserCreate
from app.services.auth_service import ensure_default_admin
from app.services.user_service import create_user


@pytest.fixture(autouse=True)
def reset_database():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    rate_limiter.clear()
    ensure_default_admin()
    yield
    rate_limiter.clear()
    Base.metadata.drop_all(bind=engine)


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
