import { Link, useLocation } from "react-router";
import { ArrowLeft, LockKeyhole, ShieldAlert } from "lucide-react";

import { useAuth } from "../context/AuthContext";
import { formatRoleLabel } from "../lib/api";

export default function AccessDenied() {
  const location = useLocation();
  const { user } = useAuth();

  const requestedPath =
    typeof location.state === "object" &&
    location.state !== null &&
    "from" in location.state &&
    typeof location.state.from === "object" &&
    location.state.from !== null &&
    "pathname" in location.state.from &&
    typeof location.state.from.pathname === "string"
      ? location.state.from.pathname
      : null;

  return (
    <div className="min-h-full bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.12),transparent_32%),linear-gradient(180deg,#F8FAFC_0%,#EFF6FF_48%,#FFFFFF_100%)] p-6">
      <div className="mx-auto max-w-4xl rounded-[32px] border border-white/80 bg-white/90 p-8 shadow-[0_28px_90px_-40px_rgba(15,23,42,0.32)] backdrop-blur xl:p-10">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-[#DC2626]">
              <ShieldAlert className="h-4 w-4" />
              <span>Acces refuse</span>
            </div>

            <h1 className="mt-6 text-3xl font-semibold tracking-tight text-[#0F172A]">
              Cette zone est reservee aux administrateurs.
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-[#64748B]">
              Votre session est valide, mais votre role ne permet pas d&apos;ouvrir ce module de
              gestion. Toutes les actions d&apos;administration utilisateurs restent protegees
              cote frontend et cote backend.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/dashboard"
                className="inline-flex items-center gap-2 rounded-2xl bg-[#2563EB] px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_34px_-18px_rgba(37,99,235,0.58)] transition-all hover:-translate-y-0.5 hover:bg-[#1D4ED8]"
              >
                <ArrowLeft className="h-4 w-4" />
                <span>Retour au tableau de bord</span>
              </Link>

              <Link
                to="/profil"
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-[#475569] transition-all hover:-translate-y-0.5 hover:bg-[#F8FAFC]"
              >
                <LockKeyhole className="h-4 w-4" />
                <span>Voir mon profil</span>
              </Link>
            </div>
          </div>

          <aside className="rounded-[28px] border border-slate-200/80 bg-[linear-gradient(180deg,#0F172A_0%,#1E293B_100%)] p-6 text-white shadow-[0_20px_50px_-30px_rgba(15,23,42,0.85)]">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-300">
              Contexte session
            </p>

            <div className="mt-5 space-y-4">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs text-slate-400">Role connecte</p>
                <p className="mt-2 text-lg font-semibold">
                  {user ? formatRoleLabel(user.role) : "Inconnu"}
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs text-slate-400">Ressource demandee</p>
                <p className="mt-2 break-all text-sm font-medium text-slate-100">
                  {requestedPath ?? "/utilisateurs"}
                </p>
              </div>

              <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100">
                Le backend retournera egalement `403 Forbidden` sur toute tentative d&apos;appel
                admin non autorisee.
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
