import type { KeyboardEvent, MouseEvent, PointerEvent } from "react";
import { cn } from "@/app/components/ui/utils";
import { viewPxFromMs } from "./timeline-view-extent";

export type CommandEventMarkerProps = {
  blockId: string;
  atMs: number;
  enabled: boolean;
  selected: boolean;
  invalid?: boolean;
  invalidMessage?: string;
  viewStartMs: number;
  pxPerSecond: number;
  onSelect: () => void;
};

export const CommandEventMarker = ({
  blockId,
  atMs,
  enabled,
  selected,
  invalid = false,
  invalidMessage,
  viewStartMs,
  pxPerSecond,
  onSelect,
}: CommandEventMarkerProps) => {
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onSelect();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelect();
  };

  return (
    <button
      type="button"
      data-block-id={blockId}
      data-timeline-time={String(atMs)}
      data-enabled={enabled ? "true" : "false"}
      aria-label={`${enabled ? "使能指令" : "断使能指令"} ${blockId}`}
      aria-pressed={selected}
      aria-invalid={invalid || undefined}
      data-invalid={invalid ? "true" : undefined}
      title={invalid ? invalidMessage : undefined}
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={cn(
        "absolute top-1/2 z-20 flex -translate-y-1/2 items-center",
        invalid && "rounded-sm bg-warning/75",
        selected ? "text-primary" : enabled ? "text-show" : "text-muted-foreground",
      )}
      style={{ left: viewPxFromMs(atMs, viewStartMs, pxPerSecond) }}
    >
      <span
        className={cn(
          "size-2.5 shrink-0 -translate-x-1/2",
          invalid
            ? enabled
              ? "rounded-full bg-warning"
              : "rounded-sm bg-warning"
            : enabled
              ? "rounded-full bg-show"
              : "rounded-sm bg-muted-foreground",
          selected && "ring-2 ring-primary",
        )}
        aria-hidden
      />
    </button>
  );
};
