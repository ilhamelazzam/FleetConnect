"""Extend active request email uniqueness to under-review company requests.

Revision ID: 0018_company_request_review
Revises: 0017_company_request_soft_delete
Create Date: 2026-07-20 16:10:00
"""

import sqlalchemy as sa
from alembic import op

revision = "0018_company_request_review"
down_revision = "0017_company_request_soft_delete"
branch_labels = None
depends_on = None


def _get_table_names() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    if "company_registration_requests" not in _get_table_names():
        return

    op.execute(sa.text("DROP INDEX IF EXISTS uq_active_company_request_email"))
    op.execute(
        sa.text(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uq_active_company_request_email
            ON company_registration_requests (LOWER(responsible_email))
            WHERE status IN ('pending', 'under_review', 'approved') AND is_deleted = false
            """
        )
    )


def downgrade() -> None:
    if "company_registration_requests" not in _get_table_names():
        return

    op.execute(sa.text("DROP INDEX IF EXISTS uq_active_company_request_email"))
    op.execute(
        sa.text(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uq_active_company_request_email
            ON company_registration_requests (LOWER(responsible_email))
            WHERE status IN ('pending', 'approved') AND is_deleted = false
            """
        )
    )
