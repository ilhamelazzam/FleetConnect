from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.roles import normalize_role
from app.core.security import hash_password
from app.models.company import Company
from app.models.fleet_access import Department
from app.models.user import User
from app.schemas.user import UserCreate, UserUpdate

ACTIVE_ACCOUNT_STATUS = "active"
PENDING_ACCOUNT_STATUS = "pending"
SUSPENDED_ACCOUNT_STATUS = "suspended"
REJECTED_ACCOUNT_STATUS = "rejected"


def _normalize_account_status(
    *,
    requested_status: str | None,
    is_active: bool | None,
) -> str:
    normalized_status = (requested_status or "").strip().lower()
    if normalized_status in {
        ACTIVE_ACCOUNT_STATUS,
        PENDING_ACCOUNT_STATUS,
        SUSPENDED_ACCOUNT_STATUS,
        REJECTED_ACCOUNT_STATUS,
    }:
        return normalized_status

    if is_active is False:
        return SUSPENDED_ACCOUNT_STATUS

    return ACTIVE_ACCOUNT_STATUS


def list_users(
    db: Session,
    *,
    offset: int = 0,
    limit: int = 50,
    search: str | None = None,
    role: str | None = None,
    user_status: str | None = None,
    department_id: int | None = None,
    company_id: int | None = None,
) -> list[User]:
    statement = select(User).options(selectinload(User.department), selectinload(User.company))

    if search:
        normalized_search = f"%{search.strip().lower()}%"
        statement = statement.outerjoin(Department, User.department_id == Department.id).where(
            or_(
                func.lower(User.full_name).like(normalized_search),
                func.lower(User.email).like(normalized_search),
                func.lower(func.coalesce(User.job_profile, "")).like(normalized_search),
                func.lower(func.coalesce(Department.name, "")).like(normalized_search),
            )
        )

    if role:
        statement = statement.where(User.role == normalize_role(role))

    if user_status:
        statement = statement.where(User.account_status == user_status)

    if department_id is not None:
        statement = statement.where(User.department_id == department_id)

    if company_id is not None:
        statement = statement.where(User.company_id == company_id)

    statement = statement.order_by(User.created_at.desc(), User.id.desc()).offset(offset).limit(limit)
    return list(db.scalars(statement))


def get_user_by_id(db: Session, user_id: int) -> User | None:
    statement = (
        select(User)
        .options(selectinload(User.department), selectinload(User.company))
        .where(User.id == user_id)
    )
    return db.scalar(statement)


def get_user_by_email(db: Session, email: str) -> User | None:
    return db.scalar(select(User).where(User.email == email.lower().strip()))


def _ensure_department_exists(db: Session, department_id: int | None) -> None:
    if department_id is None:
        return

    if db.get(Department, department_id) is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Department not found",
        )


def _ensure_company_exists(db: Session, company_id: int | None) -> None:
    if company_id is None:
        return

    if db.get(Company, company_id) is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Company not found",
        )


def create_user(db: Session, payload: UserCreate) -> User:
    _ensure_company_exists(db, payload.company_id)
    _ensure_department_exists(db, payload.department_id)

    user = User(
        full_name=payload.full_name.strip(),
        email=str(payload.email).lower().strip(),
        hashed_password=hash_password(payload.password),
        photo_url=(payload.photo_url.strip() or None) if payload.photo_url else None,
        phone=(payload.phone.strip() or None) if payload.phone else None,
        role=normalize_role(payload.role),
        company_id=payload.company_id,
        department_id=payload.department_id,
        requested_department=(
            payload.requested_department.strip() or None
            if payload.requested_department
            else None
        ),
        job_profile=(payload.job_profile.strip() or None) if payload.job_profile else None,
        is_active=payload.is_active,
        account_status=_normalize_account_status(
            requested_status=payload.account_status,
            is_active=payload.is_active,
        ),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def update_user(db: Session, user: User, payload: UserUpdate) -> User:
    data = payload.model_dump(exclude_unset=True)

    if "full_name" in data and data["full_name"] is not None:
        user.full_name = data["full_name"].strip()
    if "email" in data and data["email"] is not None:
        user.email = str(data["email"]).lower().strip()
    if "photo_url" in data:
        user.photo_url = (data["photo_url"].strip() or None) if data["photo_url"] else None
    if "phone" in data:
        user.phone = (data["phone"].strip() or None) if data["phone"] else None
    if "role" in data and data["role"] is not None:
        user.role = normalize_role(data["role"])
    if "company_id" in data:
        _ensure_company_exists(db, data["company_id"])
        user.company_id = data["company_id"]
    if "department_id" in data:
        _ensure_department_exists(db, data["department_id"])
        user.department_id = data["department_id"]
    if "requested_department" in data:
        user.requested_department = (
            data["requested_department"].strip() or None
            if data["requested_department"]
            else None
        )
    if "job_profile" in data:
        user.job_profile = (data["job_profile"].strip() or None) if data["job_profile"] else None
    if "is_active" in data and data["is_active"] is not None:
        user.is_active = data["is_active"]
        user.account_status = _normalize_account_status(
            requested_status=data.get("account_status"),
            is_active=data["is_active"],
        )
    if "account_status" in data and data["account_status"] is not None:
        user.account_status = _normalize_account_status(
            requested_status=data["account_status"],
            is_active=data.get("is_active"),
        )
        user.is_active = user.account_status == ACTIVE_ACCOUNT_STATUS
    if "password" in data and data["password"]:
        user.hashed_password = hash_password(data["password"])

    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def delete_user(db: Session, user: User) -> None:
    db.delete(user)
    db.commit()


def set_user_active_state(db: Session, user: User, is_active: bool) -> User:
    return set_user_account_status(
        db,
        user,
        ACTIVE_ACCOUNT_STATUS if is_active else SUSPENDED_ACCOUNT_STATUS,
    )


def set_user_account_status(db: Session, user: User, account_status: str) -> User:
    normalized_status = _normalize_account_status(
        requested_status=account_status,
        is_active=account_status == ACTIVE_ACCOUNT_STATUS,
    )
    user.account_status = normalized_status
    user.is_active = normalized_status == ACTIVE_ACCOUNT_STATUS
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def set_user_role(db: Session, user: User, role: str) -> User:
    user.role = normalize_role(role)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def update_user_password(db: Session, user: User, password: str) -> User:
    user.hashed_password = hash_password(password)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user
