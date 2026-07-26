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
    alert_flag: bool
    fraud_severity: str
    fraud_severity_score: float
    investigation_priority: str
    estimated_financial_loss: float
    ai_recommendation_priority: str
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
    fraud_severity: str
    fraud_severity_score: float
    investigation_priority: str
    estimated_financial_loss: float
    ai_recommendation_priority: str
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
    alert_flag: bool
    fraud_severity: str
    fraud_severity_score: float
    investigation_priority: str
    estimated_financial_loss: float
    ai_recommendation_priority: str
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


class CdrRoamingMapCountryCostRead(BaseModel):
    country: str
    total_cost_mad: float
    device_count: int
    critical_alerts: int


class CdrRoamingMapStatsRead(BaseModel):
    roaming_devices: int
    total_roaming_cost_mad: float
    critical_alerts: int
    top_cost_countries: list[CdrRoamingMapCountryCostRead] = Field(default_factory=list)
    exact_gps_count: int
    estimated_location_count: int
    simulated_location_count: int


class CdrRoamingMapFiltersRead(BaseModel):
    countries: list[str] = Field(default_factory=list)
    operators: list[str] = Field(default_factory=list)
    departments: list[str] = Field(default_factory=list)
    risk_levels: list[str] = Field(default_factory=list)
    location_sources: list[str] = Field(default_factory=list)
    period_start: str | None = None
    period_end: str | None = None


class CdrRoamingMapPointRead(BaseModel):
    line_id: int | None = None
    phone_number: str | None = None
    employee_name: str | None = None
    department: str
    operator: str
    country: str
    city: str | None = None
    latitude: float
    longitude: float
    location_source: str
    location_precision_label: str
    line_assignment_source: str
    location_notice: str | None = None
    assignment_notice: str | None = None
    roaming_cost_mad: float
    data_usage_gb: float | None = None
    risk_level: str
    risk_label: str
    recommendation: str
    event_time: str | None = None
    roaming_event_count: int
    position_disclaimer: str


class CdrRoamingMapRead(BaseModel):
    points: list[CdrRoamingMapPointRead] = Field(default_factory=list)
    stats: CdrRoamingMapStatsRead
    filters: CdrRoamingMapFiltersRead
    generated_at: str
    privacy_notice: str


class CdrMapPointRead(BaseModel):
    city: str
    country: str
    region: str
    latitude: float
    longitude: float
    count: int
    alerts: int
    risk_score: float
    estimated_loss_mad: float
    top_recommendation: str


class CdrMapFlowRead(BaseModel):
    origin_city: str
    origin_country: str
    origin_region: str
    origin_latitude: float
    origin_longitude: float
    destination_city: str
    destination_country: str
    destination_region: str
    destination_latitude: float
    destination_longitude: float
    count: int
    alerts: int
    risk_score: float
    estimated_loss_mad: float


class CdrMapUnknownLocationRead(BaseModel):
    cdr_row_id: int
    field: str
    raw_value: str
    country: str
    reason: str


class CdrMapFiltersRead(BaseModel):
    operators: list[str] = Field(default_factory=list)
    departments: list[str] = Field(default_factory=list)
    risk_levels: list[str] = Field(default_factory=list)
    fraud_severities: list[str] = Field(default_factory=list)
    regions: list[str] = Field(default_factory=list)
    modes: list[str] = Field(default_factory=list)
    scopes: list[str] = Field(default_factory=list)


class CdrMapRead(BaseModel):
    mode: str
    scope: str
    center: list[float] = Field(default_factory=list)
    zoom: int
    points: list[CdrMapPointRead] = Field(default_factory=list)
    flows: list[CdrMapFlowRead] = Field(default_factory=list)
    unknown_locations: list[CdrMapUnknownLocationRead] = Field(default_factory=list)
    filters: CdrMapFiltersRead
