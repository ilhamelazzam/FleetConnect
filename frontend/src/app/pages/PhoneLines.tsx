import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import {
  Building2,
  CirclePause,
  Coins,
  Download,
  Eye,
  LoaderCircle,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  Trash2,
  UserCheck,
  Wifi,
} from "lucide-react";
import { toast } from "sonner";

import AddLineModal, {
  type LineFormData,
  type LinePlanOption,
} from "../components/AddLineModal";
import KPICard from "../components/KPICard";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { Input } from "../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { cn } from "../components/ui/utils";
import { useAuth } from "../context/AuthContext";
import { useDepartments } from "../context/DepartmentsContext";
import {
  ApiError,
  phoneLinesApi,
  plansApi,
  type ApiPhoneLine,
  type ApiPhoneLineOccupationStats,
  type ApiPhoneLineOccupationStatus,
  type ApiPhoneLineStats,
  type CreatePhoneLinePayload,
  type ApiPlan,
} from "../lib/api";
import { buildSearchUrl, getPageSearchQuery } from "../lib/page-search";
import { canApplyOperationalChanges } from "../lib/roles";

const API_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 10;
const EMPTY_DEPARTMENT_FILTER_VALUE = "__none__";

type OccupationFilter = "all" | ApiPhoneLineOccupationStatus;

interface OccupationMeta {
  label: string;
  helper: string;
  badgeClassName: string;
  subtleClassName: string;
}

type SurfaceTone = "primary" | "positive" | "warning" | "danger" | "ai";

interface OccupationCountMap {
  total: number;
  total_libre: number;
  total_attribuees: number;
  total_en_cours: number;
  total_suspendues: number;
  total_inactives: number;
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

function normalizePhoneNumber(value: string): string {
  return value.replace(/\s+/g, "");
}

function sortValues(values: Iterable<string>): string[] {
  return Array.from(
    new Set(
      Array.from(values)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ).sort((leftValue, rightValue) =>
    leftValue.localeCompare(rightValue, "fr", { sensitivity: "base" }),
  );
}

async function fetchAllPhoneLines(token: string): Promise<ApiPhoneLine[]> {
  const rows: ApiPhoneLine[] = [];
  let offset = 0;

  while (true) {
    const batch = await phoneLinesApi.list(token, { offset, limit: API_PAGE_SIZE });
    rows.push(...batch);
    if (batch.length < API_PAGE_SIZE) {
      break;
    }
    offset += batch.length;
  }

  return rows;
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

function getOccupationMeta(status: ApiPhoneLineOccupationStatus): OccupationMeta {
  if (status === "libre") {
    return {
      label: "Libre",
      helper: "Disponible",
      badgeClassName: "border-emerald-200 bg-emerald-50 text-[#059669]",
      subtleClassName: "bg-emerald-50 text-[#047857]",
    };
  }
  if (status === "attribuee") {
    return {
      label: "Attribuee",
      helper: "Active",
      badgeClassName: "border-blue-200 bg-blue-50 text-[#1D4ED8]",
      subtleClassName: "bg-blue-50 text-[#1D4ED8]",
    };
  }
  if (status === "en_cours") {
    return {
      label: "En cours",
      helper: "Partielle",
      badgeClassName: "border-amber-200 bg-amber-50 text-[#D97706]",
      subtleClassName: "bg-amber-50 text-[#B45309]",
    };
  }
  if (status === "suspendue") {
    return {
      label: "Suspendue",
      helper: "Bloquee",
      badgeClassName: "border-red-200 bg-red-50 text-[#DC2626]",
      subtleClassName: "bg-red-50 text-[#B91C1C]",
    };
  }
  return {
    label: "Inactive",
    helper: "Hors parc",
    badgeClassName: "border-slate-200 bg-slate-100 text-[#475569]",
    subtleClassName: "bg-slate-100 text-[#475569]",
  };
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

function getServiceStatusBadgeClass(status: string): string {
  if (status === "suspended") {
    return "border-red-200 bg-red-50 text-[#DC2626]";
  }
  if (status === "inactive") {
    return "border-slate-200 bg-slate-100 text-[#475569]";
  }
  return "border-emerald-200 bg-emerald-50 text-[#059669]";
}

function getSurfaceClasses(tone: SurfaceTone): { card: string; icon: string; badge: string } {
  if (tone === "primary") {
    return {
      card: "bc-surface-primary",
      icon: "bc-icon-primary",
      badge: "border-[var(--bc-primary-border)] bg-[var(--bc-primary-soft)] text-[var(--bc-primary)]",
    };
  }

  if (tone === "positive") {
    return {
      card: "bc-surface-success",
      icon: "bc-icon-success",
      badge: "border-[var(--bc-success-border)] bg-[var(--bc-success-soft)] text-[var(--bc-success)]",
    };
  }

  if (tone === "warning") {
    return {
      card: "bc-surface-warning",
      icon: "bc-icon-warning",
      badge: "border-[var(--bc-warning-border)] bg-[var(--bc-warning-soft)] text-[var(--bc-warning)]",
    };
  }

  if (tone === "danger") {
    return {
      card: "bc-surface-danger",
      icon: "bc-icon-danger",
      badge: "border-[var(--bc-danger-border)] bg-[var(--bc-danger-soft)] text-[var(--bc-danger)]",
    };
  }

  return {
    card: "bc-surface-ai",
    icon: "bc-icon-ai",
    badge: "border-[var(--bc-ai-border)] bg-[linear-gradient(135deg,rgba(99,102,241,0.14),rgba(139,92,246,0.16))] text-[var(--bc-ai-start)]",
  };
}

function formatServiceStatusLabel(status: string): string {
  if (status === "suspended") {
    return "Service suspendu";
  }
  if (status === "inactive") {
    return "Service inactif";
  }
  return "Service actif";
}

function formatDateLabel(value: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatUsageValue(value: number): string {
  return `${value.toFixed(1)} Go`;
}

function formatCompactMadValue(value: number): string {
  return `${new Intl.NumberFormat("fr-FR", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)} MAD`;
}

function formatNumberValue(value: number): string {
  return new Intl.NumberFormat("fr-FR").format(value);
}

function getUsageRate(line: ApiPhoneLine): number | null {
  if (line.monthly_limit === null || line.monthly_limit === 0) {
    return null;
  }

  return Math.min(line.current_data_usage_gb / line.monthly_limit, 1);
}

function downloadLinesAsCsv(lines: ApiPhoneLine[]) {
  const header = [
    "numero",
    "etat_occupation",
    "statut_service",
    "collaborateur",
    "departement",
    "operateur",
    "forfait",
    "data_courante_go",
    "data_precedente_go",
    "limite_mensuelle_go",
    "notes",
  ];

  const csvRows = [
    header.join(","),
    ...lines.map((line) =>
      [
        line.phone_number,
        deriveOccupationStatus(line),
        line.status,
        `"${(line.assigned_to ?? "").replace(/"/g, '""')}"`,
        `"${(line.department ?? "").replace(/"/g, '""')}"`,
        `"${line.operator_name.replace(/"/g, '""')}"`,
        `"${line.plan_name.replace(/"/g, '""')}"`,
        line.current_data_usage_gb,
        line.previous_data_usage_gb,
        line.monthly_limit ?? "",
        `"${(line.notes ?? "").replace(/"/g, '""')}"`,
      ].join(","),
    ),
  ];

  const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "lignes-telecom.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function deriveCounts(lines: ApiPhoneLine[]): OccupationCountMap {
  const counts: OccupationCountMap = {
    total: lines.length,
    total_libre: 0,
    total_attribuees: 0,
    total_en_cours: 0,
    total_suspendues: 0,
    total_inactives: 0,
  };

  lines.forEach((line) => {
    const status = deriveOccupationStatus(line);
    if (status === "libre") counts.total_libre += 1;
    else if (status === "attribuee") counts.total_attribuees += 1;
    else if (status === "en_cours") counts.total_en_cours += 1;
    else if (status === "suspendue") counts.total_suspendues += 1;
    else counts.total_inactives += 1;
  });

  return counts;
}

function getCrudFormStatus(line: ApiPhoneLine): LineFormData["status"] {
  const occupationStatus = deriveOccupationStatus(line);
  if (occupationStatus === "suspendue") {
    return "suspendue";
  }
  if (occupationStatus === "inactive") {
    return "inactive";
  }
  if (occupationStatus === "attribuee" || occupationStatus === "en_cours") {
    return "attribuee";
  }
  return "libre";
}

function buildLineFormData(line: ApiPhoneLine): LineFormData {
  return {
    phone_number: line.phone_number,
    operator_name: line.operator_name,
    plan_name: line.plan_name,
    department: line.department ?? "",
    assigned_to: line.assigned_to ?? "",
    status: getCrudFormStatus(line),
  };
}

function validateLineForm(formData: LineFormData): string | null {
  const normalizedPhoneNumber = normalizePhoneNumber(formData.phone_number);
  if (!/^\+?[0-9]{8,15}$/.test(normalizedPhoneNumber)) {
    return "Le numero doit contenir entre 8 et 15 chiffres sans caracteres speciaux.";
  }

  if (formData.status === "attribuee" && formData.assigned_to.trim() === "") {
    return "Renseignez un collaborateur pour une ligne attribuee.";
  }

  if (formData.status === "attribuee" && formData.department.trim() === "") {
    return "Renseignez un departement pour une ligne attribuee.";
  }

  return null;
}

function buildPhoneLinePayload(formData: LineFormData): CreatePhoneLinePayload {
  return {
    phone_number: normalizePhoneNumber(formData.phone_number.trim()),
    operator_name: formData.operator_name.trim(),
    plan_name: formData.plan_name.trim(),
    assigned_to:
      formData.status === "libre" ? null : formData.assigned_to.trim() || null,
    department: formData.department.trim() || null,
    status:
      formData.status === "suspendue"
        ? "suspended"
        : formData.status === "inactive"
          ? "inactive"
          : "active",
  };
}

function buildVisiblePages(currentPage: number, totalPages: number): number[] {
  const pages = new Set<number>([1, totalPages, currentPage]);

  if (currentPage - 1 > 1) {
    pages.add(currentPage - 1);
  }
  if (currentPage + 1 < totalPages) {
    pages.add(currentPage + 1);
  }

  return Array.from(pages).sort((leftPage, rightPage) => leftPage - rightPage);
}

function buildPlanOptions(allLines: ApiPhoneLine[], plans: ApiPlan[]): LinePlanOption[] {
  const optionMap = new Map<string, LinePlanOption>();

  plans.forEach((plan) => {
    optionMap.set(`${plan.operator_name}:${plan.name}`, {
      name: plan.name,
      operatorName: plan.operator_name,
      quotaLabel: plan.data_quota,
    });
  });

  allLines.forEach((line) => {
    const key = `${line.operator_name}:${line.plan_name}`;
    if (!optionMap.has(key)) {
      optionMap.set(key, {
        name: line.plan_name,
        operatorName: line.operator_name,
        quotaLabel: line.monthly_limit !== null ? `${line.monthly_limit} Go` : "Illimite",
      });
    }
  });

  return Array.from(optionMap.values()).sort(
    (leftOption, rightOption) =>
      leftOption.operatorName.localeCompare(rightOption.operatorName, "fr", {
        sensitivity: "base",
      }) ||
      leftOption.name.localeCompare(rightOption.name, "fr", {
        sensitivity: "base",
      }),
  );
}

export default function PhoneLines() {
  const { token, user } = useAuth();
  const { departments } = useDepartments();
  const location = useLocation();
  const navigate = useNavigate();
  const canManageLines = canApplyOperationalChanges(user);

  const [allLines, setAllLines] = useState<ApiPhoneLine[]>([]);
  const [phoneLineStats, setPhoneLineStats] = useState<ApiPhoneLineStats | null>(null);
  const [occupationStats, setOccupationStats] = useState<ApiPhoneLineOccupationStats | null>(
    null,
  );
  const [plans, setPlans] = useState<ApiPlan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState(getPageSearchQuery(location.search));
  const [selectedOccupation, setSelectedOccupation] = useState<OccupationFilter>("all");
  const [selectedOperator, setSelectedOperator] = useState("all");
  const [selectedDepartment, setSelectedDepartment] = useState("all");
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [currentPage, setCurrentPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [editingLine, setEditingLine] = useState<ApiPhoneLine | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [modalErrorMessage, setModalErrorMessage] = useState<string | null>(null);
  const [lineToDelete, setLineToDelete] = useState<ApiPhoneLine | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const deferredSearch = useDeferredValue(searchQuery);

  useEffect(() => {
    setSearchQuery(getPageSearchQuery(location.search));
  }, [location.search]);

  useEffect(() => {
    setCurrentPage(1);
  }, [deferredSearch, pageSize, selectedOccupation, selectedOperator, selectedDepartment]);

  useEffect(() => {
    let isMounted = true;

    async function loadPhoneLines() {
      if (!token) {
        if (isMounted) {
          setAllLines([]);
          setPhoneLineStats(null);
          setOccupationStats(null);
          setPlans([]);
          setErrorMessage(null);
          setIsLoading(false);
          setIsRefreshing(false);
        }
        return;
      }

      const hasCurrentSnapshot =
        allLines.length > 0 || phoneLineStats !== null || occupationStats !== null;

      if (hasCurrentSnapshot) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }

      setErrorMessage(null);

      try {
        const [linesResult, statsResult, occupationResult, plansResult] =
          await Promise.allSettled([
            fetchAllPhoneLines(token),
            phoneLinesApi.stats(token),
            phoneLinesApi.occupationStats(token),
            plansApi.list(token, { limit: API_PAGE_SIZE }),
          ]);

        if (!isMounted) {
          return;
        }

        if (
          linesResult.status === "rejected" ||
          statsResult.status === "rejected" ||
          occupationResult.status === "rejected"
        ) {
          const rootError =
            linesResult.status === "rejected"
              ? linesResult.reason
              : statsResult.status === "rejected"
                ? statsResult.reason
                : occupationResult.reason;
          throw rootError;
        }

        setAllLines(linesResult.value);
        setPhoneLineStats(statsResult.value);
        setOccupationStats(occupationResult.value);

        if (plansResult.status === "fulfilled") {
          setPlans(plansResult.value);
        } else if (!hasCurrentSnapshot) {
          setPlans([]);
        }
      } catch (error) {
        if (!isMounted) {
          return;
        }

        if (!allLines.length) {
          setAllLines([]);
          setPhoneLineStats(null);
          setOccupationStats(null);
        }

        setErrorMessage(normalizeError(error, "Impossible de charger les lignes telecom."));
      } finally {
        if (!isMounted) {
          return;
        }
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }

    void loadPhoneLines();

    return () => {
      isMounted = false;
    };
  }, [refreshKey, token]);

  const fallbackCounts = useMemo(() => deriveCounts(allLines), [allLines]);
  const resolvedCounts = occupationStats ?? fallbackCounts;

  const operatorOptions = useMemo(
    () =>
      sortValues([
        ...allLines.map((line) => line.operator_name),
        ...plans.map((plan) => plan.operator_name),
      ]),
    [allLines, plans],
  );

  const departmentOptions = useMemo(
    () =>
      sortValues([
        ...departments.map((department) => department.name),
        ...allLines.map((line) => line.department ?? ""),
      ]),
    [allLines, departments],
  );

  const hasLinesWithoutDepartment = useMemo(
    () => allLines.some((line) => !line.department?.trim()),
    [allLines],
  );

  const planOptions = useMemo(() => buildPlanOptions(allLines, plans), [allLines, plans]);

  useEffect(() => {
    if (selectedOperator !== "all" && !operatorOptions.includes(selectedOperator)) {
      setSelectedOperator("all");
    }
  }, [operatorOptions, selectedOperator]);

  useEffect(() => {
    if (
      selectedDepartment !== "all" &&
      selectedDepartment !== EMPTY_DEPARTMENT_FILTER_VALUE &&
      !departmentOptions.includes(selectedDepartment)
    ) {
      setSelectedDepartment("all");
    }
  }, [departmentOptions, selectedDepartment]);

  const filterOptions = useMemo(
    () => [
      { value: "all" as const, label: "Toutes", count: resolvedCounts.total },
      { value: "libre" as const, label: "Libres", count: resolvedCounts.total_libre },
      {
        value: "attribuee" as const,
        label: "Attribuees",
        count: resolvedCounts.total_attribuees,
      },
      {
        value: "en_cours" as const,
        label: "En cours",
        count: resolvedCounts.total_en_cours,
      },
      {
        value: "suspendue" as const,
        label: "Suspendues",
        count: resolvedCounts.total_suspendues,
      },
      {
        value: "inactive" as const,
        label: "Inactives",
        count: resolvedCounts.total_inactives,
      },
    ],
    [resolvedCounts],
  );

  const filteredLines = useMemo(() => {
    const normalizedSearch = normalizeText(deferredSearch);

    return allLines.filter((line) => {
      const occupationStatus = deriveOccupationStatus(line);
      const matchesOccupation =
        selectedOccupation === "all" || occupationStatus === selectedOccupation;
      const matchesOperator =
        selectedOperator === "all" || line.operator_name === selectedOperator;
      const matchesDepartment =
        selectedDepartment === "all"
          ? true
          : selectedDepartment === EMPTY_DEPARTMENT_FILTER_VALUE
            ? !line.department?.trim()
            : (line.department ?? "") === selectedDepartment;
      const haystack = normalizeText(
        [
          line.phone_number,
          line.assigned_to ?? "",
          line.department ?? "",
          line.operator_name,
          line.plan_name,
          line.notes ?? "",
        ].join(" "),
      );
      const matchesSearch =
        normalizedSearch.length === 0 || haystack.includes(normalizedSearch);

      return (
        matchesOccupation &&
        matchesOperator &&
        matchesDepartment &&
        matchesSearch
      );
    });
  }, [
    allLines,
    deferredSearch,
    selectedDepartment,
    selectedOccupation,
    selectedOperator,
  ]);

  const totalPages = Math.max(1, Math.ceil(filteredLines.length / pageSize));
  const currentPageSafe = Math.min(currentPage, totalPages);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const paginatedLines = useMemo(() => {
    const startIndex = (currentPageSafe - 1) * pageSize;
    return filteredLines.slice(startIndex, startIndex + pageSize);
  }, [currentPageSafe, filteredLines, pageSize]);

  const visiblePages = useMemo(
    () => buildVisiblePages(currentPageSafe, totalPages),
    [currentPageSafe, totalPages],
  );

  const operationalLines =
    resolvedCounts.total_libre + resolvedCounts.total_attribuees + resolvedCounts.total_en_cours;
  const averageDataUsage = phoneLineStats?.average_data_usage_gb ?? null;
  const initialModalData = useMemo(
    () => (editingLine ? buildLineFormData(editingLine) : null),
    [editingLine],
  );
  const heroCards: Array<{
    title: string;
    value: string;
    helper: string;
    tone: SurfaceTone;
    icon: typeof Phone;
    badge: string;
  }> = [
    {
      title: "Lignes utilisables",
      value: String(operationalLines),
      helper: "Libres, attribuees et en cours",
      tone: "primary",
      icon: Phone,
      badge: "Parc actif",
    },
    {
      title: "Moyenne data",
      value: averageDataUsage !== null ? formatUsageValue(averageDataUsage) : "--",
      helper: "Consommation moyenne du parc",
      tone: "primary",
      icon: Wifi,
      badge: "Usage",
    },
    {
      title: "Alertes IA",
      value: String(phoneLineStats?.total_ai_alerts ?? 0),
      helper: `${phoneLineStats?.critical_ai_alerts ?? 0} critiques a traiter`,
      tone: "ai",
      icon: Sparkles,
      badge: "IA",
    },
    {
      title: "Economies estimees",
      value: formatCompactMadValue(phoneLineStats?.estimated_monthly_savings_mad ?? 0),
      helper: "Optimisation mensuelle theorique",
      tone: "positive",
      icon: Coins,
      badge: "Gain",
    },
  ];

  function triggerReload() {
    setRefreshKey((previousValue) => previousValue + 1);
  }

  function handleRefresh() {
    triggerReload();
  }

  function handleExport() {
    downloadLinesAsCsv(filteredLines);
    toast.success("Export CSV genere", {
      description: `${filteredLines.length} ligne(s) exportee(s) avec leurs statuts et rattachements.`,
    });
  }

  function handleSearchChange(nextValue: string) {
    setSearchQuery(nextValue);
    navigate(buildSearchUrl(location.pathname, location.search, nextValue), {
      replace: true,
    });
  }

  function openCreateModal() {
    if (!canManageLines) {
      return;
    }

    setModalMode("create");
    setEditingLine(null);
    setModalErrorMessage(null);
    setIsModalOpen(true);
  }

  function openEditModal(line: ApiPhoneLine) {
    if (!canManageLines) {
      return;
    }

    setModalMode("edit");
    setEditingLine(line);
    setModalErrorMessage(null);
    setIsModalOpen(true);
  }

  function closeModal() {
    setIsModalOpen(false);
    setEditingLine(null);
    setModalErrorMessage(null);
  }

  async function handleSubmitLine(formData: LineFormData) {
    if (!token) {
      return;
    }

    const validationError = validateLineForm(formData);
    if (validationError) {
      setModalErrorMessage(validationError);
      return;
    }

    setIsSubmitting(true);
    setModalErrorMessage(null);

    try {
      const payload = buildPhoneLinePayload(formData);

      if (modalMode === "create") {
        await phoneLinesApi.create(token, payload);
      } else if (editingLine) {
        await phoneLinesApi.update(token, editingLine.id, payload);
      }

      toast.success(
        modalMode === "create" ? "Ligne ajoutee" : "Ligne mise a jour",
        {
          description:
            modalMode === "create"
              ? "La nouvelle ligne est visible dans le tableau principal."
              : "Les modifications sont appliquees et rafraichies dans la vue.",
        },
      );
      closeModal();
      triggerReload();
    } catch (error) {
      const message = normalizeError(
        error,
        modalMode === "create"
          ? "Impossible de creer la ligne."
          : "Impossible de mettre a jour la ligne.",
      );
      setModalErrorMessage(message);
      toast.error("Operation impossible", { description: message });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeleteLine() {
    if (!token || !lineToDelete) {
      return;
    }

    setIsDeleting(true);

    try {
      await phoneLinesApi.remove(token, lineToDelete.id);
      toast.success("Ligne supprimee", {
        description: `${lineToDelete.phone_number} a ete retiree du parc telecom.`,
      });
      setLineToDelete(null);
      triggerReload();
    } catch (error) {
      toast.error("Suppression impossible", {
        description: normalizeError(error, "Impossible de supprimer cette ligne."),
      });
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <section className="relative overflow-hidden rounded-[32px] border border-[#DCE5F1] bg-[linear-gradient(135deg,#FFFFFF_0%,#F7FAFF_48%,#EEF4FF_100%)] p-5 shadow-[0_30px_90px_-54px_rgba(37,99,235,0.4)]">
        <div className="pointer-events-none absolute -top-24 right-[-6rem] h-64 w-64 rounded-full bg-blue-200/35 blur-3xl" />
        <div className="pointer-events-none absolute bottom-[-7rem] left-[-5rem] h-56 w-56 rounded-full bg-cyan-100/50 blur-3xl" />

        <div className="relative flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#BFDBFE] bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#1D4ED8] shadow-sm backdrop-blur">
              <Phone className="h-3.5 w-3.5" />
              Gestion CRUD telecom
            </div>
            <h1 className="mt-4 text-4xl font-semibold tracking-[-0.05em] text-[#0F172A]">
              Lignes telecom
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-[#64748B]">
              Pilotez la flotte dans une vue unique avec creation, lecture, modification et
              suppression. Les filtres, badges de statut et actions rapides sont concus pour un
              usage quotidien type dashboard SaaS.
            </p>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {heroCards.map((card) => {
                const styles = getSurfaceClasses(card.tone);
                const Icon = card.icon;

                return (
                  <article key={card.title} className={`rounded-[22px] border p-4 shadow-sm backdrop-blur ${styles.card}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className={`rounded-2xl p-2.5 ${styles.icon}`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <Badge className={styles.badge}>{card.badge}</Badge>
                    </div>
                    <p className="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-[#64748B]">
                      {card.title}
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-[#0F172A]">
                      {card.value}
                    </p>
                    <p className="mt-1 text-xs text-[#64748B]">{card.helper}</p>
                  </article>
                );
              })}
            </div>
          </div>

          <div className="flex w-full flex-col gap-3 xl:w-auto">
            <Button
              type="button"
              className="h-12 rounded-2xl bg-[linear-gradient(135deg,#2563EB,#1D4ED8)] px-5 text-white shadow-[0_18px_35px_-20px_rgba(37,99,235,0.72)] hover:opacity-95"
              onClick={openCreateModal}
              disabled={!canManageLines}
            >
              <Plus className="h-4 w-4" />
              Ajouter une ligne
            </Button>
            <div className="grid grid-cols-2 gap-3">
              <Button
                type="button"
                variant="outline"
                className="h-11 rounded-2xl border-[#DCE5F1] bg-white/90"
                onClick={handleExport}
                disabled={filteredLines.length === 0 || isLoading}
              >
                <Download className="h-4 w-4" />
                Exporter
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11 rounded-2xl border-[#DCE5F1] bg-white/90"
                onClick={handleRefresh}
                disabled={isLoading || isRefreshing}
              >
                {isRefreshing ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Rafraichir
              </Button>
            </div>
            <div className="rounded-2xl border border-[#DCE5F1] bg-white/80 px-4 py-3 text-sm text-[#64748B] shadow-sm backdrop-blur">
              {canManageLines ? (
                "Ajout, modification et suppression disponibles depuis la colonne Actions."
              ) : (
                "Mode lecture seule: les actions CRUD sont reservees aux managers et administrateurs."
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KPICard
          title="Total lignes"
          value={String(resolvedCounts.total)}
          description="Parc telecom consolide"
          icon={Phone}
          color="blue"
          emphasis="strong"
          density="compact"
        />
        <KPICard
          title="Lignes libres"
          value={String(resolvedCounts.total_libre)}
          description="Disponibles pour attribution"
          icon={Wifi}
          color="green"
          emphasis="strong"
          density="compact"
        />
        <KPICard
          title="Lignes en cours"
          value={String(resolvedCounts.total_en_cours)}
          description="Attributions partielles ou a finaliser"
          icon={LoaderCircle}
          color="orange"
          emphasis="strong"
          density="compact"
        />
        <KPICard
          title="Lignes suspendues"
          value={String(resolvedCounts.total_suspendues)}
          description="Blocages a traiter rapidement"
          icon={CirclePause}
          color="red"
          emphasis="strong"
          density="compact"
        />
      </section>

      <section className="rounded-[30px] border border-[#DCE5F1] bg-white p-5 shadow-[0_24px_70px_-54px_rgba(15,23,42,0.22)]">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#64748B]">
              Registre principal
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-[#0F172A]">
              Tableau de gestion des lignes
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#64748B]">
              Recherchez, filtrez et pilotez la flotte en un seul endroit. Les actions CRUD sont
              visibles a droite de chaque ligne pour reduire les frictions operateur.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#DCE5F1] bg-[#F8FAFC] px-4 py-3 text-sm text-[#475569]">
            <span>{filteredLines.length} ligne(s) visibles</span>
            <span className="h-1 w-1 rounded-full bg-[#94A3B8]" />
            <span>{formatNumberValue(resolvedCounts.total)} dans le parc</span>
            {isRefreshing ? (
              <>
                <span className="h-1 w-1 rounded-full bg-[#94A3B8]" />
                <span className="inline-flex items-center gap-2 text-[#1D4ED8]">
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  Synchronisation...
                </span>
              </>
            ) : null}
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          {filterOptions.map((option) => {
            const isActive = selectedOccupation === option.value;
            const optionMeta =
              option.value === "all" ? null : getOccupationMeta(option.value);

            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setSelectedOccupation(option.value)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-all",
                  isActive
                    ? optionMeta
                      ? `${optionMeta.badgeClassName} shadow-sm`
                      : "border-[#93C5FD] bg-[#EFF6FF] text-[#1D4ED8] shadow-sm"
                    : optionMeta
                      ? `border-transparent ${optionMeta.subtleClassName} opacity-80 hover:opacity-100`
                      : "border-[#E2E8F0] bg-white text-[#64748B] hover:border-[#BFDBFE] hover:bg-[#F8FBFF] hover:text-[#0F172A]",
                )}
              >
                <span>{option.label}</span>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs",
                    isActive
                      ? "bg-white/90 text-[#1D4ED8]"
                      : optionMeta
                        ? "bg-white/85 text-[#334155]"
                        : "bg-[#F8FAFC] text-[#475569]",
                  )}
                >
                  {option.count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-6 grid gap-3 xl:grid-cols-[minmax(0,1.55fr)_220px_240px_140px]">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[#64748B]" />
            <Input
              value={searchQuery}
              onChange={(event) => handleSearchChange(event.target.value)}
              placeholder="Numero, collaborateur, operateur, forfait..."
              className="h-12 rounded-2xl border-[#DCE5F1] bg-[#F8FAFC] pl-10"
            />
          </div>

          <Select value={selectedOperator} onValueChange={setSelectedOperator}>
            <SelectTrigger className="h-12 rounded-2xl border-[#DCE5F1] bg-[#F8FAFC]">
              <SelectValue placeholder="Filtrer par operateur" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les operateurs</SelectItem>
              {operatorOptions.map((operatorName) => (
                <SelectItem key={operatorName} value={operatorName}>
                  {operatorName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={selectedDepartment} onValueChange={setSelectedDepartment}>
            <SelectTrigger className="h-12 rounded-2xl border-[#DCE5F1] bg-[#F8FAFC]">
              <SelectValue placeholder="Filtrer par departement" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les departements</SelectItem>
              {departmentOptions.map((departmentName) => (
                <SelectItem key={departmentName} value={departmentName}>
                  {departmentName}
                </SelectItem>
              ))}
              {hasLinesWithoutDepartment ? (
                <SelectItem value={EMPTY_DEPARTMENT_FILTER_VALUE}>
                  Sans departement
                </SelectItem>
              ) : null}
            </SelectContent>
          </Select>

          <Select
            value={String(pageSize)}
            onValueChange={(value) => setPageSize(Number(value))}
          >
            <SelectTrigger className="h-12 rounded-2xl border-[#DCE5F1] bg-[#F8FAFC]">
              <SelectValue placeholder="Pagination" />
            </SelectTrigger>
            <SelectContent>
              {[10, 20, 50].map((value) => (
                <SelectItem key={value} value={String(value)}>
                  {value} lignes
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {errorMessage ? (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-[#B91C1C]">
            {errorMessage}
          </div>
        ) : null}

        {isLoading ? (
          <div className="mt-6 rounded-[28px] border border-[#E2E8F0] bg-[#F8FAFC] px-6 py-14 text-center">
            <div className="inline-flex items-center gap-3 text-sm text-[#475569]">
              <LoaderCircle className="h-4 w-4 animate-spin text-[#1D4ED8]" />
              Chargement de la flotte telecom...
            </div>
          </div>
        ) : filteredLines.length === 0 ? (
          <div className="mt-6 rounded-[28px] border border-dashed border-[#DCE5F1] bg-[linear-gradient(135deg,#F8FAFC,#FFFFFF)] px-6 py-14 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#EFF6FF] text-[#2563EB]">
              <Search className="h-5 w-5" />
            </div>
            <p className="mt-4 text-lg font-semibold text-[#0F172A]">
              Aucune ligne ne correspond aux filtres
            </p>
            <p className="mt-2 text-sm text-[#64748B]">
              Ajustez la recherche, le statut, l&apos;operateur ou le departement pour retrouver
              la ligne souhaitee.
            </p>
            {canManageLines ? (
              <Button
                type="button"
                className="mt-5 h-11 rounded-xl bg-[#2563EB] text-white hover:bg-[#1D4ED8]"
                onClick={openCreateModal}
              >
                <Plus className="h-4 w-4" />
                Ajouter une ligne
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="mt-6 overflow-hidden rounded-[28px] border border-[#E2E8F0] bg-white">
            <div className="border-b border-[#E2E8F0] bg-[linear-gradient(180deg,#FBFDFF,#F8FAFC)] px-5 py-4">
              <div className="flex items-center gap-3 text-sm text-[#475569]">
                <Badge className="border-[#DBEAFE] bg-[#EFF6FF] text-[#1D4ED8]">
                  CRUD complet
                </Badge>
                <span>Actions visibles a droite</span>
              </div>
            </div>

            <Table className="min-w-[1160px]">
              <TableHeader className="bg-[#F8FAFC]">
                <TableRow className="border-[#E2E8F0] hover:bg-[#F8FAFC]">
                  <TableHead className="px-4 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-[#64748B]">
                    Numero
                  </TableHead>
                  <TableHead className="px-4 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-[#64748B]">
                    Operateur
                  </TableHead>
                  <TableHead className="px-4 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-[#64748B]">
                    Forfait
                  </TableHead>
                  <TableHead className="px-4 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-[#64748B]">
                    Departement
                  </TableHead>
                  <TableHead className="px-4 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-[#64748B]">
                    Collaborateur
                  </TableHead>
                  <TableHead className="px-4 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-[#64748B]">
                    Statut
                  </TableHead>
                  <TableHead className="px-4 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-[#64748B]">
                    Usage
                  </TableHead>
                  <TableHead className="px-4 py-4 text-right text-xs font-semibold uppercase tracking-[0.18em] text-[#64748B]">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedLines.map((line) => {
                  const occupationStatus = deriveOccupationStatus(line);
                  const occupationMeta = getOccupationMeta(occupationStatus);
                  const usageRate = getUsageRate(line);

                  return (
                    <TableRow
                      key={line.id}
                      className="border-[#EEF2F7] hover:bg-[#F8FBFF]"
                    >
                      <TableCell className="px-4 py-4 align-top">
                        <div className="min-w-[170px]">
                          <p className="text-sm font-semibold text-[#0F172A]">
                            {line.phone_number}
                          </p>
                          <p className="mt-1 text-xs text-[#64748B]">
                            Mise a jour {formatDateLabel(line.updated_at)}
                          </p>
                        </div>
                      </TableCell>

                      <TableCell className="px-4 py-4 align-top">
                        <Badge className={cn("border px-3 py-1", getOperatorBadgeClass(line.operator_name))}>
                          {line.operator_name}
                        </Badge>
                      </TableCell>

                      <TableCell className="px-4 py-4 align-top">
                        <div className="min-w-[180px]">
                          <p className="text-sm font-medium text-[#0F172A]">{line.plan_name}</p>
                          <p className="mt-1 text-xs text-[#64748B]">
                            Limite {line.monthly_limit !== null ? `${line.monthly_limit} Go` : "Illimitee"}
                          </p>
                        </div>
                      </TableCell>

                      <TableCell className="px-4 py-4 align-top">
                        <div className="min-w-[150px]">
                          {line.department?.trim() ? (
                            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-[#475569]">
                              <Building2 className="h-3.5 w-3.5" />
                              {line.department}
                            </div>
                          ) : (
                            <span className="text-sm text-[#94A3B8]">Non renseigne</span>
                          )}
                        </div>
                      </TableCell>

                      <TableCell className="px-4 py-4 align-top">
                        <div className="min-w-[170px]">
                          <p className="text-sm font-medium text-[#0F172A]">
                            {line.assigned_to?.trim() || "Aucune attribution"}
                          </p>
                          <p className="mt-1 text-xs text-[#64748B]">
                            {line.assigned_to?.trim()
                              ? "Collaborateur rattache"
                              : "Ligne libre ou en attente"}
                          </p>
                        </div>
                      </TableCell>

                      <TableCell className="px-4 py-4 align-top">
                        <div className="min-w-[170px] space-y-2">
                          <Badge
                            className={cn(
                              "border px-3 py-1 text-xs font-semibold",
                              occupationMeta.badgeClassName,
                            )}
                          >
                            {occupationMeta.label}
                          </Badge>
                          <div className="flex flex-wrap gap-2">
                            <Badge
                              className={cn(
                                "border px-3 py-1",
                                getServiceStatusBadgeClass(line.status),
                              )}
                            >
                              {formatServiceStatusLabel(line.status)}
                            </Badge>
                            <span
                              className={cn(
                                "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium",
                                occupationMeta.subtleClassName,
                              )}
                            >
                              {occupationMeta.helper}
                            </span>
                          </div>
                        </div>
                      </TableCell>

                      <TableCell className="px-4 py-4 align-top">
                        <div className="min-w-[190px]">
                          <div className="flex items-center justify-between gap-3 text-sm">
                            <span className="text-[#475569]">Cycle courant</span>
                            <span className="font-semibold text-[#0F172A]">
                              {formatUsageValue(line.current_data_usage_gb)}
                            </span>
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-3 text-xs text-[#64748B]">
                            <span>Cycle precedent</span>
                            <span>{formatUsageValue(line.previous_data_usage_gb)}</span>
                          </div>
                          <div className="mt-3 h-2 rounded-full bg-[#E2E8F0]">
                            <div
                              className={cn(
                                "h-2 rounded-full",
                                usageRate === null
                                  ? "w-1/2 bg-[#94A3B8]"
                                  : usageRate >= 0.9
                                    ? "bg-[#DC2626]"
                                    : usageRate >= 0.7
                                      ? "bg-[#F97316]"
                                      : "bg-[#2563EB]",
                              )}
                              style={{
                                width:
                                  usageRate === null
                                    ? "50%"
                                    : `${Math.max(8, usageRate * 100)}%`,
                              }}
                            />
                          </div>
                        </div>
                      </TableCell>

                      <TableCell className="px-4 py-4 align-top">
                        <div className="flex justify-end gap-2">
                          <Button
                            asChild
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-10 w-10 rounded-xl text-[#1D4ED8] hover:bg-blue-50"
                          >
                            <Link to={`/lignes/${line.id}`} aria-label={`Voir ${line.phone_number}`}>
                              <Eye className="h-4 w-4" />
                            </Link>
                          </Button>

                          {canManageLines ? (
                            <>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-10 w-10 rounded-xl text-[#1D4ED8] hover:bg-blue-50"
                                onClick={() => openEditModal(line)}
                                aria-label={`Modifier ${line.phone_number}`}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-10 w-10 rounded-xl text-[#DC2626] hover:bg-red-50"
                                onClick={() => setLineToDelete(line)}
                                aria-label={`Supprimer ${line.phone_number}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="mt-6 flex flex-col gap-4 border-t border-[#E2E8F0] pt-5 xl:flex-row xl:items-center xl:justify-between">
          <div className="text-sm text-[#64748B]">
            Page {currentPageSafe} / {totalPages} - {filteredLines.length} ligne(s) visibles
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-10 rounded-xl border-[#DCE5F1] bg-white"
              onClick={() => setCurrentPage((value) => Math.max(1, value - 1))}
              disabled={currentPageSafe <= 1}
            >
              Precedent
            </Button>

            {visiblePages.map((pageNumber) => (
              <Button
                key={pageNumber}
                type="button"
                variant={pageNumber === currentPageSafe ? "default" : "outline"}
                className={cn(
                  "h-10 min-w-10 rounded-xl px-3",
                  pageNumber === currentPageSafe
                    ? "bg-[#2563EB] text-white hover:bg-[#1D4ED8]"
                    : "border-[#DCE5F1] bg-white text-[#475569]",
                )}
                onClick={() => setCurrentPage(pageNumber)}
              >
                {pageNumber}
              </Button>
            ))}

            <Button
              type="button"
              variant="outline"
              className="h-10 rounded-xl border-[#DCE5F1] bg-white"
              onClick={() => setCurrentPage((value) => Math.min(totalPages, value + 1))}
              disabled={currentPageSafe >= totalPages}
            >
              Suivant
            </Button>
          </div>
        </div>
      </section>

      <AddLineModal
        open={isModalOpen}
        mode={modalMode}
        initialData={initialModalData}
        operatorOptions={operatorOptions}
        departmentOptions={departmentOptions}
        planOptions={planOptions}
        isSubmitting={isSubmitting}
        errorMessage={modalErrorMessage}
        onClose={closeModal}
        onSubmit={handleSubmitLine}
      />

      <AlertDialog
        open={lineToDelete !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !isDeleting) {
            setLineToDelete(null);
          }
        }}
      >
        <AlertDialogContent className="rounded-[28px] border border-[#FECACA] bg-white p-0 shadow-[0_30px_90px_-38px_rgba(15,23,42,0.28)]">
          <div className="border-b border-[#FEE2E2] bg-[linear-gradient(135deg,#FEF2F2,#FFFFFF)] px-6 py-5">
            <AlertDialogHeader className="gap-2 text-left">
              <AlertDialogTitle className="flex items-center gap-3 text-2xl font-semibold text-[#0F172A]">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-red-100 text-[#DC2626]">
                  <ShieldAlert className="h-5 w-5" />
                </span>
                Supprimer cette ligne ?
              </AlertDialogTitle>
              <AlertDialogDescription className="text-sm leading-6 text-[#64748B]">
                Cette action supprimera definitivement la ligne du tableau et du backend.
              </AlertDialogDescription>
            </AlertDialogHeader>
          </div>

          <div className="space-y-4 px-6 py-5">
            <div className="rounded-2xl border border-[#FEE2E2] bg-[#FFF5F5] p-4">
              <p className="text-sm font-semibold text-[#0F172A]">
                {lineToDelete?.phone_number ?? "-"}
              </p>
              <p className="mt-1 text-sm text-[#64748B]">
                {lineToDelete?.operator_name ?? "-"} - {lineToDelete?.plan_name ?? "-"}
              </p>
              <p className="mt-2 text-xs text-[#64748B]">
                Collaborateur: {lineToDelete?.assigned_to?.trim() || "Aucune attribution"}
              </p>
            </div>

            <AlertDialogFooter className="gap-3">
              <AlertDialogCancel
                className="h-11 rounded-xl border-[#DCE5F1] text-[#475569]"
                disabled={isDeleting}
              >
                Annuler
              </AlertDialogCancel>
              <AlertDialogAction
                className="h-11 rounded-xl bg-[#DC2626] text-white hover:bg-[#B91C1C]"
                onClick={(event) => {
                  event.preventDefault();
                  void handleDeleteLine();
                }}
                disabled={isDeleting}
              >
                {isDeleting ? "Suppression..." : "Confirmer la suppression"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
