import { formatLengthFamily, type DisplayLengthUnit } from "@/app/project/display-length-units";
import type { Vec3 } from "../types";

/** 一把标尺：两个世界坐标端点（m），不跟随物体 */
export type MeasureRuler = { id: string; a: Vec3; b: Vec3 };

export type MeasureEndpoint = "a" | "b";

/** 端点落点来源：吊点中心 > 顶点 > 物体表面 > 地面 > 视图平面 */
export type MeasureSnapKind = "hoist" | "vertex" | "surface" | "ground" | "view";

export type ScreenPoint = { x: number; y: number };

const M_TO_MM = 1000;

/** 小于这个长度（m）的标尺在松手时丢掉，免得留下看不见的标尺 */
export const MIN_RULER_LENGTH_M = 1e-6;

export const rulerLengthMm = (ruler: Pick<MeasureRuler, "a" | "b">): number =>
  Math.hypot(ruler.b.x - ruler.a.x, ruler.b.y - ruler.a.y, ruler.b.z - ruler.a.z) * M_TO_MM;

/** 三个方向的分量（mm，取绝对值：水平距离、高度差） */
export const rulerDeltaMm = (ruler: Pick<MeasureRuler, "a" | "b">): Vec3 => ({
  x: Math.abs(ruler.b.x - ruler.a.x) * M_TO_MM,
  y: Math.abs(ruler.b.y - ruler.a.y) * M_TO_MM,
  z: Math.abs(ruler.b.z - ruler.a.z) * M_TO_MM,
});

/** 测量值（非负）固定 0.1mm 精度换算到显示单位，不去尾零 */
export const formatMeasureLength = (mm: number, unit: DisplayLengthUnit): string =>
  formatLengthFamily(mm, "mm", unit, { canonicalPrecision: 1, trimTrailingZeros: false });

export const distanceToSegment = (point: ScreenPoint, a: ScreenPoint, b: ScreenPoint): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0
      ? 0
      : Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
};

/** 一把标尺在某一格里的屏幕投影（已按近裁剪面截断） */
export type ProjectedRuler = {
  id: string;
  a: ScreenPoint;
  b: ScreenPoint;
  /** 端点本身在相机前方（被截断的一端不能当端点拖） */
  aInFront: boolean;
  bInFront: boolean;
};

export type RulerHit =
  | { kind: "endpoint"; id: string; endpoint: MeasureEndpoint }
  | { kind: "segment"; id: string };

/**
 * 按下点命中哪把标尺：端点优先（最近的那个），其次线段。
 * 选中的标尺排在最后画、在最上面，同距离时先算它。
 */
export const hitTestRulers = (
  point: ScreenPoint,
  rulers: readonly ProjectedRuler[],
  radii: { endpoint: number; segment: number },
  selectedId: string | null,
): RulerHit | null => {
  const ordered = [...rulers].sort(
    (left, right) => Number(right.id === selectedId) - Number(left.id === selectedId),
  );
  let best: { hit: RulerHit; distance: number } | null = null;
  for (const ruler of ordered) {
    for (const endpoint of ["a", "b"] as const) {
      if (!(endpoint === "a" ? ruler.aInFront : ruler.bInFront)) continue;
      const screen = ruler[endpoint];
      const distance = Math.hypot(point.x - screen.x, point.y - screen.y);
      if (distance <= radii.endpoint && (!best || distance < best.distance)) {
        best = { hit: { kind: "endpoint", id: ruler.id, endpoint }, distance };
      }
    }
  }
  if (best) return best.hit;
  for (const ruler of ordered) {
    const distance = distanceToSegment(point, ruler.a, ruler.b);
    if (distance <= radii.segment && (!best || distance < best.distance)) {
      best = { hit: { kind: "segment", id: ruler.id }, distance };
    }
  }
  return best?.hit ?? null;
};

/** 屏幕上离光标最近、且在半径内的候选点 */
export const nearestScreenCandidate = <T extends { screen: ScreenPoint }>(
  point: ScreenPoint,
  candidates: Iterable<T>,
  radius: number,
): T | null => {
  let best: T | null = null;
  let bestDistance = radius;
  for (const candidate of candidates) {
    const distance = Math.hypot(point.x - candidate.screen.x, point.y - candidate.screen.y);
    if (distance <= bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
};
