import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { cn } from "@/app/components/ui/utils";
import type { TimelineMarker } from "@/app/project/action-sequence/types";
import { useSessionDisplayLengthUnit } from "@/app/project/display-length-unit-provider";
import {
  getDisplayLengthFamilyUnit,
  isLengthFamilyUnit,
  toCanonicalLengthValue,
  toDisplayLengthValue,
  type DisplayLengthUnit,
} from "@/app/project/display-length-units";
import type { VirtualAxisId } from "@/app/project/project-document-types";
import { formatQuantity, formatQuantityValue } from "../motion-profile/quantity-format";
import { getVirtualAxisCanonicalUnit } from "../virtual-axis-display";
import {
  CURVE_GRAPHS,
  curveIssueShortText,
  curveIssueText,
  curveSampleAt,
  dragValueStep,
  junctionKindText,
  niceTicks,
  roundDragValue,
  spanSampleAt,
  spanSampleTimes,
  type AxisCurve,
  type CurveGraph,
  type CurveKey,
  type CurveRange,
} from "./curve-data";
import { DRAG_CLICK_THRESHOLD_PX, isAdditiveClick } from "./suppress-click";
import { formatTime, TIMELINE_PAD_LEFT, type ControlledObject } from "./timeline-data";
import { MARQUEE_THRESHOLD_PX, viewPxFromMs } from "./timeline-view-extent";

export type CurvePlotRect = { top: number; height: number };

/** 曲线区一次只放一张图（位置或速度），占满整个高度 */
export type CurvePlotLayout = { height: number; plot: CurvePlotRect };

const PLOT_PAD_PX = 4;
const MIN_AREA_HEIGHT_PX = 120;
/** 采样间隔（像素） */
const SAMPLE_PX = 2;
/** 刻度标签之间至少留这么高 */
const TICK_SPACING_PX = 24;
export const CURVE_GUTTER_WIDTH = 52;

/** 点中、拖动的手感：触屏手指粗，范围都放大 */
type PointerTolerance = {
  /** 离曲线多近算点中 */
  hitPx: number;
  /** 关键帧的点击半径 */
  keyHitRadius: number;
  /** 按下后移动多远才算拖 */
  dragPx: number;
  /** 拖多远才开始框选 */
  marqueePx: number;
  /** 拖值时离别的关键帧、行程上下限多近就吸过去 */
  snapPx: number;
  /** 拖值标签在关键帧上方多高，手指别挡住 */
  labelOffsetPx: number;
};

const FINE_POINTER: PointerTolerance = {
  hitPx: 6,
  keyHitRadius: 8,
  dragPx: DRAG_CLICK_THRESHOLD_PX,
  marqueePx: MARQUEE_THRESHOLD_PX,
  snapPx: 6,
  labelOffsetPx: 12,
};

const COARSE_POINTER: PointerTolerance = {
  hitPx: 14,
  keyHitRadius: 16,
  dragPx: 8,
  marqueePx: 12,
  snapPx: 10,
  labelOffsetPx: 36,
};

const COARSE_POINTER_QUERY = "(pointer: coarse)";

const isCoarsePointer = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia(COARSE_POINTER_QUERY).matches;

/** 主要输入是触屏时用更大的点击范围；接上、拔掉触屏时跟着变 */
const usePointerTolerance = (): PointerTolerance => {
  const [coarse, setCoarse] = useState(isCoarsePointer);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(COARSE_POINTER_QUERY);
    const update = () => setCoarse(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return coarse ? COARSE_POINTER : FINE_POINTER;
};

export const curvePlotLayout = (areaHeight: number): CurvePlotLayout => {
  const height = Math.max(areaHeight, MIN_AREA_HEIGHT_PX);
  return { height, plot: { top: PLOT_PAD_PX, height: height - PLOT_PAD_PX * 2 } };
};

export const plotY = (plot: CurvePlotRect, range: CurveRange, value: number): number =>
  plot.top + plot.height * (1 - (value - range.min) / (range.max - range.min));

export const plotValue = (plot: CurvePlotRect, range: CurveRange, y: number): number =>
  range.min + (1 - (y - plot.top) / plot.height) * (range.max - range.min);

const graphLabel = (graph: CurveGraph): string =>
  CURVE_GRAPHS.find((item) => item.id === graph)?.label ?? "";

/** 曲线的标准单位（mm / °），各物体虚轴的种类可能不同 */
const canonicalUnitOf = (
  objectsById: ReadonlyMap<number, ControlledObject>,
  objectId: number,
  axis: VirtualAxisId,
): string => getVirtualAxisCanonicalUnit(axis, objectsById.get(objectId)?.controlType);

export type CurveFormat = {
  value: (curve: AxisCurve, value: number) => string;
  speed: (curve: AxisCurve, value: number) => string;
  acceleration: (curve: AxisCurve, value: number) => string;
  /** 不带单位，曲线旁的简短标注用 */
  speedNumber: (curve: AxisCurve, value: number) => string;
};

/** 数值按显示单位：长度跟随设置（mm / cm / m / in），角度保持 ° */
export const useCurveFormat = (objectsById: ReadonlyMap<number, ControlledObject>): CurveFormat => {
  const display = useSessionDisplayLengthUnit();
  return useMemo(() => {
    const unitOf = (curve: AxisCurve) => canonicalUnitOf(objectsById, curve.objectId, curve.axis);
    return {
      value: (curve, value) => formatQuantity(value, unitOf(curve), display),
      speed: (curve, value) => formatQuantity(value, `${unitOf(curve)}/s`, display),
      acceleration: (curve, value) => formatQuantity(value, `${unitOf(curve)}/s²`, display),
      speedNumber: (curve, value) => formatQuantityValue(value, `${unitOf(curve)}/s`, display),
    };
  }, [display, objectsById]);
};

type GutterTick = { value: number; label: string };

const formatTickNumber = (value: number): string =>
  String(Number(value.toFixed(6)));

/** 刻度按显示单位取整齐的数，位置仍按标准单位画 */
const gutterTicks = (
  range: CurveRange,
  canonicalUnit: string | undefined,
  display: DisplayLengthUnit,
  maxCount: number,
): GutterTick[] => {
  const length = canonicalUnit !== undefined && isLengthFamilyUnit(canonicalUnit);
  const toDisplay = (value: number) => (length ? toDisplayLengthValue(value, display) : value);
  const toCanonical = (value: number) => (length ? toCanonicalLengthValue(value, display) : value);
  return niceTicks(toDisplay(range.min), toDisplay(range.max), maxCount).map((tick) => ({
    value: toCanonical(tick),
    label: formatTickNumber(tick),
  }));
};

/** 各曲线的 ±最大速度，标签按显示单位 */
const speedLimitTicks = (
  curves: readonly AxisCurve[],
  range: CurveRange,
  canonicalUnit: string | undefined,
  display: DisplayLengthUnit,
): GutterTick[] => {
  const length = canonicalUnit !== undefined && isLengthFamilyUnit(canonicalUnit);
  const limits = [...new Set(curves.flatMap((curve) => (curve.maxVelocity ? [curve.maxVelocity] : [])))];
  return limits
    .flatMap((limit) => [limit, -limit])
    .filter((value) => value >= range.min && value <= range.max)
    .map((value) => ({
      value,
      label: formatTickNumber(Number((length ? toDisplayLengthValue(value, display) : value).toFixed(3))),
    }));
};

/** 可见曲线单位一致时才标单位（V1 可能有的是 mm、有的是 °） */
const sharedCanonicalUnit = (
  curves: readonly AxisCurve[],
  objectsById: ReadonlyMap<number, ControlledObject>,
  axis: VirtualAxisId,
): string | undefined => {
  const units = new Set(curves.map((curve) => canonicalUnitOf(objectsById, curve.objectId, axis)));
  return units.size === 1 ? [...units][0] : undefined;
};

/** 左侧的纵轴刻度，和右边的图对齐；竖排写着现在看的是哪根轴的位置还是速度 */
export const CurveScaleGutter = ({
  layout,
  range,
  graph,
  curves,
  objectsById,
  axis,
}: {
  layout: CurvePlotLayout;
  range: CurveRange;
  graph: CurveGraph;
  curves: readonly AxisCurve[];
  objectsById: ReadonlyMap<number, ControlledObject>;
  axis: VirtualAxisId;
}) => {
  const display = useSessionDisplayLengthUnit();
  const { plot } = layout;
  const shared = sharedCanonicalUnit(curves, objectsById, axis);
  const unit = shared === undefined ? undefined : graph === "position" ? shared : `${shared}/s`;
  const title = [
    axis.toUpperCase(),
    graphLabel(graph),
    ...(unit === undefined ? [] : [getDisplayLengthFamilyUnit(unit, display)]),
  ].join(" ");
  // 单位竖着写在最左边，刻度靠右
  const fits = (tick: GutterTick) => {
    const y = plotY(plot, range, tick.value);
    return y >= plot.top + 4 && y <= plot.top + plot.height;
  };
  // 速度图标出最大速度（和图上的虚线对应），刻度离它太近的不标
  const limits = graph === "velocity" ? speedLimitTicks(curves, range, unit, display).filter(fits) : [];
  const maxCount = Math.max(1, Math.floor(plot.height / TICK_SPACING_PX));
  const ticks = gutterTicks(range, unit, display, maxCount).filter(
    (tick) =>
      fits(tick) &&
      limits.every(
        (limit) => Math.abs(plotY(plot, range, limit.value) - plotY(plot, range, tick.value)) >= 12,
      ),
  );
  return (
    <div
      data-testid="curve-scale-gutter"
      className="relative shrink-0 border-l border-border/40 bg-muted/40"
      style={{ width: CURVE_GUTTER_WIDTH, height: layout.height }}
      aria-hidden
    >
      <span
        data-testid="curve-graph-title"
        className="absolute whitespace-nowrap text-[10px] leading-none text-muted-foreground"
        style={{
          left: 7,
          top: plot.top + plot.height / 2,
          transform: "translate(-50%, -50%) rotate(-90deg)",
        }}
      >
        {title}
      </span>
      {ticks.map((tick) => (
        <span
          key={tick.label}
          data-testid="curve-tick"
          className="absolute right-1 -translate-y-1/2 font-mono text-[10px] leading-none tabular-nums text-muted-foreground"
          style={{ top: plotY(plot, range, tick.value) }}
        >
          {tick.label}
        </span>
      ))}
      {limits.map((tick) => (
        <span
          key={`limit-${tick.label}`}
          data-testid="curve-tick-speed-limit"
          className="absolute right-1 -translate-y-1/2 font-mono text-[10px] leading-none tabular-nums text-warning"
          style={{ top: plotY(plot, range, tick.value) }}
        >
          {tick.label}
        </span>
      ))}
    </div>
  );
};

/**
 * 曲线视图左侧的物体列表：点名字选物体（和轨道视图一样），显示指针处的位置或速度
 * （跟着图）；曲线加粗的物体（选中的块所属）名字前有个点，对得上是哪条曲线。
 */
export const CurveObjectList = ({
  rows,
  curves,
  graph,
  visibleObjectIds,
  selectedObjectIds,
  emphasizedObjectIds,
  cursorMs,
  objectsById,
  onObjectClick,
}: {
  rows: readonly { objectId: number; objectName: string }[];
  curves: readonly AxisCurve[];
  graph: CurveGraph;
  visibleObjectIds: readonly number[];
  selectedObjectIds: readonly number[];
  emphasizedObjectIds: readonly number[];
  cursorMs: number;
  objectsById: ReadonlyMap<number, ControlledObject>;
  onObjectClick?: (objectId: number, event: MouseEvent<HTMLElement>, rowObjectIds: readonly number[]) => void;
}) => {
  const format = useCurveFormat(objectsById);
  const rowObjectIds = rows.map((row) => row.objectId);
  return (
    <div className="custom-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto" data-testid="curve-object-list">
      {rows.map((row) => {
        const objectSelected = selectedObjectIds.includes(row.objectId);
        const visible = visibleObjectIds.includes(row.objectId);
        const curve = visible ? curves.find((item) => item.objectId === row.objectId) : undefined;
        const sample = curve ? curveSampleAt(curve, cursorMs) : undefined;
        const readout =
          curve && sample
            ? graph === "position"
              ? format.value(curve, sample.value)
              : Number.isFinite(sample.velocity)
                ? format.speed(curve, sample.velocity)
                : "--"
            : undefined;
        return (
          <button
            key={row.objectId}
            type="button"
            aria-pressed={objectSelected}
            onClick={(event) => onObjectClick?.(row.objectId, event, rowObjectIds)}
            className={cn(
              "flex h-9 w-full shrink-0 flex-col justify-center border-l-2 px-3 text-left [@media(pointer:coarse)]:h-11",
              objectSelected
                ? "border-l-primary bg-accent"
                : "border-l-transparent bg-card hover:bg-muted/40",
            )}
            title={readout ? `${row.objectName}：指针处${graphLabel(graph)} ${readout}` : row.objectName}
          >
            <span
              className={cn(
                "flex w-full min-w-0 items-center gap-1.5 text-body-sm leading-tight",
                objectSelected ? "text-primary" : curve ? "text-foreground/80" : "text-muted-foreground/60",
              )}
            >
              {curve && emphasizedObjectIds.includes(row.objectId) ? (
                <span
                  data-testid="curve-emphasis-dot"
                  className="size-1.5 shrink-0 rounded-full bg-primary"
                  aria-hidden
                />
              ) : null}
              <span className="truncate">{row.objectName}</span>
            </span>
            {readout ? (
              <span
                data-testid="curve-readout"
                className="w-full truncate font-mono text-[11px] leading-tight tabular-nums text-muted-foreground"
              >
                {readout}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
};

type PathBuilder = {
  line: (x: number, y: number) => void;
  lift: () => void;
  d: () => string;
};

const pathBuilder = (): PathBuilder => {
  const parts: string[] = [];
  let open = false;
  return {
    line: (x, y) => {
      parts.push(`${open ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`);
      open = true;
    },
    lift: () => {
      open = false;
    },
    d: () => parts.join(" "),
  };
};

type CurvePaths = {
  objectId: number;
  line: string;
  /** 有问题的段（标红）及原因；dashed：算不出形状，位置按直线虚线画 */
  issues: {
    d: string;
    text: string;
    dashed: boolean;
    /** 简短标注，段太窄时不标 */
    label?: { x: number; y: number; text: string; below: boolean };
  }[];
};

type CurveGeometry = {
  graph: CurveGraph;
  x: (atMs: number) => number;
  y: (value: number) => number;
  fromMs: number;
  toMs: number;
  stepMs: number;
};

/** 段在屏幕上至少这么宽才写简短标注 */
const ISSUE_LABEL_MIN_PX = 40;

const buildCurvePaths = (
  curve: AxisCurve,
  geometry: CurveGeometry,
  issueText: (curve: AxisCurve, span: AxisCurve["spans"][number]) => string,
  issueLabel: (curve: AxisCurve, span: AxisCurve["spans"][number]) => string,
): CurvePaths => {
  const { graph, x, y, fromMs, toMs, stepMs } = geometry;
  const quantity = (sample: { value: number; velocity: number }) =>
    graph === "position" ? sample.value : sample.velocity;
  const line = pathBuilder();
  const issues: CurvePaths["issues"] = [];
  if (fromMs < curve.startMs) {
    const held = graph === "position" ? curve.firstValue : 0;
    line.line(x(fromMs), y(held));
    line.line(x(Math.min(curve.startMs, toMs)), y(held));
  }
  for (const span of curve.spans) {
    const times = spanSampleTimes(span, fromMs, toMs, stepMs);
    if (times.length === 0) continue;
    const first = times[0]!;
    const last = times[times.length - 1]!;
    const wide = x(last) - x(first) >= ISSUE_LABEL_MIN_PX;
    if (!span.drawable) {
      // 位置按直线虚线画；速度算不出来，空着只留标注
      line.lift();
      const dashed = pathBuilder();
      if (graph === "position") {
        dashed.line(x(first), y(spanSampleAt(span, first).value));
        dashed.line(x(last), y(spanSampleAt(span, last).value));
      }
      const middle = (first + last) / 2;
      issues.push({
        d: dashed.d(),
        text: issueText(curve, span),
        dashed: true,
        ...(wide
          ? {
              label: {
                x: x(middle),
                y: y(graph === "position" ? spanSampleAt(span, middle).value : 0),
                text: issueLabel(curve, span),
                below: false,
              },
            }
          : {}),
      });
      continue;
    }
    const flagged = span.issues.length > 0;
    const overlay = pathBuilder();
    // 速度图标注在这段速度最大处，位置图标注在这段中间
    let peak: { atMs: number; velocity: number } | null = null;
    for (const atMs of times) {
      const sample = spanSampleAt(span, atMs);
      line.line(x(atMs), y(quantity(sample)));
      if (!flagged) continue;
      overlay.line(x(atMs), y(quantity(sample)));
      if (peak === null || Math.abs(sample.velocity) > Math.abs(peak.velocity)) {
        peak = { atMs, velocity: sample.velocity };
      }
    }
    if (!flagged) continue;
    const anchor =
      graph === "velocity" && peak
        ? { atMs: peak.atMs, value: peak.velocity, below: peak.velocity < 0 }
        : {
            atMs: (first + last) / 2,
            value: spanSampleAt(span, (first + last) / 2).value,
            below: false,
          };
    issues.push({
      d: overlay.d(),
      text: issueText(curve, span),
      dashed: false,
      ...(wide
        ? {
            label: {
              x: x(anchor.atMs),
              y: y(anchor.value),
              text: issueLabel(curve, span),
              below: anchor.below,
            },
          }
        : {}),
    });
  }
  if (toMs > curve.endMs) {
    const held = graph === "position" ? curve.lastValue : 0;
    line.line(x(Math.max(curve.endMs, fromMs)), y(held));
    line.line(x(toMs), y(held));
  }
  return { objectId: curve.objectId, line: line.d(), issues };
};

/** 点中的曲线和点的时刻 */
type CurveHit = { curve: AxisCurve; atMs: number };

type KeyDrag = { objectId: number; sourceRef: string; snapValue: number | null };

type Marquee = { x0: number; y0: number; x1: number; y1: number };

export type TimelineCurvesProps = {
  curves: readonly AxisCurve[];
  /** 看位置还是速度 */
  graph: CurveGraph;
  /** 这张图的纵轴范围 */
  range: CurveRange;
  layout: CurvePlotLayout;
  canvasWidth: number;
  viewStartMs: number;
  viewEndMs: number;
  pxPerSecond: number;
  occupiedEndMs: number;
  /** 竖网格线（主刻度） */
  gridTimesMs: readonly number[];
  markers: readonly TimelineMarker[];
  selectedMarkerIds: readonly string[];
  selectedBlockIds: readonly string[];
  objectsById: ReadonlyMap<number, ControlledObject>;
  objectName: (objectId: number) => string;
  /** 选中的块所属的物体：它们的曲线加粗，其它变淡；没有时都一样 */
  emphasizedObjectIds: readonly number[];
  /** 拖值时吸附到别的关键帧和行程上下限；按住 Alt 临时不吸 */
  snapEnabled: boolean;
  onBlockSelect: (blockId: string, additive: boolean) => void;
  /** 点中曲线（不在关键帧上）：选中这一刻所在的运动区间 */
  onCurveSelect: (curve: AxisCurve, atMs: number, additive: boolean) => void;
  /** 点空白：clientX 换算成指针时刻 */
  onBackgroundClick: (clientX: number) => void;
  onMarquee: (blockIds: string[]) => void;
  /** 上下拖位姿的值（只在位置图）：value 是被拖的关键帧现在要去的值 */
  onKeyDrag?: (curve: AxisCurve, key: CurveKey, value: number) => void;
  onKeyDragEnd?: () => void;
};

/**
 * 曲线视图：一次看一张图（位置或速度），同一根虚轴的各物体叠在一起，统一一种颜色。
 * 不靠悬停（要支持触屏）：选中的块所属物体的曲线加粗，点曲线选区间，点空白移指针。
 */
export const TimelineCurves = ({
  curves,
  graph,
  range,
  layout,
  canvasWidth,
  viewStartMs,
  viewEndMs,
  pxPerSecond,
  occupiedEndMs,
  gridTimesMs,
  markers,
  selectedMarkerIds,
  selectedBlockIds,
  objectsById,
  objectName,
  emphasizedObjectIds,
  snapEnabled,
  onBlockSelect,
  onCurveSelect,
  onBackgroundClick,
  onMarquee,
  onKeyDrag,
  onKeyDragEnd,
}: TimelineCurvesProps) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const format = useCurveFormat(objectsById);
  const tolerance = usePointerTolerance();
  const [keyDrag, setKeyDrag] = useState<KeyDrag | null>(null);
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const { plot } = layout;

  const x = (atMs: number) => TIMELINE_PAD_LEFT + viewPxFromMs(atMs, viewStartMs, pxPerSecond);
  const msAt = (px: number) => viewStartMs + ((px - TIMELINE_PAD_LEFT) / pxPerSecond) * 1000;
  const y = (value: number) => plotY(plot, range, value);

  const stepMs = (SAMPLE_PX / pxPerSecond) * 1000;
  const fromMs = Math.max(0, viewStartMs - stepMs);
  const toMs = viewEndMs + stepMs;

  const paths = useMemo(
    () =>
      curves.map((curve) =>
        buildCurvePaths(
          curve,
          {
            graph,
            x: (atMs) => TIMELINE_PAD_LEFT + viewPxFromMs(atMs, viewStartMs, pxPerSecond),
            y: (value) => plotY(plot, range, value),
            fromMs,
            toMs,
            stepMs,
          },
          (owner, span) =>
            span.issues
              .map((issue) =>
                curveIssueText(issue, {
                  speed: (value) => format.speed(owner, value),
                  acceleration: (value) => format.acceleration(owner, value),
                }),
              )
              .join("；") || "这段曲线算不出来",
          (owner, span) => {
            const [issue] = span.issues;
            return issue
              ? curveIssueShortText(issue, (value) => format.speedNumber(owner, value))
              : "算不出来";
          },
        ),
      ),
    [curves, graph, plot, range, viewStartMs, pxPerSecond, fromMs, toMs, stepMs, format],
  );

  const localPoint = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  };

  /** 指针附近的曲线：左右各看一点，陡的地方也点得中 */
  const curveAt = (px: number, py: number): CurveHit | null => {
    const { hitPx } = tolerance;
    if (py < plot.top - hitPx || py > plot.top + plot.height + hitPx) return null;
    let best: CurveHit | null = null;
    let bestDistance = hitPx;
    for (const curve of curves) {
      for (const offset of [-3, 0, 3]) {
        const sample = curveSampleAt(curve, msAt(px + offset));
        const value = graph === "position" ? sample.value : sample.velocity;
        if (!Number.isFinite(value)) continue;
        const distance = Math.hypot(offset, y(value) - py);
        if (distance > bestDistance) continue;
        best = { curve, atMs: msAt(px) };
        bestDistance = distance;
      }
    }
    return best;
  };

  /** 按下后跟着整个窗口的指针走；触摸被系统打断（pointercancel）时按取消处理 */
  const followPointer = (
    onMove: (event: globalThis.PointerEvent) => void,
    onUp: (event: globalThis.PointerEvent) => void,
    onCancel: () => void,
  ) => {
    const stop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleCancel);
    };
    const handleUp = (event: globalThis.PointerEvent) => {
      stop();
      onUp(event);
    };
    const handleCancel = () => {
      stop();
      onCancel();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleCancel);
  };

  /** 框选的点：位置图是关键帧，速度图是位姿处的速度点 */
  const markScreenPoints = () =>
    curves.flatMap((curve) =>
      graph === "position"
        ? curve.keys.map((key) => ({ blockId: key.blockId, x: x(key.atMs), y: y(key.value) }))
        : curve.junctions.map((junction) => ({
            blockId: junction.blockId,
            x: x(junction.atMs),
            y: y(junction.velocity),
          })),
    );

  /** 空白处按下：拖开是框选，不动松手是点（点在曲线上选区间，否则移指针） */
  const handleBackgroundPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const start = localPoint(event.clientX, event.clientY);
    const hit = curveAt(start.x, start.y);
    const additive = isAdditiveClick(event);
    let boxing = false;
    const handleMove = (moveEvent: globalThis.PointerEvent) => {
      const point = localPoint(moveEvent.clientX, moveEvent.clientY);
      if (!boxing && Math.hypot(point.x - start.x, point.y - start.y) < tolerance.marqueePx) return;
      boxing = true;
      setMarquee({ x0: start.x, y0: start.y, x1: point.x, y1: point.y });
    };
    const handleUp = (upEvent: globalThis.PointerEvent) => {
      setMarquee(null);
      if (!boxing) {
        if (hit) onCurveSelect(hit.curve, hit.atMs, additive);
        else onBackgroundClick(upEvent.clientX);
        return;
      }
      const end = localPoint(upEvent.clientX, upEvent.clientY);
      const left = Math.min(start.x, end.x);
      const right = Math.max(start.x, end.x);
      const top = Math.min(start.y, end.y);
      const bottom = Math.max(start.y, end.y);
      const ids = new Set<string>();
      for (const point of markScreenPoints()) {
        if (point.blockId === null) continue;
        if (point.x >= left && point.x <= right && point.y >= top && point.y <= bottom) {
          ids.add(point.blockId);
        }
      }
      onMarquee([...ids]);
    };
    followPointer(handleMove, handleUp, () => setMarquee(null));
  };

  /** 关键帧、速度点上按下：位置图里设定了值的位姿可以上下拖改值，其它只能点选 */
  const handleMarkPointerDown = (
    event: PointerEvent<SVGElement>,
    curve: AxisCurve,
    key: CurveKey,
    draggable: boolean,
  ) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    const additive = isAdditiveClick(event);
    const startY = event.clientY;
    // 拖动中刻度不变，用按下时的刻度换算
    const pressedRange = range;
    const step = dragValueStep((pressedRange.max - pressedRange.min) / plot.height);
    // 吸到别的关键帧设定的值（经过点的值是算出来的，不吸）和行程上下限
    const targets = [
      ...curves.flatMap((item) =>
        item.keys
          .filter((other) => other.kind !== "pass" && other.sourceRef !== key.sourceRef)
          .map((other) => other.value),
      ),
      ...(curve.range ? [curve.range.min, curve.range.max] : []),
    ];
    let moved = false;
    const handleMove = (moveEvent: globalThis.PointerEvent) => {
      if (!draggable || !onKeyDrag) return;
      if (!moved && Math.abs(moveEvent.clientY - startY) < tolerance.dragPx) return;
      moved = true;
      const rawY = localPoint(moveEvent.clientX, moveEvent.clientY).y;
      const raw = plotValue(plot, pressedRange, rawY);
      let snapValue: number | null = null;
      if (snapEnabled && !moveEvent.altKey) {
        let best = tolerance.snapPx;
        for (const target of targets) {
          const distance = Math.abs(plotY(plot, pressedRange, target) - rawY);
          if (distance <= best) {
            best = distance;
            snapValue = target;
          }
        }
      }
      setKeyDrag({ objectId: curve.objectId, sourceRef: key.sourceRef, snapValue });
      onKeyDrag(curve, key, snapValue ?? roundDragValue(raw, step));
    };
    const finishDrag = () => {
      setKeyDrag(null);
      onKeyDragEnd?.();
    };
    const handleUp = () => {
      if (moved) {
        finishDrag();
        return;
      }
      if (key.blockId !== null) onBlockSelect(key.blockId, additive);
    };
    // 被打断时已经拖到的值留着，和松手一样收尾；还没拖开就当没点
    followPointer(handleMove, handleUp, () => {
      if (moved) finishDrag();
    });
  };

  const emphasized = (objectId: number) => emphasizedObjectIds.includes(objectId);
  const dimmed = (objectId: number) => emphasizedObjectIds.length > 0 && !emphasized(objectId);
  const visibleTime = (atMs: number) => atMs >= fromMs && atMs <= toMs;
  const inRange = (value: number) => value >= range.min && value <= range.max;
  const usedRight = occupiedEndMs > 0 ? x(occupiedEndMs) : TIMELINE_PAD_LEFT;
  // 位置图画行程上下限，速度图画 ±最大速度和 0
  const guideLines =
    graph === "position"
      ? [...new Set(curves.flatMap((curve) => (curve.range ? [curve.range.min, curve.range.max] : [])))]
      : [...new Set(curves.flatMap((curve) => (curve.maxVelocity ? [curve.maxVelocity, -curve.maxVelocity] : [])))];
  const draggedCurve = keyDrag ? curves.find((curve) => curve.objectId === keyDrag.objectId) : undefined;
  const draggedKey = draggedCurve?.keys.find((key) => key.sourceRef === keyDrag?.sourceRef);

  return (
    <svg
      ref={svgRef}
      data-testid="timeline-curve-plot"
      data-graph={graph}
      className="absolute inset-x-0 top-0 block touch-none select-none"
      width={canvasWidth}
      height={layout.height}
      onPointerDown={handleBackgroundPointerDown}
    >
      <g aria-hidden>
        <rect x={0} y={plot.top} width={canvasWidth} height={plot.height} className="fill-background" />
        <rect
          x={0}
          y={plot.top}
          width={Math.max(0, Math.min(usedRight, canvasWidth))}
          height={plot.height}
          className="fill-input-background"
        />
      </g>

      <g aria-hidden className="pointer-events-none">
        {gridTimesMs.map((atMs) => (
          <line
            key={atMs}
            x1={x(atMs)}
            x2={x(atMs)}
            y1={plot.top}
            y2={plot.top + plot.height}
            className="stroke-border/40"
          />
        ))}
        {guideLines.filter(inRange).map((value) => (
          <line
            key={`guide-${value}`}
            data-testid={graph === "position" ? "curve-range-line" : "curve-speed-limit"}
            x1={0}
            x2={canvasWidth}
            y1={y(value)}
            y2={y(value)}
            strokeDasharray={graph === "position" ? "2 3" : "4 3"}
            className={graph === "position" ? "stroke-muted-foreground/50" : "stroke-warning/60"}
          />
        ))}
        {graph === "velocity" && inRange(0) ? (
          <line x1={0} x2={canvasWidth} y1={y(0)} y2={y(0)} className="stroke-border" />
        ) : null}
        {markers.map((marker) => (
          <line
            key={marker.id}
            x1={x(marker.atMs)}
            x2={x(marker.atMs)}
            y1={plot.top}
            y2={plot.top + plot.height}
            strokeDasharray="3 3"
            className={cn(
              selectedMarkerIds.includes(marker.id) ? "stroke-primary/70" : "stroke-foreground/20",
            )}
          />
        ))}
      </g>

      {paths.map((path) => (
        <g
          key={path.objectId}
          data-testid="curve"
          data-object-id={String(path.objectId)}
          className="pointer-events-none"
          opacity={dimmed(path.objectId) ? 0.3 : 1}
        >
          <path
            d={path.line}
            fill="none"
            strokeWidth={emphasized(path.objectId) ? 2.5 : 1.5}
            className="stroke-primary"
          />
          {path.issues.map((issue, index) => (
            <g key={index} data-testid="curve-issue" data-dashed={issue.dashed ? "true" : undefined}>
              {issue.d ? (
                <path
                  d={issue.d}
                  fill="none"
                  strokeWidth={issue.dashed ? 2 : 2.5}
                  strokeDasharray={issue.dashed ? "5 4" : undefined}
                  className="stroke-warning"
                />
              ) : null}
              {issue.d ? (
                <path
                  d={issue.d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={10}
                  className="pointer-events-auto"
                >
                  <title>{`${objectName(path.objectId)}：${issue.text}`}</title>
                </path>
              ) : null}
              {issue.label ? (
                <text
                  data-testid="curve-issue-label"
                  x={issue.label.x}
                  y={issue.label.below ? issue.label.y + 12 : issue.label.y - 5}
                  textAnchor="middle"
                  strokeWidth={3}
                  paintOrder="stroke"
                  className="fill-warning stroke-card text-[10px]"
                >
                  {issue.label.text}
                </text>
              ) : null}
            </g>
          ))}
        </g>
      ))}

      {curves.map((curve) => (
        <g
          key={curve.objectId}
          opacity={dimmed(curve.objectId) ? 0.3 : 1}
          data-testid="curve-points"
          data-object-id={String(curve.objectId)}
        >
          {graph === "velocity"
            ? curve.junctions.filter((junction) => visibleTime(junction.atMs)).map((junction) => {
                const moving = junction.velocity !== 0;
                const manual = junction.kind === "manual";
                const key = curve.keys.find((item) => item.sourceRef === junction.sourceRef);
                const selected = junction.blockId !== null && selectedBlockIds.includes(junction.blockId);
                const cx = x(junction.atMs);
                const cy = y(junction.velocity);
                const label =
                  `${objectName(curve.objectId)} ${formatTime(junction.atMs)} s 经过速度 ` +
                  `${format.speed(curve, Math.abs(junction.velocity))}（${junctionKindText(junction.kind)}）`;
                return (
                  <g
                    key={`j-${junction.sourceRef}`}
                    data-testid="curve-junction"
                    data-kind={junction.kind}
                    data-block-id={junction.blockId ?? undefined}
                    data-selected={selected ? "true" : undefined}
                    role="button"
                    aria-label={label}
                    aria-pressed={selected}
                    className="cursor-pointer"
                    onPointerDown={(event) => {
                      if (key) handleMarkPointerDown(event, curve, key, false);
                    }}
                  >
                    <title>{label}</title>
                    <circle
                      data-testid="curve-key-hit"
                      cx={cx}
                      cy={cy}
                      r={tolerance.keyHitRadius}
                      fill="transparent"
                    />
                    <circle
                      cx={cx}
                      cy={cy}
                      r={(moving ? (manual ? 3.5 : 3) : 2.5) + (selected ? 1 : 0)}
                      strokeWidth={manual || selected ? 1.5 : 1}
                      className={cn(
                        selected
                          ? "fill-primary stroke-foreground"
                          : !moving
                            ? "fill-card stroke-muted-foreground"
                            : manual
                              ? "fill-card stroke-primary"
                              : "fill-primary stroke-card",
                      )}
                    />
                  </g>
                );
              })
            : curve.keys.filter((key) => visibleTime(key.atMs)).map((key) => {
                const cx = x(key.atMs);
                const cy = y(key.value);
                const selected = key.blockId !== null && selectedBlockIds.includes(key.blockId);
                const draggable = key.kind === "set" && onKeyDrag !== undefined;
                const label =
                  `${objectName(curve.objectId)} ${formatTime(key.atMs)} s ${format.value(curve, key.value)}` +
                  (key.kind === "pass"
                    ? "（这一帧不设定，经过）"
                    : key.kind === "preset"
                      ? "（预设生成，拆解后可拖）"
                      : "");
                return (
                  <g
                    key={`k-${key.sourceRef}`}
                    data-testid="curve-key"
                    data-kind={key.kind}
                    data-block-id={key.blockId ?? undefined}
                    data-selected={selected ? "true" : undefined}
                    role="button"
                    aria-label={label}
                    aria-pressed={selected}
                    className={draggable ? "cursor-ns-resize" : "cursor-pointer"}
                    onPointerDown={(event) => handleMarkPointerDown(event, curve, key, draggable)}
                  >
                    <title>{draggable ? `${label}，上下拖改值` : label}</title>
                    <circle
                      data-testid="curve-key-hit"
                      cx={cx}
                      cy={cy}
                      r={tolerance.keyHitRadius}
                      fill="transparent"
                    />
                    {key.kind === "pass" ? (
                      <circle
                        cx={cx}
                        cy={cy}
                        r={selected ? 3.5 : 3}
                        strokeWidth={1.5}
                        className={cn("fill-card", selected ? "stroke-primary" : "stroke-foreground/80")}
                      />
                    ) : (
                      <rect
                        x={cx - (selected ? 4.5 : 3.75)}
                        y={cy - (selected ? 4.5 : 3.75)}
                        width={selected ? 9 : 7.5}
                        height={selected ? 9 : 7.5}
                        transform={`rotate(45 ${cx} ${cy})`}
                        strokeWidth={selected ? 1.5 : 1}
                        className={cn(
                          key.kind === "preset"
                            ? "fill-muted-foreground stroke-card"
                            : selected
                              ? "fill-primary stroke-foreground"
                              : "fill-foreground stroke-card",
                        )}
                      />
                    )}
                  </g>
                );
              })}
        </g>
      ))}

      {keyDrag && keyDrag.snapValue !== null ? (
        <line
          data-testid="curve-snap-line"
          x1={0}
          x2={canvasWidth}
          y1={y(keyDrag.snapValue)}
          y2={y(keyDrag.snapValue)}
          strokeDasharray="4 3"
          className="pointer-events-none stroke-warning"
        />
      ) : null}

      {draggedKey && draggedCurve ? (
        <CurveLabel
          x={x(draggedKey.atMs)}
          y={y(draggedKey.value) - tolerance.labelOffsetPx}
          text={`${objectName(draggedCurve.objectId)} · ${format.value(draggedCurve, draggedKey.value)}`}
        />
      ) : null}

      {marquee ? (
        <rect
          x={Math.min(marquee.x0, marquee.x1)}
          y={Math.min(marquee.y0, marquee.y1)}
          width={Math.abs(marquee.x1 - marquee.x0)}
          height={Math.abs(marquee.y1 - marquee.y0)}
          className="pointer-events-none fill-primary/20 stroke-primary"
        />
      ) : null}
    </svg>
  );
};

/** 拖值时关键帧上方的小标签：哪个物体、拖到多少 */
const CurveLabel = ({ x, y, text }: { x: number; y: number; text: string }) => {
  // 等宽数字约 6.6px，中文约 11px
  const width = [...text].reduce((sum, char) => sum + (char.charCodeAt(0) > 0xff ? 11 : 6.6), 10);
  const left = x - width / 2;
  return (
    <g className="pointer-events-none" data-testid="curve-label">
      <rect x={left} y={y - 9} width={width} height={16} rx={2} className="fill-card stroke-border" />
      <text
        x={left + width / 2}
        y={y + 3}
        textAnchor="middle"
        className="fill-foreground font-mono text-[11px] tabular-nums"
      >
        {text}
      </text>
    </g>
  );
};
