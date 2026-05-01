const LOCAL_STORAGE_KEY = "fleetconnect.auth.local";
const SESSION_STORAGE_KEY = "fleetconnect.auth.session";
const AUTH_SESSION_EVENT = "fleetconnect:auth-session-changed";

interface StoredSessionUser {
  id: number;
  full_name: string;
  email: string;
  photo_url: string | null;
  role: string;
  department_id: number | null;
  job_profile: string | null;
  is_active: boolean;
  updated_at: string;
  last_login_at: string | null;
  created_at: string;
}

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  user: StoredSessionUser;
}

function emitAuthSessionChange(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new Event(AUTH_SESSION_EVENT));
}

function parseStoredSession(rawValue: string | null): StoredSession | null {
  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue) as StoredSession;
  } catch {
    return null;
  }
}

export function readStoredSession(): StoredSession | null {
  if (typeof window === "undefined") {
    return null;
  }

  return (
    parseStoredSession(window.localStorage.getItem(LOCAL_STORAGE_KEY)) ??
    parseStoredSession(window.sessionStorage.getItem(SESSION_STORAGE_KEY))
  );
}

export function hasPersistentSession(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem(LOCAL_STORAGE_KEY) !== null;
}

export function writeStoredSession(session: StoredSession, remember: boolean): void {
  if (typeof window === "undefined") {
    return;
  }

  const serializedSession = JSON.stringify(session);

  if (remember) {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, serializedSession);
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } else {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, serializedSession);
    window.localStorage.removeItem(LOCAL_STORAGE_KEY);
  }

  emitAuthSessionChange();
}

export function clearStoredSession(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(LOCAL_STORAGE_KEY);
  window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
  emitAuthSessionChange();
}

export function subscribeToAuthSessionChanges(listener: () => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  window.addEventListener(AUTH_SESSION_EVENT, listener);

  return () => {
    window.removeEventListener(AUTH_SESSION_EVENT, listener);
  };
}
