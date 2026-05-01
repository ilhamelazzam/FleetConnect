import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Brain,
  Building2,
  ChevronDown,
  ChevronUp,
  Database,
  Filter,
  Globe2,
  Package2,
  PhoneCall,
  PiggyBank,
  Search,
  ShieldAlert,
  Smartphone,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import KPICard from "../components/KPICard";
import AIRiskInsightCard from "../components/AIRiskInsightCard";
import DashboardSection from "../components/dashboard/DashboardSection";
import WidgetVisibilityManager from "../components/dashboard/WidgetVisibilityManager";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { useAuth } from "../context/AuthContext";
import {
  useDashboardPreferences,
  type DashboardWidgetDefinition,
} from "../hooks/useDashboardPreferences";
import {
  ApiError,
  cdrAnalyticsApi,
  customerChurnApi,
  mobileFleetApi,
  type ApiCdrOverview,
  type ApiCdrRecommendationList,
  type ApiCustomerChurnOverview,
  type ApiMobileFleetFilters,
  type ApiMobileFleetOverview,
} from "../lib/api";
import {
  buildCriticalRisks,
  buildCustomerExplanation,
  buildDepartmentInsights,
  buildFraudExplanation,
  buildMobileExplanation,
  buildPriorityActions,
  getDashboardRiskRank,
  mergeFraudPriorityAlerts,
  type DashboardRiskLevel,
} from "../lib/dashboard-insights";
import {
  formatCallZoneLabel,
  formatCdrDateTime,
  formatFraudTypeLabel,
  formatMadValue as formatCdrMadValue,
  formatSeverityLabel,
  getSeverityChartColor,
} from "../lib/cdr-analytics";
import {
  formatContractLabel,
  formatChurnLabel,
  formatCustomerFactorLabel,
  formatCustomerRiskLabel,
  formatMadValue as formatCustomerMadValue,
  formatRiskProbability,
  formatRiskScore,
  formatTenure,
  getChurnClasses,
  getCustomerRiskClasses,
  getCustomerRiskColor,
  getOperatorStyles as getCustomerOperatorStyles,
} from "../lib/customer-churn";
import {
  formatMadValue,
  formatMobileRiskLabel,
  formatPredictionConfidence,
  getDeviceCategoryClasses,
  getDeviceCategoryColor,
  getMobileRiskClasses,
  getMobileRiskColor,
  getOperatorStyles,
} from "../lib/mobile-fleet";

function normalizeError(error: unknown, fallbackMessage: string): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallbackMessage;
}

function formatBudgetAxisTick(value: number): string {
  if (value === 0) {
    return "0";
  }

  return new Intl.NumberFormat("fr-FR", {
    notation: "compact",
    maximumFractionDigits: value >= 1_000_000 ? 1 : 0,
  }).format(value);
}

function formatRiskScoreLabel(value: number): string {
  return `${value.toFixed(1)}/100`;
}

function formatAlertVolumeTick(value: number): string {
  return new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatIntegerTick(value: number): string {
  return new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 0,
  }).format(value);
}

function getRiskStyles(riskLevel: DashboardRiskLevel): {
  badge: string;
  panel: string;
  icon: string;
} {
  if (riskLevel === "Critique") {
    return {
      badge: "border-red-200 bg-red-50 text-[#DC2626]",
      panel: "border-red-200 bg-[linear-gradient(135deg,#FFF1F2,#FFFFFF)]",
      icon: "bg-red-50 text-[#DC2626]",
    };
  }
  if (riskLevel === "Eleve") {
    return {
      badge: "border-orange-200 bg-orange-50 text-[#F97316]",
      panel: "border-orange-200 bg-[linear-gradient(135deg,#FFF7ED,#FFFFFF)]",
      icon: "bg-orange-50 text-[#F97316]",
    };
  }
  if (riskLevel === "Moyen") {
    return {
      badge: "border-amber-200 bg-amber-50 text-[#CA8A04]",
      panel: "border-amber-200 bg-[linear-gradient(135deg,#FFFBEB,#FFFFFF)]",
      icon: "bg-amber-50 text-[#CA8A04]",
    };
  }
  return {
    badge: "border-emerald-200 bg-emerald-50 text-[#16A34A]",
    panel: "border-emerald-200 bg-[linear-gradient(135deg,#ECFDF5,#FFFFFF)]",
    icon: "bg-emerald-50 text-[#16A34A]",
  };
}

function getModuleStyles(moduleName: string): { badge: string; icon: string } {
  if (moduleName === "Flotte mobile" || moduleName === "Mobile") {
    return {
      badge: "border-blue-200 bg-blue-50 text-[#2563EB]",
      icon: "bg-blue-50 text-[#2563EB]",
    };
  }
  if (moduleName === "Risque client" || moduleName === "Churn") {
    return {
      badge: "border-emerald-200 bg-emerald-50 text-[#059669]",
      icon: "bg-emerald-50 text-[#059669]",
    };
  }
  return {
    badge: "border-violet-200 bg-violet-50 text-[#7C3AED]",
    icon: "bg-violet-50 text-[#7C3AED]",
  };
}

const integratedDatasetCards = [
  {
    id: "mobile",
    title: "Referentiel analytique flotte mobile",
    description: "Donnees preparees pour l'analyse des forfaits mobiles",
    icon: Smartphone,
    panelClassName:
      "border-[#DBEAFE] bg-[radial-gradient(circle_at_top_right,_rgba(59,130,246,0.12),_transparent_32%),linear-gradient(180deg,_rgba(255,255,255,0.96),_rgba(248,250,252,0.94))]",
    iconClassName: "bg-[#EFF6FF] text-[#2563EB]",
    accentClassName: "from-[#60A5FA] via-[#3B82F6] to-[#1D4ED8]",
  },
  {
    id: "churn",
    title: "Referentiel analytique retention client",
    description: "Donnees enrichies pour la prediction du churn client",
    icon: Users,
    panelClassName:
      "border-[#D1FAE5] bg-[radial-gradient(circle_at_top_right,_rgba(16,185,129,0.12),_transparent_32%),linear-gradient(180deg,_rgba(255,255,255,0.96),_rgba(248,250,252,0.94))]",
    iconClassName: "bg-[#ECFDF5] text-[#059669]",
    accentClassName: "from-[#6EE7B7] via-[#10B981] to-[#059669]",
  },
  {
    id: "fraud",
    title: "Referentiel analytique fraude telecom",
    description: "Donnees consolidees pour la detection de fraude telecom",
    icon: ShieldAlert,
    panelClassName:
      "border-[#E9D5FF] bg-[radial-gradient(circle_at_top_right,_rgba(124,58,237,0.12),_transparent_32%),linear-gradient(180deg,_rgba(255,255,255,0.96),_rgba(248,250,252,0.94))]",
    iconClassName: "bg-[#F5F3FF] text-[#7C3AED]",
    accentClassName: "from-[#C4B5FD] via-[#8B5CF6] to-[#7C3AED]",
  },
] as const;

const dashboardWidgets: DashboardWidgetDefinition[] = [
  {
    id: "source-cards",
    label: "Referentiels analytiques",
    description: "Cartes de cadrage des referentiels analytiques mobilite, retention et fraude.",
    defaultVisible: false,
  },
  {
    id: "executive-summary",
    label: "Synthese executive",
    description: "KPI prioritaires et top 5 des arbitrages a traiter.",
    defaultVisible: true,
  },
  {
    id: "cross-insights",
    label: "Insights croises",
    description: "Analyse combinee budget, churn et fraude par departement.",
    defaultVisible: false,
  },
  {
    id: "analysis-modules",
    label: "Modules d'analyse",
    description: "Onglets detailles: flotte mobile, risque client et fraude CDR.",
    defaultVisible: true,
  },
];

export default function Dashboard() {
  const { token, user } = useAuth();
  const dashboardPreferences = useDashboardPreferences("decision-dashboard", dashboardWidgets, user?.email);
  const [overview, setOverview] = useState<ApiMobileFleetOverview | null>(null);
  const [portfolioOverview, setPortfolioOverview] = useState<ApiMobileFleetOverview | null>(null);
  const [filters, setFilters] = useState<ApiMobileFleetFilters | null>(null);
  const [customerOverview, setCustomerOverview] = useState<ApiCustomerChurnOverview | null>(null);
  const [cdrOverview, setCdrOverview] = useState<ApiCdrOverview | null>(null);
  const [cdrRecommendations, setCdrRecommendations] = useState<ApiCdrRecommendationList | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPortfolioLoading, setIsPortfolioLoading] = useState(true);
  const [isCustomerLoading, setIsCustomerLoading] = useState(true);
  const [isCdrLoading, setIsCdrLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [portfolioErrorMessage, setPortfolioErrorMessage] = useState<string | null>(null);
  const [customerErrorMessage, setCustomerErrorMessage] = useState<string | null>(null);
  const [cdrErrorMessage, setCdrErrorMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedOperator, setSelectedOperator] = useState("all");
  const [selectedDepartment, setSelectedDepartment] = useState("all");
  const [selectedProfile, setSelectedProfile] = useState("all");
  const [selectedDeviceCategory, setSelectedDeviceCategory] = useState("all");
  const [selectedRiskLevel, setSelectedRiskLevel] = useState("all");
  const [isPortfolioDetailsOpen, setIsPortfolioDetailsOpen] = useState(false);
  const [activeModule, setActiveModule] = useState("mobile");
  const [showAllMobileDevices, setShowAllMobileDevices] = useState(false);
  const [showAllCustomers, setShowAllCustomers] = useState(false);
  const [showAllFraudAlerts, setShowAllFraudAlerts] = useState(false);

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
          setErrorMessage(normalizeError(error, "Impossible de charger les filtres flotte mobile."));
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

    async function loadOverview() {
      if (!token) {
        if (isMounted) {
          setOverview(null);
          setIsLoading(false);
        }
        return;
      }

      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await mobileFleetApi.overview(token, {
          search: searchQuery.trim() || undefined,
          operator: selectedOperator !== "all" ? selectedOperator : undefined,
          department: selectedDepartment !== "all" ? selectedDepartment : undefined,
          employee_profile: selectedProfile !== "all" ? selectedProfile : undefined,
          device_category: selectedDeviceCategory !== "all" ? selectedDeviceCategory : undefined,
          risk_level: selectedRiskLevel !== "all" ? selectedRiskLevel : undefined,
        });

        if (isMounted) {
          setOverview(response);
        }
      } catch (error) {
        if (isMounted) {
          setOverview(null);
          setErrorMessage(normalizeError(error, "Impossible de charger le dashboard flotte mobile."));
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadOverview();

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

  useEffect(() => {
    let isMounted = true;

    async function loadPortfolioOverview() {
      if (!token) {
        if (isMounted) {
          setPortfolioOverview(null);
          setIsPortfolioLoading(false);
        }
        return;
      }

      setIsPortfolioLoading(true);
      setPortfolioErrorMessage(null);

      try {
        const response = await mobileFleetApi.overview(token);
        if (isMounted) {
          setPortfolioOverview(response);
        }
      } catch (error) {
        if (isMounted) {
          setPortfolioOverview(null);
          setPortfolioErrorMessage(
            normalizeError(error, "Impossible de charger la synthese portefeuille mobile."),
          );
        }
      } finally {
        if (isMounted) {
          setIsPortfolioLoading(false);
        }
      }
    }

    void loadPortfolioOverview();

    return () => {
      isMounted = false;
    };
  }, [token]);

  useEffect(() => {
    let isMounted = true;

    async function loadCustomerOverview() {
      if (!token) {
        if (isMounted) {
          setCustomerOverview(null);
          setIsCustomerLoading(false);
        }
        return;
      }

      setIsCustomerLoading(true);
      setCustomerErrorMessage(null);

      try {
        const response = await customerChurnApi.overview(token);
        if (isMounted) {
          setCustomerOverview(response);
        }
      } catch (error) {
        if (isMounted) {
          setCustomerOverview(null);
          setCustomerErrorMessage(normalizeError(error, "Impossible de charger le bloc churn."));
        }
      } finally {
        if (isMounted) {
          setIsCustomerLoading(false);
        }
      }
    }

    void loadCustomerOverview();

    return () => {
      isMounted = false;
    };
  }, [token]);

  useEffect(() => {
    let isMounted = true;

    async function loadFraudOverview() {
      if (!token) {
        if (isMounted) {
          setCdrOverview(null);
          setCdrRecommendations(null);
          setIsCdrLoading(false);
        }
        return;
      }

      setIsCdrLoading(true);
      setCdrErrorMessage(null);

      try {
        const [overviewResponse, recommendationsResponse] = await Promise.all([
          cdrAnalyticsApi.overview(token),
          cdrAnalyticsApi.recommendations(token, { limit: 8 }),
        ]);

        if (isMounted) {
          setCdrOverview(overviewResponse);
          setCdrRecommendations(recommendationsResponse);
        }
      } catch (error) {
        if (isMounted) {
          setCdrOverview(null);
          setCdrRecommendations(null);
          setCdrErrorMessage(normalizeError(error, "Impossible de charger les alertes CDR."));
        }
      } finally {
        if (isMounted) {
          setIsCdrLoading(false);
        }
      }
    }

    void loadFraudOverview();

    return () => {
      isMounted = false;
    };
  }, [token]);

  const resetFilters = () => {
    setSearchQuery("");
    setSelectedOperator("all");
    setSelectedDepartment("all");
    setSelectedProfile("all");
    setSelectedDeviceCategory("all");
    setSelectedRiskLevel("all");
  };

  const kpis = overview?.kpis;
  const churnKpis = customerOverview?.kpis;
  const fraudKpis = cdrOverview?.kpis;
  const decisionWarnings = [
    portfolioErrorMessage,
    customerErrorMessage,
    cdrErrorMessage,
  ].filter((message): message is string => Boolean(message));
  const isDecisionLoading = isPortfolioLoading || isCustomerLoading || isCdrLoading;
  const priorityFraudAlerts = mergeFraudPriorityAlerts(cdrOverview, cdrRecommendations?.items ?? []);
  const priorityActions = buildPriorityActions(portfolioOverview, customerOverview, priorityFraudAlerts);
  const criticalRisks = buildCriticalRisks(portfolioOverview, customerOverview, priorityFraudAlerts);
  const departmentInsights = buildDepartmentInsights(portfolioOverview, customerOverview, cdrOverview);
  const visibleDepartmentInsights = departmentInsights.slice(0, 6);
  const mostExposedDepartment =
    visibleDepartmentInsights.length > 0
      ? visibleDepartmentInsights.reduce((currentLeader, insight) =>
          insight.financialExposureMad > currentLeader.financialExposureMad
            ? insight
            : currentLeader,
        )
      : null;
  const shouldRotateInsightTicks = visibleDepartmentInsights.length > 4;
  const fraudZoneHotspots = Object.values(
    priorityFraudAlerts.reduce<
      Record<string, { callZone: string; alerts: number; critical: number; cost: number; maxScore: number }>
    >((accumulator, alert) => {
      const currentZone = accumulator[alert.call_zone] ?? {
        callZone: alert.call_zone,
        alerts: 0,
        critical: 0,
        cost: 0,
        maxScore: 0,
      };

      currentZone.alerts += 1;
      currentZone.critical += alert.severity === "critique" ? 1 : 0;
      currentZone.cost += alert.call_cost_mad;
      currentZone.maxScore = Math.max(currentZone.maxScore, alert.fraud_risk_score_100);
      accumulator[alert.call_zone] = currentZone;
      return accumulator;
    }, {}),
  ).sort(
    (left, right) =>
      right.critical - left.critical || right.maxScore - left.maxScore || right.cost - left.cost,
  );
  const totalPortfolioExposure = departmentInsights.reduce(
    (sum, insight) => sum + insight.financialExposureMad,
    0,
  );
  const totalPrioritySignals =
    (portfolioOverview?.kpis.alert_devices ?? 0) +
    (churnKpis?.high_risk_customers ?? 0) +
    (fraudKpis?.suspicious_calls ?? 0);
  const deviceCategoryChartData = overview?.devices_by_category ?? [];
  const totalCategorizedDevices = deviceCategoryChartData.reduce(
    (sum, category) => sum + category.count,
    0,
  );
  const dominantDeviceCategory =
    deviceCategoryChartData.length > 0
      ? deviceCategoryChartData.reduce((currentLeader, category) =>
          category.count > currentLeader.count ? category : currentLeader,
        )
      : null;
  const shouldRotateDeviceCategoryTicks =
    deviceCategoryChartData.length > 4 ||
    deviceCategoryChartData.some((category) => category.label.length > 14);
  const mobileDevices = overview?.top_devices ?? [];
  const visibleMobileDevices = showAllMobileDevices ? mobileDevices : mobileDevices.slice(0, 5);
  const atRiskCustomers = customerOverview?.top_at_risk_customers ?? [];
  const visibleCustomers = showAllCustomers ? atRiskCustomers : atRiskCustomers.slice(0, 5);
  const fraudAlerts = priorityFraudAlerts ?? [];
  const visibleFraudAlerts = showAllFraudAlerts ? fraudAlerts : fraudAlerts.slice(0, 5);
  const executiveSummaryItems = [
    ...priorityActions.map((action) => ({
      id: action.id,
      severity: action.severity,
      module: action.module,
      title: action.title,
      summary: action.summary,
      note: action.metric,
      recommendation: action.recommendation,
      suggestedAction: action.suggestedAction,
      confidenceScore: action.confidenceScore,
      type: "Action",
    })),
    ...criticalRisks.map((risk) => ({
      id: risk.id,
      severity: risk.severity,
      module: risk.module === "Mobile" ? "Flotte mobile" : risk.module === "Churn" ? "Risque client" : "Fraude CDR",
      title: risk.title,
      summary: risk.context,
      note: risk.scoreLabel,
      recommendation: risk.recommendation,
      suggestedAction: risk.suggestedAction,
      confidenceScore: risk.confidenceScore,
      type: "Risque",
    })),
  ]
    .sort(
      (left, right) =>
        getDashboardRiskRank(left.severity) - getDashboardRiskRank(right.severity) ||
        left.type.localeCompare(right.type) ||
        left.title.localeCompare(right.title),
    )
    .slice(0, 5);
  const departmentBudgetChartData = (overview?.budget_by_department ?? []).map((department) => ({
    ...department,
    priorityExposureMad:
      (department.total_estimated_price_mad * department.average_budget_risk_score) / 100,
  }));
  const mobileLeadDepartment =
    departmentBudgetChartData.length > 0
      ? departmentBudgetChartData.reduce((currentLeader, department) => {
          if (department.priorityExposureMad > currentLeader.priorityExposureMad) {
            return department;
          }
          if (department.priorityExposureMad < currentLeader.priorityExposureMad) {
            return currentLeader;
          }
          if (
            department.average_budget_risk_score >
            currentLeader.average_budget_risk_score
          ) {
            return department;
          }
          if (
            department.average_budget_risk_score <
            currentLeader.average_budget_risk_score
          ) {
            return currentLeader;
          }
          return department.total_estimated_price_mad >
            currentLeader.total_estimated_price_mad
            ? department
            : currentLeader;
        })
      : null;
  const shouldRotateDepartmentTicks = departmentBudgetChartData.length > 4;
  const churnLeadContract = customerOverview?.churn_by_contract
    ?.slice()
    .sort(
      (left, right) =>
        right.predicted_high_risk_customers - left.predicted_high_risk_customers ||
        right.revenue_at_risk_mad - left.revenue_at_risk_mad,
    )[0];
  const churnByContractData = (customerOverview?.churn_by_contract ?? []).map((item) => ({
    ...item,
    label: formatContractLabel(item.label),
  }));
  const fraudLeadOperator = cdrOverview?.cost_by_operator?.[0];

  return (
    <div className="space-y-8 p-6">
      <section className="overflow-hidden rounded-[28px] border border-[#DCE5F1] bg-[radial-gradient(circle_at_top_right,_rgba(59,130,246,0.14),_transparent_30%),radial-gradient(circle_at_top_left,_rgba(245,158,11,0.12),_transparent_26%),linear-gradient(135deg,_#FFFFFF,_#F8FAFC)] p-6 shadow-[0_24px_60px_-36px_rgba(15,23,42,0.35)]">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-3xl">
              <Badge className="border-[#BFDBFE] bg-[#EFF6FF] px-3 py-1 text-[#1D4ED8]">
                Systeme decisionnel telecom pilote par l'IA
              </Badge>
              <h1 className="mt-4 text-3xl font-bold tracking-[-0.03em] text-[#0F172A]">
                Dashboard decisionnel
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-[#475569]">
                Ce tableau de bord decisionnel permet d'optimiser la gestion de la flotte mobile et de
                reduire le risque client en combinant analytique predictive et indicateurs de pilotage metier.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Badge className="border-[#DCE5F1] bg-white px-3 py-1 text-[#475569]">
                3 domaines analytiques integres
              </Badge>
              <Badge className="border-[#DCE5F1] bg-white px-3 py-1 text-[#475569]">
                BI + analytique predictive
              </Badge>
              <Badge className="border-[#DCE5F1] bg-white px-3 py-1 text-[#475569]">
                Exposition portefeuille {formatMadValue(totalPortfolioExposure)}
              </Badge>
            </div>
          </div>

          {dashboardPreferences.isWidgetVisible("source-cards") ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              {integratedDatasetCards.map((card) => {
                const Icon = card.icon;

                return (
                  <div
                    key={card.id}
                    className={`group relative overflow-hidden rounded-2xl border p-6 shadow-sm backdrop-blur transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_22px_45px_-32px_rgba(15,23,42,0.32)] ${card.panelClassName}`}
                  >
                    <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${card.accentClassName}`} />

                    <div className="flex min-h-[172px] flex-col justify-center gap-6">
                      <div className="flex items-start gap-4">
                        <div className={`rounded-xl p-3 shadow-sm ${card.iconClassName}`}>
                          <Icon className="h-5 w-5" />
                        </div>
                        <div className="max-w-[15rem] pt-0.5">
                          <p className="text-[15px] font-semibold leading-8 text-[#0F172A] sm:text-[17px]">
                            {card.title}
                          </p>
                        </div>
                      </div>

                      <p className="max-w-[30ch] text-sm leading-6 text-[#64748B]">
                        {card.description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </section>

      <WidgetVisibilityManager
        widgets={dashboardWidgets}
        visibility={dashboardPreferences.visibility}
        visibleCount={dashboardPreferences.visibleCount}
        onChange={dashboardPreferences.setWidgetVisible}
        onReset={dashboardPreferences.resetVisibility}
      />

      {decisionWarnings.length > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-[#92400E]">
          Certains modules decisionnels sont partiels: {decisionWarnings.join(" ")}
        </div>
      ) : null}

      <DashboardSection isVisible={dashboardPreferences.isWidgetVisible("executive-summary")}>
      <section className="rounded-[28px] border border-[#DCE5F1] bg-white p-6 shadow-[0_24px_60px_-40px_rgba(15,23,42,0.25)]">
        <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
          <div className="space-y-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-[#0F172A]">Synthese executive</h2>
                <p className="mt-1 text-sm text-[#64748B]">
                  Lecture compacte des enjeux a presenter en soutenance ou en comite de pilotage.
                </p>
              </div>
              <Badge className="border-[#DCE5F1] bg-[#F8FAFC] px-3 py-1 text-[#475569]">
                Top 5 priorites uniquement
              </Badge>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <KPICard
                title="Exposition portefeuille"
                value={formatMadValue(totalPortfolioExposure)}
                description="Budget mobile + revenu client a risque"
                icon={Wallet}
                color="green"
                emphasis="strong"
              />
              <KPICard
                title="Signaux prioritaires"
                value={String(totalPrioritySignals)}
                description="Appareils, churn et fraude a traiter"
                icon={AlertTriangle}
                color="red"
                emphasis="strong"
              />
              <KPICard
                title="Actions urgentes"
                value={String(priorityActions.length)}
                description="Plans de mitigation immediats"
                icon={Brain}
                color="orange"
              />
              <KPICard
                title="Exposition fraude"
                value={formatCdrMadValue(fraudKpis?.suspicious_cost_exposure_mad ?? 0)}
                description="Montant des appels suspects"
                icon={ShieldAlert}
                color="purple"
              />
            </div>
          </div>

          <div className="rounded-2xl border border-[#E2E8F0] bg-[linear-gradient(180deg,#F8FAFC,#FFFFFF)] p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Focus executif</p>
                <h3 className="mt-2 text-lg font-semibold text-[#0F172A]">Priorites a arbitrer</h3>
              </div>
              <Badge className="border-red-200 bg-red-50 px-3 py-1 text-[#DC2626]">Severite d'abord</Badge>
            </div>

            <div className="mt-5 space-y-3">
              {executiveSummaryItems.length === 0 ? (
                <div className="rounded-xl bg-white px-4 py-8 text-sm text-[#64748B]">
                  Aucune priorite executive disponible.
                </div>
              ) : (
                executiveSummaryItems.map((item) => {
                  const riskStyles = getRiskStyles(item.severity);
                  const moduleStyles = getModuleStyles(item.module);

                  return (
                    <div key={item.id} className={`rounded-2xl border bg-white p-4 ${riskStyles.panel}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge className={riskStyles.badge}>{item.severity}</Badge>
                            <Badge className={moduleStyles.badge}>{item.module}</Badge>
                            <span className="text-xs font-medium uppercase tracking-[0.14em] text-[#64748B]">
                              {item.type}
                            </span>
                          </div>
                          <h4 className="mt-3 text-sm font-semibold text-[#0F172A]">{item.title}</h4>
                          <p className="mt-1 text-sm leading-6 text-[#475569]">{item.summary}</p>
                          <div className="mt-3 rounded-lg border border-white/80 bg-white/85 p-3">
                            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#64748B]">
                              <Brain className="h-3.5 w-3.5" />
                              <span>Recommandation IA</span>
                            </div>
                            <p className="mt-2 text-sm font-medium leading-6 text-[#0F172A]">
                              {item.recommendation}
                            </p>
                          </div>
                        </div>
                        <p className="text-right text-xs font-medium uppercase tracking-[0.14em] text-[#64748B]">
                          {item.note}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <Collapsible open={isPortfolioDetailsOpen} onOpenChange={setIsPortfolioDetailsOpen} className="mt-6 border-t border-[#E2E8F0] pt-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-[#0F172A]">Detail decisionnel portefeuille</h3>
              <p className="mt-1 text-sm text-[#64748B]">
                Actions prioritaires, top risques critiques et rationale IA pour la prise de decision.
              </p>
            </div>

            <CollapsibleTrigger asChild>
              <Button variant="outline" className="rounded-xl border-[#DCE5F1]">
                {isPortfolioDetailsOpen ? "Masquer le detail" : "Voir le detail"}
                {isPortfolioDetailsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            </CollapsibleTrigger>
          </div>

          <CollapsibleContent className="space-y-6 pt-6">
            <div className="space-y-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-[#0F172A]">Actions prioritaires</h3>
                  <p className="mt-1 text-sm text-[#64748B]">
                    Vue portefeuille globale alignee sur les trois modules pour guider les decisions immediates.
                  </p>
                </div>
                <Badge className="border-[#DCE5F1] bg-white px-3 py-1 text-[#475569]">
                  Actions reliees a des scores, revenus et couts reels
                </Badge>
              </div>

              {isDecisionLoading ? (
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <div
                      key={index}
                      className="h-[240px] rounded-2xl border border-gray-200 bg-white/90 p-5 shadow-sm"
                    />
                  ))}
                </div>
              ) : priorityActions.length === 0 ? (
                <div className="rounded-2xl border border-gray-200 bg-white px-6 py-10 text-sm text-[#64748B]">
                  Aucune action prioritaire disponible pour le moment.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                  {priorityActions.map((action) => (
                    <AIRiskInsightCard
                      key={action.id}
                      riskId={action.id}
                      moduleLabel={action.module}
                      title={action.title}
                      severity={action.severity}
                      description={action.summary}
                      impact={`${action.metric} - ${action.detail}`}
                      cause={action.explanation}
                      aiRecommendation={action.recommendation}
                      suggestedAction={action.suggestedAction}
                      confidenceScore={action.confidenceScore}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-[28px] border border-red-100 bg-[linear-gradient(135deg,#FFF1F2,#FFFFFF)] p-6 shadow-[0_24px_50px_-42px_rgba(220,38,38,0.45)]">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <div className="flex items-center gap-2 text-[#DC2626]">
                    <AlertTriangle className="h-5 w-5" />
                    <h3 className="text-lg font-semibold text-[#0F172A]">Top risques critiques</h3>
                  </div>
                  <p className="mt-2 text-sm text-[#64748B]">
                    Liste triee par severite d'abord, puis par exposition budgetaire ou revenu a proteger.
                  </p>
                </div>
                <Badge className="border-red-200 bg-white px-3 py-1 text-[#DC2626]">
                  Critique en rouge, actions a traiter en priorite
                </Badge>
              </div>

              {isDecisionLoading ? (
                <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-3">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <div key={index} className="h-[220px] rounded-2xl border border-red-100 bg-white/90 p-4" />
                  ))}
                </div>
              ) : criticalRisks.length === 0 ? (
                <div className="mt-5 rounded-2xl border border-red-100 bg-white/90 px-6 py-10 text-sm text-[#64748B]">
                  Aucun risque critique disponible.
                </div>
              ) : (
                <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-3">
                  {criticalRisks.slice(0, 5).map((risk) => (
                    <AIRiskInsightCard
                      key={risk.id}
                      riskId={risk.id}
                      moduleLabel={risk.module}
                      title={risk.title}
                      severity={risk.severity}
                      description={risk.context}
                      impact={`${risk.impact} - ${risk.scoreLabel}`}
                      cause={risk.explanation}
                      aiRecommendation={risk.recommendation}
                      suggestedAction={risk.suggestedAction}
                      confidenceScore={risk.confidenceScore}
                    />
                  ))}
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </section>
      </DashboardSection>

      <DashboardSection isVisible={dashboardPreferences.isWidgetVisible("cross-insights")}>
      <section className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-[#0F172A]">Insights croises</h2>
            <p className="mt-1 text-sm text-[#64748B]">
              Lien entre budget device, risque churn et exposition fraude pour identifier les zones
              telecom a arbitrer.
            </p>
          </div>
          <Badge className="border-[#DCE5F1] bg-white px-3 py-1 text-[#475569]">
            Exposition combinee = budget mobile + revenu a risque
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.65fr_1fr]">
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h3 className="text-lg font-semibold text-[#0F172A]">
                  Exposition financiere et volume d'alertes par departement
                </h3>
                <p className="mt-1 text-sm text-[#64748B]">
                  Croisement de l'exposition financiere et du volume d'alertes afin d'identifier
                  les departements necessitant une vigilance prioritaire.
                </p>
              </div>
              {mostExposedDepartment ? (
                <Badge className="border-[#DCE5F1] bg-white px-3 py-1 text-[#475569]">
                  Departement le plus expose : {mostExposedDepartment.department}
                </Badge>
              ) : null}
            </div>

            {departmentInsights.length === 0 ? (
              <div className="rounded-xl bg-[#F8FAFC] px-4 py-8 text-sm text-[#64748B]">
                Aucun insight croise disponible.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={340}>
                <ComposedChart
                  data={visibleDepartmentInsights}
                  margin={{
                    top: 20,
                    right: 28,
                    left: 20,
                    bottom: shouldRotateInsightTicks ? 30 : 10,
                  }}
                >
                  <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="department"
                    stroke="#64748B"
                    interval={0}
                    minTickGap={0}
                    tickMargin={10}
                    height={shouldRotateInsightTicks ? 58 : 42}
                    angle={shouldRotateInsightTicks ? -12 : 0}
                    textAnchor={shouldRotateInsightTicks ? "end" : "middle"}
                    tick={{ fontSize: 12 }}
                    padding={{ left: 14, right: 14 }}
                  />
                  <YAxis
                    yAxisId="left"
                    stroke="#64748B"
                    width={78}
                    tickMargin={8}
                    tickFormatter={formatBudgetAxisTick}
                    label={{
                      value: "Exposition financiere (MAD)",
                      angle: -90,
                      position: "insideLeft",
                      style: { fill: "#64748B", fontSize: 12, fontWeight: 500 },
                    }}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    stroke="#DC2626"
                    width={78}
                    tickMargin={8}
                    allowDecimals={false}
                    tickFormatter={formatAlertVolumeTick}
                    label={{
                      value: "Volume d'alertes",
                      angle: 90,
                      position: "insideRight",
                      style: { fill: "#DC2626", fontSize: 12, fontWeight: 500 },
                    }}
                  />
                  <Legend />
                  <Tooltip
                    labelFormatter={(value: string) => `Departement : ${value}`}
                    formatter={(value: number, name: string) => {
                      if (name === "Exposition financiere (MAD)") {
                        return [formatMadValue(Number(value)), name];
                      }
                      return [`${formatAlertVolumeTick(Number(value))} alertes`, name];
                    }}
                  />
                  <Bar
                    yAxisId="left"
                    dataKey="financialExposureMad"
                    fill="#0F172A"
                    name="Exposition financiere (MAD)"
                    radius={[10, 10, 0, 0]}
                  />
                  <Line
                    yAxisId="right"
                    type="linear"
                    dataKey="attentionPoints"
                    stroke="#DC2626"
                    strokeWidth={3.5}
                    dot={{ r: 5, strokeWidth: 3, fill: "#FFFFFF" }}
                    activeDot={{ r: 6, strokeWidth: 2, fill: "#FFFFFF" }}
                    name="Volume d'alertes"
                  >
                    <LabelList
                      dataKey="attentionPoints"
                      formatter={(value: number) => formatAlertVolumeTick(value)}
                      position="top"
                      offset={10}
                      fill="#DC2626"
                      fontSize={11}
                      fontWeight={600}
                    />
                  </Line>
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="space-y-4">
            {departmentInsights.slice(0, 3).map((insight) => {
              const riskStyles = getRiskStyles(insight.severity);
              return (
                <div key={insight.department} className={`rounded-2xl border bg-white p-5 shadow-sm ${riskStyles.panel}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.16em] text-[#64748B]">Focus departement</p>
                        <h3 className="mt-2 text-lg font-semibold text-[#0F172A]">{insight.department}</h3>
                      </div>
                    <Badge className={riskStyles.badge}>{insight.severity}</Badge>
                  </div>

                  <p className="mt-3 text-sm leading-6 text-[#475569]">{insight.summary}</p>

                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-xl bg-[#F8FAFC] p-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-[#64748B]">Budget mobile</p>
                      <p className="mt-2 font-semibold text-[#0F172A]">{formatMadValue(insight.mobileBudgetMad)}</p>
                    </div>
                    <div className="rounded-xl bg-[#F8FAFC] p-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-[#64748B]">Revenu a risque</p>
                      <p className="mt-2 font-semibold text-[#0F172A]">
                        {formatCustomerMadValue(insight.churnRevenueAtRiskMad)}
                      </p>
                    </div>
                    <div className="rounded-xl bg-[#F8FAFC] p-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-[#64748B]">Alertes devices</p>
                      <p className="mt-2 font-semibold text-[#0F172A]">{insight.mobileAlertDevices}</p>
                    </div>
                    <div className="rounded-xl bg-[#F8FAFC] p-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-[#64748B]">Alertes fraude</p>
                      <p className="mt-2 font-semibold text-[#0F172A]">{insight.fraudAlerts}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
      </DashboardSection>

      <DashboardSection isVisible={dashboardPreferences.isWidgetVisible("analysis-modules")}>
      <Tabs value={activeModule} onValueChange={setActiveModule} className="space-y-6">
        <div className="rounded-[28px] border border-[#DCE5F1] bg-[linear-gradient(180deg,#FFFFFF,#F8FAFC)] p-5 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-[#0F172A]">Modules d'analyse</h2>
              <p className="mt-1 text-sm text-[#64748B]">
                Un seul module detaille a la fois pour accelerer la lecture et garder le focus.
              </p>
            </div>
            <Badge className="border-[#DCE5F1] bg-white px-3 py-1 text-[#475569]">
              Detail complet conserve dans chaque onglet
            </Badge>
          </div>

          <TabsList className="mt-5 grid h-auto w-full grid-cols-1 gap-3 bg-transparent p-0 md:grid-cols-3">
            <TabsTrigger
              value="mobile"
              className="h-auto rounded-2xl border border-[#DCE5F1] bg-white px-4 py-4 text-left data-[state=active]:border-[#93C5FD] data-[state=active]:bg-[#EFF6FF]"
            >
              <div className="w-full text-left">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-[#0F172A]">Flotte mobile</span>
                  <Badge className="border-blue-200 bg-blue-50 text-[#2563EB]">
                    {portfolioOverview?.kpis.critical_risks ?? 0} critiques
                  </Badge>
                </div>
                <p className="mt-2 text-xs leading-5 text-[#64748B]">
                  {portfolioOverview?.kpis.total_devices ?? 0} appareils et{" "}
                  {formatMadValue(portfolioOverview?.kpis.total_estimated_budget_mad ?? 0)} de budget.
                </p>
              </div>
            </TabsTrigger>

            <TabsTrigger
              value="churn"
              className="h-auto rounded-2xl border border-[#DCE5F1] bg-white px-4 py-4 text-left data-[state=active]:border-[#86EFAC] data-[state=active]:bg-[#ECFDF5]"
            >
              <div className="w-full text-left">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-[#0F172A]">Risque client</span>
                  <Badge className="border-emerald-200 bg-emerald-50 text-[#059669]">
                    {churnKpis?.high_risk_customers ?? 0} clients a risque
                  </Badge>
                </div>
                <p className="mt-2 text-xs leading-5 text-[#64748B]">
                  {formatCustomerMadValue(churnKpis?.revenue_at_risk_mad ?? 0)} de revenu a proteger.
                </p>
              </div>
            </TabsTrigger>

            <TabsTrigger
              value="fraud"
              className="h-auto rounded-2xl border border-[#DCE5F1] bg-white px-4 py-4 text-left data-[state=active]:border-[#C4B5FD] data-[state=active]:bg-[#F5F3FF]"
            >
              <div className="w-full text-left">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-[#0F172A]">Fraude CDR</span>
                  <Badge className="border-violet-200 bg-violet-50 text-[#7C3AED]">
                    {fraudKpis?.critical_alerts ?? 0} alertes critiques
                  </Badge>
                </div>
                <p className="mt-2 text-xs leading-5 text-[#64748B]">
                  {formatCdrMadValue(fraudKpis?.suspicious_cost_exposure_mad ?? 0)} d'exposition suspecte.
                </p>
              </div>
            </TabsTrigger>
          </TabsList>
        </div>

      <TabsContent
        value="mobile"
        className="mt-0 rounded-[28px] border border-[#E2E8F0] bg-[linear-gradient(180deg,#FFFFFF,#F8FAFC)] p-6 shadow-sm"
      >
      {errorMessage ? (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {errorMessage}
        </div>
      ) : null}
      <section className="space-y-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-[#0F172A]">Flotte mobile</h2>
            <p className="mt-1 text-sm text-[#64748B]">
              Pilotage des appareils, du budget et des recommandations d'affectation intelligente.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge className="border-[#BFDBFE] bg-[#EFF6FF] px-3 py-1 text-[#1D4ED8]">
              Jeu de donnees Mobile Price Classification
            </Badge>
            <Badge className="border-[#DCE5F1] bg-white px-3 py-1 text-[#475569]">
              Filtres mobile actifs
            </Badge>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex flex-col gap-3 border-b border-gray-200 pb-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-blue-50 p-2 text-[#2D6CDF]">
                <Filter className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[#0F172A]">Filtres flotte mobile</h3>
                <p className="text-xs text-[#64748B]">
                  {kpis?.total_devices ?? 0} appareils - {kpis?.alert_devices ?? 0} alertes -{" "}
                  {kpis?.critical_risks ?? 0} risques critiques
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={resetFilters}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-[#64748B] transition-colors hover:bg-[#F8FAFC]"
            >
              Reinitialiser
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
            <div className="relative md:col-span-2">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748B]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Operateur, profil, recommandation..."
                className="w-full rounded-lg border border-gray-200 bg-[#F8FAFC] py-2 pl-10 pr-4 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2D6CDF]"
              />
            </div>

            <select
              value={selectedOperator}
              onChange={(event) => setSelectedOperator(event.target.value)}
              className="rounded-lg border border-gray-200 bg-[#F8FAFC] px-4 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2D6CDF]"
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
              className="rounded-lg border border-gray-200 bg-[#F8FAFC] px-4 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2D6CDF]"
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
              onChange={(event) => setSelectedProfile(event.target.value)}
              className="rounded-lg border border-gray-200 bg-[#F8FAFC] px-4 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2D6CDF]"
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
              onChange={(event) => setSelectedDeviceCategory(event.target.value)}
              className="rounded-lg border border-gray-200 bg-[#F8FAFC] px-4 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2D6CDF]"
            >
              <option value="all">Toutes categories</option>
              {(filters?.device_categories ?? []).map((deviceCategory) => (
                <option key={deviceCategory} value={deviceCategory}>
                  {deviceCategory}
                </option>
              ))}
            </select>

            <select
              value={selectedRiskLevel}
              onChange={(event) => setSelectedRiskLevel(event.target.value)}
              className="rounded-lg border border-gray-200 bg-[#F8FAFC] px-4 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2D6CDF]"
            >
              <option value="all">Tous les risques</option>
              {(filters?.risk_levels ?? []).map((riskLevel) => (
                <option key={riskLevel} value={riskLevel}>
                  {formatMobileRiskLabel(riskLevel)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <KPICard
            title="Total appareils"
            value={isLoading ? "--" : String(kpis?.total_devices ?? 0)}
            icon={Smartphone}
            color="blue"
          />
          <KPICard
            title="Budget estime"
            value={isLoading ? "--" : formatMadValue(kpis?.total_estimated_budget_mad ?? 0)}
            description="Budget total mobile pilote"
            icon={PiggyBank}
            color="green"
            emphasis="strong"
          />
          <KPICard
            title="Cout moyen"
            value={isLoading ? "--" : formatMadValue(kpis?.average_estimated_price_mad ?? 0)}
            icon={Package2}
            color="cyan"
          />
          <KPICard
            title="Alertes"
            value={isLoading ? "--" : String(kpis?.alert_devices ?? 0)}
            icon={AlertTriangle}
            color="orange"
          />
          <KPICard
            title="Risques critiques"
            value={isLoading ? "--" : String(kpis?.critical_risks ?? 0)}
            description="Appareils a arbitrer en priorite"
            icon={ShieldAlert}
            color="red"
            emphasis="strong"
          />
          <KPICard
            title="Appareils premium"
            value={isLoading ? "--" : String(kpis?.premium_devices ?? 0)}
            icon={Building2}
            color="purple"
          />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-[#0F172A]">Repartition des niveaux de risque</h3>
              <p className="mt-1 text-sm text-[#64748B]">
                Lecture immediate des niveaux critiques, eleves, moyens et faibles.
              </p>
            </div>

            <ResponsiveContainer width="100%" height={320}>
              <PieChart>
                <Pie
                  data={overview?.risk_distribution ?? []}
                  dataKey="count"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  outerRadius={96}
                >
                  {(overview?.risk_distribution ?? []).map((entry) => (
                    <Cell key={entry.label} fill={getMobileRiskColor(entry.label)} />
                  ))}
                </Pie>
                <Legend formatter={(value: string) => formatMobileRiskLabel(value)} />
                <Tooltip
                  formatter={(value: number, _name: string, payload: { payload?: { label?: string } }) => [
                    `${value} appareils`,
                    formatMobileRiskLabel(payload.payload?.label ?? ""),
                  ]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-[#0F172A]">Appareils par operateur</h3>
              <p className="mt-1 text-sm text-[#64748B]">
                Volume de parc pour identifier les poches d'usage les plus larges.
              </p>
            </div>

            <ResponsiveContainer width="100%" height={320}>
              <BarChart
                data={overview?.devices_by_operator ?? []}
                margin={{ top: 8, right: 12, left: 4, bottom: 24 }}
              >
                <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" />
                <XAxis
                  dataKey="label"
                  stroke="#64748B"
                  interval={0}
                  tickMargin={10}
                  height={54}
                  tick={{ fontSize: 12 }}
                  padding={{ left: 18, right: 18 }}
                />
                <YAxis stroke="#64748B" />
                <Tooltip formatter={(value: number) => [`${value} appareils`, "Volume"]} />
                <Bar dataKey="count" fill="#2563EB" name="Appareils" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h3 className="text-lg font-semibold text-[#0F172A]">
                  Repartition des appareils par categorie
                </h3>
                <p className="mt-1 text-sm text-[#64748B]">
                  Vue synthetique de la composition du parc selon le niveau de gamme des
                  terminaux.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {dominantDeviceCategory ? (
                  <Badge className="border-blue-200 bg-blue-50 px-3 py-1 text-[#2563EB]">
                    Categorie dominante : {dominantDeviceCategory.label}
                  </Badge>
                ) : null}
                <Badge className="border-[#DCE5F1] bg-white px-3 py-1 text-[#475569]">
                  Volume total : {formatIntegerTick(totalCategorizedDevices)} appareils
                </Badge>
              </div>
            </div>

            <ResponsiveContainer width="100%" height={320}>
              <BarChart
                data={deviceCategoryChartData}
                margin={{
                  top: 20,
                  right: 16,
                  left: 18,
                  bottom: shouldRotateDeviceCategoryTicks ? 30 : 12,
                }}
              >
                <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="label"
                  stroke="#64748B"
                  interval={0}
                  minTickGap={0}
                  tickMargin={10}
                  height={shouldRotateDeviceCategoryTicks ? 60 : 42}
                  angle={shouldRotateDeviceCategoryTicks ? -14 : 0}
                  textAnchor={shouldRotateDeviceCategoryTicks ? "end" : "middle"}
                  tick={{ fontSize: 12 }}
                  padding={{ left: 16, right: 16 }}
                />
                <YAxis
                  stroke="#64748B"
                  width={84}
                  tickMargin={8}
                  allowDecimals={false}
                  tickFormatter={formatIntegerTick}
                  domain={[0, (dataMax: number) => Math.max(dataMax + 1, Math.ceil(dataMax * 1.12))]}
                  label={{
                    value: "Nombre d'appareils",
                    angle: -90,
                    position: "insideLeft",
                    style: { fill: "#64748B", fontSize: 12, fontWeight: 500 },
                  }}
                />
                <Tooltip
                  labelFormatter={(value: string) => `Categorie : ${value}`}
                  formatter={(value: number) => [
                    `${formatIntegerTick(Number(value))} appareils`,
                    "Nombre d'appareils",
                  ]}
                />
                <Bar
                  dataKey="count"
                  name="Nombre d'appareils"
                  radius={[10, 10, 0, 0]}
                  maxBarSize={72}
                >
                  {deviceCategoryChartData.map((entry) => (
                    <Cell key={entry.label} fill={getDeviceCategoryColor(entry.label)} />
                  ))}
                  <LabelList
                    dataKey="count"
                    position="top"
                    offset={10}
                    formatter={(value: number) => formatIntegerTick(value)}
                    fill="#334155"
                    fontSize={12}
                    fontWeight={600}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h3 className="text-lg font-semibold text-[#0F172A]">Budget et risque par departement</h3>
                <p className="mt-1 text-sm text-[#64748B]">
                  Croisement du budget estime et du score moyen de risque afin d'identifier les
                  departements les plus exposes.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {mobileLeadDepartment ? (
                  <Badge className="border-orange-200 bg-orange-50 px-3 py-1 text-[#F97316]">
                    Departement prioritaire : {mobileLeadDepartment.label}
                  </Badge>
                ) : null}
                {mobileLeadDepartment ? (
                  <Badge className="border-[#DCE5F1] bg-white px-3 py-1 text-[#475569]">
                    Exposition ponderee la plus elevee | Risque moyen :{" "}
                    {formatRiskScoreLabel(mobileLeadDepartment.average_budget_risk_score)}
                  </Badge>
                ) : null}
                <Badge className="border-red-200 bg-red-50 px-3 py-1 text-[#DC2626]">
                  Seuil critique : 80/100
                </Badge>
              </div>
            </div>

            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart
                data={departmentBudgetChartData}
                margin={{
                  top: 16,
                  right: 16,
                  left: 24,
                  bottom: shouldRotateDepartmentTicks ? 28 : 8,
                }}
              >
                <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" />
                <XAxis
                  dataKey="label"
                  stroke="#64748B"
                  interval={0}
                  minTickGap={0}
                  tickMargin={10}
                  height={shouldRotateDepartmentTicks ? 58 : 42}
                  angle={shouldRotateDepartmentTicks ? -14 : 0}
                  textAnchor={shouldRotateDepartmentTicks ? "end" : "middle"}
                  tick={{ fontSize: 12 }}
                  padding={{ left: 12, right: 12 }}
                />
                <YAxis
                  yAxisId="left"
                  stroke="#64748B"
                  width={72}
                  tickMargin={8}
                  tickFormatter={formatBudgetAxisTick}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  domain={[0, 100]}
                  stroke="#DC2626"
                  tickMargin={8}
                />
                <Legend />
                <Tooltip
                  labelFormatter={(value: string) => `Departement : ${value}`}
                  formatter={(value: number, name: string) => {
                    if (name === "Budget estime (MAD)") {
                      return [formatMadValue(Number(value)), name];
                    }
                    return [formatRiskScoreLabel(Number(value)), name];
                  }}
                />
                <ReferenceLine
                  yAxisId="right"
                  y={80}
                  stroke="#DC2626"
                  strokeDasharray="4 4"
                  ifOverflow="extendDomain"
                />
                <Bar
                  yAxisId="left"
                  dataKey="total_estimated_price_mad"
                  fill="#2563EB"
                  name="Budget estime (MAD)"
                  radius={[8, 8, 0, 0]}
                />
                <Line
                  yAxisId="right"
                  type="linear"
                  dataKey="average_budget_risk_score"
                  stroke="#DC2626"
                  strokeWidth={3.5}
                  dot={{ r: 5, strokeWidth: 3, fill: "#FFFFFF" }}
                  activeDot={{ r: 6, strokeWidth: 2, fill: "#FFFFFF" }}
                  name="Score moyen de risque"
                >
                  <LabelList
                    dataKey="average_budget_risk_score"
                    content={({ x, y, value }) =>
                      typeof x === "number" &&
                      typeof y === "number" &&
                      typeof value === "number" ? (
                        <text
                          x={x}
                          y={y - 12}
                          fill="#DC2626"
                          fontSize={11}
                          fontWeight={600}
                          textAnchor="middle"
                        >
                          {value.toFixed(1)}
                        </text>
                      ) : null
                    }
                  />
                </Line>
              </ComposedChart>
            </ResponsiveContainer>

            <div className="mt-4 flex flex-wrap items-center gap-3 text-xs font-medium text-[#64748B]">
              <div className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-[#DC2626]">
                <span className="w-6 border-t-2 border-dashed border-current" />
                <span>Repere visuel du seuil critique de risque</span>
              </div>
              <span>
                La priorite est determinee a partir de l'exposition budgetaire ponderee par le
                score moyen de risque de chaque departement.
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-[#0F172A]">Appareils prioritaires</h3>
              <p className="mt-1 text-sm text-[#64748B]">
                Tri par severite, score budgetaire puis prix estime, avec explication IA lisible.
              </p>
            </div>
            <Badge className="border-[#DCE5F1] bg-white px-3 py-1 text-[#475569]">
              Criticite d'abord
            </Badge>
          </div>

          <div className="space-y-4">
            {mobileDevices.length === 0 ? (
              <div className="rounded-lg bg-[#F8FAFC] px-4 py-6 text-sm text-[#64748B]">
                Aucun appareil ne correspond aux filtres actuels.
              </div>
            ) : (
              visibleMobileDevices.map((device) => {
                const operatorStyles = getOperatorStyles(device.operator);
                const riskStyles = getRiskStyles(device.risk_level as DashboardRiskLevel);

                return (
                  <div key={device.fleet_row_id} className={`rounded-2xl border p-5 ${riskStyles.panel}`}>
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="flex-1">
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                          <span className="font-medium text-[#0F172A]">Appareil-{device.fleet_row_id}</span>
                          <span className="rounded-full px-2 py-0.5 text-xs" style={operatorStyles}>
                            {device.operator}
                          </span>
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-medium ${getMobileRiskClasses(device.risk_level)}`}
                          >
                            {formatMobileRiskLabel(device.risk_level)}
                          </span>
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-medium ${getDeviceCategoryClasses(device.device_category)}`}
                          >
                            {device.device_category}
                          </span>
                        </div>

                        <p className="text-sm text-[#0F172A]">
                          {device.department} - {device.employee_profile}
                        </p>

                        <div className="mt-4 rounded-2xl border border-white/70 bg-white/80 p-4">
                          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[#64748B]">
                            <Brain className="h-3.5 w-3.5" />
                            <span>Explication IA</span>
                          </div>
                          <p className="mt-2 text-sm leading-6 text-[#334155]">{buildMobileExplanation(device)}</p>
                          <p className="mt-2 text-sm font-medium leading-6 text-[#0F172A]">{device.recommendation}</p>
                        </div>
                      </div>

                      <div className="min-w-[240px] rounded-2xl bg-white/80 p-4">
                        <p className="text-xs uppercase tracking-[0.16em] text-[#64748B]">Impact budgetaire</p>
                        <p className="mt-2 text-lg font-bold text-[#0F172A]">
                          {formatMadValue(device.estimated_price_mad)}
                        </p>
                        <p className="mt-1 text-sm text-[#64748B]">
                          Score budget {device.budget_risk_score.toFixed(1)}/100
                        </p>
                        <p className="mt-1 text-sm text-[#64748B]">Classe predite {device.predicted_price_label}</p>
                        <p className="mt-1 text-sm text-[#64748B]">
                          Confiance {formatPredictionConfidence(device.prediction_confidence)}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {mobileDevices.length > 5 ? (
            <div className="mt-4 flex justify-end">
              <Button
                type="button"
                variant="outline"
                className="rounded-xl border-[#DCE5F1]"
                onClick={() => setShowAllMobileDevices((currentValue) => !currentValue)}
              >
                {showAllMobileDevices ? "Afficher le top 5" : `Voir les ${mobileDevices.length} appareils`}
              </Button>
            </div>
          ) : null}
        </div>
      </section>
      </TabsContent>

      <TabsContent
        value="churn"
        className="mt-0 rounded-[28px] border border-[#E2E8F0] bg-[linear-gradient(180deg,#FFFFFF,#F8FAFC)] p-6 shadow-sm"
      >
      <section className="space-y-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-[#0F172A]">Risque client</h2>
            <p className="mt-1 text-sm text-[#64748B]">
              KPIs business, impact revenu et plans de retention issus du module churn.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge className="border-emerald-200 bg-emerald-50 px-3 py-1 text-[#059669]">
              Jeu de donnees Telco Customer Churn
            </Badge>
            <Badge className="border-[#DCE5F1] bg-white px-3 py-1 text-[#475569]">
              Impact revenu suivi
            </Badge>
          </div>
        </div>

        {customerErrorMessage ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {customerErrorMessage}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          <KPICard
            title="Total clients"
            value={isCustomerLoading ? "--" : String(churnKpis?.total_customers ?? 0)}
            icon={Users}
            color="blue"
          />
          <KPICard
            title="Taux churn"
            value={isCustomerLoading ? "--" : `${(churnKpis?.churn_rate_pct ?? 0).toFixed(1)}%`}
            icon={TrendingUp}
            color="orange"
          />
          <KPICard
            title="Clients a risque"
            value={isCustomerLoading ? "--" : String(churnKpis?.high_risk_customers ?? 0)}
            description="Portefeuille retention prioritaire"
            icon={ShieldAlert}
            color="red"
            emphasis="strong"
          />
          <KPICard
            title="Revenu a risque"
            value={isCustomerLoading ? "--" : formatCustomerMadValue(churnKpis?.revenue_at_risk_mad ?? 0)}
            description="Montant mensuel a proteger"
            icon={Wallet}
            color="green"
            emphasis="strong"
          />
          <KPICard
            title="Clients fideles"
            value={isCustomerLoading ? "--" : String(churnKpis?.loyal_customers ?? 0)}
            icon={Building2}
            color="cyan"
          />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h3 className="text-lg font-semibold text-[#0F172A]">Churn par contrat</h3>
                <p className="mt-1 text-sm text-[#64748B]">
                  Comparaison entre churn reel et clients a risque pour orienter la retention.
                </p>
              </div>
              {churnLeadContract ? (
                <Badge className="border-red-200 bg-red-50 px-3 py-1 text-[#DC2626]">
                  Priorite : {formatContractLabel(churnLeadContract.label)} concentre {churnLeadContract.predicted_high_risk_customers} risques
                </Badge>
              ) : null}
            </div>

            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={churnByContractData}>
                <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke="#64748B" />
                <YAxis stroke="#64748B" />
                <Legend />
                <Tooltip />
                <Bar dataKey="actual_churn_customers" fill="#F97316" name="Churn reel" radius={[8, 8, 0, 0]} />
                <Bar
                  dataKey="predicted_high_risk_customers"
                  fill="#DC2626"
                  name="Clients a risque"
                  radius={[8, 8, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-[#0F172A]">Revenu a risque et score moyen</h3>
              <p className="mt-1 text-sm text-[#64748B]">
                Churn versus impact revenu, avec mise en evidence des paliers les plus critiques.
              </p>
            </div>

            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={customerOverview?.churn_by_price_range ?? []}>
                <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke="#64748B" />
                <YAxis yAxisId="left" stroke="#64748B" />
                <YAxis yAxisId="right" orientation="right" domain={[0, 100]} stroke="#DC2626" />
                <Legend />
                <Tooltip
                  formatter={(value: number, name: string) => {
                    if (name === "Revenu a risque") {
                      return [formatCustomerMadValue(Number(value)), name];
                    }
                    return [`${Number(value).toFixed(1)}/100`, name];
                  }}
                />
                <ReferenceLine yAxisId="right" y={80} stroke="#DC2626" strokeDasharray="4 4" />
                <Bar
                  yAxisId="left"
                  dataKey="revenue_at_risk_mad"
                  fill="#2563EB"
                  name="Revenu a risque"
                  radius={[8, 8, 0, 0]}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="average_risk_score"
                  stroke="#DC2626"
                  strokeWidth={3}
                  dot={{ r: 4 }}
                  name="Score moyen"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-[#0F172A]">Top clients a risque</h3>
              <p className="mt-1 text-sm text-[#64748B]">
                Clients tries par prediction, severite et valeur, avec explication IA et facteurs cles.
              </p>
            </div>
            <Badge className="border-[#DCE5F1] bg-white px-3 py-1 text-[#475569]">
              Retention d'abord
            </Badge>
          </div>

          <div className="space-y-4">
            {atRiskCustomers.length === 0 ? (
              <div className="rounded-lg bg-[#F8FAFC] px-4 py-6 text-sm text-[#64748B]">
                Aucun client a risque disponible.
              </div>
            ) : (
              visibleCustomers.map((customer) => {
                const operatorStyles = getCustomerOperatorStyles(customer.operator);
                const riskStyles = getRiskStyles(customer.risk_level as DashboardRiskLevel);

                return (
                  <div key={customer.customer_row_id} className={`rounded-2xl border p-5 ${riskStyles.panel}`}>
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="flex-1">
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                          <span className="font-medium text-[#0F172A]">{customer.customer_id}</span>
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-medium ${getCustomerRiskClasses(customer.risk_level)}`}
                          >
                            {formatCustomerRiskLabel(customer.risk_level)}
                          </span>
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-medium ${getChurnClasses(customer.predicted_churn)}`}
                          >
                            Churn predit {formatChurnLabel(customer.predicted_churn)}
                          </span>
                          <span className="rounded-full px-2 py-0.5 text-xs" style={operatorStyles}>
                            {customer.operator}
                          </span>
                        </div>

                        <p className="text-sm text-[#0F172A]">
                          {customer.department} - {formatContractLabel(customer.contract)} - {formatTenure(customer.tenure)}
                        </p>

                        <div className="mt-4 rounded-2xl border border-white/70 bg-white/80 p-4">
                          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[#64748B]">
                            <Brain className="h-3.5 w-3.5" />
                            <span>Explication IA</span>
                          </div>
                          <p className="mt-2 text-sm leading-6 text-[#334155]">
                            {buildCustomerExplanation(customer)}
                          </p>
                          <p className="mt-2 text-sm font-medium leading-6 text-[#0F172A]">
                            {customer.recommendation}
                          </p>

                          <div className="mt-4 flex flex-wrap gap-2">
                            {customer.key_factors.map((factor) => (
                              <span
                                key={factor}
                                className="rounded-full bg-[#F8FAFC] px-3 py-1 text-xs font-medium text-[#475569]"
                              >
                                {formatCustomerFactorLabel(factor)}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="min-w-[240px] rounded-2xl bg-white/80 p-4">
                        <p className="text-xs uppercase tracking-[0.16em] text-[#64748B]">Priorite retention</p>
                        <p className="mt-2 text-lg font-bold text-[#0F172A]">
                          {formatCustomerMadValue(customer.revenue_at_risk_mad)}
                        </p>
                        <p className="mt-1 text-sm text-[#64748B]">{formatRiskScore(customer.risk_score_100)}</p>
                        <p className="mt-1 text-sm text-[#64748B]">
                          Probabilite {formatRiskProbability(customer.risk_proba)}
                        </p>
                        <p className="mt-1 text-sm text-[#64748B]">
                          Cout futur {formatCustomerMadValue(customer.future_cost_pred_mad)}
                        </p>

                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-200">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.min(customer.risk_score_100, 100)}%`,
                              backgroundColor: getCustomerRiskColor(customer.risk_level),
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {atRiskCustomers.length > 5 ? (
            <div className="mt-4 flex justify-end">
              <Button
                type="button"
                variant="outline"
                className="rounded-xl border-[#DCE5F1]"
                onClick={() => setShowAllCustomers((currentValue) => !currentValue)}
              >
                {showAllCustomers ? "Afficher le top 5" : `Voir les ${atRiskCustomers.length} clients`}
              </Button>
            </div>
          ) : null}
        </div>
      </section>
      </TabsContent>

      <TabsContent
        value="fraud"
        className="mt-0 rounded-[28px] border border-[#E2E8F0] bg-[linear-gradient(180deg,#FFFFFF,#F8FAFC)] p-6 shadow-sm"
      >
      <section className="space-y-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-[#0F172A]">Fraude CDR</h2>
            <p className="mt-1 text-sm text-[#64748B]">
              Surveillance des appels suspects, exposition cout et zones critiques a escalader.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge className="border-violet-200 bg-violet-50 px-3 py-1 text-[#7C3AED]">Jeu de donnees CDR Fraud</Badge>
            <Badge className="border-[#DCE5F1] bg-white px-3 py-1 text-[#475569]">
              Exposition fraude active
            </Badge>
          </div>
        </div>

        {cdrErrorMessage ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {cdrErrorMessage}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          <KPICard
            title="Total appels"
            value={isCdrLoading ? "--" : String(fraudKpis?.total_calls ?? 0)}
            icon={PhoneCall}
            color="blue"
          />
          <KPICard
            title="Appels suspects"
            value={isCdrLoading ? "--" : String(fraudKpis?.suspicious_calls ?? 0)}
            icon={AlertTriangle}
            color="orange"
          />
          <KPICard
            title="Alertes critiques"
            value={isCdrLoading ? "--" : String(fraudKpis?.critical_alerts ?? 0)}
            description="Dossiers fraude immediats"
            icon={ShieldAlert}
            color="red"
            emphasis="strong"
          />
          <KPICard
            title="Score moyen"
            value={isCdrLoading ? "--" : `${(fraudKpis?.average_risk_score ?? 0).toFixed(1)}/100`}
            icon={TrendingUp}
            color="purple"
          />
          <KPICard
            title="Exposition suspecte"
            value={isCdrLoading ? "--" : formatCdrMadValue(fraudKpis?.suspicious_cost_exposure_mad ?? 0)}
            description="Montant cumule des appels suspects"
            icon={Wallet}
            color="green"
            emphasis="strong"
          />
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.55fr_1fr]">
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h3 className="text-lg font-semibold text-[#0F172A]">Exposition suspecte par operateur</h3>
                <p className="mt-1 text-sm text-[#64748B]">
                  Combine cout suspect et volume d'appels a surveiller.
                </p>
              </div>
              {fraudLeadOperator ? (
                <Badge className="border-violet-200 bg-violet-50 px-3 py-1 text-[#7C3AED]">
                  Priorite : {fraudLeadOperator.operator} expose {formatCdrMadValue(fraudLeadOperator.total_cost_mad)}
                </Badge>
              ) : null}
            </div>

            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={cdrOverview?.cost_by_operator ?? []}>
                <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" />
                <XAxis dataKey="operator" stroke="#64748B" />
                <YAxis yAxisId="left" stroke="#64748B" />
                <YAxis yAxisId="right" orientation="right" stroke="#DC2626" />
                <Legend />
                <Tooltip
                  formatter={(value: number, name: string) => {
                    if (name === "Cout suspect") {
                      return [formatCdrMadValue(Number(value)), name];
                    }
                    return [`${Number(value)} appels`, name];
                  }}
                />
                <Bar
                  yAxisId="left"
                  dataKey="total_cost_mad"
                  fill="#7C3AED"
                  name="Cout suspect"
                  radius={[8, 8, 0, 0]}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="suspicious_calls"
                  stroke="#DC2626"
                  strokeWidth={3}
                  dot={{ r: 4 }}
                  name="Appels suspects"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <div className="mb-4 flex items-center gap-2">
              <Globe2 className="h-5 w-5 text-[#DC2626]" />
              <h3 className="text-lg font-semibold text-[#0F172A]">Zones critiques</h3>
            </div>
            <p className="text-sm text-[#64748B]">
              Zones de trafic a surveiller selon les alertes prioritaires du moteur fraude.
            </p>

            <div className="mt-5 space-y-3">
              {fraudZoneHotspots.length === 0 ? (
                <div className="rounded-xl bg-[#F8FAFC] px-4 py-8 text-sm text-[#64748B]">
                  Aucune zone critique disponible.
                </div>
              ) : (
                fraudZoneHotspots.slice(0, 5).map((zone) => {
                  const severity =
                    zone.critical > 0
                      ? "Critique"
                      : zone.maxScore >= 60
                        ? "Eleve"
                        : zone.maxScore >= 40
                          ? "Moyen"
                          : "Faible";
                  const riskStyles = getRiskStyles(severity);

                  return (
                    <div key={zone.callZone} className={`rounded-2xl border p-4 ${riskStyles.panel}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-[#0F172A]">{formatCallZoneLabel(zone.callZone)}</p>
                          <p className="mt-1 text-sm text-[#64748B]">
                            {zone.alerts} alertes prioritaires - score max {zone.maxScore.toFixed(1)}/100
                          </p>
                        </div>
                        <Badge className={riskStyles.badge}>{severity}</Badge>
                      </div>
                      <p className="mt-3 text-sm font-medium text-[#0F172A]">
                        Exposition {formatCdrMadValue(zone.cost)}
                      </p>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-[#0F172A]">Alertes fraude prioritaires</h3>
              <p className="mt-1 text-sm text-[#64748B]">
                Appels suspects tries par severite, score et cout, avec justification IA associee.
              </p>
            </div>
            <Badge className="border-[#DCE5F1] bg-white px-3 py-1 text-[#475569]">
              Surveillance immediate
            </Badge>
          </div>

          <div className="space-y-4">
            {fraudAlerts.length === 0 ? (
              <div className="rounded-lg bg-[#F8FAFC] px-4 py-6 text-sm text-[#64748B]">
                Aucune alerte fraude prioritaire disponible.
              </div>
            ) : (
              visibleFraudAlerts.map((alert) => {
                const operatorStyles = getOperatorStyles(alert.operator_maroc);
                const severityLabel = formatSeverityLabel(alert.severity);
                const riskStyles = getRiskStyles(severityLabel as DashboardRiskLevel);

                return (
                  <div key={alert.cdr_row_id} className={`rounded-2xl border p-5 ${riskStyles.panel}`}>
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="flex-1">
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                          <span className="font-medium text-[#0F172A]">CDR-{alert.cdr_row_id}</span>
                          <span className="rounded-full px-2 py-0.5 text-xs" style={operatorStyles}>
                            {alert.operator_maroc}
                          </span>
                          <span className="rounded-full bg-[#F8FAFC] px-2.5 py-1 text-xs font-medium text-[#475569]">
                            {formatFraudTypeLabel(alert.fraud_type)}
                          </span>
                          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${riskStyles.badge}`}>
                            {severityLabel}
                          </span>
                        </div>

                        <p className="text-sm text-[#0F172A]">
                          {alert.department} - {formatCallZoneLabel(alert.call_zone)} - {formatCdrDateTime(alert.start_time)}
                        </p>

                        <div className="mt-4 rounded-2xl border border-white/70 bg-white/80 p-4">
                          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[#64748B]">
                            <Database className="h-3.5 w-3.5" />
                            <span>Explication IA</span>
                          </div>
                          <p className="mt-2 text-sm leading-6 text-[#334155]">{buildFraudExplanation(alert)}</p>
                          <p className="mt-2 text-sm font-medium leading-6 text-[#0F172A]">{alert.recommendation}</p>
                        </div>
                      </div>

                      <div className="min-w-[240px] rounded-2xl bg-white/80 p-4">
                        <p className="text-xs uppercase tracking-[0.16em] text-[#64748B]">Exposition fraude</p>
                        <p className="mt-2 text-lg font-bold text-[#0F172A]">
                          {formatCdrMadValue(alert.call_cost_mad)}
                        </p>
                        <p className="mt-1 text-sm text-[#64748B]">
                          Score {alert.fraud_risk_score_100.toFixed(1)}/100
                        </p>
                        <p className="mt-1 text-sm text-[#64748B]">Zone {formatCallZoneLabel(alert.call_zone)}</p>
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-200">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.min(alert.fraud_risk_score_100, 100)}%`,
                              backgroundColor: getSeverityChartColor(alert.severity),
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {fraudAlerts.length > 5 ? (
            <div className="mt-4 flex justify-end">
              <Button
                type="button"
                variant="outline"
                className="rounded-xl border-[#DCE5F1]"
                onClick={() => setShowAllFraudAlerts((currentValue) => !currentValue)}
              >
                {showAllFraudAlerts ? "Afficher le top 5" : `Voir les ${fraudAlerts.length} alertes`}
              </Button>
            </div>
          ) : null}
        </div>
      </section>
      </TabsContent>
      </Tabs>
      </DashboardSection>
    </div>
  );
}
