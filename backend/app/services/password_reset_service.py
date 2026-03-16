import hashlib
import hmac
import secrets

from fastapi import HTTPException, status
from jose import JWTError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.logging import get_security_logger, mask_email
from app.core.security import (
    PASSWORD_RESET_TOKEN_TYPE,
    create_password_reset_token,
    decode_password_reset_token,
)
from app.schemas.auth import ForgotPasswordResponse, MessageResponse
from app.services.email_service import EmailDeliveryError, send_email
from app.services.user_service import get_user_by_email, update_user_password

security_logger = get_security_logger()


def _hash_reset_code(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def _generate_reset_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def send_password_reset_email(*, recipient_email: str, recipient_name: str, code: str) -> None:
    settings = get_settings()
    subject = "Code de reinitialisation de mot de passe"
    expiration_minutes = settings.password_reset_code_expire_minutes
    text_body = (
        f"Bonjour {recipient_name},\n\n"
        f"Votre code de reinitialisation est : {code}\n"
        f"Ce code expire dans {expiration_minutes} minutes.\n\n"
        "Si vous n'avez pas demande cette action, ignorez cet email."
    )
    html_body = f"""
    <html>
      <body style="font-family: Arial, sans-serif; color: #0F172A;">
        <p>Bonjour {recipient_name},</p>
        <p>Votre code de reinitialisation est :</p>
        <p style="font-size: 28px; font-weight: 700; letter-spacing: 6px;">{code}</p>
        <p>Ce code expire dans {expiration_minutes} minutes.</p>
        <p>Si vous n'avez pas demande cette action, ignorez cet email.</p>
      </body>
    </html>
    """
    send_email(
        to_email=recipient_email,
        subject=subject,
        text_body=text_body,
        html_body=html_body,
    )


def request_password_reset(
    db: Session,
    email: str,
    *,
    client_ip: str | None = None,
) -> ForgotPasswordResponse:
    settings = get_settings()
    normalized_email = email.lower().strip()
    reset_code = _generate_reset_code()
    reset_token = create_password_reset_token(normalized_email, _hash_reset_code(reset_code))
    user = get_user_by_email(db, normalized_email)

    if user is not None:
        try:
            send_password_reset_email(
                recipient_email=user.email,
                recipient_name=user.full_name,
                code=reset_code,
            )
        except EmailDeliveryError as exc:
            security_logger.exception(
                "event=password_reset_email_failed ip=%s email=%s",
                client_ip or "unknown",
                mask_email(normalized_email),
            )
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Password reset email could not be sent. Check SMTP credentials.",
            ) from exc

    security_logger.info(
        "event=password_reset_requested ip=%s email=%s user_exists=%s",
        client_ip or "unknown",
        mask_email(normalized_email),
        user is not None,
    )
    return ForgotPasswordResponse(
        message="If an account exists for this email, a verification code has been sent.",
        reset_token=reset_token,
        expires_in_seconds=settings.password_reset_code_expire_minutes * 60,
    )


def verify_password_reset_code(reset_token: str, code: str) -> MessageResponse:
    try:
        payload = decode_password_reset_token(reset_token)
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset code",
        ) from exc

    expected_code_hash = payload.get("code_hash")
    token_type = payload.get("type")
    if (
        token_type != PASSWORD_RESET_TOKEN_TYPE
        or not isinstance(expected_code_hash, str)
        or not hmac.compare_digest(expected_code_hash, _hash_reset_code(code))
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset code",
        )

    return MessageResponse(message="Verification code confirmed.")


def reset_password(db: Session, reset_token: str, code: str, new_password: str) -> MessageResponse:
    verify_password_reset_code(reset_token, code)

    payload = decode_password_reset_token(reset_token)
    email = payload.get("sub")
    if not isinstance(email, str):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired password reset request",
        )

    user = get_user_by_email(db, email)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired password reset request",
        )

    update_user_password(db, user, new_password)
    security_logger.info(
        "event=password_reset_success user_id=%s email=%s",
        user.id,
        mask_email(user.email),
    )
    return MessageResponse(message="Password has been reset successfully.")
