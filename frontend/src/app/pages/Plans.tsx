import {
  Activity,
  ArrowRightLeft,
  Brain,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Eye,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
  TriangleAlert,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import PlanFormModal, { type PlanFormData } from "../components/PlanFormModal";
import KPICard from "../components/KPICard";
import { Badge } from "../components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { ScrollArea } from "../components/ui/scroll-area";
import { useAuth } from "../context/AuthContext";
import { usePhoneLineStats } from "../hooks/usePhoneLineStats";
import {
  ApiError,
  customerChurnApi,
  type ApiCustomerChurnOverview,
  type ApiPlanLifecycleImpact,
  plansApi,
  type ApiPlan,
  type CreatePlanPayload,
  type UpdatePlanPayload,
} from "../lib/api";
import { buildSearchUrl } from "../lib/page-search";
import {
  getPlanActivationActionLabel,
  getPlanActivationStatusClasses,
  getPlanActivationStatusLabel,
  isPlanActive,
} from "../lib/plan-activation";
import { canApplyOperationalChanges, canManagePlans } from "../lib/roles";

type OptimizationStatus = "Optimise" | "Sous-utilise" | "Trop cher";
type TableSortKey = "efficiency" | "cost" | "lines";
type PriorityRank = 1 | 2 | 3;
type DecisionRiskLevel = "Faible" | "Moyen" | "Eleve";

interface PlanInsight {
  plan: ApiPlan;
  monthlyFleetCostMad: number;
  optimizedFleetCostMad: number;
  potentialSavingsMad: number;
  costReductionPct: number;
  efficiencyScore: number;
  aiScore: number;
  usageFitScore: number;
  costFitScore: number;
  featureScore: number;
  status: OptimizationStatus;
  benchmarkPlanId: number | null;
  benchmarkPlanName: string | null;
  linesImpacted: number;
  linkedRiskCustomers: number;
  decisionRiskLevel: DecisionRiskLevel;
  decisionRiskScore: number;
  whyRecommended: string[];
  whyNotRecommended: string[];
  fraudImpactPct: number;
  churnImpactPct: number;
  costTrendMad: number[];
  scoreTrend: number[];
  usageTarget: string;
  profileTarget: string;
  deviceTarget: string;
  coverageSharePct: number;
  valueSummary: string;
  strategySummary: string;
  isBestPlan: boolean;
  isRiskyPlan: boolean;
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

function formatCreatedAt(value: string): string {
  return new Date(value).toLocaleString("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatPrice(value: number): string {
  return `${new Intl.NumberFormat("fr-FR").format(Math.round(value))} MAD`;
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatScore(value: number): string {
  return `${Math.round(value)}/100`;
}

function formatCount(value: number, singularLabel: string, pluralLabel: string): string {
  return `${value} ${value === 1 ? singularLabel : pluralLabel}`;
}

function getOperatorBadgeClass(operatorName: string): string {
  if (operatorName === "Orange Maroc") {
    return "bg-blue-50 text-[#2D6CDF]";
  }
  if (operatorName === "Maroc Telecom") {
    return "bg-red-50 text-[#DC2626]";
  }
  return "bg-emerald-50 text-[#059669]";
}

function getStatusBadgeClasses(status: OptimizationStatus): string {
  if (status === "Optimise") {
    return "border-emerald-200 bg-emerald-50 text-[#059669]";
  }

  if (status === "Sous-utilise") {
    return "border-amber-200 bg-amber-50 text-[#D97706]";
  }

  return "border-red-200 bg-red-50 text-[#DC2626]";
}

function getDecisionRiskClasses(level: DecisionRiskLevel): string {
  if (level === "Faible") {
    return "border-emerald-200 bg-emerald-50 text-[#059669]";
  }

  if (level === "Moyen") {
    return "border-amber-200 bg-amber-50 text-[#D97706]";
  }

  return "border-red-200 bg-red-50 text-[#DC2626]";
}

function getCoverageImpactClasses(level: string): string {
  const normalizedLevel = level.trim().toLowerCase();

  if (normalizedLevel === "nul" || normalizedLevel === "faible") {
    return "border-emerald-200 bg-emerald-50 text-[#059669]";
  }
  if (normalizedLevel === "modere") {
    return "border-amber-200 bg-amber-50 text-[#D97706]";
  }
  return "border-red-200 bg-red-50 text-[#DC2626]";
}

function getCardClasses(insight: PlanInsight, isApplied: boolean): string {
  if (isApplied) {
    return "border-[#BFDBFE] bg-[linear-gradient(180deg,#FFFFFF,#EFF6FF)] shadow-[0_20px_45px_-35px_rgba(37,99,235,0.55)]";
  }

  if (insight.isBestPlan) {
    return "border-emerald-200 bg-[linear-gradient(180deg,#FFFFFF,#ECFDF5)] shadow-[0_24px_50px_-36px_rgba(5,150,105,0.45)]";
  }

  if (insight.status === "Trop cher") {
    return "border-red-200 bg-[linear-gradient(180deg,#FFFFFF,#FEF2F2)] shadow-[0_22px_48px_-38px_rgba(220,38,38,0.38)]";
  }

  if (insight.status === "Sous-utilise") {
    return "border-amber-200 bg-[linear-gradient(180deg,#FFFFFF,#FFFBEB)] shadow-[0_20px_45px_-38px_rgba(217,119,6,0.28)]";
  }

  return "border-gray-200 bg-white shadow-sm";
}

function getTableRowClasses(insight: PlanInsight, isApplied: boolean): string {
  if (isApplied) {
    return "bg-[#EFF6FF]";
  }

  if (insight.isBestPlan) {
    return "bg-[#ECFDF5]";
  }

  if (insight.status === "Trop cher") {
    return "bg-[#FEF2F2]";
  }

  if (insight.status === "Sous-utilise") {
    return "bg-[#FFFBEB]";
  }

  return "hover:bg-[#F8FAFC]";
}

function toPlanFormData(plan: ApiPlan): PlanFormData {
  return {
    name: plan.name,
    operator_name: plan.operator_name,
    monthly_price: plan.monthly_price,
    voice_quota: plan.voice_quota,
    data_quota: plan.data_quota,
    sms_quota: plan.sms_quota,
    roaming_zone: plan.roaming_zone,
    active_lines: plan.active_lines,
    description: plan.description ?? "",
  };
}

function buildCreatePayload(data: PlanFormData): CreatePlanPayload {
  return {
    name: data.name.trim(),
    operator_name: data.operator_name.trim(),
    monthly_price: data.monthly_price,
    voice_quota: data.voice_quota.trim(),
    data_quota: data.data_quota.trim(),
    sms_quota: data.sms_quota.trim(),
    roaming_zone: data.roaming_zone.trim(),
    active_lines: data.active_lines,
    description: data.description.trim() || null,
  };
}

function buildUpdatePayload(plan: ApiPlan, data: PlanFormData): UpdatePlanPayload {
  const payload: UpdatePlanPayload = {};
  const nextDescription = data.description.trim() || null;

  if (data.name.trim() !== plan.name) {
    payload.name = data.name.trim();
  }
  if (data.operator_name.trim() !== plan.operator_name) {
    payload.operator_name = data.operator_name.trim();
  }
  if (data.monthly_price !== plan.monthly_price) {
    payload.monthly_price = data.monthly_price;
  }
  if (data.voice_quota.trim() !== plan.voice_quota) {
    payload.voice_quota = data.voice_quota.trim();
  }
  if (data.data_quota.trim() !== plan.data_quota) {
    payload.data_quota = data.data_quota.trim();
  }
  if (data.sms_quota.trim() !== plan.sms_quota) {
    payload.sms_quota = data.sms_quota.trim();
  }
  if (data.roaming_zone.trim() !== plan.roaming_zone) {
    payload.roaming_zone = data.roaming_zone.trim();
  }
  if (data.active_lines !== plan.active_lines) {
    payload.active_lines = data.active_lines;
  }
  if (nextDescription !== (plan.description ?? null)) {
    payload.description = nextDescription;
  }

  return payload;
}

function parseFirstNumber(value: string): number {
  const match = value.toLowerCase().replace(",", ".").match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : 0;
}

function parseDataQuotaGb(value: string): number {
  const normalizedValue = value.toLowerCase();

  if (normalizedValue.includes("illim")) {
    return 150;
  }

  const numericValue = parseFirstNumber(value);
  if (normalizedValue.includes("mo")) {
    return numericValue / 1024;
  }

  return numericValue;
}

function parseVoiceQuotaHours(value: string): number {
  const normalizedValue = value.toLowerCase();

  if (normalizedValue.includes("illim")) {
    return 20;
  }

  const numericValue = parseFirstNumber(value);
  if (normalizedValue.includes("min")) {
    return numericValue / 60;
  }

  return numericValue;
}

function parseSmsQuota(value: string): number {
  const normalizedValue = value.toLowerCase();

  if (normalizedValue.includes("illim")) {
    return 5000;
  }

  return parseFirstNumber(value);
}

function getRoamingWeight(value: string): number {
  const normalizedValue = value.toLowerCase();

  if (normalizedValue.includes("monde")) {
    return 4;
  }
  if (normalizedValue.includes("intern")) {
    return 3;
  }
  if (normalizedValue.includes("maghreb")) {
    return 2;
  }
  if (normalizedValue.includes("aucun")) {
    return 0.5;
  }

  return 1;
}

function getMedian(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sortedValues = [...values].sort((left, right) => left - right);
  const middleIndex = Math.floor(sortedValues.length / 2);

  if (sortedValues.length % 2 === 0) {
    return (sortedValues[middleIndex - 1] + sortedValues[middleIndex]) / 2;
  }

  return sortedValues[middleIndex];
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(value, 100));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function getLatestActivatedPlanId(items: ApiPlan[]): number | null {
  const latestActivatedPlan = [...items]
    .filter((plan) => plan.activation_status === "active")
    .sort((left, right) => {
      const leftTimestamp = left.activated_at ? new Date(left.activated_at).getTime() : 0;
      const rightTimestamp = right.activated_at ? new Date(right.activated_at).getTime() : 0;
      return rightTimestamp - leftTimestamp;
    })[0];

  return latestActivatedPlan?.id ?? null;
}

function buildTrendSeries(currentValue: number, targetValue: number): number[] {
  const delta = targetValue - currentValue;

  return [
    currentValue,
    currentValue + delta * 0.28,
    currentValue + delta * 0.64,
    targetValue,
  ].map((value) => Math.max(Math.round(value), 0));
}

interface MiniTrendProps {
  bars: number[];
  colorClass: string;
  label: string;
  valueFormatter?: (value: number) => string;
}

function MiniTrend({ bars, colorClass, label, valueFormatter }: MiniTrendProps) {
  const maxValue = Math.max(...bars, 1);

  return (
    <div className="rounded-xl border border-white/80 bg-white/80 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#64748B]">{label}</p>
        <span className="text-xs font-medium text-[#64748B]">
          {valueFormatter ? valueFormatter(bars[bars.length - 1] ?? 0) : bars[bars.length - 1]}
        </span>
      </div>
      <div className="flex h-16 items-end gap-2">
        {bars.map((bar, index) => (
          <div key={`${label}-${index}`} className="flex flex-1 flex-col items-center gap-1">
            <div className="flex h-12 w-full items-end rounded-md bg-[#F1F5F9] p-1">
              <div
                className={`w-full rounded-sm ${colorClass}`}
                style={{ height: `${Math.max((bar / maxValue) * 100, 16)}%` }}
              />
            </div>
            <span className="text-[10px] text-[#94A3B8]">T{index + 1}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function getUsageTarget(plan: ApiPlan, averageDataUsageGb: number | null): string {
  const dataGb = parseDataQuotaGb(plan.data_quota);
  const voiceHours = parseVoiceQuotaHours(plan.voice_quota);
  const roamingWeight = getRoamingWeight(plan.roaming_zone);
  const usageBaseline = averageDataUsageGb ?? 18;

  if (roamingWeight >= 3 && dataGb >= Math.max(usageBaseline * 1.5, 40)) {
    return "Mobilite internationale et usage data intensif";
  }
  if (dataGb >= Math.max(usageBaseline * 1.35, 45)) {
    return "Equipes terrain et collaborateurs tres connectes";
  }
  if (voiceHours >= 8) {
    return "Front-office, relation client et usage voix soutenu";
  }

  return "Profils standards et lignes maitrisees";
}

function getProfileTarget(plan: ApiPlan): string {
  const dataGb = parseDataQuotaGb(plan.data_quota);
  const voiceHours = parseVoiceQuotaHours(plan.voice_quota);
  const roamingWeight = getRoamingWeight(plan.roaming_zone);

  if (roamingWeight >= 3) {
    return "Direction, commerce et profils nomades";
  }
  if (dataGb >= 50) {
    return "Managers, support terrain et profils premium";
  }
  if (voiceHours >= 8) {
    return "Service client et equipes a fort trafic voix";
  }

  return "Back-office et utilisateurs standard";
}

function getDeviceTarget(plan: ApiPlan): string {
  const dataGb = parseDataQuotaGb(plan.data_quota);

  if (dataGb >= 80) {
    return "Smartphones premium et lignes a forte exposition data";
  }
  if (dataGb >= 40) {
    return "Parc mobile polyvalent et postes terrain";
  }

  return "Terminaux standards et lignes generalistes";
}

function getFallbackSavings(plan: ApiPlan, medianPrice: number): number {
  const priceGap = Math.max(plan.monthly_price - medianPrice, 0);
  return priceGap * 0.35 * plan.active_lines;
}

export default function Plans() {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = canManagePlans(user);
  const canApplyChanges = canApplyOperationalChanges(user);
  const {
    totalLines,
    averageDataUsageGb,
    criticalAiAlerts,
    estimatedMonthlySavingsMad,
    lineStatsError,
    refresh: refreshLineStats,
  } = usePhoneLineStats();
  const [plans, setPlans] = useState<ApiPlan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [editingPlan, setEditingPlan] = useState<ApiPlan | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [detailPlan, setDetailPlan] = useState<ApiPlan | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [customerOverview, setCustomerOverview] = useState<ApiCustomerChurnOverview | null>(null);
  const [tableSort, setTableSort] = useState<TableSortKey>("efficiency");
  const [simulationPlanId, setSimulationPlanId] = useState<number | null>(null);
  const [appliedPlanId, setAppliedPlanId] = useState<number | null>(null);
  const [isGlobalSimulationOpen, setIsGlobalSimulationOpen] = useState(false);
  const [isGlobalSimulationRunning, setIsGlobalSimulationRunning] = useState(false);
  const [isPlanSimulationRunningId, setIsPlanSimulationRunningId] = useState<number | null>(null);
  const [isApplyingPlanId, setIsApplyingPlanId] = useState<number | null>(null);
  const [comparisonPlanId, setComparisonPlanId] = useState<number | null>(null);
  const [expandedPlanId, setExpandedPlanId] = useState<number | null>(null);
  const [isAutomationConfirmOpen, setIsAutomationConfirmOpen] = useState(false);
  const [isAutomationApplying, setIsAutomationApplying] = useState(false);
  const [isAutomationApplied, setIsAutomationApplied] = useState(false);
  const [isAutomationDetailsOpen, setIsAutomationDetailsOpen] = useState(false);
  const [planToDeactivate, setPlanToDeactivate] = useState<ApiPlan | null>(null);
  const [deactivationImpact, setDeactivationImpact] = useState<ApiPlanLifecycleImpact | null>(null);
  const [deactivationError, setDeactivationError] = useState<string | null>(null);
  const [isDeactivationImpactLoading, setIsDeactivationImpactLoading] = useState(false);
  const [isDeactivatingPlanId, setIsDeactivatingPlanId] = useState<number | null>(null);
  const [planToReplace, setPlanToReplace] = useState<ApiPlan | null>(null);
  const [replacementImpact, setReplacementImpact] = useState<ApiPlanLifecycleImpact | null>(null);
  const [replacementError, setReplacementError] = useState<string | null>(null);
  const [selectedReplacementPlanId, setSelectedReplacementPlanId] = useState<number | null>(null);
  const [isReplacementImpactLoading, setIsReplacementImpactLoading] = useState(false);
  const [isReplacingPlanId, setIsReplacingPlanId] = useState<number | null>(null);
  const [fadingPlanId, setFadingPlanId] = useState<number | null>(null);

  async function loadPlans(): Promise<void> {
    if (!token) {
      setPlans([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const apiPlans = await plansApi.list(token);
      setPlans(apiPlans);
    } catch (error) {
      setErrorMessage(normalizeError(error, "Impossible de charger les forfaits."));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadPlans();
  }, [token]);

  useEffect(() => {
    const appliedPlan =
      appliedPlanId !== null ? plans.find((plan) => plan.id === appliedPlanId) ?? null : null;

    if (appliedPlan && appliedPlan.activation_status === "active") {
      return;
    }

    const latestActivatedPlanId = getLatestActivatedPlanId(plans);
    if (latestActivatedPlanId !== appliedPlanId) {
      setAppliedPlanId(latestActivatedPlanId);
    }
  }, [appliedPlanId, plans]);

  async function loadCustomerOverview(): Promise<void> {
    if (!token) {
      setCustomerOverview(null);
      return;
    }

    try {
      const overview = await customerChurnApi.overview(token);
      setCustomerOverview(overview);
    } catch {
      setCustomerOverview(null);
    }
  }

  useEffect(() => {
    void loadCustomerOverview();
  }, [token]);

  async function handleRefresh(): Promise<void> {
    setIsRefreshing(true);

    try {
      await Promise.all([loadPlans(), refreshLineStats(), loadCustomerOverview()]);
    } finally {
      setIsRefreshing(false);
    }
  }

  function closeFormModal(): void {
    setIsFormOpen(false);
    setEditingPlan(null);
    setFormError(null);
    setIsSubmitting(false);
  }

  function openCreateModal(): void {
    setFormMode("create");
    setEditingPlan(null);
    setFormError(null);
    setIsFormOpen(true);
  }

  function openEditModal(plan: ApiPlan): void {
    setFormMode("edit");
    setEditingPlan(plan);
    setFormError(null);
    setIsFormOpen(true);
  }

  function closeDetailModal(): void {
    setDetailPlan(null);
    setDetailError(null);
    setIsDetailLoading(false);
  }

  function openSimulationModal(planId: number): void {
    setSimulationPlanId(planId);
  }

  function closeSimulationModal(): void {
    setSimulationPlanId(null);
  }

  function closeGlobalSimulationModal(): void {
    setIsGlobalSimulationOpen(false);
  }

  function openComparisonModal(planId: number): void {
    setComparisonPlanId(planId);
  }

  function closeComparisonModal(): void {
    setComparisonPlanId(null);
  }

  function openAutomationConfirmModal(): void {
    if (!canApplyChanges) {
      return;
    }

    setIsAutomationConfirmOpen(true);
  }

  function closeAutomationConfirmModal(): void {
    setIsAutomationConfirmOpen(false);
  }

  function closeDeactivateModal(): void {
    setPlanToDeactivate(null);
    setDeactivationImpact(null);
    setDeactivationError(null);
    setIsDeactivationImpactLoading(false);
  }

  function closeReplaceModal(): void {
    setPlanToReplace(null);
    setReplacementImpact(null);
    setReplacementError(null);
    setSelectedReplacementPlanId(null);
    setIsReplacementImpactLoading(false);
  }

  function updatePlanInState(updatedPlan: ApiPlan): void {
    setPlans((currentPlans) =>
      currentPlans.map((plan) => (plan.id === updatedPlan.id ? updatedPlan : plan)),
    );
  }

  function updateMultiplePlansInState(updatedPlans: ApiPlan[]): void {
    setPlans((currentPlans) =>
      currentPlans.map((plan) => updatedPlans.find((updatedPlan) => updatedPlan.id === plan.id) ?? plan),
    );
  }

  async function loadLifecycleImpact(planId: number): Promise<ApiPlanLifecycleImpact> {
    if (!token) {
      throw new Error("Session expiree. Reconnectez-vous.");
    }

    return plansApi.lifecycleImpact(token, planId);
  }

  async function openDeactivateModal(plan: ApiPlan): Promise<void> {
    setPlanToDeactivate(plan);
    setDeactivationImpact(null);
    setDeactivationError(null);
    setIsDeactivationImpactLoading(true);

    try {
      const impact = await loadLifecycleImpact(plan.id);
      setDeactivationImpact(impact);
    } catch (error) {
      setDeactivationError(normalizeError(error, "Impossible de charger l'impact de desactivation."));
    } finally {
      setIsDeactivationImpactLoading(false);
    }
  }

  async function openReplaceModal(plan: ApiPlan): Promise<void> {
    setPlanToReplace(plan);
    setReplacementImpact(null);
    setReplacementError(null);
    setSelectedReplacementPlanId(null);
    setIsReplacementImpactLoading(true);

    try {
      const impact = await loadLifecycleImpact(plan.id);
      setReplacementImpact(impact);
      if (impact.recommended_replacement_plan_id !== null) {
        setSelectedReplacementPlanId(impact.recommended_replacement_plan_id);
      }
    } catch (error) {
      setReplacementError(normalizeError(error, "Impossible de charger les options de remplacement."));
    } finally {
      setIsReplacementImpactLoading(false);
    }
  }

  function handleViewAssociatedLines(plan: ApiPlan): void {
    navigate(buildSearchUrl("/lignes", "", plan.name));
    toast("Lignes associees ciblees", {
      description: `La page Lignes a ete filtree sur le forfait ${plan.name}.`,
    });
  }

  async function handleApplyPlan(planId: number): Promise<void> {
    if (!canApplyChanges || !token) {
      return;
    }

    const targetedPlan = plans.find((plan) => plan.id === planId);
    if (!targetedPlan) {
      return;
    }
    if (isPlanActive(targetedPlan.activation_status)) {
      return;
    }

    setIsApplyingPlanId(planId);
    try {
      const response = await plansApi.activatePlan(token, { plan_id: planId });
      updatePlanInState(response.plan);
      setAppliedPlanId(planId);
      toast.success("Forfait active avec succes", {
        description: `${targetedPlan.name} est maintenant marque comme actif dans la plateforme.`,
      });
    } catch (error) {
      toast.error("Activation impossible", {
        description: normalizeError(error, "Le forfait n'a pas pu etre active."),
      });
    } finally {
      setIsApplyingPlanId(null);
    }
  }

  async function handleDeactivatePlan(): Promise<void> {
    if (!canApplyChanges || !token || !planToDeactivate) {
      return;
    }

    setIsDeactivatingPlanId(planToDeactivate.id);
    setFadingPlanId(planToDeactivate.id);
    try {
      const response = await plansApi.deactivate(token, planToDeactivate.id);
      await wait(180);
      updatePlanInState(response.plan);
      closeDeactivateModal();
      toast.success("Forfait desactive avec succes", {
        description:
          response.impact.impacted_lines > 0
            ? `${formatCount(response.impact.impacted_lines, "ligne impactee", "lignes impactees")} a suivre. ${response.impact.coverage_impact_summary}`
            : "Le forfait est maintenant archive et peut etre reactive si besoin.",
      });
    } catch (error) {
      toast.error("Desactivation impossible", {
        description: normalizeError(error, "Le forfait n'a pas pu etre desactive."),
      });
    } finally {
      setIsDeactivatingPlanId(null);
      window.setTimeout(() => setFadingPlanId((currentId) => (currentId === planToDeactivate.id ? null : currentId)), 260);
    }
  }

  async function handleReplacePlan(): Promise<void> {
    if (!canApplyChanges || !token || !planToReplace || selectedReplacementPlanId === null) {
      return;
    }

    setIsReplacingPlanId(planToReplace.id);
    setFadingPlanId(planToReplace.id);
    try {
      const response = await plansApi.replace(token, planToReplace.id, {
        replacement_plan_id: selectedReplacementPlanId,
      });
      await wait(180);
      updateMultiplePlansInState([response.previous_plan, response.replacement_plan]);
      setAppliedPlanId(response.replacement_plan.id);
      closeReplaceModal();
      toast.success("Forfait remplace avec succes", {
        description: `${response.replacement_plan.name} prend le relais. ${formatCount(response.impact.impacted_lines, "ligne concernee", "lignes concernees")} et ${formatPrice(Math.max((response.previous_plan.monthly_price - response.replacement_plan.monthly_price) * response.impact.impacted_lines, 0))} de gain potentiel.`,
      });
    } catch (error) {
      toast.error("Remplacement impossible", {
        description: normalizeError(error, "Le forfait n'a pas pu etre remplace."),
      });
    } finally {
      setIsReplacingPlanId(null);
      window.setTimeout(() => setFadingPlanId((currentId) => (currentId === planToReplace.id ? null : currentId)), 260);
    }
  }

  async function handlePlanSimulation(planId: number): Promise<void> {
    const targetedPlan = plans.find((plan) => plan.id === planId);

    setIsPlanSimulationRunningId(planId);
    await wait(350);
    setSimulationPlanId(planId);
    setIsPlanSimulationRunningId(null);

    if (targetedPlan) {
      toast("Simulation IA prete", {
        description: `Le scenario detaille de ${targetedPlan.name} est disponible.`,
      });
    }
  }

  async function handleGlobalSimulation(): Promise<void> {
    setIsGlobalSimulationRunning(true);
    await wait(450);
    setIsGlobalSimulationOpen(true);
    setIsGlobalSimulationRunning(false);
    toast.success("Simulation globale calculee", {
      description: `Gain potentiel ${formatPrice(derivedPotentialSavingsMad)} sur ${impactedLinesForOptimization} lignes.`,
    });
  }

  async function handleApplyAllRecommendations(): Promise<void> {
    if (!canApplyChanges) {
      return;
    }

    setIsAutomationApplying(true);
    await wait(700);
    setIsAutomationApplied(true);
    setIsAutomationApplying(false);
    setIsAutomationConfirmOpen(false);

    if (priorityPlans[0]?.insight.plan.id) {
      setAppliedPlanId(priorityPlans[0].insight.plan.id);
    }

    toast.success("Recommandations IA appliquées", {
      description: `${automationTargets.length} forfaits ajustés sur ${automationLines} lignes, gain estimé : ${formatPrice(automationGainMad)}.`,
      className: "max-w-[30rem] rounded-3xl border border-slate-200 bg-white p-3 shadow-lg",
      descriptionClassName: "mt-1 text-sm leading-6 text-slate-700",
      duration: 7000,
    });
  }

  async function handleActivateAllRecommendations(): Promise<void> {
    if (!canApplyChanges || !token) {
      return;
    }

    setIsAutomationApplying(true);
    try {
      const targetsToActivate = automationTargets.filter(
        (insight) => !isPlanActive(insight.plan.activation_status),
      );
      const activationResponses = await Promise.all(
        targetsToActivate.map((insight) =>
          plansApi.activatePlan(token, { plan_id: insight.plan.id }),
        ),
      );

      activationResponses.forEach((response) => updatePlanInState(response.plan));
      setIsAutomationApplied(true);
      setIsAutomationConfirmOpen(false);

      const latestActivationResponse =
        activationResponses.length > 0 ? activationResponses[activationResponses.length - 1] : null;
      const latestAppliedPlanId =
        latestActivationResponse?.plan.id ?? priorityPlans[0]?.insight.plan.id ?? null;
      if (latestAppliedPlanId !== null) {
        setAppliedPlanId(latestAppliedPlanId);
      }

      toast.success("Recommandations IA appliquees", {
        description: `${automationTargets.length} forfaits ajustes sur ${automationLines} lignes, gain estime : ${formatPrice(automationGainMad)}.`,
        className: "max-w-[30rem] rounded-3xl border border-slate-200 bg-white p-3 shadow-lg",
        descriptionClassName: "mt-1 text-sm leading-6 text-slate-700",
        duration: 7000,
      });
    } catch (error) {
      toast.error("Activation impossible", {
        description: normalizeError(error, "Les recommandations n'ont pas pu etre appliquees."),
      });
    } finally {
      setIsAutomationApplying(false);
    }
  }

  async function handleSubmitPlan(data: PlanFormData): Promise<void> {
    if (!token) {
      setFormError("Session expiree. Reconnectez-vous.");
      return;
    }

    setIsSubmitting(true);
    setFormError(null);

    try {
      if (formMode === "create") {
        const createdPlan = await plansApi.create(token, buildCreatePayload(data));
        setPlans((previousPlans) => [createdPlan, ...previousPlans]);
      } else if (editingPlan) {
        const payload = buildUpdatePayload(editingPlan, data);

        if (Object.keys(payload).length > 0) {
          const updatedPlan = await plansApi.update(token, editingPlan.id, payload);
          setPlans((previousPlans) =>
            previousPlans.map((plan) => (plan.id === updatedPlan.id ? updatedPlan : plan)),
          );
          setDetailPlan((currentPlan) => (currentPlan?.id === updatedPlan.id ? updatedPlan : currentPlan));
        }
      }

      closeFormModal();
    } catch (error) {
      setFormError(normalizeError(error, "Impossible d'enregistrer ce forfait."));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function openDetailModal(planId: number): Promise<void> {
    if (!token) {
      setDetailError("Session expiree. Reconnectez-vous.");
      return;
    }

    setDetailPlan(null);
    setDetailError(null);
    setIsDetailLoading(true);

    try {
      const fetchedPlan = await plansApi.get(token, planId);
      setDetailPlan(fetchedPlan);
    } catch (error) {
      setDetailError(normalizeError(error, "Impossible de charger ce forfait."));
    } finally {
      setIsDetailLoading(false);
    }
  }

  async function handleDeletePlan(plan: ApiPlan): Promise<void> {
    if (!token) {
      setErrorMessage("Session expiree. Reconnectez-vous.");
      return;
    }

    const confirmed = window.confirm(`Supprimer le forfait ${plan.name} ?`);
    if (!confirmed) {
      return;
    }

    try {
      await plansApi.remove(token, plan.id);
      setPlans((previousPlans) => previousPlans.filter((currentPlan) => currentPlan.id !== plan.id));
      closeDetailModal();
    } catch (error) {
      setErrorMessage(normalizeError(error, "Suppression impossible pour le moment."));
    }
  }

  const planInsights = useMemo<PlanInsight[]>(() => {
    if (plans.length === 0) {
      return [];
    }

    const metricRows = plans.map((plan) => ({
      plan,
      dataGb: parseDataQuotaGb(plan.data_quota),
      voiceHours: parseVoiceQuotaHours(plan.voice_quota),
      smsQuota: parseSmsQuota(plan.sms_quota),
      roamingWeight: getRoamingWeight(plan.roaming_zone),
      monthlyFleetCostMad: plan.monthly_price * plan.active_lines,
    }));

    const maxDataGb = Math.max(...metricRows.map((row) => row.dataGb), 1);
    const maxVoiceHours = Math.max(...metricRows.map((row) => row.voiceHours), 1);
    const maxSmsQuota = Math.max(...metricRows.map((row) => row.smsQuota), 1);
    const maxRoamingWeight = Math.max(...metricRows.map((row) => row.roamingWeight), 1);
    const maxActiveLines = Math.max(...plans.map((plan) => plan.active_lines), 1);
    const maxMonthlyPrice = Math.max(...plans.map((plan) => plan.monthly_price), 1);
    const medianMonthlyPrice = getMedian(plans.map((plan) => plan.monthly_price));
    const medianActiveLines = getMedian(plans.map((plan) => plan.active_lines));
    const totalPlanLines = plans.reduce((total, plan) => total + plan.active_lines, 0);
    const maxFleetCostMad = Math.max(...metricRows.map((row) => row.monthlyFleetCostMad), 1);
    const usageReferenceGb = averageDataUsageGb ?? (getMedian(metricRows.map((row) => row.dataGb)) || 18);
    const highRiskCustomers = customerOverview?.kpis.high_risk_customers ?? 0;

    const rowsWithScore = metricRows.map((row) => {
      const featureScore =
        (row.dataGb / maxDataGb) * 48 +
        (row.voiceHours / maxVoiceHours) * 18 +
        (row.smsQuota / maxSmsQuota) * 8 +
        (row.roamingWeight / maxRoamingWeight) * 26;
      const efficiencyRaw = featureScore / Math.max(row.plan.monthly_price, 1);
      const unitCostScore = clampPercent(
        100 -
          Math.max((row.plan.monthly_price - medianMonthlyPrice) / Math.max(medianMonthlyPrice, 1), 0) * 52,
      );
      const fleetCostScore = clampPercent(
        100 -
          (row.monthlyFleetCostMad / maxFleetCostMad) * 22 +
          (row.plan.active_lines / maxActiveLines) * 8,
      );
      const costFitScore = clampPercent(unitCostScore * 0.74 + fleetCostScore * 0.26);
      const usageTargetGb = row.roamingWeight >= 3 ? usageReferenceGb * 1.35 : usageReferenceGb * 1.12;
      const usageGapRatio = Math.abs(row.dataGb - usageTargetGb) / Math.max(usageTargetGb, 1);
      const usageFitScore = clampPercent(
        100 -
          usageGapRatio * 52 +
          Math.min(row.voiceHours / maxVoiceHours, 1) * 10 +
          Math.min(row.roamingWeight / maxRoamingWeight, 1) * 8,
      );
      const riskExposureWeight =
        (row.plan.active_lines / maxActiveLines) * 0.44 +
        (row.dataGb / maxDataGb) * 0.22 +
        (row.roamingWeight / maxRoamingWeight) * 0.14 +
        (row.plan.monthly_price / maxMonthlyPrice) * 0.2;

      return {
        ...row,
        featureScore,
        efficiencyRaw,
        costFitScore,
        usageFitScore,
        riskExposureWeight,
      };
    });

    const maxEfficiencyRaw = Math.max(...rowsWithScore.map((row) => row.efficiencyRaw), 0.001);
    const totalRiskWeight = rowsWithScore.reduce((total, row) => total + row.riskExposureWeight, 0.001);
    const recommendationScores = rowsWithScore.map((row) => {
      const efficiencyScore = (row.efficiencyRaw / maxEfficiencyRaw) * 100;
      const coverageScore = (row.plan.active_lines / maxActiveLines) * 100;
      return {
        id: row.plan.id,
        recommendationScore: efficiencyScore * 0.72 + coverageScore * 0.28,
      };
    });
    const bestPlanId =
      recommendationScores.sort((left, right) => right.recommendationScore - left.recommendationScore)[0]?.id ?? null;

    return rowsWithScore.map((row) => {
      const efficiencyScore = clampPercent((row.efficiencyRaw / maxEfficiencyRaw) * 100);
      const aiScore = Math.round(
        clampPercent(efficiencyScore * 0.5 + row.usageFitScore * 0.24 + row.costFitScore * 0.26),
      );
      const oversizedPlan =
        averageDataUsageGb !== null &&
        row.dataGb >= Math.max(averageDataUsageGb * 2.3, averageDataUsageGb + 20);
      const benchmarkThreshold = oversizedPlan ? 0.64 : 0.82;
      const benchmarkPlan =
        rowsWithScore
          .filter(
            (candidate) =>
              candidate.plan.id !== row.plan.id &&
              candidate.plan.monthly_price < row.plan.monthly_price &&
              candidate.featureScore >= row.featureScore * benchmarkThreshold,
          )
          .sort(
            (left, right) =>
              left.plan.monthly_price - right.plan.monthly_price || right.featureScore - left.featureScore,
          )[0] ?? null;

      const benchmarkSavingsMad = benchmarkPlan
        ? (row.plan.monthly_price - benchmarkPlan.plan.monthly_price) * row.plan.active_lines
        : 0;
      const fallbackSavingsMad =
        benchmarkSavingsMad === 0 && row.plan.monthly_price > medianMonthlyPrice
          ? getFallbackSavings(row.plan, medianMonthlyPrice)
          : 0;
      const potentialSavingsMad = Math.round(Math.max(benchmarkSavingsMad, fallbackSavingsMad));
      const costReductionPct =
        row.monthlyFleetCostMad > 0 ? clampPercent((potentialSavingsMad / row.monthlyFleetCostMad) * 100) : 0;

      let status: OptimizationStatus = "Optimise";
      if (costReductionPct >= 12 || (row.plan.monthly_price > medianMonthlyPrice * 1.2 && efficiencyScore < 55)) {
        status = "Trop cher";
      } else if (oversizedPlan && row.plan.active_lines <= Math.max(medianActiveLines, 1) * 1.1) {
        status = "Sous-utilise";
      }

      const optimizedFleetCostMad = Math.max(row.monthlyFleetCostMad - potentialSavingsMad, 0);
      const linkedRiskCustomers =
        highRiskCustomers > 0 ? Math.round((highRiskCustomers * row.riskExposureWeight) / totalRiskWeight) : 0;
      const benchmarkFeatureGapPct = benchmarkPlan
        ? clampPercent(
            Math.max((row.featureScore - benchmarkPlan.featureScore) / Math.max(row.featureScore, 1), 0) * 100,
          )
        : 0;
      const rawDecisionRiskScore = benchmarkPlan
        ? benchmarkFeatureGapPct * 0.46 +
          (100 - aiScore) * 0.28 +
          (row.plan.active_lines / maxActiveLines) * 18 +
          (oversizedPlan ? 12 : 6)
        : (100 - aiScore) * 0.22 + (row.plan.active_lines / maxActiveLines) * 12 + 8;
      const decisionRiskScore =
        status === "Optimise" ? clampPercent(Math.min(rawDecisionRiskScore, 34)) : clampPercent(rawDecisionRiskScore);
      const decisionRiskLevel: DecisionRiskLevel =
        decisionRiskScore >= 66 ? "Eleve" : decisionRiskScore >= 38 ? "Moyen" : "Faible";
      const fraudImpactPct = clampPercent(
        (row.roamingWeight / maxRoamingWeight) * 11 +
          costReductionPct * 0.34 +
          ((100 - aiScore) / 100) * 8 +
          (row.plan.monthly_price / maxMonthlyPrice) * 6,
      );
      const churnImpactPct = clampPercent(
        (highRiskCustomers > 0 ? (linkedRiskCustomers / highRiskCustomers) * 100 * 0.45 : 0) +
          costReductionPct * 0.26 +
          Math.max(row.dataGb - usageReferenceGb, 0) / Math.max(usageReferenceGb, 1) * 10 +
          (row.plan.active_lines / maxActiveLines) * 7,
      );
      const scoreTarget =
        status === "Optimise"
          ? clampPercent(aiScore + 4)
          : clampPercent(aiScore + Math.max(8, Math.round(costReductionPct / 3)));
      const costTrendMad = buildTrendSeries(row.monthlyFleetCostMad, optimizedFleetCostMad);
      const scoreTrend = buildTrendSeries(Math.max(aiScore - (status === "Optimise" ? 6 : 12), 0), scoreTarget);
      const whyRecommended = [
        `Score IA ${formatScore(aiScore)} avec un ratio cout / usage adapte a ${getUsageTarget(row.plan, averageDataUsageGb).toLowerCase()}.`,
        potentialSavingsMad > 0
          ? `Potentiel de gain ${formatPrice(potentialSavingsMad)} sur ${row.plan.active_lines} lignes sans perte majeure de couverture.`
          : `Stabilise ${row.plan.active_lines} lignes avec une efficacite de ${formatPercent(efficiencyScore)}.`,
        row.roamingWeight >= 3
          ? "Couverture roaming adaptee aux profils nomades et aux usages a forte mobilite."
          : row.dataGb >= usageReferenceGb
            ? "Volume data coherent avec l'usage observe sur la flotte."
            : "Structure tarifaire mieux alignee sur les profils standards et les besoins maitrises.",
      ];
      const whyNotRecommended = benchmarkPlan
        ? [
            `${benchmarkPlan.plan.name} coute ${formatPrice(Math.max(row.plan.monthly_price - benchmarkPlan.plan.monthly_price, 0))} de moins par ligne.`,
            benchmarkFeatureGapPct <= 10
              ? "L'ecart de service avec l'alternative reste limite pour la plupart des lignes concernees."
              : `Le changement reduit la couverture fonctionnelle d'environ ${formatPercent(benchmarkFeatureGapPct)}.`,
            status === "Trop cher"
              ? "Le cout unitaire actuel depasse le median du portefeuille pour une valeur proche."
              : "Le service actuel depasse les usages reels et cree une marge budgetaire peu exploitee.",
          ]
        : [
            "Les autres forfaits affichent soit un score IA plus faible, soit un cout superieur sur le meme segment.",
            "Le gain budgetaire additionnel serait limite par rapport au niveau de service deja atteint.",
            "La couverture data, voix et roaming reste la plus stable pour ce profil d'usage.",
          ];

      return {
        plan: row.plan,
        monthlyFleetCostMad: row.monthlyFleetCostMad,
        optimizedFleetCostMad,
        potentialSavingsMad,
        costReductionPct,
        efficiencyScore,
        aiScore,
        usageFitScore: row.usageFitScore,
        costFitScore: row.costFitScore,
        featureScore: clampPercent(row.featureScore),
        status,
        benchmarkPlanId: benchmarkPlan?.plan.id ?? null,
        benchmarkPlanName: benchmarkPlan?.plan.name ?? null,
        linesImpacted: row.plan.active_lines,
        linkedRiskCustomers,
        decisionRiskLevel,
        decisionRiskScore,
        whyRecommended,
        whyNotRecommended,
        fraudImpactPct,
        churnImpactPct,
        costTrendMad,
        scoreTrend,
        usageTarget: getUsageTarget(row.plan, averageDataUsageGb),
        profileTarget: getProfileTarget(row.plan),
        deviceTarget: getDeviceTarget(row.plan),
        coverageSharePct: totalPlanLines > 0 ? clampPercent((row.plan.active_lines / totalPlanLines) * 100) : 0,
        valueSummary:
          status === "Optimise"
            ? "Forfait pertinent pour le parc actuel et la structure de cout observee."
            : status === "Sous-utilise"
              ? "Le niveau de service depasse les usages moyens observes sur la flotte."
              : "Le cout unitaire est eleve au regard des alternatives et du niveau de service.",
        strategySummary:
          status === "Optimise"
            ? "Maintenir ce plan comme option de reference pour les lignes comparables."
            : status === "Sous-utilise"
              ? "Redimensionner ou reaffecter les lignes vers un plan plus proportionne."
              : "Arbitrer ce plan en priorite pour reduire le budget mensuel sans perte majeure de couverture.",
        isBestPlan: row.plan.id === bestPlanId,
        isRiskyPlan: status === "Trop cher",
      };
    });
  }, [averageDataUsageGb, customerOverview?.kpis.high_risk_customers, plans]);

  const totalFleetCostMad = useMemo(
    () => planInsights.reduce((total, insight) => total + insight.monthlyFleetCostMad, 0),
    [planInsights],
  );
  const derivedPotentialSavingsMad = useMemo(
    () => planInsights.reduce((total, insight) => total + insight.potentialSavingsMad, 0),
    [planInsights],
  );
  const optimizedFleetCostMad = Math.max(totalFleetCostMad - derivedPotentialSavingsMad, 0);
  const totalPlanLines = useMemo(
    () => planInsights.reduce((total, insight) => total + insight.plan.active_lines, 0),
    [planInsights],
  );
  const averageAiScore = useMemo(
    () =>
      planInsights.length > 0
        ? Math.round(planInsights.reduce((total, insight) => total + insight.aiScore, 0) / planInsights.length)
        : 0,
    [planInsights],
  );
  const impactedLinesForOptimization = useMemo(
    () =>
      planInsights
        .filter((insight) => insight.potentialSavingsMad > 0 || insight.status !== "Optimise")
        .reduce((total, insight) => total + insight.linesImpacted, 0),
    [planInsights],
  );
  const connectedLines = totalLines ?? totalPlanLines;
  const activeScenario = planInsights.find((insight) => insight.plan.id === appliedPlanId) ?? null;
  const simulationInsight = planInsights.find((insight) => insight.plan.id === simulationPlanId) ?? null;
  const detailInsight = detailPlan ? planInsights.find((insight) => insight.plan.id === detailPlan.id) ?? null : null;
  const priorityPlans = useMemo(() => {
    const maxSavings = Math.max(...planInsights.map((insight) => insight.potentialSavingsMad), 1);
    const maxRiskCustomers = Math.max(...planInsights.map((insight) => insight.linkedRiskCustomers), 1);
    const maxLines = Math.max(...planInsights.map((insight) => insight.linesImpacted), 1);

    return [...planInsights]
      .map((insight) => ({
        insight,
        priorityScore:
          (insight.isRiskyPlan ? 28 : 0) +
          (insight.potentialSavingsMad / maxSavings) * 36 +
          (insight.linkedRiskCustomers / maxRiskCustomers) * 20 +
          (insight.linesImpacted / maxLines) * 8 +
          ((100 - insight.aiScore) / 100) * 8,
      }))
      .sort(
        (left, right) =>
          right.priorityScore - left.priorityScore ||
          right.insight.potentialSavingsMad - left.insight.potentialSavingsMad ||
          right.insight.linkedRiskCustomers - left.insight.linkedRiskCustomers,
      )
      .slice(0, 3)
      .map((entry, index) => ({
        insight: entry.insight,
        priorityRank: (index + 1) as PriorityRank,
      }));
  }, [planInsights]);
  const globalSimulationDistribution = useMemo(
    () =>
      [...planInsights]
        .sort(
          (left, right) =>
            right.potentialSavingsMad - left.potentialSavingsMad ||
            right.linkedRiskCustomers - left.linkedRiskCustomers ||
            left.aiScore - right.aiScore,
        )
        .slice(0, 4),
    [planInsights],
  );
  const automationTargets = useMemo(
    () =>
      planInsights.filter(
        (insight) => insight.potentialSavingsMad > 0 || insight.status !== "Optimise" || insight.decisionRiskLevel !== "Faible",
      ),
    [planInsights],
  );
  const automationGainMad = useMemo(
    () => automationTargets.reduce((total, insight) => total + insight.potentialSavingsMad, 0),
    [automationTargets],
  );
  const automationLines = useMemo(
    () => automationTargets.reduce((total, insight) => total + insight.linesImpacted, 0),
    [automationTargets],
  );
  const comparisonInsight = comparisonPlanId
    ? planInsights.find((insight) => insight.plan.id === comparisonPlanId) ?? null
    : null;
  const comparisonAlternativeInsight = useMemo(() => {
    if (!comparisonInsight) {
      return null;
    }

    const benchmarkAlternative =
      comparisonInsight.benchmarkPlanId !== null
        ? planInsights.find((insight) => insight.plan.id === comparisonInsight.benchmarkPlanId) ?? null
        : null;

    if (benchmarkAlternative) {
      return benchmarkAlternative;
    }

    return (
      [...planInsights]
        .filter((insight) => insight.plan.id !== comparisonInsight.plan.id)
        .sort(
          (left, right) =>
            right.aiScore - left.aiScore ||
            left.plan.monthly_price - right.plan.monthly_price ||
            right.efficiencyScore - left.efficiencyScore,
        )[0] ?? null
    );
  }, [comparisonInsight, planInsights]);
  const comparisonSummary =
    comparisonInsight && comparisonAlternativeInsight
      ? {
          financialGainMad: Math.max(
            comparisonInsight.monthlyFleetCostMad - comparisonAlternativeInsight.monthlyFleetCostMad,
            0,
          ),
          efficiencyDelta: comparisonAlternativeInsight.efficiencyScore - comparisonInsight.efficiencyScore,
          aiScoreDelta: comparisonAlternativeInsight.aiScore - comparisonInsight.aiScore,
          riskDelta: comparisonInsight.decisionRiskScore - comparisonAlternativeInsight.decisionRiskScore,
          fraudDelta: comparisonInsight.fraudImpactPct - comparisonAlternativeInsight.fraudImpactPct,
          churnDelta: comparisonInsight.churnImpactPct - comparisonAlternativeInsight.churnImpactPct,
        }
      : null;
  const replacementOptions = useMemo(() => {
    if (!planToReplace) {
      return [];
    }

    return [...planInsights]
      .filter((insight) => insight.plan.id !== planToReplace.id)
      .sort((left, right) => {
        const recommendedPlanId = replacementImpact?.recommended_replacement_plan_id;
        const leftRecommended = recommendedPlanId === left.plan.id ? 1 : 0;
        const rightRecommended = recommendedPlanId === right.plan.id ? 1 : 0;
        if (leftRecommended !== rightRecommended) {
          return rightRecommended - leftRecommended;
        }

        const leftSameOperator = left.plan.operator_name === planToReplace.operator_name ? 1 : 0;
        const rightSameOperator = right.plan.operator_name === planToReplace.operator_name ? 1 : 0;
        if (leftSameOperator !== rightSameOperator) {
          return rightSameOperator - leftSameOperator;
        }

        return (
          left.plan.monthly_price - right.plan.monthly_price ||
          right.aiScore - left.aiScore ||
          right.efficiencyScore - left.efficiencyScore
        );
      });
  }, [planInsights, planToReplace, replacementImpact?.recommended_replacement_plan_id]);
  const selectedReplacementInsight =
    selectedReplacementPlanId !== null
      ? replacementOptions.find((insight) => insight.plan.id === selectedReplacementPlanId) ?? null
      : null;
  const deactivationInsight =
    planToDeactivate !== null
      ? planInsights.find((insight) => insight.plan.id === planToDeactivate.id) ?? null
      : null;
  const replacementSourceInsight =
    planToReplace !== null
      ? planInsights.find((insight) => insight.plan.id === planToReplace.id) ?? null
      : null;
  const replacementLineCount =
    replacementImpact?.impacted_lines ??
    replacementSourceInsight?.linesImpacted ??
    planToReplace?.active_lines ??
    0;
  const replacementSavingsMad =
    planToReplace && selectedReplacementInsight
      ? Math.max((planToReplace.monthly_price - selectedReplacementInsight.plan.monthly_price) * replacementLineCount, 0)
      : 0;
  const tablePlans = useMemo(() => {
    const items = [...planInsights];

    items.sort((left, right) => {
      if (tableSort === "cost") {
        return right.monthlyFleetCostMad - left.monthlyFleetCostMad || right.plan.monthly_price - left.plan.monthly_price;
      }
      if (tableSort === "lines") {
        return right.plan.active_lines - left.plan.active_lines || right.monthlyFleetCostMad - left.monthlyFleetCostMad;
      }

      return right.efficiencyScore - left.efficiencyScore || right.plan.active_lines - left.plan.active_lines;
    });

    return items;
  }, [planInsights, tableSort]);

  useEffect(() => {
    if (!planToReplace || replacementOptions.length === 0) {
      return;
    }

    if (
      selectedReplacementPlanId !== null &&
      replacementOptions.some((insight) => insight.plan.id === selectedReplacementPlanId)
    ) {
      return;
    }

    const recommendedPlanId = replacementImpact?.recommended_replacement_plan_id;
    const fallbackPlanId =
      (recommendedPlanId !== null &&
      replacementOptions.some((insight) => insight.plan.id === recommendedPlanId)
        ? recommendedPlanId
        : replacementOptions[0]?.plan.id) ?? null;

    if (fallbackPlanId !== null) {
      setSelectedReplacementPlanId(fallbackPlanId);
    }
  }, [planToReplace, replacementImpact?.recommended_replacement_plan_id, replacementOptions, selectedReplacementPlanId]);

  return (
    <>
      <div className="space-y-6 p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="mb-2 text-2xl font-bold text-[#0F172A]">Gestion des forfaits</h1>
            <p className="text-[#64748B]">
              Arbitrage des forfaits telecom avec lecture cout, efficacite et potentiel d'optimisation.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={openAutomationConfirmModal}
              disabled={!canApplyChanges || isLoading || isAutomationApplying || automationTargets.length === 0}
              className="flex items-center gap-2 rounded-lg border border-blue-200 bg-[linear-gradient(135deg,#1D4ED8,#2563EB)] px-4 py-2 font-medium text-white shadow-lg shadow-blue-500/25 transition-all hover:-translate-y-[1px] hover:shadow-blue-500/35 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isAutomationApplying ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
              <span>{isAutomationApplying ? "Application globale..." : "Appliquer toutes les recommandations IA"}</span>
            </button>
            <button
              type="button"
              onClick={() => void handleGlobalSimulation()}
              disabled={isLoading || isGlobalSimulationRunning || planInsights.length === 0}
              className="flex items-center gap-2 rounded-lg border border-violet-200 bg-[linear-gradient(135deg,#7C3AED,#6D28D9)] px-4 py-2 font-medium text-white shadow-lg shadow-violet-500/25 transition-all hover:-translate-y-[1px] hover:shadow-violet-500/35 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isGlobalSimulationRunning ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              <span>{isGlobalSimulationRunning ? "Simulation en cours..." : "Simuler optimisation complete"}</span>
            </button>
            <button
              type="button"
              onClick={() => void handleRefresh()}
              disabled={isLoading || isRefreshing}
              className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 font-medium text-[#0F172A] transition-all hover:bg-[#F8FAFC] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
              <span>{isRefreshing ? "Rafraichissement..." : "Rafraichir"}</span>
            </button>
            {isAdmin ? (
              <button
                type="button"
                onClick={openCreateModal}
                className="flex items-center gap-2 rounded-lg bg-[#2D6CDF] px-4 py-2 font-medium text-white shadow-lg shadow-blue-500/30 transition-all hover:-translate-y-[1px] hover:bg-[#1d4ed8] active:scale-[0.99]"
              >
                <Plus className="h-5 w-5" />
                <span>Ajouter un forfait</span>
              </button>
            ) : null}
          </div>
        </div>

        {!isAdmin ? (
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
            Consultation en lecture seule. La creation et la modification des forfaits sont reservees a l'administrateur.
          </div>
        ) : null}
        {!canApplyChanges ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            Votre role est en lecture seule sur les actions d'application. Les simulations restent disponibles.
          </div>
        ) : null}

        {isAutomationApplied ? (
          <div className="rounded-2xl border border-emerald-200 bg-[linear-gradient(135deg,#ECFDF5,#FFFFFF)] px-5 py-4 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-[#059669]">Automatisation IA active</p>
                <p className="mt-2 text-base font-semibold text-[#0F172A]">
                  {automationTargets.length} recommandations appliquees sur {automationLines} lignes avec un gain total estime de {formatPrice(automationGainMad)}.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge className="border-emerald-200 bg-white px-3 py-1 text-[#059669]">
                  Risque moyen reduit {formatPercent(automationTargets.length > 0 ? automationTargets.reduce((total, insight) => total + insight.decisionRiskScore, 0) / automationTargets.length : 0)}
                </Badge>
                <Badge className="border-emerald-200 bg-white px-3 py-1 text-[#059669]">
                  Churn protege {customerOverview?.kpis.high_risk_customers ?? "--"} clients
                </Badge>
              </div>
            </div>
          </div>
        ) : null}

        {activeScenario ? (
          <div className="rounded-2xl border border-[#BFDBFE] bg-[linear-gradient(135deg,#EFF6FF,#FFFFFF)] px-5 py-4 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-[#1D4ED8]">Scenario actif</p>
                <p className="mt-2 text-base font-semibold text-[#0F172A]">
                  {activeScenario.plan.name} cible {activeScenario.linesImpacted} lignes et {formatPercent(activeScenario.coverageSharePct)} du portefeuille forfaits.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-sm">
                <Badge className="border-blue-200 bg-white px-3 py-1 text-[#1D4ED8]">
                  Economies estimees {formatPrice(activeScenario.potentialSavingsMad)}
                </Badge>
                <Badge className="border-blue-200 bg-white px-3 py-1 text-[#1D4ED8]">
                  Usage cible: {activeScenario.usageTarget}
                </Badge>
              </div>
            </div>
          </div>
        ) : null}

        {errorMessage ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {errorMessage}
          </div>
        ) : null}

        {isLoading ? (
          <div className="rounded-xl border border-gray-200 bg-white px-6 py-14 text-center">
            <p className="text-sm text-[#64748B]">Chargement des forfaits...</p>
          </div>
        ) : plans.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white px-6 py-14 text-center">
            <p className="text-sm text-[#64748B]">Aucun forfait disponible pour le moment.</p>
            {isAdmin ? (
              <button
                type="button"
                onClick={openCreateModal}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#2D6CDF] px-4 py-2 font-medium text-white transition-colors hover:bg-[#1d4ed8]"
              >
                <Plus className="h-4 w-4" />
                <span>Ajouter votre premier forfait</span>
              </button>
            ) : null}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <KPICard
                title="Cout flotte actuel"
                value={formatPrice(totalFleetCostMad)}
                description={`${totalPlanLines} lignes rattachees aux forfaits`}
                icon={Wallet}
                color="blue"
                emphasis="strong"
              />
              <KPICard
                title="Cout cible IA"
                value={formatPrice(optimizedFleetCostMad)}
                description="Scenario apres arbitrage des forfaits"
                icon={Target}
                color="green"
                emphasis="strong"
              />
              <KPICard
                title="Economies potentielles"
                value={formatPrice(derivedPotentialSavingsMad)}
                description={`${planInsights.filter((insight) => insight.potentialSavingsMad > 0).length} forfaits a arbitrer`}
                icon={TrendingUp}
                color="orange"
                emphasis="strong"
              />
              <KPICard
                title="Couverture lignes"
                value={String(connectedLines)}
                description={
                  lineStatsError
                    ? "Statistiques lignes indisponibles"
                    : averageDataUsageGb !== null
                      ? `Usage moyen observe ${averageDataUsageGb.toFixed(1)} Go`
                      : "Vue connectee aux lignes mobiles"
                }
                icon={Users}
                color="purple"
              />
            </div>

            <div className="rounded-[24px] border border-violet-100 bg-[linear-gradient(135deg,#FFFFFF,#F5F3FF)] p-5 shadow-sm">
              <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                <div className="max-w-3xl">
                  <p className="text-xs uppercase tracking-[0.18em] text-[#6D28D9]">Impact budgetaire visuel</p>
                  <h2 className="mt-2 text-lg font-semibold text-[#0F172A]">Avant optimisation vs apres arbitrage IA</h2>
                  <p className="mt-2 text-sm leading-6 text-[#64748B]">
                    L'IA croise cout, efficacite estimee, usages reels et exposition client pour proposer une nouvelle
                    repartition du portefeuille forfaits.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3 xl:min-w-[360px]">
                  <div className="rounded-2xl border border-white/80 bg-white/85 px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.14em] text-[#64748B]">Avant optimisation</p>
                    <p className="mt-2 text-xl font-bold text-[#0F172A]">{formatPrice(totalFleetCostMad)}</p>
                  </div>
                  <div className="rounded-2xl border border-white/80 bg-white/85 px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.14em] text-[#64748B]">Apres optimisation</p>
                    <p className="mt-2 text-xl font-bold text-[#16A34A]">{formatPrice(optimizedFleetCostMad)}</p>
                  </div>
                  <div className="rounded-2xl border border-white/80 bg-white/85 px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.14em] text-[#64748B]">Economies</p>
                    <p className="mt-2 text-xl font-bold text-[#16A34A]">{formatPrice(derivedPotentialSavingsMad)}</p>
                  </div>
                  <div className="rounded-2xl border border-white/80 bg-white/85 px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.14em] text-[#64748B]">Score IA moyen</p>
                    <p className="mt-2 text-xl font-bold text-[#6D28D9]">{formatScore(averageAiScore)}</p>
                  </div>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
                <div className="rounded-2xl border border-white/80 bg-white/80 p-4">
                  <div className="space-y-4">
                    <div>
                      <div className="mb-2 flex items-center justify-between text-sm">
                        <span className="font-medium text-[#475569]">Avant optimisation</span>
                        <span className="font-semibold text-[#0F172A] tabular-nums">{formatPrice(totalFleetCostMad)}</span>
                      </div>
                      <div className="h-3 rounded-full bg-[#E2E8F0]">
                        <div className="h-3 rounded-full bg-[#94A3B8]" style={{ width: "100%" }} />
                      </div>
                    </div>
                    <div>
                      <div className="mb-2 flex items-center justify-between text-sm">
                        <span className="font-medium text-[#475569]">Apres optimisation</span>
                        <span className="font-semibold text-[#16A34A] tabular-nums">{formatPrice(optimizedFleetCostMad)}</span>
                      </div>
                      <div className="h-3 rounded-full bg-[#DCFCE7]">
                        <div
                          className="h-3 rounded-full bg-[linear-gradient(90deg,#16A34A,#22C55E)] transition-all"
                          style={{
                            width: `${totalFleetCostMad > 0 ? Math.max((optimizedFleetCostMad / totalFleetCostMad) * 100, 6) : 0}%`,
                          }}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="mb-2 flex items-center justify-between text-sm">
                        <span className="font-medium text-[#475569]">Gain visualise</span>
                        <span className="font-semibold text-[#6D28D9] tabular-nums">{formatPercent(totalFleetCostMad > 0 ? (derivedPotentialSavingsMad / totalFleetCostMad) * 100 : 0)}</span>
                      </div>
                      <div className="h-3 rounded-full bg-[#E9D5FF]">
                        <div
                          className="h-3 rounded-full bg-[linear-gradient(90deg,#7C3AED,#8B5CF6)] transition-all"
                          style={{
                            width: `${totalFleetCostMad > 0 ? Math.max((derivedPotentialSavingsMad / totalFleetCostMad) * 100, derivedPotentialSavingsMad > 0 ? 6 : 0) : 0}%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-white/80 bg-white/80 p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-[#64748B]">Synthese executive</p>
                  <div className="mt-3 space-y-3">
                    <div className="flex items-center justify-between rounded-xl border border-violet-100 bg-violet-50 px-4 py-3">
                      <span className="text-sm text-[#475569]">Lignes impactees</span>
                      <span className="text-base font-semibold text-[#6D28D9] tabular-nums">{impactedLinesForOptimization}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-xl border border-red-100 bg-red-50 px-4 py-3">
                      <span className="text-sm text-[#475569]">Clients a risque relies</span>
                      <span className="text-base font-semibold text-[#DC2626] tabular-nums">
                        {customerOverview?.kpis.high_risk_customers ?? "--"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-[#F8FAFC] px-4 py-3">
                      <span className="text-sm text-[#475569]">Forfaits a arbitrer</span>
                      <span className="text-base font-semibold text-[#0F172A] tabular-nums">
                        {planInsights.filter((insight) => insight.status !== "Optimise").length}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-[24px] border border-[#DCE5F1] bg-[linear-gradient(135deg,#FFFFFF,#F8FAFC)] p-5 shadow-sm">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="max-w-3xl">
                  <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Contexte business et IA</p>
                  <h2 className="mt-2 text-lg font-semibold text-[#0F172A]">Lecture croisee avec les lignes et les usages</h2>
                  <p className="mt-2 text-sm leading-6 text-[#64748B]">
                    Les forfaits sont relies a {connectedLines} lignes. L'analyse croise prix unitaire, volume de lignes,
                    usage data moyen et poches d'alertes IA pour prioriser les actions de cout.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Badge className="border-[#DCE5F1] bg-white px-3 py-1 text-[#475569]">
                    {lineStatsError ? "Usage data indisponible" : `Data moyenne ${averageDataUsageGb?.toFixed(1) ?? "--"} Go`}
                  </Badge>
                  <Badge className="border-[#DCE5F1] bg-white px-3 py-1 text-[#475569]">
                    Alertes critiques {criticalAiAlerts ?? "--"}
                  </Badge>
                  <Badge className="border-[#DCE5F1] bg-white px-3 py-1 text-[#475569]">
                    Economies reseau detectees {formatPrice(estimatedMonthlySavingsMad ?? 0)}
                  </Badge>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
              {planInsights.map((insight) => {
                const { plan } = insight;
                const isApplied = appliedPlanId === plan.id;
                const isActivated = isPlanActive(plan.activation_status);
                const isExpanded = expandedPlanId === plan.id;
                const isFading = fadingPlanId === plan.id;
                const isLifecycleBusy =
                  isApplyingPlanId === plan.id ||
                  isDeactivatingPlanId === plan.id ||
                  isReplacingPlanId === plan.id;

                return (
                  <div
                    key={plan.id}
                    className={`rounded-2xl border p-5 transition-all duration-300 ${getCardClasses(insight, isApplied)} ${
                      isFading ? "scale-[0.985] opacity-70" : "opacity-100"
                    }`}
                  >
                    <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-lg font-semibold text-[#0F172A]">{plan.name}</h3>
                          <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${getOperatorBadgeClass(plan.operator_name)}`}>
                            {plan.operator_name}
                          </span>
                          <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${getStatusBadgeClasses(insight.status)}`}>
                            {insight.status}
                          </span>
                          <Badge className={`px-2.5 py-1 ${getPlanActivationStatusClasses(plan.activation_status)}`}>
                            {getPlanActivationStatusLabel(plan.activation_status)}
                          </Badge>
                          {insight.isBestPlan ? (
                            <Badge className="border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[#059669]">
                              Meilleure option
                            </Badge>
                          ) : null}
                          {isApplied ? (
                            <Badge className="border-blue-200 bg-blue-50 px-2.5 py-1 text-[#1D4ED8]">
                              Scenario actif
                            </Badge>
                          ) : null}
                        </div>
                        <p className="mt-3 max-w-xl text-sm leading-6 text-[#475569]">{insight.strategySummary}</p>
                      </div>

                      <div className="flex flex-col items-start gap-2 text-right sm:items-end">
                        <p className="text-2xl font-semibold text-[#2D6CDF]">{formatPrice(plan.monthly_price)}</p>
                        <span className="text-sm text-[#64748B]">par ligne / mois</span>
                        <div className="rounded-2xl border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-semibold text-[#6D28D9]">
                          {formatScore(insight.aiScore)}
                        </div>
                      </div>
                    </div>

                    <div className="mb-4 grid gap-2 sm:grid-cols-3">
                      <div className="rounded-2xl border border-white/80 bg-white/80 px-4 py-3">
                        <p className="text-[11px] uppercase tracking-[0.16em] text-[#64748B]">Lignes</p>
                        <p className="mt-2 text-lg font-semibold text-[#0F172A]">{insight.linesImpacted}</p>
                      </div>
                      <div className="rounded-2xl border border-white/80 bg-white/80 px-4 py-3">
                        <p className="text-[11px] uppercase tracking-[0.16em] text-[#64748B]">Gain potentiel</p>
                        <p className="mt-2 text-lg font-semibold text-[#16A34A]">
                          {insight.potentialSavingsMad > 0 ? formatPrice(insight.potentialSavingsMad) : "Aucun"}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-white/80 bg-white/80 px-4 py-3">
                        <p className="text-[11px] uppercase tracking-[0.16em] text-[#64748B]">Risque</p>
                        <p className="mt-2 text-lg font-semibold text-[#0F172A]">{formatScore(insight.decisionRiskScore)}</p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {isActivated ? (
                        <div className="grid gap-2 sm:grid-cols-3">
                          <button
                            type="button"
                            onClick={() => void openDeactivateModal(plan)}
                            disabled={!canApplyChanges || isLifecycleBusy}
                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-[#DC2626] transition-all hover:-translate-y-[1px] hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {isDeactivatingPlanId === plan.id ? (
                              <RefreshCw className="h-4 w-4 animate-spin" />
                            ) : (
                              <X className="h-4 w-4" />
                            )}
                            <span>Désactiver</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void openReplaceModal(plan)}
                            disabled={!canApplyChanges || isLifecycleBusy}
                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm font-semibold text-[#6D28D9] transition-all hover:-translate-y-[1px] hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {isReplacingPlanId === plan.id ? (
                              <RefreshCw className="h-4 w-4 animate-spin" />
                            ) : (
                              <ArrowRightLeft className="h-4 w-4" />
                            )}
                            <span>Remplacer</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleViewAssociatedLines(plan)}
                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-[#1D4ED8] transition-all hover:-translate-y-[1px] hover:shadow-sm"
                          >
                            <Users className="h-4 w-4" />
                            <span>Voir lignes associées</span>
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-3">
                          <button
                            type="button"
                            onClick={() => void handleApplyPlan(plan.id)}
                            disabled={!canApplyChanges || isApplyingPlanId === plan.id}
                            className={`min-w-[160px] inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70 ${
                              isApplied
                                ? "border border-blue-200 bg-[#EFF6FF] text-[#1D4ED8]"
                                : "bg-[linear-gradient(135deg,#1D4ED8,#2563EB)] text-white shadow-sm hover:-translate-y-[1px]"
                            }`}
                          >
                            {isApplyingPlanId === plan.id ? (
                              <RefreshCw className="h-4 w-4 animate-spin" />
                            ) : (
                              <ArrowRightLeft className="h-4 w-4" />
                            )}
                            <span>
                              {isApplyingPlanId === plan.id
                                ? "Activation..."
                                : getPlanActivationActionLabel(plan.activation_status)}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleViewAssociatedLines(plan)}
                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-[#1D4ED8] transition-all hover:-translate-y-[1px] hover:shadow-sm"
                          >
                            <Users className="h-4 w-4" />
                            <span>Voir lignes associées</span>
                          </button>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => setExpandedPlanId(isExpanded ? null : plan.id)}
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-[#0F172A] hover:bg-[#F8FAFC] active:scale-[0.99]"
                      >
                        <Eye className="h-4 w-4" />
                        <span>{isExpanded ? "Masquer" : "Voir plus"}</span>
                      </button>
                    </div>

                    <div className={`overflow-hidden transition-all duration-300 ${isExpanded ? "mt-5 max-h-[1600px]" : "max-h-0"}`}>
                      <div className="space-y-4 pt-4">
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                          <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3">
                            <p className="text-[11px] uppercase tracking-[0.16em] text-[#64748B]">Cout flotte</p>
                            <p className="mt-2 text-sm font-semibold text-[#0F172A]">{formatPrice(insight.monthlyFleetCostMad)}</p>
                          </div>
                          <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3">
                            <p className="text-[11px] uppercase tracking-[0.16em] text-[#64748B]">Cout cible IA</p>
                            <p className="mt-2 text-sm font-semibold text-[#16A34A]">{formatPrice(insight.optimizedFleetCostMad)}</p>
                          </div>
                          <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3">
                            <p className="text-[11px] uppercase tracking-[0.16em] text-[#64748B]">Usage cible</p>
                            <p className="mt-2 text-sm font-semibold text-[#0F172A]">{insight.usageTarget}</p>
                          </div>
                          <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3">
                            <p className="text-[11px] uppercase tracking-[0.16em] text-[#64748B]">Roaming</p>
                            <p className="mt-2 text-sm font-semibold text-[#0F172A]">{plan.roaming_zone}</p>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-gray-200 bg-[#F8FAFC] p-4 text-sm leading-6 text-[#334155]">
                          <p className="font-semibold text-[#0F172A]">Synthese IA</p>
                          <p className="mt-2">{insight.strategySummary}</p>
                        </div>

                        <div className="grid gap-2 sm:grid-cols-2">
                          <button
                            type="button"
                            onClick={() => openComparisonModal(plan.id)}
                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm font-medium text-[#6D28D9] hover:bg-violet-100"
                          >
                            <Brain className="h-4 w-4" />
                            <span>Comparer</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void handlePlanSimulation(plan.id)}
                            disabled={isPlanSimulationRunningId === plan.id}
                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-[#0F172A] hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-70"
                          >
                            {isPlanSimulationRunningId === plan.id ? (
                              <RefreshCw className="h-4 w-4 animate-spin" />
                            ) : (
                              <Sparkles className="h-4 w-4" />
                            )}
                            <span>{isPlanSimulationRunningId === plan.id ? "Calcul..." : "Simuler"}</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
      <PlanFormModal
        open={isFormOpen}
        mode={formMode}
        initialData={editingPlan ? toPlanFormData(editingPlan) : null}
        isSubmitting={isSubmitting}
        errorMessage={formError}
        onClose={closeFormModal}
        onSubmit={handleSubmitPlan}
      />

      <Dialog
        open={planToDeactivate !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            closeDeactivateModal();
          }
        }}
      >
        <DialogContent className="max-w-2xl overflow-hidden border border-gray-200 bg-white p-0">
          <DialogHeader className="border-b border-gray-200 px-6 py-5 pr-14">
            <DialogTitle className="text-2xl font-bold text-[#0F172A]">Désactiver ce forfait ?</DialogTitle>
            <DialogDescription className="text-sm leading-6 text-[#64748B]">
              Vérifiez l’impact avant de rendre ce forfait inactif dans la plateforme.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 px-6 py-5">
            {isDeactivationImpactLoading ? (
              <p className="text-sm text-[#64748B]">Analyse de l’impact en cours...</p>
            ) : deactivationError ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                {deactivationError}
              </div>
            ) : planToDeactivate && deactivationImpact ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-semibold text-[#0F172A]">{planToDeactivate.name}</h3>
                  <Badge className={`px-2.5 py-1 ${getOperatorBadgeClass(planToDeactivate.operator_name)}`}>
                    {planToDeactivate.operator_name}
                  </Badge>
                  <Badge className={`px-2.5 py-1 ${getCoverageImpactClasses(deactivationImpact.coverage_impact_label)}`}>
                    Impact {deactivationImpact.coverage_impact_label}
                  </Badge>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-gray-200 bg-[#F8FAFC] px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-[#64748B]">Lignes impactées</p>
                    <p className="mt-2 text-xl font-semibold text-[#0F172A]">{deactivationImpact.impacted_lines}</p>
                    <p className="mt-1 text-xs text-[#64748B]">
                      {deactivationImpact.actual_linked_lines > 0
                        ? `${deactivationImpact.actual_linked_lines} lignes liées réellement`
                        : "Aucune ligne liée dans la base"}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-gray-200 bg-[#F8FAFC] px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-[#64748B]">Impact coût</p>
                    <p className="mt-2 text-xl font-semibold text-[#0F172A]">
                      {formatPrice(deactivationImpact.estimated_monthly_cost_mad)}
                    </p>
                    <p className="mt-1 text-xs text-[#64748B]">Budget exposé si le plan est retiré</p>
                  </div>
                  <div className="rounded-2xl border border-gray-200 bg-[#F8FAFC] px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-[#64748B]">Couverture</p>
                    <p className="mt-2 text-xl font-semibold text-[#0F172A]">{deactivationImpact.coverage_impact_label}</p>
                    <p className="mt-1 text-xs text-[#64748B]">{deactivationImpact.coverage_impact_summary}</p>
                  </div>
                </div>

                <div className="rounded-2xl border border-violet-200 bg-[linear-gradient(135deg,#F5F3FF,#FFFFFF)] px-4 py-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-violet-100 text-[#6D28D9]">
                      <Brain className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-[#0F172A]">Suggestion IA</p>
                      <p className="mt-1 text-sm leading-6 text-[#475569]">
                        {deactivationImpact.ai_recommendation ??
                          "Aucune alternative automatique n'a été détectée. Vérifiez les lignes avant coupure."}
                      </p>
                    </div>
                  </div>
                </div>

                {deactivationImpact.blocking_reason ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                    {deactivationImpact.blocking_reason}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                    {deactivationImpact.requires_reassignment
                      ? "La désactivation reste possible, mais un suivi des lignes restantes est recommandé."
                      : "Aucune ligne dépendante détectée. La désactivation est sûre."}
                  </div>
                )}

                {deactivationInsight ? (
                  <div className="rounded-2xl border border-gray-200 bg-white px-4 py-4 text-sm leading-6 text-[#475569]">
                    <p className="font-semibold text-[#0F172A]">Contexte métier</p>
                    <p className="mt-2">{deactivationInsight.strategySummary}</p>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>

          <DialogFooter className="border-t border-gray-200 px-6 py-4">
            <button
              type="button"
              onClick={() => void handleDeactivatePlan()}
              disabled={
                !planToDeactivate ||
                !deactivationImpact ||
                !deactivationImpact.can_deactivate ||
                isDeactivatingPlanId === planToDeactivate.id
              }
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,#DC2626,#EF4444)] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {planToDeactivate && isDeactivatingPlanId === planToDeactivate.id ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <X className="h-4 w-4" />
              )}
              <span>Confirmer désactivation</span>
            </button>
            <button
              type="button"
              onClick={closeDeactivateModal}
              className="rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-sm font-medium text-[#475569] transition-colors hover:bg-[#F8FAFC]"
            >
              Annuler
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={planToReplace !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            closeReplaceModal();
          }
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-hidden border border-gray-200 bg-white p-0">
          <DialogHeader className="border-b border-gray-200 px-6 py-5 pr-14">
            <DialogTitle className="text-2xl font-bold text-[#0F172A]">Remplacer le forfait actif</DialogTitle>
            <DialogDescription className="text-sm leading-6 text-[#64748B]">
              Comparez avant / après, puis confirmez le remplacement le plus rentable.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 overflow-y-auto px-6 py-5">
            {isReplacementImpactLoading ? (
              <p className="text-sm text-[#64748B]">Préparation des options de remplacement...</p>
            ) : replacementError ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                {replacementError}
              </div>
            ) : planToReplace ? (
              <>
                <div className="rounded-2xl border border-blue-200 bg-[linear-gradient(135deg,#EFF6FF,#FFFFFF)] px-4 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-semibold text-[#0F172A]">{planToReplace.name}</h3>
                    <Badge className={`px-2.5 py-1 ${getOperatorBadgeClass(planToReplace.operator_name)}`}>
                      {planToReplace.operator_name}
                    </Badge>
                    <Badge className={`px-2.5 py-1 ${getPlanActivationStatusClasses(planToReplace.activation_status)}`}>
                      {getPlanActivationStatusLabel(planToReplace.activation_status)}
                    </Badge>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-[#475569]">
                    {replacementSourceInsight?.strategySummary ??
                      "Sélectionnez un forfait cible pour remplacer ce plan actif sans perdre la lecture métier."}
                  </p>
                </div>

                <div className="space-y-2">
                  <label htmlFor="replacement-plan" className="text-sm font-semibold text-[#0F172A]">
                    Nouveau forfait cible
                  </label>
                  <select
                    id="replacement-plan"
                    value={selectedReplacementPlanId ?? ""}
                    onChange={(event) =>
                      setSelectedReplacementPlanId(
                        event.target.value === "" ? null : Number(event.target.value),
                      )
                    }
                    className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-[#0F172A] outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                  >
                    <option value="">Choisir un forfait</option>
                    {replacementOptions.map((insight) => (
                      <option key={insight.plan.id} value={insight.plan.id}>
                        {insight.plan.name} · {insight.plan.operator_name} · {formatPrice(insight.plan.monthly_price)}
                      </option>
                    ))}
                  </select>
                  {replacementOptions.length === 0 ? (
                    <p className="text-sm text-amber-700">
                      Aucun forfait alternatif disponible. Créez un nouveau plan ou réactivez une autre option.
                    </p>
                  ) : null}
                </div>

                {selectedReplacementInsight ? (
                  <>
                    <div className="grid gap-4 lg:grid-cols-2">
                      <div className="rounded-2xl border border-gray-200 bg-[#F8FAFC] p-4">
                        <p className="text-[11px] uppercase tracking-[0.16em] text-[#64748B]">Avant</p>
                        <div className="mt-3 space-y-3 text-sm text-[#475569]">
                          <div className="flex items-center justify-between gap-3">
                            <span>Prix</span>
                            <span className="font-semibold text-[#0F172A]">{formatPrice(planToReplace.monthly_price)}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span>Data</span>
                            <span className="font-semibold text-[#0F172A]">{planToReplace.data_quota}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span>Voix</span>
                            <span className="font-semibold text-[#0F172A]">{planToReplace.voice_quota}</span>
                          </div>
                        </div>
                      </div>
                      <div className="rounded-2xl border border-emerald-200 bg-[linear-gradient(135deg,#ECFDF5,#FFFFFF)] p-4">
                        <p className="text-[11px] uppercase tracking-[0.16em] text-[#059669]">Après remplacement</p>
                        <div className="mt-3 space-y-3 text-sm text-[#475569]">
                          <div className="flex items-center justify-between gap-3">
                            <span>Prix</span>
                            <span className="font-semibold text-[#0F172A]">
                              {formatPrice(selectedReplacementInsight.plan.monthly_price)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span>Data</span>
                            <span className="font-semibold text-[#0F172A]">
                              {selectedReplacementInsight.plan.data_quota}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span>Voix</span>
                            <span className="font-semibold text-[#0F172A]">
                              {selectedReplacementInsight.plan.voice_quota}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3">
                        <p className="text-[11px] uppercase tracking-[0.16em] text-[#64748B]">Lignes couvertes</p>
                        <p className="mt-2 text-lg font-semibold text-[#0F172A]">{replacementLineCount}</p>
                      </div>
                      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                        <p className="text-[11px] uppercase tracking-[0.16em] text-[#64748B]">Économie IA estimée</p>
                        <p className="mt-2 text-lg font-semibold text-[#059669]">{formatPrice(replacementSavingsMad)}</p>
                      </div>
                      <div className="rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3">
                        <p className="text-[11px] uppercase tracking-[0.16em] text-[#64748B]">Score IA cible</p>
                        <p className="mt-2 text-lg font-semibold text-[#6D28D9]">
                          {formatScore(selectedReplacementInsight.aiScore)}
                        </p>
                      </div>
                    </div>
                  </>
                ) : null}

                <div className="rounded-2xl border border-violet-200 bg-[linear-gradient(135deg,#F5F3FF,#FFFFFF)] px-4 py-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-violet-100 text-[#6D28D9]">
                      <Brain className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-[#0F172A]">Suggestion automatique</p>
                      <p className="mt-1 text-sm leading-6 text-[#475569]">
                        {replacementImpact?.ai_recommendation ??
                          "Choisissez un plan plus proportionné pour sécuriser le budget sans casser la couverture."}
                      </p>
                    </div>
                  </div>
                </div>
              </>
            ) : null}
          </div>

          <DialogFooter className="border-t border-gray-200 px-6 py-4">
            <button
              type="button"
              onClick={() => void handleReplacePlan()}
              disabled={
                !planToReplace ||
                selectedReplacementPlanId === null ||
                replacementOptions.length === 0 ||
                (planToReplace ? isReplacingPlanId === planToReplace.id : false)
              }
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,#6D28D9,#7C3AED)] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {planToReplace && isReplacingPlanId === planToReplace.id ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowRightLeft className="h-4 w-4" />
              )}
              <span>Confirmer le remplacement</span>
            </button>
            <button
              type="button"
              onClick={closeReplaceModal}
              className="rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-sm font-medium text-[#475569] transition-colors hover:bg-[#F8FAFC]"
            >
              Annuler
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isDetailLoading || detailPlan !== null || detailError !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            closeDetailModal();
          }
        }}
      >
        <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col overflow-hidden border border-gray-200 bg-white p-0">
          <DialogHeader className="shrink-0 border-b border-gray-200 px-6 py-5 pr-14">
            <DialogTitle className="text-2xl font-bold text-[#0F172A]">Detail du forfait</DialogTitle>
            <DialogDescription className="text-sm text-[#64748B]">
              Lecture business du cout, des lignes impactees et de la recommandation IA.
            </DialogDescription>
          </DialogHeader>

          {isDetailLoading ? (
            <div className="min-h-0 overflow-y-auto px-6 py-5">
              <p className="text-sm text-[#64748B]">Chargement du forfait...</p>
            </div>
          ) : detailError ? (
            <div className="min-h-0 overflow-y-auto px-6 py-5">
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                {detailError}
              </div>
            </div>
          ) : detailPlan && detailInsight ? (
            <>
              <div className="min-h-0 space-y-6 overflow-y-auto px-6 py-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-xl font-bold text-[#0F172A]">{detailPlan.name}</h3>
                      <Badge className={`px-3 py-1 ${getStatusBadgeClasses(detailInsight.status)}`}>
                        {detailInsight.status}
                      </Badge>
                      {detailInsight.isBestPlan ? (
                        <Badge className="border-emerald-200 bg-emerald-50 px-3 py-1 text-[#059669]">
                          Meilleure option
                        </Badge>
                      ) : null}
                      <Badge className="border-violet-200 bg-violet-50 px-3 py-1 text-[#6D28D9]">
                        Score IA {formatScore(detailInsight.aiScore)}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm text-[#64748B]">ID #{detailPlan.id}</p>
                  </div>
                  <div className="text-left lg:text-right">
                    <p className="text-2xl font-bold text-[#2D6CDF]">{formatPrice(detailPlan.monthly_price)}</p>
                    <p className="text-sm text-[#64748B]">par ligne / mois</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <div className="rounded-xl border border-gray-200 bg-[#F8FAFC] p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">Cout mensuel flotte</p>
                    <p className="mt-2 text-lg font-bold text-[#0F172A] tabular-nums">{formatPrice(detailInsight.monthlyFleetCostMad)}</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-[#F8FAFC] p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">Cout cible IA</p>
                    <p className="mt-2 text-lg font-bold text-[#16A34A] tabular-nums">{formatPrice(detailInsight.optimizedFleetCostMad)}</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-[#F8FAFC] p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">Economies</p>
                    <p className="mt-2 text-lg font-bold text-[#16A34A] tabular-nums">
                      {detailInsight.potentialSavingsMad > 0 ? formatPrice(detailInsight.potentialSavingsMad) : "Stable"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-[#F8FAFC] p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">Lignes impactees</p>
                    <p className="mt-2 text-lg font-bold text-[#0F172A] tabular-nums">{detailPlan.active_lines}</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-[#F8FAFC] p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">Clients a risque lies</p>
                    <p className="mt-2 text-lg font-bold text-[#DC2626] tabular-nums">{detailInsight.linkedRiskCustomers}</p>
                  </div>
                  <div className="rounded-xl border border-violet-100 bg-violet-50 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-[#6D28D9]">Score global IA</p>
                    <p className="mt-2 text-lg font-bold text-[#6D28D9] tabular-nums">{formatScore(detailInsight.aiScore)}</p>
                    <div className="mt-3 h-2 rounded-full bg-violet-100">
                      <div
                        className="h-2 rounded-full bg-[linear-gradient(90deg,#7C3AED,#8B5CF6)]"
                        style={{ width: `${Math.max(detailInsight.aiScore, 8)}%` }}
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <div className="rounded-xl border border-gray-200 bg-white p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">Risque de decision</p>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <Badge className={`px-3 py-1 ${getDecisionRiskClasses(detailInsight.decisionRiskLevel)}`}>
                        {detailInsight.decisionRiskLevel}
                      </Badge>
                      <span className="text-sm font-semibold text-[#0F172A] tabular-nums">
                        {formatScore(detailInsight.decisionRiskScore)}
                      </span>
                    </div>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-white p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">Impact fraude estime</p>
                    <p className="mt-2 text-lg font-bold text-[#DC2626] tabular-nums">-{formatPercent(detailInsight.fraudImpactPct)}</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-white p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">Impact churn estime</p>
                    <p className="mt-2 text-lg font-bold text-[#D97706] tabular-nums">-{formatPercent(detailInsight.churnImpactPct)}</p>
                  </div>
                </div>

                <div className="rounded-2xl border border-[#DCE5F1] bg-[linear-gradient(135deg,#FFFFFF,#F8FAFC)] p-5">
                  <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[#64748B]">
                    <Brain className="h-4 w-4" />
                    <span>Synthese IA</span>
                  </div>
                  <p className="text-sm leading-7 text-[#0F172A]">{detailInsight.strategySummary}</p>
                  <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div className="rounded-xl border border-white/80 bg-white/85 px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-[#64748B]">Reduction estimee</p>
                      <p className="mt-2 font-semibold text-[#0F172A] tabular-nums">{formatPercent(detailInsight.costReductionPct)}</p>
                    </div>
                    <div className="rounded-xl border border-white/80 bg-white/85 px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-[#64748B]">Alternative cible</p>
                      <p className="mt-2 font-semibold text-[#0F172A]">
                        {detailInsight.benchmarkPlanName ?? "Plan conserve"}
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/80 bg-white/85 px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-[#64748B]">Efficacite</p>
                      <p className="mt-2 font-semibold text-[#0F172A] tabular-nums">{formatPercent(detailInsight.efficiencyScore)}</p>
                    </div>
                  </div>
                  <div className="mt-4 rounded-xl border border-white/80 bg-white/85 p-4">
                    <div className="mb-3 flex items-center justify-between text-sm">
                      <span className="font-medium text-[#475569]">Avant optimisation</span>
                      <span className="font-semibold text-[#0F172A] tabular-nums">{formatPrice(detailInsight.monthlyFleetCostMad)}</span>
                    </div>
                    <div className="mb-3 h-2 rounded-full bg-[#E2E8F0]">
                      <div className="h-2 rounded-full bg-[#94A3B8]" style={{ width: "100%" }} />
                    </div>
                    <div className="mb-3 flex items-center justify-between text-sm">
                      <span className="font-medium text-[#475569]">Apres optimisation</span>
                      <span className="font-semibold text-[#16A34A] tabular-nums">{formatPrice(detailInsight.optimizedFleetCostMad)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-[#DCFCE7]">
                      <div
                        className="h-2 rounded-full bg-[linear-gradient(90deg,#16A34A,#22C55E)]"
                        style={{
                          width: `${detailInsight.monthlyFleetCostMad > 0 ? Math.max((detailInsight.optimizedFleetCostMad / detailInsight.monthlyFleetCostMad) * 100, 6) : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                  <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#059669]">Pourquoi recommande</p>
                    <ul className="mt-3 space-y-2 text-sm leading-6 text-[#0F172A]">
                      {detailInsight.whyRecommended.map((reason) => (
                        <li key={reason} className="flex gap-2">
                          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#16A34A]" />
                          <span>{reason}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-xl border border-red-100 bg-red-50/70 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#DC2626]">Pourquoi moins optimal</p>
                    <ul className="mt-3 space-y-2 text-sm leading-6 text-[#0F172A]">
                      {detailInsight.whyNotRecommended.map((reason) => (
                        <li key={reason} className="flex gap-2">
                          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#DC2626]" />
                          <span>{reason}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                  <MiniTrend
                    bars={detailInsight.costTrendMad}
                    colorClass="bg-[linear-gradient(180deg,#16A34A,#22C55E)]"
                    label="Evolution cout"
                    valueFormatter={formatPrice}
                  />
                  <MiniTrend
                    bars={detailInsight.scoreTrend}
                    colorClass="bg-[linear-gradient(180deg,#7C3AED,#8B5CF6)]"
                    label="Evolution score"
                    valueFormatter={formatScore}
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="rounded-xl border border-gray-200 bg-[#F8FAFC] p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">Operateur</p>
                    <p className="mt-2 text-sm text-[#0F172A]">{detailPlan.operator_name}</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-[#F8FAFC] p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">Part du portefeuille</p>
                    <p className="mt-2 text-sm text-[#0F172A]">{formatPercent(detailInsight.coverageSharePct)}</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-[#F8FAFC] p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">Voix</p>
                    <p className="mt-2 text-sm text-[#0F172A]">{detailPlan.voice_quota}</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-[#F8FAFC] p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">Data</p>
                    <p className="mt-2 text-sm text-[#0F172A]">{detailPlan.data_quota}</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-[#F8FAFC] p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">SMS</p>
                    <p className="mt-2 text-sm text-[#0F172A]">{detailPlan.sms_quota}</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-[#F8FAFC] p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">Roaming</p>
                    <p className="mt-2 text-sm text-[#0F172A]">{detailPlan.roaming_zone}</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-[#F8FAFC] p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">Cree le</p>
                    <p className="mt-2 text-sm text-[#0F172A]">{formatCreatedAt(detailPlan.created_at)}</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-[#F8FAFC] p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">Mis a jour le</p>
                    <p className="mt-2 text-sm text-[#0F172A]">{formatCreatedAt(detailPlan.updated_at)}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                  <div className="rounded-xl border border-gray-200 bg-white p-4">
                    <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-[#64748B]">
                      <Activity className="h-4 w-4" />
                      <span>Usage cible</span>
                    </div>
                    <p className="text-sm font-medium text-[#0F172A]">{detailInsight.usageTarget}</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-white p-4">
                    <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-[#64748B]">
                      <Users className="h-4 w-4" />
                      <span>Profils relies</span>
                    </div>
                    <p className="text-sm font-medium text-[#0F172A]">{detailInsight.profileTarget}</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-white p-4">
                    <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-[#64748B]">
                      <Target className="h-4 w-4" />
                      <span>Parc concerne</span>
                    </div>
                    <p className="text-sm font-medium text-[#0F172A]">{detailInsight.deviceTarget}</p>
                  </div>
                </div>

                <div className="rounded-xl border border-gray-200 bg-[#F8FAFC] p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">Description</p>
                  <p className="mt-2 text-sm leading-6 text-[#0F172A]">
                    {detailPlan.description || "Aucune description fournie pour ce forfait."}
                  </p>
                </div>
              </div>

              <DialogFooter className="shrink-0 flex-wrap gap-3 border-t border-gray-200 px-6 py-4">
                {isPlanActive(detailPlan.activation_status) ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        closeDetailModal();
                        void openDeactivateModal(detailPlan);
                      }}
                      disabled={!canApplyChanges || isDeactivatingPlanId === detailPlan.id}
                      className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 font-medium text-[#DC2626] transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isDeactivatingPlanId === detailPlan.id ? (
                        <RefreshCw className="h-4 w-4 animate-spin" />
                      ) : (
                        <X className="h-4 w-4" />
                      )}
                      <span>Désactiver</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        closeDetailModal();
                        void openReplaceModal(detailPlan);
                      }}
                      disabled={!canApplyChanges || isReplacingPlanId === detailPlan.id}
                      className="inline-flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-4 py-2.5 font-medium text-[#6D28D9] transition-colors hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isReplacingPlanId === detailPlan.id ? (
                        <RefreshCw className="h-4 w-4 animate-spin" />
                      ) : (
                        <ArrowRightLeft className="h-4 w-4" />
                      )}
                      <span>Remplacer</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        closeDetailModal();
                        handleViewAssociatedLines(detailPlan);
                      }}
                      className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 font-medium text-[#1D4ED8] transition-colors hover:bg-blue-100"
                    >
                      <Users className="h-4 w-4" />
                      <span>Voir lignes associées</span>
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleApplyPlan(detailPlan.id)}
                    disabled={!canApplyChanges || isApplyingPlanId === detailPlan.id}
                    className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 font-medium transition-all active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70 ${
                      appliedPlanId === detailPlan.id
                        ? "border border-blue-200 bg-[#EFF6FF] text-[#1D4ED8]"
                        : "bg-[#2D6CDF] text-white hover:bg-[#1d4ed8]"
                    }`}
                  >
                    {isApplyingPlanId === detailPlan.id ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <ArrowRightLeft className="h-4 w-4" />
                    )}
                    <span>{isApplyingPlanId === detailPlan.id ? "Activation..." : getPlanActivationActionLabel(detailPlan.activation_status)}</span>
                  </button>
                )}
                <Badge className={`px-3 py-2 ${getPlanActivationStatusClasses(detailPlan.activation_status)}`}>
                  {getPlanActivationStatusLabel(detailPlan.activation_status)}
                </Badge>
                <button
                  type="button"
                  onClick={() => {
                    closeDetailModal();
                    openComparisonModal(detailPlan.id);
                  }}
                  className="inline-flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-4 py-2.5 font-medium text-[#6D28D9] transition-colors hover:bg-violet-100"
                >
                  <Brain className="h-4 w-4" />
                  <span>Comparer</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    closeDetailModal();
                    void handlePlanSimulation(detailPlan.id);
                  }}
                  disabled={isPlanSimulationRunningId === detailPlan.id}
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 font-medium text-[#0F172A] transition-all hover:bg-[#F8FAFC] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isPlanSimulationRunningId === detailPlan.id ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  <span>{isPlanSimulationRunningId === detailPlan.id ? "Calcul..." : "Simuler l'impact"}</span>
                </button>
                {isAdmin ? (
                  <button
                    type="button"
                    onClick={() => {
                      closeDetailModal();
                      openEditModal(detailPlan);
                    }}
                    className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 font-medium text-[#2D6CDF] transition-colors hover:bg-blue-100"
                  >
                    <Pencil className="h-4 w-4" />
                    <span>Modifier</span>
                  </button>
                ) : null}
                {isAdmin ? (
                  <button
                    type="button"
                    onClick={() => void handleDeletePlan(detailPlan)}
                    className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 font-medium text-[#DC2626] transition-colors hover:bg-red-100"
                  >
                    <Trash2 className="h-4 w-4" />
                    <span>Supprimer</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={closeDetailModal}
                  className="rounded-lg border border-gray-200 px-4 py-2.5 font-medium text-[#64748B] transition-colors hover:bg-[#F8FAFC]"
                >
                  Fermer
                </button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog
        open={simulationInsight !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            closeSimulationModal();
          }
        }}
      >
        <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col overflow-hidden border border-gray-200 bg-white p-0">
          <DialogHeader className="shrink-0 border-b border-gray-200 px-6 py-5 pr-14">
            <DialogTitle className="text-2xl font-bold text-[#0F172A]">Simulation d'impact</DialogTitle>
            <DialogDescription className="text-sm text-[#64748B]">
              Projection business avant application aux lignes de flotte.
            </DialogDescription>
          </DialogHeader>

          {simulationInsight ? (
            <>
              <div className="min-h-0 space-y-6 overflow-y-auto px-6 py-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-xl font-bold text-[#0F172A]">{simulationInsight.plan.name}</h3>
                      <Badge className={`px-3 py-1 ${getStatusBadgeClasses(simulationInsight.status)}`}>
                        {simulationInsight.status}
                      </Badge>
                      <Badge className="border-violet-200 bg-violet-50 px-3 py-1 text-[#6D28D9]">
                        Score IA {formatScore(simulationInsight.aiScore)}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm text-[#64748B]">{simulationInsight.valueSummary}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge className="border-[#DCE5F1] bg-white px-3 py-1 text-[#475569]">
                      {simulationInsight.linesImpacted} lignes simulees
                    </Badge>
                    <Badge className="border-red-100 bg-red-50 px-3 py-1 text-[#DC2626]">
                      {simulationInsight.linkedRiskCustomers} clients a risque relies
                    </Badge>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-xl border border-gray-200 bg-[#F8FAFC] p-4">
                    <p className="text-xs uppercase tracking-[0.14em] text-[#64748B]">Cout actuel</p>
                    <p className="mt-2 text-lg font-bold text-[#0F172A] tabular-nums">{formatPrice(simulationInsight.monthlyFleetCostMad)}</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-[#F8FAFC] p-4">
                    <p className="text-xs uppercase tracking-[0.14em] text-[#64748B]">Cout optimise</p>
                    <p className="mt-2 text-lg font-bold text-[#16A34A] tabular-nums">{formatPrice(simulationInsight.optimizedFleetCostMad)}</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-[#F8FAFC] p-4">
                    <p className="text-xs uppercase tracking-[0.14em] text-[#64748B]">Reduction</p>
                    <p className="mt-2 text-lg font-bold text-[#16A34A] tabular-nums">{formatPercent(simulationInsight.costReductionPct)}</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-[#F8FAFC] p-4">
                    <p className="text-xs uppercase tracking-[0.14em] text-[#64748B]">Economies</p>
                    <p className="mt-2 text-lg font-bold text-[#16A34A] tabular-nums">
                      {simulationInsight.potentialSavingsMad > 0 ? formatPrice(simulationInsight.potentialSavingsMad) : "Aucun gain"}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="rounded-xl border border-gray-200 bg-white p-4">
                    <p className="text-xs uppercase tracking-[0.14em] text-[#64748B]">Risque de decision</p>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <Badge className={`px-3 py-1 ${getDecisionRiskClasses(simulationInsight.decisionRiskLevel)}`}>
                        {simulationInsight.decisionRiskLevel}
                      </Badge>
                      <span className="text-sm font-semibold text-[#0F172A] tabular-nums">
                        {formatScore(simulationInsight.decisionRiskScore)}
                      </span>
                    </div>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-white p-4">
                    <p className="text-xs uppercase tracking-[0.14em] text-[#64748B]">Impact fraude estime</p>
                    <p className="mt-2 text-lg font-bold text-[#DC2626] tabular-nums">
                      -{formatPercent(simulationInsight.fraudImpactPct)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-white p-4">
                    <p className="text-xs uppercase tracking-[0.14em] text-[#64748B]">Impact churn estime</p>
                    <p className="mt-2 text-lg font-bold text-[#D97706] tabular-nums">
                      -{formatPercent(simulationInsight.churnImpactPct)}
                    </p>
                  </div>
                </div>

                <div className="rounded-2xl border border-[#DCE5F1] bg-[linear-gradient(135deg,#FFFFFF,#F8FAFC)] p-5">
                  <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[#64748B]">
                    <Sparkles className="h-4 w-4" />
                    <span>Avant / apres optimisation</span>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <div className="mb-2 flex items-center justify-between text-sm">
                        <span className="font-medium text-[#475569]">Avant optimisation</span>
                        <span className="font-semibold text-[#0F172A] tabular-nums">{formatPrice(simulationInsight.monthlyFleetCostMad)}</span>
                      </div>
                      <div className="h-3 rounded-full bg-[#E2E8F0]">
                        <div className="h-3 rounded-full bg-[#94A3B8]" style={{ width: "100%" }} />
                      </div>
                    </div>
                    <div>
                      <div className="mb-2 flex items-center justify-between text-sm">
                        <span className="font-medium text-[#475569]">Apres optimisation</span>
                        <span className="font-semibold text-[#16A34A] tabular-nums">{formatPrice(simulationInsight.optimizedFleetCostMad)}</span>
                      </div>
                      <div className="h-3 rounded-full bg-[#DCFCE7]">
                        <div
                          className="h-3 rounded-full bg-[linear-gradient(90deg,#16A34A,#22C55E)]"
                          style={{
                            width: `${simulationInsight.monthlyFleetCostMad > 0 ? Math.max((simulationInsight.optimizedFleetCostMad / simulationInsight.monthlyFleetCostMad) * 100, 6) : 0}%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                  <MiniTrend
                    bars={simulationInsight.costTrendMad}
                    colorClass="bg-[linear-gradient(180deg,#16A34A,#22C55E)]"
                    label="Evolution cout"
                    valueFormatter={formatPrice}
                  />
                  <MiniTrend
                    bars={simulationInsight.scoreTrend}
                    colorClass="bg-[linear-gradient(180deg,#7C3AED,#8B5CF6)]"
                    label="Evolution score"
                    valueFormatter={formatScore}
                  />
                </div>

                <div className="rounded-2xl border border-[#DCE5F1] bg-[linear-gradient(135deg,#FFFFFF,#F8FAFC)] p-5">
                  <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[#64748B]">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Projection metier</span>
                  </div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="rounded-xl border border-white/80 bg-white/85 px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-[#64748B]">Type d'usage cible</p>
                      <p className="mt-2 font-semibold text-[#0F172A]">{simulationInsight.usageTarget}</p>
                    </div>
                    <div className="rounded-xl border border-white/80 bg-white/85 px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-[#64748B]">Profils concernes</p>
                      <p className="mt-2 font-semibold text-[#0F172A]">{simulationInsight.profileTarget}</p>
                    </div>
                    <div className="rounded-xl border border-white/80 bg-white/85 px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-[#64748B]">Parc et terminaux</p>
                      <p className="mt-2 font-semibold text-[#0F172A]">{simulationInsight.deviceTarget}</p>
                    </div>
                    <div className="rounded-xl border border-white/80 bg-white/85 px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-[#64748B]">Alternative comparee</p>
                      <p className="mt-2 font-semibold text-[#0F172A]">
                        {simulationInsight.benchmarkPlanName ?? "Maintien de la configuration actuelle"}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-gray-200 bg-white p-4">
                  <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[#64748B]">
                    <TriangleAlert className="h-4 w-4" />
                    <span>Impact sur la flotte</span>
                  </div>
                  <p className="text-sm leading-7 text-[#0F172A]">
                    La simulation couvre {simulationInsight.linesImpacted} lignes, soit {formatPercent(simulationInsight.coverageSharePct)} des lignes rattachees aux forfaits. Elle vise un usage
                    "{simulationInsight.usageTarget.toLowerCase()}" et un parc cible "{simulationInsight.deviceTarget.toLowerCase()}".
                  </p>
                </div>
              </div>

              <DialogFooter className="shrink-0 gap-3 border-t border-gray-200 px-6 py-4">
                <button
                  type="button"
                  onClick={() => {
                    void handleApplyPlan(simulationInsight.plan.id);
                    closeSimulationModal();
                  }}
                  disabled={
                    !canApplyChanges ||
                    isApplyingPlanId === simulationInsight.plan.id ||
                    isPlanActive(simulationInsight.plan.activation_status)
                  }
                  className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 font-medium transition-all active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70 ${
                    isPlanActive(simulationInsight.plan.activation_status)
                      ? "border border-emerald-200 bg-emerald-50 text-[#059669]"
                      : appliedPlanId === simulationInsight.plan.id
                        ? "border border-blue-200 bg-[#EFF6FF] text-[#1D4ED8]"
                        : "bg-[#2D6CDF] text-white hover:bg-[#1d4ed8]"
                  }`}
                >
                  {isApplyingPlanId === simulationInsight.plan.id ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <ArrowRightLeft className="h-4 w-4" />
                  )}
                  <span>
                    {isApplyingPlanId === simulationInsight.plan.id
                      ? "Activation..."
                      : isPlanActive(simulationInsight.plan.activation_status)
                        ? getPlanActivationActionLabel(simulationInsight.plan.activation_status)
                        : "Activer forfait"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    closeSimulationModal();
                    openComparisonModal(simulationInsight.plan.id);
                  }}
                  className="inline-flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-4 py-2.5 font-medium text-[#6D28D9] transition-colors hover:bg-violet-100"
                >
                  <Brain className="h-4 w-4" />
                  <span>Comparer</span>
                </button>
                <button
                  type="button"
                  onClick={closeSimulationModal}
                  className="rounded-lg border border-gray-200 px-4 py-2.5 font-medium text-[#64748B] transition-colors hover:bg-[#F8FAFC]"
                >
                  Fermer
                </button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog
        open={comparisonInsight !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            closeComparisonModal();
          }
        }}
      >
        <DialogContent className="flex max-h-[90vh] max-w-5xl flex-col overflow-hidden border border-gray-200 bg-white p-0">
          <DialogHeader className="shrink-0 border-b border-gray-200 px-6 py-5 pr-14">
            <DialogTitle className="text-2xl font-bold text-[#0F172A]">Comparaison intelligente IA</DialogTitle>
            <DialogDescription className="text-sm text-[#64748B]">
              Arbitrage entre le forfait courant et l'alternative la plus pertinente selon le score IA, le cout et le risque de decision.
            </DialogDescription>
          </DialogHeader>

          {comparisonInsight && comparisonAlternativeInsight && comparisonSummary ? (
            <>
              <div className="min-h-0 space-y-6 overflow-y-auto px-6 py-5">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-xl border border-gray-200 bg-[#F8FAFC] p-4">
                    <p className="text-xs uppercase tracking-[0.14em] text-[#64748B]">Gain financier</p>
                    <p className="mt-2 text-lg font-bold text-[#16A34A] tabular-nums">{formatPrice(comparisonSummary.financialGainMad)}</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-[#F8FAFC] p-4">
                    <p className="text-xs uppercase tracking-[0.14em] text-[#64748B]">Lignes impactees</p>
                    <p className="mt-2 text-lg font-bold text-[#0F172A] tabular-nums">{comparisonInsight.linesImpacted}</p>
                  </div>
                  <div className="rounded-xl border border-violet-100 bg-violet-50 p-4">
                    <p className="text-xs uppercase tracking-[0.14em] text-[#6D28D9]">Delta score IA</p>
                    <p className="mt-2 text-lg font-bold text-[#6D28D9] tabular-nums">
                      {comparisonSummary.aiScoreDelta >= 0 ? "+" : ""}
                      {formatScore(comparisonSummary.aiScoreDelta)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-[#F8FAFC] p-4">
                    <p className="text-xs uppercase tracking-[0.14em] text-[#64748B]">Delta efficacite</p>
                    <p className="mt-2 text-lg font-bold text-[#0F172A] tabular-nums">
                      {comparisonSummary.efficiencyDelta >= 0 ? "+" : ""}
                      {formatPercent(comparisonSummary.efficiencyDelta)}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                  <div className="rounded-2xl border border-red-100 bg-red-50/60 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.16em] text-[#DC2626]">Forfait courant</p>
                        <h3 className="mt-2 text-lg font-semibold text-[#0F172A]">{comparisonInsight.plan.name}</h3>
                      </div>
                      <Badge className={`px-3 py-1 ${getDecisionRiskClasses(comparisonInsight.decisionRiskLevel)}`}>
                        Risque {comparisonInsight.decisionRiskLevel}
                      </Badge>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div className="rounded-xl border border-white/80 bg-white px-3 py-3">
                        <p className="text-[#64748B]">Cout flotte</p>
                        <p className="mt-1 font-semibold text-[#0F172A] tabular-nums">{formatPrice(comparisonInsight.monthlyFleetCostMad)}</p>
                      </div>
                      <div className="rounded-xl border border-white/80 bg-white px-3 py-3">
                        <p className="text-[#64748B]">Score IA</p>
                        <p className="mt-1 font-semibold text-[#6D28D9] tabular-nums">{formatScore(comparisonInsight.aiScore)}</p>
                      </div>
                      <div className="rounded-xl border border-white/80 bg-white px-3 py-3">
                        <p className="text-[#64748B]">Fraude</p>
                        <p className="mt-1 font-semibold text-[#DC2626] tabular-nums">-{formatPercent(comparisonInsight.fraudImpactPct)}</p>
                      </div>
                      <div className="rounded-xl border border-white/80 bg-white px-3 py-3">
                        <p className="text-[#64748B]">Churn</p>
                        <p className="mt-1 font-semibold text-[#D97706] tabular-nums">-{formatPercent(comparisonInsight.churnImpactPct)}</p>
                      </div>
                    </div>
                    <ul className="mt-4 space-y-2 text-sm leading-6 text-[#0F172A]">
                      {comparisonInsight.whyNotRecommended.map((reason) => (
                        <li key={reason} className="flex gap-2">
                          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#DC2626]" />
                          <span>{reason}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.16em] text-[#059669]">Alternative IA</p>
                        <h3 className="mt-2 text-lg font-semibold text-[#0F172A]">{comparisonAlternativeInsight.plan.name}</h3>
                      </div>
                      <Badge className={`px-3 py-1 ${getDecisionRiskClasses(comparisonAlternativeInsight.decisionRiskLevel)}`}>
                        Risque {comparisonAlternativeInsight.decisionRiskLevel}
                      </Badge>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div className="rounded-xl border border-white/80 bg-white px-3 py-3">
                        <p className="text-[#64748B]">Cout flotte</p>
                        <p className="mt-1 font-semibold text-[#0F172A] tabular-nums">{formatPrice(comparisonAlternativeInsight.monthlyFleetCostMad)}</p>
                      </div>
                      <div className="rounded-xl border border-white/80 bg-white px-3 py-3">
                        <p className="text-[#64748B]">Score IA</p>
                        <p className="mt-1 font-semibold text-[#6D28D9] tabular-nums">{formatScore(comparisonAlternativeInsight.aiScore)}</p>
                      </div>
                      <div className="rounded-xl border border-white/80 bg-white px-3 py-3">
                        <p className="text-[#64748B]">Fraude</p>
                        <p className="mt-1 font-semibold text-[#DC2626] tabular-nums">-{formatPercent(comparisonAlternativeInsight.fraudImpactPct)}</p>
                      </div>
                      <div className="rounded-xl border border-white/80 bg-white px-3 py-3">
                        <p className="text-[#64748B]">Churn</p>
                        <p className="mt-1 font-semibold text-[#D97706] tabular-nums">-{formatPercent(comparisonAlternativeInsight.churnImpactPct)}</p>
                      </div>
                    </div>
                    <ul className="mt-4 space-y-2 text-sm leading-6 text-[#0F172A]">
                      {comparisonAlternativeInsight.whyRecommended.map((reason) => (
                        <li key={reason} className="flex gap-2">
                          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#16A34A]" />
                          <span>{reason}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="rounded-2xl border border-[#DCE5F1] bg-[linear-gradient(135deg,#FFFFFF,#F8FAFC)] p-5">
                  <div className="mb-4 flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[#64748B]">
                    <Brain className="h-4 w-4" />
                    <span>Lecture comparative</span>
                  </div>
                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                    <MiniTrend
                      bars={comparisonAlternativeInsight.costTrendMad}
                      colorClass="bg-[linear-gradient(180deg,#16A34A,#22C55E)]"
                      label="Evolution cout alternatif"
                      valueFormatter={formatPrice}
                    />
                    <MiniTrend
                      bars={comparisonAlternativeInsight.scoreTrend}
                      colorClass="bg-[linear-gradient(180deg,#7C3AED,#8B5CF6)]"
                      label="Evolution score alternatif"
                      valueFormatter={formatScore}
                    />
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div className="rounded-xl border border-white/80 bg-white px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-[#64748B]">Delta risque</p>
                      <p className="mt-2 font-semibold text-[#0F172A] tabular-nums">
                        {comparisonSummary.riskDelta >= 0 ? "-" : "+"}
                        {formatScore(Math.abs(comparisonSummary.riskDelta))}
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/80 bg-white px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-[#64748B]">Delta fraude</p>
                      <p className="mt-2 font-semibold text-[#DC2626] tabular-nums">
                        {comparisonSummary.fraudDelta >= 0 ? "-" : "+"}
                        {formatPercent(Math.abs(comparisonSummary.fraudDelta))}
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/80 bg-white px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-[#64748B]">Delta churn</p>
                      <p className="mt-2 font-semibold text-[#D97706] tabular-nums">
                        {comparisonSummary.churnDelta >= 0 ? "-" : "+"}
                        {formatPercent(Math.abs(comparisonSummary.churnDelta))}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <DialogFooter className="shrink-0 gap-3 border-t border-gray-200 px-6 py-4">
                <button
                  type="button"
                  onClick={() => {
                    void handleApplyPlan(comparisonAlternativeInsight.plan.id);
                    closeComparisonModal();
                  }}
                  disabled={
                    isApplyingPlanId === comparisonAlternativeInsight.plan.id ||
                    isPlanActive(comparisonAlternativeInsight.plan.activation_status)
                  }
                  className="inline-flex items-center gap-2 rounded-lg bg-[linear-gradient(135deg,#1D4ED8,#2563EB)] px-4 py-2.5 font-medium text-white transition-all hover:bg-[#1d4ed8] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isApplyingPlanId === comparisonAlternativeInsight.plan.id ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <ArrowRightLeft className="h-4 w-4" />
                  )}
                  <span>
                    {isApplyingPlanId === comparisonAlternativeInsight.plan.id
                      ? "Activation..."
                      : isPlanActive(comparisonAlternativeInsight.plan.activation_status)
                        ? getPlanActivationActionLabel(comparisonAlternativeInsight.plan.activation_status)
                        : "Activer l'alternative IA"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    closeComparisonModal();
                    void handlePlanSimulation(comparisonAlternativeInsight.plan.id);
                  }}
                  className="inline-flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-4 py-2.5 font-medium text-[#6D28D9] transition-colors hover:bg-violet-100"
                >
                  <Sparkles className="h-4 w-4" />
                  <span>Simuler l'alternative</span>
                </button>
                <button
                  type="button"
                  onClick={closeComparisonModal}
                  className="rounded-lg border border-gray-200 px-4 py-2.5 font-medium text-[#64748B] transition-colors hover:bg-[#F8FAFC]"
                >
                  Fermer
                </button>
              </DialogFooter>
            </>
          ) : (
            <div className="px-6 py-10 text-sm text-[#64748B]">Aucune comparaison disponible pour ce forfait.</div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={isAutomationConfirmOpen}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            closeAutomationConfirmModal();
          }
        }}
      >
        <DialogContent className="flex h-[min(88vh,860px)] w-[min(96vw,1024px)] max-w-[min(96vw,1024px)] flex-col overflow-hidden rounded-[28px] border border-slate-200/80 bg-white p-0 shadow-[0_28px_80px_-38px_rgba(15,23,42,0.28)] sm:max-h-[88vh]">
          <DialogHeader className="shrink-0 border-b border-slate-200/80 bg-white px-6 py-5 pr-16 sm:px-7">
            <div className="space-y-2">
              <DialogTitle className="text-3xl font-semibold tracking-[-0.03em] text-slate-950">
                Appliquer toutes les recommandations IA
              </DialogTitle>
              <DialogDescription className="max-w-2xl text-sm leading-6 text-slate-600">
                Vérifiez rapidement les principaux indicateurs et lancez l’automatisation sans perdre le fil.
              </DialogDescription>
            </div>
          </DialogHeader>

          <ScrollArea
            type="auto"
            className="min-h-0 flex-1 overscroll-contain [&>[data-slot=scroll-area-viewport]]:max-h-full [&>[data-slot=scroll-area-viewport]]:focus-visible:ring-0 [&>[data-slot=scroll-area-scrollbar]]:w-3 [&>[data-slot=scroll-area-scrollbar]]:p-1 [&_[data-slot=scroll-area-thumb]]:bg-slate-300/90 [&_[data-slot=scroll-area-thumb]]:transition-colors hover:[&_[data-slot=scroll-area-thumb]]:bg-slate-400"
          >
            <div className="space-y-4 px-6 py-5 sm:px-7">
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="min-w-0 rounded-3xl border border-slate-200/90 bg-slate-50/90 p-4 shadow-sm">
                    <p className="text-[11px] uppercase tracking-[0.3em] text-slate-500">Gain total</p>
                    <p className="mt-2 text-[1.5rem] font-semibold text-emerald-600 tabular-nums">{formatPrice(automationGainMad)}</p>
                  </div>
                  <div className="min-w-0 rounded-3xl border border-slate-200/90 bg-slate-50/90 p-4 shadow-sm">
                    <p className="text-[11px] uppercase tracking-[0.3em] text-slate-500">Lignes modifiées</p>
                    <p className="mt-2 text-[1.5rem] font-semibold text-slate-950 tabular-nums">{automationLines}</p>
                  </div>
                  <div className="min-w-0 rounded-3xl border border-slate-200/90 bg-slate-50/90 p-4 shadow-sm">
                    <p className="text-[11px] uppercase tracking-[0.3em] text-slate-500">Forfaits ajustés</p>
                    <p className="mt-2 text-[1.5rem] font-semibold text-slate-950 tabular-nums">{automationTargets.length}</p>
                  </div>
                  <div className="min-w-0 rounded-3xl border border-violet-100 bg-violet-50 p-4 shadow-sm">
                    <p className="text-[11px] uppercase tracking-[0.3em] text-violet-600">Clients protégés</p>
                    <p className="mt-2 text-[1.5rem] font-semibold text-violet-700 tabular-nums">{customerOverview?.kpis.high_risk_customers ?? "--"}</p>
                  </div>
                </div>

                <div className="min-w-0 rounded-[28px] border border-slate-200/80 bg-slate-50 p-4 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs uppercase tracking-[0.32em] text-slate-500">Synthèse</p>
                    <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase text-slate-600">
                      {automationTargets.length} recommandations
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-600">
                    Cette automatisation consolide les recommandations IA les plus impactantes et limite l’impact sur les profils premium.
                  </p>
                  <div className="mt-4 space-y-3 text-sm">
                    <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-3 py-3">
                      <span className="text-slate-600">Priorité économique</span>
                      <span className="font-semibold text-slate-950">Haute</span>
                    </div>
                    <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-3 py-3">
                      <span className="text-slate-600">Risque client</span>
                      <span className="font-semibold text-slate-950">{customerOverview?.kpis.high_risk_customers ?? "--"} protégés</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {automationTargets.slice(0, 3).map((insight) => (
                  <article
                    key={insight.plan.id}
                    className="min-w-0 rounded-[24px] border border-slate-200/90 bg-white p-4 shadow-sm transition hover:shadow-md"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-950">{insight.plan.name}</p>
                        <p className="mt-1 text-xs leading-5 text-slate-500">{insight.strategySummary}</p>
                      </div>
                      <Badge className={`rounded-full px-3 py-1 text-xs font-semibold ${getStatusBadgeClasses(insight.status)}`}>
                        {insight.status}
                      </Badge>
                    </div>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      <div className="rounded-2xl border border-slate-200/90 bg-slate-50 p-3">
                        <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">Score IA</p>
                        <p className="mt-2 text-base font-semibold text-slate-950">{formatScore(insight.aiScore)}</p>
                      </div>
                      <div className="rounded-2xl border border-slate-200/90 bg-slate-50 p-3">
                        <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">Gain potentiel</p>
                        <p className="mt-2 text-base font-semibold text-emerald-600">{formatPrice(insight.potentialSavingsMad)}</p>
                      </div>
                    </div>
                  </article>
                ))}
              </div>

              <div className="rounded-[24px] border border-slate-200/80 bg-slate-50 p-4 text-sm text-slate-600 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold text-slate-950">Détails supplémentaires</p>
                  <button
                    type="button"
                    onClick={() => setIsAutomationDetailsOpen((current) => !current)}
                    className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                  >
                    <span>{isAutomationDetailsOpen ? "Voir moins" : "Voir plus"}</span>
                    {isAutomationDetailsOpen ? (
                      <ChevronUp className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
                <p className="mt-3 leading-6 text-slate-700">
                  Les recommandations sont prêtes à être appliquées. Après confirmation, vous pourrez consulter chaque forfait ajusté dans le tableau principal.
                </p>
                <div
                  className={`overflow-hidden transition-all duration-300 ${
                    isAutomationDetailsOpen ? "mt-4 max-h-[1000px] opacity-100" : "max-h-0 opacity-0"
                  }`}
                >
                  <div className="space-y-3 pt-4">
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                      <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">
                        Ce que couvre l’automatisation
                      </p>
                      <p className="mt-2 text-sm leading-6 text-slate-700">
                        Ajustements sur les forfaits les plus impactants, priorisation des économies et protection des clients à risque premium.
                      </p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl border border-slate-200 bg-white p-3">
                        <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">Impact fonctionnel</p>
                        <p className="mt-2 text-sm leading-6 text-slate-700">
                          Réduction des coûts sans rupture de service et optimisation du mix forfaitaire pour le périmètre ciblé.
                        </p>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white p-3">
                        <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">Visibilité après validation</p>
                        <p className="mt-2 text-sm leading-6 text-slate-700">
                          Chaque modification sera visible dans le tableau principal, avec l’historique des forfaits ajustés.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </ScrollArea>

          <DialogFooter className="shrink-0 border-t border-slate-200/80 bg-white px-6 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-7">
            <button
              type="button"
              onClick={() => void handleActivateAllRecommendations()}
              disabled={!canApplyChanges || isAutomationApplying || automationTargets.length === 0}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#1D4ED8] to-[#2563EB] px-6 py-3 text-sm font-semibold text-white shadow-[0_18px_60px_-30px_rgba(37,99,235,0.9)] transition duration-200 hover:shadow-[0_20px_60px_-30px_rgba(37,99,235,1)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isAutomationApplying ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
              <span>{isAutomationApplying ? "Application en cours..." : "Lancer l’automatisation"}</span>
            </button>
            <button
              type="button"
              onClick={closeAutomationConfirmModal}
              className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-6 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Annuler
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={isGlobalSimulationOpen}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            closeGlobalSimulationModal();
          }
        }}
      >
        <DialogContent className="flex h-[90vh] max-h-[90vh] max-w-4xl flex-col overflow-hidden border border-gray-200 bg-white">
          <DialogHeader className="shrink-0 border-b border-gray-200 bg-white px-6 py-5 pr-14">
            <DialogTitle className="text-2xl font-bold text-[#0F172A]">Simulation globale IA</DialogTitle>
            <DialogDescription className="mt-1 text-sm leading-6 text-[#64748B]">
              Projection portefeuille après optimisation complète des forfaits telecom.
            </DialogDescription>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto px-6 py-5">
              <div className="grid gap-6">
                <section className="rounded-[28px] border border-slate-200 bg-slate-50 p-5 shadow-sm">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Résumé exécutif</p>
                      <h2 className="mt-2 text-xl font-semibold text-slate-950">Résultats de la simulation</h2>
                      <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
                        Synthèse rapide des économies projetées et de l’impact opérationnel. Les indicateurs clés identifient immédiatement le gain et l’ampleur de la simulation.
                      </p>
                    </div>
                    <div className="rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm">
                      Gain estimé : {formatPrice(derivedPotentialSavingsMad)} sur {impactedLinesForOptimization} lignes
                    </div>
                  </div>

                  <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Coût actuel</p>
                      <p className="mt-3 text-xl font-semibold text-slate-950 tabular-nums">{formatPrice(totalFleetCostMad)}</p>
                    </div>
                    <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Coût optimisé</p>
                      <p className="mt-3 text-xl font-semibold text-[#16A34A] tabular-nums">{formatPrice(optimizedFleetCostMad)}</p>
                    </div>
                    <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Gain total</p>
                      <p className="mt-3 text-xl font-semibold text-[#16A34A] tabular-nums">{formatPrice(derivedPotentialSavingsMad)}</p>
                    </div>
                    <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                      <p className="text-xs uppercase tracking-[0.2em] text-[#6D28D9]">Lignes impactées</p>
                      <p className="mt-3 text-xl font-semibold text-[#6D28D9] tabular-nums">{impactedLinesForOptimization}</p>
                    </div>
                  </div>
                </section>

                <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
                  <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="mb-4 flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[#64748B]">
                      <Sparkles className="h-4 w-4 text-[#64748B]" />
                      <span>Avant / Après optimisation</span>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Avant</p>
                        <p className="mt-3 text-2xl font-semibold text-slate-950 tabular-nums">{formatPrice(totalFleetCostMad)}</p>
                        <p className="mt-2 text-sm text-slate-600">Coût actuel du portefeuille</p>
                      </div>
                      <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Après</p>
                        <p className="mt-3 text-2xl font-semibold text-[#16A34A] tabular-nums">{formatPrice(optimizedFleetCostMad)}</p>
                        <p className="mt-2 text-sm text-slate-600">Coût simulé après optimisation</p>
                      </div>
                    </div>
                    <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-slate-700">Économies projetées</p>
                          <p className="mt-1 text-sm text-slate-500">Part du portefeuille</p>
                        </div>
                        <span className="rounded-full bg-violet-50 px-3 py-1 text-sm font-semibold text-[#6D28D9] tabular-nums">
                          {formatPercent(totalFleetCostMad > 0 ? (derivedPotentialSavingsMad / totalFleetCostMad) * 100 : 0)}
                        </span>
                      </div>
                      <div className="mt-4 h-3 overflow-hidden rounded-full bg-[#E9D5FF]">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-[#7C3AED] to-[#C084FC]"
                          style={{
                            width: totalFleetCostMad > 0
                              ? `${Math.min(Math.max((derivedPotentialSavingsMad / totalFleetCostMad) * 100, 8), 100)}%`
                              : "0%",
                          }}
                        />
                      </div>
                    </div>
                  </section>

                  <section className="rounded-[28px] border border-slate-200 bg-slate-50 p-5 shadow-sm">
                    <p className="text-xs uppercase tracking-[0.16em] text-[#64748B]">Impact business</p>
                    <div className="mt-4 grid gap-3">
                      <div className="rounded-3xl border border-slate-200 bg-white px-4 py-3">
                        <p className="text-sm text-slate-600">Score IA moyen</p>
                        <p className="mt-2 text-xl font-semibold text-[#6D28D9] tabular-nums">{formatScore(averageAiScore)}</p>
                      </div>
                      <div className="rounded-3xl border border-slate-200 bg-white px-4 py-3">
                        <p className="text-sm text-slate-600">Clients à risque couverts</p>
                        <p className="mt-2 text-xl font-semibold text-[#DC2626] tabular-nums">{customerOverview?.kpis.high_risk_customers ?? "--"}</p>
                      </div>
                      <div className="rounded-3xl border border-slate-200 bg-white px-4 py-3">
                        <p className="text-sm text-slate-600">Forfaits à arbitrer</p>
                        <p className="mt-2 text-xl font-semibold text-slate-950 tabular-nums">
                          {planInsights.filter((insight) => insight.status !== "Optimise").length}
                        </p>
                      </div>
                    </div>
                    <div className="mt-5 rounded-3xl border border-violet-100 bg-white p-4">
                      <p className="text-sm uppercase tracking-[0.18em] text-[#6D28D9]">Décision IA recommandée</p>
                      <p className="mt-3 text-sm leading-6 text-slate-700">
                        Prioriser le remplacement des plans les plus coûteux par des options plus efficientes, tout en préservant les usages premium. Cette décision favorise des économies substantielles avec un impact minimal sur les clients sensibles.
                      </p>
                    </div>
                  </section>
                </div>

                <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.16em] text-[#64748B]">Scénarios clés</p>
                      <h3 className="mt-2 text-lg font-semibold text-[#0F172A]">Plans priorisés par la simulation</h3>
                    </div>
                    <Badge className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-[#6D28D9]">
                      {globalSimulationDistribution.length} scénarios clés
                    </Badge>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    {globalSimulationDistribution.map((insight) => (
                      <div key={insight.plan.id} className="rounded-3xl border border-[#E2E8F0] bg-[#F8FAFC] p-4">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h4 className="truncate text-base font-semibold text-[#0F172A]">{insight.plan.name}</h4>
                              <Badge className={`px-2.5 py-1 ${getStatusBadgeClasses(insight.status)}`}>
                                {insight.status}
                              </Badge>
                            </div>
                            <p className="mt-2 text-sm leading-6 text-[#475569]">{insight.strategySummary}</p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-xs uppercase tracking-[0.14em] text-[#64748B]">Score IA</p>
                            <p className="mt-1 text-lg font-semibold text-[#6D28D9] tabular-nums">{formatScore(insight.aiScore)}</p>
                          </div>
                        </div>

                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          <div className="rounded-2xl bg-white p-3 shadow-sm">
                            <p className="text-xs text-[#64748B]">Avant</p>
                            <p className="mt-1 font-semibold text-slate-950 tabular-nums">{formatPrice(insight.monthlyFleetCostMad)}</p>
                          </div>
                          <div className="rounded-2xl bg-white p-3 shadow-sm">
                            <p className="text-xs text-[#64748B]">Après</p>
                            <p className="mt-1 font-semibold text-[#16A34A] tabular-nums">{formatPrice(insight.optimizedFleetCostMad)}</p>
                          </div>
                          <div className="rounded-2xl bg-white p-3 shadow-sm">
                            <p className="text-xs text-[#64748B]">Lignes</p>
                            <p className="mt-1 font-semibold text-slate-950 tabular-nums">{insight.linesImpacted}</p>
                          </div>
                          <div className="rounded-2xl bg-white p-3 shadow-sm">
                            <p className="text-xs text-[#64748B]">Clients à risque</p>
                            <p className="mt-1 font-semibold text-[#DC2626] tabular-nums">{insight.linkedRiskCustomers}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </div>
          </div>

          <DialogFooter className="shrink-0 gap-3 border-t border-gray-200 px-6 py-4">
            <button
              type="button"
              onClick={openAutomationConfirmModal}
              disabled={!canApplyChanges || isAutomationApplying || automationTargets.length === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-[linear-gradient(135deg,#1D4ED8,#2563EB)] px-4 py-2.5 font-medium text-white transition-all hover:bg-[#1d4ed8] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isAutomationApplying ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
              <span>{isAutomationApplying ? "Application..." : "Appliquer toutes les recommandations IA"}</span>
            </button>
            <button
              type="button"
              onClick={closeGlobalSimulationModal}
              className="rounded-lg border border-gray-200 px-4 py-2.5 font-medium text-[#64748B] transition-colors hover:bg-[#F8FAFC]"
            >
              Fermer
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
