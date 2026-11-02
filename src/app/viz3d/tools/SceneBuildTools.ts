import type { AlignAxis, AlignEdge, Vec3 } from "../types";

export type { AlignAxis, AlignEdge } from "../types";

export type AlignBoundsItem = {
  id: string;
  position: Vec3;
  min: Vec3;
  max: Vec3;
};

const moveAlongAxis = (position: Vec3, axis: AlignAxis, delta: number): Vec3 => ({
  ...position,
  [axis]: position[axis] + delta,
});

const unchanged = (items: AlignBoundsItem[]): Record<string, Vec3> =>
  Object.fromEntries(items.map((item) => [item.id, { ...item.position }]));

const centerOf = (item: AlignBoundsItem, axis: AlignAxis): number =>
  (item.min[axis] + item.max[axis]) / 2;

/** 按包围盒对齐到选中整体的最小边、中心或最大边，只动 axis 这一个方向 */
export const alignByBounds = (
  items: AlignBoundsItem[],
  axis: AlignAxis,
  edge: AlignEdge,
): Record<string, Vec3> => {
  if (items.length < 2) return unchanged(items);

  const selMin = Math.min(...items.map((item) => item.min[axis]));
  const selMax = Math.max(...items.map((item) => item.max[axis]));

  const result: Record<string, Vec3> = {};
  for (const item of items) {
    const delta =
      edge === "min"
        ? selMin - item.min[axis]
        : edge === "max"
          ? selMax - item.max[axis]
          : (selMin + selMax) / 2 - centerOf(item, axis);
    result[item.id] = moveAlongAxis(item.position, axis, delta);
  }
  return result;
};

/** 沿 axis 均布：中心最靠外的两个物体不动，中间的等间隙排开；空间不够时间隙为负，会等量重叠 */
export const distributeByBounds = (
  items: AlignBoundsItem[],
  axis: AlignAxis,
): Record<string, Vec3> => {
  if (items.length < 3) return unchanged(items);

  const sorted = [...items].sort((a, b) => centerOf(a, axis) - centerOf(b, axis));
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const middle = sorted.slice(1, -1);
  const occupied = middle.reduce((sum, item) => sum + item.max[axis] - item.min[axis], 0);
  const gap = (last.min[axis] - first.max[axis] - occupied) / (sorted.length - 1);

  const result = unchanged([first, last]);
  let cursor = first.max[axis] + gap;
  for (const item of middle) {
    result[item.id] = moveAlongAxis(item.position, axis, cursor - item.min[axis]);
    cursor += item.max[axis] - item.min[axis] + gap;
  }
  return result;
};
