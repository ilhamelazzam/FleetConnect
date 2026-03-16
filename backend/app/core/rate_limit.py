from collections import defaultdict, deque
from threading import Lock
from time import monotonic

from fastapi import Request

from app.core.config import get_settings
from app.core.exceptions import RateLimitExceededError


class InMemoryRateLimiter:
    def __init__(self) -> None:
        self._entries: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def is_allowed(self, key: str, limit: int, window_seconds: int) -> bool:
        now = monotonic()

        with self._lock:
            timestamps = self._entries[key]
            while timestamps and now - timestamps[0] >= window_seconds:
                timestamps.popleft()

            if len(timestamps) >= limit:
                return False

            timestamps.append(now)
            return True

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()


rate_limiter = InMemoryRateLimiter()


def _get_client_identifier(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()

    return request.client.host if request.client else "unknown"


def auth_rate_limit(request: Request) -> None:
    settings = get_settings()
    key = f"auth:{_get_client_identifier(request)}:{request.url.path}"
    is_allowed = rate_limiter.is_allowed(
        key=key,
        limit=settings.login_rate_limit_attempts,
        window_seconds=settings.login_rate_limit_window_seconds,
    )
    if not is_allowed:
        raise RateLimitExceededError("Too many authentication attempts. Please try again later.")
