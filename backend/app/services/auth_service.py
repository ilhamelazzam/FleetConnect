from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.logging import get_security_logger, mask_email
from app.core.roles import ADMIN_ROLE, MANAGEMENT_ROLES, normalize_role
from app.core.security import (
    ACCESS_TOKEN_TYPE,
    REFRESH_TOKEN_TYPE,
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    oauth2_scheme,
    verify_password,
)
from app.db.session import SessionLocal, get_db_session
from app.models.user import User
from app.schemas.auth import TokenResponse
from app.schemas.user import UserRead

security_logger = get_security_logger()


def authenticate_user(
    db: Session,
    email: str,
    password: str,
    *,
    client_ip: str | None = None,
) -> User | None:
    normalized_email = email.lower().strip()
    user = db.scalar(select(User).where(User.email == normalized_email))

    if user is None or not verify_password(password, user.hashed_password):
        security_logger.warning(
            "event=login_failed ip=%s email=%s reason=invalid_credentials",
            client_ip or "unknown",
            mask_email(normalized_email),
        )
        return None

    if not user.is_active:
        security_logger.warning(
            "event=login_failed ip=%s email=%s reason=inactive_user",
            client_ip or "unknown",
            mask_email(normalized_email),
        )
        return None

    user.last_login_at = datetime.now(UTC)
    db.add(user)
    db.commit()
    db.refresh(user)

    security_logger.info(
        "event=login_success ip=%s user_id=%s role=%s",
        client_ip or "unknown",
        user.id,
        user.role,
    )
    return user


def ensure_default_admin() -> None:
    settings = get_settings()
    db = SessionLocal()
    try:
        existing_user = db.scalar(
            select(User).where(User.email == settings.default_admin_email.lower().strip())
        )
        if existing_user is not None:
            return

        admin_user = User(
            full_name=settings.default_admin_name,
            email=settings.default_admin_email.lower().strip(),
            hashed_password=hash_password(settings.default_admin_password),
            role=ADMIN_ROLE,
            is_active=True,
        )
        db.add(admin_user)
        db.commit()
    finally:
        db.close()


def get_current_user(
    request: Request,
    token: Annotated[str, Depends(oauth2_scheme)],
    db: Annotated[Session, Depends(get_db_session)],
) -> User:
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = decode_token(token)
        subject = payload.get("sub")
        token_type = payload.get("type")
        if subject is None or token_type != ACCESS_TOKEN_TYPE:
            raise credentials_error
        user_id = int(subject)
    except (JWTError, ValueError) as exc:
        security_logger.warning(
            "event=token_rejected ip=%s path=%s reason=invalid_or_expired_token",
            request.client.host if request.client else "unknown",
            request.url.path,
        )
        raise credentials_error from exc

    user = db.get(User, user_id)
    if user is None:
        security_logger.warning(
            "event=token_rejected ip=%s path=%s reason=user_not_found",
            request.client.host if request.client else "unknown",
            request.url.path,
        )
        raise credentials_error

    return user


def get_current_active_user(current_user: Annotated[User, Depends(get_current_user)]) -> User:
    if not current_user.is_active:
        security_logger.warning(
            "event=inactive_user_denied user_id=%s",
            current_user.id,
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Inactive user",
        )
    return current_user


def _build_role_dependency(*allowed_roles: str):
    def dependency(current_user: Annotated[User, Depends(get_current_active_user)]) -> User:
        current_role = normalize_role(current_user.role)

        if current_role not in allowed_roles:
            required_roles = ",".join(allowed_roles)
            security_logger.warning(
                "event=permission_denied user_id=%s role=%s required=%s",
                current_user.id,
                current_user.role,
                required_roles,
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not allowed to access this resource",
            )

        return current_user

    return dependency


require_admin = _build_role_dependency(ADMIN_ROLE)
require_manager_or_admin = _build_role_dependency(*MANAGEMENT_ROLES)


def create_token_response(user: User) -> TokenResponse:
    settings = get_settings()
    return TokenResponse(
        access_token=create_access_token(str(user.id), user.role),
        refresh_token=create_refresh_token(str(user.id), user.role),
        access_token_expires_in=settings.access_token_expire_minutes * 60,
        refresh_token_expires_in=settings.refresh_token_expire_minutes * 60,
        user=UserRead.model_validate(user),
    )


def refresh_user_tokens(
    db: Session,
    refresh_token: str,
    *,
    client_ip: str | None = None,
) -> TokenResponse:
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not refresh credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = decode_token(refresh_token, refresh=True)
        subject = payload.get("sub")
        token_type = payload.get("type")
        if subject is None or token_type != REFRESH_TOKEN_TYPE:
            raise credentials_error
        user_id = int(subject)
    except (JWTError, ValueError) as exc:
        security_logger.warning(
            "event=refresh_rejected ip=%s reason=invalid_or_expired_refresh_token",
            client_ip or "unknown",
        )
        raise credentials_error from exc

    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise credentials_error

    security_logger.info(
        "event=refresh_success ip=%s user_id=%s",
        client_ip or "unknown",
        user.id,
    )
    return create_token_response(user)
