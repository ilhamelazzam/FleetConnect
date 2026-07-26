from pydantic import BaseModel, Field


class CustomerChurnKpiRead(BaseModel):
    total_customers: int
    actual_churn_customers: int
    churn_rate_pct: float
    high_risk_customers: int
    loyal_customers: int
    revenue_at_risk_mad: float
    average_risk_score: float
    average_tenure_months: float
    average_monthly_revenue_mad: float


class CustomerChurnBreakdownRead(BaseModel):
    label: str
    total_customers: int
    actual_churn_customers: int
    predicted_high_risk_customers: int
    churn_rate_pct: float
    revenue_at_risk_mad: float
    average_risk_score: float


class CustomerChurnCustomerRead(BaseModel):
    customer_row_id: int
    customer_id: str
    operator: str
    department: str
    gender: str
    senior_citizen: bool
    partner: bool
    dependents: bool
    tenure: int
    tenure_group: str
    contract: str
    payment_method: str
    internet_service: str
    monthly_charges: float
    total_charges: float
    monthly_cost_mad: float
    total_cost_mad: float
    plan: str
    price_range_label: str
    roaming_flag: bool
    data_usage_gb: float
    quota_gb: float
    over_quota_flag: bool
    anomaly_flag: bool
    risk_proba: float
    risk_score_100: float
    risk_level: str
    actual_churn: bool
    predicted_churn: bool
    recommendation: str
    risk_id: str
    title: str
    description: str
    impact: str
    ai_recommendation: str
    suggested_action: str
    confidence_score: float


class CustomerChurnPredictionRead(CustomerChurnCustomerRead):
    future_cost_mad: float
    future_cost_pred_mad: float
    revenue_at_risk_mad: float
    key_factors: list[str] = Field(default_factory=list)


class CustomerChurnRecommendationRead(CustomerChurnPredictionRead):
    recommendation_reason: str


class CustomerChurnConsumptionKpiRead(BaseModel):
    total_lines: int
    total_monthly_cost_mad: float
    total_future_cost_mad: float
    total_future_cost_pred_mad: float
    total_data_usage_gb: float
    average_data_usage_gb: float
    average_quota_gb: float
    over_quota_lines: int
    roaming_lines: int
    anomaly_lines: int
    high_risk_lines: int
    average_risk_score: float


class CustomerChurnConsumptionBreakdownRead(BaseModel):
    label: str
    line_count: int
    total_monthly_cost_mad: float
    total_future_cost_mad: float
    total_data_usage_gb: float
    over_quota_lines: int
    anomaly_lines: int
    average_risk_score: float


class CustomerChurnConsumptionRead(BaseModel):
    kpis: CustomerChurnConsumptionKpiRead
    cost_by_operator: list[CustomerChurnConsumptionBreakdownRead] = Field(default_factory=list)
    cost_by_department: list[CustomerChurnConsumptionBreakdownRead] = Field(default_factory=list)
    usage_by_department: list[CustomerChurnConsumptionBreakdownRead] = Field(default_factory=list)
    top_consumers: list[CustomerChurnPredictionRead] = Field(default_factory=list)
    priority_lines: list[CustomerChurnPredictionRead] = Field(default_factory=list)


class CustomerChurnCustomerListRead(BaseModel):
    total: int
    offset: int
    limit: int
    items: list[CustomerChurnCustomerRead]


class CustomerChurnPredictionListRead(BaseModel):
    total: int
    offset: int
    limit: int
    items: list[CustomerChurnPredictionRead]


class CustomerChurnRecommendationListRead(BaseModel):
    total: int
    offset: int
    limit: int
    items: list[CustomerChurnRecommendationRead]


class CustomerChurnFiltersRead(BaseModel):
    operators: list[str]
    departments: list[str]
    contracts: list[str]
    payment_methods: list[str]
    internet_services: list[str]
    plans: list[str]
    risk_levels: list[str]
    tenure_groups: list[str]
    price_ranges: list[str]
    churn_statuses: list[str]
    prediction_statuses: list[str]


class CustomerChurnOverviewRead(BaseModel):
    kpis: CustomerChurnKpiRead
    churn_by_contract: list[CustomerChurnBreakdownRead] = Field(default_factory=list)
    churn_by_internet_service: list[CustomerChurnBreakdownRead] = Field(default_factory=list)
    churn_by_price_range: list[CustomerChurnBreakdownRead] = Field(default_factory=list)
    risk_by_department: list[CustomerChurnBreakdownRead] = Field(default_factory=list)
    top_at_risk_customers: list[CustomerChurnPredictionRead] = Field(default_factory=list)


class CustomerChurnReportsRead(BaseModel):
    kpis: CustomerChurnKpiRead
    churn_by_contract: list[CustomerChurnBreakdownRead] = Field(default_factory=list)
    churn_by_internet_service: list[CustomerChurnBreakdownRead] = Field(default_factory=list)
    churn_by_price_range: list[CustomerChurnBreakdownRead] = Field(default_factory=list)
    risk_by_department: list[CustomerChurnBreakdownRead] = Field(default_factory=list)
    top_revenue_at_risk: list[CustomerChurnRecommendationRead] = Field(default_factory=list)
