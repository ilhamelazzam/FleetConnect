const FILTER_PANEL_TOGGLE_EVENT = "fleetconnect:toggle-filters";
const FILTER_PANEL_STATE_EVENT = "fleetconnect:filter-panel-state";

export interface FilterPanelState {
  activeCount: number;
  isOpen: boolean;
}

export function toggleFilterPanel(): void {
  window.dispatchEvent(new Event(FILTER_PANEL_TOGGLE_EVENT));
}

export function publishFilterPanelState(state: FilterPanelState): void {
  window.dispatchEvent(new CustomEvent(FILTER_PANEL_STATE_EVENT, { detail: state }));
}

export function subscribeToFilterPanelToggle(listener: () => void): () => void {
  window.addEventListener(FILTER_PANEL_TOGGLE_EVENT, listener);

  return () => {
    window.removeEventListener(FILTER_PANEL_TOGGLE_EVENT, listener);
  };
}

export function subscribeToFilterPanelState(listener: (state: FilterPanelState) => void): () => void {
  const eventHandler = (event: Event) => {
    const customEvent = event as CustomEvent<FilterPanelState>;
    if (customEvent.detail) {
      listener(customEvent.detail);
    }
  };

  window.addEventListener(FILTER_PANEL_STATE_EVENT, eventHandler);

  return () => {
    window.removeEventListener(FILTER_PANEL_STATE_EVENT, eventHandler);
  };
}
