import { useEffect, type PointerEvent as ReactPointerEvent } from "react";
import { Pause, Play, RotateCcw, X } from "lucide-react";
import { cn } from "@/app/components/ui/utils";
import {
  useSequencePreview,
  type SequencePreviewMultiplier,
} from "../../hooks/use-sequence-preview";
import { formatExecTime } from "../../hooks/sequence-run-status";
import { previewPhaseAt, type PreviewTimeline } from "../../hooks/sequence-preview-timeline";

const SPEED_OPTIONS: SequencePreviewMultiplier[] = [1, 2, 4];

const TRANSITION_HATCH =
  "bg-[repeating-linear-gradient(135deg,var(--secondary)_0px,var(--secondary)_3px,transparent_3px,transparent_6px)]";

const stopPointer = (event: ReactPointerEvent) => {
  event.stopPropagation();
};

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName;
  return tagName === "INPUT" || tagName === "TEXTAREA" || target.isContentEditable;
};

const PreviewSegments = ({ timeline }: { timeline: PreviewTimeline }) => {
  const transitionPercent = timeline.totalMs > 0 ? (timeline.transitionMs / timeline.totalMs) * 100 : 0;
  return (
    <div aria-hidden className="flex h-1 w-full overflow-hidden rounded-full bg-input-background">
      <div
        data-testid="preview-transition-segment"
        className={cn("h-full shrink-0 opacity-80", TRANSITION_HATCH)}
        style={{ width: `${transitionPercent}%` }}
      />
      <div className="h-full min-w-0 flex-1 bg-primary/50" />
    </div>
  );
};

export const SequencePreviewBar = () => {
  const {
    cursorMs,
    totalMs,
    timeline,
    isPlaying,
    multiplier,
    play,
    pause,
    stopPreview,
    setCursorMs,
    setMultiplier,
  } = useSequencePreview();

  const atEnd = totalMs > 0 && cursorMs >= totalMs;
  const playLabel = isPlaying ? "暂停" : atEnd ? "重新播放" : "播放";
  const hasTransition = !!timeline && timeline.transitionMs > 0;
  const phase = timeline ? previewPhaseAt(timeline, cursorMs) : null;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;

      if (event.key === " " || event.code === "Space") {
        event.preventDefault();
        if (isPlaying) pause();
        else play();
        return;
      }
      if (event.key === "Escape") {
        stopPreview();
        return;
      }
      if (event.key === "ArrowLeft") {
        setCursorMs(cursorMs - 100);
        return;
      }
      if (event.key === "ArrowRight") {
        setCursorMs(cursorMs + 100);
        return;
      }
      if (event.key === "Home") {
        setCursorMs(0);
        return;
      }
      if (event.key === "End") {
        setCursorMs(totalMs);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cursorMs, totalMs, isPlaying, play, pause, stopPreview, setCursorMs]);

  return (
    <div
      role="toolbar"
      aria-label="序列预览"
      onPointerDown={stopPointer}
      className="pointer-events-auto absolute inset-x-3 bottom-3 flex h-9 items-center gap-2 rounded-md bg-card/90 px-2"
    >
      <button
        type="button"
        aria-label={playLabel}
        className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-primary hover:bg-accent"
        onClick={() => {
          if (isPlaying) pause();
          else play();
        }}
      >
        {isPlaying ? <Pause aria-hidden /> : atEnd ? <RotateCcw aria-hidden /> : <Play aria-hidden />}
      </button>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
        <input
          type="range"
          min={0}
          max={totalMs}
          step={100}
          aria-label="预览进度"
          className="w-full accent-primary"
          value={cursorMs}
          onChange={(event) => setCursorMs(Number(event.target.value))}
        />
        {hasTransition && timeline ? <PreviewSegments timeline={timeline} /> : null}
      </div>
      {phase?.phase === "transition" && timeline ? (
        <span className="inline-flex items-center gap-1.5 font-mono text-mono-sm tabular-nums text-secondary">
          <span className="rounded-full bg-secondary/15 px-1.5 font-sans text-label-caps">过渡</span>
          {formatExecTime(phase.elapsedMs)} / {formatExecTime(timeline.transitionMs)}
        </span>
      ) : (
        <span className="font-mono text-mono-sm tabular-nums text-foreground">
          {formatExecTime(phase?.phase === "program" ? phase.programMs : cursorMs)} /{" "}
          {formatExecTime(timeline?.programTotalMs ?? totalMs)}
        </span>
      )}
      {SPEED_OPTIONS.map((speed) => (
        <button
          key={speed}
          type="button"
          aria-pressed={multiplier === speed}
          className={cn(
            "h-6 rounded-sm px-1.5 text-label-caps",
            multiplier === speed
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent",
          )}
          onClick={() => setMultiplier(speed)}
        >
          {speed}×
        </button>
      ))}
      <button
        type="button"
        aria-label="退出预览"
        className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent"
        onClick={() => stopPreview()}
      >
        <X aria-hidden />
      </button>
    </div>
  );
};
