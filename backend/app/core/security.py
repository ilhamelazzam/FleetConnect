import base64
import hashlib
import hmac
import os
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi.security import OAuth2PasswordBearer
from jose import jwt

from app.core.config import get_settings

ACCESS_TOKEN_TYPE = "access"
REFRESH_TOKEN_TYPE = "refresh"
PASSWORD_RESET_TOKEN_TYPE = "password_reset"
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/token")


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    derived_key = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1)
    return f"{base64.b64encode(salt).decode()}${base64.b64encode(derived_key).decode()}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        salt_encoded, hash_encoded = stored_hash.split("$", maxsplit=1)
    except ValueError:
        return False

    salt = base64.b64decode(salt_encoded)
    expected_hash = base64.b64decode(hash_encoded)
    current_hash = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1)
    return hmac.compare_digest(current_hash, expected_hash)


def _create_token(
    *,
    subject: str,
    token_type: str,
    expires_minutes: int,
    secret_key: str,
    additional_claims: dict[str, Any] | None = None,
) -> str:
    settings = get_settings()
    expires_at = datetime.now(UTC) + timedelta(minutes=expires_minutes)
    payload: dict[str, Any] = {
        "sub": subject,
        "type": token_type,
        "exp": expires_at,
    }
    if additional_claims:
        payload.update(additional_claims)

    return jwt.encode(payload, secret_key, algorithm=settings.jwt_algorithm)


def create_access_token(subject: str, role: str) -> str:
    settings = get_settings()
    return _create_token(
        subject=subject,
        token_type=ACCESS_TOKEN_TYPE,
        expires_minutes=settings.access_token_expire_minutes,
        secret_key=settings.secret_key,
        additional_claims={"role": role},
    )


def create_refresh_token(subject: str, role: str) -> str:
    settings = get_settings()
    return _create_token(
        subject=subject,
        token_type=REFRESH_TOKEN_TYPE,
        expires_minutes=settings.refresh_token_expire_minutes,
        secret_key=settings.effective_refresh_secret_key,
        additional_claims={"role": role},
    )


def create_password_reset_token(subject: str, code_hash: str) -> str:
    settings = get_settings()
    return _create_token(
        subject=subject,
        token_type=PASSWORD_RESET_TOKEN_TYPE,
        expires_minutes=settings.password_reset_code_expire_minutes,
        secret_key=settings.effective_password_reset_secret_key,
        additional_claims={"code_hash": code_hash},
    )


def decode_token(token: str, *, refresh: bool = False) -> dict[str, Any]:
    settings = get_settings()
    secret_key = settings.effective_refresh_secret_key if refresh else settings.secret_key
    return jwt.decode(token, secret_key, algorithms=[settings.jwt_algorithm])


def decode_password_reset_token(token: str) -> dict[str, Any]:
    settings = get_settings()
    return jwt.decode(
        token,
        settings.effective_password_reset_secret_key,
        algorithms=[settings.jwt_algorithm],
    )
