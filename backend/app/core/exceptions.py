import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

logger = logging.getLogger("app.api")


class RateLimitExceededError(Exception):
    def __init__(self, detail: str = "Too many requests. Please try again later.") -> None:
        self.detail = detail
        super().__init__(detail)


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(RateLimitExceededError)
    async def handle_rate_limit(
        request: Request,
        exc: RateLimitExceededError,
    ) -> JSONResponse:
        logger.warning(
            "event=rate_limit_exceeded path=%s method=%s",
            request.url.path,
            request.method,
        )
        return JSONResponse(status_code=429, content={"detail": exc.detail})

    @app.exception_handler(Exception)
    async def handle_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
        logger.exception(
            "event=unhandled_exception path=%s method=%s",
            request.url.path,
            request.method,
        )
        return JSONResponse(status_code=500, content={"detail": "Internal server error"})
