import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider, useAuth } from "../AuthContext";
import { writeStoredSession } from "../../lib/auth-session";

const { getCurrentUserMock } = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
}));

vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");

  return {
    ...actual,
    authApi: {
      ...actual.authApi,
      getCurrentUser: getCurrentUserMock,
    },
  };
});

function SessionProbe() {
  const { isLoading, isAuthenticated, user } = useAuth();

  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="authenticated">{String(isAuthenticated)}</span>
      <span data-testid="email">{user?.email ?? "guest"}</span>
    </div>
  );
}

const storedSession = {
  accessToken: "stored-access-token",
  refreshToken: "stored-refresh-token",
  user: {
    id: 7,
    full_name: "Admin BC Skills",
    email: "admin@bcskills.ma",
    photo_url: null,
    role: "super_admin",
    company_id: null,
    company_name: null,
    department_id: null,
    department_name: null,
    job_profile: null,
    is_active: true,
    status: "active",
    updated_at: "2026-07-19T09:00:00Z",
    last_login_at: null,
    created_at: "2026-07-19T09:00:00Z",
  },
} as const;

describe("AuthProvider public route behavior", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    getCurrentUserMock.mockReset();
  });

  afterEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("does not call auth/me on the public register-company route", async () => {
    writeStoredSession(storedSession, true);

    render(
      <MemoryRouter initialEntries={["/register-company"]}>
        <AuthProvider>
          <SessionProbe />
        </AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("authenticated")).toHaveTextContent("true");
    expect(screen.getByTestId("email")).toHaveTextContent("admin@bcskills.ma");
    expect(getCurrentUserMock).not.toHaveBeenCalled();
  });

  it("validates the stored session when entering a protected route", async () => {
    writeStoredSession(storedSession, true);
    getCurrentUserMock.mockResolvedValueOnce({
      ...storedSession.user,
      full_name: "Super Admin Verifie",
    });

    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <AuthProvider>
          <SessionProbe />
        </AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(getCurrentUserMock).toHaveBeenCalledTimes(1));
    expect(getCurrentUserMock).toHaveBeenCalledWith("stored-access-token");
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("authenticated")).toHaveTextContent("true");
    expect(screen.getByTestId("email")).toHaveTextContent("admin@bcskills.ma");
  });
});
