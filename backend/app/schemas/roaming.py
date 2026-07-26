from pydantic import BaseModel, Field


class RoamingCountryCostRead(BaseModel):
    country: str
    total_roaming_cost_mad: float
    device_count: int
    critical_alerts: int
    fraud_signals: int


class RoamingMapDeviceRead(BaseModel):
    line_id: int | None = None
    phone_number: str | None = None
    employee: str | None = None
    department: str
    operator: str
    country: str
    city: str | None = None
    latitude: float
    longitude: float
    location_source: str
    location_precision_label: str
    location_notice: str
    assignment_notice: str | None = None
    line_assignment_source: str
    roaming_cost: float
    data_usage: float | None = None
    risk_level: str
    risk_score: float
    alerts: int
    fraud_signals: int
    anomaly_type: str
    roaming_active: bool
    recommendation: str
    ai_reasoning: list[str] = Field(default_factory=list)
    explanation: str
    last_event_at: str | None = None
    roaming_events: int
    call_zone: str
    fraud_flag: bool
    call_cost_mad: float
    fraud_risk_score_100: float
    location_origin: str | None = None
    country_origin: str | None = None
    location_dest: str | None = None
    country_dest: str | None = None


class RoamingHeatPointRead(BaseModel):
    label: str
    country: str
    city: str | None = None
    latitude: float
    longitude: float
    intensity: float
    device_count: int
    total_roaming_cost_mad: float
    critical_alerts: int
    fraud_signals: int
    risk_level: str


class RoamingFlowRead(BaseModel):
    origin_label: str
    destination_label: str
    origin_latitude: float
    origin_longitude: float
    destination_latitude: float
    destination_longitude: float
    total_roaming_cost_mad: float
    alerts: int
    event_count: int
    risk_level: str


class RoamingTimelinePointRead(BaseModel):
    bucket: str
    total_roaming_cost_mad: float
    active_devices: int
    alerts: int
    critical_alerts: int
    fraud_signals: int


class RoamingCountryInsightRead(BaseModel):
    country: str
    risk_level: str
    total_roaming_cost_mad: float
    active_devices: int
    critical_alerts: int
    fraud_signals: int
    dominant_operator: str | None = None
    top_department: str | None = None
    explanation_factors: list[str] = Field(default_factory=list)
    explanation: str


class RoamingCriticalZoneRead(BaseModel):
    label: str
    country: str
    city: str | None = None
    latitude: float
    longitude: float
    intensity: float
    total_roaming_cost_mad: float
    active_devices: int
    alerts: int
    critical_alerts: int
    fraud_signals: int
    risk_level: str
    explanation: str


class RoamingMapStatsRead(BaseModel):
    active_roaming_devices: int
    total_roaming_cost_mad: float
    critical_roaming_alerts: int
    fraud_roaming_detected: int
    top_cost_countries: list[RoamingCountryCostRead] = Field(default_factory=list)
    highest_risk_country: str | None = None
    exact_gps_locations: int
    estimated_locations: int
    simulated_locations: int


class RoamingMapFiltersRead(BaseModel):
    countries: list[str] = Field(default_factory=list)
    operators: list[str] = Field(default_factory=list)
    departments: list[str] = Field(default_factory=list)
    risk_levels: list[str] = Field(default_factory=list)
    anomaly_types: list[str] = Field(default_factory=list)
    location_sources: list[str] = Field(default_factory=list)
    roaming_states: list[bool] = Field(default_factory=list)
    fraud_states: list[bool] = Field(default_factory=list)
    period_start: str | None = None
    period_end: str | None = None


class RoamingMapRead(BaseModel):
    devices: list[RoamingMapDeviceRead] = Field(default_factory=list)
    stats: RoamingMapStatsRead
    filters: RoamingMapFiltersRead
    heatmap: list[RoamingHeatPointRead] = Field(default_factory=list)
    clusters: list[RoamingHeatPointRead] = Field(default_factory=list)
    critical_zones: list[RoamingCriticalZoneRead] = Field(default_factory=list)
    movement_flows: list[RoamingFlowRead] = Field(default_factory=list)
    timeline: list[RoamingTimelinePointRead] = Field(default_factory=list)
    country_insights: list[RoamingCountryInsightRead] = Field(default_factory=list)
    generated_at: str
    live_supported: bool
    live_refresh_interval_seconds: int
    privacy_notice: str
