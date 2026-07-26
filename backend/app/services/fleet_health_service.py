from __future__ import annotations

from app.db.session import SessionLocal
from app.services.chat_service import DataSummary, get_data_summary
from app.services.fleet_scoring_service import build_fleet_health_payload
from app.services.live_monitoring_service import get_live_monitoring_snapshot_if_ready


def get_fleet_health_score() -> dict[str, object]:
    db = SessionLocal()
    try:
        summary = get_data_summary(db)
    finally:
        db.close()
    return build_fleet_health_payload(
        summary,
        live_snapshot=get_live_monitoring_snapshot_if_ready(),
    )
