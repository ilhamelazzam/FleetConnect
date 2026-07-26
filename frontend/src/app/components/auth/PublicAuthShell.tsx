import type { ReactNode } from "react";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { Link } from "react-router";

import logoImage from "../../../assets/2285601bb4e4d491e253f51df33e674aefdb2011.png";

interface PublicAuthStat {
  label: string;
  value: string;
  hint?: string;
}

interface PublicAuthShellProps {
  backHref?: string;
  backLabel?: string;
  topAction?: ReactNode;
  asideBadge: string;
  asideTitle: string;
  asideDescription: string;
  asidePoints: string[];
  asideStats?: PublicAuthStat[];
  contentBadge?: string;
  contentTitle: string;
  contentDescription: string;
  children: ReactNode;
}

export default function PublicAuthShell({
  backHref = "/",
  backLabel = "Retour a l'accueil",
  topAction,
  asideBadge,
  asideTitle,
  asideDescription,
  asidePoints,
  asideStats = [],
  contentBadge,
  contentTitle,
  contentDescription,
  children,
}: PublicAuthShellProps) {
  return (
    <div className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.18),transparent_28%),radial-gradient(circle_at_top_right,rgba(124,58,237,0.16),transparent_24%),linear-gradient(180deg,#F8FAFC_0%,#FFFFFF_50%,#EEF2FF_100%)] px-4 py-5 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            to={backHref}
            className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/80 px-4 py-2 text-sm font-medium text-[#1D4ED8] shadow-[0_12px_28px_-22px_rgba(15,23,42,0.42)] backdrop-blur hover:border-[#BFDBFE] hover:text-[#1E40AF]"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>{backLabel}</span>
          </Link>

          {topAction ? <div className="text-sm text-[#475569]">{topAction}</div> : null}
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)] xl:grid-cols-[400px_minmax(0,1fr)]">
          <aside className="overflow-hidden rounded-[34px] border border-white/15 bg-[linear-gradient(155deg,#0F172A_0%,#1D4ED8_50%,#7C3AED_100%)] p-6 text-white shadow-[0_32px_90px_-44px_rgba(15,23,42,0.88)]">
            <div className="flex items-center gap-3">
              <div className="rounded-[22px] border border-white/15 bg-white/10 p-2.5 backdrop-blur">
                <img src={logoImage} alt="BC SKILLS" className="h-11 w-11 rounded-2xl object-cover" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-white/60">FleetConnect IA</p>
                <p className="mt-1 text-sm font-medium text-white/90">BC SKILLS Workspace</p>
              </div>
            </div>

            <div className="mt-8 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white/90">
              <span>{asideBadge}</span>
            </div>

            <h1 className="mt-6 text-3xl font-semibold tracking-tight">{asideTitle}</h1>
            <p className="mt-4 text-sm leading-7 text-white/78">{asideDescription}</p>

            <div className="mt-8 space-y-3">
              {asidePoints.map((point) => (
                <div
                  key={point}
                  className="flex items-start gap-3 rounded-[24px] border border-white/10 bg-white/8 px-4 py-3 backdrop-blur"
                >
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl bg-white/15 text-white">
                    <CheckCircle2 className="h-4 w-4" />
                  </div>
                  <p className="text-sm leading-6 text-white/84">{point}</p>
                </div>
              ))}
            </div>

            {asideStats.length ? (
              <div className="mt-8 grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
                {asideStats.map((stat) => (
                  <div
                    key={stat.label}
                    className="rounded-[24px] border border-white/12 bg-white/10 px-4 py-4 backdrop-blur"
                  >
                    <p className="text-[11px] uppercase tracking-[0.2em] text-white/58">{stat.label}</p>
                    <p className="mt-2 text-2xl font-semibold">{stat.value}</p>
                    {stat.hint ? (
                      <p className="mt-2 text-xs leading-5 text-white/70">{stat.hint}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </aside>

          <section className="rounded-[34px] border border-white/80 bg-white/92 p-6 shadow-[0_28px_90px_-42px_rgba(15,23,42,0.28)] backdrop-blur-xl sm:p-8 lg:p-10">
            {contentBadge ? (
              <div className="inline-flex items-center gap-2 rounded-full border border-[#BFDBFE] bg-[#EFF6FF] px-4 py-2 text-sm font-medium text-[#1D4ED8]">
                <span>{contentBadge}</span>
              </div>
            ) : null}

            <h2 className="mt-5 text-3xl font-semibold tracking-tight text-[#0F172A] sm:text-4xl">
              {contentTitle}
            </h2>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-[#475569] sm:text-[15px]">
              {contentDescription}
            </p>

            <div className="mt-8">{children}</div>
          </section>
        </div>
      </div>
    </div>
  );
}
