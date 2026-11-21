import { NumericInput } from "@/app/components/ics/numeric-input";
import { resolveLivePoseSelection } from "../../components/action-builder/live-pose-edit";
import { useActionBuilder } from "../../components/action-builder/use-action-builder";
import type { GoTiming } from "../../hooks/go-motion";
import { pendingGoEntries } from "../../hooks/go-ready";
import { useGoReady } from "../../hooks/go-ready-provider";
import { useConsoleNav } from "../../hooks/use-console-nav";
import { useProjectStore } from "../../hooks/use-project-store";

const TIMINGS: ReadonlyArray<{ id: GoTiming["kind"]; label: string }> = [
  { id: "default", label: "各自默认速度" },
  { id: "sync", label: "同时到达" },
  { id: "duration", label: "指定时长" },
];

const DIRECTIONS: ReadonlyArray<{ id: 1 | 2; label: string }> = [
  { id: 1, label: "正转" },
  { id: 2, label: "反转" },
];

const seconds = (value: number | null | undefined): string =>
  value === null || value === undefined ? "—" : `${value.toFixed(1)} s`;

const segmentClass = (pressed: boolean) =>
  `h-7 shrink-0 px-2 text-body-sm [@media(pointer:coarse)]:h-10 ${
    pressed ? "bg-accent font-semibold text-primary" : "text-foreground hover:bg-accent"
  }`;

/**
 * GO 条：设了目标就出现。显示要多久和最慢的是哪台（不列出每台），无极旋转的物体单独一行改正转 / 反转；
 * 走法三选一：各自默认速度、同时到达、指定时长。用时只在目标变化时算，按 GO 时按最新位置再算一次。
 */
export const GoReadyOverlay = () => {
  const { state, go, cancel, timing, setTiming, setDirection, plan } = useGoReady();
  const { activeNav } = useConsoleNav();
  const { objects } = useProjectStore();
  const { sequence, selection, liveMode, handleSelectionChange } = useActionBuilder();
  // 动作页「当前位置」里 GO 目标是选中的位姿：清除时连选中的位姿一起清掉，和手动控制里的「清除」一样
  const clearsPoses =
    activeNav === "sequences" &&
    liveMode &&
    resolveLivePoseSelection(sequence, selection).kind !== "none";

  if (state.phase === "idle") return null;

  const pendingCount = pendingGoEntries(state.entries).length;
  const canGoAll = pendingCount > 0;
  const nameOf = (objectId: string) =>
    objects.find((object) => String(object.id) === objectId)?.name ?? `物体 ${objectId}`;
  // 只单独列要选转向的无极旋转物体（按工程里的物体顺序），别的物体不逐台列出
  const orderOf = (objectId: string) => {
    const index = objects.findIndex((object) => String(object.id) === objectId);
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  };
  const turning = plan.objects
    .filter((item) => item.direction !== 0)
    .sort((a, b) => orderOf(a.objectId) - orderOf(b.objectId));
  const slowestName =
    plan.slowestId !== undefined && plan.objects.length > 1 ? nameOf(plan.slowestId) : null;
  const handleGoAll = () => {
    void go();
  };
  const handleCancelAll = () => {
    cancel();
    if (clearsPoses) handleSelectionChange(null);
  };
  const handleTimingChange = (kind: GoTiming["kind"]) => {
    if (kind !== "duration") {
      setTiming({ kind });
      return;
    }
    // 指定时长先填现在的用时，再让人改
    const start = timing.kind === "duration" ? timing.durationMs : Math.ceil((plan.totalSeconds ?? 10) * 10) * 100;
    setTiming({ kind: "duration", durationMs: Math.max(100, start) });
  };

  return (
    <div className="pointer-events-auto absolute bottom-3 left-1/2 z-20 -translate-x-1/2">
      <div className="flex flex-col gap-2 rounded-md bg-card px-3 py-2 shadow-[0_4px_24px_rgba(0,0,0,0.4)]">
        {canGoAll && turning.length > 0 ? (
          <ul aria-label="无极旋转转向" className="flex flex-col gap-1">
            {turning.map((item) => (
              <li key={item.objectId} className="flex items-center gap-2 text-body-sm">
                <span className="min-w-0 flex-1 truncate text-foreground">{nameOf(item.objectId)}</span>
                <span className="w-14 shrink-0 text-right font-mono tabular-nums text-muted-foreground">
                  {seconds(item.seconds)}
                </span>
                <span
                  role="group"
                  aria-label={`${nameOf(item.objectId)} 转向`}
                  className="flex shrink-0 overflow-hidden rounded-md bg-input-background"
                >
                  {DIRECTIONS.map((direction) => (
                    <button
                      key={direction.id}
                      type="button"
                      aria-pressed={item.direction === direction.id}
                      onClick={() => setDirection(item.objectId, direction.id)}
                      className={segmentClass(item.direction === direction.id)}
                    >
                      {direction.label}
                    </button>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-2 text-body-sm text-foreground">
            <span className="inline-block size-2 rounded-full bg-show" aria-hidden />
            {canGoAll ? `GO 准备 · ${pendingCount} 个物体` : "GO 执行中"}
          </span>
          {canGoAll ? (
            <span className="flex items-baseline gap-1.5 text-body-sm">
              <span className="font-mono tabular-nums text-foreground">
                {plan.totalSeconds === null ? "用时算不出" : `约 ${plan.totalSeconds.toFixed(1)} s`}
              </span>
              {slowestName && plan.totalSeconds !== null ? (
                <span className="max-w-32 truncate text-muted-foreground">{slowestName} 最慢</span>
              ) : null}
            </span>
          ) : null}
          <button
            type="button"
            aria-label="全部物体 GO"
            disabled={!canGoAll || plan.error !== undefined}
            onClick={handleGoAll}
            className="h-7 rounded-sm bg-primary px-3 text-body-sm font-semibold text-primary-foreground disabled:pointer-events-none disabled:opacity-40 [@media(pointer:coarse)]:h-10"
          >
            GO
          </button>
          <button
            type="button"
            aria-label="取消全部 GO"
            onClick={handleCancelAll}
            className="h-7 rounded-sm border border-primary px-3 text-body-sm text-primary hover:bg-primary/10 [@media(pointer:coarse)]:h-10"
          >
            清除
          </button>
        </div>
        {canGoAll ? (
          <div className="flex items-center gap-2">
            <span role="group" aria-label="走法" className="flex overflow-hidden rounded-md bg-input-background">
              {TIMINGS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={timing.kind === item.id}
                  onClick={() => handleTimingChange(item.id)}
                  className={segmentClass(timing.kind === item.id)}
                >
                  {item.label}
                </button>
              ))}
            </span>
            {timing.kind === "duration" ? (
              <NumericInput
                aria-label="指定时长"
                value={timing.durationMs / 1000}
                unit="s"
                step={0.1}
                precision={1}
                min={0.1}
                onCommit={(value) =>
                  setTiming({ kind: "duration", durationMs: Math.max(100, Math.round(value * 10) * 100) })
                }
                className="w-24 border border-border"
              />
            ) : null}
          </div>
        ) : null}
        {canGoAll && plan.error ? <p className="text-body-sm text-warning">{plan.error}</p> : null}
      </div>
    </div>
  );
};
