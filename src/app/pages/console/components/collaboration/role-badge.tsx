import { cn } from "@/app/components/ui/utils";
import { COLLAB_SURFACES } from "./collab-surfaces";
import { HOST_ROLE_LABEL } from "./collab-constants";
import type { HostRole } from "./collab-types";

type RoleBadgeProps = {
  role: HostRole;
  className?: string;
};

export const RoleBadge = ({ role, className }: RoleBadgeProps) => {
  const isPrimary = role === "primary";

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-label-caps",
        isPrimary ? "bg-show/10 text-show" : cn(COLLAB_SURFACES.elevated, "border-0 text-muted-foreground"),
        className,
      )}
    >
      <span
        className={cn("h-1.5 w-1.5 rounded-full", isPrimary ? "bg-show" : "bg-muted-foreground")}
        aria-hidden
      />
      {HOST_ROLE_LABEL[role]}
    </span>
  );
};
