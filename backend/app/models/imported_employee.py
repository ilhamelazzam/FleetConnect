from datetime import datetime

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ImportedEmployee(Base):
    __tablename__ = "imported_employees"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    full_name: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    identity_key: Mapped[str] = mapped_column(String(320), nullable=False, unique=True, index=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    employee_identifier: Mapped[str | None] = mapped_column(String(160), nullable=True, index=True)
    employee_code: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    department_name: Mapped[str | None] = mapped_column(String(160), nullable=True, index=True)
    job_profile: Mapped[str | None] = mapped_column(String(160), nullable=True)
    status: Mapped[str] = mapped_column(String(40), nullable=False, default="active", index=True)
    source_filename: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_format: Mapped[str | None] = mapped_column(String(16), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
