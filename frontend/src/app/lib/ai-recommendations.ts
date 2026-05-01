export type AiRecommendationStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "waiting";

function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function resolveAiRecommendation(
  ...values: Array<string | null | undefined>
): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

export function normalizeAiRecommendationStatus(
  rawValue: string | null | undefined,
  fallbackStatus: AiRecommendationStatus = "pending",
): AiRecommendationStatus {
  if (!rawValue?.trim()) {
    return fallbackStatus;
  }

  const normalized = normalizeKey(rawValue);

  if (
    [
      "en_cours",
      "in_progress",
      "client_contacte",
      "acknowledged",
      "acknowledge",
      "alerte_envoyee",
      "sent",
      "accepted",
      "acceptee",
      "accepte",
    ].includes(normalized)
  ) {
    return "in_progress";
  }

  if (
    [
      "traitee",
      "traite",
      "complete",
      "completed",
      "resolved",
      "resolue",
      "resolu",
      "offre_appliquee",
      "ligne_bloquee",
      "blocked",
      "appliquee",
      "applique",
      "rejected",
      "rejetee",
      "rejetee",
      "rejete",
    ].includes(normalized)
  ) {
    return "completed";
  }

  if (
    [
      "waiting",
      "pending_analysis",
      "analyse_en_attente",
      "ia_en_attente",
      "queued",
    ].includes(normalized)
  ) {
    return "waiting";
  }

  return "pending";
}

export function formatAiRecommendationStatus(
  status: AiRecommendationStatus,
): string {
  if (status === "in_progress") return "En cours";
  if (status === "completed") return "Traitee";
  if (status === "waiting") return "Analyse IA en attente";
  return "Non traitee";
}

export function getAiRecommendationStatusClasses(
  status: AiRecommendationStatus,
): string {
  if (status === "in_progress") {
    return "border-[var(--bc-primary-border)] bg-[var(--bc-primary-soft)] text-[var(--bc-primary)]";
  }
  if (status === "completed") {
    return "border-[var(--bc-success-border)] bg-[var(--bc-success-soft)] text-[var(--bc-success)]";
  }
  if (status === "waiting") {
    return "border-[var(--bc-ai-border)] bg-[linear-gradient(135deg,rgba(99,102,241,0.14),rgba(139,92,246,0.16))] text-[var(--bc-ai-start)]";
  }
  return "border-[var(--bc-warning-border)] bg-[var(--bc-warning-soft)] text-[var(--bc-warning)]";
}

export function getAiRecommendationEmptyStateLabel(
  status: AiRecommendationStatus,
): string {
  if (status === "waiting") {
    return "Analyse IA en attente";
  }

  return "Aucune recommandation disponible";
}

export function buildRecommendationPreview(
  text: string,
  maxLength = 148,
): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}
