import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearStoredSession,
  readStoredSession,
  writeStoredSession,
} from "../auth-session";
import { liveMonitoringApi, notificationsApi } from "../api";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function setWindowLocation(url: string): void {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: new URL(url),
  });
}

describe("api auth infrastructure", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    clearStoredSession();
    setWindowLocation("http://localhost:5173/dashboard");
  });

  it("refreshes the access token and retries the protected request on 401", async () => {
    writeStoredSession(
      {
        accessToken: "expired-access-token",
        refreshToken: "refresh-token",
        user: {
          id: 1,
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
          updated_at: "2026-07-09T12:00:00Z",
          last_login_at: null,
          created_at: "2026-07-09T12:00:00Z",
        },
      },
      true,
    );

    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          {
            detail: {
              error: "UNAUTHORIZED",
              message: "Token manquant ou expire.",
            },
          },
          401,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "fresh-access-token",
          refresh_token: "fresh-refresh-token",
          token_type: "bearer",
          access_token_expires_in: 3600,
          refresh_token_expires_in: 7200,
          user: {
            id: 1,
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
            updated_at: "2026-07-09T12:00:00Z",
            last_login_at: null,
            created_at: "2026-07-09T12:00:00Z",
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          total: 0,
          unread_count: 0,
          offset: 0,
          limit: 50,
          items: [],
        }),
      );

    const response = await notificationsApi.list("expired-access-token", { limit: 50 });

    expect(response.items).toEqual([]);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/auth/refresh",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/v1/notifications?limit=50",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer fresh-access-token",
        }),
      }),
    );
    expect(readStoredSession()?.accessToken).toBe("fresh-access-token");
    expect(readStoredSession()?.refreshToken).toBe("fresh-refresh-token");
  });

  it("keeps the session when a protected route returns 403", async () => {
    writeStoredSession(
      {
        accessToken: "valid-access-token",
        refreshToken: "refresh-token",
        user: {
          id: 2,
          full_name: "Manager Test",
          email: "manager@test.com",
          photo_url: null,
          role: "manager",
          company_id: null,
          company_name: null,
          department_id: null,
          department_name: null,
          job_profile: null,
          is_active: true,
          status: "active",
          updated_at: "2026-07-09T12:00:00Z",
          last_login_at: null,
          created_at: "2026-07-09T12:00:00Z",
        },
      },
      true,
    );

    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          detail: {
            code: "FORBIDDEN",
            message: "Access denied",
          },
        },
        403,
      ),
    );

    await expect(notificationsApi.list("valid-access-token", { limit: 50 })).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
    });

    expect(readStoredSession()?.accessToken).toBe("valid-access-token");
  });

  it("builds the live websocket URL from the current browser host", () => {
    setWindowLocation("http://127.0.0.1:5173/dashboard");
    expect(liveMonitoringApi.buildStreamUrl("token-demo")).toBe(
      "ws://127.0.0.1:5173/api/v1/live/stream?token=token-demo",
    );

    setWindowLocation("http://localhost:5173/dashboard");
    expect(liveMonitoringApi.buildStreamUrl("token-demo")).toBe(
      "ws://localhost:5173/api/v1/live/stream?token=token-demo",
    );
  });
});
