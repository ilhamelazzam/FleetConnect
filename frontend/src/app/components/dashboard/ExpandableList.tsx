import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

interface ExpandableListProps<TItem> {
  className?: string;
  collapsedCount?: number;
  emptyState?: ReactNode;
  getKey: (item: TItem, index: number) => string | number;
  itemLabel?: string;
  items: TItem[];
  renderItem: (item: TItem, index: number) => ReactNode;
}

export default function ExpandableList<TItem>({
  className = "space-y-3",
  collapsedCount = 5,
  emptyState,
  getKey,
  itemLabel = "elements",
  items,
  renderItem,
}: ExpandableListProps<TItem>) {
  const [isExpanded, setIsExpanded] = useState(false);
  const visibleItems = isExpanded ? items : items.slice(0, collapsedCount);

  if (items.length === 0) {
    return <>{emptyState ?? null}</>;
  }

  return (
    <div>
      <div className={className}>
        {visibleItems.map((item, index) => (
          <div key={getKey(item, index)}>{renderItem(item, index)}</div>
        ))}
      </div>

      {items.length > collapsedCount ? (
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={() => setIsExpanded((currentValue) => !currentValue)}
            className="inline-flex items-center gap-2 rounded-xl border border-[#DCE5F1] bg-white px-4 py-2 text-sm font-semibold text-[#475569] transition-colors hover:bg-[#F8FAFC]"
          >
            <span>{isExpanded ? "Voir moins" : `Voir les ${items.length} ${itemLabel}`}</span>
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      ) : null}
    </div>
  );
}
