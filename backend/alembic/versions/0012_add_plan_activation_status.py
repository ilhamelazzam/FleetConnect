"""Add plan activation status fields.

Revision ID: 0012_plan_activation_status
Revises: 0011_imported_employees
Create Date: 2026-04-29 11:05:00
"""

import sqlalchemy as sa
from alembic import op

revision = "0012_plan_activation_status"
down_revision = "0011_imported_employees"
branch_labels = None
depends_on = None


def _get_table_names() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _get_columns(table_name: str) -> set[str]:
    return {
        column["name"]
        for column in sa.inspect(op.get_bind()).get_columns(table_name)
    }


def _get_indexes(table_name: str) -> set[str]:
    return {
        index["name"]
        for index in sa.inspect(op.get_bind()).get_indexes(table_name)
    }


def _get_foreign_keys(table_name: str) -> set[str]:
    return {
        foreign_key["name"]
        for foreign_key in sa.inspect(op.get_bind()).get_foreign_keys(table_name)
        if foreign_key.get("name")
    }


def upgrade() -> None:
    if "plans" not in _get_table_names():
        return

    plan_columns = _get_columns("plans")
    activation_status_added = False
    activated_at_added = False

    if "activation_status" not in plan_columns:
        activation_status_added = True
        op.add_column(
            "plans",
            sa.Column(
                "activation_status",
                sa.String(length=30),
                nullable=False,
                server_default="inactive",
            ),
        )

    if "activated_at" not in plan_columns:
        activated_at_added = True
        op.add_column("plans", sa.Column("activated_at", sa.DateTime(timezone=True), nullable=True))

    if "activated_by_user_id" not in plan_columns:
        op.add_column("plans", sa.Column("activated_by_user_id", sa.Integer(), nullable=True))

    if activation_status_added:
        op.execute(
            sa.text(
                """
                UPDATE plans
                SET activation_status = CASE
                    WHEN active_lines > 0 THEN 'active'
                    ELSE 'inactive'
                END
                """
            )
        )

    if activation_status_added or activated_at_added:
        op.execute(
            sa.text(
                """
                UPDATE plans
                SET activated_at = COALESCE(updated_at, created_at)
                WHERE activation_status = 'active'
                  AND activated_at IS NULL
                """
            )
        )

    plan_indexes = _get_indexes("plans")
    if "ix_plans_activated_by_user_id" not in plan_indexes:
        op.create_index(op.f("ix_plans_activated_by_user_id"), "plans", ["activated_by_user_id"], unique=False)

    if (
        "users" in _get_table_names()
        and "fk_plans_activated_by_user_id_users" not in _get_foreign_keys("plans")
    ):
        op.create_foreign_key(
            "fk_plans_activated_by_user_id_users",
            "plans",
            "users",
            ["activated_by_user_id"],
            ["id"],
            ondelete="SET NULL",
        )

    if activation_status_added:
        op.alter_column("plans", "activation_status", server_default=None)


def downgrade() -> None:
    if "plans" not in _get_table_names():
        return

    plan_foreign_keys = _get_foreign_keys("plans")
    if "fk_plans_activated_by_user_id_users" in plan_foreign_keys:
        op.drop_constraint("fk_plans_activated_by_user_id_users", "plans", type_="foreignkey")

    plan_indexes = _get_indexes("plans")
    if "ix_plans_activated_by_user_id" in plan_indexes:
        op.drop_index(op.f("ix_plans_activated_by_user_id"), table_name="plans")

    plan_columns = _get_columns("plans")
    if "activated_by_user_id" in plan_columns:
        op.drop_column("plans", "activated_by_user_id")
    if "activated_at" in plan_columns:
        op.drop_column("plans", "activated_at")
    if "activation_status" in plan_columns:
        op.drop_column("plans", "activation_status")
