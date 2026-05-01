import {
  clearStoredSession,
  hasPersistentSession,
  readStoredSession,
  writeStoredSession,
} from "./auth-session";

export type ApiUserRole = "admin" | "manager" | "user" | "analyst";
export type ApiUserStatus = "active" | "suspended";

export interface ApiUser {
  id: number;
  full_name: string;
  email: string;
  photo_url: string | null;
  role: ApiUserRole;
  department_id: number | null;
  department_name: string | null;
  job_profile: string | null;
  is_active: boolean;
  status: ApiUserStatus;
  updated_at: string;
  last_login_at: string | null;
  created_at: string;
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
  role: ApiUserRole;
  department_id?: number | null;
  job_profile?: string | null;
  is_active: boolean;
}

export interface UpdateUserPayload {
  full_name?: string;
  email?: string;
  password?: string | null;
  photo_url?: string | null;
  role?: ApiUserRole;
  department_id?: number | null;
  job_profile?: string | null;
  is_active?: boolean;
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

  constructor(message: string, status: number, details: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

const API_BASE_URL =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ??
  "http://127.0.0.1:8000/api/v1";

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
      return null;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
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

      return refreshedSession.access_token;
    } catch {
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
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...rest,
      body,
      headers: buildHeaders(headers, token, body),
    });
  } catch (error) {
    throw new ApiError(
      "Connexion backend impossible. Verifiez que l'API est demarree et accessible depuis l'application.",
      0,
      error,
    );
  }

  const payload = await parsePayload(response);

  if (response.status === 401 && token && allowRefresh) {
    const refreshedToken = await tryRefreshAccessToken();
    if (refreshedToken) {
      return request<T>(path, { ...options, token: refreshedToken }, false);
    }
  }

  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "detail" in payload &&
      typeof payload.detail === "string"
        ? payload.detail
        : typeof payload === "string"
          ? payload
          : "Backend request failed";
    throw new ApiError(message, response.status, payload);
  }

  return payload as T;
}

export const authApi = {
  login(payload: LoginPayload) {
    return request<AuthResponse>("/auth/login", {
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
  get(token: string, userId: number) {
    return request<ApiUser>(`/users/${userId}`, { token });
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
};

export const mobileFleetApi = {
  overview(token: string, params?: MobileFleetQuery) {
    return request<ApiMobileFleetOverview>(`/mobile-fleet/overview${buildQueryString(params)}`, { token });
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

  if (normalizedRole === "admin") {
    return "Administrateur";
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
