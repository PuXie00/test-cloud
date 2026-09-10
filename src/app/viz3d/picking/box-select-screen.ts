import type { ScreenRect } from "../types";

export type { ScreenRect };

export type ScreenProjectedItem = {
  id: string;
  corners: { x: number; y: number }[];
};

export const isPointInScreenRect = (x: number, y: number, rect: ScreenRect): boolean =>
  x >= rect.left &&
  x <= rect.left + rect.width &&
  y >= rect.top &&
  y <= rect.top + rect.height;

export const screenRectsOverlap = (a: ScreenRect, b: ScreenRect): boolean =>
  a.left <= b.left + b.width &&
  a.left + a.width >= b.left &&
  a.top <= b.top + b.height &&
  a.top + a.height >= b.top;

export const projectedCornersToScreenRect = (
  corners: { x: number; y: number }[],
): ScreenRect | null => {
  if (corners.length === 0) {
    return null;
  }
  let minX = corners[0]!.x;
  let maxX = corners[0]!.x;
  let minY = corners[0]!.y;
  let maxY = corners[0]!.y;
  for (let index = 1; index < corners.length; index += 1) {
    const corner = corners[index]!;
    minX = Math.min(minX, corner.x);
    maxX = Math.max(maxX, corner.x);
    minY = Math.min(minY, corner.y);
    maxY = Math.max(maxY, corner.y);
  }
  return { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
};

export const selectIdsInScreenRect = (
  rect: ScreenRect,
  items: ScreenProjectedItem[],
): string[] =>
  items
    .filter((item) => {
      const bounds = projectedCornersToScreenRect(item.corners);
      return bounds ? screenRectsOverlap(rect, bounds) : false;
    })
    .map((item) => item.id);
