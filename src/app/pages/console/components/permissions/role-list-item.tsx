import type { AuthRole } from "@shared/auth/types";
import { cn } from "@/app/components/ui/utils";

type RoleListItemProps = {
  role: AuthRole;
  userCount: number;
  selected: boolean;
  onSelect: () => void;
};

export const RoleListItem = ({ role, userCount, selected, onSelect }: RoleListItemProps) => (
  <button
    type="button"
    onClick={onSelect}
    className={cn(
      "flex w-full flex-col gap-1 px-3 py-3 text-left transition-colors hover:bg-accent/60",
      selected && "border-l-2 border-primary bg-accent",
    )}
    aria-current={selected ? "true" : undefined}
  >
    <span className="flex items-center gap-2">
      <span className="truncate text-body-md font-medium text-foreground">{role.name}</span>
      {role.builtin && (
        <span className="rounded-full bg-warning-surface px-2 py-0.5 text-label-caps text-warning">内置</span>
      )}
      <span className="ml-auto shrink-0 text-body-sm text-muted-foreground">{userCount} 人</span>
    </span>
    {role.description ? (
      <span className="line-clamp-2 text-body-sm text-muted-foreground">{role.description}</span>
    ) : null}
  </button>
);
