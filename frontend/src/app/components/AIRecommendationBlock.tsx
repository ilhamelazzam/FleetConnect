import { useState } from "react";
import { Brain, ChevronDown, ChevronUp, Info } from "lucide-react";

import { Badge } from "./ui/badge";
import { cn } from "./ui/utils";
import {
  buildRecommendationPreview,
  formatAiRecommendationStatus,
  getAiRecommendationEmptyStateLabel,
  getAiRecommendationStatusClasses,
  normalizeAiRecommendationStatus,
  resolveAiRecommendation,
  type AiRecommendationStatus,
} from "../lib/ai-recommendations";

interface AIRecommendationBlockProps {
  recommendation?: string | null;
  secondaryText?: string | null;
  status?: string | null;
  fallbackStatus?: AiRecommendationStatus;
  severityLabel?: string | null;
  riskTypeLabel?: string | null;
  scoreLabel?: string | null;
  title?: string;
  compact?: boolean;
  previewLength?: number;
  defaultExpanded?: boolean;
  className?: string;
}

export default function AIRecommendationBlock({
  recommendation,
  secondaryText,
  status,
  fallbackStatus = "pending",
  severityLabel,
  riskTypeLabel,
  scoreLabel,
  title = "Recommandation IA",
  compact = false,
  previewLength = 148,
  defaultExpanded = false,
  className,
}: AIRecommendationBlockProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const resolvedRecommendation = resolveAiRecommendation(recommendation);
  const hasRecommendation = Boolean(resolvedRecommendation);
  const normalizedStatus = normalizeAiRecommendationStatus(
    status,
    hasRecommendation ? fallbackStatus : "waiting",
  );
  const statusLabel = formatAiRecommendationStatus(normalizedStatus);
  const statusClasses = getAiRecommendationStatusClasses(normalizedStatus);
  const preview = resolvedRecommendation
    ? buildRecommendationPreview(resolvedRecommendation, previewLength)
    : null;
  const isTruncated = Boolean(
    resolvedRecommendation && preview && preview !== resolvedRecommendation,
  );
  const shouldShowDetailsToggle = Boolean(isTruncated || secondaryText?.trim());

  return (
    <div
      className={cn(
        "rounded-2xl border border-[var(--bc-ai-border)] bg-[linear-gradient(135deg,rgba(99,102,241,0.08)_0%,rgba(139,92,246,0.05)_48%,var(--bg-card)_100%)] p-4 shadow-[0_12px_28px_rgba(15,23,42,0.04)] dark:shadow-[0_18px_40px_rgba(2,6,23,0.32)]",
        compact ? "space-y-2" : "space-y-3",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--bc-ai-start)]">
          <span className="bc-gradient-ai flex h-7 w-7 items-center justify-center rounded-full text-white shadow-[0_10px_22px_rgba(99,102,241,0.2)]">
            <Brain className="h-3.5 w-3.5" />
          </span>
          <span>{title}</span>
        </div>
        <Badge className={statusClasses}>{statusLabel}</Badge>
      </div>

      {severityLabel || riskTypeLabel || scoreLabel ? (
        <div className="flex flex-wrap gap-2">
          {severityLabel ? (
            <Badge variant="outline" className="bg-[var(--card)]">
              Risque {severityLabel}
            </Badge>
          ) : null}
          {riskTypeLabel ? (
            <Badge variant="outline" className="bg-[var(--card)]">
              {riskTypeLabel}
            </Badge>
          ) : null}
          {scoreLabel ? (
            <Badge variant="outline" className="bg-[var(--card)]">
              {scoreLabel}
            </Badge>
          ) : null}
        </div>
      ) : null}

      {hasRecommendation ? (
        <>
          <p
            className={cn(
              "text-[var(--bc-neutral-strong)]",
              compact ? "text-sm leading-6" : "text-sm leading-6",
            )}
          >
            {isExpanded || !preview ? resolvedRecommendation : preview}
          </p>
          {isExpanded && secondaryText?.trim() ? (
            <p className="text-sm leading-6 text-[var(--bc-neutral-body)]">{secondaryText.trim()}</p>
          ) : null}
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-[var(--bc-ai-border)] bg-[var(--card)] px-3 py-3 text-sm text-[var(--bc-neutral-body)]">
          {getAiRecommendationEmptyStateLabel(normalizedStatus)}
        </div>
      )}

      {shouldShowDetailsToggle ? (
        <button
          type="button"
          onClick={() => setIsExpanded((current) => !current)}
          className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--bc-ai-start)] transition-colors hover:text-[var(--bc-ai-end)]"
        >
          <Info className="h-3.5 w-3.5" />
          {isExpanded ? "Voir moins" : "Voir plus"}
          {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      ) : null}
    </div>
  );
}
