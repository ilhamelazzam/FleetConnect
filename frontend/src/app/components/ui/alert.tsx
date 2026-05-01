import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./utils";

const alertVariants = cva(
  "relative w-full rounded-lg border px-4 py-3 text-sm grid has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] grid-cols-[0_1fr] has-[>svg]:gap-x-3 gap-y-0.5 items-start [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current",
  {
    variants: {
      variant: {
        default:
          "border-[var(--bc-primary-border)] bg-[linear-gradient(135deg,rgba(59,130,246,0.08),#FFFFFF)] text-card-foreground [&>svg]:text-[var(--bc-primary)] *:data-[slot=alert-title]:text-[var(--bc-primary-hover)]",
        destructive:
          "border-[var(--bc-danger-border)] bg-[linear-gradient(135deg,rgba(239,68,68,0.1),#FFFFFF)] text-card-foreground [&>svg]:text-[var(--bc-danger)] *:data-[slot=alert-title]:text-[var(--bc-danger-hover)] *:data-[slot=alert-description]:text-[var(--bc-danger)]/90",
        warning:
          "border-[var(--bc-warning-border)] bg-[linear-gradient(135deg,rgba(245,158,11,0.12),#FFFFFF)] text-card-foreground [&>svg]:text-[var(--bc-warning)] *:data-[slot=alert-title]:text-[var(--bc-warning-hover)] *:data-[slot=alert-description]:text-[var(--bc-warning-hover)]/90",
        success:
          "border-[var(--bc-success-border)] bg-[linear-gradient(135deg,rgba(16,185,129,0.1),#FFFFFF)] text-card-foreground [&>svg]:text-[var(--bc-success)] *:data-[slot=alert-title]:text-[var(--bc-success-hover)] *:data-[slot=alert-description]:text-[var(--bc-success-hover)]/90",
        ai:
          "border-[var(--bc-ai-border)] bg-[linear-gradient(135deg,rgba(99,102,241,0.1),rgba(139,92,246,0.08),#FFFFFF)] text-card-foreground [&>svg]:text-[var(--bc-ai-start)] *:data-[slot=alert-title]:text-[var(--bc-ai-end)] *:data-[slot=alert-description]:text-[var(--bc-ai-start)]/90",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "col-start-2 line-clamp-1 min-h-4 font-medium tracking-tight",
        className,
      )}
      {...props}
    />
  );
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "text-muted-foreground col-start-2 grid justify-items-start gap-1 text-sm [&_p]:leading-relaxed",
        className,
      )}
      {...props}
    />
  );
}

export { Alert, AlertTitle, AlertDescription };
