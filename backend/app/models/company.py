from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.company_document import CompanyDocument
    from app.models.company_status_history import CompanyStatusHistory
    from app.models.user import User


class Company(Base):
    __tablename__ = "companies"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    join_code: Mapped[str | None] = mapped_column(String(32), nullable=True, unique=True, index=True)
    sector: Mapped[str] = mapped_column(String(120), nullable=False)
    city: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    address_line: Mapped[str | None] = mapped_column(String(255), nullable=True)
    region: Mapped[str | None] = mapped_column(String(120), nullable=True)
    postal_code: Mapped[str | None] = mapped_column(String(40), nullable=True)
    country: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    phone: Mapped[str] = mapped_column(String(30), nullable=False)
    ice: Mapped[str | None] = mapped_column(String(80), nullable=True, unique=True)
    rc: Mapped[str | None] = mapped_column(String(80), nullable=True, unique=True)
    tax_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    cnss: Mapped[str | None] = mapped_column(String(80), nullable=True)
    patente: Mapped[str | None] = mapped_column(String(80), nullable=True)
    website: Mapped[str | None] = mapped_column(String(255), nullable=True)
    logo_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="active", index=True)
    estimated_phone_lines: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    employees_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    operators_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    coverage_zones_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
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

    users: Mapped[list["User"]] = relationship("User", back_populates="company")
    documents: Mapped[list["CompanyDocument"]] = relationship(
        "CompanyDocument",
        back_populates="company",
        lazy="selectin",
    )
    history_entries: Mapped[list["CompanyStatusHistory"]] = relationship(
        "CompanyStatusHistory",
        back_populates="company",
        lazy="selectin",
    )
