import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  Check,
  CheckCircle2,
  CreditCard,
  Info,
  PauseCircle,
  Phone,
  PowerOff,
  RotateCcw,
  Sparkles,
  User,
  type LucideIcon,
} from "lucide-react";

import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { cn } from "./ui/utils";

export type LineCrudStatus = "libre" | "attribuee" | "suspendue" | "inactive";

export interface LinePlanOption {
  name: string;
  operatorName: string;
  quotaLabel?: string | null;
}

export interface LineFormData {
  phone_number: string;
  operator_name: string;
  plan_name: string;
  department: string;
  assigned_to: string;
  status: LineCrudStatus;
}

interface AddLineModalProps {
  open: boolean;
  mode: "create" | "edit";
  initialData?: LineFormData | null;
  operatorOptions: string[];
  departmentOptions: string[];
  planOptions: LinePlanOption[];
  isSubmitting?: boolean;
  errorMessage?: string | null;
  onClose: () => void;
  onSubmit: (data: LineFormData) => Promise<void>;
}

const fallbackOperators = ["Orange Maroc", "Maroc Telecom", "inwi"];
const fallbackPlans: LinePlanOption[] = [
  { name: "Premium 10 G", operatorName: "Orange Maroc", quotaLabel: "10 Go" },
  { name: "Standard 20Go", operatorName: "Orange Maroc", quotaLabel: "20 Go" },
  { name: "Premium 50Go", operatorName: "Maroc Telecom", quotaLabel: "50 Go" },
  { name: "Business 100Go", operatorName: "inwi", quotaLabel: "100 Go" },
];

const statusCards: Array<{
  value: LineCrudStatus;
  label: string;
  description: string;
  helper: string;
  icon: LucideIcon;
  baseCardClassName: string;
  hoverCardClassName: string;
  baseIconClassName: string;
  baseRadioClassName: string;
  titleClassName: string;
  descriptionClassName: string;
  badgeClassName: string;
  activeCardClassName: string;
  activeIconClassName: string;
  activeRadioClassName: string;
  activeDotClassName: string;
}> = [
  {
    value: "libre",
    label: "Libre",
    description: "Disponible pour une nouvelle attribution.",
    helper: "Disponible",
    icon: CheckCircle2,
    baseCardClassName: "border-emerald-200 bg-[linear-gradient(135deg,rgba(236,253,245,0.95),rgba(255,255,255,0.98))]",
    hoverCardClassName: "hover:border-emerald-300 hover:shadow-[0_24px_44px_-32px_rgba(16,185,129,0.34)]",
    baseIconClassName: "border-emerald-200 bg-emerald-100 text-[#059669]",
    baseRadioClassName: "border-emerald-200 bg-white",
    titleClassName: "text-[#065F46]",
    descriptionClassName: "text-[#047857]",
    badgeClassName: "border-emerald-200 bg-white text-[#059669]",
    activeCardClassName:
      "border-[2.5px] border-emerald-400 bg-[linear-gradient(135deg,#ECFDF5,#FFFFFF)] shadow-[0_24px_48px_-28px_rgba(16,185,129,0.44)]",
    activeIconClassName: "border-emerald-300 bg-emerald-100 text-[#047857] shadow-[0_14px_28px_-20px_rgba(16,185,129,0.45)]",
    activeRadioClassName: "border-emerald-400 bg-emerald-50 shadow-[0_0_0_4px_rgba(16,185,129,0.12)]",
    activeDotClassName: "bg-emerald-500",
  },
  {
    value: "attribuee",
    label: "Deja utilisee",
    description: "Associee a un collaborateur.",
    helper: "En cours d'utilisation",
    icon: User,
    baseCardClassName: "border-blue-200 bg-[linear-gradient(135deg,rgba(239,246,255,0.96),rgba(255,255,255,0.98))]",
    hoverCardClassName: "hover:border-blue-300 hover:shadow-[0_24px_44px_-32px_rgba(37,99,235,0.34)]",
    baseIconClassName: "border-blue-200 bg-blue-100 text-[#2563EB]",
    baseRadioClassName: "border-blue-200 bg-white",
    titleClassName: "text-[#1D4ED8]",
    descriptionClassName: "text-[#1E40AF]",
    badgeClassName: "border-blue-200 bg-white text-[#2563EB]",
    activeCardClassName:
      "border-[2.5px] border-blue-400 bg-[linear-gradient(135deg,#EFF6FF,#FFFFFF)] shadow-[0_24px_48px_-28px_rgba(37,99,235,0.42)]",
    activeIconClassName: "border-blue-300 bg-blue-100 text-[#1D4ED8] shadow-[0_14px_28px_-20px_rgba(37,99,235,0.4)]",
    activeRadioClassName: "border-blue-400 bg-blue-50 shadow-[0_0_0_4px_rgba(37,99,235,0.12)]",
    activeDotClassName: "bg-[#2563EB]",
  },
  {
    value: "suspendue",
    label: "Temporairement bloquee",
    description: "Service coupe pour une action temporaire.",
    helper: "Attention",
    icon: PauseCircle,
    baseCardClassName: "border-amber-200 bg-[linear-gradient(135deg,rgba(255,247,237,0.96),rgba(255,255,255,0.98))]",
    hoverCardClassName: "hover:border-amber-300 hover:shadow-[0_24px_44px_-32px_rgba(245,158,11,0.34)]",
    baseIconClassName: "border-amber-200 bg-amber-100 text-[#D97706]",
    baseRadioClassName: "border-amber-200 bg-white",
    titleClassName: "text-[#9A3412]",
    descriptionClassName: "text-[#C2410C]",
    badgeClassName: "border-amber-200 bg-white text-[#D97706]",
    activeCardClassName:
      "border-[2.5px] border-amber-400 bg-[linear-gradient(135deg,#FFF7ED,#FFFFFF)] shadow-[0_24px_48px_-28px_rgba(245,158,11,0.42)]",
    activeIconClassName: "border-amber-300 bg-amber-100 text-[#D97706] shadow-[0_14px_28px_-20px_rgba(245,158,11,0.42)]",
    activeRadioClassName: "border-amber-400 bg-amber-50 shadow-[0_0_0_4px_rgba(245,158,11,0.12)]",
    activeDotClassName: "bg-amber-500",
  },
  {
    value: "inactive",
    label: "Hors service",
    description: "Ligne desactivee et non utilisable.",
    helper: "Desactivee",
    icon: PowerOff,
    baseCardClassName: "border-slate-300 bg-[linear-gradient(135deg,rgba(241,245,249,0.98),rgba(255,255,255,0.98))]",
    hoverCardClassName: "hover:border-slate-400 hover:shadow-[0_24px_44px_-32px_rgba(51,65,85,0.26)]",
    baseIconClassName: "border-slate-300 bg-slate-200 text-[#334155]",
    baseRadioClassName: "border-slate-400 bg-white",
    titleClassName: "text-[#1E293B]",
    descriptionClassName: "text-[#475569]",
    badgeClassName: "border-slate-300 bg-white text-[#334155]",
    activeCardClassName:
      "border-[2.5px] border-slate-500 bg-[linear-gradient(135deg,#F8FAFC,#FFFFFF)] shadow-[0_24px_44px_-30px_rgba(51,65,85,0.28)]",
    activeIconClassName: "border-slate-400 bg-slate-200 text-[#1E293B] shadow-[0_14px_28px_-20px_rgba(51,65,85,0.24)]",
    activeRadioClassName: "border-slate-500 bg-slate-100 shadow-[0_0_0_4px_rgba(100,116,139,0.12)]",
    activeDotClassName: "bg-slate-600",
  },
];

function getSuggestedStatus(assignedTo: string): LineCrudStatus {
  return assignedTo.trim() === "" ? "libre" : "attribuee";
}

function buildDefaultFormData(
  operatorOptions: string[],
  planOptions: LinePlanOption[],
): LineFormData {
  const operatorName = operatorOptions[0] ?? fallbackOperators[0];
  const matchingPlan =
    planOptions.find((plan) => plan.operatorName === operatorName) ??
    planOptions[0] ??
    fallbackPlans[0];

  return {
    phone_number: "",
    operator_name: operatorName,
    plan_name: matchingPlan?.name ?? "",
    department: "",
    assigned_to: "",
    status: "libre",
  };
}

export default function AddLineModal({
  open,
  mode,
  initialData,
  operatorOptions,
  departmentOptions,
  planOptions,
  isSubmitting = false,
  errorMessage = null,
  onClose,
  onSubmit,
}: AddLineModalProps) {
  const resolvedOperators = useMemo(
    () => (operatorOptions.length > 0 ? operatorOptions : fallbackOperators),
    [operatorOptions],
  );
  const resolvedPlans = useMemo(
    () => (planOptions.length > 0 ? planOptions : fallbackPlans),
    [planOptions],
  );
  const resolvedDepartments = useMemo(
    () => Array.from(new Set(departmentOptions.filter((department) => department.trim() !== ""))),
    [departmentOptions],
  );
  const [formData, setFormData] = useState<LineFormData>(
    buildDefaultFormData(resolvedOperators, resolvedPlans),
  );
  const [isStatusManuallyOverridden, setIsStatusManuallyOverridden] = useState(false);

  const filteredPlans = useMemo(() => {
    const matchingPlans = resolvedPlans.filter(
      (plan) => plan.operatorName === formData.operator_name,
    );

    return matchingPlans.length > 0 ? matchingPlans : resolvedPlans;
  }, [formData.operator_name, resolvedPlans]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const nextFormData =
      initialData ?? buildDefaultFormData(resolvedOperators, resolvedPlans);
    setFormData(nextFormData);
    setIsStatusManuallyOverridden(
      nextFormData.status !== getSuggestedStatus(nextFormData.assigned_to),
    );
  }, [initialData, open, resolvedOperators, resolvedPlans]);

  useEffect(() => {
    if (filteredPlans.length === 0) {
      return;
    }

    const planStillAvailable = filteredPlans.some((plan) => plan.name === formData.plan_name);
    if (!planStillAvailable) {
      setFormData((currentData) => ({
        ...currentData,
        plan_name: filteredPlans[0].name,
      }));
    }
  }, [filteredPlans, formData.plan_name]);

  const suggestedStatus = useMemo(
    () => getSuggestedStatus(formData.assigned_to),
    [formData.assigned_to],
  );
  const selectedStatusCard =
    statusCards.find((card) => card.value === formData.status) ?? statusCards[0];
  const selectedPlan = filteredPlans.find((plan) => plan.name === formData.plan_name) ?? null;

  useEffect(() => {
    if (!open) {
      return;
    }

    if (isStatusManuallyOverridden) {
      if (formData.status === suggestedStatus) {
        setIsStatusManuallyOverridden(false);
      }
      return;
    }

    if (formData.status !== suggestedStatus) {
      setFormData((currentData) => ({
        ...currentData,
        status: suggestedStatus,
      }));
    }
  }, [formData.status, isStatusManuallyOverridden, open, suggestedStatus]);

  const statusSummaryMessage = isStatusManuallyOverridden
    ? "Vous avez remplace la suggestion automatique. Votre choix manuel sera conserve."
    : suggestedStatus === "attribuee"
      ? "Cette ligne sera automatiquement marquee comme deja utilisee pour ce collaborateur."
      : "Aucun collaborateur selectionne, la ligne sera creee comme libre.";
  const statusSummaryDescription =
    isStatusManuallyOverridden && formData.assigned_to.trim() !== "" && formData.status === "libre"
      ? "Le collaborateur renseigne ne sera pas lie a la ligne tant que vous gardez le statut Libre."
      : isStatusManuallyOverridden && formData.assigned_to.trim() === "" && formData.status === "attribuee"
        ? "Renseignez un collaborateur pour garder un statut Deja utilisee coherent."
        : "Vous pouvez conserver la suggestion ou choisir un autre statut selon votre besoin metier.";

  function handleStatusSelection(nextStatus: LineCrudStatus) {
    setFormData((currentData) => ({
      ...currentData,
      status: nextStatus,
    }));
    setIsStatusManuallyOverridden(nextStatus !== suggestedStatus);
  }

  function handleResetStatusSuggestion() {
    setFormData((currentData) => ({
      ...currentData,
      status: suggestedStatus,
    }));
    setIsStatusManuallyOverridden(false);
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    await onSubmit(formData);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isSubmitting) {
          onClose();
        }
      }}
    >
      <DialogContent className="flex max-h-[92vh] max-w-4xl flex-col overflow-hidden rounded-[30px] border border-[#DCE5F1] bg-white p-0 shadow-[0_30px_90px_-38px_rgba(15,23,42,0.32)]">
        <div className="border-b border-[#E2E8F0] bg-[linear-gradient(135deg,#F8FBFF_0%,#FFFFFF_62%,#EEF4FF_100%)] px-6 py-6 sm:px-7">
          <DialogHeader className="gap-2 text-left">
            <DialogTitle className="flex items-center gap-3 text-2xl font-semibold tracking-[-0.03em] text-[#0F172A]">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#E0ECFF] text-[#2563EB] shadow-inner shadow-white/80">
                <Phone className="h-5 w-5" />
              </span>
              {mode === "create" ? "Ajouter une ligne" : "Modifier la ligne"}
            </DialogTitle>
            <DialogDescription className="max-w-2xl text-sm leading-6 text-[#64748B]">
              Renseignez les informations de la ligne telephonique et le statut metier visible dans
              le tableau principal.
            </DialogDescription>
          </DialogHeader>
        </div>

        <form
          onSubmit={(event) => void handleSubmit(event)}
          className="flex-1 overflow-y-auto px-6 py-6 sm:px-7"
        >
          <div className="space-y-6">
            <div>
              <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-[#0F172A]">Statut de la ligne</p>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex h-5 w-5 cursor-help items-center justify-center rounded-full border border-[#DCE5F1] bg-white text-[#64748B]">
                          <Info className="h-3.5 w-3.5" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent
                        sideOffset={8}
                        className="max-w-xs bg-[#0F172A] text-white"
                      >
                        Le statut est suggere automatiquement a partir du collaborateur, puis
                        peut etre modifie manuellement.
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <p className="mt-1 text-sm leading-6 text-[#64748B]">
                    Le statut visible dans le tableau est suggere automatiquement selon le
                    collaborateur renseigne.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold",
                      isStatusManuallyOverridden
                        ? "border border-[#E2E8F0] bg-white text-[#475569]"
                        : "border border-[#BFDBFE] bg-[#EFF6FF] text-[#1D4ED8]",
                    )}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {isStatusManuallyOverridden
                      ? "Selection manuelle"
                      : "Statut suggere automatiquement"}
                  </span>
                  <span
                    className={cn(
                      "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium",
                      selectedStatusCard.badgeClassName,
                    )}
                  >
                    <selectedStatusCard.icon className="h-3.5 w-3.5" />
                    {selectedStatusCard.label}
                  </span>
                  {isStatusManuallyOverridden ? (
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-8 rounded-full px-3 text-xs text-[#1D4ED8] hover:bg-blue-50"
                      onClick={handleResetStatusSuggestion}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Revenir a la suggestion
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="mb-4 rounded-[24px] border border-[#DCE5F1] bg-[linear-gradient(135deg,#F8FBFF,#FFFFFF)] p-4 shadow-[0_18px_40px_-34px_rgba(15,23,42,0.22)]">
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      "mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl",
                      isStatusManuallyOverridden
                        ? "bg-white text-[#1D4ED8] shadow-sm"
                        : "bg-[#EFF6FF] text-[#2563EB]",
                    )}
                    >
                      {isStatusManuallyOverridden ? (
                      <selectedStatusCard.icon className="h-4 w-4" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-[#0F172A]">{statusSummaryMessage}</p>
                    <p className="mt-1 text-xs leading-6 text-[#64748B]">
                      {statusSummaryDescription}
                    </p>
                  </div>
                </div>
              </div>

              <div
                role="radiogroup"
                aria-label="Choix du statut de la ligne"
                className="grid gap-4 md:grid-cols-2"
              >
                {statusCards.map((card) => {
                  const isActive = formData.status === card.value;
                  const isSuggested = suggestedStatus === card.value;

                  return (
                    <div
                      key={card.value}
                      className={cn(
                        "relative overflow-hidden rounded-[24px] transition-all duration-300",
                        isActive
                          ? `${card.activeCardClassName} scale-[1.01] ring-1 ring-white/80`
                          : `${card.baseCardClassName} ${card.hoverCardClassName} hover:scale-[1.02]`,
                      )}
                    >
                      <button
                        type="button"
                        role="radio"
                        aria-checked={isActive}
                        onClick={() => handleStatusSelection(card.value)}
                        aria-label={`${card.label} - ${card.description}`}
                        className="w-full cursor-pointer p-5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/10"
                      >
                        <div className="flex min-h-[164px] items-start justify-between gap-4">
                          <div className="flex min-w-0 items-start gap-4">
                            <span
                              className={cn(
                                "flex h-14 w-14 shrink-0 items-center justify-center rounded-[20px] border transition-all duration-300",
                                isActive
                                  ? card.activeIconClassName
                                  : card.baseIconClassName,
                              )}
                            >
                              <card.icon className="h-5 w-5" />
                            </span>

                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2.5">
                                <span className={cn("text-base font-bold tracking-[-0.01em]", isActive ? "text-[#0F172A]" : card.titleClassName)}>
                                  {card.label}
                                </span>
                                <span className={cn("rounded-full border bg-white/92 px-2.5 py-1 text-[11px] font-semibold", card.badgeClassName)}>
                                  {card.helper}
                                </span>
                                {isSuggested ? (
                                  <span className="rounded-full border border-[#DCE5F1] bg-white/92 px-2.5 py-1 text-[11px] font-semibold text-[#0F172A] shadow-sm">
                                    Recommande
                                  </span>
                                ) : null}
                              </div>
                              <p className={cn("mt-3 max-w-[28ch] text-sm font-medium leading-6", isActive ? "text-[#334155]" : card.descriptionClassName)}>
                                {card.description}
                              </p>
                            </div>
                          </div>

                          <div className="flex shrink-0 items-start">
                            <span
                              className={cn(
                                "flex h-8 w-8 items-center justify-center rounded-full border transition-all duration-300",
                                isActive
                                  ? card.activeRadioClassName
                                  : card.baseRadioClassName,
                              )}
                            >
                              {isActive ? (
                                <Check className={cn("h-4 w-4", isActive ? "text-[#0F172A]" : card.titleClassName)} />
                              ) : (
                                <span className="h-3 w-3 rounded-full bg-white/80" />
                              )}
                            </span>
                          </div>
                        </div>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="line_phone_number">Numero de ligne</Label>
                <div className="relative">
                  <Phone className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[#64748B]" />
                  <Input
                    id="line_phone_number"
                    type="tel"
                    value={formData.phone_number}
                    onChange={(event) =>
                      setFormData((currentData) => ({
                        ...currentData,
                        phone_number: event.target.value,
                      }))
                    }
                    placeholder="+212612345678"
                    className="h-12 rounded-2xl border-[#DCE5F1] bg-[#F8FAFC] pl-10"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="line_operator">Operateur</Label>
                <div className="relative">
                  <CreditCard className="pointer-events-none absolute top-1/2 left-3 z-10 h-4 w-4 -translate-y-1/2 text-[#64748B]" />
                  <Select
                    value={formData.operator_name}
                    onValueChange={(value) =>
                      setFormData((currentData) => ({
                        ...currentData,
                        operator_name: value,
                      }))
                    }
                  >
                    <SelectTrigger
                      id="line_operator"
                      className="h-12 rounded-2xl border-[#DCE5F1] bg-[#F8FAFC] pl-10"
                    >
                      <SelectValue placeholder="Selectionner un operateur" />
                    </SelectTrigger>
                    <SelectContent>
                      {resolvedOperators.map((operatorName) => (
                        <SelectItem key={operatorName} value={operatorName}>
                          {operatorName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="line_plan">Forfait</Label>
                <div className="relative">
                  <CreditCard className="pointer-events-none absolute top-1/2 left-3 z-10 h-4 w-4 -translate-y-1/2 text-[#64748B]" />
                  <Select
                    value={formData.plan_name}
                    onValueChange={(value) =>
                      setFormData((currentData) => ({
                        ...currentData,
                        plan_name: value,
                      }))
                    }
                  >
                    <SelectTrigger
                      id="line_plan"
                      className="h-12 rounded-2xl border-[#DCE5F1] bg-[#F8FAFC] pl-10"
                    >
                      <SelectValue placeholder="Selectionner un forfait" />
                    </SelectTrigger>
                    <SelectContent>
                      {filteredPlans.map((plan) => (
                        <SelectItem
                          key={`${plan.operatorName}:${plan.name}`}
                          value={plan.name}
                        >
                          {plan.name}
                          {plan.quotaLabel ? ` - ${plan.quotaLabel}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="line_department">Departement</Label>
                <div className="relative">
                  <Building2 className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[#64748B]" />
                  <Input
                    id="line_department"
                    list={resolvedDepartments.length > 0 ? "line-department-suggestions" : undefined}
                    value={formData.department}
                    onChange={(event) =>
                      setFormData((currentData) => ({
                        ...currentData,
                        department: event.target.value,
                      }))
                    }
                    placeholder="Direction, Finance, Commercial..."
                    className="h-12 rounded-2xl border-[#DCE5F1] bg-[#F8FAFC] pl-10"
                  />
                </div>
                {resolvedDepartments.length > 0 ? (
                  <datalist id="line-department-suggestions">
                    {resolvedDepartments.map((departmentName) => (
                      <option key={departmentName} value={departmentName} />
                    ))}
                  </datalist>
                ) : null}
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="line_assigned_to">Collaborateur</Label>
                <div className="relative">
                  <User className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[#64748B]" />
                  <Input
                    id="line_assigned_to"
                    value={formData.assigned_to}
                    onChange={(event) =>
                      setFormData((currentData) => ({
                        ...currentData,
                        assigned_to: event.target.value,
                      }))
                    }
                    placeholder="Nom complet du collaborateur"
                    className="h-12 rounded-2xl border-[#DCE5F1] bg-[#F8FAFC] pl-10"
                  />
                </div>
                <p className="text-xs text-[#64748B]">
                  Si un collaborateur est renseigne, le statut suggere passe automatiquement a
                  Deja utilisee. Vous pouvez toujours le modifier manuellement.
                </p>
              </div>
            </div>

            <div className="rounded-[26px] border border-[#DCE5F1] bg-[linear-gradient(135deg,#F8FAFC_0%,#FFFFFF_100%)] p-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-sm font-semibold text-[#0F172A]">Apercu avant validation</p>
                  <p className="mt-1 text-sm text-[#64748B]">
                    La ligne sera enregistree avec l&apos;operateur {formData.operator_name || "-"} et le
                    forfait {selectedPlan?.name || formData.plan_name || "-"}.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full border border-[#DBEAFE] bg-[#EFF6FF] px-3 py-1 text-xs font-medium text-[#1D4ED8]">
                    {formData.phone_number.trim() || "Numero a definir"}
                  </span>
                  <span
                    className={cn(
                      "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium",
                      selectedStatusCard.badgeClassName,
                    )}
                  >
                    <selectedStatusCard.icon className="h-3.5 w-3.5" />
                    {selectedStatusCard.label}
                  </span>
                  <span className="rounded-full border border-[#E2E8F0] bg-white px-3 py-1 text-xs font-medium text-[#475569]">
                    {selectedPlan?.quotaLabel ? `${selectedPlan.quotaLabel}` : "Quota selon forfait"}
                  </span>
                </div>
              </div>
            </div>

            {errorMessage ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-[#B91C1C]">
                {errorMessage}
              </div>
            ) : null}
          </div>

          <DialogFooter className="mt-8 gap-3 border-t border-[#E2E8F0] pt-5">
            <Button
              type="button"
              variant="outline"
              className="h-11 rounded-xl border-[#DCE5F1] bg-white text-[#475569]"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Annuler
            </Button>
            <Button
              type="submit"
              className="h-11 rounded-xl bg-[linear-gradient(135deg,#2563EB,#1D4ED8)] px-6 text-white shadow-[0_16px_30px_-18px_rgba(37,99,235,0.7)] hover:opacity-95"
              disabled={isSubmitting}
            >
              {isSubmitting
                ? mode === "create"
                  ? "Enregistrement..."
                  : "Mise a jour..."
                : mode === "create"
                  ? "Enregistrer"
                  : "Mettre a jour"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
