from typing import Annotated

from fastapi import APIRouter, Query

from app.core.dependencies import (
    DEFAULT_PAGE_SIZE,
    CurrentActiveUser,
    PaginationLimit,
    PaginationOffset,
)
from app.schemas.customer_churn import (
    CustomerChurnCustomerListRead,
    CustomerChurnFiltersRead,
    CustomerChurnOverviewRead,
    CustomerChurnPredictionListRead,
    CustomerChurnRecommendationListRead,
    CustomerChurnReportsRead,
)
from app.services.customer_churn_service import (
    get_customer_churn_filters,
    get_customer_churn_overview,
    get_customer_churn_reports,
    list_customer_churn_customers,
    list_customer_churn_predictions,
    list_customer_churn_recommendations,
)

router = APIRouter(prefix="/customer-churn", tags=["customer-churn"])


def _normalize_optional_filter(value: str | None) -> str | None:
    if value is None:
        return None

    normalized = value.strip()
    return normalized or None


def _build_query_filters(
    *,
    search: str | None = None,
    operator: str | None = None,
    department: str | None = None,
    contract: str | None = None,
    payment_method: str | None = None,
    internet_service: str | None = None,
    plan: str | None = None,
    price_range: str | None = None,
    risk_level: str | None = None,
    tenure_group: str | None = None,
    churn_status: str | None = None,
    prediction_status: str | None = None,
) -> dict[str, str | None]:
    return {
        "search": _normalize_optional_filter(search),
        "operator": _normalize_optional_filter(operator),
        "department": _normalize_optional_filter(department),
        "contract": _normalize_optional_filter(contract),
        "payment_method": _normalize_optional_filter(payment_method),
        "internet_service": _normalize_optional_filter(internet_service),
        "plan": _normalize_optional_filter(plan),
        "price_range": _normalize_optional_filter(price_range),
        "risk_level": _normalize_optional_filter(risk_level),
        "tenure_group": _normalize_optional_filter(tenure_group),
        "churn_status": _normalize_optional_filter(churn_status),
        "prediction_status": _normalize_optional_filter(prediction_status),
    }


@router.get("/overview", response_model=CustomerChurnOverviewRead)
def read_customer_churn_overview(
    _: CurrentActiveUser,
    search: Annotated[str | None, Query()] = None,
    operator: Annotated[str | None, Query()] = None,
    department: Annotated[str | None, Query()] = None,
    contract: Annotated[str | None, Query()] = None,
    payment_method: Annotated[str | None, Query()] = None,
    internet_service: Annotated[str | None, Query()] = None,
    plan: Annotated[str | None, Query()] = None,
    price_range: Annotated[str | None, Query()] = None,
    risk_level: Annotated[str | None, Query()] = None,
    tenure_group: Annotated[str | None, Query()] = None,
    churn_status: Annotated[str | None, Query()] = None,
    prediction_status: Annotated[str | None, Query()] = None,
) -> CustomerChurnOverviewRead:
    overview = get_customer_churn_overview(
        **_build_query_filters(
            search=search,
            operator=operator,
            department=department,
            contract=contract,
            payment_method=payment_method,
            internet_service=internet_service,
            plan=plan,
            price_range=price_range,
            risk_level=risk_level,
            tenure_group=tenure_group,
            churn_status=churn_status,
            prediction_status=prediction_status,
        )
    )
    return CustomerChurnOverviewRead(**overview)


@router.get("/filters", response_model=CustomerChurnFiltersRead)
def read_customer_churn_filters(
    _: CurrentActiveUser,
) -> CustomerChurnFiltersRead:
    return CustomerChurnFiltersRead(**get_customer_churn_filters())


@router.get("/customers", response_model=CustomerChurnCustomerListRead)
def read_customer_churn_customers(
    _: CurrentActiveUser,
    offset: PaginationOffset = 0,
    limit: PaginationLimit = DEFAULT_PAGE_SIZE,
    search: Annotated[str | None, Query()] = None,
    operator: Annotated[str | None, Query()] = None,
    department: Annotated[str | None, Query()] = None,
    contract: Annotated[str | None, Query()] = None,
    payment_method: Annotated[str | None, Query()] = None,
    internet_service: Annotated[str | None, Query()] = None,
    plan: Annotated[str | None, Query()] = None,
    price_range: Annotated[str | None, Query()] = None,
    risk_level: Annotated[str | None, Query()] = None,
    tenure_group: Annotated[str | None, Query()] = None,
    churn_status: Annotated[str | None, Query()] = None,
    prediction_status: Annotated[str | None, Query()] = None,
) -> CustomerChurnCustomerListRead:
    customers = list_customer_churn_customers(
        offset=offset,
        limit=limit,
        **_build_query_filters(
            search=search,
            operator=operator,
            department=department,
            contract=contract,
            payment_method=payment_method,
            internet_service=internet_service,
            plan=plan,
            price_range=price_range,
            risk_level=risk_level,
            tenure_group=tenure_group,
            churn_status=churn_status,
            prediction_status=prediction_status,
        ),
    )
    return CustomerChurnCustomerListRead(**customers)


@router.get("/predictions", response_model=CustomerChurnPredictionListRead)
def read_customer_churn_predictions(
    _: CurrentActiveUser,
    offset: PaginationOffset = 0,
    limit: PaginationLimit = DEFAULT_PAGE_SIZE,
    search: Annotated[str | None, Query()] = None,
    operator: Annotated[str | None, Query()] = None,
    department: Annotated[str | None, Query()] = None,
    contract: Annotated[str | None, Query()] = None,
    payment_method: Annotated[str | None, Query()] = None,
    internet_service: Annotated[str | None, Query()] = None,
    plan: Annotated[str | None, Query()] = None,
    price_range: Annotated[str | None, Query()] = None,
    risk_level: Annotated[str | None, Query()] = None,
    tenure_group: Annotated[str | None, Query()] = None,
    churn_status: Annotated[str | None, Query()] = None,
    prediction_status: Annotated[str | None, Query()] = None,
) -> CustomerChurnPredictionListRead:
    predictions = list_customer_churn_predictions(
        offset=offset,
        limit=limit,
        **_build_query_filters(
            search=search,
            operator=operator,
            department=department,
            contract=contract,
            payment_method=payment_method,
            internet_service=internet_service,
            plan=plan,
            price_range=price_range,
            risk_level=risk_level,
            tenure_group=tenure_group,
            churn_status=churn_status,
            prediction_status=prediction_status,
        ),
    )
    return CustomerChurnPredictionListRead(**predictions)


@router.get("/recommendations", response_model=CustomerChurnRecommendationListRead)
def read_customer_churn_recommendations(
    _: CurrentActiveUser,
    offset: PaginationOffset = 0,
    limit: PaginationLimit = DEFAULT_PAGE_SIZE,
    search: Annotated[str | None, Query()] = None,
    operator: Annotated[str | None, Query()] = None,
    department: Annotated[str | None, Query()] = None,
    contract: Annotated[str | None, Query()] = None,
    payment_method: Annotated[str | None, Query()] = None,
    internet_service: Annotated[str | None, Query()] = None,
    plan: Annotated[str | None, Query()] = None,
    price_range: Annotated[str | None, Query()] = None,
    risk_level: Annotated[str | None, Query()] = None,
    tenure_group: Annotated[str | None, Query()] = None,
    churn_status: Annotated[str | None, Query()] = None,
    prediction_status: Annotated[str | None, Query()] = None,
) -> CustomerChurnRecommendationListRead:
    recommendations = list_customer_churn_recommendations(
        offset=offset,
        limit=limit,
        **_build_query_filters(
            search=search,
            operator=operator,
            department=department,
            contract=contract,
            payment_method=payment_method,
            internet_service=internet_service,
            plan=plan,
            price_range=price_range,
            risk_level=risk_level,
            tenure_group=tenure_group,
            churn_status=churn_status,
            prediction_status=prediction_status,
        ),
    )
    return CustomerChurnRecommendationListRead(**recommendations)


@router.get("/reports", response_model=CustomerChurnReportsRead)
def read_customer_churn_reports(
    _: CurrentActiveUser,
    search: Annotated[str | None, Query()] = None,
    operator: Annotated[str | None, Query()] = None,
    department: Annotated[str | None, Query()] = None,
    contract: Annotated[str | None, Query()] = None,
    payment_method: Annotated[str | None, Query()] = None,
    internet_service: Annotated[str | None, Query()] = None,
    plan: Annotated[str | None, Query()] = None,
    price_range: Annotated[str | None, Query()] = None,
    risk_level: Annotated[str | None, Query()] = None,
    tenure_group: Annotated[str | None, Query()] = None,
    churn_status: Annotated[str | None, Query()] = None,
    prediction_status: Annotated[str | None, Query()] = None,
) -> CustomerChurnReportsRead:
    reports = get_customer_churn_reports(
        **_build_query_filters(
            search=search,
            operator=operator,
            department=department,
            contract=contract,
            payment_method=payment_method,
            internet_service=internet_service,
            plan=plan,
            price_range=price_range,
            risk_level=risk_level,
            tenure_group=tenure_group,
            churn_status=churn_status,
            prediction_status=prediction_status,
        )
    )
    return CustomerChurnReportsRead(**reports)
