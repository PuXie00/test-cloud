import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, ArrowRightLeft, Check, X } from "lucide-react";
import { cn } from "@/app/components/ui/utils";
import { useSessionDisplayLengthUnit } from "@/app/project/display-length-unit-provider";
import {
  getDisplayLengthFamilyUnit,
  toCanonicalLengthValue,
  toDisplayLengthValue,
} from "@/app/project/display-length-units";
import { useActionBuilder } from "../use-action-builder";
import { VIRTUAL_AXIS_META, formatTime } from "../timeline/timeline-data";
import {
  formatVirtualAxisSpeed,
  formatVirtualAxisValue,
} from "../virtual-axis-display";
import {
  computeTransitionRows,
  durationMsFromSpeed,
  minFeasibleDurationMs,
} from "./transition-math";

type ComposeMode = "time" | "speed";

const DEFAULT_DURATION_MS = 5000;
/** Canonical mm/s — legacy UI default was 0.5 m/s. */
const DEFAULT_SPEED_MM_PER_S = 500;

/** 编辑坞形态二：双 Cue 过渡组合器（时间/速度互锁 + 超限警告） */
export const TransitionComposer = () => {
  const {
    cues,
    transitionDraft,
    getTimelineObject,
    handleTransitionSwap,
    handleTransitionCancel,
    handleTransitionSave,
  } = useActionBuilder();
  const display = useSessionDisplayLengthUnit();

  const [mode, setMode] = useState<ComposeMode>("time");
  const [durationMs, setDurationMs] = useState(DEFAULT_DURATION_MS);
  const [canonicalSpeed, setCanonicalSpeed] = useState(DEFAULT_SPEED_MM_PER_S);

  const from = cues.find((cue) => cue.id === transitionDraft?.fromCueId);
  const to = cues.find((cue) => cue.id === transitionDraft?.toCueId);

  const rows = useMemo(
    () => (from && to ? computeTransitionRows(from, to, durationMs, getTimelineObject) : []),
    [from, to, durationMs, getTimelineObject],
  );
  const minMs = useMemo(
    () => (from && to ? minFeasibleDurationMs(from, to, getTimelineObject) : null),
    [from, to, getTimelineObject],
  );

  if (!from || !to) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-body-sm text-muted-foreground">
        组合的 Cue 不存在
      </div>
    );
  }

  const exceeded = rows.some((row) => row.exceeded);
  const durationSec = durationMs / 1000;
  const displaySpeed = toDisplayLengthValue(canonicalSpeed, display);
  const speedUnit = getDisplayLengthFamilyUnit("mm/s", display);

  const applyDuration = (ms: number) => {
    setDurationMs(Math.max(100, Math.round(ms)));
  };

  const handleSpeedChange = (displayValue: number) => {
    const nextCanonical = toCanonicalLengthValue(displayValue, display);
    setCanonicalSpeed(nextCanonical);
    const ms = from && to ? durationMsFromSpeed(from, to, nextCanonical) : null;
    if (ms !== null) applyDuration(ms);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 头部：A → B、交换、模式与数值 */}
      <div className="flex h-12 shrink-0 items-center gap-3 bg-muted px-3">
        <span className="text-label-caps text-muted-foreground">过渡组合</span>
        <div className="flex items-center gap-2">
          <span className="rounded-sm bg-input-background px-2 py-1 text-body-sm font-medium text-foreground">
            {from.name}
          </span>
          <ArrowRight className="h-4 w-4 text-primary" aria-hidden />
          <span className="rounded-sm bg-input-background px-2 py-1 text-body-sm font-medium text-foreground">
            {to.name}
          </span>
          <button
            type="button"
            aria-label="交换起止 Cue"
            onClick={handleTransitionSwap}
            className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowRightLeft className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="ml-4 flex items-center gap-1 rounded-md bg-input-background p-0.5" role="tablist" aria-label="组合模式">
          {(
            [
              { id: "time", label: "按时间" },
              { id: "speed", label: "按速度" },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={mode === item.id}
              onClick={() => setMode(item.id)}
              className={cn(
                "h-7 rounded-sm px-3 text-body-sm transition-colors",
                mode === item.id
                  ? "bg-primary text-primary-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        {mode === "time" ? (
          <label className="flex items-center gap-1.5 text-body-sm text-muted-foreground">
            总时间
            <input
              type="number"
              step="0.5"
              min="0.1"
              value={durationSec}
              aria-label="过渡总时间（秒）"
              onChange={(event) =>
                applyDuration((parseFloat(event.target.value) || 0.1) * 1000)
              }
              className="w-20 rounded-sm bg-input-background px-2 py-1.5 text-right font-mono text-mono-md tabular-nums text-foreground outline-none focus:ring-1 focus:ring-ring"
            />
            s
          </label>
        ) : (
          <label className="flex items-center gap-1.5 text-body-sm text-muted-foreground">
            升降速度
            <input
              type="number"
              step={toDisplayLengthValue(50, display)}
              min={toDisplayLengthValue(10, display)}
              value={displaySpeed}
              aria-label={`升降速度（${speedUnit}）`}
              onChange={(event) =>
                handleSpeedChange(parseFloat(event.target.value) || toDisplayLengthValue(10, display))
              }
              className="w-20 rounded-sm bg-input-background px-2 py-1.5 text-right font-mono text-mono-md tabular-nums text-foreground outline-none focus:ring-1 focus:ring-ring"
            />
            {speedUnit}
            <span className="font-mono text-mono-sm tabular-nums text-foreground">
              ≈ {formatTime(durationMs)}
            </span>
          </label>
        )}

        <button
          type="button"
          aria-label="取消组合"
          onClick={handleTransitionCancel}
          className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {/* 每物体行程 / 峰值速度表 */}
      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto bg-background">
        <div className="grid grid-cols-[minmax(120px,1.4fr)_repeat(4,minmax(80px,1fr))] items-center gap-x-2 px-3 py-1.5 text-label-caps text-muted-foreground">
          <span>物体 · 轴</span>
          <span className="text-right">起点</span>
          <span className="text-right">行程</span>
          <span className="text-right">峰值速度</span>
          <span className="text-right">状态</span>
        </div>

        {rows.length === 0 && (
          <p className="px-3 py-6 text-center text-body-sm text-muted-foreground">
            两个 Cue 没有可比较的目标值
          </p>
        )}

        {rows.map((row, index) => {
          const meta = VIRTUAL_AXIS_META[row.axis];
          return (
            <div
              key={`${row.objectId}:${row.axis}`}
              className={cn(
                "grid min-h-[36px] grid-cols-[minmax(120px,1.4fr)_repeat(4,minmax(80px,1fr))] items-center gap-x-2 px-3 py-1",
                index % 2 === 0 ? "bg-input-background" : "bg-accent/40",
              )}
            >
              <span className="truncate text-body-sm text-foreground">
                {row.objectName}
                <span className="ml-1 text-muted-foreground">· {meta.label}</span>
              </span>
              <span className="text-right font-mono text-mono-sm tabular-nums text-muted-foreground">
                {formatVirtualAxisValue(row.axis, row.fromValue, display, undefined, row.controlType)} →{" "}
                {formatVirtualAxisValue(row.axis, row.toValue, display, undefined, row.controlType)}
              </span>
              <span className="text-right font-mono text-mono-md tabular-nums text-foreground">
                {formatVirtualAxisValue(row.axis, row.travel, display, undefined, row.controlType)}
              </span>
              <span
                className={cn(
                  "text-right font-mono text-mono-md tabular-nums",
                  row.exceeded ? "text-warning" : "text-foreground",
                )}
              >
                {formatVirtualAxisSpeed(row.axis, row.requiredSpeed, display, undefined, row.controlType)}
              </span>
              <span className="flex items-center justify-end">
                {row.exceeded ? (
                  <span className="inline-flex items-center gap-1 text-body-sm text-warning">
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                    超限
                    {row.maxSpeed !== undefined
                      ? ` (max ${formatVirtualAxisSpeed(row.axis, row.maxSpeed, display, undefined, row.controlType)})`
                      : ""}
                  </span>
                ) : (
                  <Check className="h-4 w-4 text-show" aria-hidden />
                )}
              </span>
            </div>
          );
        })}
      </div>

      {/* 底部操作 */}
      <div className="flex h-12 shrink-0 items-center gap-3 bg-muted px-3">
        {minMs !== null && (
          <div className="flex items-center gap-2 text-body-sm text-muted-foreground">
            最短可行时间
            <span className="font-mono text-mono-md tabular-nums text-foreground">
              {formatTime(minMs)}
            </span>
            <button
              type="button"
              onClick={() => applyDuration(minMs)}
              className="inline-flex h-8 items-center rounded-md border border-border px-2.5 text-body-sm text-foreground hover:bg-accent"
            >
              采用
            </button>
          </div>
        )}
        {exceeded && (
          <p className="text-body-sm text-warning">存在超限轴，请延长时间后再保存</p>
        )}
        <button
          type="button"
          disabled={exceeded || rows.length === 0}
          onClick={() => handleTransitionSave(durationMs)}
          className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-body-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
        >
          保存为动作
        </button>
      </div>
    </div>
  );
};
