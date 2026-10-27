import type { AuthUser } from "@shared/auth/types";
import { cn } from "@/app/components/ui/utils";
import { UserAvatar } from "./user-avatar";

type UserListItemProps = {
  user: AuthUser;
  roleName: string;
  isCurrent: boolean;
  selected: boolean;
  onSelect: () => void;
};

export const UserListItem = ({ user, roleName, isCurrent, selected, onSelect }: UserListItemProps) => (
  <button
    type="button"
    onClick={onSelect}
    className={cn(
      "flex h-16 w-full items-center gap-3 px-3 text-left transition-colors hover:bg-accent/60",
      selected && "border-l-2 border-primary bg-accent",
      !user.enabled && "opacity-60",
    )}
    aria-current={selected ? "true" : undefined}
  >
    <UserAvatar name={user.displayName} selected={selected} />
    <span className="min-w-0 flex-1">
      <span className="block truncate text-body-md font-medium text-foreground">{user.displayName}</span>
      <span className="mt-0.5 flex flex-wrap gap-1">
        <span className="rounded-full bg-muted px-2 py-0.5 text-label-caps text-muted-foreground">
          {roleName}
        </span>
        {isCurrent && (
          <span className="rounded-full bg-show/20 px-2 py-0.5 text-label-caps text-show">当前登录</span>
        )}
        {!user.enabled && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-label-caps text-muted-foreground">已停用</span>
        )}
      </span>
    </span>
  </button>
);
