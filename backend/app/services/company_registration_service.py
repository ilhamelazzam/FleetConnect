import json
import logging
import mimetypes
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import asc, desc, func, inspect, or_, select, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session, selectinload

from app.core.config import get_settings
from app.core.roles import (
    ANALYST_ROLE,
    COMPANY_ADMIN_ROLE,
    MANAGER_ROLE,
    SUPER_ADMIN_ROLE,
    normalize_role,
)
from app.core.security import hash_password
from app.models.company import Company
from app.models.company_document import CompanyDocument
from app.models.company_registration_request import CompanyRegistrationRequest
from app.models.company_status_history import CompanyStatusHistory
from app.models.user import User
from app.schemas.company_registration import (
    CompanyAdminSummaryRead,
    CompanyAuditLogListResponse,
    CompanyDashboardMetricsRead,
    CompanyDashboardRead,
    CompanyLifecycleStatus,
    CompanyListItemRead,
    CompanyListResponse,
    CompanyOperatorDistributionRead,
    CompanyRegistrationActionResponse,
    CompanyRegistrationDecisionRead,
    CompanyRegistrationDocumentRead,
    CompanyRegistrationInfoRequest,
    CompanyRegistrationOverviewRead,
    CompanyRegistrationRequestDetailRead,
    CompanyRegistrationRequestSummaryRead,
    CompanyRegistrationStatus,
    CompanyRegistrationStatsRead,
    CompanyStatusCommentRequest,
    CompanyStatusHistoryRead,
    CompanySummaryRead,
    RequestedCompanyRole,
)
from app.services.email_service import EmailDeliveryError, send_email
from app.services.notification_service import enqueue_notification
from app.services.user_onboarding_service import ensure_company_join_code

logger = logging.getLogger(__name__)

REQUEST_STATUS_PENDING = "pending"
REQUEST_STATUS_UNDER_REVIEW = "under_review"
REQUEST_STATUS_APPROVED = "approved"
REQUEST_STATUS_REJECTED = "rejected"
ACTIVE_REQUEST_EMAIL_STATUSES = (
    REQUEST_STATUS_PENDING,
    REQUEST_STATUS_UNDER_REVIEW,
    REQUEST_STATUS_APPROVED,
)
APPROVABLE_REQUEST_STATUSES = (
    REQUEST_STATUS_PENDING,
    REQUEST_STATUS_UNDER_REVIEW,
)
REJECTABLE_REQUEST_STATUSES = (
    REQUEST_STATUS_PENDING,
    REQUEST_STATUS_UNDER_REVIEW,
)
REOPENABLE_REQUEST_STATUSES = (REQUEST_STATUS_REJECTED,)
ALLOWED_REQUEST_STATUS_TRANSITIONS: dict[str, tuple[str, ...]] = {
    REQUEST_STATUS_PENDING: (
        REQUEST_STATUS_APPROVED,
        REQUEST_STATUS_REJECTED,
    ),
    REQUEST_STATUS_REJECTED: (REQUEST_STATUS_UNDER_REVIEW,),
    REQUEST_STATUS_UNDER_REVIEW: (
        REQUEST_STATUS_APPROVED,
        REQUEST_STATUS_REJECTED,
    ),
}
COMPANY_STATUS_ACTIVE = "active"
COMPANY_STATUS_SUSPENDED = "suspended"
COMPANY_STATUS_DELETED = "deleted"
REQUESTED_ROLE_ADMIN = "ADMIN"
REQUESTED_ROLE_MANAGER = "MANAGER"
REQUESTED_ROLE_ANALYST = "ANALYST"
REQUESTED_ROLE_VALUES: tuple[RequestedCompanyRole, ...] = (
    REQUESTED_ROLE_ADMIN,
    REQUESTED_ROLE_MANAGER,
    REQUESTED_ROLE_ANALYST,
)
REQUESTED_ROLE_LABELS: dict[RequestedCompanyRole, str] = {
    REQUESTED_ROLE_ADMIN: "Administrateur",
    REQUESTED_ROLE_MANAGER: "Manager",
    REQUESTED_ROLE_ANALYST: "Analyste",
}
REQUESTED_ROLE_TO_USER_ROLE: dict[RequestedCompanyRole, str] = {
    REQUESTED_ROLE_ADMIN: COMPANY_ADMIN_ROLE,
    REQUESTED_ROLE_MANAGER: MANAGER_ROLE,
    REQUESTED_ROLE_ANALYST: ANALYST_ROLE,
}

ALLOWED_UPLOAD_MIME_TYPES = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
}
DOCUMENT_LABELS = {
    "logo": "Logo entreprise",
    "legal_representative_cin": "CIN du representant legal",
    "commercial_register": "Registre de commerce",
    "fiscal_document": "Document fiscal",
    "company_stamp": "Cachet societe",
}
PASSWORD_POLICY_PATTERN = re.compile(
    r"^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,128}$"
)

REQUEST_SORT_FIELDS = {
    "date": CompanyRegistrationRequest.created_at,
    "company": CompanyRegistrationRequest.company_name,
    "status": CompanyRegistrationRequest.status,
}

COMPANY_SORT_FIELDS = {
    "date": Company.created_at,
    "company": Company.name,
    "status": Company.status,
}

REGISTRATION_DIAGNOSTIC_TABLES = (
    "company_requests",
    "registration_requests",
    "auth_users",
    "pending_registrations",
    "archived_requests",
    "deleted_requests",
)


@dataclass(frozen=True, slots=True)
class CompanyRequestEligibility:
    can_submit: bool
    reason: str
    message: str
    previous_request_id: int | None = None


def _serialize_diagnostic_value(value: object) -> object:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, list):
        return [_serialize_diagnostic_value(item) for item in value]
    if isinstance(value, tuple):
        return [_serialize_diagnostic_value(item) for item in value]
    if isinstance(value, dict):
        return {
            str(key): _serialize_diagnostic_value(item)
            for key, item in value.items()
        }
    return str(value)


def _log_company_registration_step(step: str, **details: object) -> None:
    serialized_details = {
        key: _serialize_diagnostic_value(value)
        for key, value in details.items()
        if value is not None
    }
    logger.info(
        "event=company_registration_submit step=%s details=%s",
        step,
        serialized_details,
    )


def _log_sqlalchemy_operation_error(
    step: str,
    exc: SQLAlchemyError,
    **details: object,
) -> None:
    logger.exception(
        "event=company_registration_sql_error step=%s error_type=%s message=%s statement=%s params=%s details=%s",
        step,
        type(exc).__name__,
        str(exc),
        getattr(exc, "statement", None),
        _serialize_diagnostic_value(getattr(exc, "params", None)),
        {
            key: _serialize_diagnostic_value(value)
            for key, value in details.items()
            if value is not None
        },
    )


def serialize_string_list(values: list[str]) -> str:
    normalized = [value.strip() for value in values if value.strip()]
    return json.dumps(normalized, ensure_ascii=True)


def deserialize_string_list(value: str | None) -> list[str]:
    if not value:
        return []

    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return []

    if not isinstance(parsed, list):
        return []

    return [str(item).strip() for item in parsed if str(item).strip()]


def normalize_coverage_zones(raw_value: str) -> list[str]:
    return [
        chunk.strip()
        for chunk in re.split(r"[,\n;]+", raw_value)
        if chunk.strip()
    ]


def serialize_metadata(value: dict[str, object] | None) -> str | None:
    if not value:
        return None
    return json.dumps(value, ensure_ascii=True, default=str)


def deserialize_metadata(value: str | None) -> dict[str, object]:
    if not value:
        return {}
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def get_primary_operator(values: list[str]) -> str | None:
    for value in values:
        normalized = value.strip()
        if normalized:
            return normalized
    return None


def normalize_requested_role(role: str) -> RequestedCompanyRole:
    normalized_role = role.strip().upper()
    if normalized_role == "ANALYSTE":
        normalized_role = REQUESTED_ROLE_ANALYST
    if normalized_role not in REQUESTED_ROLE_VALUES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Le role demande doit etre ADMIN, MANAGER ou ANALYST",
        )
    return normalized_role  # type: ignore[return-value]


def get_requested_role_label(role: str) -> str:
    return REQUESTED_ROLE_LABELS[normalize_requested_role(role)]


def get_requested_role_user_role(role: str) -> str:
    return REQUESTED_ROLE_TO_USER_ROLE[normalize_requested_role(role)]


def normalize_company_request_email(email: str) -> str:
    return email.strip().lower()


def _collect_registration_conflict_snapshot(
    db: Session,
    *,
    email: str,
    company_name: str | None = None,
    ice: str | None = None,
    rc: str | None = None,
) -> dict[str, object]:
    normalized_email = normalize_company_request_email(email)

    active_user_rows = [
        {
            "id": user.id,
            "email": user.email,
            "full_name": user.full_name,
            "role": user.role,
            "company_id": user.company_id,
            "is_active": user.is_active,
            "account_status": user.account_status,
        }
        for user in db.scalars(
            select(User).where(
                func.lower(User.email) == normalized_email,
                User.is_active.is_(True),
                func.lower(func.coalesce(User.account_status, "active")) == "active",
            )
        )
    ]

    request_rows = [
        {
            "id": request.id,
            "responsible_email": request.responsible_email,
            "company_name": request.company_name,
            "status": request.status,
            "is_deleted": request.is_deleted,
            "approved_company_id": request.approved_company_id,
            "approved_admin_user_id": request.approved_admin_user_id,
            "created_at": request.created_at,
            "reviewed_at": request.reviewed_at,
            "deleted_at": request.deleted_at,
        }
        for request in db.scalars(
            select(CompanyRegistrationRequest)
            .where(func.lower(CompanyRegistrationRequest.responsible_email) == normalized_email)
            .order_by(
                CompanyRegistrationRequest.created_at.desc(),
                CompanyRegistrationRequest.id.desc(),
            )
        )
    ]

    company_ids = {
        int(user_row["company_id"])
        for user_row in active_user_rows
        if user_row["company_id"] is not None
    }
    company_ids.update(
        int(request_row["approved_company_id"])
        for request_row in request_rows
        if request_row["approved_company_id"] is not None
    )

    company_filters = []
    normalized_company_name = (company_name or "").strip().lower()
    normalized_ice = (ice or "").strip()
    normalized_rc = (rc or "").strip()
    if normalized_company_name:
        company_filters.append(func.lower(Company.name) == normalized_company_name)
    if normalized_ice:
        company_filters.append(Company.ice == normalized_ice)
    if normalized_rc:
        company_filters.append(Company.rc == normalized_rc)
    if company_ids:
        company_filters.append(Company.id.in_(sorted(company_ids)))

    company_rows: list[dict[str, object]] = []
    if company_filters:
        company_rows = [
            {
                "id": company.id,
                "name": company.name,
                "status": company.status,
                "city": company.city,
                "country": company.country,
                "ice": company.ice,
                "rc": company.rc,
            }
            for company in db.scalars(
                select(Company)
                .where(or_(*company_filters))
                .order_by(Company.created_at.desc(), Company.id.desc())
            )
        ]

    inspector = inspect(db.get_bind())
    existing_table_names = set(inspector.get_table_names())
    extra_tables: dict[str, object] = {}
    for table_name in REGISTRATION_DIAGNOSTIC_TABLES:
        if table_name not in existing_table_names:
            extra_tables[table_name] = {"table_present": False, "rows": []}
            continue

        columns = {column["name"] for column in inspector.get_columns(table_name)}
        email_column = next(
            (candidate for candidate in ("responsible_email", "email") if candidate in columns),
            None,
        )
        if email_column is None:
            extra_tables[table_name] = {
                "table_present": True,
                "rows": [],
                "email_column": None,
            }
            continue

        rows = db.execute(
            text(
                f"""
                SELECT *
                FROM {table_name}
                WHERE LOWER({email_column}) = :email
                ORDER BY 1 DESC
                LIMIT 20
                """
            ),
            {"email": normalized_email},
        ).mappings().all()
        extra_tables[table_name] = {
            "table_present": True,
            "rows": [
                {
                    key: _serialize_diagnostic_value(value)
                    for key, value in dict(row).items()
                }
                for row in rows
            ],
            "email_column": email_column,
        }

    active_request_rows = [
        row
        for row in request_rows
        if row["status"] in ACTIVE_REQUEST_EMAIL_STATUSES and row["is_deleted"] is False
    ]
    deleted_request_rows = [row for row in request_rows if row["is_deleted"] is True]
    rejected_request_rows = [
        row
        for row in request_rows
        if row["status"] == REQUEST_STATUS_REJECTED
    ]

    return _serialize_diagnostic_value(
        {
            "email": normalized_email,
            "users": active_user_rows,
            "company_registration_requests": request_rows,
            "active_company_registration_requests": active_request_rows,
            "rejected_company_registration_requests": rejected_request_rows,
            "deleted_company_registration_requests": deleted_request_rows,
            "companies": company_rows,
            "extra_tables": extra_tables,
        }
    )


def _log_registration_conflict_snapshot(
    db: Session,
    *,
    email: str,
    blocker: str,
    company_name: str | None = None,
    ice: str | None = None,
    rc: str | None = None,
) -> None:
    snapshot = _collect_registration_conflict_snapshot(
        db,
        email=email,
        company_name=company_name,
        ice=ice,
        rc=rc,
    )
    logger.warning(
        "company_registration_conflict blocker=%s snapshot=%s",
        blocker,
        snapshot,
    )


def find_active_request_by_email(
    db: Session,
    email: str,
    *,
    exclude_request_id: int | None = None,
) -> CompanyRegistrationRequest | None:
    normalized_email = normalize_company_request_email(email)
    statement = (
        select(CompanyRegistrationRequest)
        .where(
            func.lower(CompanyRegistrationRequest.responsible_email) == normalized_email,
            CompanyRegistrationRequest.status.in_(ACTIVE_REQUEST_EMAIL_STATUSES),
            CompanyRegistrationRequest.is_deleted.is_(False),
        )
        .order_by(
            CompanyRegistrationRequest.created_at.desc(),
            CompanyRegistrationRequest.id.desc(),
        )
    )
    if exclude_request_id is not None:
        statement = statement.where(CompanyRegistrationRequest.id != exclude_request_id)
    return db.scalar(statement)


def find_latest_rejected_request(
    db: Session,
    email: str,
) -> CompanyRegistrationRequest | None:
    normalized_email = normalize_company_request_email(email)
    statement = (
        select(CompanyRegistrationRequest)
        .where(
            func.lower(CompanyRegistrationRequest.responsible_email) == normalized_email,
            CompanyRegistrationRequest.status == REQUEST_STATUS_REJECTED,
            CompanyRegistrationRequest.is_deleted.is_(False),
        )
        .order_by(
            CompanyRegistrationRequest.created_at.desc(),
            CompanyRegistrationRequest.id.desc(),
        )
    )
    return db.scalar(statement)


def find_latest_resubmission_source(
    db: Session,
    email: str,
) -> CompanyRegistrationRequest | None:
    normalized_email = normalize_company_request_email(email)
    statement = (
        select(CompanyRegistrationRequest)
        .where(
            func.lower(CompanyRegistrationRequest.responsible_email) == normalized_email,
            or_(
                CompanyRegistrationRequest.status == REQUEST_STATUS_REJECTED,
                CompanyRegistrationRequest.is_deleted.is_(True),
            ),
        )
        .order_by(
            CompanyRegistrationRequest.created_at.desc(),
            CompanyRegistrationRequest.id.desc(),
        )
    )
    return db.scalar(statement)


def can_create_request(
    db: Session,
    email: str,
    *,
    log_conflicts: bool = True,
) -> CompanyRequestEligibility:
    normalized_email = normalize_company_request_email(email)

    existing_user = db.scalar(
        select(User).where(
            func.lower(User.email) == normalized_email,
            User.is_active.is_(True),
            func.lower(func.coalesce(User.account_status, "active")) == "active",
        )
    )
    if existing_user is not None:
        if log_conflicts:
            _log_registration_conflict_snapshot(
                db,
                email=normalized_email,
                blocker="active_user_exists",
            )
        return CompanyRequestEligibility(
            can_submit=False,
            reason="active_user_exists",
            message=(
                "Un compte actif existe deja avec cet email. Connectez-vous ou utilisez "
                "la recuperation de mot de passe."
            ),
        )

    active_request = find_active_request_by_email(db, normalized_email)
    if active_request is not None:
        if log_conflicts:
            _log_registration_conflict_snapshot(
                db,
                email=normalized_email,
                blocker="active_request_exists",
            )
        return CompanyRequestEligibility(
            can_submit=False,
            reason="active_request_exists",
            message="Une demande est deja en cours de traitement pour cet email.",
        )

    latest_rejected_request = find_latest_rejected_request(db, normalized_email)
    if latest_rejected_request is not None:
        return CompanyRequestEligibility(
            can_submit=True,
            reason="resubmission_allowed",
            message=(
                "Une precedente demande associee a cet email a ete refusee. "
                "Vous pouvez creer un nouveau dossier corrige."
            ),
            previous_request_id=latest_rejected_request.id,
        )

    latest_deleted_request = db.scalar(
        select(CompanyRegistrationRequest)
        .where(
            func.lower(CompanyRegistrationRequest.responsible_email) == normalized_email,
            CompanyRegistrationRequest.is_deleted.is_(True),
        )
        .order_by(
            CompanyRegistrationRequest.deleted_at.desc(),
            CompanyRegistrationRequest.id.desc(),
        )
    )
    if latest_deleted_request is not None:
        return CompanyRequestEligibility(
            can_submit=True,
            reason="resubmission_allowed",
            message=(
                "Une precedente demande associee a cet email a ete cloturee. "
                "Vous pouvez creer un nouveau dossier."
            ),
            previous_request_id=latest_deleted_request.id,
        )

    return CompanyRequestEligibility(
        can_submit=True,
        reason="available",
        message="Aucune demande active n'existe pour cet email.",
    )


def validate_status_transition(old_status: str, new_status: str) -> None:
    allowed_statuses = ALLOWED_REQUEST_STATUS_TRANSITIONS.get(old_status, ())
    if new_status not in allowed_statuses:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Transition de statut non autorisee pour cette demande "
                f"({old_status} -> {new_status})."
            ),
        )


def company_has_admin_account(db: Session, company_id: int) -> bool:
    return (
        db.scalar(
            select(func.count(User.id)).where(
                User.company_id == company_id,
                User.role == COMPANY_ADMIN_ROLE,
            )
        )
        or 0
    ) > 0


def validate_company_registration_password(password: str) -> None:
    if not PASSWORD_POLICY_PATTERN.match(password):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                "Le mot de passe doit contenir au moins 8 caracteres, "
                "une majuscule, une minuscule et un chiffre"
            ),
        )


def _get_upload_root() -> Path:
    settings = get_settings()
    root = Path(settings.company_registration_upload_dir).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def resolve_stored_document_path(relative_path: str) -> Path:
    root = _get_upload_root()
    resolved_path = (root / relative_path).resolve()
    if root not in resolved_path.parents and resolved_path != root:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid document path",
        )
    return resolved_path


def _sanitize_file_stem(file_name: str | None, fallback: str) -> str:
    original_stem = Path(file_name or fallback).stem
    sanitized = re.sub(r"[^A-Za-z0-9_-]+", "-", original_stem).strip("-")
    return sanitized or fallback


def _store_upload_file(
    upload_file: UploadFile | None,
    *,
    submission_folder: str,
    document_key: str,
    required: bool,
) -> str | None:
    if upload_file is None:
        if required:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Le document {DOCUMENT_LABELS[document_key]} est obligatoire",
            )
        return None

    content_type = (upload_file.content_type or "").lower().strip()
    extension = ALLOWED_UPLOAD_MIME_TYPES.get(content_type)
    if extension is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Seuls les fichiers PDF, JPG et PNG sont autorises",
        )

    settings = get_settings()
    target_directory = _get_upload_root() / submission_folder
    target_directory.mkdir(parents=True, exist_ok=True)
    target_name = (
        f"{document_key}-{_sanitize_file_stem(upload_file.filename, document_key)}-"
        f"{uuid4().hex}{extension}"
    )
    target_path = target_directory / target_name

    total_bytes = 0
    with target_path.open("wb") as buffer:
        while True:
            chunk = upload_file.file.read(1024 * 1024)
            if not chunk:
                break
            total_bytes += len(chunk)
            if total_bytes > settings.company_registration_max_upload_bytes:
                target_path.unlink(missing_ok=True)
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail=(
                        "Le fichier depasse la taille maximale autorisee "
                        f"de {settings.company_registration_max_upload_bytes // (1024 * 1024)} Mo"
                    ),
                )
            buffer.write(chunk)

    return str(Path(submission_folder) / target_name).replace("\\", "/")


def _request_query_options():
    return (
        selectinload(CompanyRegistrationRequest.reviewer),
        selectinload(CompanyRegistrationRequest.approved_company),
        selectinload(CompanyRegistrationRequest.approved_admin_user),
        selectinload(CompanyRegistrationRequest.previous_request),
        selectinload(CompanyRegistrationRequest.deleter),
        selectinload(CompanyRegistrationRequest.documents),
        selectinload(CompanyRegistrationRequest.history_entries).selectinload(
            CompanyStatusHistory.actor_user
        ),
    )


def _company_query_options():
    return (
        selectinload(Company.users),
        selectinload(Company.documents),
        selectinload(Company.history_entries).selectinload(CompanyStatusHistory.actor_user),
    )


def _create_company_document(
    db: Session,
    *,
    registration_request: CompanyRegistrationRequest,
    company_id: int | None,
    document_key: str,
    relative_path: str,
    content_type: str | None,
) -> CompanyDocument:
    document = CompanyDocument(
        request_id=registration_request.id,
        company_id=company_id,
        document_key=document_key,
        label=DOCUMENT_LABELS[document_key],
        file_name=Path(relative_path).name,
        relative_path=relative_path,
        content_type=content_type,
    )
    db.add(document)
    return document


def _record_company_history(
    db: Session,
    *,
    action: str,
    title: str,
    request_id: int | None = None,
    company_id: int | None = None,
    actor_user_id: int | None = None,
    previous_status: str | None = None,
    next_status: str | None = None,
    comment: str | None = None,
    metadata: dict[str, object] | None = None,
) -> CompanyStatusHistory:
    entry = CompanyStatusHistory(
        request_id=request_id,
        company_id=company_id,
        actor_user_id=actor_user_id,
        action=action,
        title=title,
        comment=(comment or "").strip() or None,
        previous_status=previous_status,
        next_status=next_status,
        metadata_json=serialize_metadata(metadata),
    )
    db.add(entry)
    return entry


def _ensure_request_is_not_deleted(
    registration_request: CompanyRegistrationRequest,
    *,
    detail: str,
) -> None:
    if registration_request.is_deleted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=detail,
        )


def _ensure_no_other_active_request_exists(
    db: Session,
    registration_request: CompanyRegistrationRequest,
) -> None:
    conflicting_request = find_active_request_by_email(
        db,
        registration_request.responsible_email,
        exclude_request_id=registration_request.id,
    )
    if conflicting_request is None:
        return

    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=(
            "Une nouvelle demande active existe deja pour cet email. "
            "Veuillez traiter la demande la plus recente."
        ),
    )


def _validate_required_request_fields(
    registration_request: CompanyRegistrationRequest,
) -> None:
    required_values = {
        "Nom du responsable": registration_request.responsible_full_name,
        "Telephone du responsable": registration_request.responsible_phone,
        "Fonction": registration_request.job_title,
        "Role demande": registration_request.requested_role,
        "Email responsable": registration_request.responsible_email,
        "Nom entreprise": registration_request.company_name,
        "Secteur": registration_request.sector,
        "Ville": registration_request.city,
        "Telephone entreprise": registration_request.company_phone,
        "Mot de passe": registration_request.password_hash,
    }
    missing_fields = [
        label
        for label, value in required_values.items()
        if not str(value or "").strip()
    ]
    if not missing_fields:
        return

    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=(
            "Impossible d'approuver la demande car des informations obligatoires sont "
            f"manquantes: {', '.join(missing_fields)}."
        ),
    )


def _validate_request_documents_available(
    registration_request: CompanyRegistrationRequest,
) -> None:
    document_paths = {
        "CIN du representant legal": registration_request.legal_representative_cin_path,
        "Registre de commerce": registration_request.commercial_register_path,
        "Logo entreprise": registration_request.logo_path,
        "Document fiscal": registration_request.fiscal_document_path,
        "Cachet societe": registration_request.company_stamp_path,
    }
    missing_documents = [
        label
        for label, relative_path in document_paths.items()
        if relative_path and not resolve_stored_document_path(relative_path).exists()
    ]
    required_missing_documents = [
        label
        for label in ("CIN du representant legal", "Registre de commerce")
        if not document_paths[label]
    ]
    if required_missing_documents:
        missing_documents = [*required_missing_documents, *missing_documents]

    if not missing_documents:
        return

    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=(
            "Les documents justificatifs ne sont plus disponibles ou sont incomplets: "
            f"{', '.join(dict.fromkeys(missing_documents))}."
        ),
    )


def _build_history_read(entry: CompanyStatusHistory) -> CompanyStatusHistoryRead:
    return CompanyStatusHistoryRead(
        id=entry.id,
        action=entry.action,
        title=entry.title,
        comment=entry.comment,
        previous_status=entry.previous_status,
        next_status=entry.next_status,
        actor_user_id=entry.actor_user_id,
        actor_user_name=entry.actor_user.full_name if entry.actor_user is not None else None,
        created_at=entry.created_at,
    )


def _build_request_documents(
    registration_request: CompanyRegistrationRequest,
    *,
    api_prefix: str,
) -> list[CompanyRegistrationDocumentRead]:
    if registration_request.is_deleted:
        return []

    if registration_request.documents:
        return [
            CompanyRegistrationDocumentRead(
                key=document.document_key,
                label=document.label,
                file_name=document.file_name,
                download_url=(
                    f"{api_prefix}/admin/company-registration/requests/"
                    f"{registration_request.id}/documents/{document.document_key}"
                ),
            )
            for document in registration_request.documents
        ]

    documents: list[CompanyRegistrationDocumentRead] = []
    document_paths = {
        "logo": registration_request.logo_path,
        "legal_representative_cin": registration_request.legal_representative_cin_path,
        "commercial_register": registration_request.commercial_register_path,
        "fiscal_document": registration_request.fiscal_document_path,
        "company_stamp": registration_request.company_stamp_path,
    }
    for key, relative_path in document_paths.items():
        if not relative_path:
            continue
        documents.append(
            CompanyRegistrationDocumentRead(
                key=key,
                label=DOCUMENT_LABELS[key],
                file_name=Path(relative_path).name,
                download_url=(
                    f"{api_prefix}/admin/company-registration/requests/"
                    f"{registration_request.id}/documents/{key}"
                ),
            )
        )
    return documents


def _build_company_logo_download_url(company: Company, *, api_prefix: str) -> str | None:
    if not company.logo_path:
        return None
    return f"{api_prefix}/admin/companies/{company.id}/logo"


def _build_company_admin_summary(user: User) -> CompanyAdminSummaryRead:
    return CompanyAdminSummaryRead(
        id=user.id,
        full_name=user.full_name,
        email=user.email,
        role=user.role,
        company_id=user.company_id,
        company_name=user.company_name,
        created_at=user.created_at,
    )


def _build_company_summary(company: Company) -> CompanySummaryRead:
    operators = deserialize_string_list(company.operators_json)
    return CompanySummaryRead(
        id=company.id,
        company_code=company.join_code,
        name=company.name,
        sector=company.sector,
        city=company.city,
        country=company.country,
        phone=company.phone,
        ice=company.ice,
        status=company.status,  # type: ignore[arg-type]
        user_count=len(company.users),
        estimated_phone_lines=company.estimated_phone_lines,
        operators=operators,
        created_at=company.created_at,
    )


def _build_company_list_item(company: Company, *, api_prefix: str) -> CompanyListItemRead:
    active_user_count = sum(1 for user in company.users if user.status == "active")
    suspended_user_count = sum(1 for user in company.users if user.status == "suspended")
    pending_user_count = sum(1 for user in company.users if user.status == "pending")
    admin_count = sum(
        1
        for user in company.users
        if normalize_role(user.role) in {COMPANY_ADMIN_ROLE, SUPER_ADMIN_ROLE}
    )
    return CompanyListItemRead(
        id=company.id,
        company_code=company.join_code,
        name=company.name,
        sector=company.sector,
        city=company.city,
        address_line=company.address_line,
        region=company.region,
        postal_code=company.postal_code,
        country=company.country,
        phone=company.phone,
        ice=company.ice,
        rc=company.rc,
        tax_id=company.tax_id,
        cnss=company.cnss,
        patente=company.patente,
        website=company.website,
        status=company.status,  # type: ignore[arg-type]
        join_code=company.join_code,
        estimated_phone_lines=company.estimated_phone_lines,
        employees_count=company.employees_count,
        user_count=len(company.users),
        active_user_count=active_user_count,
        suspended_user_count=suspended_user_count,
        pending_user_count=pending_user_count,
        admin_count=admin_count,
        operators=deserialize_string_list(company.operators_json),
        coverage_zones=deserialize_string_list(company.coverage_zones_json),
        logo_download_url=_build_company_logo_download_url(company, api_prefix=api_prefix),
        created_at=company.created_at,
        updated_at=company.updated_at,
    )


def get_request_by_id(db: Session, request_id: int) -> CompanyRegistrationRequest | None:
    statement = (
        select(CompanyRegistrationRequest)
        .options(*_request_query_options())
        .where(CompanyRegistrationRequest.id == request_id)
    )
    return db.scalar(statement)


def get_request_or_404(db: Session, request_id: int) -> CompanyRegistrationRequest:
    registration_request = get_request_by_id(db, request_id)
    if registration_request is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Registration request not found",
        )
    return registration_request


def create_company_registration_request(
    db: Session,
    *,
    responsible_full_name: str,
    responsible_phone: str,
    job_title: str,
    requested_role: str,
    responsible_email: str,
    password: str,
    company_name: str,
    sector: str,
    city: str,
    address_line: str | None,
    region: str | None,
    postal_code: str | None,
    country: str | None,
    latitude: float | None,
    longitude: float | None,
    company_phone: str,
    ice: str | None,
    rc: str | None,
    tax_id: str | None,
    cnss: str | None,
    patente: str | None,
    website: str | None,
    estimated_phone_lines: int,
    employees_count: int,
    operators: list[str],
    coverage_zones: list[str],
    logo_file: UploadFile | None,
    legal_representative_cin_file: UploadFile | None,
    commercial_register_file: UploadFile | None,
    fiscal_document_file: UploadFile | None,
    company_stamp_file: UploadFile | None,
) -> CompanyRegistrationRequest:
    normalized_email = normalize_company_request_email(responsible_email)
    normalized_requested_role = normalize_requested_role(requested_role)
    _log_company_registration_step(
        "request_received",
        responsible_email=normalized_email,
        company_name=company_name.strip(),
        requested_role=normalized_requested_role,
        has_logo=logo_file is not None,
        has_legal_representative_cin=legal_representative_cin_file is not None,
        has_commercial_register=commercial_register_file is not None,
        has_fiscal_document=fiscal_document_file is not None,
        has_company_stamp=company_stamp_file is not None,
    )
    validate_company_registration_password(password)
    _log_company_registration_step(
        "validation_passed",
        responsible_email=normalized_email,
        company_name=company_name.strip(),
    )
    eligibility = can_create_request(db, normalized_email, log_conflicts=False)
    _log_company_registration_step(
        "eligibility_checked",
        responsible_email=normalized_email,
        can_submit=eligibility.can_submit,
        reason=eligibility.reason,
        previous_request_id=eligibility.previous_request_id,
    )
    if not eligibility.can_submit:
        _log_registration_conflict_snapshot(
            db,
            email=normalized_email,
            blocker=eligibility.reason,
            company_name=company_name,
            ice=ice,
            rc=rc,
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=eligibility.message,
        )
    previous_request = (
        get_request_by_id(db, eligibility.previous_request_id)
        if eligibility.previous_request_id is not None
        else None
    )

    if not operators:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Selectionnez au moins un operateur",
        )
    if not coverage_zones:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Renseignez au moins une zone de couverture",
        )

    submission_folder = f"request-{uuid4().hex}"
    created_files: list[str] = []
    current_step = "upload_files"
    try:
        _log_company_registration_step(
            "upload_started",
            responsible_email=normalized_email,
            submission_folder=submission_folder,
        )
        logo_path = _store_upload_file(
            logo_file,
            submission_folder=submission_folder,
            document_key="logo",
            required=False,
        )
        if logo_path:
            created_files.append(logo_path)
        legal_representative_cin_path = _store_upload_file(
            legal_representative_cin_file,
            submission_folder=submission_folder,
            document_key="legal_representative_cin",
            required=True,
        )
        if legal_representative_cin_path:
            created_files.append(legal_representative_cin_path)
        commercial_register_path = _store_upload_file(
            commercial_register_file,
            submission_folder=submission_folder,
            document_key="commercial_register",
            required=True,
        )
        if commercial_register_path:
            created_files.append(commercial_register_path)
        fiscal_document_path = _store_upload_file(
            fiscal_document_file,
            submission_folder=submission_folder,
            document_key="fiscal_document",
            required=False,
        )
        if fiscal_document_path:
            created_files.append(fiscal_document_path)
        company_stamp_path = _store_upload_file(
            company_stamp_file,
            submission_folder=submission_folder,
            document_key="company_stamp",
            required=False,
        )
        if company_stamp_path:
            created_files.append(company_stamp_path)
        _log_company_registration_step(
            "upload_completed",
            responsible_email=normalized_email,
            submission_folder=submission_folder,
            uploaded_files=created_files,
        )

        current_step = "build_registration_request"
        registration_request = CompanyRegistrationRequest(
            responsible_full_name=responsible_full_name.strip(),
            responsible_phone=responsible_phone.strip(),
            job_title=job_title.strip(),
            requested_role=normalized_requested_role,
            responsible_email=normalized_email,
            password_hash=hash_password(password),
            company_name=company_name.strip(),
            sector=sector.strip(),
            city=city.strip(),
            address_line=(address_line or "").strip() or None,
            region=(region or "").strip() or None,
            postal_code=(postal_code or "").strip() or None,
            country=(country or "").strip() or None,
            latitude=latitude,
            longitude=longitude,
            company_phone=company_phone.strip(),
            ice=(ice.strip() or None) if ice else None,
            rc=(rc.strip() or None) if rc else None,
            tax_id=(tax_id.strip() or None) if tax_id else None,
            cnss=(cnss.strip() or None) if cnss else None,
            patente=(patente.strip() or None) if patente else None,
            website=(website.strip() or None) if website else None,
            estimated_phone_lines=estimated_phone_lines,
            employees_count=employees_count,
            operators_json=serialize_string_list(operators),
            coverage_zones_json=serialize_string_list(coverage_zones),
            logo_path=logo_path,
            legal_representative_cin_path=legal_representative_cin_path or "",
            commercial_register_path=commercial_register_path or "",
            fiscal_document_path=fiscal_document_path,
            company_stamp_path=company_stamp_path,
            status=REQUEST_STATUS_PENDING,
            previous_request_id=previous_request.id if previous_request is not None else None,
            resubmission_number=(
                max(previous_request.resubmission_number, 1) + 1
                if previous_request is not None
                else 1
            ),
            is_deleted=False,
            deleted_at=None,
            deleted_by=None,
        )
        _log_company_registration_step(
            "request_entity_built",
            responsible_email=normalized_email,
            company_name=registration_request.company_name,
            previous_request_id=registration_request.previous_request_id,
            resubmission_number=registration_request.resubmission_number,
        )
        db.add(registration_request)
        current_step = "db_flush"
        _log_company_registration_step(
            "db_flush_started",
            responsible_email=normalized_email,
            company_name=registration_request.company_name,
            table="company_registration_requests",
        )
        try:
            db.flush()
        except IntegrityError as exc:
            _log_sqlalchemy_operation_error(
                current_step,
                exc,
                responsible_email=normalized_email,
                company_name=registration_request.company_name,
                table="company_registration_requests",
            )
            raise
        except SQLAlchemyError as exc:
            _log_sqlalchemy_operation_error(
                current_step,
                exc,
                responsible_email=normalized_email,
                company_name=registration_request.company_name,
                table="company_registration_requests",
            )
            raise
        _log_company_registration_step(
            "db_flush_completed",
            responsible_email=normalized_email,
            request_id=registration_request.id,
        )

        current_step = "create_request_documents"
        document_payloads = [
            ("logo", logo_path, logo_file.content_type if logo_file else None),
            (
                "legal_representative_cin",
                legal_representative_cin_path,
                legal_representative_cin_file.content_type
                if legal_representative_cin_file
                else None,
            ),
            (
                "commercial_register",
                commercial_register_path,
                commercial_register_file.content_type if commercial_register_file else None,
            ),
            (
                "fiscal_document",
                fiscal_document_path,
                fiscal_document_file.content_type if fiscal_document_file else None,
            ),
            (
                "company_stamp",
                company_stamp_path,
                company_stamp_file.content_type if company_stamp_file else None,
            ),
        ]
        for document_key, relative_path, content_type in document_payloads:
            if relative_path:
                _create_company_document(
                    db,
                    registration_request=registration_request,
                    company_id=None,
                    document_key=document_key,
                    relative_path=relative_path,
                    content_type=content_type,
                )
        _log_company_registration_step(
            "documents_linked",
            responsible_email=normalized_email,
            request_id=registration_request.id,
            document_count=sum(1 for _, relative_path, _ in document_payloads if relative_path),
        )

        current_step = "record_request_history"
        _record_company_history(
            db,
            request_id=registration_request.id,
            action="request_resubmitted" if previous_request is not None else "request_submitted",
            title=(
                "Nouveau dossier resoumis"
                if previous_request is not None
                else "Demande d'entreprise enregistree"
            ),
            previous_status=None,
            next_status=REQUEST_STATUS_PENDING,
            comment=(
                "Nouveau dossier recu apres cloture du precedent. "
                f"Dossier lie : #{previous_request.id}."
                if previous_request is not None
                else "Dossier recu et en attente de validation super administrateur."
            ),
            metadata={
                "company_name": registration_request.company_name,
                "responsible_email": registration_request.responsible_email,
                "job_title": registration_request.job_title,
                "requested_role": registration_request.requested_role,
                "previous_request_id": previous_request.id if previous_request is not None else None,
                "resubmission_number": registration_request.resubmission_number,
            },
        )
        _log_company_registration_step(
            "history_recorded",
            responsible_email=normalized_email,
            request_id=registration_request.id,
            status=registration_request.status,
        )

        current_step = "enqueue_super_admin_notifications"
        super_admins = list(
            db.scalars(select(User).where(User.role == SUPER_ADMIN_ROLE, User.is_active.is_(True)))
        )
        for super_admin in super_admins:
            enqueue_notification(
                db,
                recipient_user_id=super_admin.id,
                actor_user_id=None,
                notification_type="info",
                title="Nouvelle demande d'entreprise",
                message=(
                    f"{registration_request.company_name} a soumis un dossier de creation "
                    f"avec {registration_request.estimated_phone_lines} lignes declarees."
                ),
                priority="high",
                link_url=f"/admin/company-requests?requestId={registration_request.id}",
                source_type="company_registration_request",
                source_id=str(registration_request.id),
                source_key=f"company-request:{registration_request.id}",
                metadata_json={
                    "request_id": registration_request.id,
                    "company_name": registration_request.company_name,
                    "status": registration_request.status,
                },
            )
        _log_company_registration_step(
            "notifications_enqueued",
            responsible_email=normalized_email,
            request_id=registration_request.id,
            super_admin_count=len(super_admins),
        )

        current_step = "db_commit"
        _log_company_registration_step(
            "db_commit_started",
            responsible_email=normalized_email,
            request_id=registration_request.id,
        )
        try:
            db.commit()
        except SQLAlchemyError as exc:
            _log_sqlalchemy_operation_error(
                current_step,
                exc,
                responsible_email=normalized_email,
                request_id=registration_request.id,
                table="company_registration_requests",
            )
            raise
        _log_company_registration_step(
            "db_commit_completed",
            responsible_email=normalized_email,
            request_id=registration_request.id,
        )
        current_step = "refresh_request"
        db.refresh(registration_request)
        _log_company_registration_step(
            "request_created",
            responsible_email=normalized_email,
            request_id=registration_request.id,
            status=registration_request.status,
        )
        return registration_request
    except Exception:
        _log_company_registration_step(
            "rollback_started",
            responsible_email=normalized_email,
            failed_phase=current_step,
            submission_folder=submission_folder,
        )
        db.rollback()
        logger.exception(
            "event=company_registration_submit_failed step=%s responsible_email=%s company_name=%s submission_folder=%s",
            current_step,
            normalized_email,
            company_name.strip(),
            submission_folder,
        )
        for relative_path in created_files:
            resolve_stored_document_path(relative_path).unlink(missing_ok=True)
        submission_path = (_get_upload_root() / submission_folder)
        if submission_path.exists():
            try:
                submission_path.rmdir()
            except OSError:
                pass
        _log_company_registration_step(
            "rollback_completed",
            responsible_email=normalized_email,
            failed_phase=current_step,
            cleaned_files=created_files,
        )
        raise


def list_company_registration_requests(
    db: Session,
    *,
    offset: int,
    limit: int,
    status_filter: str | None = None,
    search: str | None = None,
    sort_by: str = "date",
    sort_order: str = "desc",
    include_deleted: bool = False,
    deleted_only: bool = False,
) -> tuple[int, list[CompanyRegistrationRequest]]:
    filters = []

    if deleted_only:
        filters.append(CompanyRegistrationRequest.is_deleted.is_(True))
    elif not include_deleted:
        filters.append(CompanyRegistrationRequest.is_deleted.is_(False))

    if status_filter:
        filters.append(CompanyRegistrationRequest.status == status_filter)

    if search:
        normalized_search = f"%{search.strip().lower()}%"
        filters.append(
            or_(
                func.lower(CompanyRegistrationRequest.company_name).like(normalized_search),
                func.lower(CompanyRegistrationRequest.responsible_full_name).like(
                    normalized_search
                ),
                func.lower(CompanyRegistrationRequest.responsible_email).like(normalized_search),
            )
        )

    base_statement = select(CompanyRegistrationRequest)
    count_statement = select(func.count()).select_from(CompanyRegistrationRequest)
    for item in filters:
        base_statement = base_statement.where(item)
        count_statement = count_statement.where(item)

    sort_column = REQUEST_SORT_FIELDS.get(sort_by, CompanyRegistrationRequest.created_at)
    sort_expression = desc(sort_column) if sort_order == "desc" else asc(sort_column)
    statement = (
        base_statement
        .options(*_request_query_options())
        .order_by(sort_expression, CompanyRegistrationRequest.id.desc())
        .offset(offset)
        .limit(limit)
    )

    total = db.scalar(count_statement) or 0
    return total, list(db.scalars(statement))


def build_company_registration_overview(db: Session) -> CompanyRegistrationOverviewRead:
    month_start = datetime.now(UTC).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    stats_rows = db.execute(
        select(
            CompanyRegistrationRequest.status,
            func.count(CompanyRegistrationRequest.id),
        )
        .where(CompanyRegistrationRequest.is_deleted.is_(False))
        .group_by(CompanyRegistrationRequest.status)
    ).all()
    stats_by_status = {status: count for status, count in stats_rows}
    this_month = db.scalar(
        select(func.count(CompanyRegistrationRequest.id)).where(
            CompanyRegistrationRequest.created_at >= month_start,
            CompanyRegistrationRequest.is_deleted.is_(False),
        )
    ) or 0
    total = sum(stats_by_status.values())
    active_companies = db.scalar(
        select(func.count(Company.id)).where(Company.status == COMPANY_STATUS_ACTIVE)
    ) or 0
    suspended_companies = db.scalar(
        select(func.count(Company.id)).where(Company.status == COMPANY_STATUS_SUSPENDED)
    ) or 0
    total_users = db.scalar(select(func.count(User.id))) or 0
    connections = db.scalar(select(func.count(User.id)).where(User.last_login_at.is_not(None))) or 0

    recent_companies = list(
        db.scalars(
            select(Company)
            .options(*_company_query_options())
            .order_by(Company.created_at.desc(), Company.id.desc())
            .limit(6)
        )
    )
    recent_company_admins = list(
        db.scalars(
            select(User)
            .options(selectinload(User.company))
            .where(
                User.id.in_(
                    select(CompanyRegistrationRequest.approved_admin_user_id).where(
                        CompanyRegistrationRequest.approved_admin_user_id.is_not(None)
                    )
                )
            )
            .order_by(User.created_at.desc(), User.id.desc())
            .limit(6)
        )
    )
    operator_totals: dict[str, int] = {}
    companies_for_distribution = list(
        db.scalars(
            select(Company)
            .where(Company.status != COMPANY_STATUS_DELETED)
            .order_by(Company.id.asc())
        )
    )
    for company in companies_for_distribution:
        for operator in deserialize_string_list(company.operators_json):
            operator_totals[operator] = operator_totals.get(operator, 0) + 1

    return CompanyRegistrationOverviewRead(
        stats=CompanyRegistrationStatsRead(
            pending=stats_by_status.get(REQUEST_STATUS_PENDING, 0),
            under_review=stats_by_status.get(REQUEST_STATUS_UNDER_REVIEW, 0),
            approved=stats_by_status.get(REQUEST_STATUS_APPROVED, 0),
            rejected=stats_by_status.get(REQUEST_STATUS_REJECTED, 0),
            this_month=this_month,
            total=total,
            active_companies=active_companies,
            total_users=total_users,
            suspended_companies=suspended_companies,
            connections=connections,
        ),
        operator_distribution=[
            CompanyOperatorDistributionRead(operator=operator, total=total_count)
            for operator, total_count in sorted(
                operator_totals.items(),
                key=lambda item: (-item[1], item[0].lower()),
            )
        ],
        recent_companies=[_build_company_summary(company) for company in recent_companies],
        recent_company_admins=[
            _build_company_admin_summary(user)
            for user in recent_company_admins
        ],
    )


def approve_company_registration_request(
    db: Session,
    registration_request: CompanyRegistrationRequest,
    *,
    reviewer: User,
) -> CompanyRegistrationRequest:
    if normalize_role(reviewer.role) != SUPER_ADMIN_ROLE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only super administrators can approve registration requests",
        )

    _ensure_request_is_not_deleted(
        registration_request,
        detail="Deleted requests cannot be approved",
    )
    validate_status_transition(
        registration_request.status,
        REQUEST_STATUS_APPROVED,
    )
    _ensure_no_other_active_request_exists(db, registration_request)
    _validate_required_request_fields(registration_request)
    _validate_request_documents_available(registration_request)

    normalized_email = normalize_company_request_email(registration_request.responsible_email)
    existing_active_user = db.scalar(
        select(User).where(
            func.lower(User.email) == normalized_email,
            User.is_active.is_(True),
            func.lower(func.coalesce(User.account_status, "active")) == "active",
        )
    )
    if existing_active_user is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Un compte actif existe deja avec cet email.",
        )

    if db.scalar(select(User).where(func.lower(User.email) == normalized_email)) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Un utilisateur existe deja avec cet email.",
        )

    duplicate_company_filters = [func.lower(Company.name) == registration_request.company_name.lower()]
    if registration_request.ice:
        duplicate_company_filters.append(Company.ice == registration_request.ice)
    if registration_request.rc:
        duplicate_company_filters.append(Company.rc == registration_request.rc)

    existing_company = db.scalar(select(Company).where(or_(*duplicate_company_filters)))
    if existing_company is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Une entreprise existe deja avec les informations fournies",
        )

    company = Company(
        name=registration_request.company_name,
        join_code=None,
        sector=registration_request.sector,
        city=registration_request.city,
        address_line=registration_request.address_line,
        region=registration_request.region,
        postal_code=registration_request.postal_code,
        country=registration_request.country,
        phone=registration_request.company_phone,
        ice=registration_request.ice,
        rc=registration_request.rc,
        tax_id=registration_request.tax_id,
        cnss=registration_request.cnss,
        patente=registration_request.patente,
        website=registration_request.website,
        logo_path=registration_request.logo_path,
        status=COMPANY_STATUS_ACTIVE,
        estimated_phone_lines=registration_request.estimated_phone_lines,
        employees_count=registration_request.employees_count,
        operators_json=registration_request.operators_json,
        coverage_zones_json=registration_request.coverage_zones_json,
    )
    db.add(company)
    db.flush()
    ensure_company_join_code(db, company)

    requested_role_label = get_requested_role_label(registration_request.requested_role)
    requested_user_role = get_requested_role_user_role(registration_request.requested_role)
    must_force_company_admin = (
        requested_user_role != COMPANY_ADMIN_ROLE and not company_has_admin_account(db, company.id)
    )
    effective_user_role = (
        COMPANY_ADMIN_ROLE if must_force_company_admin else requested_user_role
    )
    provisioned_role_label = (
        "Administrateur"
        if effective_user_role == COMPANY_ADMIN_ROLE
        else requested_role_label
    )
    approved_user = User(
        full_name=registration_request.responsible_full_name,
        email=registration_request.responsible_email,
        hashed_password=registration_request.password_hash,
        role=effective_user_role,
        company_id=company.id,
        job_profile=registration_request.job_title,
        is_active=True,
        account_status="active",
    )
    db.add(approved_user)
    db.flush()

    previous_status = registration_request.status
    was_reopened = previous_status == REQUEST_STATUS_UNDER_REVIEW

    registration_request.status = REQUEST_STATUS_APPROVED
    registration_request.rejection_reason = None
    registration_request.reviewed_by = reviewer.id
    registration_request.reviewed_at = datetime.now(UTC)
    registration_request.approved_company_id = company.id
    registration_request.approved_admin_user_id = approved_user.id

    for document in registration_request.documents:
        document.company_id = company.id
        db.add(document)

    _record_company_history(
        db,
        request_id=registration_request.id,
        company_id=company.id,
        actor_user_id=reviewer.id,
        action=(
            "REQUEST_APPROVED_AFTER_REOPENING"
            if was_reopened
            else "request_approved"
        ),
        title="Demande approuvee",
        previous_status=previous_status,
        next_status=REQUEST_STATUS_APPROVED,
        comment=(
            "Entreprise creee, workspace active et premier compte "
            f"{provisioned_role_label.lower()} provisionne."
            + (
                f" Role demande initial conserve: {requested_role_label.lower()}."
                if must_force_company_admin
                else ""
            )
        ),
        metadata={
            "company_id": company.id,
            "approved_user_id": approved_user.id,
            "approved_user_role": approved_user.role,
            "requested_role": registration_request.requested_role,
            "requested_user_role": requested_user_role,
            "first_account_forced_admin": must_force_company_admin,
            "join_code": company.join_code,
            "action_type": (
                "REQUEST_APPROVED_AFTER_REOPENING"
                if was_reopened
                else "REQUEST_APPROVED"
            ),
        },
    )
    _record_company_history(
        db,
        company_id=company.id,
        actor_user_id=reviewer.id,
        action="company_activated",
        title="Entreprise activee",
        previous_status=None,
        next_status=COMPANY_STATUS_ACTIVE,
        comment=(
            "Validation initiale du tenant entreprise et creation du premier compte "
            f"{provisioned_role_label.lower()}."
        ),
        metadata={
            "request_id": registration_request.id,
            "approved_user_id": approved_user.id,
            "approved_user_role": approved_user.role,
            "requested_role": registration_request.requested_role,
            "first_account_forced_admin": must_force_company_admin,
        },
    )

    enqueue_notification(
        db,
        recipient_user_id=approved_user.id,
        actor_user_id=reviewer.id,
        notification_type="success",
        title="Votre entreprise est active",
        message=(
            f"L'espace {company.name} est actif. Connectez-vous pour finaliser votre workspace."
        ),
        priority="high",
        link_url="/dashboard",
        source_type="company_approval",
        source_id=str(company.id),
        source_key=f"company-approved:{company.id}",
        metadata_json={
            "request_id": registration_request.id,
            "company_id": company.id,
            "requested_role": registration_request.requested_role,
            "effective_user_role": approved_user.role,
            "first_account_forced_admin": must_force_company_admin,
            "join_code": company.join_code,
        },
    )

    db.add(company)
    db.add(approved_user)
    db.add(registration_request)
    db.commit()
    db.refresh(registration_request)

    _send_approval_email(registration_request, approved_user.email, company.join_code)
    return get_request_or_404(db, registration_request.id)


def reject_company_registration_request(
    db: Session,
    registration_request: CompanyRegistrationRequest,
    *,
    reviewer: User,
    rejection_reason: str,
) -> CompanyRegistrationRequest:
    if normalize_role(reviewer.role) != SUPER_ADMIN_ROLE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only super administrators can reject registration requests",
        )

    _ensure_request_is_not_deleted(
        registration_request,
        detail="Deleted requests cannot be rejected",
    )
    previous_status = registration_request.status
    validate_status_transition(
        previous_status,
        REQUEST_STATUS_REJECTED,
    )
    registration_request.status = REQUEST_STATUS_REJECTED
    registration_request.rejection_reason = rejection_reason.strip()
    registration_request.reviewed_by = reviewer.id
    registration_request.reviewed_at = datetime.now(UTC)
    _record_company_history(
        db,
        request_id=registration_request.id,
        actor_user_id=reviewer.id,
        action="request_rejected",
        title="Demande refusee",
        previous_status=previous_status,
        next_status=REQUEST_STATUS_REJECTED,
        comment=registration_request.rejection_reason,
        metadata={
            "request_id": registration_request.id,
            "responsible_email": registration_request.responsible_email,
            "company_name": registration_request.company_name,
            "admin_id": reviewer.id,
            "action_type": "REQUEST_REJECTED",
        },
    )
    db.add(registration_request)
    db.commit()
    db.refresh(registration_request)

    _send_rejection_email(registration_request)
    return get_request_or_404(db, registration_request.id)


def reopen_company_registration_request(
    db: Session,
    registration_request: CompanyRegistrationRequest,
    *,
    reviewer: User,
    reason: str,
) -> CompanyRegistrationRequest:
    if normalize_role(reviewer.role) != SUPER_ADMIN_ROLE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only super administrators can reopen registration requests",
        )

    _ensure_request_is_not_deleted(
        registration_request,
        detail="Deleted requests cannot be reopened",
    )
    validate_status_transition(
        registration_request.status,
        REQUEST_STATUS_UNDER_REVIEW,
    )
    _ensure_no_other_active_request_exists(db, registration_request)

    normalized_reason = reason.strip()
    registration_request.status = REQUEST_STATUS_UNDER_REVIEW
    registration_request.rejection_reason = None
    registration_request.reviewed_by = reviewer.id
    registration_request.reviewed_at = datetime.now(UTC)

    _record_company_history(
        db,
        request_id=registration_request.id,
        actor_user_id=reviewer.id,
        action="REQUEST_REOPENED",
        title="Demande rouverte",
        previous_status=REQUEST_STATUS_REJECTED,
        next_status=REQUEST_STATUS_UNDER_REVIEW,
        comment=normalized_reason,
        metadata={
            "request_id": registration_request.id,
            "responsible_email": registration_request.responsible_email,
            "company_name": registration_request.company_name,
            "old_status": REQUEST_STATUS_REJECTED,
            "new_status": REQUEST_STATUS_UNDER_REVIEW,
            "reason": normalized_reason,
            "admin_id": reviewer.id,
            "action_type": "REQUEST_REOPENED",
            "reopened_at": registration_request.reviewed_at.isoformat(),
        },
    )
    db.add(registration_request)
    db.commit()
    db.refresh(registration_request)

    _send_reopen_email(registration_request, normalized_reason)
    return get_request_or_404(db, registration_request.id)


def request_more_company_registration_information(
    db: Session,
    registration_request: CompanyRegistrationRequest,
    *,
    reviewer: User,
    comment: str,
) -> CompanyRegistrationRequest:
    if normalize_role(reviewer.role) != SUPER_ADMIN_ROLE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only super administrators can review registration requests",
        )

    _ensure_request_is_not_deleted(
        registration_request,
        detail="Deleted requests cannot receive a complementary information request",
    )
    if registration_request.status not in APPROVABLE_REQUEST_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only active review requests can receive a complementary information request",
        )

    normalized_comment = comment.strip()
    registration_request.reviewed_by = reviewer.id
    registration_request.reviewed_at = datetime.now(UTC)
    _record_company_history(
        db,
        request_id=registration_request.id,
        actor_user_id=reviewer.id,
        action="information_requested",
        title="Informations complementaires demandees",
        previous_status=REQUEST_STATUS_PENDING,
        next_status=REQUEST_STATUS_PENDING,
        comment=normalized_comment,
    )
    db.add(registration_request)
    db.commit()
    db.refresh(registration_request)

    _send_information_request_email(registration_request, normalized_comment)
    return get_request_or_404(db, registration_request.id)


def build_submission_response_message(
    registration_request: CompanyRegistrationRequest,
) -> str:
    previous_request = registration_request.previous_request
    if previous_request is None:
        return "Votre demande a ete envoyee. Elle sera examinee par l'administrateur."

    if previous_request.status == REQUEST_STATUS_REJECTED and not previous_request.is_deleted:
        return (
            "Une precedente demande associee a cet email a ete refusee. "
            "Vous pouvez creer un nouveau dossier corrige. Votre nouveau dossier a bien ete recu "
            "et sera reexamine."
        )

    return "Votre nouveau dossier a bien ete recu et sera reexamine."


def soft_delete_request(
    db: Session,
    registration_request: CompanyRegistrationRequest,
    *,
    reviewer: User,
    force: bool = False,
    reason: str | None = None,
) -> CompanyRegistrationRequest:
    if normalize_role(reviewer.role) != SUPER_ADMIN_ROLE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only super administrators can delete registration requests",
        )

    if registration_request.is_deleted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cette demande est deja supprimee.",
        )

    if registration_request.status == REQUEST_STATUS_APPROVED and (
        registration_request.approved_company_id is not None
        or registration_request.approved_admin_user_id is not None
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Impossible de supprimer une demande approuvee liee a une entreprise active. "
                "Suspendez ou archivez d'abord l'entreprise."
            ),
        )

    if registration_request.status == REQUEST_STATUS_PENDING and not force:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La suppression d'une demande en attente necessite une confirmation renforcee.",
        )

    if registration_request.status not in {REQUEST_STATUS_PENDING, REQUEST_STATUS_REJECTED}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Seules les demandes en attente ou refusees peuvent etre supprimees.",
        )

    registration_request.is_deleted = True
    registration_request.deleted_at = datetime.now(UTC)
    registration_request.deleted_by = reviewer.id
    _record_company_history(
        db,
        request_id=registration_request.id,
        actor_user_id=reviewer.id,
        action="request_deleted",
        title="Demande supprimee",
        previous_status=registration_request.status,
        next_status=registration_request.status,
        comment=(reason or "").strip() or None,
        metadata={
            "request_id": registration_request.id,
            "responsible_email": registration_request.responsible_email,
            "company_name": registration_request.company_name,
            "deleted_by": reviewer.id,
            "deleted_at": registration_request.deleted_at.isoformat(),
            "action_type": "REQUEST_DELETED",
        },
    )
    db.add(registration_request)
    db.commit()
    db.refresh(registration_request)
    return get_request_or_404(db, registration_request.id)


def restore_request(
    db: Session,
    registration_request: CompanyRegistrationRequest,
    *,
    reviewer: User,
    reason: str | None = None,
) -> CompanyRegistrationRequest:
    if normalize_role(reviewer.role) != SUPER_ADMIN_ROLE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only super administrators can restore registration requests",
        )

    if not registration_request.is_deleted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cette demande n'est pas dans la corbeille.",
        )

    if registration_request.status in ACTIVE_REQUEST_EMAIL_STATUSES:
        if find_active_request_by_email(
            db,
            registration_request.responsible_email,
            exclude_request_id=registration_request.id,
        ) is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Une demande active existe deja pour cet email.",
            )
        if db.scalar(
            select(User).where(
                func.lower(User.email)
                == normalize_company_request_email(registration_request.responsible_email),
                User.is_active.is_(True),
                func.lower(func.coalesce(User.account_status, "active")) == "active",
            )
        ) is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Un compte actif existe deja avec cet email.",
            )

    registration_request.is_deleted = False
    registration_request.deleted_at = None
    registration_request.deleted_by = None
    _record_company_history(
        db,
        request_id=registration_request.id,
        actor_user_id=reviewer.id,
        action="request_restored",
        title="Demande restauree",
        previous_status=registration_request.status,
        next_status=registration_request.status,
        comment=(reason or "").strip() or None,
        metadata={
            "request_id": registration_request.id,
            "responsible_email": registration_request.responsible_email,
            "company_name": registration_request.company_name,
            "restored_by": reviewer.id,
            "action_type": "REQUEST_RESTORED",
        },
    )
    db.add(registration_request)
    db.commit()
    db.refresh(registration_request)
    return get_request_or_404(db, registration_request.id)


def _send_approval_email(
    registration_request: CompanyRegistrationRequest,
    login_email: str,
    join_code: str | None,
) -> None:
    settings = get_settings()
    login_url = f"{settings.frontend_url.rstrip('/')}/login"
    join_code_block = (
        f"\nCode entreprise :\n{join_code}\n\n"
        if join_code
        else "\n"
    )
    join_code_html = (
        f"<p><strong>Code entreprise :</strong> {join_code}</p>"
        if join_code
        else ""
    )
    text_body = (
        f"Bonjour {registration_request.responsible_full_name},\n\n"
        f"Votre demande d'inscription pour l'entreprise {registration_request.company_name} "
        "a ete acceptee.\n\n"
        f"Vous pouvez maintenant vous connecter a FleetConnect IA avec votre email professionnel:\n\n"
        f"{login_email}\n\n"
        f"{join_code_block}"
        f"Lien de connexion:\n{login_url}\n\n"
        "Cordialement,\nEquipe FleetConnect IA"
    )
    html_body = (
        f"<p>Bonjour {registration_request.responsible_full_name},</p>"
        f"<p>Votre demande d'inscription pour l'entreprise "
        f"<strong>{registration_request.company_name}</strong> a ete acceptee.</p>"
        "<p>Vous pouvez maintenant vous connecter a FleetConnect IA avec votre email professionnel :</p>"
        f"<p><strong>{login_email}</strong></p>"
        f"{join_code_html}"
        f"<p><a href=\"{login_url}\">Acceder a la page de connexion</a></p>"
        "<p>Cordialement,<br/>Equipe FleetConnect IA</p>"
    )
    _send_email_safely(
        to_email=registration_request.responsible_email,
        subject="Votre compte FleetConnect IA est active",
        text_body=text_body,
        html_body=html_body,
    )


def _send_rejection_email(registration_request: CompanyRegistrationRequest) -> None:
    text_body = (
        f"Bonjour {registration_request.responsible_full_name},\n\n"
        f"Votre demande d'inscription pour l'entreprise {registration_request.company_name} "
        "n'a pas pu etre validee.\n\n"
        f"Raison :\n{registration_request.rejection_reason or 'Non precisee'}\n\n"
        "Vous pouvez corriger les informations et soumettre une nouvelle demande.\n\n"
        "Cordialement,\nEquipe FleetConnect IA"
    )
    html_body = (
        f"<p>Bonjour {registration_request.responsible_full_name},</p>"
        f"<p>Votre demande d'inscription pour l'entreprise "
        f"<strong>{registration_request.company_name}</strong> n'a pas pu etre validee.</p>"
        f"<p><strong>Raison :</strong> {registration_request.rejection_reason or 'Non precisee'}</p>"
        "<p>Vous pouvez corriger les informations et soumettre une nouvelle demande.</p>"
        "<p>Cordialement,<br/>Equipe FleetConnect IA</p>"
    )
    _send_email_safely(
        to_email=registration_request.responsible_email,
        subject="Demande d'inscription FleetConnect IA refusee",
        text_body=text_body,
        html_body=html_body,
    )


def _send_information_request_email(
    registration_request: CompanyRegistrationRequest,
    comment: str,
) -> None:
    text_body = (
        f"Bonjour {registration_request.responsible_full_name},\n\n"
        f"Votre demande d'inscription pour l'entreprise {registration_request.company_name} "
        "necessite des informations complementaires.\n\n"
        f"Commentaire du super administrateur :\n{comment}\n\n"
        "Vous pouvez mettre a jour votre dossier puis le soumettre a nouveau.\n\n"
        "Cordialement,\nEquipe FleetConnect IA"
    )
    html_body = (
        f"<p>Bonjour {registration_request.responsible_full_name},</p>"
        f"<p>Votre demande d'inscription pour l'entreprise "
        f"<strong>{registration_request.company_name}</strong> necessite des informations complementaires.</p>"
        f"<p><strong>Commentaire du super administrateur :</strong> {comment}</p>"
        "<p>Vous pouvez mettre a jour votre dossier puis le soumettre a nouveau.</p>"
        "<p>Cordialement,<br/>Equipe FleetConnect IA</p>"
    )
    _send_email_safely(
        to_email=registration_request.responsible_email,
        subject="Informations complementaires requises pour votre demande FleetConnect IA",
        text_body=text_body,
        html_body=html_body,
    )


def _send_reopen_email(
    registration_request: CompanyRegistrationRequest,
    reason: str,
) -> None:
    text_body = (
        f"Bonjour {registration_request.responsible_full_name},\n\n"
        f"Votre demande de creation d'entreprise pour {registration_request.company_name} "
        "a ete rouverte par notre equipe.\n\n"
        "Elle est actuellement en cours de reexamen.\n\n"
        f"Motif :\n{reason}\n\n"
        "Vous serez informe de la decision finale.\n\n"
        "Cordialement,\nEquipe FleetConnect IA"
    )
    html_body = (
        f"<p>Bonjour {registration_request.responsible_full_name},</p>"
        f"<p>Votre demande de creation d'entreprise pour "
        f"<strong>{registration_request.company_name}</strong> a ete rouverte par notre equipe.</p>"
        "<p>Elle est actuellement en cours de reexamen.</p>"
        f"<p><strong>Motif :</strong> {reason}</p>"
        "<p>Vous serez informe de la decision finale.</p>"
        "<p>Cordialement,<br/>Equipe FleetConnect IA</p>"
    )
    _send_email_safely(
        to_email=registration_request.responsible_email,
        subject="Votre demande FleetConnect IA est de nouveau en cours d'examen",
        text_body=text_body,
        html_body=html_body,
    )


def _send_email_safely(*, to_email: str, subject: str, text_body: str, html_body: str) -> None:
    try:
        send_email(
            to_email=to_email,
            subject=subject,
            text_body=text_body,
            html_body=html_body,
        )
    except EmailDeliveryError as exc:
        logger.warning("company_registration_email_failed to=%s reason=%s", to_email, exc)


def build_request_summary(
    registration_request: CompanyRegistrationRequest,
) -> CompanyRegistrationRequestSummaryRead:
    operators = deserialize_string_list(registration_request.operators_json)
    return CompanyRegistrationRequestSummaryRead(
        id=registration_request.id,
        responsible_full_name=registration_request.responsible_full_name,
        responsible_email=registration_request.responsible_email,
        responsible_phone=registration_request.responsible_phone,
        job_title=registration_request.job_title,
        requested_role=normalize_requested_role(registration_request.requested_role),
        requested_role_label=get_requested_role_label(registration_request.requested_role),
        company_name=registration_request.company_name,
        sector=registration_request.sector,
        city=registration_request.city,
        address_line=registration_request.address_line,
        region=registration_request.region,
        postal_code=registration_request.postal_code,
        country=registration_request.country,
        company_phone=registration_request.company_phone,
        ice=registration_request.ice,
        rc=registration_request.rc,
        primary_operator=get_primary_operator(operators),
        estimated_phone_lines=registration_request.estimated_phone_lines,
        employees_count=registration_request.employees_count,
        operators=operators,
        status=registration_request.status,
        is_deleted=registration_request.is_deleted,
        deleted_at=registration_request.deleted_at,
        deleted_by_user_id=registration_request.deleted_by,
        deleted_by_name=(
            registration_request.deleter.full_name
            if registration_request.deleter is not None
            else None
        ),
        previous_request_id=registration_request.previous_request_id,
        resubmission_number=registration_request.resubmission_number,
        reviewed_at=registration_request.reviewed_at,
        created_at=registration_request.created_at,
        updated_at=registration_request.updated_at,
    )


def build_request_detail(
    registration_request: CompanyRegistrationRequest,
    *,
    api_prefix: str,
) -> CompanyRegistrationRequestDetailRead:
    summary = build_request_summary(registration_request)
    history_entries = sorted(
        registration_request.history_entries,
        key=lambda entry: (entry.created_at, entry.id),
        reverse=True,
    )
    approved_admin_email = (
        registration_request.approved_admin_user.email
        if registration_request.approved_admin_user is not None
        else None
    )
    return CompanyRegistrationRequestDetailRead(
        **summary.model_dump(),
        tax_id=registration_request.tax_id,
        cnss=registration_request.cnss,
        patente=registration_request.patente,
        website=registration_request.website,
        latitude=registration_request.latitude,
        longitude=registration_request.longitude,
        coverage_zones=deserialize_string_list(registration_request.coverage_zones_json),
        documents=_build_request_documents(registration_request, api_prefix=api_prefix),
        history=[_build_history_read(entry) for entry in history_entries],
        decision=CompanyRegistrationDecisionRead(
            status=registration_request.status,
            rejection_reason=registration_request.rejection_reason,
            reviewed_at=registration_request.reviewed_at,
            reviewed_by_user_id=registration_request.reviewed_by,
            reviewed_by_name=(
                registration_request.reviewer.full_name
                if registration_request.reviewer is not None
                else None
            ),
        ),
        approved_company_id=registration_request.approved_company_id,
        approved_company_name=(
            registration_request.approved_company.name
            if registration_request.approved_company is not None
            else None
        ),
        approved_admin_user_id=registration_request.approved_admin_user_id,
        approved_admin_email=approved_admin_email,
    )


def guess_document_media_type(relative_path: str) -> str:
    return mimetypes.guess_type(relative_path)[0] or "application/octet-stream"


def get_company_by_id(db: Session, company_id: int) -> Company | None:
    statement = select(Company).options(*_company_query_options()).where(Company.id == company_id)
    return db.scalar(statement)


def get_company_or_404(db: Session, company_id: int) -> Company:
    company = get_company_by_id(db, company_id)
    if company is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Company not found",
        )
    return company


def list_companies(
    db: Session,
    *,
    offset: int,
    limit: int,
    search: str | None = None,
    status_filter: CompanyLifecycleStatus | None = None,
    sort_by: str = "date",
    sort_order: str = "desc",
) -> tuple[int, list[Company]]:
    filters = []
    if status_filter:
        filters.append(Company.status == status_filter)
    if search:
        normalized_search = f"%{search.strip().lower()}%"
        filters.append(
            or_(
                func.lower(Company.name).like(normalized_search),
                func.lower(Company.city).like(normalized_search),
                func.lower(func.coalesce(Company.country, "")).like(normalized_search),
                func.lower(func.coalesce(Company.join_code, "")).like(normalized_search),
            )
        )

    base_statement = select(Company)
    count_statement = select(func.count()).select_from(Company)
    for item in filters:
        base_statement = base_statement.where(item)
        count_statement = count_statement.where(item)

    sort_column = COMPANY_SORT_FIELDS.get(sort_by, Company.created_at)
    sort_expression = desc(sort_column) if sort_order == "desc" else asc(sort_column)
    statement = (
        base_statement
        .options(*_company_query_options())
        .order_by(sort_expression, Company.id.desc())
        .offset(offset)
        .limit(limit)
    )
    total = db.scalar(count_statement) or 0
    return total, list(db.scalars(statement))


def build_company_list_response(
    companies: list[Company],
    *,
    total: int,
    offset: int,
    limit: int,
    api_prefix: str,
) -> CompanyListResponse:
    return CompanyListResponse(
        total=total,
        offset=offset,
        limit=limit,
        items=[_build_company_list_item(company, api_prefix=api_prefix) for company in companies],
    )


def build_company_dashboard(
    company: Company,
    *,
    api_prefix: str,
) -> CompanyDashboardRead:
    company_item = _build_company_list_item(company, api_prefix=api_prefix)
    admins = [
        _build_company_admin_summary(user)
        for user in sorted(
            company.users,
            key=lambda user: (normalize_role(user.role) != COMPANY_ADMIN_ROLE, user.full_name.lower()),
        )
    ]
    history_entries = sorted(
        company.history_entries,
        key=lambda entry: (entry.created_at, entry.id),
        reverse=True,
    )
    return CompanyDashboardRead(
        company=company_item,
        metrics=CompanyDashboardMetricsRead(
            total_users=company_item.user_count,
            active_users=company_item.active_user_count,
            suspended_users=company_item.suspended_user_count,
            pending_users=company_item.pending_user_count,
            admin_users=company_item.admin_count,
            estimated_phone_lines=company_item.estimated_phone_lines,
            employees_count=company_item.employees_count,
            operators_count=len(company_item.operators),
        ),
        admins=admins,
        history=[_build_history_read(entry) for entry in history_entries],
    )


def list_company_audit_logs(
    db: Session,
    *,
    offset: int,
    limit: int,
    action_filter: str | None = None,
    search: str | None = None,
) -> CompanyAuditLogListResponse:
    statement = select(CompanyStatusHistory).options(selectinload(CompanyStatusHistory.actor_user))
    count_statement = select(func.count()).select_from(CompanyStatusHistory)

    if action_filter:
        statement = statement.where(CompanyStatusHistory.action == action_filter)
        count_statement = count_statement.where(CompanyStatusHistory.action == action_filter)

    if search:
        normalized_search = f"%{search.strip().lower()}%"
        statement = statement.where(
            or_(
                func.lower(CompanyStatusHistory.title).like(normalized_search),
                func.lower(func.coalesce(CompanyStatusHistory.comment, "")).like(
                    normalized_search
                ),
            )
        )
        count_statement = count_statement.where(
            or_(
                func.lower(CompanyStatusHistory.title).like(normalized_search),
                func.lower(func.coalesce(CompanyStatusHistory.comment, "")).like(
                    normalized_search
                ),
            )
        )

    statement = statement.order_by(
        CompanyStatusHistory.created_at.desc(),
        CompanyStatusHistory.id.desc(),
    ).offset(offset).limit(limit)
    items = list(db.scalars(statement))
    total = db.scalar(count_statement) or 0
    return CompanyAuditLogListResponse(
        total=total,
        offset=offset,
        limit=limit,
        items=[_build_history_read(item) for item in items],
    )
