import type { ApiPhoneLine, ApiPlan } from "./api";
import {
  type TelecomAssistantAlert,
  type TelecomAssistantBudgetEntry,
  type TelecomAssistantDataset,
  type TelecomAssistantRecommendation,
} from "./chatbot-data";

export interface TelecomAssistantContextMessage {
  role: "assistant" | "user";
  text: string;
}

export interface TelecomAssistantReply {
  text: string;
  bullets: string[];
  recommendation?: string;
  ctaLabel?: string;
  ctaPath?: string;
  suggestions: string[];
  titleHint?: string;
  sources?: string[];
}

export const assistantQuestionSuggestions = [
  "Que faire cette semaine ?",
  "Compare Finance et IT",
  "Quel budget risque de deraper le mois prochain ?",
  "Quels pays roaming concentrent le plus de risque ?",
  "Quels forfaits sont trop chers ?",
  "Montre-moi les lignes critiques",
  "Quelle est la meilleure optimisation ?",
  "Pourquoi Maroc Telecom est en depassement ?",
  "Plan d'action IA hebdomadaire",
];

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function formatMad(value: number): string {
  return `${new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 0,
  }).format(Math.round(value))} MAD`;
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatScore(value: number): string {
  return `${Math.round(value)}/100`;
}

function formatUsage(value: number): string {
  return `${value.toFixed(1)} Go`;
}

function formatLoadedAt(value: string): string {
  return new Date(value).toLocaleString("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function parseFirstNumber(value: string): number {
  const match = value.toLowerCase().replace(",", ".").match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : 0;
}

function parseDataQuotaGb(value: string): number {
  const normalizedValue = normalizeText(value);

  if (normalizedValue.includes("illim")) {
    return 150;
  }

  const numericValue = parseFirstNumber(value);

  if (normalizedValue.includes("mo")) {
    return numericValue / 1024;
  }

  return numericValue;
}

function humanizeDatasetSource(source: string): string {
  const [kind, label] = source.split(":");

  if (!label) {
    return source;
  }

  if (kind === "api") {
    return `Donnees synchronisees ${label}`;
  }
  if (kind === "mock") {
    return `Copie locale ${label}`;
  }
  if (kind === "derive") {
    return `Calcul interne ${label}`;
  }

  return source;
}

function enrichReply(
  reply: TelecomAssistantReply,
  dataset: TelecomAssistantDataset,
  {
    titleHint,
    focus,
  }: {
    titleHint: string;
    focus: string;
  },
): TelecomAssistantReply {
  return {
    ...reply,
    titleHint,
    sources: [
      `Angle: ${focus}`,
      dataset.usingMock ? "Sources mixtes: donnees synchronisees + secours local" : "Donnees synchronisees en temps reel",
      `Donnees mises a jour le ${formatLoadedAt(dataset.loadedAt)}`,
      ...dataset.sources.slice(0, 3).map((source) => humanizeDatasetSource(source)),
    ],
  };
}

function deriveOccupationStatus(line: ApiPhoneLine): string {
  if (line.occupation_status) {
    return line.occupation_status;
  }

  if (line.status === "inactive") {
    return "inactive";
  }

  if (line.status === "suspended") {
    return "suspendue";
  }

  if (!line.assigned_to?.trim()) {
    return "libre";
  }

  if (!line.department?.trim()) {
    return "en_cours";
  }

  return "attribuee";
}

function getUsageRate(line: ApiPhoneLine): number {
  if (!line.monthly_limit || line.monthly_limit <= 0) {
    return 0;
  }

  return line.current_data_usage_gb / line.monthly_limit;
}

function getPlansByOperator(plans: ApiPlan[], operatorName: string): ApiPlan[] {
  return plans.filter(
    (plan) => normalizeText(plan.operator_name) === normalizeText(operatorName),
  );
}

function buildPlanMap(plans: ApiPlan[]): Map<string, ApiPlan> {
  return new Map(
    plans.map((plan) => [
      `${normalizeText(plan.operator_name)}::${normalizeText(plan.name)}`,
      plan,
    ]),
  );
}

function findBudgetEntry(
  collection: TelecomAssistantBudgetEntry[],
  label: string | null,
): TelecomAssistantBudgetEntry | null {
  if (!label) {
    return null;
  }

  const normalizedLabel = normalizeText(label);

  return (
    collection.find(
      (entry) =>
        normalizeText(entry.label).includes(normalizedLabel) ||
        normalizedLabel.includes(normalizeText(entry.label)),
    ) ?? null
  );
}

function findRecommendationByTopic(
  recommendations: TelecomAssistantRecommendation[],
  label: string | null,
): TelecomAssistantRecommendation | null {
  if (!label) {
    return recommendations[0] ?? null;
  }

  const normalizedLabel = normalizeText(label);

  return (
    recommendations.find(
      (recommendation) =>
        normalizeText(recommendation.operator).includes(normalizedLabel) ||
        normalizeText(recommendation.department).includes(normalizedLabel),
    ) ??
    recommendations[0] ??
    null
  );
}

function findAlertByTopic(alerts: TelecomAssistantAlert[], label: string | null): TelecomAssistantAlert | null {
  if (!label) {
    return alerts[0] ?? null;
  }

  const normalizedLabel = normalizeText(label);

  return (
    alerts.find(
      (alert) =>
        normalizeText(alert.operator).includes(normalizedLabel) ||
        normalizeText(alert.department).includes(normalizedLabel),
    ) ??
    alerts[0] ??
    null
  );
}

function extractEntity(question: string, candidates: string[]): string | null {
  const normalizedQuestion = normalizeText(question);

  return (
    candidates.find((candidate) => {
      const normalizedCandidate = normalizeText(candidate);
      return (
        normalizedQuestion.includes(normalizedCandidate) ||
        normalizedCandidate.includes(normalizedQuestion)
      );
    }) ?? null
  );
}

function isQuestionAbout(normalizedQuestion: string, keywords: string[]): boolean {
  return keywords.some((keyword) => normalizedQuestion.includes(keyword));
}

function getGreetingReply(dataset: TelecomAssistantDataset): TelecomAssistantReply {
  return {
    text: "Je peux vous aider a analyser votre flotte telecom sans quitter l'application.",
    bullets: [
      `${dataset.occupationStats.total} lignes suivies, dont ${dataset.occupationStats.total_libre} libres`,
      `${dataset.lineStats.total_ai_alerts} alertes importantes actuellement visibles`,
      `${dataset.recommendations.length} actions recommandees pour optimiser les couts`,
    ],
    recommendation: "Commencez par une question budget, alertes, lignes critiques ou optimisation forfaits.",
    suggestions: assistantQuestionSuggestions,
  };
}

function getDashboardSummaryReply(dataset: TelecomAssistantDataset): TelecomAssistantReply {
  const topOperator = [...dataset.operatorBudgets].sort(
    (left, right) => right.totalEstimatedPriceMad - left.totalEstimatedPriceMad,
  )[0];
  const topDepartment = [...dataset.departmentBudgets].sort(
    (left, right) => right.totalEstimatedPriceMad - left.totalEstimatedPriceMad,
  )[0];

  return {
    text: "Voici la synthese business la plus utile a lire en premier.",
    bullets: [
      `${dataset.occupationStats.total_libre} lignes libres et ${dataset.occupationStats.total_suspendues} suspendues sur ${dataset.occupationStats.total} lignes`,
      `${dataset.lineStats.critical_ai_alerts} alertes critiques sur ${dataset.lineStats.total_ai_alerts} alertes importantes`,
      `${topOperator?.label ?? "Operateur principal"} concentre ${formatMad(topOperator?.totalEstimatedPriceMad ?? 0)} de budget estime`,
      `${topDepartment?.label ?? "Departement principal"} est le departement le plus consommateur avec ${formatMad(topDepartment?.totalEstimatedPriceMad ?? 0)}`,
    ],
    recommendation:
      topOperator && topDepartment
        ? `Priorite: arbitrer ${topOperator.label} puis verifier ${topDepartment.label}, car ce sont les deux poches qui tirent le plus le budget.`
        : "Priorite: commencer par les alertes critiques puis les lignes premium peu utilisees.",
    ctaLabel: "Ouvrir Dashboard",
    ctaPath: "/dashboard",
    suggestions: [
      "Quelle est la meilleure optimisation ?",
      "Montre-moi les lignes critiques",
      "Quels forfaits sont trop chers ?",
    ],
  };
}

function getFreeLinesReply(dataset: TelecomAssistantDataset): TelecomAssistantReply {
  const freeLines = dataset.lines.filter(
    (line) => deriveOccupationStatus(line) === "libre",
  );

  return {
    text: `Il y a actuellement ${freeLines.length} lignes libres dans le parc.`,
    bullets: freeLines.slice(0, 4).map((line) => {
      const usageLabel = line.monthly_limit
        ? `${formatUsage(line.current_data_usage_gb)} / ${formatUsage(line.monthly_limit)}`
        : formatUsage(line.current_data_usage_gb);
      return `${line.phone_number} - ${line.operator_name} - ${line.plan_name} - usage ${usageLabel}`;
    }),
    recommendation:
      freeLines.length > 0
        ? "Verifier si les lignes libres premium peuvent etre degradees vers des forfaits plus compacts en attendant attribution."
        : "Aucune ligne libre: il vaut mieux reactiver une ligne inactive ou ouvrir une nouvelle attribution.",
    ctaLabel: "Ouvrir Lignes",
    ctaPath: "/lignes",
    suggestions: [
      "Montre-moi les lignes critiques",
      "Quels forfaits sont trop chers ?",
      "Quel departement consomme le plus ?",
    ],
  };
}

function getOperatorBudgetReply(
  dataset: TelecomAssistantDataset,
  operatorName: string,
): TelecomAssistantReply {
  const operatorLines = dataset.lines.filter(
    (line) => normalizeText(line.operator_name) === normalizeText(operatorName),
  );
  const operatorBudget = findBudgetEntry(dataset.operatorBudgets, operatorName);
  const totalBudget = dataset.operatorBudgets.reduce(
    (total, entry) => total + entry.totalEstimatedPriceMad,
    0,
  );
  const planMap = buildPlanMap(dataset.plans);
  const operatorPremiumLines = operatorLines.filter((line) => {
    const linkedPlan = planMap.get(
      `${normalizeText(line.operator_name)}::${normalizeText(line.plan_name)}`,
    );
    return (
      normalizeText(line.plan_name).includes("premium") ||
      normalizeText(line.plan_name).includes("business") ||
      (linkedPlan ? linkedPlan.monthly_price >= 400 : false)
    );
  });
  const nearLimitLines = operatorLines.filter((line) => getUsageRate(line) >= 0.9);
  const bestRecommendation = findRecommendationByTopic(dataset.recommendations, operatorName);

  return {
    text: `${operatorName} est sous pression budgetaire principalement a cause de la concentration du portefeuille et des lignes premium actives.`,
    bullets: [
      `${operatorLines.length} lignes actives ou libres chez ${operatorName}`,
      `${operatorPremiumLines.length} lignes sont sur des forfaits premium ou business`,
      `${formatPercent(totalBudget > 0 ? ((operatorBudget?.totalEstimatedPriceMad ?? 0) / totalBudget) * 100 : 0)} du budget mobile est concentre sur cet operateur`,
      `${nearLimitLines.length} lignes approchent ou depassent 90% de leur quota`,
    ],
    recommendation:
      bestRecommendation?.recommendation ??
      "Arbitrer les lignes premium a usage moyen vers un forfait 10Go ou 20Go pour reduire la facture sans casser le service.",
    ctaLabel: "Ouvrir Consommations",
    ctaPath: "/consommations",
    suggestions: [
      "Quels forfaits sont trop chers ?",
      "Quelle est la meilleure optimisation ?",
      "Montre-moi les lignes critiques",
    ],
  };
}

function findCheapestAlternative(
  plan: ApiPlan,
  plans: ApiPlan[],
): ApiPlan | null {
  const planQuota = parseDataQuotaGb(plan.data_quota);

  return (
    getPlansByOperator(plans, plan.operator_name).find(
      (candidate) =>
        candidate.id !== plan.id &&
        candidate.monthly_price < plan.monthly_price &&
        parseDataQuotaGb(candidate.data_quota) >= Math.max(planQuota * 0.45, 8),
    ) ?? null
  );
}

function getExpensivePlansReply(dataset: TelecomAssistantDataset): TelecomAssistantReply {
  const activePlans = dataset.plans.filter((plan) => plan.active_lines > 0);
  const prices = activePlans.map((plan) => plan.monthly_price).sort((left, right) => left - right);
  const medianPrice =
    prices.length === 0
      ? 0
      : prices.length % 2 === 0
        ? (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2
        : prices[Math.floor(prices.length / 2)];

  const expensivePlans = activePlans
    .filter((plan) => plan.monthly_price > medianPrice * 1.15)
    .map((plan) => {
      const alternative = findCheapestAlternative(plan, dataset.plans);
      const potentialSavings = alternative
        ? Math.round((plan.monthly_price - alternative.monthly_price) * plan.active_lines)
        : 0;

      return {
        plan,
        alternative,
        potentialSavings,
      };
    })
    .sort((left, right) => right.potentialSavings - left.potentialSavings)
    .slice(0, 4);

  return {
    text: "Les forfaits les plus chers a prioriser sont ceux qui cumulent prix eleve et volume de lignes significatif.",
    bullets: expensivePlans.map(({ plan, alternative, potentialSavings }) => {
      const alternativeLabel = alternative
        ? ` -> alternative ${alternative.name}`
        : "";
      return `${plan.name} (${plan.operator_name}) - ${formatMad(plan.monthly_price)}/ligne - ${plan.active_lines} lignes - gain potentiel ${formatMad(potentialSavings)}${alternativeLabel}`;
    }),
    recommendation:
      expensivePlans[0]?.alternative
        ? `Commencer par ${expensivePlans[0].plan.name}: c'est le gisement d'economie le plus rapide a convertir vers ${expensivePlans[0].alternative.name}.`
        : "Aucun arbitrage majeur detecte: verifier plutot les lignes suspendues et les usages critiques.",
    ctaLabel: "Ouvrir Forfaits",
    ctaPath: "/forfaits",
    suggestions: [
      "Quelle est la meilleure optimisation ?",
      "Pourquoi Maroc Telecom est en depassement ?",
      "Quel departement consomme le plus ?",
    ],
  };
}

function getBestOptimizationReply(dataset: TelecomAssistantDataset): TelecomAssistantReply {
  const bestRecommendation = [...dataset.recommendations].sort(
    (left, right) => right.estimatedPriceMad - left.estimatedPriceMad,
  )[0];

  if (!bestRecommendation) {
    return {
      text: "Je n'ai pas encore de scenario d'optimisation exploitable.",
      bullets: [
        "Les actions recommandees ne sont pas disponibles pour le moment",
        "Les donnees de depenses sont peut-etre partielles",
      ],
      recommendation: "Relancez la synchronisation puis reouvrez les pages Consommations ou Forfaits.",
      suggestions: assistantQuestionSuggestions,
    };
  }

  return {
    text: "La meilleure optimisation immediate est celle qui combine gain rapide, faible friction et bonne confiance IA.",
    bullets: [
      `${bestRecommendation.title}`,
      `${bestRecommendation.operator} - ${bestRecommendation.department}`,
      `Gain estime ${formatMad(bestRecommendation.estimatedPriceMad)} avec confiance ${bestRecommendation.confidenceScore}%`,
      `Niveau de risque ${formatScore(bestRecommendation.budgetRiskScore)}`,
    ],
    recommendation: bestRecommendation.recommendation,
    ctaLabel: "Ouvrir Forfaits",
    ctaPath: "/forfaits",
    suggestions: [
      "Quels forfaits sont trop chers ?",
      "Montre-moi les lignes critiques",
      "Pourquoi Maroc Telecom est en depassement ?",
    ],
  };
}

function getCriticalLinesReply(dataset: TelecomAssistantDataset): TelecomAssistantReply {
  const criticalLines = [...dataset.lines]
    .filter((line) => {
      const usageRate = getUsageRate(line);
      return line.status === "suspended" || line.status === "inactive" || usageRate >= 0.9;
    })
    .sort((left, right) => {
      const rightScore = Math.round(getUsageRate(right) * 100) + (right.status === "suspended" ? 20 : 0);
      const leftScore = Math.round(getUsageRate(left) * 100) + (left.status === "suspended" ? 20 : 0);
      return rightScore - leftScore;
    })
    .slice(0, 5);

  return {
    text: "Voici les lignes les plus critiques a traiter en priorite.",
    bullets: criticalLines.map((line) => {
      const statusLabel =
        line.status === "suspended"
          ? "Suspendue"
          : line.status === "inactive"
            ? "Inactive"
            : "Surconsommation";
      const usageLabel = line.monthly_limit
        ? `${formatUsage(line.current_data_usage_gb)} / ${formatUsage(line.monthly_limit)}`
        : formatUsage(line.current_data_usage_gb);
      return `${line.phone_number} - ${statusLabel} - ${line.operator_name} - ${usageLabel}`;
    }),
    recommendation:
      criticalLines.length > 0
        ? "Commencez par les lignes suspendues puis par celles qui depassent 90% de quota avec un forfait encore premium."
        : "Aucune ligne critique detectee: vous pouvez basculer sur une logique d'optimisation budgetaire.",
    ctaLabel: "Ouvrir Lignes",
    ctaPath: "/lignes",
    suggestions: [
      "Combien de lignes sont libres ?",
      "Quels forfaits sont trop chers ?",
      "Explique-moi les alertes importantes",
    ],
  };
}

function getDepartmentReply(
  dataset: TelecomAssistantDataset,
  requestedDepartment?: string | null,
): TelecomAssistantReply {
  const totalDepartmentBudget = dataset.departmentBudgets.reduce(
    (total, department) => total + department.totalEstimatedPriceMad,
    0,
  );
  const topDepartment = requestedDepartment
    ? findBudgetEntry(dataset.departmentBudgets, requestedDepartment)
    : [...dataset.departmentBudgets].sort(
        (left, right) => right.totalEstimatedPriceMad - left.totalEstimatedPriceMad,
      )[0];

  return {
    text: `${topDepartment?.label ?? "Aucun departement"} est le departement qui ressort le plus sur la consommation actuelle.`,
    bullets: [
      `${formatMad(topDepartment?.totalEstimatedPriceMad ?? 0)} de budget estime`,
      `${formatPercent(totalDepartmentBudget > 0 ? ((topDepartment?.totalEstimatedPriceMad ?? 0) / totalDepartmentBudget) * 100 : 0)} du budget total par departement`,
      `Score de risque ${formatScore(topDepartment?.averageBudgetRiskScore ?? 0)}`,
      `${topDepartment?.alertDevices ?? 0} lignes ou devices en alerte`,
    ],
    recommendation:
      topDepartment && topDepartment.averageBudgetRiskScore >= 60
        ? `Prioriser ${topDepartment.label}: c'est le meilleur point d'entree pour reduire rapidement le budget et la pression alertes.`
        : "Le departement leader consomme plus mais reste relativement stable: ciblez ensuite les forfaits les plus chers.",
    ctaLabel: "Ouvrir Dashboard",
    ctaPath: "/dashboard",
    suggestions: [
      "Quels forfaits sont trop chers ?",
      "Pourquoi Maroc Telecom est en depassement ?",
      "Resume le dashboard",
    ],
  };
}

function getAlertsReply(dataset: TelecomAssistantDataset): TelecomAssistantReply {
  const topAlert = [...dataset.alerts].sort((left, right) => right.score - left.score)[0];

  return {
    text: "Les alertes se concentrent actuellement sur les zones qui pesent le plus sur les couts ou les usages.",
    bullets: [
      `${dataset.lineStats.critical_ai_alerts} alertes critiques sur ${dataset.lineStats.total_ai_alerts} alertes detectees`,
      ...dataset.alerts.slice(0, 3).map((alert) => {
        return `${alert.severity} - ${alert.operator} - ${alert.department} - ${formatMad(alert.costMad)} - score ${formatScore(alert.score)}`;
      }),
    ],
    recommendation:
      topAlert?.recommendation ??
      "Traitez d'abord les alertes critiques puis les recommandations d'optimisation associees.",
    ctaLabel: "Ouvrir Anomalies",
    ctaPath: "/anomalies",
    suggestions: [
      "Montre-moi les lignes critiques",
      "Quelle est la meilleure optimisation ?",
      "Quel departement consomme le plus ?",
    ],
  };
}

function getGuidanceReply(normalizedQuestion: string): TelecomAssistantReply {
  const guides = [
    {
      keywords: ["ligne", "lignes"],
      text: "Pour piloter les lignes, la meilleure entree est la page Lignes.",
      bullets: [
        "Filtrer par statut libre, attribuee, suspendue ou inactive",
        "Voir les usages et les actions de gestion au meme endroit",
        "Repérer rapidement les lignes critiques ou libres",
      ],
      recommendation: "Utilisez Lignes pour les actions operationnelles quotidiennes.",
      ctaLabel: "Ouvrir Lignes",
      ctaPath: "/lignes",
    },
    {
      keywords: ["forfait", "forfaits", "optimisation"],
      text: "Pour les arbitrages budgetaires, ouvrez d'abord la page Forfaits.",
      bullets: [
        "Identifier les offres trop cheres",
        "Comparer les gains potentiels par plan",
        "Appliquer ou simuler une optimisation",
      ],
      recommendation: "Forfaits est la meilleure page pour reduire le cout mensuel.",
      ctaLabel: "Ouvrir Forfaits",
      ctaPath: "/forfaits",
    },
    {
      keywords: ["alerte", "alertes", "anomalie", "fraude"],
      text: "Pour comprendre les alertes, la page Anomalies est la bonne entree.",
      bullets: [
        "Prioriser les alertes critiques",
        "Lire l'action conseillee associee",
        "Isoler rapidement les zones ou lignes a risque",
      ],
      recommendation: "Anomalies permet d'aller du signal a l'action sans perdre le contexte.",
      ctaLabel: "Ouvrir Anomalies",
      ctaPath: "/anomalies",
    },
    {
      keywords: ["dashboard", "tableau de bord", "resume", "synthese"],
      text: "Pour une vue d'ensemble, ouvrez le tableau de bord.",
      bullets: [
        "Vue d'ensemble budget, risques et priorites",
        "Top actions business a presenter rapidement",
        "Croisement depenses, risques client et appels suspects",
      ],
      recommendation: "Le tableau de bord est ideal pour resumer la situation avant une decision.",
      ctaLabel: "Ouvrir Dashboard",
      ctaPath: "/dashboard",
    },
  ];

  const guide =
    guides.find((item) => item.keywords.some((keyword) => normalizedQuestion.includes(keyword))) ??
    guides[0];

  return {
    ...guide,
    suggestions: assistantQuestionSuggestions,
  };
}

function getFallbackReply(): TelecomAssistantReply {
  return {
    text: "Je peux vous aider, mais j'ai besoin d'une question plus ciblee.",
    bullets: [
      "Budget operateur ou departement",
      "Etat des lignes libres ou critiques",
      "Forfaits trop chers ou meilleure optimisation",
      "Explication des alertes importantes",
    ],
    recommendation: "Essayez une question concrete comme: 'Quels forfaits sont trop chers ?'",
    suggestions: assistantQuestionSuggestions,
  };
}

export function generateTelecomAssistantReply(
  question: string,
  dataset: TelecomAssistantDataset,
  contextMessages: TelecomAssistantContextMessage[] = [],
): TelecomAssistantReply {
  const normalizedQuestion = normalizeText(question);
  const normalizedContext = normalizeText(
    contextMessages
      .slice(-8)
      .map((message) => message.text)
      .join(" "),
  );
  const operators = dataset.operatorBudgets.map((entry) => entry.label);
  const departments = dataset.departmentBudgets.map((entry) => entry.label);
  const matchedOperator =
    extractEntity(question, operators) ?? extractEntity(normalizedContext, operators);
  const matchedDepartment =
    extractEntity(question, departments) ?? extractEntity(normalizedContext, departments);

  if (
    isQuestionAbout(normalizedQuestion, ["bonjour", "salut", "hello", "bonsoir"]) &&
    normalizedQuestion.split(" ").length <= 4
  ) {
    return enrichReply(getGreetingReply(dataset), dataset, {
      titleHint: "Assistant flotte telecom",
      focus: "Accueil assistant",
    });
  }

  if (
    isQuestionAbout(normalizedQuestion, ["dashboard", "tableau de bord", "resume", "synthese", "synthese"])
  ) {
    return enrichReply(getDashboardSummaryReply(dataset), dataset, {
      titleHint: "Synthese dashboard",
      focus: "Synthese executive",
    });
  }

  if (
    matchedOperator &&
    isQuestionAbout(normalizedQuestion, [
      "depassement",
      "surcout",
      "budget",
      "trop cher",
      "pourquoi",
      "cout",
      "coût",
    ])
  ) {
    return enrichReply(getOperatorBudgetReply(dataset, matchedOperator), dataset, {
      titleHint: `Budget ${matchedOperator}`,
      focus: `Budget operateur ${matchedOperator}`,
    });
  }

  if (
    isQuestionAbout(normalizedQuestion, ["ligne libre", "lignes libres"]) ||
    (isQuestionAbout(normalizedQuestion, ["combien"]) &&
      isQuestionAbout(normalizedQuestion, ["ligne", "lignes", "libre", "libres"]))
  ) {
    return enrichReply(getFreeLinesReply(dataset), dataset, {
      titleHint: "Lignes libres",
      focus: "Disponibilite des lignes",
    });
  }

  if (
    isQuestionAbout(normalizedQuestion, ["forfait", "forfaits"]) &&
    isQuestionAbout(normalizedQuestion, ["trop cher", "chers", "cher", "coûteux", "couteux"])
  ) {
    return enrichReply(getExpensivePlansReply(dataset), dataset, {
      titleHint: "Forfaits trop chers",
      focus: "Arbitrage forfaitaire",
    });
  }

  if (isQuestionAbout(normalizedQuestion, ["meilleure optimisation", "optimisation", "optimiser"])) {
    return enrichReply(getBestOptimizationReply(dataset), dataset, {
      titleHint: "Meilleure optimisation",
      focus: "Priorite d'optimisation",
    });
  }

  if (
    isQuestionAbout(normalizedQuestion, ["ligne critique", "lignes critiques", "critique", "critiques"]) &&
    isQuestionAbout(normalizedQuestion, ["ligne", "lignes", "montre", "affiche"])
  ) {
    return enrichReply(getCriticalLinesReply(dataset), dataset, {
      titleHint: "Lignes critiques",
      focus: "Priorisation des lignes",
    });
  }

  if (
    isQuestionAbout(normalizedQuestion, ["departement", "departements"]) &&
    isQuestionAbout(normalizedQuestion, ["consomme", "budget", "plus"])
  ) {
    return enrichReply(getDepartmentReply(dataset, matchedDepartment), dataset, {
      titleHint: matchedDepartment ? `Budget ${matchedDepartment}` : "Budget departements",
      focus: matchedDepartment ? `Analyse departement ${matchedDepartment}` : "Budget departements",
    });
  }

  if (
    isQuestionAbout(normalizedQuestion, ["alerte", "alertes", "ia"]) ||
    (matchedOperator && isQuestionAbout(normalizedQuestion, ["risque", "anomalie", "anomalies"]))
  ) {
    return enrichReply(getAlertsReply(dataset), dataset, {
      titleHint: "Alertes IA",
      focus: matchedOperator ? `Alertes ${matchedOperator}` : "Alertes IA",
    });
  }

  if (isQuestionAbout(normalizedQuestion, ["ouvrir", "ou aller", "ou trouver", "guider", "navigation"])) {
    return enrichReply(getGuidanceReply(normalizedQuestion), dataset, {
      titleHint: "Guidage application",
      focus: "Navigation dans l'application",
    });
  }

  if (matchedDepartment) {
    return enrichReply(getDepartmentReply(dataset, matchedDepartment), dataset, {
      titleHint: `Budget ${matchedDepartment}`,
      focus: `Analyse departement ${matchedDepartment}`,
    });
  }

  if (matchedOperator) {
    return enrichReply(getOperatorBudgetReply(dataset, matchedOperator), dataset, {
      titleHint: `Budget ${matchedOperator}`,
      focus: `Budget operateur ${matchedOperator}`,
    });
  }

  return enrichReply(getFallbackReply(), dataset, {
    titleHint: "Analyse flotte telecom",
    focus: "Question libre",
  });
}
