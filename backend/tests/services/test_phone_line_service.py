from sqlalchemy.orm import Session

from app.models.plan import Plan
from app.schemas.phone_line import PhoneLineCreate
from app.services.phone_line_service import (
    compute_occupation_status,
    create_phone_line,
    get_occupation_stats,
    get_phone_line,
    get_phone_line_stats,
)


def test_create_phone_line_persists_data(db_session: Session) -> None:
    payload = PhoneLineCreate(
        phone_number="+212600000002",
        operator_name="Inwi",
        plan_name="Business 100Go",
        assigned_to="Youssef Amrani",
        department="Support",
        status="active",
        monthly_limit=300,
        current_data_usage_gb=212.4,
        previous_data_usage_gb=189.6,
        notes="Ligne test service",
    )

    created_phone_line = create_phone_line(db_session, payload)
    fetched_phone_line = get_phone_line(db_session, created_phone_line.id)

    assert fetched_phone_line is not None
    assert fetched_phone_line.phone_number == payload.phone_number
    assert fetched_phone_line.operator_name == payload.operator_name
    assert fetched_phone_line.plan_name == payload.plan_name
    assert fetched_phone_line.current_data_usage_gb == 212.4
    assert fetched_phone_line.previous_data_usage_gb == 189.6


def test_get_phone_line_stats_returns_average_data_usage(db_session: Session) -> None:
    db_session.add_all(
        [
            Plan(
                name="Standard 20Go",
                operator_name="Orange Maroc",
                monthly_price=120,
                voice_quota="2h",
                data_quota="20Go",
                sms_quota="Illimite",
                roaming_zone="Maghreb",
                active_lines=85,
            ),
            Plan(
                name="Premium 50Go",
                operator_name="Maroc Telecom",
                monthly_price=280,
                voice_quota="Illimite",
                data_quota="50Go",
                sms_quota="Illimite",
                roaming_zone="International",
                active_lines=125,
            ),
        ]
    )
    db_session.commit()

    create_phone_line(
        db_session,
        PhoneLineCreate(
            phone_number="+212600000011",
            operator_name="Orange Maroc",
            plan_name="Standard 20Go",
            assigned_to="Ilham A",
            department="Direction",
            status="active",
            monthly_limit=20,
            current_data_usage_gb=14.5,
            previous_data_usage_gb=12.95,
        ),
    )
    create_phone_line(
        db_session,
        PhoneLineCreate(
            phone_number="+212600000012",
            operator_name="Maroc Telecom",
            plan_name="Premium 50Go",
            assigned_to="Ilham B",
            department="Support",
            status="active",
            monthly_limit=50,
            current_data_usage_gb=21.5,
            previous_data_usage_gb=19.2,
        ),
    )

    stats = get_phone_line_stats(db_session)

    assert stats["total"] == 2
    assert stats["average_data_usage_gb"] == 18.0
    assert stats["previous_average_data_usage_gb"] == 16.1
    assert stats["average_data_usage_change_pct"] == 11.8
    assert stats["total_ai_alerts"] == 2
    assert stats["critical_ai_alerts"] == 0
    assert stats["estimated_monthly_savings_mad"] == 0


def test_get_phone_line_stats_returns_alerts_and_savings(db_session: Session) -> None:
    db_session.add_all(
        [
            Plan(
                name="Standard 20Go",
                operator_name="Orange Maroc",
                monthly_price=120,
                voice_quota="2h",
                data_quota="20Go",
                sms_quota="Illimite",
                roaming_zone="Maghreb",
                active_lines=85,
            ),
            Plan(
                name="Premium 50Go",
                operator_name="Orange Maroc",
                monthly_price=280,
                voice_quota="Illimite",
                data_quota="50Go",
                sms_quota="Illimite",
                roaming_zone="International",
                active_lines=125,
            ),
        ]
    )
    db_session.commit()

    create_phone_line(
        db_session,
        PhoneLineCreate(
            phone_number="+212600000013",
            operator_name="Orange Maroc",
            plan_name="Premium 50Go",
            assigned_to="Ilham C",
            department="Finance",
            status="active",
            monthly_limit=50,
            current_data_usage_gb=14.5,
            previous_data_usage_gb=12.95,
        ),
    )

    stats = get_phone_line_stats(db_session)

    assert stats["average_data_usage_gb"] == 14.5
    assert stats["average_data_usage_change_pct"] == 12.4
    assert stats["total_ai_alerts"] == 1
    assert stats["critical_ai_alerts"] == 0
    assert stats["estimated_monthly_savings_mad"] == 160


def test_compute_occupation_status_distinguishes_free_assigned_pending_and_blocked(
    db_session: Session,
) -> None:
    free_line = create_phone_line(
        db_session,
        PhoneLineCreate(
            phone_number="+212600000021",
            operator_name="Orange Maroc",
            plan_name="Standard 20Go",
            status="active",
        ),
    )
    pending_line = create_phone_line(
        db_session,
        PhoneLineCreate(
            phone_number="+212600000022",
            operator_name="Orange Maroc",
            plan_name="Standard 20Go",
            assigned_to="Meriem Tazi",
            status="active",
        ),
    )
    assigned_line = create_phone_line(
        db_session,
        PhoneLineCreate(
            phone_number="+212600000023",
            operator_name="Orange Maroc",
            plan_name="Standard 20Go",
            assigned_to="Meriem Tazi",
            department="IT",
            status="active",
        ),
    )
    suspended_line = create_phone_line(
        db_session,
        PhoneLineCreate(
            phone_number="+212600000024",
            operator_name="Orange Maroc",
            plan_name="Standard 20Go",
            assigned_to="Karim Alaoui",
            department="Support",
            status="suspended",
        ),
    )
    inactive_line = create_phone_line(
        db_session,
        PhoneLineCreate(
            phone_number="+212600000025",
            operator_name="Orange Maroc",
            plan_name="Standard 20Go",
            status="inactive",
        ),
    )

    assert compute_occupation_status(free_line) == "libre"
    assert compute_occupation_status(pending_line) == "en_cours"
    assert compute_occupation_status(assigned_line) == "attribuee"
    assert compute_occupation_status(suspended_line) == "suspendue"
    assert compute_occupation_status(inactive_line) == "inactive"

    stats = get_occupation_stats(db_session)

    assert stats["total"] == 5
    assert stats["total_libre"] == 1
    assert stats["total_en_cours"] == 1
    assert stats["total_attribuees"] == 1
    assert stats["total_suspendues"] == 1
    assert stats["total_inactives"] == 1
