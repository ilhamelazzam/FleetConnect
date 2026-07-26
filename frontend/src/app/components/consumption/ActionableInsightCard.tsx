import { ArrowRight, Brain, Sparkles, type LucideIcon } from "lucide-react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { cn } from "../ui/utils";

type InsightTone = "critical" | "warning" | "positive";
type InsightImpact = "Faible" | "Moyen" | "Eleve";

interface ActionableInsightCardProps {
  title: string;
  headline: string;
  detail: string;
  recommendation: string;
  estimatedGainLabel: string;
  impact: InsightImpact;
  score: number;
  badge: string;
  tone: InsightTone;
  filterLabel: string;
  icon?: LucideIcon;
  primaryLabel?: string;
  secondaryLabel?: string;
  onPrimaryAction?: () => void;
  onSecondaryAction?: () => void;
}

function getToneClasses(tone: InsightTone): {
  container: string;
  badge: string;
  icon: string;
  accent: string;
  metric: string;
  primaryVariant: "destructive" | "default" | "success";
} {
  if (tone === "critical") {
    return {
      container: "bc-surface-danger",
      badge: "border-[var(--bc-danger-border)] bg-[var(--bc-danger-soft)] text-[var(--bc-danger)]",
      icon: "bc-icon-danger",
      accent: "text-[var(--bc-danger-hover)]",
      metric: "border-[var(--bc-neutral-border)] bg-[var(--card)]",
      primaryVariant: "destructive",
    };
  }

  if (tone === "warning") {
    return {
      container: "bc-surface-warning",
      badge: "border-[var(--bc-warning-border)] bg-[var(--bc-warning-soft)] text-[var(--bc-warning)]",
      icon: "bc-icon-warning",
      accent: "text-[var(--bc-warning-hover)]",
      metric: "border-[var(--bc-neutral-border)] bg-[var(--card)]",
      primaryVariant: "default",
    };
  }

  return {
    container: "bc-surface-success",
    badge: "border-[var(--bc-success-border)] bg-[var(--bc-success-soft)] text-[var(--bc-success)]",
    icon: "bc-icon-success",
    accent: "text-[var(--bc-success-hover)]",
    metric: "border-[var(--bc-neutral-border)] bg-[var(--card)]",
    primaryVariant: "success",
  };
}

function getImpactClasses(impact: InsightImpact): string {
  if (impact === "Eleve") {
    return "border-[var(--bc-danger-border)] bg-[var(--bc-danger-soft)] text-[var(--bc-danger)]";
  }

  if (impact === "Moyen") {
    return "border-[var(--bc-warning-border)] bg-[var(--bc-warning-soft)] text-[var(--bc-warning)]";
  }

  return "border-[var(--bc-success-border)] bg-[var(--bc-success-soft)] text-[var(--bc-success)]";
}

export default function ActionableInsightCard({
  title,
  headline,
  detail,
  recommendation,
  estimatedGainLabel,
  impact,
  score,
  badge,
  tone,
  filterLabel,
  icon: Icon = Sparkles,
  primaryLabel = "Appliquer cette recommandation",
  secondaryLabel = "Isoler la zone",
  onPrimaryAction,
  onSecondaryAction,
}: ActionableInsightCardProps) {
  const styles = getToneClasses(tone);

  return (
    <article
      className={cn(
        "flex h-full flex-col rounded-[26px] border p-5 shadow-[0_18px_40px_rgba(15,23,42,0.06)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_22px_48px_rgba(15,23,42,0.1)]",
        styles.container,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className={cn("rounded-2xl p-3", styles.icon)}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--bc-neutral-muted)]">{title}</p>
            <h3 className="mt-2 text-lg font-semibold leading-7 text-[var(--bc-neutral-strong)]">{headline}</h3>
          </div>
        </div>
        <Badge className={styles.badge}>{badge}</Badge>
      </div>

      <p className="mt-4 text-sm leading-6 text-[var(--bc-neutral-body)]">{detail}</p>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className={cn("rounded-2xl border px-4 py-3", styles.metric)}>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--bc-neutral-muted)]">Gain estime</p>
          <p className={cn("mt-2 text-sm font-semibold", styles.accent)}>{estimatedGainLabel}</p>
        </div>
        <div className={cn("rounded-2xl border px-4 py-3", styles.metric)}>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--bc-neutral-muted)]">Impact</p>
          <div className="mt-2">
            <Badge className={getImpactClasses(impact)}>{impact}</Badge>
          </div>
        </div>
        <div className={cn("rounded-2xl border px-4 py-3", styles.metric)}>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--bc-neutral-muted)]">Score estime</p>
          <div className="mt-2 inline-flex items-center gap-2">
            <Brain className="h-4 w-4 text-[var(--bc-ai-start)]" />
            <span className="text-sm font-semibold text-[var(--bc-neutral-strong)]">{score}/100</span>
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-[var(--bc-ai-border)] bg-[linear-gradient(135deg,rgba(99,102,241,0.08),rgba(139,92,246,0.06),var(--bg-card))] p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--bc-ai-start)]">Suggestion</p>
        <p className="mt-2 text-sm font-medium leading-6 text-[var(--bc-neutral-strong)]">{recommendation}</p>
      </div>

      <div className="mt-5 flex flex-1 items-end">
        <div className="flex w-full flex-wrap gap-3">
          {onPrimaryAction ? (
            <Button
              type="button"
              variant={styles.primaryVariant}
              className="rounded-2xl px-4 py-2.5 text-sm font-semibold"
              onClick={onPrimaryAction}
            >
              <Sparkles className="h-4 w-4" />
              {primaryLabel}
            </Button>
          ) : null}
          {onSecondaryAction ? (
            <Button
              type="button"
              variant="outline"
              className="rounded-2xl px-4 py-2.5 text-sm font-semibold"
              onClick={onSecondaryAction}
            >
              <ArrowRight className="h-4 w-4" />
              {secondaryLabel}: {filterLabel}
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  );
}
