from sqlalchemy.orm import Session

from app.schemas.phone_line import PhoneLineCreate
from app.services.phone_line_service import create_phone_line, get_phone_line


def test_create_phone_line_persists_data(db_session: Session) -> None:
    payload = PhoneLineCreate(
        phone_number="+212600000002",
        operator_name="Inwi",
        plan_name="Business 100Go",
        assigned_to="Youssef Amrani",
        department="Support",
        status="active",
        monthly_limit=300,
        notes="Ligne test service",
    )

    created_phone_line = create_phone_line(db_session, payload)
    fetched_phone_line = get_phone_line(db_session, created_phone_line.id)

    assert fetched_phone_line is not None
    assert fetched_phone_line.phone_number == payload.phone_number
    assert fetched_phone_line.operator_name == payload.operator_name
    assert fetched_phone_line.plan_name == payload.plan_name
