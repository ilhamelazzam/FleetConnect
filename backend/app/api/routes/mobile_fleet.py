from typing import Annotated

from fastapi import APIRouter, Query

from app.core.dependencies import (
    DEFAULT_PAGE_SIZE,
    CurrentActiveUser,
    PaginationLimit,
    PaginationOffset,
)
from app.schemas.mobile_fleet import (
    MobileFleetAdvancedKpiRead,
    MobileFleetConsumptionRead,
    MobileFleetDeviceListRead,
    MobileFleetFiltersRead,
    MobileFleetOverviewRead,
    MobileFleetRecommendationListRead,
    MobileFleetReportsRead,
)
from app.services.mobile_fleet_advanced_kpi_service import get_mobile_fleet_advanced_kpis
from app.services.mobile_fleet_service import (
    get_mobile_fleet_consumption,
    get_mobile_fleet_filters,
    get_mobile_fleet_overview,
    get_mobile_fleet_reports,
    list_mobile_fleet_devices,
    list_mobile_fleet_recommendations,
)

router = APIRouter(prefix="/mobile-fleet", tags=["mobile-fleet"])


def _normalize_optional_filter(value: str | None) -> str | None:
    if value is None:
        return None

    normalized = value.strip()
    return normalized or None


@router.get("/overview", response_model=MobileFleetOverviewRead)
def read_mobile_fleet_overview(
    _: CurrentActiveUser,
    search: Annotated[str | None, Query()] = None,
    operator: Annotated[str | None, Query()] = None,
    department: Annotated[str | None, Query()] = None,
    employee_profile: Annotated[str | None, Query()] = None,
    device_category: Annotated[str | None, Query()] = None,
    risk_level: Annotated[str | None, Query()] = None,
) -> MobileFleetOverviewRead:
    overview = get_mobile_fleet_overview(
        search=_normalize_optional_filter(search),
        operator=_normalize_optional_filter(operator),
        department=_normalize_optional_filter(department),
        employee_profile=_normalize_optional_filter(employee_profile),
        device_category=_normalize_optional_filter(device_category),
        risk_level=_normalize_optional_filter(risk_level),
    )
    return MobileFleetOverviewRead(**overview)


@router.get("/advanced-kpis", response_model=MobileFleetAdvancedKpiRead)
def read_mobile_fleet_advanced_kpis(
    _: CurrentActiveUser,
) -> MobileFleetAdvancedKpiRead:
    return MobileFleetAdvancedKpiRead(**get_mobile_fleet_advanced_kpis())


@router.get("/filters", response_model=MobileFleetFiltersRead)
def read_mobile_fleet_filters(
    _: CurrentActiveUser,
) -> MobileFleetFiltersRead:
    return MobileFleetFiltersRead(**get_mobile_fleet_filters())


@router.get("/devices", response_model=MobileFleetDeviceListRead)
def read_mobile_fleet_devices(
    _: CurrentActiveUser,
    offset: PaginationOffset = 0,
    limit: PaginationLimit = DEFAULT_PAGE_SIZE,
    search: Annotated[str | None, Query()] = None,
    operator: Annotated[str | None, Query()] = None,
    department: Annotated[str | None, Query()] = None,
    employee_profile: Annotated[str | None, Query()] = None,
    device_category: Annotated[str | None, Query()] = None,
    risk_level: Annotated[str | None, Query()] = None,
) -> MobileFleetDeviceListRead:
    devices = list_mobile_fleet_devices(
        offset=offset,
        limit=limit,
        search=_normalize_optional_filter(search),
        operator=_normalize_optional_filter(operator),
        department=_normalize_optional_filter(department),
        employee_profile=_normalize_optional_filter(employee_profile),
        device_category=_normalize_optional_filter(device_category),
        risk_level=_normalize_optional_filter(risk_level),
    )
    return MobileFleetDeviceListRead(**devices)


@router.get("/consumption", response_model=MobileFleetConsumptionRead)
def read_mobile_fleet_consumption(
    _: CurrentActiveUser,
    search: Annotated[str | None, Query()] = None,
    operator: Annotated[str | None, Query()] = None,
    department: Annotated[str | None, Query()] = None,
    employee_profile: Annotated[str | None, Query()] = None,
    device_category: Annotated[str | None, Query()] = None,
    risk_level: Annotated[str | None, Query()] = None,
) -> MobileFleetConsumptionRead:
    consumption = get_mobile_fleet_consumption(
        search=_normalize_optional_filter(search),
        operator=_normalize_optional_filter(operator),
        department=_normalize_optional_filter(department),
        employee_profile=_normalize_optional_filter(employee_profile),
        device_category=_normalize_optional_filter(device_category),
        risk_level=_normalize_optional_filter(risk_level),
    )
    return MobileFleetConsumptionRead(**consumption)


@router.get("/recommendations", response_model=MobileFleetRecommendationListRead)
def read_mobile_fleet_recommendations(
    _: CurrentActiveUser,
    offset: PaginationOffset = 0,
    limit: PaginationLimit = DEFAULT_PAGE_SIZE,
    search: Annotated[str | None, Query()] = None,
    operator: Annotated[str | None, Query()] = None,
    department: Annotated[str | None, Query()] = None,
    employee_profile: Annotated[str | None, Query()] = None,
    device_category: Annotated[str | None, Query()] = None,
    risk_level: Annotated[str | None, Query()] = None,
) -> MobileFleetRecommendationListRead:
    recommendations = list_mobile_fleet_recommendations(
        offset=offset,
        limit=limit,
        search=_normalize_optional_filter(search),
        operator=_normalize_optional_filter(operator),
        department=_normalize_optional_filter(department),
        employee_profile=_normalize_optional_filter(employee_profile),
        device_category=_normalize_optional_filter(device_category),
        risk_level=_normalize_optional_filter(risk_level),
    )
    return MobileFleetRecommendationListRead(**recommendations)


@router.get("/reports", response_model=MobileFleetReportsRead)
def read_mobile_fleet_reports(
    _: CurrentActiveUser,
    search: Annotated[str | None, Query()] = None,
    operator: Annotated[str | None, Query()] = None,
    department: Annotated[str | None, Query()] = None,
    employee_profile: Annotated[str | None, Query()] = None,
    device_category: Annotated[str | None, Query()] = None,
    risk_level: Annotated[str | None, Query()] = None,
) -> MobileFleetReportsRead:
    reports = get_mobile_fleet_reports(
        search=_normalize_optional_filter(search),
        operator=_normalize_optional_filter(operator),
        department=_normalize_optional_filter(department),
        employee_profile=_normalize_optional_filter(employee_profile),
        device_category=_normalize_optional_filter(device_category),
        risk_level=_normalize_optional_filter(risk_level),
    )
    return MobileFleetReportsRead(**reports)
