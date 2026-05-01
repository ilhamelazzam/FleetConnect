import { formatMadValue, getOperatorStyles } from "./cdr-analytics";

export { formatMadValue, getOperatorStyles };

export function formatMobileRiskLabel(riskLevel: string): string {
  if (riskLevel === "Eleve") {
    return "Eleve";
  }
  return riskLevel;
}

export function getMobileRiskClasses(riskLevel: string): string {
  if (riskLevel === "Critique") {
    return "border-[var(--bc-danger-border)] bg-[var(--bc-danger-soft)] text-[var(--bc-danger)]";
  }
  if (riskLevel === "Eleve") {
    return "border-[var(--bc-warning-border)] bg-[var(--bc-warning-soft)] text-[var(--bc-warning)]";
  }
  if (riskLevel === "Moyen") {
    return "border-[var(--bc-warning-border)] bg-[var(--bc-warning-soft)] text-[var(--bc-warning-hover)]";
  }
  return "border-[var(--bc-success-border)] bg-[var(--bc-success-soft)] text-[var(--bc-success)]";
}

export function getMobileRiskColor(riskLevel: string): string {
  if (riskLevel === "Critique") {
    return "#EF4444";
  }
  if (riskLevel === "Eleve") {
    return "#F59E0B";
  }
  if (riskLevel === "Moyen") {
    return "#F59E0B";
  }
  return "#10B981";
}

export function getDeviceCategoryColor(deviceCategory: string): string {
  if (deviceCategory === "Premium") {
    return "#8B5CF6";
  }
  if (deviceCategory === "Haut de gamme") {
    return "#3B82F6";
  }
  if (deviceCategory === "Milieu de gamme") {
    return "#F59E0B";
  }
  return "#10B981";
}

export function getDeviceCategoryClasses(deviceCategory: string): string {
  if (deviceCategory === "Premium") {
    return "border-[var(--bc-ai-border)] bg-[linear-gradient(135deg,rgba(99,102,241,0.14),rgba(139,92,246,0.16))] text-[var(--bc-ai-start)]";
  }
  if (deviceCategory === "Haut de gamme") {
    return "border-[var(--bc-primary-border)] bg-[var(--bc-primary-soft)] text-[var(--bc-primary)]";
  }
  if (deviceCategory === "Milieu de gamme") {
    return "border-[var(--bc-warning-border)] bg-[var(--bc-warning-soft)] text-[var(--bc-warning)]";
  }
  return "border-[var(--bc-success-border)] bg-[var(--bc-success-soft)] text-[var(--bc-success)]";
}

export function formatPredictionConfidence(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
