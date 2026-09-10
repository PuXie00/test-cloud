import type { AlignAxis, AlignEdge, AlignMode, Vec3 } from "../types";

export type { AlignAxis, AlignEdge, AlignMode } from "../types";

export type AlignBoundsItem = {
  id: string;
  position: Vec3;
  min: Vec3;
  max: Vec3;
};

const axisValue = (position: Vec3, axis: AlignAxis): number => position[axis];

const withAxisValue = (position: Vec3, axis: AlignAxis, value: number): Vec3 => ({
  ...position,
  [axis]: value,
});

const resolveAlignTarget = (values: number[], edge: AlignEdge): number => {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (edge === "min") {
    return min;
  }
  if (edge === "max") {
    return max;
  }
  return (min + max) / 2;
};

export const alignPositions = (
  items: { id: string; position: Vec3 }[],
  axis: AlignAxis,
  edge: AlignEdge
): Record<string, Vec3> => {
  const target = resolveAlignTarget(items.map((item) => axisValue(item.position, axis)), edge);
  const result: Record<string, Vec3> = {};
  items.forEach((item) => {
    result[item.id] = withAxisValue(item.position, axis, target);
  });
  return result;
};

export const alignByBounds = (
  items: AlignBoundsItem[],
  mode: AlignMode,
): Record<string, Vec3> => {
  if (items.length < 2) {
    return Object.fromEntries(items.map((item) => [item.id, { ...item.position }]));
  }

  const selMinX = Math.min(...items.map((item) => item.min.x));
  const selMaxX = Math.max(...items.map((item) => item.max.x));
  const selMinY = Math.min(...items.map((item) => item.min.y));
  const selMaxY = Math.max(...items.map((item) => item.max.y));
  const selCenterX = (selMinX + selMaxX) / 2;
  const selCenterY = (selMinY + selMaxY) / 2;

  const result: Record<string, Vec3> = {};
  for (const item of items) {
    const centerX = (item.min.x + item.max.x) / 2;
    const centerY = (item.min.y + item.max.y) / 2;
    let dx = 0;
    let dy = 0;

    if (mode === "left") dx = selMinX - item.min.x;
    if (mode === "right") dx = selMaxX - item.max.x;
    if (mode === "hCenter" || mode === "center") dx = selCenterX - centerX;
    if (mode === "top") dy = selMaxY - item.max.y;
    if (mode === "bottom") dy = selMinY - item.min.y;
    if (mode === "vCenter" || mode === "center") dy = selCenterY - centerY;

    result[item.id] = {
      x: item.position.x + dx,
      y: item.position.y + dy,
      z: item.position.z,
    };
  }
  return result;
};

export const distributePositions = (
  items: { id: string; position: Vec3 }[],
  axis: AlignAxis
): Record<string, Vec3> => {
  if (items.length < 3) {
    return Object.fromEntries(items.map((item) => [item.id, { ...item.position }]));
  }

  const sorted = [...items].sort(
    (a, b) => axisValue(a.position, axis) - axisValue(b.position, axis)
  );
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const start = axisValue(first.position, axis);
  const end = axisValue(last.position, axis);
  const step = (end - start) / (sorted.length - 1);

  const result: Record<string, Vec3> = {};
  sorted.forEach((item, index) => {
    result[item.id] = withAxisValue(item.position, axis, start + step * index);
  });
  return result;
};
