import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  ApiError,
  liveMonitoringApi,
  type ApiLiveAlert,
  type ApiLiveMonitoringSnapshot,
  type ApiLiveMonitoringStatus,
} from "../lib/api";

type LiveConnectionState = "idle" | "connecting" | "connected" | "reconnecting" | "error";

const LIVE_ENABLED_STORAGE_KEY = "fleetconnect.live-monitoring.enabled";
const LIVE_SOUND_STORAGE_KEY = "fleetconnect.live-monitoring.sound-enabled";
const ENABLE_INFRA_DEBUG_LOGS = import.meta.env.DEV;

function readStoredBoolean(storageKey: string, fallbackValue: boolean): boolean {
  if (typeof window === "undefined") {
    return fallbackValue;
  }

  const storedValue = window.localStorage.getItem(storageKey);
  if (storedValue === "true") {
    return true;
  }
  if (storedValue === "false") {
    return false;
  }
  return fallbackValue;
}

function writeStoredBoolean(storageKey: string, nextValue: boolean): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(storageKey, nextValue ? "true" : "false");
}

function normalizeError(error: unknown, fallbackMessage: string): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallbackMessage;
}

function playAlertTone(severity: ApiLiveAlert["severity"]): void {
  if (typeof window === "undefined") {
    return;
  }

  const AudioContextConstructor =
    window.AudioContext ||
    (
      window as Window &
        typeof globalThis & {
          webkitAudioContext?: typeof AudioContext;
        }
    ).webkitAudioContext;

  if (!AudioContextConstructor) {
    return;
  }

  const audioContext = new AudioContextConstructor();
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  const duration = severity === "critical" ? 0.36 : severity === "high" ? 0.28 : 0.22;

  oscillator.type = severity === "critical" ? "sawtooth" : "triangle";
  oscillator.frequency.setValueAtTime(severity === "critical" ? 960 : severity === "high" ? 820 : 700, audioContext.currentTime);
  gainNode.gain.setValueAtTime(0.0001, audioContext.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.08, audioContext.currentTime + 0.02);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + duration);

  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + duration);

  window.setTimeout(() => {
    void audioContext.close().catch(() => {
      // Ignore browser audio context shutdown errors.
    });
  }, Math.ceil(duration * 1000) + 80);
}

interface UseLiveMonitoringResult {
  isEnabled: boolean;
  setEnabled: (enabled: boolean) => void;
  soundEnabled: boolean;
  setSoundEnabled: (enabled: boolean) => void;
  connectionState: LiveConnectionState;
  status: ApiLiveMonitoringStatus | null;
  snapshot: ApiLiveMonitoringSnapshot | null;
  errorMessage: string | null;
  refreshNow: () => Promise<void>;
}

export function useLiveMonitoring(token: string | null): UseLiveMonitoringResult {
  const [isEnabled, setIsEnabled] = useState<boolean>(() =>
    readStoredBoolean(LIVE_ENABLED_STORAGE_KEY, false),
  );
  const [soundEnabled, setSoundEnabledState] = useState<boolean>(() =>
    readStoredBoolean(LIVE_SOUND_STORAGE_KEY, false),
  );
  const [connectionState, setConnectionState] = useState<LiveConnectionState>("idle");
  const [status, setStatus] = useState<ApiLiveMonitoringStatus | null>(null);
  const [snapshot, setSnapshot] = useState<ApiLiveMonitoringSnapshot | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const heartbeatTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const shouldReconnectRef = useRef(false);
  const seenAlertIdsRef = useRef<Set<string>>(new Set());

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const clearHeartbeatTimer = useCallback(() => {
    if (heartbeatTimerRef.current !== null) {
      window.clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  const closeSocket = useCallback(() => {
    clearHeartbeatTimer();
    if (socketRef.current) {
      socketRef.current.onopen = null;
      socketRef.current.onclose = null;
      socketRef.current.onerror = null;
      socketRef.current.onmessage = null;
      socketRef.current.close();
      socketRef.current = null;
    }
  }, [clearHeartbeatTimer]);

  const setEnabled = useCallback((enabled: boolean) => {
    writeStoredBoolean(LIVE_ENABLED_STORAGE_KEY, enabled);
    setIsEnabled(enabled);
  }, []);

  const setSoundEnabled = useCallback((enabled: boolean) => {
    writeStoredBoolean(LIVE_SOUND_STORAGE_KEY, enabled);
    setSoundEnabledState(enabled);
  }, []);

  const pushLiveAlerts = useCallback(
    (alerts: ApiLiveAlert[]) => {
      alerts.forEach((alert) => {
        if (seenAlertIdsRef.current.has(alert.alert_id)) {
          return;
        }

        if (seenAlertIdsRef.current.size > 200) {
          seenAlertIdsRef.current.clear();
        }
        seenAlertIdsRef.current.add(alert.alert_id);

        const toastTitle =
          alert.severity === "critical"
            ? `Alerte critique live: ${alert.title}`
            : alert.severity === "high"
              ? `Alerte elevee live: ${alert.title}`
              : `Signal live: ${alert.title}`;

        toast(alert.severity === "critical" ? toastTitle : toastTitle, {
          description: `${alert.message} ${alert.recommendation}`,
        });

        if (soundEnabled && (alert.severity === "critical" || alert.severity === "high")) {
          playAlertTone(alert.severity);
        }
      });
    },
    [soundEnabled],
  );

  const refreshNow = useCallback(async () => {
    if (!token) {
      setStatus(null);
      setSnapshot(null);
      setConnectionState("idle");
      setErrorMessage("Flux temps reel indisponible.");
      return;
    }

    try {
      const [nextStatus, nextSnapshot] = await Promise.all([
        liveMonitoringApi.status(token),
        liveMonitoringApi.kpis(token),
      ]);
      setStatus(nextStatus);
      setSnapshot(nextSnapshot);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(normalizeError(error, "Flux temps reel indisponible."));
      throw error;
    }
  }, [token]);

  const connectStream = useCallback(async () => {
    if (!token) {
      setConnectionState("error");
      setErrorMessage("Flux temps reel indisponible.");
      return;
    }

    clearReconnectTimer();
    closeSocket();
    setConnectionState(reconnectAttemptRef.current > 0 ? "reconnecting" : "connecting");

    try {
      await refreshNow();
    } catch {
      setConnectionState("error");
    }

    try {
      const nextSocket = new WebSocket(liveMonitoringApi.buildStreamUrl(token));
      socketRef.current = nextSocket;

      nextSocket.onopen = () => {
        reconnectAttemptRef.current = 0;
        setConnectionState("connected");
        setErrorMessage(null);
        if (ENABLE_INFRA_DEBUG_LOGS) {
          console.info("[infra] WEBSOCKET_CONNECTED", {
            endpoint: "/api/v1/live/stream",
          });
        }
        clearHeartbeatTimer();
        heartbeatTimerRef.current = window.setInterval(() => {
          try {
            nextSocket.send("status");
          } catch {
            // Ignore browser send errors during heartbeat.
          }
        }, 18_000);
      };

      nextSocket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as {
            type?: string;
            payload?: unknown;
          };

          if (message.type === "status" && message.payload) {
            setStatus(message.payload as ApiLiveMonitoringStatus);
            return;
          }

          if (message.type === "snapshot" && message.payload) {
            setSnapshot(message.payload as ApiLiveMonitoringSnapshot);
            return;
          }

          if (message.type === "alerts" && Array.isArray(message.payload)) {
            pushLiveAlerts(message.payload as ApiLiveAlert[]);
          }
        } catch {
          setErrorMessage("Flux temps reel indisponible.");
        }
      };

      nextSocket.onerror = () => {
        setConnectionState("error");
        setErrorMessage("Flux temps reel indisponible.");
      };

      nextSocket.onclose = () => {
        clearHeartbeatTimer();
        socketRef.current = null;
        if (!shouldReconnectRef.current) {
          setConnectionState("idle");
          return;
        }

        reconnectAttemptRef.current += 1;
        setConnectionState("reconnecting");
        setErrorMessage("Connexion live interrompue. Reconnexion surveillance...");
        if (ENABLE_INFRA_DEBUG_LOGS) {
          console.warn("[infra] WEBSOCKET_RECONNECT", {
            endpoint: "/api/v1/live/stream",
            attempt: reconnectAttemptRef.current,
          });
        }
        clearReconnectTimer();
        reconnectTimerRef.current = window.setTimeout(() => {
          void connectStream();
        }, Math.min(7000, 1500 + reconnectAttemptRef.current * 900));
      };
    } catch (error) {
      setConnectionState("error");
      setErrorMessage(normalizeError(error, "Flux temps reel indisponible."));
    }
  }, [clearHeartbeatTimer, clearReconnectTimer, closeSocket, pushLiveAlerts, refreshNow, token]);

  useEffect(() => {
    shouldReconnectRef.current = isEnabled;

    if (!isEnabled) {
      clearReconnectTimer();
      closeSocket();
      setConnectionState("idle");
      setErrorMessage(null);
      return;
    }

    if (!token) {
      setConnectionState("error");
      setErrorMessage("Flux temps reel indisponible.");
      return;
    }

    void connectStream();

    return () => {
      shouldReconnectRef.current = false;
      clearReconnectTimer();
      closeSocket();
    };
  }, [clearReconnectTimer, closeSocket, connectStream, isEnabled, token]);

  useEffect(() => {
    return () => {
      shouldReconnectRef.current = false;
      clearReconnectTimer();
      closeSocket();
    };
  }, [clearReconnectTimer, closeSocket]);

  return {
    isEnabled,
    setEnabled,
    soundEnabled,
    setSoundEnabled,
    connectionState,
    status,
    snapshot,
    errorMessage,
    refreshNow,
  };
}
