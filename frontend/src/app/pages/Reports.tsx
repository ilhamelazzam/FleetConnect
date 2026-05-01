import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import {
  Brain,
  CircleHelp,
  Download,
  Eye,
  Filter,
  Lightbulb,
  PhoneCall,
  Search,
  Sparkles,
  Target,
  TrendingUp,
  Wallet,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";

import AIRecommendationBlock from "../components/AIRecommendationBlock";
import { Badge } from "../components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import { useAuth } from "../context/AuthContext";
import {
  ApiError,
  customerChurnApi,
  type ApiCustomerChurnFilters,
  type ApiCustomerChurnReports,
} from "../lib/api";
import {
  buildRecommendationSummary,
  enrichRecommendation,
  type EnrichedRecommendation,
} from "../lib/churn-recommendations";
import {
  formatContractLabel,
  formatCustomerFactorLabel,
  formatCustomerRiskLabel,
  formatInternetServiceLabel,
  formatMadValue,
  formatRiskProbability,
  formatRiskScore,
  formatTenure,
  getCustomerRiskClasses,
} from "../lib/customer-churn";

type PriorityLevel = "P1" | "P2" | "P3";
type SortMode = "revenue" | "churn";
type SegmentType = "contract" | "service" | "price";

interface StrategicSegment {
  key: string;
  type: SegmentType;
  typeLabel: string;
  label: string;
  rawLabel: string;
  churnRatePct: number;
  revenueAtRiskMad: number;
  predictedHighRiskCustomers: number;
  averageRiskScore: number;
  priorityLevel: PriorityLevel;
  severityLabel: "Critique" | "Eleve" | "Moyen" | "Faible";
  priorityScore: number;
}

const panelClass = "rounded-2xl border border-gray-200 bg-white";
const secondaryButtonClass =
  "inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-[#64748B] transition-colors hover:bg-[#F8FAFC]";
const primaryButtonClass =
  "inline-flex items-center gap-2 rounded-xl bg-[#2D6CDF] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1D4ED8]";

function normalizeError(error: unknown, fallbackMessage: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return fallbackMessage;
}

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, durationMs);
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function downloadCsv(filename: string, headers: string[], rows: Array<Array<string | number | boolean>>) {
  const escapedRows = rows.map((row) =>
    row
      .map((value) => {
        const stringValue = String(value);
        if (stringValue.includes(",") || stringValue.includes('"') || stringValue.includes("\n")) {
          return `"${stringValue.replace(/"/g, '""')}"`;
        }
        return stringValue;
      })
      .join(","),
  );

  const csvContent = [headers.join(","), ...escapedRows].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function getPriorityLevel(score: number): PriorityLevel {
  if (score >= 82) return "P1";
  if (score >= 63) return "P2";
  return "P3";
}

function getPriorityClasses(priorityLevel: PriorityLevel): string {
  if (priorityLevel === "P1") return "border-red-200 bg-red-50 text-[#DC2626]";
  if (priorityLevel === "P2") return "border-orange-200 bg-orange-50 text-[#F97316]";
  return "border-blue-200 bg-blue-50 text-[#1D4ED8]";
}

function getSeverityLabel(churnRatePct: number, averageRiskScore: number) {
  if (churnRatePct >= 34 || averageRiskScore >= 65) return "Critique" as const;
  if (churnRatePct >= 22 || averageRiskScore >= 45) return "Eleve" as const;
  if (churnRatePct >= 11 || averageRiskScore >= 28) return "Moyen" as const;
  return "Faible" as const;
}

function getSeverityClasses(severityLabel: "Critique" | "Eleve" | "Moyen" | "Faible"): string {
  if (severityLabel === "Critique") return "border-red-200 bg-red-50 text-[#DC2626]";
  if (severityLabel === "Eleve") return "border-orange-200 bg-orange-50 text-[#F97316]";
  if (severityLabel === "Moyen") return "border-amber-200 bg-amber-50 text-[#CA8A04]";
  return "border-emerald-200 bg-emerald-50 text-[#16A34A]";
}

function formatSegmentLabel(type: SegmentType, label: string): string {
  if (type === "contract") return formatContractLabel(label);
  if (type === "service") return formatInternetServiceLabel(label);
  return label;
}

function getStrategyAction(type: SegmentType, segment: StrategicSegment): string {
  if (type === "contract") {
    return segment.rawLabel.trim().toLowerCase() === "month-to-month" ? "Retenir client" : "Upgrade";
  }
  if (type === "service") {
    const normalized = segment.rawLabel.trim().toLowerCase();
    if (normalized === "dsl" || normalized === "no internet service") return "Changer forfait";
    return segment.churnRatePct >= 28 ? "Retenir client" : "Upgrade";
  }
  return segment.churnRatePct >= 25 ? "Changer forfait" : "Upgrade";
}

function InfoTip({ label }: { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[#94A3B8] hover:bg-[#F8FAFC]">
          <CircleHelp className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent sideOffset={6} className="max-w-xs bg-[#0F172A] text-white">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function buildTrajectoryData(currentRate: number, reducedRate: number) {
  const pressure = clamp(currentRate * 0.08, 1.2, 4.4);

  return [
    { label: "M-3", baseline: clamp(currentRate - pressure * 1.1, 0, 100), scenario: clamp(currentRate - pressure * 1.1, 0, 100) },
    { label: "M-2", baseline: clamp(currentRate - pressure * 0.7, 0, 100), scenario: clamp(currentRate - pressure * 0.7, 0, 100) },
    { label: "M-1", baseline: clamp(currentRate - pressure * 0.3, 0, 100), scenario: clamp(currentRate - pressure * 0.3, 0, 100) },
    { label: "Actuel", baseline: clamp(currentRate, 0, 100), scenario: clamp(currentRate, 0, 100) },
    { label: "M+1", baseline: clamp(currentRate + pressure * 0.4, 0, 100), scenario: clamp(currentRate - reducedRate * 0.45, 0, 100) },
    { label: "M+2", baseline: clamp(currentRate + pressure * 0.8, 0, 100), scenario: clamp(currentRate - reducedRate * 0.78, 0, 100) },
    { label: "M+3", baseline: clamp(currentRate + pressure * 1.1, 0, 100), scenario: clamp(currentRate - reducedRate, 0, 100) },
  ];
}

function getRecommendationStatus(
  customerId: number,
  appliedCustomerIds: number[],
  contactedCustomerIds: number[],
): string {
  if (appliedCustomerIds.includes(customerId)) return "Traitee";
  if (contactedCustomerIds.includes(customerId)) return "En cours";
  return "Non traitee";
}

export default function Reports() {
  const navigate = useNavigate();
  const { token } = useAuth();
  const [filters, setFilters] = useState<ApiCustomerChurnFilters | null>(null);
  const [reports, setReports] = useState<ApiCustomerChurnReports | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDepartment, setSelectedDepartment] = useState("all");
  const [selectedContract, setSelectedContract] = useState("all");
  const [selectedInternetService, setSelectedInternetService] = useState("all");
  const [selectedPriceRange, setSelectedPriceRange] = useState("all");
  const [selectedRiskLevel, setSelectedRiskLevel] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState<"all" | PriorityLevel>("all");
  const [sortMode, setSortMode] = useState<SortMode>("revenue");
  const [activeExportKey, setActiveExportKey] = useState<string | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulationReady, setSimulationReady] = useState(false);
  const [appliedStrategyKeys, setAppliedStrategyKeys] = useState<string[]>([]);
  const [contactedCustomerIds, setContactedCustomerIds] = useState<number[]>([]);
  const [appliedCustomerIds, setAppliedCustomerIds] = useState<number[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function loadFilters() {
      if (!token) return;
      try {
        const response = await customerChurnApi.filters(token);
        if (isMounted) setFilters(response);
      } catch (error) {
        if (isMounted) setErrorMessage(normalizeError(error, "Impossible de charger les filtres de rapports."));
      }
    }
    void loadFilters();
    return () => {
      isMounted = false;
    };
  }, [token]);

  useEffect(() => {
    let isMounted = true;
    async function loadReports() {
      if (!token) {
        if (isMounted) {
          setReports(null);
          setIsLoading(false);
        }
        return;
      }
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const response = await customerChurnApi.reports(token, {
          search: searchQuery.trim() || undefined,
          department: selectedDepartment !== "all" ? selectedDepartment : undefined,
          contract: selectedContract !== "all" ? selectedContract : undefined,
          internet_service: selectedInternetService !== "all" ? selectedInternetService : undefined,
          price_range: selectedPriceRange !== "all" ? selectedPriceRange : undefined,
          risk_level: selectedRiskLevel !== "all" ? selectedRiskLevel : undefined,
        });
        if (isMounted) setReports(response);
      } catch (error) {
        if (isMounted) {
          setReports(null);
          setErrorMessage(normalizeError(error, "Impossible de charger les rapports churn."));
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }
    void loadReports();
    return () => {
      isMounted = false;
    };
  }, [token, searchQuery, selectedDepartment, selectedContract, selectedInternetService, selectedPriceRange, selectedRiskLevel]);

  const topSummary = buildRecommendationSummary(reports?.top_revenue_at_risk ?? []);
  const topCustomers = [...(reports?.top_revenue_at_risk ?? [])]
    .map((customer) => enrichRecommendation(customer, topSummary))
    .sort((leftCustomer, rightCustomer) => {
      if (sortMode === "revenue" && leftCustomer.revenue_at_risk_mad !== rightCustomer.revenue_at_risk_mad) {
        return rightCustomer.revenue_at_risk_mad - leftCustomer.revenue_at_risk_mad;
      }
      if (sortMode === "churn" && leftCustomer.risk_proba !== rightCustomer.risk_proba) {
        return rightCustomer.risk_proba - leftCustomer.risk_proba;
      }
      return rightCustomer.priorityScore - leftCustomer.priorityScore;
    });
  const visibleCustomers = topCustomers.filter((customer) => priorityFilter === "all" || customer.priorityLevel === priorityFilter);

  const contractRows = (reports?.churn_by_contract ?? []).map((row) => ({ ...row, label: formatContractLabel(row.label), rawLabel: row.label }));
  const serviceRows = (reports?.churn_by_internet_service ?? []).map((row) => ({ ...row, label: formatInternetServiceLabel(row.label), rawLabel: row.label }));
  const priceRows = (reports?.churn_by_price_range ?? []).map((row) => ({ ...row, rawLabel: row.label }));
  const departmentLead = [...(reports?.risk_by_department ?? [])].sort((leftRow, rightRow) => rightRow.revenue_at_risk_mad - leftRow.revenue_at_risk_mad)[0] ?? null;

  const revenueReference = Math.max(1, ...[...contractRows, ...serviceRows, ...priceRows].map((row) => row.revenue_at_risk_mad));
  const strategicSegments: StrategicSegment[] = [
    ...contractRows.map((row) => {
      const priorityScore = row.churn_rate_pct * 1.1 + row.average_risk_score * 0.7 + (row.revenue_at_risk_mad / revenueReference) * 32;
      return { key: `contract:${row.rawLabel}`, type: "contract" as const, typeLabel: "Contrat", label: row.label, rawLabel: row.rawLabel, churnRatePct: row.churn_rate_pct, revenueAtRiskMad: row.revenue_at_risk_mad, predictedHighRiskCustomers: row.predicted_high_risk_customers, averageRiskScore: row.average_risk_score, priorityLevel: getPriorityLevel(priorityScore), severityLabel: getSeverityLabel(row.churn_rate_pct, row.average_risk_score), priorityScore };
    }),
    ...serviceRows.map((row) => {
      const priorityScore = row.churn_rate_pct * 1.1 + row.average_risk_score * 0.7 + (row.revenue_at_risk_mad / revenueReference) * 32;
      return { key: `service:${row.rawLabel}`, type: "service" as const, typeLabel: "Service", label: row.label, rawLabel: row.rawLabel, churnRatePct: row.churn_rate_pct, revenueAtRiskMad: row.revenue_at_risk_mad, predictedHighRiskCustomers: row.predicted_high_risk_customers, averageRiskScore: row.average_risk_score, priorityLevel: getPriorityLevel(priorityScore), severityLabel: getSeverityLabel(row.churn_rate_pct, row.average_risk_score), priorityScore };
    }),
    ...priceRows.map((row) => {
      const priorityScore = row.churn_rate_pct * 1.1 + row.average_risk_score * 0.7 + (row.revenue_at_risk_mad / revenueReference) * 32;
      return { key: `price:${row.rawLabel}`, type: "price" as const, typeLabel: "Prix", label: row.label, rawLabel: row.rawLabel, churnRatePct: row.churn_rate_pct, revenueAtRiskMad: row.revenue_at_risk_mad, predictedHighRiskCustomers: row.predicted_high_risk_customers, averageRiskScore: row.average_risk_score, priorityLevel: getPriorityLevel(priorityScore), severityLabel: getSeverityLabel(row.churn_rate_pct, row.average_risk_score), priorityScore };
    }),
  ];
  const leadSegment = [...strategicSegments].sort((leftSegment, rightSegment) => rightSegment.priorityScore - leftSegment.priorityScore)[0] ?? null;
  const strategyCards = (["contract", "service", "price"] as SegmentType[]).map((type) => [...strategicSegments].filter((segment) => segment.type === type).sort((leftSegment, rightSegment) => rightSegment.priorityScore - leftSegment.priorityScore)[0] ?? null).filter((segment): segment is StrategicSegment => segment !== null);

  const revenueCoverage = clamp(topCustomers.reduce((sum, customer) => sum + customer.revenue_at_risk_mad, 0) / Math.max(reports?.kpis.revenue_at_risk_mad ?? 1, 1), 0.2, 1);
  const recoveredRevenueMad = topCustomers.reduce((sum, customer) => sum + customer.simulatedFinancialGainMad, 0) / revenueCoverage;
  const gainPotentialMad = (topCustomers.reduce((sum, customer) => sum + customer.simulatedFinancialGainMad + Math.max(0, customer.future_cost_pred_mad - customer.estimatedOptimizedCostMad), 0)) / revenueCoverage;
  const averageReduction = topCustomers.length === 0 ? 0 : topCustomers.reduce((sum, customer) => sum + customer.simulatedRiskReductionPct, 0) / topCustomers.length;
  const churnReducedPct = Math.min(reports?.kpis.churn_rate_pct ?? 0, averageReduction * (simulationReady ? 0.48 : 0.26));
  const customersSaved = Math.max(0, Math.round((reports?.kpis.high_risk_customers ?? 0) * (churnReducedPct / 100) * 0.42));
  const trajectoryData = buildTrajectoryData(reports?.kpis.churn_rate_pct ?? 0, churnReducedPct);
  const crossedCustomers = topCustomers
    .filter(
      (customer) =>
        customer.monthly_cost_mad >=
          (topSummary.averageMonthlyCostMad > 0
            ? topSummary.averageMonthlyCostMad * 1.12
            : (reports?.kpis.average_monthly_revenue_mad ?? 0) * 1.1) &&
        customer.risk_proba >= 0.45,
    )
    .slice(0, 4);
  const selectedCustomer =
    visibleCustomers.find((customer) => customer.customer_row_id === selectedCustomerId) ??
    topCustomers.find((customer) => customer.customer_row_id === selectedCustomerId) ??
    null;
  const exportButtons = [
    {
      key: "contracts",
      title: "Exporter contrats",
      subtitle: "Churn et revenu a risque",
      filename: "churn-by-contract.csv",
      headers: ["contract", "total_customers", "actual_churn_customers", "predicted_high_risk_customers", "churn_rate_pct", "revenue_at_risk_mad"],
      rows: contractRows.map((row) => [row.label, row.total_customers, row.actual_churn_customers, row.predicted_high_risk_customers, row.churn_rate_pct, row.revenue_at_risk_mad]),
    },
    {
      key: "services",
      title: "Exporter services",
      subtitle: "Segments service critiques",
      filename: "churn-by-service.csv",
      headers: ["service", "total_customers", "actual_churn_customers", "predicted_high_risk_customers", "churn_rate_pct", "revenue_at_risk_mad"],
      rows: serviceRows.map((row) => [row.label, row.total_customers, row.actual_churn_customers, row.predicted_high_risk_customers, row.churn_rate_pct, row.revenue_at_risk_mad]),
    },
    {
      key: "prices",
      title: "Exporter prix",
      subtitle: "Churn vs revenu",
      filename: "churn-by-price-range.csv",
      headers: ["price_range", "total_customers", "actual_churn_customers", "predicted_high_risk_customers", "churn_rate_pct", "revenue_at_risk_mad"],
      rows: priceRows.map((row) => [row.label, row.total_customers, row.actual_churn_customers, row.predicted_high_risk_customers, row.churn_rate_pct, row.revenue_at_risk_mad]),
    },
    {
      key: "top-risk",
      title: "Exporter top risque",
      subtitle: "Priorites et actions IA",
      filename: "top-revenue-at-risk.csv",
      headers: ["customer_id", "department", "contract", "priority_level", "risk_level", "risk_probability", "revenue_at_risk_mad", "recommendation"],
      rows: visibleCustomers.map((customer) => [customer.customer_id, customer.department, formatContractLabel(customer.contract), customer.priorityLevel, customer.risk_level, customer.risk_proba, customer.revenue_at_risk_mad, customer.recommendation]),
    },
  ];

  useEffect(() => {
    if (!selectedCustomerId && visibleCustomers[0]) setSelectedCustomerId(visibleCustomers[0].customer_row_id);
    if (selectedCustomerId && !visibleCustomers.some((customer) => customer.customer_row_id === selectedCustomerId)) {
      setSelectedCustomerId(visibleCustomers[0]?.customer_row_id ?? null);
    }
  }, [selectedCustomerId, visibleCustomers]);

  function resetFilters() {
    setSearchQuery("");
    setSelectedDepartment("all");
    setSelectedContract("all");
    setSelectedInternetService("all");
    setSelectedPriceRange("all");
    setSelectedRiskLevel("all");
    setPriorityFilter("all");
  }

  function applySegmentFilter(segment: StrategicSegment) {
    if (segment.type === "contract") setSelectedContract(segment.rawLabel);
    if (segment.type === "service") setSelectedInternetService(segment.rawLabel);
    if (segment.type === "price") setSelectedPriceRange(segment.rawLabel);
  }

  async function handleExport(key: string, filename: string, headers: string[], rows: Array<Array<string | number | boolean>>) {
    setActiveExportKey(key);
    downloadCsv(filename, headers, rows);
    toast.success("Export pret", { description: `${filename} a ete genere pour la vue courante.` });
    await wait(700);
    setActiveExportKey(null);
  }

  async function handleSimulate() {
    setIsSimulating(true);
    await wait(700);
    setSimulationReady(true);
    setIsSimulating(false);
    toast.success("Simulation mise a jour", { description: `${formatMadValue(recoveredRevenueMad)} recuperables selon le scenario IA.` });
  }

  function handleApplyStrategy(segment: StrategicSegment) {
    applySegmentFilter(segment);
    setAppliedStrategyKeys((keys) => (keys.includes(segment.key) ? keys : [...keys, segment.key]));
    toast.success("Strategie appliquee", { description: `${getStrategyAction(segment.type, segment)} active sur ${segment.label}.` });
  }

  function handleContactCustomer(customer: EnrichedRecommendation) {
    setContactedCustomerIds((ids) => (ids.includes(customer.customer_row_id) ? ids : [...ids, customer.customer_row_id]));
    toast.success("Client contacte", { description: `${customer.customer_id} passe en suivi retention.` });
  }

  function handleApplyCustomerAction(customer: EnrichedRecommendation) {
    setAppliedCustomerIds((ids) => (ids.includes(customer.customer_row_id) ? ids : [...ids, customer.customer_row_id]));
    toast.success("Action appliquee", { description: `${customer.customer_id} passe en execution prioritaire.` });
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="mb-2 text-2xl font-bold text-[#0F172A]">Rapports churn</h1>
          <p className="max-w-4xl text-[#64748B]">Dashboard IA pour comprendre le churn, prioriser les revenus exposes et piloter les actions a fort impact business.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => void handleSimulate()} className={primaryButtonClass}>
            <Sparkles className={`h-4 w-4 ${isSimulating ? "animate-spin" : ""}`} />
            <span>{isSimulating ? "Simulation..." : "Simuler reduction churn"}</span>
          </button>
          <button type="button" onClick={() => navigate("/predictions")} className={secondaryButtonClass}>
            <TrendingUp className="h-4 w-4" />
            <span>Predictions churn</span>
          </button>
          <button type="button" onClick={() => navigate("/recommandations")} className={secondaryButtonClass}>
            <Lightbulb className="h-4 w-4" />
            <span>Recommandations IA</span>
          </button>
        </div>
      </div>

      {errorMessage ? <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{errorMessage}</div> : null}

      <div className={`${panelClass} p-4`}>
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium text-[#64748B]">
            <Filter className="h-4 w-4" />
            <span>{reports?.kpis.total_customers ?? 0} clients dans la vue decisionnelle</span>
          </div>
          <button type="button" onClick={resetFilters} className={secondaryButtonClass}>Reinitialiser</button>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-7">
          <div className="relative xl:col-span-2">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748B]" />
            <input type="text" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Client, contrat, recommandation..." className="w-full rounded-xl border border-gray-200 bg-[#F8FAFC] py-2.5 pl-10 pr-4 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2D6CDF]" />
          </div>
          <select value={selectedDepartment} onChange={(event) => setSelectedDepartment(event.target.value)} className="rounded-xl border border-gray-200 bg-[#F8FAFC] px-4 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2D6CDF]"><option value="all">Tous les departements</option>{(filters?.departments ?? []).map((department) => <option key={department} value={department}>{department}</option>)}</select>
          <select value={selectedContract} onChange={(event) => setSelectedContract(event.target.value)} className="rounded-xl border border-gray-200 bg-[#F8FAFC] px-4 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2D6CDF]"><option value="all">Tous les contrats</option>{(filters?.contracts ?? []).map((contract) => <option key={contract} value={contract}>{formatContractLabel(contract)}</option>)}</select>
          <select value={selectedInternetService} onChange={(event) => setSelectedInternetService(event.target.value)} className="rounded-xl border border-gray-200 bg-[#F8FAFC] px-4 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2D6CDF]"><option value="all">Tous les services</option>{(filters?.internet_services ?? []).map((service) => <option key={service} value={service}>{formatInternetServiceLabel(service)}</option>)}</select>
          <select value={selectedPriceRange} onChange={(event) => setSelectedPriceRange(event.target.value)} className="rounded-xl border border-gray-200 bg-[#F8FAFC] px-4 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2D6CDF]"><option value="all">Tous les prix</option>{(filters?.price_ranges ?? []).map((priceRange) => <option key={priceRange} value={priceRange}>{priceRange}</option>)}</select>
          <select value={selectedRiskLevel} onChange={(event) => setSelectedRiskLevel(event.target.value)} className="rounded-xl border border-gray-200 bg-[#F8FAFC] px-4 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2D6CDF]"><option value="all">Tous les risques</option>{(filters?.risk_levels ?? []).map((riskLevel) => <option key={riskLevel} value={riskLevel}>{formatCustomerRiskLabel(riskLevel)}</option>)}</select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className={`${panelClass} p-6`}><p className="text-sm text-[#64748B]">Clients</p><p className="mt-2 text-3xl font-bold text-[#0F172A]">{isLoading ? "--" : reports?.kpis.total_customers ?? 0}</p></div>
        <div className={`${panelClass} p-6`}><p className="text-sm text-[#64748B]">Churn reel</p><p className="mt-2 text-3xl font-bold text-[#DC2626]">{isLoading ? "--" : reports?.kpis.actual_churn_customers ?? 0}</p></div>
        <div className={`${panelClass} p-6`}><p className="text-sm text-[#64748B]">Clients a risque</p><p className="mt-2 text-3xl font-bold text-[#D97706]">{isLoading ? "--" : reports?.kpis.high_risk_customers ?? 0}</p></div>
        <div className={`${panelClass} p-6`}><p className="text-sm text-[#64748B]">Revenu a risque</p><p className="mt-2 text-3xl font-bold text-[#0F172A]">{isLoading ? "--" : formatMadValue(reports?.kpis.revenue_at_risk_mad ?? 0)}</p></div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)]">
        <div className="rounded-3xl border border-blue-100 bg-gradient-to-br from-[#EFF6FF] via-white to-[#F8FAFC] p-6">
          <div className="flex items-center gap-2"><Brain className="h-5 w-5 text-[#2D6CDF]" /><h2 className="text-lg font-semibold text-[#0F172A]">Synthese IA</h2><InfoTip label="Lecture automatique du facteur dominant, du segment critique et de la recommandation globale a partir des donnees churn." /></div>
          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-2xl bg-white/90 p-5"><p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Principal facteur</p><p className="mt-3 text-xl font-semibold text-[#0F172A]">{leadSegment ? `${leadSegment.typeLabel} - ${leadSegment.label}` : "--"}</p><p className="mt-2 text-sm text-[#64748B]">{leadSegment ? `${leadSegment.predictedHighRiskCustomers} clients a risque, ${leadSegment.churnRatePct.toFixed(1)}% de churn et ${formatMadValue(leadSegment.revenueAtRiskMad)} exposes.` : "Analyse indisponible."}</p></div>
            <div className="rounded-2xl bg-white/90 p-5"><p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Segment le plus critique</p><p className="mt-3 text-xl font-semibold text-[#0F172A]">{departmentLead ? departmentLead.label : "--"}</p><p className="mt-2 text-sm text-[#64748B]">{departmentLead ? `${departmentLead.predicted_high_risk_customers} clients exposes pour ${formatMadValue(departmentLead.revenue_at_risk_mad)}.` : "Aucun segment critique detecte."}</p></div>
          </div>
          <div className="mt-5 rounded-2xl border border-blue-100 bg-white p-5"><p className="text-sm leading-7 text-[#334155]">{leadSegment ? `Le moteur IA relie le churn prioritaire a ${leadSegment.typeLabel.toLowerCase()} ${leadSegment.label.toLowerCase()}, avec une pression maximale sur ${departmentLead?.label ?? "les departements les plus exposes"}. La priorite business consiste a ${getStrategyAction(leadSegment.type, leadSegment).toLowerCase()} sur ce segment avant d'etendre la strategie aux clients P1.` : "Le moteur IA attend davantage de donnees pour produire une synthese exploitable."}</p></div>
        </div>

        <div className={`rounded-3xl border p-6 ${simulationReady ? "border-emerald-200 bg-emerald-50/40" : "border-gray-200 bg-white"}`}>
          <div className="flex items-center gap-2"><Target className="h-5 w-5 text-[#16A34A]" /><h2 className="text-lg font-semibold text-[#0F172A]">Impact global</h2><InfoTip label="Projection business basee sur le revenu expose, les recommandations prioritaires et la reduction de risque moyenne." /></div>
          <div className="mt-5 space-y-4">
            <div className="rounded-2xl bg-[#F8FAFC] p-4"><p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Revenu actuel a risque</p><p className="mt-2 text-2xl font-semibold text-[#0F172A]">{formatMadValue(reports?.kpis.revenue_at_risk_mad ?? 0)}</p></div>
            <div className="rounded-2xl bg-[#F8FAFC] p-4"><p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Revenu recuperable</p><p className="mt-2 text-2xl font-semibold text-[#16A34A]">{isLoading ? "--" : formatMadValue(recoveredRevenueMad)}</p></div>
            <div className="rounded-2xl bg-[#F8FAFC] p-4"><p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Gain potentiel</p><p className="mt-2 text-2xl font-semibold text-[#2D6CDF]">{isLoading ? "--" : formatMadValue(gainPotentialMad)}</p></div>
          </div>
          <div className="mt-5 rounded-2xl border border-emerald-100 bg-white p-4"><p className="text-sm font-medium text-[#0F172A]">{simulationReady ? "Scenario simule actif" : "Projection IA prete a etre validee"}</p><p className="mt-2 text-sm text-[#64748B]">Churn reduit {churnReducedPct.toFixed(1)}% - {customersSaved} clients sauves.</p></div>
        </div>
      </div>

      <div className={`${panelClass} p-6`}>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-2"><Lightbulb className="h-5 w-5 text-[#6D28D9]" /><h2 className="text-lg font-semibold text-[#0F172A]">Priorisation intelligente</h2><InfoTip label="Classement des segments par impact business, revenu expose et intensite du churn." /></div>
          <div className="flex flex-wrap gap-2"><button type="button" onClick={() => setSortMode("revenue")} className={sortMode === "revenue" ? primaryButtonClass : secondaryButtonClass}>Trier revenu a risque</button><button type="button" onClick={() => setSortMode("churn")} className={sortMode === "churn" ? primaryButtonClass : secondaryButtonClass}>Trier taux de churn</button></div>
        </div>
        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">{(["P1", "P2", "P3"] as PriorityLevel[]).map((level) => <button key={level} type="button" onClick={() => setPriorityFilter((currentLevel) => currentLevel === level ? "all" : level)} className={`rounded-2xl border p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-md ${priorityFilter === level ? "border-[#2D6CDF] shadow-md" : "border-gray-200"}`}><Badge className={getPriorityClasses(level)}>Top risques {level}</Badge><p className="mt-3 text-3xl font-bold text-[#0F172A]">{strategicSegments.filter((segment) => segment.priorityLevel === level).length}</p><p className="mt-2 text-sm text-[#64748B]">{level === "P1" ? "Segments critiques a traiter immediatement" : level === "P2" ? "Segments importants a cadrer cette semaine" : "Segments a surveiller et automatiser"}</p></button>)}</div>
        <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-3">{strategyCards.map((segment) => <div key={segment.key} className={`${panelClass} p-5`}><div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">{segment.typeLabel}</p><h3 className="mt-2 text-lg font-semibold text-[#0F172A]">{segment.label}</h3></div><Badge className={getSeverityClasses(segment.severityLabel)}>{segment.severityLabel}</Badge></div><p className="mt-4 text-sm font-medium text-[#0F172A]">{getStrategyAction(segment.type, segment)}</p><p className="mt-2 text-sm leading-6 text-[#64748B]">Prioriser {segment.predictedHighRiskCustomers} clients exposes sur {segment.label.toLowerCase()} pour proteger {formatMadValue(segment.revenueAtRiskMad)} et contenir un churn de {segment.churnRatePct.toFixed(1)}%.</p><button type="button" onClick={() => handleApplyStrategy(segment)} className={`mt-5 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${appliedStrategyKeys.includes(segment.key) ? "bg-emerald-50 text-[#16A34A]" : "bg-[#2D6CDF] text-white hover:bg-[#1D4ED8]"}`}><Sparkles className="h-4 w-4" /><span>{appliedStrategyKeys.includes(segment.key) ? "Strategie active" : "Appliquer strategie"}</span></button></div>)}</div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className={`${panelClass} p-6`}>
          <div className="mb-4 flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-[#2D6CDF]" />
            <h2 className="text-lg font-semibold text-[#0F172A]">Churn par contrat</h2>
            <InfoTip label="Cliquez sur une barre pour filtrer la page sur le contrat correspondant." />
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={contractRows}>
              <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" />
              <XAxis dataKey="label" stroke="#64748B" />
              <YAxis stroke="#64748B" />
              <Legend />
              <RechartsTooltip />
              <Bar dataKey="actual_churn_customers" name="Churn reel" fill="#F97316" radius={[8, 8, 0, 0]} />
              <Bar
                dataKey="predicted_high_risk_customers"
                name="A risque"
                radius={[8, 8, 0, 0]}
                onClick={(_data, index) => {
                  const row = contractRows[index];
                  if (row) setSelectedContract(row.rawLabel);
                }}
              >
                {contractRows.map((row) => (
                  <Cell key={row.rawLabel} fill={selectedContract === row.rawLabel ? "#DC2626" : "#2D6CDF"} cursor="pointer" />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className={`${panelClass} p-6`}>
          <div className="mb-4 flex items-center gap-2">
            <Wallet className="h-5 w-5 text-[#16A34A]" />
            <h2 className="text-lg font-semibold text-[#0F172A]">Churn vs revenu</h2>
            <InfoTip label="Lecture croisee entre revenu a risque et taux de churn. Cliquez sur une barre pour filtrer le palier de prix." />
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={priceRows}>
              <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" />
              <XAxis dataKey="label" stroke="#64748B" />
              <YAxis yAxisId="left" stroke="#64748B" />
              <YAxis yAxisId="right" orientation="right" stroke="#DC2626" />
              <Legend />
              <RechartsTooltip formatter={(value: number, name: string) => name === "Revenu a risque" ? [formatMadValue(value), name] : [`${value.toFixed(1)}%`, name]} />
              <Bar
                yAxisId="left"
                dataKey="revenue_at_risk_mad"
                name="Revenu a risque"
                radius={[8, 8, 0, 0]}
                onClick={(_data, index) => {
                  const row = priceRows[index];
                  if (row) setSelectedPriceRange(row.rawLabel);
                }}
              >
                {priceRows.map((row) => (
                  <Cell key={row.rawLabel} fill={selectedPriceRange === row.rawLabel ? "#16A34A" : "#93C5FD"} cursor="pointer" />
                ))}
              </Bar>
              <Line yAxisId="right" type="monotone" dataKey="churn_rate_pct" name="Taux churn" stroke="#DC2626" strokeWidth={3} dot={{ r: 4 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className={`${panelClass} p-6`}>
          <div className="mb-4 flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-[#6D28D9]" />
            <h2 className="text-lg font-semibold text-[#0F172A]">Churn par service</h2>
            <InfoTip label="Cliquez sur une barre pour isoler le service internet qui concentre le risque." />
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={serviceRows}>
              <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" />
              <XAxis dataKey="label" stroke="#64748B" />
              <YAxis stroke="#64748B" />
              <RechartsTooltip formatter={(value: number) => `${value.toFixed(1)}%`} />
              <Bar
                dataKey="churn_rate_pct"
                name="Taux churn"
                radius={[8, 8, 0, 0]}
                onClick={(_data, index) => {
                  const row = serviceRows[index];
                  if (row) setSelectedInternetService(row.rawLabel);
                }}
              >
                {serviceRows.map((row) => (
                  <Cell key={row.rawLabel} fill={selectedInternetService === row.rawLabel ? "#6D28D9" : "#C4B5FD"} cursor="pointer" />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className={`${panelClass} p-6`}>
          <div className="mb-4 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-[#2D6CDF]" />
            <h2 className="text-lg font-semibold text-[#0F172A]">Evolution du churn</h2>
            <InfoTip label="Trajectoire IA avant et apres strategie. La ligne scenario se met a jour apres simulation." />
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={trajectoryData}>
              <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" />
              <XAxis dataKey="label" stroke="#64748B" />
              <YAxis stroke="#64748B" />
              <Legend />
              <RechartsTooltip formatter={(value: number) => `${value.toFixed(1)}%`} />
              <Line type="monotone" dataKey="baseline" name="Sans action" stroke="#94A3B8" strokeWidth={3} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="scenario" name={simulationReady ? "Scenario simule" : "Projection IA"} stroke="#16A34A" strokeWidth={3} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className={`${panelClass} p-6`}>
          <div className="mb-4 flex items-center gap-2">
            <Filter className="h-5 w-5 text-[#DC2626]" />
            <h2 className="text-lg font-semibold text-[#0F172A]">Croisement churn vs budget</h2>
            <InfoTip label="Clients chers et a forte probabilite de churn, a traiter avant les autres." />
          </div>
          <div className="space-y-3">
            {(crossedCustomers.length > 0 ? crossedCustomers : topCustomers.slice(0, 4)).map((customer) => (
              <div key={customer.customer_row_id} className="rounded-2xl border border-red-100 bg-red-50/50 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold text-[#0F172A]">{customer.customer_id} - {customer.department}</p>
                    <p className="mt-1 text-sm text-[#64748B]">{formatContractLabel(customer.contract)} - {formatCustomerRiskLabel(customer.risk_level)} - {formatRiskProbability(customer.risk_proba)}</p>
                  </div>
                  <p className="text-sm font-semibold text-[#0F172A]">{formatMadValue(customer.monthly_cost_mad)}</p>
                </div>
                <p className="mt-3 text-sm text-[#475569]">{customer.quickSummary}</p>
              </div>
            ))}
          </div>
        </div>

        <div className={`${panelClass} p-6`}>
          <div className="mb-4 flex items-center gap-2">
            <Download className="h-5 w-5 text-[#2D6CDF]" />
            <h2 className="text-lg font-semibold text-[#0F172A]">Exports et actions</h2>
          </div>
          <div className="space-y-3">
            {exportButtons.map((button) => (
              <button
                key={button.key}
                type="button"
                onClick={() => void handleExport(button.key, button.filename, button.headers, button.rows)}
                className={`w-full rounded-2xl border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-md ${activeExportKey === button.key ? "border-[#2D6CDF] bg-blue-50 animate-pulse" : "border-gray-200 bg-white"}`}
              >
                <div className="flex items-center gap-3">
                  <Download className="h-5 w-5 text-[#2D6CDF]" />
                  <div>
                    <p className="font-semibold text-[#0F172A]">{button.title}</p>
                    <p className="text-xs text-[#64748B]">{button.subtitle}</p>
                  </div>
                </div>
              </button>
            ))}
            <button type="button" onClick={() => navigate("/consommations")} className={`${secondaryButtonClass} w-full justify-center`}>
              <Wallet className="h-4 w-4" />
              <span>Ouvrir Consommation</span>
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className={`${panelClass} p-6`}>
          <div className="mb-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-[#2D6CDF]" />
              <h2 className="text-lg font-semibold text-[#0F172A]">Top revenu a risque</h2>
            </div>
            <p className="text-sm text-[#64748B]">{visibleCustomers.length} clients prioritaires</p>
          </div>

          <div className="space-y-4">
            {visibleCustomers.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-[#64748B]">
                Aucun client ne correspond aux filtres et priorites actuels.
              </div>
            ) : (
              visibleCustomers.slice(0, 8).map((customer) => (
                <div key={customer.customer_row_id} title={customer.recommendation_reason} className={`rounded-2xl border p-5 transition-all hover:-translate-y-0.5 hover:shadow-md ${customer.priorityLevel === "P1" ? "border-red-200 bg-red-50/40" : "border-gray-200 bg-white"}`}>
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <button type="button" onClick={() => setSelectedCustomerId(customer.customer_row_id)} className="truncate font-semibold text-[#0F172A] hover:text-[#2D6CDF]">
                          {customer.customer_id}
                        </button>
                        <Badge className={getPriorityClasses(customer.priorityLevel)}>{customer.priorityLevel}</Badge>
                        <Badge className={getCustomerRiskClasses(customer.risk_level)}>{formatCustomerRiskLabel(customer.risk_level)}</Badge>
                        {contactedCustomerIds.includes(customer.customer_row_id) ? <Badge className="border-blue-200 bg-blue-50 text-[#1D4ED8]">Contacte</Badge> : null}
                        {appliedCustomerIds.includes(customer.customer_row_id) ? <Badge className="border-emerald-200 bg-emerald-50 text-[#16A34A]">Action appliquee</Badge> : null}
                      </div>
                      <p className="mt-2 text-sm text-[#64748B]">{customer.department} - {formatContractLabel(customer.contract)} - score {formatRiskScore(customer.risk_score_100)}</p>
                      <AIRecommendationBlock
                        recommendation={customer.recommendation}
                        secondaryText={customer.quickSummary}
                        status={getRecommendationStatus(
                          customer.customer_row_id,
                          appliedCustomerIds,
                          contactedCustomerIds,
                        )}
                        severityLabel={formatCustomerRiskLabel(customer.risk_level)}
                        riskTypeLabel={customer.recommendationKindLabel}
                        scoreLabel={`Score ${formatRiskScore(customer.risk_score_100)}`}
                        compact
                        previewLength={112}
                        className="mt-3"
                      />
                    </div>

                    <div className="min-w-[180px] xl:text-right">
                      <p className="text-sm text-[#64748B]">Revenu expose</p>
                      <p className="text-xl font-semibold text-[#0F172A]">{formatMadValue(customer.revenue_at_risk_mad)}</p>
                      <p className="mt-2 text-sm text-[#64748B]">Probabilite {formatRiskProbability(customer.risk_proba)}</p>
                      <p className="text-sm text-[#64748B]">Action: {customer.recommendationKindLabel}</p>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" onClick={() => setSelectedCustomerId(customer.customer_row_id)} className={secondaryButtonClass}>
                      <Eye className="h-4 w-4" />
                      <span>Voir detail</span>
                    </button>
                    <button type="button" onClick={() => handleContactCustomer(customer)} className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-[#1D4ED8] transition-colors hover:bg-blue-100">
                      <PhoneCall className="h-4 w-4" />
                      <span>Contacter client</span>
                    </button>
                    <button type="button" onClick={() => handleApplyCustomerAction(customer)} className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-[#16A34A] transition-colors hover:bg-emerald-100">
                      <Sparkles className="h-4 w-4" />
                      <span>Appliquer action</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <aside className={`${panelClass} h-fit p-6`}>
          {selectedCustomer ? (
            <div className="space-y-5">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-semibold text-[#0F172A]">{selectedCustomer.customer_id}</h2>
                  <Badge className={getPriorityClasses(selectedCustomer.priorityLevel)}>{selectedCustomer.priorityLevel}</Badge>
                  <Badge className={getCustomerRiskClasses(selectedCustomer.risk_level)}>{formatCustomerRiskLabel(selectedCustomer.risk_level)}</Badge>
                </div>
                <p className="mt-2 text-sm text-[#64748B]">{selectedCustomer.department} - {formatContractLabel(selectedCustomer.contract)} - {formatTenure(selectedCustomer.tenure)}</p>
              </div>

              <AIRecommendationBlock
                recommendation={selectedCustomer.recommendation}
                secondaryText={selectedCustomer.recommendation_reason}
                status={getRecommendationStatus(
                  selectedCustomer.customer_row_id,
                  appliedCustomerIds,
                  contactedCustomerIds,
                )}
                severityLabel={formatCustomerRiskLabel(selectedCustomer.risk_level)}
                riskTypeLabel={selectedCustomer.recommendationKindLabel}
                scoreLabel={`Score ${formatRiskScore(selectedCustomer.risk_score_100)}`}
                className="bg-[#F8FAFC]"
              />

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-gray-200 p-4"><p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Score churn</p><p className="mt-2 text-lg font-semibold text-[#0F172A]">{formatRiskScore(selectedCustomer.risk_score_100)}</p></div>
                <div className="rounded-2xl border border-gray-200 p-4"><p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Probabilite</p><p className="mt-2 text-lg font-semibold text-[#0F172A]">{formatRiskProbability(selectedCustomer.risk_proba)}</p></div>
                <div className="rounded-2xl border border-gray-200 p-4"><p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Revenu expose</p><p className="mt-2 text-lg font-semibold text-[#0F172A]">{formatMadValue(selectedCustomer.revenue_at_risk_mad)}</p></div>
                <div className="rounded-2xl border border-gray-200 p-4"><p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Gain estime</p><p className="mt-2 text-lg font-semibold text-[#16A34A]">{formatMadValue(selectedCustomer.simulatedFinancialGainMad)}</p></div>
              </div>

              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#64748B]">Facteurs cles</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedCustomer.key_factors.map((factor) => (
                    <span key={factor} className="rounded-full border border-gray-200 bg-[#F8FAFC] px-3 py-1 text-xs font-medium text-[#475569]">
                      {formatCustomerFactorLabel(factor)}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#64748B]">Pourquoi cette priorite</p>
                <div className="mt-3 space-y-2">
                  {selectedCustomer.whyRecommendation.map((reason) => (
                    <div key={reason} className="rounded-xl bg-[#F8FAFC] px-3 py-2 text-sm text-[#475569]">
                      {reason}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="py-10 text-center text-sm text-[#64748B]">
              Selectionnez un client pour examiner la recommandation IA en detail.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
