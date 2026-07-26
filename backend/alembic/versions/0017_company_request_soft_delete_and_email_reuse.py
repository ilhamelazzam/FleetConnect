"""Add soft delete fields and partial email uniqueness for company requests.

Revision ID: 0017_company_request_soft_delete
Revises: 0016_company_request_role_fix
Create Date: 2026-07-20 13:50:00
"""

import sqlalchemy as sa
from alembic import op

revision = "0017_company_request_soft_delete"
down_revision = "0016_company_request_role_fix"
branch_labels = None
depends_on = None


def _get_table_names() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _get_columns(table_name: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table_name)}


def _get_indexes(table_name: str) -> set[str]:
    return {index["name"] for index in sa.inspect(op.get_bind()).get_indexes(table_name)}


def _get_foreign_keys(table_name: str) -> set[str]:
    return {
        foreign_key["name"]
        for foreign_key in sa.inspect(op.get_bind()).get_foreign_keys(table_name)
        if foreign_key.get("name")
    }


def upgrade() -> None:
    if "company_registration_requests" not in _get_table_names():
        return

    columns = _get_columns("company_registration_requests")
    with op.batch_alter_table("company_registration_requests") as batch_op:
        if "previous_request_id" not in columns:
            batch_op.add_column(sa.Column("previous_request_id", sa.Integer(), nullable=True))
        if "resubmission_number" not in columns:
            batch_op.add_column(
                sa.Column(
                    "resubmission_number",
                    sa.Integer(),
                    nullable=False,
                    server_default="1",
                )
            )
        if "is_deleted" not in columns:
            batch_op.add_column(
                sa.Column(
                    "is_deleted",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.false(),
                )
            )
        if "deleted_at" not in columns:
            batch_op.add_column(sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
        if "deleted_by" not in columns:
            batch_op.add_column(sa.Column("deleted_by", sa.Integer(), nullable=True))

    op.execute(
        sa.text(
            """
            UPDATE company_registration_requests
            SET resubmission_number = COALESCE(resubmission_number, 1),
                is_deleted = COALESCE(is_deleted, false)
            """
        )
    )

    foreign_keys = _get_foreign_keys("company_registration_requests")
    with op.batch_alter_table("company_registration_requests") as batch_op:
        if "fk_company_registration_requests_previous_request_id" not in foreign_keys:
            batch_op.create_foreign_key(
                "fk_company_registration_requests_previous_request_id",
                "company_registration_requests",
                ["previous_request_id"],
                ["id"],
                ondelete="SET NULL",
            )
        if "fk_company_registration_requests_deleted_by_users" not in foreign_keys:
            batch_op.create_foreign_key(
                "fk_company_registration_requests_deleted_by_users",
                "users",
                ["deleted_by"],
                ["id"],
                ondelete="SET NULL",
            )

    indexes = _get_indexes("company_registration_requests")
    with op.batch_alter_table("company_registration_requests") as batch_op:
        if "ix_company_registration_requests_previous_request_id" not in indexes:
            batch_op.create_index(
                "ix_company_registration_requests_previous_request_id",
                ["previous_request_id"],
                unique=False,
            )
        if "ix_company_registration_requests_deleted_by" not in indexes:
            batch_op.create_index(
                "ix_company_registration_requests_deleted_by",
                ["deleted_by"],
                unique=False,
            )
        if "ix_company_registration_requests_is_deleted" not in indexes:
            batch_op.create_index(
                "ix_company_registration_requests_is_deleted",
                ["is_deleted"],
                unique=False,
            )

    if "uq_active_company_request_email" not in _get_indexes("company_registration_requests"):
        op.execute(
            sa.text(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS uq_active_company_request_email
                ON company_registration_requests (LOWER(responsible_email))
                WHERE status IN ('pending', 'approved') AND is_deleted = false
                """
            )
        )


def downgrade() -> None:
    if "company_registration_requests" not in _get_table_names():
        return

    op.execute(sa.text("DROP INDEX IF EXISTS uq_active_company_request_email"))

    indexes = _get_indexes("company_registration_requests")
    with op.batch_alter_table("company_registration_requests") as batch_op:
        if "ix_company_registration_requests_is_deleted" in indexes:
            batch_op.drop_index("ix_company_registration_requests_is_deleted")
        if "ix_company_registration_requests_deleted_by" in indexes:
            batch_op.drop_index("ix_company_registration_requests_deleted_by")
        if "ix_company_registration_requests_previous_request_id" in indexes:
            batch_op.drop_index("ix_company_registration_requests_previous_request_id")

    foreign_keys = _get_foreign_keys("company_registration_requests")
    with op.batch_alter_table("company_registration_requests") as batch_op:
        if "fk_company_registration_requests_deleted_by_users" in foreign_keys:
            batch_op.drop_constraint(
                "fk_company_registration_requests_deleted_by_users",
                type_="foreignkey",
            )
        if "fk_company_registration_requests_previous_request_id" in foreign_keys:
            batch_op.drop_constraint(
                "fk_company_registration_requests_previous_request_id",
                type_="foreignkey",
            )

    columns = _get_columns("company_registration_requests")
    with op.batch_alter_table("company_registration_requests") as batch_op:
        if "deleted_by" in columns:
            batch_op.drop_column("deleted_by")
        if "deleted_at" in columns:
            batch_op.drop_column("deleted_at")
        if "is_deleted" in columns:
            batch_op.drop_column("is_deleted")
        if "resubmission_number" in columns:
            batch_op.drop_column("resubmission_number")
        if "previous_request_id" in columns:
            batch_op.drop_column("previous_request_id")
