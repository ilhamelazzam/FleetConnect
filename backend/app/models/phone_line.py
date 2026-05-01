from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PhoneLine(Base):
    __tablename__ = "phone_lines"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    phone_number: Mapped[str] = mapped_column(String(20), nullable=False, unique=True, index=True)
    operator_name: Mapped[str] = mapped_column(String(100), nullable=False)
    plan_name: Mapped[str] = mapped_column(String(120), nullable=False, default="Standard 20Go")
    assigned_to: Mapped[str | None] = mapped_column(String(120), nullable=True)
    department: Mapped[str | None] = mapped_column(String(120), nullable=True)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="active")
    monthly_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    current_data_usage_gb: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    previous_data_usage_gb: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
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
