import { Navigate, Outlet, createBrowserRouter, useParams, type RouteObject } from "react-router";

import AdminCompanies from "./pages/AdminCompanies";
import AdminDocuments from "./pages/AdminDocuments";
import Layout from "./components/Layout";
import {
  createRequireModuleAccess,
  RequireAdmin,
  RequireAuth,
  RequireSuperAdmin,
  RequireUserAdmin,
} from "./components/RouteGuards";
import { AuthProvider } from "./context/AuthContext";
import AccessDenied from "./pages/AccessDenied";
import Admin from "./pages/Admin";
import AlertDetail from "./pages/AlertDetail";
import Anomalies from "./pages/Anomalies";
import ChooseProfile from "./pages/ChooseProfile";
import Consumption from "./pages/Consumption";
import CustomerRisk from "./pages/CustomerRisk";
import Dashboard from "./pages/Dashboard";
import LandingPage from "./pages/LandingPage";
import LineDetail from "./pages/LineDetail";
import AdminLogin from "./pages/AdminLogin";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";
import OAuthCallback from "./pages/OAuthCallback";
import PhoneLines from "./pages/PhoneLines";
import PlanAssignments from "./pages/PlanAssignments";
import Plans from "./pages/Plans";
import Predictions from "./pages/Predictions";
import Profile from "./pages/Profile";
import Recommendations from "./pages/Recommendations";
import Register from "./pages/Register";
import RegisterCompany from "./pages/RegisterCompany";
import Reports from "./pages/Reports";
import ResetPassword from "./pages/ResetPassword";
import ForgotPassword from "./pages/ForgotPassword";
import Settings from "./pages/Settings";
import SuperAdminDashboard from "./pages/SuperAdminDashboard";
import SuperAdminRegistrationRequestDetail from "./pages/SuperAdminRegistrationRequestDetail";
import SuperAdminRegistrationRequests from "./pages/SuperAdminRegistrationRequests";
import Users from "./pages/Users";
import FleetAccess from "./pages/FleetAccess";

function AuthLayout() {
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  );
}

function AdminIndexRedirect() {
  return <Navigate to="/admin/dashboard" replace />;
}

function AdminValidationRedirect() {
  return <Navigate to="/admin/company-requests?status=pending" replace />;
}

function LegacySuperAdminRedirect() {
  return <Navigate to="/admin/company-requests" replace />;
}

function LegacySuperAdminDetailRedirect() {
  const { requestId } = useParams();

  return (
    <Navigate
      to={requestId ? `/admin/company-requests/${requestId}` : "/admin/company-requests"}
      replace
    />
  );
}

const RequireDashboardAccess = createRequireModuleAccess("dashboard");
const RequirePhoneLinesAccess = createRequireModuleAccess("phone_lines");
const RequireFleetAccess = createRequireModuleAccess("fleet_access");
const RequirePlansAccess = createRequireModuleAccess("plans");
const RequirePlanAssignmentsAccess = createRequireModuleAccess("plan_assignments");
const RequireConsumptionAccess = createRequireModuleAccess("consumption");
const RequireFraudCdrAccess = createRequireModuleAccess("fraud_cdr");
const RequirePredictionsAccess = createRequireModuleAccess("predictions");
const RequireRecommendationsAccess = createRequireModuleAccess("recommendations");
const RequireReportsAccess = createRequireModuleAccess("reports");
const RequireCustomerRiskAccess = createRequireModuleAccess("customer_risk");
const RequireProfileAccess = createRequireModuleAccess("profile");

export const appRoutes: RouteObject[] = [
  {
    Component: AuthLayout,
    children: [
      {
        path: "/auth/callback",
        Component: OAuthCallback,
      },
      {
        path: "/",
        Component: LandingPage,
      },
      {
        path: "/choose-profile",
        Component: ChooseProfile,
      },
      {
        path: "/choisir-profil",
        Component: ChooseProfile,
      },
      {
        path: "/register",
        Component: Register,
      },
      {
        path: "/register-company",
        Component: RegisterCompany,
      },
      {
        path: "/inscription-entreprise",
        Component: RegisterCompany,
      },
      {
        path: "/login",
        Component: Login,
      },
      {
        path: "/admin/login",
        Component: AdminLogin,
      },
      {
        path: "/forgot-password",
        Component: ForgotPassword,
      },
      {
        path: "/reset-password",
        Component: ResetPassword,
      },
      {
        Component: RequireAdmin,
        children: [{ path: "/admin-center", Component: Admin }],
      },
      {
        Component: RequireAuth,
        children: [
          {
            Component: Layout,
            children: [
              {
                Component: RequireDashboardAccess,
                children: [{ path: "/dashboard", Component: Dashboard }],
              },
              {
                Component: RequirePhoneLinesAccess,
                children: [
                  { path: "/lignes", Component: PhoneLines },
                  { path: "/lignes/:id", Component: LineDetail },
                ],
              },
              {
                Component: RequireFleetAccess,
                children: [{ path: "/acces-flotte", Component: FleetAccess }],
              },
              {
                Component: RequirePlansAccess,
                children: [{ path: "/forfaits", Component: Plans }],
              },
              {
                Component: RequirePlanAssignmentsAccess,
                children: [{ path: "/forfaits/attributions", Component: PlanAssignments }],
              },
              {
                Component: RequireConsumptionAccess,
                children: [{ path: "/consommations", Component: Consumption }],
              },
              {
                Component: RequireFraudCdrAccess,
                children: [
                  { path: "/fraude-cdr", Component: Anomalies },
                  { path: "/fraude-cdr/:id", Component: AlertDetail },
                  { path: "/anomalies", Component: Anomalies },
                  { path: "/anomalies/:id", Component: AlertDetail },
                ],
              },
              {
                Component: RequirePredictionsAccess,
                children: [{ path: "/predictions", Component: Predictions }],
              },
              {
                Component: RequireRecommendationsAccess,
                children: [{ path: "/recommandations", Component: Recommendations }],
              },
              {
                Component: RequireReportsAccess,
                children: [{ path: "/rapports", Component: Reports }],
              },
              {
                Component: RequireCustomerRiskAccess,
                children: [{ path: "/risque-client", Component: CustomerRisk }],
              },
              {
                Component: RequireProfileAccess,
                children: [{ path: "/profil", Component: Profile }],
              },
              { path: "/acces-refuse", Component: AccessDenied },
              {
                Component: RequireUserAdmin,
                children: [{ path: "/utilisateurs", Component: Users }],
              },
              {
                Component: RequireAdmin,
                children: [{ path: "/parametres", Component: Settings }],
              },
            ],
          },
        ],
      },
      {
        Component: RequireSuperAdmin,
        children: [
          {
            Component: Layout,
            children: [
              { path: "/admin", Component: AdminIndexRedirect },
              { path: "/admin/dashboard", Component: SuperAdminDashboard },
              {
                path: "/admin/company-requests",
                Component: SuperAdminRegistrationRequests,
              },
              {
                path: "/admin/company-requests/:requestId",
                Component: SuperAdminRegistrationRequestDetail,
              },
              { path: "/admin/companies", Component: AdminCompanies },
              { path: "/admin/users", Component: Users },
              { path: "/admin/documents", Component: AdminDocuments },
              { path: "/admin/validation", Component: AdminValidationRedirect },
              { path: "/admin/settings", Component: Settings },
              { path: "/super-admin", Component: LegacySuperAdminRedirect },
              {
                path: "/super-admin/registration-requests",
                Component: LegacySuperAdminRedirect,
              },
              {
                path: "/super-admin/registration-requests/:requestId",
                Component: LegacySuperAdminDetailRedirect,
              },
            ],
          },
        ],
      },
      { path: "*", Component: NotFound },
    ],
  },
];

export const router = createBrowserRouter(appRoutes, {
  future: {
    v7_startTransition: true,
    v7_relativeSplatPath: true,
  },
});
