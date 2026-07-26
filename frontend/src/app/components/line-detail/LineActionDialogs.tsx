import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeftRight,
  BadgeCheck,
  Briefcase,
  Mail,
  ShieldAlert,
  User,
  Wallet,
} from "lucide-react";

import { type ApiPlan } from "../../lib/api";
import {
  getPlanActivationStatusClasses,
  getPlanActivationStatusLabel,
  isPlanActive,
} from "../../lib/plan-activation";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { cn } from "../ui/utils";

export interface LineEditFormValues {
  assigned_to: string;
  contact_email: string;
  department: string;
  status: "active" | "suspended" | "inactive";
}

interface EditLineDialogProps {
  open: boolean;
  isSubmitting?: boolean;
  initialValues: LineEditFormValues;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: LineEditFormValues) => Promise<void>;
}

interface ChangePlanDialogProps {
  open: boolean;
  plans: ApiPlan[];
  currentPlanId: number | null;
  currentMonthlyCost: number;
  recommendedPlanId: number | null;
  isSubmitting?: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (planId: number) => Promise<void>;
}

interface SuspendLineDialogProps {
  open: boolean;
  phoneNumber: string;
  isSubmitting?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
}

function formatMadValue(value: number): string {
  return `${new Intl.NumberFormat("fr-FR").format(value)} MAD`;
}

export function EditLineDialog({
  open,
  isSubmitting = false,
  initialValues,
  onOpenChange,
  onSubmit,
}: EditLineDialogProps) {
  const [formValues, setFormValues] = useState<LineEditFormValues>(initialValues);

  useEffect(() => {
    if (open) {
      setFormValues(initialValues);
    }
  }, [initialValues, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl rounded-[28px] border border-[#DCE5F1] bg-white p-0 shadow-[0_30px_90px_rgba(15,23,42,0.18)]">
        <div className="border-b border-[#E2E8F0] bg-[linear-gradient(135deg,#F8FBFF_0%,#FFFFFF_80%)] px-6 py-5">
          <DialogHeader className="gap-2 text-left">
            <DialogTitle className="flex items-center gap-3 text-2xl font-semibold text-[#0F172A]">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#EFF6FF] text-[#2563EB]">
                <User className="h-5 w-5" />
              </span>
              Modifier la ligne
            </DialogTitle>
            <DialogDescription className="text-sm text-[#64748B]">
              Mettez a jour le rattachement collaborateur et le statut de service de la ligne.
            </DialogDescription>
          </DialogHeader>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void onSubmit(formValues);
          }}
          className="space-y-6 px-6 py-6"
        >
          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="assigned_to">Nom utilisateur</Label>
              <div className="relative">
                <User className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[#64748B]" />
                <Input
                  id="assigned_to"
                  value={formValues.assigned_to}
                  onChange={(event) =>
                    setFormValues((currentValues) => ({
                      ...currentValues,
                      assigned_to: event.target.value,
                    }))
                  }
                  placeholder="Nom du collaborateur"
                  className="h-11 rounded-xl border-[#DCE5F1] bg-[#F8FAFC] pl-10"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="contact_email">Email</Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[#64748B]" />
                <Input
                  id="contact_email"
                  type="email"
                  value={formValues.contact_email}
                  onChange={(event) =>
                    setFormValues((currentValues) => ({
                      ...currentValues,
                      contact_email: event.target.value,
                    }))
                  }
                  placeholder="nom@entreprise.ma"
                  className="h-11 rounded-xl border-[#DCE5F1] bg-[#F8FAFC] pl-10"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="department">Departement</Label>
              <div className="relative">
                <Briefcase className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[#64748B]" />
                <Input
                  id="department"
                  value={formValues.department}
                  onChange={(event) =>
                    setFormValues((currentValues) => ({
                      ...currentValues,
                      department: event.target.value,
                    }))
                  }
                  placeholder="IT, Commercial, Finance..."
                  className="h-11 rounded-xl border-[#DCE5F1] bg-[#F8FAFC] pl-10"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="line_status">Statut</Label>
              <Select
                value={formValues.status}
                onValueChange={(value: LineEditFormValues["status"]) =>
                  setFormValues((currentValues) => ({
                    ...currentValues,
                    status: value,
                  }))
                }
              >
                <SelectTrigger
                  id="line_status"
                  className="h-11 rounded-xl border-[#DCE5F1] bg-[#F8FAFC]"
                >
                  <SelectValue placeholder="Selectionner un statut" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Actif</SelectItem>
                  <SelectItem value="suspended">Suspendu</SelectItem>
                  <SelectItem value="inactive">Inactif</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded-2xl border border-[#DCE5F1] bg-[#F8FAFC] p-4 text-sm text-[#475569]">
            Le statut met a jour immediatement l'exploitabilite de la ligne dans la vue principale.
          </div>

          <DialogFooter className="gap-3 border-t border-[#E2E8F0] pt-4">
            <Button
              type="button"
              variant="outline"
              className="h-11 rounded-xl border-[#DCE5F1] text-[#475569]"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Annuler
            </Button>
            <Button
              type="submit"
              className="h-11 rounded-xl bg-[#2563EB] px-5 text-white hover:bg-[#1D4ED8]"
              disabled={isSubmitting}
            >
              {isSubmitting ? "Enregistrement..." : "Enregistrer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ChangePlanDialog({
  open,
  plans,
  currentPlanId,
  currentMonthlyCost,
  recommendedPlanId,
  isSubmitting = false,
  onOpenChange,
  onSubmit,
}: ChangePlanDialogProps) {
  const initialPlanId = recommendedPlanId ?? currentPlanId ?? plans[0]?.id ?? null;
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(initialPlanId);

  useEffect(() => {
    if (open) {
      setSelectedPlanId(recommendedPlanId ?? currentPlanId ?? plans[0]?.id ?? null);
    }
  }, [currentPlanId, open, plans, recommendedPlanId]);

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.id === selectedPlanId) ?? null,
    [plans, selectedPlanId],
  );

  const costDelta = selectedPlan ? selectedPlan.monthly_price - currentMonthlyCost : 0;
  const estimatedSavings = Math.max(currentMonthlyCost - (selectedPlan?.monthly_price ?? currentMonthlyCost), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col overflow-hidden rounded-[28px] border border-[#DCE5F1] bg-white p-0 shadow-[0_30px_90px_rgba(15,23,42,0.18)]">
        <div className="border-b border-[#E2E8F0] bg-[linear-gradient(135deg,#EEF4FF_0%,#FFFFFF_80%)] px-6 py-5">
          <DialogHeader className="gap-2 text-left">
            <DialogTitle className="flex items-center gap-3 text-2xl font-semibold text-[#0F172A]">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#E0EAFF] text-[#2563EB]">
                <ArrowLeftRight className="h-5 w-5" />
              </span>
              Changer de forfait
            </DialogTitle>
            <DialogDescription className="text-sm text-[#64748B]">
              Comparez les forfaits disponibles et confirmez un changement avec impact budgetaire.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="grid gap-5 overflow-hidden px-6 py-6 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-3 overflow-y-auto pr-1">
            {plans.map((plan) => {
              const isSelected = plan.id === selectedPlanId;
              const isCurrent = plan.id === currentPlanId;
              const isRecommended = plan.id === recommendedPlanId;
              return (
                <button
                  key={plan.id}
                  type="button"
                  onClick={() => setSelectedPlanId(plan.id)}
                  className={cn(
                    "w-full rounded-2xl border p-4 text-left transition-all",
                    isSelected
                      ? "border-[#2563EB] bg-[#F8FBFF] shadow-[0_18px_40px_rgba(37,99,235,0.12)]"
                      : "border-[#E2E8F0] bg-white hover:border-[#BFDBFE] hover:bg-[#F8FBFF]",
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold text-[#0F172A]">{plan.name}</h3>
                        {isCurrent ? (
                          <Badge className="border-slate-200 bg-slate-100 text-[#475569]">
                            Forfait actuel
                          </Badge>
                        ) : null}
                        {isRecommended ? (
                          <Badge className="border-emerald-200 bg-emerald-50 text-[#059669]">
                            Recommande
                          </Badge>
                        ) : null}
                        <Badge className={getPlanActivationStatusClasses(plan.activation_status)}>
                          {getPlanActivationStatusLabel(plan.activation_status)}
                        </Badge>
                      </div>
                      <p className="text-sm text-[#64748B]">{plan.operator_name}</p>
                    </div>
                    <div className="rounded-2xl bg-[#F8FAFC] px-4 py-3 text-right">
                      <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Prix</p>
                      <p className="text-lg font-semibold text-[#0F172A]">
                        {formatMadValue(plan.monthly_price)}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 text-sm text-[#475569] md:grid-cols-3">
                    <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2">
                      <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Data</p>
                      <p className="mt-1 font-medium text-[#0F172A]">{plan.data_quota}</p>
                    </div>
                    <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2">
                      <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Voix</p>
                      <p className="mt-1 font-medium text-[#0F172A]">{plan.voice_quota}</p>
                    </div>
                    <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2">
                      <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">SMS</p>
                      <p className="mt-1 font-medium text-[#0F172A]">{plan.sms_quota}</p>
                    </div>
                  </div>
                  <p className="mt-3 text-sm text-[#64748B]">
                    {plan.description ?? "Forfait exploitable immediatement pour les lignes entreprise."}
                  </p>
                </button>
              );
            })}
          </div>

          <div className="space-y-4 rounded-[24px] border border-[#DCE5F1] bg-[linear-gradient(180deg,#F8FAFC_0%,#FFFFFF_100%)] p-5">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#EEF2FF] text-[#4F46E5]">
                <Wallet className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-medium text-[#0F172A]">Impact du changement</p>
                <p className="text-sm text-[#64748B]">Resume budgetaire et metier avant confirmation.</p>
              </div>
            </div>

            <div className="grid gap-3">
              <div className="rounded-2xl border border-[#E2E8F0] bg-white px-4 py-3">
                <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Cout actuel</p>
                <p className="mt-2 text-xl font-semibold text-[#0F172A]">
                  {formatMadValue(currentMonthlyCost)}
                </p>
              </div>
              <div className="rounded-2xl border border-[#E2E8F0] bg-white px-4 py-3">
                <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Nouveau cout</p>
                <p className="mt-2 text-xl font-semibold text-[#0F172A]">
                  {selectedPlan ? formatMadValue(selectedPlan.monthly_price) : "--"}
                </p>
              </div>
              <div className="rounded-2xl border border-[#E2E8F0] bg-white px-4 py-3">
                <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Gain estime</p>
                <p className="mt-2 text-xl font-semibold text-[#059669]">
                  {formatMadValue(estimatedSavings)}
                </p>
                <p className="mt-1 text-sm text-[#64748B]">
                  {costDelta > 0
                    ? `Surcout de ${formatMadValue(costDelta)} pour eviter les depassements.`
                    : costDelta < 0
                      ? `Reduction directe de ${formatMadValue(Math.abs(costDelta))} par mois.`
                      : "Budget stable avec un meilleur alignement d'usage."}
                </p>
              </div>
              <div className="rounded-2xl border border-[#DBEAFE] bg-[#EFF6FF] px-4 py-3 text-sm text-[#1D4ED8]">
                {selectedPlan ? (
                  <>
                    <p className="font-medium text-[#1E3A8A]">Suggestion</p>
                    <p className="mt-1">
                      {selectedPlan.id === recommendedPlanId
                        ? "Ce forfait a ete preselectionne car il correspond mieux au profil de consommation."
                        : "Vous pouvez confirmer un autre forfait si le contexte metier l'exige."}
                    </p>
                  </>
                ) : (
                  "Selectionnez un forfait pour afficher l'impact."
                )}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-3 border-t border-[#E2E8F0] px-6 py-4">
          <Button
            type="button"
            variant="outline"
            className="h-11 rounded-xl border-[#DCE5F1] text-[#475569]"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Fermer
          </Button>
          <Button
            type="button"
            className="h-11 rounded-xl bg-[#2563EB] px-5 text-white hover:bg-[#1D4ED8]"
            disabled={
              isSubmitting ||
              selectedPlanId === null ||
              (selectedPlanId === currentPlanId && isPlanActive(selectedPlan?.activation_status ?? "inactive"))
            }
            onClick={() => {
              if (selectedPlanId !== null) {
                void onSubmit(selectedPlanId);
              }
            }}
          >
            {isSubmitting
              ? "Activation..."
              : selectedPlanId === currentPlanId && isPlanActive(selectedPlan?.activation_status ?? "inactive")
                ? "Deja active"
                : selectedPlan?.activation_status === "suspended"
                  ? "Reactiver"
                  : "Activer forfait"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SuspendLineDialog({
  open,
  phoneNumber,
  isSubmitting = false,
  onOpenChange,
  onConfirm,
}: SuspendLineDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="rounded-[28px] border border-[#FECACA] bg-white shadow-[0_30px_90px_rgba(15,23,42,0.18)]">
        <AlertDialogHeader className="gap-3 text-left">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-[#DC2626]">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <AlertDialogTitle className="text-2xl font-semibold text-[#0F172A]">
            Suspendre la ligne
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-2 text-sm text-[#64748B]">
            <span className="block">
              Voulez-vous vraiment suspendre cette ligne ?
            </span>
            <span className="flex items-center gap-2 rounded-2xl border border-[#FECACA] bg-red-50 px-3 py-2 text-[#991B1B]">
              <BadgeCheck className="h-4 w-4" />
              {phoneNumber}
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-3">
          <AlertDialogCancel className="h-11 rounded-xl border-[#DCE5F1] text-[#475569]">
            Annuler
          </AlertDialogCancel>
          <AlertDialogAction
            className="h-11 rounded-xl bg-[#DC2626] text-white hover:bg-[#B91C1C]"
            onClick={(event) => {
              event.preventDefault();
              void onConfirm();
            }}
            disabled={isSubmitting}
          >
            {isSubmitting ? "Suspension..." : "Confirmer la suspension"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
