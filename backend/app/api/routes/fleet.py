from fastapi import APIRouter

from app.core.dependencies import CurrentActiveUser
from app.schemas.fleet import FleetHealthScoreRead
from app.services.fleet_health_service import get_fleet_health_score

router = APIRouter(prefix="/fleet", tags=["fleet"])


@router.get("/health-score", response_model=FleetHealthScoreRead)
def read_fleet_health_score(_: CurrentActiveUser) -> FleetHealthScoreRead:
    return FleetHealthScoreRead(**get_fleet_health_score())
