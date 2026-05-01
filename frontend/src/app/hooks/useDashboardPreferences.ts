import { useEffect, useMemo, useState } from "react";

export interface DashboardWidgetDefinition {
  id: string;
  label: string;
  description?: string;
  defaultVisible?: boolean;
}

export type DashboardWidgetVisibility = Record<string, boolean>;

const STORAGE_PREFIX = "fleetconnect.dashboard-preferences";

function buildDefaultVisibility(widgets: DashboardWidgetDefinition[]): DashboardWidgetVisibility {
  return widgets.reduce<DashboardWidgetVisibility>((visibility, widget) => {
    visibility[widget.id] = widget.defaultVisible ?? true;
    return visibility;
  }, {});
}

function readStoredVisibility(
  storageKey: string,
  widgets: DashboardWidgetDefinition[],
): DashboardWidgetVisibility {
  const defaultVisibility = buildDefaultVisibility(widgets);

  if (typeof window === "undefined") {
    return defaultVisibility;
  }

  const rawValue = window.localStorage.getItem(storageKey);
  if (!rawValue) {
    return defaultVisibility;
  }

  try {
    const storedVisibility = JSON.parse(rawValue) as DashboardWidgetVisibility;
    return widgets.reduce<DashboardWidgetVisibility>((visibility, widget) => {
      const storedValue = storedVisibility[widget.id];
      visibility[widget.id] = typeof storedValue === "boolean"
        ? storedValue
        : (widget.defaultVisible ?? true);
      return visibility;
    }, {});
  } catch {
    return defaultVisibility;
  }
}

function writeStoredVisibility(storageKey: string, visibility: DashboardWidgetVisibility): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(storageKey, JSON.stringify(visibility));
}

export function useDashboardPreferences(
  dashboardId: string,
  widgets: DashboardWidgetDefinition[],
  userScope = "anonymous",
) {
  const storageKey = useMemo(
    () => `${STORAGE_PREFIX}.${userScope}.${dashboardId}`,
    [dashboardId, userScope],
  );
  const [visibility, setVisibility] = useState<DashboardWidgetVisibility>(() =>
    readStoredVisibility(storageKey, widgets),
  );

  useEffect(() => {
    setVisibility(readStoredVisibility(storageKey, widgets));
  }, [storageKey, widgets]);

  const visibleCount = useMemo(
    () => widgets.filter((widget) => visibility[widget.id] ?? (widget.defaultVisible ?? true)).length,
    [visibility, widgets],
  );

  function setWidgetVisible(widgetId: string, isVisible: boolean): void {
    setVisibility((currentVisibility) => {
      const nextVisibility = {
        ...currentVisibility,
        [widgetId]: isVisible,
      };
      writeStoredVisibility(storageKey, nextVisibility);
      return nextVisibility;
    });
  }

  function isWidgetVisible(widgetId: string): boolean {
    const widget = widgets.find((item) => item.id === widgetId);
    return visibility[widgetId] ?? widget?.defaultVisible ?? true;
  }

  function resetVisibility(): void {
    const defaultVisibility = buildDefaultVisibility(widgets);
    setVisibility(defaultVisibility);
    writeStoredVisibility(storageKey, defaultVisibility);
  }

  return {
    isWidgetVisible,
    resetVisibility,
    setWidgetVisible,
    visibleCount,
    visibility,
  };
}
