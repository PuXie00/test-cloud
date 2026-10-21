import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/app/components/ui/utils";
import type {
  ActionSequenceConfig,
  DynamicPresetBlock,
  PoseBlock,
  InstructionBlock,
  StaticPresetBlock,
  TimelineBlock,
  TimelineMarker,
} from "@/app/project/action-sequence/types";
import type { VirtualAxisId } from "@/app/project/project-document-types";
import { sortedMarkers } from "../marker-ops";
import { unsetAxesOf } from "@/app/project/action-sequence/keyframe-pose";
import {
  uncontrolledAxesOf,
  type ResolvedActionSequence,
  type ResolvedMotionSegment,
} from "@/app/project/action-sequence/resolve-sequence";
import type { InvalidTimelineTargets } from "@/app/project/action-sequence/validate-sequence";
import {
  segmentEndpointBlockIds,
  segmentSelection,
  selectedSegmentsOf,
  selectionBlockIds,
  selectionFromBlockIds,
  selectionMarkerIds,
  toggleBlockSelection,
  toggleMarkerSelection,
  toggleSegmentSelection,
  type SequenceSelection,
} from "../sequence-selection";
import { MARKER_LANE_HEIGHT_PX, TimelineMarkerLane } from "./timeline-markers";
import { suppressNextClick } from "./suppress-click";
import {
  clampTimelinePxPerSecond,
  pxToMs,
  TIMELINE_PAD_LEFT,
  TIMELINE_ZOOM_FACTOR,
  TRACK_LABEL_WIDTH,
  type ControlledObject as TimelineControlledObject,
} from "./timeline-data";
import { TimelineHScroll } from "./timeline-h-scroll";
import { blockObjectIds, snapSpanStart, snapTargetTimes, snapToTargets } from "./timeline-snap";
import { collectMarqueeBlockIds } from "./timeline-marquee";
import { computeNiceTimeTicks } from "./timeline-ticks";
import { TimelineRuler, TimelineRulerReadout } from "./timeline-ruler";
import { visibleGeneratedAtMs } from "./preset-ticks";
import { TimelineTrack } from "./timeline-track";
import {
  buildAxisCurves,
  fitCurveScales,
  visibleCurveObjectIds,
  type AxisCurve,
  type CurveGraph,
  type CurveKey,
  type CurveScales,
  type TimelineViewMode,
} from "./curve-data";
import {
  CurveObjectList,
  CurveScaleGutter,
  curvePlotLayout,
  TimelineCurves,
} from "./timeline-curves";
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
  fitAllPxPerSecond,
  followPlayheadViewStart,
  revealCursorViewStart,
  viewWindowEndMs,
  viewportDurationMs,
} from "./timeline-view-extent";

export type TimelineEditorProps = {
  sequence: ActionSequenceConfig;
  resolved: ResolvedActionSequence;
  objects: TimelineControlledObject[];
  selection: SequenceSelection;
  cursorMs: number;
  isPlaying?: boolean;
  timelinePxPerSecond: number;
  onSelectionChange: (selection: SequenceSelection) => void;
  onCursorChange: (ms: number) => void;
  onPoseMove: (blockId: string, atMs: number) => void;
  onPresetMove: (blockId: string, atMs: number) => void;
  onBlocksShift?: (blockIds: string[], deltaMs: number) => void;
  onBlocksShiftEnd?: () => void;
  onDynamicPresetResize: (blockId: string, startMs: number, endMs: number) => void;
  onTimelinePxPerSecondChange: (pxPerSecond: number) => void;
  invalidTargets?: InvalidTimelineTargets;
  /** 与 3D 同步的物体选中，左侧物体列表据此显示选中 */
  selectedObjectIds?: readonly number[];
  /** 点左侧物体名；rowObjectIds 为列表顺序，供 Shift 连选 */
  onObjectClick?: (
    objectId: number,
    event: React.MouseEvent<HTMLElement>,
    rowObjectIds: readonly number[],
  ) => void;
  /** 拖动块和指针时吸附到指针、其它行的块、序列起止和整秒；拖的时候按住 Alt 临时不吸 */
  snapEnabled?: boolean;
  /** 变化时缩放到全部 */
  fitRequestId?: number;
  /** 变化时把跑到视野外的指针移回视野（跳关键帧） */
  revealCursorRequestId?: number;
  /** 拖标记：deltaMs 相对拖动开始 */
  onMarkersShift?: (markerIds: string[], deltaMs: number) => void;
  onMarkersShiftEnd?: () => void;
  /** 双击标记改名 */
  onMarkerRename?: (marker: TimelineMarker) => void;
  /** 轨道或曲线视图；缺省轨道 */
  viewMode?: TimelineViewMode;
  /** 曲线视图看的虚轴 */
  curveAxis?: VirtualAxisId;
  /** 曲线视图看位置还是速度 */
  curveGraph?: CurveGraph;
  /** 曲线上拖位姿的值：这些位姿的这根轴加 deltaValue（相对拖动开始） */
  onPoseAxisDrag?: (blockIds: string[], axis: VirtualAxisId, deltaValue: number) => void;
  onPoseAxisDragEnd?: () => void;
};

const NO_OBJECT_IDS: readonly number[] = [];

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

const commandsFor = (sequence: ActionSequenceConfig, objectId: number): InstructionBlock[] =>
  sequence.blocks.filter(
    (block): block is InstructionBlock => block.kind === "instruction" && block.objectId === objectId,
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
  isPlaying = false,
  timelinePxPerSecond,
  onSelectionChange,
  onCursorChange,
  onPoseMove,
  onPresetMove,
  onBlocksShift,
  onBlocksShiftEnd,
  onDynamicPresetResize,
  onTimelinePxPerSecondChange,
  invalidTargets,
  selectedObjectIds = NO_OBJECT_IDS,
  onObjectClick,
  snapEnabled = true,
  fitRequestId = 0,
  revealCursorRequestId = 0,
  onMarkersShift,
  onMarkersShiftEnd,
  onMarkerRename,
  viewMode = "tracks",
  curveAxis = "v1",
  curveGraph = "position",
  onPoseAxisDrag,
  onPoseAxisDragEnd,
}: TimelineEditorProps) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const labelNamesRef = useRef<HTMLDivElement>(null);
  const tracksRef = useRef<HTMLDivElement>(null);
  const groupDragOriginRef = useRef<ActionSequenceConfig | null>(null);
  // 一次拖动里只在开始时改一次选中；拖区间时记下这次拖的块和区间原来的起点
  const dragSelectedRef = useRef(false);
  const segmentDragRef = useRef<{ blockIds: string[]; originStartMs: number } | null>(null);
  const markerDragRef = useRef<{ markerIds: string[]; originAtMs: number } | null>(null);
  const curvesRef = useRef<HTMLDivElement>(null);
  // 曲线上拖值：这次拖的位姿和被拖关键帧原来的值
  const curveDragRef = useRef<{ blockIds: string[]; originValue: number } | null>(null);
  const [curveAreaHeight, setCurveAreaHeight] = useState(0);
  // 拖值时纵轴刻度不动，松手再按曲线适配
  const [frozenCurveScales, setFrozenCurveScales] = useState<CurveScales | null>(null);
  const curveMode = viewMode === "curves";
  const [viewportWidth, setViewportWidth] = useState(0);
  const [viewStartMs, setViewStartMs] = useState(0);
  const [marquee, setMarquee] = useState<MarqueeDrag | null>(null);
  const [snapIndicatorMs, setSnapIndicatorMs] = useState<number | null>(null);
  // 拖动时按住 Alt 不吸附：捕获阶段先记下，块自己的拖动处理再读到
  const altHeldRef = useRef(false);
  const occupiedEndMs = resolved.totalMs;
  const pxPerSecond = timelinePxPerSecond;

  useEffect(() => {
    const track = (event: PointerEvent | KeyboardEvent) => {
      altHeldRef.current = event.altKey;
    };
    const clearIndicator = () => setSnapIndicatorMs(null);
    window.addEventListener("pointerdown", track, { capture: true });
    window.addEventListener("pointermove", track, { capture: true });
    window.addEventListener("keydown", track, { capture: true });
    window.addEventListener("keyup", track, { capture: true });
    window.addEventListener("pointerup", clearIndicator);
    return () => {
      window.removeEventListener("pointerdown", track, { capture: true });
      window.removeEventListener("pointermove", track, { capture: true });
      window.removeEventListener("keydown", track, { capture: true });
      window.removeEventListener("keyup", track, { capture: true });
      window.removeEventListener("pointerup", clearIndicator);
    };
  }, []);

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

  useEffect(() => {
    const el = curvesRef.current;
    if (!curveMode || !el || typeof ResizeObserver === "undefined") return;
    const update = () => setCurveAreaHeight(el.clientHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [curveMode]);

  const viewportMs = viewportDurationMs(viewportWidth, pxPerSecond);
  const viewEndMs = viewWindowEndMs(viewStartMs, viewportMs);
  const tot = totEndMs(occupiedEndMs, viewEndMs, viewportMs);
  const canvasWidth = canvasWidthPx(viewportWidth);
  const contentWidth = Math.max(canvasWidth - TIMELINE_PAD_LEFT, 1);
  const used = usedBandScreenRect(occupiedEndMs, viewStartMs, pxPerSecond);

  const markers = useMemo(() => sortedMarkers(sequence), [sequence]);
  const selectedMarkerIds = selectionMarkerIds(selection);

  // 缩放到全部：从 0 开始，整条序列和所有标记铺满时间区
  const fitEndMs = Math.max(occupiedEndMs, markers.at(-1)?.atMs ?? 0);
  const fitStateRef = useRef({ totalMs: fitEndMs, viewportWidth, onTimelinePxPerSecondChange });
  fitStateRef.current = { totalMs: fitEndMs, viewportWidth, onTimelinePxPerSecondChange };
  useEffect(() => {
    if (fitRequestId === 0) return;
    const { totalMs, viewportWidth: width, onTimelinePxPerSecondChange: setPx } = fitStateRef.current;
    setPx(fitAllPxPerSecond(totalMs, width));
    setViewStartMs(0);
  }, [fitRequestId]);

  // 跳关键帧后指针在视野外时移回视野中间
  const revealStateRef = useRef({ cursorMs, viewportMs });
  revealStateRef.current = { cursorMs, viewportMs };
  useEffect(() => {
    if (revealCursorRequestId === 0) return;
    const { cursorMs: target, viewportMs: span } = revealStateRef.current;
    setViewStartMs((current) =>
      revealCursorViewStart({ cursorMs: target, viewStartMs: current, viewportMs: span }),
    );
  }, [revealCursorRequestId]);

  useEffect(() => {
    if (!isPlaying) return;
    setViewStartMs((current) =>
      followPlayheadViewStart({
        cursorMs,
        viewStartMs: current,
        viewportMs,
      }),
    );
  }, [isPlaying, cursorMs, viewportMs]);
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

  const objectsById = useMemo(
    () => new Map(objects.map((object) => [object.id, object])),
    [objects],
  );
  const visibleCurveIds = useMemo(
    () => visibleCurveObjectIds(objectIdsInRowOrder, selectedObjectIds),
    [objectIdsInRowOrder, selectedObjectIds],
  );
  const curves = useMemo(
    () =>
      curveMode
        ? buildAxisCurves({ resolved, objectIds: visibleCurveIds, axis: curveAxis, objects })
        : [],
    [curveMode, resolved, visibleCurveIds, curveAxis, objects],
  );
  const fittedCurveScales = useMemo(() => fitCurveScales(curves), [curves]);
  // 选中的块所属的物体：曲线加粗，靠选中区分是哪条（不靠悬停，触屏也能用）
  const emphasizedObjectIds = useMemo(() => {
    const ids = new Set(selectionBlockIds(selection));
    return [
      ...new Set(sequence.blocks.filter((block) => ids.has(block.id)).flatMap(blockObjectIds)),
    ];
  }, [selection, sequence]);
  const curveScales = frozenCurveScales ?? fittedCurveScales;
  const curveRange = curveScales[curveGraph];
  const curveLayout = curvePlotLayout(curveAreaHeight);

  const rows = useMemo(
    () =>
      objectIdsInRowOrder.map((objectId) => {
        const initial = resolved.initialPoseByObject.get(objectId);
        const uncontrolled = uncontrolledAxesOf(resolved, objectId);
        const dynamicPresets = dynamicPresetsFor(sequence, objectId);
        const generatedTicksByPreset: Record<string, number[]> = {};
        for (const block of dynamicPresets) {
          generatedTicksByPreset[block.id] = visibleGeneratedAtMs(resolved.poses, objectId, block.id);
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
            // 序列整体不控制的轴不算“经过”
            partial: unsetAxesOf(block.pose).some((axis) => !uncontrolled.includes(axis)),
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
    [objectIdsInRowOrder, objectNameById, resolved, sequence],
  );

  const selectedSegmentKeys = useMemo(() => {
    const segments = selectedSegmentsOf(resolved, selectionBlockIds(selection));
    return new Set(segments.map((segment) => segment.key));
  }, [resolved, selection]);

  const handleBlockSelect = (blockId: string, additive: boolean) => {
    onSelectionChange(
      additive ? toggleBlockSelection(selection, blockId) : { kind: "block", blockId },
    );
  };

  /** 点区间等于选中它两端的块 */
  const handleSegmentSelect = (segment: ResolvedMotionSegment, additive: boolean) => {
    onSelectionChange(
      additive
        ? toggleSegmentSelection(resolved, selection, segment)
        : segmentSelection(resolved, segment),
    );
  };

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

  /** 磁吸：关掉或按住 Alt 时原样返回；indicate 为 true 时在吸附处画竖线 */
  const applySnap = (ms: number, targets: readonly number[], indicate = true): number => {
    if (!snapEnabled || altHeldRef.current) {
      if (indicate) setSnapIndicatorMs(null);
      return ms;
    }
    const result = snapToTargets(ms, targets, pxPerSecond);
    if (indicate) setSnapIndicatorMs(result.snappedTo);
    return result.ms;
  };

  /** 指针吸到块的时刻、序列起止和整秒 */
  const snapCursor = (ms: number, indicate = true): number =>
    applySnap(ms, snapTargetTimes({ sequence, totalMs: occupiedEndMs }), indicate);

  /** 拖块时不吸这些块所在行的块，吸指针 */
  const blockSnapTargets = (blockIds: ReadonlySet<string>): number[] =>
    snapTargetTimes({
      sequence,
      totalMs: occupiedEndMs,
      cursorMs,
      excludeObjectIds: new Set(
        sequence.blocks.filter((block) => blockIds.has(block.id)).flatMap(blockObjectIds),
      ),
    });

  const handlePlayheadDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const handleMove = (moveEvent: PointerEvent) => {
      onCursorChange(snapCursor(clientToMs(moveEvent.clientX)));
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
    const button = event.target instanceof Element ? event.target.closest("button") : null;
    // 运动区间上按住 Shift 拖也是框选（直接拖是平移，由区间自己处理）；位姿、预设等块有自己的拖动
    if (button && !button.hasAttribute("data-marquee-start")) return;
    const startedOnBand = button !== null;
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
        // 在运动区间上单击：交给它自己的 click 选中该区间
        if (startedOnBand) return;
        onCursorChange(snapCursor(clientToMs(upEvent.clientX), false));
        onSelectionChange(null);
        return;
      }
      if (startedOnBand) suppressNextClick();
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

  /** 一段时间（动态预设、运动区间）整体拖动：起止两端谁近吸谁 */
  const snapSpan = (proposedStartMs: number, durationMs: number, targets: readonly number[]) => {
    if (!snapEnabled || altHeldRef.current) {
      setSnapIndicatorMs(null);
      return proposedStartMs;
    }
    const result = snapSpanStart(proposedStartMs, durationMs, targets, pxPerSecond);
    setSnapIndicatorMs(result.snappedTo);
    return result.ms;
  };

  /** 拖没选中的块时，先选中它（拖完不再补 click） */
  const selectForDrag = (blockId: string) => {
    if (dragSelectedRef.current) return;
    dragSelectedRef.current = true;
    if (!selectionBlockIds(selection).includes(blockId)) {
      onSelectionChange({ kind: "block", blockId });
    }
  };

  const handleTimedBlockMove = (
    blockId: string,
    proposedMs: number,
    singleMove: (blockId: string, atMs: number) => void,
  ) => {
    const ids = selectionBlockIds(selection);
    const groupDrag = onBlocksShift !== undefined && ids.length > 1 && ids.includes(blockId);
    if (!groupDrag) selectForDrag(blockId);
    const targets = blockSnapTargets(new Set(groupDrag ? ids : [blockId]));
    const current = sequence.blocks.find((block) => block.id === blockId);
    const atMs =
      current?.kind === "dynamic-preset"
        ? snapSpan(proposedMs, current.endMs - current.startMs, targets)
        : applySnap(proposedMs, targets);
    if (groupDrag) {
      const origin = groupDragOriginRef.current ?? sequence;
      if (!groupDragOriginRef.current) groupDragOriginRef.current = sequence;
      const originBlock = origin.blocks.find((block) => block.id === blockId);
      if (originBlock === undefined) return;
      onBlocksShift(ids, atMs - blockOriginMs(originBlock));
      return;
    }
    singleMove(blockId, atMs);
  };

  const handleDynamicPresetResize = (
    blockId: string,
    startMs: number,
    endMs: number,
    edge?: "start" | "end",
  ) => {
    selectForDrag(blockId);
    if (edge === undefined) {
      onDynamicPresetResize(blockId, startMs, endMs);
      return;
    }
    const targets = blockSnapTargets(new Set([blockId]));
    if (edge === "start") onDynamicPresetResize(blockId, applySnap(startMs, targets), endMs);
    else onDynamicPresetResize(blockId, startMs, applySnap(endMs, targets));
  };

  /**
   * 拖运动区间等于拖它两端的块：区间已选中时整组选中的块一起走，
   * 没选中时先改成只选中它两端。
   */
  const handleSegmentMove = (segment: ResolvedMotionSegment, proposedStartMs: number) => {
    if (!onBlocksShift) return;
    let drag = segmentDragRef.current;
    if (drag === null) {
      const endpoints = segmentEndpointBlockIds(resolved, segment);
      if (endpoints.length === 0) return;
      const ids = selectionBlockIds(selection);
      const selected = endpoints.every((id) => ids.includes(id));
      if (!selected) onSelectionChange(selectionFromBlockIds(endpoints, "segments"));
      drag = { blockIds: selected ? ids : endpoints, originStartMs: segment.startMs };
      segmentDragRef.current = drag;
    }
    const startMs = snapSpan(
      proposedStartMs,
      segment.durationMs,
      blockSnapTargets(new Set(drag.blockIds)),
    );
    onBlocksShift(drag.blockIds, startMs - drag.originStartMs);
  };

  /** 点标记：选中它并把指针移过去；Ctrl/⌘ 单击加选或减选 */
  const handleMarkerSelect = (marker: TimelineMarker, additive: boolean) => {
    if (additive) {
      onSelectionChange(toggleMarkerSelection(selection, marker.id));
      return;
    }
    onSelectionChange({ kind: "markers", markerIds: [marker.id] });
    onCursorChange(marker.atMs);
  };

  /** 拖标记：标记已选中时选中的一起走，没选中时先只选中它 */
  const handleMarkerMove = (marker: TimelineMarker, proposedMs: number) => {
    if (!onMarkersShift) return;
    let drag = markerDragRef.current;
    if (drag === null) {
      const selected = selectionMarkerIds(selection);
      const grouped = selected.includes(marker.id);
      if (!grouped) onSelectionChange({ kind: "markers", markerIds: [marker.id] });
      drag = { markerIds: grouped ? selected : [marker.id], originAtMs: marker.atMs };
      markerDragRef.current = drag;
    }
    const targets = snapTargetTimes({
      sequence,
      totalMs: occupiedEndMs,
      cursorMs,
      excludeMarkerIds: new Set(drag.markerIds),
    });
    onMarkersShift(drag.markerIds, applySnap(proposedMs, targets) - drag.originAtMs);
  };

  const handleMarkerMoveEnd = () => {
    markerDragRef.current = null;
    setSnapIndicatorMs(null);
    onMarkersShiftEnd?.();
  };

  const handleBlockMoveEnd = () => {
    groupDragOriginRef.current = null;
    dragSelectedRef.current = false;
    segmentDragRef.current = null;
    setSnapIndicatorMs(null);
    onBlocksShiftEnd?.();
  };

  /**
   * 曲线上拖关键帧的值：关键帧所在位姿已选中时，选中的位姿这根轴一起加同样的增量；
   * 没选中时先只选中它。只改值，不改时间。
   */
  const handleCurveKeyDrag = (curve: AxisCurve, key: CurveKey, value: number) => {
    if (!onPoseAxisDrag || key.blockId === null) return;
    let drag = curveDragRef.current;
    if (drag === null) {
      const ids = selectionBlockIds(selection);
      const grouped = ids.length > 1 && ids.includes(key.blockId);
      if (!ids.includes(key.blockId)) onSelectionChange({ kind: "block", blockId: key.blockId });
      drag = { blockIds: grouped ? ids : [key.blockId], originValue: key.value };
      curveDragRef.current = drag;
      setFrozenCurveScales(curveScales);
    }
    onPoseAxisDrag(drag.blockIds, curve.axis, value - drag.originValue);
  };

  const handleCurveKeyDragEnd = () => {
    if (curveDragRef.current === null) return;
    curveDragRef.current = null;
    setFrozenCurveScales(null);
    onPoseAxisDragEnd?.();
  };

  const handleCurveBackgroundClick = (clientX: number) => {
    onCursorChange(snapCursor(clientToMs(clientX), false));
    onSelectionChange(null);
  };

  /** 点在两个关键帧之间的曲线上：选中这一刻所在的运动区间（预设内部的选中预设） */
  const handleCurveSelect = (curve: AxisCurve, atMs: number, additive: boolean) => {
    const segment = resolved.segments.find(
      (item) => item.objectId === curve.objectId && atMs >= item.startMs && atMs < item.endMs,
    );
    if (!segment) {
      onCursorChange(snapCursor(atMs, false));
      onSelectionChange(null);
      return;
    }
    if (segment.configurable) {
      handleSegmentSelect(segment, additive);
      return;
    }
    if (segment.ownerPresetBlockId) handleBlockSelect(segment.ownerPresetBlockId, additive);
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
        {curveMode ? (
          <div className="flex min-h-0 flex-1 overflow-hidden bg-card">
            <CurveObjectList
              rows={rows}
              curves={curves}
              graph={curveGraph}
              visibleObjectIds={visibleCurveIds}
              selectedObjectIds={selectedObjectIds}
              emphasizedObjectIds={emphasizedObjectIds}
              cursorMs={cursorMs}
              objectsById={objectsById}
              onObjectClick={onObjectClick}
            />
            <CurveScaleGutter
              layout={curveLayout}
              range={curveRange}
              graph={curveGraph}
              curves={curves}
              objectsById={objectsById}
              axis={curveAxis}
            />
          </div>
        ) : (
          <div ref={labelNamesRef} className="min-h-0 flex-1 overflow-hidden bg-card">
            {rows.map((row) => {
              const objectSelected = selectedObjectIds.includes(row.objectId);
              return (
                <button
                  key={row.objectId}
                  type="button"
                  aria-pressed={objectSelected}
                  onClick={(event) => onObjectClick?.(row.objectId, event, objectIdsInRowOrder)}
                  className={cn(
                    "flex h-9 w-full shrink-0 items-center truncate border-l-2 px-3 text-left text-body-sm",
                    objectSelected
                      ? "border-l-primary bg-accent text-primary"
                      : "border-l-transparent bg-card text-foreground/80 hover:bg-muted/40",
                  )}
                  title={row.objectName}
                >
                  {row.objectName}
                </button>
              );
            })}
          </div>
        )}
        {markers.length > 0 ? (
          <div
            className="flex shrink-0 items-center border-t border-border/40 bg-muted px-3 text-[11px] text-muted-foreground"
            style={{ height: MARKER_LANE_HEIGHT_PX }}
          >
            标记
          </div>
        ) : null}
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
          className="custom-scrollbar flex min-h-0 min-w-0 flex-1 flex-col overflow-x-clip overflow-y-auto"
          onScroll={handleScroll}
          onPointerDown={handleMiddlePanStart}
        >
          <div
            className="relative flex flex-1 flex-col overflow-x-clip"
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
              onScrub={(ms) => onCursorChange(snapCursor(ms))}
            />

            {curveMode ? (
              <div
                ref={curvesRef}
                data-testid="timeline-curves"
                className="relative min-h-0 flex-1 touch-none overflow-hidden"
                style={{ width: canvasWidth }}
              >
                <TimelineCurves
                  curves={curves}
                  graph={curveGraph}
                  range={curveRange}
                  layout={curveLayout}
                  canvasWidth={canvasWidth}
                  viewStartMs={viewStartMs}
                  viewEndMs={viewEndMs}
                  pxPerSecond={pxPerSecond}
                  occupiedEndMs={occupiedEndMs}
                  gridTimesMs={majorTicks.map((tick) => tick.ms)}
                  markers={markers}
                  selectedMarkerIds={selectedMarkerIds}
                  selectedBlockIds={selectionBlockIds(selection)}
                  objectsById={objectsById}
                  objectName={(objectId) => objectNameById.get(objectId) ?? `模型 ${objectId}`}
                  emphasizedObjectIds={emphasizedObjectIds}
                  snapEnabled={snapEnabled}
                  onBlockSelect={handleBlockSelect}
                  onCurveSelect={handleCurveSelect}
                  onBackgroundClick={handleCurveBackgroundClick}
                  onMarquee={(blockIds) => onSelectionChange(selectionFromBlockIds(blockIds))}
                  onKeyDrag={onPoseAxisDrag ? handleCurveKeyDrag : undefined}
                  onKeyDragEnd={handleCurveKeyDragEnd}
                />
              </div>
            ) : (
              <div
                ref={tracksRef}
                data-testid="timeline-tracks"
                className="relative min-h-0 flex-1"
                style={{ width: canvasWidth }}
                onPointerDown={handleTracksPointerDown}
              >
                <div className="pointer-events-none absolute inset-0 z-0 w-full" aria-hidden>
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
                  {markers.map((marker) => (
                    <div
                      key={marker.id}
                      data-testid="timeline-marker-line"
                      className={cn(
                        "absolute top-0 h-full w-0 border-l border-dashed",
                        selectedMarkerIds.includes(marker.id)
                          ? "border-primary/70"
                          : "border-foreground/20",
                      )}
                      style={{ left: TIMELINE_PAD_LEFT + viewPxFromMs(marker.atMs, viewStartMs, pxPerSecond) }}
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
                      selectedSegmentKeys={selectedSegmentKeys}
                      viewStartMs={viewStartMs}
                      contentWidth={contentWidth}
                      pxPerSecond={pxPerSecond}
                      onBlockSelect={handleBlockSelect}
                      onSegmentSelect={handleSegmentSelect}
                      onSegmentMove={onBlocksShift ? handleSegmentMove : undefined}
                      onPoseMove={(blockId, atMs) => handleTimedBlockMove(blockId, atMs, onPoseMove)}
                      onPresetMove={(blockId, atMs) => handleTimedBlockMove(blockId, atMs, onPresetMove)}
                      onDynamicPresetResize={handleDynamicPresetResize}
                      onBlockMoveEnd={handleBlockMoveEnd}
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
            )}

            {markers.length > 0 ? (
              <TimelineMarkerLane
                markers={markers}
                selectedMarkerIds={selectedMarkerIds}
                cursorMs={cursorMs}
                viewStartMs={viewStartMs}
                pxPerSecond={pxPerSecond}
                contentWidth={contentWidth}
                onSelect={handleMarkerSelect}
                onMove={handleMarkerMove}
                onMoveEnd={handleMarkerMoveEnd}
                onRename={(marker) => onMarkerRename?.(marker)}
              />
            ) : null}

            {snapIndicatorMs !== null ? (
              <div
                data-testid="timeline-snap-line"
                data-snap-ms={String(snapIndicatorMs)}
                className="pointer-events-none absolute top-0 bottom-0 z-20 w-0 -translate-x-1/2 border-l border-dashed border-warning"
                style={{ left: TIMELINE_PAD_LEFT + viewPxFromMs(snapIndicatorMs, viewStartMs, pxPerSecond) }}
                aria-hidden
              />
            ) : null}

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
