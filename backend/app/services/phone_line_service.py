from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.phone_line import PhoneLine
from app.schemas.phone_line import PhoneLineCreate, PhoneLineUpdate


def list_phone_lines(db: Session, *, offset: int = 0, limit: int = 50) -> list[PhoneLine]:
    statement = (
        select(PhoneLine)
        .order_by(PhoneLine.created_at.desc(), PhoneLine.id.desc())
        .offset(offset)
        .limit(limit)
    )
    return list(db.scalars(statement))


def get_phone_line_stats(db: Session) -> dict[str, int]:
    now = datetime.now(UTC)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    next_month_start = (
        month_start.replace(year=month_start.year + 1, month=1)
        if month_start.month == 12
        else month_start.replace(month=month_start.month + 1)
    )

    total = db.scalar(select(func.count()).select_from(PhoneLine)) or 0
    created_this_month = db.scalar(
        select(func.count())
        .select_from(PhoneLine)
        .where(
            PhoneLine.created_at >= month_start,
            PhoneLine.created_at < next_month_start,
        ),
    ) or 0

    return {
        "total": int(total),
        "created_this_month": int(created_this_month),
    }


def get_phone_line(db: Session, phone_line_id: int) -> PhoneLine | None:
    return db.get(PhoneLine, phone_line_id)


def get_phone_line_by_number(db: Session, phone_number: str) -> PhoneLine | None:
    statement = select(PhoneLine).where(PhoneLine.phone_number == phone_number.strip())
    return db.scalar(statement)


def create_phone_line(db: Session, payload: PhoneLineCreate) -> PhoneLine:
    phone_line = PhoneLine(
        phone_number=payload.phone_number.strip(),
        operator_name=payload.operator_name.strip(),
        plan_name=payload.plan_name.strip(),
        assigned_to=payload.assigned_to.strip() if payload.assigned_to else None,
        department=payload.department.strip() if payload.department else None,
        status=payload.status,
        monthly_limit=payload.monthly_limit,
        notes=payload.notes.strip() if payload.notes else None,
    )
    db.add(phone_line)
    db.commit()
    db.refresh(phone_line)
    return phone_line


def update_phone_line(
    db: Session,
    phone_line: PhoneLine,
    payload: PhoneLineUpdate,
) -> PhoneLine:
    update_data = payload.model_dump(exclude_unset=True)

    for field_name, value in update_data.items():
        if isinstance(value, str):
            value = value.strip()
        setattr(phone_line, field_name, value)

    db.add(phone_line)
    db.commit()
    db.refresh(phone_line)
    return phone_line


def delete_phone_line(db: Session, phone_line: PhoneLine) -> None:
    db.delete(phone_line)
    db.commit()
