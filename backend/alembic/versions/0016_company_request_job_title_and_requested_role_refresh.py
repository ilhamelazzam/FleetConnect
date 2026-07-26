"""Restore company request job title and normalize requested role values.

Revision ID: 0016_company_request_role_fix
Revises: 0015_company_request_role
Create Date: 2026-07-18 00:20:00
"""

import sqlalchemy as sa
from alembic import op

revision = "0016_company_request_role_fix"
down_revision = "0015_company_request_role"
branch_labels = None
depends_on = None


def _get_table_names() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _get_columns(table_name: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table_name)}


def upgrade() -> None:
    if "company_registration_requests" not in _get_table_names():
        return

    columns = _get_columns("company_registration_requests")
    with op.batch_alter_table("company_registration_requests") as batch_op:
        if "job_title" not in columns:
            batch_op.add_column(
                sa.Column(
                    "job_title",
                    sa.String(length=120),
                    nullable=False,
                    server_default="Responsable Telecom",
                )
            )

    columns = _get_columns("company_registration_requests")
    if "responsible_position" in columns:
        op.execute(
            sa.text(
                """
                UPDATE company_registration_requests
                SET job_title = COALESCE(NULLIF(TRIM(responsible_position), ''), job_title)
                """
            )
        )

    op.execute(
        sa.text(
            """
            UPDATE company_registration_requests
            SET requested_role = CASE
                WHEN requested_role = 'ANALYSTE' THEN 'ANALYST'
                ELSE requested_role
            END
            """
        )
    )


def downgrade() -> None:
    if "company_registration_requests" not in _get_table_names():
        return

    op.execute(
        sa.text(
            """
            UPDATE company_registration_requests
            SET requested_role = CASE
                WHEN requested_role = 'ANALYST' THEN 'ANALYSTE'
                ELSE requested_role
            END
            """
        )
    )

    columns = _get_columns("company_registration_requests")
    if "job_title" in columns:
        with op.batch_alter_table("company_registration_requests") as batch_op:
            batch_op.drop_column("job_title")
