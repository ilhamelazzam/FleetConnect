from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI
from sqlalchemy.exc import OperationalError

from app.api.router import api_router
from app.core.config import get_settings
from app.core.exceptions import register_exception_handlers
from app.core.logging import configure_logging
from app.core.middleware import configure_middlewares
from app.db.session import (
    ensure_company_registration_schema_compatibility,
    ensure_notification_schema_compatibility,
    ensure_plan_activation_schema_compatibility,
    ensure_user_invitation_schema_compatibility,
    init_db,
)
from app.services.auth_service import ensure_default_admin
from app.services.fleet_access_service import ensure_default_fleet_access_data
from app.services.health_service import collect_health_status, log_health_status
from app.services.plan_service import ensure_default_plans
from app.services.voice_service import preload_transcription_runtime

APP_LOGGER = logging.getLogger("app.main")


def _log_registered_auth_routes(application: FastAPI, api_prefix: str) -> None:
    auth_routes = sorted(
        route.path
        for route in application.routes
        if route.path.startswith(f"{api_prefix}/auth")
    )
    APP_LOGGER.info("event=AUTH_ROUTE_REGISTERED paths=%s", auth_routes)


def create_application() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        try:
            if settings.auto_create_tables:
                init_db()
            if settings.is_development and not settings.is_sqlite:
                ensure_plan_activation_schema_compatibility()
                ensure_company_registration_schema_compatibility()
                ensure_notification_schema_compatibility()
                ensure_user_invitation_schema_compatibility()
            ensure_default_admin()
            ensure_default_plans()
            ensure_default_fleet_access_data()
            if settings.voice_stt_enabled and settings.voice_stt_preload:
                preload_transcription_runtime()
            log_health_status(await collect_health_status())
        except OperationalError as exc:
            raise RuntimeError(
                "Database is not ready. Apply migrations with `alembic upgrade head`."
            ) from exc
        yield

    application = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        lifespan=lifespan,
    )

    configure_middlewares(application, settings)
    register_exception_handlers(application)

    @application.get("/", tags=["meta"])
    def read_root() -> dict[str, str]:
        return {
            "message": f"{settings.app_name} is running",
            "docs_url": "/docs",
            "api_prefix": settings.api_v1_prefix,
        }

    application.include_router(api_router, prefix=settings.api_v1_prefix)
    _log_registered_auth_routes(application, settings.api_v1_prefix)
    return application


app = create_application()
