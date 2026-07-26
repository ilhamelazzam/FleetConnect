import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.responses import RedirectResponse

from app.core.roles import ADMIN_ROLE, PUBLIC_REGISTRATION_ROLES
from app.core.dependencies import CurrentActiveUser, DbSession
from app.core.rate_limit import auth_rate_limit
from app.core.logging import mask_email
from app.schemas.auth import (
    ForgotPasswordRequest,
    ForgotPasswordResponse,
    LoginRequest,
    MessageResponse,
    OAuthProviderStatus,
    OAuthProvidersResponse,
    RefreshTokenRequest,
    RegisterRequest,
    ResetPasswordRequest,
    TokenResponse,
    VerifyResetCodeRequest,
)
from app.schemas.user import UserCreate, UserRead
from app.services.auth_service import (
    authenticate_super_admin,
    authenticate_user,
    create_token_response,
    refresh_user_tokens,
)
from app.services.oauth_service import (
    GOOGLE_PROVIDER,
    MICROSOFT_PROVIDER,
    OAuthAuthenticationError,
    OAuthConfigurationError,
    complete_oauth_login,
    get_oauth_error_redirect_url,
    get_oauth_login_redirect_url,
    is_oauth_provider_configured,
)
from app.services.password_reset_service import (
    request_password_reset,
    reset_password,
    verify_password_reset_code,
)
from app.services.user_service import create_user, get_user_by_email

router = APIRouter(tags=["auth"])
AUTH_LOGGER = logging.getLogger("app.auth")


def apply_no_store_headers(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"


@router.post("/login", response_model=TokenResponse)
def login(
    payload: LoginRequest,
    response: Response,
    request: Request,
    db: DbSession,
    _: Annotated[None, Depends(auth_rate_limit)],
) -> TokenResponse:
    AUTH_LOGGER.info(
        "event=LOGIN_REQUEST_RECEIVED email=%s client_ip=%s",
        mask_email(str(payload.email)),
        request.client.host if request.client else None,
    )
    user = authenticate_user(
        db,
        str(payload.email),
        payload.password,
        client_ip=request.client.host if request.client else None,
    )
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    apply_no_store_headers(response)
    return create_token_response(user)


@router.post("/admin/login", response_model=TokenResponse)
def admin_login(
    payload: LoginRequest,
    response: Response,
    request: Request,
    db: DbSession,
    _: Annotated[None, Depends(auth_rate_limit)],
) -> TokenResponse:
    AUTH_LOGGER.info(
        "event=ADMIN_LOGIN_REQUEST_RECEIVED email=%s client_ip=%s",
        mask_email(str(payload.email)),
        request.client.host if request.client else None,
    )
    user = authenticate_super_admin(
        db,
        str(payload.email),
        payload.password,
        client_ip=request.client.host if request.client else None,
    )

    apply_no_store_headers(response)
    return create_token_response(user)


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(
    payload: RegisterRequest,
    response: Response,
    request: Request,
    db: DbSession,
    _: Annotated[None, Depends(auth_rate_limit)],
) -> TokenResponse:
    existing_user = get_user_by_email(db, str(payload.email))
    if existing_user is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email already exists",
        )

    if payload.role not in PUBLIC_REGISTRATION_ROLES:
        detail = (
            "Administrator role can only be assigned by an existing administrator"
            if payload.role == ADMIN_ROLE
            else "This role cannot be assigned through public registration"
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=detail,
        )

    user = create_user(
        db,
        UserCreate(
            full_name=payload.full_name.strip(),
            email=payload.email,
            password=payload.password,
            photo_url=payload.photo_url,
            role=payload.role,
            is_active=True,
        ),
    )

    apply_no_store_headers(response)
    return create_token_response(user)


@router.post("/forgot-password", response_model=ForgotPasswordResponse)
def forgot_password(
    payload: ForgotPasswordRequest,
    response: Response,
    request: Request,
    db: DbSession,
    _: Annotated[None, Depends(auth_rate_limit)],
) -> ForgotPasswordResponse:
    apply_no_store_headers(response)
    return request_password_reset(
        db,
        str(payload.email),
        client_ip=request.client.host if request.client else None,
    )


@router.post("/verify-reset-code", response_model=MessageResponse)
def verify_reset_code(
    payload: VerifyResetCodeRequest,
    response: Response,
    _: Annotated[None, Depends(auth_rate_limit)],
) -> MessageResponse:
    apply_no_store_headers(response)
    return verify_password_reset_code(payload.reset_token, payload.code)


@router.post("/reset-password", response_model=MessageResponse)
def reset_user_password(
    payload: ResetPasswordRequest,
    response: Response,
    db: DbSession,
    _: Annotated[None, Depends(auth_rate_limit)],
) -> MessageResponse:
    apply_no_store_headers(response)
    return reset_password(db, payload.reset_token, payload.code, payload.new_password)


@router.get("/oauth/providers", response_model=OAuthProvidersResponse)
def read_oauth_providers(response: Response) -> OAuthProvidersResponse:
    google_configured = is_oauth_provider_configured(GOOGLE_PROVIDER)
    microsoft_configured = is_oauth_provider_configured(MICROSOFT_PROVIDER)
    AUTH_LOGGER.info(
        "event=OAUTH_PROVIDER_REQUEST google_configured=%s microsoft_configured=%s",
        google_configured,
        microsoft_configured,
    )
    apply_no_store_headers(response)
    return OAuthProvidersResponse(
        google=OAuthProviderStatus(configured=google_configured),
        microsoft=OAuthProviderStatus(configured=microsoft_configured),
    )


@router.get("/google/login", include_in_schema=False)
def login_with_google() -> RedirectResponse:
    try:
        return RedirectResponse(get_oauth_login_redirect_url(GOOGLE_PROVIDER), status_code=302)
    except OAuthConfigurationError as exc:
        return RedirectResponse(get_oauth_error_redirect_url(str(exc)), status_code=302)


@router.get("/google/callback", include_in_schema=False)
def google_callback(
    db: DbSession,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    error_description: str | None = None,
) -> RedirectResponse:
    try:
        redirect_url = complete_oauth_login(
            db,
            provider=GOOGLE_PROVIDER,
            code=code,
            state=state,
            error=error,
            error_description=error_description,
        )
    except (OAuthAuthenticationError, OAuthConfigurationError) as exc:
        redirect_url = get_oauth_error_redirect_url(str(exc))

    return RedirectResponse(redirect_url, status_code=302)


@router.get("/microsoft/login", include_in_schema=False)
def login_with_microsoft() -> RedirectResponse:
    try:
        return RedirectResponse(get_oauth_login_redirect_url(MICROSOFT_PROVIDER), status_code=302)
    except OAuthConfigurationError as exc:
        return RedirectResponse(get_oauth_error_redirect_url(str(exc)), status_code=302)


@router.get("/microsoft/callback", include_in_schema=False)
def microsoft_callback(
    db: DbSession,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    error_description: str | None = None,
) -> RedirectResponse:
    try:
        redirect_url = complete_oauth_login(
            db,
            provider=MICROSOFT_PROVIDER,
            code=code,
            state=state,
            error=error,
            error_description=error_description,
        )
    except (OAuthAuthenticationError, OAuthConfigurationError) as exc:
        redirect_url = get_oauth_error_redirect_url(str(exc))

    return RedirectResponse(redirect_url, status_code=302)


@router.post("/token", response_model=TokenResponse)
def issue_oauth_token(
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    response: Response,
    request: Request,
    db: DbSession,
    _: Annotated[None, Depends(auth_rate_limit)],
) -> TokenResponse:
    user = authenticate_user(
        db,
        form_data.username,
        form_data.password,
        client_ip=request.client.host if request.client else None,
    )
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    apply_no_store_headers(response)
    return create_token_response(user)


@router.post("/refresh", response_model=TokenResponse)
def refresh_access_token(
    payload: RefreshTokenRequest,
    response: Response,
    request: Request,
    db: DbSession,
    _: Annotated[None, Depends(auth_rate_limit)],
) -> TokenResponse:
    apply_no_store_headers(response)
    return refresh_user_tokens(
        db,
        payload.refresh_token,
        client_ip=request.client.host if request.client else None,
    )


@router.get("/me", response_model=UserRead)
def read_me(current_user: CurrentActiveUser) -> UserRead:
    return UserRead.model_validate(current_user)
