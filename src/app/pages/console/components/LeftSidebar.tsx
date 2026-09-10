import { Cpu, List, SlidersHorizontal, User } from "lucide-react";
import { useAuth } from "@/app/auth/use-auth";
import { NavRail } from "@/app/components/ics/nav-rail";
import { cn } from "@/app/components/ui/utils";

export type LeftNavId = "control" | "devices" | "sequences";

const NAV_ITEMS = [
  { id: "control" as const, icon: SlidersHorizontal, label: "控制" },
  { id: "devices" as const, icon: Cpu, label: "搭建" },
  { id: "sequences" as const, icon: List, label: "动作" },
];

type LeftSidebarProps = {
  active: LeftNavId;
  onChange: (id: LeftNavId) => void;
  className?: string;
};

export const LeftSidebar = ({ active, onChange, className }: LeftSidebarProps) => {
  const { user } = useAuth();
  const displayName = user?.displayName ?? "未登录";

  return (
    <aside className={cn("flex shrink-0", className)}>
      <NavRail
        items={NAV_ITEMS}
        active={active}
        onChange={onChange}
        className="h-full"
        footer={
          <div
            className="flex w-full flex-col items-center gap-1 px-1 py-2 text-muted-foreground"
            title={displayName}
            aria-label={`当前用户 ${displayName}`}
          >
            <User className="h-4 w-4 shrink-0" aria-hidden />
            <span className="w-full truncate text-center text-[10px] font-medium leading-tight tracking-wide">
              {displayName}
            </span>
          </div>
        }
      />
    </aside>
  );
};
