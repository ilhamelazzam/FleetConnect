import { describe, expect, it } from "vitest";

import { RequireAuth, RequireSuperAdmin } from "../../components/RouteGuards";
import { isPublicAppPath } from "../../lib/roles";
import { appRoutes } from "../../routes";

describe("public onboarding routes", () => {
  it("keeps landing, onboarding and login routes public", () => {
    const rootRoute = appRoutes[0];
    const rootChildren = rootRoute.children ?? [];
    const directPaths = new Set(
      rootChildren
        .map((child) => child.path)
        .filter((path): path is string => typeof path === "string"),
    );

    expect(directPaths).toContain("/");
    expect(directPaths).toContain("/choose-profile");
    expect(directPaths).toContain("/choisir-profil");
    expect(directPaths).toContain("/register");
    expect(directPaths).toContain("/register-company");
    expect(directPaths).toContain("/inscription-entreprise");
    expect(directPaths).toContain("/login");
    expect(directPaths).toContain("/admin/login");
    expect(isPublicAppPath("/register-company")).toBe(true);
    expect(isPublicAppPath("/login")).toBe(true);
    expect(isPublicAppPath("/dashboard")).toBe(false);
  });

  it("keeps super admin pages outside the collaborator auth branch", () => {
    const rootRoute = appRoutes[0];
    const rootChildren = rootRoute.children ?? [];
    const collaboratorBranch = rootChildren.find((child) => child.Component === RequireAuth);
    const collaboratorLayoutBranch = collaboratorBranch?.children?.[0];
    const collaboratorPaths = new Set(
      (collaboratorLayoutBranch?.children ?? [])
        .map((child) => child.path)
        .filter((path): path is string => typeof path === "string"),
    );
    const superAdminBranch = rootChildren.find((child) => child.Component === RequireSuperAdmin);
    const superAdminLayoutBranch = superAdminBranch?.children?.[0];
    const superAdminPaths = new Set(
      (superAdminLayoutBranch?.children ?? [])
        .map((child) => child.path)
        .filter((path): path is string => typeof path === "string"),
    );

    expect(collaboratorPaths.has("/admin/dashboard")).toBe(false);
    expect(collaboratorPaths.has("/admin/company-requests")).toBe(false);
    expect(superAdminPaths).toContain("/admin/dashboard");
    expect(superAdminPaths).toContain("/admin/company-requests");
  });
});
