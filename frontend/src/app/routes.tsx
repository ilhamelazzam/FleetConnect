import { createBrowserRouter, Outlet } from "react-router";
import { AuthProvider } from "./context/AuthContext";
import Login from "./pages/Login";
import OAuthCallback from "./pages/OAuthCallback";
import Register from "./pages/Register";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import AccessDenied from "./pages/AccessDenied";
import Admin from "./pages/Admin";
import CustomerRisk from "./pages/CustomerRisk";
import Dashboard from "./pages/Dashboard";
import PhoneLines from "./pages/PhoneLines";
import FleetAccess from "./pages/FleetAccess";
import Plans from "./pages/Plans";
import PlanAssignments from "./pages/PlanAssignments";
import Consumption from "./pages/Consumption";
import Anomalies from "./pages/Anomalies";
import Predictions from "./pages/Predictions";
import Recommendations from "./pages/Recommendations";
import Reports from "./pages/Reports";
import Profile from "./pages/Profile";
import Settings from "./pages/Settings";
import Users from "./pages/Users";
import LineDetail from "./pages/LineDetail";
import AlertDetail from "./pages/AlertDetail";
import Layout from "./components/Layout";
import { GuestOnly, RequireAdmin, RequireAuth, RootRedirect } from "./components/RouteGuards";
import NotFound from "./pages/NotFound";

// Wrapper qui place AuthProvider DANS l'arbre React du router
function AuthLayout() {
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  );
}


export const router = createBrowserRouter(
  [
    {
      // AuthLayout est le layout racine : il monte AuthProvider
      // en premier, garantissant que tous les enfants y ont accès
      Component: AuthLayout,
      children: [
        {
          path: "/",
          Component: RootRedirect,
        },
        {
          path: "/auth/callback",
          Component: OAuthCallback,
        },
        {
          path: "/register",
          Component: Register,
        },
        {
          Component: GuestOnly,
          children: [
            { path: "/login", Component: Login },
            { path: "/forgot-password", Component: ForgotPassword },
            { path: "/reset-password", Component: ResetPassword },
          ],
        },
        {
          Component: RequireAdmin,
          children: [
            { path: "/admin", Component: Admin },
          ],
        },
        {
          Component: RequireAuth,
          children: [
            {
              Component: Layout,
              children: [
                { path: "/dashboard", Component: Dashboard },
                { path: "/lignes", Component: PhoneLines },
                { path: "/lignes/:id", Component: LineDetail },
                { path: "/acces-flotte", Component: FleetAccess },
                { path: "/forfaits", Component: Plans },
                { path: "/forfaits/attributions", Component: PlanAssignments },
                { path: "/consommations", Component: Consumption },
                { path: "/anomalies", Component: Anomalies },
                { path: "/anomalies/:id", Component: AlertDetail },
                { path: "/predictions", Component: Predictions },
                { path: "/recommandations", Component: Recommendations },
                { path: "/rapports", Component: Reports },
                { path: "/risque-client", Component: CustomerRisk },
                { path: "/profil", Component: Profile },
                { path: "/acces-refuse", Component: AccessDenied },
                {
                  Component: RequireAdmin,
                  children: [
                    { path: "/utilisateurs", Component: Users },
                    { path: "/parametres", Component: Settings },
                  ],
                },
              ],
            },
          ],
        },
        { path: "*", Component: NotFound },
      ],
    },
  ],
  {
    future: {
      v7_startTransition: true,
      v7_relativeSplatPath: true,
    },
  }
);
