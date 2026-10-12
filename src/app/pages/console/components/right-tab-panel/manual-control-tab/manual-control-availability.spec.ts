import { describe, expect, it } from "vitest";
import {
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
});
