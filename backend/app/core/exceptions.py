import logging
import traceback

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from app.core.config import get_settings

logger = logging.getLogger("app.api")


class RateLimitExceededError(Exception):
    def __init__(self, detail: str = "Too many requests. Please try again later.") -> None:
        self.detail = detail
        super().__init__(detail)


def _extract_exception_origin(exc: Exception) -> tuple[str | None, str | None, int | None]:
    frames = traceback.extract_tb(exc.__traceback__)
    if not frames:
        return None, None, None

    app_frames = [
        frame
        for frame in frames
        if "\\app\\" in frame.filename or "/app/" in frame.filename
    ]
    target_frame = app_frames[-1] if app_frames else frames[-1]
    return target_frame.filename, target_frame.name, target_frame.lineno


def _build_error_response(
    *,
    status_code: int,
    code: str,
    message: str,
    details: object | None = None,
    legacy_detail: object | None = None,
    extra_fields: dict[str, object] | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    payload: dict[str, object] = {
        "success": False,
        "message": message,
        "code": code,
        "details": details if isinstance(details, dict) else {},
    }
    if legacy_detail is not None:
        payload["detail"] = legacy_detail
    if extra_fields:
        payload.update(extra_fields)
    return JSONResponse(status_code=status_code, content=payload, headers=headers)


def _status_code_to_error_code(status_code: int) -> str:
    return {
        400: "BAD_REQUEST",
        401: "UNAUTHORIZED",
        403: "FORBIDDEN",
        404: "NOT_FOUND",
        409: "CONFLICT",
        410: "GONE",
        422: "VALIDATION_ERROR",
        429: "RATE_LIMIT_EXCEEDED",
    }.get(status_code, "HTTP_ERROR")


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
        return _build_error_response(
            status_code=429,
            code="RATE_LIMIT_EXCEEDED",
            message=exc.detail,
            legacy_detail=exc.detail,
        )

    @app.exception_handler(HTTPException)
    async def handle_http_exception(request: Request, exc: HTTPException) -> JSONResponse:
        if exc.status_code == 401:
            logger.warning(
                "event=http_unauthorized path=%s method=%s authorization_present=%s",
                request.url.path,
                request.method,
                bool(request.headers.get("authorization")),
            )
        else:
            logger.info(
                "event=http_exception path=%s method=%s status=%s",
                request.url.path,
                request.method,
                exc.status_code,
            )

        if isinstance(exc.detail, dict):
            detail_code = exc.detail.get("code")
            detail_message = exc.detail.get("message")
            if isinstance(detail_code, str) and isinstance(detail_message, str):
                extra_fields: dict[str, object] = {}
                if exc.status_code == 401:
                    extra_fields["error"] = exc.detail.get("error") or detail_code
                return _build_error_response(
                    status_code=exc.status_code,
                    code=detail_code,
                    message=detail_message,
                    details={key: value for key, value in exc.detail.items() if key not in {"code", "message"}},
                    legacy_detail=exc.detail,
                    extra_fields=extra_fields,
                    headers=exc.headers,
                )

            if (
                exc.status_code == 401
                and isinstance(exc.detail.get("error"), str)
                and isinstance(exc.detail.get("message"), str)
            ):
                return _build_error_response(
                    status_code=exc.status_code,
                    code=str(exc.detail["error"]),
                    message=str(exc.detail["message"]),
                    legacy_detail=exc.detail,
                    extra_fields={"error": exc.detail["error"]},
                    headers=exc.headers,
                )

        if isinstance(exc.detail, str):
            return _build_error_response(
                status_code=exc.status_code,
                code=_status_code_to_error_code(exc.status_code),
                message=exc.detail,
                legacy_detail=exc.detail,
                headers=exc.headers,
            )

        return _build_error_response(
            status_code=exc.status_code,
            code=_status_code_to_error_code(exc.status_code),
            message="Une erreur HTTP est survenue.",
            details=exc.detail if isinstance(exc.detail, dict) else {},
            legacy_detail=exc.detail,
            headers=exc.headers,
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
        logger.exception(
            "event=unhandled_exception path=%s method=%s",
            request.url.path,
            request.method,
        )
        settings = get_settings()
        if settings.is_development:
            filename, function_name, line_number = _extract_exception_origin(exc)
            return _build_error_response(
                status_code=500,
                code="INTERNAL_SERVER_ERROR",
                message=str(exc) or repr(exc),
                details={
                    "exception_type": type(exc).__name__,
                    "file": filename,
                    "function": function_name,
                    "line": line_number,
                },
                extra_fields={
                    "error": type(exc).__name__,
                },
            )

        return _build_error_response(
            status_code=500,
            code="INTERNAL_SERVER_ERROR",
            message="Internal server error",
            legacy_detail="Internal server error",
        )
