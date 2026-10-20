import type { PresetLayout } from "./types";

/** 物体在水平面上的位置（世界坐标，mm） */
export type LayoutPoint = { id: number; x: number; z: number };

/** 沿排列方向的分布小于这个距离时，当作叠在一起，按原顺序等距 */
const MIN_SPREAD_MM = 1;
const OFFSET_DECIMALS = 4;

const roundTo = (value: number, decimals: number): number => {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
};

/** 角度归到 (-180°, 180°] */
const normalizeAngleDeg = (deg: number): number => {
  const wrapped = ((deg % 360) + 360) % 360;
  return wrapped > 180 ? wrapped - 360 : wrapped;
};

/**
 * 自动方向：这批物体在水平面上分布最长的方向（主方向），0° 沿 X 正向、90° 沿 Z 正向；
 * 取朝 X 正向那一侧（-90°, 90°]。叠在一起时取 0°。
 */
export const autoLayoutAngleDeg = (points: readonly Pick<LayoutPoint, "x" | "z">[]): number => {
  if (points.length < 2) return 0;
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const meanZ = points.reduce((sum, point) => sum + point.z, 0) / points.length;
  let sxx = 0;
  let szz = 0;
  let sxz = 0;
  for (const point of points) {
    const dx = point.x - meanX;
    const dz = point.z - meanZ;
    sxx += dx * dx;
    szz += dz * dz;
    sxz += dx * dz;
  }
  if (sxx + szz < MIN_SPREAD_MM * MIN_SPREAD_MM) return 0;
  let deg = (0.5 * Math.atan2(2 * sxz, sxx - szz) * 180) / Math.PI;
  if (deg <= -90) deg += 180;
  if (deg > 90) deg -= 180;
  return roundTo(deg, 1);
};

/**
 * 按坐标排预设的参与物体：投影到方向上从小到大排（投影相同的保持原顺序），
 * 相对位置 = 到第一个的距离 / 平均间距，所以第一个是 0、最后一个是 n−1，间距均匀时就是 0,1,2…。
 * 沿这个方向几乎没有分布时按原顺序等距。不传角度时取自动方向。
 */
export const layoutParticipants = (
  points: readonly LayoutPoint[],
  angleDeg?: number,
): { orderedObjectIds: number[]; layout: PresetLayout } => {
  const angle = normalizeAngleDeg(angleDeg ?? autoLayoutAngleDeg(points));
  const rad = (angle * Math.PI) / 180;
  const projected = points
    .map((point, index) => ({
      id: point.id,
      index,
      along: point.x * Math.cos(rad) + point.z * Math.sin(rad),
    }))
    .sort((left, right) => left.along - right.along || left.index - right.index);
  const count = projected.length;
  const first = projected[0]?.along ?? 0;
  const spread = (projected[count - 1]?.along ?? 0) - first;
  const offsets =
    count < 2 || spread < MIN_SPREAD_MM
      ? projected.map((_, index) => index)
      : projected.map((item, index) =>
          index === count - 1
            ? count - 1
            : roundTo(((item.along - first) * (count - 1)) / spread, OFFSET_DECIMALS),
        );
  return {
    orderedObjectIds: projected.map((item) => item.id),
    layout: { angleDeg: roundTo(angle, 1), offsets },
  };
};

/** 每个参与物体沿排列方向的相对位置；没有按坐标排过的老预设按第几个算 */
export const participantOffsets = (block: {
  orderedObjectIds: readonly number[];
  layout?: PresetLayout;
}): number[] =>
  block.layout && block.layout.offsets.length === block.orderedObjectIds.length
    ? [...block.layout.offsets]
    : block.orderedObjectIds.map((_, index) => index);

/**
 * 去掉部分参与物体后（如物体被删）重新归一：第一个还是 0、最后一个是 n−1，间距比例不变。
 * keep 与原 offsets 一一对应。
 */
export const keepLayoutOffsets = (
  layout: PresetLayout,
  keep: readonly boolean[],
): PresetLayout => {
  const kept = layout.offsets.filter((_, index) => keep[index]);
  const count = kept.length;
  const first = kept[0] ?? 0;
  const spread = (kept[count - 1] ?? 0) - first;
  const offsets =
    count < 2 || !(spread > 0)
      ? kept.map((_, index) => index)
      : kept.map((offset, index) =>
          index === count - 1 ? count - 1 : roundTo(((offset - first) * (count - 1)) / spread, OFFSET_DECIMALS),
        );
  return { angleDeg: layout.angleDeg, offsets };
};
