import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";

export type AxisInsertPosition = "before" | "after";

type AxisRowMoreMenuProps = {
  axisLabel: string;
  disabled?: boolean;
  onInsert: (position: AxisInsertPosition) => void;
};

export const AxisRowMoreMenu = ({ axisLabel, disabled = false, onInsert }: AxisRowMoreMenuProps) => (
  <DropdownMenu modal={false}>
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        aria-label={`${axisLabel} 更多操作`}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent
      align="end"
      className="min-w-[8rem] border-0 bg-card p-1 text-foreground shadow-[0_4px_24px_rgba(0,0,0,0.4)]"
    >
      <DropdownMenuItem
        disabled={disabled}
        className="text-body-sm focus:bg-accent focus:text-foreground"
        onSelect={() => onInsert("before")}
      >
        向前添加
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={disabled}
        className="text-body-sm focus:bg-accent focus:text-foreground"
        onSelect={() => onInsert("after")}
      >
        向后添加
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);
