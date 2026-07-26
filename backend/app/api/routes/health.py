from fastapi import APIRouter

from app.schemas.common import HealthResponse
from app.services.health_service import collect_health_status

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    return await collect_health_status()
