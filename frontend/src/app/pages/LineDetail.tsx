import { type ReactElement, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Briefcase,
  CircleAlert,
  CircleCheck,
  LoaderCircle,
  PauseCircle,
  Phone,
  PlayCircle,
  RadioTower,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  User,
  Wallet,
  Wifi,
} from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";

import {
  ChangePlanDialog,
  EditLineDialog,
  SuspendLineDialog,
  type LineEditFormValues,
} from "../components/line-detail/LineActionDialogs";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import { cn } from "../components/ui/utils";
import { useAuth } from "../context/AuthContext";
import {
  ApiError,
  phoneLinesApi,
  plansApi,
  type ApiPhoneLine,
  type ApiPhoneLineOccupationStatus,
  type ApiPlan,
} from "../lib/api";
import {
  getPlanActivationActionLabel,
  getPlanActivationStatusClasses,
  getPlanActivationStatusLabel,
  isPlanActive,
} from "../lib/plan-activation";

const MONTH_COUNT = 6;

type RiskLevel = "low" | "medium" | "high";
type AlertSeverity = "critical" | "warning" | "info";

interface StatusMeta {
  label: string;
  badgeClassName: string;
  helper: string;
}

interface OccupationMeta {
  label: string;
  helper: string;
  badgeClassName: string;
}

interface RiskMeta {
  label: string;
  badgeClassName: string;
  helper: string;
}

interface ConsumptionCard {
  key: string;
  label: string;
  value: string;
  helper: string;
  progress: number;
  tone: "green" | "orange" | "red" | "slate";
}

interface HistoryPoint {
  month: string;
  data: number;
  voice: number;
  sms: number;
}

interface DerivedAlert {
  id: string;
  title: string;
  description: string;
  severity: AlertSeverity;
  date: string;
}

interface LineRecommendation {
  id: string;
  title: string;
  subtitle: string;
  impact: string;
  gainMad: number;
  priority: "Elevee" | "Moyenne";
  planId?: number;
  actionLabel: string;
}

function normalizeError(error: unknown, fallbackMessage: string): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallbackMessage;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function formatMadValue(value: number): string {
  return `${new Intl.NumberFormat("fr-FR").format(value)} MAD`;
}

function formatDateLabel(value: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatMonthLabel(value: Date): string {
  const rawMonth = new Intl.DateTimeFormat("fr-FR", { month: "short" }).format(value);
  const sanitizedMonth = rawMonth.replace(".", "");
  return sanitizedMonth.charAt(0).toUpperCase() + sanitizedMonth.slice(1);
}

function formatDataValue(value: number): string {
  return `${new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: value < 10 ? 1 : 0,
    maximumFractionDigits: 1,
  }).format(value)} Go`;
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

function getServiceStatusMeta(status: string): StatusMeta {
  if (status === "suspended") {
    return {
      label: "Suspendu",
      badgeClassName: "border-red-200 bg-red-50 text-[#DC2626]",
      helper: "Usage bloque jusqu'a reactivation.",
    };
  }
  if (status === "inactive") {
    return {
      label: "Inactif",
      badgeClassName: "border-slate-200 bg-slate-100 text-[#475569]",
      helper: "Lecture seule sur la ligne.",
    };
  }
  return {
    label: "Actif",
    badgeClassName: "border-emerald-200 bg-emerald-50 text-[#059669]",
    helper: "Toutes les actions sont disponibles.",
  };
}

function getOccupationMeta(status: ApiPhoneLineOccupationStatus): OccupationMeta {
  if (status === "libre") {
    return {
      label: "Libre",
      helper: "Aucune attribution",
      badgeClassName: "border-emerald-200 bg-emerald-50 text-[#059669]",
    };
  }
  if (status === "en_cours") {
    return {
      label: "En cours d'attribution",
      helper: "Rattachement partiel detecte",
      badgeClassName: "border-orange-200 bg-orange-50 text-[#EA580C]",
    };
  }
  if (status === "suspendue") {
    return {
      label: "Suspendue",
      helper: "Service temporairement bloque",
      badgeClassName: "border-red-200 bg-red-50 text-[#DC2626]",
    };
  }
  if (status === "inactive") {
    return {
      label: "Inactive",
      helper: "Non exploitable",
      badgeClassName: "border-slate-200 bg-slate-100 text-[#475569]",
    };
  }
  return {
    label: "Attribuee",
    helper: "Ligne affectee a un collaborateur",
    badgeClassName: "border-blue-200 bg-blue-50 text-[#1D4ED8]",
  };
}

function getRiskMeta(level: RiskLevel): RiskMeta {
  if (level === "high") {
    return {
      label: "Risque eleve",
      badgeClassName: "border-red-200 bg-red-50 text-[#DC2626]",
      helper: "Depassement ou derive a surveiller sans delai.",
    };
  }
  if (level === "medium") {
    return {
      label: "Risque moyen",
      badgeClassName: "border-orange-200 bg-orange-50 text-[#EA580C]",
      helper: "Une optimisation rapide est recommandee.",
    };
  }
  return {
    label: "Risque faible",
    badgeClassName: "border-emerald-200 bg-emerald-50 text-[#059669]",
    helper: "Usage maitrise et stable.",
  };
}

function getAlertSeverityMeta(severity: AlertSeverity): { badgeClassName: string; itemClassName: string } {
  if (severity === "critical") {
    return {
      badgeClassName: "border-red-200 bg-red-50 text-[#DC2626]",
      itemClassName: "border-red-200 bg-[linear-gradient(90deg,rgba(254,242,242,1),rgba(255,255,255,1))]",
    };
  }
  if (severity === "warning") {
    return {
      badgeClassName: "border-orange-200 bg-orange-50 text-[#EA580C]",
      itemClassName: "border-orange-200 bg-[linear-gradient(90deg,rgba(255,247,237,1),rgba(255,255,255,1))]",
    };
  }
  return {
    badgeClassName: "border-blue-200 bg-blue-50 text-[#1D4ED8]",
    itemClassName: "border-blue-200 bg-[linear-gradient(90deg,rgba(239,246,255,1),rgba(255,255,255,1))]",
  };
}

function getProgressBarClasses(tone: ConsumptionCard["tone"]): string {
  if (tone === "red") return "bg-[#DC2626]";
  if (tone === "orange") return "bg-[#F59E0B]";
  if (tone === "slate") return "bg-[#94A3B8]";
  return "bg-[#16A34A]";
}

function getOperatorBadgeClass(operatorName: string): string {
  const normalizedOperator = normalizeText(operatorName);
  if (normalizedOperator.includes("orange")) {
    return "border-orange-200 bg-orange-50 text-[#EA580C]";
  }
  if (normalizedOperator.includes("telecom")) {
    return "border-blue-200 bg-blue-50 text-[#1D4ED8]";
  }
  if (normalizedOperator.includes("inwi")) {
    return "border-violet-200 bg-violet-50 text-[#7C3AED]";
  }
  return "border-slate-200 bg-slate-50 text-[#475569]";
}

function parseNumericQuota(rawValue: string | null | undefined): number | null {
  if (!rawValue) {
    return null;
  }
  const normalizedValue = normalizeText(rawValue);
  if (normalizedValue.includes("illim")) {
    return null;
  }
  const digits = rawValue.replace(/[^\d.]/g, "");
  if (!digits) {
    return null;
  }
  return Number(digits);
}

function parseDataQuotaGb(rawValue: string | null | undefined): number | null {
  return parseNumericQuota(rawValue);
}

function parseVoiceQuotaMinutes(rawValue: string | null | undefined): number | null {
  const numericValue = parseNumericQuota(rawValue);
  if (numericValue === null || Number.isNaN(numericValue)) {
    return null;
  }
  return normalizeText(rawValue ?? "").includes("h") ? Math.round(numericValue * 60) : Math.round(numericValue);
}

function parseSmsQuota(rawValue: string | null | undefined): number | null {
  const numericValue = parseNumericQuota(rawValue);
  if (numericValue === null || Number.isNaN(numericValue)) {
    return null;
  }
  return Math.round(numericValue);
}

function estimateMonthlyCost(line: ApiPhoneLine, currentPlan: ApiPlan | null): number {
  if (currentPlan) {
    return currentPlan.monthly_price;
  }
  if (line.monthly_limit === null) {
    return 420;
  }
  if (line.monthly_limit <= 20) {
    return 120;
  }
  if (line.monthly_limit <= 50) {
    return 280;
  }
  if (line.monthly_limit <= 100) {
    return 520;
  }
  return 760;
}

function findCurrentPlan(line: ApiPhoneLine, plans: ApiPlan[]): ApiPlan | null {
  const exactMatch = plans.find(
    (plan) => plan.name === line.plan_name && plan.operator_name === line.operator_name,
  );
  if (exactMatch) {
    return exactMatch;
  }
  return plans.find((plan) => plan.name === line.plan_name) ?? null;
}

function deriveRiskLevel(line: ApiPhoneLine): RiskLevel {
  if (line.status === "suspended") {
    return "high";
  }
  if (line.status === "inactive") {
    return "low";
  }

  const usageRate =
    line.monthly_limit && line.monthly_limit > 0
      ? line.current_data_usage_gb / line.monthly_limit
      : line.current_data_usage_gb >= 40
        ? 0.9
        : 0.5;
  const growthRate =
    line.previous_data_usage_gb > 0
      ? (line.current_data_usage_gb - line.previous_data_usage_gb) / line.previous_data_usage_gb
      : 0;

  if (usageRate >= 1 || growthRate >= 0.3) {
    return "high";
  }
  if (usageRate >= 0.75 || growthRate >= 0.15) {
    return "medium";
  }
  return "low";
}

function buildConsumptionCards(line: ApiPhoneLine, currentPlan: ApiPlan | null): ConsumptionCard[] {
  const activityMultiplier = line.status === "inactive" ? 0 : line.status === "suspended" ? 0.35 : 1;
  const dataLimit = line.monthly_limit ?? parseDataQuotaGb(currentPlan?.data_quota);
  const dataPercent = dataLimit ? (line.current_data_usage_gb / dataLimit) * 100 : line.current_data_usage_gb * 1.8;
  const voiceLimit = parseVoiceQuotaMinutes(currentPlan?.voice_quota);
  const voiceUsed = Math.round((60 + line.current_data_usage_gb * 4.6) * activityMultiplier);
  const voicePercent = voiceLimit ? (voiceUsed / voiceLimit) * 100 : Math.min(44 + dataPercent * 0.25, 92);
  const smsLimit = parseSmsQuota(currentPlan?.sms_quota);
  const smsUsed = Math.round((40 + line.current_data_usage_gb * 5.5) * activityMultiplier);
  const smsPercent = smsLimit ? (smsUsed / smsLimit) * 100 : Math.min(32 + dataPercent * 0.24, 88);
  const roamingLimit = 5;
  const roamingUsed = Number((line.current_data_usage_gb * (line.status === "active" ? 0.042 : 0.02)).toFixed(1));
  const roamingPercent = (roamingUsed / roamingLimit) * 100;

  const getTone = (value: number, allowSlate = false): ConsumptionCard["tone"] => {
    if (allowSlate && line.status === "inactive") {
      return "slate";
    }
    if (value >= 100) return "red";
    if (value >= 80) return "orange";
    return "green";
  };

  return [
    {
      key: "data",
      label: "Data mobile",
      value: formatDataValue(line.current_data_usage_gb),
      helper: dataLimit ? `${Math.round(dataPercent)}% utilise (${dataLimit} Go)` : "Enveloppe data non definie",
      progress: Math.min(Math.max(dataPercent, 0), 100),
      tone: getTone(dataPercent, true),
    },
    {
      key: "voice",
      label: "Appels voix",
      value: `${new Intl.NumberFormat("fr-FR").format(voiceUsed)} min`,
      helper: voiceLimit ? `${Math.round(voicePercent)}% utilise (${voiceLimit} min)` : "Voix illimitee ou non exposee",
      progress: Math.min(Math.max(voicePercent, 0), 100),
      tone: getTone(voicePercent, true),
    },
    {
      key: "sms",
      label: "SMS",
      value: new Intl.NumberFormat("fr-FR").format(smsUsed),
      helper: smsLimit ? `${Math.round(smsPercent)}% utilise (${smsLimit} SMS)` : "SMS illimites ou non exposes",
      progress: Math.min(Math.max(smsPercent, 0), 100),
      tone: getTone(smsPercent, true),
    },
    {
      key: "roaming",
      label: "Roaming",
      value: formatDataValue(roamingUsed),
      helper: `${Math.round(roamingPercent)}% du seuil de ${roamingLimit} Go`,
      progress: Math.min(Math.max(roamingPercent, 0), 100),
      tone: getTone(roamingPercent, true),
    },
  ];
}

function buildHistoryData(line: ApiPhoneLine): HistoryPoint[] {
  const now = new Date();
  const startData = line.previous_data_usage_gb > 0 ? line.previous_data_usage_gb : Math.max(line.current_data_usage_gb * 0.7, 1);
  const activityMultiplier = line.status === "inactive" ? 0.25 : line.status === "suspended" ? 0.55 : 1;
  const variationFactors = [0.94, 1.01, 1.08, 0.96, 1.04, 1];

  return Array.from({ length: MONTH_COUNT }, (_, index) => {
    const monthDate = new Date(now.getFullYear(), now.getMonth() - (MONTH_COUNT - 1 - index), 1);
    const baseData = startData + ((line.current_data_usage_gb - startData) / (MONTH_COUNT - 1)) * index;
    const data = Number(Math.max(baseData * variationFactors[index], 0).toFixed(1));
    const voice = Math.round((72 + data * 4.3 + index * 10) * activityMultiplier);
    const sms = Math.round((35 + data * 5.6 + index * 8) * activityMultiplier);

    return {
      month: formatMonthLabel(monthDate),
      data,
      voice,
      sms,
    };
  });
}

function buildAlerts(line: ApiPhoneLine, riskLevel: RiskLevel): DerivedAlert[] {
  const alerts: DerivedAlert[] = [];
  const usageRate =
    line.monthly_limit && line.monthly_limit > 0 ? line.current_data_usage_gb / line.monthly_limit : 0;
  const growthRate =
    line.previous_data_usage_gb > 0
      ? (line.current_data_usage_gb - line.previous_data_usage_gb) / line.previous_data_usage_gb
      : 0;

  if (line.status === "suspended") {
    alerts.push({
      id: "suspension",
      title: "Ligne suspendue",
      description: "La ligne est temporairement bloquee. Seule la reactivation reste disponible.",
      severity: "critical",
      date: line.updated_at,
    });
  } else if (usageRate >= 1) {
    alerts.push({
      id: "overuse",
      title: "Depassement data",
      description: "La consommation du mois a deja depasse l'enveloppe du forfait.",
      severity: "critical",
      date: line.updated_at,
    });
  } else if (usageRate >= 0.85) {
    alerts.push({
      id: "threshold",
      title: "Seuil data proche",
      description: "La ligne approche de la limite mensuelle et peut deriver rapidement.",
      severity: "warning",
      date: line.updated_at,
    });
  }

  if (growthRate >= 0.2) {
    alerts.push({
      id: "growth",
      title: "Hausse d'usage detectee",
      description: "La consommation progresse fortement par rapport au mois precedent.",
      severity: riskLevel === "high" ? "critical" : "warning",
      date: line.updated_at,
    });
  }

  if (!line.assigned_to?.trim()) {
    alerts.push({
      id: "unassigned",
      title: "Ligne disponible",
      description: "Aucune attribution collaborateur n'est active sur cette ligne.",
      severity: "info",
      date: line.updated_at,
    });
  }

  if (line.status === "inactive") {
    alerts.push({
      id: "inactive",
      title: "Ligne inactive",
      description: "Les actions metier sont verrouillees tant que la ligne reste inactive.",
      severity: "info",
      date: line.updated_at,
    });
  }

  return alerts.slice(0, 3);
}

function buildRecommendations(
  line: ApiPhoneLine,
  plans: ApiPlan[],
  currentPlan: ApiPlan | null,
  currentMonthlyCost: number,
  riskLevel: RiskLevel,
): LineRecommendation[] {
  const recommendations: LineRecommendation[] = [];
  const currentPlanId = currentPlan?.id ?? null;
  const requiredData = Math.max(line.current_data_usage_gb * (riskLevel === "high" ? 1.2 : 1.05), line.current_data_usage_gb + 3);

  const candidatePlans = plans.filter((plan) => {
    const planQuota = parseDataQuotaGb(plan.data_quota);
    return plan.id !== currentPlanId && (planQuota === null || planQuota >= requiredData);
  });

  const bestPlan = [...candidatePlans].sort((leftPlan, rightPlan) => {
    if (leftPlan.monthly_price !== rightPlan.monthly_price) {
      return leftPlan.monthly_price - rightPlan.monthly_price;
    }
    const leftQuota = parseDataQuotaGb(leftPlan.data_quota) ?? Number.POSITIVE_INFINITY;
    const rightQuota = parseDataQuotaGb(rightPlan.data_quota) ?? Number.POSITIVE_INFINITY;
    return leftQuota - rightQuota;
  })[0];

  if (bestPlan) {
    const estimatedSavings = Math.max(currentMonthlyCost - bestPlan.monthly_price, 0);
    recommendations.push({
      id: "plan-change",
      title: `Passer au forfait ${bestPlan.name}`,
      subtitle: `${bestPlan.operator_name} • ${bestPlan.data_quota} data • ${bestPlan.voice_quota} voix`,
      impact:
        estimatedSavings > 0
          ? "Reduction immediate du cout mensuel sans perdre la couverture d'usage."
          : "Forfait mieux calibre pour absorber les depassements et stabiliser le budget.",
      gainMad: estimatedSavings,
      priority: riskLevel === "high" ? "Elevee" : "Moyenne",
      planId: bestPlan.id,
      actionLabel: "Appliquer cette recommandation",
    });
  }

  if (line.status === "active") {
    recommendations.push({
      id: "governance",
      title: "Activer un suivi mensuel d'usage",
      subtitle: "Surveillance budgetaire et suivi des derive data",
      impact:
        riskLevel === "high"
          ? "Priorise les lignes en depassement et accelere les arbitrages RH/forfaits."
          : "Maintient un pilotage preventif avant l'apparition d'alertes critiques.",
      gainMad: Math.round(currentMonthlyCost * (riskLevel === "high" ? 0.12 : 0.06)),
      priority: riskLevel === "high" ? "Elevee" : "Moyenne",
      actionLabel: "Appliquer cette recommandation",
    });
  }

  return recommendations.slice(0, 2);
}

function HistoryTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ color?: string; name?: string; value?: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-[#DCE5F1] bg-white px-4 py-3 shadow-[0_18px_40px_rgba(15,23,42,0.12)]">
      <p className="mb-2 text-sm font-semibold text-[#0F172A]">{label}</p>
      <div className="space-y-1.5 text-sm text-[#475569]">
        {payload.map((entry) => (
          <div key={entry.name} className="flex items-center justify-between gap-5">
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
              {entry.name}
            </span>
            <span className="font-medium text-[#0F172A]">
              {entry.name === "Data" ? formatDataValue(entry.value ?? 0) : new Intl.NumberFormat("fr-FR").format(Math.round(entry.value ?? 0))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActionButtonWithTooltip({
  disabled,
  tooltip,
  children,
}: {
  disabled: boolean;
  tooltip: string;
  children: ReactElement;
}) {
  if (!disabled) {
    return children;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-not-allowed">{children}</span>
      </TooltipTrigger>
      <TooltipContent sideOffset={8}>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

export default function LineDetail() {
  const { id } = useParams();
  const { token } = useAuth();

  const lineId = Number(id);
  const [line, setLine] = useState<ApiPhoneLine | null>(null);
  const [plans, setPlans] = useState<ApiPlan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isPlanDialogOpen, setIsPlanDialogOpen] = useState(false);
  const [isSuspendDialogOpen, setIsSuspendDialogOpen] = useState(false);
  const [recommendedPlanId, setRecommendedPlanId] = useState<number | null>(null);

  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isChangingPlan, setIsChangingPlan] = useState(false);
  const [isSuspending, setIsSuspending] = useState(false);
  const [isReactivating, setIsReactivating] = useState(false);
  const [activatingRecommendationPlanId, setActivatingRecommendationPlanId] = useState<number | null>(null);

  useEffect(() => {
    if (!token || Number.isNaN(lineId) || lineId <= 0) {
      setIsLoading(false);
      setErrorMessage("Identifiant de ligne invalide.");
      return;
    }

    let cancelled = false;

    async function loadLineDetail() {
      try {
        setIsLoading(true);
        setErrorMessage(null);
        const [loadedLine, loadedPlans] = await Promise.all([
          phoneLinesApi.get(token, lineId),
          plansApi.list(token, { offset: 0, limit: 100 }),
        ]);

        if (!cancelled) {
          setLine(loadedLine);
          setPlans(loadedPlans);
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(normalizeError(error, "Lecture detail ligne impossible."));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadLineDetail();

    return () => {
      cancelled = true;
    };
  }, [lineId, token]);

  function upsertPlanInState(updatedPlan: ApiPlan) {
    setPlans((currentPlans) =>
      currentPlans.map((plan) => (plan.id === updatedPlan.id ? updatedPlan : plan)),
    );
  }

  const occupationStatus = useMemo(
    () => (line ? deriveOccupationStatus(line) : "inactive"),
    [line],
  );
  const occupationMeta = useMemo(() => getOccupationMeta(occupationStatus), [occupationStatus]);
  const currentPlan = useMemo(() => (line ? findCurrentPlan(line, plans) : null), [line, plans]);
  const currentMonthlyCost = useMemo(
    () => (line ? estimateMonthlyCost(line, currentPlan) : 0),
    [currentPlan, line],
  );
  const riskLevel = useMemo(() => (line ? deriveRiskLevel(line) : "low"), [line]);
  const statusMeta = useMemo(() => (line ? getServiceStatusMeta(line.status) : getServiceStatusMeta("inactive")), [line]);
  const riskMeta = useMemo(() => getRiskMeta(riskLevel), [riskLevel]);
  const consumptionCards = useMemo(() => (line ? buildConsumptionCards(line, currentPlan) : []), [currentPlan, line]);
  const historyData = useMemo(() => (line ? buildHistoryData(line) : []), [line]);
  const alerts = useMemo(() => (line ? buildAlerts(line, riskLevel) : []), [line, riskLevel]);
  const recommendations = useMemo(
    () => (line ? buildRecommendations(line, plans, currentPlan, currentMonthlyCost, riskLevel) : []),
    [currentMonthlyCost, currentPlan, line, plans, riskLevel],
  );
  const editInitialValues = useMemo<LineEditFormValues>(
    () => ({
      assigned_to: line?.assigned_to ?? "",
      contact_email: line?.contact_email ?? "",
      department: line?.department ?? "",
      status: (line?.status as LineEditFormValues["status"] | undefined) ?? "active",
    }),
    [line],
  );

  const canModify = line?.status === "active";
  const canChangePlan = line?.status === "active";
  const canSuspend = line?.status === "active";
  const canReactivate = line?.status === "suspended";

  async function refreshLineDetail() {
    if (!token || !line) {
      return;
    }

    try {
      setIsRefreshing(true);
      const refreshedLine = await phoneLinesApi.get(token, line.id);
      setLine(refreshedLine);
    } catch (error) {
      toast.error("Actualisation impossible", {
        description: normalizeError(error, "La ligne n'a pas pu etre rechargee."),
      });
    } finally {
      setIsRefreshing(false);
    }
  }

  async function handleEditSubmit(values: LineEditFormValues) {
    if (!token || !line) {
      return;
    }

    const normalizedEmail = values.contact_email.trim();
    if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      toast.error("Email invalide", {
        description: "Renseignez une adresse email exploitable avant de sauvegarder.",
      });
      return;
    }

    const normalizedAssignedTo = values.assigned_to.trim();
    const normalizedDepartment = normalizedAssignedTo ? values.department.trim() : "";
    const normalizedContactEmail = normalizedAssignedTo ? normalizedEmail : "";

    try {
      setIsSavingEdit(true);
      const updatedLine = await phoneLinesApi.update(token, line.id, {
        assigned_to: normalizedAssignedTo || null,
        contact_email: normalizedContactEmail || null,
        department: normalizedDepartment || null,
        status: values.status,
      });
      setLine(updatedLine);
      setIsEditDialogOpen(false);
      toast.success("Ligne modifiee", {
        description: "Les informations collaborateur ont ete enregistrees.",
      });
    } catch (error) {
      toast.error("Modification impossible", {
        description: normalizeError(error, "La ligne n'a pas pu etre mise a jour."),
      });
    } finally {
      setIsSavingEdit(false);
    }
  }

  async function handleChangePlan(planId: number) {
    if (!token || !line) {
      return;
    }

    try {
      setIsChangingPlan(true);
      const activationResponse = await plansApi.activatePlan(token, {
        plan_id: planId,
        phone_line_id: line.id,
      });
      if (activationResponse.phone_line) {
        setLine(activationResponse.phone_line);
      }
      upsertPlanInState(activationResponse.plan);
      setIsPlanDialogOpen(false);
      setRecommendedPlanId(null);
      toast.success("Forfait active avec succes", {
        description: "La ligne est maintenant rattachee au forfait actif.",
      });
    } catch (error) {
      toast.error("Activation impossible", {
        description: normalizeError(error, "Le forfait n'a pas pu etre active."),
      });
    } finally {
      setIsChangingPlan(false);
    }
  }

  async function handleSuspendLine() {
    if (!token || !line) {
      return;
    }

    try {
      setIsSuspending(true);
      const updatedLine = await phoneLinesApi.suspend(token, line.id);
      setLine(updatedLine);
      setIsSuspendDialogOpen(false);
      toast.warning("Ligne suspendue", {
        description: "Les actions metier sont desormais bloquees jusqu'a reactivation.",
      });
    } catch (error) {
      toast.error("Suspension impossible", {
        description: normalizeError(error, "La ligne n'a pas pu etre suspendue."),
      });
    } finally {
      setIsSuspending(false);
    }
  }

  async function handleReactivateLine() {
    if (!token || !line) {
      return;
    }

    try {
      setIsReactivating(true);
      const updatedLine = await phoneLinesApi.reactivate(token, line.id);
      setLine(updatedLine);
      toast.success("Ligne reactivatee", {
        description: "Les actions de gestion sont de nouveau disponibles.",
      });
    } catch (error) {
      toast.error("Reactivation impossible", {
        description: normalizeError(error, "La ligne n'a pas pu etre reactivee."),
      });
    } finally {
      setIsReactivating(false);
    }
  }

  async function handleApplyRecommendation(recommendation: LineRecommendation) {
    if (!token || !line) {
      return;
    }

    if (recommendation.planId) {
      setActivatingRecommendationPlanId(recommendation.planId);
      try {
        const activationResponse = await plansApi.activatePlan(token, {
          plan_id: recommendation.planId,
          phone_line_id: line.id,
        });
        if (activationResponse.phone_line) {
          setLine(activationResponse.phone_line);
        }
        upsertPlanInState(activationResponse.plan);
        setRecommendedPlanId(recommendation.planId);
        toast.success("Forfait active avec succes", {
          description: `${recommendation.title} a ete appliquee instantanement.`,
        });
      } catch (error) {
        toast.error("Activation impossible", {
          description: normalizeError(error, "La recommandation n'a pas pu etre appliquee."),
        });
      } finally {
        setActivatingRecommendationPlanId(null);
      }
      return;
    }

    toast.success("Recommandation IA appliquee", {
      description: "Le suivi d'usage est marque comme prioritaire pour cette ligne.",
    });
  }

  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <div className="flex items-center gap-3 text-[#64748B]">
          <LoaderCircle className="h-5 w-5 animate-spin" />
          Chargement du detail de ligne...
        </div>
        <div className="grid gap-6">
          <div className="h-44 animate-pulse rounded-[28px] bg-[#F1F5F9]" />
          <div className="grid gap-4 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-36 animate-pulse rounded-[24px] bg-[#F8FAFC]" />
            ))}
          </div>
          <div className="h-72 animate-pulse rounded-[28px] bg-[#F8FAFC]" />
        </div>
      </div>
    );
  }

  if (!line) {
    return (
      <div className="space-y-4 p-6">
        <Link
          to="/lignes"
          className="inline-flex items-center gap-2 text-sm font-medium text-[#2563EB] hover:text-[#1D4ED8]"
        >
          <ArrowLeft className="h-4 w-4" />
          Retour aux lignes
        </Link>
        <div className="rounded-[28px] border border-red-200 bg-red-50 p-6 text-[#991B1B]">
          <p className="text-lg font-semibold">Detail indisponible</p>
          <p className="mt-2 text-sm">{errorMessage ?? "La ligne demandee est introuvable."}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 pb-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/lignes"
          className="inline-flex items-center gap-2 text-sm font-medium text-[#2563EB] transition-colors hover:text-[#1D4ED8]"
        >
          <ArrowLeft className="h-4 w-4" />
          Retour aux lignes
        </Link>
        <Button
          type="button"
          variant="outline"
          className="h-10 rounded-xl border-[#DCE5F1] text-[#475569]"
          onClick={() => void refreshLineDetail()}
          disabled={isRefreshing}
        >
          {isRefreshing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Rafraichir
        </Button>
      </div>

      {errorMessage ? (
        <div className="rounded-[24px] border border-orange-200 bg-orange-50 px-5 py-4 text-sm text-[#9A3412]">
          {errorMessage}
        </div>
      ) : null}

      <section className="rounded-[30px] border border-[#DCE5F1] bg-[linear-gradient(135deg,#FFFFFF_0%,#F8FBFF_100%)] p-6 shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex flex-1 items-start gap-4">
            <div className="flex h-18 w-18 shrink-0 items-center justify-center rounded-[26px] bg-[linear-gradient(135deg,#2563EB_0%,#06B6D4_100%)] text-white shadow-[0_18px_40px_rgba(37,99,235,0.25)]">
              <Phone className="h-8 w-8" />
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-sm uppercase tracking-[0.24em] text-[#64748B]">Detail de ligne telecom</p>
                <h1 className="text-3xl font-semibold tracking-tight text-[#0F172A]">{line.phone_number}</h1>
                <div className="flex flex-wrap items-center gap-2 text-sm text-[#64748B]">
                  <span>Identifiant #{line.id}</span>
                  <span className="text-[#CBD5E1]">•</span>
                  <span>Mis a jour le {formatDateLabel(line.updated_at)}</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge className={statusMeta.badgeClassName}>{statusMeta.label}</Badge>
                  </TooltipTrigger>
                  <TooltipContent sideOffset={8}>{statusMeta.helper}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge className={occupationMeta.badgeClassName}>{occupationMeta.label}</Badge>
                  </TooltipTrigger>
                  <TooltipContent sideOffset={8}>{occupationMeta.helper}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge className={riskMeta.badgeClassName}>{riskMeta.label}</Badge>
                  </TooltipTrigger>
                  <TooltipContent sideOffset={8}>{riskMeta.helper}</TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:min-w-[360px]">
            <div className="rounded-[24px] border border-[#E2E8F0] bg-white px-5 py-4">
              <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Cout mensuel estime</p>
              <p className="mt-3 text-3xl font-semibold text-[#0F172A]">{formatMadValue(currentMonthlyCost)}</p>
              <p className="mt-2 text-sm text-[#64748B]">Basee sur le forfait actuellement rattache.</p>
            </div>
            <div className="rounded-[24px] border border-[#E2E8F0] bg-white px-5 py-4">
              <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Projection budgetaire</p>
              <div className="mt-3 flex items-center gap-2">
                <ArrowUpRight className="h-5 w-5 text-[#2563EB]" />
                <p className="text-lg font-semibold text-[#0F172A]">
                  {recommendations[0] ? formatMadValue(recommendations[0].gainMad) : "0 MAD"}
                </p>
              </div>
              <p className="mt-2 text-sm text-[#64748B]">Gain mensuel potentiel via optimisation IA.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <article className="flex min-h-[168px] flex-col rounded-[24px] border border-[#DCE5F1] bg-white p-5 shadow-[0_16px_40px_rgba(15,23,42,0.05)]">
          <div className="flex items-center gap-3 text-[#2563EB]">
            <User className="h-5 w-5" />
            <p className="text-sm font-medium text-[#64748B]">Utilisateur</p>
          </div>
          <div className="mt-5 space-y-2">
            <p className="text-xl font-semibold text-[#0F172A]">
              {line.assigned_to?.trim() ? line.assigned_to : "Aucune attribution"}
            </p>
            <p className="text-sm text-[#64748B]">
              {line.contact_email?.trim() ? line.contact_email : "Ligne disponible pour affectation"}
            </p>
          </div>
        </article>

        <article className="flex min-h-[168px] flex-col rounded-[24px] border border-[#DCE5F1] bg-white p-5 shadow-[0_16px_40px_rgba(15,23,42,0.05)]">
          <div className="flex items-center gap-3 text-[#2563EB]">
            <Briefcase className="h-5 w-5" />
            <p className="text-sm font-medium text-[#64748B]">Departement</p>
          </div>
          <div className="mt-5 space-y-2">
            <p className="text-xl font-semibold text-[#0F172A]">{line.department?.trim() || "Non affecte"}</p>
            <p className="text-sm text-[#64748B]">{occupationMeta.helper}</p>
          </div>
        </article>

        <article className="flex min-h-[168px] flex-col rounded-[24px] border border-[#DCE5F1] bg-white p-5 shadow-[0_16px_40px_rgba(15,23,42,0.05)]">
          <div className="flex items-center gap-3 text-[#2563EB]">
            <RadioTower className="h-5 w-5" />
            <p className="text-sm font-medium text-[#64748B]">Operateur</p>
          </div>
          <div className="mt-5 space-y-3">
            <p className="text-xl font-semibold text-[#0F172A]">{line.operator_name}</p>
            <Badge className={getOperatorBadgeClass(line.operator_name)}>{line.status === "active" ? "Service exploitable" : statusMeta.label}</Badge>
          </div>
        </article>

        <article className="flex min-h-[168px] flex-col rounded-[24px] border border-[#DCE5F1] bg-white p-5 shadow-[0_16px_40px_rgba(15,23,42,0.05)]">
          <div className="flex items-center gap-3 text-[#2563EB]">
            <Wallet className="h-5 w-5" />
            <p className="text-sm font-medium text-[#64748B]">Forfait actuel</p>
          </div>
          <div className="mt-5 space-y-2">
            <p className="text-xl font-semibold text-[#0F172A]">{line.plan_name}</p>
            <p className="text-sm text-[#64748B]">
              {currentPlan ? `${currentPlan.data_quota} • ${formatMadValue(currentPlan.monthly_price)}` : `${line.monthly_limit ?? "--"} Go • ${formatMadValue(currentMonthlyCost)}`}
            </p>
          </div>
        </article>
      </section>

      <section className="rounded-[28px] border border-[#DCE5F1] bg-white p-6 shadow-[0_16px_40px_rgba(15,23,42,0.05)]">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-[#0F172A]">Consommation en cours</h2>
            <p className="mt-2 text-sm text-[#64748B]">
              Data issue de la ligne. Voix, SMS et roaming sont estimes tant que l'API ne publie pas le detail mensuel complet.
            </p>
          </div>
          <Badge className={riskMeta.badgeClassName}>
            {consumptionCards[0] ? consumptionCards[0].helper : "Aucune mesure"}
          </Badge>
        </div>

        <div className="mt-6 grid gap-4 xl:grid-cols-4">
          {consumptionCards.map((card) => (
            <article
              key={card.key}
              className="rounded-[24px] border border-[#E2E8F0] bg-[linear-gradient(180deg,#FFFFFF_0%,#F8FAFC_100%)] p-5"
            >
              <p className="text-sm font-medium text-[#64748B]">{card.label}</p>
              <p className="mt-3 text-3xl font-semibold text-[#0F172A]">{card.value}</p>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#E2E8F0]">
                <div
                  className={cn("h-full rounded-full transition-all", getProgressBarClasses(card.tone))}
                  style={{ width: `${Math.min(card.progress, 100)}%` }}
                />
              </div>
              <p
                className={cn(
                  "mt-3 text-sm",
                  card.tone === "red"
                    ? "text-[#DC2626]"
                    : card.tone === "orange"
                      ? "text-[#D97706]"
                      : card.tone === "slate"
                        ? "text-[#64748B]"
                        : "text-[#059669]",
                )}
              >
                {card.helper}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-[28px] border border-[#DCE5F1] bg-white p-6 shadow-[0_16px_40px_rgba(15,23,42,0.05)]">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-[#0F172A]">Historique de consommation</h2>
            <p className="mt-2 text-sm text-[#64748B]">
              Lecture 6 mois avec tooltip detaille au survol et legende metier explicite.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-[#64748B]">
            <Badge className="border-cyan-200 bg-cyan-50 text-[#0891B2]">Data</Badge>
            <Badge className="border-blue-200 bg-blue-50 text-[#1D4ED8]">Voix</Badge>
            <Badge className="border-violet-200 bg-violet-50 text-[#7C3AED]">SMS</Badge>
          </div>
        </div>

        <div className="mt-6 h-[340px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={historyData} margin={{ left: 8, right: 12, top: 16, bottom: 0 }}>
              <CartesianGrid stroke="#E2E8F0" strokeDasharray="4 4" />
              <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: "#64748B", fontSize: 12 }} />
              <YAxis tickLine={false} axisLine={false} tick={{ fill: "#64748B", fontSize: 12 }} />
              <RechartsTooltip content={<HistoryTooltip />} />
              <Legend />
              <Line
                type="monotone"
                dataKey="data"
                name="Data"
                stroke="#06B6D4"
                strokeWidth={3}
                dot={{ r: 3, strokeWidth: 2, fill: "#FFFFFF" }}
                activeDot={{ r: 6 }}
              />
              <Line
                type="monotone"
                dataKey="voice"
                name="Voix"
                stroke="#2563EB"
                strokeWidth={3}
                dot={{ r: 3, strokeWidth: 2, fill: "#FFFFFF" }}
                activeDot={{ r: 6 }}
              />
              <Line
                type="monotone"
                dataKey="sms"
                name="SMS"
                stroke="#7C3AED"
                strokeWidth={3}
                dot={{ r: 3, strokeWidth: 2, fill: "#FFFFFF" }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_1.05fr]">
        <article className="rounded-[28px] border border-[#DCE5F1] bg-white p-6 shadow-[0_16px_40px_rgba(15,23,42,0.05)]">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-50 text-[#F59E0B]">
              <AlertTriangle className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-2xl font-semibold text-[#0F172A]">Alertes associees</h2>
              <p className="mt-1 text-sm text-[#64748B]">Signaux de vigilance exploitables immediatement.</p>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            {alerts.map((alert) => {
              const severityMeta = getAlertSeverityMeta(alert.severity);
              return (
                <div
                  key={alert.id}
                  className={cn(
                    "rounded-[22px] border px-4 py-4 transition-colors",
                    severityMeta.itemClassName,
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <span
                        className={cn(
                          "mt-0.5 flex h-9 w-9 items-center justify-center rounded-2xl",
                          alert.severity === "critical"
                            ? "bg-red-100 text-[#DC2626]"
                            : alert.severity === "warning"
                              ? "bg-orange-100 text-[#EA580C]"
                              : "bg-blue-100 text-[#1D4ED8]",
                        )}
                      >
                        {alert.severity === "critical" ? (
                          <ShieldAlert className="h-4 w-4" />
                        ) : alert.severity === "warning" ? (
                          <CircleAlert className="h-4 w-4" />
                        ) : (
                          <CircleCheck className="h-4 w-4" />
                        )}
                      </span>
                      <div>
                        <p className="font-semibold text-[#0F172A]">{alert.title}</p>
                        <p className="mt-1 text-sm leading-6 text-[#475569]">{alert.description}</p>
                      </div>
                    </div>
                    <Badge className={severityMeta.badgeClassName}>
                      {alert.severity === "critical"
                        ? "Critique"
                        : alert.severity === "warning"
                          ? "Moyen"
                          : "Faible"}
                    </Badge>
                  </div>
                  <p className="mt-3 text-xs uppercase tracking-[0.18em] text-[#64748B]">
                    Detectee le {formatDateLabel(alert.date)}
                  </p>
                </div>
              );
            })}
          </div>
        </article>

        <article className="rounded-[28px] border border-[#DCE5F1] bg-[linear-gradient(135deg,#EEF2FF_0%,#DBEAFE_40%,#FFFFFF_100%)] p-6 shadow-[0_16px_40px_rgba(15,23,42,0.05)]">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-[#4F46E5] shadow-sm">
              <Sparkles className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-2xl font-semibold text-[#0F172A]">Recommandations IA</h2>
              <p className="mt-1 text-sm text-[#475569]">Actions guidantes avec impact budgetaire et metier.</p>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            {recommendations.map((recommendation) => (
              <div
                key={recommendation.id}
                className="rounded-[24px] border border-white/70 bg-white/85 p-5 shadow-[0_14px_32px_rgba(37,99,235,0.08)] backdrop-blur"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        className={
                          recommendation.priority === "Elevee"
                            ? "border-red-200 bg-red-50 text-[#DC2626]"
                            : "border-orange-200 bg-orange-50 text-[#EA580C]"
                        }
                      >
                        {recommendation.priority}
                      </Badge>
                      {recommendation.planId ? (
                        <>
                          <Badge className="border-emerald-200 bg-emerald-50 text-[#059669]">
                            Gain mensuel: {formatMadValue(recommendation.gainMad)}
                          </Badge>
                          {(() => {
                            const recommendedPlan = plans.find((plan) => plan.id === recommendation.planId);
                            return recommendedPlan ? (
                              <Badge className={getPlanActivationStatusClasses(recommendedPlan.activation_status)}>
                                {getPlanActivationStatusLabel(recommendedPlan.activation_status)}
                              </Badge>
                            ) : null;
                          })()}
                        </>
                      ) : null}
                    </div>
                    <h3 className="mt-3 text-lg font-semibold text-[#0F172A]">{recommendation.title}</h3>
                    <p className="mt-1 text-sm text-[#475569]">{recommendation.subtitle}</p>
                  </div>
                  <div className="rounded-2xl bg-[#EEF2FF] px-4 py-3 text-right">
                    <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Impact</p>
                    <p className="mt-2 max-w-[220px] text-sm font-medium text-[#1E3A8A]">
                      {recommendation.impact}
                    </p>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[#E2E8F0] pt-4">
                  <p className="text-sm text-[#64748B]">
                    Gain mensuel estime:{" "}
                    <span className="font-semibold text-[#059669]">{formatMadValue(recommendation.gainMad)}</span>
                  </p>
                  <Button
                    type="button"
                    className="h-10 rounded-xl bg-[#2563EB] px-4 text-white hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-70"
                    onClick={() => void handleApplyRecommendation(recommendation)}
                    disabled={
                      (recommendation.planId !== undefined &&
                        (plans.find((plan) => plan.id === recommendation.planId)?.activation_status === "active" ||
                          activatingRecommendationPlanId === recommendation.planId))
                    }
                  >
                    {recommendation.planId && activatingRecommendationPlanId === recommendation.planId
                      ? "Activation..."
                      : recommendation.planId
                        ? (() => {
                            const recommendedPlan = plans.find((plan) => plan.id === recommendation.planId);
                            return recommendedPlan && isPlanActive(recommendedPlan.activation_status)
                              ? getPlanActivationActionLabel(recommendedPlan.activation_status)
                              : recommendation.actionLabel;
                          })()
                        : recommendation.actionLabel}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="flex flex-wrap items-center gap-3 rounded-[28px] border border-[#DCE5F1] bg-white p-5 shadow-[0_16px_40px_rgba(15,23,42,0.05)]">
        <ActionButtonWithTooltip
          disabled={!canModify}
          tooltip={line.status === "inactive" ? "Ligne inactive : edition verrouillee." : "Ligne suspendue : reactiver avant modification."}
        >
          <Button
            type="button"
            className="h-11 rounded-xl bg-[#2563EB] px-5 text-white hover:bg-[#1D4ED8]"
            onClick={() => setIsEditDialogOpen(true)}
            disabled={!canModify}
          >
            <User className="h-4 w-4" />
            Modifier la ligne
          </Button>
        </ActionButtonWithTooltip>

        <ActionButtonWithTooltip
          disabled={!canChangePlan}
          tooltip={line.status === "inactive" ? "Ligne inactive : aucun changement de forfait possible." : "Ligne suspendue : reactiver avant de changer de forfait."}
        >
          <Button
            type="button"
            variant="outline"
            className="h-11 rounded-xl border-[#DCE5F1] text-[#475569] hover:bg-[#F8FAFC]"
            onClick={() => {
              setRecommendedPlanId(recommendations.find((item) => item.planId)?.planId ?? null);
              setIsPlanDialogOpen(true);
            }}
            disabled={!canChangePlan}
          >
            <Wallet className="h-4 w-4" />
            Changer de forfait
          </Button>
        </ActionButtonWithTooltip>

        <ActionButtonWithTooltip
          disabled={!canSuspend}
          tooltip={line.status === "inactive" ? "Ligne inactive : suspension non pertinente." : "Ligne deja suspendue."}
        >
          <Button
            type="button"
            variant="outline"
            className="h-11 rounded-xl border-red-200 text-[#DC2626] hover:bg-red-50 hover:text-[#B91C1C]"
            onClick={() => setIsSuspendDialogOpen(true)}
            disabled={!canSuspend}
          >
            <PauseCircle className="h-4 w-4" />
            Suspendre la ligne
          </Button>
        </ActionButtonWithTooltip>

        {canReactivate ? (
          <Button
            type="button"
            className="h-11 rounded-xl bg-[#16A34A] px-5 text-white hover:bg-[#15803D]"
            onClick={() => void handleReactivateLine()}
            disabled={isReactivating}
          >
            {isReactivating ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
            Reactiver la ligne
          </Button>
        ) : null}

        <div className="ml-auto flex items-center gap-2 text-sm text-[#64748B]">
          <Wifi className="h-4 w-4" />
          {statusMeta.helper}
        </div>
      </section>

      <EditLineDialog
        open={isEditDialogOpen}
        initialValues={editInitialValues}
        isSubmitting={isSavingEdit}
        onOpenChange={setIsEditDialogOpen}
        onSubmit={handleEditSubmit}
      />
      <ChangePlanDialog
        open={isPlanDialogOpen}
        plans={plans}
        currentPlanId={currentPlan?.id ?? null}
        currentMonthlyCost={currentMonthlyCost}
        recommendedPlanId={recommendedPlanId}
        isSubmitting={isChangingPlan}
        onOpenChange={(nextOpen) => {
          setIsPlanDialogOpen(nextOpen);
          if (!nextOpen) {
            setRecommendedPlanId(null);
          }
        }}
        onSubmit={handleChangePlan}
      />
      <SuspendLineDialog
        open={isSuspendDialogOpen}
        phoneNumber={line.phone_number}
        isSubmitting={isSuspending}
        onOpenChange={setIsSuspendDialogOpen}
        onConfirm={handleSuspendLine}
      />
    </div>
  );
}
