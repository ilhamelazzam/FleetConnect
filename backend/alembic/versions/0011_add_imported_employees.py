"""Add imported employees directory.

Revision ID: 0011_imported_employees
Revises: 0010_department_codes
Create Date: 2026-04-21 14:20:00
"""

import sqlalchemy as sa
from alembic import op

revision = "0011_imported_employees"
down_revision = "0010_department_codes"
branch_labels = None
depends_on = None


def _get_table_names() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _get_indexes(table_name: str) -> set[str]:
    return {
        index["name"]
        for index in sa.inspect(op.get_bind()).get_indexes(table_name)
    }


def upgrade() -> None:
    if "imported_employees" not in _get_table_names():
        op.create_table(
            "imported_employees",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("full_name", sa.String(length=160), nullable=False),
            sa.Column("identity_key", sa.String(length=320), nullable=False),
            sa.Column("email", sa.String(length=255), nullable=True),
            sa.Column("employee_identifier", sa.String(length=160), nullable=True),
            sa.Column("employee_code", sa.String(length=120), nullable=True),
            sa.Column("department_name", sa.String(length=160), nullable=True),
            sa.Column("job_profile", sa.String(length=160), nullable=True),
            sa.Column("status", sa.String(length=40), nullable=False, server_default="active"),
            sa.Column("source_filename", sa.Text(), nullable=True),
            sa.Column("source_format", sa.String(length=16), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )

    existing_indexes = _get_indexes("imported_employees")

    if "ix_imported_employees_id" not in existing_indexes:
        op.create_index(op.f("ix_imported_employees_id"), "imported_employees", ["id"], unique=False)
    if "ix_imported_employees_full_name" not in existing_indexes:
        op.create_index(op.f("ix_imported_employees_full_name"), "imported_employees", ["full_name"], unique=False)
    if "ix_imported_employees_identity_key" not in existing_indexes:
        op.create_index(op.f("ix_imported_employees_identity_key"), "imported_employees", ["identity_key"], unique=True)
    if "ix_imported_employees_email" not in existing_indexes:
        op.create_index(op.f("ix_imported_employees_email"), "imported_employees", ["email"], unique=False)
    if "ix_imported_employees_employee_identifier" not in existing_indexes:
        op.create_index(
            op.f("ix_imported_employees_employee_identifier"),
            "imported_employees",
            ["employee_identifier"],
            unique=False,
        )
    if "ix_imported_employees_employee_code" not in existing_indexes:
        op.create_index(
            op.f("ix_imported_employees_employee_code"),
            "imported_employees",
            ["employee_code"],
            unique=False,
        )
    if "ix_imported_employees_department_name" not in existing_indexes:
        op.create_index(
            op.f("ix_imported_employees_department_name"),
            "imported_employees",
            ["department_name"],
            unique=False,
        )
    if "ix_imported_employees_status" not in existing_indexes:
        op.create_index(op.f("ix_imported_employees_status"), "imported_employees", ["status"], unique=False)


def downgrade() -> None:
    if "imported_employees" not in _get_table_names():
        return

    existing_indexes = _get_indexes("imported_employees")
    if "ix_imported_employees_status" in existing_indexes:
        op.drop_index(op.f("ix_imported_employees_status"), table_name="imported_employees")
    if "ix_imported_employees_department_name" in existing_indexes:
        op.drop_index(op.f("ix_imported_employees_department_name"), table_name="imported_employees")
    if "ix_imported_employees_employee_code" in existing_indexes:
        op.drop_index(op.f("ix_imported_employees_employee_code"), table_name="imported_employees")
    if "ix_imported_employees_employee_identifier" in existing_indexes:
        op.drop_index(op.f("ix_imported_employees_employee_identifier"), table_name="imported_employees")
    if "ix_imported_employees_email" in existing_indexes:
        op.drop_index(op.f("ix_imported_employees_email"), table_name="imported_employees")
    if "ix_imported_employees_identity_key" in existing_indexes:
        op.drop_index(op.f("ix_imported_employees_identity_key"), table_name="imported_employees")
    if "ix_imported_employees_full_name" in existing_indexes:
        op.drop_index(op.f("ix_imported_employees_full_name"), table_name="imported_employees")
    if "ix_imported_employees_id" in existing_indexes:
        op.drop_index(op.f("ix_imported_employees_id"), table_name="imported_employees")
    op.drop_table("imported_employees")
