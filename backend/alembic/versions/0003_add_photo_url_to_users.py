"""Add photo_url to users.

Revision ID: 0003_add_photo_url_to_users
Revises: 0002_add_plan_name
Create Date: 2026-03-11 22:58:00
"""

import sqlalchemy as sa
from alembic import op

revision = "0003_add_photo_url_to_users"
down_revision = "0002_add_plan_name"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("photo_url", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "photo_url")
