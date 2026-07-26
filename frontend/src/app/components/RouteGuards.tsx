import { Navigate, Outlet, useLocation } from "react-router";

import { useAuth } from "../context/AuthContext";
import {
  canAccessModule,
  canAccessAdminCenter,
  canAccessSuperAdmin,
  canManageUsers,
  getDefaultAuthenticatedPath,
  type AppModule,
} from "../lib/roles";

function AuthLoadingScreen() {
  return (
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center">
      <div className="text-sm font-medium text-[#64748B]">Chargement de la session...</div>
    </div>
  );
}

export function RootRedirect() {
  const { isAuthenticated, isLoading, user } = useAuth();

  if (isLoading) {
    return <AuthLoadingScreen />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <Navigate to={getDefaultAuthenticatedPath(user)} replace />;
}

export function RequireAuth() {
  const location = useLocation();
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <AuthLoadingScreen />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}

export function RequireAdmin() {
  const location = useLocation();
  const { isAuthenticated, isLoading, user } = useAuth();

  if (isLoading) {
    return <AuthLoadingScreen />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (!canAccessAdminCenter(user)) {
    return <Navigate to="/acces-refuse" replace state={{ from: location }} />;
  }

  return <Outlet />;
}

export function RequireUserAdmin() {
  const location = useLocation();
  const { isAuthenticated, isLoading, user } = useAuth();

  if (isLoading) {
    return <AuthLoadingScreen />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (!canManageUsers(user)) {
    return <Navigate to="/acces-refuse" replace state={{ from: location }} />;
  }

  return <Outlet />;
}

export function GuestOnly() {
  const { isLoading } = useAuth();

  if (isLoading) {
    return <AuthLoadingScreen />;
  }

  return <Outlet />;
}

export function RequireSuperAdmin() {
  const location = useLocation();
  const { isAuthenticated, isLoading, user } = useAuth();

  if (isLoading) {
    return <AuthLoadingScreen />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/admin/login" replace state={{ from: location }} />;
  }

  if (!canAccessSuperAdmin(user)) {
    return <Navigate to="/acces-refuse" replace state={{ from: location }} />;
  }

  return <Outlet />;
}

export function createRequireModuleAccess(module: AppModule) {
  function RequireModuleAccess() {
    const location = useLocation();
    const { isAuthenticated, isLoading, user } = useAuth();

    if (isLoading) {
      return <AuthLoadingScreen />;
    }

    if (!isAuthenticated) {
      return <Navigate to="/login" replace state={{ from: location }} />;
    }

    if (!canAccessModule(user, module)) {
      return <Navigate to="/acces-refuse" replace state={{ from: location }} />;
    }

    return <Outlet />;
  }

  RequireModuleAccess.displayName = `Require${module
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join("")}Access`;

  return RequireModuleAccess;
}
