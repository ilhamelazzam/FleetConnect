import {
  cdrAnalyticsApi,
  mobileFleetApi,
  notificationsApi,
  phoneLinesApi,
  plansApi,
  type ApiMobileFleetRecommendation,
  type ApiNotification,
  type ApiPhoneLine,
  type ApiPhoneLineOccupationStats,
  type ApiPhoneLineOccupationStatus,
  type ApiPhoneLineStats,
  type ApiPlan,
} from "./api";

const PHONE_LINES_BATCH_SIZE = 100;

export interface TelecomAssistantBudgetEntry {
  label: string;
  totalEstimatedPriceMad: number;
  averageBudgetRiskScore: number;
  alertDevices: number;
}

export interface TelecomAssistantRecommendation {
  id: string;
  title: string;
  operator: string;
  department: string;
  estimatedPriceMad: number;
  budgetRiskScore: number;
  riskLevel: string;
  recommendation: string;
  confidenceScore: number;
}

export interface TelecomAssistantAlert {
  id: string;
  title: string;
  operator: string;
  department: string;
  severity: string;
  zone: string;
  costMad: number;
  score: number;
  recommendation: string;
}

export interface TelecomAssistantDataset {
  lines: ApiPhoneLine[];
  lineStats: ApiPhoneLineStats;
  occupationStats: ApiPhoneLineOccupationStats;
  plans: ApiPlan[];
  operatorBudgets: TelecomAssistantBudgetEntry[];
  departmentBudgets: TelecomAssistantBudgetEntry[];
  recommendations: TelecomAssistantRecommendation[];
  alerts: TelecomAssistantAlert[];
  recentNotifications: ApiNotification[];
  unreadNotifications: number;
  usingMock: boolean;
  loadedAt: string;
  sources: string[];
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
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

function deriveOccupationStatus(line: ApiPhoneLine): ApiPhoneLineOccupationStatus {
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

function buildPlanKey(operatorName: string, planName: string): string {
  return `${normalizeText(operatorName)}::${normalizeText(planName)}`;
}

function buildPlanMap(plans: ApiPlan[]): Map<string, ApiPlan> {
  return new Map(
    plans.map((plan) => [buildPlanKey(plan.operator_name, plan.name), plan] as const),
  );
}

function buildOccupationStats(lines: ApiPhoneLine[]): ApiPhoneLineOccupationStats {
  const stats: ApiPhoneLineOccupationStats = {
    total: lines.length,
    total_libre: 0,
    total_attribuees: 0,
    total_en_cours: 0,
    total_suspendues: 0,
    total_inactives: 0,
  };

  lines.forEach((line) => {
    const occupationStatus = deriveOccupationStatus(line);

    if (occupationStatus === "libre") {
      stats.total_libre += 1;
      return;
    }
    if (occupationStatus === "attribuee") {
      stats.total_attribuees += 1;
      return;
    }
    if (occupationStatus === "en_cours") {
      stats.total_en_cours += 1;
      return;
    }
    if (occupationStatus === "suspendue") {
      stats.total_suspendues += 1;
      return;
    }

    stats.total_inactives += 1;
  });

  return stats;
}

function buildLineStats(
  lines: ApiPhoneLine[],
  alerts: TelecomAssistantAlert[],
  recommendations: TelecomAssistantRecommendation[],
): ApiPhoneLineStats {
  const currentAverage =
    lines.length > 0
      ? lines.reduce((total, line) => total + line.current_data_usage_gb, 0) / lines.length
      : null;
  const previousAverage =
    lines.length > 0
      ? lines.reduce((total, line) => total + line.previous_data_usage_gb, 0) / lines.length
      : null;
  const averageChangePct =
    currentAverage !== null && previousAverage !== null && previousAverage > 0
      ? ((currentAverage - previousAverage) / previousAverage) * 100
      : null;
  const estimatedMonthlySavingsMad = Math.round(
    recommendations.reduce(
      (total, recommendation) => total + Math.max(recommendation.estimatedPriceMad * 0.18, 0),
      0,
    ),
  );

  return {
    total: lines.length,
    created_this_month: Math.max(Math.round(lines.length * 0.18), 0),
    average_data_usage_gb: currentAverage,
    previous_average_data_usage_gb: previousAverage,
    average_data_usage_change_pct: averageChangePct,
    total_ai_alerts: alerts.length,
    critical_ai_alerts: alerts.filter((alert) => normalizeText(alert.severity).includes("crit")).length,
    estimated_monthly_savings_mad: estimatedMonthlySavingsMad,
  };
}

function buildOperatorBudgets(
  lines: ApiPhoneLine[],
  plans: ApiPlan[],
): TelecomAssistantBudgetEntry[] {
  const planMap = buildPlanMap(plans);
  const budgetMap = new Map<
    string,
    {
      label: string;
      total: number;
      riskSum: number;
      count: number;
      alerts: number;
    }
  >();

  lines.forEach((line) => {
    const key = normalizeText(line.operator_name);
    const linkedPlan = planMap.get(buildPlanKey(line.operator_name, line.plan_name));
    const monthlyPrice = linkedPlan?.monthly_price ?? 0;
    const riskScore = Math.min(
      100,
      Math.round(getUsageRate(line) * 70) +
        (line.status === "suspended" ? 24 : 0) +
        (line.status === "inactive" ? 12 : 0),
    );
    const isAlertLine =
      line.status === "suspended" || line.status === "inactive" || getUsageRate(line) >= 0.9;
    const currentEntry = budgetMap.get(key) ?? {
      label: line.operator_name,
      total: 0,
      riskSum: 0,
      count: 0,
      alerts: 0,
    };

    currentEntry.total += monthlyPrice;
    currentEntry.riskSum += riskScore;
    currentEntry.count += 1;
    currentEntry.alerts += isAlertLine ? 1 : 0;
    budgetMap.set(key, currentEntry);
  });

  return Array.from(budgetMap.values())
    .map((entry) => ({
      label: entry.label,
      totalEstimatedPriceMad: Math.round(entry.total),
      averageBudgetRiskScore: entry.count > 0 ? Math.round(entry.riskSum / entry.count) : 0,
      alertDevices: entry.alerts,
    }))
    .sort((left, right) => right.totalEstimatedPriceMad - left.totalEstimatedPriceMad);
}

function buildDepartmentBudgets(
  lines: ApiPhoneLine[],
  plans: ApiPlan[],
): TelecomAssistantBudgetEntry[] {
  const planMap = buildPlanMap(plans);
  const budgetMap = new Map<
    string,
    {
      label: string;
      total: number;
      riskSum: number;
      count: number;
      alerts: number;
    }
  >();

  lines.forEach((line) => {
    const departmentLabel = line.department?.trim() || "Sans departement";
    const key = normalizeText(departmentLabel);
    const linkedPlan = planMap.get(buildPlanKey(line.operator_name, line.plan_name));
    const monthlyPrice = linkedPlan?.monthly_price ?? 0;
    const riskScore = Math.min(
      100,
      Math.round(getUsageRate(line) * 68) +
        (line.status === "suspended" ? 20 : 0) +
        (line.status === "inactive" ? 10 : 0),
    );
    const isAlertLine =
      line.status === "suspended" || line.status === "inactive" || getUsageRate(line) >= 0.9;
    const currentEntry = budgetMap.get(key) ?? {
      label: departmentLabel,
      total: 0,
      riskSum: 0,
      count: 0,
      alerts: 0,
    };

    currentEntry.total += monthlyPrice;
    currentEntry.riskSum += riskScore;
    currentEntry.count += 1;
    currentEntry.alerts += isAlertLine ? 1 : 0;
    budgetMap.set(key, currentEntry);
  });

  return Array.from(budgetMap.values())
    .map((entry) => ({
      label: entry.label,
      totalEstimatedPriceMad: Math.round(entry.total),
      averageBudgetRiskScore: entry.count > 0 ? Math.round(entry.riskSum / entry.count) : 0,
      alertDevices: entry.alerts,
    }))
    .sort((left, right) => right.totalEstimatedPriceMad - left.totalEstimatedPriceMad);
}

function buildFallbackRecommendations(
  lines: ApiPhoneLine[],
  plans: ApiPlan[],
): TelecomAssistantRecommendation[] {
  const cheaperPlansByOperator = new Map<string, ApiPlan[]>();

  plans.forEach((plan) => {
    const operatorKey = normalizeText(plan.operator_name);
    const currentOperatorPlans = cheaperPlansByOperator.get(operatorKey) ?? [];
    currentOperatorPlans.push(plan);
    cheaperPlansByOperator.set(operatorKey, currentOperatorPlans);
  });

  cheaperPlansByOperator.forEach((operatorPlans, operatorKey) => {
    operatorPlans.sort((leftPlan, rightPlan) => leftPlan.monthly_price - rightPlan.monthly_price);
    cheaperPlansByOperator.set(operatorKey, operatorPlans);
  });

  return plans
    .map((plan) => {
      const operatorPlans = cheaperPlansByOperator.get(normalizeText(plan.operator_name)) ?? [];
      const cheaperAlternative = operatorPlans.find(
        (candidatePlan) =>
          candidatePlan.monthly_price < plan.monthly_price &&
          parseDataQuotaGb(candidatePlan.data_quota) >= Math.max(parseDataQuotaGb(plan.data_quota) * 0.45, 8),
      );

      if (!cheaperAlternative || plan.active_lines <= 0) {
        return null;
      }

      const impactedLines = lines.filter(
        (line) =>
          normalizeText(line.operator_name) === normalizeText(plan.operator_name) &&
          normalizeText(line.plan_name) === normalizeText(plan.name),
      );
      const departmentLabel =
        impactedLines[0]?.department?.trim() || (plan.active_lines > 4 ? "Parc transverse" : "Sans departement");
      const estimatedGain = Math.round((plan.monthly_price - cheaperAlternative.monthly_price) * plan.active_lines);
      const averageUsageRate =
        impactedLines.length > 0
          ? impactedLines.reduce((total, line) => total + getUsageRate(line), 0) / impactedLines.length
          : 0.64;
      const budgetRiskScore = Math.min(
        100,
        Math.round(45 + averageUsageRate * 30 + Math.min(plan.monthly_price / 12, 28)),
      );

      return {
        id: `plan-${plan.id}`,
        title: `${plan.name} peut etre arbitre`,
        operator: plan.operator_name,
        department: departmentLabel,
        estimatedPriceMad: estimatedGain,
        budgetRiskScore,
        riskLevel: budgetRiskScore >= 75 ? "Critique" : budgetRiskScore >= 55 ? "Eleve" : "Moyen",
        recommendation: `Basculer une partie des ${plan.active_lines} lignes vers ${cheaperAlternative.name} pour reduire le cout unitaire.`,
        confidenceScore: Math.min(96, Math.max(64, Math.round(82 - averageUsageRate * 12))),
      } satisfies TelecomAssistantRecommendation;
    })
    .filter((value): value is TelecomAssistantRecommendation => value !== null)
    .sort((left, right) => right.estimatedPriceMad - left.estimatedPriceMad)
    .slice(0, 6);
}

function buildFallbackAlerts(lines: ApiPhoneLine[]): TelecomAssistantAlert[] {
  return lines
    .map((line) => {
      const usageRate = getUsageRate(line);
      const isCritical = line.status === "suspended" || usageRate >= 1;
      const isHigh = usageRate >= 0.9 || line.status === "inactive";

      if (!isCritical && !isHigh) {
        return null;
      }

      return {
        id: `line-alert-${line.id}`,
        title:
          line.status === "suspended"
            ? `Ligne ${line.phone_number} suspendue`
            : `Usage eleve sur ${line.phone_number}`,
        operator: line.operator_name,
        department: line.department?.trim() || "Sans departement",
        severity: isCritical ? "Critique" : "Elevee",
        zone: "Usage mobile",
        costMad: Math.round(line.current_data_usage_gb * 22),
        score: Math.min(100, Math.round(usageRate * 100) + (line.status === "suspended" ? 18 : 0)),
        recommendation:
          line.status === "suspended"
            ? "Verifier l'attribution et reactiver uniquement apres validation."
            : "Verifier le forfait et isoler la ligne avant depassement complet.",
      } satisfies TelecomAssistantAlert;
    })
    .filter((value): value is TelecomAssistantAlert => value !== null)
    .sort((left, right) => right.score - left.score)
    .slice(0, 6);
}

function cloneDataset(dataset: TelecomAssistantDataset): TelecomAssistantDataset {
  return {
    ...dataset,
    lines: dataset.lines.map((line) => ({ ...line })),
    lineStats: { ...dataset.lineStats },
    occupationStats: { ...dataset.occupationStats },
    plans: dataset.plans.map((plan) => ({ ...plan })),
    operatorBudgets: dataset.operatorBudgets.map((entry) => ({ ...entry })),
    departmentBudgets: dataset.departmentBudgets.map((entry) => ({ ...entry })),
    recommendations: dataset.recommendations.map((recommendation) => ({ ...recommendation })),
    alerts: dataset.alerts.map((alert) => ({ ...alert })),
    recentNotifications: dataset.recentNotifications.map((notification) => ({
      ...notification,
      metadata_json: { ...notification.metadata_json },
    })),
    sources: [...dataset.sources],
  };
}

async function fetchAllPhoneLines(token: string): Promise<ApiPhoneLine[]> {
  const lines: ApiPhoneLine[] = [];
  let offset = 0;

  while (true) {
    const currentBatch = await phoneLinesApi.list(token, {
      offset,
      limit: PHONE_LINES_BATCH_SIZE,
    });

    lines.push(...currentBatch);

    if (currentBatch.length < PHONE_LINES_BATCH_SIZE) {
      break;
    }

    offset += currentBatch.length;
  }

  return lines;
}

export const mockTelecomAssistantDataset: TelecomAssistantDataset = {
  lines: [
    {
      id: 101,
      phone_number: "+212600100101",
      operator_name: "Maroc Telecom",
      plan_name: "Premium 50Go",
      assigned_to: "ILHAMITA",
      contact_email: "ilhamita@bcskills.ma",
      department: "Commercial",
      status: "active",
      monthly_limit: 50,
      current_data_usage_gb: 47,
      previous_data_usage_gb: 35,
      notes: "Usage roaming en hausse",
      created_at: "2026-04-02T09:15:00.000Z",
      updated_at: "2026-04-28T10:00:00.000Z",
      occupation_status: "attribuee",
    },
    {
      id: 102,
      phone_number: "+212600100102",
      operator_name: "Maroc Telecom",
      plan_name: "Business 100Go",
      assigned_to: "SARA BENALI",
      contact_email: "sara.benali@bcskills.ma",
      department: "Direction",
      status: "active",
      monthly_limit: 100,
      current_data_usage_gb: 82,
      previous_data_usage_gb: 71,
      notes: null,
      created_at: "2026-03-22T11:00:00.000Z",
      updated_at: "2026-04-28T13:40:00.000Z",
      occupation_status: "attribuee",
    },
    {
      id: 103,
      phone_number: "+212600100103",
      operator_name: "Orange Maroc",
      plan_name: "Premium 10 G",
      assigned_to: null,
      contact_email: null,
      department: null,
      status: "active",
      monthly_limit: 10,
      current_data_usage_gb: 1.2,
      previous_data_usage_gb: 0.8,
      notes: "Reserve pour nouvelle attribution",
      created_at: "2026-04-10T08:00:00.000Z",
      updated_at: "2026-04-27T17:10:00.000Z",
      occupation_status: "libre",
    },
    {
      id: 104,
      phone_number: "+212600100104",
      operator_name: "Orange Maroc",
      plan_name: "Standard 20Go",
      assigned_to: "YASSINE EL AMRANI",
      contact_email: "yassine@bcskills.ma",
      department: "Finance",
      status: "suspended",
      monthly_limit: 20,
      current_data_usage_gb: 21.4,
      previous_data_usage_gb: 18.2,
      notes: "Suspension temporaire pour usage hors politique",
      created_at: "2026-04-03T09:40:00.000Z",
      updated_at: "2026-04-29T08:25:00.000Z",
      occupation_status: "suspendue",
    },
    {
      id: 105,
      phone_number: "+212600100105",
      operator_name: "Inwi",
      plan_name: "Standard 20Go",
      assigned_to: "AMINE HADDAD",
      contact_email: "amine@bcskills.ma",
      department: "IT",
      status: "active",
      monthly_limit: 20,
      current_data_usage_gb: 13.4,
      previous_data_usage_gb: 11.1,
      notes: null,
      created_at: "2026-03-29T15:25:00.000Z",
      updated_at: "2026-04-28T14:00:00.000Z",
      occupation_status: "attribuee",
    },
    {
      id: 106,
      phone_number: "+212600100106",
      operator_name: "Maroc Telecom",
      plan_name: "Premium 50Go",
      assigned_to: null,
      contact_email: null,
      department: null,
      status: "active",
      monthly_limit: 50,
      current_data_usage_gb: 4.1,
      previous_data_usage_gb: 2.3,
      notes: "Ligne libre premium a rationaliser",
      created_at: "2026-04-11T10:12:00.000Z",
      updated_at: "2026-04-28T09:12:00.000Z",
      occupation_status: "libre",
    },
  ],
  lineStats: {
    total: 6,
    created_this_month: 2,
    average_data_usage_gb: 28.18,
    previous_average_data_usage_gb: 23.23,
    average_data_usage_change_pct: 21.3,
    total_ai_alerts: 5,
    critical_ai_alerts: 2,
    estimated_monthly_savings_mad: 9600,
  },
  occupationStats: {
    total: 6,
    total_libre: 2,
    total_attribuees: 3,
    total_en_cours: 0,
    total_suspendues: 1,
    total_inactives: 0,
  },
  plans: [
    {
      id: 11,
      name: "Premium 50Go",
      operator_name: "Maroc Telecom",
      monthly_price: 520,
      voice_quota: "Illimite",
      data_quota: "50 Go",
      sms_quota: "Illimite",
      roaming_zone: "International",
      active_lines: 68,
      activation_status: "active",
      activated_at: "2026-04-08T09:00:00.000Z",
      activated_by_user_id: 1,
      description: "Forfait premium a forte couverture data",
      created_at: "2026-02-02T09:00:00.000Z",
      updated_at: "2026-04-28T09:00:00.000Z",
    },
    {
      id: 12,
      name: "Business 100Go",
      operator_name: "Maroc Telecom",
      monthly_price: 760,
      voice_quota: "Illimite",
      data_quota: "100 Go",
      sms_quota: "Illimite",
      roaming_zone: "Monde",
      active_lines: 14,
      activation_status: "active",
      activated_at: "2026-04-07T10:00:00.000Z",
      activated_by_user_id: 1,
      description: "Forfait direction et mobilite internationale",
      created_at: "2026-02-06T09:00:00.000Z",
      updated_at: "2026-04-28T09:00:00.000Z",
    },
    {
      id: 13,
      name: "Standard 20Go",
      operator_name: "Orange Maroc",
      monthly_price: 120,
      voice_quota: "8 h",
      data_quota: "20 Go",
      sms_quota: "Illimite",
      roaming_zone: "National",
      active_lines: 85,
      activation_status: "active",
      activated_at: "2026-04-03T11:00:00.000Z",
      activated_by_user_id: 1,
      description: "Forfait standard polyvalent",
      created_at: "2026-02-14T09:00:00.000Z",
      updated_at: "2026-04-27T09:00:00.000Z",
    },
    {
      id: 14,
      name: "Premium 10 G",
      operator_name: "Orange Maroc",
      monthly_price: 50,
      voice_quota: "5 h",
      data_quota: "10 Go",
      sms_quota: "2000",
      roaming_zone: "National",
      active_lines: 4,
      activation_status: "active",
      activated_at: "2026-04-05T11:00:00.000Z",
      activated_by_user_id: 1,
      description: "Forfait compact pour usages maitrises",
      created_at: "2026-02-10T09:00:00.000Z",
      updated_at: "2026-04-27T09:00:00.000Z",
    },
    {
      id: 15,
      name: "Standard 20Go",
      operator_name: "Inwi",
      monthly_price: 116,
      voice_quota: "7 h",
      data_quota: "20 Go",
      sms_quota: "Illimite",
      roaming_zone: "National",
      active_lines: 36,
      activation_status: "active",
      activated_at: "2026-04-06T11:00:00.000Z",
      activated_by_user_id: 1,
      description: "Forfait standard Inwi",
      created_at: "2026-02-08T09:00:00.000Z",
      updated_at: "2026-04-27T09:00:00.000Z",
    },
  ],
  operatorBudgets: [
    {
      label: "Maroc Telecom",
      totalEstimatedPriceMad: 24000,
      averageBudgetRiskScore: 72,
      alertDevices: 4,
    },
    {
      label: "Orange Maroc",
      totalEstimatedPriceMad: 14500,
      averageBudgetRiskScore: 48,
      alertDevices: 2,
    },
    {
      label: "Inwi",
      totalEstimatedPriceMad: 9600,
      averageBudgetRiskScore: 31,
      alertDevices: 1,
    },
  ],
  departmentBudgets: [
    {
      label: "Commercial",
      totalEstimatedPriceMad: 18200,
      averageBudgetRiskScore: 76,
      alertDevices: 4,
    },
    {
      label: "Direction",
      totalEstimatedPriceMad: 15400,
      averageBudgetRiskScore: 58,
      alertDevices: 2,
    },
    {
      label: "Finance",
      totalEstimatedPriceMad: 11200,
      averageBudgetRiskScore: 63,
      alertDevices: 2,
    },
    {
      label: "IT",
      totalEstimatedPriceMad: 9700,
      averageBudgetRiskScore: 34,
      alertDevices: 1,
    },
  ],
  recommendations: [
    {
      id: "rec-1",
      title: "Arbitrer Premium 50Go",
      operator: "Maroc Telecom",
      department: "Commercial",
      estimatedPriceMad: 7024,
      budgetRiskScore: 79,
      riskLevel: "Critique",
      recommendation: "Basculer les profils a usage moyen vers un forfait 10Go ou 20Go pour reduire le cout sans perte notable.",
      confidenceScore: 87,
    },
    {
      id: "rec-2",
      title: "Isoler les lignes suspendues Orange",
      operator: "Orange Maroc",
      department: "Finance",
      estimatedPriceMad: 1850,
      budgetRiskScore: 66,
      riskLevel: "Eleve",
      recommendation: "Verifier la justification metier puis replacer les lignes en standard 20Go apres validation.",
      confidenceScore: 81,
    },
    {
      id: "rec-3",
      title: "Rationaliser les lignes premium libres",
      operator: "Maroc Telecom",
      department: "Sans departement",
      estimatedPriceMad: 920,
      budgetRiskScore: 58,
      riskLevel: "Moyen",
      recommendation: "Transformer les lignes libres premium en forfaits standards jusqu'a attribution effective.",
      confidenceScore: 78,
    },
  ],
  alerts: [
    {
      id: "alert-1",
      title: "Depassement critique sur ligne finance",
      operator: "Orange Maroc",
      department: "Finance",
      severity: "Critique",
      zone: "Usage mobile",
      costMad: 2450,
      score: 92,
      recommendation: "Bloquer provisoirement la ligne et verifier le forfait attribue.",
    },
    {
      id: "alert-2",
      title: "Concentration budgetaire sur Maroc Telecom",
      operator: "Maroc Telecom",
      department: "Commercial",
      severity: "Elevee",
      zone: "Budget operateur",
      costMad: 7800,
      score: 84,
      recommendation: "Arbitrer les forfaits premium actifs et reduire la part budgetaire concentree sur un seul operateur.",
    },
    {
      id: "alert-3",
      title: "Roaming premium a surveiller",
      operator: "Maroc Telecom",
      department: "Direction",
      severity: "Elevee",
      zone: "International",
      costMad: 3200,
      score: 79,
      recommendation: "Verifier la legitimite du roaming et basculer vers une option mieux ciblee si besoin.",
    },
  ],
  recentNotifications: [
    {
      id: 5001,
      type: "ai",
      title: "Recommandation IA prioritaire",
      message: "Arbitrer Premium 50Go sur le portefeuille Commercial.",
      timestamp: "2026-04-29T08:00:00.000Z",
      is_read: false,
      status: "unread",
      priority: "high",
      link_url: "/forfaits",
      ai_recommendation: "Basculer vers une offre 10Go pour les usages moderes.",
      action_suggeree: "Ouvrir Forfaits",
      recipient_user_id: 1,
      actor_user_id: null,
      related_resource_id: null,
      related_compliance_alert_id: null,
      source_type: "assistant",
      source_id: "rec-1",
      metadata_json: {},
    },
    {
      id: 5002,
      type: "alert",
      title: "Ligne suspendue a traiter",
      message: "La ligne +212600100104 reste suspendue apres depassement.",
      timestamp: "2026-04-29T08:25:00.000Z",
      is_read: false,
      status: "unread",
      priority: "critical",
      link_url: "/lignes",
      ai_recommendation: null,
      action_suggeree: "Ouvrir Lignes",
      recipient_user_id: 1,
      actor_user_id: null,
      related_resource_id: null,
      related_compliance_alert_id: null,
      source_type: "assistant",
      source_id: "alert-1",
      metadata_json: {},
    },
  ],
  unreadNotifications: 7,
  usingMock: true,
  loadedAt: "2026-04-29T08:30:00.000Z",
  sources: ["mock"],
};

export async function loadTelecomAssistantDataset(
  token: string | null,
): Promise<TelecomAssistantDataset> {
  const fallbackDataset = cloneDataset(mockTelecomAssistantDataset);

  if (!token) {
    return {
      ...fallbackDataset,
      loadedAt: new Date().toISOString(),
      usingMock: true,
      sources: ["mock"],
    };
  }

  const [
    linesResult,
    lineStatsResult,
    occupationStatsResult,
    plansResult,
    consumptionResult,
    overviewResult,
    recommendationsResult,
    cdrOverviewResult,
    notificationsResult,
  ] = await Promise.allSettled([
    fetchAllPhoneLines(token),
    phoneLinesApi.stats(token),
    phoneLinesApi.occupationStats(token),
    plansApi.list(token, { limit: PHONE_LINES_BATCH_SIZE }),
    mobileFleetApi.consumption(token),
    mobileFleetApi.overview(token),
    mobileFleetApi.recommendations(token, { limit: 6 }),
    cdrAnalyticsApi.overview(token),
    notificationsApi.unread(token, 8),
  ]);

  const lines = linesResult.status === "fulfilled" ? linesResult.value : fallbackDataset.lines;
  const plans = plansResult.status === "fulfilled" ? plansResult.value : fallbackDataset.plans;
  const fallbackRecommendations = buildFallbackRecommendations(lines, plans);
  const alertsFromCdr =
    cdrOverviewResult.status === "fulfilled"
      ? cdrOverviewResult.value.priority_alerts.slice(0, 6).map((alert) => ({
          id: `cdr-${alert.cdr_row_id}`,
          title: alert.title,
          operator: alert.operator_maroc,
          department: alert.department,
          severity: alert.severity,
          zone: alert.call_zone,
          costMad: alert.call_cost_mad,
          score: alert.fraud_risk_score_100,
          recommendation: alert.ai_recommendation || alert.recommendation,
        }))
      : buildFallbackAlerts(lines);

  const recommendationsFromApi =
    recommendationsResult.status === "fulfilled"
      ? recommendationsResult.value.items.map((item: ApiMobileFleetRecommendation) => ({
          id: `fleet-${item.fleet_row_id}`,
          title: item.title,
          operator: item.operator,
          department: item.department,
          estimatedPriceMad: Math.round(item.estimated_price_mad),
          budgetRiskScore: Math.round(item.budget_risk_score),
          riskLevel: item.risk_level,
          recommendation: item.ai_recommendation || item.recommendation,
          confidenceScore: Math.round(item.confidence_score),
        }))
      : fallbackRecommendations;

  const operatorBudgets =
    consumptionResult.status === "fulfilled"
      ? consumptionResult.value.budget_by_operator.map((entry) => ({
          label: entry.label,
          totalEstimatedPriceMad: Math.round(entry.total_estimated_price_mad),
          averageBudgetRiskScore: Math.round(entry.average_budget_risk_score),
          alertDevices: entry.alert_devices,
        }))
      : buildOperatorBudgets(lines, plans);

  const departmentBudgets =
    overviewResult.status === "fulfilled"
      ? overviewResult.value.budget_by_department.map((entry) => ({
          label: entry.label,
          totalEstimatedPriceMad: Math.round(entry.total_estimated_price_mad),
          averageBudgetRiskScore: Math.round(entry.average_budget_risk_score),
          alertDevices: entry.alert_devices,
        }))
      : buildDepartmentBudgets(lines, plans);

  const lineStats =
    lineStatsResult.status === "fulfilled"
      ? lineStatsResult.value
      : buildLineStats(lines, alertsFromCdr, recommendationsFromApi);
  const occupationStats =
    occupationStatsResult.status === "fulfilled"
      ? occupationStatsResult.value
      : buildOccupationStats(lines);
  const recentNotifications =
    notificationsResult.status === "fulfilled"
      ? notificationsResult.value
      : fallbackDataset.recentNotifications;

  const usingMock =
    linesResult.status !== "fulfilled" ||
    plansResult.status !== "fulfilled" ||
    consumptionResult.status !== "fulfilled" ||
    overviewResult.status !== "fulfilled" ||
    recommendationsResult.status !== "fulfilled" ||
    cdrOverviewResult.status !== "fulfilled";

  const sources = [
    linesResult.status === "fulfilled" ? "api:lignes" : "mock:lignes",
    plansResult.status === "fulfilled" ? "api:forfaits" : "mock:forfaits",
    consumptionResult.status === "fulfilled" ? "api:consommations" : "derive:consommations",
    overviewResult.status === "fulfilled" ? "api:dashboard" : "derive:dashboard",
    recommendationsResult.status === "fulfilled" ? "api:recommandations" : "derive:recommandations",
    cdrOverviewResult.status === "fulfilled" ? "api:alertes" : "derive:alertes",
  ];

  return {
    lines,
    lineStats,
    occupationStats,
    plans,
    operatorBudgets,
    departmentBudgets,
    recommendations: recommendationsFromApi,
    alerts: alertsFromCdr,
    recentNotifications,
    unreadNotifications: recentNotifications.filter((notification) => !notification.is_read).length,
    usingMock,
    loadedAt: new Date().toISOString(),
    sources,
  };
}
