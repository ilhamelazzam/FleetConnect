from typing import Any, Literal

from pydantic import BaseModel, Field

ChatErrorCode = Literal[
    "AUTH_ERROR",
    "AUDIO_INVALID",
    "AUDIO_TOO_LARGE",
    "IMAGE_INVALID",
    "IMAGE_TOO_LARGE",
    "OLLAMA_OFFLINE",
    "NO_AUDIO_DETECTED",
    "OCR_UNAVAILABLE",
    "TRANSCRIPTION_UNAVAILABLE",
    "VOICE_STT_DISABLED",
    "VOICE_STT_UNAVAILABLE",
    "TIMEOUT",
    "TTS_UNAVAILABLE",
    "REQUEST_CANCELLED",
    "VISION_UNAVAILABLE",
    "MEMORY_ERROR",
    "MULTIPART_INVALID",
    "SERVER_ERROR",
]


class ChatContextMessage(BaseModel):
    role: Literal["assistant", "user"]
    text: str = Field(min_length=1, max_length=4000)


class ChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    conversation_id: str | None = Field(default=None, max_length=120)
    history: list[ChatContextMessage] = Field(default_factory=list)


class ChatResponse(BaseModel):
    answer: str
    model: str
    title_hint: str | None = None
    sources: list[str] = Field(default_factory=list)
    summary_updated_at: str
    cached: bool = False
    fallback_used: bool = False
    duration_ms: int | None = None


class ChatActionPlanItem(BaseModel):
    day: str
    title: str
    detail: str
    priority: Literal["low", "medium", "high", "critical"] = "medium"
    reason: str
    impact: str
    deadline: str
    type: Literal["cost", "fraud", "equipment", "workflow", "consumption"] = "cost"
    status: Literal["todo", "in_progress", "done"] = "todo"


class ChatActionPlanResponse(BaseModel):
    plan_title: str
    subtitle: str
    answer: str
    model: str
    sources: list[str] = Field(default_factory=list)
    summary_updated_at: str
    fleet_health_score: int | None = Field(default=None, ge=0, le=100)
    global_risk: Literal["low", "medium", "high", "critical"] | None = None
    trend: Literal["improving", "stable", "declining"] | None = None
    actions: list[ChatActionPlanItem] = Field(default_factory=list)
    weekly_actions: list[ChatActionPlanItem] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)
    cached: bool = False
    fallback_used: bool = False
    duration_ms: int | None = None


class ChatActionPlanRequest(BaseModel):
    history: list[ChatContextMessage] = Field(default_factory=list)


class ChatErrorResponse(BaseModel):
    success: bool = False
    code: ChatErrorCode
    error_type: str | None = None
    message: str
    fallback_answer: str | None = None
    details: dict[str, Any] | None = None

    def model_dump(self, *args, **kwargs):
        kwargs.setdefault("exclude_none", True)
        return super().model_dump(*args, **kwargs)


class ChatVoiceTranscriptionResponse(BaseModel):
    success: bool = True
    text: str = Field(min_length=1, max_length=4000)
    transcript: str = Field(min_length=1, max_length=4000)
    language: str = Field(default="fr", min_length=2, max_length=12)
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    provider: str = Field(default="faster-whisper", min_length=2, max_length=40)
    model: str = Field(default="base", min_length=1, max_length=80)
    duration_ms: int = Field(default=0, ge=0)
    audio_duration_ms: int | None = Field(default=None, ge=0)


class ChatVoiceHealthResponse(BaseModel):
    success: bool = True
    enabled: bool
    ready: bool
    status: Literal["ready", "disabled", "degraded", "unavailable"]
    provider: str = Field(min_length=2, max_length=40)
    model: str = Field(min_length=1, max_length=80)
    language: str = Field(min_length=0, max_length=12)
    device: str = Field(min_length=1, max_length=40)
    compute_type: str = Field(min_length=1, max_length=40)
    runtime_available: bool
    model_loaded: bool
    ffmpeg_available: bool
    message: str
    details: dict[str, Any] = Field(default_factory=dict)


class ChatVoiceSpeakRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


class ChatVoiceSpeakResponse(BaseModel):
    audio_url: str = Field(min_length=1)
    duration: float = Field(ge=0.0)
    format: str = Field(default="audio/mpeg", min_length=5, max_length=40)


class ChatVoiceRespondResponse(BaseModel):
    transcript: str = Field(min_length=1, max_length=4000)
    language: str = Field(default="fr", min_length=2, max_length=12)
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    answer: str = Field(min_length=1)
    audio_url: str = Field(min_length=1)
    duration: float = Field(ge=0.0)
    format: str = Field(default="audio/mpeg", min_length=5, max_length=40)
    model: str
    sources: list[str] = Field(default_factory=list)
    summary_updated_at: str
    cached: bool = False
    fallback_used: bool = False
    duration_ms: int | None = None


class ChatInvoiceCostItem(BaseModel):
    label: str
    amount_mad: str
    amount_value_mad: float | None = Field(default=None, ge=0.0)
    share_of_total_pct: float | None = Field(default=None, ge=0.0, le=1000.0)
    category: str | None = None
    is_critical: bool = False


class ChatInvoiceDetails(BaseModel):
    operator: str | None = None
    invoice_number: str | None = None
    invoice_date: str | None = None
    billing_period: str | None = None
    amount_ht_mad: str | None = None
    vat_amount_mad: str | None = None
    amount_ttc_mad: str | None = None
    total_amount_mad: str | None = None
    billed_lines: list[str] = Field(default_factory=list)
    additional_fees: list[str] = Field(default_factory=list)
    overage_items: list[str] = Field(default_factory=list)
    anomalies: list[str] = Field(default_factory=list)
    cost_items: list[ChatInvoiceCostItem] = Field(default_factory=list)
    critical_items: list[ChatInvoiceCostItem] = Field(default_factory=list)
    primary_risk: str | None = None
    estimated_savings: str | None = None
    risk_level: Literal["low", "medium", "high", "critical"] | None = None


class ChatIncidentDetails(BaseModel):
    alert_type: str | None = None
    severity: str | None = None
    detected_at: str | None = None
    operator: str | None = None
    line_reference: str | None = None
    suspect_cost_mad: str | None = None
    call_volume: str | None = None
    data_overage: str | None = None
    error_message: str | None = None
    priority: str | None = None
    summary: str | None = None
    critical_alert_count: int | None = None
    exposure_rate: str | None = None
    exposure_rate_pct: float | None = None
    financial_impact_mad: str | None = None
    financial_impact_value_mad: float | None = None
    at_risk_clients_count: int | None = None
    department_risk: str | None = None
    contract_exposed: str | None = None
    churn_rate: str | None = None
    churn_rate_pct: float | None = None
    estimated_impact_mad: str | None = None
    estimated_impact_value_mad: float | None = None
    revenue_at_risk_mad: str | None = None
    revenue_at_risk_value_mad: float | None = None
    roi_estimated: str | None = None
    roi_estimated_pct: float | None = None
    priority_actions_count: int | None = None
    average_score: str | None = None
    average_score_value: float | None = None
    fraud_score_visible: str | None = None
    fraud_score_value: float | None = None
    anomaly_score_visible: str | None = None
    anomaly_score_value: float | None = None
    optimization_score_visible: str | None = None
    optimization_score_value: float | None = None
    cost_score_visible: str | None = None
    cost_score_value: float | None = None
    risk_score: str | None = None
    max_risk_scores: list[str] = Field(default_factory=list)
    risky_entities: list[str] = Field(default_factory=list)
    repeated_anomalies: list[str] = Field(default_factory=list)
    visible_statuses: list[str] = Field(default_factory=list)
    critical_signals: list[str] = Field(default_factory=list)
    probable_causes: list[str] = Field(default_factory=list)


class ChatAlertTimelineItem(BaseModel):
    label: str
    detail: str
    status: Literal["observed", "watch", "critical", "action"] = "observed"


class ChatAlertIntelligence(BaseModel):
    alert_family: str | None = None
    ai_risk_score: int | None = Field(default=None, ge=0, le=100)
    ocr_confidence_score: int | None = Field(default=None, ge=0, le=100)
    criticity: Literal["low", "medium", "high", "critical"] | None = None
    executive_summary: str | None = None
    business_risk: str | None = None
    financial_exposure_mad: str | None = None
    potential_loss_mad: str | None = None
    possible_savings_mad: str | None = None
    priority_kpis: list[str] = Field(default_factory=list)
    visible_evidence: list[str] = Field(default_factory=list)
    at_risk_entities: list[str] = Field(default_factory=list)
    immediate_actions: list[str] = Field(default_factory=list)
    recommended_controls: list[str] = Field(default_factory=list)
    alert_timeline: list[ChatAlertTimelineItem] = Field(default_factory=list)
    audit_focus: str | None = None


class ChatImageAnnotation(BaseModel):
    label: str
    type: str
    bbox: list[int] = Field(min_length=4, max_length=4)
    confidence: float = Field(ge=0.0, le=1.0)


class ChatDecisionRecommendation(BaseModel):
    title: str
    priority: Literal["low", "medium", "high", "critical"]
    impact: str
    estimated_saving: str | None = None
    reason: str


class ChatWorkflowDetails(BaseModel):
    workflow_type: str | None = None
    complexity_score: int | None = Field(default=None, ge=0, le=100)
    complexity_level: Literal["low", "medium", "high", "critical"] | None = None
    critical_steps: list[str] = Field(default_factory=list)
    detected_departments: list[str] = Field(default_factory=list)
    detected_roles: list[str] = Field(default_factory=list)
    automation_opportunities: list[str] = Field(default_factory=list)
    bottlenecks: list[str] = Field(default_factory=list)
    repeated_validations: list[str] = Field(default_factory=list)
    summary: str | None = None


class ChatEquipmentDetails(BaseModel):
    equipment_type: str | None = None
    brand: str | None = None
    model: str | None = None
    serial_number: str | None = None
    operator: str | None = None
    visible_condition: str | None = None
    device_version: str | None = None
    sim_information: str | None = None
    label_information: str | None = None
    usage_summary: str | None = None
    detected_issues: list[str] = Field(default_factory=list)
    maintenance_recommendations: list[str] = Field(default_factory=list)
    replacement_needed: bool = False
    condition_score: int | None = Field(default=None, ge=0, le=100)
    criticality_score: int | None = Field(default=None, ge=0, le=100)
    obsolescence_score: int | None = Field(default=None, ge=0, le=100)
    maintenance_score: int | None = Field(default=None, ge=0, le=100)
    summary: str | None = None


class ChatUiDetails(BaseModel):
    ui_type: str | None = None
    ux_score: int | None = Field(default=None, ge=0, le=100)
    readability_score: int | None = Field(default=None, ge=0, le=100)
    accessibility_score: int | None = Field(default=None, ge=0, le=100)
    density_score: int | None = Field(default=None, ge=0, le=100)
    modern_ui_score: int | None = Field(default=None, ge=0, le=100)
    dark_mode_detected: bool | None = None
    mobile_interface: bool | None = None
    detected_issues: list[str] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)
    strong_points: list[str] = Field(default_factory=list)
    summary: str | None = None


class ChatImageAnalysisMetadata(BaseModel):
    """Métadonnées pour tracer l'analyse en mode strict."""
    source_mode: str = Field(default="image_strict")
    visible_kpis_used: list[str] = Field(default_factory=list)
    blocked_global_context: bool = False
    removed_unverified_claims: list[str] = Field(default_factory=list)
    filtered_numbers: list[str] = Field(default_factory=list)
    confidence_score: float = Field(default=0.0, ge=0.0, le=1.0)


class ChatImageResponse(ChatResponse):
    success: bool = True
    mode: Literal["fast", "advanced", "dashboard_analysis"] = "fast"
    image_type: str
    ocr_text: str
    vision_analysis: str
    analysis_mode: Literal["quick", "advanced", "dashboard_analysis"] = "quick"
    analysis_status: Literal["success", "fallback"] = "success"
    advanced_analysis_available: bool = True
    advanced_analysis_completed: bool = False
    can_run_advanced: bool = True
    processing_message: str | None = None
    processing_notices: list[str] = Field(default_factory=list)
    warning: str | None = None
    error_type: str | None = None
    fallback_answer: str | None = None
    detected_kpis: list[str] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)
    confidence: float = Field(ge=0.0, le=1.0)
    ocr_confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    detected_operator: str | None = None
    detected_anomalies: list[str] = Field(default_factory=list)
    analysis_metadata: ChatImageAnalysisMetadata | None = None
    invoice_details: ChatInvoiceDetails | None = None
    incident_details: ChatIncidentDetails | None = None
    alert_intelligence: ChatAlertIntelligence | None = None
    workflow_details: ChatWorkflowDetails | None = None
    equipment_details: ChatEquipmentDetails | None = None
    ui_details: ChatUiDetails | None = None
    highlighted_image: str | None = None
    annotations: list[ChatImageAnnotation] = Field(default_factory=list)
    decision_recommendations: list[ChatDecisionRecommendation] = Field(default_factory=list)
    recommendation_notice: str | None = None
    risk_level: Literal["low", "medium", "high", "critical"] | None = None
    optimization_score: int | None = Field(default=None, ge=0, le=100)
    anomaly_score: int | None = Field(default=None, ge=0, le=100)
    fraud_score: int | None = Field(default=None, ge=0, le=100)
    cost_score: int | None = Field(default=None, ge=0, le=100)


ExecutiveRiskLevel = Literal["low", "medium", "high", "critical"]
ExecutiveScoreLevel = Literal["excellent", "bon", "moyen", "critique"]
ExecutiveScoreDirection = Literal["higher_is_better", "higher_is_worse"]


class ExecutiveReportImageContext(BaseModel):
    image_type: str = Field(min_length=1, max_length=80)
    detected_operator: str | None = Field(default=None, max_length=120)
    detected_kpis: list[str] = Field(default_factory=list)
    detected_anomalies: list[str] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)
    annotations: list[ChatImageAnnotation] = Field(default_factory=list)
    decision_recommendations: list[ChatDecisionRecommendation] = Field(default_factory=list)
    risk_level: ExecutiveRiskLevel | None = None
    optimization_score: int | None = Field(default=None, ge=0, le=100)
    anomaly_score: int | None = Field(default=None, ge=0, le=100)
    fraud_score: int | None = Field(default=None, ge=0, le=100)
    cost_score: int | None = Field(default=None, ge=0, le=100)
    invoice_details: ChatInvoiceDetails | None = None
    incident_details: ChatIncidentDetails | None = None
    workflow_details: ChatWorkflowDetails | None = None
    equipment_details: ChatEquipmentDetails | None = None


class ExecutiveReportRequest(BaseModel):
    conversation_id: str | None = Field(default=None, max_length=120)
    history: list[ChatContextMessage] = Field(default_factory=list)
    image_analyses: list[ExecutiveReportImageContext] = Field(default_factory=list)


class ExecutiveReportScoreExplanation(BaseModel):
    label: str
    score: int = Field(ge=0, le=100)
    level: ExecutiveScoreLevel
    direction: ExecutiveScoreDirection
    explanation: str


class ExecutiveReportCostItem(BaseModel):
    title: str
    amount_mad: float = Field(ge=0.0)
    category: str
    owner: str | None = None
    reason: str


class ExecutiveReportDepartmentItem(BaseModel):
    department: str
    risk_score: int = Field(ge=0, le=100)
    monthly_cost_mad: float | None = Field(default=None, ge=0.0)
    alert_count: int = Field(default=0, ge=0)
    reason: str


class ExecutiveReportOperatorItem(BaseModel):
    operator: str
    total_cost_mad: float = Field(ge=0.0)
    suspicious_calls: int = Field(default=0, ge=0)
    roaming_lines: int = Field(default=0, ge=0)
    reason: str


class ExecutiveReportAnomalyItem(BaseModel):
    title: str
    severity: ExecutiveRiskLevel
    source: str
    reason: str


class ExecutiveReportFraudSignalItem(BaseModel):
    title: str
    severity: ExecutiveRiskLevel
    operator: str | None = None
    department: str | None = None
    estimated_exposure_mad: float | None = Field(default=None, ge=0.0)
    reason: str


class ExecutiveReportOpportunityItem(BaseModel):
    title: str
    estimated_saving_mad: float | None = Field(default=None, ge=0.0)
    justification: str


class ExecutiveReportRecommendationItem(BaseModel):
    title: str
    priority: ExecutiveRiskLevel
    justification: str
    action: str
    estimated_saving_mad: float | None = Field(default=None, ge=0.0)


class ExecutiveReportChartPoint(BaseModel):
    label: str
    value: float
    secondary_value: float | None = None


class ExecutiveReportCharts(BaseModel):
    cost_evolution: list[ExecutiveReportChartPoint] = Field(default_factory=list)
    department_risk: list[ExecutiveReportChartPoint] = Field(default_factory=list)
    operator_costs: list[ExecutiveReportChartPoint] = Field(default_factory=list)
    score_breakdown: list[ExecutiveReportChartPoint] = Field(default_factory=list)


class ExecutiveReportResponse(BaseModel):
    executive_summary: str
    fleet_health_score: int = Field(ge=0, le=100)
    fleet_health_level: ExecutiveScoreLevel
    risk_level: ExecutiveRiskLevel
    risk_score: int = Field(ge=0, le=100)
    fraud_score: int = Field(ge=0, le=100)
    optimization_score: int = Field(ge=0, le=100)
    anomaly_score: int = Field(ge=0, le=100)
    equipment_score: int = Field(ge=0, le=100)
    critical_costs: list[ExecutiveReportCostItem] = Field(default_factory=list)
    high_risk_departments: list[ExecutiveReportDepartmentItem] = Field(default_factory=list)
    costly_operators: list[ExecutiveReportOperatorItem] = Field(default_factory=list)
    major_anomalies: list[ExecutiveReportAnomalyItem] = Field(default_factory=list)
    fraud_signals: list[ExecutiveReportFraudSignalItem] = Field(default_factory=list)
    priority_risks: list[str] = Field(default_factory=list)
    optimization_opportunities: list[ExecutiveReportOpportunityItem] = Field(default_factory=list)
    top_recommendations: list[ExecutiveReportRecommendationItem] = Field(default_factory=list)
    estimated_savings: str
    estimated_savings_mad: float = Field(ge=0.0)
    multimodal_highlights: list[str] = Field(default_factory=list)
    multimodal_analysis_count: int = Field(default=0, ge=0)
    score_explanations: list[ExecutiveReportScoreExplanation] = Field(default_factory=list)
    charts: ExecutiveReportCharts = Field(default_factory=ExecutiveReportCharts)
    model: str
    sources: list[str] = Field(default_factory=list)
    summary_updated_at: str
    cached: bool = False
    fallback_used: bool = False
    duration_ms: int | None = None


class ExplainabilityExecutiveContext(BaseModel):
    executive_summary: str
    fleet_health_score: int | None = Field(default=None, ge=0, le=100)
    risk_level: ExecutiveRiskLevel | None = None
    risk_score: int | None = Field(default=None, ge=0, le=100)
    fraud_score: int | None = Field(default=None, ge=0, le=100)
    optimization_score: int | None = Field(default=None, ge=0, le=100)
    anomaly_score: int | None = Field(default=None, ge=0, le=100)
    equipment_score: int | None = Field(default=None, ge=0, le=100)
    estimated_savings: str | None = None
    critical_costs: list[ExecutiveReportCostItem] = Field(default_factory=list)
    high_risk_departments: list[ExecutiveReportDepartmentItem] = Field(default_factory=list)
    costly_operators: list[ExecutiveReportOperatorItem] = Field(default_factory=list)
    major_anomalies: list[ExecutiveReportAnomalyItem] = Field(default_factory=list)
    fraud_signals: list[ExecutiveReportFraudSignalItem] = Field(default_factory=list)
    priority_risks: list[str] = Field(default_factory=list)
    top_recommendations: list[ExecutiveReportRecommendationItem] = Field(default_factory=list)
    score_explanations: list[ExecutiveReportScoreExplanation] = Field(default_factory=list)
    sources: list[str] = Field(default_factory=list)
    summary_updated_at: str | None = None


class ExplainabilityRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    focus_label: str | None = Field(default=None, max_length=240)
    conversation_id: str | None = Field(default=None, max_length=120)
    history: list[ChatContextMessage] = Field(default_factory=list)
    message_text: str | None = Field(default=None, max_length=4000)
    image_analysis: ExecutiveReportImageContext | None = None
    executive_report: ExplainabilityExecutiveContext | None = None
    use_live_context: bool = True


class ExplainabilityFactor(BaseModel):
    label: str
    category: str
    value: str
    impact_score: int = Field(ge=0, le=100)
    severity: ExecutiveRiskLevel
    evidence: str


class ExplainabilityCriticalZone(BaseModel):
    label: str
    zone_type: str
    severity: ExecutiveRiskLevel
    detail: str
    value: str | None = None


class ExplainabilityGraphNode(BaseModel):
    node_id: str
    label: str
    node_type: Literal["signal", "cause", "decision", "impact", "zone"]
    severity: ExecutiveRiskLevel
    weight: int = Field(ge=0, le=100)


class ExplainabilityGraphEdge(BaseModel):
    source: str
    target: str
    relation: str


class ExplainabilityGraph(BaseModel):
    summary: str
    dominant_factor: str | None = None
    nodes: list[ExplainabilityGraphNode] = Field(default_factory=list)
    edges: list[ExplainabilityGraphEdge] = Field(default_factory=list)


class ExplainabilityCharts(BaseModel):
    factor_breakdown: list[ExecutiveReportChartPoint] = Field(default_factory=list)
    risk_timeline: list[ExecutiveReportChartPoint] = Field(default_factory=list)
    critical_zone_heatmap: list[ExecutiveReportChartPoint] = Field(default_factory=list)
    score_radar: list[ExecutiveReportChartPoint] = Field(default_factory=list)


class ExplainabilityResponse(BaseModel):
    answer: str
    confidence: float = Field(ge=0.0, le=1.0)
    risk_level: ExecutiveRiskLevel
    reasoning: list[str] = Field(default_factory=list)
    causes: list[str] = Field(default_factory=list)
    influencing_factors: list[ExplainabilityFactor] = Field(default_factory=list)
    explanation_graph: ExplainabilityGraph
    critical_zones: list[ExplainabilityCriticalZone] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)
    data_points_used: list[str] = Field(default_factory=list)
    confidence_score: int = Field(ge=0, le=100)
    fraud_score: int = Field(ge=0, le=100)
    anomaly_score: int = Field(ge=0, le=100)
    optimization_score: int = Field(ge=0, le=100)
    risk_score: int = Field(ge=0, le=100)
    equipment_score: int = Field(ge=0, le=100)
    charts: ExplainabilityCharts = Field(default_factory=ExplainabilityCharts)
    model: str
    sources: list[str] = Field(default_factory=list)
    summary_updated_at: str
    cached: bool = False
    fallback_used: bool = False
    duration_ms: int | None = None


class ExplainRecommendationRequest(BaseModel):
    recommendation_title: str = Field(min_length=1, max_length=400)
    conversation_id: str | None = Field(default=None, max_length=120)
    history: list[ChatContextMessage] = Field(default_factory=list)
    image_analysis: ExecutiveReportImageContext | None = None
    executive_report: ExplainabilityExecutiveContext | None = None
    use_live_context: bool = True


class ExplainRecommendationFactor(BaseModel):
    label: str
    category: str
    value: str
    impact_score: int = Field(ge=0, le=100)
    severity: ExecutiveRiskLevel
    evidence: str
    weight: float = Field(ge=0.0, le=1.0)


class ExplainRecommendationDecisionStep(BaseModel):
    step_number: int
    step_title: str
    step_description: str
    data_used: list[str] = Field(default_factory=list)
    confidence: float = Field(ge=0.0, le=1.0)


class ExplainRecommendationSupportingKpi(BaseModel):
    label: str
    value: str
    unit: str | None = None
    impact: str
    confidence: float = Field(ge=0.0, le=1.0)


class ExplainRecommendationReasoning(BaseModel):
    factors: list[str] = Field(default_factory=list)
    kpis: list[str] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    impact: str = ""
    business_explanation: str = ""


class ExplainRecommendationResponse(BaseModel):
    recommendation: str
    answer: str
    reasoning: ExplainRecommendationReasoning = Field(
        default_factory=ExplainRecommendationReasoning
    )
    confidence_score: float = Field(ge=0.0, le=1.0)
    estimated_savings: str | None = None
    risk_level: ExecutiveRiskLevel
    impact_score: int = Field(ge=0, le=100)
    risk_score: int = Field(ge=0, le=100)
    fraud_score: int = Field(ge=0, le=100)
    anomaly_score: int = Field(ge=0, le=100)
    optimization_score: int = Field(ge=0, le=100)
    equipment_score: int = Field(ge=0, le=100)
    supporting_kpis: list[ExplainRecommendationSupportingKpi] = Field(default_factory=list)
    influencing_factors: list[ExplainRecommendationFactor] = Field(default_factory=list)
    decision_trace: list[ExplainRecommendationDecisionStep] = Field(default_factory=list)
    explanation_graph: ExplainabilityGraph
    critical_zones: list[ExplainabilityCriticalZone] = Field(default_factory=list)
    alternative_recommendations: list[str] = Field(default_factory=list)
    data_points_used: list[str] = Field(default_factory=list)
    model: str
    sources: list[str] = Field(default_factory=list)
    summary_updated_at: str
    cached: bool = False
    fallback_used: bool = False
    duration_ms: int | None = None
