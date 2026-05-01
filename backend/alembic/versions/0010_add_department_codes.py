"""Add department codes and status.

Revision ID: 0010_department_codes
Revises: 0009_notifications
Create Date: 2026-04-14 11:05:00
"""

import re
import unicodedata

import sqlalchemy as sa
from alembic import op

revision = "0010_department_codes"
down_revision = "0009_notifications"
branch_labels = None
depends_on = None


def _build_department_code(name: str, used_codes: set[str]) -> str:
    normalized = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    words = [re.sub(r"[^A-Za-z0-9]+", "", chunk) for chunk in normalized.split()]
    words = [word for word in words if word]

    candidate = "".join(word[0] for word in words[:8]).upper()
    if len(candidate) < 2:
        candidate = re.sub(r"[^A-Za-z0-9]+", "", normalized).upper()[:8]
    if len(candidate) < 2:
        candidate = "DEP"

    candidate = candidate[:24]
    if candidate not in used_codes:
        used_codes.add(candidate)
        return candidate

    suffix = 2
    while True:
        suffix_value = str(suffix)
        base = candidate[: max(2, 24 - len(suffix_value))]
        derived = f"{base}{suffix_value}"
        if derived not in used_codes:
            used_codes.add(derived)
            return derived
        suffix += 1


def upgrade() -> None:
    with op.batch_alter_table("departments") as batch_op:
        batch_op.add_column(sa.Column("code", sa.String(length=24), nullable=True))
        batch_op.add_column(
            sa.Column(
                "is_active",
                sa.Boolean(),
                nullable=False,
                server_default=sa.true(),
            )
        )

    connection = op.get_bind()
    departments_table = sa.table(
        "departments",
        sa.column("id", sa.Integer()),
        sa.column("name", sa.String(length=120)),
        sa.column("code", sa.String(length=24)),
        sa.column("is_active", sa.Boolean()),
    )

    rows = connection.execute(
        sa.select(departments_table.c.id, departments_table.c.name, departments_table.c.code)
    ).fetchall()

    used_codes = {
        str(row.code).upper()
        for row in rows
        if row.code is not None and str(row.code).strip() != ""
    }
    for row in rows:
        code = str(row.code).strip().upper() if row.code is not None and str(row.code).strip() else None
        if code is None:
            code = _build_department_code(str(row.name or ""), used_codes)
        connection.execute(
            departments_table.update()
            .where(departments_table.c.id == row.id)
            .values(code=code, is_active=True)
        )

    with op.batch_alter_table("departments") as batch_op:
        batch_op.alter_column("code", existing_type=sa.String(length=24), nullable=False)
        batch_op.create_index(op.f("ix_departments_code"), ["code"], unique=True)
        batch_op.create_index(op.f("ix_departments_is_active"), ["is_active"], unique=False)


def downgrade() -> None:
    with op.batch_alter_table("departments") as batch_op:
        batch_op.drop_index(op.f("ix_departments_is_active"))
        batch_op.drop_index(op.f("ix_departments_code"))
        batch_op.drop_column("is_active")
        batch_op.drop_column("code")
