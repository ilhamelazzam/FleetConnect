"""Add many-to-many fleet access assignments.

Revision ID: 0007_fleet_access_m2m
Revises: 0006_fleet_access_resources
Create Date: 2026-04-08 10:10:00
"""

import sqlalchemy as sa
from alembic import op

revision = "0007_fleet_access_m2m"
down_revision = "0006_fleet_access_resources"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "fleet_resources",
        sa.Column("is_shareable", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.add_column(
        "fleet_resources",
        sa.Column("max_assignments", sa.Integer(), server_default="1", nullable=False),
    )

    op.add_column("resource_assignments", sa.Column("assignment_reason", sa.Text(), nullable=True))
    op.add_column(
        "resource_assignments",
        sa.Column(
            "start_date",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
    )
    op.add_column(
        "resource_assignments", sa.Column("end_date", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("resource_assignments", sa.Column("notes", sa.Text(), nullable=True))
    op.create_index(
        op.f("ix_resource_assignments_resource_user_status"),
        "resource_assignments",
        ["resource_id", "user_id", "status"],
        unique=False,
    )
    op.execute(
        "UPDATE resource_assignments SET assignment_reason = reason WHERE assignment_reason IS NULL"
    )

    op.create_table(
        "fleet_access_audit_logs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("actor_user_id", sa.Integer(), nullable=True),
        sa.Column("action", sa.String(length=80), nullable=False),
        sa.Column("resource_id", sa.Integer(), nullable=True),
        sa.Column("target_user_id", sa.Integer(), nullable=True),
        sa.Column("assignment_id", sa.Integer(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column(
            "occurred_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["assignment_id"], ["resource_assignments.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["resource_id"], ["fleet_resources.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["target_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_fleet_access_audit_logs_action"),
        "fleet_access_audit_logs",
        ["action"],
        unique=False,
    )
    op.create_index(
        op.f("ix_fleet_access_audit_logs_actor_user_id"),
        "fleet_access_audit_logs",
        ["actor_user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_fleet_access_audit_logs_assignment_id"),
        "fleet_access_audit_logs",
        ["assignment_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_fleet_access_audit_logs_id"), "fleet_access_audit_logs", ["id"], unique=False
    )
    op.create_index(
        op.f("ix_fleet_access_audit_logs_occurred_at"),
        "fleet_access_audit_logs",
        ["occurred_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_fleet_access_audit_logs_resource_id"),
        "fleet_access_audit_logs",
        ["resource_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_fleet_access_audit_logs_target_user_id"),
        "fleet_access_audit_logs",
        ["target_user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_fleet_access_audit_logs_target_user_id"), table_name="fleet_access_audit_logs"
    )
    op.drop_index(
        op.f("ix_fleet_access_audit_logs_resource_id"), table_name="fleet_access_audit_logs"
    )
    op.drop_index(
        op.f("ix_fleet_access_audit_logs_occurred_at"), table_name="fleet_access_audit_logs"
    )
    op.drop_index(op.f("ix_fleet_access_audit_logs_id"), table_name="fleet_access_audit_logs")
    op.drop_index(
        op.f("ix_fleet_access_audit_logs_assignment_id"), table_name="fleet_access_audit_logs"
    )
    op.drop_index(
        op.f("ix_fleet_access_audit_logs_actor_user_id"), table_name="fleet_access_audit_logs"
    )
    op.drop_index(op.f("ix_fleet_access_audit_logs_action"), table_name="fleet_access_audit_logs")
    op.drop_table("fleet_access_audit_logs")

    op.drop_index(
        op.f("ix_resource_assignments_resource_user_status"), table_name="resource_assignments"
    )
    op.drop_column("resource_assignments", "notes")
    op.drop_column("resource_assignments", "end_date")
    op.drop_column("resource_assignments", "start_date")
    op.drop_column("resource_assignments", "assignment_reason")

    op.drop_column("fleet_resources", "max_assignments")
    op.drop_column("fleet_resources", "is_shareable")
