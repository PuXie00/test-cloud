import { useState, type MouseEvent, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "../ui/utils";

type TreeNodeProps = {
  label: string;
  meta?: ReactNode;
  extra?: ReactNode;
  children?: ReactNode;
  defaultExpanded?: boolean;
  status?: "normal" | "warning";
  /** 当前选中项高亮 */
  selected?: boolean;
  depth?: number;
  onSelect?: (event: MouseEvent) => void;
};

/** @deprecated Use TreeView from @/app/components/ics/tree instead. */
export const TreeNode = ({
  label,
  meta,
  extra,
  children,
  defaultExpanded = false,
  status = "normal",
  selected = false,
  depth = 0,
  onSelect,
}: TreeNodeProps) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const hasChildren = Boolean(children);

  const handleToggleExpand = (event: MouseEvent) => {
    event.stopPropagation();
    setExpanded((current) => !current);
  };

  const handleSelect = (event: MouseEvent) => {
    onSelect?.(event);
  };

  return (
    <div className="flex select-none flex-col">
      <div
        role="treeitem"
        aria-expanded={hasChildren ? expanded : undefined}
        aria-selected={selected}
        tabIndex={onSelect ? 0 : undefined}
        onClick={onSelect ? handleSelect : undefined}
        onKeyDown={
          onSelect
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  handleSelect(event as unknown as MouseEvent);
                }
              }
            : undefined
        }
        className={cn(
          "group relative flex h-9 items-center gap-1 border-l-2 transition-colors [@media(pointer:coarse)]:h-11",
          onSelect && "cursor-pointer",
          selected ? "border-l-primary bg-muted" : "border-l-transparent hover:bg-muted/30"
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px`, paddingRight: "8px" }}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-label={expanded ? "收起" : "展开"}
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground [@media(pointer:coarse)]:h-7 [@media(pointer:coarse)]:w-7"
            onClick={handleToggleExpand}
          >
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        ) : (
          <span className="h-4 w-4 shrink-0" aria-hidden />
        )}

        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className={cn(
              "min-w-0 truncate text-body-md",
              selected ? "font-medium text-primary" : "text-foreground/80"
            )}
          >
            {label}
          </span>
          {meta && (
            <span className="min-w-0 truncate font-mono text-mono-sm tabular-nums text-muted-foreground">{meta}</span>
          )}
        </div>

        {status === "warning" && (
          <span className="h-2 w-2 shrink-0 rounded-full bg-warning" aria-label="Warning" />
        )}

        {extra && (
          <div className="shrink-0" onClick={(event) => event.stopPropagation()}>
            {extra}
          </div>
        )}
      </div>
      {expanded && children && <div className="flex flex-col">{children}</div>}
    </div>
  );
};
