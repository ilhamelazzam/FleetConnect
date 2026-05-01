import {
  type ApiCdrAlert,
  type ApiCdrOverview,
  type ApiCdrRecommendation,
  type ApiCustomerChurnOverview,
  type ApiCustomerChurnPrediction,
  type ApiMobileFleetDevice,
  type ApiMobileFleetOverview,
} from "./api";
import {
  formatContractLabel,
  formatCustomerFactorLabel,
  formatInternetServiceLabel,
  formatRiskProbability,
} from "./customer-churn";
import { formatCallZoneLabel, formatFraudTypeLabel, formatMadValue } from "./cdr-analytics";

export const DASHBOARD_RISK_LEVELS = ["Critique", "Eleve", "Moyen", "Faible"] as const;

export type DashboardRiskLevel = (typeof DASHBOARD_RISK_LEVELS)[number];

export interface DashboardAction {
  id: string;
  module: "Flotte mobile" | "Risque client" | "Fraude CDR";
  severity: DashboardRiskLevel;
  title: string;
  summary: string;
  explanation: string;
  recommendation: string;
  suggestedAction: string;
  confidenceScore: number;
  metric: string;
  detail: string;
}

export interface DashboardCriticalRisk {
  id: string;
  module: "Mobile" | "Churn" | "Fraude";
  severity: DashboardRiskLevel;
  title: string;
  context: string;
  impactValue: number;
  impact: string;
  scoreValue: number;
  scoreLabel: string;
  explanation: string;
  recommendation: string;
  suggestedAction: string;
  confidenceScore: number;
}

export interface DashboardDepartmentInsight {
  department: string;
  severity: DashboardRiskLevel;
  financialExposureMad: number;
  attentionPoints: number;
  mobileBudgetMad: number;
  mobileAlertDevices: number;
  mobileAverageScore: number;
  churnRevenueAtRiskMad: number;
  churnPredictedCustomers: number;
  churnAverageScore: number;
  fraudAlerts: number;
  fraudIntensityScore: number;
  summary: string;
}

export interface DashboardFraudPriority extends ApiCdrAlert {
  recommendation_reason: string;
}

function formatScore(value: number): string {
  return `${value.toFixed(1)}/100`;
}

function joinReasons(reasons: string[]): string {
  if (reasons.length === 0) {
    return "";
  }

  if (reasons.length === 1) {
    return reasons[0];
  }

  if (reasons.length === 2) {
    return `${reasons[0]} et ${reasons[1]}`;
  }

  return `${reasons.slice(0, -1).join(", ")} et ${reasons[reasons.length - 1]}`;
}

export function getDashboardRiskRank(riskLevel: DashboardRiskLevel): number {
  return DASHBOARD_RISK_LEVELS.indexOf(riskLevel);
}

export function getDashboardRiskFromScore(score: number): DashboardRiskLevel {
  if (score >= 80) {
    return "Critique";
  }
  if (score >= 60) {
    return "Eleve";
  }
  if (score >= 40) {
    return "Moyen";
  }
  return "Faible";
}

export function getDashboardRiskFromSeverity(severity: string): DashboardRiskLevel {
  const normalized = severity.trim().toLowerCase();

  if (normalized === "critique") {
    return "Critique";
  }
  if (normalized === "eleve") {
    return "Eleve";
  }
  if (normalized === "moyen") {
    return "Moyen";
  }
  return "Faible";
}

export function buildMobileExplanation(device: ApiMobileFleetDevice): string {
  const reasons: string[] = [];

  if (device.budget_risk_score >= 80) {
    reasons.push(`score budget ${formatScore(device.budget_risk_score)}`);
  }
  if (device.estimated_price_mad >= 6000) {
    reasons.push(`cout eleve ${formatMadValue(device.estimated_price_mad)}`);
  }
  if (device.device_category === "Premium") {
    reasons.push("categorie premium");
  }
  if (device.employee_profile.toLowerCase().includes("premium")) {
    reasons.push("usage premium");
  }
  if (device.employee_profile.toLowerCase().includes("intensif")) {
    reasons.push("usage intensif");
  }
  if (reasons.length === 0 && device.risk_level !== "Faible") {
    reasons.push(`niveau ${device.risk_level.toLowerCase()}`);
  }

  if (reasons.length === 0) {
    return "Priorisation basee sur la combinaison cout, score budgetaire et recommandation IA.";
  }

  return `Risque motive par ${joinReasons(reasons)}.`;
}

export function buildCustomerExplanation(customer: ApiCustomerChurnPrediction): string {
  if (customer.key_factors.length > 0) {
    return `Probabilite de churn tiree par ${joinReasons(
      customer.key_factors.map((factor) => formatCustomerFactorLabel(factor).toLowerCase()),
    )}.`;
  }

  const reasons: string[] = [];
  if (customer.contract === "Month-to-month") {
    reasons.push("contrat mensuel");
  }
  if (customer.monthly_cost_mad >= 700) {
    reasons.push(`facturation ${formatMadValue(customer.monthly_cost_mad)}`);
  }
  if (customer.tenure <= 12) {
    reasons.push("anciennete faible");
  }

  if (reasons.length === 0) {
    return "Probabilite de churn elevee selon le score IA et la valeur client.";
  }

  return `Probabilite de churn tiree par ${joinReasons(reasons)}.`;
}

export function buildFraudExplanation(alert: DashboardFraudPriority): string {
  if (alert.recommendation_reason) {
    return alert.recommendation_reason;
  }

  const reasons: string[] = [];
  if (alert.call_zone.toLowerCase().includes("international")) {
    reasons.push("zone internationale");
  }
  if (alert.call_cost_mad >= 300) {
    reasons.push(`cout ${formatMadValue(alert.call_cost_mad)}`);
  }
  if (alert.fraud_type !== "none") {
    reasons.push(`type ${formatFraudTypeLabel(alert.fraud_type).toLowerCase()}`);
  }

  if (reasons.length === 0) {
    return "Suspicion basee sur le score fraude et la recommandation du moteur CDR.";
  }

  return `Suspicion motivee par ${joinReasons(reasons)}.`;
}

export function mergeFraudPriorityAlerts(
  overview: ApiCdrOverview | null,
  recommendations: ApiCdrRecommendation[],
): DashboardFraudPriority[] {
  if (!overview) {
    return [];
  }

  const recommendationMap = new Map(
    recommendations.map((recommendation) => [recommendation.cdr_row_id, recommendation]),
  );

  return overview.priority_alerts.map((alert) => ({
    ...alert,
    recommendation_reason: recommendationMap.get(alert.cdr_row_id)?.recommendation_reason ?? "",
  }));
}

export function buildPriorityActions(
  mobileOverview: ApiMobileFleetOverview | null,
  customerOverview: ApiCustomerChurnOverview | null,
  fraudAlerts: DashboardFraudPriority[],
): DashboardAction[] {
  const actions: DashboardAction[] = [];

  const mobileDepartment = mobileOverview?.budget_by_department
    ?.slice()
    .sort(
      (left, right) =>
        right.average_budget_risk_score - left.average_budget_risk_score ||
        right.alert_devices - left.alert_devices ||
        right.total_estimated_price_mad - left.total_estimated_price_mad,
    )[0];
  const mobileDevice = mobileOverview?.top_devices?.[0];

  if (mobileDepartment) {
    actions.push({
      id: "mobile-budget-action",
      module: "Flotte mobile",
      severity: getDashboardRiskFromScore(mobileDepartment.average_budget_risk_score),
      title: `Reduire le budget appareils sur ${mobileDepartment.label}`,
      summary: `${mobileDepartment.alert_devices} appareils en alerte pour ${formatMadValue(
        mobileDepartment.total_estimated_price_mad,
      )} de budget estime.`,
      explanation: mobileDevice
        ? buildMobileExplanation(mobileDevice)
        : "Verifier l'affectation et la categorie d'appareil.",
      recommendation:
        mobileDevice?.ai_recommendation ||
        "Optimiser le forfait ou requalifier la categorie de l'appareil.",
      suggestedAction:
        mobileDevice?.suggested_action ||
        "Comparer le cout estime au besoin metier avant renouvellement.",
      confidenceScore: mobileDevice?.confidence_score ?? 0.72,
      metric: `Score moyen ${formatScore(mobileDepartment.average_budget_risk_score)}`,
      detail: mobileDevice
        ? `Priorite actuelle: Appareil-${mobileDevice.fleet_row_id} a ${formatMadValue(mobileDevice.estimated_price_mad)}`
        : "Aucun appareil prioritaire disponible.",
    });
  }

  const highValueCustomer = customerOverview?.top_at_risk_customers
    ?.slice()
    .sort(
      (left, right) =>
        right.revenue_at_risk_mad - left.revenue_at_risk_mad ||
        right.risk_score_100 - left.risk_score_100,
    )[0];

  if (highValueCustomer) {
    actions.push({
      id: "customer-retention-action",
      module: "Risque client",
      severity: highValueCustomer.risk_level as DashboardRiskLevel,
      title: `Retenir ${highValueCustomer.customer_id} avant churn`,
      summary: `${formatMadValue(highValueCustomer.revenue_at_risk_mad)} de revenu mensuel expose avec ${formatRiskProbability(
        highValueCustomer.risk_proba,
      )} de probabilite.`,
      explanation: buildCustomerExplanation(highValueCustomer),
      recommendation: highValueCustomer.ai_recommendation,
      suggestedAction: highValueCustomer.suggested_action,
      confidenceScore: highValueCustomer.confidence_score,
      metric: `Score churn ${formatScore(highValueCustomer.risk_score_100)}`,
      detail: `${highValueCustomer.department} - ${formatContractLabel(highValueCustomer.contract)} - ${formatInternetServiceLabel(highValueCustomer.internet_service)}`,
    });
  }

  const fraudAlert = fraudAlerts[0];
  if (fraudAlert) {
    actions.push({
      id: "fraud-monitoring-action",
      module: "Fraude CDR",
      severity: getDashboardRiskFromSeverity(fraudAlert.severity),
      title: `Monitorer l'alerte CDR #${fraudAlert.cdr_row_id}`,
      summary: `${formatFraudTypeLabel(fraudAlert.fraud_type)} detecte en ${formatCallZoneLabel(fraudAlert.call_zone)} pour ${formatMadValue(
        fraudAlert.call_cost_mad,
      )}.`,
      explanation: buildFraudExplanation(fraudAlert),
      recommendation: fraudAlert.ai_recommendation,
      suggestedAction: fraudAlert.suggested_action,
      confidenceScore: fraudAlert.confidence_score,
      metric: `Score fraude ${formatScore(fraudAlert.fraud_risk_score_100)}`,
      detail: `${fraudAlert.department} - ${fraudAlert.operator_maroc}`,
    });
  }

  return actions;
}

export function buildCriticalRisks(
  mobileOverview: ApiMobileFleetOverview | null,
  customerOverview: ApiCustomerChurnOverview | null,
  fraudAlerts: DashboardFraudPriority[],
): DashboardCriticalRisk[] {
  const mobileRisks: DashboardCriticalRisk[] =
    mobileOverview?.top_devices.map((device) => ({
      id: `mobile-${device.fleet_row_id}`,
      module: "Mobile",
      severity: device.risk_level as DashboardRiskLevel,
      title: `Appareil-${device.fleet_row_id}`,
      context: `${device.department} - ${device.employee_profile} - ${device.device_category}`,
      impactValue: device.estimated_price_mad,
      impact: formatMadValue(device.estimated_price_mad),
      scoreValue: device.budget_risk_score,
      scoreLabel: `Score budget ${formatScore(device.budget_risk_score)}`,
      explanation: buildMobileExplanation(device),
      recommendation: device.recommendation,
      suggestedAction: device.suggested_action,
      confidenceScore: device.confidence_score,
    })) ?? [];

  const customerRisks: DashboardCriticalRisk[] =
    customerOverview?.top_at_risk_customers.map((customer) => ({
      id: `customer-${customer.customer_row_id}`,
      module: "Churn",
      severity: customer.risk_level as DashboardRiskLevel,
      title: customer.customer_id,
      context: `${customer.department} - ${formatContractLabel(customer.contract)} - ${formatInternetServiceLabel(customer.internet_service)}`,
      impactValue: customer.revenue_at_risk_mad,
      impact: formatMadValue(customer.revenue_at_risk_mad),
      scoreValue: customer.risk_score_100,
      scoreLabel: `Score churn ${formatScore(customer.risk_score_100)}`,
      explanation: buildCustomerExplanation(customer),
      recommendation: customer.recommendation,
      suggestedAction: customer.suggested_action,
      confidenceScore: customer.confidence_score,
    })) ?? [];

  const fraudRisks: DashboardCriticalRisk[] = fraudAlerts.map((alert) => ({
    id: `fraud-${alert.cdr_row_id}`,
    module: "Fraude",
    severity: getDashboardRiskFromSeverity(alert.severity),
    title: `CDR-${alert.cdr_row_id}`,
    context: `${alert.department} - ${formatCallZoneLabel(alert.call_zone)} - ${formatFraudTypeLabel(alert.fraud_type)}`,
    impactValue: alert.call_cost_mad,
    impact: formatMadValue(alert.call_cost_mad),
    scoreValue: alert.fraud_risk_score_100,
    scoreLabel: `Score fraude ${formatScore(alert.fraud_risk_score_100)}`,
    explanation: buildFraudExplanation(alert),
    recommendation: alert.recommendation,
    suggestedAction: alert.suggested_action,
    confidenceScore: alert.confidence_score,
  }));

  const combinedRisks = [...mobileRisks, ...customerRisks, ...fraudRisks].sort(
    (left, right) =>
      getDashboardRiskRank(left.severity) - getDashboardRiskRank(right.severity) ||
      right.impactValue - left.impactValue ||
      right.scoreValue - left.scoreValue ||
      left.title.localeCompare(right.title),
  );

  const criticalOnly = combinedRisks.filter((risk) => risk.severity === "Critique");
  if (criticalOnly.length >= 6) {
    return criticalOnly.slice(0, 6);
  }

  return [
    ...criticalOnly,
    ...combinedRisks
      .filter((risk) => risk.severity !== "Critique")
      .slice(0, Math.max(0, 6 - criticalOnly.length)),
  ];
}

export function buildDepartmentInsights(
  mobileOverview: ApiMobileFleetOverview | null,
  customerOverview: ApiCustomerChurnOverview | null,
  cdrOverview: ApiCdrOverview | null,
): DashboardDepartmentInsight[] {
  const insights = new Map<string, DashboardDepartmentInsight>();
  const fraudMaxAlerts = Math.max(...(cdrOverview?.alerts_by_department.map((item) => item.count) ?? [0]), 0);

  const ensureInsight = (department: string) => {
    const existingInsight = insights.get(department);
    if (existingInsight) {
      return existingInsight;
    }

    const createdInsight: DashboardDepartmentInsight = {
      department,
      severity: "Faible",
      financialExposureMad: 0,
      attentionPoints: 0,
      mobileBudgetMad: 0,
      mobileAlertDevices: 0,
      mobileAverageScore: 0,
      churnRevenueAtRiskMad: 0,
      churnPredictedCustomers: 0,
      churnAverageScore: 0,
      fraudAlerts: 0,
      fraudIntensityScore: 0,
      summary: "",
    };
    insights.set(department, createdInsight);
    return createdInsight;
  };

  for (const row of mobileOverview?.budget_by_department ?? []) {
    const insight = ensureInsight(row.label);
    insight.mobileBudgetMad = row.total_estimated_price_mad;
    insight.mobileAlertDevices = row.alert_devices;
    insight.mobileAverageScore = row.average_budget_risk_score;
  }

  for (const row of customerOverview?.risk_by_department ?? []) {
    const insight = ensureInsight(row.label);
    insight.churnRevenueAtRiskMad = row.revenue_at_risk_mad;
    insight.churnPredictedCustomers = row.predicted_high_risk_customers;
    insight.churnAverageScore = row.average_risk_score;
  }

  for (const row of cdrOverview?.alerts_by_department ?? []) {
    const insight = ensureInsight(row.department);
    insight.fraudAlerts = row.count;
    insight.fraudIntensityScore = fraudMaxAlerts > 0 ? (row.count / fraudMaxAlerts) * 100 : 0;
  }

  return [...insights.values()]
    .map((insight) => {
      insight.financialExposureMad = insight.mobileBudgetMad + insight.churnRevenueAtRiskMad;
      insight.attentionPoints =
        insight.mobileAlertDevices + insight.churnPredictedCustomers + insight.fraudAlerts;

      const highestSignal = Math.max(
        insight.mobileAverageScore,
        insight.churnAverageScore,
        insight.fraudIntensityScore,
      );

      insight.severity = getDashboardRiskFromScore(highestSignal);
      insight.summary = `${formatMadValue(insight.mobileBudgetMad)} device, ${formatMadValue(
        insight.churnRevenueAtRiskMad,
      )} revenu a risque, ${insight.fraudAlerts} alertes fraude.`;
      return insight;
    })
    .filter((insight) => insight.financialExposureMad > 0 || insight.attentionPoints > 0)
    .sort(
      (left, right) =>
        getDashboardRiskRank(left.severity) - getDashboardRiskRank(right.severity) ||
        right.financialExposureMad - left.financialExposureMad ||
        right.attentionPoints - left.attentionPoints,
    );
}
