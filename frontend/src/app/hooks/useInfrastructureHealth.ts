import { useEffect, useRef } from "react";

import { ApiError, healthApi, type ApiHealthResponse } from "../lib/api";

const ENABLE_INFRA_DEBUG_LOGS = import.meta.env.DEV;

function logHealthCheck(payload: ApiHealthResponse): void {
  if (!ENABLE_INFRA_DEBUG_LOGS) {
    return;
  }
  console.info("[infra] API_CONNECTED", {
    endpoint: "/api/v1/health",
    status: payload.status,
  });
  console.info("[infra] BACKEND_ONLINE", payload.checks.backend);

  if (payload.checks.database.status === "ok") {
    console.info("[infra] POSTGRES_CONNECTED", payload.checks.database);
  } else {
    console.warn("[infra] POSTGRES_CONNECTED", payload.checks.database);
  }

  if (payload.checks.ollama.status === "ok") {
    console.info("[infra] OLLAMA_CONNECTED", payload.checks.ollama);
  } else {
    console.warn("[infra] OLLAMA_CONNECTED", payload.checks.ollama);
  }

  if (payload.checks.csv.status === "ok") {
    console.info("[infra] CSV_LOADED", payload.checks.csv);
  } else {
    console.warn("[infra] CSV_LOADED", payload.checks.csv);
  }

  if (payload.checks.websocket.status === "ok") {
    console.info("[infra] WEBSOCKET_CONNECTED", payload.checks.websocket);
  } else {
    console.warn("[infra] WEBSOCKET_CONNECTED", payload.checks.websocket);
  }
}

export function useInfrastructureHealth(pollIntervalMs = 60_000): void {
  const lastSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    let timerId: number | null = null;

    const scheduleNextPoll = () => {
      timerId = window.setTimeout(() => {
        void pollHealth();
      }, pollIntervalMs);
    };

    const pollHealth = async () => {
      try {
        const payload = await healthApi.get();

        if (!active) {
          return;
        }

        const signature = JSON.stringify({
          status: payload.status,
          checks: payload.checks,
        });

        if (signature !== lastSignatureRef.current) {
          lastSignatureRef.current = signature;
          if (ENABLE_INFRA_DEBUG_LOGS) {
            logHealthCheck(payload);
          }
        }
      } catch (error) {
        if (!active) {
          return;
        }

        const message =
          error instanceof ApiError || error instanceof Error
            ? error.message
            : "Health check indisponible.";
        const signature = `offline:${message}`;

        if (signature !== lastSignatureRef.current) {
          lastSignatureRef.current = signature;
          if (ENABLE_INFRA_DEBUG_LOGS) {
            console.error("[infra] BACKEND_OFFLINE", {
              endpoint: "/api/v1/health",
              message,
            });
          }
        }
      } finally {
        if (active) {
          scheduleNextPoll();
        }
      }
    };

    void pollHealth();

    return () => {
      active = false;
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
    };
  }, [pollIntervalMs]);
}
