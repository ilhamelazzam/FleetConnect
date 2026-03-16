from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy.exc import OperationalError

from app.api.router import api_router
from app.core.config import get_settings
from app.core.exceptions import register_exception_handlers
from app.core.logging import configure_logging
from app.core.middleware import configure_middlewares
from app.db.session import init_db
from app.services.auth_service import ensure_default_admin
from app.services.plan_service import ensure_default_plans


def create_application() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        if settings.auto_create_tables:
            init_db()
        try:
            ensure_default_admin()
            ensure_default_plans()
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
    return application


app = create_application()
