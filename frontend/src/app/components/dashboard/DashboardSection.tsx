import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import { Button } from "../ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";

interface DashboardSectionProps {
  collapsedLabel?: string;
  children: ReactNode;
  className?: string;
  expandedLabel?: string;
  collapsible?: boolean;
  contentClassName?: string;
  defaultOpen?: boolean;
  description?: string;
  isVisible?: boolean;
  title?: string;
}

export default function DashboardSection({
  collapsedLabel = "Ouvrir la section",
  children,
  className,
  expandedLabel = "Replier",
  collapsible = false,
  contentClassName,
  defaultOpen = false,
  description,
  isVisible = true,
  title,
}: DashboardSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  if (!isVisible) {
    return null;
  }

  if (!collapsible) {
    return <>{children}</>;
  }

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className={
        className ??
        "rounded-[24px] border border-[var(--bc-neutral-border)] bg-[var(--card)] p-5 shadow-sm"
      }
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          {title ? (
            <h2 className="text-lg font-semibold text-[var(--bc-neutral-strong)]">{title}</h2>
          ) : null}
          {description ? (
            <p className="mt-1 text-sm leading-6 text-[var(--bc-neutral-body)]">{description}</p>
          ) : null}
        </div>
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-xl border-[var(--bc-neutral-border)]"
          >
            {isOpen ? expandedLabel : collapsedLabel}
            {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent className={contentClassName ?? "pt-5"}>
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
