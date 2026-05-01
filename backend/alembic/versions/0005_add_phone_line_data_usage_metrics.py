"""Add phone line data usage metrics.

Revision ID: 0005_phone_line_usage
Revises: 0004_create_plans_table
Create Date: 2026-03-30 09:25:00
"""

import sqlalchemy as sa
from alembic import op

revision = "0005_phone_line_usage"
down_revision = "0004_create_plans_table"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "phone_lines",
        sa.Column("current_data_usage_gb", sa.Float(), nullable=True),
    )
    op.add_column(
        "phone_lines",
        sa.Column("previous_data_usage_gb", sa.Float(), nullable=True),
    )

    op.execute(
        sa.text(
            """
            UPDATE phone_lines
            SET current_data_usage_gb = CASE
                WHEN status = 'inactive' THEN 0
                WHEN status = 'suspended' AND monthly_limit IS NULL THEN 5.2
                WHEN status = 'suspended' THEN ROUND(LEAST(5.2, monthly_limit * 0.35)::numeric, 2)
                WHEN monthly_limit IS NULL THEN 14.5
                WHEN monthly_limit <= 50 THEN ROUND(LEAST(14.5, monthly_limit * 0.725)::numeric, 2)
                WHEN monthly_limit <= 100 THEN 21.5
                ELSE 32.0
            END
            """
        )
    )

    op.execute(
        sa.text(
            """
            UPDATE phone_lines
            SET previous_data_usage_gb = CASE
                WHEN status = 'inactive' THEN 0
                ELSE ROUND((current_data_usage_gb / 1.12)::numeric, 2)
            END
            """
        )
    )

    op.alter_column("phone_lines", "current_data_usage_gb", nullable=False)
    op.alter_column("phone_lines", "previous_data_usage_gb", nullable=False)


def downgrade() -> None:
    op.drop_column("phone_lines", "previous_data_usage_gb")
    op.drop_column("phone_lines", "current_data_usage_gb")
