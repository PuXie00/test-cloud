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
  showDragHandle: _showDragHandle,
  dragHandleProps: _dragHandleProps,
  rowDragListeners,
  dropIndicator,
  rowRef,
  rowProps,
}: TreeRowProps) => {
  const { onKeyDown: rowKeyDown, className: rowClassName, ...restRowProps } = rowProps ?? {};

  // Enter / 空格选中；方向键、Delete 等交给外层（rowProps 不能把这里覆盖掉）
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(event);
      return;
    }
    rowKeyDown?.(event);
    rowDragListeners?.onKeyDown?.(event);
  };

  return (
    <div className="relative flex flex-col">
      {dropIndicator}
      <div
        ref={rowRef}
        role="treeitem"
        aria-expanded={hasChildren ? expanded : undefined}
        aria-selected={selected}
        tabIndex={restRowProps.tabIndex ?? -1}
        onClick={(e) => onSelect(e)}
        // 双击有子项的行展开 / 收起（展开按钮、行尾按钮各自拦掉了双击）
        onDoubleClick={() => {
          if (hasChildren) onToggleExpand();
        }}
        {...restRowProps}
        {...rowDragListeners}
        onKeyDown={handleKeyDown}
        className={cn(
          "group relative focus-visible:outline-none flex min-h-9 items-center transition-colors pointer-coarse:min-h-11",
          "cursor-pointer border-l-2 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
          rowDragListeners && "touch-none",
          selected
            ? "border-l-primary bg-primary/15"
            : "border-l-transparent hover:bg-accent",
          rowClassName,
        )}
        style={{
          paddingRight: 8,
          paddingLeft: depth === 0 ? 2 : depth * indent - 6,
        }}
      >
        {hasChildren ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={expanded ? "收起" : "展开"}
            className="flex h-8 w-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground pointer-coarse:h-11 pointer-coarse:w-9"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand();
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
        ) : (
          <span className="h-8 w-6 shrink-0 pointer-coarse:w-9" aria-hidden />
        )}

        {icon && <span className="flex shrink-0 text-muted-foreground">{icon}</span>}

        <div className="flex min-w-0 flex-1 items-center gap-1 ml-1.5">{label}</div>

        {extra && (
          <div
            className="shrink-0"
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {extra}
          </div>
        )}

      </div>
    </div>
  );
};
