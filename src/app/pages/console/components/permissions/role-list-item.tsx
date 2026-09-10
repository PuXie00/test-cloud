import { cn } from "@/app/components/ui/utils";
import type { RoleRecord } from "./permissions-types";

type RoleListItemProps = {
  role: RoleRecord;
  selected: boolean;
  onSelect: () => void;
};

export const RoleListItem = ({ role, selected, onSelect }: RoleListItemProps) => (
  <button
    type="button"
    onClick={onSelect}
    className={cn(
      "flex w-full flex-col gap-1 px-3 py-3 text-left transition-colors hover:bg-accent/60",
      selected && "border-l-2 border-primary bg-accent",
    )}
    aria-current={selected ? "true" : undefined}
  >
    <span className="text-body-md font-medium text-foreground">{role.label}</span>
    <span className="line-clamp-2 text-body-sm text-muted-foreground">{role.description}</span>
  </button>
);
