import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Plus, Search, Trash2 } from "lucide-react";
import { PanelHeader } from "@/app/components/ics/panel-header";
import { useRules } from "@/app/pages/console/hooks/use-rules";
import { RuleCreateDialog } from "./rule-create-dialog";
import { RuleRow } from "./rule-row";

type Filter = "all" | "enabled" | "disabled" | "error";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "enabled", label: "已启用" },
  { id: "disabled", label: "已禁用" },
  { id: "error", label: "错误" },
];

const inputCls =
  "h-8 w-full rounded-md bg-input-background px-2 text-body-sm text-foreground outline-none focus:ring-1 focus:ring-ring [@media(pointer:coarse)]:h-11";

const btnCreate =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-label-caps text-primary-foreground hover:opacity-90 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:px-4";

export const RulesList = () => {
  const navigate = useNavigate();
  const { rules, selectedIds, setEnabled, toggleSelect, clearSelection, setBatchEnabled, removeSelected } = useRules();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const filtered = useMemo(() => {
    return rules.filter((r) => {
      if (filter === "enabled" && !r.enabled) return false;
      if (filter === "disabled" && r.enabled) return false;
      if (filter === "error" && r.status !== "error") return false;
      if (query.trim() && !r.name.includes(query.trim())) return false;
      return true;
    });
  }, [rules, filter, query]);

  const hasSelection = selectedIds.size > 0;

  return (
    <>
      <section className="flex min-h-0 flex-1 flex-col" aria-label="已配置规则">
        <PanelHeader
          title="已配置规则"
          extra={(
            <div className="flex items-center gap-2">
              <span className="text-body-sm text-muted-foreground">{rules.length} 条</span>
              <button type="button" className={btnCreate} onClick={() => setCreateOpen(true)}>
                <Plus className="h-3.5 w-3.5" aria-hidden />
                新建规则
              </button>
            </div>
          )}
        />
      <div className="flex flex-col gap-2 p-3 bg-muted/20">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索规则名称…"
            aria-label="搜索规则"
            className={`${inputCls} pl-7`}
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`inline-flex h-7 items-center rounded-full border px-3 text-body-sm transition-colors [@media(pointer:coarse)]:h-9 ${
                filter === f.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background text-muted-foreground hover:text-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
          {hasSelection && (
            <div className="ml-auto flex items-center gap-1.5">
              <span className="text-body-sm text-muted-foreground">已选 {selectedIds.size}</span>
              <button
                type="button"
                onClick={() => setBatchEnabled(true)}
                className="inline-flex h-7 items-center rounded-md border border-border px-2 text-body-sm hover:bg-accent [@media(pointer:coarse)]:h-9"
              >
                启用
              </button>
              <button
                type="button"
                onClick={() => setBatchEnabled(false)}
                className="inline-flex h-7 items-center rounded-md border border-border px-2 text-body-sm hover:bg-accent [@media(pointer:coarse)]:h-9"
              >
                禁用
              </button>
              <button
                type="button"
                onClick={removeSelected}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-destructive/40 px-2 text-body-sm text-destructive hover:bg-destructive/10 [@media(pointer:coarse)]:h-9"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                删除
              </button>
              <button
                type="button"
                onClick={clearSelection}
                className="inline-flex h-7 items-center rounded-md px-2 text-body-sm text-muted-foreground hover:text-foreground [@media(pointer:coarse)]:h-9"
              >
                取消
              </button>
            </div>
          )}
        </div>
      </div>
      <ul className="custom-scrollbar flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        {filtered.length > 0 ? (
          filtered.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              selected={selectedIds.has(rule.id)}
              onToggleSelect={() => toggleSelect(rule.id)}
              onSetEnabled={(enabled) => setEnabled(rule.id, enabled)}
              onEdit={() => navigate(`/console/rule/${rule.id}`)}
            />
          ))
        ) : (
          <li className="px-3 py-6 text-center text-body-sm text-muted-foreground">
            没有匹配的规则。
            <button type="button" className="ml-1 text-primary hover:underline" onClick={() => setCreateOpen(true)}>
              新建一条
            </button>
          </li>
        )}
      </ul>
      </section>
      <RuleCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
};
