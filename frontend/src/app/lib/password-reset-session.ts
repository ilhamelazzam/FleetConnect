const PASSWORD_RESET_SESSION_KEY = "fleetconnect_password_reset_session";

export interface PasswordResetSession {
  email: string;
  resetToken: string;
  expiresAt: number;
}

function getStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.sessionStorage;
}

export function readPasswordResetSession(): PasswordResetSession | null {
  const storage = getStorage();
  const rawValue = storage?.getItem(PASSWORD_RESET_SESSION_KEY);
  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue) as PasswordResetSession;
  } catch {
    storage?.removeItem(PASSWORD_RESET_SESSION_KEY);
    return null;
  }
}

export function writePasswordResetSession(session: PasswordResetSession): void {
  getStorage()?.setItem(PASSWORD_RESET_SESSION_KEY, JSON.stringify(session));
}

export function clearPasswordResetSession(): void {
  getStorage()?.removeItem(PASSWORD_RESET_SESSION_KEY);
}
