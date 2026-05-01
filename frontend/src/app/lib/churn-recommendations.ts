import type { ApiCustomerChurnRecommendation } from "./api";
import { formatContractLabel, formatInternetServiceLabel } from "./customer-churn";

export type RecommendationKind = "forfait" | "churn" | "fraude";
export type RecommendationPriorityLevel = "P1" | "P2" | "P3";

export interface RecommendationSummary {
  averageMonthlyCostMad: number;
  averageRevenueAtRiskMad: number;
  maxRevenueAtRiskMad: number;
}

export interface EnrichedRecommendation extends ApiCustomerChurnRecommendation {
  recommendationKind: RecommendationKind;
  recommendationKindLabel: string;
  priorityLevel: RecommendationPriorityLevel;
  priorityScore: number;
  whyRecommendation: string[];
  quickSummary: string;
  simulatedFinancialGainMad: number;
  simulatedRiskReductionPct: number;
  simulatedImpactedLines: number;
  estimatedOptimizedCostMad: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalizeFactor(value: string): string {
  return value.trim().toLowerCase();
}

export function buildRecommendationSummary(
  recommendations: ApiCustomerChurnRecommendation[],
): RecommendationSummary {
  if (recommendations.length === 0) {
    return {
      averageMonthlyCostMad: 0,
      averageRevenueAtRiskMad: 0,
      maxRevenueAtRiskMad: 0,
    };
  }

  const totalMonthlyCostMad = recommendations.reduce(
    (sum, recommendation) => sum + recommendation.monthly_cost_mad,
    0,
  );
  const totalRevenueAtRiskMad = recommendations.reduce(
    (sum, recommendation) => sum + recommendation.revenue_at_risk_mad,
    0,
  );

  return {
    averageMonthlyCostMad: totalMonthlyCostMad / recommendations.length,
    averageRevenueAtRiskMad: totalRevenueAtRiskMad / recommendations.length,
    maxRevenueAtRiskMad: recommendations.reduce(
      (maxValue, recommendation) => Math.max(maxValue, recommendation.revenue_at_risk_mad),
      0,
    ),
  };
}

function getRecommendationKindLabel(kind: RecommendationKind): string {
  if (kind === "forfait") {
    return "Optimisation forfait";
  }
  if (kind === "fraude") {
    return "Controle fraude";
  }
  return "Retention churn";
}

function detectRecommendationKind(
  recommendation: ApiCustomerChurnRecommendation,
  summary: RecommendationSummary,
): RecommendationKind {
  const normalizedRecommendation = recommendation.recommendation.toLowerCase();
  const normalizedReason = recommendation.recommendation_reason.toLowerCase();
  const normalizedFactors = recommendation.key_factors.map(normalizeFactor);
  const costGap =
    recommendation.future_cost_pred_mad > 0
      ? (recommendation.future_cost_pred_mad - recommendation.future_cost_mad) /
        recommendation.future_cost_pred_mad
      : 0;
  const priceHigh =
    summary.averageMonthlyCostMad > 0 &&
    recommendation.monthly_cost_mad >= summary.averageMonthlyCostMad * 1.08;

  if (
    priceHigh ||
    normalizedRecommendation.includes("forfait") ||
    normalizedRecommendation.includes("offre") ||
    normalizedReason.includes("prix") ||
    normalizedFactors.some((factor) => factor.includes("high monthly charges"))
  ) {
    return "forfait";
  }

  if (
    costGap >= 0.18 ||
    normalizedRecommendation.includes("surveiller") ||
    normalizedRecommendation.includes("analyser") ||
    normalizedReason.includes("anomal") ||
    normalizedFactors.some((factor) => factor.includes("electronic check")) ||
    normalizedFactors.some((factor) => factor.includes("multiple lines"))
  ) {
    return "fraude";
  }

  return "churn";
}

export function getPriorityLevel(score: number): RecommendationPriorityLevel {
  if (score >= 82) {
    return "P1";
  }
  if (score >= 64) {
    return "P2";
  }
  return "P3";
}

function buildPriorityScore(
  recommendation: ApiCustomerChurnRecommendation,
  summary: RecommendationSummary,
  kind: RecommendationKind,
): number {
  const revenueShare =
    summary.maxRevenueAtRiskMad === 0
      ? 0
      : (recommendation.revenue_at_risk_mad / summary.maxRevenueAtRiskMad) * 100;
  const criticalBoost =
    recommendation.risk_level === "Critique" ? 10 : recommendation.risk_level === "Eleve" ? 5 : 0;
  const kindBoost = kind === "fraude" ? 7 : kind === "forfait" ? 6 : 4;

  return Math.round(
    clamp(
      recommendation.risk_score_100 * 0.63 +
        revenueShare * 0.24 +
        criticalBoost +
        kindBoost +
        (recommendation.predicted_churn ? 4 : 0),
      0,
      100,
    ),
  );
}

function buildWhyRecommendation(
  recommendation: ApiCustomerChurnRecommendation,
  summary: RecommendationSummary,
  kind: RecommendationKind,
): string[] {
  const reasons: string[] = [];
  const normalizedFactors = recommendation.key_factors.map(normalizeFactor);
  const priceHigh =
    summary.averageMonthlyCostMad > 0 &&
    recommendation.monthly_cost_mad >= summary.averageMonthlyCostMad * 1.08;
  const costGap =
    recommendation.future_cost_pred_mad > 0
      ? (recommendation.future_cost_pred_mad - recommendation.future_cost_mad) /
        recommendation.future_cost_pred_mad
      : 0;

  if (priceHigh || normalizedFactors.some((factor) => factor.includes("high monthly charges"))) {
    reasons.push("Cout mensuel eleve par rapport aux profils comparables.");
  }

  if (
    recommendation.internet_service.trim().toLowerCase() === "dsl" ||
    recommendation.internet_service.trim().toLowerCase() === "no internet service"
  ) {
    reasons.push("Usage percu trop faible pour le service actuellement facture.");
  }

  if (
    recommendation.predicted_churn ||
    recommendation.contract.trim().toLowerCase() === "month-to-month" ||
    recommendation.risk_score_100 >= 85
  ) {
    reasons.push("Risque churn structurel eleve sur ce segment client.");
  }

  if (kind === "fraude" || costGap >= 0.18) {
    reasons.push("Anomalies de cout ou d'usage a surveiller avant escalation.");
  }

  if (normalizedFactors.some((factor) => factor.includes("fiber optic"))) {
    reasons.push("Profil proche des cohortes a attrition historique sur la fibre optique.");
  }

  if (reasons.length === 0) {
    reasons.push("Le moteur IA combine sensibilite prix, usage et exposition au churn.");
  }

  return reasons.slice(0, 4);
}

function buildQuickSummary(
  recommendation: ApiCustomerChurnRecommendation,
  kind: RecommendationKind,
): string {
  if (kind === "forfait") {
    return `Reallouer le client vers un forfait plus proportionne au service ${formatInternetServiceLabel(
      recommendation.internet_service,
    ).toLowerCase()}.`;
  }
  if (kind === "fraude") {
    return "Verifier rapidement les signaux d'usage anormal pour contenir le risque et le cout.";
  }
  return `Renforcer la retention sur le contrat ${formatContractLabel(recommendation.contract).toLowerCase()} avant depart client.`;
}

function buildSimulation(
  recommendation: ApiCustomerChurnRecommendation,
  kind: RecommendationKind,
  summary: RecommendationSummary,
): Pick<
  EnrichedRecommendation,
  | "simulatedFinancialGainMad"
  | "simulatedRiskReductionPct"
  | "simulatedImpactedLines"
  | "estimatedOptimizedCostMad"
> {
  const baseRiskReduction = kind === "churn" ? 24 : kind === "forfait" ? 19 : 16;
  const simulatedRiskReductionPct = clamp(
    baseRiskReduction + recommendation.risk_proba * 17 + (recommendation.risk_level === "Critique" ? 5 : 0),
    10,
    48,
  );
  const optimizationRatio = kind === "forfait" ? 0.46 : kind === "fraude" ? 0.34 : 0.4;
  const simulatedFinancialGainMad =
    recommendation.revenue_at_risk_mad * optimizationRatio +
    Math.max(0, recommendation.future_cost_pred_mad - recommendation.future_cost_mad) * 0.55;
  const simulatedImpactedLines = clamp(
    Math.round(
      1 +
        (summary.averageMonthlyCostMad > 0
          ? recommendation.monthly_cost_mad / summary.averageMonthlyCostMad
          : 1) +
        (kind === "fraude" ? 1 : 0) +
        (recommendation.key_factors.some((factor) => normalizeFactor(factor).includes("multiple lines"))
          ? 2
          : 0),
    ),
    1,
    12,
  );
  const estimatedOptimizedCostMad = Math.max(
    recommendation.future_cost_mad,
    recommendation.future_cost_pred_mad - simulatedFinancialGainMad,
  );

  return {
    simulatedFinancialGainMad,
    simulatedRiskReductionPct,
    simulatedImpactedLines,
    estimatedOptimizedCostMad,
  };
}

export function enrichRecommendation(
  recommendation: ApiCustomerChurnRecommendation,
  summary: RecommendationSummary,
): EnrichedRecommendation {
  const recommendationKind = detectRecommendationKind(recommendation, summary);
  const priorityScore = buildPriorityScore(recommendation, summary, recommendationKind);

  return {
    ...recommendation,
    recommendationKind,
    recommendationKindLabel: getRecommendationKindLabel(recommendationKind),
    priorityLevel: getPriorityLevel(priorityScore),
    priorityScore,
    whyRecommendation: buildWhyRecommendation(recommendation, summary, recommendationKind),
    quickSummary: buildQuickSummary(recommendation, recommendationKind),
    ...buildSimulation(recommendation, recommendationKind, summary),
  };
}
