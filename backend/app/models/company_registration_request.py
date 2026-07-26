from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Enum, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.company import Company
    from app.models.company_document import CompanyDocument
    from app.models.company_status_history import CompanyStatusHistory
    from app.models.user import User


COMPANY_REQUESTED_ROLE_ENUM = Enum(
    "ADMIN",
    "MANAGER",
    "ANALYST",
    name="company_requested_role",
    native_enum=False,
    validate_strings=True,
)


class CompanyRegistrationRequest(Base):
    __tablename__ = "company_registration_requests"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    responsible_full_name: Mapped[str] = mapped_column(String(120), nullable=False)
    responsible_phone: Mapped[str] = mapped_column(String(30), nullable=False)
    job_title: Mapped[str] = mapped_column(String(120), nullable=False)
    requested_role: Mapped[str] = mapped_column(
        COMPANY_REQUESTED_ROLE_ENUM,
        nullable=False,
        default="ADMIN",
    )
    responsible_email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    company_name: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    sector: Mapped[str] = mapped_column(String(120), nullable=False)
    city: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    address_line: Mapped[str | None] = mapped_column(String(255), nullable=True)
    region: Mapped[str | None] = mapped_column(String(120), nullable=True)
    postal_code: Mapped[str | None] = mapped_column(String(40), nullable=True)
    country: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    company_phone: Mapped[str] = mapped_column(String(30), nullable=False)
    ice: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    rc: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    tax_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    cnss: Mapped[str | None] = mapped_column(String(80), nullable=True)
    patente: Mapped[str | None] = mapped_column(String(80), nullable=True)
    website: Mapped[str | None] = mapped_column(String(255), nullable=True)
    estimated_phone_lines: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    employees_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    operators_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    coverage_zones_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    logo_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    legal_representative_cin_path: Mapped[str] = mapped_column(String(500), nullable=False)
    commercial_register_path: Mapped[str] = mapped_column(String(500), nullable=False)
    fiscal_document_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    company_stamp_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="pending", index=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_company_id: Mapped[int | None] = mapped_column(
        ForeignKey("companies.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    approved_admin_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    previous_request_id: Mapped[int | None] = mapped_column(
        ForeignKey("company_registration_requests.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    resubmission_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
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

    reviewer: Mapped["User | None"] = relationship(
        "User",
        lazy="selectin",
        foreign_keys=[reviewed_by],
    )
    approved_company: Mapped["Company | None"] = relationship(
        "Company",
        lazy="selectin",
        foreign_keys=[approved_company_id],
    )
    approved_admin_user: Mapped["User | None"] = relationship(
        "User",
        lazy="selectin",
        foreign_keys=[approved_admin_user_id],
    )
    previous_request: Mapped["CompanyRegistrationRequest | None"] = relationship(
        "CompanyRegistrationRequest",
        remote_side=[id],
        lazy="selectin",
        foreign_keys=[previous_request_id],
        back_populates="resubmissions",
    )
    resubmissions: Mapped[list["CompanyRegistrationRequest"]] = relationship(
        "CompanyRegistrationRequest",
        lazy="selectin",
        foreign_keys=[previous_request_id],
        back_populates="previous_request",
    )
    deleter: Mapped["User | None"] = relationship(
        "User",
        lazy="selectin",
        foreign_keys=[deleted_by],
    )
    documents: Mapped[list["CompanyDocument"]] = relationship(
        "CompanyDocument",
        back_populates="request",
        lazy="selectin",
    )
    history_entries: Mapped[list["CompanyStatusHistory"]] = relationship(
        "CompanyStatusHistory",
        back_populates="request",
        lazy="selectin",
    )
