from collections.abc import Iterable, Sequence
from datetime import UTC, datetime
import re
from typing import Any
import unicodedata

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.roles import ADMIN_ROLE, MANAGER_ROLE, normalize_role
from app.db.session import SessionLocal
from app.models.fleet_access import (
    ComplianceAlert,
    Department,
    FleetAccessAuditLog,
    FleetResource,
    ResourceAssignment,
    ResourceRestriction,
    ResourceUsagePolicy,
    UsageLog,
)
from app.models.user import User
from app.schemas.fleet_access import (
    AccessCheckRead,
    ComplianceAlertRead,
    ComplianceAlertResolution,
    DepartmentCreate,
    DepartmentRead,
    DepartmentUpdate,
    FleetAccessAuditLogRead,
    FleetResourceCreate,
    FleetResourceRead,
    FleetResourceUpdate,
    ResourceActiveAssignmentRead,
    ResourceAssignmentBulkCreate,
    ResourceAssignmentCreate,
    ResourceAssignmentRead,
    ResourceAssignmentRevoke,
    ResourceBlockRequest,
    ResourceComplianceOverview,
    ResourceRestrictionCreate,
    ResourceRestrictionRead,
    ResourceUsagePolicyRead,
    ResourceUsagePolicyUpsert,
    UsageLogCreate,
    UsageLogRead,
    UserResourcesAssignmentCreate,
)
from app.services.notification_service import (
    notify_compliance_alert,
    notify_resource_assignment,
    notify_resource_created,
)

ACTIVE_ASSIGNMENT_STATUS = "active"
REVOKED_ASSIGNMENT_STATUS = "revoked"
SUSPENDED_ASSIGNMENT_STATUS = "suspended"
CURRENT_ASSIGNMENT_STATUSES = (ACTIVE_ASSIGNMENT_STATUS, SUSPENDED_ASSIGNMENT_STATUS)

ASSIGNED_RESOURCE_STATUS = "assigned"
AVAILABLE_RESOURCE_STATUS = "available"
SUSPENDED_RESOURCE_STATUS = "suspended"
RESTRICTED_RESOURCE_STATUS = "restricted"
BLOCKED_RESOURCE_STATUSES = {SUSPENDED_RESOURCE_STATUS, RESTRICTED_RESOURCE_STATUS}

DEFAULT_RESTRICTED_USAGE_CATEGORIES = [
    "social_media",
    "streaming",
    "unauthorized_download",
    "personal_app",
    "gaming",
]
DEFAULT_PROFESSIONAL_CATEGORIES = [
    "business",
    "productivity",
    "support",
    "security",
    "collaboration",
]
OPEN_ALERT_STATUSES = ("open", "acknowledged")

DEFAULT_DEPARTMENTS = [
    {
        "name": "Direction",
        "code": "DIR",
        "description": "Direction generale et profils executifs.",
        "is_active": True,
    },
    {
        "name": "IT",
        "code": "IT",
        "description": "Systemes d'information, support et securite.",
        "is_active": True,
    },
    {
        "name": "Finance",
        "code": "FIN",
        "description": "Finance, controle de gestion et achats.",
        "is_active": True,
    },
    {
        "name": "Commercial",
        "code": "COM",
        "description": "Equipes commerciales et terrain.",
        "is_active": True,
    },
    {
        "name": "Support",
        "code": "SUP",
        "description": "Support client et back-office.",
        "is_active": True,
    },
]

DEFAULT_RESOURCES = [
    {
        "resource_type": "phone_line",
        "identifier": "+212600100001",
        "label": "Ligne premium Direction",
        "department_name": "Direction",
        "is_premium": True,
        "is_shareable": False,
        "max_assignments": 1,
        "authorized_profiles": ["Direction", "Manager", "Executive"],
        "notes": "Ligne mobile avec roaming international.",
    },
    {
        "resource_type": "mobile_phone",
        "identifier": "IPH-15-BCS-001",
        "label": "iPhone 15 Pro terrain",
        "department_name": "Commercial",
        "is_premium": True,
        "is_shareable": False,
        "max_assignments": 1,
        "authorized_profiles": ["Manager", "Commercial terrain"],
        "notes": "Telephone reserve aux profils terrain prioritaires.",
    },
    {
        "resource_type": "tablet",
        "identifier": "TAB-S9-IT-004",
        "label": "Tablette support IT",
        "department_name": "IT",
        "is_premium": False,
        "is_shareable": True,
        "max_assignments": 5,
        "authorized_profiles": ["Support IT", "Manager"],
        "notes": "Tablette partageable reservee au support technique.",
    },
    {
        "resource_type": "laptop",
        "identifier": "PC-LEN-FIN-022",
        "label": "PC portable Finance",
        "department_name": "Finance",
        "is_premium": False,
        "is_shareable": False,
        "max_assignments": 1,
        "authorized_profiles": ["Finance", "Manager"],
        "notes": "Poste portable avec applications finance.",
    },
]


def _is_admin(user: User) -> bool:
    return normalize_role(user.role) == ADMIN_ROLE


def _is_manager(user: User) -> bool:
    return normalize_role(user.role) == MANAGER_ROLE


def _forbidden() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You are not allowed to access this resource",
    )


def _clean_text(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


def _normalize_profiles(profiles: Iterable[str]) -> list[str]:
    normalized_profiles: list[str] = []
    for profile in profiles:
        normalized = profile.strip()
        if normalized and normalized not in normalized_profiles:
            normalized_profiles.append(normalized)
    return normalized_profiles


def _normalize_categories(categories: Iterable[str]) -> list[str]:
    normalized_categories: list[str] = []
    for category in categories:
        normalized = category.strip().lower().replace(" ", "_")
        if normalized and normalized not in normalized_categories:
            normalized_categories.append(normalized)
    return normalized_categories


def _normalize_int_ids(ids: Iterable[int]) -> list[int]:
    normalized_ids: list[int] = []
    for item_id in ids:
        if item_id > 0 and item_id not in normalized_ids:
            normalized_ids.append(item_id)
    return normalized_ids


def _unique_ids(ids: Sequence[int]) -> list[int]:
    unique_values: list[int] = []
    for item_id in ids:
        if item_id not in unique_values:
            unique_values.append(item_id)
    return unique_values


def _normalize_department_name(name: str) -> str:
    normalized = " ".join(name.split()).strip()
    if len(normalized) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Department name must contain at least 2 characters",
        )
    return normalized


def _normalize_department_code(code: str) -> str:
    normalized = unicodedata.normalize("NFKD", code).encode("ascii", "ignore").decode("ascii")
    normalized = re.sub(r"[^A-Za-z0-9_-]+", "-", normalized).strip("-_").upper()
    if len(normalized) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Department code must contain at least 2 characters",
        )
    return normalized[:24]


def _generate_department_code(name: str, used_codes: set[str] | None = None) -> str:
    normalized = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    words = [re.sub(r"[^A-Za-z0-9]+", "", chunk) for chunk in normalized.split()]
    words = [word for word in words if word]

    candidate = "".join(word[0] for word in words[:8]).upper()
    if len(candidate) < 2:
        candidate = re.sub(r"[^A-Za-z0-9]+", "", normalized).upper()[:8]
    if len(candidate) < 2:
        candidate = "DEP"

    candidate = candidate[:24]
    if used_codes is None:
        return candidate

    if candidate not in used_codes:
        return candidate

    suffix = 2
    while True:
        suffix_value = str(suffix)
        base = candidate[: max(2, 24 - len(suffix_value))]
        derived = f"{base}{suffix_value}"
        if derived not in used_codes:
            return derived
        suffix += 1


def _ensure_department_uniqueness(
    db: Session,
    *,
    name: str,
    code: str,
    exclude_department_id: int | None = None,
) -> None:
    existing_name_statement = select(Department).where(func.lower(Department.name) == name.lower())
    existing_code_statement = select(Department).where(func.lower(Department.code) == code.lower())

    if exclude_department_id is not None:
        existing_name_statement = existing_name_statement.where(Department.id != exclude_department_id)
        existing_code_statement = existing_code_statement.where(Department.id != exclude_department_id)

    if db.scalar(existing_name_statement) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A department with this name already exists",
        )

    if db.scalar(existing_code_statement) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A department with this code already exists",
        )


def _read_department_or_404(db: Session, department_id: int) -> Department:
    department = db.get(Department, department_id)
    if department is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Department not found")
    return department


def _get_department_name(db: Session, department_id: int | None) -> str | None:
    if department_id is None:
        return None
    department = db.get(Department, department_id)
    return department.name if department else None


def _resource_capacity(resource: FleetResource) -> int:
    if not resource.is_shareable:
        return 1
    return max(1, resource.max_assignments or 1)


def _current_assignments_statement(resource_id: int):
    return (
        select(ResourceAssignment)
        .where(
            ResourceAssignment.resource_id == resource_id,
            ResourceAssignment.status.in_(CURRENT_ASSIGNMENT_STATUSES),
        )
        .order_by(ResourceAssignment.assigned_at.asc(), ResourceAssignment.id.asc())
    )


def _list_current_assignments(db: Session, resource_id: int) -> list[ResourceAssignment]:
    return list(db.scalars(_current_assignments_statement(resource_id)))


def _current_assignment_count(db: Session, resource_id: int) -> int:
    return (
        db.scalar(
            select(func.count(ResourceAssignment.id)).where(
                ResourceAssignment.resource_id == resource_id,
                ResourceAssignment.status.in_(CURRENT_ASSIGNMENT_STATUSES),
            )
        )
        or 0
    )


def _current_assignment_for_user(
    db: Session,
    *,
    resource_id: int,
    user_id: int,
) -> ResourceAssignment | None:
    return db.scalar(
        select(ResourceAssignment).where(
            ResourceAssignment.resource_id == resource_id,
            ResourceAssignment.user_id == user_id,
            ResourceAssignment.status.in_(CURRENT_ASSIGNMENT_STATUSES),
        )
    )


def _resource_has_assignment_for_department(
    db: Session,
    *,
    resource_id: int,
    department_id: int,
) -> bool:
    assignment_id = db.scalar(
        select(ResourceAssignment.id)
        .join(User, ResourceAssignment.user_id == User.id)
        .where(
            ResourceAssignment.resource_id == resource_id,
            ResourceAssignment.status.in_(CURRENT_ASSIGNMENT_STATUSES),
            User.department_id == department_id,
        )
        .limit(1)
    )
    return assignment_id is not None


def _build_active_assignment_read(
    db: Session,
    assignment: ResourceAssignment,
) -> ResourceActiveAssignmentRead:
    user = db.get(User, assignment.user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Assignment user not found"
        )

    assigned_by = db.get(User, assignment.assigned_by_id) if assignment.assigned_by_id else None

    return ResourceActiveAssignmentRead(
        id=assignment.id,
        user_id=user.id,
        user_name=user.full_name,
        user_email=user.email,
        department_id=user.department_id,
        department_name=_get_department_name(db, user.department_id),
        status=assignment.status,
        assignment_reason=assignment.assignment_reason,
        assigned_by_id=assignment.assigned_by_id,
        assigned_by_name=assigned_by.full_name if assigned_by else None,
        assigned_at=assignment.assigned_at,
        start_date=assignment.start_date or assignment.assigned_at,
        end_date=assignment.end_date,
        notes=assignment.notes,
    )


def _default_usage_policy_payload(resource: FleetResource) -> dict[str, object]:
    restricted_categories = list(DEFAULT_RESTRICTED_USAGE_CATEGORIES)
    if resource.is_premium or resource.resource_type in {"laptop", "phone_line"}:
        policy_mode = "professional_only"
        security_level = "sensitive" if not resource.is_premium else "critical"
        threshold = 90
    elif resource.resource_type == "internet_connection":
        policy_mode = "mixed_limited"
        security_level = "standard"
        threshold = 85
        restricted_categories.append("high_bandwidth_personal")
    else:
        policy_mode = "mixed_limited"
        security_level = "standard"
        threshold = 85

    return {
        "policy_mode": policy_mode,
        "acceptable_use_rules": (
            "Usage reserve aux activites professionnelles autorisees. Les usages personnels "
            "doivent rester limites, conformes a la charte interne et sans exposition de donnees."
        ),
        "security_level": security_level,
        "allowed_activity_categories": list(DEFAULT_PROFESSIONAL_CATEGORIES),
        "restricted_activity_categories": _normalize_categories(restricted_categories),
        "exception_roles": [],
        "exception_department_ids": [],
        "monitoring_enabled": True,
        "auto_alert_enabled": True,
        "auto_suspend_on_critical": resource.is_premium,
        "compliance_threshold": threshold,
    }


def _get_usage_policy(db: Session, resource_id: int) -> ResourceUsagePolicy | None:
    return db.scalar(
        select(ResourceUsagePolicy).where(ResourceUsagePolicy.resource_id == resource_id)
    )


def _build_restriction_read(restriction: ResourceRestriction) -> ResourceRestrictionRead:
    return ResourceRestrictionRead(
        id=restriction.id,
        policy_id=restriction.policy_id,
        category=restriction.category,
        action=restriction.action,
        severity=restriction.severity,
        exception_roles=restriction.exception_roles or [],
        exception_department_ids=restriction.exception_department_ids or [],
        notes=restriction.notes,
        is_active=restriction.is_active,
        created_at=restriction.created_at,
        updated_at=restriction.updated_at,
    )


def _build_policy_read(
    db: Session,
    resource: FleetResource,
    policy: ResourceUsagePolicy | None = None,
) -> ResourceUsagePolicyRead:
    effective_policy = policy or _get_usage_policy(db, resource.id)
    if effective_policy is None:
        default_payload = _default_usage_policy_payload(resource)
        return ResourceUsagePolicyRead(
            id=0,
            resource_id=resource.id,
            created_by_id=None,
            updated_by_id=None,
            created_at=None,
            updated_at=None,
            restrictions=[],
            **default_payload,
        )

    restrictions = list(
        db.scalars(
            select(ResourceRestriction)
            .where(ResourceRestriction.policy_id == effective_policy.id)
            .order_by(ResourceRestriction.category.asc(), ResourceRestriction.id.asc())
        )
    )
    return ResourceUsagePolicyRead(
        id=effective_policy.id,
        resource_id=effective_policy.resource_id,
        policy_mode=effective_policy.policy_mode,
        acceptable_use_rules=effective_policy.acceptable_use_rules,
        security_level=effective_policy.security_level,
        allowed_activity_categories=effective_policy.allowed_activity_categories or [],
        restricted_activity_categories=effective_policy.restricted_activity_categories or [],
        exception_roles=effective_policy.exception_roles or [],
        exception_department_ids=effective_policy.exception_department_ids or [],
        monitoring_enabled=effective_policy.monitoring_enabled,
        auto_alert_enabled=effective_policy.auto_alert_enabled,
        auto_suspend_on_critical=effective_policy.auto_suspend_on_critical,
        compliance_threshold=effective_policy.compliance_threshold,
        created_by_id=effective_policy.created_by_id,
        updated_by_id=effective_policy.updated_by_id,
        created_at=effective_policy.created_at,
        updated_at=effective_policy.updated_at,
        restrictions=[_build_restriction_read(restriction) for restriction in restrictions],
    )


def _calculate_usage_summary(
    db: Session,
    resource: FleetResource,
) -> tuple[str, int, int, datetime | None]:
    usage_count = (
        db.scalar(select(func.count(UsageLog.id)).where(UsageLog.resource_id == resource.id)) or 0
    )
    compliant_count = (
        db.scalar(
            select(func.count(UsageLog.id)).where(
                UsageLog.resource_id == resource.id,
                UsageLog.is_compliant.is_(True),
            )
        )
        or 0
    )
    open_alert_count = (
        db.scalar(
            select(func.count(ComplianceAlert.id)).where(
                ComplianceAlert.resource_id == resource.id,
                ComplianceAlert.status.in_(OPEN_ALERT_STATUSES),
            )
        )
        or 0
    )
    critical_alert_count = (
        db.scalar(
            select(func.count(ComplianceAlert.id)).where(
                ComplianceAlert.resource_id == resource.id,
                ComplianceAlert.status.in_(OPEN_ALERT_STATUSES),
                ComplianceAlert.severity == "critical",
            )
        )
        or 0
    )
    last_incident_at = db.scalar(
        select(func.max(ComplianceAlert.created_at)).where(
            ComplianceAlert.resource_id == resource.id
        )
    )
    policy = _build_policy_read(db, resource)
    score = 100 if usage_count == 0 else round((compliant_count / usage_count) * 100)

    if resource.status in BLOCKED_RESOURCE_STATUSES:
        compliance_status = "blocked"
    elif critical_alert_count > 0 or score < policy.compliance_threshold:
        compliance_status = "non_compliant"
    elif open_alert_count > 0 or score < 100:
        compliance_status = "under_monitoring"
    else:
        compliance_status = "compliant"

    return compliance_status, score, open_alert_count, last_incident_at


def _build_resource_read(db: Session, resource: FleetResource) -> FleetResourceRead:
    current_assignments = _list_current_assignments(db, resource.id)
    active_assignments = [
        _build_active_assignment_read(db, assignment) for assignment in current_assignments
    ]
    primary_assignment = current_assignments[0] if current_assignments else None
    assigned_user = db.get(User, primary_assignment.user_id) if primary_assignment else None
    active_assignment_count = len(current_assignments)
    assignment_capacity = _resource_capacity(resource)
    (
        usage_compliance_status,
        usage_compliance_score,
        usage_open_alert_count,
        usage_last_incident_at,
    ) = _calculate_usage_summary(db, resource)

    return FleetResourceRead(
        id=resource.id,
        resource_type=resource.resource_type,
        identifier=resource.identifier,
        label=resource.label,
        status=resource.status,
        department_id=resource.department_id,
        department_name=_get_department_name(db, resource.department_id),
        is_premium=resource.is_premium,
        is_shareable=resource.is_shareable,
        max_assignments=assignment_capacity,
        authorized_profiles=resource.normalized_authorized_profiles(),
        access_blocked_until=resource.access_blocked_until,
        restriction_reason=resource.restriction_reason,
        notes=resource.notes,
        active_assignment_count=active_assignment_count,
        available_assignment_slots=max(0, assignment_capacity - active_assignment_count),
        active_assignments=active_assignments,
        assigned_user_id=assigned_user.id if assigned_user else None,
        assigned_user_name=assigned_user.full_name if assigned_user else None,
        assigned_user_email=assigned_user.email if assigned_user else None,
        current_assignment_id=primary_assignment.id if primary_assignment else None,
        usage_policy_mode=_build_policy_read(db, resource).policy_mode,
        usage_compliance_score=usage_compliance_score,
        usage_compliance_status=usage_compliance_status,
        usage_open_alert_count=usage_open_alert_count,
        usage_last_incident_at=usage_last_incident_at,
        created_at=resource.created_at,
        updated_at=resource.updated_at,
    )


def _build_assignment_read(db: Session, assignment: ResourceAssignment) -> ResourceAssignmentRead:
    resource = db.get(FleetResource, assignment.resource_id)
    user = db.get(User, assignment.user_id)
    if resource is None or user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Assignment data not found"
        )

    assigned_by = db.get(User, assignment.assigned_by_id) if assignment.assigned_by_id else None
    revoked_by = db.get(User, assignment.revoked_by_id) if assignment.revoked_by_id else None

    return ResourceAssignmentRead(
        id=assignment.id,
        resource_id=resource.id,
        resource_label=resource.label,
        resource_identifier=resource.identifier,
        resource_type=resource.resource_type,
        user_id=user.id,
        user_name=user.full_name,
        user_email=user.email,
        department_id=user.department_id,
        department_name=_get_department_name(db, user.department_id),
        status=assignment.status,
        assignment_reason=assignment.assignment_reason,
        reason=assignment.assignment_reason,
        revoke_reason=assignment.revoke_reason,
        assigned_by_id=assignment.assigned_by_id,
        assigned_by_name=assigned_by.full_name if assigned_by else None,
        assigned_by_email=assigned_by.email if assigned_by else None,
        revoked_by_id=assignment.revoked_by_id,
        revoked_by_name=revoked_by.full_name if revoked_by else None,
        revoked_by_email=revoked_by.email if revoked_by else None,
        assigned_at=assignment.assigned_at,
        start_date=assignment.start_date or assignment.assigned_at,
        end_date=assignment.end_date,
        notes=assignment.notes,
        revoked_at=assignment.revoked_at,
    )


def _build_usage_log_read(db: Session, usage_log: UsageLog) -> UsageLogRead:
    resource = db.get(FleetResource, usage_log.resource_id)
    user = db.get(User, usage_log.user_id)
    if resource is None or user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Usage log data not found"
        )

    return UsageLogRead(
        id=usage_log.id,
        resource_id=usage_log.resource_id,
        resource_label=resource.label,
        user_id=usage_log.user_id,
        user_name=user.full_name,
        assignment_id=usage_log.assignment_id,
        activity_type=usage_log.activity_type,
        activity_category=usage_log.activity_category,
        activity_label=usage_log.activity_label,
        usage_volume_mb=usage_log.usage_volume_mb,
        duration_minutes=usage_log.duration_minutes,
        occurred_at=usage_log.occurred_at,
        is_compliant=usage_log.is_compliant,
        policy_action=usage_log.policy_action,
        severity=usage_log.severity,
        violation_reason=usage_log.violation_reason,
        evaluated_policy_id=usage_log.evaluated_policy_id,
        metadata_json=usage_log.metadata_json or {},
        created_at=usage_log.created_at,
    )


def _build_alert_read(db: Session, alert: ComplianceAlert) -> ComplianceAlertRead:
    resource = db.get(FleetResource, alert.resource_id)
    user = db.get(User, alert.user_id)
    if resource is None or user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert data not found")
    recommended_action = (
        alert.recommended_action
        or "Revoir l'usage et appliquer la politique de conformite."
    )
    confidence_by_severity = {"warning": 0.68, "moderate": 0.82, "critical": 0.95}

    return ComplianceAlertRead(
        id=alert.id,
        resource_id=alert.resource_id,
        resource_label=resource.label,
        resource_identifier=resource.identifier,
        user_id=alert.user_id,
        user_name=user.full_name,
        user_email=user.email,
        department_id=user.department_id,
        department_name=_get_department_name(db, user.department_id),
        usage_log_id=alert.usage_log_id,
        policy_id=alert.policy_id,
        severity=alert.severity,
        status=alert.status,
        title=alert.title,
        description=alert.description,
        recommended_action=alert.recommended_action,
        risk_id=f"fleet-compliance-{alert.id}",
        impact=f"Ressource {resource.label} utilisee par {user.full_name}.",
        ai_recommendation=recommended_action,
        suggested_action=recommended_action,
        confidence_score=confidence_by_severity.get(alert.severity, 0.75),
        created_at=alert.created_at,
        acknowledged_at=alert.acknowledged_at,
        acknowledged_by_id=alert.acknowledged_by_id,
        resolved_at=alert.resolved_at,
        resolved_by_id=alert.resolved_by_id,
        resolution_notes=alert.resolution_notes,
    )


def _build_audit_log_read(db: Session, audit_log: FleetAccessAuditLog) -> FleetAccessAuditLogRead:
    actor = db.get(User, audit_log.actor_user_id) if audit_log.actor_user_id else None
    target_user = db.get(User, audit_log.target_user_id) if audit_log.target_user_id else None
    resource = db.get(FleetResource, audit_log.resource_id) if audit_log.resource_id else None

    return FleetAccessAuditLogRead(
        id=audit_log.id,
        action=audit_log.action,
        actor_user_id=audit_log.actor_user_id,
        actor_user_name=actor.full_name if actor else None,
        target_user_id=audit_log.target_user_id,
        target_user_name=target_user.full_name if target_user else None,
        resource_id=audit_log.resource_id,
        resource_label=resource.label if resource else None,
        assignment_id=audit_log.assignment_id,
        reason=audit_log.reason,
        metadata_json=audit_log.metadata_json or {},
        occurred_at=audit_log.occurred_at,
    )


def _record_audit(
    db: Session,
    *,
    action: str,
    actor: User,
    resource: FleetResource | None = None,
    target_user: User | None = None,
    assignment: ResourceAssignment | None = None,
    reason: str | None = None,
    metadata_json: dict[str, Any] | None = None,
) -> None:
    db.add(
        FleetAccessAuditLog(
            actor_user_id=actor.id,
            action=action,
            resource_id=resource.id if resource else None,
            target_user_id=target_user.id if target_user else None,
            assignment_id=assignment.id if assignment else None,
            reason=reason,
            metadata_json=metadata_json or {},
        )
    )


def list_departments(
    db: Session,
    current_user: User,
    *,
    include_inactive: bool = False,
) -> list[DepartmentRead]:
    is_admin = _is_admin(current_user)
    if include_inactive and not is_admin:
        include_inactive = False

    statement = select(Department).order_by(Department.is_active.desc(), Department.name.asc())
    if not include_inactive:
        statement = statement.where(Department.is_active.is_(True))

    if not is_admin:
        if current_user.department_id is None:
            return []
        statement = statement.where(Department.id == current_user.department_id)

    return [DepartmentRead.model_validate(department) for department in db.scalars(statement)]


def create_department(db: Session, payload: DepartmentCreate) -> DepartmentRead:
    normalized_name = _normalize_department_name(payload.name)
    normalized_code = _normalize_department_code(payload.code)
    _ensure_department_uniqueness(db, name=normalized_name, code=normalized_code)

    department = Department(
        name=normalized_name,
        code=normalized_code,
        description=_clean_text(payload.description),
        is_active=payload.is_active,
    )
    db.add(department)
    db.commit()
    db.refresh(department)
    return DepartmentRead.model_validate(department)


def update_department(db: Session, department_id: int, payload: DepartmentUpdate) -> DepartmentRead:
    department = _read_department_or_404(db, department_id)
    update_data = payload.model_dump(exclude_unset=True)

    next_name = _normalize_department_name(update_data["name"]) if "name" in update_data else department.name
    next_code = _normalize_department_code(update_data["code"]) if "code" in update_data else department.code
    _ensure_department_uniqueness(
        db,
        name=next_name,
        code=next_code,
        exclude_department_id=department.id,
    )

    department.name = next_name
    department.code = next_code
    if "description" in update_data:
        department.description = _clean_text(update_data["description"])
    if "is_active" in update_data:
        department.is_active = bool(update_data["is_active"])

    db.add(department)
    db.commit()
    db.refresh(department)
    return DepartmentRead.model_validate(department)


def delete_department(db: Session, department_id: int) -> None:
    department = _read_department_or_404(db, department_id)

    linked_user_id = db.scalar(select(User.id).where(User.department_id == department.id).limit(1))
    linked_resource_id = db.scalar(
        select(FleetResource.id).where(FleetResource.department_id == department.id).limit(1)
    )

    if linked_user_id is not None or linked_resource_id is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Department is still linked to users or resources. Deactivate it instead.",
        )

    db.delete(department)
    db.commit()


def list_assignable_users(db: Session, current_user: User) -> list[User]:
    statement = select(User).where(User.is_active.is_(True)).order_by(User.full_name.asc())
    if _is_manager(current_user):
        if current_user.department_id is None:
            return []
        statement = statement.where(User.department_id == current_user.department_id)
    elif not _is_admin(current_user):
        statement = statement.where(User.id == current_user.id)

    return list(db.scalars(statement))


def list_visible_resources(db: Session, current_user: User) -> list[FleetResourceRead]:
    statement = select(FleetResource).order_by(
        FleetResource.updated_at.desc(), FleetResource.id.desc()
    )

    if _is_manager(current_user):
        if current_user.department_id is None:
            own_resource_ids = select(ResourceAssignment.resource_id).where(
                ResourceAssignment.user_id == current_user.id,
                ResourceAssignment.status.in_(CURRENT_ASSIGNMENT_STATUSES),
            )
            statement = statement.where(FleetResource.id.in_(own_resource_ids))
        else:
            department_user_ids = select(User.id).where(
                User.department_id == current_user.department_id
            )
            department_resource_ids = select(ResourceAssignment.resource_id).where(
                ResourceAssignment.user_id.in_(department_user_ids),
                ResourceAssignment.status.in_(CURRENT_ASSIGNMENT_STATUSES),
            )
            statement = statement.where(
                or_(
                    FleetResource.department_id.is_(None),
                    FleetResource.department_id == current_user.department_id,
                    FleetResource.id.in_(department_resource_ids),
                )
            )
    elif not _is_admin(current_user):
        resource_ids = select(ResourceAssignment.resource_id).where(
            ResourceAssignment.user_id == current_user.id,
            ResourceAssignment.status.in_(CURRENT_ASSIGNMENT_STATUSES),
        )
        statement = statement.where(FleetResource.id.in_(resource_ids))

    return [_build_resource_read(db, resource) for resource in db.scalars(statement)]


def get_visible_resource(db: Session, resource_id: int, current_user: User) -> FleetResource:
    resource = db.get(FleetResource, resource_id)
    if resource is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resource not found")

    if _is_admin(current_user) or _can_user_access_resource(db, current_user, resource):
        return resource

    raise _forbidden()


def read_visible_resource(db: Session, resource_id: int, current_user: User) -> FleetResourceRead:
    return _build_resource_read(db, get_visible_resource(db, resource_id, current_user))


def _can_user_access_resource(db: Session, current_user: User, resource: FleetResource) -> bool:
    if _is_admin(current_user):
        return True

    if (
        _current_assignment_for_user(db, resource_id=resource.id, user_id=current_user.id)
        is not None
    ):
        return True

    if _is_manager(current_user):
        if current_user.department_id is None:
            return False
        if resource.department_id is None:
            return True
        if resource.department_id == current_user.department_id:
            return True
        return _resource_has_assignment_for_department(
            db,
            resource_id=resource.id,
            department_id=current_user.department_id,
        )

    return False


def _can_manage_resource(db: Session, current_user: User, resource: FleetResource) -> bool:
    if _is_admin(current_user):
        return True
    if not _is_manager(current_user) or current_user.department_id is None:
        return False
    if resource.department_id is None or resource.department_id == current_user.department_id:
        return True
    return _resource_has_assignment_for_department(
        db,
        resource_id=resource.id,
        department_id=current_user.department_id,
    )


def create_resource(
    db: Session,
    payload: FleetResourceCreate,
    current_user: User | None = None,
) -> FleetResourceRead:
    existing_resource = db.scalar(
        select(FleetResource).where(
            func.lower(FleetResource.identifier) == payload.identifier.lower().strip()
        )
    )
    if existing_resource:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A resource with this identifier already exists",
        )

    if payload.department_id is not None and db.get(Department, payload.department_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Department not found")

    resource = FleetResource(
        resource_type=payload.resource_type,
        identifier=payload.identifier.strip(),
        label=payload.label.strip(),
        status=AVAILABLE_RESOURCE_STATUS,
        department_id=payload.department_id,
        is_premium=payload.is_premium,
        is_shareable=payload.is_shareable,
        max_assignments=payload.max_assignments if payload.is_shareable else 1,
        authorized_profiles=_normalize_profiles(payload.authorized_profiles),
        notes=payload.notes.strip() if payload.notes else None,
    )
    db.add(resource)
    db.flush()
    if current_user is not None:
        _record_audit(
            db,
            action="resource_created",
            actor=current_user,
            resource=resource,
            metadata_json={
                "is_shareable": resource.is_shareable,
                "max_assignments": resource.max_assignments,
            },
        )
        notify_resource_created(db, actor=current_user, resource=resource)
    db.commit()
    db.refresh(resource)
    return _build_resource_read(db, resource)


def update_resource(
    db: Session,
    resource_id: int,
    payload: FleetResourceUpdate,
    current_user: User,
) -> FleetResourceRead:
    resource = get_visible_resource(db, resource_id, current_user)
    if not _is_admin(current_user):
        raise _forbidden()

    update_data = payload.model_dump(exclude_unset=True)
    if (
        "department_id" in update_data
        and update_data["department_id"] is not None
        and db.get(Department, update_data["department_id"]) is None
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Department not found")

    candidate_is_shareable = update_data.get("is_shareable", resource.is_shareable)
    candidate_max_assignments = update_data.get("max_assignments", resource.max_assignments)
    if not candidate_is_shareable:
        candidate_max_assignments = 1
    current_assignment_count = _current_assignment_count(db, resource.id)
    if current_assignment_count > max(1, candidate_max_assignments or 1):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Resource already has more active assignments than the requested limit",
        )

    for field_name, value in update_data.items():
        if field_name == "authorized_profiles" and value is not None:
            value = _normalize_profiles(value)
        elif field_name == "max_assignments" and value is not None:
            value = candidate_max_assignments
        elif isinstance(value, str):
            value = value.strip() or None
        setattr(resource, field_name, value)

    if not resource.is_shareable:
        resource.max_assignments = 1

    db.add(resource)
    db.commit()
    db.refresh(resource)
    return _build_resource_read(db, resource)


def read_resource_usage_policy(
    db: Session,
    resource_id: int,
    current_user: User,
) -> ResourceUsagePolicyRead:
    resource = get_visible_resource(db, resource_id, current_user)
    return _build_policy_read(db, resource)


def _create_restriction(
    *,
    policy_id: int,
    payload: ResourceRestrictionCreate,
) -> ResourceRestriction:
    return ResourceRestriction(
        policy_id=policy_id,
        category=payload.category.strip().lower().replace(" ", "_"),
        action=payload.action,
        severity=payload.severity,
        exception_roles=_normalize_categories(payload.exception_roles),
        exception_department_ids=_normalize_int_ids(payload.exception_department_ids),
        notes=_clean_text(payload.notes),
        is_active=payload.is_active,
    )


def upsert_resource_usage_policy(
    db: Session,
    resource_id: int,
    payload: ResourceUsagePolicyUpsert,
    current_user: User,
) -> ResourceUsagePolicyRead:
    resource = get_visible_resource(db, resource_id, current_user)
    if not _is_admin(current_user):
        raise _forbidden()

    policy = _get_usage_policy(db, resource.id)
    if policy is None:
        policy = ResourceUsagePolicy(resource_id=resource.id, created_by_id=current_user.id)
        db.add(policy)
        db.flush()

    policy.policy_mode = payload.policy_mode
    policy.acceptable_use_rules = payload.acceptable_use_rules.strip()
    policy.security_level = payload.security_level
    policy.allowed_activity_categories = _normalize_categories(payload.allowed_activity_categories)
    policy.restricted_activity_categories = _normalize_categories(
        payload.restricted_activity_categories
    )
    policy.exception_roles = _normalize_categories(payload.exception_roles)
    policy.exception_department_ids = _normalize_int_ids(payload.exception_department_ids)
    policy.monitoring_enabled = payload.monitoring_enabled
    policy.auto_alert_enabled = payload.auto_alert_enabled
    policy.auto_suspend_on_critical = payload.auto_suspend_on_critical
    policy.compliance_threshold = payload.compliance_threshold
    policy.updated_by_id = current_user.id

    for restriction in db.scalars(
        select(ResourceRestriction).where(ResourceRestriction.policy_id == policy.id)
    ):
        db.delete(restriction)
    db.flush()
    for restriction_payload in payload.restrictions:
        db.add(_create_restriction(policy_id=policy.id, payload=restriction_payload))

    _record_audit(
        db,
        action="usage_policy_updated",
        actor=current_user,
        resource=resource,
        reason="Usage policy updated",
        metadata_json={
            "policy_mode": policy.policy_mode,
            "security_level": policy.security_level,
            "restricted_activity_categories": policy.restricted_activity_categories,
        },
    )
    db.commit()
    db.refresh(policy)
    return _build_policy_read(db, resource, policy)


def _usage_policy_exception_applies(policy: ResourceUsagePolicyRead, target_user: User) -> bool:
    target_role = normalize_role(target_user.role)
    if target_role in {role.lower() for role in policy.exception_roles}:
        return True
    return bool(
        target_user.department_id
        and target_user.department_id in set(policy.exception_department_ids)
    )


def _restriction_exception_applies(
    restriction: ResourceRestriction,
    target_user: User,
) -> bool:
    exception_roles = {str(role).lower() for role in (restriction.exception_roles or [])}
    if normalize_role(target_user.role) in exception_roles:
        return True
    exception_departments = set(restriction.exception_department_ids or [])
    return bool(target_user.department_id and target_user.department_id in exception_departments)


def _active_restrictions_for_category(
    db: Session,
    *,
    policy_id: int,
    category: str,
) -> list[ResourceRestriction]:
    return list(
        db.scalars(
            select(ResourceRestriction).where(
                ResourceRestriction.policy_id == policy_id,
                ResourceRestriction.category == category,
                ResourceRestriction.is_active.is_(True),
            )
        )
    )


def _evaluate_usage_compliance(
    db: Session,
    *,
    resource: FleetResource,
    target_user: User,
    category: str,
) -> tuple[bool, str, str | None, str | None, ResourceUsagePolicyRead]:
    policy = _build_policy_read(db, resource)
    if not policy.monitoring_enabled:
        return True, "allow", None, None, policy

    if _usage_policy_exception_applies(policy, target_user):
        return True, "allow", None, None, policy

    normalized_category = category.strip().lower().replace(" ", "_")
    if policy.id:
        matching_restrictions = _active_restrictions_for_category(
            db,
            policy_id=policy.id,
            category=normalized_category,
        )
    else:
        matching_restrictions = []
    for restriction in matching_restrictions:
        if _restriction_exception_applies(restriction, target_user):
            return True, "allow", None, None, policy
        if restriction.action == "allow":
            return True, "allow", None, None, policy
        return (
            False,
            restriction.action,
            restriction.severity,
            f"Usage category '{normalized_category}' is restricted by policy.",
            policy,
        )

    if normalized_category in set(policy.restricted_activity_categories):
        severity = "critical" if policy.security_level == "critical" else "moderate"
        action = "block" if severity == "critical" and policy.auto_suspend_on_critical else "alert"
        return (
            False,
            action,
            severity,
            f"Usage category '{normalized_category}' is outside the acceptable use policy.",
            policy,
        )

    if policy.policy_mode == "professional_only" and normalized_category not in set(
        policy.allowed_activity_categories
    ):
        return (
            False,
            "alert",
            "warning",
            f"Usage category '{normalized_category}' is not declared as professional.",
            policy,
        )

    return True, "allow", None, None, policy


def _validate_usage_log_target(
    db: Session,
    *,
    resource: FleetResource,
    payload: UsageLogCreate,
    current_user: User,
) -> tuple[User, ResourceAssignment]:
    target_user_id = payload.user_id or current_user.id
    target_user = db.get(User, target_user_id)
    if target_user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target user not found")

    if _is_manager(current_user):
        if (
            current_user.department_id is None
            or target_user.department_id != current_user.department_id
        ):
            raise _forbidden()
    elif not _is_admin(current_user) and target_user.id != current_user.id:
        raise _forbidden()

    assignment = (
        db.get(ResourceAssignment, payload.assignment_id) if payload.assignment_id else None
    )
    if assignment is not None:
        if (
            assignment.resource_id != resource.id
            or assignment.user_id != target_user.id
            or assignment.status != ACTIVE_ASSIGNMENT_STATUS
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Assignment does not match an active resource-user assignment",
            )
        return target_user, assignment

    assignment = _current_assignment_for_user(db, resource_id=resource.id, user_id=target_user.id)
    if assignment is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Usage can only be logged for an active assignment",
        )
    return target_user, assignment


def record_usage_log(
    db: Session,
    resource_id: int,
    payload: UsageLogCreate,
    current_user: User,
) -> UsageLogRead:
    resource = get_visible_resource(db, resource_id, current_user)
    target_user, assignment = _validate_usage_log_target(
        db,
        resource=resource,
        payload=payload,
        current_user=current_user,
    )
    normalized_category = payload.activity_category.strip().lower().replace(" ", "_")
    is_compliant, policy_action, severity, violation_reason, policy = _evaluate_usage_compliance(
        db,
        resource=resource,
        target_user=target_user,
        category=normalized_category,
    )

    usage_log = UsageLog(
        resource_id=resource.id,
        user_id=target_user.id,
        assignment_id=assignment.id,
        evaluated_policy_id=policy.id or None,
        activity_type=payload.activity_type.strip().lower().replace(" ", "_"),
        activity_category=normalized_category,
        activity_label=_clean_text(payload.activity_label),
        usage_volume_mb=payload.usage_volume_mb,
        duration_minutes=payload.duration_minutes,
        occurred_at=payload.occurred_at or datetime.now(UTC),
        is_compliant=is_compliant,
        policy_action=policy_action,
        severity=severity,
        violation_reason=violation_reason,
        metadata_json=payload.metadata_json,
    )
    db.add(usage_log)
    db.flush()
    _record_audit(
        db,
        action="usage_log_recorded",
        actor=current_user,
        resource=resource,
        target_user=target_user,
        assignment=assignment,
        reason=violation_reason,
        metadata_json={
            "activity_category": usage_log.activity_category,
            "is_compliant": usage_log.is_compliant,
        },
    )

    if not is_compliant and policy.auto_alert_enabled:
        alert = ComplianceAlert(
            resource_id=resource.id,
            user_id=target_user.id,
            usage_log_id=usage_log.id,
            policy_id=policy.id or None,
            severity=severity or "warning",
            status="open",
            title=f"Usage non conforme: {usage_log.activity_category}",
            description=violation_reason or "Usage outside the professional policy.",
            recommended_action=_recommend_action_for_violation(policy_action, severity),
        )
        db.add(alert)
        db.flush()
        notify_compliance_alert(
            db,
            actor=current_user,
            target_user=target_user,
            resource=resource,
            alert=alert,
        )
        _record_audit(
            db,
            action="compliance_alert_created",
            actor=current_user,
            resource=resource,
            target_user=target_user,
            assignment=assignment,
            reason=alert.description,
            metadata_json={"severity": alert.severity, "usage_log_id": usage_log.id},
        )

    if not is_compliant and policy_action == "block" and policy.auto_suspend_on_critical:
        resource.status = SUSPENDED_RESOURCE_STATUS
        resource.restriction_reason = violation_reason or "Critical compliance violation"
        db.add(resource)
        _record_audit(
            db,
            action="resource_suspended_for_compliance",
            actor=current_user,
            resource=resource,
            target_user=target_user,
            assignment=assignment,
            reason=resource.restriction_reason,
        )

    db.commit()
    db.refresh(usage_log)
    return _build_usage_log_read(db, usage_log)


def _recommend_action_for_violation(policy_action: str, severity: str | None) -> str:
    if policy_action == "block" or severity == "critical":
        return "Suspendre temporairement la ressource et notifier l'administrateur."
    if severity == "moderate":
        return "Notifier le manager et revoir les restrictions de la ressource."
    return "Envoyer un avertissement et surveiller les prochains usages."


def _assignment_reason(
    payload: ResourceAssignmentCreate
    | ResourceAssignmentBulkCreate
    | UserResourcesAssignmentCreate,
) -> str | None:
    return _clean_text(payload.assignment_reason or payload.reason)


def _validate_assignment_window(start_date: datetime, end_date: datetime | None) -> None:
    if end_date is not None and end_date < start_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Assignment end date must be after the start date",
        )


def _validate_assignment_rules(
    db: Session,
    *,
    resource: FleetResource,
    target_user: User,
    current_user: User,
) -> None:
    if not _can_manage_resource(db, current_user, resource):
        raise _forbidden()

    if not target_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Target user is inactive"
        )

    if _is_manager(current_user) and target_user.department_id != current_user.department_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Managers can only assign resources within their department",
        )

    if resource.status in BLOCKED_RESOURCE_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Resource access is currently blocked",
        )

    if resource.department_id is not None and target_user.department_id != resource.department_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This resource is reserved for another department",
        )

    authorized_profiles = [profile.lower() for profile in resource.normalized_authorized_profiles()]
    target_profile = (target_user.job_profile or "").strip().lower()
    target_role = normalize_role(target_user.role)
    if (
        authorized_profiles
        and target_profile not in authorized_profiles
        and target_role not in authorized_profiles
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Target user profile is not authorized for this resource",
        )

    if (
        _current_assignment_for_user(db, resource_id=resource.id, user_id=target_user.id)
        is not None
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This user already has an active assignment for this resource",
        )


def _validate_resource_capacity(
    db: Session,
    *,
    resource: FleetResource,
    requested_assignments: int,
) -> None:
    assignment_capacity = _resource_capacity(resource)
    current_assignment_count = _current_assignment_count(db, resource.id)
    if current_assignment_count + requested_assignments <= assignment_capacity:
        return

    if not resource.is_shareable:
        detail = "Resource is not shareable and already has an active assignment"
    else:
        detail = "Resource maximum assignments limit exceeded"
    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


def _get_users_by_ids(db: Session, user_ids: list[int]) -> list[User]:
    users = list(db.scalars(select(User).where(User.id.in_(user_ids))))
    users_by_id = {user.id: user for user in users}
    missing_user_ids = [user_id for user_id in user_ids if user_id not in users_by_id]
    if missing_user_ids:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Target user not found: {missing_user_ids[0]}",
        )
    return [users_by_id[user_id] for user_id in user_ids]


def _get_resources_by_ids(db: Session, resource_ids: list[int]) -> list[FleetResource]:
    resources = list(db.scalars(select(FleetResource).where(FleetResource.id.in_(resource_ids))))
    resources_by_id = {resource.id: resource for resource in resources}
    missing_resource_ids = [
        resource_id for resource_id in resource_ids if resource_id not in resources_by_id
    ]
    if missing_resource_ids:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Resource not found: {missing_resource_ids[0]}",
        )
    return [resources_by_id[resource_id] for resource_id in resource_ids]


def assign_resource(
    db: Session,
    resource_id: int,
    payload: ResourceAssignmentCreate,
    current_user: User,
) -> ResourceAssignmentRead:
    assignments = assign_resource_to_users(
        db,
        resource_id,
        ResourceAssignmentBulkCreate(
            user_ids=[payload.user_id],
            assignment_reason=payload.assignment_reason,
            reason=payload.reason,
            start_date=payload.start_date,
            end_date=payload.end_date,
            notes=payload.notes,
        ),
        current_user,
    )
    return assignments[0]


def assign_resource_to_users(
    db: Session,
    resource_id: int,
    payload: ResourceAssignmentBulkCreate,
    current_user: User,
) -> list[ResourceAssignmentRead]:
    resource = get_visible_resource(db, resource_id, current_user)
    user_ids = _unique_ids(payload.user_ids)
    target_users = _get_users_by_ids(db, user_ids)
    assignment_reason = _assignment_reason(payload)
    start_date = payload.start_date or datetime.now(UTC)
    end_date = payload.end_date
    notes = _clean_text(payload.notes)
    _validate_assignment_window(start_date, end_date)

    for target_user in target_users:
        _validate_assignment_rules(
            db,
            resource=resource,
            target_user=target_user,
            current_user=current_user,
        )
    _validate_resource_capacity(db, resource=resource, requested_assignments=len(target_users))

    created_assignments: list[ResourceAssignment] = []
    for target_user in target_users:
        assignment = ResourceAssignment(
            resource_id=resource.id,
            user_id=target_user.id,
            assigned_by_id=current_user.id,
            status=ACTIVE_ASSIGNMENT_STATUS,
            assignment_reason=assignment_reason,
            start_date=start_date,
            end_date=end_date,
            notes=notes,
        )
        db.add(assignment)
        db.flush()
        _record_audit(
            db,
            action="assignment_created",
            actor=current_user,
            resource=resource,
            target_user=target_user,
            assignment=assignment,
            reason=assignment_reason,
            metadata_json={
                "start_date": start_date.isoformat(),
                "end_date": end_date.isoformat() if end_date else None,
            },
        )
        notify_resource_assignment(
            db,
            actor=current_user,
            target_user=target_user,
            resource=resource,
            assignment_id=assignment.id,
        )
        created_assignments.append(assignment)

    if resource.status == AVAILABLE_RESOURCE_STATUS:
        resource.status = ASSIGNED_RESOURCE_STATUS

    db.add(resource)
    db.commit()
    for assignment in created_assignments:
        db.refresh(assignment)
    return [_build_assignment_read(db, assignment) for assignment in created_assignments]


def assign_resources_to_user(
    db: Session,
    user_id: int,
    payload: UserResourcesAssignmentCreate,
    current_user: User,
) -> list[ResourceAssignmentRead]:
    target_user = db.get(User, user_id)
    if target_user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target user not found")

    resource_ids = _unique_ids(payload.resource_ids)
    resources = _get_resources_by_ids(db, resource_ids)
    assignment_reason = _assignment_reason(payload)
    start_date = payload.start_date or datetime.now(UTC)
    end_date = payload.end_date
    notes = _clean_text(payload.notes)
    _validate_assignment_window(start_date, end_date)

    for resource in resources:
        get_visible_resource(db, resource.id, current_user)
        _validate_assignment_rules(
            db,
            resource=resource,
            target_user=target_user,
            current_user=current_user,
        )
        _validate_resource_capacity(db, resource=resource, requested_assignments=1)

    created_assignments: list[ResourceAssignment] = []
    for resource in resources:
        assignment = ResourceAssignment(
            resource_id=resource.id,
            user_id=target_user.id,
            assigned_by_id=current_user.id,
            status=ACTIVE_ASSIGNMENT_STATUS,
            assignment_reason=assignment_reason,
            start_date=start_date,
            end_date=end_date,
            notes=notes,
        )
        db.add(assignment)
        db.flush()
        if resource.status == AVAILABLE_RESOURCE_STATUS:
            resource.status = ASSIGNED_RESOURCE_STATUS
        db.add(resource)
        _record_audit(
            db,
            action="assignment_created",
            actor=current_user,
            resource=resource,
            target_user=target_user,
            assignment=assignment,
            reason=assignment_reason,
            metadata_json={
                "start_date": start_date.isoformat(),
                "end_date": end_date.isoformat() if end_date else None,
            },
        )
        notify_resource_assignment(
            db,
            actor=current_user,
            target_user=target_user,
            resource=resource,
            assignment_id=assignment.id,
        )
        created_assignments.append(assignment)

    db.commit()
    for assignment in created_assignments:
        db.refresh(assignment)
    return [_build_assignment_read(db, assignment) for assignment in created_assignments]


def revoke_assignment(
    db: Session,
    assignment_id: int,
    payload: ResourceAssignmentRevoke,
    current_user: User,
) -> ResourceAssignmentRead:
    assignment = db.get(ResourceAssignment, assignment_id)
    if assignment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")

    resource = db.get(FleetResource, assignment.resource_id)
    target_user = db.get(User, assignment.user_id)
    if resource is None or target_user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Assignment data not found"
        )

    if not _can_manage_resource(db, current_user, resource):
        raise _forbidden()

    if assignment.status not in CURRENT_ASSIGNMENT_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Assignment is not active",
        )

    now = datetime.now(UTC)
    revoke_reason = _clean_text(payload.reason)
    assignment.status = REVOKED_ASSIGNMENT_STATUS
    assignment.revoked_by_id = current_user.id
    assignment.revoked_at = now
    assignment.end_date = assignment.end_date or now
    assignment.revoke_reason = revoke_reason

    db.add(assignment)
    db.flush()
    if (
        resource.status == ASSIGNED_RESOURCE_STATUS
        and _current_assignment_count(db, resource.id) == 0
    ):
        resource.status = AVAILABLE_RESOURCE_STATUS
        db.add(resource)
    _record_audit(
        db,
        action="assignment_revoked",
        actor=current_user,
        resource=resource,
        target_user=target_user,
        assignment=assignment,
        reason=revoke_reason,
    )

    db.commit()
    db.refresh(assignment)
    return _build_assignment_read(db, assignment)


def revoke_resource_assignment(
    db: Session,
    resource_id: int,
    payload: ResourceAssignmentRevoke,
    current_user: User,
) -> ResourceAssignmentRead:
    resource = get_visible_resource(db, resource_id, current_user)
    if not _can_manage_resource(db, current_user, resource):
        raise _forbidden()

    current_assignments = _list_current_assignments(db, resource.id)
    if not current_assignments:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="No active assignment found"
        )
    if len(current_assignments) > 1:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Resource has multiple active assignments; revoke a specific assignment",
        )
    return revoke_assignment(db, current_assignments[0].id, payload, current_user)


def block_resource(
    db: Session,
    resource_id: int,
    payload: ResourceBlockRequest,
    current_user: User,
) -> FleetResourceRead:
    resource = get_visible_resource(db, resource_id, current_user)
    if not _can_manage_resource(db, current_user, resource):
        raise _forbidden()

    reason = payload.reason.strip()
    resource.status = payload.status
    resource.access_blocked_until = payload.blocked_until
    resource.restriction_reason = reason

    db.add(resource)
    db.flush()
    _record_audit(
        db,
        action="resource_blocked",
        actor=current_user,
        resource=resource,
        reason=reason,
        metadata_json={
            "status": payload.status,
            "blocked_until": payload.blocked_until.isoformat() if payload.blocked_until else None,
        },
    )
    db.commit()
    db.refresh(resource)
    return _build_resource_read(db, resource)


def unblock_resource(db: Session, resource_id: int, current_user: User) -> FleetResourceRead:
    resource = get_visible_resource(db, resource_id, current_user)
    if not _can_manage_resource(db, current_user, resource):
        raise _forbidden()

    resource.status = (
        ASSIGNED_RESOURCE_STATUS
        if _current_assignment_count(db, resource.id)
        else AVAILABLE_RESOURCE_STATUS
    )
    resource.access_blocked_until = None
    resource.restriction_reason = None

    db.add(resource)
    db.flush()
    _record_audit(db, action="resource_unblocked", actor=current_user, resource=resource)
    db.commit()
    db.refresh(resource)
    return _build_resource_read(db, resource)


def list_assignments(
    db: Session,
    current_user: User,
    *,
    include_history: bool = False,
) -> list[ResourceAssignmentRead]:
    statement = select(ResourceAssignment).order_by(
        ResourceAssignment.assigned_at.desc(),
        ResourceAssignment.id.desc(),
    )
    if not include_history:
        statement = statement.where(ResourceAssignment.status.in_(CURRENT_ASSIGNMENT_STATUSES))

    if _is_manager(current_user):
        if current_user.department_id is None:
            statement = statement.where(ResourceAssignment.user_id == current_user.id)
        else:
            department_user_ids = select(User.id).where(
                User.department_id == current_user.department_id
            )
            statement = statement.where(ResourceAssignment.user_id.in_(department_user_ids))
    elif not _is_admin(current_user):
        statement = statement.where(ResourceAssignment.user_id == current_user.id)

    return [_build_assignment_read(db, assignment) for assignment in db.scalars(statement)]


def list_resource_assignments(
    db: Session,
    resource_id: int,
    current_user: User,
    *,
    include_history: bool = False,
) -> list[ResourceAssignmentRead]:
    resource = get_visible_resource(db, resource_id, current_user)
    statement = (
        select(ResourceAssignment)
        .where(ResourceAssignment.resource_id == resource.id)
        .order_by(ResourceAssignment.assigned_at.desc(), ResourceAssignment.id.desc())
    )
    if not include_history:
        statement = statement.where(ResourceAssignment.status.in_(CURRENT_ASSIGNMENT_STATUSES))

    if _is_manager(current_user):
        if current_user.department_id is None:
            statement = statement.where(ResourceAssignment.user_id == current_user.id)
        else:
            department_user_ids = select(User.id).where(
                User.department_id == current_user.department_id
            )
            statement = statement.where(ResourceAssignment.user_id.in_(department_user_ids))
    elif not _is_admin(current_user):
        statement = statement.where(ResourceAssignment.user_id == current_user.id)

    return [_build_assignment_read(db, assignment) for assignment in db.scalars(statement)]


def list_user_resource_assignments(
    db: Session,
    user_id: int,
    current_user: User,
    *,
    include_history: bool = False,
) -> list[ResourceAssignmentRead]:
    target_user = db.get(User, user_id)
    if target_user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target user not found")

    if _is_manager(current_user):
        if (
            current_user.department_id is None
            or target_user.department_id != current_user.department_id
        ):
            raise _forbidden()
    elif not _is_admin(current_user) and current_user.id != target_user.id:
        raise _forbidden()

    statement = (
        select(ResourceAssignment)
        .where(ResourceAssignment.user_id == target_user.id)
        .order_by(ResourceAssignment.assigned_at.desc(), ResourceAssignment.id.desc())
    )
    if not include_history:
        statement = statement.where(ResourceAssignment.status.in_(CURRENT_ASSIGNMENT_STATUSES))

    return [_build_assignment_read(db, assignment) for assignment in db.scalars(statement)]


def list_audit_logs(
    db: Session,
    current_user: User,
    *,
    limit: int = 100,
) -> list[FleetAccessAuditLogRead]:
    statement = (
        select(FleetAccessAuditLog)
        .order_by(FleetAccessAuditLog.occurred_at.desc(), FleetAccessAuditLog.id.desc())
        .limit(limit)
    )

    if _is_manager(current_user):
        if current_user.department_id is None:
            statement = statement.where(FleetAccessAuditLog.actor_user_id == current_user.id)
        else:
            department_user_ids = select(User.id).where(
                User.department_id == current_user.department_id
            )
            department_resource_ids = select(FleetResource.id).where(
                or_(
                    FleetResource.department_id == current_user.department_id,
                    FleetResource.department_id.is_(None),
                )
            )
            statement = statement.where(
                or_(
                    FleetAccessAuditLog.actor_user_id == current_user.id,
                    FleetAccessAuditLog.target_user_id.in_(department_user_ids),
                    FleetAccessAuditLog.resource_id.in_(department_resource_ids),
                )
            )
    elif not _is_admin(current_user):
        statement = statement.where(
            or_(
                FleetAccessAuditLog.actor_user_id == current_user.id,
                FleetAccessAuditLog.target_user_id == current_user.id,
            )
        )

    return [_build_audit_log_read(db, audit_log) for audit_log in db.scalars(statement)]


def _scope_usage_log_statement(statement, current_user: User):
    if _is_manager(current_user):
        if current_user.department_id is None:
            return statement.where(UsageLog.user_id == current_user.id)
        department_user_ids = select(User.id).where(
            User.department_id == current_user.department_id
        )
        return statement.where(UsageLog.user_id.in_(department_user_ids))
    if not _is_admin(current_user):
        return statement.where(UsageLog.user_id == current_user.id)
    return statement


def _scope_alert_statement(statement, current_user: User):
    if _is_manager(current_user):
        if current_user.department_id is None:
            return statement.where(ComplianceAlert.user_id == current_user.id)
        department_user_ids = select(User.id).where(
            User.department_id == current_user.department_id
        )
        return statement.where(ComplianceAlert.user_id.in_(department_user_ids))
    if not _is_admin(current_user):
        return statement.where(ComplianceAlert.user_id == current_user.id)
    return statement


def list_usage_logs(
    db: Session,
    current_user: User,
    *,
    resource_id: int | None = None,
    user_id: int | None = None,
    is_compliant: bool | None = None,
    limit: int = 100,
) -> list[UsageLogRead]:
    statement = (
        select(UsageLog).order_by(UsageLog.occurred_at.desc(), UsageLog.id.desc()).limit(limit)
    )
    if resource_id is not None:
        get_visible_resource(db, resource_id, current_user)
        statement = statement.where(UsageLog.resource_id == resource_id)
    if user_id is not None:
        if not _is_admin(current_user):
            target_user = db.get(User, user_id)
            if target_user is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND, detail="Target user not found"
                )
            if _is_manager(current_user):
                if (
                    current_user.department_id is None
                    or target_user.department_id != current_user.department_id
                ):
                    raise _forbidden()
            elif target_user.id != current_user.id:
                raise _forbidden()
        statement = statement.where(UsageLog.user_id == user_id)
    if is_compliant is not None:
        statement = statement.where(UsageLog.is_compliant.is_(is_compliant))

    statement = _scope_usage_log_statement(statement, current_user)
    return [_build_usage_log_read(db, usage_log) for usage_log in db.scalars(statement)]


def list_compliance_alerts(
    db: Session,
    current_user: User,
    *,
    status_filter: str | None = None,
    severity: str | None = None,
    resource_id: int | None = None,
    limit: int = 100,
) -> list[ComplianceAlertRead]:
    statement = (
        select(ComplianceAlert)
        .order_by(ComplianceAlert.created_at.desc(), ComplianceAlert.id.desc())
        .limit(limit)
    )
    if resource_id is not None:
        get_visible_resource(db, resource_id, current_user)
        statement = statement.where(ComplianceAlert.resource_id == resource_id)
    if status_filter:
        statement = statement.where(ComplianceAlert.status == status_filter)
    if severity:
        statement = statement.where(ComplianceAlert.severity == severity)

    statement = _scope_alert_statement(statement, current_user)
    return [_build_alert_read(db, alert) for alert in db.scalars(statement)]


def acknowledge_compliance_alert(
    db: Session,
    alert_id: int,
    current_user: User,
) -> ComplianceAlertRead:
    alert = db.get(ComplianceAlert, alert_id)
    if alert is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Compliance alert not found"
        )
    resource = get_visible_resource(db, alert.resource_id, current_user)
    if not _can_manage_resource(db, current_user, resource):
        raise _forbidden()
    if alert.status == "open":
        alert.status = "acknowledged"
        alert.acknowledged_at = datetime.now(UTC)
        alert.acknowledged_by_id = current_user.id
        db.add(alert)
        db.commit()
        db.refresh(alert)
    return _build_alert_read(db, alert)


def resolve_compliance_alert(
    db: Session,
    alert_id: int,
    payload: ComplianceAlertResolution,
    current_user: User,
) -> ComplianceAlertRead:
    alert = db.get(ComplianceAlert, alert_id)
    if alert is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Compliance alert not found"
        )
    resource = get_visible_resource(db, alert.resource_id, current_user)
    if not _can_manage_resource(db, current_user, resource):
        raise _forbidden()

    alert.status = "resolved"
    alert.resolved_at = datetime.now(UTC)
    alert.resolved_by_id = current_user.id
    alert.resolution_notes = _clean_text(payload.notes)
    db.add(alert)
    _record_audit(
        db,
        action="compliance_alert_resolved",
        actor=current_user,
        resource=resource,
        reason=alert.resolution_notes,
        metadata_json={"alert_id": alert.id, "severity": alert.severity},
    )
    db.commit()
    db.refresh(alert)
    return _build_alert_read(db, alert)


def _build_compliance_recommendations(
    *,
    overview_status: str,
    score: int,
    critical_alert_count: int,
    non_compliant_log_count: int,
    policy: ResourceUsagePolicyRead,
) -> list[str]:
    recommendations: list[str] = []
    if critical_alert_count > 0:
        recommendations.append(
            "Suspendre temporairement la ressource et notifier l'administrateur."
        )
    if score < policy.compliance_threshold:
        recommendations.append("Revoir l'attribution et renforcer les restrictions d'usage.")
    if non_compliant_log_count > 0 and "social_media" in policy.restricted_activity_categories:
        recommendations.append("Limiter ou bloquer les reseaux sociaux sur cette ressource.")
    if overview_status == "compliant":
        recommendations.append(
            "Conserver la politique actuelle et poursuivre la surveillance standard."
        )
    if policy.policy_mode == "controlled_free" and non_compliant_log_count > 0:
        recommendations.append("Reclassifier la ressource en usage mixte limite.")
    return recommendations


def get_resource_compliance_overview(
    db: Session,
    resource_id: int,
    current_user: User,
) -> ResourceComplianceOverview:
    resource = get_visible_resource(db, resource_id, current_user)
    policy = _build_policy_read(db, resource)
    usage_count = (
        db.scalar(select(func.count(UsageLog.id)).where(UsageLog.resource_id == resource.id)) or 0
    )
    compliant_count = (
        db.scalar(
            select(func.count(UsageLog.id)).where(
                UsageLog.resource_id == resource.id,
                UsageLog.is_compliant.is_(True),
            )
        )
        or 0
    )
    non_compliant_count = usage_count - compliant_count
    open_alert_count = (
        db.scalar(
            select(func.count(ComplianceAlert.id)).where(
                ComplianceAlert.resource_id == resource.id,
                ComplianceAlert.status.in_(OPEN_ALERT_STATUSES),
            )
        )
        or 0
    )
    critical_alert_count = (
        db.scalar(
            select(func.count(ComplianceAlert.id)).where(
                ComplianceAlert.resource_id == resource.id,
                ComplianceAlert.status.in_(OPEN_ALERT_STATUSES),
                ComplianceAlert.severity == "critical",
            )
        )
        or 0
    )
    last_incident_at = db.scalar(
        select(func.max(ComplianceAlert.created_at)).where(
            ComplianceAlert.resource_id == resource.id
        )
    )
    score = 100 if usage_count == 0 else round((compliant_count / usage_count) * 100)
    if resource.status in BLOCKED_RESOURCE_STATUSES:
        compliance_status = "blocked"
    elif critical_alert_count > 0 or score < policy.compliance_threshold:
        compliance_status = "non_compliant"
    elif open_alert_count > 0 or score < 100:
        compliance_status = "under_monitoring"
    else:
        compliance_status = "compliant"

    recent_logs = list(
        db.scalars(
            select(UsageLog)
            .where(UsageLog.resource_id == resource.id)
            .order_by(UsageLog.occurred_at.desc(), UsageLog.id.desc())
            .limit(10)
        )
    )
    recent_alerts = list(
        db.scalars(
            select(ComplianceAlert)
            .where(ComplianceAlert.resource_id == resource.id)
            .order_by(ComplianceAlert.created_at.desc(), ComplianceAlert.id.desc())
            .limit(10)
        )
    )
    return ResourceComplianceOverview(
        resource_id=resource.id,
        resource_label=resource.label,
        compliance_score=score,
        compliance_status=compliance_status,
        policy=policy,
        usage_log_count=usage_count,
        compliant_log_count=compliant_count,
        non_compliant_log_count=non_compliant_count,
        open_alert_count=open_alert_count,
        critical_alert_count=critical_alert_count,
        last_incident_at=last_incident_at,
        recommendations=_build_compliance_recommendations(
            overview_status=compliance_status,
            score=score,
            critical_alert_count=critical_alert_count,
            non_compliant_log_count=non_compliant_count,
            policy=policy,
        ),
        recent_logs=[_build_usage_log_read(db, usage_log) for usage_log in recent_logs],
        recent_alerts=[_build_alert_read(db, alert) for alert in recent_alerts],
    )


def suspend_resource_for_compliance(
    db: Session,
    resource_id: int,
    payload: ResourceBlockRequest,
    current_user: User,
) -> FleetResourceRead:
    resource = get_visible_resource(db, resource_id, current_user)
    if not _can_manage_resource(db, current_user, resource):
        raise _forbidden()
    resource.status = SUSPENDED_RESOURCE_STATUS
    resource.access_blocked_until = payload.blocked_until
    resource.restriction_reason = payload.reason.strip()
    db.add(resource)
    _record_audit(
        db,
        action="resource_suspended_for_compliance",
        actor=current_user,
        resource=resource,
        reason=resource.restriction_reason,
    )
    db.commit()
    db.refresh(resource)
    return _build_resource_read(db, resource)


def check_resource_access(
    db: Session,
    resource_id: int,
    current_user: User,
) -> AccessCheckRead:
    resource = get_visible_resource(db, resource_id, current_user)

    if resource.status in BLOCKED_RESOURCE_STATUSES:
        return AccessCheckRead(
            resource_id=resource.id,
            user_id=current_user.id,
            access_allowed=False,
            reason=resource.restriction_reason or "Resource access is currently blocked",
        )

    if _is_admin(current_user):
        return AccessCheckRead(
            resource_id=resource.id,
            user_id=current_user.id,
            access_allowed=True,
            reason="Administrator access",
        )

    if (
        _current_assignment_for_user(db, resource_id=resource.id, user_id=current_user.id)
        is not None
    ):
        return AccessCheckRead(
            resource_id=resource.id,
            user_id=current_user.id,
            access_allowed=True,
            reason="Resource assigned to current user",
        )

    if (
        _is_manager(current_user)
        and current_user.department_id is not None
        and _resource_has_assignment_for_department(
            db,
            resource_id=resource.id,
            department_id=current_user.department_id,
        )
    ):
        return AccessCheckRead(
            resource_id=resource.id,
            user_id=current_user.id,
            access_allowed=True,
            reason="Manager access to department resource",
        )

    return AccessCheckRead(
        resource_id=resource.id,
        user_id=current_user.id,
        access_allowed=False,
        reason="Resource is not assigned to current user",
    )


def ensure_default_fleet_access_data() -> None:
    db = SessionLocal()
    try:
        department_by_name: dict[str, Department] = {}
        used_codes = {
            department.code
            for department in db.scalars(select(Department))
            if getattr(department, "code", None)
        }
        for payload in DEFAULT_DEPARTMENTS:
            department = db.scalar(
                select(Department).where(func.lower(Department.name) == payload["name"].lower())
            )
            if department is None:
                department = Department(**payload)
                db.add(department)
                db.flush()
                used_codes.add(department.code)
            else:
                if not department.code:
                    department.code = _generate_department_code(department.name, used_codes)
                    used_codes.add(department.code)
                if department.description is None and payload.get("description"):
                    department.description = str(payload["description"])
                if not department.is_active and payload.get("is_active", True):
                    department.is_active = True
                db.add(department)
            department_by_name[department.name] = department

        existing_resource_id = db.scalar(select(FleetResource.id).limit(1))
        if existing_resource_id is None:
            for payload in DEFAULT_RESOURCES:
                department = department_by_name.get(payload["department_name"])
                db.add(
                    FleetResource(
                        resource_type=payload["resource_type"],
                        identifier=payload["identifier"],
                        label=payload["label"],
                        department_id=department.id if department else None,
                        is_premium=payload["is_premium"],
                        is_shareable=payload["is_shareable"],
                        max_assignments=payload["max_assignments"],
                        authorized_profiles=payload["authorized_profiles"],
                        notes=payload["notes"],
                        status=AVAILABLE_RESOURCE_STATUS,
                    )
                )
        else:
            resources_to_normalize = db.scalars(select(FleetResource)).all()
            for resource in resources_to_normalize:
                if resource.max_assignments is None:
                    resource.max_assignments = 1
                if not resource.is_shareable:
                    resource.max_assignments = 1
                db.add(resource)

        for resource in db.scalars(select(FleetResource)).all():
            if _get_usage_policy(db, resource.id) is not None:
                continue
            default_policy = _default_usage_policy_payload(resource)
            policy = ResourceUsagePolicy(
                resource_id=resource.id,
                policy_mode=str(default_policy["policy_mode"]),
                acceptable_use_rules=str(default_policy["acceptable_use_rules"]),
                security_level=str(default_policy["security_level"]),
                allowed_activity_categories=default_policy["allowed_activity_categories"],
                restricted_activity_categories=default_policy["restricted_activity_categories"],
                exception_roles=[],
                exception_department_ids=[],
                monitoring_enabled=True,
                auto_alert_enabled=True,
                auto_suspend_on_critical=bool(default_policy["auto_suspend_on_critical"]),
                compliance_threshold=int(default_policy["compliance_threshold"]),
            )
            db.add(policy)

        db.commit()
    finally:
        db.close()
