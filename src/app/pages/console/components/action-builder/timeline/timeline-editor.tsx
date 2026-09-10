import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ActionSequenceConfig,
  DynamicPresetBlock,
  PoseBlock,
  SetEnabledBlock,
  StaticPresetBlock,
  TimelineBlock,
} from "@/app/project/action-sequence/types";
import type { ResolvedActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import type { InvalidTimelineTargets } from "@/app/project/action-sequence/validate-sequence";
import {
  selectionBlockIds,
  selectionFromBlockIds,
  type SequenceSelection,
} from "../sequence-selection";
import {
  clampTimelinePxPerSecond,
  pxToMs,
  TIMELINE_PAD_LEFT,
  TIMELINE_ZOOM_FACTOR,
  TRACK_LABEL_WIDTH,
  type ControlledObject as TimelineControlledObject,
} from "./timeline-data";
import { TimelineHScroll } from "./timeline-h-scroll";
import { collectMarqueeBlockIds } from "./timeline-marquee";
import { computeNiceTimeTicks } from "./timeline-ticks";
import { TimelineRuler, TimelineRulerReadout } from "./timeline-ruler";
import { TimelineTrack } from "./timeline-track";
import {
  canvasWidthPx,
  clampCursorMs,
  MARQUEE_THRESHOLD_PX,
  panViewStartMs,
  TIMELINE_H_SCROLL_HEIGHT_PX,
  totEndMs,
  usedBandScreenRect,
  viewPxFromMs,
  viewStartForZoomAnchor,
  viewWindowEndMs,
  viewportDurationMs,
} from "./timeline-view-extent";

export type TimelineEditorProps = {
  sequence: ActionSequenceConfig;
  resolved: ResolvedActionSequence;
  objects: TimelineControlledObject[];
  selection: SequenceSelection;
  cursorMs: number;
  timelinePxPerSecond: number;
  onSelectionChange: (selection: SequenceSelection) => void;
  onCursorChange: (ms: number) => void;
  onPoseMove: (blockId: string, atMs: number) => void;
  onPresetMove: (blockId: string, atMs: number) => void;
  onBlocksShift?: (blockIds: string[], deltaMs: number) => void;
  onBlocksShiftEnd?: () => void;
  onDynamicPresetResize: (blockId: string, startMs: number, endMs: number) => void;
  onTimelinePxPerSecondChange: (pxPerSecond: number) => void;
  onCueDrop?: (objectId: number, cueId: string, atMs: number) => void;
  invalidTargets?: InvalidTimelineTargets;
};

const TRACK_ROW_HEIGHT = 36;

const collectSequenceObjectIds = (sequence: ActionSequenceConfig): number[] => {
  const objectIds = new Set<number>();
  for (const block of sequence.blocks) {
    if ("objectId" in block) objectIds.add(block.objectId);
    if ("orderedObjectIds" in block) {
      block.orderedObjectIds.forEach((objectId) => objectIds.add(objectId));
    }
  }
  return [...objectIds].filter((id) => Number.isFinite(id)).sort((a, b) => a - b);
};

const authoredPosesFor = (sequence: ActionSequenceConfig, objectId: number): PoseBlock[] =>
  sequence.blocks.filter(
    (block): block is PoseBlock => block.kind === "pose" && block.objectId === objectId,
  );

const commandsFor = (sequence: ActionSequenceConfig, objectId: number): SetEnabledBlock[] =>
  sequence.blocks.filter(
    (block): block is SetEnabledBlock => block.kind === "set-enabled" && block.objectId === objectId,
  );

const staticPresetsFor = (sequence: ActionSequenceConfig, objectId: number): StaticPresetBlock[] =>
  sequence.blocks.filter(
    (block): block is StaticPresetBlock =>
      block.kind === "static-preset" && block.orderedObjectIds.includes(objectId),
  );

const dynamicPresetsFor = (sequence: ActionSequenceConfig, objectId: number): DynamicPresetBlock[] =>
  sequence.blocks.filter(
    (block): block is DynamicPresetBlock =>
      block.kind === "dynamic-preset" && block.orderedObjectIds.includes(objectId),
  );

const blockOriginMs = (block: TimelineBlock): number =>
  block.kind === "dynamic-preset" ? block.startMs : block.atMs;

type MarqueeDrag = {
  startClientX: number;
  startClientY: number;
  currentClientX: number;
  currentClientY: number;
  boxing: boolean;
};

export const TimelineEditor = ({
  sequence,
  resolved,
  objects,
  selection,
  cursorMs,
  timelinePxPerSecond,
  onSelectionChange,
  onCursorChange,
  onPoseMove,
  onPresetMove,
  onBlocksShift,
  onBlocksShiftEnd,
  onDynamicPresetResize,
  onTimelinePxPerSecondChange,
  onCueDrop,
  invalidTargets,
}: TimelineEditorProps) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const labelNamesRef = useRef<HTMLDivElement>(null);
  const tracksRef = useRef<HTMLDivElement>(null);
  const groupDragOriginRef = useRef<ActionSequenceConfig | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [viewStartMs, setViewStartMs] = useState(0);
  const [marquee, setMarquee] = useState<MarqueeDrag | null>(null);
  const occupiedEndMs = resolved.totalMs;
  const pxPerSecond = timelinePxPerSecond;

  useEffect(() => {
    setViewStartMs(0);
  }, [sequence.id]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const update = () => setViewportWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const viewportMs = viewportDurationMs(viewportWidth, pxPerSecond);
  const viewEndMs = viewWindowEndMs(viewStartMs, viewportMs);
  const tot = totEndMs(occupiedEndMs, viewEndMs, viewportMs);
  const canvasWidth = canvasWidthPx(viewportWidth);
  const contentWidth = Math.max(canvasWidth - TIMELINE_PAD_LEFT, 1);
  const used = usedBandScreenRect(occupiedEndMs, viewStartMs, pxPerSecond);
  const majorTicks = useMemo(
    () =>
      computeNiceTimeTicks(pxPerSecond, viewEndMs, viewStartMs).ticks.filter(
        (tick) => tick.kind === "major",
      ),
    [pxPerSecond, viewEndMs, viewStartMs],
  );

  const objectNameById = useMemo(() => {
    const names = new Map<number, string>();
    for (const object of objects) names.set(object.id, object.name);
    return names;
  }, [objects]);

  const objectIdsInRowOrder = useMemo(() => collectSequenceObjectIds(sequence), [sequence]);

  const rows = useMemo(
    () =>
      objectIdsInRowOrder.map((objectId) => {
        const initial = resolved.initialPoseByObject.get(objectId);
        const dynamicPresets = dynamicPresetsFor(sequence, objectId);
        const generatedTicksByPreset: Record<string, number[]> = {};
        for (const block of dynamicPresets) {
          generatedTicksByPreset[block.id] = resolved.poses
            .filter(
              (point) =>
                point.objectId === objectId &&
                point.sourceBlockId === block.id &&
                point.sourceKind === "dynamic-preset" &&
                point.atMs !== null,
            )
            .map((point) => point.atMs as number);
        }
        return {
          objectId,
          objectName: objectNameById.get(objectId) ?? `模型 ${objectId}`,
          poses: authoredPosesFor(sequence, objectId).map((block) => ({
            id: block.id,
            atMs: block.atMs,
            pose: block.pose,
            label: block.label,
            isInitialPose: initial?.sourceRef === block.id,
          })),
          commands: commandsFor(sequence, objectId),
          staticPresets: staticPresetsFor(sequence, objectId),
          dynamicPresets,
          resolvedInitialPose: initial,
          generatedTicksByPreset,
          segments: resolved.segments.filter(
            (segment) => segment.objectId === objectId && segment.configurable,
          ),
        };
      }),
    [objectIdsInRowOrder, objectNameById, resolved.initialPoseByObject, resolved.poses, resolved.segments, sequence],
  );

  const clientToMs = (clientX: number): number => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return 0;
    const rect = scrollEl.getBoundingClientRect();
    const x = clientX - rect.left - TIMELINE_PAD_LEFT;
    return clampCursorMs(viewStartMs + pxToMs(x, pxPerSecond));
  };

  const clientToRow = (clientY: number): number => {
    const tracksEl = tracksRef.current;
    const scrollEl = scrollRef.current;
    if (!tracksEl || !scrollEl) return 0;
    const rect = tracksEl.getBoundingClientRect();
    const y = clientY - rect.top + scrollEl.scrollTop;
    return Math.max(0, Math.floor(y / TRACK_ROW_HEIGHT));
  };

  const handlePlayheadDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handleMove = (moveEvent: PointerEvent) => {
      onCursorChange(clientToMs(moveEvent.clientX));
    };
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  };

  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const nextPx = clampTimelinePxPerSecond(
        event.deltaY < 0
          ? pxPerSecond / TIMELINE_ZOOM_FACTOR
          : pxPerSecond * TIMELINE_ZOOM_FACTOR,
      );
      if (nextPx === pxPerSecond) return;

      const rect = scrollEl.getBoundingClientRect();
      const pointerXFromPad = event.clientX - rect.left - TIMELINE_PAD_LEFT;
      const anchorMs = viewStartMs + pxToMs(pointerXFromPad, pxPerSecond);
      onTimelinePxPerSecondChange(nextPx);
      setViewStartMs(
        viewStartForZoomAnchor({
          anchorMs,
          pointerXFromPad,
          nextPxPerSecond: nextPx,
        }),
      );
    };

    scrollEl.addEventListener("wheel", onWheel, { passive: false });
    return () => scrollEl.removeEventListener("wheel", onWheel);
  }, [onTimelinePxPerSecondChange, pxPerSecond, viewStartMs]);

  const syncLabelScroll = (scrollEl: HTMLDivElement) => {
    const labelsEl = labelNamesRef.current;
    if (labelsEl) labelsEl.scrollTop = scrollEl.scrollTop;
  };

  const handleScroll = () => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    syncLabelScroll(scrollEl);
  };

  const handleMiddlePanStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    let lastX = event.clientX;
    let lastY = event.clientY;
    const handleMove = (moveEvent: PointerEvent) => {
      const scrollEl = scrollRef.current;
      if (!scrollEl) return;
      const dx = moveEvent.clientX - lastX;
      const dy = moveEvent.clientY - lastY;
      lastX = moveEvent.clientX;
      lastY = moveEvent.clientY;
      setViewStartMs((current) => panViewStartMs(current, dx, pxPerSecond));
      scrollEl.scrollTop -= dy;
      syncLabelScroll(scrollEl);
    };
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  };

  const handleTracksPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest("button")) return;
    event.preventDefault();
    const start: MarqueeDrag = {
      startClientX: event.clientX,
      startClientY: event.clientY,
      currentClientX: event.clientX,
      currentClientY: event.clientY,
      boxing: false,
    };
    setMarquee(start);

    const handleMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - start.startClientX;
      const dy = moveEvent.clientY - start.startClientY;
      const boxing = Math.hypot(dx, dy) >= MARQUEE_THRESHOLD_PX;
      setMarquee({
        startClientX: start.startClientX,
        startClientY: start.startClientY,
        currentClientX: moveEvent.clientX,
        currentClientY: moveEvent.clientY,
        boxing,
      });
    };

    const handleUp = (upEvent: PointerEvent) => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      const dx = upEvent.clientX - start.startClientX;
      const dy = upEvent.clientY - start.startClientY;
      const boxing = Math.hypot(dx, dy) >= MARQUEE_THRESHOLD_PX;
      setMarquee(null);
      if (!boxing) {
        onCursorChange(clientToMs(upEvent.clientX));
        onSelectionChange(null);
        return;
      }
      const hits = collectMarqueeBlockIds(
        sequence,
        objectIdsInRowOrder,
        {
          startMs: clientToMs(start.startClientX),
          endMs: clientToMs(upEvent.clientX),
          startRow: clientToRow(start.startClientY),
          endRow: clientToRow(upEvent.clientY),
        },
        pxPerSecond,
      );
      onSelectionChange(selectionFromBlockIds(hits));
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  };

  const handleTimedBlockMove = (
    blockId: string,
    atMs: number,
    singleMove: (blockId: string, atMs: number) => void,
  ) => {
    const ids = selectionBlockIds(selection);
    if (onBlocksShift && ids.length > 1 && ids.includes(blockId)) {
      const origin = groupDragOriginRef.current ?? sequence;
      if (!groupDragOriginRef.current) groupDragOriginRef.current = sequence;
      const originBlock = origin.blocks.find((block) => block.id === blockId);
      if (originBlock === undefined) return;
      onBlocksShift(ids, atMs - blockOriginMs(originBlock));
      return;
    }
    singleMove(blockId, atMs);
  };

  const handleBlockMoveEnd = () => {
    groupDragOriginRef.current = null;
    onBlocksShiftEnd?.();
  };

  const marqueeStyle = (() => {
    if (!marquee?.boxing || !tracksRef.current) return null;
    const rect = tracksRef.current.getBoundingClientRect();
    const left = Math.min(marquee.startClientX, marquee.currentClientX) - rect.left;
    const top = Math.min(marquee.startClientY, marquee.currentClientY) - rect.top;
    const width = Math.abs(marquee.currentClientX - marquee.startClientX);
    const height = Math.abs(marquee.currentClientY - marquee.startClientY);
    return { left, top, width, height };
  })();

  const playheadLeft = TIMELINE_PAD_LEFT + viewPxFromMs(cursorMs, viewStartMs, pxPerSecond);

  return (
    <div
      className="flex min-h-0 flex-1 overflow-hidden bg-card"
      data-testid="timeline-viewport"
      ref={viewportRef}
    >
      <div
        data-testid="timeline-labels"
        className="flex shrink-0 flex-col overflow-hidden bg-muted"
        style={{ width: TRACK_LABEL_WIDTH }}
      >
        <TimelineRulerReadout cursorMs={cursorMs} occupiedEndMs={occupiedEndMs} />
        <div ref={labelNamesRef} className="min-h-0 flex-1 overflow-hidden">
          {rows.map((row) => (
            <div
              key={row.objectId}
              className="flex h-9 shrink-0 items-center truncate bg-card px-3 text-left text-body-sm text-foreground/80"
              title={row.objectName}
            >
              {row.objectName}
            </div>
          ))}
        </div>
        <div
          className="shrink-0 bg-muted"
          style={{ height: TIMELINE_H_SCROLL_HEIGHT_PX }}
          aria-hidden
        />
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div
          ref={scrollRef}
          data-testid="timeline-scroll"
          className="custom-scrollbar min-h-0 min-w-0 flex-1 overflow-x-clip overflow-y-auto"
          onScroll={handleScroll}
          onPointerDown={handleMiddlePanStart}
        >
          <div
            className="relative overflow-x-clip"
            data-testid="timeline-canvas"
            style={{ width: canvasWidth }}
          >
            <div className="pointer-events-none sticky top-0 z-30 h-0" aria-hidden>
              <div
                data-testid="timeline-playhead-head"
                className="absolute top-0 flex h-8 -translate-x-1/2 flex-col items-center"
                style={{ left: playheadLeft }}
              >
                <div className="h-0 w-0 border-x-[5px] border-t-[6px] border-x-transparent border-t-primary" />
                <div className="w-0.5 min-h-0 flex-1 bg-primary" />
              </div>
            </div>

            <TimelineRuler
              occupiedEndMs={occupiedEndMs}
              viewStartMs={viewStartMs}
              viewEndMs={viewEndMs}
              cursorMs={cursorMs}
              contentWidth={contentWidth}
              pxPerSecond={pxPerSecond}
              onCursorChange={onCursorChange}
            />

            <div
              ref={tracksRef}
              data-testid="timeline-tracks"
              className="relative"
              style={{ width: canvasWidth }}
              onPointerDown={handleTracksPointerDown}
            >
              <div className="pointer-events-none absolute inset-y-0 z-0 w-full" aria-hidden>
                {used ? (
                  <div
                    className="absolute inset-y-0 bg-input-background"
                    style={{ left: used.leftPx, width: used.widthPx }}
                  />
                ) : null}
                <div
                  className="absolute inset-y-0 bg-background"
                  style={{ left: used ? used.leftPx + used.widthPx : 0, right: 0 }}
                />
                {majorTicks.map((tick) => (
                  <div
                    key={tick.ms}
                    data-testid="timeline-grid-line"
                    data-tick-ms={String(tick.ms)}
                    className="absolute top-0 h-full w-px -translate-x-1/2 bg-border/40"
                    style={{ left: TIMELINE_PAD_LEFT + viewPxFromMs(tick.ms, viewStartMs, pxPerSecond) }}
                  />
                ))}
              </div>

              <div className="relative" style={{ marginLeft: TIMELINE_PAD_LEFT, width: contentWidth }}>
                {rows.map((row) => (
                  <TimelineTrack
                    key={row.objectId}
                    objectId={row.objectId}
                    objectName={row.objectName}
                    poses={row.poses}
                    commands={row.commands}
                    staticPresets={row.staticPresets}
                    dynamicPresets={row.dynamicPresets}
                    resolvedInitialPose={row.resolvedInitialPose}
                    generatedTicksByPreset={row.generatedTicksByPreset}
                    segments={row.segments}
                    selection={selection}
                    viewStartMs={viewStartMs}
                    contentWidth={contentWidth}
                    pxPerSecond={pxPerSecond}
                    onSelectionChange={onSelectionChange}
                    onPoseMove={(blockId, atMs) => handleTimedBlockMove(blockId, atMs, onPoseMove)}
                    onPresetMove={(blockId, atMs) => handleTimedBlockMove(blockId, atMs, onPresetMove)}
                    onDynamicPresetResize={onDynamicPresetResize}
                    onBlockMoveEnd={handleBlockMoveEnd}
                    onCueDrop={onCueDrop}
                    invalidTargets={invalidTargets}
                  />
                ))}
              </div>

              {marqueeStyle ? (
                <div
                  className="pointer-events-none absolute z-40 border border-primary bg-primary/20"
                  style={marqueeStyle}
                  aria-hidden
                />
              ) : null}
            </div>

            <div
              data-testid="timeline-playhead-line"
              className="pointer-events-none absolute top-0 bottom-0 z-20 w-0.5 -translate-x-1/2 bg-primary"
              style={{ left: playheadLeft }}
              aria-hidden
            />

            <div
              role="slider"
              aria-label="播放游标"
              aria-valuemin={0}
              aria-valuemax={Math.max(viewEndMs, cursorMs)}
              aria-valuenow={cursorMs}
              tabIndex={0}
              onPointerDown={handlePlayheadDrag}
              className="absolute top-0 bottom-0 z-30 w-3 -translate-x-1/2 cursor-ew-resize"
              style={{ left: playheadLeft }}
            />
          </div>
        </div>

        <TimelineHScroll
          viewStartMs={viewStartMs}
          viewportMs={viewportMs}
          totEndMs={tot}
          onViewStartChange={setViewStartMs}
        />
      </div>
    </div>
  );
};
