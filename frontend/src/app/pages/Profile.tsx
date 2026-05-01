import { useNavigate } from "react-router";
import { CalendarDays, Mail, Shield, UserRound } from "lucide-react";

import { useAuth } from "../context/AuthContext";
import { formatRoleLabel, getUserAvatarUrl } from "../lib/api";
import { canAccessSettings, getRoleCapabilities } from "../lib/roles";

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "Non disponible";
  }

  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function Profile() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const roleCapabilities = getRoleCapabilities(user);

  return (
    <div className="space-y-6 p-6">
      <section className="overflow-hidden rounded-[28px] border border-gray-200 bg-[linear-gradient(135deg,#EFF6FF,#FFFFFF)] shadow-sm">
        <div className="flex flex-col gap-6 p-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <img
              src={getUserAvatarUrl(user?.full_name ?? "Utilisateur", user?.photo_url)}
              alt={user?.full_name ?? "Utilisateur"}
              className="h-20 w-20 rounded-3xl border border-white bg-white object-cover shadow-lg"
            />
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.18em] text-[#2D6CDF]">
                Espace personnel
              </p>
              <h1 className="mt-2 text-3xl font-bold text-[#0F172A]">
                {user?.full_name ?? "Utilisateur"}
              </h1>
              <p className="mt-2 text-sm text-[#64748B]">
                {user ? formatRoleLabel(user.role) : "Role indisponible"}
              </p>
            </div>
          </div>

          {canAccessSettings(user) ? (
            <button
              type="button"
              onClick={() => navigate("/parametres")}
              className="inline-flex items-center justify-center rounded-xl bg-[#2D6CDF] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1D4ED8]"
            >
              Ouvrir les parametres admin
            </button>
          ) : null}
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section className="rounded-[28px] border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-[#0F172A]">Informations du compte</h2>
          <div className="mt-6 space-y-4">
            <div className="rounded-2xl border border-gray-200 bg-[#F8FAFC] p-4">
              <div className="flex items-center gap-3">
                <UserRound className="h-5 w-5 text-[#2D6CDF]" />
                <div>
                  <p className="text-sm text-[#64748B]">Nom complet</p>
                  <p className="mt-1 font-semibold text-[#0F172A]">
                    {user?.full_name ?? "Non disponible"}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-[#F8FAFC] p-4">
              <div className="flex items-center gap-3">
                <Mail className="h-5 w-5 text-[#2D6CDF]" />
                <div>
                  <p className="text-sm text-[#64748B]">Email</p>
                  <p className="mt-1 font-semibold text-[#0F172A]">
                    {user?.email ?? "Non disponible"}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-[#F8FAFC] p-4">
              <div className="flex items-center gap-3">
                <Shield className="h-5 w-5 text-[#2D6CDF]" />
                <div>
                  <p className="text-sm text-[#64748B]">Role</p>
                  <p className="mt-1 font-semibold text-[#0F172A]">
                    {user ? formatRoleLabel(user.role) : "Non disponible"}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-[#F8FAFC] p-4">
              <div className="flex items-center gap-3">
                <CalendarDays className="h-5 w-5 text-[#2D6CDF]" />
                <div>
                  <p className="text-sm text-[#64748B]">Derniere connexion</p>
                  <p className="mt-1 font-semibold text-[#0F172A]">
                    {formatDateTime(user?.last_login_at)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[28px] border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-[#0F172A]">Permissions actives</h2>
          <p className="mt-2 text-sm text-[#64748B]">
            Capacites disponibles pour votre session actuelle.
          </p>

          <div className="mt-6 grid gap-3">
            {roleCapabilities.map((capability) => (
              <div
                key={capability}
                className="rounded-2xl border border-gray-200 bg-[#F8FAFC] px-4 py-3 text-sm font-medium text-[#0F172A]"
              >
                {capability}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
