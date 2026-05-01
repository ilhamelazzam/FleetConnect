import { useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, PlayCircle, XCircle } from "lucide-react";

import AIRecommendationBlock from "./AIRecommendationBlock";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { cn } from "./ui/utils";

type RiskTone = "critical" | "high" | "medium" | "low";

export interface AIRiskInsightCardProps {
  riskId: string;
  title: string;
  severity: string;
  description: string;
  impact: string;
  cause?: string;
  aiRecommendation?: string | null;
  suggestedAction?: string | null;
  confidenceScore?: number | null;
  recommendationStatus?: string | null;
  moduleLabel?: string;
  className?: string;
  compact?: boolean;
  defaultExpanded?: boolean;
  onApply?: () => void;
  onSimulate?: () => void;
  onIgnore?: () => void;
}

function normalizeTone(severity: string): RiskTone {
  const normalized = severity.trim().toLowerCase();

  if (["critique", "critical", "p1", "non_compliant"].includes(normalized)) {
    return "critical";
  }
  if (["eleve", "elevee", "high", "p2", "moderate", "blocked"].includes(normalized)) {
    return "high";
  }
  if (["moyen", "medium", "warning", "under_monitoring", "p3"].includes(normalized)) {
    return "medium";
  }
  return "low";
}

function toneClasses(tone: RiskTone): { card: string; badge: string; icon: string } {
  if (tone === "critical") {
    return {
      card: "bc-surface-danger",
      badge: "border-[var(--bc-danger-border)] bg-[var(--bc-danger-soft)] text-[var(--bc-danger)]",
      icon: "bc-icon-danger",
    };
  }
  if (tone === "high") {
    return {
      card: "bc-surface-warning",
      badge: "border-[var(--bc-warning-border)] bg-[var(--bc-warning-soft)] text-[var(--bc-warning)]",
      icon: "bc-icon-warning",
    };
  }
  if (tone === "medium") {
    return {
      card: "bc-surface-warning",
      badge: "border-[var(--bc-warning-border)] bg-[var(--bc-warning-soft)] text-[var(--bc-warning-hover)]",
      icon: "bc-icon-warning",
    };
  }
  return {
    card: "bc-surface-success",
    badge: "border-[var(--bc-success-border)] bg-[var(--bc-success-soft)] text-[var(--bc-success)]",
    icon: "bc-icon-success",
  };
}

function formatConfidenceScore(value: number | null | undefined): string | null {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return null;
  }

  const normalized = value <= 1 ? value * 100 : value;
  return `${Math.round(Math.max(0, Math.min(normalized, 100)))}%`;
}

export default function AIRiskInsightCard({
  riskId,
  title,
  severity,
  description,
  impact,
  cause,
  aiRecommendation,
  suggestedAction,
  confidenceScore,
  recommendationStatus,
  moduleLabel,
  className,
  compact = false,
  defaultExpanded = false,
  onApply,
  onSimulate,
  onIgnore,
}: AIRiskInsightCardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const tone = normalizeTone(severity);
  const styles = toneClasses(tone);
  const confidenceLabel = formatConfidenceScore(confidenceScore);
  const recommendation = aiRecommendation?.trim() ?? "";
  const action =
    suggestedAction?.trim() ||
    "Analyser le contexte, confirmer l'impact et definir l'action metier adaptee.";
  const hasActions = Boolean(onApply || onSimulate || onIgnore);

  return (
    <article
      className={cn(
        "rounded-[24px] border p-5 shadow-[0_14px_34px_rgba(15,23,42,0.05)]",
        styles.card,
        className,
      )}
      data-risk-id={riskId}
    >
      <div className="flex items-start gap-3">
        <div className={cn("rounded-lg p-2", styles.icon)}>
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={styles.badge}>{severity}</Badge>
            {moduleLabel ? <Badge variant="outline" className="bg-white/90">{moduleLabel}</Badge> : null}
            {confidenceLabel ? <Badge variant="ai">Confiance {confidenceLabel}</Badge> : null}
          </div>

          <h3
            className={cn(
              "mt-3 font-semibold leading-6 text-[var(--bc-neutral-strong)]",
              compact ? "text-base" : "text-lg",
            )}
          >
            {title}
          </h3>
          <p className="mt-2 text-sm leading-6 text-[var(--bc-neutral-body)]">{description}</p>
        </div>
      </div>

      <AIRecommendationBlock
        recommendation={recommendation}
        secondaryText={action}
        status={recommendationStatus}
        fallbackStatus="pending"
        title="Recommandation IA"
        compact={compact}
        className="mt-4"
      />

      <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">Impact</p>
          <p className="mt-1 text-sm font-medium leading-6 text-[var(--bc-neutral-strong)]">{impact}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="rounded-xl"
          onClick={() => setIsExpanded((currentValue) => !currentValue)}
        >
          {isExpanded ? "Replier" : "Voir plus"}
          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </div>

      {isExpanded ? (
        <div className="mt-4 space-y-3 rounded-lg border border-white/80 bg-white/80 p-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">Cause detectee</p>
            <p className="mt-1 text-sm leading-6 text-[#334155]">{cause || description}</p>
          </div>
          {hasActions ? (
            <div className="flex flex-wrap gap-2 pt-1">
              {onApply ? (
                <Button type="button" variant="success" className="rounded-xl" onClick={onApply}>
                  <CheckCircle2 className="h-4 w-4" />
                  Appliquer
                </Button>
              ) : null}
              {onSimulate ? (
                <Button type="button" variant="outline" className="rounded-xl" onClick={onSimulate}>
                  <PlayCircle className="h-4 w-4" />
                  Simuler
                </Button>
              ) : null}
              {onIgnore ? (
                <Button type="button" variant="outline" className="rounded-xl" onClick={onIgnore}>
                  <XCircle className="h-4 w-4" />
                  Ignorer
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
