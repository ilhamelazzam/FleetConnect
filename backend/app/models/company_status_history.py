from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.company import Company
    from app.models.company_registration_request import CompanyRegistrationRequest
    from app.models.user import User


class CompanyStatusHistory(Base):
    __tablename__ = "company_status_history"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    request_id: Mapped[int | None] = mapped_column(
        ForeignKey("company_registration_requests.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    company_id: Mapped[int | None] = mapped_column(
        ForeignKey("companies.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    actor_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    action: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(180), nullable=False)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    previous_status: Mapped[str | None] = mapped_column(String(30), nullable=True, index=True)
    next_status: Mapped[str | None] = mapped_column(String(30), nullable=True, index=True)
    metadata_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        index=True,
    )

    actor_user: Mapped["User | None"] = relationship("User", lazy="selectin")
    request: Mapped["CompanyRegistrationRequest | None"] = relationship(
        "CompanyRegistrationRequest",
        back_populates="history_entries",
        lazy="selectin",
    )
    company: Mapped["Company | None"] = relationship(
        "Company",
        back_populates="history_entries",
        lazy="selectin",
    )
