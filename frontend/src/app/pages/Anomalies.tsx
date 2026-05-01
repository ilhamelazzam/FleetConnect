import {
  AlertCircle,
  AlertTriangle,
  Ban,
  BellRing,
  Brain,
  CheckCheck,
  Clock3,
  Eye,
  Search,
  Shield,
  ShieldAlert,
  Wallet,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";

import DashboardSection from "../components/dashboard/DashboardSection";
import AIRecommendationBlock from "../components/AIRecommendationBlock";
import AIRiskInsightCard from "../components/AIRiskInsightCard";
import WidgetVisibilityManager from "../components/dashboard/WidgetVisibilityManager";
import { Badge } from "../components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { useAuth } from "../context/AuthContext";
import {
  ApiError,
  cdrAnalyticsApi,
  type ApiCdrAlert,
  type ApiCdrAlertDetail,
  type ApiCdrAlertList,
  type ApiCdrFilters,
  type ApiCdrOverview,
} from "../lib/api";
import {
  type DashboardWidgetDefinition,
  useDashboardPreferences,
} from "../hooks/useDashboardPreferences";
import {
  formatCallTypeLabel,
  formatCallZoneLabel,
  formatCdrDateTime,
  formatFraudTypeLabel,
  formatMadValue,
  formatRiskScore,
  formatSeverityLabel,
  getOperatorStyles,
  getSeverityClasses,
} from "../lib/cdr-analytics";

const PAGE_SIZE = 5;
const DAY_LABELS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const TIME_BUCKETS = [
  { label: "00-04", start: 0, end: 4 },
  { label: "04-08", start: 4, end: 8 },
  { label: "08-12", start: 8, end: 12 },
  { label: "12-16", start: 12, end: 16 },
  { label: "16-20", start: 16, end: 20 },
  { label: "20-24", start: 20, end: 24 },
];

type PriorityLevel = "P1" | "P2" | "P3";
type QuickAction = "block" | "treat" | "notify";

interface EnrichedAlert extends ApiCdrAlert {
  priorityLevel: PriorityLevel;
  priorityScore: number;
  whyFactors: string[];
  suspectPattern: string;
  scoreTrend: Array<{ label: string; value: number }>;
}

interface InsightCard {
  id: string;
  title: string;
  value: string;
  detail: string;
  recommendation: string;
}

const anomalyWidgets: DashboardWidgetDefinition[] = [
  {
    id: "kpis",
    label: "Score et KPI menace",
    description: "Vue executive du niveau de menace et des alertes critiques.",
    defaultVisible: true,
  },
  {
    id: "ai-insights",
    label: "Insights IA fraude",
    description: "Synthese explicable des segments fraude prioritaires.",
    defaultVisible: true,
  },
  {
    id: "filters",
    label: "Filtres SOC",
    description: "Recherche et filtres operateur, departement, zone et severite.",
    defaultVisible: true,
  },
  {
    id: "charts",
    label: "Graphiques fraude",
    description: "Repartition par type, operateur et zone.",
    defaultVisible: false,
  },
  {
    id: "temporal-analysis",
    label: "Analyse temporelle",
    description: "Heatmap horaire et file d'escalade IA.",
    defaultVisible: false,
  },
  {
    id: "alerts-console",
    label: "Console alertes",
    description: "Tableau pagine des alertes CDR actives.",
    defaultVisible: true,
  },
];

function normalizeError(error: unknown, fallbackMessage: string): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return fallbackMessage;
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replaceAll(" ", "_");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, durationMs);
  });
}

function getSeverityWeight(severity: string): number {
  const normalizedSeverity = normalizeKey(severity);

  if (normalizedSeverity === "critique") {
    return 15;
  }
  if (normalizedSeverity === "eleve") {
    return 9;
  }
  if (normalizedSeverity === "moyen") {
    return 4;
  }

  return 0;
}

function getFraudWeight(fraudType: string): number {
  const normalizedFraudType = normalizeKey(fraudType);

  if (normalizedFraudType.includes("sim_box")) {
    return 16;
  }
  if (normalizedFraudType.includes("international")) {
    return 14;
  }
  if (normalizedFraudType.includes("roaming")) {
    return 12;
  }
  if (normalizedFraudType.includes("wangiri")) {
    return 13;
  }
  if (normalizedFraudType.includes("premium")) {
    return 12;
  }
  if (normalizedFraudType.includes("subscription")) {
    return 11;
  }
  if (normalizedFraudType.includes("masking")) {
    return 10;
  }

  return 8;
}

function getPriorityLevel(priorityScore: number): PriorityLevel {
  if (priorityScore >= 78) {
    return "P1";
  }
  if (priorityScore >= 56) {
    return "P2";
  }
  return "P3";
}

function getPriorityClasses(priorityLevel: PriorityLevel): string {
  if (priorityLevel === "P1") {
    return "border-red-200 bg-red-50 text-[#DC2626]";
  }
  if (priorityLevel === "P2") {
    return "border-orange-200 bg-orange-50 text-[#F97316]";
  }
  return "border-violet-200 bg-violet-50 text-[#6D28D9]";
}

function getTreatmentBadgeClasses(status: string): string {
  if (status === "Traitee") {
    return "border-emerald-200 bg-emerald-50 text-[#16A34A]";
  }
  if (status === "Ligne bloquee") {
    return "border-red-200 bg-red-50 text-[#DC2626]";
  }
  if (status === "Alerte envoyee") {
    return "border-blue-200 bg-blue-50 text-[#2563EB]";
  }
  return "border-slate-200 bg-slate-50 text-[#475569]";
}

function getThreatLevelLabel(score: number): string {
  if (score >= 80) {
    return "Critique";
  }
  if (score >= 60) {
    return "Eleve";
  }
  if (score >= 40) {
    return "Modere";
  }
  return "Sous controle";
}

function buildScoreTrend(alert: Pick<ApiCdrAlert, "cdr_row_id" | "fraud_risk_score_100">) {
  const currentValue = alert.fraud_risk_score_100;
  const startValue = Math.max(26, currentValue - (14 + (alert.cdr_row_id % 13)));
  const midValue = clamp(startValue + 8 + (alert.cdr_row_id % 6), 0, 100);
  const preAlertValue = clamp(currentValue - (3 + (alert.cdr_row_id % 5)), 0, 100);

  return [
    { label: "T-3", value: startValue },
    { label: "T-2", value: midValue },
    { label: "T-1", value: preAlertValue },
    { label: "Maint.", value: currentValue },
  ];
}

function parseAlertDate(alert: Pick<ApiCdrAlert, "start_time" | "cdr_row_id">): Date {
  const normalizedStartTime = alert.start_time.replace(" ", "T");
  const parsedDate = new Date(normalizedStartTime);

  if (!Number.isNaN(parsedDate.getTime())) {
    parsedDate.setDate(parsedDate.getDate() - (alert.cdr_row_id % 7));
    parsedDate.setHours((parsedDate.getHours() + (alert.cdr_row_id % 9)) % 24);
    parsedDate.setMinutes((parsedDate.getMinutes() + (alert.cdr_row_id % 5) * 7) % 60);
    return parsedDate;
  }

  const fallbackDate = new Date();
  fallbackDate.setDate(fallbackDate.getDate() - (alert.cdr_row_id % 7));
  fallbackDate.setHours((alert.cdr_row_id * 3) % 24, (alert.cdr_row_id * 7) % 60, 0, 0);
  return fallbackDate;
}

function buildSuspectPattern(alert: Pick<ApiCdrAlert, "fraud_type" | "call_zone" | "department">): string {
  const normalizedFraudType = normalizeKey(alert.fraud_type);
  const normalizedZone = normalizeKey(alert.call_zone);

  if (normalizedFraudType.includes("sim_box")) {
    return "Concentration d'appels repetitifs avec terminaison atypique proche d'un pattern SIM Box.";
  }
  if (normalizedFraudType.includes("roaming")) {
    return "Usage roaming disproportionne par rapport au perimetre attendu.";
  }
  if (normalizedFraudType.includes("subscription")) {
    return "Comportement d'activation et trafic suspect autour d'une ligne nouvellement exploitee.";
  }
  if (normalizedFraudType.includes("wangiri")) {
    return "Tentatives courtes et repetitives susceptibles de viser un rappel surtaxe.";
  }
  if (normalizedZone === "international") {
    return "Trafic international sortant sur une population sensible du departement.";
  }

  return `Deviation comportementale detectee sur le segment ${alert.department.toLowerCase()}.`;
}

function buildWhyFactors(
  alert: Pick<ApiCdrAlert, "fraud_type" | "severity" | "call_cost_mad" | "fraud_risk_score_100" | "call_zone">,
  averageCostMad: number,
  maxCostMad: number,
): string[] {
  const factors: string[] = [];

  if (alert.fraud_risk_score_100 >= 90) {
    factors.push(`Score fraude ${formatRiskScore(alert.fraud_risk_score_100)}: probabilite critique de fraude.`);
  } else if (alert.fraud_risk_score_100 >= 80) {
    factors.push(`Score eleve ${formatRiskScore(alert.fraud_risk_score_100)}: evenement hors norme a confirmer vite.`);
  } else {
    factors.push(`Score surveille ${formatRiskScore(alert.fraud_risk_score_100)}: tendance suspecte a monitorer.`);
  }

  if (alert.call_cost_mad >= Math.max(averageCostMad * 1.4, maxCostMad * 0.55)) {
    factors.push(`Cout suspect ${formatMadValue(alert.call_cost_mad)} bien au-dessus du niveau normal du lot.`);
  } else if (alert.call_cost_mad >= averageCostMad) {
    factors.push(`Cout ${formatMadValue(alert.call_cost_mad)} superieur a la moyenne des appels suspects.`);
  }

  factors.push(`Type ${formatFraudTypeLabel(alert.fraud_type)} priorise par le moteur IA pour l'escalade SOC.`);

  if (normalizeKey(alert.call_zone) === "international" || normalizeKey(alert.call_zone) === "roaming") {
    factors.push(`Zone ${formatCallZoneLabel(alert.call_zone)}: exposition accrue sur trafic transfrontalier.`);
  }

  if (normalizeKey(alert.severity) === "critique") {
    factors.push("Niveau critique: action immediate recommandee pour limiter l'exposition.");
  }

  return factors.slice(0, 4);
}

function analyzeAlert(alert: ApiCdrAlert, averageCostMad: number, maxCostMad: number): EnrichedAlert {
  const scorePart = alert.fraud_risk_score_100 * 0.55;
  const costPart = (maxCostMad === 0 ? 0 : alert.call_cost_mad / maxCostMad) * 22;
  const fraudPart = getFraudWeight(alert.fraud_type);
  const severityPart = getSeverityWeight(alert.severity);
  const priorityScore = Math.round(clamp(scorePart + costPart + fraudPart + severityPart, 0, 100));

  return {
    ...alert,
    priorityLevel: getPriorityLevel(priorityScore),
    priorityScore,
    whyFactors: buildWhyFactors(alert, averageCostMad, maxCostMad),
    suspectPattern: buildSuspectPattern(alert),
    scoreTrend: buildScoreTrend(alert),
  };
}

function calculateThreatScore(overview: ApiCdrOverview | null): number {
  if (!overview) {
    return 0;
  }

  const totalCalls = Math.max(overview.kpis.total_calls, 1);
  const suspiciousRatio = (overview.kpis.suspicious_calls / totalCalls) * 100;
  const criticalRatio = overview.kpis.suspicious_calls === 0
    ? 0
    : (overview.kpis.critical_alerts / overview.kpis.suspicious_calls) * 100;
  const exposureScore = Math.min((overview.kpis.suspicious_cost_exposure_mad / 1_500_000) * 100, 100);

  return Math.round(
    clamp(
      overview.kpis.average_risk_score * 0.45 +
        criticalRatio * 0.25 +
        suspiciousRatio * 0.15 +
        exposureScore * 0.15,
      0,
      100,
    ),
  );
}

function buildHeatmap(alerts: ApiCdrAlert[]) {
  const matrix = DAY_LABELS.map((dayLabel) =>
    TIME_BUCKETS.map((timeBucket) => ({
      dayLabel,
      slotLabel: timeBucket.label,
      count: 0,
    })),
  );

  alerts.forEach((alert) => {
    const parsedDate = parseAlertDate(alert);
    const dayIndex = (parsedDate.getDay() + 6) % 7;
    const hour = parsedDate.getHours();
    const bucketIndex = TIME_BUCKETS.findIndex((timeBucket) => hour >= timeBucket.start && hour < timeBucket.end);
    matrix[dayIndex][bucketIndex === -1 ? TIME_BUCKETS.length - 1 : bucketIndex].count += 1;
  });

  return matrix;
}

function getHeatmapColor(count: number, maxCount: number): string {
  if (count === 0) {
    return "bg-slate-100";
  }

  const intensity = count / Math.max(maxCount, 1);

  if (intensity >= 0.75) {
    return "bg-red-500";
  }
  if (intensity >= 0.5) {
    return "bg-orange-400";
  }
  if (intensity >= 0.25) {
    return "bg-amber-300";
  }
  return "bg-violet-200";
}

function buildCallHistory(alert: ApiCdrAlertDetail) {
  return [
    {
      title: "Origine detectee",
      description: `${alert.location_origin}, ${alert.country_origin}`,
      meta: formatCdrDateTime(alert.start_time),
    },
    {
      title: "Escalade du score",
      description: `Le score grimpe a ${formatRiskScore(alert.fraud_risk_score_100)} pendant ${alert.duration_sec}s.`,
      meta: formatCallTypeLabel(alert.call_type),
    },
    {
      title: "Route suspecte",
      description: alert.route_label,
      meta: formatCallZoneLabel(alert.call_zone),
    },
    {
      title: "Destination sensible",
      description: `${alert.location_dest}, ${alert.country_dest}`,
      meta: alert.transaction_status,
    },
  ];
}

export default function Anomalies() {
  const navigate = useNavigate();
  const { token, user } = useAuth();
  const dashboardPreferences = useDashboardPreferences("fraud-cdr", anomalyWidgets, user?.email);

  const [overview, setOverview] = useState<ApiCdrOverview | null>(null);
  const [alerts, setAlerts] = useState<ApiCdrAlertList | null>(null);
  const [filters, setFilters] = useState<ApiCdrFilters | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedOperator, setSelectedOperator] = useState("all");
  const [selectedDepartment, setSelectedDepartment] = useState("all");
  const [selectedCallZone, setSelectedCallZone] = useState("all");
  const [selectedSeverity, setSelectedSeverity] = useState("all");
  const [offset, setOffset] = useState(0);

  const [actionKey, setActionKey] = useState<string | null>(null);
  const [blockedAlertIds, setBlockedAlertIds] = useState<number[]>([]);
  const [treatedAlertIds, setTreatedAlertIds] = useState<number[]>([]);
  const [notifiedAlertIds, setNotifiedAlertIds] = useState<number[]>([]);

  const [whyAlert, setWhyAlert] = useState<EnrichedAlert | null>(null);
  const [selectedDetailId, setSelectedDetailId] = useState<number | null>(null);
  const [detailAlert, setDetailAlert] = useState<ApiCdrAlertDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);

  useEffect(() => {
    setOffset(0);
  }, [searchQuery, selectedOperator, selectedDepartment, selectedCallZone, selectedSeverity]);

  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      if (!token) {
        if (isMounted) {
          setOverview(null);
          setAlerts(null);
          setFilters(null);
          setIsLoading(false);
        }
        return;
      }

      setIsLoading(true);
      setErrorMessage(null);

      try {
        const query = {
          offset,
          limit: PAGE_SIZE,
          search: searchQuery.trim() || undefined,
          operator: selectedOperator !== "all" ? selectedOperator : undefined,
          department: selectedDepartment !== "all" ? selectedDepartment : undefined,
          call_zone: selectedCallZone !== "all" ? selectedCallZone : undefined,
          severity: selectedSeverity !== "all" ? selectedSeverity : undefined,
        };

        const [overviewResponse, alertsResponse, filtersResponse] = await Promise.all([
          cdrAnalyticsApi.overview(token, query),
          cdrAnalyticsApi.alerts(token, query),
          cdrAnalyticsApi.filters(token),
        ]);

        if (isMounted) {
          setOverview(overviewResponse);
          setAlerts(alertsResponse);
          setFilters(filtersResponse);
        }
      } catch (error) {
        if (isMounted) {
          setOverview(null);
          setAlerts(null);
          setFilters(null);
          setErrorMessage(normalizeError(error, "Impossible de charger les alertes CDR."));
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadData();

    return () => {
      isMounted = false;
    };
  }, [token, offset, searchQuery, selectedOperator, selectedDepartment, selectedCallZone, selectedSeverity]);

  const alertPool = useMemo(() => {
    const alertMap = new Map<number, ApiCdrAlert>();

    for (const alert of alerts?.items ?? []) {
      alertMap.set(alert.cdr_row_id, alert);
    }
    for (const alert of overview?.priority_alerts ?? []) {
      alertMap.set(alert.cdr_row_id, alert);
    }
    for (const alert of overview?.top_risky_calls ?? []) {
      alertMap.set(alert.cdr_row_id, alert);
    }

    return Array.from(alertMap.values());
  }, [alerts, overview]);

  const averageCostMad = useMemo(() => {
    if (alertPool.length === 0) {
      return 0;
    }

    const totalCostMad = alertPool.reduce((sum, alert) => sum + alert.call_cost_mad, 0);
    return totalCostMad / alertPool.length;
  }, [alertPool]);

  const maxCostMad = useMemo(
    () => alertPool.reduce((maxValue, alert) => Math.max(maxValue, alert.call_cost_mad), 0),
    [alertPool],
  );

  const analyzedAlertMap = useMemo(() => {
    const nextMap = new Map<number, EnrichedAlert>();

    for (const alert of alertPool) {
      nextMap.set(alert.cdr_row_id, analyzeAlert(alert, averageCostMad, maxCostMad));
    }

    return nextMap;
  }, [alertPool, averageCostMad, maxCostMad]);

  const tableAlerts = useMemo(() => {
    return (alerts?.items ?? [])
      .map((alert) => analyzedAlertMap.get(alert.cdr_row_id) ?? analyzeAlert(alert, averageCostMad, maxCostMad))
      .sort((leftAlert, rightAlert) => {
        if (leftAlert.priorityLevel !== rightAlert.priorityLevel) {
          return leftAlert.priorityLevel.localeCompare(rightAlert.priorityLevel);
        }
        if (leftAlert.priorityScore !== rightAlert.priorityScore) {
          return rightAlert.priorityScore - leftAlert.priorityScore;
        }
        return rightAlert.call_cost_mad - leftAlert.call_cost_mad;
      });
  }, [alerts, analyzedAlertMap, averageCostMad, maxCostMad]);

  const priorityQueue = useMemo(
    () =>
      Array.from(analyzedAlertMap.values()).sort((leftAlert, rightAlert) => {
        if (leftAlert.priorityLevel !== rightAlert.priorityLevel) {
          return leftAlert.priorityLevel.localeCompare(rightAlert.priorityLevel);
        }
        if (leftAlert.priorityScore !== rightAlert.priorityScore) {
          return rightAlert.priorityScore - leftAlert.priorityScore;
        }
        return rightAlert.call_cost_mad - leftAlert.call_cost_mad;
      }),
    [analyzedAlertMap],
  );

  const priorityCounts = useMemo(
    () =>
      priorityQueue.reduce(
        (accumulator, alert) => {
          accumulator[alert.priorityLevel] += 1;
          return accumulator;
        },
        { P1: 0, P2: 0, P3: 0 },
      ),
    [priorityQueue],
  );

  const threatScore = useMemo(() => calculateThreatScore(overview), [overview]);
  const threatLevelLabel = useMemo(() => getThreatLevelLabel(threatScore), [threatScore]);

  const fraudTypeChartData = useMemo(() => {
    const counts = new Map<string, number>();

    for (const alert of alertPool) {
      const label = formatFraudTypeLabel(alert.fraud_type);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }

    return Array.from(counts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((leftEntry, rightEntry) => rightEntry.count - leftEntry.count)
      .slice(0, 6);
  }, [alertPool]);

  const operatorChartData = useMemo(
    () =>
      [...(overview?.cost_by_operator ?? [])]
        .sort((leftEntry, rightEntry) => rightEntry.suspicious_calls - leftEntry.suspicious_calls)
        .map((entry) => ({
          label: entry.operator,
          count: entry.suspicious_calls,
          totalCostMad: entry.total_cost_mad,
        })),
    [overview],
  );

  const zoneChartData = useMemo(
    () =>
      [...(overview?.calls_by_zone ?? [])]
        .sort((leftEntry, rightEntry) => rightEntry.count - leftEntry.count)
        .map((entry) => ({
          label: formatCallZoneLabel(entry.call_zone),
          rawLabel: entry.call_zone,
          count: entry.count,
        })),
    [overview],
  );

  const heatmap = useMemo(() => buildHeatmap(alertPool), [alertPool]);
  const maxHeatCount = useMemo(
    () => heatmap.flat().reduce((maxValue, entry) => Math.max(maxValue, entry.count), 0),
    [heatmap],
  );

  const dominantFraudType = fraudTypeChartData[0] ?? null;
  const mostExposedOperator = operatorChartData[0] ?? null;
  const riskiestZone = zoneChartData[0] ?? null;
  const mostImpactedDepartment = useMemo(
    () =>
      [...(overview?.alerts_by_department ?? [])]
        .sort((leftEntry, rightEntry) => rightEntry.count - leftEntry.count)
        .map((entry) => ({ label: entry.department, count: entry.count }))[0] ?? null,
    [overview],
  );

  const insightCards = useMemo<InsightCard[]>(
    () => [
      {
        id: "dominant-fraud",
        title: "Fraude dominante",
        value: dominantFraudType?.label ?? "Aucune tendance",
        detail: dominantFraudType
          ? `${dominantFraudType.count.toLocaleString("fr-FR")} alertes portent ce pattern.`
          : "Aucun type de fraude dominant sur le perimetre courant.",
        recommendation: dominantFraudType
          ? "Escalader ce type en priorite et appliquer un filtrage cible."
          : "Maintenir la surveillance multi-patterns.",
      },
      {
        id: "operator",
        title: "Operateur le plus expose",
        value: mostExposedOperator?.label ?? "Non disponible",
        detail: mostExposedOperator
          ? `${mostExposedOperator.count.toLocaleString("fr-FR")} appels suspects pour ${formatMadValue(
              mostExposedOperator.totalCostMad,
            )}.`
          : "Aucune exposition operateur detectee.",
        recommendation: "Filtrer l'operateur et verifier les lignes a forte recidive.",
      },
      {
        id: "zone",
        title: "Zone la plus a risque",
        value: riskiestZone?.label ?? "Non disponible",
        detail: riskiestZone
          ? `${riskiestZone.count.toLocaleString("fr-FR")} evenements concentrent l'exposition la plus forte.`
          : "Aucune zone dominante detectee.",
        recommendation: "Renforcer les regles de blocage sur cette zone geographique.",
      },
      {
        id: "department",
        title: "Departement impacte",
        value: mostImpactedDepartment?.label ?? "Non disponible",
        detail: mostImpactedDepartment
          ? `${mostImpactedDepartment.count.toLocaleString("fr-FR")} alertes a traiter en priorite.`
          : "Aucun departement ne ressort nettement.",
        recommendation: "Coordonner avec le manager du departement pour containment et sensibilisation.",
      },
    ],
    [dominantFraudType, mostExposedOperator, riskiestZone, mostImpactedDepartment],
  );

  const currentPage = alerts ? Math.floor(alerts.offset / PAGE_SIZE) + 1 : 1;
  const totalPages = alerts ? Math.max(1, Math.ceil(alerts.total / PAGE_SIZE)) : 1;

  function resetFilters() {
    setSearchQuery("");
    setSelectedOperator("all");
    setSelectedDepartment("all");
    setSelectedCallZone("all");
    setSelectedSeverity("all");
  }

  function applyOperatorFilter(operatorLabel: string) {
    setSelectedOperator(operatorLabel);
    toast.success("Filtre operateur applique", {
      description: `${operatorLabel} est maintenant priorise dans la console.`,
    });
  }

  function applyZoneFilter(zoneLabel: string) {
    setSelectedCallZone(zoneLabel);
    toast.success("Filtre zone applique", {
      description: `${formatCallZoneLabel(zoneLabel)} est maintenant la zone surveillee.`,
    });
  }

  function applyDepartmentFilter(departmentLabel: string) {
    setSelectedDepartment(departmentLabel);
    toast.success("Filtre departement applique", {
      description: `${departmentLabel} est maintenant le segment cible.`,
    });
  }

  function applyFraudFilter(fraudLabel: string) {
    setSearchQuery(fraudLabel);
    toast.success("Filtre fraude applique", {
      description: `${fraudLabel} est maintenant le pattern analyse sur la page.`,
    });
  }

  function getHandlingStatus(alertId: number): string {
    if (treatedAlertIds.includes(alertId)) {
      return "Traitee";
    }
    if (blockedAlertIds.includes(alertId)) {
      return "Ligne bloquee";
    }
    if (notifiedAlertIds.includes(alertId)) {
      return "Alerte envoyee";
    }
    return "A surveiller";
  }

  async function handleQuickAction(alert: ApiCdrAlert, action: QuickAction) {
    const nextActionKey = `${action}-${alert.cdr_row_id}`;
    setActionKey(nextActionKey);

    try {
      await wait(650);

      if (action === "block") {
        setBlockedAlertIds((previousIds) => (previousIds.includes(alert.cdr_row_id) ? previousIds : [...previousIds, alert.cdr_row_id]));
        toast.success("Ligne bloquee", {
          description: `La ligne CDR-${alert.cdr_row_id} passe en confinement immediat.`,
        });
      }

      if (action === "treat") {
        setTreatedAlertIds((previousIds) => (previousIds.includes(alert.cdr_row_id) ? previousIds : [...previousIds, alert.cdr_row_id]));
        toast.success("Alerte traitee", {
          description: `L'alerte CDR-${alert.cdr_row_id} est marquee comme traitee.`,
        });
      }

      if (action === "notify") {
        setNotifiedAlertIds((previousIds) => (previousIds.includes(alert.cdr_row_id) ? previousIds : [...previousIds, alert.cdr_row_id]));
        toast.success("Alerte envoyee", {
          description: `Une notification SOC a ete simulee pour CDR-${alert.cdr_row_id}.`,
        });
      }
    } finally {
      setActionKey(null);
    }
  }

  async function openDetailModal(cdrRowId: number) {
    if (!token) {
      toast.error("Session indisponible", {
        description: "Reconnectez-vous pour charger le detail de l'alerte.",
      });
      return;
    }

    setSelectedDetailId(cdrRowId);
    setDetailAlert(null);
    setDetailError(null);
    setIsDetailLoading(true);

    try {
      const response = await cdrAnalyticsApi.alert(token, cdrRowId);
      setDetailAlert(response);
    } catch (error) {
      setDetailError(normalizeError(error, "Impossible de charger cette alerte."));
    } finally {
      setIsDetailLoading(false);
    }
  }

  function closeDetailModal() {
    setSelectedDetailId(null);
    setDetailAlert(null);
    setDetailError(null);
    setIsDetailLoading(false);
  }

  const detailAnalysis = useMemo(
    () => (detailAlert ? analyzeAlert(detailAlert, averageCostMad, maxCostMad) : null),
    [detailAlert, averageCostMad, maxCostMad],
  );

  const detailHistory = useMemo(
    () => (detailAlert ? buildCallHistory(detailAlert) : []),
    [detailAlert],
  );

  return (
    <>
      <div className="space-y-6 p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#6D28D9]">
              <Brain className="h-3.5 w-3.5" />
              SOC + IA telecom
            </div>
            <h1 className="mt-3 text-3xl font-bold text-[#0F172A]">Anomalies & alertes CDR</h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-[#64748B]">
              Monitoring actif des appels suspects avec score de menace, priorisation IA, explicabilite et
              actions de containment immediates.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => navigate("/consommations")}
              className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-[#DC2626] transition-all hover:bg-red-100 active:scale-[0.99]"
            >
              <Wallet className="h-4 w-4" />
              Voir impact budget
            </button>
            <button
              type="button"
              onClick={() => navigate("/recommandations")}
              className="inline-flex items-center gap-2 rounded-xl bg-[#6D28D9] px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-violet-500/25 transition-all hover:bg-[#5B21B6] active:scale-[0.99]"
            >
              <Zap className="h-4 w-4" />
              Voir recommandations IA
            </button>
          </div>
        </div>

        {errorMessage ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {errorMessage}
          </div>
        ) : null}

        <WidgetVisibilityManager
          widgets={anomalyWidgets}
          visibility={dashboardPreferences.visibility}
          visibleCount={dashboardPreferences.visibleCount}
          onChange={dashboardPreferences.setWidgetVisible}
          onReset={dashboardPreferences.resetVisibility}
        />

        <DashboardSection isVisible={dashboardPreferences.isWidgetVisible("kpis")}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-3xl border border-violet-200 bg-gradient-to-br from-violet-600 via-[#5B21B6] to-[#1D4ED8] p-6 text-white shadow-2xl shadow-violet-500/20 md:col-span-2">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-white/70">Score de menace global</p>
                <div className="mt-3 flex items-end gap-3">
                  <p className="text-4xl font-bold">{isLoading ? "--" : `${threatScore}/100`}</p>
                  <p className="pb-1 text-sm font-medium text-white/80">{isLoading ? "" : threatLevelLabel}</p>
                </div>
                <p className="mt-3 text-sm text-white/80">
                  Base sur le volume d'alertes, le niveau critique et l'exposition cout sur la fenetre CDR.
                </p>
              </div>
              <div className="rounded-2xl bg-white/10 p-3">
                <ShieldAlert className="h-6 w-6 text-white" />
              </div>
            </div>

            <div className="mt-5 h-3 rounded-full bg-white/15">
              <div
                className="h-3 rounded-full bg-emerald-300 transition-all duration-500"
                style={{ width: `${isLoading ? 0 : threatScore}%` }}
              />
            </div>

            <div className="mt-5 grid grid-cols-3 gap-3">
              {(["P1", "P2", "P3"] as PriorityLevel[]).map((priorityLevel) => (
                <div key={priorityLevel} className="rounded-2xl border border-white/15 bg-white/10 p-3">
                  <p className="text-xs uppercase tracking-[0.18em] text-white/70">{priorityLevel}</p>
                  <p className="mt-2 text-xl font-semibold">{isLoading ? "--" : priorityCounts[priorityLevel]}</p>
                  <p className="mt-1 text-xs text-white/70">
                    {priorityLevel === "P1"
                      ? "Escalade immediate"
                      : priorityLevel === "P2"
                        ? "Surveillance renforcee"
                        : "Backlog SOC"}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-gray-200 bg-white p-6">
            <div className="flex items-center justify-between">
              <p className="text-sm text-[#64748B]">Alertes detectees</p>
              <AlertTriangle className="h-5 w-5 text-[#F97316]" />
            </div>
            <p className="mt-3 text-3xl font-bold text-[#0F172A]">
              {isLoading ? "--" : (alerts?.total ?? 0).toLocaleString("fr-FR")}
            </p>
            <p className="mt-2 text-sm text-[#64748B]">Volume correspondant aux filtres actifs.</p>
          </div>

          <div className="rounded-3xl border border-gray-200 bg-white p-6">
            <div className="flex items-center justify-between">
              <p className="text-sm text-[#64748B]">Critiques</p>
              <AlertCircle className="h-5 w-5 text-[#DC2626]" />
            </div>
            <p className="mt-3 text-3xl font-bold text-[#DC2626]">
              {isLoading ? "--" : (overview?.kpis.critical_alerts ?? 0).toLocaleString("fr-FR")}
            </p>
            <p className="mt-2 text-sm text-[#64748B]">Priorite immediate pour le SOC.</p>
          </div>

          <div className="rounded-3xl border border-gray-200 bg-white p-6">
            <div className="flex items-center justify-between">
              <p className="text-sm text-[#64748B]">Exposition suspecte</p>
              <Wallet className="h-5 w-5 text-[#F97316]" />
            </div>
            <p className="mt-3 text-3xl font-bold text-[#0F172A]">
              {isLoading ? "--" : formatMadValue(overview?.kpis.suspicious_cost_exposure_mad ?? 0)}
            </p>
            <p className="mt-2 text-sm text-[#64748B]">Montant des appels suspects sur le snapshot courant.</p>
          </div>
        </div>
        </DashboardSection>

        <DashboardSection isVisible={dashboardPreferences.isWidgetVisible("ai-insights")}>
        <div className="rounded-3xl border border-gray-200 bg-white p-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#6D28D9]">Insights IA</p>
              <h2 className="mt-2 text-2xl font-semibold text-[#0F172A]">Resume intelligent de l'exposition fraude</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[#64748B]">
                Le moteur met en avant les segments a traiter d'abord, puis propose l'action la plus utile
                pour contenir le risque.
              </p>
            </div>

            <Badge className="rounded-full border-violet-200 bg-violet-50 px-3 py-1 text-[#6D28D9]">
              Monitoring priorise
            </Badge>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-4">
            {insightCards.map((insightCard) => (
              <div
                key={insightCard.id}
                className="rounded-2xl border border-gray-200 bg-gradient-to-br from-white to-[#F8FAFC] p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#64748B]">{insightCard.title}</p>
                <p className="mt-3 text-xl font-semibold text-[#0F172A]">{insightCard.value}</p>
                <p className="mt-2 text-sm leading-6 text-[#64748B]">{insightCard.detail}</p>
                <div className="mt-4 rounded-2xl border border-violet-100 bg-violet-50/70 p-3 text-sm text-[#4C1D95]">
                  {insightCard.recommendation}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {insightCard.id === "dominant-fraud" && dominantFraudType ? (
                    <button
                      type="button"
                      onClick={() => applyFraudFilter(dominantFraudType.label)}
                      className="rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm font-medium text-[#6D28D9] transition-colors hover:bg-violet-50"
                    >
                      Filtrer ce pattern
                    </button>
                  ) : null}
                  {insightCard.id === "operator" && mostExposedOperator ? (
                    <button
                      type="button"
                      onClick={() => applyOperatorFilter(mostExposedOperator.label)}
                      className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-medium text-[#2563EB] transition-colors hover:bg-blue-50"
                    >
                      Focus operateur
                    </button>
                  ) : null}
                  {insightCard.id === "zone" && riskiestZone ? (
                    <button
                      type="button"
                      onClick={() => applyZoneFilter(riskiestZone.rawLabel)}
                      className="rounded-lg border border-orange-200 bg-white px-3 py-2 text-sm font-medium text-[#F97316] transition-colors hover:bg-orange-50"
                    >
                      Filtrer la zone
                    </button>
                  ) : null}
                  {insightCard.id === "department" && mostImpactedDepartment ? (
                    <button
                      type="button"
                      onClick={() => applyDepartmentFilter(mostImpactedDepartment.label)}
                      className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm font-medium text-[#16A34A] transition-colors hover:bg-emerald-50"
                    >
                      Filtrer le departement
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
        </DashboardSection>

        <DashboardSection isVisible={dashboardPreferences.isWidgetVisible("filters")}>
        <div className="rounded-3xl border border-gray-200 bg-white p-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <p className="text-sm font-medium text-[#64748B]">
                {(alerts?.total ?? 0).toLocaleString("fr-FR")} alertes correspondent aux filtres actifs
              </p>
            </div>
            <button
              type="button"
              onClick={resetFilters}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-[#64748B] transition-colors hover:bg-[#F8FAFC]"
            >
              Reinitialiser
            </button>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="relative lg:col-span-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748B]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Pays, zone, fraude, recommandation..."
                className="w-full rounded-xl border border-gray-200 bg-[#F8FAFC] py-3 pr-4 pl-10 text-sm text-[#0F172A] focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              />
            </div>

            <select
              value={selectedOperator}
              onChange={(event) => setSelectedOperator(event.target.value)}
              className="rounded-xl border border-gray-200 bg-[#F8FAFC] px-4 py-3 text-sm text-[#0F172A] focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
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
              onChange={(event) => setSelectedDepartment(event.target.value)}
              className="rounded-xl border border-gray-200 bg-[#F8FAFC] px-4 py-3 text-sm text-[#0F172A] focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
            >
              <option value="all">Tous les departements</option>
              {(filters?.departments ?? []).map((department) => (
                <option key={department} value={department}>
                  {department}
                </option>
              ))}
            </select>

            <select
              value={selectedCallZone}
              onChange={(event) => setSelectedCallZone(event.target.value)}
              className="rounded-xl border border-gray-200 bg-[#F8FAFC] px-4 py-3 text-sm text-[#0F172A] focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
            >
              <option value="all">Toutes les zones</option>
              {(filters?.call_zones ?? []).map((callZone) => (
                <option key={callZone} value={callZone}>
                  {formatCallZoneLabel(callZone)}
                </option>
              ))}
            </select>

            <select
              value={selectedSeverity}
              onChange={(event) => setSelectedSeverity(event.target.value)}
              className="rounded-xl border border-gray-200 bg-[#F8FAFC] px-4 py-3 text-sm text-[#0F172A] focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
            >
              <option value="all">Tous les niveaux</option>
              {(filters?.severities ?? []).map((severity) => (
                <option key={severity} value={severity}>
                  {formatSeverityLabel(severity)}
                </option>
              ))}
            </select>
          </div>
        </div>
        </DashboardSection>

        <DashboardSection
          isVisible={dashboardPreferences.isWidgetVisible("charts")}
          collapsible
          title="Graphiques fraude secondaires"
          description="Repartition par type, operateur et zone, masquee par defaut pour garder la console SOC lisible."
          className="rounded-3xl border border-gray-200 bg-white p-6"
          contentClassName="pt-5"
        >
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="rounded-3xl border border-gray-200 bg-white p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-[#0F172A]">Fraude par type</h2>
                <p className="mt-1 text-sm text-[#64748B]">Cliquer sur une barre applique le filtre du pattern.</p>
              </div>
              <div className="rounded-2xl bg-violet-50 p-3">
                <Brain className="h-5 w-5 text-[#6D28D9]" />
              </div>
            </div>

            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={fraudTypeChartData}>
                <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke="#64748B" tick={{ fontSize: 12 }} />
                <YAxis stroke="#64748B" />
                <Tooltip formatter={(value: number) => [`${value} alertes`, "Volume"]} />
                <Bar dataKey="count" radius={[10, 10, 0, 0]}>
                  {fraudTypeChartData.map((entry) => (
                    <Cell
                      key={entry.label}
                      fill="#6D28D9"
                      className="cursor-pointer"
                      onClick={() => applyFraudFilter(entry.label)}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="rounded-3xl border border-gray-200 bg-white p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-[#0F172A]">Fraude par operateur</h2>
                <p className="mt-1 text-sm text-[#64748B]">Le volume suspect est combine au cout observe.</p>
              </div>
              <div className="rounded-2xl bg-blue-50 p-3">
                <Shield className="h-5 w-5 text-[#2563EB]" />
              </div>
            </div>

            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={operatorChartData}>
                <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke="#64748B" tick={{ fontSize: 12 }} />
                <YAxis stroke="#64748B" />
                <Tooltip
                  formatter={(value: number, name: string, payload) => {
                    if (name === "count") {
                      return [`${value} alertes`, "Volume suspect"];
                    }
                    return [formatMadValue(payload?.payload?.totalCostMad ?? 0), "Cout"];
                  }}
                />
                <Bar dataKey="count" radius={[10, 10, 0, 0]}>
                  {operatorChartData.map((entry) => {
                    const styles = getOperatorStyles(entry.label);
                    return (
                      <Cell
                        key={entry.label}
                        fill={styles.color}
                        className="cursor-pointer"
                        onClick={() => applyOperatorFilter(entry.label)}
                      />
                    );
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="rounded-3xl border border-gray-200 bg-white p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-[#0F172A]">Fraude par zone</h2>
                <p className="mt-1 text-sm text-[#64748B]">Les zones critiques peuvent filtrer toute la page.</p>
              </div>
              <div className="rounded-2xl bg-orange-50 p-3">
                <Eye className="h-5 w-5 text-[#F97316]" />
              </div>
            </div>

            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={zoneChartData}>
                <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke="#64748B" tick={{ fontSize: 12 }} />
                <YAxis stroke="#64748B" />
                <Tooltip formatter={(value: number) => [`${value} alertes`, "Volume"]} />
                <Bar dataKey="count" radius={[10, 10, 0, 0]}>
                  {zoneChartData.map((entry) => (
                    <Cell
                      key={entry.label}
                      fill="#F97316"
                      className="cursor-pointer"
                      onClick={() => applyZoneFilter(entry.rawLabel)}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        </DashboardSection>

        <DashboardSection
          isVisible={dashboardPreferences.isWidgetVisible("temporal-analysis")}
          collapsible
          title="Analyse temporelle et escalade"
          description="Heatmap horaire et top 5 des alertes a escalader, disponibles a la demande."
          className="rounded-3xl border border-gray-200 bg-white p-6"
          contentClassName="pt-5"
        >
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="rounded-3xl border border-gray-200 bg-white p-6 xl:col-span-2">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-[#0F172A]">Activite fraude par heure / jour</h2>
                <p className="mt-1 text-sm text-[#64748B]">
                  Vue de distribution temporelle pour reperer les fenetres d'attaque recurrentes.
                </p>
              </div>
              <div className="rounded-2xl bg-red-50 p-3">
                <Clock3 className="h-5 w-5 text-[#DC2626]" />
              </div>
            </div>

            <div className="grid grid-cols-[70px_repeat(6,minmax(0,1fr))] gap-2">
              <div />
              {TIME_BUCKETS.map((timeBucket) => (
                <div key={timeBucket.label} className="text-center text-xs font-medium text-[#64748B]">
                  {timeBucket.label}
                </div>
              ))}
              {heatmap.map((heatmapRow, rowIndex) => (
                <div key={`heatmap-row-${rowIndex}`} className="contents">
                  <div className="flex items-center text-xs font-medium text-[#64748B]">{heatmapRow[0]?.dayLabel}</div>
                  {heatmapRow.map((heatmapCell) => (
                    <div
                      key={`${heatmapCell.dayLabel}-${heatmapCell.slotLabel}`}
                      className={`flex h-12 items-center justify-center rounded-xl text-xs font-semibold text-white ${getHeatmapColor(
                        heatmapCell.count,
                        maxHeatCount,
                      )}`}
                      title={`${heatmapCell.dayLabel} ${heatmapCell.slotLabel}: ${heatmapCell.count} alertes`}
                    >
                      {heatmapCell.count === 0 ? "-" : heatmapCell.count}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-gray-200 bg-white p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-[#0F172A]">File d'escalade IA</h2>
                <p className="mt-1 text-sm text-[#64748B]">Les alertes sont triees automatiquement par urgence.</p>
              </div>
              <div className="rounded-2xl bg-red-50 p-3">
                <BellRing className="h-5 w-5 text-[#DC2626]" />
              </div>
            </div>

            <div className="space-y-3">
              {priorityQueue.slice(0, 5).map((alert) => (
                <AIRiskInsightCard
                  key={alert.cdr_row_id}
                  riskId={alert.risk_id}
                  moduleLabel="Fraude CDR"
                  title={alert.title}
                  severity={formatSeverityLabel(alert.severity)}
                  description={`${formatFraudTypeLabel(alert.fraud_type)} - ${alert.operator_maroc} - ${alert.department}`}
                  impact={`${formatMadValue(alert.call_cost_mad)} - ${formatRiskScore(alert.fraud_risk_score_100)}`}
                  cause={alert.suspectPattern}
                  aiRecommendation={alert.ai_recommendation}
                  suggestedAction={alert.suggested_action}
                  confidenceScore={alert.confidence_score}
                  recommendationStatus={getHandlingStatus(alert.cdr_row_id)}
                  compact
                  onApply={() => void openDetailModal(alert.cdr_row_id)}
                  onSimulate={() => setWhyAlert(alert)}
                />
              ))}
            </div>
          </div>
        </div>
        </DashboardSection>

        <DashboardSection isVisible={dashboardPreferences.isWidgetVisible("alerts-console")}>
        <div className="overflow-hidden rounded-3xl border border-gray-200 bg-white">
          <div className="border-b border-gray-200 px-6 py-5">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-[#0F172A]">Console active des alertes</h2>
                <p className="mt-1 text-sm text-[#64748B]">
                  Triee par priorite IA, puis par score et exposition budgetaire. Clic sur une ligne pour ouvrir la vue detaillee.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge className="rounded-full border-red-200 bg-red-50 px-3 py-1 text-[#DC2626]">
                  Critique = rouge
                </Badge>
                <Badge className="rounded-full border-orange-200 bg-orange-50 px-3 py-1 text-[#F97316]">
                  P1 / P2 / P3
                </Badge>
              </div>
            </div>
          </div>

          {isLoading ? (
            <div className="px-6 py-12 text-center text-sm text-[#64748B]">Chargement des alertes CDR...</div>
          ) : tableAlerts.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-[#64748B]">
              Aucune alerte ne correspond au perimetre filtre.
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead className="border-b border-gray-200 bg-[#F8FAFC]">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.16em] text-[#64748B]">ID</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.16em] text-[#64748B]">Date</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.16em] text-[#64748B]">Operateur</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.16em] text-[#64748B]">Departement</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.16em] text-[#64748B]">Zone</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.16em] text-[#64748B]">Fraude</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-[0.16em] text-[#64748B]">Score</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-[0.16em] text-[#64748B]">Cout</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.16em] text-[#64748B]">Priorite IA</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.16em] text-[#64748B]">Niveau</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.16em] text-[#64748B]">Actions rapides</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {tableAlerts.map((alert) => {
                      const isCritical = alert.severity === "critique" || alert.priorityLevel === "P1";
                      const handlingStatus = getHandlingStatus(alert.cdr_row_id);

                      return (
                        <tr
                          key={alert.cdr_row_id}
                          role="button"
                          tabIndex={0}
                          onClick={() => void openDetailModal(alert.cdr_row_id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              void openDetailModal(alert.cdr_row_id);
                            }
                          }}
                          className={`cursor-pointer align-top transition-all hover:bg-[#F8FAFC] ${
                            isCritical ? "border-l-4 border-l-[#DC2626] bg-red-50/40" : "bg-white"
                          }`}
                        >
                          <td className="px-4 py-4">
                            <div className="flex items-start gap-2">
                              {isCritical ? <span className="mt-1 h-2.5 w-2.5 animate-pulse rounded-full bg-[#DC2626]" /> : null}
                              <div>
                                <p className="font-semibold text-[#0F172A]">CDR-{alert.cdr_row_id}</p>
                                <p className="mt-1 text-xs text-[#64748B]">{handlingStatus}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-4 text-sm text-[#475569]">{formatCdrDateTime(alert.start_time)}</td>
                          <td className="px-4 py-4">
                            <span
                              className="inline-flex rounded-full px-2.5 py-1 text-xs font-medium"
                              style={getOperatorStyles(alert.operator_maroc)}
                            >
                              {alert.operator_maroc}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-sm text-[#475569]">{alert.department}</td>
                          <td className="px-4 py-4 text-sm text-[#475569]">{formatCallZoneLabel(alert.call_zone)}</td>
                          <td className="px-4 py-4">
                            <p className="text-sm font-medium text-[#0F172A]">{formatFraudTypeLabel(alert.fraud_type)}</p>
                            <p className="mt-1 text-xs text-[#64748B]">{alert.suspectPattern}</p>
                          </td>
                          <td className="px-4 py-4 text-right">
                            <p className="font-semibold text-[#0F172A]">{formatRiskScore(alert.fraud_risk_score_100)}</p>
                            <div className="mt-2 ml-auto h-2 w-24 rounded-full bg-slate-200">
                              <div
                                className={`h-2 rounded-full ${
                                  alert.fraud_risk_score_100 >= 90
                                    ? "bg-[#DC2626]"
                                    : alert.fraud_risk_score_100 >= 75
                                      ? "bg-[#F97316]"
                                      : "bg-[#6D28D9]"
                                }`}
                                style={{ width: `${alert.fraud_risk_score_100}%` }}
                              />
                            </div>
                          </td>
                          <td className="px-4 py-4 text-right font-semibold text-[#0F172A]">{formatMadValue(alert.call_cost_mad)}</td>
                          <td className="px-4 py-4">
                            <div className="flex flex-col gap-2">
                              <span
                                className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${getPriorityClasses(
                                  alert.priorityLevel,
                                )}`}
                              >
                                {alert.priorityLevel}
                              </span>
                              <span className="text-xs text-[#64748B]">Score IA {alert.priorityScore}/100</span>
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${getSeverityClasses(alert.severity)}`}>
                              {formatSeverityLabel(alert.severity)}
                            </span>
                          </td>
                          <td className="px-4 py-4">
                            <div className="min-w-[270px] space-y-2" onClick={(event) => event.stopPropagation()}>
                              <AIRecommendationBlock
                                recommendation={alert.ai_recommendation || alert.recommendation}
                                secondaryText={alert.suggested_action}
                                status={handlingStatus}
                                severityLabel={formatSeverityLabel(alert.severity)}
                                riskTypeLabel={formatFraudTypeLabel(alert.fraud_type)}
                                scoreLabel={`Score ${formatRiskScore(alert.fraud_risk_score_100)}`}
                                compact
                                previewLength={88}
                              />
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  disabled={actionKey === `block-${alert.cdr_row_id}` || blockedAlertIds.includes(alert.cdr_row_id)}
                                  onClick={() => void handleQuickAction(alert, "block")}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-[#DC2626] transition-all hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  <Ban className="h-3.5 w-3.5" />
                                  {actionKey === `block-${alert.cdr_row_id}` ? "Blocage..." : "Bloquer ligne"}
                                </button>
                                <button
                                  type="button"
                                  disabled={actionKey === `treat-${alert.cdr_row_id}` || treatedAlertIds.includes(alert.cdr_row_id)}
                                  onClick={() => void handleQuickAction(alert, "treat")}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-[#16A34A] transition-all hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  <CheckCheck className="h-3.5 w-3.5" />
                                  {actionKey === `treat-${alert.cdr_row_id}` ? "Traitement..." : "Marquer comme traite"}
                                </button>
                                <button
                                  type="button"
                                  disabled={actionKey === `notify-${alert.cdr_row_id}` || notifiedAlertIds.includes(alert.cdr_row_id)}
                                  onClick={() => void handleQuickAction(alert, "notify")}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium text-[#2563EB] transition-all hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  <BellRing className="h-3.5 w-3.5" />
                                  {actionKey === `notify-${alert.cdr_row_id}` ? "Envoi..." : "Envoyer alerte"}
                                </button>
                              </div>

                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setWhyAlert(alert)}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-medium text-[#6D28D9] transition-colors hover:bg-violet-100"
                                >
                                  <Brain className="h-3.5 w-3.5" />
                                  Voir pourquoi
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void openDetailModal(alert.cdr_row_id)}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-[#475569] transition-colors hover:bg-[#F8FAFC]"
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                  Detail
                                </button>
                                <span
                                  className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${getTreatmentBadgeClasses(
                                    handlingStatus,
                                  )}`}
                                >
                                  {handlingStatus}
                                </span>
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between border-t border-gray-200 px-6 py-4">
                <p className="text-sm text-[#64748B]">
                  Page {currentPage} / {totalPages} - {(alerts?.total ?? 0).toLocaleString("fr-FR")} alertes
                </p>
                <div className="flex gap-3">
                  <button
                    type="button"
                    disabled={isLoading || offset === 0}
                    onClick={() => setOffset((previousOffset) => Math.max(previousOffset - PAGE_SIZE, 0))}
                    className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-[#64748B] transition-colors hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Precedent
                  </button>
                  <button
                    type="button"
                    disabled={isLoading || !alerts || offset + PAGE_SIZE >= alerts.total}
                    onClick={() => setOffset((previousOffset) => previousOffset + PAGE_SIZE)}
                    className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-[#64748B] transition-colors hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Suivant
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
        </DashboardSection>

      </div>

      <Dialog open={whyAlert !== null} onOpenChange={(nextOpen) => (!nextOpen ? setWhyAlert(null) : undefined)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-hidden border border-gray-200 bg-white p-0">
          <DialogHeader className="shrink-0 border-b border-gray-200 px-6 py-5 pr-14">
            <DialogTitle className="text-2xl font-bold text-[#0F172A]">Pourquoi cette alerte est priorisee</DialogTitle>
            <DialogDescription className="text-sm text-[#64748B]">
              Lecture explicable de la decision IA pour aider au tri SOC.
            </DialogDescription>
          </DialogHeader>

          {whyAlert ? (
            <>
              <div className="min-h-0 space-y-5 overflow-y-auto px-6 py-5">
                <div className="flex flex-wrap gap-2">
                  <span className={`inline-flex rounded-full border px-3 py-1 text-sm font-semibold ${getPriorityClasses(whyAlert.priorityLevel)}`}>
                    {whyAlert.priorityLevel}
                  </span>
                  <span className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${getSeverityClasses(whyAlert.severity)}`}>
                    {formatSeverityLabel(whyAlert.severity)}
                  </span>
                  <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-[#475569]">
                    {whyAlert.operator_maroc}
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                  <div className="rounded-2xl border border-gray-200 bg-[#F8FAFC] p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Score</p>
                    <p className="mt-2 text-lg font-semibold text-[#0F172A]">{formatRiskScore(whyAlert.fraud_risk_score_100)}</p>
                  </div>
                  <div className="rounded-2xl border border-gray-200 bg-[#F8FAFC] p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Cout</p>
                    <p className="mt-2 text-lg font-semibold text-[#0F172A]">{formatMadValue(whyAlert.call_cost_mad)}</p>
                  </div>
                  <div className="rounded-2xl border border-gray-200 bg-[#F8FAFC] p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Fraude</p>
                    <p className="mt-2 text-lg font-semibold text-[#0F172A]">{formatFraudTypeLabel(whyAlert.fraud_type)}</p>
                  </div>
                  <div className="rounded-2xl border border-gray-200 bg-[#F8FAFC] p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Zone</p>
                    <p className="mt-2 text-lg font-semibold text-[#0F172A]">{formatCallZoneLabel(whyAlert.call_zone)}</p>
                  </div>
                </div>

                <div className="rounded-2xl border border-violet-200 bg-violet-50/60 p-5">
                  <div className="flex items-center gap-2">
                    <Brain className="h-5 w-5 text-[#6D28D9]" />
                    <h3 className="text-lg font-semibold text-[#0F172A]">Facteurs declencheurs</h3>
                  </div>
                  <ul className="mt-4 space-y-3">
                    {whyAlert.whyFactors.map((factor) => (
                      <li key={factor} className="flex gap-3 text-sm leading-6 text-[#475569]">
                        <span className="mt-2 h-2 w-2 rounded-full bg-[#6D28D9]" />
                        <span>{factor}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-2xl border border-gray-200 bg-white p-5">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="h-5 w-5 text-[#DC2626]" />
                    <h3 className="text-lg font-semibold text-[#0F172A]">Pattern suspect</h3>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-[#475569]">{whyAlert.suspectPattern}</p>
                  <AIRecommendationBlock
                    recommendation={whyAlert.ai_recommendation || whyAlert.recommendation}
                    secondaryText={whyAlert.suggested_action}
                    status={getHandlingStatus(whyAlert.cdr_row_id)}
                    severityLabel={formatSeverityLabel(whyAlert.severity)}
                    riskTypeLabel={formatFraudTypeLabel(whyAlert.fraud_type)}
                    scoreLabel={`Score ${formatRiskScore(whyAlert.fraud_risk_score_100)}`}
                    compact
                    className="mt-4"
                  />
                </div>
              </div>

              <DialogFooter className="shrink-0 gap-3 border-t border-gray-200 px-6 py-4">
                <button
                  type="button"
                  onClick={() => {
                    const alertId = whyAlert.cdr_row_id;
                    setWhyAlert(null);
                    void openDetailModal(alertId);
                  }}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#6D28D9] px-4 py-2.5 font-medium text-white transition-colors hover:bg-[#5B21B6]"
                >
                  <Eye className="h-4 w-4" />
                  Ouvrir la vue detaillee
                </button>
                <button
                  type="button"
                  onClick={() => setWhyAlert(null)}
                  className="rounded-xl border border-gray-200 px-4 py-2.5 font-medium text-[#64748B] transition-colors hover:bg-[#F8FAFC]"
                >
                  Fermer
                </button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={selectedDetailId !== null || isDetailLoading || detailAlert !== null || detailError !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            closeDetailModal();
          }
        }}
      >
        <DialogContent className="flex max-h-[92vh] max-w-5xl flex-col overflow-hidden border border-gray-200 bg-white p-0">
          <DialogHeader className="shrink-0 border-b border-gray-200 px-6 py-5 pr-14">
            <DialogTitle className="text-2xl font-bold text-[#0F172A]">Vue detaillee de l'alerte CDR</DialogTitle>
            <DialogDescription className="text-sm text-[#64748B]">
              Historique, evolution du score, pattern suspect et recommendation IA.
            </DialogDescription>
          </DialogHeader>

          {isDetailLoading ? (
            <div className="min-h-0 overflow-y-auto px-6 py-12 text-center text-sm text-[#64748B]">
              Chargement du detail de l'alerte...
            </div>
          ) : detailError ? (
            <div className="min-h-0 overflow-y-auto px-6 py-6">
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                {detailError}
              </div>
            </div>
          ) : detailAlert && detailAnalysis ? (
            <>
              <div className="min-h-0 space-y-6 overflow-y-auto px-6 py-5">
                <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-2xl font-bold text-[#0F172A]">CDR-{detailAlert.cdr_row_id}</h3>
                      <span className={`inline-flex rounded-full border px-3 py-1 text-sm font-semibold ${getPriorityClasses(detailAnalysis.priorityLevel)}`}>
                        {detailAnalysis.priorityLevel}
                      </span>
                      <span className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${getSeverityClasses(detailAlert.severity)}`}>
                        {formatSeverityLabel(detailAlert.severity)}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-[#64748B]">{formatCdrDateTime(detailAlert.start_time)}</p>
                    <p className="mt-3 text-sm leading-6 text-[#475569]">{detailAlert.recommendation_reason}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="rounded-2xl border border-gray-200 bg-[#F8FAFC] p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Score</p>
                      <p className="mt-2 text-xl font-semibold text-[#0F172A]">{formatRiskScore(detailAlert.fraud_risk_score_100)}</p>
                    </div>
                    <div className="rounded-2xl border border-gray-200 bg-[#F8FAFC] p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Probabilite</p>
                      <p className="mt-2 text-xl font-semibold text-[#0F172A]">{(detailAlert.fraud_risk_proba * 100).toFixed(1)}%</p>
                    </div>
                    <div className="rounded-2xl border border-gray-200 bg-[#F8FAFC] p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Cout</p>
                      <p className="mt-2 text-xl font-semibold text-[#0F172A]">{formatMadValue(detailAlert.call_cost_mad)}</p>
                    </div>
                    <div className="rounded-2xl border border-gray-200 bg-[#F8FAFC] p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Zone</p>
                      <p className="mt-2 text-xl font-semibold text-[#0F172A]">{formatCallZoneLabel(detailAlert.call_zone)}</p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
                  <div className="rounded-3xl border border-gray-200 bg-white p-5 xl:col-span-2">
                    <div className="flex items-center gap-2">
                      <Brain className="h-5 w-5 text-[#6D28D9]" />
                      <h4 className="text-lg font-semibold text-[#0F172A]">Evolution du score</h4>
                    </div>
                    <p className="mt-2 text-sm text-[#64748B]">
                      Trajectoire simulee autour de l'evenement pour visualiser l'escalade du risque.
                    </p>

                    <div className="mt-5 grid grid-cols-4 gap-3">
                      {detailAnalysis.scoreTrend.map((scorePoint) => (
                        <div key={scorePoint.label} className="rounded-2xl border border-gray-200 bg-[#F8FAFC] p-4">
                          <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">{scorePoint.label}</p>
                          <div className="mt-3 h-24 rounded-xl bg-white p-2">
                            <div className="flex h-full items-end">
                              <div
                                className="w-full rounded-lg bg-gradient-to-t from-[#6D28D9] to-[#2563EB]"
                                style={{ height: `${scorePoint.value}%` }}
                              />
                            </div>
                          </div>
                          <p className="mt-3 text-sm font-semibold text-[#0F172A]">{scorePoint.value}/100</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-3xl border border-red-200 bg-red-50/60 p-5">
                    <AIRecommendationBlock
                      recommendation={detailAlert.ai_recommendation || detailAlert.recommendation}
                      secondaryText={detailAlert.recommendation_reason}
                      status={getHandlingStatus(detailAlert.cdr_row_id)}
                      severityLabel={formatSeverityLabel(detailAlert.severity)}
                      riskTypeLabel={formatFraudTypeLabel(detailAlert.fraud_type)}
                      scoreLabel={`Score ${formatRiskScore(detailAlert.fraud_risk_score_100)}`}
                      className="border-red-100 bg-white/90"
                    />
                    <div className="mt-4 space-y-2">
                      {detailAnalysis.whyFactors.map((factor) => (
                        <div key={factor} className="rounded-xl border border-red-100 bg-white px-3 py-2 text-sm text-[#475569]">
                          {factor}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                  <div className="rounded-3xl border border-gray-200 bg-white p-5">
                    <div className="flex items-center gap-2">
                      <Clock3 className="h-5 w-5 text-[#2563EB]" />
                      <h4 className="text-lg font-semibold text-[#0F172A]">Historique appel</h4>
                    </div>
                    <div className="mt-4 space-y-3">
                      {detailHistory.map((historyItem) => (
                        <div key={historyItem.title} className="rounded-2xl border border-gray-200 bg-[#F8FAFC] p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-medium text-[#0F172A]">{historyItem.title}</p>
                              <p className="mt-2 text-sm text-[#475569]">{historyItem.description}</p>
                            </div>
                            <span className="text-xs font-medium text-[#64748B]">{historyItem.meta}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-3xl border border-gray-200 bg-white p-5">
                    <div className="flex items-center gap-2">
                      <ShieldAlert className="h-5 w-5 text-[#DC2626]" />
                      <h4 className="text-lg font-semibold text-[#0F172A]">Pattern suspect et regles</h4>
                    </div>
                    <div className="mt-4 rounded-2xl border border-gray-200 bg-[#F8FAFC] p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Pattern IA</p>
                      <p className="mt-2 text-sm leading-6 text-[#475569]">{detailAnalysis.suspectPattern}</p>
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="rounded-2xl border border-gray-200 p-4">
                        <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Route</p>
                        <p className="mt-2 text-sm font-medium text-[#0F172A]">{detailAlert.route_label}</p>
                        <p className="mt-1 text-xs text-[#64748B]">
                          {detailAlert.operator_maroc} - {detailAlert.department}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-gray-200 p-4">
                        <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Appel</p>
                        <p className="mt-2 text-sm font-medium text-[#0F172A]">{formatCallTypeLabel(detailAlert.call_type)}</p>
                        <p className="mt-1 text-xs text-[#64748B]">{detailAlert.duration_sec}s - {detailAlert.transaction_status}</p>
                      </div>
                    </div>

                    <div className="mt-4 rounded-2xl border border-gray-200 p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Regles declenchees</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {detailAlert.rule_matches.map((ruleMatch) => (
                          <span
                            key={ruleMatch}
                            className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-semibold text-[#6D28D9]"
                          >
                            {ruleMatch}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {[
                        detailAlert.roaming_flag ? "Roaming actif" : null,
                        detailAlert.international_flag ? "International" : null,
                        detailAlert.high_cost_flag ? "Cout eleve" : null,
                        detailAlert.long_duration_flag ? "Longue duree" : null,
                        detailAlert.is_night_call ? "Appel de nuit" : null,
                      ]
                        .filter(Boolean)
                        .map((flagLabel) => (
                          <span
                            key={flagLabel}
                            className="rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-semibold text-[#F97316]"
                          >
                            {flagLabel}
                          </span>
                        ))}
                    </div>
                  </div>
                </div>
              </div>

              <DialogFooter className="shrink-0 border-t border-gray-200 px-6 py-4 sm:flex-col">
                <div className="flex w-full flex-col gap-3">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handleQuickAction(detailAlert, "block")}
                      disabled={actionKey === `block-${detailAlert.cdr_row_id}` || blockedAlertIds.includes(detailAlert.cdr_row_id)}
                      className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 font-medium text-[#DC2626] transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Ban className="h-4 w-4" />
                      {actionKey === `block-${detailAlert.cdr_row_id}` ? "Blocage..." : "Bloquer ligne"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleQuickAction(detailAlert, "treat")}
                      disabled={actionKey === `treat-${detailAlert.cdr_row_id}` || treatedAlertIds.includes(detailAlert.cdr_row_id)}
                      className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 font-medium text-[#16A34A] transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <CheckCheck className="h-4 w-4" />
                      {actionKey === `treat-${detailAlert.cdr_row_id}` ? "Traitement..." : "Marquer comme traite"}
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => navigate("/consommations")}
                      className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 font-medium text-[#475569] transition-colors hover:bg-[#F8FAFC]"
                    >
                      <Wallet className="h-4 w-4" />
                      Voir impact budget
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate("/recommandations")}
                      className="inline-flex items-center gap-2 rounded-xl bg-[#6D28D9] px-4 py-2.5 font-medium text-white transition-colors hover:bg-[#5B21B6]"
                    >
                      <Zap className="h-4 w-4" />
                      Voir recommandations IA
                    </button>
                    <Link
                      to={`/anomalies/${detailAlert.cdr_row_id}`}
                      className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 font-medium text-[#2563EB] transition-colors hover:bg-blue-100"
                    >
                      <Eye className="h-4 w-4" />
                      Page detaillee
                    </Link>
                    <button
                      type="button"
                      onClick={closeDetailModal}
                      className="inline-flex items-center rounded-xl border border-gray-200 px-4 py-2.5 font-medium text-[#64748B] transition-colors hover:bg-[#F8FAFC] sm:ml-auto"
                    >
                      Fermer
                    </button>
                  </div>
                </div>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
