import { describe, expect, it } from "vitest";
import {
  DRAG_THRESHOLD_PX,
  isOverDragThreshold,
  resolvePointerDownKind,
  resolveViewportDragFinish,
  shouldFinishViewportDrag,
} from "./viewport-pointer-gestures";

describe("resolvePointerDownKind", () => {
  it("routes left to boxSelect, middle to camera, others ignore", () => {
    expect(resolvePointerDownKind(0)).toBe("boxSelect");
    expect(resolvePointerDownKind(1)).toBe("camera");
    expect(resolvePointerDownKind(2)).toBe("ignore");
  });
});

describe("isOverDragThreshold", () => {
  it("treats movement within 5px as a click", () => {
    expect(isOverDragThreshold(DRAG_THRESHOLD_PX, 0)).toBe(false);
    expect(isOverDragThreshold(0, DRAG_THRESHOLD_PX)).toBe(false);
    expect(isOverDragThreshold(DRAG_THRESHOLD_PX + 1, 0)).toBe(true);
    expect(isOverDragThreshold(0, DRAG_THRESHOLD_PX + 1)).toBe(true);
    expect(isOverDragThreshold(-6, 0)).toBe(true);
    expect(isOverDragThreshold(0, -6)).toBe(true);
  });
});

describe("shouldFinishViewportDrag", () => {
  it("only finishes on primary button up", () => {
    expect(shouldFinishViewportDrag(0)).toBe(true);
    expect(shouldFinishViewportDrag(1)).toBe(false);
    expect(shouldFinishViewportDrag(2)).toBe(false);
  });
});

describe("resolveViewportDragFinish", () => {
  it("picks single on click; shift+click still picks single", () => {
    expect(resolveViewportDragFinish({ additive: false, dx: 0, dy: 0 })).toEqual({
      kind: "pick",
      mode: "single",
    });
    expect(resolveViewportDragFinish({ additive: true, dx: 3, dy: 3 })).toEqual({
      kind: "pick",
      mode: "single",
    });
  });

  it("box-selects replace without shift and additive with shift", () => {
    expect(resolveViewportDragFinish({ additive: false, dx: 6, dy: 0 })).toEqual({
      kind: "boxSelect",
      mode: "replace",
    });
    expect(resolveViewportDragFinish({ additive: true, dx: 0, dy: 6 })).toEqual({
      kind: "boxSelect",
      mode: "additive",
    });
  });
});
