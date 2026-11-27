import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/app/components/ui/dialog";
import type { CollisionEvent, CollisionReport } from "@/app/project/collision/types";
import type { useSequenceCollision } from "@/app/project/collision/use-sequence-collision";

type Props = Pick<ReturnType<typeof useSequenceCollision>, "status" | "error" | "report" | "runFull"> & {
  names: ReadonlyMap<number, string>;
  onLocate: (event: CollisionEvent) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const seconds = (ms: number) => (ms / 1000).toFixed(3);

export const CollisionPanel = ({ open, onOpenChange, status, error, report, runFull, names, onLocate }: Props) => {
  const [limit, setLimit] = useState(32);
  const current = status === "ready" ? report : null;
  const scanning = status === "running" || status === "paused" || status === "queued";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>碰撞检测</DialogTitle>
          <DialogDescription>检查当前动作序列编程段内的模型碰撞。</DialogDescription>
        </DialogHeader>
        {status === "queued" && <p role="status">检测已排队，可关闭窗口。</p>}
        {status === "paused" && <p role="status">检测已暂停，停止播放或结束拖动后继续。</p>}
        {status === "running" && <p role="status">正在检测，可关闭窗口。</p>}
        {error && <p role="alert" className="text-body-sm text-warning">{error}</p>}
        {current && (
          <div className="max-h-[50vh] overflow-y-auto text-body-sm">
            {current.events.slice(0, limit).map((event) => {
              const [a, b] = event.objectIds;
              return (
                <button key={`${a}-${b}-${event.startMs}-${event.kind}`} type="button"
                  className="flex w-full items-center justify-between gap-2 rounded px-1 py-1.5 text-left hover:bg-accent"
                  onClick={() => { onLocate(event); onOpenChange(false); }}>
                  <span className="min-w-0"><span className="mr-1 text-warning">{event.kind === "collision" ? "碰撞" : "需复核"}</span>
                    {names.get(a) ?? a} ↔ {names.get(b) ?? b}
                  </span>
                  <span className="shrink-0 font-mono text-xs">{seconds(event.startMs)}–{seconds(event.endMs)} s</span>
                </button>
              );
            })}
            {current.events.length > limit &&
              <button type="button" className="py-2 text-primary" onClick={() => setLimit(limit + 32)}>显示更多结果</button>}
            {current.incomplete.length > 0 &&
              <div className="pt-1 text-warning">
                <p className="font-medium">未完整校验</p>
                <ul className="list-inside list-disc">{current.incomplete.map((message, i) => <li key={i}>{message}</li>)}</ul>
              </div>}
            {!current.events.length && !current.incomplete.length && <p>未发现碰撞</p>}
          </div>
        )}
        <div className="flex justify-end">
          <button type="button" disabled={scanning} onClick={runFull}
            className="rounded border border-border px-3 py-1.5 text-body-sm hover:bg-accent disabled:opacity-50">
            检测当前草稿
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
