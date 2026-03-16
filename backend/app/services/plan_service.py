from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.plan import Plan
from app.schemas.plan import PlanCreate, PlanUpdate

DEFAULT_PLANS = [
    {
        "name": "Standard 20Go",
        "operator_name": "Orange Maroc",
        "monthly_price": 120,
        "voice_quota": "2h",
        "data_quota": "20Go",
        "sms_quota": "Illimite",
        "roaming_zone": "Maghreb",
        "active_lines": 85,
        "description": "Forfait standard pour les usages quotidiens avec un budget maitrise.",
    },
    {
        "name": "Premium 50Go",
        "operator_name": "Orange Maroc",
        "monthly_price": 280,
        "voice_quota": "Illimite",
        "data_quota": "50Go",
        "sms_quota": "Illimite",
        "roaming_zone": "International",
        "active_lines": 125,
        "description": "Forfait equilibre pour les equipes terrain avec plus de data.",
    },
    {
        "name": "Business 100Go",
        "operator_name": "Maroc Telecom",
        "monthly_price": 520,
        "voice_quota": "Illimite",
        "data_quota": "100Go",
        "sms_quota": "Illimite",
        "roaming_zone": "Monde",
        "active_lines": 68,
        "description": "Forfait haut de gamme pour les profils tres consommateurs et en roaming.",
    },
]


def list_plans(db: Session, *, offset: int = 0, limit: int = 50) -> list[Plan]:
    statement = select(Plan).order_by(Plan.created_at.desc(), Plan.id.desc()).offset(offset).limit(limit)
    return list(db.scalars(statement))


def get_plan(db: Session, plan_id: int) -> Plan | None:
    return db.get(Plan, plan_id)


def get_plan_by_name(db: Session, name: str) -> Plan | None:
    normalized_name = name.lower().strip()
    statement = select(Plan).where(func.lower(Plan.name) == normalized_name)
    return db.scalar(statement)


def create_plan(db: Session, payload: PlanCreate) -> Plan:
    plan = Plan(
        name=payload.name.strip(),
        operator_name=payload.operator_name.strip(),
        monthly_price=payload.monthly_price,
        voice_quota=payload.voice_quota.strip(),
        data_quota=payload.data_quota.strip(),
        sms_quota=payload.sms_quota.strip(),
        roaming_zone=payload.roaming_zone.strip(),
        active_lines=payload.active_lines,
        description=payload.description.strip() if payload.description else None,
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return plan


def update_plan(db: Session, plan: Plan, payload: PlanUpdate) -> Plan:
    update_data = payload.model_dump(exclude_unset=True)

    for field_name, value in update_data.items():
        if isinstance(value, str):
            value = value.strip() or None
        setattr(plan, field_name, value)

    db.add(plan)
    db.commit()
    db.refresh(plan)
    return plan


def delete_plan(db: Session, plan: Plan) -> None:
    db.delete(plan)
    db.commit()


def ensure_default_plans() -> None:
    db = SessionLocal()
    try:
        existing_plan = db.scalar(select(Plan.id).limit(1))
        if existing_plan is not None:
            return

        for payload in DEFAULT_PLANS:
            db.add(Plan(**payload))
        db.commit()
    finally:
        db.close()
