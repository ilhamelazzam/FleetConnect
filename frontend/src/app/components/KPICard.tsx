import { ArrowDownRight, ArrowUpRight, LucideIcon } from "lucide-react";

interface KPICardProps {
  title: string;
  value: string;
  trend?: string;
  trendUp?: boolean;
  icon: LucideIcon;
  color?: "blue" | "green" | "orange" | "red" | "purple" | "cyan";
  variant?: "default" | "total-lines";
}

const colorClasses = {
  blue: "bg-blue-50 text-[#2563EB]",
  green: "bg-green-50 text-[#16A34A]",
  orange: "bg-orange-50 text-[#F59E0B]",
  red: "bg-red-50 text-[#DC2626]",
  purple: "bg-purple-50 text-[#7C3AED]",
  cyan: "bg-cyan-50 text-[#06B6D4]",
};

export default function KPICard({
  title,
  value,
  trend,
  trendUp,
  icon: Icon,
  color = "blue",
  variant = "default",
}: KPICardProps) {
  const TrendIcon = trendUp ? ArrowUpRight : ArrowDownRight;

  if (variant === "total-lines") {
    return (
      <div className="min-h-[220px] rounded-[28px] border border-[#DCE5F1] bg-white p-6 shadow-[0_24px_48px_-36px_rgba(15,23,42,0.5)] transition-shadow hover:shadow-[0_30px_60px_-40px_rgba(15,23,42,0.55)]">
        <div className="flex items-start justify-between gap-4">
          <p className="max-w-[9ch] text-[18px] font-medium leading-[1.35] text-[#64748B] sm:text-[20px]">
            {title}
          </p>
          <div className="flex h-16 w-16 items-center justify-center rounded-[18px] bg-[#EEF4FF] text-[#2D6CDF]">
            <Icon className="h-8 w-8" strokeWidth={2.2} />
          </div>
        </div>

        <p className="mt-6 text-[46px] font-semibold leading-none tracking-[-0.04em] text-[#0F172A] sm:text-[52px]">
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

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 transition-shadow hover:shadow-lg">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="mb-1 text-sm text-[#64748B]">{title}</p>
          <p className="mb-2 text-2xl font-bold text-[#0F172A]">{value}</p>
          {trend ? (
            <div
              className={`inline-flex items-center gap-1 text-sm font-medium ${
                trendUp ? "text-[#16A34A]" : "text-[#DC2626]"
              }`}
            >
              <TrendIcon className="h-4 w-4" />
              <span>{trend}</span>
            </div>
          ) : null}
        </div>
        <div className={`rounded-lg p-3 ${colorClasses[color]}`}>
          <Icon className="h-6 w-6" />
        </div>
      </div>
    </div>
  );
}
