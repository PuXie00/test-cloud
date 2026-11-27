import type { SelectionMode } from "@/app/viz3d/types";

export const PRIMARY_POINTER_BUTTON = 0;
export const MIDDLE_POINTER_BUTTON = 1;
export const DRAG_THRESHOLD_PX = 5;

export type ViewportPointerDownKind = "camera" | "boxSelect" | "ignore";

export type ViewportDragFinish =
  | { kind: "pick"; mode: SelectionMode }
  | { kind: "boxSelect"; mode: "replace" | "additive" };

export const resolvePointerDownKind = (button: number): ViewportPointerDownKind => {
  if (button === MIDDLE_POINTER_BUTTON) return "camera";
  if (button === PRIMARY_POINTER_BUTTON) return "boxSelect";
  return "ignore";
};

export const isOverDragThreshold = (dx: number, dy: number): boolean =>
  Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX;

export const shouldFinishViewportDrag = (button: number): boolean =>
  button === PRIMARY_POINTER_BUTTON;

export const resolveViewportDragFinish = (input: {
  additive: boolean;
  toggle: boolean;
  dx: number;
  dy: number;
}): ViewportDragFinish => {
  if (!isOverDragThreshold(input.dx, input.dy)) {
    return { kind: "pick", mode: input.toggle ? "toggle" : "single" };
  }
  return {
    kind: "boxSelect",
    mode: input.additive ? "additive" : "replace",
  };
};
