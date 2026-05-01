import { ArrowRight, ShieldAlert, Sparkles, Wallet } from "lucide-react";

import type { ApiMobileFleetDevice } from "../../lib/api";
import {
  formatMadValue,
  formatMobileRiskLabel,
  formatPredictionConfidence,
  getDeviceCategoryClasses,
  getMobileRiskClasses,
} from "../../lib/mobile-fleet";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { cn } from "../ui/utils";

type DeviceTone = "critical" | "warning" | "primary";

interface CriticalBudgetDeviceCardProps {
  device: ApiMobileFleetDevice;
  expectedUnitCostMad: number;
  compact?: boolean;
  onOptimize?: (device: ApiMobileFleetDevice) => void;
  onViewDetail?: (device: ApiMobileFleetDevice) => void;
}

function getCardTone(device: ApiMobileFleetDevice, gapPct: number): DeviceTone {
  if (device.risk_level === "Critique" || device.alert_flag || gapPct >= 35) {
    return "critical";
  }

  if (device.risk_level === "Eleve" || gapPct >= 18) {
    return "warning";
  }

  return "primary";
}

function getCardClasses(tone: DeviceTone): string {
  if (tone === "critical") {
    return "bc-surface-danger";
  }

  if (tone === "warning") {
    return "bc-surface-warning";
  }

  return "bc-surface-primary";
}

function getStatusBadgeVariant(tone: DeviceTone): "destructive" | "warning" | "success" {
  if (tone === "critical") {
    return "destructive";
  }

  if (tone === "warning") {
    return "warning";
  }

  return "success";
}

export default function CriticalBudgetDeviceCard({
  device,
  expectedUnitCostMad,
  compact = false,
  onOptimize,
  onViewDetail,
}: CriticalBudgetDeviceCardProps) {
  const gapMad = Math.max(device.estimated_price_mad - expectedUnitCostMad, 0);
  const gapPct = expectedUnitCostMad > 0 ? (gapMad / expectedUnitCostMad) * 100 : 0;
  const tone = getCardTone(device, gapPct);
  const confidenceSource = device.confidence_score ?? device.prediction_confidence ?? null;
  const confidenceLabel =
    confidenceSource !== null && confidenceSource > 0
      ? formatPredictionConfidence(Math.max(confidenceSource, 0))
      : null;

  return (
    <article
      className={cn(
        "rounded-[24px] border p-5 shadow-[0_14px_34px_rgba(15,23,42,0.05)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_20px_42px_rgba(15,23,42,0.1)]",
        getCardClasses(tone),
        compact ? "h-full" : "h-full",
      )}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={cn("px-2.5 py-1", getMobileRiskClasses(device.risk_level))}>
              {formatMobileRiskLabel(device.risk_level)}
            </Badge>
            {device.alert_flag ? (
              <Badge variant="destructive">Surcout</Badge>
            ) : null}
            <Badge className={cn("px-2.5 py-1", getDeviceCategoryClasses(device.device_category))}>
              {device.device_category}
            </Badge>
            {confidenceLabel ? (
              <Badge variant="outline" className="bg-white/90">
                {confidenceLabel} confiance
              </Badge>
            ) : null}
          </div>

          <h3 className="mt-3 text-lg font-semibold text-[var(--bc-neutral-strong)]">Appareil-{device.fleet_row_id}</h3>
          <p className="mt-2 text-sm leading-6 text-[var(--bc-neutral-body)]">
            {device.operator} - {device.department} - {device.employee_profile}
          </p>
        </div>

        <div className="rounded-2xl border border-white/90 bg-white/90 px-4 py-3 text-left lg:min-w-[180px] lg:text-right">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--bc-neutral-muted)]">Cout actuel</p>
          <p className="mt-2 text-xl font-bold text-[var(--bc-neutral-strong)]">{formatMadValue(device.estimated_price_mad)}</p>
          <p className="mt-2 text-sm font-semibold text-[var(--bc-danger)]">
            +{formatMadValue(gapMad)} / +{gapPct.toFixed(1)}%
          </p>
        </div>
      </div>

      <div className={cn("mt-4 grid gap-3", compact ? "md:grid-cols-2" : "lg:grid-cols-[1.25fr_0.85fr]")}>
        <div className="rounded-2xl border border-white/90 bg-white/88 p-4">
          <div className="flex items-center gap-2 text-[var(--bc-ai-start)]">
            <Sparkles className="h-4 w-4" />
            <p className="text-xs font-semibold uppercase tracking-[0.14em]">Recommandation</p>
          </div>
          <p className="mt-2 text-sm font-medium leading-6 text-[var(--bc-neutral-strong)]">
            {device.ai_recommendation || device.suggested_action || device.recommendation}
          </p>
          <p className="mt-3 text-sm leading-6 text-[var(--bc-neutral-body)]">{device.description}</p>
        </div>

        <div className="rounded-2xl border border-white/90 bg-white/88 p-4">
          <div className="flex items-center gap-2 text-[var(--bc-neutral-body)]">
            <Wallet className="h-4 w-4" />
            <p className="text-xs font-semibold uppercase tracking-[0.14em]">Lecture rapide</p>
          </div>
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[var(--bc-neutral-body)]">Budget optimal</span>
              <span className="font-semibold text-[var(--bc-neutral-strong)]">{formatMadValue(expectedUnitCostMad)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[var(--bc-neutral-body)]">Impact</span>
              <Badge variant={getStatusBadgeVariant(tone)}>{device.impact}</Badge>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[var(--bc-neutral-body)]">Statut</span>
              <Badge variant={getStatusBadgeVariant(tone)}>{device.predicted_price_label}</Badge>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        {onOptimize ? (
          <Button type="button" className="rounded-2xl px-4 py-2.5 text-sm font-semibold" onClick={() => onOptimize(device)}>
            <ShieldAlert className="h-4 w-4" />
            Optimiser forfait
          </Button>
        ) : null}
        {onViewDetail ? (
          <Button type="button" variant="outline" className="rounded-2xl px-4 py-2.5 text-sm font-semibold" onClick={() => onViewDetail(device)}>
            Voir detail
            <ArrowRight className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
    </article>
  );
}
