import { useState } from "react";
import { ChevronDown, ChevronUp, Eye, EyeOff, RotateCcw, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";

import type {
  DashboardWidgetDefinition,
  DashboardWidgetVisibility,
} from "../../hooks/useDashboardPreferences";

interface WidgetVisibilityManagerProps {
  title?: string;
  description?: string;
  resetLabel?: string;
  widgets: DashboardWidgetDefinition[];
  visibility: DashboardWidgetVisibility;
  visibleCount: number;
  onChange: (widgetId: string, isVisible: boolean) => void;
  onReset: () => void;
}

export default function WidgetVisibilityManager({
  title = "Personnaliser le dashboard",
  description = "Choisissez les indicateurs, graphiques et blocs d'analyse a afficher.",
  resetLabel = "Vue complete",
  widgets,
  visibility,
  visibleCount,
  onChange,
  onReset,
}: WidgetVisibilityManagerProps) {
  const [isOpen, setIsOpen] = useState(false);

  function handleReset(): void {
    onReset();
    toast.success("Vue par defaut restauree", {
      description: "Tous les widgets disponibles sont de nouveau affiches.",
    });
  }

  return (
    <section className="rounded-2xl border border-[var(--bc-neutral-border)] bg-[var(--card)] p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-[var(--bc-primary-soft)] p-3 text-[var(--bc-primary)]">
            <SlidersHorizontal className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-[var(--bc-neutral-strong)]">{title}</h2>
            <p className="mt-1 text-sm leading-6 text-[var(--bc-neutral-body)]">{description}</p>
            <p className="mt-1 text-xs font-medium uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
              {visibleCount} / {widgets.length} widgets visibles
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--bc-neutral-border)] px-3 py-2 text-sm font-medium text-[var(--bc-neutral-body)] transition-colors hover:bg-[var(--bc-neutral-soft)]"
          >
            <RotateCcw className="h-4 w-4" />
            <span>{resetLabel}</span>
          </button>
          <button
            type="button"
            onClick={() => setIsOpen((currentValue) => !currentValue)}
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--bc-primary)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--bc-primary-hover)]"
          >
            <span>{isOpen ? "Fermer" : "Configurer l'affichage"}</span>
            {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {isOpen ? (
        <div className="mt-4 grid gap-3 border-t border-[var(--bc-neutral-border)] pt-4 md:grid-cols-2 xl:grid-cols-3">
          {widgets.map((widget) => {
            const isVisible = visibility[widget.id] ?? (widget.defaultVisible ?? true);
            const Icon = isVisible ? Eye : EyeOff;

            return (
              <label
                key={widget.id}
                className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition-colors ${
                  isVisible
                    ? "border-[var(--bc-primary-border)] bg-[var(--bc-primary-soft)]"
                    : "border-[var(--bc-neutral-border)] bg-[var(--bc-neutral-soft)] opacity-90"
                }`}
              >
                <input
                  type="checkbox"
                  checked={isVisible}
                  onChange={(event) => onChange(widget.id, event.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-gray-300"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Icon
                      className={`h-4 w-4 ${isVisible ? "text-[var(--bc-primary)]" : "text-[var(--bc-neutral-muted)]"}`}
                    />
                    <span className="text-sm font-semibold text-[var(--bc-neutral-strong)]">
                      {widget.label}
                    </span>
                  </div>
                  {widget.description ? (
                    <p className="mt-1 text-xs leading-5 text-[var(--bc-neutral-body)]">
                      {widget.description}
                    </p>
                  ) : null}
                </div>
              </label>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
