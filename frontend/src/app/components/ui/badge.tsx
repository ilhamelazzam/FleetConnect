import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./utils";

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-full border px-2.5 py-1 text-xs font-semibold tracking-[0.01em] w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,background-color,border-color,box-shadow] overflow-hidden",
  {
    variants: {
      variant: {
        default:
          "border-[var(--bc-primary-border)] bg-[var(--bc-primary-soft)] text-[var(--bc-primary)]",
        primary:
          "border-[var(--bc-primary-border)] bg-[var(--bc-primary-soft)] text-[var(--bc-primary)]",
        secondary:
          "border-[var(--bc-neutral-border)] bg-[var(--bc-neutral-soft)] text-[var(--bc-neutral-body)]",
        success:
          "border-[var(--bc-success-border)] bg-[var(--bc-success-soft)] text-[var(--bc-success)]",
        warning:
          "border-[var(--bc-warning-border)] bg-[var(--bc-warning-soft)] text-[var(--bc-warning)]",
        destructive:
          "border-[var(--bc-danger-border)] bg-[var(--bc-danger-soft)] text-[var(--bc-danger)]",
        ai:
          "border-[var(--bc-ai-border)] bg-[linear-gradient(135deg,rgba(99,102,241,0.14),rgba(139,92,246,0.16))] text-[var(--bc-ai-start)]",
        outline:
          "border-[var(--bc-neutral-border)] bg-[var(--card)] text-[var(--bc-neutral-body)] [a&]:hover:border-[var(--bc-primary-border)] [a&]:hover:bg-[var(--bc-primary-soft)] [a&]:hover:text-[var(--bc-primary)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span";

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
