import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/app/components/ui/utils";

type ProgramPageHeaderProps = {
  pageIndex: number;
  pageTotal: number;
  isCurrent: boolean;
  expanded: boolean;
  onToggle: (event: React.MouseEvent) => void;
  onSelect: () => void;
};

export const ProgramPageHeader = ({
  pageIndex,
  pageTotal,
  isCurrent,
  expanded,
  onToggle,
  onSelect,
}: ProgramPageHeaderProps) => (
  <button
    type="button"
    onClick={() => {
      onSelect();
    }}
    className={cn(
      "mx-1 flex h-8 items-center gap-2 rounded-sm px-2 text-left transition-colors",
      isCurrent ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/30",
    )}
  >
    <span onClick={onToggle} className="flex h-4 w-4 items-center justify-center">
      {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
    </span>
    <span className="text-label-caps">
      页 {pageIndex + 1}/{pageTotal}
      {isCurrent && " · 当前页"}
    </span>
  </button>
);
