import { cn } from "@/app/components/ui/utils";
import { ROLE_LABEL } from "./permissions-constants";
import type { UserRecord } from "./permissions-types";
import { UserAvatar } from "./user-avatar";

type UserListItemProps = {
  user: UserRecord;
  selected: boolean;
  onSelect: () => void;
};

export const UserListItem = ({ user, selected, onSelect }: UserListItemProps) => (
  <button
    type="button"
    onClick={onSelect}
    className={cn(
      "flex h-16 w-full items-center gap-3 px-3 text-left transition-colors hover:bg-accent/60",
      selected && "border-l-2 border-primary bg-accent",
    )}
    aria-current={selected ? "true" : undefined}
  >
    <UserAvatar name={user.displayName} selected={selected} />
    <span className="min-w-0 flex-1">
      <span className="block truncate text-body-md font-medium text-foreground">
        {user.displayName}
      </span>
      <span className="mt-0.5 inline-block rounded-full bg-muted px-2 py-0.5 text-label-caps text-muted-foreground">
        {ROLE_LABEL[user.role]}
      </span>
    </span>
    <span
      className={cn(
        "h-2 w-2 shrink-0 rounded-full",
        user.online ? "bg-show" : "bg-muted-foreground",
      )}
      aria-label={user.online ? "在线" : "离线"}
    />
  </button>
);
