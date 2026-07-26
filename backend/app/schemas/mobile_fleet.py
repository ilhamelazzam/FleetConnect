from pydantic import BaseModel, Field


class MobileFleetKpiRead(BaseModel):
    total_devices: int
    total_estimated_budget_mad: float
    average_estimated_price_mad: float
    average_budget_risk_score: float
    alert_devices: int
    critical_risks: int
    premium_devices: int


class MobileFleetDistributionRead(BaseModel):
    label: str
    count: int


class MobileFleetBudgetBreakdownRead(BaseModel):
    label: str
    total_estimated_price_mad: float
    average_budget_risk_score: float
    alert_devices: int


class MobileFleetDeviceRead(BaseModel):
    fleet_row_id: int
    operator: str
    department: str
    employee_profile: str
    device_category: str
    estimated_price_mad: float
    budget_risk_score: float
    risk_level: str
    alert_flag: bool
    recommendation: str
    predicted_price_label: str
    prediction_confidence: float
    risk_id: str
    title: str
    description: str
    impact: str
    ai_recommendation: str
    suggested_action: str
    confidence_score: float


class MobileFleetDeviceListRead(BaseModel):
    total: int
    offset: int
    limit: int
    items: list[MobileFleetDeviceRead]


class MobileFleetFiltersRead(BaseModel):
    operators: list[str]
    departments: list[str]
    employee_profiles: list[str]
    device_categories: list[str]
    risk_levels: list[str]
    predicted_price_labels: list[str]


class MobileFleetOverviewRead(BaseModel):
    kpis: MobileFleetKpiRead
    risk_distribution: list[MobileFleetDistributionRead] = Field(default_factory=list)
    devices_by_operator: list[MobileFleetDistributionRead] = Field(default_factory=list)
    devices_by_category: list[MobileFleetDistributionRead] = Field(default_factory=list)
    budget_by_department: list[MobileFleetBudgetBreakdownRead] = Field(default_factory=list)
    top_devices: list[MobileFleetDeviceRead] = Field(default_factory=list)


class MobileFleetAdvancedKpiRead(BaseModel):
    total_devices: int
    total_estimated_budget_mad: float
    total_cost_12_months_mad: float
    fleet_health_score: int
    average_fit_score: float
    adapted_devices: int
    unfit_devices: int
    oversized_devices: int
    undersized_devices: int
    potential_savings_mad: float
    alerts_summary: str
    fit_rate_pct: float
    optimization_rate_pct: float


class MobileFleetConsumptionRead(BaseModel):
    kpis: MobileFleetKpiRead
    budget_by_operator: list[MobileFleetBudgetBreakdownRead] = Field(default_factory=list)
    budget_by_device_category: list[MobileFleetBudgetBreakdownRead] = Field(default_factory=list)
    risk_distribution: list[MobileFleetDistributionRead] = Field(default_factory=list)
    top_expensive_devices: list[MobileFleetDeviceRead] = Field(default_factory=list)


class MobileFleetRecommendationRead(MobileFleetDeviceRead):
    priority_rank: int


class MobileFleetRecommendationListRead(BaseModel):
    total: int
    offset: int
    limit: int
    items: list[MobileFleetRecommendationRead]


class MobileFleetDepartmentRecommendationRead(BaseModel):
    department: str
    devices_to_optimize: int
    alert_devices: int
    critical_risks: int
    estimated_budget_mad: float


class MobileFleetReportsRead(BaseModel):
    kpis: MobileFleetKpiRead
    budget_by_department: list[MobileFleetBudgetBreakdownRead] = Field(default_factory=list)
    devices_by_category: list[MobileFleetDistributionRead] = Field(default_factory=list)
    risk_distribution: list[MobileFleetDistributionRead] = Field(default_factory=list)
    recommendations_by_department: list[MobileFleetDepartmentRecommendationRead] = Field(
        default_factory=list
    )
    top_recommendations: list[MobileFleetRecommendationRead] = Field(default_factory=list)
