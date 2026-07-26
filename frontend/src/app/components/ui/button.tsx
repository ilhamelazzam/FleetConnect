import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--bc-primary)] text-white shadow-[0_14px_28px_rgba(59,130,246,0.24)] hover:bg-[var(--bc-primary-hover)] hover:shadow-[0_18px_34px_rgba(59,130,246,0.28)]",
        destructive:
          "bg-[var(--bc-danger)] text-white shadow-[0_14px_28px_rgba(239,68,68,0.22)] hover:bg-[var(--bc-danger-hover)] hover:shadow-[0_18px_34px_rgba(239,68,68,0.26)] focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40",
        warning:
          "bg-[var(--bc-warning)] text-white shadow-[0_14px_28px_rgba(245,158,11,0.22)] hover:bg-[var(--bc-warning-hover)] hover:shadow-[0_18px_34px_rgba(245,158,11,0.26)]",
        success:
          "bg-[var(--bc-success)] text-white shadow-[0_14px_28px_rgba(16,185,129,0.22)] hover:bg-[var(--bc-success-hover)] hover:shadow-[0_18px_34px_rgba(16,185,129,0.26)]",
        ai:
          "bc-gradient-ai text-white shadow-[0_16px_32px_rgba(99,102,241,0.24)] hover:opacity-95 hover:shadow-[0_20px_38px_rgba(99,102,241,0.28)]",
        outline:
          "border border-[var(--bc-neutral-border)] bg-[var(--card)] text-[var(--bc-neutral-body)] shadow-[0_10px_24px_rgba(15,23,42,0.04)] hover:border-[var(--bc-primary-border)] hover:bg-[var(--bc-primary-soft)] hover:text-[var(--bc-primary)] dark:bg-input/30 dark:border-input dark:hover:bg-input/50",
        secondary:
          "bg-[var(--bc-neutral-soft)] text-[var(--bc-neutral-body)] hover:bg-[var(--card)] hover:text-[var(--bc-neutral-strong)] hover:shadow-[0_12px_24px_rgba(15,23,42,0.04)]",
        ghost:
          "text-[var(--bc-neutral-body)] hover:bg-[var(--bc-primary-soft)] hover:text-[var(--bc-primary)] dark:hover:bg-accent/50",
        link: "text-[var(--bc-primary)] underline-offset-4 hover:text-[var(--bc-primary-hover)] hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-lg gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-xl px-6 has-[>svg]:px-4",
        icon: "size-9 rounded-xl",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";

    return (
      <Comp
        ref={ref}
        data-slot="button"
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    );
  },
);

Button.displayName = "Button";

export { Button, buttonVariants };
