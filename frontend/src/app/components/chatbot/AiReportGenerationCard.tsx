import {
  Download,
  Eye,
  FileText,
  LoaderCircle,
  Share2,
  Sparkles,
} from "lucide-react";

import type { ApiReportGenerateResponse, ApiReportType } from "../../lib/api";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { cn } from "../ui/utils";

interface AiReportGenerationCardProps {
  selectedReportType: ApiReportType;
  onSelectReportType: (value: ApiReportType) => void;
  onGenerate: () => void;
  onPreview: () => void;
  onDownload: () => void;
  onShare: () => void;
  onExport: () => void;
  isGenerating?: boolean;
  loadingLabel?: string | null;
  latestReport?: ApiReportGenerateResponse | null;
  error?: string | null;
  multimodalCount?: number;
  exportImageCount?: number;
  hasExecutiveContext?: boolean;
  hasExplainabilityContext?: boolean;
}

const REPORT_OPTIONS: Array<{
  value: ApiReportType;
  label: string;
  description: string;
}> = [
  {
    value: "executive",
    label: "Rapport executif",
    description: "Synthese DSI, score flotte, risques et recommandations prioritaires.",
  },
  {
    value: "anomalies",
    label: "Rapport anomalies",
    description: "Zones rouges, heatmap risque et analyse detaillee des anomalies.",
  },
  {
    value: "fraud",
    label: "Rapport fraude",
    description: "Signaux suspects, exposition potentielle et actions de controle.",
  },
  {
    value: "equipment",
    label: "Rapport equipements",
    description: "Obsolescence, maintenance, criticite et remplacements prioritaires.",
  },
  {
    value: "workflow",
    label: "Rapport workflow",
    description: "Complexite des processus, goulets et opportunites d'automatisation.",
  },
  {
    value: "cost_optimization",
    label: "Rapport optimisation couts",
    description: "Leviers d'economies, forfaits a reduire et actions budgetaires.",
  },
  {
    value: "live",
    label: "Rapport surveillance live",
    description: "Vue dynamique des alertes, risques et evenements en cours.",
  },
  {
    value: "complete",
    label: "Rapport complet IA",
    description: "Pack premium avec scoring, XAI, images annotees et plan d'action.",
  },
];

function formatConversationDate(value: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function getReportLabel(value: ApiReportType): string {
  return REPORT_OPTIONS.find((option) => option.value === value)?.label ?? "Rapport IA";
}

export default function AiReportGenerationCard({
  selectedReportType,
  onSelectReportType,
  onGenerate,
  onPreview,
  onDownload,
  onShare,
  onExport,
  isGenerating = false,
  loadingLabel,
  latestReport = null,
  error = null,
  multimodalCount = 0,
  exportImageCount = 0,
  hasExecutiveContext = false,
  hasExplainabilityContext = false,
}: AiReportGenerationCardProps) {
  const activeOption =
    REPORT_OPTIONS.find((option) => option.value === selectedReportType) ?? REPORT_OPTIONS[0];
  const hasGeneratedReport = latestReport !== null;

  return (
    <div className="overflow-hidden rounded-[24px] border border-[var(--bc-ai-border)] bg-[linear-gradient(135deg,rgba(14,165,233,0.1),rgba(37,99,235,0.08),rgba(255,255,255,0.96))] shadow-[0_18px_38px_-28px_rgba(37,99,235,0.42)] dark:bg-[linear-gradient(135deg,rgba(14,165,233,0.16),rgba(8,16,31,0.96),rgba(8,16,31,0.98))]">
      <div className="border-b border-[var(--bc-ai-border)] px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="border border-[var(--bc-ai-border)] bg-white/82 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--bc-ai-start)] dark:bg-[#08101f]">
                <FileText className="mr-1.5 h-3.5 w-3.5" />
                Rapport IA PDF
              </Badge>
              <Badge variant="outline" className="bg-white/70 text-[11px] dark:bg-[#08101f]">
                {multimodalCount} analyse(s) IA
              </Badge>
              <Badge variant="outline" className="bg-white/70 text-[11px] dark:bg-[#08101f]">
                {exportImageCount} image(s) annotee(s)
              </Badge>
              {hasExecutiveContext ? (
                <Badge variant="outline" className="bg-white/70 text-[11px] dark:bg-[#08101f]">
                  Executive context
                </Badge>
              ) : null}
              {hasExplainabilityContext ? (
                <Badge variant="outline" className="bg-white/70 text-[11px] dark:bg-[#08101f]">
                  XAI active
                </Badge>
              ) : null}
            </div>

            <h3 className="mt-3 text-lg font-semibold text-[var(--bc-neutral-body)]">
              Generer un rapport executif intelligent en PDF
            </h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--bc-neutral-body)]">
              Le rapport consolide les KPI telecom, le Fleet Health Score, les risques,
              les anomalies, les recommandations IA et les elements visuels disponibles.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              onClick={onGenerate}
              disabled={isGenerating}
              className="rounded-full border-0 bg-[linear-gradient(135deg,var(--bc-ai-start),var(--bc-ai-end))] text-white shadow-[0_16px_28px_-18px_rgba(37,99,235,0.55)]"
            >
              {isGenerating ? (
                <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" />
              )}
              Generer rapport IA
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="rounded-[20px] border border-[var(--bc-neutral-border)] bg-white/82 px-4 py-4 dark:bg-[#08101f]/92">
            <label className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
              Type de rapport
            </label>
            <select
              value={selectedReportType}
              onChange={(event) => onSelectReportType(event.target.value as ApiReportType)}
              className="mt-3 h-11 w-full rounded-2xl border border-[var(--bc-neutral-border)] bg-[var(--bg-card)] px-3 text-sm text-[var(--bc-neutral-body)] outline-none"
            >
              {REPORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="mt-3 text-sm leading-6 text-[var(--bc-neutral-muted)]">
              {activeOption.description}
            </p>

            {isGenerating ? (
              <div className="mt-4 rounded-[18px] border border-[var(--bc-ai-border)] bg-[var(--bc-ai-soft)]/65 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--bc-ai-start)]">
                  Generation en cours
                </p>
                <p className="mt-1 text-sm font-semibold text-[var(--bc-neutral-body)]">
                  {loadingLabel ?? "Construction du rapport IA..."}
                </p>
              </div>
            ) : null}

            {error ? (
              <div className="mt-4 rounded-[18px] border border-[#FCA5A5]/60 bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B] dark:border-[#7F1D1D] dark:bg-[#2A0A0A] dark:text-[#FCA5A5]">
                {error}
              </div>
            ) : null}
          </div>

          <div className="rounded-[20px] border border-[var(--bc-neutral-border)] bg-white/82 px-4 py-4 dark:bg-[#08101f]/92">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
              Derniere generation
            </p>
            {hasGeneratedReport ? (
              <>
                <p className="mt-3 text-base font-semibold text-[var(--bc-neutral-body)]">
                  {getReportLabel(latestReport.report_type)}
                </p>
                <p className="mt-2 text-sm text-[var(--bc-neutral-muted)]">
                  Genere le {formatConversationDate(latestReport.generated_at)}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Badge variant="outline" className="bg-white/70 text-[11px] dark:bg-[#08101f]">
                    Fleet Health {latestReport.fleet_health_score}/100
                  </Badge>
                  <Badge variant="outline" className="bg-white/70 text-[11px] dark:bg-[#08101f]">
                    ID {latestReport.report_id.slice(0, 8)}
                  </Badge>
                </div>
              </>
            ) : (
              <p className="mt-3 text-sm leading-6 text-[var(--bc-neutral-muted)]">
                Aucun PDF genere pour le moment. Selectionnez un type de rapport puis lancez la
                construction du document IA.
              </p>
            )}

            <div className="mt-5 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={onPreview}
                disabled={!hasGeneratedReport || isGenerating}
                className="rounded-full bg-white/80 dark:bg-[#08101f]"
              >
                <Eye className="mr-2 h-4 w-4" />
                Previsualiser PDF
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={onDownload}
                disabled={!hasGeneratedReport || isGenerating}
                className="rounded-full bg-white/80 dark:bg-[#08101f]"
              >
                <Download className="mr-2 h-4 w-4" />
                Telecharger PDF
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={onShare}
                disabled={!hasGeneratedReport || isGenerating}
                className="rounded-full bg-white/80 dark:bg-[#08101f]"
              >
                <Share2 className="mr-2 h-4 w-4" />
                Partager PDF
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={onExport}
                disabled={!hasGeneratedReport || isGenerating}
                className={cn(
                  "rounded-full bg-white/80 dark:bg-[#08101f]",
                  hasGeneratedReport ? "border-[var(--bc-ai-border)] text-[var(--bc-ai-start)]" : "",
                )}
              >
                <FileText className="mr-2 h-4 w-4" />
                Exporter PDF
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
