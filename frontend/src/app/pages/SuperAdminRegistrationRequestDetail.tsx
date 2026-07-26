import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import {
  ArrowLeft,
  Briefcase,
  Building2,
  Download,
  FileBadge2,
  Mail,
  MapPinned,
  Phone,
  RotateCcw,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import {
  DeleteRequestDialog,
  RejectRequestDialog,
  ReopenRequestDialog,
  RegistrationStatusBadge,
  formatDateTime,
  formatRegistrationStatusLabel,
} from "../components/company-registration/RegistrationUi";
import { useAuth } from "../context/AuthContext";
import {
  ApiError,
  companyRegistrationApi,
  formatCompanyRequestedRoleLabel,
  type ApiCompanyRegistrationDetail,
} from "../lib/api";

export default function SuperAdminRegistrationRequestDetail() {
  const { requestId } = useParams();
  const { token } = useAuth();
  const [request, setRequest] = useState<ApiCompanyRegistrationDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isActionSubmitting, setIsActionSubmitting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [reopenReason, setReopenReason] = useState("");
  const [isRejectDialogOpen, setIsRejectDialogOpen] = useState(false);
  const [isReopenDialogOpen, setIsReopenDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const numericRequestId = Number(requestId);
  const canReview =
    (request?.status === "pending" || request?.status === "under_review") &&
    !request?.is_deleted;
  const canReopen = request?.status === "rejected" && !request?.is_deleted;
  const documentCount = useMemo(() => request?.documents.length ?? 0, [request]);
  const latestRejectionEntry = useMemo(
    () =>
      request?.history.find(
        (entry) => entry.action.toLowerCase() === "request_rejected" && Boolean(entry.comment),
      ) ?? null,
    [request],
  );

  useEffect(() => {
    let active = true;

    async function loadRequest() {
      if (!token || !numericRequestId) {
        return;
      }

      setIsLoading(true);
      setErrorMessage("");
      try {
        const detail = await companyRegistrationApi.get(token, numericRequestId);
        if (!active) {
          return;
        }
        setRequest(detail);
      } catch (error) {
        if (!active) {
          return;
        }
        if (error instanceof ApiError) {
          setErrorMessage(error.message);
        } else {
          setErrorMessage("Impossible de charger cette demande.");
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void loadRequest();

    return () => {
      active = false;
    };
  }, [token, numericRequestId]);

  const handleApprove = async () => {
    if (!token || !request) {
      return;
    }

    if (!window.confirm(`Approuver la demande de ${request.company_name} ?`)) {
      return;
    }

    setIsActionSubmitting(true);
    try {
      const response = await companyRegistrationApi.approve(token, request.id);
      setRequest(response.request);
      toast.success("Demande approuvee", {
        description: "La demande a ete approuvee et l'entreprise a ete creee.",
      });
    } catch (error) {
      if (error instanceof ApiError) {
        toast.error(error.message);
      } else {
        toast.error("Erreur pendant l'approbation.");
      }
    } finally {
      setIsActionSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!token || !request) {
      return;
    }

    if (rejectReason.trim().length < 10) {
      toast.error("La raison du refus doit contenir au moins 10 caracteres.");
      return;
    }

    setIsActionSubmitting(true);
    try {
      const response = await companyRegistrationApi.reject(token, request.id, rejectReason.trim());
      setRequest(response.request);
      setRejectReason("");
      setIsRejectDialogOpen(false);
      toast.success("Demande refusee", {
        description: "Le motif de refus a ete enregistre et notifie.",
      });
    } catch (error) {
      if (error instanceof ApiError) {
        toast.error(error.message);
      } else {
        toast.error("Erreur pendant le refus.");
      }
    } finally {
      setIsActionSubmitting(false);
    }
  };

  const handleReopen = async () => {
    if (!token || !request) {
      return;
    }

    if (reopenReason.trim().length < 3) {
      toast.error("Le motif de reouverture doit contenir au moins 3 caracteres.");
      return;
    }

    setIsActionSubmitting(true);
    try {
      const response = await companyRegistrationApi.reopen(token, request.id, reopenReason.trim());
      setRequest(response.request);
      setReopenReason("");
      setIsReopenDialogOpen(false);
      toast.success("Reouverture reussie", {
        description: "La demande est de nouveau en cours d'examen.",
      });
    } catch (error) {
      if (error instanceof ApiError) {
        toast.error(error.message);
      } else {
        toast.error("Erreur pendant la reouverture.");
      }
    } finally {
      setIsActionSubmitting(false);
    }
  };

  const handleDownloadDocument = async (documentKey: string, fileName: string) => {
    if (!token || !request) {
      return;
    }

    try {
      const blob = await companyRegistrationApi.downloadDocument(token, request.id, documentKey);
      const objectUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = fileName;
      link.click();
      window.URL.revokeObjectURL(objectUrl);
    } catch (error) {
      if (error instanceof ApiError) {
        toast.error(error.message);
      } else {
        toast.error("Le document n'a pas pu etre telecharge.");
      }
    }
  };

  const handleDelete = async () => {
    if (!token || !request) {
      return;
    }

    setIsActionSubmitting(true);
    try {
      const response = await companyRegistrationApi.delete(token, request.id, {
        force: request.status === "pending",
      });
      setRequest(response.request);
      setIsDeleteDialogOpen(false);
      toast.success("Demande supprimee", {
        description: `${response.request.company_name} a ete retiree de la liste active.`,
      });
    } catch (error) {
      if (error instanceof ApiError) {
        toast.error(error.message);
      } else {
        toast.error("Erreur pendant la suppression.");
      }
    } finally {
      setIsActionSubmitting(false);
    }
  };

  const handleRestore = async () => {
    if (!token || !request) {
      return;
    }

    setIsActionSubmitting(true);
    try {
      const response = await companyRegistrationApi.restore(token, request.id);
      setRequest(response.request);
      toast.success("Demande restauree", {
        description: `${response.request.company_name} est revenue dans la liste active.`,
      });
    } catch (error) {
      if (error instanceof ApiError) {
        toast.error(error.message);
      } else {
        toast.error("Erreur pendant la restauration.");
      }
    } finally {
      setIsActionSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-full bg-[linear-gradient(180deg,#F8FAFC_0%,#FFFFFF_100%)] p-6">
        <div className="rounded-[32px] border border-white/80 bg-white/92 p-10 text-center text-sm text-[#64748B] shadow-[0_20px_70px_-36px_rgba(15,23,42,0.28)]">
          Chargement du dossier...
        </div>
      </div>
    );
  }

  if (!request) {
    return (
      <div className="min-h-full bg-[linear-gradient(180deg,#F8FAFC_0%,#FFFFFF_100%)] p-6">
        <div className="rounded-[32px] border border-white/80 bg-white/92 p-10 shadow-[0_20px_70px_-36px_rgba(15,23,42,0.28)]">
          <p className="text-sm font-medium text-[#B91C1C]">
            {errorMessage || "Cette demande est introuvable."}
          </p>
          <Link
            to="/admin/company-requests"
            className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-[#1D4ED8] px-4 py-3 text-sm font-semibold text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Retour a la file</span>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.14),transparent_28%),linear-gradient(180deg,#F8FAFC_0%,#FFFFFF_52%,#EEF6FF_100%)] p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="rounded-[32px] bg-[linear-gradient(145deg,#0F172A_0%,#1E3A8A_42%,#06B6D4_100%)] p-7 text-white shadow-[0_28px_90px_-42px_rgba(15,23,42,0.72)]">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <Link
                to="/admin/company-requests"
                className="inline-flex items-center gap-2 text-sm font-medium text-white/80 hover:text-white"
              >
                <ArrowLeft className="h-4 w-4" />
                <span>Retour a la file des demandes</span>
              </Link>
              <h1 className="mt-5 text-3xl font-semibold tracking-tight">
                Dossier {request.company_name}
              </h1>
              <p className="mt-4 max-w-3xl text-sm leading-7 text-white/80">
                Consultez l'identite du responsable, les informations societe, les justificatifs
                fournis et l'historique avant validation finale.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <RegistrationStatusBadge status={request.status} isDeleted={request.is_deleted} />
              <span className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium">
                {formatRegistrationStatusLabel(request.status, request.is_deleted)}
              </span>
              {canReopen ? (
                <button
                  type="button"
                  onClick={() => setIsReopenDialogOpen(true)}
                  disabled={isActionSubmitting}
                  className="inline-flex items-center gap-2 rounded-2xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white transition-all hover:-translate-y-0.5 hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <RotateCcw className="h-4 w-4" />
                  <span>Reouvrir la demande</span>
                </button>
              ) : null}
              {!request.is_deleted && (request.status === "pending" || request.status === "rejected") ? (
                <button
                  type="button"
                  onClick={() => setIsDeleteDialogOpen(true)}
                  disabled={isActionSubmitting}
                  className="inline-flex items-center gap-2 rounded-2xl bg-[#B91C1C] px-4 py-3 text-sm font-semibold text-white transition-all hover:-translate-y-0.5 hover:bg-[#991B1B] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Trash2 className="h-4 w-4" />
                  <span>Supprimer</span>
                </button>
              ) : null}
              {request.is_deleted ? (
                <button
                  type="button"
                  onClick={() => void handleRestore()}
                  disabled={isActionSubmitting}
                  className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition-all hover:-translate-y-0.5 hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <RotateCcw className="h-4 w-4" />
                  <span>Restaurer</span>
                </button>
              ) : null}
            </div>
          </div>
        </section>

        {errorMessage ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-[#B91C1C]">
            {errorMessage}
          </div>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <Panel title="Responsable du dossier" subtitle="Compte a activer apres approbation.">
            <DetailGrid
              items={[
                { label: "Nom complet", value: request.responsible_full_name, icon: UserRound },
                { label: "Fonction / poste", value: request.job_title, icon: Briefcase },
                {
                  label: "Role demande",
                  value:
                    request.requested_role_label ||
                    formatCompanyRequestedRoleLabel(request.requested_role),
                  icon: ShieldCheck,
                },
                { label: "Email", value: request.responsible_email, icon: Mail },
                { label: "Telephone", value: request.responsible_phone, icon: Phone },
              ]}
            />
          </Panel>

          <Panel title="Etat du dossier" subtitle="Suivi de revision et statut courant.">
            <div className="space-y-4">
              <InfoCard
                label="Statut actuel"
                value={formatRegistrationStatusLabel(request.status, request.is_deleted)}
              />
              <InfoCard label="Soumis le" value={formatDateTime(request.created_at)} />
              <InfoCard label="Derniere mise a jour" value={formatDateTime(request.updated_at)} />
              <InfoCard
                label="Revu par"
                value={request.decision.reviewed_by_name ?? "En attente de traitement"}
              />
              {request.decision.rejection_reason ? (
                <div className="rounded-[24px] border border-red-200 bg-red-50/80 p-4">
                  <p className="text-sm font-semibold text-[#991B1B]">Motif de refus</p>
                  <p className="mt-2 text-sm leading-6 text-[#B91C1C]">
                    {request.decision.rejection_reason}
                  </p>
                </div>
              ) : null}
              {!request.decision.rejection_reason && latestRejectionEntry ? (
                <div className="rounded-[24px] border border-red-200 bg-red-50/80 p-4">
                  <p className="text-sm font-semibold text-[#991B1B]">Dernier motif de refus</p>
                  <p className="mt-2 text-sm leading-6 text-[#B91C1C]">
                    {latestRejectionEntry.comment}
                  </p>
                  <p className="mt-2 text-xs font-medium text-[#B91C1C]">
                    {formatDateTime(latestRejectionEntry.created_at)}
                  </p>
                </div>
              ) : null}
              {request.approved_company_name ? (
                <div className="rounded-[24px] border border-emerald-200 bg-emerald-50/80 p-4">
                  <p className="text-sm font-semibold text-[#065F46]">
                    Entreprise et compte crees
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[#047857]">
                    {request.approved_company_name}
                    {request.approved_admin_email ? ` - ${request.approved_admin_email}` : ""}
                  </p>
                </div>
              ) : null}
            </div>
          </Panel>
        </div>

        <Panel title="Informations entreprise" subtitle="Donnees societe et perimetre telecom declare.">
          <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
            <DetailGrid
              items={[
                { label: "Entreprise", value: request.company_name, icon: Building2 },
                { label: "Secteur", value: request.sector, icon: Building2 },
                { label: "Ville", value: request.city, icon: MapPinned },
                { label: "Telephone entreprise", value: request.company_phone, icon: Phone },
                { label: "ICE", value: request.ice ?? "-", icon: FileBadge2 },
                { label: "RC", value: request.rc ?? "-", icon: FileBadge2 },
                { label: "IF", value: request.tax_id ?? "-", icon: FileBadge2 },
                { label: "CNSS", value: request.cnss ?? "-", icon: FileBadge2 },
                { label: "Patente", value: request.patente ?? "-", icon: FileBadge2 },
                { label: "Site web", value: request.website ?? "-", icon: Mail },
              ]}
            />

            <div className="space-y-4">
              <InfoCard
                label="Lignes telephoniques estimees"
                value={String(request.estimated_phone_lines)}
              />
              <InfoCard label="Nombre d'employes" value={String(request.employees_count)} />
              <InfoCard label="Operateurs" value={request.operators.join(", ")} />
              <InfoCard label="Pays" value={request.country ?? "-"} />
              <InfoCard label="Adresse" value={request.address_line ?? "-"} />
              <InfoCard
                label="Coordonnees"
                value={
                  request.latitude !== null && request.longitude !== null
                    ? `${request.latitude}, ${request.longitude}`
                    : "Non disponibles"
                }
              />
              <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4">
                <p className="text-sm font-semibold text-[#0F172A]">Zones de couverture</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {request.coverage_zones.map((zone) => (
                    <span
                      key={zone}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-[#0F172A]"
                    >
                      {zone}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </Panel>

        <Panel
          title={`Documents justificatifs (${documentCount})`}
          subtitle="Telechargement securise accessible uniquement a la supervision."
        >
          {request.documents.length ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {request.documents.map((document) => (
                <div
                  key={document.key}
                  className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-5"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-[#1D4ED8] shadow-sm">
                    <FileBadge2 className="h-5 w-5" />
                  </div>
                  <p className="mt-4 font-semibold text-[#0F172A]">{document.label}</p>
                  <p className="mt-2 break-all text-sm text-[#64748B]">{document.file_name}</p>
                  <button
                    type="button"
                    onClick={() => void handleDownloadDocument(document.key, document.file_name)}
                    className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-[#1D4ED8] px-4 py-3 text-sm font-semibold text-white transition-all hover:-translate-y-0.5 hover:bg-[#1E40AF]"
                  >
                    <Download className="h-4 w-4" />
                    <span>Telecharger</span>
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-10 text-center text-sm text-[#64748B]">
              Aucun document n'est disponible pour cette demande.
            </div>
          )}
        </Panel>

        <Panel title="Historique" subtitle="Trace des actions et commentaires super admin.">
          {request.history.length ? (
            <div className="space-y-3">
              {request.history.map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-semibold text-[#0F172A]">{entry.title}</p>
                      <p className="mt-1 text-sm text-[#64748B]">
                        {entry.actor_user_name ?? "Systeme"} - {entry.action}
                      </p>
                      {entry.comment ? (
                        <p className="mt-3 text-sm leading-6 text-[#475569]">{entry.comment}</p>
                      ) : null}
                    </div>
                    <span className="text-xs text-[#64748B]">{formatDateTime(entry.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-10 text-center text-sm text-[#64748B]">
              Aucun historique n'est disponible pour cette demande.
            </div>
          )}
        </Panel>

        {canReview ? (
          <Panel title="Actions super admin" subtitle="Confirmation explicite avant validation ou refus.">
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void handleApprove()}
                disabled={isActionSubmitting}
                className="rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isActionSubmitting ? "Traitement..." : "Approuver la demande"}
              </button>
              <button
                type="button"
                onClick={() => setIsRejectDialogOpen(true)}
                disabled={isActionSubmitting}
                className="rounded-2xl bg-[#B91C1C] px-5 py-3 text-sm font-semibold text-white hover:bg-[#991B1B] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Refuser la demande
              </button>
            </div>
          </Panel>
        ) : null}
      </div>

      <RejectRequestDialog
        isOpen={isRejectDialogOpen}
        reason={rejectReason}
        isSubmitting={isActionSubmitting}
        onReasonChange={setRejectReason}
        onClose={() => {
          setRejectReason("");
          setIsRejectDialogOpen(false);
        }}
        onConfirm={() => void handleReject()}
      />
      <ReopenRequestDialog
        isOpen={isReopenDialogOpen}
        reason={reopenReason}
        isSubmitting={isActionSubmitting}
        onReasonChange={setReopenReason}
        onClose={() => {
          setReopenReason("");
          setIsReopenDialogOpen(false);
        }}
        onConfirm={() => void handleReopen()}
      />
      <DeleteRequestDialog
        isOpen={isDeleteDialogOpen}
        isSubmitting={isActionSubmitting}
        companyName={request.company_name}
        isPendingRequest={request.status === "pending"}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={() => void handleDelete()}
      />
    </div>
  );
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[32px] border border-white/80 bg-white/92 p-6 shadow-[0_20px_70px_-36px_rgba(15,23,42,0.28)]">
      <h2 className="text-2xl font-semibold tracking-tight text-[#0F172A]">{title}</h2>
      <p className="mt-2 text-sm leading-7 text-[#64748B]">{subtitle}</p>
      <div className="mt-6">{children}</div>
    </section>
  );
}

function DetailGrid({
  items,
}: {
  items: Array<{ label: string; value: string; icon: typeof UserRound }>;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <div
            key={`${item.label}-${item.value}`}
            className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4"
          >
            <div className="flex items-center gap-3 text-sm text-[#64748B]">
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </div>
            <p className="mt-3 text-sm font-semibold text-[#0F172A]">{item.value}</p>
          </div>
        );
      })}
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4">
      <p className="text-sm text-[#64748B]">{label}</p>
      <p className="mt-2 text-sm font-semibold text-[#0F172A]">{value}</p>
    </div>
  );
}
