"""Create plans table.

Revision ID: 0004_create_plans_table
Revises: 0003_add_photo_url_to_users
Create Date: 2026-03-12 00:40:00
"""

import sqlalchemy as sa
from alembic import op

revision = "0004_create_plans_table"
down_revision = "0003_add_photo_url_to_users"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "plans",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("operator_name", sa.String(length=100), nullable=False),
        sa.Column("monthly_price", sa.Integer(), nullable=False),
        sa.Column("voice_quota", sa.String(length=100), nullable=False),
        sa.Column("data_quota", sa.String(length=100), nullable=False),
        sa.Column("sms_quota", sa.String(length=100), nullable=False),
        sa.Column("roaming_zone", sa.String(length=120), nullable=False),
        sa.Column("active_lines", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("description", sa.Text(), nullable=True),
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
    )
    op.create_index(op.f("ix_plans_id"), "plans", ["id"], unique=False)
    op.create_index(op.f("ix_plans_name"), "plans", ["name"], unique=True)


def downgrade() -> None:
    op.drop_index(op.f("ix_plans_name"), table_name="plans")
    op.drop_index(op.f("ix_plans_id"), table_name="plans")
    op.drop_table("plans")
