import { useState } from "react";
import { CheckCircle2, Loader2, ScanLine, XCircle } from "lucide-react";
import { cn } from "@/app/components/ui/utils";
import { PanelHeader } from "@/app/components/ics/panel-header";
import { SCAN_MOCK_RESULTS, type ScanResultItem } from "@/app/pages/console/components/right-sidebar/project-data";

type ScanState =
  | { kind: "idle" }
  | { kind: "scanning"; progress: number; discovered: number }
  | { kind: "success"; results: ScanResultItem[] }
  | { kind: "timeout" }
  | { kind: "error"; message: string };

type ScanInlinePanelProps = {
  masterId: string;
  masterName: string;
  className?: string;
};

const btnPrimary =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-label-caps text-primary-foreground hover:opacity-90 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:px-4";
const btnSecondary =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-border bg-transparent px-3 text-label-caps text-foreground hover:bg-accent [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:px-4";

export const ScanInlinePanel = ({ masterId, masterName, className }: ScanInlinePanelProps) => {
  const [state, setState] = useState<ScanState>({ kind: "idle" });
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());

  const handleStart = () => {
    setState({ kind: "scanning", progress: 0, discovered: 0 });
    let progress = 0;
    let discovered = 0;
    const tick = window.setInterval(() => {
      progress += 20;
      if (progress >= 60) discovered = Math.min(SCAN_MOCK_RESULTS.length, discovered + 1);
      if (progress >= 100) {
        window.clearInterval(tick);
        setState({ kind: "success", results: SCAN_MOCK_RESULTS });
        return;
      }
      setState({ kind: "scanning", progress, discovered });
    }, 250);
  };

  const handleAdd = (id: string) => setAddedIds((c) => new Set(c).add(id));
  const handleAddAll = () => setAddedIds(new Set(SCAN_MOCK_RESULTS.map((r) => r.id)));
  const handleReset = () => {
    setAddedIds(new Set());
    setState({ kind: "idle" });
  };

  return (
    <section className={cn("flex flex-col border-t border-border bg-card/30", className)} aria-label={`扫描 · ${masterName}`}>
      <PanelHeader title={`扫描识别 · ${masterName}`} icon={ScanLine} />
      <div className="space-y-3 p-4">
        {state.kind === "idle" && (
          <>
            <p className="text-body-sm text-muted-foreground">
              开始扫描后将向 {masterName} ({masterId}) 发送广播请求并枚举从站设备。
            </p>
            <button type="button" className={btnPrimary} onClick={handleStart}>
              <ScanLine className="h-3.5 w-3.5" aria-hidden /> 开始扫描
            </button>
          </>
        )}
        {state.kind === "scanning" && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-body-sm text-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden />
              <span>正在扫描… 已发现 {state.discovered} 台设备</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${state.progress}%` }}
              />
            </div>
          </div>
        )}
        {state.kind === "success" && (
          <>
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-body-sm text-primary">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> 扫描完成 · 发现 {state.results.length} 台
              </span>
              <div className="flex items-center gap-2">
                <button type="button" className={btnSecondary} onClick={handleReset}>重新扫描</button>
                <button type="button" className={btnPrimary} onClick={handleAddAll}>全部添加</button>
              </div>
            </div>
            <ul className="divide-y divide-border rounded-md border border-border">
              {state.results.map((r) => {
                const added = addedIds.has(r.id) || r.alreadyAdded;
                return (
                  <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 [@media(pointer:coarse)]:py-3">
                    <div className="min-w-0">
                      <p className="truncate text-body-md text-foreground">{r.deviceType}</p>
                      <p className="font-mono text-mono-sm tabular-nums text-muted-foreground">节点 {r.nodeAddress}</p>
                    </div>
                    <button
                      type="button"
                      disabled={added}
                      onClick={() => handleAdd(r.id)}
                      className={cn(btnSecondary, added && "cursor-default opacity-60")}
                    >
                      {added ? "已添加" : "添加"}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {(state.kind === "timeout" || state.kind === "error") && (
          <div className="flex items-center gap-2 text-body-sm text-destructive">
            <XCircle className="h-3.5 w-3.5" aria-hidden />
            <span>{state.kind === "timeout" ? "扫描超时" : state.message}</span>
            <button type="button" className={btnSecondary} onClick={handleReset}>重试</button>
          </div>
        )}
      </div>
    </section>
  );
};
