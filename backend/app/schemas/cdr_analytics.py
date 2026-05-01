from pydantic import BaseModel, Field


class CdrKpiRead(BaseModel):
    total_calls: int
    suspicious_calls: int
    critical_alerts: int
    average_cost_mad: float
    average_risk_score: float
    suspicious_cost_exposure_mad: float


class CdrRiskDistributionRead(BaseModel):
    severity: str
    count: int


class CdrDepartmentAlertRead(BaseModel):
    department: str
    count: int


class CdrOperatorCostRead(BaseModel):
    operator: str
    total_cost_mad: float
    suspicious_calls: int


class CdrZoneDistributionRead(BaseModel):
    call_zone: str
    count: int


class CdrAlertRead(BaseModel):
    cdr_row_id: int
    start_time: str
    operator_maroc: str
    department: str
    call_zone: str
    fraud_type: str
    call_cost_mad: float
    fraud_risk_score_100: float
    severity: str
    is_alert: bool
    recommendation: str
    risk_id: str
    title: str
    description: str
    impact: str
    ai_recommendation: str
    suggested_action: str
    confidence_score: float


class CdrAlertDetailRead(CdrAlertRead):
    duration_sec: int
    call_type: str
    location_origin: str
    country_origin: str
    location_dest: str
    country_dest: str
    transaction_status: str
    is_night_call: bool
    roaming_flag: bool
    high_cost_flag: bool
    long_duration_flag: bool
    international_flag: bool
    fraud_risk_proba: float
    recommendation_reason: str
    rule_matches: list[str]
    route_label: str


class CdrRecommendationRead(BaseModel):
    cdr_row_id: int
    start_time: str
    operator_maroc: str
    department: str
    call_zone: str
    severity: str
    fraud_type: str
    call_cost_mad: float
    fraud_risk_score_100: float
    recommendation: str
    recommendation_reason: str
    risk_id: str
    title: str
    description: str
    impact: str
    ai_recommendation: str
    suggested_action: str
    confidence_score: float


class CdrFiltersRead(BaseModel):
    operators: list[str]
    departments: list[str]
    call_zones: list[str]
    severities: list[str]


class CdrAlertListRead(BaseModel):
    total: int
    offset: int
    limit: int
    items: list[CdrAlertRead]


class CdrRecommendationListRead(BaseModel):
    total: int
    offset: int
    limit: int
    items: list[CdrRecommendationRead]


class CdrOverviewRead(BaseModel):
    snapshot_start_time: str | None = None
    snapshot_end_time: str | None = None
    kpis: CdrKpiRead
    risk_distribution: list[CdrRiskDistributionRead] = Field(default_factory=list)
    alerts_by_department: list[CdrDepartmentAlertRead] = Field(default_factory=list)
    cost_by_operator: list[CdrOperatorCostRead] = Field(default_factory=list)
    calls_by_zone: list[CdrZoneDistributionRead] = Field(default_factory=list)
    top_risky_calls: list[CdrAlertRead] = Field(default_factory=list)
    priority_alerts: list[CdrAlertRead] = Field(default_factory=list)
