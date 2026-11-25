import { useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { Link2 } from "lucide-react";
import { cn } from "@/app/components/ui/utils";
import { formatTime, msToPx } from "./timeline-data";
import { viewPxFromMs } from "./timeline-view-extent";
import { DRAG_CLICK_THRESHOLD_PX, isAdditiveClick, useDragClickGuard } from "./suppress-click";
import { useTimelineEdgeScroll } from "./timeline-edge-scroll";

export type SequenceRefBarProps = {
  blockId: string;
  /** 被引用序列现在的名字（删了时用引用里存的名字） */
  name: string;
  /** 被引用的序列已经删了：照常播放，不再跟着更新 */
  detached?: boolean;
  atMs: number;
  durationMs: number;
  selected: boolean;
  invalid?: boolean;
  invalidMessage?: string;
  viewStartMs: number;
  pxPerSecond: number;
  /** additive：Ctrl/⌘ 单击加选或减选 */
  onSelect: (additive: boolean) => void;
  onMove: (atMs: number) => void;
  onMoveEnd?: () => void;
  /** 双击：打开被引用的序列 */
  onOpen?: () => void;
};

/** 引用的另一条序列：一条带名字的横条，整段拖动；里面的块跟着被引用的序列走，不能单独改 */
export const SequenceRefBar = ({
  blockId,
  name,
  detached = false,
  atMs,
  durationMs,
  selected,
  invalid = false,
  invalidMessage,
  viewStartMs,
  pxPerSecond,
  onSelect,
  onMove,
  onMoveEnd,
  onOpen,
}: SequenceRefBarProps) => {
  const [dragging, setDragging] = useState(false);
  const dragClick = useDragClickGuard();
  const beginEdgeScroll = useTimelineEdgeScroll();

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (dragClick.consumeDragClick()) return;
    onSelect(isAdditiveClick(event));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelect(false);
  };

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    dragClick.pressStarted();
    const startX = event.clientX;
    const initialAtMs = atMs;
    let moved = false;
    let lastClientX = startX;
    const handleMove = (moveEvent: Pick<globalThis.PointerEvent, "clientX">) => {
      lastClientX = moveEvent.clientX;
      const dx = moveEvent.clientX - startX;
      if (!moved && Math.abs(dx) < DRAG_CLICK_THRESHOLD_PX) return;
      moved = true;
      setDragging(true);
      onMove(Math.max(0, initialAtMs + Math.round((dx / pxPerSecond) * 1000) + edgeScroll.shiftMs()));
    };
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      edgeScroll.end();
      if (!moved) return;
      setDragging(false);
      dragClick.dragEnded();
      onMoveEnd?.();
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    const edgeScroll = beginEdgeScroll(() => handleMove({ clientX: lastClientX }));
  };

  const title = `引用「${name}」${detached ? "（原序列已删除，不再跟着更新）" : ""}，${formatTime(durationMs)} s：双击打开原序列`;

  return (
    <button
      type="button"
      data-block-id={blockId}
      data-timeline-time={String(atMs)}
      aria-label={`引用 ${name}`}
      aria-pressed={selected}
      aria-invalid={invalid || undefined}
      data-invalid={invalid ? "true" : undefined}
      title={invalid ? (invalidMessage ?? title) : title}
      tabIndex={0}
      onClick={handleClick}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onOpen?.();
      }}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      className={cn(
        "absolute top-1 z-10 flex h-[calc(100%-8px)] cursor-grab items-center gap-1 overflow-hidden rounded-sm border border-dashed px-1 active:cursor-grabbing",
        invalid
          ? "border-warning bg-warning/40 text-warning"
          : selected
            ? "border-primary bg-primary/60 text-foreground"
            : "border-primary/60 bg-primary/15 text-foreground/80",
      )}
      style={{
        left: viewPxFromMs(atMs, viewStartMs, pxPerSecond),
        width: Math.max(msToPx(durationMs, pxPerSecond), 1),
      }}
    >
      <Link2 className="h-3 w-3 shrink-0" aria-hidden />
      <span className={cn("min-w-0 truncate text-[11px]", detached && "line-through")}>{name}</span>
      {dragging ? (
        <span className="pointer-events-none absolute -top-5 left-0 z-40 rounded-sm bg-card px-1.5 py-0.5 font-mono text-mono-sm tabular-nums text-foreground">
          {formatTime(atMs)}
        </span>
      ) : null}
    </button>
  );
};
