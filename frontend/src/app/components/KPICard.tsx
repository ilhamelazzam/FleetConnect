import { ArrowDownRight, ArrowUpRight, LucideIcon } from "lucide-react";

import { cn } from "./ui/utils";

interface KPICardProps {
  title: string;
  value: string;
  description?: string;
  trend?: string;
  trendUp?: boolean;
  icon: LucideIcon;
  color?: "blue" | "green" | "orange" | "red" | "purple" | "cyan";
  emphasis?: "default" | "strong";
  variant?: "default" | "total-lines";
  density?: "default" | "compact";
}

const colorClasses = {
  blue: {
    card: "bc-surface-primary",
    icon: "bc-icon-primary",
  },
  green: {
    card: "bc-surface-success",
    icon: "bc-icon-success",
  },
  orange: {
    card: "bc-surface-warning",
    icon: "bc-icon-warning",
  },
  red: {
    card: "bc-surface-danger",
    icon: "bc-icon-danger",
  },
  purple: {
    card: "bc-surface-ai",
    icon: "bc-icon-ai",
  },
  cyan: {
    card: "bc-surface-primary",
    icon: "bc-icon-primary",
  },
};

export default function KPICard({
  title,
  value,
  description,
  trend,
  trendUp,
  icon: Icon,
  color = "blue",
  emphasis = "default",
  variant = "default",
  density = "default",
}: KPICardProps) {
  const TrendIcon = trendUp ? ArrowUpRight : ArrowDownRight;
  const palette = colorClasses[color];

  if (variant === "total-lines") {
    return (
      <div
        className={cn(
          "min-h-[220px] rounded-[28px] border p-6 shadow-[0_24px_48px_-36px_rgba(15,23,42,0.5)] transition-shadow hover:shadow-[0_30px_60px_-40px_rgba(15,23,42,0.55)]",
          palette.card,
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <p className="max-w-[9ch] text-[18px] font-medium leading-[1.35] text-[var(--bc-neutral-body)] sm:text-[20px]">
            {title}
          </p>
          <div className={cn("flex h-16 w-16 items-center justify-center rounded-[18px]", palette.icon)}>
            <Icon className="h-8 w-8" strokeWidth={2.2} />
          </div>
        </div>

        <p className="mt-6 text-[46px] font-semibold leading-none tracking-[-0.04em] text-[var(--bc-neutral-strong)] sm:text-[52px]">
          {value}
        </p>

        {trend ? (
          <div className="mt-7 flex max-w-[11ch] items-start gap-2 text-[18px] font-semibold leading-[1.35] text-[#16A34A]">
            <TrendIcon className="mt-1 h-5 w-5 shrink-0" strokeWidth={2.4} />
            <span>{trend}</span>
          </div>
        ) : null}
      </div>
    );
  }

  const isStrong = emphasis === "strong";
  const isCompact = density === "compact";

  return (
    <div
      className={cn(
        "rounded-2xl border transition-shadow hover:shadow-lg",
        palette.card,
        isStrong
          ? isCompact
            ? "min-h-[132px] p-4 shadow-[0_16px_34px_-28px_rgba(15,23,42,0.35)]"
            : "min-h-[152px] p-5 shadow-[0_20px_45px_-34px_rgba(15,23,42,0.35)]"
          : isCompact
            ? "min-h-[124px] p-4 shadow-sm"
            : "min-h-[144px] p-5 shadow-sm",
      )}
    >
      <div className={`flex h-full items-start justify-between ${isCompact ? "gap-3" : "gap-4"}`}>
        <div className="flex-1">
          <p className={`mb-1 font-medium text-[var(--bc-neutral-body)] ${isCompact ? "text-[13px]" : "text-sm"}`}>{title}</p>
          <p
            className={`mb-1.5 font-bold text-[var(--bc-neutral-strong)] ${
              isStrong ? (isCompact ? "text-[26px]" : "text-[30px]") : isCompact ? "text-[22px]" : "text-2xl"
            }`}
          >
            {value}
          </p>
          {description ? (
            <p className={`text-[var(--bc-neutral-body)] ${isCompact ? "text-[13px] leading-5" : "mb-2 text-sm leading-6"}`}>
              {description}
            </p>
          ) : null}
          {trend ? (
            <div
              className={`inline-flex items-center gap-1 font-medium ${
                trendUp ? "text-[#16A34A]" : "text-[#DC2626]"
              } ${isCompact ? "mt-1 text-[13px]" : "text-sm"}`}
            >
              <TrendIcon className="h-4 w-4" />
              <span>{trend}</span>
            </div>
          ) : null}
        </div>
        <div
          className={cn(
            `flex shrink-0 items-center justify-center rounded-xl ${
            isStrong ? (isCompact ? "h-12 w-12" : "h-14 w-14") : isCompact ? "h-10 w-10" : "h-12 w-12"
          }`,
            palette.icon,
          )}
        >
          <Icon
            className={
              isStrong ? (isCompact ? "h-5 w-5" : "h-6 w-6") : isCompact ? "h-[18px] w-[18px]" : "h-5 w-5"
            }
          />
        </div>
      </div>
    </div>
  );
}
