import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import {
  BadgeCheck,
  Building2,
  CalendarDays,
  ChartBar,
  ChevronLeft,
  ChevronRight,
  CirclePause,
  Eye,
  Package,
  Pencil,
  Plus,
  Phone,
  RefreshCw,
  Search,
  Upload,
  UserRound,
  UserX,
} from "lucide-react";

import KPICard from "../components/KPICard";
import CollaboratorAssignmentDrawer, {
  type CollaboratorAssignmentFormValues,
} from "../components/CollaboratorAssignmentDrawer";
import EmployeeImportDialog from "../components/EmployeeImportDialog";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
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
import { useAuth } from "../context/AuthContext";
import {
  ApiError,
  fleetAccessApi,
  phoneLinesApi,
  plansApi,
  usersApi,
  type ApiPhoneLine,
  type ApiPlan,
  type ApiUser,
} from "../lib/api";
import {
  getPlanActivationActionLabel,
  getPlanActivationStatusClasses,
  getPlanActivationStatusLabel,
  isPlanActive,
} from "../lib/plan-activation";
import { canApplyOperationalChanges, isAdminUser } from "../lib/roles";

const API_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 8;

type AssignmentStatus = "active" | "inactive" | "suspended";
type AssignmentAction = "suspend" | "reactivate" | "remove";

interface AssignedPlanRow {
  line: ApiPhoneLine;
  plan: ApiPlan | null;
  collaboratorName: string;
  collaboratorIdentifier: string;
  departmentLabel: string;
  planLabel: string;
  operatorLabel: string;
  planType: string;
  status: AssignmentStatus;
  currentUsageGb: number;
  previousUsageGb: number;
  monthlyLimitGb: number | null;
  currentConsumptionLabel: string;
  usageProgress: number | null;
  activationDateLabel: string;
}

function normalizeError(error: unknown, fallbackMessage: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return fallbackMessage;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function formatDate(value: string): string {
  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) return "--";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsedDate);
}

function formatUsage(value: number): string {
  const decimals = value > 0 && value < 10 ? 1 : 0;
  return `${value.toFixed(decimals)} Go`;
}

function extractQuotaGb(value: string | null | undefined): number | null {
  if (!value) return null;

  const normalizedValue = value.replace(",", ".");
  const match = normalizedValue.match(/(\d+(?:\.\d+)?)\s*(to|tb|go|gb)/i);
  if (!match) return null;

  const amount = Number(match[1]);
  if (Number.isNaN(amount)) return null;

  return match[2].toLowerCase().includes("t") ? amount * 1024 : amount;
}

function derivePlanType(plan: ApiPlan | null, line: ApiPhoneLine): string {
  const descriptor = normalizeText(`${plan?.name ?? line.plan_name} ${plan?.roaming_zone ?? ""}`);
  if (descriptor.includes("business")) return "Business";
  if (descriptor.includes("premium") || descriptor.includes("international") || descriptor.includes("monde")) {
    return "Premium";
  }

  const quota = extractQuotaGb(plan?.data_quota);
  return quota !== null && quota >= 50 ? "Business" : "Standard";
}

function getStatusValue(status: string): AssignmentStatus {
  return status === "inactive" || status === "suspended" ? status : "active";
}

function getStatusLabel(status: AssignmentStatus): string {
  if (status === "inactive") return "Inactif";
  if (status === "suspended") return "Suspendu";
  return "Actif";
}

function getStatusClasses(status: AssignmentStatus): string {
  if (status === "inactive") return "border-slate-200 bg-slate-50 text-[#475569]";
  if (status === "suspended") return "border-amber-200 bg-amber-50 text-[#B45309]";
  return "border-emerald-200 bg-emerald-50 text-[#059669]";
}

function getPlanTypeClasses(planType: string): string {
  if (planType === "Premium") return "border-violet-200 bg-violet-50 text-[#6D28D9]";
  if (planType === "Business") return "border-blue-200 bg-blue-50 text-[#1D4ED8]";
  return "border-slate-200 bg-slate-50 text-[#475569]";
}

function getUsageBarClasses(progress: number | null): string {
  if (progress === null) return "bg-[#CBD5E1]";
  if (progress >= 90) return "bg-[#DC2626]";
  if (progress >= 70) return "bg-[#D97706]";
  return "bg-[#16A34A]";
}

function getIdentifier(lineId: number): string {
  return `LIG-${String(lineId).padStart(4, "0")}`;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normalizePhoneNumber(value: string): string {
  const compactValue = value.replace(/\s+/g, "");
  if (compactValue.startsWith("+")) {
    return `+${compactValue.slice(1).replace(/\D/g, "")}`;
  }
  return compactValue.replace(/\D/g, "");
}

function generateTemporaryPassword(): string {
  const characters = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const randomValues = new Uint32Array(10);

  if (typeof window !== "undefined" && window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(randomValues);
  } else {
    for (let index = 0; index < randomValues.length; index += 1) {
      randomValues[index] = Math.floor(Math.random() * characters.length);
    }
  }

  const generatedSuffix = Array.from(randomValues, (value) => characters[value % characters.length]).join("");
  return `BcSkills!${generatedSuffix}`;
}

function formatActivationDateForNote(value: string): string {
  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsedDate);
}

function buildAssignmentNotes(values: CollaboratorAssignmentFormValues): string | null {
  const noteParts: string[] = [];

  if (values.source_mode === "imported" && values.imported_employee_id !== null) {
    noteParts.push(`Employe importe #${values.imported_employee_id}`);
  }
  if (values.employee_identifier.trim()) {
    noteParts.push(`Identifiant RH: ${values.employee_identifier.trim()}`);
  }
  if (values.employee_code.trim()) {
    noteParts.push(`Matricule: ${values.employee_code.trim()}`);
  }
  if (values.activation_date) {
    noteParts.push(`Activation souhaitee: ${formatActivationDateForNote(values.activation_date)}`);
  }
  if (values.notes.trim()) {
    noteParts.push(values.notes.trim());
  }

  return noteParts.length > 0 ? noteParts.join(" | ") : null;
}

async function fetchAllPhoneLines(token: string): Promise<ApiPhoneLine[]> {
  const rows: ApiPhoneLine[] = [];
  let offset = 0;

  while (true) {
    const batch = await phoneLinesApi.list(token, { offset, limit: API_PAGE_SIZE });
    rows.push(...batch);
    if (batch.length < API_PAGE_SIZE) break;
    offset += batch.length;
  }

  return rows;
}

async function fetchAllPlans(token: string): Promise<ApiPlan[]> {
  const rows: ApiPlan[] = [];
  let offset = 0;

  while (true) {
    const batch = await plansApi.list(token, { offset, limit: API_PAGE_SIZE });
    rows.push(...batch);
    if (batch.length < API_PAGE_SIZE) break;
    offset += batch.length;
  }

  return rows;
}

export default function PlanAssignments() {
  const { token, user } = useAuth();
  const [phoneLines, setPhoneLines] = useState<ApiPhoneLine[]>([]);
  const [plans, setPlans] = useState<ApiPlan[]>([]);
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPlanType, setSelectedPlanType] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [selectedDepartment, setSelectedDepartment] = useState("all");
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [currentPage, setCurrentPage] = useState(1);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [employeesRefreshKey, setEmployeesRefreshKey] = useState(0);
  const [isCreateDrawerOpen, setIsCreateDrawerOpen] = useState(false);
  const [isCreatingCollaborator, setIsCreatingCollaborator] = useState(false);
  const [createCollaboratorError, setCreateCollaboratorError] = useState<string | null>(null);
  const [highlightedLineId, setHighlightedLineId] = useState<number | null>(null);
  const [detailLineId, setDetailLineId] = useState<number | null>(null);
  const [editingLineId, setEditingLineId] = useState<number | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [rowActionKey, setRowActionKey] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ lineId: number; type: AssignmentAction } | null>(null);

  const canMutateAssignments = canApplyOperationalChanges(user);
  const canCreateCollaborator = isAdminUser(user);

  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      if (!token) {
        if (isMounted) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
        return;
      }

      if (reloadKey === 0) setIsLoading(true);
      setErrorMessage(null);

      try {
        const [linesResult, plansResult, usersResult] = await Promise.allSettled([
          fetchAllPhoneLines(token),
          fetchAllPlans(token),
          fleetAccessApi.users(token),
        ]);

        if (!isMounted) return;
        if (linesResult.status === "rejected") throw linesResult.reason;
        if (plansResult.status === "rejected") throw plansResult.reason;

        setPhoneLines(linesResult.value);
        setPlans(plansResult.value);
        setUsers(usersResult.status === "fulfilled" ? usersResult.value : []);
      } catch (error) {
        if (isMounted) {
          setErrorMessage(normalizeError(error, "Impossible de charger les forfaits attribues."));
          setPhoneLines([]);
          setPlans([]);
          setUsers([]);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    }

    void loadData();
    return () => {
      isMounted = false;
    };
  }, [reloadKey, token]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedPlanType, selectedStatus, selectedDepartment, pageSize]);

  const userByName = useMemo(() => {
    const map = new Map<string, ApiUser>();
    users.forEach((currentUser) => {
      const key = normalizeText(currentUser.full_name);
      if (key && !map.has(key)) map.set(key, currentUser);
    });
    return map;
  }, [users]);

  const planLookup = useMemo(() => {
    const byCompositeKey = new Map<string, ApiPlan>();
    const byName = new Map<string, ApiPlan>();

    plans.forEach((plan) => {
      const nameKey = normalizeText(plan.name);
      byCompositeKey.set(`${nameKey}::${normalizeText(plan.operator_name)}`, plan);
      if (nameKey && !byName.has(nameKey)) byName.set(nameKey, plan);
    });

    return { byCompositeKey, byName };
  }, [plans]);

  const availablePlans = useMemo(
    () =>
      [...plans].sort(
        (left, right) =>
          left.operator_name.localeCompare(right.operator_name, "fr", { sensitivity: "base" }) ||
          left.name.localeCompare(right.name, "fr", { sensitivity: "base" }),
      ),
    [plans],
  );

  const availableUnassignedLines = useMemo(
    () =>
      phoneLines
        .filter((line) => !line.assigned_to?.trim())
        .sort(
          (left, right) =>
            left.operator_name.localeCompare(right.operator_name, "fr", {
              sensitivity: "base",
            }) || left.phone_number.localeCompare(right.phone_number, "fr", { sensitivity: "base" }),
        ),
    [phoneLines],
  );

  const rows = useMemo(() => {
    return phoneLines
      .filter((line) => Boolean(line.assigned_to?.trim()) && Boolean(line.plan_name?.trim()))
      .map((line) => {
        const plan =
          planLookup.byCompositeKey.get(`${normalizeText(line.plan_name)}::${normalizeText(line.operator_name)}`) ??
          planLookup.byName.get(normalizeText(line.plan_name)) ??
          null;
        const matchedUser = userByName.get(normalizeText(line.assigned_to));
        const monthlyLimitGb = line.monthly_limit ?? extractQuotaGb(plan?.data_quota);
        const currentUsageGb = Number(line.current_data_usage_gb ?? 0);
        const previousUsageGb = Number(line.previous_data_usage_gb ?? 0);
        const usageProgress =
          monthlyLimitGb !== null && monthlyLimitGb > 0
            ? Math.max(0, Math.min((currentUsageGb / monthlyLimitGb) * 100, 100))
            : null;

        return {
          line,
          plan,
          collaboratorName: line.assigned_to?.trim() || "Collaborateur non renseigne",
          collaboratorIdentifier: matchedUser?.email ?? getIdentifier(line.id),
          departmentLabel: line.department?.trim() || "Non renseigne",
          planLabel: plan?.name ?? line.plan_name,
          operatorLabel: plan?.operator_name ?? line.operator_name,
          planType: derivePlanType(plan, line),
          status: getStatusValue(line.status),
          currentUsageGb,
          previousUsageGb,
          monthlyLimitGb,
          currentConsumptionLabel:
            monthlyLimitGb !== null
              ? `${formatUsage(currentUsageGb)} / ${formatUsage(monthlyLimitGb)}`
              : formatUsage(currentUsageGb),
          usageProgress,
          activationDateLabel: formatDate(line.created_at),
        } satisfies AssignedPlanRow;
      })
      .sort(
        (left, right) =>
          left.collaboratorName.localeCompare(right.collaboratorName, "fr", { sensitivity: "base" }) ||
          left.line.phone_number.localeCompare(right.line.phone_number),
      );
  }, [phoneLines, planLookup, userByName]);

  const rowById = useMemo(() => new Map(rows.map((row) => [row.line.id, row])), [rows]);
  const detailRow = detailLineId !== null ? rowById.get(detailLineId) ?? null : null;
  const editingRow = editingLineId !== null ? rowById.get(editingLineId) ?? null : null;
  const confirmRow = confirmAction ? rowById.get(confirmAction.lineId) ?? null : null;

  const normalizedSearchQuery = normalizeText(searchQuery);
  const planTypeOptions = Array.from(new Set(rows.map((row) => row.planType))).sort();
  const departmentOptions = Array.from(new Set(rows.map((row) => row.departmentLabel))).sort((left, right) =>
    left.localeCompare(right, "fr", { sensitivity: "base" }),
  );

  const filteredRows = rows.filter((row) => {
    if (selectedPlanType !== "all" && row.planType !== selectedPlanType) return false;
    if (selectedStatus !== "all" && row.status !== selectedStatus) return false;
    if (selectedDepartment !== "all" && row.departmentLabel !== selectedDepartment) return false;
    if (!normalizedSearchQuery) return true;

    return normalizeText(
      [row.collaboratorName, row.collaboratorIdentifier, row.departmentLabel, row.line.phone_number, row.planLabel, row.planType, row.operatorLabel].join(" "),
    ).includes(normalizedSearchQuery);
  });

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const totalAssigned = rows.length;
  const activeAssigned = rows.filter((row) => row.status === "active").length;
  const suspendedAssigned = rows.filter((row) => row.status === "suspended").length;
  const departmentsCovered = new Set(rows.map((row) => row.departmentLabel).filter((value) => value !== "Non renseigne")).size;
  const visibleFrom = filteredRows.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const visibleTo = Math.min(currentPage * pageSize, filteredRows.length);
  const selectedTargetPlan =
    selectedPlanId !== null
      ? availablePlans.find((plan) => String(plan.id) === selectedPlanId) ?? null
      : null;

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  useEffect(() => {
    if (highlightedLineId === null) return undefined;

    const timeoutId = window.setTimeout(() => {
      setHighlightedLineId(null);
    }, 4500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [highlightedLineId]);

  useEffect(() => {
    if (!editingRow) {
      setSelectedPlanId(null);
      return;
    }

    const currentPlanId =
      editingRow.plan?.id ??
      availablePlans.find((plan) => normalizeText(plan.name) === normalizeText(editingRow.planLabel))?.id ??
      null;

    setSelectedPlanId(currentPlanId ? String(currentPlanId) : null);
  }, [availablePlans, editingRow]);

  function updateLineInState(updatedLine: ApiPhoneLine) {
    setPhoneLines((currentLines) =>
      currentLines.map((line) => (line.id === updatedLine.id ? updatedLine : line)),
    );
  }

  function upsertLineInState(savedLine: ApiPhoneLine) {
    setPhoneLines((currentLines) => {
      const existingIndex = currentLines.findIndex((line) => line.id === savedLine.id);
      if (existingIndex === -1) {
        return [savedLine, ...currentLines];
      }

      return currentLines.map((line) => (line.id === savedLine.id ? savedLine : line));
    });
  }

  function upsertUserInState(savedUser: ApiUser) {
    setUsers((currentUsers) => {
      const existingIndex = currentUsers.findIndex((currentUser) => currentUser.id === savedUser.id);
      if (existingIndex === -1) {
        return [savedUser, ...currentUsers];
      }

      return currentUsers.map((currentUser) =>
        currentUser.id === savedUser.id ? savedUser : currentUser,
      );
    });
  }

  function upsertPlanInState(savedPlan: ApiPlan) {
    setPlans((currentPlans) => {
      const existingIndex = currentPlans.findIndex((plan) => plan.id === savedPlan.id);
      if (existingIndex === -1) {
        return [savedPlan, ...currentPlans];
      }

      return currentPlans.map((plan) => (plan.id === savedPlan.id ? savedPlan : plan));
    });
  }

  function focusAssignmentOnTable(collaboratorName: string, lineId: number) {
    setSearchQuery(collaboratorName);
    setSelectedPlanType("all");
    setSelectedStatus("all");
    setSelectedDepartment("all");
    setCurrentPage(1);
    setHighlightedLineId(lineId);
  }

  async function handleCreateCollaborator(values: CollaboratorAssignmentFormValues) {
    if (!token) return;

    const selectedPlan = plans.find((plan) => plan.id === values.plan_id);
    if (!selectedPlan) {
      setCreateCollaboratorError("Le forfait selectionne n'est plus disponible.");
      return;
    }

    const normalizedEmail = normalizeEmail(values.email);
    const duplicateUser = users.some((currentUser) => normalizeEmail(currentUser.email) === normalizedEmail);
    if (duplicateUser) {
      setCreateCollaboratorError("Un collaborateur avec cet email existe deja.");
      return;
    }

    if (values.assignment_mode === "new") {
      const normalizedPhone = normalizePhoneNumber(values.phone_number);
      const duplicateLine = phoneLines.some(
        (line) => normalizePhoneNumber(line.phone_number) === normalizedPhone,
      );
      if (duplicateLine) {
        setCreateCollaboratorError("Ce numero de ligne existe deja dans la flotte.");
        return;
      }
    }

    setIsCreatingCollaborator(true);
    setCreateCollaboratorError(null);

    const existingUser =
      users.find((currentUser) => normalizeEmail(currentUser.email) === normalizedEmail) ?? null;
    let createdUser: ApiUser | null = null;
    let shouldRollbackCreatedUser = false;

    try {
      if (existingUser) {
        createdUser = await usersApi.update(token, existingUser.id, {
          full_name: values.full_name,
          department_id: values.department_id,
          job_profile: values.job_profile,
          is_active: values.status !== "inactive",
        });
      } else {
        createdUser = await usersApi.create(token, {
          full_name: values.full_name,
          email: normalizedEmail,
          password: generateTemporaryPassword(),
          role: "user",
          department_id: values.department_id,
          job_profile: values.job_profile,
          is_active: values.status !== "inactive",
        });
        shouldRollbackCreatedUser = true;
      }

      const assignmentNotes = buildAssignmentNotes(values);
      let savedLine: ApiPhoneLine;

      if (values.assignment_mode === "existing") {
        const targetLine = phoneLines.find((line) => line.id === values.existing_line_id);
        if (!targetLine) {
          throw new Error("La ligne selectionnee n'est plus disponible.");
        }
        if (targetLine.assigned_to?.trim()) {
          throw new Error("Cette ligne vient d'etre attribuee. Rafraichissez la vue et recommencez.");
        }
        if (normalizeText(targetLine.operator_name) !== normalizeText(selectedPlan.operator_name)) {
          throw new Error("Le forfait selectionne n'est pas compatible avec l'operateur de cette ligne.");
        }

        savedLine = await phoneLinesApi.update(token, targetLine.id, {
          assigned_to: values.full_name,
          department: values.department_name,
          status: values.status,
          plan_name: selectedPlan.name,
          operator_name: targetLine.operator_name,
          monthly_limit: extractQuotaGb(selectedPlan.data_quota),
          notes: assignmentNotes,
        });
      } else {
        savedLine = await phoneLinesApi.create(token, {
          phone_number: normalizePhoneNumber(values.phone_number),
          assigned_to: values.full_name,
          department: values.department_name,
          operator_name: selectedPlan.operator_name,
          plan_name: selectedPlan.name,
          status: values.status,
          monthly_limit: extractQuotaGb(selectedPlan.data_quota),
          notes: assignmentNotes,
        });
      }

      upsertUserInState(createdUser);
      upsertLineInState(savedLine);
      focusAssignmentOnTable(createdUser.full_name, savedLine.id);
      setIsCreateDrawerOpen(false);

      toast.success(existingUser ? "Attribution ajoutee" : "Collaborateur ajoute", {
        description: existingUser
          ? `${createdUser.full_name} a ete reutilise puis attribue a ${selectedPlan.name}.`
          : `${createdUser.full_name} a ete cree et attribue a ${selectedPlan.name}.`,
      });
    } catch (error) {
      let description = normalizeError(
        error,
        "Le collaborateur n'a pas pu etre cree avec son attribution telecom.",
      );

      if (createdUser && shouldRollbackCreatedUser) {
        try {
          await usersApi.remove(token, createdUser.id);
        } catch {
          upsertUserInState(createdUser);
          description = `${description} Le compte collaborateur a ete cree mais n'a pas pu etre annule automatiquement.`;
        }
      }

      setCreateCollaboratorError(description);
    } finally {
      setIsCreatingCollaborator(false);
    }
  }

  async function handleUpdatePlan() {
    if (!token || !editingRow || !selectedTargetPlan) return;

    const actionKey = `plan:${editingRow.line.id}`;
    setRowActionKey(actionKey);

    try {
      const activationResponse = await plansApi.activatePlan(token, {
        plan_id: selectedTargetPlan.id,
        phone_line_id: editingRow.line.id,
      });

      if (activationResponse.phone_line) {
        updateLineInState(activationResponse.phone_line);
      }
      upsertPlanInState(activationResponse.plan);
      setEditingLineId(null);
      toast.success("Forfait active avec succes", {
        description: `${editingRow.collaboratorName} passe maintenant sur ${selectedTargetPlan.name}.`,
      });
    } catch (error) {
      toast.error("Activation impossible", {
        description: normalizeError(error, "Le forfait n'a pas pu etre active."),
      });
    } finally {
      setRowActionKey(null);
    }
  }

  async function handleActivateAssignedPlan(row: AssignedPlanRow) {
    if (!token || !row.plan) return;

    const actionKey = `activate:${row.line.id}`;
    setRowActionKey(actionKey);

    try {
      const activationResponse = await plansApi.activatePlan(token, {
        plan_id: row.plan.id,
        phone_line_id: row.line.id,
      });

      if (activationResponse.phone_line) {
        updateLineInState(activationResponse.phone_line);
      }
      upsertPlanInState(activationResponse.plan);

      toast.success("Forfait active avec succes", {
        description: `${row.planLabel} est actif pour ${row.collaboratorName}.`,
      });
    } catch (error) {
      toast.error("Activation impossible", {
        description: normalizeError(error, "Le forfait n'a pas pu etre active."),
      });
    } finally {
      setRowActionKey(null);
    }
  }

  async function handleExecuteAction() {
    if (!token || !confirmAction || !confirmRow) return;

    const actionKey = `${confirmAction.type}:${confirmRow.line.id}`;
    setRowActionKey(actionKey);

    try {
      const updatedLine = await phoneLinesApi.update(
        token,
        confirmRow.line.id,
        confirmAction.type === "remove"
          ? { assigned_to: null, department: null }
          : { status: confirmAction.type === "suspend" ? "suspended" : "active" },
      );

      updateLineInState(updatedLine);
      setConfirmAction(null);
      if (confirmAction.type === "remove" && detailLineId === updatedLine.id) {
        setDetailLineId(null);
      }

      toast.success(
        confirmAction.type === "remove"
          ? "Attribution retiree"
          : confirmAction.type === "suspend"
            ? "Ligne suspendue"
            : "Ligne reactivee",
      );
    } catch (error) {
      toast.error("Action refusee", {
        description: normalizeError(error, "La ligne n'a pas pu etre mise a jour."),
      });
    } finally {
      setRowActionKey(null);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="max-w-3xl">
          <Badge className="border-[#BFDBFE] bg-[#EFF6FF] px-3 py-1 text-[#1D4ED8]">
            Pilotage des attributions telecom
          </Badge>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-[#0F172A]">
            Lignes et forfaits attribues
          </h1>
          <p className="mt-3 text-base leading-7 text-[#64748B]">
            Vue metier des collaborateurs equipes, du forfait attribue et de la consommation
            actuelle, avec actions de gestion rapides.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link
            to="/forfaits"
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-[#0F172A] transition-all hover:bg-[#F8FAFC]"
          >
            <Package className="h-4 w-4" />
            Catalogue forfaits
          </Link>
          {canMutateAssignments ? (
            <button
              type="button"
              onClick={() => {
                setCreateCollaboratorError(null);
                setIsCreateDrawerOpen(true);
              }}
              disabled={!canCreateCollaborator}
              title={
                canCreateCollaborator
                  ? "Ajouter un collaborateur et lui attribuer une ligne"
                  : "Creation de collaborateur reservee aux administrateurs"
              }
              className="inline-flex items-center gap-2 rounded-xl border border-[#C7D2FE] bg-[linear-gradient(135deg,#EFF6FF,#FFFFFF)] px-4 py-2.5 text-sm font-medium text-[#1D4ED8] shadow-sm transition-all hover:-translate-y-[1px] hover:shadow-md disabled:cursor-not-allowed disabled:opacity-55"
            >
              <Plus className="h-4 w-4" />
              Ajouter un collaborateur
            </button>
          ) : null}
          {canMutateAssignments ? (
            <button
              type="button"
            onClick={() => setIsImportDialogOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-[#0F172A] transition-all hover:bg-[#F8FAFC]"
          >
              <Upload className="h-4 w-4" />
              Importer collaborateurs
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setIsRefreshing(true);
              setReloadKey((value) => value + 1);
            }}
            disabled={isRefreshing}
            className="inline-flex items-center gap-2 rounded-xl bg-[linear-gradient(135deg,#1D4ED8,#2563EB)] px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-blue-500/20 transition-all hover:-translate-y-[1px] hover:shadow-blue-500/30 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            Rafraichir
          </button>
        </div>
      </div>

      {errorMessage ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-[#B91C1C]">
          {errorMessage}
        </div>
      ) : null}

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div
              key={`assignment-skeleton-${index}`}
              className="h-[152px] animate-pulse rounded-2xl border border-[#DCE5F1] bg-[linear-gradient(135deg,#F8FAFC,#FFFFFF)]"
            />
          ))}
        </div>
      ) : totalAssigned === 0 ? (
        <div className="rounded-[28px] border border-[#DCE5F1] bg-[linear-gradient(135deg,#FFFFFF,#F8FAFC)] p-8 text-center shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#EEF4FF] text-[#2D6CDF]">
            <UserRound className="h-8 w-8" />
          </div>
          <h2 className="mt-5 text-2xl font-semibold text-[#0F172A]">
            Aucune attribution de forfait pour le moment
          </h2>
          <p className="mt-3 text-sm leading-7 text-[#64748B]">
            La vue sera alimentee automatiquement des qu'une ligne sera rattachee a un
            collaborateur avec un forfait actif.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <KPICard title="Personnes avec forfait" value={String(totalAssigned)} description="Attributions visibles dans le portefeuille courant" icon={UserRound} color="blue" emphasis="strong" />
            <KPICard title="Lignes actives" value={String(activeAssigned)} description="Collaborateurs exploitables immediatement" icon={BadgeCheck} color="green" />
            <KPICard title="Lignes suspendues" value={String(suspendedAssigned)} description="Attributions a reviser ou relancer" icon={CirclePause} color="orange" />
            <KPICard title="Departements couverts" value={String(departmentsCovered)} description="Services representes dans la flotte equipee" icon={Building2} color="purple" />
          </div>

          <div className="rounded-[28px] border border-[#DCE5F1] bg-white p-5 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-[minmax(260px,1.35fr)_repeat(3,minmax(180px,0.9fr))]">
                <div className="space-y-2">
                  <label htmlFor="plan-assignment-search" className="text-xs font-semibold uppercase tracking-[0.16em] text-[#64748B]">Recherche</label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94A3B8]" />
                    <Input id="plan-assignment-search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Nom, email, ligne ou forfait..." className="h-11 rounded-xl border-[#DCE5F1] bg-[#F8FAFC] pl-10" />
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#64748B]">Type de forfait</p>
                  <Select value={selectedPlanType} onValueChange={setSelectedPlanType}>
                    <SelectTrigger className="h-11 rounded-xl border-[#DCE5F1] bg-[#F8FAFC]"><SelectValue placeholder="Tous les types" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Tous les types</SelectItem>
                      {planTypeOptions.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#64748B]">Statut</p>
                  <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                    <SelectTrigger className="h-11 rounded-xl border-[#DCE5F1] bg-[#F8FAFC]"><SelectValue placeholder="Tous les statuts" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Tous les statuts</SelectItem>
                      <SelectItem value="active">Actif</SelectItem>
                      <SelectItem value="suspended">Suspendu</SelectItem>
                      <SelectItem value="inactive">Inactif</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#64748B]">Departement</p>
                  <Select value={selectedDepartment} onValueChange={setSelectedDepartment}>
                    <SelectTrigger className="h-11 rounded-xl border-[#DCE5F1] bg-[#F8FAFC]"><SelectValue placeholder="Tous les services" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Tous les services</SelectItem>
                      {departmentOptions.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="min-w-[240px] rounded-2xl border border-[#BFDBFE] bg-[linear-gradient(135deg,#EFF6FF,#FFFFFF)] px-5 py-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#1D4ED8]">Attributions visibles</p>
                <p className="mt-2 text-3xl font-semibold tracking-tight text-[#0F172A]">{filteredRows.length}</p>
                <p className="mt-1 text-sm text-[#64748B]">sur {totalAssigned} personnes equipees</p>
              </div>
            </div>
          </div>

          <div className="rounded-[28px] border border-[#DCE5F1] bg-white shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
            <div className="flex flex-col gap-3 border-b border-[#E2E8F0] px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-[#0F172A]">Tableau des attributions</h2>
                <p className="mt-1 text-sm text-[#64748B]">Vue consolidee des collaborateurs, lignes et forfaits attribues.</p>
              </div>
              <Badge className="border-[#DCE5F1] bg-white px-3 py-1 text-[#475569]">
                {filteredRows.length} resultat{filteredRows.length > 1 ? "s" : ""}
              </Badge>
            </div>

            {filteredRows.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#EEF4FF] text-[#2D6CDF]">
                  <Search className="h-6 w-6" />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-[#0F172A]">Aucun resultat</h3>
                <p className="mt-2 text-sm leading-6 text-[#64748B]">Ajustez les filtres pour retrouver un collaborateur, une ligne ou un forfait.</p>
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    setSelectedPlanType("all");
                    setSelectedStatus("all");
                    setSelectedDepartment("all");
                  }}
                  className="mt-5 inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-[#0F172A] transition-all hover:bg-[#F8FAFC]"
                >
                  Reinitialiser les filtres
                </button>
              </div>
            ) : (
              <>
                <Table className="min-w-[1240px]">
                  <TableHeader className="bg-[#F8FAFC]">
                    <TableRow className="border-b border-[#E2E8F0] hover:bg-[#F8FAFC]">
                      <TableHead className="px-6 py-4 text-xs font-semibold uppercase tracking-[0.16em] text-[#64748B]">Collaborateur</TableHead>
                      <TableHead className="px-6 py-4 text-xs font-semibold uppercase tracking-[0.16em] text-[#64748B]">Email ou identifiant</TableHead>
                      <TableHead className="px-6 py-4 text-xs font-semibold uppercase tracking-[0.16em] text-[#64748B]">Numero de ligne</TableHead>
                      <TableHead className="px-6 py-4 text-xs font-semibold uppercase tracking-[0.16em] text-[#64748B]">Forfait attribue</TableHead>
                      <TableHead className="px-6 py-4 text-xs font-semibold uppercase tracking-[0.16em] text-[#64748B]">Type</TableHead>
                      <TableHead className="px-6 py-4 text-xs font-semibold uppercase tracking-[0.16em] text-[#64748B]">Statut</TableHead>
                      <TableHead className="px-6 py-4 text-xs font-semibold uppercase tracking-[0.16em] text-[#64748B]">Consommation</TableHead>
                      <TableHead className="px-6 py-4 text-xs font-semibold uppercase tracking-[0.16em] text-[#64748B]">Activation</TableHead>
                      <TableHead className="px-6 py-4 text-xs font-semibold uppercase tracking-[0.16em] text-[#64748B]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {currentRows.map((row) => (
                      <TableRow
                        key={row.line.id}
                        className={
                          highlightedLineId === row.line.id
                            ? "border-b border-[#BFDBFE] bg-[#EFF6FF] transition-colors hover:bg-[#DBEAFE]"
                            : "border-b border-[#E2E8F0] bg-white transition-colors hover:bg-[#F8FAFC]"
                        }
                      >
                        <TableCell className="px-6 py-5 align-top whitespace-normal">
                          <div className="flex items-start gap-3">
                            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#EEF4FF] text-[#2D6CDF]">
                              <UserRound className="h-5 w-5" />
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-[#0F172A]">{row.collaboratorName}</p>
                              <p className="mt-1 text-sm text-[#64748B]">{row.departmentLabel}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="px-6 py-5 align-top whitespace-normal">
                          <p className="text-sm font-medium text-[#0F172A]">{row.collaboratorIdentifier}</p>
                          <p className="mt-1 text-xs uppercase tracking-[0.14em] text-[#94A3B8]">Identifiant de contact</p>
                        </TableCell>
                        <TableCell className="px-6 py-5 align-top whitespace-normal">
                          <div className="flex items-center gap-2 text-sm font-medium text-[#0F172A]">
                            <Phone className="h-4 w-4 text-[#2D6CDF]" />
                            <span>{row.line.phone_number}</span>
                          </div>
                          <p className="mt-1 text-sm text-[#64748B]">{row.operatorLabel}</p>
                        </TableCell>
                        <TableCell className="px-6 py-5 align-top whitespace-normal">
                          <p className="text-sm font-semibold text-[#0F172A]">{row.planLabel}</p>
                          <p className="mt-1 text-sm text-[#64748B]">{row.plan?.description ?? `Portefeuille ${row.operatorLabel}`}</p>
                          {row.plan ? (
                            <Badge className={`mt-2 px-3 py-1 ${getPlanActivationStatusClasses(row.plan.activation_status)}`}>
                              {getPlanActivationStatusLabel(row.plan.activation_status)}
                            </Badge>
                          ) : null}
                        </TableCell>
                        <TableCell className="px-6 py-5 align-top"><Badge className={`px-3 py-1 ${getPlanTypeClasses(row.planType)}`}>{row.planType}</Badge></TableCell>
                        <TableCell className="px-6 py-5 align-top"><Badge className={`px-3 py-1 ${getStatusClasses(row.status)}`}>{getStatusLabel(row.status)}</Badge></TableCell>
                        <TableCell className="px-6 py-5 align-top whitespace-normal">
                          <div className="min-w-[180px] space-y-2 rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-3.5">
                            <div className="flex items-center justify-between gap-3 text-sm">
                              <span className="text-[#64748B]">Usage</span>
                              <span className="font-semibold text-[#0F172A]">{row.currentConsumptionLabel}</span>
                            </div>
                            <div className="h-2 rounded-full bg-[#E2E8F0]">
                              <div className={`h-2 rounded-full ${getUsageBarClasses(row.usageProgress)}`} style={{ width: `${row.usageProgress ?? 24}%` }} />
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="px-6 py-5 align-top whitespace-normal">
                          <div className="flex items-center gap-2 text-sm font-medium text-[#0F172A]">
                            <CalendarDays className="h-4 w-4 text-[#64748B]" />
                            <span>{row.activationDateLabel}</span>
                          </div>
                        </TableCell>
                        <TableCell className="px-6 py-5 align-top whitespace-normal">
                          <div className="flex min-w-[320px] flex-wrap gap-2">
                            <Button type="button" size="sm" variant="outline" className="rounded-xl border-gray-200 bg-white" onClick={() => setDetailLineId(row.line.id)}>
                              <Eye className="h-4 w-4" />
                              Detail
                            </Button>
                            <Button type="button" size="sm" variant="outline" className="rounded-xl border-blue-200 bg-blue-50 text-[#1D4ED8] hover:bg-blue-100 hover:text-[#1D4ED8]" onClick={() => setDetailLineId(row.line.id)}>
                              <ChartBar className="h-4 w-4" />
                              Consommation
                            </Button>
                            {canMutateAssignments ? (
                              <>
                                <Button type="button" size="sm" variant="outline" disabled={rowActionKey === `plan:${row.line.id}`} className="rounded-xl border-violet-200 bg-violet-50 text-[#6D28D9] hover:bg-violet-100 hover:text-[#6D28D9]" onClick={() => setEditingLineId(row.line.id)}>
                                  <Pencil className="h-4 w-4" />
                                  Modifier
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={!row.plan || isPlanActive(row.plan.activation_status) || rowActionKey === `activate:${row.line.id}`}
                                  className={row.plan && isPlanActive(row.plan.activation_status) ? "rounded-xl border-emerald-200 bg-emerald-50 text-[#059669] hover:bg-emerald-50 hover:text-[#059669]" : "rounded-xl border-emerald-200 bg-emerald-50 text-[#059669] hover:bg-emerald-100 hover:text-[#059669]"}
                                  onClick={() => void handleActivateAssignedPlan(row)}
                                >
                                  <BadgeCheck className="h-4 w-4" />
                                  {rowActionKey === `activate:${row.line.id}`
                                    ? "Activation..."
                                    : row.plan
                                      ? getPlanActivationActionLabel(row.plan.activation_status)
                                      : "Activer forfait"}
                                </Button>
                                <Button type="button" size="sm" variant="outline" disabled={rowActionKey === `suspend:${row.line.id}` || rowActionKey === `reactivate:${row.line.id}`} className={row.status === "active" ? "rounded-xl border-amber-200 bg-amber-50 text-[#B45309] hover:bg-amber-100 hover:text-[#B45309]" : "rounded-xl border-emerald-200 bg-emerald-50 text-[#059669] hover:bg-emerald-100 hover:text-[#059669]"} onClick={() => setConfirmAction({ lineId: row.line.id, type: row.status === "active" ? "suspend" : "reactivate" })}>
                                  <CirclePause className="h-4 w-4" />
                                  {row.status === "active" ? "Suspendre" : "Reactiver"}
                                </Button>
                                <Button type="button" size="sm" variant="outline" disabled={rowActionKey === `remove:${row.line.id}`} className="rounded-xl border-red-200 bg-red-50 text-[#DC2626] hover:bg-red-100 hover:text-[#DC2626]" onClick={() => setConfirmAction({ lineId: row.line.id, type: "remove" })}>
                                  <UserX className="h-4 w-4" />
                                  Retirer
                                </Button>
                              </>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                <div className="flex flex-col gap-4 border-t border-[#E2E8F0] px-6 py-4 md:flex-row md:items-center md:justify-between">
                  <div className="flex flex-wrap items-center gap-3 text-sm text-[#64748B]">
                    <span>Affichage {visibleFrom}-{visibleTo} sur {filteredRows.length} attribution{filteredRows.length > 1 ? "s" : ""}</span>
                    <Select value={String(pageSize)} onValueChange={(value) => setPageSize(Number(value))}>
                      <SelectTrigger className="h-9 w-[92px] rounded-lg border-[#DCE5F1] bg-white"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="8">8</SelectItem>
                        <SelectItem value="12">12</SelectItem>
                        <SelectItem value="20">20</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" size="sm" className="rounded-xl border-gray-200 bg-white" disabled={currentPage === 1} onClick={() => setCurrentPage((value) => Math.max(value - 1, 1))}>
                      <ChevronLeft className="h-4 w-4" />
                      Precedent
                    </Button>
                    <div className="rounded-xl border border-[#DCE5F1] bg-[#F8FAFC] px-3 py-2 text-sm font-medium text-[#0F172A]">Page {currentPage} / {totalPages}</div>
                    <Button type="button" variant="outline" size="sm" className="rounded-xl border-gray-200 bg-white" disabled={currentPage === totalPages} onClick={() => setCurrentPage((value) => Math.min(value + 1, totalPages))}>
                      Suivant
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}

      <CollaboratorAssignmentDrawer
        open={isCreateDrawerOpen}
        isSubmitting={isCreatingCollaborator}
        errorMessage={createCollaboratorError}
        availableLines={availableUnassignedLines}
        plans={availablePlans}
        employeesRefreshKey={employeesRefreshKey}
        onClose={() => {
          if (isCreatingCollaborator) return;
          setCreateCollaboratorError(null);
          setIsCreateDrawerOpen(false);
        }}
        onOpenImportDialog={() => setIsImportDialogOpen(true)}
        onSubmit={handleCreateCollaborator}
      />

      <EmployeeImportDialog
        open={isImportDialogOpen}
        onClose={() => setIsImportDialogOpen(false)}
        onImported={() => {
          setEmployeesRefreshKey((value) => value + 1);
        }}
      />

      <Dialog open={detailRow !== null} onOpenChange={(isOpen) => (!isOpen ? setDetailLineId(null) : null)}>
        <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col overflow-hidden rounded-[28px] border border-[#DCE5F1] bg-white p-0">
          {detailRow ? (
            <>
              <div className="border-b border-[#E2E8F0] bg-[linear-gradient(135deg,#FFFFFF,#F8FAFC)] px-6 py-5 pr-14">
                <DialogHeader>
                  <DialogTitle className="text-2xl font-bold text-[#0F172A]">{detailRow.collaboratorName}</DialogTitle>
                  <DialogDescription className="text-sm leading-6 text-[#64748B]">Fiche synthetique de la ligne attribuee, du forfait actif et de la consommation associee.</DialogDescription>
                </DialogHeader>
              </div>

              <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={`px-3 py-1 ${getStatusClasses(detailRow.status)}`}>{getStatusLabel(detailRow.status)}</Badge>
                  <Badge className={`px-3 py-1 ${getPlanTypeClasses(detailRow.planType)}`}>{detailRow.planType}</Badge>
                  {detailRow.plan ? (
                    <Badge className={`px-3 py-1 ${getPlanActivationStatusClasses(detailRow.plan.activation_status)}`}>
                      {getPlanActivationStatusLabel(detailRow.plan.activation_status)}
                    </Badge>
                  ) : null}
                  <Badge className="border-[#DCE5F1] bg-white px-3 py-1 text-[#475569]">{detailRow.departmentLabel}</Badge>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="rounded-2xl border border-[#DCE5F1] bg-[#F8FAFC] p-4"><p className="text-xs uppercase tracking-[0.16em] text-[#64748B]">Contact</p><p className="mt-2 text-sm font-semibold text-[#0F172A]">{detailRow.collaboratorIdentifier}</p></div>
                  <div className="rounded-2xl border border-[#DCE5F1] bg-[#F8FAFC] p-4"><p className="text-xs uppercase tracking-[0.16em] text-[#64748B]">Numero de ligne</p><p className="mt-2 text-sm font-semibold text-[#0F172A]">{detailRow.line.phone_number}</p></div>
                  <div className="rounded-2xl border border-[#DCE5F1] bg-[#F8FAFC] p-4"><p className="text-xs uppercase tracking-[0.16em] text-[#64748B]">Forfait attribue</p><p className="mt-2 text-sm font-semibold text-[#0F172A]">{detailRow.planLabel}</p><p className="mt-1 text-sm text-[#64748B]">{detailRow.operatorLabel}</p></div>
                  <div className="rounded-2xl border border-[#DCE5F1] bg-[#F8FAFC] p-4"><p className="text-xs uppercase tracking-[0.16em] text-[#64748B]">Date d'activation</p><p className="mt-2 text-sm font-semibold text-[#0F172A]">{detailRow.activationDateLabel}</p></div>
                </div>

                <div className="rounded-2xl border border-[#DCE5F1] bg-[linear-gradient(135deg,#FFFFFF,#F8FAFC)] p-5">
                  <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Consommation courante</p>
                  <h3 className="mt-2 text-lg font-semibold text-[#0F172A]">{detailRow.currentConsumptionLabel}</h3>
                  <div className="mt-4 h-3 rounded-full bg-[#E2E8F0]">
                    <div className={`h-3 rounded-full ${getUsageBarClasses(detailRow.usageProgress)}`} style={{ width: `${detailRow.usageProgress ?? 24}%` }} />
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div className="rounded-2xl border border-[#E2E8F0] bg-white px-4 py-3"><p className="text-xs uppercase tracking-[0.16em] text-[#64748B]">Usage actuel</p><p className="mt-2 font-semibold text-[#0F172A]">{formatUsage(detailRow.currentUsageGb)}</p></div>
                    <div className="rounded-2xl border border-[#E2E8F0] bg-white px-4 py-3"><p className="text-xs uppercase tracking-[0.16em] text-[#64748B]">Mois precedent</p><p className="mt-2 font-semibold text-[#0F172A]">{formatUsage(detailRow.previousUsageGb)}</p></div>
                    <div className="rounded-2xl border border-[#E2E8F0] bg-white px-4 py-3"><p className="text-xs uppercase tracking-[0.16em] text-[#64748B]">Quota</p><p className="mt-2 font-semibold text-[#0F172A]">{detailRow.monthlyLimitGb !== null ? formatUsage(detailRow.monthlyLimitGb) : "--"}</p></div>
                  </div>
                </div>
              </div>

              <DialogFooter className="border-t border-[#E2E8F0] px-6 py-4">
                <Button asChild className="h-11 rounded-xl bg-[linear-gradient(135deg,#1D4ED8,#2563EB)] text-white">
                  <Link to={`/lignes/${detailRow.line.id}`}>Ouvrir la fiche ligne</Link>
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={editingRow !== null} onOpenChange={(isOpen) => (!isOpen ? setEditingLineId(null) : null)}>
        <DialogContent className="max-w-2xl rounded-[28px] border border-[#DCE5F1] bg-white p-0">
          {editingRow ? (
            <>
              <div className="border-b border-[#E2E8F0] bg-[linear-gradient(135deg,#FFFFFF,#F8FAFC)] px-6 py-5 pr-14">
                <DialogHeader>
                  <DialogTitle className="text-2xl font-bold text-[#0F172A]">Modifier le forfait attribue</DialogTitle>
                  <DialogDescription className="text-sm leading-6 text-[#64748B]">Selectionnez un autre forfait pour {editingRow.collaboratorName}.</DialogDescription>
                </DialogHeader>
              </div>

              <div className="space-y-5 px-6 py-5">
                <div className="rounded-2xl border border-[#DCE5F1] bg-[#F8FAFC] p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-[#64748B]">Ligne cible</p>
                  <p className="mt-2 text-sm font-semibold text-[#0F172A]">{editingRow.collaboratorName} - {editingRow.line.phone_number}</p>
                  <p className="mt-1 text-sm text-[#64748B]">Forfait actuel: {editingRow.planLabel}</p>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#64748B]">Nouveau forfait</p>
                  <Select value={selectedPlanId ?? undefined} onValueChange={(value) => setSelectedPlanId(value)}>
                    <SelectTrigger className="h-11 rounded-xl border-[#DCE5F1] bg-white"><SelectValue placeholder="Selectionnez un forfait" /></SelectTrigger>
                    <SelectContent>
                      {availablePlans.map((plan) => <SelectItem key={plan.id} value={String(plan.id)}>{plan.name} - {plan.operator_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                {selectedTargetPlan ? (
                  <div className="rounded-2xl border border-[#DCE5F1] bg-[linear-gradient(135deg,#FFFFFF,#F8FAFC)] p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-semibold text-[#0F172A]">{selectedTargetPlan.name}</h3>
                        <p className="mt-1 text-sm text-[#64748B]">{selectedTargetPlan.operator_name}</p>
                      </div>
                      <Badge className={`px-3 py-1 ${getPlanTypeClasses(derivePlanType(selectedTargetPlan, editingRow.line))}`}>{derivePlanType(selectedTargetPlan, editingRow.line)}</Badge>
                    </div>
                    <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div className="rounded-2xl border border-[#E2E8F0] bg-white px-4 py-3"><p className="text-xs uppercase tracking-[0.16em] text-[#64748B]">Data</p><p className="mt-2 font-semibold text-[#0F172A]">{selectedTargetPlan.data_quota}</p></div>
                      <div className="rounded-2xl border border-[#E2E8F0] bg-white px-4 py-3"><p className="text-xs uppercase tracking-[0.16em] text-[#64748B]">Voix</p><p className="mt-2 font-semibold text-[#0F172A]">{selectedTargetPlan.voice_quota}</p></div>
                    </div>
                  </div>
                ) : null}
              </div>

              <DialogFooter className="border-t border-[#E2E8F0] px-6 py-4">
                <Button type="button" variant="outline" className="h-11 rounded-xl border-gray-200 bg-white" onClick={() => setEditingLineId(null)}>Annuler</Button>
                <Button type="button" disabled={!selectedTargetPlan || rowActionKey === `plan:${editingRow.line.id}` || (normalizeText(selectedTargetPlan.name) === normalizeText(editingRow.planLabel) && normalizeText(selectedTargetPlan.operator_name) === normalizeText(editingRow.operatorLabel) && isPlanActive(selectedTargetPlan.activation_status))} className="h-11 rounded-xl bg-[linear-gradient(135deg,#1D4ED8,#2563EB)] text-white" onClick={handleUpdatePlan}>
                  <Pencil className="h-4 w-4" />
                  {rowActionKey === `plan:${editingRow.line.id}`
                    ? "Activation..."
                    : selectedTargetPlan &&
                        normalizeText(selectedTargetPlan.name) === normalizeText(editingRow.planLabel) &&
                        normalizeText(selectedTargetPlan.operator_name) === normalizeText(editingRow.operatorLabel) &&
                        isPlanActive(selectedTargetPlan.activation_status)
                      ? "Deja active"
                      : selectedTargetPlan?.activation_status === "suspended"
                        ? "Reactiver"
                        : "Activer forfait"}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={confirmRow !== null && confirmAction !== null} onOpenChange={(isOpen) => (!isOpen ? setConfirmAction(null) : null)}>
        <DialogContent className="max-w-lg rounded-[28px] border border-[#DCE5F1] bg-white p-0">
          {confirmRow && confirmAction ? (
            <>
              <div className="border-b border-[#E2E8F0] bg-[linear-gradient(135deg,#FFFFFF,#F8FAFC)] px-6 py-5 pr-14">
                <DialogHeader>
                  <DialogTitle className="text-2xl font-bold text-[#0F172A]">
                    {confirmAction.type === "remove" ? "Retirer l'attribution" : confirmAction.type === "suspend" ? "Suspendre la ligne" : "Reactiver la ligne"}
                  </DialogTitle>
                  <DialogDescription className="text-sm leading-6 text-[#64748B]">
                    {confirmAction.type === "remove" ? "La ligne restera disponible mais sortira de cette vue." : confirmAction.type === "suspend" ? "Le statut de la ligne passera en mode suspendu." : "La ligne repassera en mode actif."}
                  </DialogDescription>
                </DialogHeader>
              </div>

              <div className="px-6 py-5">
                <div className="rounded-2xl border border-[#DCE5F1] bg-[#F8FAFC] p-4">
                  <p className="text-sm font-semibold text-[#0F172A]">{confirmRow.collaboratorName}</p>
                  <p className="mt-1 text-sm text-[#64748B]">{confirmRow.line.phone_number} - {confirmRow.planLabel}</p>
                </div>
              </div>

              <DialogFooter className="border-t border-[#E2E8F0] px-6 py-4">
                <Button type="button" variant="outline" className="h-11 rounded-xl border-gray-200 bg-white" onClick={() => setConfirmAction(null)}>Annuler</Button>
                <Button type="button" disabled={rowActionKey === `${confirmAction.type}:${confirmRow.line.id}`} className={confirmAction.type === "reactivate" ? "h-11 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700" : confirmAction.type === "suspend" ? "h-11 rounded-xl bg-amber-600 text-white hover:bg-amber-700" : "h-11 rounded-xl bg-[#DC2626] text-white hover:bg-[#B91C1C]"} onClick={handleExecuteAction}>
                  {confirmAction.type === "remove" ? "Retirer l'attribution" : confirmAction.type === "suspend" ? "Suspendre" : "Reactiver"}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
