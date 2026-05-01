from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Department(Base):
    __tablename__ = "departments"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False, unique=True, index=True)
    code: Mapped[str] = mapped_column(String(24), nullable=False, unique=True, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class FleetResource(Base):
    __tablename__ = "fleet_resources"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    resource_type: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    identifier: Mapped[str] = mapped_column(String(120), nullable=False, unique=True, index=True)
    label: Mapped[str] = mapped_column(String(160), nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="available", index=True)
    department_id: Mapped[int | None] = mapped_column(
        ForeignKey("departments.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    is_premium: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_shareable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    max_assignments: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    authorized_profiles: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    access_blocked_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    restriction_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    def normalized_authorized_profiles(self) -> list[str]:
        raw_profiles: Any = self.authorized_profiles or []
        if not isinstance(raw_profiles, list):
            return []
        return [str(profile).strip() for profile in raw_profiles if str(profile).strip()]


class ResourceAssignment(Base):
    __tablename__ = "resource_assignments"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    resource_id: Mapped[int] = mapped_column(
        ForeignKey("fleet_resources.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    assigned_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    revoked_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="active", index=True)
    assignment_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    revoke_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    start_date: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    end_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class FleetAccessAuditLog(Base):
    __tablename__ = "fleet_access_audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    actor_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    action: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    resource_id: Mapped[int | None] = mapped_column(
        ForeignKey("fleet_resources.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    target_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    assignment_id: Mapped[int | None] = mapped_column(
        ForeignKey("resource_assignments.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        index=True,
    )


class ResourceUsagePolicy(Base):
    __tablename__ = "resource_usage_policies"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    resource_id: Mapped[int] = mapped_column(
        ForeignKey("fleet_resources.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    policy_mode: Mapped[str] = mapped_column(
        String(40), nullable=False, default="professional_only"
    )
    acceptable_use_rules: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        default="Usage reserve aux activites professionnelles autorisees.",
    )
    security_level: Mapped[str] = mapped_column(String(30), nullable=False, default="standard")
    allowed_activity_categories: Mapped[list[str]] = mapped_column(
        JSON, nullable=False, default=list
    )
    restricted_activity_categories: Mapped[list[str]] = mapped_column(
        JSON, nullable=False, default=list
    )
    exception_roles: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    exception_department_ids: Mapped[list[int]] = mapped_column(JSON, nullable=False, default=list)
    monitoring_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    auto_alert_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    auto_suspend_on_critical: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    compliance_threshold: Mapped[int] = mapped_column(Integer, nullable=False, default=85)
    created_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    updated_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class ResourceRestriction(Base):
    __tablename__ = "resource_restrictions"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    policy_id: Mapped[int] = mapped_column(
        ForeignKey("resource_usage_policies.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    category: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(30), nullable=False, default="alert")
    severity: Mapped[str] = mapped_column(String(30), nullable=False, default="warning")
    exception_roles: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    exception_department_ids: Mapped[list[int]] = mapped_column(JSON, nullable=False, default=list)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class UsageLog(Base):
    __tablename__ = "usage_logs"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    resource_id: Mapped[int] = mapped_column(
        ForeignKey("fleet_resources.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    assignment_id: Mapped[int | None] = mapped_column(
        ForeignKey("resource_assignments.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    evaluated_policy_id: Mapped[int | None] = mapped_column(
        ForeignKey("resource_usage_policies.id", ondelete="SET NULL"),
        nullable=True,
    )
    activity_type: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    activity_category: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    activity_label: Mapped[str | None] = mapped_column(String(180), nullable=True)
    usage_volume_mb: Mapped[float | None] = mapped_column(Float, nullable=True)
    duration_minutes: Mapped[float | None] = mapped_column(Float, nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        index=True,
    )
    is_compliant: Mapped[bool] = mapped_column(Boolean, nullable=False, index=True)
    policy_action: Mapped[str] = mapped_column(String(30), nullable=False, default="allow")
    severity: Mapped[str | None] = mapped_column(String(30), nullable=True, index=True)
    violation_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )


class ComplianceAlert(Base):
    __tablename__ = "compliance_alerts"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    resource_id: Mapped[int] = mapped_column(
        ForeignKey("fleet_resources.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    usage_log_id: Mapped[int | None] = mapped_column(
        ForeignKey("usage_logs.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    policy_id: Mapped[int | None] = mapped_column(
        ForeignKey("resource_usage_policies.id", ondelete="SET NULL"),
        nullable=True,
    )
    severity: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="open", index=True)
    title: Mapped[str] = mapped_column(String(180), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    recommended_action: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        index=True,
    )
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    acknowledged_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    resolution_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
