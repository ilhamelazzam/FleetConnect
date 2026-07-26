from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
import logging
import re
import secrets

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.core.config import get_settings
from app.core.roles import normalize_role
from app.core.security import hash_password
from app.models.company import Company
from app.models.fleet_access import Department
from app.models.user import User
from app.models.user_invitation import UserInvitation
from app.schemas.invitation import (
    AcceptInvitationRequest,
    InvitationExpiration,
    InvitationStatus,
    InvitationValidationResponse,
    UserInvitationCreateRequest,
    UserInvitationRead,
)
from app.services.email_service import EmailDeliveryError, send_email
from app.services.notification_service import enqueue_notification

INVITATION_LOGGER = logging.getLogger("app.invitation")
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PASSWORD_POLICY_PATTERN = re.compile(r"^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,128}$")
PENDING_STATUS = "pending"
ACCEPTED_STATUS = "accepted"
CANCELLED_STATUS = "cancelled"
DEFAULT_INVITED_ROLE = "user"
EXPIRATION_DAY_OPTIONS: dict[InvitationExpiration, int] = {
    "7_days": 7,
    "14_days": 14,
    "30_days": 30,
}


@dataclass(slots=True)
class InvitationDeliveryResult:
    invitation: UserInvitation
    response_code: str
    status_code: int
    message: str
    email_sent: bool


@dataclass(slots=True)
class AcceptedInvitationResult:
    user: User
    invitation: UserInvitation


def _build_invitation_query():
    return select(UserInvitation).options(
        selectinload(UserInvitation.company),
        selectinload(UserInvitation.created_by),
    )


def _raise_invitation_exception(
    status_code: int,
    *,
    code: str,
    message: str,
) -> None:
    raise HTTPException(
        status_code=status_code,
        detail={
            "code": code,
            "message": message,
        },
    )


def _normalize_phone(phone: str | None) -> str | None:
    if phone is None:
        return None
    normalized = phone.strip()
    return normalized or None


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _validate_email(email: str) -> str:
    normalized_email = _normalize_email(email)
    if not EMAIL_PATTERN.match(normalized_email):
        _raise_invitation_exception(
            status.HTTP_400_BAD_REQUEST,
            code="INVITATION_INVALID_EMAIL",
            message="Email professionnel invalide.",
        )
    return normalized_email


def _compute_expiration(expiration: InvitationExpiration) -> datetime:
    return datetime.now(UTC) + timedelta(days=EXPIRATION_DAY_OPTIONS[expiration])


def _coerce_utc_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _infer_expiration_days(invitation: UserInvitation) -> int:
    delta = _coerce_utc_datetime(invitation.expires_at) - _coerce_utc_datetime(invitation.created_at)
    inferred_days = max(1, round(delta.total_seconds() / 86_400))
    if inferred_days in {7, 14, 30}:
        return inferred_days
    return 7


def _effective_status(invitation: UserInvitation, *, now: datetime | None = None) -> InvitationStatus:
    current_time = _coerce_utc_datetime(now or datetime.now(UTC))
    normalized_status = (invitation.status or "").strip().lower()
    if normalized_status == ACCEPTED_STATUS:
        return "accepted"
    if normalized_status == CANCELLED_STATUS:
        return "cancelled"
    if _coerce_utc_datetime(invitation.expires_at) <= current_time:
        return "expired"
    return "pending"


def _build_invitation_url(token: str) -> str:
    settings = get_settings()
    return f"{settings.frontend_url.rstrip('/')}/register?token={token}"


def _generate_unique_invitation_token(db: Session) -> str:
    while True:
        candidate = secrets.token_urlsafe(32)
        existing_invitation = db.scalar(
            select(UserInvitation.id).where(UserInvitation.token == candidate)
        )
        if existing_invitation is None:
            return candidate


def serialize_user_invitation(invitation: UserInvitation) -> UserInvitationRead:
    return UserInvitationRead(
        id=invitation.id,
        full_name=invitation.full_name,
        email=invitation.email,
        phone=invitation.phone,
        department=invitation.department,
        job_title=invitation.job_title,
        role=normalize_role(invitation.role),
        status=_effective_status(invitation),
        expiration_date=_coerce_utc_datetime(invitation.expires_at),
        created_at=_coerce_utc_datetime(invitation.created_at),
        sent_at=_coerce_utc_datetime(invitation.sent_at) if invitation.sent_at else None,
        created_by_id=invitation.created_by_id,
        created_by_name=invitation.created_by.full_name if invitation.created_by else None,
        invitation_url=_build_invitation_url(invitation.token),
    )


def _ensure_company_is_active(company: Company | None) -> Company:
    if company is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Entreprise introuvable.",
        )
    if (company.status or "").strip().lower() != "active":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="L'entreprise associee a cette invitation n'est pas active.",
        )
    return company


def _read_user_invitation_for_company(
    db: Session,
    invitation_id: int,
    *,
    company_id: int,
) -> UserInvitation:
    invitation = db.scalar(
        _build_invitation_query().where(
            UserInvitation.id == invitation_id,
            UserInvitation.company_id == company_id,
        )
    )
    if invitation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invitation introuvable.",
        )
    return invitation


def _read_invitation_by_token(db: Session, token: str) -> UserInvitation:
    invitation = db.scalar(_build_invitation_query().where(UserInvitation.token == token.strip()))
    if invitation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invitation introuvable ou invalide.",
        )
    return invitation


def _ensure_password_is_valid(password: str) -> None:
    if not PASSWORD_POLICY_PATTERN.match(password):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                "Le mot de passe doit contenir au moins 8 caracteres, "
                "une majuscule, une minuscule et un chiffre."
            ),
        )


def _read_user_by_email(db: Session, email: str) -> User | None:
    return db.scalar(select(User).where(User.email == _normalize_email(email)))


def _match_department(db: Session, requested_department: str) -> Department | None:
    normalized_value = requested_department.strip().lower()
    if not normalized_value:
        return None

    return db.scalar(
        select(Department).where(func.lower(Department.name) == normalized_value)
    ) or db.scalar(
        select(Department).where(func.lower(Department.code) == normalized_value)
    )


def _cancel_duplicate_pending_invitations(
    db: Session,
    *,
    company_id: int,
    email: str,
    exclude_invitation_id: int | None = None,
) -> None:
    duplicates = db.scalars(
        _build_invitation_query().where(
            UserInvitation.company_id == company_id,
            func.lower(UserInvitation.email) == email.lower().strip(),
        )
    )
    for invitation in duplicates:
        if exclude_invitation_id is not None and invitation.id == exclude_invitation_id:
            continue
        if _effective_status(invitation) == "pending":
            invitation.status = CANCELLED_STATUS
            db.add(invitation)


def _cancel_other_pending_invitations_for_email(
    db: Session,
    *,
    email: str,
    exclude_invitation_id: int,
) -> None:
    pending_invitations = db.scalars(
        _build_invitation_query().where(
            func.lower(UserInvitation.email) == _normalize_email(email),
            UserInvitation.id != exclude_invitation_id,
        )
    )
    for invitation in pending_invitations:
        if _effective_status(invitation) == "pending":
            invitation.status = CANCELLED_STATUS
            db.add(invitation)


def _find_latest_invitation_for_email(
    db: Session,
    *,
    company_id: int,
    email: str,
) -> UserInvitation | None:
    return db.scalar(
        _build_invitation_query()
        .where(
            UserInvitation.company_id == company_id,
            func.lower(UserInvitation.email) == _normalize_email(email),
        )
        .order_by(UserInvitation.created_at.desc(), UserInvitation.id.desc())
    )


def _resolve_create_invitation_conflict(
    db: Session,
    *,
    company: Company,
    normalized_email: str,
) -> InvitationDeliveryResult:
    refreshed_user = _read_user_by_email(db, normalized_email)
    if refreshed_user is not None:
        if refreshed_user.company_id == company.id and refreshed_user.is_active:
            _raise_invitation_exception(
                status.HTTP_409_CONFLICT,
                code="INVITATION_ALREADY_MEMBER",
                message="Cet utilisateur appartient deja a votre entreprise.",
            )
        if refreshed_user.company_id is not None and refreshed_user.company_id != company.id:
            _raise_invitation_exception(
                status.HTTP_403_FORBIDDEN,
                code="INVITATION_OTHER_ORGANIZATION",
                message="Cet utilisateur appartient deja a une autre organisation.",
            )

    latest_invitation = _find_latest_invitation_for_email(
        db,
        company_id=company.id,
        email=normalized_email,
    )
    if latest_invitation is not None and _effective_status(latest_invitation) == "pending":
        return InvitationDeliveryResult(
            invitation=latest_invitation,
            response_code="INVITATION_ALREADY_SENT",
            status_code=status.HTTP_200_OK,
            message="Une invitation est deja en attente pour cet utilisateur.",
            email_sent=False,
        )

    _raise_invitation_exception(
        status.HTTP_409_CONFLICT,
        code="INVITATION_CONFLICT",
        message="Un conflit a ete detecte lors de la preparation de l'invitation. Reessayez.",
    )


def _apply_invitation_payload(
    db: Session,
    invitation: UserInvitation,
    *,
    current_admin: User,
    payload: UserInvitationCreateRequest,
    normalized_email: str,
) -> UserInvitation:
    invitation.email = normalized_email
    invitation.full_name = payload.full_name.strip()
    invitation.phone = _normalize_phone(payload.phone)
    invitation.department = payload.department.strip()
    invitation.job_title = payload.job_title.strip()
    invitation.role = DEFAULT_INVITED_ROLE
    invitation.token = _generate_unique_invitation_token(db)
    invitation.status = PENDING_STATUS
    invitation.expires_at = _compute_expiration(payload.expiration)
    invitation.created_by_id = current_admin.id
    invitation.sent_at = None
    invitation.accepted_at = None
    return invitation


def _record_invitation_sent(db: Session, invitation: UserInvitation) -> None:
    invitation.sent_at = datetime.now(UTC)
    db.add(invitation)
    db.commit()
    db.refresh(invitation)


def _send_invitation_email(invitation: UserInvitation, *, company_name: str) -> bool:
    invitation_url = _build_invitation_url(invitation.token)
    expiration_label = _coerce_utc_datetime(invitation.expires_at).strftime("%d/%m/%Y a %H:%M UTC")

    text_body = (
        f"Bonjour {invitation.full_name},\n\n"
        f"Vous etes invite(e) a rejoindre {company_name} sur FleetConnect IA.\n"
        f"Accedez a votre formulaire securise ici : {invitation_url}\n\n"
        f"Cette invitation expire le {expiration_label}.\n"
        "Si vous n'etes pas concerne(e), vous pouvez ignorer cet email."
    )
    html_body = f"""
    <html>
      <body style="font-family: Arial, sans-serif; color: #0F172A;">
        <p>Bonjour {invitation.full_name},</p>
        <p>Vous etes invite(e) a rejoindre <strong>{company_name}</strong> sur FleetConnect IA.</p>
        <p>
          <a
            href="{invitation_url}"
            style="display: inline-block; padding: 12px 20px; border-radius: 12px; background: #2563EB; color: #FFFFFF; text-decoration: none; font-weight: 600;"
          >
            Finaliser mon inscription
          </a>
        </p>
        <p>Cette invitation expire le <strong>{expiration_label}</strong>.</p>
        <p>Si vous n'etes pas concerne(e), vous pouvez ignorer cet email.</p>
      </body>
    </html>
    """

    try:
        send_email(
            to_email=invitation.email,
            subject=f"Invitation a rejoindre {company_name} sur FleetConnect IA",
            text_body=text_body,
            html_body=html_body,
        )
        return True
    except EmailDeliveryError:
        INVITATION_LOGGER.exception(
            "event=user_invitation_email_failed invitation_id=%s email=%s",
            invitation.id,
            invitation.email,
        )
        return False


def list_user_invitations(db: Session, *, company_id: int) -> list[UserInvitation]:
    return list(
        db.scalars(
            _build_invitation_query()
            .where(UserInvitation.company_id == company_id)
            .order_by(UserInvitation.created_at.desc(), UserInvitation.id.desc())
        )
    )


def create_user_invitation(
    db: Session,
    *,
    current_admin: User,
    payload: UserInvitationCreateRequest,
) -> InvitationDeliveryResult:
    company = _ensure_company_is_active(db.get(Company, current_admin.company_id))
    normalized_email = _validate_email(payload.email)
    existing_user = _read_user_by_email(db, normalized_email)

    if existing_user is not None:
        if existing_user.company_id == company.id and existing_user.is_active:
            _raise_invitation_exception(
                status.HTTP_409_CONFLICT,
                code="INVITATION_ALREADY_MEMBER",
                message="Cet utilisateur appartient deja a votre entreprise.",
            )
        if existing_user.company_id is not None and existing_user.company_id != company.id:
            _raise_invitation_exception(
                status.HTTP_403_FORBIDDEN,
                code="INVITATION_OTHER_ORGANIZATION",
                message="Cet utilisateur appartient deja a une autre organisation.",
            )

    existing_invitation = _find_latest_invitation_for_email(
        db,
        company_id=company.id,
        email=normalized_email,
    )
    if existing_invitation is not None:
        effective_status = _effective_status(existing_invitation)
        if effective_status == "pending":
            return InvitationDeliveryResult(
                invitation=existing_invitation,
                response_code="INVITATION_ALREADY_SENT",
                status_code=status.HTTP_200_OK,
                message="Une invitation est deja en attente pour cet utilisateur.",
                email_sent=False,
            )

        if effective_status in {"cancelled", "expired"}:
            invitation = _apply_invitation_payload(
                db,
                existing_invitation,
                current_admin=current_admin,
                payload=payload,
                normalized_email=normalized_email,
            )
            db.add(invitation)
            try:
                db.commit()
            except IntegrityError:
                db.rollback()
                return _resolve_create_invitation_conflict(
                    db,
                    company=company,
                    normalized_email=normalized_email,
                )
            db.refresh(invitation)

            email_sent = _send_invitation_email(invitation, company_name=company.name)
            if email_sent:
                _record_invitation_sent(db, invitation)
            INVITATION_LOGGER.info(
                "event=user_invitation_reactivated invitation_id=%s company_id=%s actor_user_id=%s email_sent=%s",
                invitation.id,
                invitation.company_id,
                current_admin.id,
                email_sent,
            )
            return InvitationDeliveryResult(
                invitation=_read_user_invitation_for_company(
                    db,
                    invitation.id,
                    company_id=company.id,
                ),
                response_code="INVITATION_RESENT",
                status_code=status.HTTP_200_OK,
                message=(
                    "Invitation renvoyee avec succes."
                    if email_sent
                    else "Invitation reactivee, mais l'email n'a pas pu etre envoye automatiquement."
                ),
                email_sent=email_sent,
            )

    invitation = UserInvitation(company_id=company.id)
    _apply_invitation_payload(
        db,
        invitation,
        current_admin=current_admin,
        payload=payload,
        normalized_email=normalized_email,
    )
    db.add(invitation)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return _resolve_create_invitation_conflict(
            db,
            company=company,
            normalized_email=normalized_email,
        )
    db.refresh(invitation)

    email_sent = _send_invitation_email(invitation, company_name=company.name)
    if email_sent:
        _record_invitation_sent(db, invitation)
    INVITATION_LOGGER.info(
        "event=user_invitation_created invitation_id=%s company_id=%s actor_user_id=%s email_sent=%s",
        invitation.id,
        invitation.company_id,
        current_admin.id,
        email_sent,
    )
    return InvitationDeliveryResult(
        invitation=_read_user_invitation_for_company(db, invitation.id, company_id=company.id),
        response_code="INVITATION_SENT",
        status_code=status.HTTP_201_CREATED,
        message=(
            "Invitation envoyee avec succes."
            if email_sent
            else "Invitation creee, mais l'email n'a pas pu etre envoye automatiquement."
        ),
        email_sent=email_sent,
    )


def resend_user_invitation(
    db: Session,
    *,
    current_admin: User,
    invitation_id: int,
) -> InvitationDeliveryResult:
    invitation = _read_user_invitation_for_company(
        db,
        invitation_id,
        company_id=current_admin.company_id,
    )
    company = _ensure_company_is_active(invitation.company)
    if _effective_status(invitation) == "accepted":
        _raise_invitation_exception(
            status.HTTP_400_BAD_REQUEST,
            code="INVITATION_ALREADY_ACCEPTED",
            message="Cette invitation a deja ete acceptee.",
        )

    invitation.token = _generate_unique_invitation_token(db)
    invitation.status = PENDING_STATUS
    invitation.accepted_at = None
    invitation.expires_at = datetime.now(UTC) + timedelta(days=_infer_expiration_days(invitation))
    db.add(invitation)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "INVITATION_RESEND_CONFLICT",
                "message": "Le renvoi de l'invitation a rencontre un conflit. Reessayez.",
            },
        ) from exc
    db.refresh(invitation)

    email_sent = _send_invitation_email(invitation, company_name=company.name)
    if email_sent:
        _record_invitation_sent(db, invitation)
    INVITATION_LOGGER.info(
        "event=user_invitation_resent invitation_id=%s company_id=%s actor_user_id=%s email_sent=%s",
        invitation.id,
        invitation.company_id,
        current_admin.id,
        email_sent,
    )
    return InvitationDeliveryResult(
        invitation=_read_user_invitation_for_company(
            db,
            invitation.id,
            company_id=current_admin.company_id,
        ),
        response_code="INVITATION_RESENT",
        status_code=status.HTTP_200_OK,
        message=(
            "L'invitation a ete renvoyee."
            if email_sent
            else "L'invitation a ete reactivee, mais l'email n'a pas pu etre renvoye."
        ),
        email_sent=email_sent,
    )


def cancel_user_invitation(
    db: Session,
    *,
    current_admin: User,
    invitation_id: int,
) -> UserInvitation:
    invitation = _read_user_invitation_for_company(
        db,
        invitation_id,
        company_id=current_admin.company_id,
    )
    if _effective_status(invitation) == "accepted":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Impossible d'annuler une invitation deja acceptee.",
        )

    invitation.status = CANCELLED_STATUS
    db.add(invitation)
    db.commit()
    db.refresh(invitation)
    INVITATION_LOGGER.info(
        "event=user_invitation_cancelled invitation_id=%s company_id=%s actor_user_id=%s",
        invitation.id,
        invitation.company_id,
        current_admin.id,
    )
    return _read_user_invitation_for_company(
        db,
        invitation.id,
        company_id=current_admin.company_id,
    )


def delete_user_invitation(
    db: Session,
    *,
    current_admin: User,
    invitation_id: int,
) -> None:
    invitation = _read_user_invitation_for_company(
        db,
        invitation_id,
        company_id=current_admin.company_id,
    )
    INVITATION_LOGGER.info(
        "event=user_invitation_deleted invitation_id=%s company_id=%s actor_user_id=%s",
        invitation.id,
        invitation.company_id,
        current_admin.id,
    )
    db.delete(invitation)
    db.commit()


def validate_user_invitation(db: Session, token: str) -> InvitationValidationResponse:
    invitation = _read_invitation_by_token(db, token)
    company = _ensure_company_is_active(invitation.company)
    existing_user = _read_user_by_email(db, invitation.email)
    effective_status = _effective_status(invitation)

    if effective_status == "accepted":
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Cette invitation a deja ete utilisee.",
        )
    if effective_status == "cancelled":
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Cette invitation a ete annulee.",
        )
    if effective_status == "expired":
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Cette invitation a expire.",
        )
    if existing_user is not None and existing_user.company_id not in {None, company.id}:
        _raise_invitation_exception(
            status.HTTP_403_FORBIDDEN,
            code="INVITATION_OTHER_ORGANIZATION",
            message="Cet utilisateur appartient deja a une autre organisation.",
        )
    if existing_user is not None and existing_user.company_id == company.id and existing_user.is_active:
        _raise_invitation_exception(
            status.HTTP_409_CONFLICT,
            code="INVITATION_ALREADY_MEMBER",
            message="Cet utilisateur appartient deja a votre entreprise.",
        )

    return InvitationValidationResponse(
        company_name=company.name,
        full_name=invitation.full_name,
        email=invitation.email,
        phone=invitation.phone,
        department=invitation.department,
        job_title=invitation.job_title,
        role=normalize_role(invitation.role),
        expires_at=_coerce_utc_datetime(invitation.expires_at),
    )


def accept_user_invitation(
    db: Session,
    *,
    payload: AcceptInvitationRequest,
) -> AcceptedInvitationResult:
    invitation = _read_invitation_by_token(db, payload.token)
    company = _ensure_company_is_active(invitation.company)
    effective_status = _effective_status(invitation)
    if effective_status == "accepted":
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Cette invitation a deja ete utilisee.",
        )
    if effective_status == "cancelled":
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Cette invitation a ete annulee.",
        )
    if effective_status == "expired":
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Cette invitation a expire.",
        )

    _ensure_password_is_valid(payload.password)

    matched_department = _match_department(db, invitation.department)
    existing_user = _read_user_by_email(db, invitation.email)
    if existing_user is not None and existing_user.company_id not in {None, company.id}:
        _raise_invitation_exception(
            status.HTTP_403_FORBIDDEN,
            code="INVITATION_OTHER_ORGANIZATION",
            message="Cet utilisateur appartient deja a une autre organisation.",
        )

    if existing_user is not None and existing_user.company_id == company.id and existing_user.is_active:
        _raise_invitation_exception(
            status.HTTP_409_CONFLICT,
            code="INVITATION_ALREADY_MEMBER",
            message="Cet utilisateur appartient deja a votre entreprise.",
        )

    if existing_user is None:
        user = User(
            full_name=invitation.full_name.strip(),
            email=_normalize_email(invitation.email),
            hashed_password=hash_password(payload.password),
            phone=_normalize_phone(payload.phone) or invitation.phone,
            role=normalize_role(invitation.role),
            company_id=company.id,
            department_id=matched_department.id if matched_department else None,
            requested_department=invitation.department.strip(),
            job_profile=invitation.job_title.strip(),
            is_active=True,
            account_status="active",
        )
        db.add(user)
    else:
        existing_user.full_name = invitation.full_name.strip()
        existing_user.hashed_password = hash_password(payload.password)
        existing_user.phone = _normalize_phone(payload.phone) or invitation.phone or existing_user.phone
        existing_user.role = normalize_role(invitation.role)
        existing_user.company_id = company.id
        existing_user.department_id = matched_department.id if matched_department else None
        existing_user.requested_department = invitation.department.strip()
        existing_user.job_profile = invitation.job_title.strip()
        existing_user.is_active = True
        existing_user.account_status = "active"
        db.add(existing_user)
        user = existing_user

    invitation.status = ACCEPTED_STATUS
    invitation.accepted_at = datetime.now(UTC)
    db.add(invitation)
    db.flush()
    _cancel_other_pending_invitations_for_email(
        db,
        email=invitation.email,
        exclude_invitation_id=invitation.id,
    )

    if invitation.created_by_id is not None and invitation.created_by_id != user.id:
        recipient_user = db.get(User, invitation.created_by_id)
        if recipient_user is not None:
            enqueue_notification(
                db,
                recipient_user_id=recipient_user.id,
                actor_user_id=user.id,
                notification_type="success",
                title="Invitation acceptee",
                message=f"{user.full_name} a rejoint votre entreprise.",
                priority="medium",
                link_url="/users",
                source_type="user_invitation",
                source_id=str(invitation.id),
                source_key=f"user-invitation-accepted:{invitation.id}",
                metadata_json={
                    "invitation_id": invitation.id,
                    "company_id": company.id,
                    "joined_user_id": user.id,
                },
            )

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        refreshed_user = _read_user_by_email(db, invitation.email)
        if refreshed_user is not None and refreshed_user.company_id == company.id and refreshed_user.is_active:
            _raise_invitation_exception(
                status.HTTP_409_CONFLICT,
                code="INVITATION_ALREADY_MEMBER",
                message="Cet utilisateur appartient deja a votre entreprise.",
            )
        if refreshed_user is not None and refreshed_user.company_id not in {None, company.id}:
            _raise_invitation_exception(
                status.HTTP_403_FORBIDDEN,
                code="INVITATION_OTHER_ORGANIZATION",
                message="Cet utilisateur appartient deja a une autre organisation.",
            )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "INVITATION_ACCEPT_CONFLICT",
                "message": "Le rattachement de cet utilisateur a rencontre un conflit. Reessayez.",
            },
        ) from exc
    db.refresh(user)
    db.refresh(invitation)

    INVITATION_LOGGER.info(
        "event=user_invitation_accepted invitation_id=%s company_id=%s user_id=%s",
        invitation.id,
        company.id,
        user.id,
    )
    return AcceptedInvitationResult(user=user, invitation=invitation)
