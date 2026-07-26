"""Replace free-text responsible position with requested company role.

Revision ID: 0015_company_request_role
Revises: 0014_user_onboarding_workflow
Create Date: 2026-07-17 15:00:00
"""

import sqlalchemy as sa
from alembic import op

revision = "0015_company_request_role"
down_revision = "0014_user_onboarding_workflow"
branch_labels = None
depends_on = None

REQUESTED_ROLE_ENUM = sa.Enum(
    "ADMIN",
    "MANAGER",
    "ANALYSTE",
    name="company_requested_role",
    native_enum=False,
)


def _get_table_names() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _get_columns(table_name: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table_name)}


def upgrade() -> None:
    table_names = _get_table_names()
    if "company_registration_requests" not in table_names:
        return

    columns = _get_columns("company_registration_requests")
    with op.batch_alter_table("company_registration_requests") as batch_op:
        if "requested_role" not in columns:
            batch_op.add_column(
                sa.Column(
                    "requested_role",
                    REQUESTED_ROLE_ENUM,
                    nullable=False,
                    server_default="ADMIN",
                )
            )

    op.execute(
        sa.text(
            """
            UPDATE company_registration_requests
            SET requested_role = CASE
                WHEN LOWER(COALESCE(responsible_position, '')) LIKE '%manager%' THEN 'MANAGER'
                WHEN LOWER(COALESCE(responsible_position, '')) LIKE '%analyst%' THEN 'ANALYSTE'
                WHEN LOWER(COALESCE(responsible_position, '')) LIKE '%analyste%' THEN 'ANALYSTE'
                ELSE 'ADMIN'
            END
            """
        )
    )

    if "responsible_position" in columns:
        with op.batch_alter_table("company_registration_requests") as batch_op:
            batch_op.drop_column("responsible_position")


def downgrade() -> None:
    table_names = _get_table_names()
    if "company_registration_requests" not in table_names:
        return

    columns = _get_columns("company_registration_requests")
    with op.batch_alter_table("company_registration_requests") as batch_op:
        if "responsible_position" not in columns:
            batch_op.add_column(
                sa.Column(
                    "responsible_position",
                    sa.String(length=120),
                    nullable=False,
                    server_default="Administrateur",
                )
            )

    op.execute(
        sa.text(
            """
            UPDATE company_registration_requests
            SET responsible_position = CASE requested_role
                WHEN 'MANAGER' THEN 'Manager'
                WHEN 'ANALYSTE' THEN 'Analyste'
                ELSE 'Administrateur'
            END
            """
        )
    )

    if "requested_role" in columns:
        with op.batch_alter_table("company_registration_requests") as batch_op:
            batch_op.drop_column("requested_role")
