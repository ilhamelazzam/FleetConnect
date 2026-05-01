from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Plan(Base):
    __tablename__ = "plans"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False, unique=True, index=True)
    operator_name: Mapped[str] = mapped_column(String(100), nullable=False)
    monthly_price: Mapped[int] = mapped_column(Integer, nullable=False)
    voice_quota: Mapped[str] = mapped_column(String(100), nullable=False)
    data_quota: Mapped[str] = mapped_column(String(100), nullable=False)
    sms_quota: Mapped[str] = mapped_column(String(100), nullable=False)
    roaming_zone: Mapped[str] = mapped_column(String(120), nullable=False)
    active_lines: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    activation_status: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
        default="inactive",
        server_default="inactive",
    )
    activated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    activated_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
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
