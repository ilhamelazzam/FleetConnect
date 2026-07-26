"""Add companies and company registration requests.

Revision ID: 0013_company_registration_req
Revises: 0012_plan_activation_status
Create Date: 2026-06-22 12:00:00
"""

import sqlalchemy as sa
from alembic import op

revision = "0013_company_registration_req"
down_revision = "0012_plan_activation_status"
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
    table_names = _get_table_names()

    if "companies" not in table_names:
        op.create_table(
            "companies",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(length=160), nullable=False),
            sa.Column("sector", sa.String(length=120), nullable=False),
            sa.Column("city", sa.String(length=120), nullable=False),
            sa.Column("phone", sa.String(length=30), nullable=False),
            sa.Column("ice", sa.String(length=80), nullable=True),
            sa.Column("rc", sa.String(length=80), nullable=True),
            sa.Column("tax_id", sa.String(length=80), nullable=True),
            sa.Column("cnss", sa.String(length=80), nullable=True),
            sa.Column("patente", sa.String(length=80), nullable=True),
            sa.Column("website", sa.String(length=255), nullable=True),
            sa.Column("estimated_phone_lines", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("employees_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("operators_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("coverage_zones_json", sa.Text(), nullable=False, server_default="[]"),
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
            sa.UniqueConstraint("ice"),
            sa.UniqueConstraint("rc"),
        )
        op.create_index(op.f("ix_companies_id"), "companies", ["id"], unique=False)
        op.create_index(op.f("ix_companies_name"), "companies", ["name"], unique=False)
        op.create_index(op.f("ix_companies_city"), "companies", ["city"], unique=False)

    if "users" in _get_table_names():
        user_columns = _get_columns("users")
        user_indexes = _get_indexes("users")
        user_foreign_keys = _get_foreign_keys("users")
        with op.batch_alter_table("users") as batch_op:
            if "company_id" not in user_columns:
                batch_op.add_column(sa.Column("company_id", sa.Integer(), nullable=True))
            if "ix_users_company_id" not in user_indexes:
                batch_op.create_index(op.f("ix_users_company_id"), ["company_id"], unique=False)
            if "fk_users_company_id_companies" not in user_foreign_keys:
                batch_op.create_foreign_key(
                    "fk_users_company_id_companies",
                    "companies",
                    ["company_id"],
                    ["id"],
                    ondelete="SET NULL",
                )

    if "company_registration_requests" not in _get_table_names():
        op.create_table(
            "company_registration_requests",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("responsible_full_name", sa.String(length=120), nullable=False),
            sa.Column("responsible_phone", sa.String(length=30), nullable=False),
            sa.Column("responsible_position", sa.String(length=120), nullable=False),
            sa.Column("responsible_email", sa.String(length=255), nullable=False),
            sa.Column("password_hash", sa.String(length=255), nullable=False),
            sa.Column("company_name", sa.String(length=160), nullable=False),
            sa.Column("sector", sa.String(length=120), nullable=False),
            sa.Column("city", sa.String(length=120), nullable=False),
            sa.Column("company_phone", sa.String(length=30), nullable=False),
            sa.Column("ice", sa.String(length=80), nullable=True),
            sa.Column("rc", sa.String(length=80), nullable=True),
            sa.Column("tax_id", sa.String(length=80), nullable=True),
            sa.Column("cnss", sa.String(length=80), nullable=True),
            sa.Column("patente", sa.String(length=80), nullable=True),
            sa.Column("website", sa.String(length=255), nullable=True),
            sa.Column("estimated_phone_lines", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("employees_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("operators_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("coverage_zones_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("logo_path", sa.String(length=500), nullable=True),
            sa.Column("legal_representative_cin_path", sa.String(length=500), nullable=False),
            sa.Column("commercial_register_path", sa.String(length=500), nullable=False),
            sa.Column("fiscal_document_path", sa.String(length=500), nullable=True),
            sa.Column("company_stamp_path", sa.String(length=500), nullable=True),
            sa.Column("status", sa.String(length=30), nullable=False, server_default="pending"),
            sa.Column("rejection_reason", sa.Text(), nullable=True),
            sa.Column("reviewed_by", sa.Integer(), nullable=True),
            sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("approved_company_id", sa.Integer(), nullable=True),
            sa.Column("approved_admin_user_id", sa.Integer(), nullable=True),
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
            sa.ForeignKeyConstraint(["reviewed_by"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["approved_company_id"], ["companies.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(
                ["approved_admin_user_id"],
                ["users.id"],
                ondelete="SET NULL",
            ),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            op.f("ix_company_registration_requests_id"),
            "company_registration_requests",
            ["id"],
            unique=False,
        )
        op.create_index(
            op.f("ix_company_registration_requests_responsible_email"),
            "company_registration_requests",
            ["responsible_email"],
            unique=False,
        )
        op.create_index(
            op.f("ix_company_registration_requests_company_name"),
            "company_registration_requests",
            ["company_name"],
            unique=False,
        )
        op.create_index(
            op.f("ix_company_registration_requests_city"),
            "company_registration_requests",
            ["city"],
            unique=False,
        )
        op.create_index(
            op.f("ix_company_registration_requests_ice"),
            "company_registration_requests",
            ["ice"],
            unique=False,
        )
        op.create_index(
            op.f("ix_company_registration_requests_rc"),
            "company_registration_requests",
            ["rc"],
            unique=False,
        )
        op.create_index(
            op.f("ix_company_registration_requests_status"),
            "company_registration_requests",
            ["status"],
            unique=False,
        )
        op.create_index(
            op.f("ix_company_registration_requests_reviewed_by"),
            "company_registration_requests",
            ["reviewed_by"],
            unique=False,
        )
        op.create_index(
            op.f("ix_company_registration_requests_approved_company_id"),
            "company_registration_requests",
            ["approved_company_id"],
            unique=False,
        )
        op.create_index(
            op.f("ix_company_registration_requests_approved_admin_user_id"),
            "company_registration_requests",
            ["approved_admin_user_id"],
            unique=False,
        )


def downgrade() -> None:
    table_names = _get_table_names()

    if "company_registration_requests" in table_names:
        indexes = _get_indexes("company_registration_requests")
        for index_name in (
            op.f("ix_company_registration_requests_approved_admin_user_id"),
            op.f("ix_company_registration_requests_approved_company_id"),
            op.f("ix_company_registration_requests_reviewed_by"),
            op.f("ix_company_registration_requests_status"),
            op.f("ix_company_registration_requests_rc"),
            op.f("ix_company_registration_requests_ice"),
            op.f("ix_company_registration_requests_city"),
            op.f("ix_company_registration_requests_company_name"),
            op.f("ix_company_registration_requests_responsible_email"),
            op.f("ix_company_registration_requests_id"),
        ):
            if index_name in indexes:
                op.drop_index(index_name, table_name="company_registration_requests")
        op.drop_table("company_registration_requests")

    if "users" in _get_table_names():
        user_columns = _get_columns("users")
        user_indexes = _get_indexes("users")
        with op.batch_alter_table("users") as batch_op:
            if op.f("ix_users_company_id") in user_indexes:
                batch_op.drop_index(op.f("ix_users_company_id"))
            if "company_id" in user_columns:
                batch_op.drop_column("company_id")

    if "companies" in _get_table_names():
        indexes = _get_indexes("companies")
        for index_name in (
            op.f("ix_companies_city"),
            op.f("ix_companies_name"),
            op.f("ix_companies_id"),
        ):
            if index_name in indexes:
                op.drop_index(index_name, table_name="companies")
        op.drop_table("companies")
