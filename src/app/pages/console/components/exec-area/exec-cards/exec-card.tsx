import { Loader2, MoreVertical, Play, SkipForward, Square, Minus, Plus, X, Undo2 } from "lucide-react";
import { usePermissions } from "@/app/auth/permissions";
import { cn } from "@/app/components/ui/utils";
import type { ExecCard, ExecCardSource } from "../../../hooks/use-exec-cards";
import {
  canCloseExecCard,
  canRerunExecCard,
  isExecCardAtRest,
  isExecCardInTransition,
} from "../../../hooks/exec-card-run-status";
import { formatExecTime } from "../../../hooks/sequence-run-status";
import { ForcedTrajectoryBadge, isForcedTrajectory } from "../../forced-trajectory-badge";
import { speedTopPercent } from "../../../hooks/speed-cap";

type ExecCardProps = {
  card: ExecCard;
  hasNextSequence: boolean;
  /** 继续 / 反向回正在准备（所在推子槽忙） */
  busy?: boolean;
  onStop: () => void;
  onContinue: () => void;
  onReverseBack: () => void;
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

const NO_TIME = "--:--.-";
const NO_VALUE = "—";

/** 运行时间 / 序列时长；过渡状态时前半段显示“回迹中”；PLC 还没上报时留空位 */
const runTimeText = (card: ExecCard): string => {
  const total = card.totalMs !== undefined ? formatExecTime(card.totalMs) : NO_TIME;
  if (isExecCardInTransition(card)) return `回迹中 / ${total}`;
  const elapsed = card.run ? formatExecTime(card.run.runTimeMs) : NO_TIME;
  return `${elapsed} / ${total}`;
};

/** 当前第几次 / 设定次数；设定为 0 表示无限循环 */
const loopText = (card: ExecCard): string => {
  if (!card.run) return NO_VALUE;
  const set = card.run.loopCountSet > 0 ? String(card.run.loopCountSet) : "∞";
  return `${card.run.loopCount} / ${set}`;
};

const actionBtnClass =
  "inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-sm text-body-sm transition-colors";

export const ExecCardView = ({
  card,
  hasNextSequence,
  busy = false,
  onStop,
  onContinue,
  onReverseBack,
  onSkipNext,
  onSetSpeed,
  onClose,
}: ExecCardProps) => {
  // 停止人人可用；继续、反向回、下一条、关闭、调速要「运行动作」（没有时速度只读显示）
  const canRun = usePermissions().can("control.run");
  const isStopped = card.status === "stopped" || card.status === "paused";
  const isStopping = card.status === "stopping";
  const isEnded = card.status === "completed";
  // 动作真正停下来（PLC 不再上报）之后才能关闭；继续 / 反向回准备中也不能关
  const closeDisabled = busy || !canCloseExecCard(card);
  const closeTitle = closeDisabled && !busy ? "动作停下来后才能关闭" : undefined;
  const isError = card.status === "error" || card.emergencyStopped;
  const rerunDisabled = busy || !canRerunExecCard(card);
  const skipDisabled = busy || !isExecCardAtRest(card) || !hasNextSequence || isError;
  const speedDisabled = !canRun || isError || isStopping || isExecCardInTransition(card);
  // 调速范围封顶，不超过系统上限
  const maxSpeed = speedTopPercent(card.maxSpeedPercent);

  return (
    <div
      className={cn(
        "flex h-[156px] w-full shrink-0 flex-col gap-1.5 rounded-md bg-background p-2.5",
        isError
          ? "ring-1 ring-destructive/60 animate-pulse"
          : isEnded
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
        ) : null}
        {card.reverse ? (
          <span className="shrink-0 rounded-sm bg-muted/50 px-1.5 text-label-caps text-muted-foreground">
            反向
          </span>
        ) : null}
        {isEnded ? (
          <span className="shrink-0 rounded-sm bg-muted px-1.5 text-label-caps text-foreground">
            已结束
          </span>
        ) : null}
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
        {canRun && (
          <button
            type="button"
            aria-label="关闭任务"
            disabled={closeDisabled}
            title={closeTitle}
            onClick={onClose}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-muted text-foreground hover:bg-accent disabled:bg-transparent disabled:text-muted-foreground disabled:opacity-40"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        <div>
          <div className="text-label-caps text-muted-foreground">运行时间</div>
          <div className="font-mono text-mono-sm tabular-nums text-foreground">
            {runTimeText(card)}
          </div>
        </div>
        <div>
          <div className="text-label-caps text-muted-foreground">循环次数</div>
          <div className="font-mono text-mono-sm tabular-nums text-foreground">{loopText(card)}</div>
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-label="降低速度"
          disabled={speedDisabled}
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
          disabled={speedDisabled}
          onChange={(event) => onSetSpeed(Number(event.target.value))}
          className="h-1.5 min-w-0 flex-1 accent-primary disabled:opacity-30"
          aria-label="速度倍率"
        />
        <button
          type="button"
          aria-label="提高速度"
          disabled={speedDisabled}
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
          canRun && <button
            type="button"
            disabled={closeDisabled}
            title={closeTitle}
            onClick={onClose}
            className={cn(
              actionBtnClass,
              "bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-40",
            )}
          >
            <X className="h-3.5 w-3.5" /> 确认清除
          </button>
        ) : (
          <>
            {canRun && (
              <button
                type="button"
                aria-label="反向回"
                disabled={rerunDisabled}
                onClick={onReverseBack}
                className={cn(actionBtnClass, "bg-muted/50 text-foreground hover:bg-muted disabled:opacity-40")}
              >
                <Undo2 className="h-3.5 w-3.5" aria-hidden /> 反向回
              </button>
            )}
            {busy && (isStopped || isEnded) ? (
              canRun && <button
                type="button"
                disabled
                className={cn(actionBtnClass, "bg-muted/50 text-foreground disabled:opacity-70")}
              >
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> 准备中
              </button>
            ) : isEnded ? (
              canRun && <button
                type="button"
                disabled={closeDisabled}
                title={closeTitle}
                onClick={onClose}
                className={cn(actionBtnClass, "bg-muted text-foreground hover:bg-accent disabled:opacity-40")}
              >
                <X className="h-3.5 w-3.5" aria-hidden /> 关闭
              </button>
            ) : isStopped ? (
              canRun && <button
                type="button"
                disabled={rerunDisabled}
                onClick={onContinue}
                className={cn(actionBtnClass, "bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40")}
              >
                <Play className="h-3.5 w-3.5 fill-current" aria-hidden /> 继续
              </button>
            ) : (
              <button
                type="button"
                onClick={onStop}
                className={cn(actionBtnClass, "bg-muted/50 text-foreground hover:bg-muted")}
              >
                <Square className="h-3.5 w-3.5" /> {isStopping ? "停止中" : "停止"}
              </button>
            )}
            {canRun && (
              <button
                type="button"
                aria-label="下一条"
                disabled={skipDisabled}
                onClick={onSkipNext}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-muted/50 text-foreground hover:bg-muted disabled:opacity-40"
              >
                <SkipForward className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};
