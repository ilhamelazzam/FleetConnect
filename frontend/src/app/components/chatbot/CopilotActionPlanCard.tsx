import {
  ArrowUpRight,
  Check,
  Clock3,
  Download,
  Filter,
  LoaderCircle,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";

import type { ApiChatActionPlanItem, ApiChatActionPlanResponse } from "../../lib/api";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { cn } from "../ui/utils";

type ActionStatus = "todo" | "in_progress" | "done";
type ActionFilter = "all" | "cost" | "fraud" | "equipment" | "workflow" | "consumption";

interface CopilotActionPlanCardProps {
  plan: ApiChatActionPlanResponse;
  isRefreshing?: boolean;
  onRefresh: () => void;
  onViewDetails: (action: ApiChatActionPlanItem) => void;
  onApplyRecommendation: (action: ApiChatActionPlanItem) => void;
}

function formatConversationDate(value: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatRiskLevelLabel(value: "low" | "medium" | "high" | "critical" | null | undefined): string {
  if (value === "critical") {
    return "Critique";
  }
  if (value === "high") {
    return "Elevee";
  }
  if (value === "medium") {
    return "Moyenne";
  }
  return "Faible";
}

function formatActionTypeLabel(value: ActionFilter): string {
  if (value === "cost") {
    return "Cout";
  }
  if (value === "fraud") {
    return "Fraude";
  }
  if (value === "equipment") {
    return "Equipement";
  }
  if (value === "workflow") {
    return "Workflow";
  }
  if (value === "consumption") {
    return "Consommation";
  }
  return "Tous";
}

function formatActionStatusLabel(value: ActionStatus): string {
  if (value === "done") {
    return "Termine";
  }
  if (value === "in_progress") {
    return "En cours";
  }
  return "A faire";
}

function getPriorityBadgeClass(priority: "low" | "medium" | "high" | "critical"): string {
  if (priority === "critical") {
    return "border-[#F87171]/40 bg-[#FEE2E2] text-[#B91C1C] dark:border-[#EF4444]/30 dark:bg-[#3A0D12] dark:text-[#FCA5A5]";
  }
  if (priority === "high") {
    return "border-[#FB923C]/40 bg-[#FFEDD5] text-[#C2410C] dark:border-[#F97316]/30 dark:bg-[#3A1A0C] dark:text-[#FDBA74]";
  }
  if (priority === "medium") {
    return "border-[#FACC15]/40 bg-[#FEF9C3] text-[#A16207] dark:border-[#EAB308]/30 dark:bg-[#332A08] dark:text-[#FDE047]";
  }
  return "border-[#4ADE80]/40 bg-[#DCFCE7] text-[#15803D] dark:border-[#22C55E]/30 dark:bg-[#0D2A16] dark:text-[#86EFAC]";
}

function getStatusBadgeClass(status: ActionStatus): string {
  if (status === "done") {
    return "border-[#22C55E]/30 bg-[#DCFCE7] text-[#166534] dark:border-[#16A34A]/30 dark:bg-[#0D2A16] dark:text-[#86EFAC]";
  }
  if (status === "in_progress") {
    return "border-[#60A5FA]/30 bg-[#DBEAFE] text-[#1D4ED8] dark:border-[#3B82F6]/30 dark:bg-[#0B1730] dark:text-[#93C5FD]";
  }
  return "border-[var(--bc-neutral-border)] bg-white/80 text-[var(--bc-neutral-body)] dark:bg-[#08101f]";
}

function getActionKey(action: ApiChatActionPlanItem, index: number): string {
  return `${action.day}:${action.title}:${index}`;
}

function downloadActionPlan(plan: ApiChatActionPlanResponse, actions: ApiChatActionPlanItem[]): void {
  const header = ["title", "priority", "type", "status", "deadline", "reason", "impact"];
  const rows = [
    header.join(","),
    ...actions.map((action) =>
      [
        action.title,
        action.priority,
        action.type,
        action.status,
        action.deadline,
        action.reason,
        action.impact,
      ]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(","),
    ),
  ];

  const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `plan-action-ia-${plan.summary_updated_at.slice(0, 10)}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export default function CopilotActionPlanCard({
  plan,
  isRefreshing = false,
  onRefresh,
  onViewDetails,
  onApplyRecommendation,
}: CopilotActionPlanCardProps) {
  const baseActions = plan.weekly_actions.length > 0 ? plan.weekly_actions : plan.actions;
  const [selectedFilter, setSelectedFilter] = useState<ActionFilter>("all");
  const [statusOverrides, setStatusOverrides] = useState<Record<string, ActionStatus>>({});

  useEffect(() => {
    setSelectedFilter("all");
    setStatusOverrides({});
  }, [plan.summary_updated_at]);

  const hydratedActions = baseActions.map((action, index) => {
    const key = getActionKey(action, index);
    return {
      ...action,
      status: statusOverrides[key] ?? action.status,
      _key: key,
    };
  });

  const availableFilters = Array.from(
    new Set<ActionFilter>(["all", ...hydratedActions.map((action) => action.type)]),
  );
  const filteredActions = hydratedActions.filter((action) =>
    selectedFilter === "all" ? true : action.type === selectedFilter,
  );
  const criticalCount = hydratedActions.filter((action) => action.priority === "critical").length;
  const highCount = hydratedActions.filter((action) => action.priority === "high").length;
  const doneCount = hydratedActions.filter((action) => action.status === "done").length;

  return (
    <div className="mt-4 overflow-hidden rounded-[26px] border border-[var(--bc-primary-border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(241,245,249,0.92))] shadow-[0_24px_46px_-30px_rgba(15,23,42,0.42)] dark:bg-[linear-gradient(180deg,rgba(8,16,31,0.96),rgba(8,16,31,0.9))]">
      <div className="border-b border-[var(--bc-primary-border)] bg-[linear-gradient(135deg,rgba(37,99,235,0.1),rgba(14,165,233,0.08))] px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="border border-[var(--bc-primary-border)] bg-white/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--bc-primary)] dark:bg-[#08101f]">
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                Plan d'action IA
              </Badge>
              {typeof plan.fleet_health_score === "number" ? (
                <Badge variant="outline" className="bg-white/70 text-[11px] dark:bg-[#08101f]">
                  Fleet Health {plan.fleet_health_score}/100
                </Badge>
              ) : null}
              {plan.global_risk ? (
                <Badge variant="outline" className={cn("text-[11px]", getPriorityBadgeClass(plan.global_risk))}>
                  Risque {formatRiskLevelLabel(plan.global_risk)}
                </Badge>
              ) : null}
              {plan.trend ? (
                <Badge variant="outline" className="bg-white/70 text-[11px] dark:bg-[#08101f]">
                  Tendance {plan.trend === "improving" ? "amelioree" : plan.trend === "declining" ? "en baisse" : "stable"}
                </Badge>
              ) : null}
            </div>
            <h3 className="mt-3 text-lg font-semibold text-[var(--bc-neutral-body)]">{plan.plan_title}</h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--bc-neutral-body)]">{plan.subtitle}</p>
            <p className="mt-3 text-sm leading-6 text-[var(--bc-neutral-muted)]">{plan.answer}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onRefresh}
              disabled={isRefreshing}
              className="rounded-full bg-white/80 dark:bg-[#08101f]"
            >
              {isRefreshing ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Clock3 className="mr-2 h-4 w-4" />}
              Actualiser
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => downloadActionPlan(plan, hydratedActions)}
              className="rounded-full bg-white/80 dark:bg-[#08101f]"
            >
              <Download className="mr-2 h-4 w-4" />
              Exporter plan d'action
            </Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Badge variant="outline" className="bg-white/70 text-[11px] dark:bg-[#08101f]">
            {criticalCount} critique(s)
          </Badge>
          <Badge variant="outline" className="bg-white/70 text-[11px] dark:bg-[#08101f]">
            {highCount} elevee(s)
          </Badge>
          <Badge variant="outline" className="bg-white/70 text-[11px] dark:bg-[#08101f]">
            {doneCount} terminee(s)
          </Badge>
          <Badge variant="outline" className="bg-white/70 text-[11px] dark:bg-[#08101f]">
            {hydratedActions.length} action(s)
          </Badge>
        </div>
      </div>

      <div className="px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-[var(--bc-neutral-border)] bg-white/80 px-3 py-1.5 text-[11px] font-semibold text-[var(--bc-neutral-body)] dark:bg-[#08101f]">
            <Filter className="h-3.5 w-3.5" />
            Filtrer par type
          </div>
          {availableFilters.map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => setSelectedFilter(filter)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors",
                selectedFilter === filter
                  ? "border-[var(--bc-primary-border)] bg-[var(--bc-primary)] text-white"
                  : "border-[var(--bc-neutral-border)] bg-white/80 text-[var(--bc-neutral-body)] hover:bg-[var(--bc-neutral-soft)] dark:bg-[#08101f]",
              )}
            >
              {formatActionTypeLabel(filter)}
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-3 xl:grid-cols-2">
          {filteredActions.map((action) => (
            <article
              key={action._key}
              className="rounded-[22px] border border-[var(--bc-neutral-border)] bg-white/85 p-4 shadow-[0_16px_32px_-26px_rgba(15,23,42,0.28)] dark:bg-[#08101f]/85"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={cn("text-[10px]", getPriorityBadgeClass(action.priority))}>
                  {formatRiskLevelLabel(action.priority)}
                </Badge>
                <Badge variant="outline" className="bg-white/70 text-[10px] dark:bg-[#020817]">
                  {formatActionTypeLabel(action.type)}
                </Badge>
                <Badge variant="outline" className={cn("text-[10px]", getStatusBadgeClass(action.status))}>
                  {formatActionStatusLabel(action.status)}
                </Badge>
                <Badge variant="outline" className="bg-white/70 text-[10px] dark:bg-[#020817]">
                  {action.deadline}
                </Badge>
              </div>

              <div className="mt-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--bc-neutral-muted)]">
                  {action.day}
                </p>
                <h4 className="mt-1 text-base font-semibold text-[var(--bc-neutral-body)]">{action.title}</h4>
                <p className="mt-2 text-sm leading-6 text-[var(--bc-neutral-muted)]">{action.detail}</p>
              </div>

              <div className="mt-4 space-y-2 rounded-2xl border border-[var(--bc-neutral-border)] bg-[var(--bg-card)]/80 p-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--bc-neutral-muted)]">
                    Pourquoi
                  </p>
                  <p className="mt-1 text-sm text-[var(--bc-neutral-body)]">{action.reason}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--bc-neutral-muted)]">
                    Impact estime
                  </p>
                  <p className="mt-1 text-sm text-[var(--bc-neutral-body)]">{action.impact}</p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setStatusOverrides((currentValue) => ({
                      ...currentValue,
                      [action._key]: action.status === "done" ? "in_progress" : "done",
                    }));
                  }}
                  className="rounded-full"
                >
                  <Check className="mr-2 h-3.5 w-3.5" />
                  {action.status === "done" ? "Remettre en cours" : "Marquer comme fait"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => onViewDetails(action)}
                  className="rounded-full"
                >
                  <Clock3 className="mr-2 h-3.5 w-3.5" />
                  Voir details
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => onApplyRecommendation(action)}
                  className="rounded-full"
                >
                  <ArrowUpRight className="mr-2 h-3.5 w-3.5" />
                  Appliquer recommandation
                </Button>
              </div>
            </article>
          ))}
        </div>

        {filteredActions.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-[var(--bc-neutral-border)] px-4 py-6 text-center text-sm text-[var(--bc-neutral-muted)]">
            Aucune action disponible pour ce filtre.
          </div>
        ) : null}

        {plan.recommendations.length > 0 ? (
          <div className="mt-5 rounded-2xl border border-[var(--bc-neutral-border)] bg-[var(--bg-card)]/70 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--bc-neutral-muted)]">
              Recommandations rapides
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {plan.recommendations.slice(0, 6).map((recommendation, index) => (
                <Badge key={`${recommendation}-${index}`} variant="outline" className="max-w-full bg-white/70 px-3 py-1 text-[11px] text-[var(--bc-neutral-body)] dark:bg-[#08101f]">
                  {recommendation}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}

        <p className="mt-4 text-[11px] text-[var(--bc-neutral-muted)]">
          Sources: {plan.sources.join(", ")} • Mise a jour: {formatConversationDate(plan.summary_updated_at)}
        </p>
      </div>
    </div>
  );
}
