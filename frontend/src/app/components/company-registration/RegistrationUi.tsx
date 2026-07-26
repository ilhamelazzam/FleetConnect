import { CircleAlert, CircleCheckBig, Clock3, RotateCcw, Trash2, XCircle } from "lucide-react";

import type { ApiCompanyRegistrationStatus } from "../../lib/api";

export function formatRegistrationStatusLabel(
  status: ApiCompanyRegistrationStatus,
  isDeleted = false,
): string {
  if (isDeleted) {
    return "Supprimee";
  }
  if (status === "approved") {
    return "Approuvee";
  }
  if (status === "under_review") {
    return "En revision";
  }
  if (status === "rejected") {
    return "Refusee";
  }
  return "En attente";
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "Non disponible";
  }

  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function RegistrationStatusBadge({
  status,
  isDeleted = false,
}: {
  status: ApiCompanyRegistrationStatus;
  isDeleted?: boolean;
}) {
  const config = isDeleted
    ? {
        label: "Supprimee",
        className: "border-slate-300 bg-slate-100 text-[#475569]",
        icon: Trash2,
      }
    : status === "approved"
      ? {
          label: "Approuvee",
          className: "border-emerald-200 bg-emerald-50 text-[#047857]",
          icon: CircleCheckBig,
        }
      : status === "under_review"
        ? {
            label: "En revision",
            className: "border-sky-200 bg-sky-50 text-[#0369A1]",
            icon: RotateCcw,
          }
      : status === "rejected"
        ? {
            label: "Refusee",
            className: "border-red-200 bg-red-50 text-[#B91C1C]",
            icon: XCircle,
          }
        : {
            label: "En attente",
            className: "border-amber-200 bg-amber-50 text-[#B45309]",
            icon: Clock3,
          };
  const Icon = config.icon;

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] ${config.className}`}
    >
      <Icon className="h-3.5 w-3.5" />
      <span>{config.label}</span>
    </span>
  );
}

export function DeleteRequestDialog({
  isOpen,
  isSubmitting,
  companyName,
  isPendingRequest,
  onClose,
  onConfirm,
}: {
  isOpen: boolean;
  isSubmitting: boolean;
  companyName: string;
  isPendingRequest: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-[28px] border border-white/80 bg-white p-6 shadow-[0_28px_90px_-36px_rgba(15,23,42,0.55)]">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-[#DC2626]">
            <Trash2 className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-xl font-semibold text-[#0F172A]">Supprimer cette demande ?</h3>
            <p className="mt-2 text-sm leading-6 text-[#64748B]">
              Cette action supprimera la demande d'inscription et ses donnees associees. Elle est
              irreversible.
            </p>
            <p className="mt-3 text-sm font-medium text-[#0F172A]">{companyName}</p>
            {isPendingRequest ? (
              <p className="mt-2 text-sm leading-6 text-[#B45309]">
                Cette demande est encore en attente. La suppression sera executee avec
                confirmation renforcee.
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-[#0F172A] transition-all hover:-translate-y-0.5 hover:bg-slate-50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 rounded-2xl bg-[#B91C1C] px-5 py-3 text-sm font-semibold text-white transition-all hover:-translate-y-0.5 hover:bg-[#991B1B] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Trash2 className="h-4 w-4" />
            <span>{isSubmitting ? "Suppression..." : "Supprimer definitivement"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export function RejectRequestDialog({
  isOpen,
  reason,
  isSubmitting,
  onReasonChange,
  onClose,
  onConfirm,
}: {
  isOpen: boolean;
  reason: string;
  isSubmitting: boolean;
  onReasonChange: (reason: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-[28px] border border-white/80 bg-white p-6 shadow-[0_28px_90px_-36px_rgba(15,23,42,0.55)]">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-[#DC2626]">
            <CircleAlert className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-xl font-semibold text-[#0F172A]">Refuser la demande</h3>
            <p className="mt-2 text-sm leading-6 text-[#64748B]">
              Renseignez une raison claire. Elle sera enregistree dans l'historique et envoyee par
              email a l'entreprise.
            </p>
          </div>
        </div>

        <label className="mt-6 block">
          <span className="mb-2 block text-sm font-medium text-[#0F172A]">Raison du refus</span>
          <textarea
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
            rows={5}
            className="w-full resize-none rounded-3xl border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm text-[#0F172A] outline-none transition-colors focus:border-[#93C5FD] focus:bg-white"
          />
        </label>

        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-[#0F172A] transition-all hover:-translate-y-0.5 hover:bg-slate-50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting}
            className="rounded-2xl bg-[#B91C1C] px-5 py-3 text-sm font-semibold text-white transition-all hover:-translate-y-0.5 hover:bg-[#991B1B] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Refus en cours..." : "Confirmer le refus"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ReopenRequestDialog({
  isOpen,
  reason,
  isSubmitting,
  onReasonChange,
  onClose,
  onConfirm,
}: {
  isOpen: boolean;
  reason: string;
  isSubmitting: boolean;
  onReasonChange: (reason: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-[28px] border border-white/80 bg-white p-6 shadow-[0_28px_90px_-36px_rgba(15,23,42,0.55)]">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-50 text-[#0284C7]">
            <RotateCcw className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-xl font-semibold text-[#0F172A]">Reouvrir cette demande ?</h3>
            <p className="mt-2 text-sm leading-6 text-[#64748B]">
              La demande repassera en cours d'examen. Le motif de refus restera conserve dans
              l'historique.
            </p>
          </div>
        </div>

        <label className="mt-6 block">
          <span className="mb-2 block text-sm font-medium text-[#0F172A]">
            Motif de reouverture
          </span>
          <textarea
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
            rows={5}
            className="w-full resize-none rounded-3xl border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm text-[#0F172A] outline-none transition-colors focus:border-[#93C5FD] focus:bg-white"
          />
        </label>

        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-[#0F172A] transition-all hover:-translate-y-0.5 hover:bg-slate-50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 rounded-2xl bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition-all hover:-translate-y-0.5 hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RotateCcw className="h-4 w-4" />
            <span>{isSubmitting ? "Reouverture..." : "Reouvrir"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
