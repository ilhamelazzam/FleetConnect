from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.logging import get_security_logger, mask_email
from app.core.roles import (
    ADMIN_ROLE,
    ADMIN_CENTER_ROLES,
    MANAGEMENT_ROLES,
    SUPER_ADMIN_ROLE,
    SUPER_ADMIN_ROLES,
    USER_ADMIN_ROLES,
    normalize_role,
)
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
DEFAULT_SUPER_ADMIN_NAME = "Super Administrateur"
DEFAULT_SUPER_ADMIN_EMAIL = "elazzamilham2@gmail.com"
DEFAULT_SUPER_ADMIN_PASSWORD = "Ilham12345678"
ACTIVE_ACCOUNT_STATUS = "active"


def _build_login_error(
    *,
    message: str,
    code: str,
    status_code: int = status.HTTP_401_UNAUTHORIZED,
) -> HTTPException:
    headers = {"WWW-Authenticate": "Bearer"} if status_code == status.HTTP_401_UNAUTHORIZED else None
    return HTTPException(
        status_code=status_code,
        detail={
            "code": code,
            "message": message,
        },
        headers=headers,
    )


def _unauthorized_exception(message: str = "Token manquant ou expire.") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail={
            "error": "UNAUTHORIZED",
            "message": message,
        },
        headers={"WWW-Authenticate": "Bearer"},
    )


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
        account_status = (user.account_status or "").strip().lower()
        detail_message = (
            "Compte en attente de validation par l'administrateur de votre entreprise."
            if account_status == "pending"
            else "Votre demande d'acces a ete refusee. Contactez votre administrateur."
            if account_status == "rejected"
            else "Compte suspendu. Contactez votre administrateur."
        )
        security_logger.warning(
            "event=login_failed ip=%s email=%s reason=%s",
            client_ip or "unknown",
            mask_email(normalized_email),
            (user.account_status or "inactive").strip().lower(),
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=detail_message,
        )

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


def _upsert_bootstrap_user(
    db: Session,
    *,
    full_name: str,
    email: str,
    password: str,
    role: str,
) -> User:
    normalized_email = email.lower().strip()
    normalized_role = normalize_role(role)
    existing_user = db.scalar(select(User).where(User.email == normalized_email))

    if existing_user is None:
        user = User(
            full_name=full_name.strip(),
            email=normalized_email,
            hashed_password=hash_password(password),
            role=normalized_role,
            is_active=True,
            account_status=ACTIVE_ACCOUNT_STATUS,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return user

    needs_update = False

    normalized_full_name = full_name.strip()
    if existing_user.full_name != normalized_full_name:
        existing_user.full_name = normalized_full_name
        needs_update = True

    if normalize_role(existing_user.role) != normalized_role:
        existing_user.role = normalized_role
        needs_update = True

    if not existing_user.is_active:
        existing_user.is_active = True
        needs_update = True

    if (existing_user.account_status or "").strip().lower() != ACTIVE_ACCOUNT_STATUS:
        existing_user.account_status = ACTIVE_ACCOUNT_STATUS
        needs_update = True

    if not verify_password(password, existing_user.hashed_password):
        existing_user.hashed_password = hash_password(password)
        needs_update = True

    if needs_update:
        db.add(existing_user)
        db.commit()
        db.refresh(existing_user)

    return existing_user


def ensure_default_admin() -> None:
    settings = get_settings()
    db = SessionLocal()
    try:
        bootstrap_accounts = [
            {
                "full_name": settings.default_admin_name,
                "email": settings.default_admin_email,
                "password": settings.default_admin_password,
                "role": ADMIN_ROLE,
            },
            {
                "full_name": DEFAULT_SUPER_ADMIN_NAME,
                "email": DEFAULT_SUPER_ADMIN_EMAIL,
                "password": DEFAULT_SUPER_ADMIN_PASSWORD,
                "role": SUPER_ADMIN_ROLE,
            },
        ]

        for account in bootstrap_accounts:
            try:
                _upsert_bootstrap_user(db, **account)
            except IntegrityError:
                db.rollback()
    finally:
        db.close()


def ensure_super_admin_account(
    *,
    full_name: str = DEFAULT_SUPER_ADMIN_NAME,
    email: str = DEFAULT_SUPER_ADMIN_EMAIL,
    password: str = DEFAULT_SUPER_ADMIN_PASSWORD,
) -> User:
    db = SessionLocal()
    try:
        return _upsert_bootstrap_user(
            db,
            full_name=full_name,
            email=email,
            password=password,
            role=SUPER_ADMIN_ROLE,
        )
    finally:
        db.close()


def authenticate_super_admin(
    db: Session,
    email: str,
    password: str,
    *,
    client_ip: str | None = None,
) -> User:
    normalized_email = email.lower().strip()
    user = db.scalar(select(User).where(User.email == normalized_email))

    if user is None:
        security_logger.warning(
            "event=admin_login_failed ip=%s email=%s reason=user_not_found",
            client_ip or "unknown",
            mask_email(normalized_email),
        )
        raise _build_login_error(
            message="Utilisateur inexistant",
            code="USER_NOT_FOUND",
        )

    if not verify_password(password, user.hashed_password):
        security_logger.warning(
            "event=admin_login_failed ip=%s email=%s reason=invalid_password",
            client_ip or "unknown",
            mask_email(normalized_email),
        )
        raise _build_login_error(
            message="Mot de passe incorrect",
            code="INVALID_PASSWORD",
        )

    if not user.is_active:
        account_status = (user.account_status or "").strip().lower()
        detail_message = (
            "Compte en attente de validation par l'administrateur de votre entreprise."
            if account_status == "pending"
            else "Votre demande d'acces a ete refusee. Contactez votre administrateur."
            if account_status == "rejected"
            else "Compte suspendu. Contactez votre administrateur."
        )
        security_logger.warning(
            "event=admin_login_failed ip=%s email=%s reason=%s",
            client_ip or "unknown",
            mask_email(normalized_email),
            (user.account_status or "inactive").strip().lower(),
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=detail_message,
        )

    if normalize_role(user.role) != SUPER_ADMIN_ROLE:
        security_logger.warning(
            "event=admin_login_failed ip=%s email=%s reason=role_not_allowed role=%s",
            client_ip or "unknown",
            mask_email(normalized_email),
            user.role,
        )
        raise _build_login_error(
            message="Acces reserve au Super Administrateur",
            code="SUPER_ADMIN_ONLY",
            status_code=status.HTTP_403_FORBIDDEN,
        )

    user.last_login_at = datetime.now(UTC)
    db.add(user)
    db.commit()
    db.refresh(user)

    security_logger.info(
        "event=admin_login_success ip=%s user_id=%s role=%s",
        client_ip or "unknown",
        user.id,
        user.role,
    )
    return user


def get_current_user(
    request: Request,
    token: Annotated[str | None, Depends(oauth2_scheme)],
    db: Annotated[Session, Depends(get_db_session)],
) -> User:
    credentials_error = _unauthorized_exception()
    authorization_present = bool(request.headers.get("authorization"))

    if not token:
        security_logger.warning(
            "event=token_missing ip=%s path=%s authorization_present=%s",
            request.client.host if request.client else "unknown",
            request.url.path,
            authorization_present,
        )
        raise credentials_error

    try:
        payload = decode_token(token)
        subject = payload.get("sub")
        token_type = payload.get("type")
        if subject is None or token_type != ACCESS_TOKEN_TYPE:
            raise credentials_error
        user_id = int(subject)
    except (JWTError, ValueError) as exc:
        security_logger.warning(
            "event=token_rejected ip=%s path=%s reason=invalid_or_expired_token authorization_present=%s",
            request.client.host if request.client else "unknown",
            request.url.path,
            authorization_present,
        )
        raise credentials_error from exc

    user = db.get(User, user_id)
    if user is None:
        security_logger.warning(
            "event=token_rejected ip=%s path=%s reason=user_not_found authorization_present=%s",
            request.client.host if request.client else "unknown",
            request.url.path,
            authorization_present,
        )
        raise credentials_error

    security_logger.info(
        "event=JWT_VALID user_id=%s path=%s",
        user.id,
        request.url.path,
    )
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


require_admin = _build_role_dependency(*ADMIN_CENTER_ROLES)
require_user_admin = _build_role_dependency(*USER_ADMIN_ROLES)
require_manager_or_admin = _build_role_dependency(*MANAGEMENT_ROLES)
require_super_admin = _build_role_dependency(*SUPER_ADMIN_ROLES)


def create_token_response(user: User) -> TokenResponse:
    settings = get_settings()
    return TokenResponse(
        access_token=create_access_token(str(user.id), user.role, email=user.email),
        refresh_token=create_refresh_token(str(user.id), user.role, email=user.email),
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
    credentials_error = _unauthorized_exception("Refresh token manquant ou expire.")

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
        "event=JWT_REFRESH ip=%s user_id=%s",
        client_ip or "unknown",
        user.id,
    )
    return create_token_response(user)
