import { useEffect, useRef } from "react";
import { Loader2, Play, Plus } from "lucide-react";
import { cn } from "@/app/components/ui/utils";
import { useConsoleMode } from "../../../hooks/use-console-mode";
import type { FaderSlotState } from "../../../hooks/use-executor-slots";
import { VerticalFader } from "./vertical-fader";
import { ForcedTrajectoryBadge, isForcedTrajectory } from "../../forced-trajectory-badge";

const LONG_PRESS_MS = 400;
const LONG_PRESS_MOVE_PX = 8;

type FaderSlotProps = {
  slot: FaderSlotState;
  repairMessage?: string | null;
  isPreviewing: boolean;
  selected?: boolean;
  onSelect?: () => void;
  onPreviewToggle: () => void;
  onPreviewHoldStart: () => void;
  onPreviewHoldEnd: () => void;
  onGo: () => void;
  onFaderChange: (value: number) => void;
  onAssignFromDrag: (payload: { chapterId: string; index: number; kind: "sequence" }) => void;
};

export const FaderSlot = ({
  slot,
  repairMessage,
  isPreviewing,
  selected = false,
  onSelect = () => undefined,
  onPreviewToggle,
  onPreviewHoldStart,
  onPreviewHoldEnd,
  onGo,
  onFaderChange,
  onAssignFromDrag,
}: FaderSlotProps) => {
  const { mode } = useConsoleMode();
  const isEmpty = !slot.sequence;
  const isForced = isForcedTrajectory(slot.sequence?.trajectoryMode);
  const isRunning = slot.phase === "running";
  const isReady = slot.phase === "ready";
  const actionLabel = isReady || isRunning ? "GO" : "Ready";
  const isBlocked = isEmpty || Boolean(repairMessage) || slot.isBusy || isRunning;
  const speedUnlocked = isReady || isRunning;
  const isRehearsal = mode === "rehearsal";
  const reasonId = `fader-slot-repair-${slot.index}`;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPointRef = useRef<{ x: number; y: number } | null>(null);
  const holdActiveRef = useRef(false);
  const suppressClickRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => () => clearTimer(), []);

  const cancelHold = () => {
    clearTimer();
    if (holdActiveRef.current) {
      holdActiveRef.current = false;
      onPreviewHoldEnd();
      suppressClickRef.current = true;
    }
  };

  const handlePreviewClick = () => {
    onSelect();
    if (isEmpty || repairMessage) return;
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onPreviewToggle();
  };

  const handlePreviewPointerDown = (event: React.PointerEvent) => {
    if (isEmpty || event.button !== 0 || repairMessage) return;
    suppressClickRef.current = false;
    startPointRef.current = { x: event.clientX, y: event.clientY };
    holdActiveRef.current = false;
    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      holdActiveRef.current = true;
      onPreviewHoldStart();
    }, LONG_PRESS_MS);
  };

  const handlePreviewPointerMove = (event: React.PointerEvent) => {
    const start = startPointRef.current;
    if (!start || timerRef.current == null) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_PX) {
      clearTimer();
    }
  };

  const handlePreviewPointerUp = () => {
    clearTimer();
    if (holdActiveRef.current) {
      holdActiveRef.current = false;
      onPreviewHoldEnd();
      suppressClickRef.current = true;
    }
  };

  const handleDragOver = (event: React.DragEvent) => {
    if (!isRehearsal) return;
    if (!event.dataTransfer.types.includes("application/x-console-item")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (event: React.DragEvent) => {
    if (!isRehearsal) return;
    const raw = event.dataTransfer.getData("application/x-console-item");
    if (!raw) return;
    try {
      const payload = JSON.parse(raw);
      if (payload?.kind !== "sequence") return;
      onAssignFromDrag(payload);
    } catch {
      // ignore
    }
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={cn(
        "relative flex h-full min-h-0 min-w-[72px] w-full flex-col gap-1 rounded-sm border bg-card p-1.5 transition-colors",
        isRunning
          ? "border-show/60"
          : isEmpty
            ? cn("border-dashed border-muted-foreground/40", isRehearsal && "hover:border-primary/40")
            : repairMessage
              ? "border-warning/50"
              : isReady
                ? "border-primary/50"
                : "border-border",
        selected && "border-primary",
      )}
    >
      {!isEmpty ? (
        <button
          type="button"
          aria-label={
            isForced ? `预览 ${slot.sequence?.name}，强制轨迹` : `预览 ${slot.sequence?.name}`
          }
          aria-pressed={isPreviewing}
          disabled={Boolean(repairMessage)}
          onClick={handlePreviewClick}
          onPointerDown={handlePreviewPointerDown}
          onPointerMove={handlePreviewPointerMove}
          onPointerUp={handlePreviewPointerUp}
          onPointerLeave={cancelHold}
          onPointerCancel={cancelHold}
          onContextMenu={(event) => event.preventDefault()}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          className="absolute inset-0 z-0 rounded-sm disabled:pointer-events-none"
        />
      ) : null}
      <div className="relative z-10 flex items-center gap-1">
        <button
          type="button"
          aria-pressed={selected}
          aria-label={`${slot.label} 选中`}
          onClick={onSelect}
          className={cn(
            "font-mono text-label-caps",
            selected ? "text-primary" : "text-muted-foreground",
          )}
        >
          {slot.label}
        </button>
        {isForced ? <ForcedTrajectoryBadge /> : null}
        <span
          className={cn(
            "ml-auto h-1.5 w-1.5 rounded-full",
            isRunning
              ? "bg-show"
              : isEmpty
                ? "bg-muted-foreground/40"
                : repairMessage
                  ? "bg-warning"
                  : isReady
                    ? "bg-primary"
                    : "bg-show/70",
          )}
        />
      </div>
      {!isEmpty ? (
        <>
          <span
            className={cn(
              "pointer-events-none relative z-[1] line-clamp-1 text-left text-body-sm",
              isPreviewing ? "text-primary" : "text-foreground",
              repairMessage && "opacity-60",
            )}
          >
            {slot.sequence?.name}
          </span>
          {repairMessage ? (
            <span id={reasonId} className="pointer-events-none relative z-[1] line-clamp-1 text-body-sm text-warning">
              {repairMessage}
            </span>
          ) : null}
        </>
      ) : null}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        <VerticalFader
          value={slot.faderValue}
          onChange={onFaderChange}
          disabled={!speedUnlocked}
          aria-label={`${slot.label} 速度`}
          className={speedUnlocked ? undefined : "pointer-events-auto"}
        />
        {isEmpty ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-muted-foreground/60">
            <Plus className="h-3.5 w-3.5" />
            <span className="mt-0.5 text-body-sm">{isRehearsal ? "拖入序列" : "—"}</span>
          </div>
        ) : speedUnlocked ? (
          <span className="pointer-events-none absolute inset-x-0 bottom-0.5 text-center font-mono text-mono-sm tabular-nums text-primary">
            {`${slot.faderValue}%`}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        disabled={isBlocked}
        aria-busy={slot.isBusy || undefined}
        aria-label={`${slot.label} ${actionLabel}`}
        aria-describedby={repairMessage ? reasonId : undefined}
        onClick={() => {
          onSelect();
          onGo();
        }}
        className={cn(
          "relative z-10 inline-flex h-9 shrink-0 items-center justify-center gap-1 rounded-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-30",
          isRunning
            ? "bg-show text-background"
            : isBlocked
              ? "border border-border text-muted-foreground"
              : "bg-primary text-primary-foreground hover:bg-primary/90",
        )}
      >
        {slot.isBusy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <Play className="h-3.5 w-3.5 fill-current" aria-hidden />
        )}
        {actionLabel}
      </button>
    </div>
  );
};
