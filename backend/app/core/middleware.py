import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.httpsredirect import HTTPSRedirectMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.core.config import Settings

MIDDLEWARE_LOGGER = logging.getLogger("app.middleware")


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: FastAPI, include_hsts: bool) -> None:
        super().__init__(app)
        self.include_hsts = include_hsts

    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault(
            "Permissions-Policy",
            "camera=(), geolocation=(self), microphone=(self)",
        )

        if self.include_hsts:
            response.headers.setdefault(
                "Strict-Transport-Security",
                "max-age=31536000; includeSubDomains",
            )

        return response


def configure_middlewares(app: FastAPI, settings: Settings) -> None:
    MIDDLEWARE_LOGGER.info(
        "event=CORS_ALLOWED_ORIGINS origins=%s allow_origin_regex=%s allow_credentials=%s allow_methods=%s allow_headers=%s",
        settings.cors_origins,
        settings.cors_allow_origin_regex,
        True,
        ["*"],
        ["*"],
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_origin_regex=settings.cors_allow_origin_regex,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    if settings.trusted_hosts:
        app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.trusted_hosts)

    if settings.https_redirect:
        app.add_middleware(HTTPSRedirectMiddleware)

    if settings.security_headers_enabled:
        app.add_middleware(
            SecurityHeadersMiddleware,
            include_hsts=settings.https_redirect or settings.app_env.lower() == "production",
        )
