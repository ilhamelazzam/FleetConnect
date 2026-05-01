"""Add intelligent notifications.

Revision ID: 0009_notifications
Revises: 0008_usage_governance
Create Date: 2026-04-08 18:10:00
"""

import sqlalchemy as sa
from alembic import op

revision = "0009_notifications"
down_revision = "0008_usage_governance"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "notifications",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("recipient_user_id", sa.Integer(), nullable=False),
        sa.Column("actor_user_id", sa.Integer(), nullable=True),
        sa.Column("related_resource_id", sa.Integer(), nullable=True),
        sa.Column("related_compliance_alert_id", sa.Integer(), nullable=True),
        sa.Column("notification_type", sa.String(length=30), nullable=False),
        sa.Column("title", sa.String(length=180), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("priority", sa.String(length=30), nullable=False),
        sa.Column("link_url", sa.String(length=255), nullable=True),
        sa.Column("ai_recommendation", sa.Text(), nullable=True),
        sa.Column("suggested_action", sa.Text(), nullable=True),
        sa.Column("source_type", sa.String(length=80), nullable=True),
        sa.Column("source_id", sa.String(length=120), nullable=True),
        sa.Column("source_key", sa.String(length=160), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("is_deleted", sa.Boolean(), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["recipient_user_id"], ["users.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["related_compliance_alert_id"], ["compliance_alerts.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["related_resource_id"], ["fleet_resources.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "recipient_user_id",
            "source_key",
            name="uq_notifications_recipient_source",
        ),
    )
    op.create_index(op.f("ix_notifications_actor_user_id"), "notifications", ["actor_user_id"])
    op.create_index(op.f("ix_notifications_created_at"), "notifications", ["created_at"])
    op.create_index(op.f("ix_notifications_id"), "notifications", ["id"])
    op.create_index(op.f("ix_notifications_is_deleted"), "notifications", ["is_deleted"])
    op.create_index(
        op.f("ix_notifications_notification_type"), "notifications", ["notification_type"]
    )
    op.create_index(op.f("ix_notifications_priority"), "notifications", ["priority"])
    op.create_index(
        op.f("ix_notifications_recipient_user_id"), "notifications", ["recipient_user_id"]
    )
    op.create_index(
        op.f("ix_notifications_related_compliance_alert_id"),
        "notifications",
        ["related_compliance_alert_id"],
    )
    op.create_index(
        op.f("ix_notifications_related_resource_id"),
        "notifications",
        ["related_resource_id"],
    )
    op.create_index(op.f("ix_notifications_source_key"), "notifications", ["source_key"])
    op.create_index(op.f("ix_notifications_source_type"), "notifications", ["source_type"])


def downgrade() -> None:
    op.drop_index(op.f("ix_notifications_source_type"), table_name="notifications")
    op.drop_index(op.f("ix_notifications_source_key"), table_name="notifications")
    op.drop_index(op.f("ix_notifications_related_resource_id"), table_name="notifications")
    op.drop_index(
        op.f("ix_notifications_related_compliance_alert_id"), table_name="notifications"
    )
    op.drop_index(op.f("ix_notifications_recipient_user_id"), table_name="notifications")
    op.drop_index(op.f("ix_notifications_priority"), table_name="notifications")
    op.drop_index(op.f("ix_notifications_notification_type"), table_name="notifications")
    op.drop_index(op.f("ix_notifications_is_deleted"), table_name="notifications")
    op.drop_index(op.f("ix_notifications_id"), table_name="notifications")
    op.drop_index(op.f("ix_notifications_created_at"), table_name="notifications")
    op.drop_index(op.f("ix_notifications_actor_user_id"), table_name="notifications")
    op.drop_table("notifications")
