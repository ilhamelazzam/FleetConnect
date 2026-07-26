from typing import Annotated

from fastapi import APIRouter, Query

from app.core.dependencies import CurrentActiveUser, DbSession
from app.schemas.roaming import RoamingMapRead
from app.services.roaming_map_service import get_roaming_intelligence_map

router = APIRouter(prefix="/roaming", tags=["roaming"])


def _normalize_optional_filter(value: str | None) -> str | None:
    if value is None:
        return None

    normalized = value.strip()
    return normalized or None


@router.get("/map", response_model=RoamingMapRead)
def read_roaming_intelligence_map(
    _: CurrentActiveUser,
    db: DbSession,
    country: Annotated[str | None, Query()] = None,
    operator: Annotated[str | None, Query()] = None,
    department: Annotated[str | None, Query()] = None,
    risk_level: Annotated[str | None, Query()] = None,
    anomaly_type: Annotated[str | None, Query()] = None,
    min_cost_mad: Annotated[float | None, Query(ge=0)] = None,
    period_from: Annotated[str | None, Query()] = None,
    period_to: Annotated[str | None, Query()] = None,
    roaming_active: Annotated[bool | None, Query()] = None,
    fraud_only: Annotated[bool | None, Query()] = None,
) -> RoamingMapRead:
    return RoamingMapRead(
        **get_roaming_intelligence_map(
            db,
            country=_normalize_optional_filter(country),
            operator=_normalize_optional_filter(operator),
            department=_normalize_optional_filter(department),
            risk_level=_normalize_optional_filter(risk_level),
            anomaly_type=_normalize_optional_filter(anomaly_type),
            min_cost_mad=min_cost_mad,
            period_from=_normalize_optional_filter(period_from),
            period_to=_normalize_optional_filter(period_to),
            roaming_active=roaming_active,
            fraud_only=fraud_only,
        )
    )
