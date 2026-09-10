import { describe, expect, it } from "vitest";
import { shouldYieldPointerToTransformHandle } from "./transform-handle-pick";

const idle = {
  dragging: false,
  enabled: true,
  helperVisible: true,
  attached: true,
  hovered: false,
};

describe("shouldYieldPointerToTransformHandle", () => {
  it("yields while a handle drag is already active", () => {
    expect(shouldYieldPointerToTransformHandle({ ...idle, dragging: true })).toBe(true);
  });

  it("does not yield when detached, hidden, or disabled", () => {
    expect(shouldYieldPointerToTransformHandle({ ...idle, attached: false, hovered: true })).toBe(
      false,
    );
    expect(
      shouldYieldPointerToTransformHandle({ ...idle, helperVisible: false, hovered: true }),
    ).toBe(false);
    expect(shouldYieldPointerToTransformHandle({ ...idle, enabled: false, hovered: true })).toBe(
      false,
    );
  });

  it("yields when idle and a handle is already hovered", () => {
    expect(shouldYieldPointerToTransformHandle({ ...idle, hovered: true })).toBe(true);
    expect(shouldYieldPointerToTransformHandle(idle)).toBe(false);
  });
});
