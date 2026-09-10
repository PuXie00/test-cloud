import { MoreHorizontal, Pencil } from "lucide-react";
import { Switch } from "@/app/components/ui/switch";
import { cn } from "@/app/components/ui/utils";
import { StatusBadge } from "@/app/components/ics/status-badge";
import type { Rule } from "@/app/pages/console/components/right-sidebar/rules-data";

type RuleRowProps = {
  rule: Rule;
  selected: boolean;
  onToggleSelect: () => void;
  onSetEnabled: (enabled: boolean) => void;
  onEdit: () => void;
};

const formatLast = (iso: string | null) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return iso;
  }
};

export const RuleRow = ({ rule, selected, onToggleSelect, onSetEnabled, onEdit }: RuleRowProps) => (
  <li
    className={cn(
      "flex items-center gap-3 rounded-md bg-background px-3 py-2 transition-colors",
      "[@media(pointer:coarse)]:py-3",
      selected && "ring-1 ring-primary bg-primary/5"
    )}
  >
    <input
      type="checkbox"
      checked={selected}
      onChange={onToggleSelect}
      aria-label={`选择规则 ${rule.name}`}
      className="h-4 w-4 shrink-0 accent-primary [@media(pointer:coarse)]:h-5 [@media(pointer:coarse)]:w-5"
    />
    <div className="min-w-0 flex-1">
      <p className="truncate text-body-md text-foreground">{rule.name}</p>
      <p className="font-mono text-mono-sm tabular-nums text-muted-foreground">
        触发 {rule.triggers} 次 · 上次 {formatLast(rule.lastTriggeredAt)}
      </p>
    </div>
    {rule.status === "error" ? (
      <StatusBadge variant="error">错误</StatusBadge>
    ) : (
      <StatusBadge variant={rule.enabled ? "online" : "offline"}>
        {rule.enabled ? "已启用" : "已禁用"}
      </StatusBadge>
    )}
    <Switch checked={rule.enabled} onCheckedChange={onSetEnabled} aria-label="启用规则" />
    <button
      type="button"
      onClick={onEdit}
      aria-label={`编辑规则 ${rule.name}`}
      className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
    >
      <Pencil className="h-3.5 w-3.5" aria-hidden />
    </button>
    <button
      type="button"
      aria-label={`更多操作 ${rule.name}`}
      className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
    >
      <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
    </button>
  </li>
);
