import { describe, expect, it } from "vitest";
import {
  formatPreviewNotice,
  MANUAL_OPERATIONS,
  NO_SELECTION_NOTICE,
  resolveManualControlAvailability,
} from "./manual-control-availability";

describe("resolveManualControlAvailability", () => {
  it("disables everything and asks for a selection when nothing is selected", () => {
    const availability = resolveManualControlAvailability([]);
    expect(availability.notice).toBe(NO_SELECTION_NOTICE);
    expect(MANUAL_OPERATIONS.some((operation) => availability.allowed(operation))).toBe(false);
  });

  it("allows everything for online objects in any non-offline state", () => {
    const availability = resolveManualControlAvailability([
      { name: "A", status: "ready" },
      { name: "B", status: "alarm" },
      { name: "C", status: "disabled" },
    ]);
    expect(availability.notice).toBeNull();
    expect(MANUAL_OPERATIONS.every((operation) => availability.allowed(operation))).toBe(true);
  });

  it("disables the whole panel when any selected object is offline", () => {
    const availability = resolveManualControlAvailability([
      { name: "A", status: "ready" },
      { name: "B", status: "offline" },
    ]);
    expect(availability.notice).toBe("B 离线，无法操作");
    expect(MANUAL_OPERATIONS.some((operation) => availability.allowed(operation))).toBe(false);
  });

  it("shows only the count when more than one object is offline", () => {
    const availability = resolveManualControlAvailability(
      ["A", "B", "C", "D"].map((name) => ({ name, status: "offline" as const })),
    );
    expect(availability.notice).toBe("4 个物体离线，无法操作");
  });

  it("disables everything with a preview notice while an action is being previewed", () => {
    const availability = resolveManualControlAvailability(
      [{ name: "A", status: "ready" }],
      { name: "开场" },
    );
    expect(availability.notice).toBe("正在预览「开场」，无法操作");
    expect(MANUAL_OPERATIONS.some((operation) => availability.allowed(operation))).toBe(false);
  });

  it("falls back to a generic preview notice when the sequence has no name", () => {
    expect(formatPreviewNotice()).toBe("正在预览动作序列，无法操作");
    expect(resolveManualControlAvailability([{ name: "A", status: "ready" }], {}).notice).toBe(
      "正在预览动作序列，无法操作",
    );
  });

  it("shows the preview notice even when nothing is selected, and before offline", () => {
    expect(resolveManualControlAvailability([], { name: "开场" }).notice).toBe(
      "正在预览「开场」，无法操作",
    );
    expect(
      resolveManualControlAvailability([{ name: "A", status: "offline" }], { name: "开场" }).notice,
    ).toBe("正在预览「开场」，无法操作");
  });

  it("does not block anything once the preview is over", () => {
    const availability = resolveManualControlAvailability([{ name: "A", status: "ready" }], null);
    expect(availability.notice).toBeNull();
    expect(MANUAL_OPERATIONS.every((operation) => availability.allowed(operation))).toBe(true);
  });
});
