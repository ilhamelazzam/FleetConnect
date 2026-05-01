from collections import Counter
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.phone_line import PhoneLine
from app.models.plan import Plan
from app.schemas.phone_line import PhoneLineCreate, PhoneLineOccupationStatus, PhoneLineUpdate

DEFAULT_ACTIVE_DATA_USAGE_GB = 14.5
DEFAULT_SUSPENDED_DATA_USAGE_GB = 5.2
MEDIUM_PLAN_DATA_USAGE_GB = 21.5
LARGE_PLAN_DATA_USAGE_GB = 32.0
DEFAULT_MONTHLY_GROWTH_RATIO = 0.12
CONTACT_EMAIL_PREFIX = "Contact email:"


def _has_assignment(phone_line: PhoneLine) -> bool:
    return bool(phone_line.assigned_to and phone_line.assigned_to.strip())


def _round_usage(value: float) -> float:
    return round(max(value, 0.0), 2)


def _estimate_current_data_usage_gb(monthly_limit: int | None, status: str) -> float:
    if status == "inactive":
        return 0.0

    if status == "suspended":
        if monthly_limit is None:
            return DEFAULT_SUSPENDED_DATA_USAGE_GB
        return _round_usage(min(DEFAULT_SUSPENDED_DATA_USAGE_GB, monthly_limit * 0.35))

    if monthly_limit is None:
        return DEFAULT_ACTIVE_DATA_USAGE_GB

    if monthly_limit <= 50:
        return _round_usage(min(DEFAULT_ACTIVE_DATA_USAGE_GB, monthly_limit * 0.725))

    if monthly_limit <= 100:
        return MEDIUM_PLAN_DATA_USAGE_GB

    return LARGE_PLAN_DATA_USAGE_GB


def _estimate_previous_data_usage_gb(current_data_usage_gb: float, status: str) -> float:
    if status == "inactive" or current_data_usage_gb <= 0:
        return 0.0

    return _round_usage(current_data_usage_gb / (1 + DEFAULT_MONTHLY_GROWTH_RATIO))


def _get_default_data_usage_values(monthly_limit: int | None, status: str) -> tuple[float, float]:
    current_data_usage_gb = _estimate_current_data_usage_gb(monthly_limit, status)
    previous_data_usage_gb = _estimate_previous_data_usage_gb(current_data_usage_gb, status)
    return current_data_usage_gb, previous_data_usage_gb


def _extract_data_quota_gb(raw_quota: str) -> float | None:
    normalized_quota = raw_quota.strip().lower()

    if normalized_quota in {"illimite", "illimitee", "illimitee"}:
        return None

    digits = "".join(character for character in normalized_quota if character.isdigit() or character == ".")
    if digits == "":
        return None

    return float(digits)


def extract_contact_email(notes: str | None) -> str | None:
    if not notes:
        return None

    normalized_prefix = CONTACT_EMAIL_PREFIX.lower()
    for note_line in notes.splitlines():
        stripped_line = note_line.strip()
        if stripped_line.lower().startswith(normalized_prefix):
            _, _, raw_email = stripped_line.partition(":")
            email_value = raw_email.strip()
            return email_value or None

    return None


def _strip_contact_email_from_notes(notes: str | None) -> str | None:
    if not notes:
        return None

    normalized_prefix = CONTACT_EMAIL_PREFIX.lower()
    remaining_lines = [
        note_line.strip()
        for note_line in notes.splitlines()
        if note_line.strip() and not note_line.strip().lower().startswith(normalized_prefix)
    ]

    return "\n".join(remaining_lines) or None


def merge_contact_email_into_notes(notes: str | None, contact_email: str | None) -> str | None:
    cleaned_notes = _strip_contact_email_from_notes(notes)
    normalized_email = contact_email.strip() if contact_email else None
    if normalized_email == "":
        normalized_email = None

    if not normalized_email:
        return cleaned_notes

    email_line = f"{CONTACT_EMAIL_PREFIX} {normalized_email}"
    if not cleaned_notes:
        return email_line

    return f"{email_line}\n{cleaned_notes}"


def _get_line_growth_pct(line: PhoneLine) -> float:
    if line.previous_data_usage_gb <= 0:
        return 0.0

    return ((line.current_data_usage_gb - line.previous_data_usage_gb) / line.previous_data_usage_gb) * 100


def _get_line_alert_severity(line: PhoneLine) -> str | None:
    if line.status == "inactive":
        return None

    usage_rate = (
        line.current_data_usage_gb / line.monthly_limit
        if line.monthly_limit not in (None, 0)
        else None
    )
    growth_pct = _get_line_growth_pct(line)

    if line.status == "suspended" or (usage_rate is not None and usage_rate >= 1.0) or growth_pct >= 35:
        return "critique"

    if (usage_rate is not None and usage_rate >= 0.85) or growth_pct >= 20:
        return "moyen"

    if (usage_rate is not None and usage_rate >= 0.65) or growth_pct >= 10:
        return "faible"

    return None


def _get_current_plan_price(line: PhoneLine, plans: list[Plan]) -> int | None:
    exact_match = next(
        (plan for plan in plans if plan.name == line.plan_name and plan.operator_name == line.operator_name),
        None,
    )
    if exact_match is not None:
        return exact_match.monthly_price

    plan_name_match = next((plan for plan in plans if plan.name == line.plan_name), None)
    if plan_name_match is not None:
        return plan_name_match.monthly_price

    if line.monthly_limit is None:
        return None

    same_quota_plans = [
        plan
        for plan in plans
        if _extract_data_quota_gb(plan.data_quota) == float(line.monthly_limit)
    ]
    if not same_quota_plans:
        return None

    return min(plan.monthly_price for plan in same_quota_plans)


def _get_line_estimated_savings_mad(line: PhoneLine, plans: list[Plan]) -> int:
    if line.status != "active":
        return 0

    current_plan_price = _get_current_plan_price(line, plans)
    if current_plan_price is None:
        return 0

    required_data_gb = line.current_data_usage_gb * 1.25
    candidate_plans = [
        plan
        for plan in plans
        if (
            _extract_data_quota_gb(plan.data_quota) is None
            or (_extract_data_quota_gb(plan.data_quota) or 0) >= required_data_gb
        )
    ]

    if not candidate_plans:
        return 0

    smallest_sufficient_quota = min(
        float("inf") if _extract_data_quota_gb(plan.data_quota) is None else _extract_data_quota_gb(plan.data_quota)
        for plan in candidate_plans
    )
    smallest_quota_candidates = [
        plan
        for plan in candidate_plans
        if (
            float("inf") if _extract_data_quota_gb(plan.data_quota) is None else _extract_data_quota_gb(plan.data_quota)
        )
        == smallest_sufficient_quota
    ]

    optimized_plan = min(smallest_quota_candidates, key=lambda plan: plan.monthly_price)
    return max(current_plan_price - optimized_plan.monthly_price, 0)


def list_phone_lines(
    db: Session,
    *,
    offset: int = 0,
    limit: int = 50,
    assigned_filter: str | None = None,
    status_filter: str | None = None,
) -> list[PhoneLine]:
    statement = select(PhoneLine).order_by(PhoneLine.created_at.desc(), PhoneLine.id.desc())

    if assigned_filter == "libre":
        statement = statement.where(PhoneLine.assigned_to.is_(None), PhoneLine.status == "active")
    elif assigned_filter == "attribuee":
        statement = statement.where(PhoneLine.assigned_to.isnot(None), PhoneLine.status == "active")

    if status_filter:
        statement = statement.where(PhoneLine.status == status_filter)

    statement = statement.offset(offset).limit(limit)
    return list(db.scalars(statement))


def get_occupation_stats(db: Session) -> dict[str, int]:
    phone_lines = list(db.scalars(select(PhoneLine)))
    counts = Counter(compute_occupation_status(phone_line) for phone_line in phone_lines)

    return {
        "total": len(phone_lines),
        "total_libre": counts.get("libre", 0),
        "total_attribuees": counts.get("attribuee", 0),
        "total_en_cours": counts.get("en_cours", 0),
        "total_suspendues": counts.get("suspendue", 0),
        "total_inactives": counts.get("inactive", 0),
    }


def get_phone_line_stats(db: Session) -> dict[str, int | float | None]:
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
    total_current_data_usage_gb = db.scalar(
        select(func.coalesce(func.sum(PhoneLine.current_data_usage_gb), 0.0)).select_from(PhoneLine),
    ) or 0.0
    total_previous_data_usage_gb = db.scalar(
        select(func.coalesce(func.sum(PhoneLine.previous_data_usage_gb), 0.0)).select_from(PhoneLine),
    ) or 0.0
    phone_lines = list(db.scalars(select(PhoneLine)))
    plans = list(db.scalars(select(Plan)))

    average_data_usage_gb = round(float(total_current_data_usage_gb) / int(total), 1) if total else None
    previous_average_data_usage_gb = round(float(total_previous_data_usage_gb) / int(total), 1) if total else None
    average_data_usage_change_pct = None

    if previous_average_data_usage_gb not in (None, 0):
        average_data_usage_change_pct = round(
            (((average_data_usage_gb or 0.0) - previous_average_data_usage_gb) / previous_average_data_usage_gb) * 100,
            1,
        )

    alert_severities = [severity for line in phone_lines if (severity := _get_line_alert_severity(line))]
    total_ai_alerts = len(alert_severities)
    critical_ai_alerts = sum(1 for severity in alert_severities if severity == "critique")
    estimated_monthly_savings_mad = sum(_get_line_estimated_savings_mad(line, plans) for line in phone_lines)

    return {
        "total": int(total),
        "created_this_month": int(created_this_month),
        "average_data_usage_gb": average_data_usage_gb,
        "previous_average_data_usage_gb": previous_average_data_usage_gb,
        "average_data_usage_change_pct": average_data_usage_change_pct,
        "total_ai_alerts": total_ai_alerts,
        "critical_ai_alerts": critical_ai_alerts,
        "estimated_monthly_savings_mad": estimated_monthly_savings_mad,
    }


def get_phone_line(db: Session, phone_line_id: int) -> PhoneLine | None:
    return db.get(PhoneLine, phone_line_id)


def get_phone_line_by_number(db: Session, phone_number: str) -> PhoneLine | None:
    statement = select(PhoneLine).where(PhoneLine.phone_number == phone_number.strip())
    return db.scalar(statement)


def create_phone_line(db: Session, payload: PhoneLineCreate) -> PhoneLine:
    current_data_usage_gb, previous_data_usage_gb = _get_default_data_usage_values(
        payload.monthly_limit,
        payload.status,
    )
    normalized_notes = merge_contact_email_into_notes(payload.notes, payload.contact_email)
    phone_line = PhoneLine(
        phone_number=payload.phone_number.strip(),
        operator_name=payload.operator_name.strip(),
        plan_name=payload.plan_name.strip(),
        assigned_to=payload.assigned_to.strip() if payload.assigned_to else None,
        department=payload.department.strip() if payload.department else None,
        status=payload.status,
        monthly_limit=payload.monthly_limit,
        current_data_usage_gb=payload.current_data_usage_gb
        if payload.current_data_usage_gb is not None
        else current_data_usage_gb,
        previous_data_usage_gb=payload.previous_data_usage_gb
        if payload.previous_data_usage_gb is not None
        else previous_data_usage_gb,
        notes=normalized_notes,
    )
    db.add(phone_line)
    db.commit()
    db.refresh(phone_line)
    return phone_line


def update_phone_line(db: Session, phone_line: PhoneLine, payload: PhoneLineUpdate) -> PhoneLine:
    update_data = payload.model_dump(exclude_unset=True)
    if "contact_email" in update_data or "notes" in update_data:
        current_contact_email = extract_contact_email(phone_line.notes)
        next_contact_email = update_data.pop("contact_email", current_contact_email)
        next_notes = update_data.get("notes", phone_line.notes)
        if isinstance(next_notes, str):
            next_notes = next_notes.strip() or None
        update_data["notes"] = merge_contact_email_into_notes(next_notes, next_contact_email)

    for field_name, value in update_data.items():
        if isinstance(value, str):
            value = value.strip() or None
        setattr(phone_line, field_name, value)

    db.add(phone_line)
    db.commit()
    db.refresh(phone_line)
    return phone_line


def change_phone_line_plan(
    db: Session,
    phone_line: PhoneLine,
    plan: Plan,
    *,
    activate_service: bool = False,
    auto_commit: bool = True,
) -> PhoneLine:
    previous_plan = db.scalar(
        select(Plan).where(
            Plan.name == phone_line.plan_name,
            Plan.operator_name == phone_line.operator_name,
        ),
    )
    if previous_plan is None:
        previous_plan = db.scalar(select(Plan).where(Plan.name == phone_line.plan_name))

    if previous_plan is not None and previous_plan.id != plan.id and previous_plan.active_lines > 0:
        previous_plan.active_lines -= 1
        db.add(previous_plan)

    if previous_plan is None or previous_plan.id != plan.id:
        plan.active_lines += 1
        db.add(plan)

    phone_line.plan_name = plan.name
    phone_line.operator_name = plan.operator_name
    if activate_service:
        phone_line.status = "active"
    data_quota_gb = _extract_data_quota_gb(plan.data_quota)
    phone_line.monthly_limit = None if data_quota_gb is None else int(data_quota_gb)

    db.add(phone_line)
    if auto_commit:
        db.commit()
        db.refresh(phone_line)
    return phone_line


def suspend_phone_line(db: Session, phone_line: PhoneLine) -> PhoneLine:
    phone_line.status = "suspended"
    db.add(phone_line)
    db.commit()
    db.refresh(phone_line)
    return phone_line


def reactivate_phone_line(db: Session, phone_line: PhoneLine) -> PhoneLine:
    phone_line.status = "active"
    db.add(phone_line)
    db.commit()
    db.refresh(phone_line)
    return phone_line


def delete_phone_line(db: Session, phone_line: PhoneLine) -> None:
    db.delete(phone_line)
    db.commit()


def compute_occupation_status(phone_line: PhoneLine) -> PhoneLineOccupationStatus:
    if phone_line.status == "inactive":
        return "inactive"
    if phone_line.status == "suspended":
        return "suspendue"
    if not _has_assignment(phone_line):
        return "libre"
    if not (phone_line.department and phone_line.department.strip()):
        return "en_cours"
    return "attribuee"
