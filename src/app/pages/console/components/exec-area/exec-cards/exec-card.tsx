import { MoreVertical, Play, SkipForward, Square, Minus, Plus, X, RotateCcw } from "lucide-react";
import { cn } from "@/app/components/ui/utils";
import type { ExecCard, ExecCardSource } from "../../../hooks/use-exec-cards";
import { EXAMPLE_SEQUENCE_RUNTIME, formatExecTime } from "../../../hooks/sequence-run-status";
import { ForcedTrajectoryBadge, isForcedTrajectory } from "../../forced-trajectory-badge";

type ExecCardProps = {
  card: ExecCard;
  hasNextSequence: boolean;
  onStop: () => void;
  onResume: () => void;
  onRestart: () => void;
  onSkipNext: () => void;
  onSetSpeed: (percent: number) => void;
  onClose: () => void;
};

const sourceLabel = (source: ExecCardSource) => {
  switch (source.kind) {
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
  hasNextSequence,
  onStop,
  onResume,
  onRestart,
  onSkipNext,
  onSetSpeed,
  onClose,
}: ExecCardProps) => {
  const fixture = EXAMPLE_SEQUENCE_RUNTIME[0]!;
  const isStopped = card.status === "stopped" || card.status === "paused";
  const isCompleted = card.status === "completed";
  const isError = card.status === "error" || card.emergencyStopped;
  const skipDisabled = !isStopped || !hasNextSequence || isError;
  const maxSpeed = 200;

  return (
    <div
      className={cn(
        "flex h-[152px] w-full shrink-0 flex-col gap-1.5 rounded-md bg-background p-2.5",
        isError
          ? "ring-1 ring-destructive/60 animate-pulse"
          : isCompleted
            ? ""
            : "ring-1 ring-show/40",
      )}
    >
      <div className="flex min-h-0 items-center gap-1.5">
        <Play className="h-3.5 w-3.5 shrink-0 fill-current text-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-body-sm font-semibold text-foreground">
          {card.name}
        </span>
        {isForcedTrajectory(card.trajectoryMode) ? (
          <ForcedTrajectoryBadge className="px-1.5 text-muted-foreground" />
        ) : (
          <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-label-caps text-muted-foreground">
            Seq
          </span>
        )}
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

      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        <div>
          <div className="text-label-caps text-muted-foreground">运行时间</div>
          <div className="font-mono text-mono-sm tabular-nums text-foreground">
            {formatExecTime(fixture.elapsedMs)} / {formatExecTime(fixture.totalMs)}
          </div>
        </div>
        <div>
          <div className="text-label-caps text-muted-foreground">循环次数</div>
          <div className="font-mono text-mono-sm tabular-nums text-foreground">{fixture.loopCount}</div>
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
              aria-label="重新"
              disabled={!isStopped}
              onClick={onRestart}
              className={cn(actionBtnClass, "bg-muted/50 text-foreground hover:bg-muted disabled:opacity-40")}
            >
              <RotateCcw className="h-3.5 w-3.5" /> 重新
            </button>
            {isStopped ? (
              <button
                type="button"
                onClick={onResume}
                className={cn(actionBtnClass, "bg-primary text-primary-foreground hover:bg-primary/90")}
              >
                <Play className="h-3.5 w-3.5 fill-current" /> 继续
              </button>
            ) : (
              <button
                type="button"
                onClick={onStop}
                className={cn(actionBtnClass, "bg-muted/50 text-foreground hover:bg-muted")}
              >
                <Square className="h-3.5 w-3.5" /> 停止
              </button>
            )}
            <button
              type="button"
              aria-label="跳过"
              disabled={skipDisabled}
              onClick={onSkipNext}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-muted/50 text-foreground hover:bg-muted disabled:opacity-40"
            >
              <SkipForward className="h-3.5 w-3.5" aria-hidden />
            </button>
          </>
        )}
      </div>
    </div>
  );
};
