import { MoreVertical, Pause, Play, SkipForward, Square, Minus, Plus, X } from "lucide-react";
import { cn } from "@/app/components/ui/utils";
import type { ExecCard, ExecCardSource } from "../../../hooks/use-exec-cards";

type ExecCardProps = {
  card: ExecCard;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onSkipNext: () => void;
  onSetSpeed: (percent: number) => void;
  onClose: () => void;
};

const formatTime = (ms: number) => {
  const totalSeconds = ms / 1000;
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const s = (totalSeconds % 60).toFixed(1).padStart(4, "0");
  return `${m}:${s}`;
};

const sourceLabel = (source: ExecCardSource) => {
  switch (source.kind) {
    case "button":
      return `B${source.slotIndex + 1}`;
    case "fader":
      return `F${source.slotIndex + 1}`;
    case "program":
      return "节目";
    case "external":
      return "外部";
    case "manual":
      return "手动";
  }
};

const actionBtnClass =
  "inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-sm text-body-sm transition-colors";

export const ExecCardView = ({
  card,
  onPause,
  onResume,
  onStop,
  onSkipNext,
  onSetSpeed,
  onClose,
}: ExecCardProps) => {
  const durationMs = card.durationMs;
  const isExternallyTimed = durationMs === null;
  const progressPercent = isExternallyTimed
    ? null
    : Math.min(100, (card.elapsedMs / durationMs) * 100);
  const isPaused = card.status === "paused";
  const isCompleted = card.status === "completed";
  const isError = card.status === "error" || card.emergencyStopped;
  const maxSpeed = card.kind === "cue" ? 150 : 200;

  return (
    <div
      className={cn(
        "flex h-[152px] w-full shrink-0 flex-col gap-1.5 rounded-md bg-background p-2.5",
        isError
          ? "ring-1 ring-destructive/60 animate-pulse"
          : isCompleted
            ? ""
            : card.kind === "cue"
              ? "ring-1 ring-primary/40"
              : "ring-1 ring-show/40",
      )}
    >
      <div className="flex min-h-0 items-center gap-1.5">
        <Play className="h-3.5 w-3.5 shrink-0 fill-current text-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-body-sm font-semibold text-foreground">
          {card.name}
        </span>
        <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-label-caps text-muted-foreground">
          {card.kind === "cue" ? "Cue" : "Seq"}
        </span>
        <span className="shrink-0 font-mono text-mono-sm tabular-nums text-muted-foreground">
          {sourceLabel(card.source)}
        </span>
        <button
          type="button"
          aria-label="更多操作"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <MoreVertical className="h-3 w-3" />
        </button>
      </div>

      <div className="space-y-0.5">
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          {progressPercent !== null ? (
            <div
              className={cn(
                "h-full rounded-full transition-[width]",
                isError ? "bg-destructive" : card.kind === "cue" ? "bg-primary" : "bg-show",
              )}
              style={{ width: `${progressPercent}%` }}
            />
          ) : null}
        </div>
        <div className="flex items-center justify-between font-mono text-mono-sm tabular-nums text-muted-foreground">
          {durationMs === null ? (
            <>
              <span>{formatTime(card.elapsedMs)}</span>
              {card.status === "running" ? <span>C++ 运行中</span> : null}
            </>
          ) : (
            <>
              <span>
                {formatTime(card.elapsedMs)} / {formatTime(durationMs)}
              </span>
              <span>剩 {formatTime(Math.max(0, durationMs - card.elapsedMs))}</span>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-label="降低速度"
          disabled={isError}
          onClick={() => onSetSpeed(Math.max(0, card.speedPercent - 10))}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-input-background text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
        >
          <Minus className="h-3 w-3" />
        </button>
        <input
          type="range"
          min={0}
          max={maxSpeed}
          value={card.speedPercent}
          disabled={isError}
          onChange={(event) => onSetSpeed(Number(event.target.value))}
          className="h-1.5 min-w-0 flex-1 accent-primary disabled:opacity-30"
          aria-label="速度倍率"
        />
        <button
          type="button"
          aria-label="提高速度"
          disabled={isError}
          onClick={() => onSetSpeed(Math.min(maxSpeed, card.speedPercent + 10))}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-input-background text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
        >
          <Plus className="h-3 w-3" />
        </button>
        <span className="w-10 shrink-0 text-right font-mono text-mono-sm tabular-nums text-foreground">
          {card.speedPercent}%
        </span>
      </div>

      <div className="flex gap-1.5">
        {isError ? (
          <button
            type="button"
            onClick={onClose}
            className={cn(actionBtnClass, "bg-destructive text-destructive-foreground hover:bg-destructive/90")}
          >
            <X className="h-3.5 w-3.5" /> 确认清除
          </button>
        ) : isPaused ? (
          <>
            <button
              type="button"
              onClick={onResume}
              className={cn(actionBtnClass, "bg-primary text-primary-foreground hover:bg-primary/90")}
            >
              <Play className="h-3.5 w-3.5 fill-current" /> 继续
            </button>
            <button
              type="button"
              onClick={onStop}
              className={cn(actionBtnClass, "bg-muted/50 text-foreground hover:bg-muted")}
            >
              <Square className="h-3.5 w-3.5" /> 停止
            </button>
            <button
              type="button"
              onClick={onSkipNext}
              className={cn(actionBtnClass, "bg-muted/50 text-foreground hover:bg-muted")}
            >
              <SkipForward className="h-3.5 w-3.5" /> 跳过
            </button>
          </>
        ) : isCompleted ? (
          <button
            type="button"
            onClick={onClose}
            className={cn(actionBtnClass, "bg-muted/50 text-foreground hover:bg-muted")}
          >
            <X className="h-3.5 w-3.5" /> 关闭
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={onPause}
              className={cn(actionBtnClass, "bg-muted/50 text-foreground hover:bg-muted")}
            >
              <Pause className="h-3.5 w-3.5" /> 暂停
            </button>
            <button
              type="button"
              onClick={onStop}
              className={cn(actionBtnClass, "bg-muted/50 text-foreground hover:bg-muted")}
            >
              <Square className="h-3.5 w-3.5" /> 停止
            </button>
            <button
              type="button"
              onClick={onSkipNext}
              className={cn(actionBtnClass, "bg-muted/50 text-foreground hover:bg-muted")}
            >
              <SkipForward className="h-3.5 w-3.5" /> 跳过
            </button>
          </>
        )}
      </div>
    </div>
  );
};
