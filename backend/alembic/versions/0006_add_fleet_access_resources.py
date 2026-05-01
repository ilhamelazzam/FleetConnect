"""Add fleet access resource management.

Revision ID: 0006_fleet_access_resources
Revises: 0005_phone_line_usage
Create Date: 2026-04-07 10:30:00
"""

import sqlalchemy as sa
from alembic import op

revision = "0006_fleet_access_resources"
down_revision = "0005_phone_line_usage"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "departments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
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
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_departments_id"), "departments", ["id"], unique=False)
    op.create_index(op.f("ix_departments_name"), "departments", ["name"], unique=True)

    op.add_column("users", sa.Column("department_id", sa.Integer(), nullable=True))
    op.add_column("users", sa.Column("job_profile", sa.String(length=120), nullable=True))
    op.create_index(op.f("ix_users_department_id"), "users", ["department_id"], unique=False)
    op.create_foreign_key(
        op.f("fk_users_department_id_departments"),
        "users",
        "departments",
        ["department_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.create_table(
        "fleet_resources",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("resource_type", sa.String(length=30), nullable=False),
        sa.Column("identifier", sa.String(length=120), nullable=False),
        sa.Column("label", sa.String(length=160), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("department_id", sa.Integer(), nullable=True),
        sa.Column("is_premium", sa.Boolean(), nullable=False),
        sa.Column("authorized_profiles", sa.JSON(), nullable=False),
        sa.Column("access_blocked_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("restriction_reason", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
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
        sa.ForeignKeyConstraint(["department_id"], ["departments.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_fleet_resources_department_id"), "fleet_resources", ["department_id"], unique=False)
    op.create_index(op.f("ix_fleet_resources_id"), "fleet_resources", ["id"], unique=False)
    op.create_index(op.f("ix_fleet_resources_identifier"), "fleet_resources", ["identifier"], unique=True)
    op.create_index(op.f("ix_fleet_resources_resource_type"), "fleet_resources", ["resource_type"], unique=False)
    op.create_index(op.f("ix_fleet_resources_status"), "fleet_resources", ["status"], unique=False)

    op.create_table(
        "resource_assignments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("resource_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("assigned_by_id", sa.Integer(), nullable=True),
        sa.Column("revoked_by_id", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("revoke_reason", sa.Text(), nullable=True),
        sa.Column(
            "assigned_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["assigned_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["resource_id"], ["fleet_resources.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["revoked_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_resource_assignments_id"), "resource_assignments", ["id"], unique=False)
    op.create_index(op.f("ix_resource_assignments_resource_id"), "resource_assignments", ["resource_id"], unique=False)
    op.create_index(op.f("ix_resource_assignments_status"), "resource_assignments", ["status"], unique=False)
    op.create_index(op.f("ix_resource_assignments_user_id"), "resource_assignments", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_resource_assignments_user_id"), table_name="resource_assignments")
    op.drop_index(op.f("ix_resource_assignments_status"), table_name="resource_assignments")
    op.drop_index(op.f("ix_resource_assignments_resource_id"), table_name="resource_assignments")
    op.drop_index(op.f("ix_resource_assignments_id"), table_name="resource_assignments")
    op.drop_table("resource_assignments")

    op.drop_index(op.f("ix_fleet_resources_status"), table_name="fleet_resources")
    op.drop_index(op.f("ix_fleet_resources_resource_type"), table_name="fleet_resources")
    op.drop_index(op.f("ix_fleet_resources_identifier"), table_name="fleet_resources")
    op.drop_index(op.f("ix_fleet_resources_id"), table_name="fleet_resources")
    op.drop_index(op.f("ix_fleet_resources_department_id"), table_name="fleet_resources")
    op.drop_table("fleet_resources")

    op.drop_constraint(op.f("fk_users_department_id_departments"), "users", type_="foreignkey")
    op.drop_index(op.f("ix_users_department_id"), table_name="users")
    op.drop_column("users", "job_profile")
    op.drop_column("users", "department_id")

    op.drop_index(op.f("ix_departments_name"), table_name="departments")
    op.drop_index(op.f("ix_departments_id"), table_name="departments")
    op.drop_table("departments")
