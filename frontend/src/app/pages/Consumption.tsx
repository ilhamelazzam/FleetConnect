import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Brain,
  Coins,
  Filter,
  Gauge,
  LayoutGrid,
  ListFilter,
  Search,
  ShieldAlert,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import ActionableInsightCard from "../components/consumption/ActionableInsightCard";
import CriticalBudgetDeviceCard from "../components/consumption/CriticalBudgetDeviceCard";
import DashboardSection from "../components/dashboard/DashboardSection";
import ExpandableList from "../components/dashboard/ExpandableList";
import WidgetVisibilityManager from "../components/dashboard/WidgetVisibilityManager";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { useAuth } from "../context/AuthContext";
import {
  ApiError,
  mobileFleetApi,
  type ApiMobileFleetConsumption,
  type ApiMobileFleetDevice,
  type ApiMobileFleetFilters,
  type ApiMobileFleetOverview,
} from "../lib/api";
import {
  formatMadValue,
  formatMobileRiskLabel,
  getDeviceCategoryColor,
  getMobileRiskColor,
} from "../lib/mobile-fleet";
import {
  useDashboardPreferences,
  type DashboardWidgetDefinition,
} from "../hooks/useDashboardPreferences";

function normalizeError(error: unknown, fallbackMessage: string): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallbackMessage;
}

function clampBudgetHealth(value: number): number {
  return Math.max(0, Math.min(Math.round(value), 100));
}

function formatSignedPercentage(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(1)}%`;
}

function normalizeConfidence(value: number | null | undefined): number {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return 0;
  }

  return value <= 1 ? value * 100 : value;
}

function getRiskWeight(riskLevel: string): number {
  if (riskLevel === "Critique") {
    return 100;
  }
  if (riskLevel === "Eleve") {
    return 70;
  }
  if (riskLevel === "Moyen") {
    return 40;
  }
  return 18;
}

function getDevicePriority(device: ApiMobileFleetDevice, expectedUnitCostMad: number): number {
  const gapRatio = expectedUnitCostMad > 0 ? device.estimated_price_mad / expectedUnitCostMad : 1;
  const confidence = normalizeConfidence(device.confidence_score ?? device.prediction_confidence);

  return (
    getRiskWeight(device.risk_level) +
    (device.alert_flag ? 28 : 0) +
    gapRatio * 18 +
    confidence * 0.18
  );
}

type Tone = "critical" | "warning" | "positive" | "neutral" | "primary" | "ai";
type ViewMode = "quick" | "detailed";
type QuickPreset = "overrun" | "critical" | "high-risk" | "recommendations";

type InsightTone = "critical" | "warning" | "positive";
type InsightImpact = "Faible" | "Moyen" | "Eleve";

interface QuickFilterOption {
  key: QuickPreset;
  label: string;
  helper: string;
  metric: string;
  tone: Tone;
  icon: LucideIcon;
}

interface SupportCard {
  title: string;
  value: string;
  helper: string;
  tone: Tone;
  icon: LucideIcon;
}

interface BudgetInsight {
  id: string;
  title: string;
  badge: string;
  tone: InsightTone;
  headline: string;
  detail: string;
  recommendation: string;
  estimatedGainLabel: string;
  impact: InsightImpact;
  score: number;
  filterLabel: string;
  icon: LucideIcon;
  onPrimaryAction: () => void;
  onSecondaryAction: () => void;
}

const consumptionWidgets: DashboardWidgetDefinition[] = [
  {
    id: "kpis",
    label: "Indicateurs de pilotage",
    description: "Sante budget, cout moyen, alertes et suivi du parc.",
    defaultVisible: true,
  },
  {
    id: "ai-insights",
    label: "Resume IA et benchmark",
    description: "Insights actionnables et comparaison budget reel vs optimal.",
    defaultVisible: true,
  },
  {
    id: "secondary-charts",
    label: "Analyses detaillees",
    description: "Graphiques par operateur, categorie et niveau de risque.",
    defaultVisible: false,
  },
  {
    id: "expensive-devices",
    label: "Appareils critiques",
    description: "Priorisation rapide des postes les plus couteux.",
    defaultVisible: true,
  },
];

function getToneClasses(tone: Tone): {
  card: string;
  badge: string;
  icon: string;
  accent: string;
  subtle: string;
} {
  if (tone === "primary") {
    return {
      card: "bc-surface-primary",
      badge: "border-[var(--bc-primary-border)] bg-[var(--bc-primary-soft)] text-[var(--bc-primary)]",
      icon: "bc-icon-primary",
      accent: "text-[var(--bc-primary-hover)]",
      subtle: "text-[var(--bc-primary)]",
    };
  }

  if (tone === "ai") {
    return {
      card: "bc-surface-ai",
      badge: "border-[var(--bc-ai-border)] bg-[linear-gradient(135deg,rgba(99,102,241,0.14),rgba(139,92,246,0.16))] text-[var(--bc-ai-start)]",
      icon: "bc-icon-ai",
      accent: "text-[var(--bc-ai-end)]",
      subtle: "text-[var(--bc-ai-start)]",
    };
  }

  if (tone === "critical") {
    return {
      card: "bc-surface-danger",
      badge: "border-[var(--bc-danger-border)] bg-[var(--bc-danger-soft)] text-[var(--bc-danger)]",
      icon: "bc-icon-danger",
      accent: "text-[var(--bc-danger-hover)]",
      subtle: "text-[var(--bc-danger)]",
    };
  }

  if (tone === "warning") {
    return {
      card: "bc-surface-warning",
      badge: "border-[var(--bc-warning-border)] bg-[var(--bc-warning-soft)] text-[var(--bc-warning)]",
      icon: "bc-icon-warning",
      accent: "text-[var(--bc-warning-hover)]",
      subtle: "text-[var(--bc-warning)]",
    };
  }

  if (tone === "positive") {
    return {
      card: "bc-surface-success",
      badge: "border-[var(--bc-success-border)] bg-[var(--bc-success-soft)] text-[var(--bc-success)]",
      icon: "bc-icon-success",
      accent: "text-[var(--bc-success-hover)]",
      subtle: "text-[var(--bc-success)]",
    };
  }

  return {
    card: "bc-surface-neutral",
    badge: "border-[var(--bc-neutral-border)] bg-white text-[var(--bc-neutral-body)]",
    icon: "bg-white text-[var(--bc-neutral-body)]",
    accent: "text-[var(--bc-neutral-strong)]",
    subtle: "text-[var(--bc-neutral-body)]",
  };
}

function getViewModeClasses(isActive: boolean): string {
  if (isActive) {
    return "bg-[var(--bc-primary)] text-white shadow-[0_12px_24px_rgba(59,130,246,0.2)]";
  }

  return "text-[var(--bc-neutral-body)] hover:bg-[var(--bc-primary-soft)] hover:text-[var(--bc-primary)]";
}

export default function Consumption() {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const dashboardPreferences = useDashboardPreferences(
    "consumption-budget",
    consumptionWidgets,
    user?.email,
  );
  const [filters, setFilters] = useState<ApiMobileFleetFilters | null>(null);
  const [consumption, setConsumption] = useState<ApiMobileFleetConsumption | null>(null);
  const [overview, setOverview] = useState<ApiMobileFleetOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedOperator, setSelectedOperator] = useState("all");
  const [selectedDepartment, setSelectedDepartment] = useState("all");
  const [selectedProfile, setSelectedProfile] = useState("all");
  const [selectedDeviceCategory, setSelectedDeviceCategory] = useState("all");
  const [selectedRiskLevel, setSelectedRiskLevel] = useState("all");
  const [viewMode, setViewMode] = useState<ViewMode>("quick");
  const [activeQuickPreset, setActiveQuickPreset] = useState<QuickPreset | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadFilters() {
      if (!token) {
        return;
      }

      try {
        const response = await mobileFleetApi.filters(token);
        if (isMounted) {
          setFilters(response);
        }
      } catch (error) {
        if (isMounted) {
          setErrorMessage(
            normalizeError(error, "Impossible de charger les filtres de consommation."),
          );
        }
      }
    }

    void loadFilters();

    return () => {
      isMounted = false;
    };
  }, [token]);

  useEffect(() => {
    let isMounted = true;

    async function loadConsumption() {
      if (!token) {
        if (isMounted) {
          setConsumption(null);
          setOverview(null);
          setIsLoading(false);
        }
        return;
      }

      setIsLoading(true);
      setErrorMessage(null);

      try {
        const params = {
          search: searchQuery.trim() || undefined,
          operator: selectedOperator !== "all" ? selectedOperator : undefined,
          department: selectedDepartment !== "all" ? selectedDepartment : undefined,
          employee_profile: selectedProfile !== "all" ? selectedProfile : undefined,
          device_category: selectedDeviceCategory !== "all" ? selectedDeviceCategory : undefined,
          risk_level: selectedRiskLevel !== "all" ? selectedRiskLevel : undefined,
        };
        const response = await mobileFleetApi.consumption(token, params);
        const overviewResponse = await mobileFleetApi.overview(token, params);

        if (isMounted) {
          setConsumption(response);
          setOverview(overviewResponse);
        }
      } catch (error) {
        if (isMounted) {
          setConsumption(null);
          setOverview(null);
          setErrorMessage(
            normalizeError(error, "Impossible de charger les indicateurs budgetaires."),
          );
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadConsumption();

    return () => {
      isMounted = false;
    };
  }, [
    token,
    searchQuery,
    selectedOperator,
    selectedDepartment,
    selectedProfile,
    selectedDeviceCategory,
    selectedRiskLevel,
  ]);

  const clearQuickPreset = () => setActiveQuickPreset(null);

  const resetFilters = () => {
    setSearchQuery("");
    setSelectedOperator("all");
    setSelectedDepartment("all");
    setSelectedProfile("all");
    setSelectedDeviceCategory("all");
    setSelectedRiskLevel("all");
    setActiveQuickPreset(null);
  };

  const kpis = consumption?.kpis;
  const totalDevices = kpis?.total_devices ?? 0;
  const totalBudgetMad = kpis?.total_estimated_budget_mad ?? 0;
  const averageCostMad = kpis?.average_estimated_price_mad ?? 0;
  const averageRiskScore = kpis?.average_budget_risk_score ?? 0;
  const alertDevices = kpis?.alert_devices ?? 0;
  const criticalRisks = kpis?.critical_risks ?? 0;

  const operatorCountMap = useMemo(
    () => new Map((overview?.devices_by_operator ?? []).map((item) => [item.label, item.count])),
    [overview?.devices_by_operator],
  );
  const categoryCountMap = useMemo(
    () => new Map((overview?.devices_by_category ?? []).map((item) => [item.label, item.count])),
    [overview?.devices_by_category],
  );

  const topOperatorBudget = useMemo(
    () =>
      [...(consumption?.budget_by_operator ?? [])].sort(
        (left, right) => right.total_estimated_price_mad - left.total_estimated_price_mad,
      )[0] ?? null,
    [consumption?.budget_by_operator],
  );
  const dominantCategory = useMemo(
    () =>
      [...(overview?.devices_by_category ?? [])].sort((left, right) => right.count - left.count)[0] ??
      [...(consumption?.budget_by_device_category ?? [])].sort(
        (left, right) => right.total_estimated_price_mad - left.total_estimated_price_mad,
      )[0] ??
      null,
    [consumption?.budget_by_device_category, overview?.devices_by_category],
  );
  const topRiskBucket = useMemo(
    () =>
      [...(consumption?.risk_distribution ?? [])].sort((left, right) => right.count - left.count)[0] ??
      null,
    [consumption?.risk_distribution],
  );

  const topOperatorSharePct =
    totalBudgetMad > 0 && topOperatorBudget
      ? (topOperatorBudget.total_estimated_price_mad / totalBudgetMad) * 100
      : 0;
  const alertRatio = totalDevices > 0 ? alertDevices / totalDevices : 0;
  const criticalRatio = totalDevices > 0 ? criticalRisks / totalDevices : 0;
  const operatorConcentrationPenalty = Math.max(topOperatorSharePct - 42, 0) * 0.6;
  const budgetHealthScore = clampBudgetHealth(
    100 -
      averageRiskScore * 0.36 -
      alertRatio * 28 -
      criticalRatio * 48 -
      operatorConcentrationPenalty,
  );
  const budgetOverrunRate = Math.min(
    alertRatio * 0.22 +
      criticalRatio * 0.34 +
      Math.max(averageRiskScore - 50, 0) / 300 +
      Math.max(topOperatorSharePct - 40, 0) / 220,
    0.42,
  );
  const expectedNormalBudgetMad = Math.max(Math.round(totalBudgetMad * (1 - budgetOverrunRate)), 0);
  const budgetGapMad = Math.max(totalBudgetMad - expectedNormalBudgetMad, 0);
  const expectedUnitCostMad = totalDevices > 0 ? expectedNormalBudgetMad / totalDevices : 0;
  const budgetGapPct = expectedNormalBudgetMad > 0 ? (budgetGapMad / expectedNormalBudgetMad) * 100 : 0;
  const savingsPct = totalBudgetMad > 0 ? (budgetGapMad / totalBudgetMad) * 100 : 0;
  const riskCoveragePct = totalDevices > 0 ? (alertDevices / totalDevices) * 100 : 0;
  const criticalCoveragePct = totalDevices > 0 ? (criticalRisks / totalDevices) * 100 : 0;

  const operatorBudgetWithBenchmark = useMemo(
    () =>
      (consumption?.budget_by_operator ?? []).map((item) => {
        const deviceCount = operatorCountMap.get(item.label) ?? 0;
        const expectedBudgetMad = Math.round(deviceCount * expectedUnitCostMad);
        const gapMad = item.total_estimated_price_mad - expectedBudgetMad;

        return {
          ...item,
          deviceCount,
          expectedBudgetMad,
          gapMad,
          gapPct: expectedBudgetMad > 0 ? (gapMad / expectedBudgetMad) * 100 : 0,
        };
      }),
    [consumption?.budget_by_operator, expectedUnitCostMad, operatorCountMap],
  );

  const categoryBudgetWithBenchmark = useMemo(
    () =>
      (consumption?.budget_by_device_category ?? []).map((item) => {
        const deviceCount = categoryCountMap.get(item.label) ?? 0;
        const expectedBudgetMad = Math.round(deviceCount * expectedUnitCostMad);
        const gapMad = item.total_estimated_price_mad - expectedBudgetMad;

        return {
          ...item,
          deviceCount,
          expectedBudgetMad,
          gapMad,
          gapPct: expectedBudgetMad > 0 ? (gapMad / expectedBudgetMad) * 100 : 0,
        };
      }),
    [categoryCountMap, consumption?.budget_by_device_category, expectedUnitCostMad],
  );

  const mostOverBudgetOperator = useMemo(
    () =>
      [...operatorBudgetWithBenchmark].sort((left, right) => right.gapMad - left.gapMad)[0] ?? null,
    [operatorBudgetWithBenchmark],
  );

  const dominantCategoryBenchmark = useMemo(
    () =>
      dominantCategory
        ? categoryBudgetWithBenchmark.find((item) => item.label === dominantCategory.label) ?? null
        : null,
    [categoryBudgetWithBenchmark, dominantCategory],
  );

  const prioritizedDevices = useMemo(
    () =>
      [...(consumption?.top_expensive_devices ?? [])].sort(
        (left, right) =>
          getDevicePriority(right, expectedUnitCostMad) -
          getDevicePriority(left, expectedUnitCostMad),
      ),
    [consumption?.top_expensive_devices, expectedUnitCostMad],
  );

  const highlightedDevices = prioritizedDevices.slice(0, viewMode === "quick" ? 3 : 4);
  const additionalDevices = prioritizedDevices.slice(viewMode === "quick" ? 3 : 4);
  const topRiskExposureMad = prioritizedDevices
    .slice(0, 6)
    .reduce(
      (total, device) => total + Math.max(device.estimated_price_mad - expectedUnitCostMad, 0),
      0,
    );

  const activeFilterLabels = [
    selectedOperator !== "all" ? selectedOperator : null,
    selectedDepartment !== "all" ? selectedDepartment : null,
    selectedProfile !== "all" ? selectedProfile : null,
    selectedDeviceCategory !== "all" ? selectedDeviceCategory : null,
    selectedRiskLevel !== "all" ? formatMobileRiskLabel(selectedRiskLevel) : null,
  ].filter((value): value is string => value !== null);

  const mainOperatorLabel =
    mostOverBudgetOperator?.label ?? topOperatorBudget?.label ?? "l'operateur principal";
  const executiveSummary =
    budgetGapMad > 0
      ? `Votre flotte presente un surcout de ${formatSignedPercentage(
          budgetGapPct,
        )} avec ${alertDevices} appareils a risque. L'IA recommande une optimisation prioritaire sur ${mainOperatorLabel}.`
      : `Votre flotte reste proche du budget optimal. L'IA recommande de maintenir le suivi sur ${mainOperatorLabel} et les segments les plus sensibles.`;
  const executiveActionLabel =
    mostOverBudgetOperator && mostOverBudgetOperator.gapMad > 0
      ? `Prioriser ${mostOverBudgetOperator.label} puis revisiter les forfaits ${dominantCategory?.label ?? "sensibles"}.`
      : "Maintenir la surveillance et confirmer les scenarios d'optimisation automatiques.";

  const quickFilterOptions = useMemo<QuickFilterOption[]>(
    () => [
      {
        key: "overrun",
        label: "Surcout eleve",
        helper: mostOverBudgetOperator
          ? `${mostOverBudgetOperator.label} concentre le plus grand depassement`
          : "Focus sur la zone budgetaire la plus depassante",
        metric: formatSignedPercentage(budgetGapPct),
        tone: "warning",
        icon: TrendingUp,
      },
      {
        key: "critical",
        label: "Appareils critiques",
        helper: "Isole les postes a traiter en priorite",
        metric: `${criticalRisks}`,
        tone: "critical",
        icon: ShieldAlert,
      },
      {
        key: "high-risk",
        label: "Risque eleve",
        helper: "Affiche les poches a surveiller avant depassement",
        metric: `${Math.round(riskCoveragePct)}%`,
        tone: "warning",
        icon: AlertTriangle,
      },
      {
        key: "recommendations",
        label: "Recommandations IA",
        helper: dominantCategory
          ? `${dominantCategory.label} et ${mainOperatorLabel} a arbitrer`
          : "Affiche la priorite d'action IA",
        metric: `${Math.min(prioritizedDevices.length, 6)} actions`,
        tone: "ai",
        icon: Sparkles,
      },
    ],
    [
      budgetGapPct,
      criticalRisks,
      dominantCategory,
      mainOperatorLabel,
      mostOverBudgetOperator,
      prioritizedDevices.length,
      riskCoveragePct,
    ],
  );

  const topKpis = [
    {
      title: "Budget total",
      value: isLoading ? "--" : formatMadValue(totalBudgetMad),
      helper: `${totalDevices} appareils dans le perimetre courant`,
      deltaLabel:
        totalBudgetMad > 0 ? `${formatSignedPercentage(savingsPct)} du budget recuperable` : "--",
      tone: "primary" as Tone,
      icon: Wallet,
    },
    {
      title: "Ecart vs budget optimal",
      value: isLoading ? "--" : formatSignedPercentage(budgetGapPct),
      helper:
        budgetGapMad > 0
          ? `${formatMadValue(budgetGapMad)} au-dessus du niveau cible`
          : "La flotte reste dans la zone cible",
      deltaLabel:
        budgetGapPct > 0
          ? `${formatSignedPercentage(budgetGapPct)} d'ecart`
          : "Budget optimise",
      tone:
        budgetGapPct >= 20 ? "critical" : budgetGapPct >= 10 ? "warning" : "positive",
      icon: TrendingDown,
    },
    {
      title: "Economies potentielles",
      value: isLoading ? "--" : formatMadValue(budgetGapMad),
      helper:
        budgetGapMad > 0
          ? `${mainOperatorLabel} et ${dominantCategory?.label ?? "les segments prioritaires"} a traiter`
          : "Aucun gisement majeur detecte",
      deltaLabel:
        budgetGapMad > 0 ? `${formatSignedPercentage(savingsPct)} du budget total` : "0.0%",
      tone:
        budgetGapMad > totalBudgetMad * 0.1
          ? "critical"
          : budgetGapMad > totalBudgetMad * 0.04
            ? "warning"
            : "positive",
      icon: Coins,
    },
  ];

  const supportCards: SupportCard[] = [
    {
      title: "Sante budget",
      value: isLoading ? "--" : `${budgetHealthScore}/100`,
      helper:
        budgetHealthScore < 55
          ? "Pression budgetaire elevee a traiter"
          : budgetHealthScore < 75
            ? "Zone de vigilance a surveiller"
            : "Equilibre budgetaire correct",
      tone: budgetHealthScore < 55 ? "critical" : budgetHealthScore < 75 ? "warning" : "positive",
      icon: Gauge,
    },
    {
      title: "Cout moyen",
      value: isLoading ? "--" : formatMadValue(averageCostMad),
      helper: `${formatSignedPercentage(averageRiskScore / 100)} de score de risque moyen`,
      tone: averageRiskScore >= 65 ? "warning" : "primary",
      icon: Wallet,
    },
    {
      title: "Alertes budgetaires",
      value: isLoading ? "--" : `${alertDevices}`,
      helper: `${riskCoveragePct.toFixed(1)}% du parc sous surveillance`,
      tone: riskCoveragePct >= 25 ? "critical" : riskCoveragePct >= 12 ? "warning" : "primary",
      icon: AlertTriangle,
    },
    {
      title: "Risques critiques",
      value: isLoading ? "--" : `${criticalRisks}`,
      helper: `${criticalCoveragePct.toFixed(1)}% des appareils en alerte forte`,
      tone:
        criticalCoveragePct >= 10 ? "critical" : criticalCoveragePct >= 4 ? "warning" : "primary",
      icon: ShieldAlert,
    },
  ];

  const budgetGapTone: Tone =
    budgetGapPct >= 20 ? "critical" : budgetGapPct >= 10 ? "warning" : "positive";
  const budgetGapStyles = getToneClasses(budgetGapTone);
  const executiveGainStyles = getToneClasses(budgetGapMad > 0 ? "positive" : "primary");
  const executiveCriticalStyles = getToneClasses(criticalRisks > 0 ? "critical" : "primary");
  const executiveActionStyles = getToneClasses("ai");

  const openOptimizationWorkspace = () => {
    toast.success("Scenario d'optimisation prepare", {
      description: `${mainOperatorLabel} et les appareils ${dominantCategory?.label ?? "prioritaires"} sont places en tete des recommandations IA.`,
    });
    navigate("/recommandations");
  };

  const openPlansWorkspace = (description: string) => {
    toast.success("Optimisation forfait ouverte", {
      description,
    });
    navigate("/forfaits");
  };

  const openAnomalyWorkspace = (description: string) => {
    toast.info("Vue anomalies ouverte", {
      description,
    });
    navigate("/anomalies");
  };

  const applyOperatorFilter = (operatorLabel: string) => {
    clearQuickPreset();
    setSelectedOperator(operatorLabel);
    toast.success("Filtre operateur applique", {
      description: `${operatorLabel} est maintenant le focus budgetaire principal.`,
    });
  };

  const applyCategoryFilter = (categoryLabel: string) => {
    clearQuickPreset();
    setSelectedDeviceCategory(categoryLabel);
    toast.success("Filtre categorie applique", {
      description: `${categoryLabel} est maintenant le segment prioritaire.`,
    });
  };

  const applyRiskFilter = (riskLabel: string) => {
    clearQuickPreset();
    setSelectedRiskLevel(riskLabel);
    toast.success("Filtre risque applique", {
      description: `${formatMobileRiskLabel(riskLabel)} est maintenant le niveau prioritaire.`,
    });
  };

  const budgetInsights = useMemo<BudgetInsight[]>(() => {
    const operatorGapMad = Math.max(mostOverBudgetOperator?.gapMad ?? 0, 0);
    const operatorGapPct = Math.max(mostOverBudgetOperator?.gapPct ?? 0, 0);
    const operatorScore = Math.min(
      98,
      Math.round(58 + topOperatorSharePct * 0.7 + operatorGapPct * 0.35),
    );

    const categorySharePct =
      totalDevices > 0 && dominantCategory
        ? ((categoryCountMap.get(dominantCategory.label) ?? 0) / totalDevices) * 100
        : 0;
    const categoryGapMad = Math.max(dominantCategoryBenchmark?.gapMad ?? 0, 0);
    const categoryGapPct = Math.max(dominantCategoryBenchmark?.gapPct ?? 0, 0);
    const categoryScore = Math.min(
      95,
      Math.round(52 + categorySharePct * 0.45 + categoryGapPct * 0.35),
    );

    const riskScore = Math.min(
      99,
      Math.round(54 + averageRiskScore * 0.35 + criticalCoveragePct * 1.6),
    );

    return [
      {
        id: "operator-cost",
        title: "Resume executif IA",
        badge: operatorGapMad > totalBudgetMad * 0.08 ? "Critique" : "Surcout",
        tone: operatorGapMad > totalBudgetMad * 0.08 ? "critical" : "warning",
        headline: mostOverBudgetOperator
          ? `${mostOverBudgetOperator.label} depasse sa cible de ${formatSignedPercentage(
              operatorGapPct,
            )}`
          : "Aucun operateur dominant a arbitrer",
        detail: mostOverBudgetOperator
          ? `Budget reel ${formatMadValue(
              mostOverBudgetOperator.total_estimated_price_mad,
            )} vs budget optimal ${formatMadValue(mostOverBudgetOperator.expectedBudgetMad)}.`
          : "Le portefeuille operateur reste proche du budget attendu.",
        recommendation:
          "Basculer les lignes premium sur les profils adequats et renegocier les forfaits les plus exposes.",
        estimatedGainLabel: formatMadValue(operatorGapMad),
        impact:
          operatorGapMad > totalBudgetMad * 0.1
            ? "Eleve"
            : operatorGapMad > totalBudgetMad * 0.04
              ? "Moyen"
              : "Faible",
        score: operatorScore,
        filterLabel: mostOverBudgetOperator?.label ?? "Operateurs",
        icon: Wallet,
        onPrimaryAction: () =>
          openPlansWorkspace(
            `${mostOverBudgetOperator?.label ?? "L'operateur prioritaire"} est envoye vers l'espace d'optimisation forfaitaire.`,
          ),
        onSecondaryAction: () => {
          if (!mostOverBudgetOperator) {
            return;
          }
          applyOperatorFilter(mostOverBudgetOperator.label);
        },
      },
      {
        id: "dominant-category",
        title: "Levier categorie",
        badge: dominantCategory?.label === "Premium" ? "Priorite haute" : "A suivre",
        tone: dominantCategory?.label === "Premium" ? "critical" : "warning",
        headline: dominantCategory
          ? `${dominantCategory.label} concentre ${categorySharePct.toFixed(1)}% du parc`
          : "Categorie dominante indisponible",
        detail: dominantCategoryBenchmark
          ? `Budget ${formatMadValue(
              dominantCategoryBenchmark.total_estimated_price_mad,
            )} pour ${dominantCategoryBenchmark.deviceCount} appareils.`
          : "Aucune categorie prioritaire n'est detectee sur la vue courante.",
        recommendation:
          "Cibler la categorie dominante pour realigner le cout unitaire et supprimer les usages premium sans justification.",
        estimatedGainLabel: formatMadValue(categoryGapMad),
        impact:
          dominantCategory?.label === "Premium" || categoryGapPct >= 18
            ? "Eleve"
            : categoryGapPct >= 8
              ? "Moyen"
              : "Faible",
        score: categoryScore,
        filterLabel: dominantCategory?.label ?? "Categorie",
        icon: Coins,
        onPrimaryAction: () => {
          toast.success("Recommandation IA activee", {
            description: `Le focus categorie ouvre maintenant ${dominantCategory?.label ?? "la categorie prioritaire"} dans les recommandations.`,
          });
          navigate("/recommandations");
        },
        onSecondaryAction: () => {
          if (!dominantCategory) {
            return;
          }
          applyCategoryFilter(dominantCategory.label);
        },
      },
      {
        id: "risk-devices",
        title: "Poche de risque",
        badge: criticalRisks > 0 ? "Critique" : "Sous controle",
        tone: criticalRisks > 0 ? "critical" : "positive",
        headline: `${alertDevices} appareils a suivre dont ${criticalRisks} critiques`,
        detail: topRiskBucket
          ? `Le risque ${formatMobileRiskLabel(topRiskBucket.label)} represente ${topRiskBucket.count} appareils sur le perimetre courant.`
          : "Aucun niveau de risque dominant detecte.",
        recommendation:
          "Traiter les anomalies budgetaires les plus couteuses en premier, puis verrouiller les forfaits non conformes.",
        estimatedGainLabel: formatMadValue(topRiskExposureMad),
        impact: criticalRisks > 0 ? "Eleve" : alertDevices > 0 ? "Moyen" : "Faible",
        score: riskScore,
        filterLabel: criticalRisks > 0 ? "Critique" : topRiskBucket?.label ?? "Risques",
        icon: ShieldAlert,
        onPrimaryAction: () =>
          openAnomalyWorkspace(
            "Les anomalies budgetaires les plus sensibles sont ouvertes pour arbitrage.",
          ),
        onSecondaryAction: () => {
          if (criticalRisks > 0) {
            applyRiskFilter("Critique");
            return;
          }
          if (topRiskBucket) {
            applyRiskFilter(topRiskBucket.label);
          }
        },
      },
    ];
  }, [
    alertDevices,
    averageRiskScore,
    categoryCountMap,
    criticalCoveragePct,
    criticalRisks,
    dominantCategory,
    dominantCategoryBenchmark,
    mainOperatorLabel,
    mostOverBudgetOperator,
    navigate,
    topOperatorSharePct,
    topRiskBucket,
    topRiskExposureMad,
    totalBudgetMad,
    totalDevices,
  ]);

  const visibleInsights = viewMode === "quick" ? budgetInsights.slice(0, 2) : budgetInsights;

  const applyQuickPreset = (preset: QuickPreset) => {
    setActiveQuickPreset(preset);
    setSearchQuery("");
    setSelectedDepartment("all");
    setSelectedProfile("all");

    if (preset === "overrun") {
      setSelectedOperator(mostOverBudgetOperator?.label ?? "all");
      setSelectedDeviceCategory("all");
      setSelectedRiskLevel("all");
      toast.success("Vue surcout eleve activee", {
        description: `${mainOperatorLabel} devient la priorite d'analyse.`,
      });
      return;
    }

    if (preset === "critical") {
      setSelectedOperator("all");
      setSelectedDeviceCategory("all");
      setSelectedRiskLevel("Critique");
      toast.success("Vue appareils critiques activee", {
        description: "Le tableau se concentre maintenant sur les risques critiques.",
      });
      return;
    }

    if (preset === "high-risk") {
      setSelectedOperator("all");
      setSelectedDeviceCategory("all");
      setSelectedRiskLevel("Eleve");
      toast.success("Vue risque eleve activee", {
        description: "Les zones sous tension sont maintenant isolees.",
      });
      return;
    }

    setSelectedOperator(mostOverBudgetOperator?.label ?? "all");
    setSelectedDeviceCategory(dominantCategory?.label ?? "all");
    setSelectedRiskLevel(criticalRisks > 0 ? "Critique" : "all");
    toast.success("Vue recommandations IA activee", {
      description: "Le parc prioritaire est filtre sur les leviers a plus fort impact.",
    });
  };

  return (
    <div className="space-y-6 p-6">
      <section className="rounded-[30px] border border-[var(--bc-primary-border)] bg-[linear-gradient(135deg,rgba(239,246,255,0.95)_0%,rgba(245,243,255,0.92)_48%,#FFFFFF_100%)] p-6 shadow-[0_18px_48px_rgba(37,99,235,0.08)]">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-3xl">
            <Badge variant="ai" className="px-3 py-1">
              <Sparkles className="h-3.5 w-3.5" />
              Pilotage budgetaire IA
            </Badge>
            <h1 className="mt-4 text-3xl font-bold tracking-tight text-[var(--bc-neutral-strong)]">
              Consommations & budget
            </h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-[var(--bc-neutral-body)]">
              Tableau decisionnel pour identifier les surcouts, prioriser les appareils critiques
              et activer les recommandations IA en quelques secondes.
            </p>
          </div>

          <div className="inline-flex rounded-2xl border border-[var(--bc-neutral-border)] bg-white/90 p-1 shadow-sm">
            <button
              type="button"
              onClick={() => setViewMode("quick")}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${getViewModeClasses(viewMode === "quick")}`}
            >
              <Zap className="h-4 w-4" />
              Vue rapide
            </button>
            <button
              type="button"
              onClick={() => setViewMode("detailed")}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${getViewModeClasses(viewMode === "detailed")}`}
            >
              <LayoutGrid className="h-4 w-4" />
              Vue detaillee
            </button>
          </div>
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-[1.25fr_0.95fr]">
          <div className="rounded-[26px] border border-white/90 bg-white/88 p-5 shadow-[0_16px_34px_rgba(15,23,42,0.05)]">
            <div className="flex items-start gap-4">
              <div className="bc-gradient-ai rounded-3xl p-3 text-white shadow-[0_14px_28px_rgba(99,102,241,0.18)]">
                <Brain className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--bc-neutral-body)]">
                    Resume executif IA
                  </p>
                  <Badge className={`px-3 py-1 ${budgetGapStyles.badge}`}>
                    {budgetGapMad > 0 ? `Surcout detecte ${formatSignedPercentage(budgetGapPct)}` : "Budget optimise"}
                  </Badge>
                </div>
                <p className="mt-3 text-xl font-semibold leading-8 text-[var(--bc-neutral-strong)]">
                  {isLoading ? "Chargement des arbitrages IA..." : executiveSummary}
                </p>
                <p className="mt-3 text-sm leading-6 text-[var(--bc-neutral-body)]">{executiveActionLabel}</p>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className={`rounded-2xl border px-4 py-3 ${executiveGainStyles.card}`}>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--bc-neutral-muted)]">
                  Economie potentielle
                </p>
                <p className={`mt-2 text-lg font-bold ${executiveGainStyles.accent}`}>
                  {isLoading ? "--" : formatMadValue(budgetGapMad)}
                </p>
              </div>
              <div className={`rounded-2xl border px-4 py-3 ${budgetGapStyles.card}`}>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--bc-neutral-muted)]">
                  % de surcout
                </p>
                <p className={`mt-2 text-lg font-bold ${budgetGapStyles.accent}`}>
                  {isLoading ? "--" : formatSignedPercentage(budgetGapPct)}
                </p>
              </div>
              <div className={`rounded-2xl border px-4 py-3 ${executiveCriticalStyles.card}`}>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--bc-neutral-muted)]">
                  Appareils critiques
                </p>
                <p className={`mt-2 text-lg font-bold ${executiveCriticalStyles.accent}`}>{isLoading ? "--" : criticalRisks}</p>
              </div>
              <div className={`rounded-2xl border px-4 py-3 ${executiveActionStyles.card}`}>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--bc-neutral-muted)]">
                  Action recommandee
                </p>
                <p className={`mt-2 text-sm font-semibold leading-6 ${executiveActionStyles.accent}`}>
                  {mainOperatorLabel}
                </p>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <Button
                type="button"
                className="rounded-2xl px-4 py-2.5 text-sm font-semibold"
                onClick={openOptimizationWorkspace}
              >
                <Sparkles className="h-4 w-4" />
                Optimiser automatiquement
              </Button>
              <Button
                type="button"
                variant="outline"
                className="rounded-2xl px-4 py-2.5 text-sm font-semibold"
                onClick={() =>
                  openAnomalyWorkspace(
                    "La vue des anomalies budgetaires s'ouvre avec priorisation des zones critiques.",
                  )
                }
              >
                <AlertTriangle className="h-4 w-4" />
                Voir les anomalies
              </Button>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-1">
            {topKpis.map((kpi) => {
              const styles = getToneClasses(kpi.tone);
              const Icon = kpi.icon;
              const DeltaIcon =
                kpi.tone === "positive" ? ArrowDownRight : kpi.tone === "critical" ? ArrowUpRight : TrendingUp;

              return (
                <article
                  key={kpi.title}
                  className={`rounded-[22px] border p-4 shadow-[0_16px_34px_rgba(15,23,42,0.05)] ${styles.card}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                        {kpi.title}
                      </p>
                      <p className="mt-3 text-3xl font-bold tracking-tight text-[var(--bc-neutral-strong)]">
                        {kpi.value}
                      </p>
                    </div>
                    <div className={`rounded-2xl p-3 ${styles.icon}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-[var(--bc-neutral-body)]">{kpi.helper}</p>
                  <div className="mt-4 flex items-center gap-2">
                    <Badge className={styles.badge}>
                      <DeltaIcon className="h-3.5 w-3.5" />
                      {kpi.deltaLabel}
                    </Badge>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {errorMessage ? (
        <Alert variant="destructive" className="rounded-2xl">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Chargement impossible</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      <section className="rounded-[24px] border border-[var(--bc-neutral-border)] bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-[var(--bc-neutral-body)]">
              <Filter className="h-4 w-4" />
              <span>{isLoading ? "--" : totalDevices} appareils dans le perimetre courant</span>
            </div>
            <h2 className="mt-3 text-lg font-semibold text-[var(--bc-neutral-strong)]">Filtres intelligents</h2>
            <p className="mt-1 text-sm leading-6 text-[var(--bc-neutral-body)]">
              Alternez entre une lecture rapide et une analyse detaillee sans perdre le fil
              business.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="rounded-2xl px-4 py-2.5 text-sm font-semibold"
              onClick={resetFilters}
            >
              Reinitialiser
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {quickFilterOptions.map((option) => {
            const Icon = option.icon;
            const isActive = activeQuickPreset === option.key;
            const styles = getToneClasses(option.tone);

            return (
              <button
                key={option.key}
                type="button"
                onClick={() => applyQuickPreset(option.key)}
                className={`rounded-[20px] border p-3.5 text-left transition-all duration-200 ${
                  isActive
                    ? `${styles.card} shadow-[0_14px_28px_rgba(15,23,42,0.08)]`
                    : `${styles.card} opacity-90 hover:-translate-y-0.5 hover:opacity-100 hover:shadow-sm`
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className={`rounded-2xl p-2.5 ${isActive ? styles.icon : styles.icon}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <Badge className={isActive ? styles.badge : styles.badge}>
                    {option.metric}
                  </Badge>
                </div>
                <h3 className="mt-3 text-[15px] font-semibold text-[var(--bc-neutral-strong)]">{option.label}</h3>
                <p className="mt-1.5 text-sm leading-6 text-[var(--bc-neutral-body)]">{option.helper}</p>
              </button>
            );
          })}
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-6">
          <div className="relative xl:col-span-2">
            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--bc-neutral-body)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => {
                clearQuickPreset();
                setSearchQuery(event.target.value);
              }}
              placeholder="Operateur, profil, recommandation..."
              className="w-full rounded-2xl border border-[var(--bc-neutral-border)] bg-[var(--bc-neutral-soft)] py-3 pl-11 pr-4 text-sm text-[var(--bc-neutral-strong)] outline-none transition-all focus:border-[var(--bc-primary-border)] focus:bg-white focus:ring-4 focus:ring-[rgba(59,130,246,0.16)]"
            />
          </div>

          {viewMode === "detailed" ? (
            <>
              <select
                value={selectedOperator}
                onChange={(event) => {
                  clearQuickPreset();
                  setSelectedOperator(event.target.value);
                }}
                className="rounded-2xl border border-[var(--bc-neutral-border)] bg-[var(--bc-neutral-soft)] px-4 py-3 text-sm text-[var(--bc-neutral-strong)] outline-none transition-all focus:border-[var(--bc-primary-border)] focus:bg-white focus:ring-4 focus:ring-[rgba(59,130,246,0.16)]"
              >
                <option value="all">Tous les operateurs</option>
                {(filters?.operators ?? []).map((operator) => (
                  <option key={operator} value={operator}>
                    {operator}
                  </option>
                ))}
              </select>

              <select
                value={selectedDepartment}
                onChange={(event) => {
                  clearQuickPreset();
                  setSelectedDepartment(event.target.value);
                }}
                className="rounded-2xl border border-[var(--bc-neutral-border)] bg-[var(--bc-neutral-soft)] px-4 py-3 text-sm text-[var(--bc-neutral-strong)] outline-none transition-all focus:border-[var(--bc-primary-border)] focus:bg-white focus:ring-4 focus:ring-[rgba(59,130,246,0.16)]"
              >
                <option value="all">Tous les departements</option>
                {(filters?.departments ?? []).map((department) => (
                  <option key={department} value={department}>
                    {department}
                  </option>
                ))}
              </select>

              <select
                value={selectedProfile}
                onChange={(event) => {
                  clearQuickPreset();
                  setSelectedProfile(event.target.value);
                }}
                className="rounded-2xl border border-[var(--bc-neutral-border)] bg-[var(--bc-neutral-soft)] px-4 py-3 text-sm text-[var(--bc-neutral-strong)] outline-none transition-all focus:border-[var(--bc-primary-border)] focus:bg-white focus:ring-4 focus:ring-[rgba(59,130,246,0.16)]"
              >
                <option value="all">Tous les profils</option>
                {(filters?.employee_profiles ?? []).map((profile) => (
                  <option key={profile} value={profile}>
                    {profile}
                  </option>
                ))}
              </select>

              <select
                value={selectedDeviceCategory}
                onChange={(event) => {
                  clearQuickPreset();
                  setSelectedDeviceCategory(event.target.value);
                }}
                className="rounded-2xl border border-[var(--bc-neutral-border)] bg-[var(--bc-neutral-soft)] px-4 py-3 text-sm text-[var(--bc-neutral-strong)] outline-none transition-all focus:border-[var(--bc-primary-border)] focus:bg-white focus:ring-4 focus:ring-[rgba(59,130,246,0.16)]"
              >
                <option value="all">Toutes categories</option>
                {(filters?.device_categories ?? []).map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>

              <select
                value={selectedRiskLevel}
                onChange={(event) => {
                  clearQuickPreset();
                  setSelectedRiskLevel(event.target.value);
                }}
                className="rounded-2xl border border-[var(--bc-neutral-border)] bg-[var(--bc-neutral-soft)] px-4 py-3 text-sm text-[var(--bc-neutral-strong)] outline-none transition-all focus:border-[var(--bc-primary-border)] focus:bg-white focus:ring-4 focus:ring-[rgba(59,130,246,0.16)]"
              >
                <option value="all">Tous les risques</option>
                {(filters?.risk_levels ?? []).map((riskLevel) => (
                  <option key={riskLevel} value={riskLevel}>
                    {formatMobileRiskLabel(riskLevel)}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <div className="xl:col-span-4">
              <div className="rounded-2xl border border-dashed border-[var(--bc-neutral-border)] bg-[var(--bc-neutral-soft)] px-4 py-3 text-sm text-[var(--bc-neutral-body)]">
                Vue rapide activee: les filtres avances apparaissent en vue detaillee.
              </div>
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-[var(--bc-neutral-border)] bg-[var(--bc-neutral-soft)] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-body)]">
            <ListFilter className="h-3.5 w-3.5" />
            {activeFilterLabels.length > 0 ? `${activeFilterLabels.length} filtres actifs` : "Aucun filtre avance"}
          </div>
          {activeFilterLabels.map((label) => (
            <Badge key={label} variant="outline" className="bg-white px-3 py-1">
              {label}
            </Badge>
          ))}
        </div>
      </section>

      {viewMode === "detailed" ? (
        <WidgetVisibilityManager
          widgets={consumptionWidgets}
          visibility={dashboardPreferences.visibility}
          visibleCount={dashboardPreferences.visibleCount}
          onChange={dashboardPreferences.setWidgetVisible}
          onReset={dashboardPreferences.resetPreferences}
        />
      ) : null}

      <DashboardSection isVisible={dashboardPreferences.isWidgetVisible("kpis")}>
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
          {supportCards.map((card) => {
            const styles = getToneClasses(card.tone);
            const Icon = card.icon;

            return (
              <article
                key={card.title}
                className={`rounded-[22px] border p-4 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md ${styles.card}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-[var(--bc-neutral-body)]">{card.title}</p>
                    <p className="mt-3 text-3xl font-bold tracking-tight text-[var(--bc-neutral-strong)]">
                      {card.value}
                    </p>
                  </div>
                  <div className={`rounded-2xl p-3 ${styles.icon}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                </div>
                <p className="mt-3 text-sm leading-6 text-[var(--bc-neutral-body)]">{card.helper}</p>
              </article>
            );
          })}
        </div>
      </DashboardSection>

      <DashboardSection isVisible={dashboardPreferences.isWidgetVisible("ai-insights")}>
        <div className="grid gap-6 xl:grid-cols-[1.25fr_0.95fr]">
          <div className="space-y-4">
            <div className="bc-surface-ai flex flex-col gap-3 rounded-[24px] border p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--bc-ai-start)]">
                    Insights IA actionnables
                  </p>
                  <h2 className="mt-2 text-xl font-semibold text-[var(--bc-neutral-strong)]">
                    Priorites business a activer maintenant
                  </h2>
                </div>
                <Badge variant="ai" className="px-3 py-1">
                  {visibleInsights.length} recommandations visibles
                </Badge>
              </div>
              <p className="text-sm leading-6 text-[var(--bc-neutral-body)]">
                Chaque bloc combine gain estime, niveau d'impact et score IA pour accelerer
                l'arbitrage.
              </p>
            </div>

            <div className="grid gap-4">
              {visibleInsights.map((insight) => (
                <ActionableInsightCard
                  key={insight.id}
                  title={insight.title}
                  badge={insight.badge}
                  tone={insight.tone}
                  headline={insight.headline}
                  detail={insight.detail}
                  recommendation={insight.recommendation}
                  estimatedGainLabel={insight.estimatedGainLabel}
                  impact={insight.impact}
                  score={insight.score}
                  filterLabel={insight.filterLabel}
                  icon={insight.icon}
                  onPrimaryAction={insight.onPrimaryAction}
                  onSecondaryAction={insight.onSecondaryAction}
                />
              ))}
            </div>
          </div>

          <aside className="bc-surface-ai rounded-[26px] border p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--bc-ai-start)]">
                  Benchmark budgetaire
                </p>
                <h2 className="mt-2 text-xl font-semibold text-[var(--bc-neutral-strong)]">
                  Budget reel vs budget optimal
                </h2>
                <p className="mt-2 text-sm leading-6 text-[var(--bc-neutral-body)]">
                  Une lecture immediate de l'ecart budgetaire et du levier economique recuperable.
                </p>
              </div>
              <Badge className={budgetGapStyles.badge}>
                {budgetGapMad > 0
                  ? `Surcout detecte : ${formatSignedPercentage(budgetGapPct)}`
                  : "Budget optimise"}
              </Badge>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="bc-surface-primary rounded-2xl border px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--bc-neutral-muted)]">
                  Budget reel
                </p>
                <p className="mt-2 text-2xl font-bold text-[var(--bc-primary-hover)]">
                  {isLoading ? "--" : formatMadValue(totalBudgetMad)}
                </p>
              </div>
              <div className="bc-surface-success rounded-2xl border px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--bc-neutral-muted)]">
                  Budget optimal
                </p>
                <p className="mt-2 text-2xl font-bold text-[var(--bc-success)]">
                  {isLoading ? "--" : formatMadValue(expectedNormalBudgetMad)}
                </p>
              </div>
              <div className="bc-surface-danger rounded-2xl border px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--bc-neutral-muted)]">
                  Ecart
                </p>
                <p className="mt-2 text-2xl font-bold text-[var(--bc-danger)]">
                  {isLoading ? "--" : formatMadValue(budgetGapMad)}
                </p>
              </div>
              <div className="bc-surface-ai rounded-2xl border px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--bc-neutral-muted)]">
                  Budget unitaire optimal
                </p>
                <p className="mt-2 text-2xl font-bold text-[var(--bc-ai-start)]">
                  {isLoading ? "--" : formatMadValue(expectedUnitCostMad)}
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-4 rounded-[24px] border border-white/90 bg-white/85 p-4">
              <div>
                <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium text-[var(--bc-neutral-body)]">Budget reel</span>
                  <span className="font-semibold text-[var(--bc-primary-hover)]">{formatMadValue(totalBudgetMad)}</span>
                </div>
                <div className="h-3 rounded-full bg-[var(--bc-primary-soft)]">
                  <div className="h-3 rounded-full bg-[linear-gradient(90deg,var(--bc-primary),var(--bc-primary-hover))]" style={{ width: "100%" }} />
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium text-[var(--bc-neutral-body)]">Budget optimal estime</span>
                  <span className="font-semibold text-[var(--bc-success)]">
                    {formatMadValue(expectedNormalBudgetMad)}
                  </span>
                </div>
                <div className="h-3 rounded-full bg-[#DCFCE7]">
                  <div
                    className="h-3 rounded-full bg-[linear-gradient(90deg,var(--bc-success),var(--bc-success-hover))]"
                    style={{
                      width: `${
                        totalBudgetMad > 0
                          ? Math.max((expectedNormalBudgetMad / totalBudgetMad) * 100, 8)
                          : 0
                      }%`,
                    }}
                  />
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium text-[var(--bc-neutral-body)]">Surcout detecte</span>
                  <span className="font-semibold text-[var(--bc-danger)]">{formatSignedPercentage(budgetGapPct)}</span>
                </div>
                <div className="h-3 rounded-full bg-[var(--bc-danger-soft)]">
                  <div
                    className="h-3 rounded-full bg-[linear-gradient(90deg,var(--bc-danger),var(--bc-warning))]"
                    style={{
                      width: `${
                        totalBudgetMad > 0
                          ? Math.max((budgetGapMad / totalBudgetMad) * 100, budgetGapMad > 0 ? 8 : 0)
                          : 0
                      }%`,
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="mt-5 rounded-[24px] border border-white/90 bg-white/88 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                Zone critique
              </p>
              <p className="mt-2 text-base font-semibold text-[var(--bc-neutral-strong)]">
                {mostOverBudgetOperator
                  ? `${mostOverBudgetOperator.label} depasse le budget cible de ${formatMadValue(
                      Math.max(mostOverBudgetOperator.gapMad, 0),
                    )}.`
                  : "Aucune zone critique majeure n'est detectee sur le perimetre courant."}
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Button
                  type="button"
                  className="rounded-2xl px-4 py-2.5 text-sm font-semibold"
                  onClick={openOptimizationWorkspace}
                >
                  <Sparkles className="h-4 w-4" />
                  Optimiser automatiquement
                </Button>
                {mostOverBudgetOperator ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-2xl px-4 py-2.5 text-sm font-semibold"
                    onClick={() => applyOperatorFilter(mostOverBudgetOperator.label)}
                  >
                    <Target className="h-4 w-4" />
                    Focus {mostOverBudgetOperator.label}
                  </Button>
                ) : null}
              </div>
            </div>
          </aside>
        </div>
      </DashboardSection>

      {viewMode === "detailed" ? (
        <DashboardSection
          isVisible={dashboardPreferences.isWidgetVisible("secondary-charts")}
          collapsible
          title="Analyses detaillees"
          description="Lecture croisee par operateur, categorie et niveau de risque pour confirmer la decision."
          className="rounded-[26px] border border-[var(--bc-neutral-border)] bg-white p-5 shadow-sm"
          contentClassName="space-y-6 pt-5"
        >
          <div className="grid gap-6 xl:grid-cols-3">
            <div className="rounded-[24px] border border-[var(--bc-neutral-border)] bg-white p-5">
              <div className="mb-4">
                <h3 className="text-lg font-semibold text-[var(--bc-neutral-strong)]">Budget par operateur</h3>
                <p className="mt-1 text-sm text-[var(--bc-neutral-body)]">
                  Cliquez sur une barre pour focaliser toute la page.
                </p>
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={operatorBudgetWithBenchmark}>
                  <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" />
                  <XAxis dataKey="label" stroke="#64748B" />
                  <YAxis stroke="#64748B" />
                  <Tooltip formatter={(value: number) => formatMadValue(value)} />
                  <Bar dataKey="total_estimated_price_mad" radius={[10, 10, 0, 0]}>
                    {operatorBudgetWithBenchmark.map((entry) => (
                      <Cell
                        key={entry.label}
                        fill={selectedOperator === entry.label ? "#3B82F6" : "#93C5FD"}
                        onClick={() => applyOperatorFilter(entry.label)}
                        className="cursor-pointer"
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              {topOperatorBudget ? (
                <div className="mt-4 rounded-2xl border border-[var(--bc-primary-border)] bg-[var(--bc-primary-soft)] px-4 py-3 text-sm text-[var(--bc-primary)]">
                  {topOperatorBudget.label} represente {topOperatorSharePct.toFixed(1)}% du budget total.
                </div>
              ) : null}
            </div>

            <div className="rounded-[24px] border border-[var(--bc-neutral-border)] bg-white p-5">
              <div className="mb-4">
                <h3 className="text-lg font-semibold text-[var(--bc-neutral-strong)]">Repartition des risques</h3>
                <p className="mt-1 text-sm text-[var(--bc-neutral-body)]">
                  Cliquez sur un segment pour isoler les niveaux critiques.
                </p>
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={consumption?.risk_distribution ?? []}
                    dataKey="count"
                    nameKey="label"
                    cx="50%"
                    cy="50%"
                    outerRadius={96}
                    label={({ label, count }) => `${formatMobileRiskLabel(label)} ${count}`}
                    labelLine={false}
                  >
                    {(consumption?.risk_distribution ?? []).map((entry) => (
                      <Cell
                        key={entry.label}
                        fill={getMobileRiskColor(entry.label)}
                        onClick={() => applyRiskFilter(entry.label)}
                        className="cursor-pointer"
                      />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => `${value} appareils`} />
                </PieChart>
              </ResponsiveContainer>
              {topRiskBucket ? (
                <div className="mt-4 rounded-2xl border border-[var(--bc-danger-border)] bg-[var(--bc-danger-soft)] px-4 py-3 text-sm text-[var(--bc-danger-hover)]">
                  Le niveau {formatMobileRiskLabel(topRiskBucket.label)} concentre{" "}
                  {topRiskBucket.count} appareils.
                </div>
              ) : null}
            </div>

            <div className="rounded-[24px] border border-[var(--bc-neutral-border)] bg-white p-5">
              <div className="mb-4">
                <h3 className="text-lg font-semibold text-[var(--bc-neutral-strong)]">Budget par categorie</h3>
                <p className="mt-1 text-sm text-[var(--bc-neutral-body)]">
                  Identifie la categorie a arbitrer avant de revoir les forfaits.
                </p>
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={categoryBudgetWithBenchmark}>
                  <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" />
                  <XAxis dataKey="label" stroke="#64748B" />
                  <YAxis stroke="#64748B" />
                  <Tooltip formatter={(value: number) => formatMadValue(value)} />
                  <Bar dataKey="total_estimated_price_mad" radius={[10, 10, 0, 0]}>
                    {categoryBudgetWithBenchmark.map((entry) => (
                      <Cell
                        key={entry.label}
                        fill={getDeviceCategoryColor(entry.label)}
                        opacity={
                          selectedDeviceCategory === "all" || selectedDeviceCategory === entry.label
                            ? 1
                            : 0.4
                        }
                        onClick={() => applyCategoryFilter(entry.label)}
                        className="cursor-pointer"
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              {dominantCategory ? (
                <div className="mt-4 rounded-2xl border border-[var(--bc-ai-border)] bg-[var(--bc-ai-soft)] px-4 py-3 text-sm text-[var(--bc-ai-end)]">
                  {dominantCategory.label} regroupe{" "}
                  {categoryCountMap.get(dominantCategory.label) ?? 0} appareils sur la vue.
                </div>
              ) : null}
            </div>
          </div>
        </DashboardSection>
      ) : null}

      <DashboardSection isVisible={dashboardPreferences.isWidgetVisible("expensive-devices")}>
        <section className="rounded-[26px] border border-[var(--bc-neutral-border)] bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--bc-danger)]">
                Appareils critiques
              </p>
              <h2 className="mt-2 text-xl font-semibold text-[var(--bc-neutral-strong)]">
                Zones couteuses a traiter en premier
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--bc-neutral-body)]">
                Tri automatique par criticite, ecart budgetaire et confiance IA pour rendre la
                priorisation immediate.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="destructive" className="px-3 py-1">
                {criticalRisks} critiques
              </Badge>
              <Badge variant="outline" className="bg-[var(--bc-neutral-soft)] px-3 py-1">
                {prioritizedDevices.length} appareils classes
              </Badge>
            </div>
          </div>

          {highlightedDevices.length > 0 ? (
            <div className="mt-5 grid gap-4 xl:grid-cols-2">
              {highlightedDevices.map((device) => (
                <CriticalBudgetDeviceCard
                  key={device.fleet_row_id}
                  device={device}
                  expectedUnitCostMad={expectedUnitCostMad}
                  compact={viewMode === "quick"}
                  onOptimize={(selectedDevice) =>
                    openPlansWorkspace(
                      `Appareil-${selectedDevice.fleet_row_id} est envoye vers l'optimisation forfaitaire.`,
                    )
                  }
                  onViewDetail={(selectedDevice) =>
                    {
                      toast.info("Detail appareil", {
                        description: `Appareil-${selectedDevice.fleet_row_id} est ouvert dans les recommandations IA.`,
                      });
                      navigate("/recommandations");
                    }
                  }
                />
              ))}
            </div>
          ) : (
            <div className="mt-5 rounded-2xl border border-[var(--bc-neutral-border)] bg-[var(--bc-neutral-soft)] px-4 py-6 text-sm text-[var(--bc-neutral-body)]">
              Aucun appareil couteux ne correspond aux filtres courants.
            </div>
          )}

          {viewMode === "quick" && additionalDevices.length > 0 ? (
            <div className="mt-5 flex items-center justify-between gap-4 rounded-[22px] border border-[var(--bc-neutral-border)] bg-[var(--bc-neutral-soft)] px-4 py-4">
              <div>
                <p className="text-sm font-semibold text-[var(--bc-neutral-strong)]">
                  {additionalDevices.length} autres appareils restent a analyser
                </p>
                <p className="mt-1 text-sm text-[var(--bc-neutral-body)]">
                  Passez en vue detaillee pour ouvrir la liste complete et les actions secondaires.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                className="rounded-2xl px-4 py-2.5 text-sm font-semibold"
                onClick={() => setViewMode("detailed")}
              >
                Voir tout le detail
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          ) : null}

          {viewMode === "detailed" ? (
            <div className="mt-5">
              <ExpandableList
                items={additionalDevices}
                collapsedCount={4}
                itemLabel="appareils"
                className="grid gap-4 xl:grid-cols-2"
                getKey={(device) => device.fleet_row_id}
                emptyState={null}
                renderItem={(device) => (
                  <CriticalBudgetDeviceCard
                    device={device}
                    expectedUnitCostMad={expectedUnitCostMad}
                    compact
                    onOptimize={(selectedDevice) =>
                      openPlansWorkspace(
                        `Appareil-${selectedDevice.fleet_row_id} est envoye vers l'optimisation forfaitaire.`,
                      )
                    }
                    onViewDetail={(selectedDevice) =>
                      {
                        toast.info("Detail appareil", {
                          description: `Appareil-${selectedDevice.fleet_row_id} est ouvert dans les recommandations IA.`,
                        });
                        navigate("/recommandations");
                      }
                    }
                  />
                )}
              />
            </div>
          ) : null}
        </section>
      </DashboardSection>
    </div>
  );
}
