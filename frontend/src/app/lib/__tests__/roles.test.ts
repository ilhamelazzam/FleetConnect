import { describe, expect, it } from "vitest";

import {
  NAVIGATION_ITEMS,
  canAccessModule,
  canAccessPath,
  getAccessibleModules,
  isNavigationItemActive,
  resolvePostLoginPath,
  type AppRole,
} from "../roles";

function buildUser(role: AppRole) {
  return { role };
}

describe("roles and historical module access", () => {
  it("grants company_admin access to all restored analytical modules", () => {
    const user = buildUser("company_admin");

    expect(canAccessModule(user, "consumption")).toBe(true);
    expect(canAccessModule(user, "fraud_cdr")).toBe(true);
    expect(canAccessModule(user, "predictions")).toBe(true);
    expect(canAccessModule(user, "recommendations")).toBe(true);

    const visiblePaths = NAVIGATION_ITEMS.filter((item) =>
      canAccessModule(user, item.module),
    ).map((item) => item.path);

    expect(visiblePaths).toEqual(
      expect.arrayContaining([
        "/consommations",
        "/fraude-cdr",
        "/predictions",
        "/recommandations",
      ]),
    );
  });

  it("grants analyst read access to the restored analytical modules only", () => {
    const user = buildUser("analyst");

    expect(getAccessibleModules(user)).toEqual(
      expect.arrayContaining([
        "dashboard",
        "consumption",
        "fraud_cdr",
        "predictions",
        "recommendations",
        "reports",
      ]),
    );
    expect(canAccessPath(user, "/fraude-cdr")).toBe(true);
    expect(canAccessPath(user, "/anomalies/42")).toBe(true);
    expect(canAccessPath(user, "/utilisateurs")).toBe(false);
  });

  it("redirects unauthorized users away from restricted historical routes", () => {
    const user = buildUser("manager");

    expect(canAccessPath(user, "/fraude-cdr")).toBe(false);
    expect(resolvePostLoginPath(user, "/fraude-cdr")).toBe("/dashboard");
  });

  it("keeps the fraud navigation item active for both canonical and legacy paths", () => {
    const fraudItem = NAVIGATION_ITEMS.find((item) => item.module === "fraud_cdr");

    expect(fraudItem).toBeDefined();
    expect(isNavigationItemActive(fraudItem!, "/fraude-cdr")).toBe(true);
    expect(isNavigationItemActive(fraudItem!, "/anomalies/12")).toBe(true);
  });
});
