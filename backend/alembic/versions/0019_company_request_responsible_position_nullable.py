"""Relax legacy responsible_position constraint for company requests.

Revision ID: 0019_company_request_legacy_pos
Revises: 0018_company_request_review
Create Date: 2026-07-20 18:45:00
"""

import sqlalchemy as sa
from alembic import op

revision = "0019_company_request_legacy_pos"
down_revision = "0018_company_request_review"
branch_labels = None
depends_on = None


def _get_table_names() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _get_columns(table_name: str) -> dict[str, dict[str, object]]:
    return {
        column["name"]: column
        for column in sa.inspect(op.get_bind()).get_columns(table_name)
    }


def upgrade() -> None:
    if "company_registration_requests" not in _get_table_names():
        return

    columns = _get_columns("company_registration_requests")
    if "responsible_position" not in columns:
        return

    op.execute(
        sa.text(
            """
            UPDATE company_registration_requests
            SET responsible_position = COALESCE(
                NULLIF(TRIM(responsible_position), ''),
                NULLIF(TRIM(job_title), ''),
                'Responsable Telecom'
            )
            WHERE responsible_position IS NULL
               OR TRIM(responsible_position) = ''
            """
        )
    )

    with op.batch_alter_table("company_registration_requests") as batch_op:
        batch_op.alter_column(
            "responsible_position",
            existing_type=sa.String(length=120),
            nullable=True,
        )


def downgrade() -> None:
    if "company_registration_requests" not in _get_table_names():
        return

    columns = _get_columns("company_registration_requests")
    if "responsible_position" not in columns:
        return

    op.execute(
        sa.text(
            """
            UPDATE company_registration_requests
            SET responsible_position = COALESCE(
                NULLIF(TRIM(responsible_position), ''),
                NULLIF(TRIM(job_title), ''),
                'Responsable Telecom'
            )
            WHERE responsible_position IS NULL
               OR TRIM(responsible_position) = ''
            """
        )
    )

    with op.batch_alter_table("company_registration_requests") as batch_op:
        batch_op.alter_column(
            "responsible_position",
            existing_type=sa.String(length=120),
            nullable=False,
        )
