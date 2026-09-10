import { vi } from "vitest";
import { resolveActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import type { TimelineEditorProps } from "./timeline-editor";

export const createTimelineProps = (
  sequence: ActionSequenceConfig,
  onSelectionChange = vi.fn(),
): TimelineEditorProps => {
  const objectIds = new Set<number>();
  for (const block of sequence.blocks) {
    if ("objectId" in block) objectIds.add(block.objectId);
    if ("orderedObjectIds" in block) {
      block.orderedObjectIds.forEach((objectId) => objectIds.add(objectId));
    }
  }
  return {
    sequence,
    resolved: resolveActionSequence(sequence),
    objects: [...objectIds].map((id) => ({
      id,
      name: `模型 ${id}`,
      currentPosition: 0,
      unit: "mm",
      axisLabel: "H",
      enabled: true,
      enabledAxes: ["v1", "v2", "v3"],
    })),
    selection: null,
    cursorMs: 0,
    timelinePxPerSecond: 100,
    onSelectionChange,
    onCursorChange: vi.fn(),
    onPoseMove: vi.fn(),
    onPresetMove: vi.fn(),
    onBlocksShift: vi.fn(),
    onBlocksShiftEnd: vi.fn(),
    onDynamicPresetResize: vi.fn(),
    onTimelinePxPerSecondChange: vi.fn(),
  };
};

export const TIMELINE_TEST_PANE_PX = 800;

export const installTimelinePaneWidth = (): (() => void) => {
  const Previous = globalThis.ResizeObserver;
  class TimelinePaneObserver {
    private readonly callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(target: Element) {
      Object.defineProperty(target, "clientWidth", {
        configurable: true,
        get: () => TIMELINE_TEST_PANE_PX,
      });
      this.callback(
        [{ target } as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    }
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = TimelinePaneObserver as typeof ResizeObserver;
  return () => {
    globalThis.ResizeObserver = Previous;
  };
};
