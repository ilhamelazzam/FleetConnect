"""Add company join codes and user onboarding fields.

Revision ID: 0014_user_onboarding_workflow
Revises: 0013_company_registration_req
Create Date: 2026-07-13 13:00:00
"""

import sqlalchemy as sa
from alembic import op

revision = "0014_user_onboarding_workflow"
down_revision = "0013_company_registration_req"
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


def _get_unique_constraints(table_name: str) -> set[str]:
    return {
        constraint["name"]
        for constraint in sa.inspect(op.get_bind()).get_unique_constraints(table_name)
        if constraint.get("name")
    }


def upgrade() -> None:
    table_names = _get_table_names()

    if "companies" in table_names:
        company_columns = _get_columns("companies")
        company_indexes = _get_indexes("companies")
        company_unique_constraints = _get_unique_constraints("companies")
        with op.batch_alter_table("companies") as batch_op:
            if "join_code" not in company_columns:
                batch_op.add_column(sa.Column("join_code", sa.String(length=32), nullable=True))
            if "ix_companies_join_code" not in company_indexes:
                batch_op.create_index(op.f("ix_companies_join_code"), ["join_code"], unique=False)
            if "uq_companies_join_code" not in company_unique_constraints:
                batch_op.create_unique_constraint("uq_companies_join_code", ["join_code"])

    if "users" in table_names:
        user_columns = _get_columns("users")
        user_indexes = _get_indexes("users")
        with op.batch_alter_table("users") as batch_op:
            if "phone" not in user_columns:
                batch_op.add_column(sa.Column("phone", sa.String(length=30), nullable=True))
            if "requested_department" not in user_columns:
                batch_op.add_column(
                    sa.Column("requested_department", sa.String(length=120), nullable=True)
                )
            if "account_status" not in user_columns:
                batch_op.add_column(
                    sa.Column(
                        "account_status",
                        sa.String(length=30),
                        nullable=False,
                        server_default="active",
                    )
                )
            if "ix_users_account_status" not in user_indexes:
                batch_op.create_index(op.f("ix_users_account_status"), ["account_status"], unique=False)

        if "account_status" not in user_columns:
            op.execute(
                sa.text(
                    """
                    UPDATE users
                    SET account_status = CASE
                        WHEN is_active = TRUE THEN 'active'
                        ELSE 'suspended'
                    END
                    """
                )
            )


def downgrade() -> None:
    table_names = _get_table_names()

    if "users" in table_names:
        user_columns = _get_columns("users")
        user_indexes = _get_indexes("users")
        with op.batch_alter_table("users") as batch_op:
            if op.f("ix_users_account_status") in user_indexes:
                batch_op.drop_index(op.f("ix_users_account_status"))
            if "account_status" in user_columns:
                batch_op.drop_column("account_status")
            if "requested_department" in user_columns:
                batch_op.drop_column("requested_department")
            if "phone" in user_columns:
                batch_op.drop_column("phone")

    if "companies" in table_names:
        company_columns = _get_columns("companies")
        company_indexes = _get_indexes("companies")
        company_unique_constraints = _get_unique_constraints("companies")
        with op.batch_alter_table("companies") as batch_op:
            if "uq_companies_join_code" in company_unique_constraints:
                batch_op.drop_constraint("uq_companies_join_code", type_="unique")
            if op.f("ix_companies_join_code") in company_indexes:
                batch_op.drop_index(op.f("ix_companies_join_code"))
            if "join_code" in company_columns:
                batch_op.drop_column("join_code")
