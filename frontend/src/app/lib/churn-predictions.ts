import type { ApiCustomerChurnPrediction } from "./api";
import { formatContractLabel, formatInternetServiceLabel } from "./customer-churn";

export type ChurnPriorityLevel = "P1" | "P2" | "P3";
export type ChurnActionType = "forfait" | "offre" | "commercial";

export interface ChurnPredictionSummary {
  averageMonthlyCostMad: number;
  maxRevenueAtRiskMad: number;
  averageRevenueAtRiskMad: number;
}

export interface EnrichedChurnPrediction extends ApiCustomerChurnPrediction {
  priorityLevel: ChurnPriorityLevel;
  priorityScore: number;
  whyRisk: string[];
  actionType: ChurnActionType;
  actionTitle: string;
  actionSummary: string;
  actionBadge: string;
  quickSummary: string;
  simulatedChurnReductionPct: number;
  simulatedFinancialGainMad: number;
  simulatedRetainedCustomers: number;
}

export function buildPredictionSummary(
  customers: ApiCustomerChurnPrediction[],
): ChurnPredictionSummary {
  if (customers.length === 0) {
    return {
      averageMonthlyCostMad: 0,
      maxRevenueAtRiskMad: 0,
      averageRevenueAtRiskMad: 0,
    };
  }

  const totalMonthlyCostMad = customers.reduce((sum, customer) => sum + customer.monthly_cost_mad, 0);
  const totalRevenueAtRiskMad = customers.reduce((sum, customer) => sum + customer.revenue_at_risk_mad, 0);

  return {
    averageMonthlyCostMad: totalMonthlyCostMad / customers.length,
    maxRevenueAtRiskMad: customers.reduce(
      (maxValue, customer) => Math.max(maxValue, customer.revenue_at_risk_mad),
      0,
    ),
    averageRevenueAtRiskMad: totalRevenueAtRiskMad / customers.length,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalizeFactor(factor: string): string {
  return factor.trim().toLowerCase();
}

export function getPriorityLevel(priorityScore: number): ChurnPriorityLevel {
  if (priorityScore >= 80) {
    return "P1";
  }
  if (priorityScore >= 60) {
    return "P2";
  }
  return "P3";
}

export function getPriorityScore(
  customer: ApiCustomerChurnPrediction,
  summary: ChurnPredictionSummary,
): number {
  const revenueShare = summary.maxRevenueAtRiskMad === 0
    ? 0
    : (customer.revenue_at_risk_mad / summary.maxRevenueAtRiskMad) * 100;
  const criticalBoost = customer.risk_level === "Critique" ? 10 : customer.risk_level === "Eleve" ? 5 : 0;

  return Math.round(
    clamp(
      customer.risk_score_100 * 0.72 +
        revenueShare * 0.22 +
        criticalBoost +
        (customer.predicted_churn ? 3 : 0),
      0,
      100,
    ),
  );
}

function buildRiskReasons(
  customer: ApiCustomerChurnPrediction,
  summary: ChurnPredictionSummary,
): string[] {
  const reasons: string[] = [];
  const normalizedFactors = customer.key_factors.map(normalizeFactor);

  if (
    customer.monthly_cost_mad >= summary.averageMonthlyCostMad * 1.12 ||
    normalizedFactors.some((factor) => factor.includes("high monthly charges"))
  ) {
    reasons.push("Cout mensuel eleve par rapport au portefeuille comparable.");
  }

  if (customer.contract.trim().toLowerCase() === "month-to-month") {
    reasons.push("Contrat mensuel plus exposé a l'attrition que les engagements longs.");
  }

  if (customer.tenure < 12 || normalizedFactors.some((factor) => factor.includes("short tenure"))) {
    reasons.push("Anciennete faible, donc relation client encore fragile.");
  }

  if (
    customer.internet_service.trim().toLowerCase() === "dsl" ||
    customer.internet_service.trim().toLowerCase() === "no internet service"
  ) {
    reasons.push("Valeur d'usage percue faible face au prix du service actuel.");
  }

  if (customer.future_cost_pred_mad > customer.future_cost_mad * 1.08) {
    reasons.push("Projection de cout future en hausse, susceptible d'accelerer le churn.");
  }

  if (
    normalizedFactors.some((factor) => factor.includes("electronic check")) ||
    normalizedFactors.some((factor) => factor.includes("fiber optic"))
  ) {
    reasons.push("Profil proche des segments a churn historique eleve sur les cohortes similaires.");
  }

  if (reasons.length === 0) {
    reasons.push("Le score IA combine sensibilite prix, engagement et profil de service.");
  }

  return reasons.slice(0, 4);
}

function buildActionPlan(
  customer: ApiCustomerChurnPrediction,
  summary: ChurnPredictionSummary,
): Pick<EnrichedChurnPrediction, "actionType" | "actionTitle" | "actionSummary" | "actionBadge" | "quickSummary"> {
  const normalizedContract = customer.contract.trim().toLowerCase();
  const revenueHigh = customer.revenue_at_risk_mad >= summary.averageRevenueAtRiskMad;
  const priceHigh = customer.monthly_cost_mad >= summary.averageMonthlyCostMad * 1.1;
  const serviceLabel = formatInternetServiceLabel(customer.internet_service).toLowerCase();

  if (priceHigh && normalizedContract === "month-to-month") {
    return {
      actionType: "forfait",
      actionTitle: "Changer forfait",
      actionSummary: "Proposer une offre plus proportionnee pour reduire la sensibilite prix sans perdre le client.",
      actionBadge: "Optimisation forfait",
      quickSummary: `Basculer vers une formule plus stable sur ${serviceLabel}.`,
    };
  }

  if (revenueHigh || customer.risk_proba >= 0.9) {
    return {
      actionType: "offre",
      actionTitle: "Offrir reduction",
      actionSummary: "Declencher une offre de retention ciblee pour absorber le risque prix immediat.",
      actionBadge: "Offre retention",
      quickSummary: "Reduction commerciale courte duree a enclencher.",
    };
  }

  return {
    actionType: "commercial",
    actionTitle: "Intervention commerciale",
    actionSummary: "Appel proactif pour requalifier le besoin, traiter l'insatisfaction et verrouiller l'engagement.",
    actionBadge: "Contact prioritaire",
    quickSummary: `Prendre contact sur le contrat ${formatContractLabel(customer.contract).toLowerCase()}.`,
  };
}

function buildSimulation(
  customer: ApiCustomerChurnPrediction,
  actionType: ChurnActionType,
): Pick<
  EnrichedChurnPrediction,
  "simulatedChurnReductionPct" | "simulatedFinancialGainMad" | "simulatedRetainedCustomers"
> {
  const actionBase =
    actionType === "offre" ? 26 : actionType === "forfait" ? 21 : 18;
  const churnReductionPct = clamp(actionBase + customer.risk_proba * 14, 8, 44);
  const financialGainMad = customer.revenue_at_risk_mad * (0.42 + customer.risk_proba * 0.18);

  return {
    simulatedChurnReductionPct: churnReductionPct,
    simulatedFinancialGainMad: financialGainMad,
    simulatedRetainedCustomers: financialGainMad > 0 ? 1 : 0,
  };
}

export function enrichPrediction(
  customer: ApiCustomerChurnPrediction,
  summary: ChurnPredictionSummary,
): EnrichedChurnPrediction {
  const priorityScore = getPriorityScore(customer, summary);
  const actionPlan = buildActionPlan(customer, summary);
  const simulation = buildSimulation(customer, actionPlan.actionType);

  return {
    ...customer,
    priorityLevel: getPriorityLevel(priorityScore),
    priorityScore,
    whyRisk: buildRiskReasons(customer, summary),
    ...actionPlan,
    ...simulation,
  };
}
