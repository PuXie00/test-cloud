import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/app/components/ui/utils";
import type {
  ActionSequenceConfig,
  DynamicPresetBlock,
  PoseBlock,
  InstructionBlock,
  SequenceRefBlock,
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
  type ObjectFollow,
  type SequenceSelection,
} from "../sequence-selection";
import { MARKER_LANE_HEIGHT_PX, TimelineMarkerLane } from "./timeline-markers";
import { DRAG_CLICK_THRESHOLD_PX, isAdditiveClick, suppressNextClick } from "./suppress-click";
import {
  formatTime,
  msToPx,
  pxToMs,
  snapTimeMs,
  TIME_STEP_MS,
  TIMELINE_PAD_LEFT,
  TRACK_LABEL_WIDTH,
  type ControlledObject as TimelineControlledObject,
} from "./timeline-data";
import { TimelineEdgeScrollContext, useEdgeScrollController } from "./timeline-edge-scroll";
import { TimelineHScroll } from "./timeline-h-scroll";
import { blockObjectIds, blockSpanMs, snapSpanStart, snapTargetTimes, snapToTargets } from "./timeline-snap";
import { isSequenceRefDrag, readSequenceRefDrag } from "../content-library/library-dnd";
import {
  collectMarqueeBlockIds,
  collectTimeRangeBlockIds,
  columnBlockIds,
  columnTimesMs,
} from "./timeline-marquee";
import { computeNiceTimeTicks } from "./timeline-ticks";
import { TimelineRuler, TimelineRulerReadout, type RulerColumn } from "./timeline-ruler";
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
import { TrackCurveUnderlay } from "./track-curve-underlay";
import {
  canvasWidthPx,
  clampCursorMs,
  MARQUEE_THRESHOLD_PX,
  panViewStartMs,
  PLAYHEAD_GRAB_HALF_PX,
  TIMELINE_H_SCROLL_HEIGHT_PX,
  totEndMs,
  usedBandScreenRect,
  viewPxFromMs,
  viewStartForCursorZoom,
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
  /** follow：轨道上点选时物体选中怎么跟（见 ObjectFollow）；不传时物体不跟 */
  onSelectionChange: (selection: SequenceSelection, follow?: ObjectFollow) => void;
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
  /** 轨道视图只选了一个物体时，把它的曲线（curveAxis、curveGraph）铺在轨道区背后 */
  curveUnderlay?: boolean;
  /** 曲线上拖位姿的值：这些位姿的这根轴加 deltaValue（相对拖动开始） */
  onPoseAxisDrag?: (blockIds: string[], axis: VirtualAxisId, deltaValue: number) => void;
  onPoseAxisDragEnd?: () => void;
  /** 双击轨道空白处：在那个时刻给这一行的物体加位姿（吸附开着时对齐） */
  onCreatePoseAt?: (objectId: number, atMs: number) => void;
  /**
   * 整体缩放：选中两段以上运动区间时选区有外框，拖右边改总时长（durationMs 相对拖动开始的选区）；
   * 松手调 onScaleSelectionEnd。不传时没有拖柄
   */
  onScaleSelection?: (blockIds: string[], durationMs: number) => void;
  onScaleSelectionEnd?: () => void;
  /** 动作序列库里序列现在的名字（引用的横条上显示）；引用的序列删了时查不到 */
  sequenceNames?: ReadonlyMap<number, string>;
  /** 双击引用的横条：打开被引用的序列 */
  onOpenSequence?: (sequenceId: number) => void;
  /** 从动作序列库拖一条序列到轨道上：在落点引用它（吸附开着时对齐） */
  onDropSequence?: (sequenceId: number, atMs: number) => void;
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

const sequenceRefsFor = (sequence: ActionSequenceConfig, objectId: number): SequenceRefBlock[] =>
  sequence.blocks.filter(
    (block): block is SequenceRefBlock =>
      block.kind === "sequence-ref" && block.orderedObjectIds.includes(objectId),
  );

const blockOriginMs = (block: TimelineBlock): number =>
  block.kind === "dynamic-preset" ? block.startMs : block.atMs;

/** 按行滚动的滚轮（deltaMode 1）一行算这么多像素 */
const WHEEL_LINE_PX = 16;

/** 拖动时换算时刻用的横向范围：left 处是视图起点，right 是时间区右边 */
type DragFrame = { left: number; right: number };

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
  curveUnderlay = false,
  onPoseAxisDrag,
  onPoseAxisDragEnd,
  onCreatePoseAt,
  onScaleSelection,
  onScaleSelectionEnd,
  sequenceNames,
  onOpenSequence,
  onDropSequence,
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
  // 拖动、贴边滚动在两次渲染之间也要读写视图起点：这份总是最新的
  const viewStartRef = useRef(viewStartMs);
  viewStartRef.current = viewStartMs;
  const setViewStart = useCallback((ms: number) => {
    viewStartRef.current = ms;
    setViewStartMs(ms);
  }, []);
  const pxPerSecondRef = useRef(timelinePxPerSecond);
  pxPerSecondRef.current = timelinePxPerSecond;
  const [rangeSelectMs, setRangeSelectMs] = useState<{ startMs: number; endMs: number } | null>(null);
  // 从动作序列库拖序列过来时落点的时刻
  const [dropAtMs, setDropAtMs] = useState<number | null>(null);
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
    setViewStart(0);
  }, [sequence.id, setViewStart]);

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
  const fitStateRef = useRef({ totalMs: fitEndMs, viewportWidth, onTimelinePxPerSecondChange, pxPerSecond });
  fitStateRef.current = { totalMs: fitEndMs, viewportWidth, onTimelinePxPerSecondChange, pxPerSecond };
  // 「适合窗口」改的缩放不按游标对齐（从 0 开始铺满）
  const skipZoomAnchorRef = useRef(false);
  useEffect(() => {
    if (fitRequestId === 0) return;
    const { totalMs, viewportWidth: width, onTimelinePxPerSecondChange: setPx, pxPerSecond: currentPx } =
      fitStateRef.current;
    const nextPx = fitAllPxPerSecond(totalMs, width);
    if (nextPx !== currentPx) skipZoomAnchorRef.current = true;
    setPx(nextPx);
    setViewStart(0);
  }, [fitRequestId, setViewStart]);

  // 缩放（工具栏滑条、− +）以游标为准：游标在视野里时它在屏幕上的位置不变，不在视野里时缩放完放到中间
  const zoomStateRef = useRef({ pxPerSecond, cursorMs, viewportWidth });
  useLayoutEffect(() => {
    const previous = zoomStateRef.current;
    zoomStateRef.current = { pxPerSecond, cursorMs, viewportWidth };
    if (previous.pxPerSecond === pxPerSecond) return;
    if (skipZoomAnchorRef.current) {
      skipZoomAnchorRef.current = false;
      return;
    }
    setViewStart(
      viewStartForCursorZoom({
        cursorMs,
        viewStartMs: viewStartRef.current,
        viewportWidthPx: viewportWidth,
        previousPxPerSecond: previous.pxPerSecond,
        nextPxPerSecond: pxPerSecond,
      }),
    );
  }, [pxPerSecond, cursorMs, viewportWidth, setViewStart]);

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
  const underlayObjectId =
    !curveMode &&
    curveUnderlay &&
    selectedObjectIds.length === 1 &&
    objectIdsInRowOrder.includes(selectedObjectIds[0]!)
      ? selectedObjectIds[0]!
      : null;
  const underlayCurve = useMemo(
    () =>
      underlayObjectId === null
        ? null
        : (buildAxisCurves({ resolved, objectIds: [underlayObjectId], axis: curveAxis, objects })[0] ??
          null),
    [underlayObjectId, resolved, curveAxis, objects],
  );
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
          sequenceRefs: sequenceRefsFor(sequence, objectId),
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

  // 选中两段以上运动区间：选区外框（最早到最晚、选中物体所在的行），右边拖柄整体缩放
  const scaleFrame = useMemo(() => {
    if (curveMode || !onScaleSelection || selectedSegmentKeys.size < 2) return null;
    const ids = new Set(selectionBlockIds(selection));
    const blocks = sequence.blocks.filter((block) => ids.has(block.id));
    if (blocks.length === 0) return null;
    const startMs = Math.min(...blocks.map(blockOriginMs));
    const endMs = Math.max(...blocks.map((block) => blockSpanMs(block).endMs));
    const rowIndices = blocks
      .flatMap(blockObjectIds)
      .map((objectId) => objectIdsInRowOrder.indexOf(objectId))
      .filter((index) => index >= 0);
    if (endMs <= startMs || rowIndices.length === 0) return null;
    return { startMs, endMs, firstRow: Math.min(...rowIndices), lastRow: Math.max(...rowIndices) };
  }, [curveMode, onScaleSelection, selectedSegmentKeys, selection, sequence, objectIdsInRowOrder]);
  const [scaleDrag, setScaleDrag] = useState<{ originDurationMs: number } | null>(null);

  /** follow 为 null 时只改块的选中，物体不跟 */
  const selectAndFollow = (next: SequenceSelection, follow: ObjectFollow | null) => {
    if (follow) onSelectionChange(next, follow);
    else onSelectionChange(next);
  };

  /** follow 为 false：曲线视图里点选，物体选中不跟（曲线按选中的物体显示） */
  const handleBlockSelect = (blockId: string, additive: boolean, follow = true) => {
    selectAndFollow(
      additive ? toggleBlockSelection(selection, blockId) : { kind: "block", blockId },
      follow ? (additive ? "add" : "replace") : null,
    );
  };

  /** 点区间等于选中它两端的块 */
  const handleSegmentSelect = (
    segment: ResolvedMotionSegment,
    additive: boolean,
    follow = true,
  ) => {
    selectAndFollow(
      additive
        ? toggleSegmentSelection(resolved, selection, segment)
        : segmentSelection(resolved, segment),
      follow ? (additive ? "add" : "replace") : null,
    );
  };

  /** 时间区的横向范围（左边去掉内边距） */
  const scrollFrame = (): DragFrame | null => {
    const rect = scrollRef.current?.getBoundingClientRect();
    return rect ? { left: rect.left + TIMELINE_PAD_LEFT, right: rect.right } : null;
  };

  /** 指针所在的时刻；clampToFrame 时出了左右边按边上算（拖游标时游标停在边上，视图贴边滚） */
  const frameMs = (frame: DragFrame, clientX: number, clampToFrame = false): number => {
    const x =
      clampToFrame && frame.right - frame.left > 1
        ? Math.min(Math.max(clientX, frame.left), frame.right - 1)
        : clientX;
    return clampCursorMs(viewStartRef.current + pxToMs(x - frame.left, pxPerSecond));
  };

  const clientToMs = (clientX: number): number => {
    const frame = scrollFrame();
    return frame ? frameMs(frame, clientX) : 0;
  };

  // 拖到时间区左右边上时视图自己滚（拖游标、拖块、拖标记、Shift 拖选时间段）
  const beginEdgeScroll = useEdgeScrollController({
    getBounds: scrollFrame,
    getViewStartMs: () => viewStartRef.current,
    setViewStartMs: setViewStart,
    pxPerSecond,
  });

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

  /** 双击轨道空白处加位姿；双击在块、区间上不管 */
  const handleTracksDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!onCreatePoseAt) return;
    if ((event.target as HTMLElement).closest("button, [role='button']")) return;
    const row = rows[clientToRow(event.clientY)];
    if (!row) return;
    onCreatePoseAt(row.objectId, snapCursor(clientToMs(event.clientX), false));
  };

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

  /**
   * 拖游标：指针出了左右边时游标停在边上，视图贴边滚、游标跟着走。
   * frame 是按下处的横向范围（标尺用自己的，轨道里的游标用时间区的）
   */
  const startPlayheadDrag = (startClientX: number, frame: DragFrame | null) => {
    let lastClientX = startClientX;
    const update = () => {
      const current = frame ?? scrollFrame();
      if (current) onCursorChange(snapCursor(frameMs(current, lastClientX, true)));
    };
    const handleMove = (moveEvent: PointerEvent) => {
      lastClientX = moveEvent.clientX;
      update();
    };
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      edgeScroll.end();
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    const edgeScroll = beginEdgeScroll(update);
  };

  const handlePlayheadDrag = (event: React.PointerEvent<Element>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    startPlayheadDrag(event.clientX, null);
  };

  /** 标尺内层的横向范围：left 处是视图起点 */
  const rulerFrame = (target: HTMLElement): DragFrame => {
    const rect = target.getBoundingClientRect();
    return { left: rect.left, right: rect.right };
  };

  /** Shift 拖标尺：选中这段时间里所有物体的块；加 Ctrl/⌘ 加选。视图贴边滚 */
  const startRangeSelect = (frame: DragFrame, startClientX: number, additive: boolean) => {
    const startMs = frameMs(frame, startClientX);
    let lastClientX = startClientX;
    const currentMs = () => frameMs(frame, lastClientX, true);
    setRangeSelectMs({ startMs, endMs: startMs });
    const update = () => setRangeSelectMs({ startMs, endMs: currentMs() });
    const handleMove = (moveEvent: PointerEvent) => {
      lastClientX = moveEvent.clientX;
      update();
    };
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      edgeScroll.end();
      setRangeSelectMs(null);
      const endMs = currentMs();
      if (endMs === startMs) return;
      const hits = collectTimeRangeBlockIds(sequence, { startMs, endMs });
      const ids = additive ? [...selectionBlockIds(selection), ...hits] : hits;
      onSelectionChange(selectionFromBlockIds(ids), additive ? "add" : "replace");
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    const edgeScroll = beginEdgeScroll(update);
  };

  /** 按下标尺：游标跳过去接着拖；Shift 拖选时间段 */
  const handleRulerPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const frame = rulerFrame(event.currentTarget);
    if (event.shiftKey) {
      startRangeSelect(frame, event.clientX, isAdditiveClick(event));
      return;
    }
    onCursorChange(snapCursor(frameMs(frame, event.clientX)));
    startPlayheadDrag(event.clientX, frame);
  };

  // 有位姿的时刻：标尺上的小菱形，整列都选中了的高亮
  const columns = useMemo((): RulerColumn[] => {
    const selected = new Set(selectionBlockIds(selection));
    return columnTimesMs(sequence).map((atMs) => ({
      atMs,
      selected: columnBlockIds(sequence, atMs).every((id) => selected.has(id)),
    }));
  }, [sequence, selection]);

  /** 选中这一时刻所有物体的位姿（整列）；additive 时加选，已经整列选中的再点去掉 */
  const handleColumnSelect = (atMs: number, additive: boolean) => {
    const ids = columnBlockIds(sequence, atMs);
    if (ids.length === 0) return;
    if (!additive) {
      onSelectionChange(selectionFromBlockIds(ids), "replace");
      return;
    }
    const current = selectionBlockIds(selection);
    const whole = ids.every((id) => current.includes(id));
    onSelectionChange(
      selectionFromBlockIds(whole ? current.filter((id) => !ids.includes(id)) : [...current, ...ids]),
      "add",
    );
  };

  /** 标尺上的菱形：单击选整列并把游标移过去，拖动整列一起挪（整列在选中里时选中的一起走） */
  const handleColumnPointerDown = (column: RulerColumn, event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const additive = isAdditiveClick(event);
    const startX = event.clientX;
    const ids = columnBlockIds(sequence, column.atMs);
    let lastClientX = startX;
    let dragIds: string[] | null = null;
    const handleMove = (moveEvent: Pick<PointerEvent, "clientX">) => {
      lastClientX = moveEvent.clientX;
      const dx = moveEvent.clientX - startX;
      if (!onBlocksShift || (dragIds === null && Math.abs(dx) < DRAG_CLICK_THRESHOLD_PX)) return;
      if (dragIds === null) {
        const selected = selectionBlockIds(selection);
        const grouped = ids.every((id) => selected.includes(id));
        if (!grouped) onSelectionChange(selectionFromBlockIds(ids), "replace");
        dragIds = grouped ? selected : ids;
      }
      const proposedMs = Math.max(0, column.atMs + pxToMs(dx, pxPerSecond) + edgeScroll.shiftMs());
      const atMs = applySnap(proposedMs, blockSnapTargets(new Set(dragIds)));
      onBlocksShift(dragIds, atMs - column.atMs);
    };
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      edgeScroll.end();
      if (dragIds === null) {
        handleColumnSelect(column.atMs, additive);
        if (!additive) onCursorChange(column.atMs);
        return;
      }
      handleBlockMoveEnd();
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    const edgeScroll = beginEdgeScroll(() => handleMove({ clientX: lastClientX }));
  };

  // 滚轮上下滚轨道（浏览器自己滚）；Shift+滚轮、触控板横滑左右平移时间；滚轮不缩放
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    const onWheel = (event: WheelEvent) => {
      const horizontal = event.shiftKey
        ? event.deltaX || event.deltaY
        : Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : 0;
      if (horizontal === 0) return;
      event.preventDefault();
      const unitPx =
        event.deltaMode === 1 ? WHEEL_LINE_PX : event.deltaMode === 2 ? scrollEl.clientWidth : 1;
      setViewStart(panViewStartMs(viewStartRef.current, -horizontal * unitPx, pxPerSecondRef.current));
    };
    scrollEl.addEventListener("wheel", onWheel, { passive: false });
    return () => scrollEl.removeEventListener("wheel", onWheel);
  }, [setViewStart]);

  const syncLabelScroll = (scrollEl: HTMLDivElement) => {
    const labelsEl = labelNamesRef.current;
    if (labelsEl) labelsEl.scrollTop = scrollEl.scrollTop;
  };

  // 在 3D 里选了物体：时间轴滚到第一个选中物体的那一行。
  // 选中的行已经有一行看得到（比如就是在时间轴里点的）就不滚
  const selectedObjectsKey = selectedObjectIds.join(",");
  useEffect(() => {
    if (curveMode) return;
    const scrollEl = scrollRef.current;
    const labelsEl = labelNamesRef.current;
    if (!scrollEl || !labelsEl || labelsEl.clientHeight <= 0) return;
    const indices = rows.flatMap((row, index) => (selectedObjectIds.includes(row.objectId) ? [index] : []));
    if (indices.length === 0) return;
    const top = scrollEl.scrollTop;
    const bottom = top + labelsEl.clientHeight;
    const visible = indices.some(
      (index) => index * TRACK_ROW_HEIGHT >= top - 1 && (index + 1) * TRACK_ROW_HEIGHT <= bottom + 1,
    );
    if (visible) return;
    scrollEl.scrollTop = Math.max(0, (indices[0]! - 1) * TRACK_ROW_HEIGHT);
    syncLabelScroll(scrollEl);
  }, [selectedObjectsKey, curveMode]);

  const handleScroll = () => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    syncLabelScroll(scrollEl);
  };

  /** 左边物体名上滚滚轮也滚轨道 */
  const handleLabelsWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const scrollEl = scrollRef.current;
    if (!scrollEl || event.shiftKey || event.deltaY === 0) return;
    scrollEl.scrollTop += event.deltaMode === 1 ? event.deltaY * WHEEL_LINE_PX : event.deltaY;
    syncLabelScroll(scrollEl);
  };

  /** 中键拖动只左右平移时间（上下用滚轮） */
  const handleMiddlePanStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    let lastX = event.clientX;
    const handleMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - lastX;
      lastX = moveEvent.clientX;
      if (dx !== 0) setViewStart(panViewStartMs(viewStartRef.current, dx, pxPerSecond));
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
      onSelectionChange(selectionFromBlockIds(hits), "add");
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  };

  /**
   * 拖选区外框右边：选区起点不动，按新的总时长整体缩放（吸附到其它行的块、游标）。
   * 视图贴边自己滚；每次都相对拖动开始的选区算
   */
  const handleScaleHandlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !onScaleSelection || !scaleFrame) return;
    event.preventDefault();
    event.stopPropagation();
    const blockIds = selectionBlockIds(selection);
    const { startMs, endMs } = scaleFrame;
    const startX = event.clientX;
    let lastClientX = startX;
    let moved = false;
    const handleMove = (moveEvent: Pick<PointerEvent, "clientX">) => {
      lastClientX = moveEvent.clientX;
      const dx = moveEvent.clientX - startX;
      if (!moved && Math.abs(dx) < DRAG_CLICK_THRESHOLD_PX) return;
      if (!moved) setScaleDrag({ originDurationMs: endMs - startMs });
      moved = true;
      const proposedEndMs = endMs + pxToMs(dx, pxPerSecond) + edgeScroll.shiftMs();
      const snappedEndMs = applySnap(
        Math.max(startMs + TIME_STEP_MS, proposedEndMs),
        blockSnapTargets(new Set(blockIds)),
      );
      onScaleSelection(blockIds, Math.max(TIME_STEP_MS, snapTimeMs(snappedEndMs - startMs)));
    };
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      edgeScroll.end();
      setScaleDrag(null);
      setSnapIndicatorMs(null);
      if (moved) onScaleSelectionEnd?.();
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    const edgeScroll = beginEdgeScroll(() => handleMove({ clientX: lastClientX }));
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
      onSelectionChange({ kind: "block", blockId }, "replace");
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
    // 一段时间的块（动态预设、引用）起止两端谁近吸谁
    const span = current ? blockSpanMs(current) : null;
    const atMs =
      span && span.endMs > span.startMs
        ? snapSpan(proposedMs, span.endMs - span.startMs, targets)
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
      if (!selected) onSelectionChange(selectionFromBlockIds(endpoints, "segments"), "replace");
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
      handleSegmentSelect(segment, additive, false);
      return;
    }
    if (segment.ownerPresetBlockId) handleBlockSelect(segment.ownerPresetBlockId, additive, false);
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
          <div ref={labelNamesRef} className="min-h-0 flex-1 overflow-hidden bg-card" onWheel={handleLabelsWheel}>
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

      <TimelineEdgeScrollContext.Provider value={beginEdgeScroll}>
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
              onScrubStart={handleRulerPointerDown}
              columns={columns}
              onColumnPointerDown={handleColumnPointerDown}
              rangeMs={rangeSelectMs}
            />

            {curveMode ? (
              // 压在游标拖动区上面：关键帧先被点中，游标附近的空白由曲线交回来拖游标
              <div
                ref={curvesRef}
                data-testid="timeline-curves"
                className="relative z-10 min-h-0 flex-1 touch-none overflow-hidden"
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
                  cursorMs={cursorMs}
                  gridTimesMs={majorTicks.map((tick) => tick.ms)}
                  markers={markers}
                  selectedMarkerIds={selectedMarkerIds}
                  selectedBlockIds={selectionBlockIds(selection)}
                  objectsById={objectsById}
                  objectName={(objectId) => objectNameById.get(objectId) ?? `模型 ${objectId}`}
                  emphasizedObjectIds={emphasizedObjectIds}
                  snapEnabled={snapEnabled}
                  onBlockSelect={(blockId, additive) => handleBlockSelect(blockId, additive, false)}
                  onCurveSelect={handleCurveSelect}
                  onBackgroundClick={handleCurveBackgroundClick}
                  onPlayheadPress={handlePlayheadDrag}
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
                onDoubleClick={handleTracksDoubleClick}
                onDragOver={(event) => {
                  if (!onDropSequence || !isSequenceRefDrag(event.dataTransfer)) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                  setDropAtMs(snapCursor(clientToMs(event.clientX), false));
                }}
                onDragLeave={(event) => {
                  if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                  setDropAtMs(null);
                }}
                onDrop={(event) => {
                  setDropAtMs(null);
                  if (!onDropSequence) return;
                  const sequenceId = readSequenceRefDrag(event.dataTransfer);
                  if (sequenceId === null) return;
                  event.preventDefault();
                  onDropSequence(sequenceId, snapCursor(clientToMs(event.clientX), false));
                }}
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
                  {/* 选中物体的整行（左边名字另有竖线和底色） */}
                  {rows.map((row, index) =>
                    selectedObjectIds.includes(row.objectId) ? (
                      <div
                        key={`selected-${row.objectId}`}
                        data-testid="timeline-row-selected"
                        className="absolute inset-x-0 bg-primary/10"
                        style={{ top: index * TRACK_ROW_HEIGHT, height: TRACK_ROW_HEIGHT }}
                      />
                    ) : null,
                  )}
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

                {underlayCurve ? (
                  <TrackCurveUnderlay
                    curve={underlayCurve}
                    graph={curveGraph}
                    canvasWidth={canvasWidth}
                    viewStartMs={viewStartMs}
                    viewEndMs={viewEndMs}
                    pxPerSecond={pxPerSecond}
                  />
                ) : null}

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
                      sequenceRefs={row.sequenceRefs}
                      sequenceNameOf={sequenceNames ? (id) => sequenceNames.get(id) : undefined}
                      onOpenSequence={onOpenSequence}
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
                      onPoseColumnSelect={handleColumnSelect}
                      invalidTargets={invalidTargets}
                    />
                  ))}
                </div>

                {scaleFrame ? (
                  <div
                    data-testid="timeline-scale-frame"
                    className="pointer-events-none absolute z-20 rounded-sm border border-dashed border-primary/80"
                    style={{
                      left: TIMELINE_PAD_LEFT + viewPxFromMs(scaleFrame.startMs, viewStartMs, pxPerSecond),
                      width: msToPx(scaleFrame.endMs - scaleFrame.startMs, pxPerSecond),
                      top: scaleFrame.firstRow * TRACK_ROW_HEIGHT + 2,
                      height: (scaleFrame.lastRow - scaleFrame.firstRow + 1) * TRACK_ROW_HEIGHT - 4,
                    }}
                  >
                    <div
                      role="slider"
                      aria-label="整体缩放选中的区间"
                      aria-valuemin={TIME_STEP_MS}
                      aria-valuenow={scaleFrame.endMs - scaleFrame.startMs}
                      title="拖动整体缩放：起点不动，选中的区间按比例伸缩，后面的块跟着挪（右键「整体缩放…」可填时长）"
                      onPointerDown={handleScaleHandlePointerDown}
                      className="pointer-events-auto absolute -right-1.5 top-0 z-30 flex h-full w-3 cursor-ew-resize items-center justify-center"
                    >
                      <span className="h-full max-h-6 w-1 rounded-full bg-primary" aria-hidden />
                    </div>
                    {scaleDrag ? (
                      <span
                        data-testid="timeline-scale-readout"
                        className="absolute -top-5 right-0 whitespace-nowrap rounded-sm bg-card px-1.5 py-0.5 font-mono text-mono-sm tabular-nums text-foreground"
                      >
                        {formatTime(scaleDrag.originDurationMs)} s → {formatTime(scaleFrame.endMs - scaleFrame.startMs)} s ×
                        {((scaleFrame.endMs - scaleFrame.startMs) / scaleDrag.originDurationMs).toFixed(2)}
                      </span>
                    ) : null}
                  </div>
                ) : null}

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

            {dropAtMs !== null ? (
              <div
                data-testid="timeline-drop-line"
                className="pointer-events-none absolute top-0 bottom-0 z-20 w-0.5 -translate-x-1/2 bg-primary/70"
                style={{ left: TIMELINE_PAD_LEFT + viewPxFromMs(dropAtMs, viewStartMs, pxPerSecond) }}
                aria-hidden
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

            {/* 拖动区压在运动区间上、位姿 / 预设 / 指令下面（z-10 起）：游标停在位姿上时先点中位姿 */}
            <div
              role="slider"
              aria-label="播放游标"
              aria-valuemin={0}
              aria-valuemax={Math.max(viewEndMs, cursorMs)}
              aria-valuenow={cursorMs}
              tabIndex={0}
              onPointerDown={handlePlayheadDrag}
              className="absolute top-0 bottom-0 z-[5] -translate-x-1/2 cursor-ew-resize"
              style={{ left: playheadLeft, width: PLAYHEAD_GRAB_HALF_PX * 2 }}
            />
          </div>
        </div>

        <TimelineHScroll
          viewStartMs={viewStartMs}
          viewportMs={viewportMs}
          totEndMs={tot}
          onViewStartChange={setViewStart}
        />
      </div>
      </TimelineEdgeScrollContext.Provider>
    </div>
  );
};
