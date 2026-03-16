"""Add plan_name to phone_lines.

Revision ID: 0002_add_plan_name
Revises: 0001_initial_schema
Create Date: 2026-03-11 13:10:00
"""

import sqlalchemy as sa
from alembic import op

revision = "0002_add_plan_name"
down_revision = "0001_initial_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "phone_lines",
        sa.Column(
            "plan_name",
            sa.String(length=120),
            nullable=False,
            server_default="Standard 20Go",
        ),
    )
    op.alter_column("phone_lines", "plan_name", server_default=None)


def downgrade() -> None:
    op.drop_column("phone_lines", "plan_name")
