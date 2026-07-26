import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  CalendarDays,
  LockKeyhole,
  Mail,
  Package,
  Phone,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
  UserRound,
  UsersRound,
} from "lucide-react";

import { useAuth } from "../context/AuthContext";
import { useDepartments } from "../context/DepartmentsContext";
import {
  ApiError,
  employeesApi,
  type ApiImportedEmployee,
  type ApiPhoneLine,
  type ApiPlan,
} from "../lib/api";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "./ui/sheet";
import { Textarea } from "./ui/textarea";
import { cn } from "./ui/utils";

type CollaboratorCreationStatus = "active" | "inactive" | "suspended";
type AssignmentMode = "existing" | "new";
type CollaboratorSourceMode = "manual" | "imported";

export interface CollaboratorAssignmentFormValues {
  full_name: string;
  email: string;
  department_id: number | null;
  department_name: string;
  job_profile: string;
  status: CollaboratorCreationStatus;
  activation_date: string;
  source_mode: CollaboratorSourceMode;
  imported_employee_id: number | null;
  employee_identifier: string;
  employee_code: string;
  assignment_mode: AssignmentMode;
  existing_line_id: number | null;
  phone_number: string;
  plan_id: number | null;
  notes: string;
}

interface CollaboratorAssignmentDrawerProps {
  open: boolean;
  isSubmitting?: boolean;
  errorMessage?: string | null;
  availableLines: ApiPhoneLine[];
  plans: ApiPlan[];
  employeesRefreshKey?: number;
  onClose: () => void;
  onOpenImportDialog: () => void;
  onSubmit: (values: CollaboratorAssignmentFormValues) => Promise<void>;
}

interface FormState {
  full_name: string;
  email: string;
  department_id: string;
  job_profile: string;
  status: CollaboratorCreationStatus;
  activation_date: string;
  source_mode: CollaboratorSourceMode;
  employee_identifier: string;
  employee_code: string;
  assignment_mode: AssignmentMode;
  existing_line_id: string;
  phone_number: string;
  plan_id: string;
  notes: string;
}

type FormErrors = Partial<
  Record<keyof FormState | "department_id" | "plan_id" | "imported_employee_id", string>
>;

const emptyFormState: FormState = {
  full_name: "",
  email: "",
  department_id: "",
  job_profile: "",
  status: "active",
  activation_date: "",
  source_mode: "manual",
  employee_identifier: "",
  employee_code: "",
  assignment_mode: "new",
  existing_line_id: "",
  phone_number: "",
  plan_id: "",
  notes: "",
};

function normalizeError(error: unknown, fallbackMessage: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message === "Failed to fetch") {
    return "Connexion au service impossible. Verifiez que la base des employes importes est disponible.";
  }
  if (error instanceof Error) return error.message;
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
  const compactValue = value.replace(/\s+/g, "");
  if (compactValue.startsWith("+")) {
    return `+${compactValue.slice(1).replace(/\D/g, "")}`;
  }
  return compactValue.replace(/\D/g, "");
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidPhoneNumber(value: string): boolean {
  return /^\+?[0-9]{8,15}$/.test(value);
}

function getStatusLabel(status: CollaboratorCreationStatus): string {
  if (status === "inactive") return "Inactif";
  if (status === "suspended") return "Suspendu";
  return "Actif";
}

function getDefaultState(availableLines: ApiPhoneLine[]): FormState {
  return {
    ...emptyFormState,
    assignment_mode: availableLines.length > 0 ? "existing" : "new",
    existing_line_id: availableLines[0] ? String(availableLines[0].id) : "",
  };
}

export default function CollaboratorAssignmentDrawer({
  open,
  isSubmitting = false,
  errorMessage = null,
  availableLines,
  plans,
  employeesRefreshKey = 0,
  onClose,
  onOpenImportDialog,
  onSubmit,
}: CollaboratorAssignmentDrawerProps) {
  const { token } = useAuth();
  const { departments, isLoading: isDepartmentsLoading } = useDepartments();
  const [formState, setFormState] = useState<FormState>(() => getDefaultState(availableLines));
  const [fieldErrors, setFieldErrors] = useState<FormErrors>({});
  const [directorySearchQuery, setDirectorySearchQuery] = useState("");
  const [directoryEmployees, setDirectoryEmployees] = useState<ApiImportedEmployee[]>([]);
  const [directoryTotal, setDirectoryTotal] = useState(0);
  const [selectedImportedEmployee, setSelectedImportedEmployee] =
    useState<ApiImportedEmployee | null>(null);
  const [isDirectoryLoading, setIsDirectoryLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState<string | null>(null);

  const sortedLines = useMemo(
    () =>
      [...availableLines].sort(
        (left, right) =>
          left.operator_name.localeCompare(right.operator_name, "fr", {
            sensitivity: "base",
          }) || left.phone_number.localeCompare(right.phone_number, "fr", { sensitivity: "base" }),
      ),
    [availableLines],
  );

  const sortedPlans = useMemo(
    () =>
      [...plans].sort(
        (left, right) =>
          left.operator_name.localeCompare(right.operator_name, "fr", {
            sensitivity: "base",
          }) || left.name.localeCompare(right.name, "fr", { sensitivity: "base" }),
      ),
    [plans],
  );

  const selectedDepartment =
    departments.find((department) => String(department.id) === formState.department_id) ?? null;
  const selectedExistingLine =
    sortedLines.find((line) => String(line.id) === formState.existing_line_id) ?? null;
  const selectedImportedDepartment =
    selectedImportedEmployee?.department_name
      ? departments.find(
          (department) =>
            normalizeText(department.name) === normalizeText(selectedImportedEmployee.department_name ?? ""),
        ) ?? null
      : null;

  const compatiblePlans = useMemo(() => {
    if (formState.assignment_mode !== "existing" || !selectedExistingLine) {
      return sortedPlans;
    }

    return sortedPlans.filter(
      (plan) =>
        normalizeText(plan.operator_name) === normalizeText(selectedExistingLine.operator_name),
    );
  }, [formState.assignment_mode, selectedExistingLine, sortedPlans]);

  const selectedPlan =
    compatiblePlans.find((plan) => String(plan.id) === formState.plan_id) ??
    sortedPlans.find((plan) => String(plan.id) === formState.plan_id) ??
    null;

  const hasCollaboratorSourceReady =
    formState.source_mode === "manual" || selectedImportedEmployee !== null;
  const canSubmit =
    departments.length > 0 &&
    sortedPlans.length > 0 &&
    hasCollaboratorSourceReady &&
    (formState.assignment_mode === "new" || sortedLines.length > 0);

  const importedEmployeeContact =
    selectedImportedEmployee?.email ??
    selectedImportedEmployee?.employee_identifier ??
    selectedImportedEmployee?.employee_code ??
    null;

  useEffect(() => {
    if (open) {
      return;
    }

    setFormState(getDefaultState(sortedLines));
    setFieldErrors({});
    setDirectorySearchQuery("");
    setDirectoryEmployees([]);
    setDirectoryTotal(0);
    setSelectedImportedEmployee(null);
    setDirectoryError(null);
    setIsDirectoryLoading(false);
  }, [open, sortedLines]);

  useEffect(() => {
    if (!open) {
      return;
    }

    if (formState.assignment_mode === "existing" && sortedLines.length === 0) {
      setFormState((currentState) => ({
        ...currentState,
        assignment_mode: "new",
        existing_line_id: "",
      }));
    }
  }, [formState.assignment_mode, open, sortedLines]);

  useEffect(() => {
    if (!open) {
      return;
    }

    if (formState.assignment_mode === "existing") {
      if (!selectedExistingLine && sortedLines[0]) {
        setFormState((currentState) => ({
          ...currentState,
          existing_line_id: String(sortedLines[0].id),
        }));
        return;
      }

      if (selectedExistingLine && compatiblePlans.length > 0) {
        const isCurrentPlanCompatible = compatiblePlans.some(
          (plan) => String(plan.id) === formState.plan_id,
        );
        if (!isCurrentPlanCompatible) {
          setFormState((currentState) => ({
            ...currentState,
            plan_id: String(compatiblePlans[0].id),
          }));
        }
      }
      return;
    }

    if (!formState.plan_id && sortedPlans[0]) {
      setFormState((currentState) => ({
        ...currentState,
        plan_id: String(sortedPlans[0].id),
      }));
    }
  }, [
    compatiblePlans,
    formState.assignment_mode,
    formState.plan_id,
    open,
    selectedExistingLine,
    sortedLines,
    sortedPlans,
  ]);

  useEffect(() => {
    if (!open || formState.source_mode !== "imported" || !token) {
      return;
    }

    const timeoutId = window.setTimeout(async () => {
      setIsDirectoryLoading(true);
      setDirectoryError(null);

      try {
        const response = await employeesApi.list(token, {
          search: directorySearchQuery.trim() || undefined,
          limit: 12,
        });
        setDirectoryTotal(response.total);
        setDirectoryEmployees((currentEmployees) => {
          if (
            selectedImportedEmployee &&
            !response.items.some((item) => item.id === selectedImportedEmployee.id)
          ) {
            return [selectedImportedEmployee, ...response.items];
          }
          return response.items;
        });
      } catch (error) {
        setDirectoryError(
          normalizeError(error, "Impossible de charger la base d'employes importes."),
        );
      } finally {
        setIsDirectoryLoading(false);
      }
    }, 220);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    directorySearchQuery,
    employeesRefreshKey,
    formState.source_mode,
    open,
    selectedImportedEmployee,
    token,
  ]);

  function setFieldValue<Key extends keyof FormState>(field: Key, value: FormState[Key]) {
    setFormState((currentState) => ({ ...currentState, [field]: value }));
    setFieldErrors((currentErrors) => {
      if (!currentErrors[field]) return currentErrors;
      return { ...currentErrors, [field]: undefined };
    });
  }

  function isImportedFieldLocked(field: "full_name" | "email" | "department_id" | "job_profile") {
    if (formState.source_mode !== "imported" || !selectedImportedEmployee) return false;
    if (field === "full_name") return true;
    if (field === "email") return Boolean(selectedImportedEmployee.email && isValidEmail(formState.email));
    if (field === "department_id") return selectedImportedDepartment !== null;
    if (field === "job_profile") return Boolean(selectedImportedEmployee.job_profile?.trim());
    return false;
  }

  function applyImportedEmployee(employee: ApiImportedEmployee) {
    const matchedDepartment =
      employee.department_name
        ? departments.find(
            (department) =>
              normalizeText(department.name) === normalizeText(employee.department_name ?? ""),
          ) ?? null
        : null;

    setSelectedImportedEmployee(employee);
    setFieldErrors((currentErrors) => ({
      ...currentErrors,
      imported_employee_id: undefined,
      full_name: undefined,
      email: undefined,
      department_id: undefined,
      job_profile: undefined,
    }));
    setFormState((currentState) => ({
      ...currentState,
      source_mode: "imported",
      full_name: employee.full_name,
      email: employee.email ?? employee.employee_identifier ?? "",
      department_id: matchedDepartment ? String(matchedDepartment.id) : "",
      job_profile: employee.job_profile ?? "",
      status: employee.status,
      employee_identifier: employee.employee_identifier ?? "",
      employee_code: employee.employee_code ?? "",
    }));
  }

  function validate(): boolean {
    const nextErrors: FormErrors = {};
    const normalizedPhone = normalizePhoneNumber(formState.phone_number);

    if (formState.source_mode === "imported" && !selectedImportedEmployee) {
      nextErrors.imported_employee_id = "Selectionnez un employe dans la base importee.";
    }

    if (formState.full_name.trim().length < 2) {
      nextErrors.full_name = "Le nom complet doit contenir au moins 2 caracteres.";
    }

    if (!isValidEmail(formState.email.trim())) {
      nextErrors.email =
        "Le backend attend une adresse email valide pour créer le collaborateur.";
    }

    if (!selectedDepartment) {
      nextErrors.department_id = "Selectionnez un departement actif.";
    }

    if (formState.job_profile.trim().length < 2) {
      nextErrors.job_profile = "La fonction ou le profil est obligatoire.";
    }

    if (formState.assignment_mode === "existing" && !selectedExistingLine) {
      nextErrors.existing_line_id = "Selectionnez une ligne disponible.";
    }

    if (formState.assignment_mode === "new") {
      if (!normalizedPhone) {
        nextErrors.phone_number = "Renseignez un numero de ligne.";
      } else if (!isValidPhoneNumber(normalizedPhone)) {
        nextErrors.phone_number =
          "Utilisez un numero international valide, par ex. +212612345678.";
      }
    }

    if (!selectedPlan) {
      nextErrors.plan_id =
        formState.assignment_mode === "existing"
          ? "Choisissez un forfait compatible avec l'operateur de la ligne."
          : "Le forfait est requis pour créer une attribution visible ici.";
    }

    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!validate() || !selectedDepartment || !selectedPlan) {
      return;
    }

    await onSubmit({
      full_name: formState.full_name.trim(),
      email: formState.email.trim().toLowerCase(),
      department_id: selectedDepartment.id,
      department_name: selectedDepartment.name,
      job_profile: formState.job_profile.trim(),
      status: formState.status,
      activation_date: formState.activation_date,
      source_mode: formState.source_mode,
      imported_employee_id:
        formState.source_mode === "imported" ? selectedImportedEmployee?.id ?? null : null,
      employee_identifier:
        selectedImportedEmployee?.employee_identifier ?? formState.employee_identifier.trim(),
      employee_code: selectedImportedEmployee?.employee_code ?? formState.employee_code.trim(),
      assignment_mode: formState.assignment_mode,
      existing_line_id:
        formState.assignment_mode === "existing" && selectedExistingLine
          ? selectedExistingLine.id
          : null,
      phone_number:
        formState.assignment_mode === "new" ? normalizePhoneNumber(formState.phone_number) : "",
      plan_id: selectedPlan.id,
      notes: formState.notes.trim(),
    });
  }

  const attributionSummary = selectedPlan
    ? `${selectedPlan.name} - ${selectedPlan.operator_name}`
    : "Forfait a definir";
  const lineSummary =
    formState.assignment_mode === "existing"
      ? selectedExistingLine
        ? `${selectedExistingLine.phone_number} - ${selectedExistingLine.operator_name}`
        : "Selectionnez une ligne libre"
      : formState.phone_number.trim() || "Nouveau numero a créer";
  const collaboratorSummary =
    formState.source_mode === "imported" && selectedImportedEmployee
      ? selectedImportedEmployee.full_name
      : formState.full_name.trim() || "Nom a renseigner";

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isSubmitting) {
          onClose();
        }
      }}
    >
      <SheetContent
        side="right"
        className="w-full overflow-hidden border-l border-[#DCE5F1] bg-white p-0 sm:max-w-[760px]"
      >
        <SheetHeader className="border-b border-[#E2E8F0] bg-[linear-gradient(135deg,#FFFFFF,#F8FAFC)] px-6 py-5">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#DBEAFE,#EFF6FF)] text-[#1D4ED8]">
              <UserRound className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <SheetTitle className="text-2xl font-bold tracking-tight text-[#0F172A]">
                Nouveau collaborateur
              </SheetTitle>
              <SheetDescription className="mt-2 max-w-2xl text-sm leading-6 text-[#64748B]">
                Creez le collaborateur manuellement ou selectionnez-le depuis la liste importee,
                puis rattachez-lui une ligne et un forfait dans la meme interface.
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <form
          onSubmit={(event) => void handleSubmit(event)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-6">
            <div className="rounded-[24px] border border-[#BFDBFE] bg-[linear-gradient(135deg,#EFF6FF,#FFFFFF)] p-5 shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-[#1D4ED8]">
                  <Sparkles className="h-3.5 w-3.5" />
                  Workflow direct
                </div>
                <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-[#475569]">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Apparition immediate dans le tableau
                </div>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-4">
                <div className="rounded-2xl border border-white/80 bg-white/80 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.16em] text-[#64748B]">
                    Collaborateur
                  </p>
                  <p className="mt-2 text-sm font-semibold text-[#0F172A]">
                    {collaboratorSummary}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/80 bg-white/80 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.16em] text-[#64748B]">Source</p>
                  <p className="mt-2 text-sm font-semibold text-[#0F172A]">
                    {formState.source_mode === "imported"
                      ? "Employe importe"
                      : "Creation manuelle"}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/80 bg-white/80 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.16em] text-[#64748B]">Ligne</p>
                  <p className="mt-2 text-sm font-semibold text-[#0F172A]">{lineSummary}</p>
                </div>
                <div className="rounded-2xl border border-white/80 bg-white/80 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.16em] text-[#64748B]">Forfait</p>
                  <p className="mt-2 text-sm font-semibold text-[#0F172A]">
                    {attributionSummary}
                  </p>
                </div>
              </div>
            </div>

            <section className="space-y-5 rounded-[24px] border border-[#E2E8F0] bg-white p-5 shadow-sm">
              <div>
                <h3 className="text-lg font-semibold text-[#0F172A]">
                  Informations collaborateur
                </h3>
                <p className="mt-1 text-sm text-[#64748B]">
                  Choisissez entre une creation manuelle et un employe deja importe.
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setFieldValue("source_mode", "manual")}
                  disabled={isSubmitting}
                  className={cn(
                    "rounded-[20px] border px-4 py-4 text-left transition-all",
                    formState.source_mode === "manual"
                      ? "border-[#93C5FD] bg-[#EFF6FF] shadow-sm"
                      : "border-[#E2E8F0] bg-[#F8FAFC] hover:bg-white",
                  )}
                >
                  <p className="text-sm font-semibold text-[#0F172A]">
                    Créer manuellement un collaborateur
                  </p>
                  <p className="mt-1 text-sm text-[#64748B]">
                    Saisie libre des informations quand le collaborateur n'existe pas encore dans
                    la base importee.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setFieldValue("source_mode", "imported")}
                  disabled={isSubmitting}
                  className={cn(
                    "rounded-[20px] border px-4 py-4 text-left transition-all",
                    formState.source_mode === "imported"
                      ? "border-[#93C5FD] bg-[#EFF6FF] shadow-sm"
                      : "border-[#E2E8F0] bg-[#F8FAFC] hover:bg-white",
                  )}
                >
                  <p className="text-sm font-semibold text-[#0F172A]">
                    Selectionner un employe importe
                  </p>
                  <p className="mt-1 text-sm text-[#64748B]">
                    Recherchez par nom, email, matricule ou departement dans la base RH importee.
                  </p>
                </button>
              </div>

              {formState.source_mode === "imported" ? (
                <div className="space-y-4 rounded-[24px] border border-[#DCE5F1] bg-[#F8FAFC] p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-[#0F172A]">
                        Base d'employes importes
                      </p>
                      <p className="mt-1 text-sm text-[#64748B]">
                        {directoryTotal > 0
                          ? `${directoryTotal} employe(s) disponible(s) pour l'attribution`
                          : "Aucun employe importe pour le moment"}
                      </p>
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <div className="relative min-w-[240px]">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748B]" />
                        <Input
                          value={directorySearchQuery}
                          onChange={(event) => setDirectorySearchQuery(event.target.value)}
                          placeholder="Nom, email, matricule, departement..."
                          className="h-11 rounded-xl border-[#DCE5F1] bg-white pl-10"
                          disabled={isSubmitting}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 rounded-xl border-gray-200 bg-white"
                        onClick={onOpenImportDialog}
                        disabled={isSubmitting}
                      >
                        <Upload className="h-4 w-4" />
                        Importer collaborateurs
                      </Button>
                    </div>
                  </div>

                  {directoryError ? (
                    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-[#B91C1C]">
                      {directoryError}
                    </div>
                  ) : null}

                  {fieldErrors.imported_employee_id ? (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-[#92400E]">
                      {fieldErrors.imported_employee_id}
                    </div>
                  ) : null}

                  {isDirectoryLoading ? (
                    <div className="rounded-2xl border border-[#E2E8F0] bg-white px-4 py-5 text-sm text-[#64748B]">
                      Chargement des employes importes...
                    </div>
                  ) : directoryEmployees.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-[#CBD5E1] bg-white px-4 py-8 text-center">
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#EEF4FF] text-[#2D6CDF]">
                        <UsersRound className="h-5 w-5" />
                      </div>
                      <p className="mt-4 text-sm font-semibold text-[#0F172A]">
                        Aucun employe a afficher
                      </p>
                      <p className="mt-2 text-sm text-[#64748B]">
                        Importez d'abord un fichier CSV ou Excel pour alimenter cette liste.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {directoryEmployees.map((employee) => {
                        const isSelected = employee.id === selectedImportedEmployee?.id;
                        return (
                          <button
                            key={employee.id}
                            type="button"
                            onClick={() => applyImportedEmployee(employee)}
                            disabled={isSubmitting}
                            className={cn(
                              "w-full rounded-[20px] border px-4 py-4 text-left transition-all",
                              isSelected
                                ? "border-[#93C5FD] bg-[#EFF6FF] shadow-sm"
                                : "border-[#E2E8F0] bg-white hover:bg-[#F8FAFC]",
                            )}
                          >
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-sm font-semibold text-[#0F172A]">
                                    {employee.full_name}
                                  </p>
                                  {isSelected ? (
                                    <Badge className="border-blue-200 bg-blue-50 px-3 py-1 text-[#1D4ED8]">
                                      Selectionne
                                    </Badge>
                                  ) : null}
                                </div>
                                <p className="mt-1 text-sm text-[#64748B]">
                                  {employee.email ??
                                    employee.employee_identifier ??
                                    employee.employee_code ??
                                    "Aucun identifiant"}
                                </p>
                                <p className="mt-1 text-sm text-[#64748B]">
                                  {employee.department_name ?? "Departement non renseigne"} -{" "}
                                  {employee.job_profile ?? "Fonction non renseignee"}
                                </p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {employee.employee_code ? (
                                  <Badge className="border-slate-200 bg-slate-50 px-3 py-1 text-[#475569]">
                                    {employee.employee_code}
                                  </Badge>
                                ) : null}
                                <Badge className="border-[#DCE5F1] bg-white px-3 py-1 text-[#475569]">
                                  {getStatusLabel(employee.status)}
                                </Badge>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {selectedImportedEmployee ? (
                    <div className="rounded-2xl border border-[#BFDBFE] bg-white px-4 py-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-[#0F172A]">
                            Employe selectionne
                          </p>
                          <p className="mt-1 text-sm text-[#64748B]">
                            {selectedImportedEmployee.full_name}
                            {importedEmployeeContact ? ` - ${importedEmployeeContact}` : ""}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {selectedImportedEmployee.employee_identifier ? (
                            <Badge className="border-slate-200 bg-slate-50 px-3 py-1 text-[#475569]">
                              {selectedImportedEmployee.employee_identifier}
                            </Badge>
                          ) : null}
                          {selectedImportedEmployee.employee_code ? (
                            <Badge className="border-slate-200 bg-slate-50 px-3 py-1 text-[#475569]">
                              Matricule {selectedImportedEmployee.employee_code}
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                      {!selectedImportedDepartment && selectedImportedEmployee.department_name ? (
                        <p className="mt-3 text-sm text-[#92400E]">
                          Le departement importe "{selectedImportedEmployee.department_name}" n'est
                          pas mappe dans les services actifs. Selection manuelle requise ci-dessous.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm font-medium text-[#0F172A]">Nom complet *</label>
                  <div className="relative">
                    <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748B]" />
                    <Input
                      value={formState.full_name}
                      onChange={(event) => setFieldValue("full_name", event.target.value)}
                      placeholder="Ex. Imane El Idrissi"
                      className={cn(
                        "h-11 rounded-xl border-[#DCE5F1] bg-[#F8FAFC] pl-10",
                        isImportedFieldLocked("full_name") ? "pr-10" : "",
                        fieldErrors.full_name ? "border-red-300 focus-visible:ring-red-100" : "",
                      )}
                      aria-invalid={Boolean(fieldErrors.full_name)}
                      disabled={isSubmitting || isImportedFieldLocked("full_name")}
                    />
                    {isImportedFieldLocked("full_name") ? (
                      <LockKeyhole className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94A3B8]" />
                    ) : null}
                  </div>
                  {fieldErrors.full_name ? (
                    <p className="text-xs text-[#DC2626]">{fieldErrors.full_name}</p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-[#0F172A]">
                    Email / identifiant *
                  </label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748B]" />
                    <Input
                      type="email"
                      value={formState.email}
                      onChange={(event) => setFieldValue("email", event.target.value)}
                      placeholder="prenom.nom@bcskills.ma"
                      className={cn(
                        "h-11 rounded-xl border-[#DCE5F1] bg-[#F8FAFC] pl-10",
                        isImportedFieldLocked("email") ? "pr-10" : "",
                        fieldErrors.email ? "border-red-300 focus-visible:ring-red-100" : "",
                      )}
                      aria-invalid={Boolean(fieldErrors.email)}
                      disabled={isSubmitting || isImportedFieldLocked("email")}
                    />
                    {isImportedFieldLocked("email") ? (
                      <LockKeyhole className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94A3B8]" />
                    ) : null}
                  </div>
                  <p className="text-xs text-[#64748B]">
                    {formState.source_mode === "imported" && selectedImportedEmployee && !isImportedFieldLocked("email")
                      ? "Completez un email valide si la fiche importee ne fournit qu'un identifiant."
                      : "Une adresse email valide est necessaire pour creer le compte."}
                  </p>
                  {fieldErrors.email ? (
                    <p className="text-xs text-[#DC2626]">{fieldErrors.email}</p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-[#0F172A]">
                    Departement / service *
                  </label>
                  <Select
                    value={formState.department_id || undefined}
                    onValueChange={(value) => setFieldValue("department_id", value)}
                    disabled={
                      isSubmitting ||
                      isDepartmentsLoading ||
                      departments.length === 0 ||
                      isImportedFieldLocked("department_id")
                    }
                  >
                    <SelectTrigger
                      className={cn(
                        "h-11 rounded-xl border-[#DCE5F1] bg-[#F8FAFC]",
                        fieldErrors.department_id ? "border-red-300 focus-visible:ring-red-100" : "",
                      )}
                      aria-invalid={Boolean(fieldErrors.department_id)}
                    >
                      <SelectValue
                        placeholder={
                          isDepartmentsLoading
                            ? "Chargement des departements..."
                            : "Selectionnez un service"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {departments.map((department) => (
                        <SelectItem key={department.id} value={String(department.id)}>
                          {department.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {isImportedFieldLocked("department_id") ? (
                    <p className="text-xs text-[#64748B]">
                      Service alimente automatiquement depuis l'employe importe.
                    </p>
                  ) : null}
                  {fieldErrors.department_id ? (
                    <p className="text-xs text-[#DC2626]">{fieldErrors.department_id}</p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-[#0F172A]">
                    Fonction ou profil *
                  </label>
                  <div className="relative">
                    <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748B]" />
                    <Input
                      value={formState.job_profile}
                      onChange={(event) => setFieldValue("job_profile", event.target.value)}
                      placeholder="Ex. Commercial terrain"
                      className={cn(
                        "h-11 rounded-xl border-[#DCE5F1] bg-[#F8FAFC] pl-10",
                        isImportedFieldLocked("job_profile") ? "pr-10" : "",
                        fieldErrors.job_profile ? "border-red-300 focus-visible:ring-red-100" : "",
                      )}
                      aria-invalid={Boolean(fieldErrors.job_profile)}
                      disabled={isSubmitting || isImportedFieldLocked("job_profile")}
                    />
                    {isImportedFieldLocked("job_profile") ? (
                      <LockKeyhole className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94A3B8]" />
                    ) : null}
                  </div>
                  {fieldErrors.job_profile ? (
                    <p className="text-xs text-[#DC2626]">{fieldErrors.job_profile}</p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-[#0F172A]">Statut *</label>
                  <Select
                    value={formState.status}
                    onValueChange={(value) =>
                      setFieldValue("status", value as CollaboratorCreationStatus)
                    }
                    disabled={isSubmitting}
                  >
                    <SelectTrigger className="h-11 rounded-xl border-[#DCE5F1] bg-[#F8FAFC]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Actif</SelectItem>
                      <SelectItem value="suspended">Suspendu</SelectItem>
                      <SelectItem value="inactive">Inactif</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-[#0F172A]">
                    Date d'activation
                  </label>
                  <div className="relative">
                    <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748B]" />
                    <Input
                      type="date"
                      value={formState.activation_date}
                      onChange={(event) => setFieldValue("activation_date", event.target.value)}
                      className="h-11 rounded-xl border-[#DCE5F1] bg-[#F8FAFC] pl-10"
                      disabled={isSubmitting}
                    />
                  </div>
                  <p className="text-xs text-[#64748B]">
                    Optionnel. La date est historisee dans la note d'attribution pour le suivi.
                  </p>
                </div>
              </div>
            </section>

            <section className="space-y-4 rounded-[24px] border border-[#E2E8F0] bg-white p-5 shadow-sm">
              <div>
                <h3 className="text-lg font-semibold text-[#0F172A]">Attribution de ligne</h3>
                <p className="mt-1 text-sm text-[#64748B]">
                  La creation depuis cette page inclut directement la ligne et le forfait afin de
                  rendre l'attribution visible dans le tableau.
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setFieldValue("assignment_mode", "existing")}
                  disabled={isSubmitting || sortedLines.length === 0}
                  className={cn(
                    "rounded-[20px] border px-4 py-4 text-left transition-all",
                    formState.assignment_mode === "existing"
                      ? "border-[#93C5FD] bg-[#EFF6FF] shadow-sm"
                      : "border-[#E2E8F0] bg-[#F8FAFC] hover:bg-white",
                    sortedLines.length === 0 ? "cursor-not-allowed opacity-50" : "",
                  )}
                >
                  <p className="text-sm font-semibold text-[#0F172A]">Utiliser une ligne libre</p>
                  <p className="mt-1 text-sm text-[#64748B]">
                    {sortedLines.length > 0
                      ? `${sortedLines.length} ligne(s) disponible(s) dans la flotte`
                      : "Aucune ligne libre detectee"}
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setFieldValue("assignment_mode", "new")}
                  disabled={isSubmitting}
                  className={cn(
                    "rounded-[20px] border px-4 py-4 text-left transition-all",
                    formState.assignment_mode === "new"
                      ? "border-[#93C5FD] bg-[#EFF6FF] shadow-sm"
                      : "border-[#E2E8F0] bg-[#F8FAFC] hover:bg-white",
                  )}
                >
                  <p className="text-sm font-semibold text-[#0F172A]">Creer un nouveau numero</p>
                  <p className="mt-1 text-sm text-[#64748B]">
                    Ideal si le collaborateur arrive avec une ligne a activer immediatement.
                  </p>
                </button>
              </div>

              {formState.assignment_mode === "existing" ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2 md:col-span-2">
                    <label className="text-sm font-medium text-[#0F172A]">
                      Numero de ligne disponible *
                    </label>
                    <Select
                      value={formState.existing_line_id || undefined}
                      onValueChange={(value) => setFieldValue("existing_line_id", value)}
                      disabled={isSubmitting || sortedLines.length === 0}
                    >
                      <SelectTrigger
                        className={cn(
                          "h-11 rounded-xl border-[#DCE5F1] bg-[#F8FAFC]",
                          fieldErrors.existing_line_id ? "border-red-300 focus-visible:ring-red-100" : "",
                        )}
                        aria-invalid={Boolean(fieldErrors.existing_line_id)}
                      >
                        <SelectValue placeholder="Selectionnez une ligne libre" />
                      </SelectTrigger>
                      <SelectContent>
                        {sortedLines.map((line) => (
                          <SelectItem key={line.id} value={String(line.id)}>
                            {line.phone_number} - {line.operator_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {fieldErrors.existing_line_id ? (
                      <p className="text-xs text-[#DC2626]">{fieldErrors.existing_line_id}</p>
                    ) : null}
                  </div>

                  <div className="rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-[#64748B]">
                      Operateur de la ligne
                    </p>
                    <p className="mt-2 text-sm font-semibold text-[#0F172A]">
                      {selectedExistingLine?.operator_name ?? "--"}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-[#64748B]">
                      Statut cible
                    </p>
                    <p className="mt-2 text-sm font-semibold text-[#0F172A]">
                      {getStatusLabel(formState.status)}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-[#0F172A]">
                    Numero de ligne *
                  </label>
                  <div className="relative">
                    <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748B]" />
                    <Input
                      type="tel"
                      value={formState.phone_number}
                      onChange={(event) => setFieldValue("phone_number", event.target.value)}
                      placeholder="+212612345678"
                      className={cn(
                        "h-11 rounded-xl border-[#DCE5F1] bg-[#F8FAFC] pl-10",
                        fieldErrors.phone_number ? "border-red-300 focus-visible:ring-red-100" : "",
                      )}
                      aria-invalid={Boolean(fieldErrors.phone_number)}
                      disabled={isSubmitting}
                    />
                  </div>
                  {fieldErrors.phone_number ? (
                    <p className="text-xs text-[#DC2626]">{fieldErrors.phone_number}</p>
                  ) : (
                    <p className="text-xs text-[#64748B]">
                      Format international recommande pour assurer la bonne prise en compte du numero.
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium text-[#0F172A]">
                  Forfait attribue *
                </label>
                <Select
                  value={formState.plan_id || undefined}
                  onValueChange={(value) => setFieldValue("plan_id", value)}
                  disabled={
                    isSubmitting ||
                    compatiblePlans.length === 0 ||
                    (formState.assignment_mode === "existing" && !selectedExistingLine)
                  }
                >
                  <SelectTrigger
                    className={cn(
                      "h-11 rounded-xl border-[#DCE5F1] bg-[#F8FAFC]",
                      fieldErrors.plan_id ? "border-red-300 focus-visible:ring-red-100" : "",
                    )}
                    aria-invalid={Boolean(fieldErrors.plan_id)}
                  >
                    <SelectValue
                      placeholder={
                        formState.assignment_mode === "existing" && !selectedExistingLine
                          ? "Choisissez d'abord une ligne"
                          : "Selectionnez un forfait"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {compatiblePlans.map((plan) => (
                      <SelectItem key={plan.id} value={String(plan.id)}>
                        {plan.name} - {plan.operator_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-[#64748B]">
                  Requis dans cette vue pour creer une attribution visible et exploitable tout de
                  suite.
                </p>
                {fieldErrors.plan_id ? (
                  <p className="text-xs text-[#DC2626]">{fieldErrors.plan_id}</p>
                ) : null}
              </div>

              {selectedPlan ? (
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-[#64748B]">
                      Operateur
                    </p>
                    <p className="mt-2 text-sm font-semibold text-[#0F172A]">
                      {selectedPlan.operator_name}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-[#64748B]">Data</p>
                    <p className="mt-2 text-sm font-semibold text-[#0F172A]">
                      {selectedPlan.data_quota}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-[#64748B]">Voix</p>
                    <p className="mt-2 text-sm font-semibold text-[#0F172A]">
                      {selectedPlan.voice_quota}
                    </p>
                  </div>
                </div>
              ) : null}

              <div className="space-y-2">
                <label className="text-sm font-medium text-[#0F172A]">
                  Commentaire d'attribution
                </label>
                <Textarea
                  value={formState.notes}
                  onChange={(event) => setFieldValue("notes", event.target.value)}
                  placeholder="Contexte metier, remarque d'activation ou consigne de suivi..."
                  className="min-h-[110px] rounded-2xl border-[#DCE5F1] bg-[#F8FAFC]"
                  disabled={isSubmitting}
                />
              </div>
            </section>

            {(!canSubmit || errorMessage) && (
              <div
                className={cn(
                  "rounded-2xl border px-4 py-3 text-sm",
                  errorMessage
                    ? "border-red-200 bg-red-50 text-[#B91C1C]"
                    : "border-amber-200 bg-amber-50 text-[#92400E]",
                )}
              >
                {errorMessage ??
                  (departments.length === 0
                    ? "Aucun departement actif n'est disponible pour rattacher le collaborateur."
                    : sortedPlans.length === 0
                      ? "Aucun forfait n'est disponible pour creer l'attribution."
                      : "Aucune ligne libre n'est disponible. Passez en mode creation de numero.")}
              </div>
            )}
          </div>

          <SheetFooter className="border-t border-[#E2E8F0] bg-white px-6 py-4">
            <div className="flex w-full flex-col gap-3 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                className="h-11 rounded-xl border-gray-200 bg-white"
                onClick={onClose}
                disabled={isSubmitting}
              >
                Annuler
              </Button>
              <Button
                type="submit"
                className="h-11 rounded-xl bg-[linear-gradient(135deg,#0F172A,#1D4ED8)] text-white hover:opacity-95"
                disabled={!canSubmit || isSubmitting}
              >
                <Package className="h-4 w-4" />
                {isSubmitting ? "Creation en cours..." : "Creer et attribuer"}
              </Button>
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
