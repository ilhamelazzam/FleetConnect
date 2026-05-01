"""Add resource usage governance.

Revision ID: 0008_usage_governance
Revises: 0007_fleet_access_m2m
Create Date: 2026-04-08 15:45:00
"""

import sqlalchemy as sa
from alembic import op

revision = "0008_usage_governance"
down_revision = "0007_fleet_access_m2m"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "resource_usage_policies",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("resource_id", sa.Integer(), nullable=False),
        sa.Column("policy_mode", sa.String(length=40), nullable=False),
        sa.Column("acceptable_use_rules", sa.Text(), nullable=False),
        sa.Column("security_level", sa.String(length=30), nullable=False),
        sa.Column("allowed_activity_categories", sa.JSON(), nullable=False),
        sa.Column("restricted_activity_categories", sa.JSON(), nullable=False),
        sa.Column("exception_roles", sa.JSON(), nullable=False),
        sa.Column("exception_department_ids", sa.JSON(), nullable=False),
        sa.Column("monitoring_enabled", sa.Boolean(), nullable=False),
        sa.Column("auto_alert_enabled", sa.Boolean(), nullable=False),
        sa.Column("auto_suspend_on_critical", sa.Boolean(), nullable=False),
        sa.Column("compliance_threshold", sa.Integer(), nullable=False),
        sa.Column("created_by_id", sa.Integer(), nullable=True),
        sa.Column("updated_by_id", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["resource_id"], ["fleet_resources.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["updated_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("resource_id"),
    )
    op.create_index(
        op.f("ix_resource_usage_policies_id"),
        "resource_usage_policies",
        ["id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_resource_usage_policies_resource_id"),
        "resource_usage_policies",
        ["resource_id"],
        unique=True,
    )

    op.create_table(
        "resource_restrictions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("policy_id", sa.Integer(), nullable=False),
        sa.Column("category", sa.String(length=80), nullable=False),
        sa.Column("action", sa.String(length=30), nullable=False),
        sa.Column("severity", sa.String(length=30), nullable=False),
        sa.Column("exception_roles", sa.JSON(), nullable=False),
        sa.Column("exception_department_ids", sa.JSON(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["policy_id"], ["resource_usage_policies.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_resource_restrictions_category"), "resource_restrictions", ["category"]
    )
    op.create_index(op.f("ix_resource_restrictions_id"), "resource_restrictions", ["id"])
    op.create_index(
        op.f("ix_resource_restrictions_is_active"), "resource_restrictions", ["is_active"]
    )
    op.create_index(
        op.f("ix_resource_restrictions_policy_id"), "resource_restrictions", ["policy_id"]
    )

    op.create_table(
        "usage_logs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("resource_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("assignment_id", sa.Integer(), nullable=True),
        sa.Column("evaluated_policy_id", sa.Integer(), nullable=True),
        sa.Column("activity_type", sa.String(length=80), nullable=False),
        sa.Column("activity_category", sa.String(length=80), nullable=False),
        sa.Column("activity_label", sa.String(length=180), nullable=True),
        sa.Column("usage_volume_mb", sa.Float(), nullable=True),
        sa.Column("duration_minutes", sa.Float(), nullable=True),
        sa.Column(
            "occurred_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column("is_compliant", sa.Boolean(), nullable=False),
        sa.Column("policy_action", sa.String(length=30), nullable=False),
        sa.Column("severity", sa.String(length=30), nullable=True),
        sa.Column("violation_reason", sa.Text(), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["assignment_id"], ["resource_assignments.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["evaluated_policy_id"], ["resource_usage_policies.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["resource_id"], ["fleet_resources.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_usage_logs_activity_category"), "usage_logs", ["activity_category"])
    op.create_index(op.f("ix_usage_logs_activity_type"), "usage_logs", ["activity_type"])
    op.create_index(op.f("ix_usage_logs_assignment_id"), "usage_logs", ["assignment_id"])
    op.create_index(op.f("ix_usage_logs_id"), "usage_logs", ["id"])
    op.create_index(op.f("ix_usage_logs_is_compliant"), "usage_logs", ["is_compliant"])
    op.create_index(op.f("ix_usage_logs_occurred_at"), "usage_logs", ["occurred_at"])
    op.create_index(op.f("ix_usage_logs_resource_id"), "usage_logs", ["resource_id"])
    op.create_index(op.f("ix_usage_logs_severity"), "usage_logs", ["severity"])
    op.create_index(op.f("ix_usage_logs_user_id"), "usage_logs", ["user_id"])

    op.create_table(
        "compliance_alerts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("resource_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("usage_log_id", sa.Integer(), nullable=True),
        sa.Column("policy_id", sa.Integer(), nullable=True),
        sa.Column("severity", sa.String(length=30), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("title", sa.String(length=180), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("recommended_action", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("acknowledged_by_id", sa.Integer(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_by_id", sa.Integer(), nullable=True),
        sa.Column("resolution_notes", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["acknowledged_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["policy_id"], ["resource_usage_policies.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["resolved_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["resource_id"], ["fleet_resources.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["usage_log_id"], ["usage_logs.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_compliance_alerts_created_at"), "compliance_alerts", ["created_at"])
    op.create_index(op.f("ix_compliance_alerts_id"), "compliance_alerts", ["id"])
    op.create_index(op.f("ix_compliance_alerts_resource_id"), "compliance_alerts", ["resource_id"])
    op.create_index(op.f("ix_compliance_alerts_severity"), "compliance_alerts", ["severity"])
    op.create_index(op.f("ix_compliance_alerts_status"), "compliance_alerts", ["status"])
    op.create_index(
        op.f("ix_compliance_alerts_usage_log_id"), "compliance_alerts", ["usage_log_id"]
    )
    op.create_index(op.f("ix_compliance_alerts_user_id"), "compliance_alerts", ["user_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_compliance_alerts_user_id"), table_name="compliance_alerts")
    op.drop_index(op.f("ix_compliance_alerts_usage_log_id"), table_name="compliance_alerts")
    op.drop_index(op.f("ix_compliance_alerts_status"), table_name="compliance_alerts")
    op.drop_index(op.f("ix_compliance_alerts_severity"), table_name="compliance_alerts")
    op.drop_index(op.f("ix_compliance_alerts_resource_id"), table_name="compliance_alerts")
    op.drop_index(op.f("ix_compliance_alerts_id"), table_name="compliance_alerts")
    op.drop_index(op.f("ix_compliance_alerts_created_at"), table_name="compliance_alerts")
    op.drop_table("compliance_alerts")

    op.drop_index(op.f("ix_usage_logs_user_id"), table_name="usage_logs")
    op.drop_index(op.f("ix_usage_logs_severity"), table_name="usage_logs")
    op.drop_index(op.f("ix_usage_logs_resource_id"), table_name="usage_logs")
    op.drop_index(op.f("ix_usage_logs_occurred_at"), table_name="usage_logs")
    op.drop_index(op.f("ix_usage_logs_is_compliant"), table_name="usage_logs")
    op.drop_index(op.f("ix_usage_logs_id"), table_name="usage_logs")
    op.drop_index(op.f("ix_usage_logs_assignment_id"), table_name="usage_logs")
    op.drop_index(op.f("ix_usage_logs_activity_type"), table_name="usage_logs")
    op.drop_index(op.f("ix_usage_logs_activity_category"), table_name="usage_logs")
    op.drop_table("usage_logs")

    op.drop_index(op.f("ix_resource_restrictions_policy_id"), table_name="resource_restrictions")
    op.drop_index(op.f("ix_resource_restrictions_is_active"), table_name="resource_restrictions")
    op.drop_index(op.f("ix_resource_restrictions_id"), table_name="resource_restrictions")
    op.drop_index(op.f("ix_resource_restrictions_category"), table_name="resource_restrictions")
    op.drop_table("resource_restrictions")

    op.drop_index(
        op.f("ix_resource_usage_policies_resource_id"), table_name="resource_usage_policies"
    )
    op.drop_index(op.f("ix_resource_usage_policies_id"), table_name="resource_usage_policies")
    op.drop_table("resource_usage_policies")
