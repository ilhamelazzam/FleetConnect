import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Building2,
  CheckCircle2,
  Eye,
  EyeOff,
  IdCard,
  Lock,
  Mail,
  Phone,
  ShieldCheck,
  UserRound,
  Users2,
} from "lucide-react";
import { Link, useSearchParams } from "react-router";

import PublicAuthShell from "../components/auth/PublicAuthShell";
import {
  ApiError,
  formatRoleLabel,
  invitationsApi,
  type AcceptInvitationResponse,
  type InvitationValidationResponse,
} from "../lib/api";

const PASSWORD_POLICY = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,128}$/;

function RegisterField({
  label,
  icon,
  type = "text",
  value,
  onChange,
  placeholder,
  helper,
  disabled = false,
  required = true,
  rightAction,
}: {
  label: string;
  icon: typeof Mail;
  type?: "email" | "password" | "text" | "tel";
  value: string;
  onChange?: (value: string) => void;
  placeholder: string;
  helper?: string;
  disabled?: boolean;
  required?: boolean;
  rightAction?: ReactNode;
}) {
  const Icon = icon;

  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-[#0F172A]">{label}</span>
      <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 transition-all focus-within:border-[#2563EB] focus-within:ring-4 focus-within:ring-blue-100">
        <Icon className="h-5 w-5 text-[#64748B]" />
        <input
          type={type}
          value={value}
          onChange={onChange ? (event) => onChange(event.target.value) : undefined}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          className="w-full bg-transparent text-sm text-[#0F172A] outline-none placeholder:text-[#94A3B8] disabled:cursor-not-allowed"
        />
        {rightAction}
      </div>
      {helper ? <p className="mt-2 text-xs leading-5 text-[#64748B]">{helper}</p> : null}
    </label>
  );
}

function formatExpiration(value: string): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export default function Register() {
  const [searchParams] = useSearchParams();
  const invitationToken = useMemo(() => searchParams.get("token")?.trim() ?? "", [searchParams]);

  const [companyName, setCompanyName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [department, setDepartment] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [role, setRole] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [invitation, setInvitation] = useState<InvitationValidationResponse | null>(null);
  const [requestResult, setRequestResult] = useState<AcceptInvitationResponse | null>(null);
  const [isLoadingInvitation, setIsLoadingInvitation] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!invitationToken) {
      setInvitation(null);
      setErrorMessage("Le lien d'inscription est incomplet. Utilisez l'invitation recue par email.");
      setIsLoadingInvitation(false);
      return;
    }

    let cancelled = false;

    const loadInvitation = async () => {
      setIsLoadingInvitation(true);
      setErrorMessage("");

      try {
        const invitationPayload = await invitationsApi.validate(invitationToken);
        if (cancelled) {
          return;
        }

        setInvitation(invitationPayload);
        setCompanyName(invitationPayload.company_name);
        setFullName(invitationPayload.full_name);
        setEmail(invitationPayload.email);
        setPhone(invitationPayload.phone ?? "");
        setDepartment(invitationPayload.department);
        setJobTitle(invitationPayload.job_title);
        setRole(formatRoleLabel(invitationPayload.role));
        setExpiresAt(invitationPayload.expires_at);
      } catch (error) {
        if (cancelled) {
          return;
        }

        setInvitation(null);
        if (error instanceof ApiError) {
          setErrorMessage(error.message);
        } else {
          setErrorMessage("Impossible de verifier cette invitation pour le moment.");
        }
      } finally {
        if (!cancelled) {
          setIsLoadingInvitation(false);
        }
      }
    };

    void loadInvitation();

    return () => {
      cancelled = true;
    };
  }, [invitationToken]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");

    if (!invitationToken) {
      setErrorMessage("Le lien d'invitation est manquant.");
      return;
    }

    if (!invitation) {
      setErrorMessage("L'invitation doit etre validee avant de finaliser l'inscription.");
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage("Les mots de passe ne correspondent pas.");
      return;
    }

    if (!PASSWORD_POLICY.test(password)) {
      setErrorMessage(
        "Le mot de passe doit contenir 8 caracteres minimum, une majuscule, une minuscule et un chiffre.",
      );
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await invitationsApi.accept({
        token: invitationToken,
        password,
        phone: phone.trim() || null,
      });
      setRequestResult(result);
    } catch (error) {
      if (error instanceof ApiError) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage("L'activation du compte n'a pas pu etre finalisee.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (requestResult) {
    return (
      <PublicAuthShell
        backHref="/login"
        backLabel="Retour au login"
        topAction={
          <div className="flex flex-wrap items-center gap-2">
            <span>Votre compte est actif.</span>
            <Link to="/login" className="font-semibold text-[#1D4ED8] hover:text-[#1E40AF]">
              Se connecter
            </Link>
          </div>
        }
        asideBadge="Invitation finalisee"
        asideTitle="Votre acces collaborateur est maintenant ouvert."
        asideDescription="L'invitation a ete validee et votre compte peut etre utilise immediatement depuis l'ecran de connexion."
        asidePoints={[
          "Le rattachement a l'entreprise a ete applique automatiquement.",
          "Le departement, le poste et le role proviennent de l'invitation admin.",
          "Vous pouvez vous connecter avec le meme email professionnel des maintenant.",
        ]}
        asideStats={[
          { label: "Entreprise", value: requestResult.company_name || "BC SKILLS" },
          { label: "Statut", value: "Actif" },
          { label: "Acces", value: "Immediate" },
        ]}
        contentBadge="Compte active"
        contentTitle="Votre inscription est terminee."
        contentDescription="Votre acces collaborateur est maintenant actif. Vous pouvez acceder a FleetConnect IA avec vos identifiants."
      >
        <div className="space-y-5">
          <div className="rounded-[30px] border border-emerald-200 bg-emerald-50/80 p-6">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-[#059669] shadow-sm">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm font-semibold text-[#065F46]">Activation confirmee</p>
                <h3 className="mt-2 text-2xl font-semibold tracking-tight text-[#0F172A]">
                  {requestResult.message}
                </h3>
                <p className="mt-3 text-sm leading-7 text-[#475569]">
                  Vous pouvez maintenant vous connecter sur{" "}
                  <span className="font-semibold text-[#0F172A]">
                    {requestResult.company_name || companyName}
                  </span>
                  .
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Link
              to="/login"
              className="rounded-2xl bg-[linear-gradient(135deg,#2563EB_0%,#7C3AED_100%)] px-5 py-3 text-center text-sm font-semibold text-white shadow-[0_18px_34px_-18px_rgba(99,102,241,0.45)] transition-all hover:-translate-y-0.5"
            >
              Aller au login
            </Link>
            <Link
              to="/choose-profile"
              className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-center text-sm font-semibold text-[#0F172A] transition-all hover:-translate-y-0.5 hover:bg-slate-50"
            >
              Voir les autres parcours
            </Link>
          </div>
        </div>
      </PublicAuthShell>
    );
  }

  return (
    <PublicAuthShell
      backHref="/login"
      backLabel="Retour au login"
      topAction={
        <div className="flex flex-wrap items-center gap-2">
          <span>Vous avez deja un compte ?</span>
          <Link to="/login" className="font-semibold text-[#1D4ED8] hover:text-[#1E40AF]">
            Se connecter
          </Link>
        </div>
      }
      asideBadge="Invitation securisee"
      asideTitle="Finalisez votre acces collaborateur depuis votre email."
      asideDescription="Cette page finalise une invitation nominative envoyee par l'administrateur de votre entreprise. Les informations professionnelles sont deja verifiees et rattachees au bon espace."
      asidePoints={[
        "Le formulaire lit directement le token securise recu par email.",
        "Les champs entreprise, nom, email, departement, poste et role sont verrouilles.",
        "Seul le mot de passe et le telephone optionnel restent modifiables avant activation.",
      ]}
      asideStats={[
        { label: "Validation", value: isLoadingInvitation ? "En cours" : invitation ? "OK" : "Erreur" },
        { label: "Entreprise", value: companyName || "En attente" },
        { label: "Expiration", value: expiresAt ? formatExpiration(expiresAt) : "A verifier" },
      ]}
      contentBadge="Inscription invitee"
      contentTitle="Activez votre compte collaborateur."
      contentDescription="Utilisez le lien recu par email pour confirmer votre acces et finaliser votre rattachement professionnel a FleetConnect IA."
    >
      <div className="rounded-[30px] border border-[#DBEAFE] bg-[linear-gradient(135deg,#EFF6FF_0%,#EEF2FF_100%)] p-5 text-sm text-[#334155]">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-[#1D4ED8] shadow-sm">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <p className="font-semibold text-[#0F172A]">Acces par invitation</p>
            <p className="mt-2 leading-6">
              Votre acces sera active directement en statut actif des que vous validerez ce formulaire.
            </p>
          </div>
        </div>
      </div>

      {errorMessage ? (
        <div className="mt-6 rounded-[28px] border border-red-200 bg-red-50 px-5 py-4 text-sm text-[#B91C1C]">
          {errorMessage}
        </div>
      ) : null}

      {isLoadingInvitation ? (
        <div className="mt-6 rounded-[28px] border border-slate-200 bg-slate-50 px-5 py-10 text-center text-sm text-[#64748B]">
          Verification de votre invitation en cours...
        </div>
      ) : invitation ? (
        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <div className="rounded-[30px] border border-slate-200 bg-slate-50/70 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[#0F172A]">Invitation validee</p>
                <p className="mt-1 text-sm leading-6 text-[#64748B]">
                  Envoyee pour <span className="font-semibold text-[#0F172A]">{companyName}</span> et
                  valable jusqu'au {formatExpiration(expiresAt)}.
                </p>
              </div>
              <span className="rounded-full border border-[#BBF7D0] bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-[#15803D]">
                Pret a activer
              </span>
            </div>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <RegisterField
              label="Entreprise"
              icon={Building2}
              value={companyName}
              placeholder="Entreprise"
              disabled
            />
            <RegisterField
              label="Role applicatif"
              icon={ShieldCheck}
              value={role}
              placeholder="Role"
              disabled
            />
            <RegisterField
              label="Nom complet"
              icon={UserRound}
              value={fullName}
              placeholder="Nom complet"
              disabled
            />
            <RegisterField
              label="Telephone (optionnel)"
              icon={Phone}
              type="tel"
              value={phone}
              onChange={setPhone}
              placeholder="+212 6 00 00 00 00"
              helper="Vous pouvez ajouter ou corriger votre numero avant activation."
              required={false}
            />
            <RegisterField
              label="Email professionnel"
              icon={Mail}
              type="email"
              value={email}
              placeholder="Email professionnel"
              disabled
            />
            <RegisterField
              label="Departement"
              icon={Users2}
              value={department}
              placeholder="Departement"
              disabled
            />
            <RegisterField
              label="Poste"
              icon={IdCard}
              value={jobTitle}
              placeholder="Poste"
              disabled
            />
            <RegisterField
              label="Mot de passe"
              icon={Lock}
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={setPassword}
              placeholder="Choisissez un mot de passe"
              helper="8 caracteres minimum, avec majuscule, minuscule et chiffre."
              rightAction={
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  className="text-[#64748B] transition-colors hover:text-[#0F172A]"
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              }
            />
            <RegisterField
              label="Confirmation mot de passe"
              icon={Lock}
              type={showConfirmPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={setConfirmPassword}
              placeholder="Confirmez votre mot de passe"
              rightAction={
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((current) => !current)}
                  className="text-[#64748B] transition-colors hover:text-[#0F172A]"
                >
                  {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              }
            />
          </div>

          <div className="flex flex-wrap justify-end gap-3">
            <Link
              to="/login"
              className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-[#475569] transition-all hover:-translate-y-0.5 hover:bg-[#F8FAFC]"
            >
              Annuler
            </Link>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#2563EB_0%,#7C3AED_100%)] px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_34px_-18px_rgba(99,102,241,0.45)] transition-all hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-65"
            >
              {isSubmitting ? "Activation..." : "Activer mon compte"}
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-6 rounded-[28px] border border-slate-200 bg-slate-50 px-5 py-10 text-center text-sm text-[#64748B]">
          Utilisez le lien d'invitation recu par email pour acceder a ce formulaire securise.
        </div>
      )}
    </PublicAuthShell>
  );
}
