const FILTER_PANEL_TOGGLE_EVENT = "fleetconnect:toggle-filters";

export function toggleFilterPanel(): void {
  window.dispatchEvent(new Event(FILTER_PANEL_TOGGLE_EVENT));
}

export function subscribeToFilterPanelToggle(listener: () => void): () => void {
  window.addEventListener(FILTER_PANEL_TOGGLE_EVENT, listener);

  return () => {
    window.removeEventListener(FILTER_PANEL_TOGGLE_EVENT, listener);
  };
}
