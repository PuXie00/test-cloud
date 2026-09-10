import type { SlotRect, ViewportLayout, ViewportSplit } from "../types";

const MIN_RATIO = 0.1;
const MAX_RATIO = 0.9;

export const DEFAULT_SPLIT: ViewportSplit = { x: 0.5, y: 0.5 };

const clampRatio = (value: number): number => Math.min(MAX_RATIO, Math.max(MIN_RATIO, value));

export const clampSplit = (split: ViewportSplit): ViewportSplit => ({
  x: clampRatio(split.x),
  y: clampRatio(split.y),
});

export const computeViewportCells = (
  layout: ViewportLayout,
  rect: SlotRect,
  split: ViewportSplit = DEFAULT_SPLIT
): SlotRect[] => {
  const { left, top, width, height } = rect;
  const { x, y } = clampSplit(split);

  if (layout === "single") {
    return [{ left, top, width, height }];
  }

  const leftWidth = width * x;
  const rightWidth = width - leftWidth;

  if (layout === "dual") {
    return [
      { left, top, width: leftWidth, height },
      { left: left + leftWidth, top, width: rightWidth, height },
    ];
  }

  const topHeight = height * y;
  const bottomHeight = height - topHeight;

  return [
    { left, top, width: leftWidth, height: topHeight },
    { left: left + leftWidth, top, width: rightWidth, height: topHeight },
    { left, top: top + topHeight, width: leftWidth, height: bottomHeight },
    { left: left + leftWidth, top: top + topHeight, width: rightWidth, height: bottomHeight },
  ];
};

export const findCellIndexAt = (cells: SlotRect[], x: number, y: number): number => {
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index];
    if (
      x >= cell.left &&
      x < cell.left + cell.width &&
      y >= cell.top &&
      y < cell.top + cell.height
    ) {
      return index;
    }
  }
  return -1;
};
