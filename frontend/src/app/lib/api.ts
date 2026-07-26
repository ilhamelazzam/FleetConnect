import {
  clearStoredSession,
  hasPersistentSession,
  readStoredSession,
  writeStoredSession,
} from "./auth-session";
import { emitApiErrorEvent } from "./error-events";

export type ApiUserRole =
  | "super_admin"
  | "admin"
  | "company_admin"
  | "manager"
  | "user"
  | "analyst";
export type ApiUserStatus = "pending" | "active" | "suspended" | "rejected";
export type ApiInvitationStatus = "pending" | "accepted" | "cancelled" | "expired";
export type ApiInvitationExpiration = "7_days" | "14_days" | "30_days";
export type ApiUserInvitationActionCode =
  | "INVITATION_SENT"
  | "INVITATION_RESENT"
  | "INVITATION_ALREADY_SENT"
  | "INVITATION_CANCELLED";
export type ApiImageAnalysisMode = "quick" | "advanced" | "dashboard_analysis";

export interface ApiUser {
  id: number;
  full_name: string;
  email: string;
  photo_url: string | null;
  phone: string | null;
  role: ApiUserRole;
  company_id: number | null;
  company_name: string | null;
  department_id: number | null;
  department_name: string | null;
  requested_department: string | null;
  job_profile: string | null;
  is_active: boolean;
  account_status: ApiUserStatus | null;
  status: ApiUserStatus;
  updated_at: string;
  last_login_at: string | null;
  created_at: string;
}

export type ApiCompanyRegistrationStatus =
  | "pending"
  | "under_review"
  | "approved"
  | "rejected";
export type ApiCompanyLifecycleStatus = "active" | "suspended" | "deleted";
export type ApiCompanyRequestedRole = "ADMIN" | "MANAGER" | "ANALYST";
export type ApiCompanyRegistrationEligibilityReason =
  | "available"
  | "active_request_exists"
  | "active_user_exists"
  | "resubmission_allowed";

export interface ApiCompanyRegistrationDocument {
  key: string;
  label: string;
  file_name: string;
  download_url: string;
}

export interface ApiCompanyStatusHistory {
  id: number;
  action: string;
  title: string;
  comment: string | null;
  previous_status: string | null;
  next_status: string | null;
  actor_user_id: number | null;
  actor_user_name: string | null;
  created_at: string;
}

export interface ApiCompanyRegistrationDecision {
  status: ApiCompanyRegistrationStatus;
  rejection_reason: string | null;
  reviewed_at: string | null;
  reviewed_by_user_id: number | null;
  reviewed_by_name: string | null;
}

export interface ApiCompanyRegistrationSummary {
  id: number;
  responsible_full_name: string;
  responsible_email: string;
  responsible_phone: string;
  job_title: string;
  requested_role: ApiCompanyRequestedRole;
  requested_role_label: string;
  company_name: string;
  sector: string;
  city: string;
  address_line: string | null;
  region: string | null;
  postal_code: string | null;
  country: string | null;
  company_phone: string;
  ice: string | null;
  rc: string | null;
  primary_operator: string | null;
  estimated_phone_lines: number;
  employees_count: number;
  operators: string[];
  status: ApiCompanyRegistrationStatus;
  is_deleted: boolean;
  deleted_at: string | null;
  deleted_by_user_id: number | null;
  deleted_by_name: string | null;
  previous_request_id: number | null;
  resubmission_number: number;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApiCompanyRegistrationDetail extends ApiCompanyRegistrationSummary {
  tax_id: string | null;
  cnss: string | null;
  patente: string | null;
  website: string | null;
  latitude: number | null;
  longitude: number | null;
  coverage_zones: string[];
  documents: ApiCompanyRegistrationDocument[];
  history: ApiCompanyStatusHistory[];
  decision: ApiCompanyRegistrationDecision;
  approved_company_id: number | null;
  approved_company_name: string | null;
  approved_admin_user_id: number | null;
  approved_admin_email: string | null;
}

export interface ApiCompanyRegistrationListResponse {
  total: number;
  offset: number;
  limit: number;
  items: ApiCompanyRegistrationSummary[];
}

export interface ApiCompanySummary {
  id: number;
  company_code: string | null;
  name: string;
  sector: string;
  city: string;
  country: string | null;
  phone: string;
  ice: string | null;
  status: ApiCompanyLifecycleStatus;
  user_count: number;
  estimated_phone_lines: number;
  operators: string[];
  created_at: string;
}

export interface ApiCompanyAdminSummary {
  id: number;
  full_name: string;
  email: string;
  role: string;
  company_id: number | null;
  company_name: string | null;
  created_at: string;
}

export interface ApiCompanyRegistrationStats {
  pending: number;
  under_review: number;
  approved: number;
  rejected: number;
  this_month: number;
  total: number;
  active_companies: number;
  total_users: number;
  suspended_companies: number;
  connections: number;
}

export interface ApiCompanyOperatorDistribution {
  operator: string;
  total: number;
}

export interface ApiCompanyRegistrationOverview {
  stats: ApiCompanyRegistrationStats;
  operator_distribution: ApiCompanyOperatorDistribution[];
  recent_companies: ApiCompanySummary[];
  recent_company_admins: ApiCompanyAdminSummary[];
}

export interface ApiCompanyRegistrationSubmitResponse {
  message: string;
  request_id: number;
  status: ApiCompanyRegistrationStatus;
  previous_request_id: number | null;
  resubmission_number: number;
}

export interface ApiCompanyRegistrationActionResponse {
  message: string;
  request: ApiCompanyRegistrationDetail;
}

export interface ApiCompanyRegistrationEmailEligibility {
  can_submit: boolean;
  reason: ApiCompanyRegistrationEligibilityReason;
  message: string;
  previous_request_id: number | null;
}

export interface ApiCompanyListItem {
  id: number;
  company_code: string | null;
  name: string;
  sector: string;
  city: string;
  address_line: string | null;
  region: string | null;
  postal_code: string | null;
  country: string | null;
  phone: string;
  ice: string | null;
  rc: string | null;
  tax_id: string | null;
  cnss: string | null;
  patente: string | null;
  website: string | null;
  status: ApiCompanyLifecycleStatus;
  join_code: string | null;
  estimated_phone_lines: number;
  employees_count: number;
  user_count: number;
  active_user_count: number;
  suspended_user_count: number;
  pending_user_count: number;
  admin_count: number;
  operators: string[];
  coverage_zones: string[];
  logo_download_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApiCompanyListResponse {
  total: number;
  offset: number;
  limit: number;
  items: ApiCompanyListItem[];
}

export interface ApiCompanyDashboardMetrics {
  total_users: number;
  active_users: number;
  suspended_users: number;
  pending_users: number;
  admin_users: number;
  estimated_phone_lines: number;
  employees_count: number;
  operators_count: number;
}

export interface ApiCompanyDashboard {
  company: ApiCompanyListItem;
  metrics: ApiCompanyDashboardMetrics;
  admins: ApiCompanyAdminSummary[];
  history: ApiCompanyStatusHistory[];
}

export interface ApiCompanyAuditLogListResponse {
  total: number;
  offset: number;
  limit: number;
  items: ApiCompanyStatusHistory[];
}

export type ApiPhoneLineOccupationStatus =
  | "libre"
  | "attribuee"
  | "en_cours"
  | "suspendue"
  | "inactive";

export interface ApiPhoneLine {
  id: number;
  phone_number: string;
  operator_name: string;
  plan_name: string;
  assigned_to: string | null;
  contact_email: string | null;
  department: string | null;
  status: string;
  monthly_limit: number | null;
  current_data_usage_gb: number;
  previous_data_usage_gb: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  occupation_status: ApiPhoneLineOccupationStatus | null;
}

export interface ApiPhoneLineStats {
  total: number;
  created_this_month: number;
  average_data_usage_gb: number | null;
  previous_average_data_usage_gb: number | null;
  average_data_usage_change_pct: number | null;
  total_ai_alerts: number;
  critical_ai_alerts: number;
  estimated_monthly_savings_mad: number;
}

export interface ApiPhoneLineOccupationStats {
  total: number;
  total_libre: number;
  total_attribuees: number;
  total_en_cours: number;
  total_suspendues: number;
  total_inactives: number;
}

export interface ChangePhoneLinePlanPayload {
  plan_id: number;
}

export interface ApiAIRiskInsightFields {
  risk_id: string;
  title: string;
  severity?: string;
  description: string;
  impact: string;
  ai_recommendation: string;
  suggested_action: string;
  confidence_score: number;
  recommendation_status?: string | null;
}

export type ApiNotificationType = "alert" | "info" | "success" | "warning" | "ai";
export type ApiNotificationPriority = "low" | "medium" | "high" | "critical";
export type ApiNotificationFilter = "all" | "alerts" | "ai" | "system";

export interface ApiNotification {
  id: number;
  type: ApiNotificationType;
  title: string;
  message: string;
  timestamp: string;
  is_read: boolean;
  status: "read" | "unread";
  priority: ApiNotificationPriority;
  link_url: string | null;
  ai_recommendation: string | null;
  action_suggeree: string | null;
  recipient_user_id: number;
  actor_user_id: number | null;
  related_resource_id: number | null;
  related_compliance_alert_id: number | null;
  source_type: string | null;
  source_id: string | null;
  metadata_json: Record<string, unknown>;
}

export interface ApiNotificationList {
  total: number;
  unread_count: number;
  offset: number;
  limit: number;
  items: ApiNotification[];
}

export interface CreateNotificationPayload {
  recipient_user_id?: number | null;
  type: ApiNotificationType;
  title: string;
  message: string;
  priority: ApiNotificationPriority;
  link_url?: string | null;
  ai_recommendation?: string | null;
  action_suggeree?: string | null;
  related_resource_id?: number | null;
  related_compliance_alert_id?: number | null;
  source_type?: string | null;
  source_id?: string | null;
  source_key?: string | null;
  metadata_json?: Record<string, unknown>;
}

export interface ApiCdrKpi {
  total_calls: number;
  suspicious_calls: number;
  critical_alerts: number;
  average_cost_mad: number;
  average_risk_score: number;
  suspicious_cost_exposure_mad: number;
}

export interface ApiCdrRiskDistribution {
  severity: string;
  count: number;
}

export interface ApiCdrDepartmentAlert {
  department: string;
  count: number;
}

export interface ApiCdrOperatorCost {
  operator: string;
  total_cost_mad: number;
  suspicious_calls: number;
}

export interface ApiCdrZoneDistribution {
  call_zone: string;
  count: number;
}

export interface ApiCdrAlert extends ApiAIRiskInsightFields {
  cdr_row_id: number;
  start_time: string;
  operator_maroc: string;
  department: string;
  call_zone: string;
  fraud_type: string;
  call_cost_mad: number;
  fraud_risk_score_100: number;
  severity: string;
  is_alert: boolean;
  alert_flag: boolean;
  fraud_severity: string;
  fraud_severity_score: number;
  investigation_priority: string;
  estimated_financial_loss: number;
  ai_recommendation_priority: string;
  recommendation: string;
}

export interface ApiCdrAlertDetail extends ApiCdrAlert {
  duration_sec: number;
  call_type: string;
  location_origin: string;
  country_origin: string;
  location_dest: string;
  country_dest: string;
  transaction_status: string;
  is_night_call: boolean;
  roaming_flag: boolean;
  high_cost_flag: boolean;
  long_duration_flag: boolean;
  international_flag: boolean;
  fraud_risk_proba: number;
  recommendation_reason: string;
  rule_matches: string[];
  route_label: string;
}

export interface ApiCdrRecommendation extends ApiAIRiskInsightFields {
  cdr_row_id: number;
  start_time: string;
  operator_maroc: string;
  department: string;
  call_zone: string;
  severity: string;
  fraud_type: string;
  call_cost_mad: number;
  fraud_risk_score_100: number;
  alert_flag: boolean;
  fraud_severity: string;
  fraud_severity_score: number;
  investigation_priority: string;
  estimated_financial_loss: number;
  ai_recommendation_priority: string;
  recommendation: string;
  recommendation_reason: string;
}

export interface ApiCdrFilters {
  operators: string[];
  departments: string[];
  call_zones: string[];
  severities: string[];
}

export interface ApiCdrAlertList {
  total: number;
  offset: number;
  limit: number;
  items: ApiCdrAlert[];
}

export interface ApiCdrRecommendationList {
  total: number;
  offset: number;
  limit: number;
  items: ApiCdrRecommendation[];
}

export interface ApiCdrOverview {
  snapshot_start_time: string | null;
  snapshot_end_time: string | null;
  kpis: ApiCdrKpi;
  risk_distribution: ApiCdrRiskDistribution[];
  alerts_by_department: ApiCdrDepartmentAlert[];
  cost_by_operator: ApiCdrOperatorCost[];
  calls_by_zone: ApiCdrZoneDistribution[];
  top_risky_calls: ApiCdrAlert[];
  priority_alerts: ApiCdrAlert[];
}

export interface ApiCdrMapPoint {
  city: string;
  country: string;
  region: string;
  latitude: number;
  longitude: number;
  count: number;
  alerts: number;
  risk_score: number;
  estimated_loss_mad: number;
  top_recommendation: string;
}

export interface ApiCdrMapFlow {
  origin_city: string;
  origin_country: string;
  origin_region: string;
  origin_latitude: number;
  origin_longitude: number;
  destination_city: string;
  destination_country: string;
  destination_region: string;
  destination_latitude: number;
  destination_longitude: number;
  count: number;
  alerts: number;
  risk_score: number;
  estimated_loss_mad: number;
}

export interface ApiCdrMapUnknownLocation {
  cdr_row_id: number;
  field: string;
  raw_value: string;
  country: string;
  reason: string;
}

export interface ApiCdrMapFilters {
  operators: string[];
  departments: string[];
  risk_levels: string[];
  fraud_severities: string[];
  regions: string[];
  modes: string[];
  scopes: string[];
}

export interface ApiCdrMapResponse {
  mode: string;
  scope: string;
  center: number[];
  zoom: number;
  points: ApiCdrMapPoint[];
  flows: ApiCdrMapFlow[];
  unknown_locations: ApiCdrMapUnknownLocation[];
  filters: ApiCdrMapFilters;
}

export type ApiRoamingLocationSource =
  | "gps_exact"
  | "estimated_cdr"
  | "estimated_mcc"
  | "simulated_demo";

export type ApiRoamingLineAssignmentSource = "direct" | "estimated_scope" | "demo";
export type ApiRoamingRiskLevel = "low" | "medium" | "high" | "critical";

export interface ApiRoamingMapPoint {
  line_id: number | null;
  phone_number: string | null;
  employee_name: string | null;
  department: string;
  operator: string;
  country: string;
  city: string | null;
  latitude: number;
  longitude: number;
  location_source: ApiRoamingLocationSource;
  location_precision_label: string;
  line_assignment_source: ApiRoamingLineAssignmentSource;
  location_notice: string | null;
  assignment_notice: string | null;
  roaming_cost_mad: number;
  data_usage_gb: number | null;
  risk_level: ApiRoamingRiskLevel;
  risk_label: string;
  recommendation: string;
  event_time: string | null;
  roaming_event_count: number;
  position_disclaimer: string;
}

export interface ApiRoamingMapCountryCost {
  country: string;
  total_cost_mad: number;
  device_count: number;
  critical_alerts: number;
}

export interface ApiRoamingMapStats {
  roaming_devices: number;
  total_roaming_cost_mad: number;
  critical_alerts: number;
  top_cost_countries: ApiRoamingMapCountryCost[];
  exact_gps_count: number;
  estimated_location_count: number;
  simulated_location_count: number;
}

export interface ApiRoamingMapFilters {
  countries: string[];
  operators: string[];
  departments: string[];
  risk_levels: ApiRoamingRiskLevel[];
  location_sources: ApiRoamingLocationSource[];
  period_start: string | null;
  period_end: string | null;
}

export interface ApiRoamingMapResponse {
  points: ApiRoamingMapPoint[];
  stats: ApiRoamingMapStats;
  filters: ApiRoamingMapFilters;
  generated_at: string;
  privacy_notice: string;
}

export interface ApiRoamingIntelligenceDevice {
  line_id: number | null;
  phone_number: string | null;
  employee: string | null;
  department: string;
  operator: string;
  country: string;
  city: string | null;
  latitude: number;
  longitude: number;
  location_source: ApiRoamingLocationSource;
  location_precision_label: string;
  location_notice: string;
  assignment_notice: string | null;
  line_assignment_source: ApiRoamingLineAssignmentSource;
  roaming_cost: number;
  data_usage: number | null;
  risk_level: ApiRoamingRiskLevel;
  risk_score: number;
  alerts: number;
  fraud_signals: number;
  anomaly_type: string;
  roaming_active: boolean;
  recommendation: string;
  ai_reasoning: string[];
  explanation: string;
  last_event_at: string | null;
  roaming_events: number;
  call_zone: string;
  fraud_flag: boolean;
  call_cost_mad: number;
  fraud_risk_score_100: number;
  location_origin: string | null;
  country_origin: string | null;
  location_dest: string | null;
  country_dest: string | null;
}

export interface ApiRoamingIntelligenceCountryCost {
  country: string;
  total_roaming_cost_mad: number;
  device_count: number;
  critical_alerts: number;
  fraud_signals: number;
}

export interface ApiRoamingIntelligenceZone {
  label: string;
  country: string;
  city: string | null;
  latitude: number;
  longitude: number;
  intensity: number;
  device_count: number;
  total_roaming_cost_mad: number;
  critical_alerts: number;
  fraud_signals: number;
  risk_level: ApiRoamingRiskLevel;
}

export interface ApiRoamingIntelligenceFlow {
  origin_label: string;
  destination_label: string;
  origin_latitude: number;
  origin_longitude: number;
  destination_latitude: number;
  destination_longitude: number;
  total_roaming_cost_mad: number;
  alerts: number;
  event_count: number;
  risk_level: ApiRoamingRiskLevel;
}

export interface ApiRoamingIntelligenceTimelinePoint {
  bucket: string;
  total_roaming_cost_mad: number;
  active_devices: number;
  alerts: number;
  critical_alerts: number;
  fraud_signals: number;
}

export interface ApiRoamingCountryInsight {
  country: string;
  risk_level: ApiRoamingRiskLevel;
  total_roaming_cost_mad: number;
  active_devices: number;
  critical_alerts: number;
  fraud_signals: number;
  dominant_operator: string | null;
  top_department: string | null;
  explanation_factors: string[];
  explanation: string;
}

export interface ApiRoamingCriticalZone {
  label: string;
  country: string;
  city: string | null;
  latitude: number;
  longitude: number;
  intensity: number;
  total_roaming_cost_mad: number;
  active_devices: number;
  alerts: number;
  critical_alerts: number;
  fraud_signals: number;
  risk_level: ApiRoamingRiskLevel;
  explanation: string;
}

export interface ApiRoamingIntelligenceStats {
  active_roaming_devices: number;
  total_roaming_cost_mad: number;
  critical_roaming_alerts: number;
  fraud_roaming_detected: number;
  top_cost_countries: ApiRoamingIntelligenceCountryCost[];
  highest_risk_country: string | null;
  exact_gps_locations: number;
  estimated_locations: number;
  simulated_locations: number;
}

export interface ApiRoamingIntelligenceFilters {
  countries: string[];
  operators: string[];
  departments: string[];
  risk_levels: ApiRoamingRiskLevel[];
  anomaly_types: string[];
  location_sources: ApiRoamingLocationSource[];
  roaming_states: boolean[];
  fraud_states: boolean[];
  period_start: string | null;
  period_end: string | null;
}

export interface ApiRoamingIntelligenceResponse {
  devices: ApiRoamingIntelligenceDevice[];
  stats: ApiRoamingIntelligenceStats;
  filters: ApiRoamingIntelligenceFilters;
  heatmap: ApiRoamingIntelligenceZone[];
  clusters: ApiRoamingIntelligenceZone[];
  critical_zones: ApiRoamingCriticalZone[];
  movement_flows: ApiRoamingIntelligenceFlow[];
  timeline: ApiRoamingIntelligenceTimelinePoint[];
  country_insights: ApiRoamingCountryInsight[];
  generated_at: string;
  live_supported: boolean;
  live_refresh_interval_seconds: number;
  privacy_notice: string;
}

export interface ApiMobileFleetKpi {
  total_devices: number;
  total_estimated_budget_mad: number;
  average_estimated_price_mad: number;
  average_budget_risk_score: number;
  alert_devices: number;
  critical_risks: number;
  premium_devices: number;
}

export interface ApiMobileFleetDistribution {
  label: string;
  count: number;
}

export interface ApiMobileFleetBudgetBreakdown {
  label: string;
  total_estimated_price_mad: number;
  average_budget_risk_score: number;
  alert_devices: number;
}

export interface ApiMobileFleetDevice extends ApiAIRiskInsightFields {
  fleet_row_id: number;
  operator: string;
  department: string;
  employee_profile: string;
  device_category: string;
  estimated_price_mad: number;
  budget_risk_score: number;
  risk_level: string;
  alert_flag: boolean;
  recommendation: string;
  predicted_price_label: string;
  prediction_confidence: number;
}

export interface ApiMobileFleetDeviceList {
  total: number;
  offset: number;
  limit: number;
  items: ApiMobileFleetDevice[];
}

export interface ApiMobileFleetFilters {
  operators: string[];
  departments: string[];
  employee_profiles: string[];
  device_categories: string[];
  risk_levels: string[];
  predicted_price_labels: string[];
}

export interface ApiMobileFleetOverview {
  kpis: ApiMobileFleetKpi;
  risk_distribution: ApiMobileFleetDistribution[];
  devices_by_operator: ApiMobileFleetDistribution[];
  devices_by_category: ApiMobileFleetDistribution[];
  budget_by_department: ApiMobileFleetBudgetBreakdown[];
  top_devices: ApiMobileFleetDevice[];
}

export interface ApiMobileFleetAdvancedKpis {
  total_devices: number;
  total_estimated_budget_mad: number;
  total_cost_12_months_mad: number;
  fleet_health_score: number;
  average_fit_score: number;
  adapted_devices: number;
  unfit_devices: number;
  oversized_devices: number;
  undersized_devices: number;
  potential_savings_mad: number;
  alerts_summary: string;
  fit_rate_pct: number;
  optimization_rate_pct: number;
}

export interface ApiFleetHealthScoreBreakdownPoint {
  label: string;
  value: number;
}

export interface ApiFleetHealthScoreFactor {
  label: string;
  category: string;
  value: string;
  impact_score: number;
  severity: "low" | "medium" | "high" | "critical";
  evidence: string;
}

export interface ApiFleetHealthScoreSubScores {
  cost_score: number;
  fraud_score: number;
  anomaly_score: number;
  optimization_score: number;
  equipment_score: number;
  workflow_score: number;
  risk_score: number;
  roaming_score: number;
}

export interface ApiFleetHealthScoreResponse {
  fleet_health_score: number;
  fleet_health_level: "excellent" | "bon" | "moyen" | "eleve" | "critique";
  global_risk: "low" | "medium" | "high" | "critical";
  trend: "improving" | "stable" | "declining";
  scores: ApiFleetHealthScoreSubScores;
  risk_score: number;
  cost_score: number;
  fraud_score: number;
  optimization_score: number;
  anomaly_score: number;
  equipment_score: number;
  workflow_score: number;
  roaming_score: number;
  main_risks: string[];
  main_strengths: string[];
  recommendations: string[];
  explanation: string;
  score_breakdown: ApiFleetHealthScoreBreakdownPoint[];
  key_factors: ApiFleetHealthScoreFactor[];
  summary_updated_at: string;
  sources: string[];
  cached: boolean;
  fallback_used: boolean;
  duration_ms: number | null;
}

export interface ApiMobileFleetConsumption {
  kpis: ApiMobileFleetKpi;
  budget_by_operator: ApiMobileFleetBudgetBreakdown[];
  budget_by_device_category: ApiMobileFleetBudgetBreakdown[];
  risk_distribution: ApiMobileFleetDistribution[];
  top_expensive_devices: ApiMobileFleetDevice[];
}

export interface ApiMobileFleetRecommendation extends ApiMobileFleetDevice {
  priority_rank: number;
}

export interface ApiMobileFleetRecommendationList {
  total: number;
  offset: number;
  limit: number;
  items: ApiMobileFleetRecommendation[];
}

export interface ApiMobileFleetDepartmentRecommendation {
  department: string;
  devices_to_optimize: number;
  alert_devices: number;
  critical_risks: number;
  estimated_budget_mad: number;
}

export interface ApiMobileFleetReports {
  kpis: ApiMobileFleetKpi;
  budget_by_department: ApiMobileFleetBudgetBreakdown[];
  devices_by_category: ApiMobileFleetDistribution[];
  risk_distribution: ApiMobileFleetDistribution[];
  recommendations_by_department: ApiMobileFleetDepartmentRecommendation[];
  top_recommendations: ApiMobileFleetRecommendation[];
}

export interface ApiCustomerChurnKpi {
  total_customers: number;
  actual_churn_customers: number;
  churn_rate_pct: number;
  high_risk_customers: number;
  loyal_customers: number;
  revenue_at_risk_mad: number;
  average_risk_score: number;
  average_tenure_months: number;
  average_monthly_revenue_mad: number;
}

export interface ApiCustomerChurnBreakdown {
  label: string;
  total_customers: number;
  actual_churn_customers: number;
  predicted_high_risk_customers: number;
  churn_rate_pct: number;
  revenue_at_risk_mad: number;
  average_risk_score: number;
}

export interface ApiCustomerChurnCustomer extends ApiAIRiskInsightFields {
  customer_row_id: number;
  customer_id: string;
  operator: string;
  department: string;
  gender: string;
  senior_citizen: boolean;
  partner: boolean;
  dependents: boolean;
  tenure: number;
  tenure_group: string;
  contract: string;
  payment_method: string;
  internet_service: string;
  monthly_charges: number;
  total_charges: number;
  monthly_cost_mad: number;
  total_cost_mad: number;
  plan: string;
  price_range_label: string;
  roaming_flag: boolean;
  data_usage_gb: number;
  quota_gb: number;
  over_quota_flag: boolean;
  anomaly_flag: boolean;
  risk_proba: number;
  risk_score_100: number;
  risk_level: string;
  actual_churn: boolean;
  predicted_churn: boolean;
  recommendation: string;
}

export interface ApiCustomerChurnPrediction extends ApiCustomerChurnCustomer {
  future_cost_mad: number;
  future_cost_pred_mad: number;
  revenue_at_risk_mad: number;
  key_factors: string[];
}

export interface ApiCustomerChurnRecommendation extends ApiCustomerChurnPrediction {
  recommendation_reason: string;
}

export interface ApiCustomerChurnCustomerList {
  total: number;
  offset: number;
  limit: number;
  items: ApiCustomerChurnCustomer[];
}

export interface ApiCustomerChurnPredictionList {
  total: number;
  offset: number;
  limit: number;
  items: ApiCustomerChurnPrediction[];
}

export interface ApiCustomerChurnRecommendationList {
  total: number;
  offset: number;
  limit: number;
  items: ApiCustomerChurnRecommendation[];
}

export interface ApiCustomerChurnFilters {
  operators: string[];
  departments: string[];
  contracts: string[];
  payment_methods: string[];
  internet_services: string[];
  plans: string[];
  risk_levels: string[];
  tenure_groups: string[];
  price_ranges: string[];
  churn_statuses: string[];
  prediction_statuses: string[];
}

export interface ApiCustomerChurnOverview {
  kpis: ApiCustomerChurnKpi;
  churn_by_contract: ApiCustomerChurnBreakdown[];
  churn_by_internet_service: ApiCustomerChurnBreakdown[];
  churn_by_price_range: ApiCustomerChurnBreakdown[];
  risk_by_department: ApiCustomerChurnBreakdown[];
  top_at_risk_customers: ApiCustomerChurnPrediction[];
}

export interface ApiCustomerChurnReports {
  kpis: ApiCustomerChurnKpi;
  churn_by_contract: ApiCustomerChurnBreakdown[];
  churn_by_internet_service: ApiCustomerChurnBreakdown[];
  churn_by_price_range: ApiCustomerChurnBreakdown[];
  risk_by_department: ApiCustomerChurnBreakdown[];
  top_revenue_at_risk: ApiCustomerChurnRecommendation[];
}

export interface ApiCustomerChurnConsumptionKpi {
  total_lines: number;
  total_monthly_cost_mad: number;
  total_future_cost_mad: number;
  total_future_cost_pred_mad: number;
  total_data_usage_gb: number;
  average_data_usage_gb: number;
  average_quota_gb: number;
  over_quota_lines: number;
  roaming_lines: number;
  anomaly_lines: number;
  high_risk_lines: number;
  average_risk_score: number;
}

export interface ApiCustomerChurnConsumptionBreakdown {
  label: string;
  line_count: number;
  total_monthly_cost_mad: number;
  total_future_cost_mad: number;
  total_data_usage_gb: number;
  over_quota_lines: number;
  anomaly_lines: number;
  average_risk_score: number;
}

export interface ApiCustomerChurnConsumption {
  kpis: ApiCustomerChurnConsumptionKpi;
  cost_by_operator: ApiCustomerChurnConsumptionBreakdown[];
  cost_by_department: ApiCustomerChurnConsumptionBreakdown[];
  usage_by_department: ApiCustomerChurnConsumptionBreakdown[];
  top_consumers: ApiCustomerChurnPrediction[];
  priority_lines: ApiCustomerChurnPrediction[];
}

export interface ApiPlan {
  id: number;
  name: string;
  operator_name: string;
  monthly_price: number;
  voice_quota: string;
  data_quota: string;
  sms_quota: string;
  roaming_zone: string;
  active_lines: number;
  activation_status: "pending" | "active" | "suspended" | "inactive";
  activated_at: string | null;
  activated_by_user_id: number | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface ActivatePlanPayload {
  plan_id: number;
  phone_line_id?: number;
}

export interface ApiPlanActivationResponse {
  action: string;
  message: string;
  activated_at: string;
  activated_by_user_id: number;
  activated_by_name: string;
  plan: ApiPlan;
  phone_line: ApiPhoneLine | null;
}

export interface ApiPlanLifecycleImpact {
  impacted_lines: number;
  actual_linked_lines: number;
  estimated_monthly_cost_mad: number;
  coverage_impact_label: string;
  coverage_impact_summary: string;
  can_deactivate: boolean;
  requires_reassignment: boolean;
  is_critical: boolean;
  blocking_reason: string | null;
  recommended_replacement_plan_id: number | null;
  recommended_replacement_plan_name: string | null;
  recommended_monthly_savings_mad: number | null;
  ai_recommendation: string | null;
}

export interface ApiPlanDeactivationResponse {
  action: string;
  message: string;
  deactivated_at: string;
  deactivated_by_user_id: number;
  deactivated_by_name: string;
  plan: ApiPlan;
  impact: ApiPlanLifecycleImpact;
}

export interface ReplacePlanPayload {
  replacement_plan_id: number;
}

export interface ApiPlanReplacementResponse {
  action: string;
  message: string;
  replaced_at: string;
  replaced_by_user_id: number;
  replaced_by_name: string;
  previous_plan: ApiPlan;
  replacement_plan: ApiPlan;
  impact: ApiPlanLifecycleImpact;
  reassigned_lines: number;
}

export type ApiFleetResourceType =
  | "phone_line"
  | "mobile_phone"
  | "tablet"
  | "laptop"
  | "internet_connection";
export type ApiFleetResourceStatus = "available" | "assigned" | "suspended" | "restricted";
export type ApiResourceAssignmentStatus = "active" | "revoked" | "suspended";
export type ApiUsagePolicyMode = "professional_only" | "mixed_limited" | "controlled_free";
export type ApiUsageComplianceStatus = "compliant" | "under_monitoring" | "non_compliant" | "blocked";
export type ApiUsageSeverity = "warning" | "moderate" | "critical";
export type ApiComplianceAlertStatus = "open" | "acknowledged" | "resolved";

export interface ApiDepartment {
  id: number;
  name: string;
  code: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type ApiImportedEmployeeStatus = "active" | "inactive" | "suspended";

export interface ApiImportedEmployee {
  id: number;
  full_name: string;
  identity_key: string;
  email: string | null;
  employee_identifier: string | null;
  employee_code: string | null;
  department_name: string | null;
  job_profile: string | null;
  status: ApiImportedEmployeeStatus;
  source_filename: string | null;
  source_format: "csv" | "xlsx" | null;
  created_at: string;
  updated_at: string;
}

export interface ApiImportedEmployeeList {
  total: number;
  offset: number;
  limit: number;
  items: ApiImportedEmployee[];
}

export interface ApiEmployeeImportRecognizedColumn {
  field_name: string;
  source_column: string;
}

export type ApiEmployeeImportRowStatus = "importable" | "incomplete" | "error";
export type ApiEmployeeImportIssueSeverity = "warning" | "error";
export type ApiEmployeeImportMappingConfidence = "none" | "high" | "manual";
export type ApiEmployeeImportSuggestionAction =
  | "apply_default_value"
  | "auto_fix"
  | "review_mapping"
  | "complete_after_import"
  | "none";

export interface ApiEmployeeImportIssue {
  code: string;
  severity: ApiEmployeeImportIssueSeverity;
  message: string;
  field_name: string | null;
  fixable: boolean;
}

export interface ApiEmployeeImportFieldMapping {
  field_name: string;
  label: string;
  source_column: string | null;
  required: boolean;
  confidence: ApiEmployeeImportMappingConfidence;
  manually_assigned: boolean;
  suggested_columns: string[];
  helper_text: string | null;
}

export interface ApiEmployeeImportSuggestion {
  id: string;
  title: string;
  description: string;
  action_label: string | null;
  action_type: ApiEmployeeImportSuggestionAction;
  target_field: string | null;
  suggested_value: string | null;
  affected_rows: number;
}

export interface ApiEmployeeImportPreviewRow {
  row_number: number;
  full_name: string | null;
  email: string | null;
  employee_identifier: string | null;
  employee_code: string | null;
  department_name: string | null;
  job_profile: string | null;
  status: ApiImportedEmployeeStatus;
  row_status: ApiEmployeeImportRowStatus;
  issues: ApiEmployeeImportIssue[];
  errors: string[];
  duplicate_reason: string | null;
}

export interface ApiEmployeeImportRowOverride {
  row_number: number;
  full_name?: string | null;
  email?: string | null;
  department_name?: string | null;
  job_profile?: string | null;
  employee_identifier?: string | null;
  employee_code?: string | null;
  status?: ApiImportedEmployeeStatus | null;
}

export interface ApiEmployeeImportOptions {
  mapping_overrides?: Record<string, string | null>;
  row_overrides?: ApiEmployeeImportRowOverride[];
  default_values?: Record<string, string | null>;
  auto_fix_enabled?: boolean;
}

export interface ApiEmployeeImportPreview {
  file_name: string;
  detected_format: "csv" | "xlsx";
  total_rows: number;
  valid_rows: number;
  ready_rows: number;
  incomplete_rows: number;
  invalid_rows: number;
  duplicate_rows: number;
  error_rows: number;
  quality_score: number;
  anomalies_count: number;
  fixable_anomalies: number;
  global_notice: string | null;
  recognized_columns: ApiEmployeeImportRecognizedColumn[];
  available_columns: string[];
  field_mappings: ApiEmployeeImportFieldMapping[];
  missing_required_fields: string[];
  warnings: string[];
  suggestions: ApiEmployeeImportSuggestion[];
  preview_rows: ApiEmployeeImportPreviewRow[];
}

export interface ApiEmployeeImportSummary {
  file_name: string;
  detected_format: "csv" | "xlsx";
  total_rows: number;
  imported_count: number;
  incomplete_count: number;
  skipped_count: number;
  duplicate_count: number;
  invalid_count: number;
  rejected_count: number;
  quality_score: number;
  recognized_columns: ApiEmployeeImportRecognizedColumn[];
  warnings: string[];
}

export interface CreateDepartmentPayload {
  name: string;
  code: string;
  description?: string | null;
  is_active?: boolean;
}

export interface UpdateDepartmentPayload {
  name?: string;
  code?: string;
  description?: string | null;
  is_active?: boolean;
}

export interface ApiFleetResource {
  id: number;
  resource_type: ApiFleetResourceType;
  identifier: string;
  label: string;
  status: ApiFleetResourceStatus;
  department_id: number | null;
  department_name: string | null;
  is_premium: boolean;
  is_shareable: boolean;
  max_assignments: number;
  authorized_profiles: string[];
  access_blocked_until: string | null;
  restriction_reason: string | null;
  notes: string | null;
  active_assignment_count: number;
  available_assignment_slots: number;
  active_assignments: ApiResourceActiveAssignment[];
  assigned_user_id: number | null;
  assigned_user_name: string | null;
  assigned_user_email: string | null;
  current_assignment_id: number | null;
  usage_policy_mode: ApiUsagePolicyMode;
  usage_compliance_score: number;
  usage_compliance_status: ApiUsageComplianceStatus;
  usage_open_alert_count: number;
  usage_last_incident_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApiResourceActiveAssignment {
  id: number;
  user_id: number;
  user_name: string;
  user_email: string;
  department_id: number | null;
  department_name: string | null;
  status: ApiResourceAssignmentStatus;
  assignment_reason: string | null;
  assigned_by_id: number | null;
  assigned_by_name: string | null;
  assigned_at: string;
  start_date: string;
  end_date: string | null;
  notes: string | null;
}

export interface ApiResourceAssignment {
  id: number;
  resource_id: number;
  resource_label: string;
  resource_identifier: string;
  resource_type: ApiFleetResourceType;
  user_id: number;
  user_name: string;
  user_email: string;
  department_id: number | null;
  department_name: string | null;
  status: ApiResourceAssignmentStatus;
  assignment_reason: string | null;
  reason: string | null;
  revoke_reason: string | null;
  assigned_by_id: number | null;
  assigned_by_name: string | null;
  assigned_by_email: string | null;
  revoked_by_id: number | null;
  revoked_by_name: string | null;
  revoked_by_email: string | null;
  assigned_at: string;
  start_date: string;
  end_date: string | null;
  notes: string | null;
  revoked_at: string | null;
}

export interface ApiFleetAccessAuditLog {
  id: number;
  action: string;
  actor_user_id: number | null;
  actor_user_name: string | null;
  target_user_id: number | null;
  target_user_name: string | null;
  resource_id: number | null;
  resource_label: string | null;
  assignment_id: number | null;
  reason: string | null;
  metadata_json: Record<string, unknown>;
  occurred_at: string;
}

export interface ApiResourceRestriction {
  id: number;
  policy_id: number;
  category: string;
  action: "allow" | "alert" | "block";
  severity: ApiUsageSeverity;
  exception_roles: string[];
  exception_department_ids: number[];
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ApiResourceRestrictionPayload {
  category: string;
  action: "allow" | "alert" | "block";
  severity: ApiUsageSeverity;
  exception_roles: string[];
  exception_department_ids: number[];
  notes?: string | null;
  is_active: boolean;
}

export interface ApiResourceUsagePolicy {
  id: number;
  resource_id: number;
  policy_mode: ApiUsagePolicyMode;
  acceptable_use_rules: string;
  security_level: "standard" | "sensitive" | "critical";
  allowed_activity_categories: string[];
  restricted_activity_categories: string[];
  exception_roles: string[];
  exception_department_ids: number[];
  monitoring_enabled: boolean;
  auto_alert_enabled: boolean;
  auto_suspend_on_critical: boolean;
  compliance_threshold: number;
  created_by_id: number | null;
  updated_by_id: number | null;
  created_at: string | null;
  updated_at: string | null;
  restrictions: ApiResourceRestriction[];
}

export interface ApiResourceUsagePolicyPayload {
  policy_mode: ApiUsagePolicyMode;
  acceptable_use_rules: string;
  security_level: "standard" | "sensitive" | "critical";
  allowed_activity_categories: string[];
  restricted_activity_categories: string[];
  exception_roles: string[];
  exception_department_ids: number[];
  monitoring_enabled: boolean;
  auto_alert_enabled: boolean;
  auto_suspend_on_critical: boolean;
  compliance_threshold: number;
  restrictions: ApiResourceRestrictionPayload[];
}

export interface ApiUsageLog {
  id: number;
  resource_id: number;
  resource_label: string;
  user_id: number;
  user_name: string;
  assignment_id: number | null;
  activity_type: string;
  activity_category: string;
  activity_label: string | null;
  usage_volume_mb: number | null;
  duration_minutes: number | null;
  occurred_at: string;
  is_compliant: boolean;
  policy_action: "allow" | "alert" | "block";
  severity: ApiUsageSeverity | null;
  violation_reason: string | null;
  evaluated_policy_id: number | null;
  metadata_json: Record<string, unknown>;
  created_at: string;
}

export interface ApiUsageLogPayload {
  user_id?: number | null;
  assignment_id?: number | null;
  activity_type: string;
  activity_category: string;
  activity_label?: string | null;
  usage_volume_mb?: number | null;
  duration_minutes?: number | null;
  occurred_at?: string | null;
  metadata_json?: Record<string, unknown>;
}

export interface ApiComplianceAlert extends ApiAIRiskInsightFields {
  id: number;
  resource_id: number;
  resource_label: string;
  resource_identifier: string;
  user_id: number;
  user_name: string;
  user_email: string;
  department_id: number | null;
  department_name: string | null;
  usage_log_id: number | null;
  policy_id: number | null;
  severity: ApiUsageSeverity;
  status: ApiComplianceAlertStatus;
  title: string;
  description: string;
  recommended_action: string | null;
  created_at: string;
  acknowledged_at: string | null;
  acknowledged_by_id: number | null;
  resolved_at: string | null;
  resolved_by_id: number | null;
  resolution_notes: string | null;
}

export interface ApiResourceComplianceOverview {
  resource_id: number;
  resource_label: string;
  compliance_score: number;
  compliance_status: ApiUsageComplianceStatus;
  policy: ApiResourceUsagePolicy;
  usage_log_count: number;
  compliant_log_count: number;
  non_compliant_log_count: number;
  open_alert_count: number;
  critical_alert_count: number;
  last_incident_at: string | null;
  recommendations: string[];
  recent_logs: ApiUsageLog[];
  recent_alerts: ApiComplianceAlert[];
}

export interface CreateFleetResourcePayload {
  resource_type: ApiFleetResourceType;
  identifier: string;
  label: string;
  department_id?: number | null;
  is_premium: boolean;
  is_shareable: boolean;
  max_assignments: number;
  authorized_profiles: string[];
  notes?: string | null;
}

export interface AssignResourcePayload {
  user_id: number;
  assignment_reason?: string | null;
  reason?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  notes?: string | null;
}

export interface AssignResourceUsersPayload {
  user_ids: number[];
  assignment_reason?: string | null;
  reason?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  notes?: string | null;
}

export interface AssignUserResourcesPayload {
  resource_ids: number[];
  assignment_reason?: string | null;
  reason?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  notes?: string | null;
}

export interface RevokeResourcePayload {
  reason?: string | null;
}

export interface BlockResourcePayload {
  status: "suspended" | "restricted";
  reason: string;
  blocked_until?: string | null;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterPayload {
  full_name: string;
  email: string;
  password: string;
  photo_url?: string | null;
  role: string;
}

export interface AcceptInvitationPayload {
  token: string;
  password: string;
  phone?: string | null;
}

export interface AcceptInvitationResponse {
  message: string;
  company_name: string;
}

export interface InvitationValidationResponse {
  company_name: string;
  full_name: string;
  email: string;
  phone: string | null;
  department: string;
  job_title: string;
  role: ApiUserRole;
  expires_at: string;
}

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  access_token_expires_in: number;
  refresh_token_expires_in: number;
  user: ApiUser;
}

export interface MessageResponse {
  message: string;
}

export interface CreateUserPayload {
  full_name: string;
  email: string;
  password: string;
  photo_url?: string | null;
  phone?: string | null;
  role: ApiUserRole;
  department_id?: number | null;
  requested_department?: string | null;
  job_profile?: string | null;
  is_active: boolean;
  account_status?: ApiUserStatus | null;
}

export interface UpdateUserPayload {
  full_name?: string;
  email?: string;
  password?: string | null;
  photo_url?: string | null;
  phone?: string | null;
  role?: ApiUserRole;
  department_id?: number | null;
  requested_department?: string | null;
  job_profile?: string | null;
  is_active?: boolean;
  account_status?: ApiUserStatus | null;
}

export interface ListUsersParams {
  offset?: number;
  limit?: number;
  search?: string;
  role?: ApiUserRole;
  status?: ApiUserStatus;
  department_id?: number;
}

export interface ChangeUserRolePayload {
  role: ApiUserRole;
}

export interface SetUserStatusPayload {
  status: ApiUserStatus;
}

export interface CreateUserInvitationPayload {
  full_name: string;
  email: string;
  phone?: string | null;
  department: string;
  job_title: string;
  expiration: ApiInvitationExpiration;
}

export interface ApiUserInvitation {
  id: number;
  full_name: string;
  email: string;
  phone: string | null;
  department: string;
  role: string;
  job_title: string;
  expiration_date: string | null;
  status: ApiInvitationStatus;
  created_at: string;
  created_by_id: number | null;
  created_by_name: string | null;
  invitation_url: string;
}

export interface ApiUserInvitationActionResponse {
  code: ApiUserInvitationActionCode;
  message: string;
  invitation: ApiUserInvitation;
}

export interface CreatePhoneLinePayload {
  phone_number: string;
  operator_name: string;
  plan_name: string;
  assigned_to?: string | null;
  contact_email?: string | null;
  department?: string | null;
  status?: string;
  monthly_limit?: number | null;
  current_data_usage_gb?: number | null;
  previous_data_usage_gb?: number | null;
  notes?: string | null;
}

export interface UpdatePhoneLinePayload {
  phone_number?: string;
  operator_name?: string;
  plan_name?: string;
  assigned_to?: string | null;
  contact_email?: string | null;
  department?: string | null;
  status?: string;
  monthly_limit?: number | null;
  current_data_usage_gb?: number | null;
  previous_data_usage_gb?: number | null;
  notes?: string | null;
}

export interface CreatePlanPayload {
  name: string;
  operator_name: string;
  monthly_price: number;
  voice_quota: string;
  data_quota: string;
  sms_quota: string;
  roaming_zone: string;
  active_lines: number;
  description?: string | null;
}

export interface UpdatePlanPayload {
  name?: string;
  operator_name?: string;
  monthly_price?: number;
  voice_quota?: string;
  data_quota?: string;
  sms_quota?: string;
  roaming_zone?: string;
  active_lines?: number;
  description?: string | null;
}

export interface ForgotPasswordPayload {
  email: string;
}

export interface ForgotPasswordResponse {
  message: string;
  reset_token: string;
  expires_in_seconds: number;
}

export interface ApiOAuthProviderStatus {
  configured: boolean;
}

export interface ApiOAuthProvidersStatus {
  google: ApiOAuthProviderStatus;
  microsoft: ApiOAuthProviderStatus;
}

export interface ApiChatContextMessage {
  role: "assistant" | "user";
  text: string;
}

export interface ApiChatRequest {
  question: string;
  conversation_id?: string | null;
  history?: ApiChatContextMessage[];
  analysis_mode?: ApiImageAnalysisMode;
}

export interface ApiChatResponse {
  answer: string;
  model: string;
  title_hint: string | null;
  sources: string[];
  summary_updated_at: string;
  cached: boolean;
  fallback_used: boolean;
  duration_ms: number | null;
}

export interface ApiChatActionPlanItem {
  day: string;
  title: string;
  detail: string;
  priority: "low" | "medium" | "high" | "critical";
  reason: string;
  impact: string;
  deadline: string;
  type: "cost" | "fraud" | "equipment" | "workflow" | "consumption";
  status: "todo" | "in_progress" | "done";
}

export interface ApiChatActionPlanResponse extends ApiChatResponse {
  plan_title: string;
  subtitle: string;
  fleet_health_score?: number | null;
  global_risk?: "low" | "medium" | "high" | "critical" | null;
  trend?: "improving" | "stable" | "declining" | null;
  actions: ApiChatActionPlanItem[];
  weekly_actions: ApiChatActionPlanItem[];
  recommendations: string[];
}

export interface ApiChatImageResponse extends ApiChatResponse {
  image_type: string;
  ocr_text: string;
  vision_analysis: string;
  analysis_mode: ApiImageAnalysisMode;
  analysis_status: "success" | "fallback";
  advanced_analysis_available: boolean;
  advanced_analysis_completed: boolean;
  processing_message?: string | null;
  processing_notices?: string[];
  error_type?: string | null;
  fallback_answer?: string | null;
  detected_kpis: string[];
  recommendations: string[];
  decision_recommendations?: Array<{
    title: string;
    priority: "low" | "medium" | "high" | "critical";
    impact: string;
    estimated_saving?: string | null;
    reason: string;
  }>;
  recommendation_notice?: string | null;
  risk_level?: "low" | "medium" | "high" | "critical" | null;
  optimization_score?: number | null;
  anomaly_score?: number | null;
  fraud_score?: number | null;
  cost_score?: number | null;
  confidence: number;
  ocr_confidence?: number | null;
  detected_operator?: string | null;
  detected_anomalies?: string[];
  analysis_metadata?: {
    source_mode: string;
    visible_kpis_used: string[];
    blocked_global_context: boolean;
    removed_unverified_claims: string[];
    filtered_numbers: string[];
    confidence_score: number;
  } | null;
  invoice_details?: {
    operator?: string | null;
    invoice_number?: string | null;
    invoice_date?: string | null;
    billing_period?: string | null;
    amount_ht_mad?: string | null;
    vat_amount_mad?: string | null;
    amount_ttc_mad?: string | null;
    total_amount_mad?: string | null;
    billed_lines?: string[];
    additional_fees?: string[];
    overage_items?: string[];
    anomalies?: string[];
  } | null;
  incident_details?: {
    alert_type?: string | null;
    severity?: string | null;
    detected_at?: string | null;
    operator?: string | null;
    line_reference?: string | null;
    suspect_cost_mad?: string | null;
    call_volume?: string | null;
    data_overage?: string | null;
    error_message?: string | null;
    priority?: string | null;
    summary?: string | null;
    critical_alert_count?: number | null;
    exposure_rate?: string | null;
    exposure_rate_pct?: number | null;
    financial_impact_mad?: string | null;
    financial_impact_value_mad?: number | null;
    average_score?: string | null;
    average_score_value?: number | null;
    risk_score?: string | null;
    max_risk_scores?: string[];
    risky_entities?: string[];
    repeated_anomalies?: string[];
    visible_statuses?: string[];
    critical_signals?: string[];
    probable_causes?: string[];
  } | null;
  alert_intelligence?: {
    alert_family?: string | null;
    ai_risk_score?: number | null;
    ocr_confidence_score?: number | null;
    criticity?: "low" | "medium" | "high" | "critical" | null;
    executive_summary?: string | null;
    business_risk?: string | null;
    financial_exposure_mad?: string | null;
    potential_loss_mad?: string | null;
    possible_savings_mad?: string | null;
    priority_kpis?: string[];
    visible_evidence?: string[];
    at_risk_entities?: string[];
    immediate_actions?: string[];
    recommended_controls?: string[];
    alert_timeline?: Array<{
      label: string;
      detail: string;
      status?: "observed" | "watch" | "critical" | "action";
    }>;
    audit_focus?: string | null;
  } | null;
  workflow_details?: {
    workflow_type?: string | null;
    complexity_score?: number | null;
    complexity_level?: "low" | "medium" | "high" | "critical" | null;
    critical_steps?: string[];
    detected_departments?: string[];
    detected_roles?: string[];
    automation_opportunities?: string[];
    bottlenecks?: string[];
    repeated_validations?: string[];
    summary?: string | null;
  } | null;
  equipment_details?: {
    equipment_type?: string | null;
    brand?: string | null;
    model?: string | null;
    serial_number?: string | null;
    operator?: string | null;
    visible_condition?: string | null;
    device_version?: string | null;
    sim_information?: string | null;
    label_information?: string | null;
    usage_summary?: string | null;
    detected_issues?: string[];
    maintenance_recommendations?: string[];
    replacement_needed?: boolean;
    condition_score?: number | null;
    criticality_score?: number | null;
    obsolescence_score?: number | null;
    maintenance_score?: number | null;
    summary?: string | null;
  } | null;
  highlighted_image?: string | null;
  annotations?: Array<{
    label: string;
    type: string;
    bbox: [number, number, number, number] | number[];
    confidence: number;
  }>;
}

export interface ApiExecutiveReportImageContext {
  image_type: string;
  detected_operator?: string | null;
  detected_kpis?: string[];
  detected_anomalies?: string[];
  recommendations?: string[];
  decision_recommendations?: Array<{
    title: string;
    priority: "low" | "medium" | "high" | "critical";
    impact: string;
    estimated_saving?: string | null;
    reason: string;
  }>;
  risk_level?: "low" | "medium" | "high" | "critical" | null;
  optimization_score?: number | null;
  anomaly_score?: number | null;
  fraud_score?: number | null;
  cost_score?: number | null;
  invoice_details?: ApiChatImageResponse["invoice_details"];
  incident_details?: ApiChatImageResponse["incident_details"];
  workflow_details?: ApiChatImageResponse["workflow_details"];
  equipment_details?: ApiChatImageResponse["equipment_details"];
}

export interface ApiExecutiveReportRequest {
  conversation_id?: string | null;
  history?: ApiChatContextMessage[];
  image_analyses?: ApiExecutiveReportImageContext[];
}

export interface ApiExecutiveReportScoreExplanation {
  label: string;
  score: number;
  level: "excellent" | "bon" | "moyen" | "critique";
  direction: "higher_is_better" | "higher_is_worse";
  explanation: string;
}

export interface ApiExecutiveReportCostItem {
  title: string;
  amount_mad: number;
  category: string;
  owner?: string | null;
  reason: string;
}

export interface ApiExecutiveReportDepartmentItem {
  department: string;
  risk_score: number;
  monthly_cost_mad?: number | null;
  alert_count: number;
  reason: string;
}

export interface ApiExecutiveReportOperatorItem {
  operator: string;
  total_cost_mad: number;
  suspicious_calls: number;
  roaming_lines: number;
  reason: string;
}

export interface ApiExecutiveReportAnomalyItem {
  title: string;
  severity: "low" | "medium" | "high" | "critical";
  source: string;
  reason: string;
}

export interface ApiExecutiveReportFraudSignalItem {
  title: string;
  severity: "low" | "medium" | "high" | "critical";
  operator?: string | null;
  department?: string | null;
  estimated_exposure_mad?: number | null;
  reason: string;
}

export interface ApiExecutiveReportOpportunityItem {
  title: string;
  estimated_saving_mad?: number | null;
  justification: string;
}

export interface ApiExecutiveReportRecommendationItem {
  title: string;
  priority: "low" | "medium" | "high" | "critical";
  justification: string;
  action: string;
  estimated_saving_mad?: number | null;
}

export interface ApiExecutiveReportChartPoint {
  label: string;
  value: number;
  secondary_value?: number | null;
}

export interface ApiExecutiveReportCharts {
  cost_evolution: ApiExecutiveReportChartPoint[];
  department_risk: ApiExecutiveReportChartPoint[];
  operator_costs: ApiExecutiveReportChartPoint[];
  score_breakdown: ApiExecutiveReportChartPoint[];
}

export interface ApiExecutiveReportResponse {
  executive_summary: string;
  fleet_health_score: number;
  fleet_health_level: "excellent" | "bon" | "moyen" | "critique";
  risk_level: "low" | "medium" | "high" | "critical";
  risk_score: number;
  fraud_score: number;
  optimization_score: number;
  anomaly_score: number;
  equipment_score: number;
  critical_costs: ApiExecutiveReportCostItem[];
  high_risk_departments: ApiExecutiveReportDepartmentItem[];
  costly_operators: ApiExecutiveReportOperatorItem[];
  major_anomalies: ApiExecutiveReportAnomalyItem[];
  fraud_signals: ApiExecutiveReportFraudSignalItem[];
  priority_risks: string[];
  optimization_opportunities: ApiExecutiveReportOpportunityItem[];
  top_recommendations: ApiExecutiveReportRecommendationItem[];
  estimated_savings: string;
  estimated_savings_mad: number;
  multimodal_highlights: string[];
  multimodal_analysis_count: number;
  score_explanations: ApiExecutiveReportScoreExplanation[];
  charts: ApiExecutiveReportCharts;
  model: string;
  sources: string[];
  summary_updated_at: string;
  cached: boolean;
  fallback_used: boolean;
  duration_ms: number | null;
}

export interface ApiExplainabilityExecutiveContext {
  executive_summary: string;
  fleet_health_score?: number | null;
  risk_level?: "low" | "medium" | "high" | "critical" | null;
  risk_score?: number | null;
  fraud_score?: number | null;
  optimization_score?: number | null;
  anomaly_score?: number | null;
  equipment_score?: number | null;
  estimated_savings?: string | null;
  critical_costs?: ApiExecutiveReportCostItem[];
  high_risk_departments?: ApiExecutiveReportDepartmentItem[];
  costly_operators?: ApiExecutiveReportOperatorItem[];
  major_anomalies?: ApiExecutiveReportAnomalyItem[];
  fraud_signals?: ApiExecutiveReportFraudSignalItem[];
  priority_risks?: string[];
  top_recommendations?: ApiExecutiveReportRecommendationItem[];
  score_explanations?: ApiExecutiveReportScoreExplanation[];
  sources?: string[];
  summary_updated_at?: string | null;
}

export interface ApiExplainabilityRequest {
  question: string;
  focus_label?: string | null;
  conversation_id?: string | null;
  history?: ApiChatContextMessage[];
  message_text?: string | null;
  image_analysis?: ApiExecutiveReportImageContext | null;
  executive_report?: ApiExplainabilityExecutiveContext | null;
  use_live_context?: boolean;
}

export interface ApiExplainabilityFactor {
  label: string;
  category: string;
  value: string;
  impact_score: number;
  severity: "low" | "medium" | "high" | "critical";
  evidence: string;
}

export interface ApiExplainabilityCriticalZone {
  label: string;
  zone_type: string;
  severity: "low" | "medium" | "high" | "critical";
  detail: string;
  value?: string | null;
}

export interface ApiExplainabilityGraphNode {
  node_id: string;
  label: string;
  node_type: "signal" | "cause" | "decision" | "impact" | "zone";
  severity: "low" | "medium" | "high" | "critical";
  weight: number;
}

export interface ApiExplainabilityGraphEdge {
  source: string;
  target: string;
  relation: string;
}

export interface ApiExplainabilityGraph {
  summary: string;
  dominant_factor?: string | null;
  nodes: ApiExplainabilityGraphNode[];
  edges: ApiExplainabilityGraphEdge[];
}

export interface ApiExplainabilityCharts {
  factor_breakdown: ApiExecutiveReportChartPoint[];
  risk_timeline: ApiExecutiveReportChartPoint[];
  critical_zone_heatmap: ApiExecutiveReportChartPoint[];
  score_radar: ApiExecutiveReportChartPoint[];
}

export interface ApiExplainabilityResponse {
  answer: string;
  confidence: number;
  risk_level: "low" | "medium" | "high" | "critical";
  reasoning: string[];
  causes: string[];
  influencing_factors: ApiExplainabilityFactor[];
  explanation_graph: ApiExplainabilityGraph;
  critical_zones: ApiExplainabilityCriticalZone[];
  recommendations: string[];
  data_points_used: string[];
  confidence_score: number;
  fraud_score: number;
  anomaly_score: number;
  optimization_score: number;
  risk_score: number;
  equipment_score: number;
  charts: ApiExplainabilityCharts;
  model: string;
  sources: string[];
  summary_updated_at: string;
  cached: boolean;
  fallback_used: boolean;
  duration_ms: number | null;
}

export type ApiReportType =
  | "executive"
  | "anomalies"
  | "fraud"
  | "equipment"
  | "workflow"
  | "cost_optimization"
  | "live"
  | "complete";

export interface ApiReportExportImage {
  title: string;
  src: string;
  caption?: string | null;
}

export interface ApiReportGenerateRequest {
  report_type: ApiReportType;
  conversation_id?: string | null;
  history?: ApiChatContextMessage[];
  image_analyses?: ApiExecutiveReportImageContext[];
  executive_report?: ApiExecutiveReportResponse | null;
  explainability?: ApiExplainabilityResponse | null;
  images?: ApiReportExportImage[];
}

export interface ApiReportGenerateResponse {
  report_id: string;
  pdf_url: string;
  generated_at: string;
  report_type: ApiReportType;
  fleet_health_score: number;
}

export interface ApiHealthCheck {
  status: "ok" | "degraded" | "error";
  message: string;
  details: Record<string, unknown>;
}

export interface ApiHealthResponse {
  status: "ok" | "degraded" | "error";
  app_name: string;
  environment: string;
  version: string;
  timestamp: string;
  checks: {
    backend: ApiHealthCheck;
    database: ApiHealthCheck;
    ollama: ApiHealthCheck;
    csv: ApiHealthCheck;
    websocket: ApiHealthCheck;
  };
}

export interface ApiLiveMonitoringStatus {
  active: boolean;
  mode: "simulation" | "hybrid";
  monitoring_label: string;
  connected_clients: number;
  latest_tick: number;
  latest_tick_at: string;
  simulator_enabled: boolean;
  websocket_path: string;
}

export interface ApiLiveAlert {
  alert_id: string;
  title: string;
  severity: "low" | "medium" | "high" | "critical";
  category: string;
  message: string;
  recommendation: string;
  detected_at: string;
  score: number;
  department?: string | null;
  operator?: string | null;
  equipment_label?: string | null;
  delta_pct?: number | null;
  estimated_cost_mad?: number | null;
}

export interface ApiLiveDepartment {
  department: string;
  risk_score: number;
  live_cost_mad: number;
  delta_pct: number;
  alert_count: number;
  roaming_pct: number;
}

export interface ApiLiveOperator {
  operator: string;
  live_cost_mad: number;
  anomaly_score: number;
  roaming_cost_mad: number;
  suspicious_calls: number;
  delta_pct: number;
}

export interface ApiLiveEquipment {
  label: string;
  site?: string | null;
  health_score: number;
  temperature_c: number;
  severity: "low" | "medium" | "high" | "critical";
  issue: string;
}

export interface ApiLiveWorkflow {
  name: string;
  criticality_score: number;
  waiting_steps: number;
  bottleneck: string;
}

export interface ApiLiveChartPoint {
  label: string;
  value: number;
  secondary_value?: number | null;
}

export interface ApiLiveMonitoringSnapshot {
  generated_at: string;
  tick: number;
  mode: "simulation" | "hybrid";
  active: boolean;
  monitoring_label: string;
  executive_summary: string;
  fleet_health_score: number;
  risk_score: number;
  fraud_score: number;
  optimization_score: number;
  equipment_score: number;
  live_cost_mad: number;
  live_cost_delta_pct: number;
  data_consumption_tb: number;
  data_delta_pct: number;
  roaming_cost_mad: number;
  suspicious_calls: number;
  fraud_exposure_mad: number;
  overage_lines: number;
  inactive_lines: number;
  equipment_alerts: number;
  workflow_critical_count: number;
  operator_anomaly_count: number;
  source_status: string[];
  recommendations: string[];
  priority_alerts: ApiLiveAlert[];
  recent_alerts: ApiLiveAlert[];
  top_departments: ApiLiveDepartment[];
  top_operators: ApiLiveOperator[];
  critical_equipments: ApiLiveEquipment[];
  critical_workflows: ApiLiveWorkflow[];
  cost_series: ApiLiveChartPoint[];
  risk_series: ApiLiveChartPoint[];
  alerts_series: ApiLiveChartPoint[];
  operator_heatmap: ApiLiveChartPoint[];
}

export interface ApiChatStreamMeta {
  model: string;
  summary_updated_at: string;
  sources: string[];
}

export interface ApiChatStreamCallbacks {
  onMeta?: (meta: ApiChatStreamMeta) => void;
  onToken?: (chunk: string) => void;
  onDone?: (response: ApiChatResponse) => void;
  onError?: (error: ApiChatErrorResponse) => void;
  signal?: AbortSignal;
}

export interface ApiVoiceTranscriptionResponse {
  success?: boolean;
  text?: string;
  transcript: string;
  language: string;
  confidence: number;
  provider: string;
  model: string;
  duration_ms: number;
  audio_duration_ms?: number | null;
}

export interface ApiVoiceSpeakResponse {
  audio_url: string;
  duration: number;
  format: string;
}

export interface ApiVoiceRespondResponse extends ApiVoiceSpeakResponse {
  transcript: string;
  language: string;
  confidence: number;
  answer: string;
  model: string;
  sources: string[];
  summary_updated_at: string;
  cached: boolean;
  fallback_used: boolean;
  duration_ms: number | null;
}

export interface ApiVoiceRequest {
  audio?: File | null;
  transcript?: string | null;
  conversation_id?: string | null;
  history?: ApiChatContextMessage[];
}

export interface ApiVoiceStreamStage {
  stage: "transcribing" | "thinking" | "speaking";
  label: string;
}

export interface ApiVoiceStreamAudio {
  audio_url: string;
  duration: number;
  format: string;
}

export interface ApiVoiceHealthResponse {
  success?: boolean;
  enabled: boolean;
  ready: boolean;
  status: "ready" | "disabled" | "degraded" | "unavailable";
  provider: string;
  model: string;
  language: string;
  device: string;
  compute_type: string;
  runtime_available: boolean;
  model_loaded: boolean;
  ffmpeg_available: boolean;
  message: string;
  details: Record<string, unknown>;
}

export interface ApiVoiceStreamCallbacks extends ApiChatStreamCallbacks {
  onStage?: (stage: ApiVoiceStreamStage) => void;
  onTranscript?: (transcript: ApiVoiceTranscriptionResponse) => void;
  onAudio?: (audio: ApiVoiceStreamAudio) => void;
  onVoiceError?: (error: ApiChatErrorResponse) => void;
}

export type ApiChatErrorCode =
  | "AUTH_ERROR"
  | "AUDIO_INVALID"
  | "AUDIO_TOO_LARGE"
  | "IMAGE_INVALID"
  | "IMAGE_TOO_LARGE"
  | "OLLAMA_OFFLINE"
  | "NO_AUDIO_DETECTED"
  | "OCR_UNAVAILABLE"
  | "TRANSCRIPTION_UNAVAILABLE"
  | "VOICE_STT_DISABLED"
  | "VOICE_STT_UNAVAILABLE"
  | "TIMEOUT"
  | "TTS_UNAVAILABLE"
  | "REQUEST_CANCELLED"
  | "VISION_UNAVAILABLE"
  | "MEMORY_ERROR"
  | "MULTIPART_INVALID"
  | "SERVER_ERROR"
  | "NETWORK_ERROR";

export interface ApiChatErrorResponse {
  success?: boolean;
  code: ApiChatErrorCode;
  error_type?: string | null;
  message: string;
  fallback_answer?: string | null;
  details?: Record<string, unknown> | null;
}

export interface VerifyResetCodePayload {
  reset_token: string;
  code: string;
}

export interface ResetPasswordPayload extends VerifyResetCodePayload {
  new_password: string;
}

export interface CdrAnalyticsQuery {
  offset?: number;
  limit?: number;
  search?: string;
  operator?: string;
  department?: string;
  call_zone?: string;
  severity?: string;
}

export interface CdrRoamingMapQuery {
  country?: string;
  operator?: string;
  department?: string;
  risk_level?: ApiRoamingRiskLevel;
  min_roaming_cost_mad?: number;
  period_from?: string;
  period_to?: string;
}

export interface CdrMapQuery {
  mode?: "origins" | "destinations" | "flows";
  scope?: "morocco" | "international" | "all";
  operator?: string;
  department?: string;
  risk_level?: string;
  fraud_severity?: string;
  region?: string;
  date_from?: string;
  date_to?: string;
}

export interface RoamingIntelligenceQuery {
  country?: string;
  operator?: string;
  department?: string;
  risk_level?: ApiRoamingRiskLevel;
  anomaly_type?: string;
  min_cost_mad?: number;
  period_from?: string;
  period_to?: string;
  roaming_active?: boolean;
  fraud_only?: boolean;
}

export interface MobileFleetQuery {
  offset?: number;
  limit?: number;
  search?: string;
  operator?: string;
  department?: string;
  employee_profile?: string;
  device_category?: string;
  risk_level?: string;
}

export interface CustomerChurnQuery {
  offset?: number;
  limit?: number;
  search?: string;
  operator?: string;
  department?: string;
  contract?: string;
  payment_method?: string;
  internet_service?: string;
  plan?: string;
  price_range?: string;
  risk_level?: string;
  tenure_group?: string;
  churn_status?: string;
  prediction_status?: string;
}

interface RequestOptions extends RequestInit {
  token?: string | null;
}

export class ApiError extends Error {
  status: number;
  details: unknown;
  code: string | null;

  constructor(message: string, status: number, details: unknown, code: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
    this.code = code;
  }
}

function isAbortLikeError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") {
    return true;
  }

  return error instanceof Error && error.name === "AbortError";
}

function createAbortError(message = "Réponse interrompue."): DOMException {
  return new DOMException(message, "AbortError");
}

export interface ApiExplainRecommendationRequest {
  recommendation_title: string;
  conversation_id?: string | null;
  history?: ApiChatContextMessage[];
  image_analysis?: ApiExecutiveReportImageContext | null;
  executive_report?: ApiExplainabilityExecutiveContext | null;
  use_live_context?: boolean;
}

export interface ApiExplainRecommendationFactor {
  label: string;
  category: string;
  value: string;
  impact_score: number;
  severity: "low" | "medium" | "high" | "critical";
  evidence: string;
  weight: number;
}

export interface ApiExplainRecommendationDecisionStep {
  step_number: number;
  step_title: string;
  step_description: string;
  data_used: string[];
  confidence: number;
}

export interface ApiExplainRecommendationSupportingKpi {
  label: string;
  value: string;
  unit?: string | null;
  impact: string;
  confidence: number;
}

export interface ApiExplainRecommendationReasoning {
  factors: string[];
  kpis: string[];
  risks: string[];
  impact: string;
  business_explanation: string;
}

export interface ApiExplainRecommendationResponse {
  recommendation: string;
  answer: string;
  reasoning: ApiExplainRecommendationReasoning;
  confidence_score: number;
  estimated_savings?: string | null;
  risk_level: "low" | "medium" | "high" | "critical";
  impact_score: number;
  risk_score: number;
  fraud_score: number;
  anomaly_score: number;
  optimization_score: number;
  equipment_score: number;
  supporting_kpis: ApiExplainRecommendationSupportingKpi[];
  influencing_factors: ApiExplainRecommendationFactor[];
  decision_trace: ApiExplainRecommendationDecisionStep[];
  explanation_graph: ApiExplainabilityGraph;
  critical_zones: ApiExplainabilityCriticalZone[];
  alternative_recommendations: string[];
  data_points_used: string[];
  model: string;
  sources: string[];
  summary_updated_at: string;
  cached: boolean;
  fallback_used: boolean;
  duration_ms: number | null;
}

function extractApiError(
  payload: unknown,
  fallbackMessage: string,
  fallbackCode: string,
): { message: string; code: string } {
  if (typeof payload === "object" && payload !== null) {
    if (
      "success" in payload &&
      payload.success === false &&
      "code" in payload &&
      typeof payload.code === "string" &&
      "message" in payload &&
      typeof payload.message === "string"
    ) {
      return {
        code: payload.code,
        message: payload.message,
      };
    }

    if (
      "error" in payload &&
      typeof payload.error === "string" &&
      "message" in payload &&
      typeof payload.message === "string"
    ) {
      return {
        code: payload.error,
        message: payload.message,
      };
    }

    if (
      "code" in payload &&
      typeof payload.code === "string" &&
      "message" in payload &&
      typeof payload.message === "string"
    ) {
      return {
        code: payload.code,
        message: payload.message,
      };
    }

    if (
      "error_type" in payload &&
      typeof payload.error_type === "string" &&
      "message" in payload &&
      typeof payload.message === "string"
    ) {
      return {
        code: payload.error_type.toUpperCase(),
        message: payload.message,
      };
    }

    if ("detail" in payload) {
      const detail = payload.detail;
      if (typeof detail === "string" && detail.trim() !== "") {
        if (
          detail === "Internal server error" ||
          detail === "Backend request failed"
        ) {
          return {
            code: fallbackCode,
            message: fallbackMessage,
          };
        }

        return {
          code: fallbackCode,
          message: detail,
        };
      }

      if (
        typeof detail === "object" &&
        detail !== null &&
        "code" in detail &&
        typeof detail.code === "string" &&
        "message" in detail &&
        typeof detail.message === "string"
      ) {
        return {
          code: detail.code,
          message: detail.message,
        };
      }
    }
  }

  if (typeof payload === "string" && payload.trim() !== "") {
    if (payload === "Internal server error" || payload === "Backend request failed") {
      return {
        code: fallbackCode,
        message: fallbackMessage,
      };
    }

    return {
      code: fallbackCode,
      message: payload,
    };
  }

  return {
    code: fallbackCode,
    message: fallbackMessage,
  };
}

function resolveDefaultApiBaseUrl(): string {
  return import.meta.env.DEV ? "/api/v1" : "http://localhost:8000/api/v1";
}

const API_BASE_URL =
  ((import.meta.env.VITE_API_URL as string | undefined)?.trim() || resolveDefaultApiBaseUrl()).replace(
    /\/$/,
    "",
  );
const ENABLE_DEBUG_LOGS = import.meta.env.DEV;

function resolveApiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

function logInfrastructureEvent(
  event: string,
  payload: Record<string, unknown>,
  level: "debug" | "info" | "warn" | "error" = "info",
): void {
  if (!ENABLE_DEBUG_LOGS) {
    return;
  }
  console[level](`[infra] ${event}`, payload);
}

function resolveAccessToken(token: string | null | undefined): string | null {
  return token ?? readStoredSession()?.accessToken ?? null;
}

function describeUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === "string" ? error : "Unknown error";
}

function buildBackendUnavailableError(requestUrl: string, error: unknown) {
  logInfrastructureEvent(
    "BACKEND_OFFLINE",
    {
      requestUrl,
      error: describeUnknownError(error),
    },
    "error",
  );

  emitApiErrorEvent({
    title: "Backend indisponible",
    message:
      "Connexion backend impossible. Verifiez que l'API est demarree et accessible depuis l'application.",
    status: 0,
    code: "NETWORK_ERROR",
    level: "error",
  });

  return new ApiError(
    "Connexion backend impossible. Verifiez que l'API est demarree et accessible depuis l'application.",
    0,
    error,
    "NETWORK_ERROR",
  );
}

function handleAuthFailure(
  payload: unknown,
  status: number,
  shouldClearSession = false,
): never {
  if (status === 401) {
    if (shouldClearSession) {
      clearStoredSession();
    }

    const errorInfo = extractApiError(
      payload,
      "Session expiree. Reconnectez-vous puis reessayez.",
      "AUTH_ERROR",
    );
    emitApiErrorEvent({
      title: "Session expiree",
      message: errorInfo.message,
      status,
      code: errorInfo.code || "AUTH_ERROR",
      level: "warning",
    });

    throw new ApiError(
      errorInfo.message,
      status,
      payload,
      errorInfo.code || "AUTH_ERROR",
    );
  }

  const errorInfo = extractApiError(
    payload,
    "Acces refuse a cette ressource.",
    "FORBIDDEN",
  );
  emitApiErrorEvent({
    title: "Acces refuse",
    message: errorInfo.message,
    status,
    code: errorInfo.code || "FORBIDDEN",
    level: "warning",
  });

  throw new ApiError(
    errorInfo.message,
    status,
    payload,
    errorInfo.code || "FORBIDDEN",
  );
}

function describeFormDataValue(value: FormDataEntryValue) {
  if (typeof value === "string") {
    return {
      kind: "text",
      length: value.length,
      preview: value.slice(0, 120),
    };
  }

  return {
    kind: "file",
    name: value.name,
    mimeType: value.type,
    size: value.size,
  };
}

function debugFormData(label: string, formData: FormData): void {
  if (!ENABLE_DEBUG_LOGS) {
    return;
  }
  console.debug(label, {
    contentTypeManagedByBrowser: true,
    entries: Array.from(formData.entries(), ([key, value]) => ({
      key,
      ...describeFormDataValue(value),
    })),
  });
}

function buildWebSocketUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  if (/^https?:\/\//i.test(API_BASE_URL)) {
    return `${API_BASE_URL.replace(/^http/i, "ws")}${normalizedPath}`;
  }

  const protocol =
    typeof window !== "undefined" && window.location.protocol === "https:" ? "wss" : "ws";
  const host = typeof window !== "undefined" ? window.location.host : "localhost";
  const basePath = API_BASE_URL.startsWith("/") ? API_BASE_URL : `/${API_BASE_URL}`;

  return `${protocol}://${host}${basePath}${normalizedPath}`;
}

let refreshPromise: Promise<string | null> | null = null;

function buildHeaders(
  headers: HeadersInit | undefined,
  token: string | null | undefined,
  body: BodyInit | null | undefined,
): HeadersInit {
  const shouldSetJsonContentType =
    body !== undefined && body !== null && !(body instanceof FormData);

  return {
    ...(shouldSetJsonContentType ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...headers,
  };
}

function buildQueryString(
  params: Record<string, string | number | boolean | null | undefined> | undefined,
): string {
  if (!params) {
    return "";
  }

  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }

    searchParams.set(key, String(value));
  });

  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

async function parsePayload(response: Response): Promise<unknown> {
  const responseText = await response.text();

  if (!responseText) {
    return null;
  }

  try {
    return JSON.parse(responseText);
  } catch {
    return responseText;
  }
}

async function tryRefreshAccessToken(): Promise<string | null> {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    const session = readStoredSession();
    if (!session?.refreshToken) {
      clearStoredSession();
      logInfrastructureEvent(
        "JWT_REFRESH",
        { refreshed: false, reason: "missing_refresh_token" },
        "warn",
      );
      return null;
    }

    const refreshUrl = resolveApiUrl("/auth/refresh");

    try {
      logInfrastructureEvent("JWT_REFRESH", {
        endpoint: "/auth/refresh",
        phase: "started",
      });
      const response = await fetch(refreshUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ refresh_token: session.refreshToken }),
      });
      const payload = await parsePayload(response);

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          clearStoredSession();
        }

        logInfrastructureEvent(
          "JWT_REFRESH",
          {
            endpoint: "/auth/refresh",
            phase: "failed",
            status: response.status,
          },
          response.status === 401 || response.status === 403 ? "warn" : "error",
        );
        return null;
      }

      const refreshedSession = payload as AuthResponse;
      writeStoredSession(
        {
          accessToken: refreshedSession.access_token,
          refreshToken: refreshedSession.refresh_token,
          user: refreshedSession.user,
        },
        hasPersistentSession(),
      );

      logInfrastructureEvent(
        "JWT_REFRESH",
        {
          endpoint: "/auth/refresh",
          phase: "completed",
          status: response.status,
        },
        "info",
      );
      return refreshedSession.access_token;
    } catch (error) {
      logInfrastructureEvent(
        "JWT_REFRESH",
        {
          endpoint: "/auth/refresh",
          phase: "failed",
          error: describeUnknownError(error),
        },
        "warn",
      );
      return null;
    }
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

async function request<T>(
  path: string,
  options: RequestOptions = {},
  allowRefresh = true,
): Promise<T> {
  const { token, headers, body, ...rest } = options;
  const resolvedToken = resolveAccessToken(token);
  const requestUrl = resolveApiUrl(path);
  let response: Response;
  const startedAt = performance.now();
  if (ENABLE_DEBUG_LOGS) {
    console.debug("[api] request_started", {
      request: `${options.method ?? "GET"} ${path}`,
      requestUrl,
      hasToken: Boolean(resolvedToken),
      isFormData: body instanceof FormData,
    });
  }

  try {
    response = await fetch(requestUrl, {
      ...rest,
      body,
      headers: buildHeaders(headers, resolvedToken, body),
    });
  } catch (error) {
    if (isAbortLikeError(error)) {
      throw error;
    }

    throw buildBackendUnavailableError(requestUrl, error);
  }

  const payload = await parsePayload(response);
  const requestLabel = `${options.method ?? "GET"} ${path}`;
  if (ENABLE_DEBUG_LOGS) {
    console.debug("[api] response_received", {
      request: requestLabel,
      status: response.status,
      ok: response.ok,
      durationMs: Math.round(performance.now() - startedAt),
      responseContentType: response.headers.get("content-type"),
    });
  }

  if (response.status === 401 && resolvedToken && allowRefresh) {
    const refreshedToken = await tryRefreshAccessToken();
    if (refreshedToken) {
      return request<T>(path, { ...options, token: refreshedToken }, false);
    }
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      handleAuthFailure(payload, response.status, Boolean(resolvedToken));
    }

    const errorInfo = extractApiError(
      payload,
      "Une erreur est survenue cote serveur.",
      "SERVER_ERROR",
    );
    throw new ApiError(errorInfo.message, response.status, payload, errorInfo.code);
  }

  return payload as T;
}

async function requestBlob(
  path: string,
  options: RequestOptions = {},
  allowRefresh = true,
): Promise<Blob> {
  const { token, headers, body, ...rest } = options;
  const resolvedToken = resolveAccessToken(token);
  const requestUrl = resolveApiUrl(path);
  let response: Response;
  const startedAt = performance.now();
  const requestLabel = `${options.method ?? "GET"} ${path}`;
  if (ENABLE_DEBUG_LOGS) {
    console.debug("[api] request_started", {
      request: requestLabel,
      requestUrl,
      hasToken: Boolean(resolvedToken),
      isFormData: body instanceof FormData,
      responseType: "blob",
    });
  }

  try {
    response = await fetch(requestUrl, {
      ...rest,
      body,
      headers: buildHeaders(headers, resolvedToken, body),
    });
  } catch (error) {
    if (isAbortLikeError(error)) {
      throw error;
    }

    throw buildBackendUnavailableError(requestUrl, error);
  }

  if (ENABLE_DEBUG_LOGS) {
    console.debug("[api] response_received", {
      request: requestLabel,
      status: response.status,
      ok: response.ok,
      durationMs: Math.round(performance.now() - startedAt),
      responseType: "blob",
      responseContentType: response.headers.get("content-type"),
    });
  }

  if (response.status === 401 && resolvedToken && allowRefresh) {
    const refreshedToken = await tryRefreshAccessToken();
    if (refreshedToken) {
      return requestBlob(path, { ...options, token: refreshedToken }, false);
    }
  }

  if (!response.ok) {
    const payload = await parsePayload(response);

    if (response.status === 401 || response.status === 403) {
      handleAuthFailure(payload, response.status, Boolean(resolvedToken));
    }

    const errorInfo = extractApiError(
      payload,
      "Une erreur est survenue cote serveur.",
      "SERVER_ERROR",
    );
    throw new ApiError(errorInfo.message, response.status, payload, errorInfo.code);
  }

  return response.blob();
}

export const authApi = {
  login(payload: LoginPayload) {
    return request<AuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  adminLogin(payload: LoginPayload) {
    return request<AuthResponse>("/auth/admin/login", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  register(payload: RegisterPayload) {
    return request<AuthResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  getCurrentUser(token: string) {
    return request<ApiUser>("/auth/me", { token });
  },
  requestPasswordReset(payload: ForgotPasswordPayload) {
    return request<ForgotPasswordResponse>("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  verifyResetCode(payload: VerifyResetCodePayload) {
    return request<MessageResponse>("/auth/verify-reset-code", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  resetPassword(payload: ResetPasswordPayload) {
    return request<MessageResponse>("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
};

export const healthApi = {
  get() {
    return request<ApiHealthResponse>("/health");
  },
};

export const oauthApi = {
  googleLoginUrl() {
    return `${API_BASE_URL}/auth/google/login`;
  },
  microsoftLoginUrl() {
    return `${API_BASE_URL}/auth/microsoft/login`;
  },
  providers() {
    return request<ApiOAuthProvidersStatus>("/auth/oauth/providers");
  },
};

export const companyRegistrationApi = {
  submit(formData: FormData) {
    return request<ApiCompanyRegistrationSubmitResponse>("/company-registration/request", {
      method: "POST",
      body: formData,
    });
  },
  checkEligibility(email: string) {
    return request<ApiCompanyRegistrationEmailEligibility>(
      `/company-registration/request-eligibility${buildQueryString({ email })}`,
    );
  },
  overview(token: string) {
    return request<ApiCompanyRegistrationOverview>("/admin/company-registration/overview", {
      token,
    });
  },
  list(
    token: string,
    params?: {
      offset?: number;
      limit?: number;
      status?: ApiCompanyRegistrationStatus | "all";
      search?: string;
      include_deleted?: boolean;
      deleted_only?: boolean;
    },
  ) {
    const normalizedParams = {
      ...params,
      status: params?.status === "all" ? undefined : params?.status,
    };
    return request<ApiCompanyRegistrationListResponse>(
      `/admin/company-registration/requests${buildQueryString(normalizedParams)}`,
      { token },
    );
  },
  get(token: string, requestId: number) {
    return request<ApiCompanyRegistrationDetail>(
      `/admin/company-registration/requests/${requestId}`,
      { token },
    );
  },
  approve(token: string, requestId: number) {
    return request<ApiCompanyRegistrationActionResponse>(
      `/admin/company-registration/requests/${requestId}/approve`,
      {
        method: "PATCH",
        token,
      },
    );
  },
  reopen(token: string, requestId: number, reason: string) {
    return request<ApiCompanyRegistrationActionResponse>(
      `/admin/company-registration/requests/${requestId}/reopen`,
      {
        method: "PATCH",
        token,
        body: JSON.stringify({ reason }),
      },
    );
  },
  reject(token: string, requestId: number, rejectionReason: string) {
    return request<ApiCompanyRegistrationActionResponse>(
      `/admin/company-registration/requests/${requestId}/reject`,
      {
        method: "POST",
        token,
        body: JSON.stringify({ rejection_reason: rejectionReason }),
      },
    );
  },
  delete(token: string, requestId: number, payload?: { force?: boolean; reason?: string }) {
    return request<ApiCompanyRegistrationActionResponse>(
      `/admin/company-registration/requests/${requestId}/delete`,
      {
        method: "PATCH",
        token,
        body: JSON.stringify({
          force: payload?.force ?? false,
          reason: payload?.reason ?? null,
        }),
      },
    );
  },
  restore(token: string, requestId: number, payload?: { reason?: string }) {
    return request<ApiCompanyRegistrationActionResponse>(
      `/admin/company-registration/requests/${requestId}/restore`,
      {
        method: "PATCH",
        token,
        body: JSON.stringify({
          reason: payload?.reason ?? null,
        }),
      },
    );
  },
  requestInformation(token: string, requestId: number, comment: string) {
    return request<ApiCompanyRegistrationActionResponse>(
      `/admin/company-registration/requests/${requestId}/request-information`,
      {
        method: "POST",
        token,
        body: JSON.stringify({ comment }),
      },
    );
  },
  downloadDocument(token: string, requestId: number, documentKey: string) {
    return requestBlob(
      `/admin/company-registration/requests/${requestId}/documents/${encodeURIComponent(documentKey)}`,
      {
        token,
      },
    );
  },
  listCompanies(
    token: string,
    params?: {
      offset?: number;
      limit?: number;
      search?: string;
      status?: ApiCompanyLifecycleStatus;
      sort_by?: "date" | "company" | "status";
      sort_order?: "asc" | "desc";
    },
  ) {
    return request<ApiCompanyListResponse>(`/admin/companies${buildQueryString(params)}`, {
      token,
    });
  },
  companyDashboard(token: string, companyId: number) {
    return request<ApiCompanyDashboard>(`/admin/companies/${companyId}/dashboard`, {
      token,
    });
  },
  auditLogs(
    token: string,
    params?: {
      offset?: number;
      limit?: number;
      action?: string;
      search?: string;
    },
  ) {
    return request<ApiCompanyAuditLogListResponse>(
      `/admin/company-registration/audit-logs${buildQueryString(params)}`,
      { token },
    );
  },
};

export const invitationsApi = {
  validate(token: string) {
    return request<InvitationValidationResponse>(
      `/invitations/validate${buildQueryString({ token })}`,
    );
  },
  accept(payload: AcceptInvitationPayload) {
    return request<AcceptInvitationResponse>("/invitations/accept", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
};

export const chatApi = {
  ask(token: string, payload: ApiChatRequest) {
    return request<ApiChatResponse>("/chat", {
      method: "POST",
      token,
      body: JSON.stringify(payload),
    });
  },
  generateCopilotActionPlan(
    token: string,
    payload: { history?: ApiChatContextMessage[] } = {},
    signal?: AbortSignal,
  ) {
    return request<ApiChatActionPlanResponse>("/chat/copilot/actions", {
      method: "POST",
      token,
      signal,
      body: JSON.stringify(payload),
    });
  },
  askWithImage(
    token: string,
    payload: ApiChatRequest & { image: File },
    signal?: AbortSignal,
  ) {
    const formData = new FormData();
    formData.append("image", payload.image);
    formData.append("question", payload.question);
    formData.append("analysis_mode", payload.analysis_mode ?? "quick");
    if (payload.conversation_id) {
      formData.append("conversation_id", payload.conversation_id);
    }
    formData.append("history_json", JSON.stringify(payload.history ?? []));
    console.debug("[chatbot] image_formdata_prepared", {
      endpoint: "/chat/image",
      questionLength: payload.question.length,
      conversationId: payload.conversation_id ?? null,
      historySize: payload.history?.length ?? 0,
      imageName: payload.image.name,
      imageType: payload.image.type,
      imageSize: payload.image.size,
      analysisMode: payload.analysis_mode ?? "quick",
      signalAborted: signal?.aborted ?? false,
    });

    return request<ApiChatImageResponse>("/chat/image", {
      method: "POST",
      token,
      body: formData,
      signal,
    });
  },
  askWithDocument(
    token: string,
    payload: ApiChatRequest & { document: File },
    signal?: AbortSignal,
  ) {
    const formData = new FormData();
    formData.append("document", payload.document);
    formData.append("question", payload.question);
    formData.append("analysis_mode", payload.analysis_mode ?? "advanced");
    if (payload.conversation_id) {
      formData.append("conversation_id", payload.conversation_id);
    }
    formData.append("history_json", JSON.stringify(payload.history ?? []));

    return request<ApiChatImageResponse>("/chat/upload-document", {
      method: "POST",
      token,
      body: formData,
      signal,
    });
  },
  askWithPdf(
    token: string,
    payload: ApiChatRequest & { pdf: File },
    signal?: AbortSignal,
  ) {
    return this.askWithDocument(
      token,
      {
        ...payload,
        document: payload.pdf,
      },
      signal,
    );
  },
  generateExecutiveReport(
    token: string,
    payload: ApiExecutiveReportRequest,
    signal?: AbortSignal,
  ) {
    return request<ApiExecutiveReportResponse>("/chat/executive-report", {
      method: "POST",
      token,
      body: JSON.stringify(payload),
      signal,
    });
  },
  explain(
    token: string,
    payload: ApiExplainabilityRequest,
    signal?: AbortSignal,
  ) {
    return request<ApiExplainabilityResponse>("/chat/explain", {
      method: "POST",
      token,
      body: JSON.stringify(payload),
      signal,
    });
  },
  explainRecommendation(
    token: string,
    payload: ApiExplainRecommendationRequest,
    signal?: AbortSignal,
  ) {
    return request<ApiExplainRecommendationResponse>("/chat/explain-recommendation", {
      method: "POST",
      token,
      body: JSON.stringify(payload),
      signal,
    });
  },
  transcribeVoice(
    token: string,
    audioFile: File,
    signal?: AbortSignal,
  ) {
    const formData = new FormData();
    formData.append("audio", audioFile);
    debugFormData("[api] voice_transcribe_formdata_prepared", formData);
    if (ENABLE_DEBUG_LOGS) {
      console.debug("[chatbot] voice_formdata_prepared", {
        endpoint: "/chat/voice/transcribe",
        audioName: audioFile.name,
        audioType: audioFile.type,
        audioSize: audioFile.size,
        signalAborted: signal?.aborted ?? false,
        contentTypeManagedByBrowser: true,
      });
    }

    return request<ApiVoiceTranscriptionResponse>("/chat/voice/transcribe", {
      method: "POST",
      token,
      body: formData,
      signal,
    });
  },
  voiceHealth(token: string) {
    return request<ApiVoiceHealthResponse>("/chat/voice/health", {
      token,
    });
  },
  speakVoice(
    token: string,
    text: string,
    signal?: AbortSignal,
  ) {
    if (ENABLE_DEBUG_LOGS) {
      console.debug("[chatbot] voice_speak_payload", {
        endpoint: "/chat/voice/speak",
        textChars: text.length,
        signalAborted: signal?.aborted ?? false,
      });
    }

    return request<ApiVoiceSpeakResponse>("/chat/voice/speak", {
      method: "POST",
      token,
      body: JSON.stringify({ text }),
      signal,
    });
  },
  respondVoice(
    token: string,
    payload: ApiVoiceRequest,
    signal?: AbortSignal,
  ) {
    const formData = new FormData();
    if (payload.audio) {
      formData.append("audio", payload.audio);
    }
    if (payload.transcript?.trim()) {
      formData.append("transcript", payload.transcript.trim());
    }
    if (payload.conversation_id) {
      formData.append("conversation_id", payload.conversation_id);
    }
    formData.append("history_json", JSON.stringify(payload.history ?? []));
    debugFormData("[api] voice_respond_formdata_prepared", formData);

    return request<ApiVoiceRespondResponse>("/chat/voice/respond", {
      method: "POST",
      token,
      body: formData,
      signal,
    });
  },
  async streamVoice(
    token: string,
    payload: ApiVoiceRequest,
    callbacks: ApiVoiceStreamCallbacks = {},
    allowRefresh = true,
  ) {
    if (callbacks.signal?.aborted) {
      throw createAbortError();
    }

    const formData = new FormData();
    if (payload.audio) {
      formData.append("audio", payload.audio);
    }
    if (payload.transcript?.trim()) {
      formData.append("transcript", payload.transcript.trim());
    }
    if (payload.conversation_id) {
      formData.append("conversation_id", payload.conversation_id);
    }
    formData.append("history_json", JSON.stringify(payload.history ?? []));
    debugFormData("[api] voice_stream_formdata_prepared", formData);
    const resolvedToken = resolveAccessToken(token);
    const requestUrl = resolveApiUrl("/chat/voice/stream");

    const response = await fetch(requestUrl, {
      method: "POST",
      body: formData,
      headers: buildHeaders(undefined, resolvedToken, formData),
      signal: callbacks.signal,
    }).catch((error) => {
      if (isAbortLikeError(error)) {
        throw error;
      }

      throw buildBackendUnavailableError(requestUrl, error);
    });

    if (response.status === 401 && resolvedToken && allowRefresh) {
      const refreshedToken = await tryRefreshAccessToken();
      if (refreshedToken) {
        return chatApi.streamVoice(refreshedToken, payload, callbacks, false);
      }
    }

    if (!response.ok) {
      const payloadError = await parsePayload(response);
      if (response.status === 401 || response.status === 403) {
        handleAuthFailure(payloadError, response.status, Boolean(resolvedToken));
      }

      const errorInfo = extractApiError(
        payloadError,
        "Une erreur est survenue cote serveur.",
        "SERVER_ERROR",
      );
      throw new ApiError(errorInfo.message, response.status, payloadError, errorInfo.code);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new ApiError(
        "Le streaming vocal est indisponible sur ce navigateur.",
        response.status,
        null,
        "SERVER_ERROR",
      );
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let finalResponse: ApiChatResponse | null = null;
    let streamError: ApiChatErrorResponse | null = null;
    let lastAudio: ApiVoiceStreamAudio | null = null;

    const handleEventBlock = (eventBlock: string) => {
      const trimmedBlock = eventBlock.trim();
      if (!trimmedBlock) {
        return;
      }

      const lines = trimmedBlock.split(/\r?\n/);
      let eventName = "message";
      const dataLines: string[] = [];

      lines.forEach((line) => {
        if (line.startsWith("event:")) {
          eventName = line.slice(6).trim() || "message";
          return;
        }

        if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart());
        }
      });

      const rawData = dataLines.join("\n");
      const parsedData = rawData ? JSON.parse(rawData) : null;

      if (eventName === "stage" && parsedData) {
        callbacks.onStage?.(parsedData as ApiVoiceStreamStage);
        return;
      }

      if (eventName === "transcript" && parsedData) {
        callbacks.onTranscript?.(parsedData as ApiVoiceTranscriptionResponse);
        return;
      }

      if (eventName === "audio" && parsedData) {
        lastAudio = parsedData as ApiVoiceStreamAudio;
        callbacks.onAudio?.(lastAudio);
        return;
      }

      if (eventName === "voice_error") {
        const errorInfo = extractApiError(
          parsedData,
          "Lecture audio indisponible.",
          "TTS_UNAVAILABLE",
        );
        callbacks.onVoiceError?.(errorInfo as ApiChatErrorResponse);
        return;
      }

      if (eventName === "meta" && parsedData) {
        callbacks.onMeta?.(parsedData as ApiChatStreamMeta);
        return;
      }

      if (eventName === "token" && parsedData && typeof parsedData.text === "string") {
        callbacks.onToken?.(parsedData.text);
        return;
      }

      if (eventName === "done" && parsedData) {
        finalResponse = parsedData as ApiChatResponse;
        callbacks.onDone?.(finalResponse);
        return;
      }

      if (eventName === "error") {
        const errorInfo = extractApiError(
          parsedData,
          "Une erreur est survenue cote serveur.",
          "SERVER_ERROR",
        );
        streamError = errorInfo;
        callbacks.onError?.(errorInfo as ApiChatErrorResponse);
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

        let separatorIndex = buffer.indexOf("\n\n");
        while (separatorIndex >= 0) {
          const eventBlock = buffer.slice(0, separatorIndex);
          buffer = buffer.slice(separatorIndex + 2);
          handleEventBlock(eventBlock);
          separatorIndex = buffer.indexOf("\n\n");
        }

        if (done) {
          break;
        }
      }
    } catch (error) {
      if (isAbortLikeError(error)) {
        throw error;
      }

      throw error;
    }

    const trailingBlock = buffer.trim();
    if (trailingBlock) {
      handleEventBlock(trailingBlock);
    }

    if (streamError) {
      throw new ApiError(streamError.message, response.status, streamError, streamError.code);
    }

    if (!finalResponse) {
      if (callbacks.signal?.aborted) {
        throw createAbortError();
      }

      throw new ApiError(
        "Une erreur est survenue cote serveur.",
        response.status,
        null,
        "SERVER_ERROR",
      );
    }

    return {
      response: finalResponse,
      audio: lastAudio,
    };
  },
  async stream(
    token: string,
    payload: ApiChatRequest,
    callbacks: ApiChatStreamCallbacks = {},
    allowRefresh = true,
  ) {
    if (callbacks.signal?.aborted) {
      throw createAbortError();
    }

    const resolvedToken = resolveAccessToken(token);
    const requestUrl = resolveApiUrl("/chat/stream");

    const response = await fetch(requestUrl, {
      method: "POST",
      body: JSON.stringify(payload),
      headers: buildHeaders(undefined, resolvedToken, JSON.stringify(payload)),
      signal: callbacks.signal,
    }).catch((error) => {
      if (isAbortLikeError(error)) {
        throw error;
      }

      throw buildBackendUnavailableError(requestUrl, error);
    });

    if (response.status === 401 && resolvedToken && allowRefresh) {
      const refreshedToken = await tryRefreshAccessToken();
      if (refreshedToken) {
        return chatApi.stream(refreshedToken, payload, callbacks, false);
      }
    }

    if (!response.ok) {
      const payloadValue = await parsePayload(response);
      if (response.status === 401 || response.status === 403) {
        handleAuthFailure(payloadValue, response.status, Boolean(resolvedToken));
      }

      const errorInfo = extractApiError(
        payloadValue,
        "Une erreur est survenue cote serveur.",
        "SERVER_ERROR",
      );
      throw new ApiError(errorInfo.message, response.status, payloadValue, errorInfo.code);
    }

    if (!response.body) {
      throw new ApiError(
        "Une erreur est survenue cote serveur.",
        response.status,
        null,
        "SERVER_ERROR",
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalResponse: ApiChatResponse | null = null;
    let streamError: ApiChatErrorResponse | null = null;

    const handleEventBlock = (eventBlock: string) => {
      const lines = eventBlock
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter(Boolean);

      if (lines.length === 0) {
        return;
      }

      let eventName = "message";
      const dataLines: string[] = [];

      lines.forEach((line) => {
        if (line.startsWith("event:")) {
          eventName = line.slice(6).trim();
          return;
        }

        if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart());
        }
      });

      const rawData = dataLines.join("\n");
      const parsedData = rawData ? JSON.parse(rawData) : null;

      if (eventName === "meta" && parsedData) {
        callbacks.onMeta?.(parsedData as ApiChatStreamMeta);
        return;
      }

      if (eventName === "token" && parsedData && typeof parsedData.text === "string") {
        callbacks.onToken?.(parsedData.text);
        return;
      }

      if (eventName === "done" && parsedData) {
        finalResponse = parsedData as ApiChatResponse;
        callbacks.onDone?.(finalResponse);
        return;
      }

      if (eventName === "error") {
        const errorInfo = extractApiError(
          parsedData,
          "Une erreur est survenue cote serveur.",
          "SERVER_ERROR",
        );
        streamError = errorInfo;
        callbacks.onError?.(errorInfo as ApiChatErrorResponse);
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

        let separatorIndex = buffer.indexOf("\n\n");
        while (separatorIndex >= 0) {
          const eventBlock = buffer.slice(0, separatorIndex);
          buffer = buffer.slice(separatorIndex + 2);
          handleEventBlock(eventBlock);
          separatorIndex = buffer.indexOf("\n\n");
        }

        if (done) {
          break;
        }
      }
    } catch (error) {
      if (isAbortLikeError(error)) {
        throw error;
      }

      throw error;
    }

    const trailingBlock = buffer.trim();
    if (trailingBlock) {
      handleEventBlock(trailingBlock);
    }

    if (streamError) {
      throw new ApiError(streamError.message, response.status, streamError, streamError.code);
    }

    if (!finalResponse) {
      if (callbacks.signal?.aborted) {
        throw createAbortError();
      }

      throw new ApiError(
        "Une erreur est survenue cote serveur.",
        response.status,
        null,
        "SERVER_ERROR",
      );
    }

    return finalResponse;
  },
};

export const reportsApi = {
  generate(
    token: string,
    payload: ApiReportGenerateRequest,
    signal?: AbortSignal,
  ) {
    return request<ApiReportGenerateResponse>("/reports/generate", {
      method: "POST",
      token,
      body: JSON.stringify(payload),
      signal,
    });
  },
  downloadPdf(
    token: string,
    reportId: string,
    signal?: AbortSignal,
  ) {
    return requestBlob(`/reports/${reportId}/pdf`, {
      method: "GET",
      token,
      signal,
    });
  },
};

export const liveMonitoringApi = {
  status(token: string) {
    return request<ApiLiveMonitoringStatus>("/live/status", { token });
  },
  kpis(token: string) {
    return request<ApiLiveMonitoringSnapshot>("/live/kpis", { token });
  },
  buildStreamUrl(token: string) {
    return `${buildWebSocketUrl(`/live/stream?token=${encodeURIComponent(token)}`)}`;
  },
};

export const employeesApi = {
  list(
    token: string,
    params?: { offset?: number; limit?: number; search?: string; status?: string },
  ) {
    return request<ApiImportedEmployeeList>(`/employees/${buildQueryString(params)}`, { token });
  },
  previewImport(token: string, file: File, options?: ApiEmployeeImportOptions) {
    const formData = new FormData();
    formData.append("file", file);
    if (options) {
      formData.append("options_json", JSON.stringify(options));
    }

    return request<ApiEmployeeImportPreview>("/employees/import/preview", {
      method: "POST",
      token,
      body: formData,
    });
  },
  importFile(token: string, file: File, options?: ApiEmployeeImportOptions) {
    const formData = new FormData();
    formData.append("file", file);
    if (options) {
      formData.append("options_json", JSON.stringify(options));
    }

    return request<ApiEmployeeImportSummary>("/employees/import", {
      method: "POST",
      token,
      body: formData,
    });
  },
};

export const usersApi = {
  list(token: string, params?: ListUsersParams) {
    return request<ApiUser[]>(`/users/${buildQueryString(params)}`, { token });
  },
  listInvitations(token: string) {
    return request<ApiUserInvitation[]>("/users/invitations", { token });
  },
  get(token: string, userId: number) {
    return request<ApiUser>(`/users/${userId}`, { token });
  },
  createInvitation(token: string, payload: CreateUserInvitationPayload) {
    return request<ApiUserInvitationActionResponse>("/users/invitations", {
      method: "POST",
      token,
      body: JSON.stringify(payload),
    });
  },
  create(token: string, payload: CreateUserPayload) {
    return request<ApiUser>("/users/", {
      method: "POST",
      token,
      body: JSON.stringify(payload),
    });
  },
  update(token: string, userId: number, payload: UpdateUserPayload) {
    return request<ApiUser>(`/users/${userId}`, {
      method: "PUT",
      token,
      body: JSON.stringify(payload),
    });
  },
  setStatus(token: string, userId: number, payload: SetUserStatusPayload) {
    return request<ApiUser>(`/users/${userId}/status`, {
      method: "PATCH",
      token,
      body: JSON.stringify(payload),
    });
  },
  deactivate(token: string, userId: number) {
    return request<ApiUser>(`/users/${userId}/deactivate`, {
      method: "PATCH",
      token,
    });
  },
  changeRole(token: string, userId: number, payload: ChangeUserRolePayload) {
    return request<ApiUser>(`/users/${userId}/role`, {
      method: "PATCH",
      token,
      body: JSON.stringify(payload),
    });
  },
  resendInvitation(token: string, invitationId: number) {
    return request<ApiUserInvitationActionResponse>(`/users/invitations/${invitationId}/resend`, {
      method: "POST",
      token,
    });
  },
  cancelInvitation(token: string, invitationId: number) {
    return request<ApiUserInvitationActionResponse>(`/users/invitations/${invitationId}/cancel`, {
      method: "PATCH",
      token,
    });
  },
  deleteInvitation(token: string, invitationId: number) {
    return request<void>(`/users/invitations/${invitationId}`, {
      method: "DELETE",
      token,
    });
  },
  remove(token: string, userId: number) {
    return request<void>(`/users/${userId}`, {
      method: "DELETE",
      token,
    });
  },
};

export const phoneLinesApi = {
  list(
    token: string,
    params?: { offset?: number; limit?: number; assigned_filter?: string; status_filter?: string },
  ) {
    return request<ApiPhoneLine[]>(`/phone-lines/${buildQueryString(params)}`, { token });
  },
  stats(token: string) {
    return request<ApiPhoneLineStats>("/phone-lines/stats", { token });
  },
  occupationStats(token: string) {
    return request<ApiPhoneLineOccupationStats>("/phone-lines/stats/occupation", { token });
  },
  get(token: string, phoneLineId: number) {
    return request<ApiPhoneLine>(`/phone-lines/${phoneLineId}`, { token });
  },
  create(token: string, payload: CreatePhoneLinePayload) {
    return request<ApiPhoneLine>("/phone-lines/", {
      method: "POST",
      token,
      body: JSON.stringify(payload),
    });
  },
  update(token: string, phoneLineId: number, payload: UpdatePhoneLinePayload) {
    return request<ApiPhoneLine>(`/phone-lines/${phoneLineId}`, {
      method: "PUT",
      token,
      body: JSON.stringify(payload),
    });
  },
  changePlan(token: string, phoneLineId: number, payload: ChangePhoneLinePlanPayload) {
    return request<ApiPhoneLine>(`/phone-lines/${phoneLineId}/change-plan`, {
      method: "POST",
      token,
      body: JSON.stringify(payload),
    });
  },
  suspend(token: string, phoneLineId: number) {
    return request<ApiPhoneLine>(`/phone-lines/${phoneLineId}/suspend`, {
      method: "POST",
      token,
    });
  },
  reactivate(token: string, phoneLineId: number) {
    return request<ApiPhoneLine>(`/phone-lines/${phoneLineId}/reactivate`, {
      method: "POST",
      token,
    });
  },
  remove(token: string, phoneLineId: number) {
    return request<void>(`/phone-lines/${phoneLineId}`, {
      method: "DELETE",
      token,
    });
  },
};

export const cdrAnalyticsApi = {
  overview(token: string, params?: CdrAnalyticsQuery) {
    return request<ApiCdrOverview>(`/cdr-analytics/overview${buildQueryString(params)}`, { token });
  },
  filters(token: string) {
    return request<ApiCdrFilters>("/cdr-analytics/filters", { token });
  },
  alerts(token: string, params?: CdrAnalyticsQuery) {
    return request<ApiCdrAlertList>(`/cdr-analytics/alerts${buildQueryString(params)}`, { token });
  },
  alert(token: string, cdrRowId: number) {
    return request<ApiCdrAlertDetail>(`/cdr-analytics/alerts/${cdrRowId}`, { token });
  },
  recommendations(token: string, params?: CdrAnalyticsQuery) {
    return request<ApiCdrRecommendationList>(
      `/cdr-analytics/recommendations${buildQueryString(params)}`,
      { token },
    );
  },
  map(token: string, params?: CdrMapQuery) {
    return request<ApiCdrMapResponse>(`/cdr-analytics/map${buildQueryString(params)}`, {
      token,
    });
  },
  roamingMap(token: string, params?: CdrRoamingMapQuery) {
    return request<ApiRoamingMapResponse>(
      `/cdr-analytics/roaming-map${buildQueryString(params)}`,
      { token },
    );
  },
};

export const roamingApi = {
  map(
    token: string,
    params?: RoamingIntelligenceQuery,
    options: { signal?: AbortSignal } = {},
  ) {
    return request<ApiRoamingIntelligenceResponse>(`/roaming/map${buildQueryString(params)}`, {
      token,
      signal: options.signal,
    });
  },
};

export const mobileFleetApi = {
  overview(token: string, params?: MobileFleetQuery) {
    return request<ApiMobileFleetOverview>(`/mobile-fleet/overview${buildQueryString(params)}`, { token });
  },
  advancedKpis(token: string) {
    return request<ApiMobileFleetAdvancedKpis>("/mobile-fleet/advanced-kpis", { token });
  },
  filters(token: string) {
    return request<ApiMobileFleetFilters>("/mobile-fleet/filters", { token });
  },
  devices(token: string, params?: MobileFleetQuery) {
    return request<ApiMobileFleetDeviceList>(`/mobile-fleet/devices${buildQueryString(params)}`, { token });
  },
  consumption(token: string, params?: MobileFleetQuery) {
    return request<ApiMobileFleetConsumption>(
      `/mobile-fleet/consumption${buildQueryString(params)}`,
      { token },
    );
  },
  recommendations(token: string, params?: MobileFleetQuery) {
    return request<ApiMobileFleetRecommendationList>(
      `/mobile-fleet/recommendations${buildQueryString(params)}`,
      { token },
    );
  },
  reports(token: string, params?: MobileFleetQuery) {
    return request<ApiMobileFleetReports>(`/mobile-fleet/reports${buildQueryString(params)}`, { token });
  },
  healthScore(token: string) {
    return request<ApiFleetHealthScoreResponse>(`/fleet/health-score`, { token });
  },
};

export const notificationsApi = {
  list(
    token: string,
    params?: {
      filter?: ApiNotificationFilter;
      unread_only?: boolean;
      limit?: number;
      offset?: number;
    },
  ) {
    return request<ApiNotificationList>(`/notifications${buildQueryString(params)}`, { token });
  },
  unread(token: string, limit = 50) {
    return request<ApiNotification[]>(`/notifications/unread?limit=${limit}`, { token });
  },
  create(token: string, payload: CreateNotificationPayload) {
    return request<ApiNotification>("/notifications", {
      method: "POST",
      token,
      body: JSON.stringify(payload),
    });
  },
  markRead(token: string, notificationId: number) {
    return request<ApiNotification>(`/notifications/${notificationId}/read`, {
      method: "PUT",
      token,
    });
  },
  remove(token: string, notificationId: number) {
    return request<void>(`/notifications/${notificationId}`, {
      method: "DELETE",
      token,
    });
  },
};

export const fleetAccessApi = {
  departments(token: string, params?: { include_inactive?: boolean }) {
    return request<ApiDepartment[]>(`/fleet-access/departments${buildQueryString(params)}`, {
      token,
    });
  },
  createDepartment(token: string, payload: CreateDepartmentPayload) {
    return request<ApiDepartment>("/fleet-access/departments", {
      method: "POST",
      token,
      body: JSON.stringify(payload),
    });
  },
  updateDepartment(token: string, departmentId: number, payload: UpdateDepartmentPayload) {
    return request<ApiDepartment>(`/fleet-access/departments/${departmentId}`, {
      method: "PUT",
      token,
      body: JSON.stringify(payload),
    });
  },
  removeDepartment(token: string, departmentId: number) {
    return request<void>(`/fleet-access/departments/${departmentId}`, {
      method: "DELETE",
      token,
    });
  },
  users(token: string) {
    return request<ApiUser[]>("/fleet-access/users", { token });
  },
  resources(token: string) {
    return request<ApiFleetResource[]>("/fleet-access/resources", { token });
  },
  createResource(token: string, payload: CreateFleetResourcePayload) {
    return request<ApiFleetResource>("/fleet-access/resources", {
      method: "POST",
      token,
      body: JSON.stringify(payload),
    });
  },
  assignResource(token: string, resourceId: number, payload: AssignResourcePayload) {
    return request<ApiResourceAssignment>(`/fleet-access/resources/${resourceId}/assign`, {
      method: "POST",
      token,
      body: JSON.stringify(payload),
    });
  },
  assignResourceToUsers(token: string, resourceId: number, payload: AssignResourceUsersPayload) {
    return request<ApiResourceAssignment[]>(`/fleet-access/resources/${resourceId}/assign-users`, {
      method: "POST",
      token,
      body: JSON.stringify(payload),
    });
  },
  resourceAssignments(token: string, resourceId: number, includeHistory = false) {
    const suffix = includeHistory ? "?include_history=true" : "";
    return request<ApiResourceAssignment[]>(
      `/fleet-access/resources/${resourceId}/assignments${suffix}`,
      { token },
    );
  },
  revokeResource(token: string, resourceId: number, payload: RevokeResourcePayload) {
    return request<ApiResourceAssignment>(`/fleet-access/resources/${resourceId}/revoke`, {
      method: "POST",
      token,
      body: JSON.stringify(payload),
    });
  },
  revokeAssignment(token: string, assignmentId: number, payload: RevokeResourcePayload) {
    return request<ApiResourceAssignment>(`/fleet-access/assignments/${assignmentId}/revoke`, {
      method: "POST",
      token,
      body: JSON.stringify(payload),
    });
  },
  userAssignments(token: string, userId: number, includeHistory = false) {
    const suffix = includeHistory ? "?include_history=true" : "";
    return request<ApiResourceAssignment[]>(`/fleet-access/users/${userId}/resources${suffix}`, {
      token,
    });
  },
  assignResourcesToUser(token: string, userId: number, payload: AssignUserResourcesPayload) {
    return request<ApiResourceAssignment[]>(`/fleet-access/users/${userId}/assign-resources`, {
      method: "POST",
      token,
      body: JSON.stringify(payload),
    });
  },
  blockResource(token: string, resourceId: number, payload: BlockResourcePayload) {
    return request<ApiFleetResource>(`/fleet-access/resources/${resourceId}/block`, {
      method: "POST",
      token,
      body: JSON.stringify(payload),
    });
  },
  unblockResource(token: string, resourceId: number) {
    return request<ApiFleetResource>(`/fleet-access/resources/${resourceId}/unblock`, {
      method: "POST",
      token,
    });
  },
  assignments(token: string, includeHistory = false) {
    const suffix = includeHistory ? "?include_history=true" : "";
    return request<ApiResourceAssignment[]>(`/fleet-access/assignments${suffix}`, { token });
  },
  auditLogs(token: string, limit = 100) {
    return request<ApiFleetAccessAuditLog[]>(`/fleet-access/audit-logs?limit=${limit}`, { token });
  },
  usagePolicy(token: string, resourceId: number) {
    return request<ApiResourceUsagePolicy>(`/fleet-access/resources/${resourceId}/usage-policy`, {
      token,
    });
  },
  updateUsagePolicy(token: string, resourceId: number, payload: ApiResourceUsagePolicyPayload) {
    return request<ApiResourceUsagePolicy>(`/fleet-access/resources/${resourceId}/usage-policy`, {
      method: "PUT",
      token,
      body: JSON.stringify(payload),
    });
  },
  recordUsageLog(token: string, resourceId: number, payload: ApiUsageLogPayload) {
    return request<ApiUsageLog>(`/fleet-access/resources/${resourceId}/usage-logs`, {
      method: "POST",
      token,
      body: JSON.stringify(payload),
    });
  },
  resourceCompliance(token: string, resourceId: number) {
    return request<ApiResourceComplianceOverview>(`/fleet-access/resources/${resourceId}/compliance`, {
      token,
    });
  },
  suspendForCompliance(token: string, resourceId: number, payload: BlockResourcePayload) {
    return request<ApiFleetResource>(`/fleet-access/resources/${resourceId}/compliance-suspend`, {
      method: "POST",
      token,
      body: JSON.stringify(payload),
    });
  },
  usageLogs(
    token: string,
    params?: {
      resource_id?: number;
      user_id?: number;
      is_compliant?: boolean;
      limit?: number;
    },
  ) {
    return request<ApiUsageLog[]>(`/fleet-access/usage-logs${buildQueryString(params)}`, { token });
  },
  complianceAlerts(
    token: string,
    params?: {
      resource_id?: number;
      status?: ApiComplianceAlertStatus;
      severity?: ApiUsageSeverity;
      limit?: number;
    },
  ) {
    return request<ApiComplianceAlert[]>(
      `/fleet-access/compliance-alerts${buildQueryString(params)}`,
      { token },
    );
  },
  acknowledgeComplianceAlert(token: string, alertId: number) {
    return request<ApiComplianceAlert>(`/fleet-access/compliance-alerts/${alertId}/acknowledge`, {
      method: "POST",
      token,
    });
  },
  resolveComplianceAlert(token: string, alertId: number, notes?: string | null) {
    return request<ApiComplianceAlert>(`/fleet-access/compliance-alerts/${alertId}/resolve`, {
      method: "POST",
      token,
      body: JSON.stringify({ notes: notes ?? null }),
    });
  },
};

export const customerChurnApi = {
  overview(token: string, params?: CustomerChurnQuery) {
    return request<ApiCustomerChurnOverview>(`/customer-churn/overview${buildQueryString(params)}`, {
      token,
    });
  },
  consumption(token: string, params?: CustomerChurnQuery) {
    return request<ApiCustomerChurnConsumption>(
      `/customer-churn/consumption${buildQueryString(params)}`,
      { token },
    );
  },
  filters(token: string) {
    return request<ApiCustomerChurnFilters>("/customer-churn/filters", { token });
  },
  customers(token: string, params?: CustomerChurnQuery) {
    return request<ApiCustomerChurnCustomerList>(
      `/customer-churn/customers${buildQueryString(params)}`,
      { token },
    );
  },
  predictions(token: string, params?: CustomerChurnQuery) {
    return request<ApiCustomerChurnPredictionList>(
      `/customer-churn/predictions${buildQueryString(params)}`,
      { token },
    );
  },
  recommendations(token: string, params?: CustomerChurnQuery) {
    return request<ApiCustomerChurnRecommendationList>(
      `/customer-churn/recommendations${buildQueryString(params)}`,
      { token },
    );
  },
  reports(token: string, params?: CustomerChurnQuery) {
    return request<ApiCustomerChurnReports>(
      `/customer-churn/reports${buildQueryString(params)}`,
      { token },
    );
  },
};

export const plansApi = {
  list(token: string, params?: { offset?: number; limit?: number }) {
    return request<ApiPlan[]>(`/plans/${buildQueryString(params)}`, { token });
  },
  get(token: string, planId: number) {
    return request<ApiPlan>(`/plans/${planId}`, { token });
  },
  create(token: string, payload: CreatePlanPayload) {
    return request<ApiPlan>("/plans/", {
      method: "POST",
      token,
      body: JSON.stringify(payload),
    });
  },
  update(token: string, planId: number, payload: UpdatePlanPayload) {
    return request<ApiPlan>(`/plans/${planId}`, {
      method: "PUT",
      token,
      body: JSON.stringify(payload),
    });
  },
  remove(token: string, planId: number) {
    return request<void>(`/plans/${planId}`, {
      method: "DELETE",
      token,
    });
  },
  activatePlan(token: string, payload: ActivatePlanPayload) {
    return request<ApiPlanActivationResponse>("/plans/activate-plan", {
      method: "POST",
      token,
      body: JSON.stringify(payload),
    });
  },
  lifecycleImpact(token: string, planId: number) {
    return request<ApiPlanLifecycleImpact>(`/plans/${planId}/lifecycle-impact`, { token });
  },
  deactivate(token: string, planId: number) {
    return request<ApiPlanDeactivationResponse>(`/plans/${planId}/deactivate`, {
      method: "PATCH",
      token,
    });
  },
  replace(token: string, planId: number, payload: ReplacePlanPayload) {
    return request<ApiPlanReplacementResponse>(`/plans/${planId}/replace`, {
      method: "POST",
      token,
      body: JSON.stringify(payload),
    });
  },
};

export function formatRoleLabel(role: string): string {
  const normalizedRole = role.trim().toLowerCase();

  if (normalizedRole === "super_admin") {
    return "Super administrateur";
  }
  if (normalizedRole === "admin") {
    return "Administrateur";
  }
  if (normalizedRole === "company_admin") {
    return "Admin entreprise";
  }
  if (normalizedRole === "manager") {
    return "Manager";
  }
  if (normalizedRole === "user") {
    return "Utilisateur";
  }
  if (normalizedRole === "analyst") {
    return "Analyste";
  }

  return role;
}

export function formatCompanyRequestedRoleLabel(role: string): string {
  const normalizedRole = role.trim().toUpperCase();

  if (normalizedRole === "ADMIN") {
    return "Administrateur";
  }
  if (normalizedRole === "MANAGER") {
    return "Manager";
  }
  if (normalizedRole === "ANALYST" || normalizedRole === "ANALYSTE") {
    return "Analyste";
  }

  return role;
}

export function getUserInitials(fullName: string): string {
  const initials = fullName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return initials || "A";
}

export function getGeneratedAvatarUrl(fullName: string): string {
  const seed = encodeURIComponent(fullName.trim() || "Utilisateur");
  return `https://api.dicebear.com/9.x/initials/svg?seed=${seed}&backgroundColor=2563eb,7c3aed,06b6d4,16a34a,f59e0b,dc2626&backgroundType=gradientLinear&fontSize=38&fontWeight=600`;
}

export function getUserAvatarUrl(fullName: string, photoUrl?: string | null): string {
  const normalizedPhotoUrl = photoUrl?.trim();
  return normalizedPhotoUrl || getGeneratedAvatarUrl(fullName);
}
