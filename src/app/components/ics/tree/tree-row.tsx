import { ChevronDown, ChevronRight } from "lucide-react";
import type { MouseEvent, KeyboardEvent, ReactNode } from "react";
import { cn } from "@/app/components/ui/utils";

export type TreeRowProps = {
  depth: number;
  indent: number;
  label: ReactNode;
  icon?: ReactNode;
  extra?: ReactNode;
  hasChildren: boolean;
  expanded: boolean;
  selected: boolean;
  onToggleExpand: () => void;
  onSelect: (event: MouseEvent | KeyboardEvent) => void;
  showDragHandle?: boolean;
  dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>;
  rowDragListeners?: React.HTMLAttributes<HTMLDivElement>;
  dropIndicator?: ReactNode;
  rowRef?: React.Ref<HTMLDivElement>;
  rowProps?: React.HTMLAttributes<HTMLDivElement>;
};

export const TreeRow = ({
  depth,
  indent,
  label,
  icon,
  extra,
  hasChildren,
  expanded,
  selected,
  onToggleExpand,
  onSelect,
  showDragHandle,
  dragHandleProps,
  rowDragListeners,
  dropIndicator,
  rowRef,
  rowProps,
}: TreeRowProps) => {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(event);
    }
    rowProps?.onKeyDown?.(event);
  };

  return (
    <div className="relative flex flex-col">
      {dropIndicator}
      <div
        ref={rowRef}
        role="treeitem"
        aria-expanded={hasChildren ? expanded : undefined}
        aria-selected={selected}
        tabIndex={rowProps?.tabIndex ?? -1}
        onClick={(e) => onSelect(e)}
        onKeyDown={handleKeyDown}
        {...rowProps}
        {...rowDragListeners}
        className={cn(
          "group relative focus-visible:outline-none flex min-h-9 items-center transition-colors pointer-coarse:min-h-11",
          "cursor-pointer border-l-2",
          rowDragListeners && "touch-none",
          selected
            ? "border-l-primary bg-muted"
            : "border-l-transparent hover:bg-muted/30",
          rowProps?.className,
        )}
        style={{
          paddingRight: 8,
          paddingLeft: depth === 0 ? 8 : depth * indent,
        }}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-label={expanded ? "收起" : "展开"}
            className="flex h-5 w-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand();
            }}
          >
            {expanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </button>
        ) : (
            <span className="h-5 w-4 shrink-0" aria-hidden />
        )}

        {icon && <span className="flex shrink-0 text-muted-foreground">{icon}</span>}

        <div className="flex min-w-0 flex-1 items-center gap-1 ml-1">{label}</div>

        {extra && (
          <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
            {extra}
          </div>
        )}

      </div>
    </div>
  );
};
