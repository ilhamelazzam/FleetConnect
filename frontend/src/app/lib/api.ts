import {
  clearStoredSession,
  hasPersistentSession,
  readStoredSession,
  writeStoredSession,
} from "./auth-session";

export interface ApiUser {
  id: number;
  full_name: string;
  email: string;
  photo_url: string | null;
  role: string;
  is_active: boolean;
  updated_at: string;
  last_login_at: string | null;
  created_at: string;
}

export interface ApiPhoneLine {
  id: number;
  phone_number: string;
  operator_name: string;
  plan_name: string;
  assigned_to: string | null;
  department: string | null;
  status: string;
  monthly_limit: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApiPhoneLineStats {
  total: number;
  created_this_month: number;
}

export interface ApiPlan {
  id: number;
  name: string;
  operator_name: string;
  monthly_price: number;
  voice_quota: string;
  data_quota: string;
  sms_quota: string;
  roaming_zone: string;
  active_lines: number;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterPayload {
  full_name: string;
  email: string;
  password: string;
  role: string;
}

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  access_token_expires_in: number;
  refresh_token_expires_in: number;
  user: ApiUser;
}

export interface MessageResponse {
  message: string;
}

export interface CreateUserPayload {
  full_name: string;
  email: string;
  password: string;
  photo_url?: string | null;
  role: string;
  is_active: boolean;
}

export interface UpdateUserPayload {
  full_name?: string;
  email?: string;
  password?: string | null;
  photo_url?: string | null;
  role?: string;
  is_active?: boolean;
}

export interface CreatePhoneLinePayload {
  phone_number: string;
  operator_name: string;
  plan_name: string;
  assigned_to?: string | null;
  department?: string | null;
  status?: string;
  monthly_limit?: number | null;
  notes?: string | null;
}

export interface UpdatePhoneLinePayload {
  phone_number?: string;
  operator_name?: string;
  plan_name?: string;
  assigned_to?: string | null;
  department?: string | null;
  status?: string;
  monthly_limit?: number | null;
  notes?: string | null;
}

export interface CreatePlanPayload {
  name: string;
  operator_name: string;
  monthly_price: number;
  voice_quota: string;
  data_quota: string;
  sms_quota: string;
  roaming_zone: string;
  active_lines: number;
  description?: string | null;
}

export interface UpdatePlanPayload {
  name?: string;
  operator_name?: string;
  monthly_price?: number;
  voice_quota?: string;
  data_quota?: string;
  sms_quota?: string;
  roaming_zone?: string;
  active_lines?: number;
  description?: string | null;
}

export interface ForgotPasswordPayload {
  email: string;
}

export interface ForgotPasswordResponse {
  message: string;
  reset_token: string;
  expires_in_seconds: number;
}

export interface VerifyResetCodePayload {
  reset_token: string;
  code: string;
}

export interface ResetPasswordPayload extends VerifyResetCodePayload {
  new_password: string;
}

interface RequestOptions extends RequestInit {
  token?: string | null;
}

export class ApiError extends Error {
  status: number;
  details: unknown;

  constructor(message: string, status: number, details: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

const API_BASE_URL =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ??
  "http://127.0.0.1:8000/api/v1";

let refreshPromise: Promise<string | null> | null = null;

function buildHeaders(headers: HeadersInit | undefined, token: string | null | undefined): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...headers,
  };
}

async function parsePayload(response: Response): Promise<unknown> {
  const responseText = await response.text();

  if (!responseText) {
    return null;
  }

  try {
    return JSON.parse(responseText);
  } catch {
    return responseText;
  }
}

async function tryRefreshAccessToken(): Promise<string | null> {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    const session = readStoredSession();
    if (!session?.refreshToken) {
      clearStoredSession();
      return null;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ refresh_token: session.refreshToken }),
      });
      const payload = await parsePayload(response);

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          clearStoredSession();
        }
        return null;
      }

      const refreshedSession = payload as AuthResponse;
      writeStoredSession(
        {
          accessToken: refreshedSession.access_token,
          refreshToken: refreshedSession.refresh_token,
          user: refreshedSession.user,
        },
        hasPersistentSession(),
      );

      return refreshedSession.access_token;
    } catch {
      return null;
    }
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

async function request<T>(
  path: string,
  options: RequestOptions = {},
  allowRefresh = true,
): Promise<T> {
  const { token, headers, ...rest } = options;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    headers: buildHeaders(headers, token),
  });
  const payload = await parsePayload(response);

  if (response.status === 401 && token && allowRefresh) {
    const refreshedToken = await tryRefreshAccessToken();
    if (refreshedToken) {
      return request<T>(path, { ...options, token: refreshedToken }, false);
    }
  }

  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "detail" in payload &&
      typeof payload.detail === "string"
        ? payload.detail
        : typeof payload === "string"
          ? payload
          : "Backend request failed";
    throw new ApiError(message, response.status, payload);
  }

  return payload as T;
}

export const authApi = {
  login(payload: LoginPayload) {
    return request<AuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  register(payload: RegisterPayload) {
    return request<AuthResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  getCurrentUser(token: string) {
    return request<ApiUser>("/auth/me", { token });
  },
  requestPasswordReset(payload: ForgotPasswordPayload) {
    return request<ForgotPasswordResponse>("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  verifyResetCode(payload: VerifyResetCodePayload) {
    return request<MessageResponse>("/auth/verify-reset-code", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  resetPassword(payload: ResetPasswordPayload) {
    return request<MessageResponse>("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
};

export const oauthApi = {
  googleLoginUrl() {
    return `${API_BASE_URL}/auth/google/login`;
  },
  microsoftLoginUrl() {
    return `${API_BASE_URL}/auth/microsoft/login`;
  },
};

export const usersApi = {
  list(token: string) {
    return request<ApiUser[]>("/users/", { token });
  },
  get(token: string, userId: number) {
    return request<ApiUser>(`/users/${userId}`, { token });
  },
  create(token: string, payload: CreateUserPayload) {
    return request<ApiUser>("/users/", {
      method: "POST",
      token,
      body: JSON.stringify(payload),
    });
  },
  update(token: string, userId: number, payload: UpdateUserPayload) {
    return request<ApiUser>(`/users/${userId}`, {
      method: "PUT",
      token,
      body: JSON.stringify(payload),
    });
  },
  remove(token: string, userId: number) {
    return request<void>(`/users/${userId}`, {
      method: "DELETE",
      token,
    });
  },
};

export const phoneLinesApi = {
  list(token: string) {
    return request<ApiPhoneLine[]>("/phone-lines/", { token });
  },
  stats(token: string) {
    return request<ApiPhoneLineStats>("/phone-lines/stats", { token });
  },
  get(token: string, phoneLineId: number) {
    return request<ApiPhoneLine>(`/phone-lines/${phoneLineId}`, { token });
  },
  create(token: string, payload: CreatePhoneLinePayload) {
    return request<ApiPhoneLine>("/phone-lines/", {
      method: "POST",
      token,
      body: JSON.stringify(payload),
    });
  },
  update(token: string, phoneLineId: number, payload: UpdatePhoneLinePayload) {
    return request<ApiPhoneLine>(`/phone-lines/${phoneLineId}`, {
      method: "PUT",
      token,
      body: JSON.stringify(payload),
    });
  },
  remove(token: string, phoneLineId: number) {
    return request<void>(`/phone-lines/${phoneLineId}`, {
      method: "DELETE",
      token,
    });
  },
};

export const plansApi = {
  list(token: string) {
    return request<ApiPlan[]>("/plans/", { token });
  },
  get(token: string, planId: number) {
    return request<ApiPlan>(`/plans/${planId}`, { token });
  },
  create(token: string, payload: CreatePlanPayload) {
    return request<ApiPlan>("/plans/", {
      method: "POST",
      token,
      body: JSON.stringify(payload),
    });
  },
  update(token: string, planId: number, payload: UpdatePlanPayload) {
    return request<ApiPlan>(`/plans/${planId}`, {
      method: "PUT",
      token,
      body: JSON.stringify(payload),
    });
  },
  remove(token: string, planId: number) {
    return request<void>(`/plans/${planId}`, {
      method: "DELETE",
      token,
    });
  },
};

export function formatRoleLabel(role: string): string {
  const normalizedRole = role.trim().toLowerCase();

  if (normalizedRole === "admin") {
    return "Administrateur";
  }
  if (normalizedRole === "manager") {
    return "Manager";
  }
  if (normalizedRole === "analyst") {
    return "Analyste";
  }

  return role;
}

export function getUserInitials(fullName: string): string {
  const initials = fullName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return initials || "A";
}

export function getGeneratedAvatarUrl(fullName: string): string {
  const seed = encodeURIComponent(fullName.trim() || "Utilisateur");
  return `https://api.dicebear.com/9.x/initials/svg?seed=${seed}&backgroundColor=2563eb,7c3aed,06b6d4,16a34a,f59e0b,dc2626&backgroundType=gradientLinear&fontSize=38&fontWeight=600`;
}

export function getUserAvatarUrl(fullName: string, photoUrl?: string | null): string {
  const normalizedPhotoUrl = photoUrl?.trim();
  return normalizedPhotoUrl || getGeneratedAvatarUrl(fullName);
}
