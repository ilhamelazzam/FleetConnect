import type { ApiPlan } from "./api";

export type PlanActivationStatus = ApiPlan["activation_status"];

export function getPlanActivationStatusLabel(status: PlanActivationStatus): string {
  if (status === "active") return "Actif";
  if (status === "pending") return "En attente";
  if (status === "suspended") return "Suspendu";
  return "Inactif";
}

export function getPlanActivationStatusClasses(status: PlanActivationStatus): string {
  if (status === "active") return "border-emerald-200 bg-emerald-50 text-[#059669]";
  if (status === "pending") return "border-orange-200 bg-orange-50 text-[#EA580C]";
  if (status === "suspended") return "border-red-200 bg-red-50 text-[#DC2626]";
  return "border-slate-200 bg-slate-100 text-[#475569]";
}

export function getPlanActivationActionLabel(status: PlanActivationStatus): string {
  if (status === "active") return "Deja active";
  if (status === "suspended" || status === "inactive") return "Reactiver";
  return "Activer forfait";
}

export function isPlanActive(status: PlanActivationStatus): boolean {
  return status === "active";
}
