import { cn } from "@/app/components/ui/utils";
import { COLLAB_SURFACES } from "./collab-surfaces";
import { RoleBadge } from "./role-badge";
import type { HostRecord } from "./collab-types";

type HostListItemProps = {
  host: HostRecord;
  selected: boolean;
  onSelect: () => void;
};

export const HostListItem = ({ host, selected, onSelect }: HostListItemProps) => (
  <label
    className={cn(
      "flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 transition-colors",
      COLLAB_SURFACES.recessed,
      selected && "ring-1 ring-primary/50",
    )}
  >
    <input
      type="radio"
      name="collab-primary-host"
      checked={selected}
      onChange={onSelect}
      className="h-4 w-4 shrink-0 accent-primary"
      aria-label={`选择 ${host.hostname}`}
    />
    <span className="min-w-[140px] font-mono text-mono-md tabular-nums text-foreground">
      {host.hostname}
    </span>
    <span className="font-mono text-mono-sm tabular-nums text-muted-foreground">{host.ip}</span>
    <RoleBadge role={host.role} />
    <span className="ml-auto text-body-sm text-muted-foreground">
      [{host.configured ? "已配置" : "未配置"}]
    </span>
  </label>
);
