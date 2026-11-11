import type {
  SlotRect,
  ViewPreset,
  ViewportCellId,
  ViewportLayout,
  ViewportSplit,
} from "../types";

const MIN_RATIO = 0.1;
const MAX_RATIO = 0.9;

export const DEFAULT_SPLIT: ViewportSplit = { x: 0.5, y: 0.5 };

export const VIEWPORT_LAYOUTS: readonly ViewportLayout[] = ["single", "dual", "quad"];

export const VIEWPORT_CELL_IDS: readonly ViewportCellId[] = [
  "main",
  "dualRight",
  "quadTopRight",
  "quadBottomLeft",
  "quadBottomRight",
];

/**
 * 各布局显示哪几格，顺序同 computeViewportCells（左上、右上、左下、右下）。
 * 主透视格在所有布局里都是第一格（左上）；四视图其余默认右上顶、左下前、右下右。
 */
export const LAYOUT_CELL_IDS: Record<ViewportLayout, readonly ViewportCellId[]> = {
  single: ["main"],
  dual: ["main", "dualRight"],
  quad: ["main", "quadTopRight", "quadBottomLeft", "quadBottomRight"],
};

/** 每格第一次出现时的视角；之后各格自己改、自己记 */
export const DEFAULT_CELL_PRESETS: Record<ViewportCellId, ViewPreset> = {
  main: "persp",
  dualRight: "top",
  quadTopRight: "top",
  quadBottomLeft: "front",
  quadBottomRight: "side",
};

export const isViewportLayout = (value: unknown): value is ViewportLayout =>
  typeof value === "string" && (VIEWPORT_LAYOUTS as readonly string[]).includes(value);

export const isViewportCellId = (value: unknown): value is ViewportCellId =>
  typeof value === "string" && (VIEWPORT_CELL_IDS as readonly string[]).includes(value);

const clampRatio = (value: number): number => Math.min(MAX_RATIO, Math.max(MIN_RATIO, value));

export const clampSplit = (split: ViewportSplit): ViewportSplit => ({
  x: clampRatio(Number.isFinite(split.x) ? split.x : DEFAULT_SPLIT.x),
  y: clampRatio(Number.isFinite(split.y) ? split.y : DEFAULT_SPLIT.y),
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

/** 把矩形裁进格子里；不相交时返回 null */
export const clipRectToCell = (rect: SlotRect, cell: SlotRect): SlotRect | null => {
  const left = Math.max(rect.left, cell.left);
  const top = Math.max(rect.top, cell.top);
  const right = Math.min(rect.left + rect.width, cell.left + cell.width);
  const bottom = Math.min(rect.top + rect.height, cell.top + cell.height);
  if (right < left || bottom < top) {
    return null;
  }
  return { left, top, width: right - left, height: bottom - top };
};
