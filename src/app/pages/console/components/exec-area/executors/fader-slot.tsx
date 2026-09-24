import { useEffect, useRef, useState } from "react";
import { ArrowLeftRight, Loader2, Locate, Play, Plus, Repeat, Shield, Zap } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/app/components/ui/popover";
import { cn } from "@/app/components/ui/utils";
import { useConsoleMode } from "../../../hooks/use-console-mode";
import type { FaderSlotState } from "../../../hooks/use-executor-slots";
import { VerticalFader } from "./vertical-fader";
import { isForcedTrajectory } from "../../forced-trajectory-badge";

const LONG_PRESS_MS = 400;
const LONG_PRESS_MOVE_PX = 8;

type FaderSlotProps = {
  slot: FaderSlotState;
  repairMessage?: string | null;
  isPreviewing: boolean;
  onPreviewToggle: () => void;
  onPreviewHoldStart: () => void;
  onPreviewHoldEnd: () => void;
  onGo: () => void;
  onCancelReady?: () => void;
  onFaderChange: (value: number) => void;
  onAssignFromDrag: (payload: { chapterId: string; index: number; kind: "sequence" }) => void;
};

export const FaderSlot = ({
  slot,
  repairMessage,
  isPreviewing,
  onPreviewToggle,
  onPreviewHoldStart,
  onPreviewHoldEnd,
  onGo,
  onCancelReady,
  onFaderChange,
  onAssignFromDrag,
}: FaderSlotProps) => {
  const { mode } = useConsoleMode();
  const [marksOpen, setMarksOpen] = useState(false);
  const [safetyGroupOn, setSafetyGroupOn] = useState(true);
  const [nearestOn, setNearestOn] = useState(false);
  const [reverseOn, setReverseOn] = useState(false);
  const sequenceId = slot.sequence?.id;
  const isEmpty = !slot.sequence;
  const isForced = isForcedTrajectory(slot.sequence?.trajectoryMode);
  const isRunning = slot.phase === "running";
  const isReady = slot.phase === "ready";
  const canSetRunOptions = !isReady && !isRunning && !slot.isBusy;
  const actionLabel = isReady || isRunning ? "GO" : "Ready";
  const isBlocked = isEmpty || Boolean(repairMessage) || slot.isBusy || isRunning;
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

  useEffect(() => {
    setSafetyGroupOn(true);
    setNearestOn(false);
    setReverseOn(false);
    setMarksOpen(false);
  }, [sequenceId]);

  const cancelHold = () => {
    clearTimer();
    if (holdActiveRef.current) {
      holdActiveRef.current = false;
      onPreviewHoldEnd();
      suppressClickRef.current = true;
    }
  };

  const handlePreviewClick = () => {
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
        "relative flex h-full min-h-0 min-w-[72px] w-full flex-col gap-1 rounded-sm border bg-card px-1 pt-1 transition-colors",
        isRunning
          ? "border-show/60"
          : isEmpty
            ? cn("border-dashed border-muted-foreground/40", isRehearsal)
            : repairMessage
              ? "border-warning/50"
              : isReady
                ? "border-primary/50"
                : "border-border",
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
      {isEmpty ? (
        <div className="h-6 w-full shrink-0 rounded-full bg-input-background" aria-hidden />
      ) : (
        <Popover open={marksOpen} onOpenChange={setMarksOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`${slot.sequence?.name} 标记`}
              className="relative z-10 flex h-6 w-full shrink-0 items-center justify-center gap-1.5 rounded-full bg-input-background text-foreground"
            >
              {isForced ? (
                <span className="inline-flex text-warning" title="强制">
                  <Zap className="h-3.5 w-3.5" aria-hidden />
                  <span className="sr-only">强制</span>
                </span>
              ) : null}
              <span
                className={cn(
                  "inline-flex",
                  safetyGroupOn ? "text-show" : "text-muted-foreground",
                )}
                title={safetyGroupOn ? "安全组开启" : "安全组关闭"}
              >
                <Shield className="h-3.5 w-3.5" aria-hidden />
                <span className="sr-only">{safetyGroupOn ? "安全组开启" : "安全组关闭"}</span>
              </span>
              {nearestOn ? (
                <span className="inline-flex text-foreground" title="就近">
                  <Locate className="h-3.5 w-3.5" aria-hidden />
                  <span className="sr-only">就近</span>
                </span>
              ) : null}
              {reverseOn ? (
                <span className="inline-flex text-foreground" title="反向">
                  <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden />
                  <span className="sr-only">反向</span>
                </span>
              ) : null}
              {slot.sequence?.loop ? (
                <span className="inline-flex text-secondary" title="循环">
                  <Repeat className="h-3.5 w-3.5" aria-hidden />
                  <span className="sr-only">循环</span>
                </span>
              ) : null}
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" align="center" className="w-40 bg-card p-2 shadow-[0_4px_24px_rgba(0,0,0,0.4)]">
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => setSafetyGroupOn((current) => !current)}
                className="inline-flex h-8 items-center justify-center rounded-sm bg-input-background text-body-sm text-foreground hover:bg-accent"
              >
                {safetyGroupOn ? "关闭安全组" : "开启安全组"}
              </button>
              <button
                type="button"
                disabled={!canSetRunOptions}
                onClick={() => setNearestOn((current) => !current)}
                className="inline-flex h-8 items-center justify-center rounded-sm bg-input-background text-body-sm text-foreground hover:bg-accent disabled:opacity-40"
              >
                {nearestOn ? "关闭就近" : "开启就近"}
              </button>
              <button
                type="button"
                disabled={!canSetRunOptions}
                onClick={() => setReverseOn((current) => !current)}
                className="inline-flex h-8 items-center justify-center rounded-sm bg-input-background text-body-sm text-foreground hover:bg-accent disabled:opacity-40"
              >
                {reverseOn ? "关闭反向" : "开启反向"}
              </button>
              {isReady ? (
                <button
                  type="button"
                  onClick={() => {
                    onCancelReady?.();
                    setMarksOpen(false);
                  }}
                  className="inline-flex h-8 items-center justify-center rounded-sm text-body-sm text-warning hover:bg-accent"
                >
                  取消准备
                </button>
              ) : null}
            </div>
          </PopoverContent>
        </Popover>
      )}
      <span
        className={cn(
          "pointer-events-none relative z-[1] line-clamp-2 min-h-8 text-left text-body-sm",
          isPreviewing ? "text-primary" : "text-foreground",
          repairMessage && "opacity-60",
        )}
      >
        {slot.sequence?.name}
      </span>
      {repairMessage ? (
        <span id={reasonId} className="pointer-events-none relative z-[1] line-clamp-2 text-body-sm text-warning">
          {repairMessage}
        </span>
      ) : null}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        <VerticalFader
          value={slot.faderValue}
          onChange={onFaderChange}
          disabled={!isReady && !isRunning}
          aria-label={`${slot.label} 速度`}
        />
        {isEmpty ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-muted-foreground/60">
            <Plus className="h-3.5 w-3.5" />
            <span className="mt-0.5 text-body-sm">{isRehearsal ? "拖入序列" : "—"}</span>
          </div>
        ) : (
          <span className="mt-1 text-center font-mono text-mono-sm tabular-nums text-foreground">
            {slot.faderValue}%
          </span>
        )}
      </div>
      <button
        type="button"
        disabled={isBlocked}
        aria-busy={slot.isBusy || undefined}
        aria-label={`${slot.label} ${actionLabel}`}
        aria-describedby={repairMessage ? reasonId : undefined}
        onClick={onGo}
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
