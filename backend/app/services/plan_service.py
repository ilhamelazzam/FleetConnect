from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.phone_line import PhoneLine
from app.models.plan import Plan
from app.models.user import User
from app.schemas.plan import PlanCreate, PlanLifecycleImpactRead, PlanUpdate
from app.services.phone_line_service import change_phone_line_plan

CRITICAL_PLAN_LINES_THRESHOLD = 25
REASSIGNMENT_REQUIRED_LINES_THRESHOLD = 10

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
        "activation_status": "active",
        "activated_at": datetime.now(UTC),
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
        "activation_status": "active",
        "activated_at": datetime.now(UTC),
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
        "activation_status": "active",
        "activated_at": datetime.now(UTC),
        "description": "Forfait haut de gamme pour les profils tres consommateurs et en roaming.",
    },
]


class PlanLifecycleConflictError(RuntimeError):
    def __init__(self, message: str, *, impact: PlanLifecycleImpactRead | None = None) -> None:
        super().__init__(message)
        self.impact = impact


def _parse_numeric_quota(raw_value: str) -> float | None:
    normalized_value = raw_value.strip().lower()
    if normalized_value in {"illimite", "illimitee", "illimites", "illimitee"}:
        return None

    digits = "".join(character for character in normalized_value if character.isdigit() or character == ".")
    if digits == "":
        return 0.0

    return float(digits)


def _parse_data_quota_gb(raw_value: str) -> float | None:
    normalized_value = raw_value.strip().lower()
    numeric_value = _parse_numeric_quota(raw_value)
    if numeric_value is None:
        return None
    if "mo" in normalized_value:
        return numeric_value / 1024
    return numeric_value


def _parse_voice_quota_hours(raw_value: str) -> float | None:
    normalized_value = raw_value.strip().lower()
    numeric_value = _parse_numeric_quota(raw_value)
    if numeric_value is None:
        return None
    if "min" in normalized_value:
        return numeric_value / 60
    return numeric_value


def _get_roaming_rank(raw_value: str) -> int:
    normalized_value = raw_value.strip().lower()
    if "monde" in normalized_value:
        return 4
    if "intern" in normalized_value:
        return 3
    if "maghreb" in normalized_value:
        return 2
    if "aucun" in normalized_value:
        return 0
    return 1


def _list_plan_phone_lines(db: Session, plan: Plan) -> list[PhoneLine]:
    normalized_plan_name = plan.name.strip().lower()
    statement = select(PhoneLine).where(func.lower(PhoneLine.plan_name) == normalized_plan_name)
    return list(db.scalars(statement))


def _select_recommended_replacement(
    db: Session,
    plan: Plan,
    impacted_lines: int,
) -> tuple[Plan | None, int]:
    candidates = list(
        db.scalars(
            select(Plan).where(
                Plan.id != plan.id,
            ),
        ),
    )

    if not candidates:
        return None, 0

    source_data_quota = _parse_data_quota_gb(plan.data_quota)
    source_voice_quota = _parse_voice_quota_hours(plan.voice_quota)
    source_roaming_rank = _get_roaming_rank(plan.roaming_zone)

    scored_candidates: list[tuple[float, Plan, int]] = []

    for candidate in candidates:
        candidate_data_quota = _parse_data_quota_gb(candidate.data_quota)
        candidate_voice_quota = _parse_voice_quota_hours(candidate.voice_quota)
        candidate_roaming_rank = _get_roaming_rank(candidate.roaming_zone)
        unit_savings = max(plan.monthly_price - candidate.monthly_price, 0)

        data_ratio = 1.0
        if source_data_quota not in (None, 0):
            candidate_data_value = source_data_quota if candidate_data_quota is None else candidate_data_quota
            data_ratio = min(candidate_data_value / source_data_quota, 1.0)

        voice_ratio = 1.0
        if source_voice_quota not in (None, 0):
            candidate_voice_value = source_voice_quota if candidate_voice_quota is None else candidate_voice_quota
            voice_ratio = min(candidate_voice_value / source_voice_quota, 1.0)

        roaming_ratio = 1.0 if source_roaming_rank == 0 else min(candidate_roaming_rank / source_roaming_rank, 1.0)
        compatibility_score = data_ratio * 38 + voice_ratio * 22 + roaming_ratio * 20
        savings_score = unit_savings * 0.22
        same_operator_bonus = 12 if candidate.operator_name == plan.operator_name else 0
        downgrade_penalty = 0

        if data_ratio < 0.55:
            downgrade_penalty += 28
        if voice_ratio < 0.5:
            downgrade_penalty += 20
        if candidate_roaming_rank + 1 < source_roaming_rank:
            downgrade_penalty += 18

        candidate_score = compatibility_score + savings_score + same_operator_bonus - downgrade_penalty
        scored_candidates.append((candidate_score, candidate, unit_savings * impacted_lines))

    scored_candidates.sort(
        key=lambda entry: (
            entry[0],
            entry[2],
            -entry[1].monthly_price,
        ),
        reverse=True,
    )
    best_score, best_candidate, projected_savings = scored_candidates[0]
    if best_score <= 0:
        return None, 0
    return best_candidate, projected_savings


def get_plan_lifecycle_impact(db: Session, plan: Plan) -> PlanLifecycleImpactRead:
    linked_phone_lines = _list_plan_phone_lines(db, plan)
    actual_linked_lines = len(linked_phone_lines)
    impacted_lines = max(plan.active_lines, actual_linked_lines)
    estimated_monthly_cost_mad = impacted_lines * plan.monthly_price

    is_critical = impacted_lines >= CRITICAL_PLAN_LINES_THRESHOLD
    too_many_lines_without_replacement = impacted_lines >= REASSIGNMENT_REQUIRED_LINES_THRESHOLD
    can_deactivate = impacted_lines == 0 or not (is_critical or too_many_lines_without_replacement)
    requires_reassignment = impacted_lines > 0

    if impacted_lines == 0:
        coverage_impact_label = "Nul"
        coverage_impact_summary = "Aucune ligne active ne depend actuellement de ce forfait."
    elif impacted_lines <= 5:
        coverage_impact_label = "Faible"
        coverage_impact_summary = "Impact limite: un suivi manuel et une reaffectation progressive restent possibles."
    elif impacted_lines < CRITICAL_PLAN_LINES_THRESHOLD:
        coverage_impact_label = "Modere"
        coverage_impact_summary = "Plusieurs lignes seraient a surveiller. Un remplacement est recommande pour garder la couverture."
    else:
        coverage_impact_label = "Eleve"
        coverage_impact_summary = "Couverture fortement exposee: le forfait alimente une part importante du parc."

    blocking_reason = None
    if is_critical or too_many_lines_without_replacement:
        blocking_reason = "Veuillez reaffecter les lignes avant desactivation"

    recommended_replacement_plan, recommended_savings = _select_recommended_replacement(
        db,
        plan,
        impacted_lines,
    )

    ai_recommendation = None
    if recommended_replacement_plan is not None and recommended_savings > 0:
        ai_recommendation = (
            f"Remplacer ce forfait par {recommended_replacement_plan.name} "
            f"pour economiser {recommended_savings} MAD / mois."
        )

    return PlanLifecycleImpactRead(
        impacted_lines=impacted_lines,
        actual_linked_lines=actual_linked_lines,
        estimated_monthly_cost_mad=estimated_monthly_cost_mad,
        coverage_impact_label=coverage_impact_label,
        coverage_impact_summary=coverage_impact_summary,
        can_deactivate=can_deactivate,
        requires_reassignment=requires_reassignment,
        is_critical=is_critical,
        blocking_reason=blocking_reason,
        recommended_replacement_plan_id=recommended_replacement_plan.id if recommended_replacement_plan else None,
        recommended_replacement_plan_name=recommended_replacement_plan.name if recommended_replacement_plan else None,
        recommended_monthly_savings_mad=recommended_savings if recommended_replacement_plan else None,
        ai_recommendation=ai_recommendation,
    )


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
    activation_status = "active" if payload.active_lines > 0 else "inactive"
    plan = Plan(
        name=payload.name.strip(),
        operator_name=payload.operator_name.strip(),
        monthly_price=payload.monthly_price,
        voice_quota=payload.voice_quota.strip(),
        data_quota=payload.data_quota.strip(),
        sms_quota=payload.sms_quota.strip(),
        roaming_zone=payload.roaming_zone.strip(),
        active_lines=payload.active_lines,
        activation_status=activation_status,
        activated_at=datetime.now(UTC) if activation_status == "active" else None,
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


def activate_plan(
    db: Session,
    plan: Plan,
    actor: User,
    *,
    phone_line: PhoneLine | None = None,
) -> tuple[Plan, PhoneLine | None]:
    updated_phone_line: PhoneLine | None = None

    if phone_line is not None:
        updated_phone_line = change_phone_line_plan(
            db,
            phone_line,
            plan,
            activate_service=True,
            auto_commit=False,
        )

    plan.activation_status = "active"
    plan.activated_at = datetime.now(UTC)
    plan.activated_by_user_id = actor.id
    db.add(plan)
    db.commit()
    db.refresh(plan)

    if updated_phone_line is not None:
        db.refresh(updated_phone_line)

    return plan, updated_phone_line


def deactivate_plan(
    db: Session,
    plan: Plan,
    actor: User,
) -> tuple[Plan, PlanLifecycleImpactRead, datetime]:
    lifecycle_impact = get_plan_lifecycle_impact(db, plan)
    if not lifecycle_impact.can_deactivate:
        raise PlanLifecycleConflictError(
            lifecycle_impact.blocking_reason or "Desactivation impossible pour ce forfait.",
            impact=lifecycle_impact,
        )

    deactivated_at = datetime.now(UTC)
    plan.activation_status = "inactive"
    plan.activated_at = None
    plan.activated_by_user_id = None
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return plan, lifecycle_impact, deactivated_at


def replace_plan(
    db: Session,
    current_plan: Plan,
    replacement_plan: Plan,
    actor: User,
) -> tuple[Plan, Plan, PlanLifecycleImpactRead, int, datetime]:
    if current_plan.id == replacement_plan.id:
        raise PlanLifecycleConflictError("Veuillez choisir un autre forfait de remplacement.")

    lifecycle_impact = get_plan_lifecycle_impact(db, current_plan)
    linked_phone_lines = _list_plan_phone_lines(db, current_plan)
    current_active_lines_before = current_plan.active_lines

    for phone_line in linked_phone_lines:
        change_phone_line_plan(
            db,
            phone_line,
            replacement_plan,
            activate_service=True,
            auto_commit=False,
        )

    moved_lines_from_tracking = max(current_active_lines_before - len(linked_phone_lines), 0)
    if moved_lines_from_tracking > 0:
        replacement_plan.active_lines += moved_lines_from_tracking

    replaced_at = datetime.now(UTC)
    current_plan.active_lines = 0
    current_plan.activation_status = "inactive"
    current_plan.activated_at = None
    current_plan.activated_by_user_id = None

    replacement_plan.activation_status = "active"
    replacement_plan.activated_at = replaced_at
    replacement_plan.activated_by_user_id = actor.id

    db.add(current_plan)
    db.add(replacement_plan)
    db.commit()
    db.refresh(current_plan)
    db.refresh(replacement_plan)

    return current_plan, replacement_plan, lifecycle_impact, len(linked_phone_lines), replaced_at


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
