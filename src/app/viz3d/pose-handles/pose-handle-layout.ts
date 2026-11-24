import type { Vec3 } from "../types";
import {
  addVec,
  crossVec,
  distancePt,
  distanceToPolyline,
  scaleVec,
  type Pt,
} from "./pose-handle-math";
import type { LiftHandleModel, PoseHandleModel, RingHandleModel, SwingHandleModel } from "./pose-handle-model";
import type { PoseHandleKind } from "./pose-handle-types";

/** 一格视口的投影：世界 → 画布坐标（CSS px） */
export type CellProjector = {
  /** 在相机背后（近裁剪面以内）时 null */
  project: (point: Vec3) => Pt | null;
  /** 这一点处世界 1 米约多少屏幕像素 */
  pixelsPerMeter: (point: Vec3) => number;
  /** 从相机看向这一点的视线方向（单位向量） */
  viewDirection: (point: Vec3) => Vec3;
};

/** 升降箭头离顶面中心的空隙：让开虚轴标签 */
export const LIFT_GAP_PX = 26;
export const LIFT_LENGTH_PX = 58;
const ARROW_HEAD_PX = 10;
const ARROW_HALF_WIDTH_PX = 6;
/** 摇杆在屏幕上的长度 */
export const SWING_LENGTH_PX = 72;
/** 环、弧在屏幕上至少这么大，小物体也好抓 */
export const MIN_RING_RADIUS_PX = 34;
export const HANDLE_HIT_PX = 9;
const KNOB_RADIUS_PX = 6;
const SWING_KNOB_RADIUS_PX = 7;
const END_ON_RADIUS_PX = 9;

/** 一个手柄在一格视口里的屏幕形状：画和点中都用它 */
export type HandleLayout = {
  key: string;
  objectId: string;
  kind: PoseHandleKind;
  /** 描边折线：箭杆、环、弧、摇杆 */
  strokes: Pt[][];
  /** 实心三角：箭头 */
  fills: Pt[][];
  /** 圆头 */
  knobs: Array<Pt & { r: number }>;
  /** 细虚线：行程条、竖直参考 */
  guides: Pt[][];
  /** 行程两端的短横（顶到时变色） */
  limits: Array<{ end: "min" | "max"; points: Pt[] }>;
  /** 拖动时数值标签放这里 */
  labelAt: Pt;
};

export const poseHandleKey = (objectId: string, kind: PoseHandleKind): string => `${objectId}:${kind}`;

const offsetPt = (p: Pt, dir: Pt, distance: number): Pt => ({ x: p.x + dir.x * distance, y: p.y + dir.y * distance });

const unitPt = (from: Pt, to: Pt): Pt | null => {
  const length = distancePt(from, to);
  return length < 1e-9 ? null : { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
};

/** 沿世界线段取样投影，相机背后的部分断开 */
export const projectPolyline = (projector: CellProjector, points: readonly Vec3[]): Pt[][] => {
  const runs: Pt[][] = [];
  let current: Pt[] = [];
  for (const point of points) {
    const projected = projector.project(point);
    if (projected) {
      current.push(projected);
      continue;
    }
    if (current.length > 1) runs.push(current);
    current = [];
  }
  if (current.length > 1) runs.push(current);
  return runs;
};

const sampleSegment = (a: Vec3, b: Vec3, samples: number): Vec3[] =>
  Array.from({ length: samples + 1 }, (_, index) => {
    const t = index / samples;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
  });

const circlePts = (center: Pt, radius: number, segments = 24): Pt[] =>
  Array.from({ length: segments + 1 }, (_, index) => {
    const angle = (index / segments) * Math.PI * 2;
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
  });

const arrowHead = (tip: Pt, dir: Pt): Pt[] => {
  const base = offsetPt(tip, dir, -ARROW_HEAD_PX);
  const normal = { x: -dir.y, y: dir.x };
  return [tip, offsetPt(base, normal, ARROW_HALF_WIDTH_PX), offsetPt(base, normal, -ARROW_HALF_WIDTH_PX), tip];
};

const tickAt = (at: Pt, dir: Pt | null): Pt[] => {
  const normal = dir ? { x: -dir.y, y: dir.x } : { x: 1, y: 0 };
  return [offsetPt(at, normal, -5), offsetPt(at, normal, 5)];
};

/** 环、弧的世界半径：模型半径，屏幕上不小于 MIN_RING_RADIUS_PX */
export const ringRadiusIn = (model: RingHandleModel, projector: CellProjector): number =>
  Math.max(model.radius, MIN_RING_RADIUS_PX / Math.max(projector.pixelsPerMeter(model.center), 1e-6));

export const ringPoint = (model: RingHandleModel, radius: number, angle: number): Vec3 =>
  addVec(
    model.center,
    addVec(
      scaleVec(model.ref, radius * Math.cos(angle)),
      scaleVec(crossVec(model.rotationAxis, model.ref), radius * Math.sin(angle)),
    ),
  );

export const swingLengthIn = (model: SwingHandleModel, projector: CellProjector): number =>
  SWING_LENGTH_PX / Math.max(projector.pixelsPerMeter(model.center), 1e-6);

type LayoutBase = Pick<HandleLayout, "key" | "objectId" | "kind">;

const emptyLayout = (base: LayoutBase, labelAt: Pt): HandleLayout => ({
  ...base,
  strokes: [],
  fills: [],
  knobs: [],
  guides: [],
  limits: [],
  labelAt,
});

export type LayoutOptions = {
  /** 升降箭头离顶面中心多远开始（px）：同一物体有倾斜弧、摇杆时让到它们上面 */
  liftGapPx?: number;
};

const layoutLift = (
  model: LiftHandleModel,
  projector: CellProjector,
  base: LayoutBase,
  gapPx: number,
): HandleLayout | null => {
  const anchor = projector.project(model.anchor);
  if (!anchor) return null;
  const ppm = Math.max(projector.pixelsPerMeter(model.anchor), 1e-6);
  const probe = projector.project(addVec(model.anchor, scaleVec(model.up, 20 / ppm)));
  const dir = probe && distancePt(anchor, probe) >= 4 ? unitPt(anchor, probe) : null;

  const layout = emptyLayout(base, anchor);
  if (model.travel) {
    layout.guides = projectPolyline(projector, sampleSegment(model.travel.min, model.travel.max, 24));
    for (const end of ["min", "max"] as const) {
      const at = projector.project(model.travel[end]);
      if (at) layout.limits.push({ end, points: tickAt(at, dir) });
    }
  }

  if (!dir) {
    // 正对着竖直方向看（如顶视）：箭头缩成一个圈，上下拖
    const at = { x: anchor.x, y: anchor.y - gapPx };
    layout.strokes = [circlePts(at, END_ON_RADIUS_PX)];
    layout.knobs = [{ ...at, r: 2.5 }];
    layout.labelAt = { x: at.x + 16, y: at.y };
    return layout;
  }
  const bottom = offsetPt(anchor, dir, gapPx);
  const top = offsetPt(anchor, dir, gapPx + LIFT_LENGTH_PX);
  layout.strokes = [[offsetPt(bottom, dir, ARROW_HEAD_PX - 1), offsetPt(top, dir, -(ARROW_HEAD_PX - 1))]];
  layout.fills = [arrowHead(top, dir), arrowHead(bottom, { x: -dir.x, y: -dir.y })];
  const middle = offsetPt(bottom, dir, LIFT_LENGTH_PX / 2);
  layout.labelAt = offsetPt(middle, { x: -dir.y, y: dir.x }, dir.y <= 0 ? 16 : -16);
  return layout;
};

const layoutRing = (model: RingHandleModel, projector: CellProjector, base: LayoutBase): HandleLayout | null => {
  const radius = ringRadiusIn(model, projector);
  const [from, to] = model.arc ?? [0, Math.PI * 2];
  const segments = model.arc ? 40 : 96;
  const points = Array.from({ length: segments + 1 }, (_, index) =>
    ringPoint(model, radius, from + ((to - from) * index) / segments),
  );
  const strokes = projectPolyline(projector, points);
  if (strokes.length === 0) return null;
  const knob = projector.project(ringPoint(model, radius, 0));
  const layout = emptyLayout(base, knob ?? strokes[0]![0]!);
  layout.strokes = strokes;
  if (knob) {
    layout.knobs = [{ ...knob, r: KNOB_RADIUS_PX }];
    layout.labelAt = { x: knob.x + 14, y: knob.y - 14 };
  }
  return layout;
};

const layoutSwing = (model: SwingHandleModel, projector: CellProjector, base: LayoutBase): HandleLayout | null => {
  const center = projector.project(model.center);
  if (!center) return null;
  const length = swingLengthIn(model, projector);
  const tipWorld = addVec(model.center, scaleVec(model.normal, length));
  const tip = projector.project(tipWorld);
  const layout = emptyLayout(base, center);
  layout.guides = projectPolyline(projector, sampleSegment(model.center, addVec(model.center, scaleVec(model.up, length)), 8));
  layout.strokes = projectPolyline(projector, sampleSegment(model.center, tipWorld, 8));
  if (tip) {
    layout.knobs = [{ ...tip, r: SWING_KNOB_RADIUS_PX }];
    layout.labelAt = { x: tip.x + 16, y: tip.y - 12 };
  }
  return layout;
};

export const layoutPoseHandle = (
  objectId: string,
  model: PoseHandleModel,
  projector: CellProjector,
  options: LayoutOptions = {},
): HandleLayout | null => {
  const base: LayoutBase = { key: poseHandleKey(objectId, model.kind), objectId, kind: model.kind };
  switch (model.kind) {
    case "lift":
      return layoutLift(model, projector, base, options.liftGapPx ?? LIFT_GAP_PX);
    case "swing":
      return layoutSwing(model, projector, base);
    default:
      return layoutRing(model, projector, base);
  }
};

/** 同一物体的升降箭头要让开的距离：摇杆的长度、倾斜弧的半径（屏幕上） */
export const liftGapAmong = (models: readonly PoseHandleModel[], projector: CellProjector): number => {
  let gap = LIFT_GAP_PX;
  for (const model of models) {
    if (model.kind === "swing") gap = Math.max(gap, SWING_LENGTH_PX + 16);
    if (model.kind === "tiltX" || model.kind === "tiltY") {
      gap = Math.max(gap, ringRadiusIn(model, projector) * projector.pixelsPerMeter(model.center) + 16);
    }
  }
  return gap;
};

export type HandleHit = { layout: HandleLayout; distance: number };

const layoutDistance = (layout: HandleLayout, point: Pt): number => {
  let best = Number.POSITIVE_INFINITY;
  // 圆头比线好抓：按到圆头里算 0，并且优先
  for (const knob of layout.knobs) {
    best = Math.min(best, Math.max(0, distancePt(point, knob) - knob.r) - 2);
  }
  for (const stroke of layout.strokes) best = Math.min(best, distanceToPolyline(point, stroke));
  for (const fill of layout.fills) best = Math.min(best, distanceToPolyline(point, fill) - 1);
  return best;
};

/** 离指针最近、在容差里的手柄 */
export const hitTestHandles = (
  layouts: readonly HandleLayout[],
  point: Pt,
  tolerance = HANDLE_HIT_PX,
): HandleHit | null => {
  let best: HandleHit | null = null;
  for (const layout of layouts) {
    const distance = layoutDistance(layout, point);
    if (distance > tolerance) continue;
    if (!best || distance < best.distance) best = { layout, distance };
  }
  return best;
};
