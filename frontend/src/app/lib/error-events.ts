export const API_ERROR_EVENT = "fleetconnect:api-error";

export interface ApiErrorEventDetail {
  title: string;
  message: string;
  status: number;
  code: string | null;
  level: "error" | "warning";
}

let lastEventKey = "";
let lastEventTimestamp = 0;

export function emitApiErrorEvent(detail: ApiErrorEventDetail): void {
  if (typeof window === "undefined") {
    return;
  }

  const nextKey = `${detail.level}:${detail.status}:${detail.code ?? ""}:${detail.message}`;
  const now = Date.now();
  if (nextKey === lastEventKey && now - lastEventTimestamp < 3000) {
    return;
  }

  lastEventKey = nextKey;
  lastEventTimestamp = now;
  window.dispatchEvent(new CustomEvent<ApiErrorEventDetail>(API_ERROR_EVENT, { detail }));
}

export function subscribeToApiErrorEvents(
  listener: (detail: ApiErrorEventDetail) => void,
): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handleEvent = (event: Event) => {
    const customEvent = event as CustomEvent<ApiErrorEventDetail>;
    listener(customEvent.detail);
  };

  window.addEventListener(API_ERROR_EVENT, handleEvent);
  return () => {
    window.removeEventListener(API_ERROR_EVENT, handleEvent);
  };
}
