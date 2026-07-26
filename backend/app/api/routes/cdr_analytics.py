from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Query, status

from app.core.dependencies import (
    DEFAULT_PAGE_SIZE,
    CurrentActiveUser,
    DbSession,
    PaginationLimit,
    PaginationOffset,
)
from app.schemas.cdr_analytics import (
    CdrAlertDetailRead,
    CdrAlertListRead,
    CdrFiltersRead,
    CdrMapRead,
    CdrOverviewRead,
    CdrRoamingMapRead,
    CdrRecommendationListRead,
)
from app.services.cdr_analytics_service import (
    get_cdr_alert_detail,
    get_cdr_filters,
    get_cdr_overview,
    list_cdr_alerts,
    list_cdr_recommendations,
)
from app.services.cdr_map_service import get_cdr_map_data
from app.services.roaming_map_service import get_roaming_map_data

router = APIRouter(prefix="/cdr-analytics", tags=["cdr-analytics"])


def _normalize_optional_filter(value: str | None) -> str | None:
    if value is None:
        return None

    normalized = value.strip()
    return normalized or None


@router.get("/overview", response_model=CdrOverviewRead)
def read_cdr_overview(
    _: CurrentActiveUser,
    search: Annotated[str | None, Query()] = None,
    operator: Annotated[str | None, Query()] = None,
    department: Annotated[str | None, Query()] = None,
    call_zone: Annotated[str | None, Query()] = None,
    severity: Annotated[str | None, Query()] = None,
) -> CdrOverviewRead:
    overview = get_cdr_overview(
        search=_normalize_optional_filter(search),
        operator=_normalize_optional_filter(operator),
        department=_normalize_optional_filter(department),
        call_zone=_normalize_optional_filter(call_zone),
        severity=_normalize_optional_filter(severity),
    )
    return CdrOverviewRead(**overview)


@router.get("/filters", response_model=CdrFiltersRead)
def read_cdr_filters(
    _: CurrentActiveUser,
) -> CdrFiltersRead:
    return CdrFiltersRead(**get_cdr_filters())


@router.get("/alerts", response_model=CdrAlertListRead)
def read_cdr_alerts(
    _: CurrentActiveUser,
    offset: PaginationOffset = 0,
    limit: PaginationLimit = DEFAULT_PAGE_SIZE,
    search: Annotated[str | None, Query()] = None,
    operator: Annotated[str | None, Query()] = None,
    department: Annotated[str | None, Query()] = None,
    call_zone: Annotated[str | None, Query()] = None,
    severity: Annotated[str | None, Query()] = None,
) -> CdrAlertListRead:
    alerts = list_cdr_alerts(
        offset=offset,
        limit=limit,
        search=_normalize_optional_filter(search),
        operator=_normalize_optional_filter(operator),
        department=_normalize_optional_filter(department),
        call_zone=_normalize_optional_filter(call_zone),
        severity=_normalize_optional_filter(severity),
    )
    return CdrAlertListRead(**alerts)


@router.get("/alerts/{cdr_row_id}", response_model=CdrAlertDetailRead)
def read_cdr_alert_detail(
    cdr_row_id: Annotated[int, Path(gt=0)],
    _: CurrentActiveUser,
) -> CdrAlertDetailRead:
    alert = get_cdr_alert_detail(cdr_row_id)
    if alert is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="CDR alert not found",
        )

    return CdrAlertDetailRead(**alert)


@router.get("/recommendations", response_model=CdrRecommendationListRead)
def read_cdr_recommendations(
    _: CurrentActiveUser,
    offset: PaginationOffset = 0,
    limit: PaginationLimit = DEFAULT_PAGE_SIZE,
    search: Annotated[str | None, Query()] = None,
    operator: Annotated[str | None, Query()] = None,
    department: Annotated[str | None, Query()] = None,
    call_zone: Annotated[str | None, Query()] = None,
    severity: Annotated[str | None, Query()] = None,
) -> CdrRecommendationListRead:
    recommendations = list_cdr_recommendations(
        offset=offset,
        limit=limit,
        search=_normalize_optional_filter(search),
        operator=_normalize_optional_filter(operator),
        department=_normalize_optional_filter(department),
        call_zone=_normalize_optional_filter(call_zone),
        severity=_normalize_optional_filter(severity),
    )
    return CdrRecommendationListRead(**recommendations)


@router.get("/roaming-map", response_model=CdrRoamingMapRead)
def read_roaming_map(
    _: CurrentActiveUser,
    db: DbSession,
    country: Annotated[str | None, Query()] = None,
    operator: Annotated[str | None, Query()] = None,
    department: Annotated[str | None, Query()] = None,
    risk_level: Annotated[str | None, Query()] = None,
    min_roaming_cost_mad: Annotated[float | None, Query(ge=0)] = None,
    period_from: Annotated[str | None, Query()] = None,
    period_to: Annotated[str | None, Query()] = None,
) -> CdrRoamingMapRead:
    return CdrRoamingMapRead(
        **get_roaming_map_data(
            db,
            country=_normalize_optional_filter(country),
            operator=_normalize_optional_filter(operator),
            department=_normalize_optional_filter(department),
            risk_level=_normalize_optional_filter(risk_level),
            min_roaming_cost_mad=min_roaming_cost_mad,
            period_from=_normalize_optional_filter(period_from),
            period_to=_normalize_optional_filter(period_to),
        )
    )


@router.get("/map", response_model=CdrMapRead)
def read_cdr_map(
    _: CurrentActiveUser,
    mode: Annotated[str | None, Query()] = None,
    scope: Annotated[str | None, Query()] = None,
    operator: Annotated[str | None, Query()] = None,
    department: Annotated[str | None, Query()] = None,
    risk_level: Annotated[str | None, Query()] = None,
    fraud_severity: Annotated[str | None, Query()] = None,
    region: Annotated[str | None, Query()] = None,
    date_from: Annotated[str | None, Query()] = None,
    date_to: Annotated[str | None, Query()] = None,
) -> CdrMapRead:
    return CdrMapRead(
        **get_cdr_map_data(
            mode=_normalize_optional_filter(mode),
            scope=_normalize_optional_filter(scope),
            operator=_normalize_optional_filter(operator),
            department=_normalize_optional_filter(department),
            risk_level=_normalize_optional_filter(risk_level),
            fraud_severity=_normalize_optional_filter(fraud_severity),
            region=_normalize_optional_filter(region),
            date_from=_normalize_optional_filter(date_from),
            date_to=_normalize_optional_filter(date_to),
        )
    )
