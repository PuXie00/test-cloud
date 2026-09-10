import { ArrowDownToLine, ArrowUpToLine } from "lucide-react";
import { ContextMenuItem } from "@/app/components/ui/context-menu";
import type { InsertMotorsPosition } from "@/app/pages/console/hooks/setup-operations";

type MotorInsertMenuItemsProps = {
  onRequestInsert: (position: InsertMotorsPosition) => void;
};

const dismissContextMenu = () => {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
};

export const MotorInsertMenuItems = ({ onRequestInsert }: MotorInsertMenuItemsProps) => (
  <>
    <ContextMenuItem
      className="gap-2"
      onSelect={() => {
        onRequestInsert("before");
        dismissContextMenu();
      }}
    >
      <ArrowUpToLine className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
      在上方插入
    </ContextMenuItem>
    <ContextMenuItem
      className="gap-2"
      onSelect={() => {
        onRequestInsert("after");
        dismissContextMenu();
      }}
    >
      <ArrowDownToLine className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
      在下方插入
    </ContextMenuItem>
  </>
);
