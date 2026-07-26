from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.company import Company


def generate_company_join_code(company_id: int) -> str:
    return f"FC{company_id:04d}{uuid4().hex[:6].upper()}"


def ensure_company_join_code(db: Session, company: Company) -> Company:
    if company.join_code:
        return company

    while True:
        candidate = generate_company_join_code(company.id)
        existing = db.scalar(select(Company).where(Company.join_code == candidate))
        if existing is None:
            company.join_code = candidate
            db.add(company)
            db.flush()
            return company
