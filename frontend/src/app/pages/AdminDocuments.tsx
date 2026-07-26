import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ArrowRight, FileText, FolderOpenDot, ShieldCheck } from "lucide-react";

import {
  RegistrationStatusBadge,
  formatDateTime,
} from "../components/company-registration/RegistrationUi";
import { useAuth } from "../context/AuthContext";
import {
  ApiError,
  companyRegistrationApi,
  type ApiCompanyRegistrationSummary,
} from "../lib/api";

export default function AdminDocuments() {
  const { token } = useAuth();
  const [requests, setRequests] = useState<ApiCompanyRegistrationSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let active = true;

    async function loadRequests() {
      if (!token) {
        return;
      }

      setIsLoading(true);
      setErrorMessage("");
      try {
        const response = await companyRegistrationApi.list(token, { limit: 12 });
        if (!active) {
          return;
        }
        setRequests(response.items);
      } catch (error) {
        if (!active) {
          return;
        }
        if (error instanceof ApiError) {
          setErrorMessage(error.message);
        } else {
          setErrorMessage("Impossible de charger les documents entreprises.");
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void loadRequests();

    return () => {
      active = false;
    };
  }, [token]);

  return (
    <div className="min-h-full bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.14),transparent_28%),linear-gradient(180deg,#F8FAFC_0%,#FFFFFF_52%,#EEF6FF_100%)] p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="overflow-hidden rounded-[32px] bg-[linear-gradient(145deg,#0F172A_0%,#1E3A8A_42%,#06B6D4_100%)] p-7 text-white shadow-[0_28px_90px_-42px_rgba(15,23,42,0.72)]">
          <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-end">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium">
                <FileText className="h-4 w-4" />
                <span>Controle documentaire</span>
              </div>
              <h1 className="mt-5 text-3xl font-semibold tracking-tight">Documents entreprises</h1>
              <p className="mt-4 max-w-3xl text-sm leading-7 text-white/80">
                Les justificatifs restent attaches au dossier de chaque demande. Ouvrez une fiche
                pour telecharger le logo, le RC et les pieces deposees.
              </p>
            </div>
            <div className="rounded-[28px] border border-white/15 bg-white/10 p-5 backdrop-blur-sm">
              <p className="text-xs uppercase tracking-[0.22em] text-white/60">Acces protege</p>
              <p className="mt-3 text-xl font-semibold">Supervision documentaire</p>
              <p className="mt-1 text-sm text-white/75">
                Tous les telechargements sont proteges par JWT et traces cote serveur.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-[32px] border border-white/80 bg-white/92 p-6 shadow-[0_20px_70px_-36px_rgba(15,23,42,0.28)] backdrop-blur-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-[#0F172A]">
                Dossiers avec justificatifs
              </h2>
              <p className="mt-2 text-sm leading-7 text-[#64748B]">
                Accedez rapidement au dossier complet d'une entreprise pour verifier les pieces.
              </p>
            </div>
            <Link
              to="/admin/company-requests"
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-[#0F172A] hover:bg-slate-50"
            >
              <span>Voir toutes les demandes</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {errorMessage ? (
            <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-[#B91C1C]">
              {errorMessage}
            </div>
          ) : null}

          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {isLoading ? (
              <div className="md:col-span-2 xl:col-span-3 rounded-[24px] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-12 text-center text-sm text-[#64748B]">
                Chargement des dossiers...
              </div>
            ) : requests.length ? (
              requests.map((request) => (
                <div
                  key={request.id}
                  className="rounded-[28px] border border-slate-200 bg-slate-50/80 p-5 shadow-[0_14px_40px_-30px_rgba(15,23,42,0.25)]"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-[#1D4ED8] shadow-sm">
                    <FolderOpenDot className="h-5 w-5" />
                  </div>
                  <p className="mt-4 text-lg font-semibold text-[#0F172A]">{request.company_name}</p>
                  <p className="mt-2 text-sm text-[#64748B]">{request.responsible_full_name}</p>
                  <p className="mt-1 text-sm text-[#64748B]">{request.responsible_email}</p>

                  <div className="mt-4 flex items-center justify-between gap-3">
                    <RegistrationStatusBadge status={request.status} />
                    <div className="inline-flex items-center gap-2 rounded-full border border-[#DBEAFE] bg-[#EFF6FF] px-3 py-1.5 text-xs font-semibold text-[#1D4ED8]">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      <span>{request.primary_operator ?? request.operators[0] ?? "Operateur"}</span>
                    </div>
                  </div>

                  <p className="mt-4 text-xs uppercase tracking-[0.16em] text-[#94A3B8]">
                    Soumise le {formatDateTime(request.created_at)}
                  </p>

                  <Link
                    to={`/admin/company-requests/${request.id}`}
                    className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-[#1D4ED8] px-4 py-3 text-sm font-semibold text-white transition-all hover:-translate-y-0.5 hover:bg-[#1E40AF]"
                  >
                    <span>Ouvrir le dossier</span>
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              ))
            ) : (
              <div className="md:col-span-2 xl:col-span-3 rounded-[24px] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-12 text-center text-sm text-[#64748B]">
                Aucun dossier entreprise n'est disponible pour le moment.
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
