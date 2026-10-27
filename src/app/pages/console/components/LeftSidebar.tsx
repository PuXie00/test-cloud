import { Cpu, List, SlidersHorizontal, User } from "lucide-react";
import { useMemo } from "react";
import type { PermissionId } from "@shared/auth/permissions";
import { useAuth } from "@/app/auth/use-auth";
import { usePermissions } from "@/app/auth/permissions";
import { NavRail } from "@/app/components/ics/nav-rail";
import { cn } from "@/app/components/ui/utils";

export type LeftNavId = "control" | "devices" | "sequences";

/** 「控制」人人可进；搭建、动作要「进入」权限 */
const NAV_ITEMS: {
  id: LeftNavId;
  icon: typeof SlidersHorizontal;
  label: string;
  permission?: PermissionId;
}[] = [
  { id: "control", icon: SlidersHorizontal, label: "控制" },
  { id: "devices", icon: Cpu, label: "搭建", permission: "build.view" },
  { id: "sequences", icon: List, label: "动作", permission: "action.view" },
];

type LeftSidebarProps = {
  active: LeftNavId;
  onChange: (id: LeftNavId) => void;
  className?: string;
};

export const LeftSidebar = ({ active, onChange, className }: LeftSidebarProps) => {
  const { user } = useAuth();
  const { can } = usePermissions();
  const displayName = user?.displayName ?? "未登录";
  const items = useMemo(
    () => NAV_ITEMS.filter((item) => !item.permission || can(item.permission)),
    [can],
  );

  return (
    <aside className={cn("flex shrink-0", className)}>
      <NavRail
        items={items}
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
