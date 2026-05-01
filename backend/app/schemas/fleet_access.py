from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ResourceType = Literal["phone_line", "mobile_phone", "tablet", "laptop", "internet_connection"]
ResourceStatus = Literal["available", "assigned", "suspended", "restricted"]
AssignmentStatus = Literal["active", "revoked", "suspended"]
UsagePolicyMode = Literal["professional_only", "mixed_limited", "controlled_free"]
UsageSecurityLevel = Literal["standard", "sensitive", "critical"]
RestrictionAction = Literal["allow", "alert", "block"]
UsageSeverity = Literal["warning", "moderate", "critical"]
ComplianceAlertStatus = Literal["open", "acknowledged", "resolved"]
UsageComplianceStatus = Literal["compliant", "under_monitoring", "non_compliant", "blocked"]
AuditAction = Literal[
    "resource_created",
    "assignment_created",
    "assignment_revoked",
    "resource_blocked",
    "resource_unblocked",
    "usage_policy_updated",
    "usage_log_recorded",
    "compliance_alert_created",
    "compliance_alert_resolved",
    "resource_suspended_for_compliance",
]


class DepartmentBase(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    code: str = Field(min_length=2, max_length=24, pattern=r"^[A-Za-z0-9_-]+$")
    description: str | None = Field(default=None, max_length=1000)
    is_active: bool = True


class DepartmentCreate(DepartmentBase):
    pass


class DepartmentUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    code: str | None = Field(default=None, min_length=2, max_length=24, pattern=r"^[A-Za-z0-9_-]+$")
    description: str | None = Field(default=None, max_length=1000)
    is_active: bool | None = None


class DepartmentRead(DepartmentBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: datetime


class FleetResourceCreate(BaseModel):
    resource_type: ResourceType
    identifier: str = Field(min_length=2, max_length=120)
    label: str = Field(min_length=2, max_length=160)
    department_id: int | None = Field(default=None, gt=0)
    is_premium: bool = False
    is_shareable: bool = False
    max_assignments: int = Field(default=1, ge=1, le=500)
    authorized_profiles: list[str] = Field(default_factory=list, max_length=12)
    notes: str | None = Field(default=None, max_length=1000)


class FleetResourceUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=2, max_length=160)
    department_id: int | None = Field(default=None, gt=0)
    is_premium: bool | None = None
    is_shareable: bool | None = None
    max_assignments: int | None = Field(default=None, ge=1, le=500)
    authorized_profiles: list[str] | None = Field(default=None, max_length=12)
    notes: str | None = Field(default=None, max_length=1000)


class ResourceActiveAssignmentRead(BaseModel):
    id: int
    user_id: int
    user_name: str
    user_email: str
    department_id: int | None
    department_name: str | None
    status: AssignmentStatus
    assignment_reason: str | None
    assigned_by_id: int | None
    assigned_by_name: str | None
    assigned_at: datetime
    start_date: datetime
    end_date: datetime | None
    notes: str | None


class FleetResourceRead(BaseModel):
    id: int
    resource_type: ResourceType
    identifier: str
    label: str
    status: ResourceStatus
    department_id: int | None
    department_name: str | None
    is_premium: bool
    is_shareable: bool
    max_assignments: int
    authorized_profiles: list[str]
    access_blocked_until: datetime | None
    restriction_reason: str | None
    notes: str | None
    active_assignment_count: int
    available_assignment_slots: int
    active_assignments: list[ResourceActiveAssignmentRead]
    assigned_user_id: int | None
    assigned_user_name: str | None
    assigned_user_email: str | None
    current_assignment_id: int | None
    usage_policy_mode: UsagePolicyMode
    usage_compliance_score: int
    usage_compliance_status: UsageComplianceStatus
    usage_open_alert_count: int
    usage_last_incident_at: datetime | None
    created_at: datetime
    updated_at: datetime


class ResourceAssignmentCreate(BaseModel):
    user_id: int = Field(gt=0)
    assignment_reason: str | None = Field(default=None, max_length=1000)
    reason: str | None = Field(default=None, max_length=1000)
    start_date: datetime | None = None
    end_date: datetime | None = None
    notes: str | None = Field(default=None, max_length=1000)


class ResourceAssignmentBulkCreate(BaseModel):
    user_ids: list[int] = Field(min_length=1, max_length=50)
    assignment_reason: str | None = Field(default=None, max_length=1000)
    reason: str | None = Field(default=None, max_length=1000)
    start_date: datetime | None = None
    end_date: datetime | None = None
    notes: str | None = Field(default=None, max_length=1000)


class UserResourcesAssignmentCreate(BaseModel):
    resource_ids: list[int] = Field(min_length=1, max_length=50)
    assignment_reason: str | None = Field(default=None, max_length=1000)
    reason: str | None = Field(default=None, max_length=1000)
    start_date: datetime | None = None
    end_date: datetime | None = None
    notes: str | None = Field(default=None, max_length=1000)


class ResourceAssignmentRevoke(BaseModel):
    reason: str | None = Field(default=None, max_length=1000)


class ResourceBlockRequest(BaseModel):
    status: Literal["suspended", "restricted"] = "suspended"
    reason: str = Field(min_length=2, max_length=1000)
    blocked_until: datetime | None = None


class ResourceAssignmentRead(BaseModel):
    id: int
    resource_id: int
    resource_label: str
    resource_identifier: str
    resource_type: ResourceType
    user_id: int
    user_name: str
    user_email: str
    department_id: int | None
    department_name: str | None
    status: AssignmentStatus
    assignment_reason: str | None
    reason: str | None
    revoke_reason: str | None
    assigned_by_id: int | None
    assigned_by_name: str | None
    assigned_by_email: str | None
    revoked_by_id: int | None
    revoked_by_name: str | None
    revoked_by_email: str | None
    assigned_at: datetime
    start_date: datetime
    end_date: datetime | None
    notes: str | None
    revoked_at: datetime | None


class AccessCheckRead(BaseModel):
    resource_id: int
    user_id: int
    access_allowed: bool
    reason: str


class FleetAccessAuditLogRead(BaseModel):
    id: int
    action: AuditAction
    actor_user_id: int | None
    actor_user_name: str | None
    target_user_id: int | None
    target_user_name: str | None
    resource_id: int | None
    resource_label: str | None
    assignment_id: int | None
    reason: str | None
    metadata_json: dict
    occurred_at: datetime


class ResourceRestrictionCreate(BaseModel):
    category: str = Field(min_length=2, max_length=80)
    action: RestrictionAction = "alert"
    severity: UsageSeverity = "warning"
    exception_roles: list[str] = Field(default_factory=list, max_length=12)
    exception_department_ids: list[int] = Field(default_factory=list, max_length=20)
    notes: str | None = Field(default=None, max_length=1000)
    is_active: bool = True


class ResourceRestrictionRead(ResourceRestrictionCreate):
    id: int
    policy_id: int
    created_at: datetime
    updated_at: datetime


class ResourceUsagePolicyUpsert(BaseModel):
    policy_mode: UsagePolicyMode = "professional_only"
    acceptable_use_rules: str = Field(
        default="Usage reserve aux activites professionnelles autorisees.",
        min_length=5,
        max_length=4000,
    )
    security_level: UsageSecurityLevel = "standard"
    allowed_activity_categories: list[str] = Field(default_factory=list, max_length=30)
    restricted_activity_categories: list[str] = Field(default_factory=list, max_length=30)
    exception_roles: list[str] = Field(default_factory=list, max_length=12)
    exception_department_ids: list[int] = Field(default_factory=list, max_length=20)
    monitoring_enabled: bool = True
    auto_alert_enabled: bool = True
    auto_suspend_on_critical: bool = False
    compliance_threshold: int = Field(default=85, ge=0, le=100)
    restrictions: list[ResourceRestrictionCreate] = Field(default_factory=list, max_length=50)


class ResourceUsagePolicyRead(ResourceUsagePolicyUpsert):
    id: int
    resource_id: int
    created_by_id: int | None
    updated_by_id: int | None
    created_at: datetime | None
    updated_at: datetime | None
    restrictions: list[ResourceRestrictionRead]


class UsageLogCreate(BaseModel):
    user_id: int | None = Field(default=None, gt=0)
    assignment_id: int | None = Field(default=None, gt=0)
    activity_type: str = Field(min_length=2, max_length=80)
    activity_category: str = Field(min_length=2, max_length=80)
    activity_label: str | None = Field(default=None, max_length=180)
    usage_volume_mb: float | None = Field(default=None, ge=0)
    duration_minutes: float | None = Field(default=None, ge=0)
    occurred_at: datetime | None = None
    metadata_json: dict = Field(default_factory=dict)


class UsageLogRead(BaseModel):
    id: int
    resource_id: int
    resource_label: str
    user_id: int
    user_name: str
    assignment_id: int | None
    activity_type: str
    activity_category: str
    activity_label: str | None
    usage_volume_mb: float | None
    duration_minutes: float | None
    occurred_at: datetime
    is_compliant: bool
    policy_action: RestrictionAction
    severity: UsageSeverity | None
    violation_reason: str | None
    evaluated_policy_id: int | None
    metadata_json: dict
    created_at: datetime


class ComplianceAlertRead(BaseModel):
    id: int
    resource_id: int
    resource_label: str
    resource_identifier: str
    user_id: int
    user_name: str
    user_email: str
    department_id: int | None
    department_name: str | None
    usage_log_id: int | None
    policy_id: int | None
    severity: UsageSeverity
    status: ComplianceAlertStatus
    title: str
    description: str
    recommended_action: str | None
    risk_id: str
    impact: str
    ai_recommendation: str
    suggested_action: str
    confidence_score: float
    created_at: datetime
    acknowledged_at: datetime | None
    acknowledged_by_id: int | None
    resolved_at: datetime | None
    resolved_by_id: int | None
    resolution_notes: str | None


class ComplianceAlertResolution(BaseModel):
    notes: str | None = Field(default=None, max_length=1000)


class ResourceComplianceOverview(BaseModel):
    resource_id: int
    resource_label: str
    compliance_score: int
    compliance_status: UsageComplianceStatus
    policy: ResourceUsagePolicyRead
    usage_log_count: int
    compliant_log_count: int
    non_compliant_log_count: int
    open_alert_count: int
    critical_alert_count: int
    last_incident_at: datetime | None
    recommendations: list[str]
    recent_logs: list[UsageLogRead]
    recent_alerts: list[ComplianceAlertRead]
