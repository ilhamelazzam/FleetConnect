import { ArrowRight, Building2, ShieldCheck, Users2 } from "lucide-react";
import { Link } from "react-router";

import PublicAuthShell from "../components/auth/PublicAuthShell";

const profileCards = [
  {
    title: "Creer une entreprise",
    description:
      "Soumettez votre dossier, configurez votre flotte et lancez l'espace SaaS de votre organisation.",
    href: "/register-company",
    icon: Building2,
    eyebrow: "Parcours administrateur",
    points: [
      "Creation du workspace entreprise",
      "Validation du dossier par le super administrateur",
      "Activation du compte admin entreprise apres approbation",
    ],
    ctaLabel: "Creer mon entreprise",
  },
  {
    title: "Rejoindre une entreprise existante",
    description:
      "Inscrivez-vous comme collaborateur via votre domaine email professionnel ou un code d'invitation.",
    href: "/register",
    icon: Users2,
    eyebrow: "Parcours collaborateur",
    points: [
      "Detection automatique de l'entreprise",
      "Demande envoyee a l'administrateur de votre entreprise",
      "Compte en attente jusqu'a validation",
    ],
    ctaLabel: "Rejoindre mon entreprise",
  },
];

export default function ChooseProfile() {
  return (
    <PublicAuthShell
      backHref="/"
      backLabel="Retour a l'accueil"
      topAction={
        <div className="flex flex-wrap items-center gap-2">
          <span>Vous avez deja un compte ?</span>
          <Link to="/login" className="font-semibold text-[#1D4ED8] hover:text-[#1E40AF]">
            Connexion
          </Link>
        </div>
      }
      asideBadge="Onboarding SaaS"
      asideTitle="Choisissez votre porte d'entree dans FleetConnect IA."
      asideDescription="Le demarrage se fait maintenant en deux parcours distincts, comme sur un SaaS moderne: creation du workspace entreprise ou demande d'acces collaborateur."
      asidePoints={[
        "Un onboarding plus clair pour les administrateurs entreprise et les collaborateurs.",
        "Une page de login unique ensuite pour tous les roles: administrateur, manager, analyste et employe.",
        "Un theme premium coherent avec la landing page et le dashboard.",
      ]}
      asideStats={[
        { label: "Parcours", value: "2" },
        { label: "Login unique", value: "JWT" },
        { label: "Validation", value: "Admin" },
      ]}
      contentBadge="Choisissez votre profil"
      contentTitle="Choisissez votre profil."
      contentDescription="Selectionnez le parcours qui correspond a votre besoin. Le bouton Commencer de la landing passe maintenant toujours par cette etape avant Register Company ou Register User."
    >
      <div className="grid gap-5 xl:grid-cols-2">
        {profileCards.map((card) => {
          const Icon = card.icon;

          return (
            <div
              key={card.title}
              className="group rounded-[30px] border border-slate-200 bg-[linear-gradient(180deg,#FFFFFF_0%,#F8FAFC_100%)] p-6 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.32)] transition-all hover:-translate-y-1.5 hover:border-[#C7D2FE] hover:shadow-[0_28px_80px_-42px_rgba(37,99,235,0.32)]"
            >
              <div className="flex h-14 w-14 items-center justify-center rounded-[22px] bg-[linear-gradient(135deg,#DBEAFE_0%,#EDE9FE_100%)] text-[#1D4ED8]">
                <Icon className="h-6 w-6" />
              </div>

              <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-[#64748B]">
                <span>{card.eyebrow}</span>
              </div>

              <h3 className="mt-5 text-2xl font-semibold tracking-tight text-[#0F172A]">
                {card.title}
              </h3>
              <p className="mt-3 text-sm leading-7 text-[#475569]">{card.description}</p>

              <div className="mt-5 space-y-3">
                {card.points.map((point) => (
                  <div key={point} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-[#334155]">
                    {point}
                  </div>
                ))}
              </div>

              <Link
                to={card.href}
                className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-[linear-gradient(135deg,#2563EB_0%,#7C3AED_100%)] px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_34px_-18px_rgba(99,102,241,0.45)] transition-all group-hover:-translate-y-0.5"
              >
                <span>{card.ctaLabel}</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          );
        })}
      </div>

      <div className="mt-6 rounded-[28px] border border-[#BFDBFE] bg-[linear-gradient(135deg,#EFF6FF_0%,#EEF2FF_100%)] p-5 text-sm text-[#334155]">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white text-[#1D4ED8] shadow-sm">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <p className="font-semibold text-[#0F172A]">Navigation cible</p>
            <p className="mt-2 leading-6">
              Landing Page {"->"} Choisir votre profil {"->"} Register Company ou Register User.
              Le bouton <span className="font-semibold">Connexion</span> reste un acces direct vers le login.
            </p>
          </div>
        </div>
      </div>
    </PublicAuthShell>
  );
}
