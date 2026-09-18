import type { MouseEvent } from "react";
import { cn } from "@/app/components/ui/utils";
import { msToPx } from "./timeline-data";
import { viewPxFromMs } from "./timeline-view-extent";

export type SegmentBandProps = {
  objectId: number;
  fromRef: string;
  toRef: string;
  startMs: number;
  endMs: number;
  selected: boolean;
  invalid?: boolean;
  invalidMessage?: string;
  viewStartMs: number;
  pxPerSecond: number;
  onSelect: () => void;
};

export const SegmentBand = ({
  objectId,
  fromRef,
  toRef,
  startMs,
  endMs,
  selected,
  invalid = false,
  invalidMessage,
  viewStartMs,
  pxPerSecond,
  onSelect,
}: SegmentBandProps) => {
  const durationMs = endMs - startMs;
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onSelect();
  };

  return (
    <button
      type="button"
      aria-label={`运动区间 ${objectId} ${durationMs}ms`}
      title={invalid ? (invalidMessage ?? "") : ""}
      aria-pressed={selected}
      aria-invalid={invalid || undefined}
      data-invalid={invalid ? "true" : undefined}
      data-from-ref={fromRef}
      data-to-ref={toRef}
      tabIndex={0}
      onClick={handleClick}
      className={cn(
        "absolute top-1/2 z-0 flex h-5 -translate-y-1/2 items-center justify-center overflow-hidden rounded-sm px-1",
        invalid
          ? selected
            ? "bg-warning/75 text-warning"
            : "bg-warning/75 text-warning"
          : selected
            ? " bg-primary/75"
            : "bg-secondary/15 text-muted-foreground",
      )}
      style={{
        left: viewPxFromMs(startMs, viewStartMs, pxPerSecond),
        width: Math.max(msToPx(durationMs, pxPerSecond), 1),
      }}
    />
  );
};
