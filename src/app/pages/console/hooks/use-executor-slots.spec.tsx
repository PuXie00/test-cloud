// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import type { PageItems } from "./program-context";
import {
  deriveFaderSlotPhase,
  ExecutorSlotsProvider,
  useExecutorSlots,
} from "./use-executor-slots";

describe("deriveFaderSlotPhase", () => {
  it("keeps ready when the sequence id and fingerprint still match", () => {
    expect(
      deriveFaderSlotPhase({
        sequenceId: 15,
        fingerprint: "fp-15",
        ready: { sequenceId: 15, fingerprint: "fp-15" },
        isRunning: false,
      }),
    ).toBe("ready");
  });

  it("returns idle when the slot sequence changes", () => {
    expect(
      deriveFaderSlotPhase({
        sequenceId: 16,
        fingerprint: "fp-16",
        ready: { sequenceId: 15, fingerprint: "fp-15" },
        isRunning: false,
      }),
    ).toBe("idle");
  });

  it("returns idle when the document fingerprint changes", () => {
    expect(
      deriveFaderSlotPhase({
        sequenceId: 15,
        fingerprint: "fp-15-b",
        ready: { sequenceId: 15, fingerprint: "fp-15-a" },
        isRunning: false,
      }),
    ).toBe("idle");
  });

  it("prefers running over a leftover ready record", () => {
    expect(
      deriveFaderSlotPhase({
        sequenceId: 15,
        fingerprint: "fp-15",
        ready: { sequenceId: 15, fingerprint: "fp-15" },
        isRunning: true,
      }),
    ).toBe("running");
  });
});

const pageItemsFor = (ids: Array<number | null>): PageItems => ({
  sequences: ids.flatMap((id) =>
    id === null
      ? []
      : [{ kind: "sequence" as const, sequence: { id, name: `S${id}`, durationMs: 1000 } }],
  ),
});

describe("ExecutorSlotsProvider", () => {
  it("invalidates ready when the slot sequence or fingerprint changes, not when the fader moves", () => {
    let pageItems = pageItemsFor([15, 16]);
    let fingerprints: Record<number, string> = { 15: "fp-15", 16: "fp-16" };

    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(ExecutorSlotsProvider, { pageItems, sequenceFingerprints: fingerprints }, children);

    const { result, rerender } = renderHook(() => useExecutorSlots(), { wrapper });

    act(() => {
      result.current.markSlotReady(0, 15, "fp-15");
      result.current.markSlotReady(1, 16, "fp-16");
      result.current.setFaderValue(0, 150);
    });
    expect(result.current.faderSlots[0]?.phase).toBe("ready");
    expect(result.current.faderSlots[0]?.faderValue).toBe(150);
    expect(result.current.faderSlots[1]?.phase).toBe("ready");

    fingerprints = { 15: "fp-15-changed", 16: "fp-16" };
    rerender();
    expect(result.current.faderSlots[0]?.phase).toBe("idle");
    expect(result.current.faderSlots[1]?.phase).toBe("ready");

    pageItems = pageItemsFor([99, 16]);
    fingerprints = { 99: "fp-99", 16: "fp-16" };
    rerender();
    expect(result.current.faderSlots[0]?.phase).toBe("idle");
    expect(result.current.faderSlots[1]?.phase).toBe("ready");
  });

  it("always exposes eight F1–F8 slots", () => {
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(
        ExecutorSlotsProvider,
        { pageItems: pageItemsFor([15]), sequenceFingerprints: { 15: "fp-15" } },
        children,
      );
    const { result } = renderHook(() => useExecutorSlots(), { wrapper });
    expect(result.current.faderSlots).toHaveLength(8);
    expect(result.current.faderSlots.map((slot) => slot.label)).toEqual([
      "F1",
      "F2",
      "F3",
      "F4",
      "F5",
      "F6",
      "F7",
      "F8",
    ]);
    expect(result.current.faderSlots[0]?.sequence?.id).toBe(15);
    expect(result.current.faderSlots[1]?.sequence).toBeNull();
  });
});
