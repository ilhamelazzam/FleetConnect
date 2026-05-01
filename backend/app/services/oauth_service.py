import base64
import json
import secrets
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode

import httpx
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.user import User
from app.schemas.user import UserCreate, UserRead
from app.services.auth_service import create_token_response
from app.services.user_service import create_user, get_user_by_email

GOOGLE_PROVIDER = "google"
MICROSOFT_PROVIDER = "microsoft"
OAUTH_STATE_TOKEN_TYPE = "oauth_state"
OAUTH_STATE_EXPIRE_MINUTES = 10


class OAuthConfigurationError(RuntimeError):
    pass


class OAuthAuthenticationError(RuntimeError):
    pass


def _is_missing_oauth_value(value: str | None) -> bool:
    if value is None:
        return True

    normalized_value = value.strip()
    if not normalized_value:
        return True

    return normalized_value.startswith("your-") or "change-me" in normalized_value


def _frontend_login_error_url(message: str) -> str:
    settings = get_settings()
    return f"{settings.frontend_url.rstrip('/')}/login?{urlencode({'oauth_error': message})}"


def _frontend_callback_success_url(payload: dict[str, object]) -> str:
    settings = get_settings()
    encoded_payload = base64.urlsafe_b64encode(
        json.dumps(payload, separators=(",", ":")).encode("utf-8")
    ).decode("utf-8")
    return f"{settings.frontend_url.rstrip('/')}/auth/callback#payload={encoded_payload}"


def _create_oauth_state(provider: str) -> str:
    settings = get_settings()
    payload = {
        "type": OAUTH_STATE_TOKEN_TYPE,
        "provider": provider,
        "exp": datetime.now(UTC) + timedelta(minutes=OAUTH_STATE_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def _validate_oauth_state(provider: str, state: str) -> None:
    settings = get_settings()
    try:
        payload = jwt.decode(state, settings.secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError as exc:
        raise OAuthAuthenticationError("Etat OAuth invalide ou expire.") from exc

    if payload.get("type") != OAUTH_STATE_TOKEN_TYPE or payload.get("provider") != provider:
        raise OAuthAuthenticationError("Etat OAuth invalide ou expire.")


def _require_provider_settings(provider: str) -> tuple[str, str, str]:
    settings = get_settings()

    if provider == GOOGLE_PROVIDER:
        client_id = settings.google_client_id
        client_secret = settings.google_client_secret
        redirect_uri = settings.google_redirect_uri
        provider_label = "Google"
        tenant_id = None
    else:
        client_id = settings.microsoft_client_id
        client_secret = settings.microsoft_client_secret
        redirect_uri = settings.microsoft_redirect_uri
        provider_label = "Microsoft"
        tenant_id = settings.microsoft_tenant_id

    if (
        _is_missing_oauth_value(client_id)
        or _is_missing_oauth_value(client_secret)
        or _is_missing_oauth_value(redirect_uri)
        or (provider == MICROSOFT_PROVIDER and _is_missing_oauth_value(tenant_id))
    ):
        if provider == GOOGLE_PROVIDER:
            raise OAuthConfigurationError(
                "Google OAuth n'est pas configure. Ajoutez GOOGLE_CLIENT_ID et "
                "GOOGLE_CLIENT_SECRET dans backend/.env, puis autorisez "
                f"{redirect_uri} dans Google Cloud."
            )
        raise OAuthConfigurationError(
            f"{provider_label} OAuth n'est pas configure. Ajoutez MICROSOFT_CLIENT_ID, "
            "MICROSOFT_CLIENT_SECRET, MICROSOFT_REDIRECT_URI et MICROSOFT_TENANT_ID "
            f"dans backend/.env, puis autorisez {redirect_uri} dans Microsoft Entra."
        )

    return client_id, client_secret, redirect_uri


def is_oauth_provider_configured(provider: str) -> bool:
    try:
        _require_provider_settings(provider)
    except OAuthConfigurationError:
        return False

    return True


def get_oauth_login_redirect_url(provider: str) -> str:
    settings = get_settings()
    state = _create_oauth_state(provider)

    if provider == GOOGLE_PROVIDER:
        client_id, _, redirect_uri = _require_provider_settings(provider)
        params = {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": "openid email profile",
            "state": state,
            "prompt": "select_account",
        }
        return f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}"

    client_id, _, redirect_uri = _require_provider_settings(provider)
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid profile email User.Read",
        "state": state,
        "response_mode": "query",
        "prompt": "select_account",
    }
    return (
        f"https://login.microsoftonline.com/{settings.microsoft_tenant_id}"
        f"/oauth2/v2.0/authorize?{urlencode(params)}"
    )


def get_oauth_error_redirect_url(message: str) -> str:
    return _frontend_login_error_url(message)


def _exchange_google_code_for_profile(code: str) -> dict[str, str]:
    client_id, client_secret, redirect_uri = _require_provider_settings(GOOGLE_PROVIDER)

    with httpx.Client(timeout=15.0) as client:
        token_response = client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
        )
        token_response.raise_for_status()
        access_token = token_response.json()["access_token"]

        userinfo_response = client.get(
            "https://openidconnect.googleapis.com/v1/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        userinfo_response.raise_for_status()
        payload = userinfo_response.json()

    email = payload.get("email")
    full_name = payload.get("name") or email
    if not email or not full_name:
        raise OAuthAuthenticationError("Impossible de recuperer le profil Google.")

    return {
        "email": email,
        "full_name": full_name,
    }


def _exchange_microsoft_code_for_profile(code: str) -> dict[str, str]:
    settings = get_settings()
    client_id, client_secret, redirect_uri = _require_provider_settings(MICROSOFT_PROVIDER)

    with httpx.Client(timeout=15.0) as client:
        token_response = client.post(
            f"https://login.microsoftonline.com/{settings.microsoft_tenant_id}/oauth2/v2.0/token",
            data={
                "code": code,
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
        )
        token_response.raise_for_status()
        access_token = token_response.json()["access_token"]

        userinfo_response = client.get(
            "https://graph.microsoft.com/v1.0/me",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        userinfo_response.raise_for_status()
        payload = userinfo_response.json()

    email = payload.get("mail") or payload.get("userPrincipalName")
    full_name = payload.get("displayName") or email
    if not email or not full_name:
        raise OAuthAuthenticationError("Impossible de recuperer le profil Microsoft.")

    return {
        "email": email,
        "full_name": full_name,
    }


def _resolve_oauth_user(db: Session, *, email: str, full_name: str) -> User:
    user = get_user_by_email(db, email)
    if user is not None:
        if not user.is_active:
            raise OAuthAuthenticationError("Ce compte est desactive.")
        return user

    return create_user(
        db,
        UserCreate(
            full_name=full_name,
            email=email,
            password=secrets.token_urlsafe(32),
            role="manager",
            is_active=True,
        ),
    )


def complete_oauth_login(
    db: Session,
    *,
    provider: str,
    code: str | None,
    state: str | None,
    error: str | None,
    error_description: str | None,
) -> str:
    if error:
        provider_label = "Google" if provider == GOOGLE_PROVIDER else "Microsoft"
        description = error_description or error
        raise OAuthAuthenticationError(f"Connexion {provider_label} refusee: {description}")

    if not code or not state:
        raise OAuthAuthenticationError("Reponse OAuth incomplete.")

    _validate_oauth_state(provider, state)

    try:
        if provider == GOOGLE_PROVIDER:
            profile = _exchange_google_code_for_profile(code)
        else:
            profile = _exchange_microsoft_code_for_profile(code)
    except httpx.HTTPError as exc:
        provider_label = "Google" if provider == GOOGLE_PROVIDER else "Microsoft"
        raise OAuthAuthenticationError(
            f"Echec de l'authentification {provider_label}. Verifiez la configuration OAuth."
        ) from exc

    user = _resolve_oauth_user(
        db,
        email=profile["email"],
        full_name=profile["full_name"],
    )
    token_response = create_token_response(user)
    auth_payload = {
        "accessToken": token_response.access_token,
        "refreshToken": token_response.refresh_token,
        "user": UserRead.model_validate(user).model_dump(mode="json"),
    }
    return _frontend_callback_success_url(auth_payload)
