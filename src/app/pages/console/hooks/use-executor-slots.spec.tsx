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
        ready: { sequenceId: 15, fingerprint: "fp-15", initialTransition: null, preparedPoses: {} },
        isRunning: false,
      }),
    ).toBe("ready");
  });

  it("returns idle when the slot sequence changes", () => {
    expect(
      deriveFaderSlotPhase({
        sequenceId: 16,
        fingerprint: "fp-16",
        ready: { sequenceId: 15, fingerprint: "fp-15", initialTransition: null, preparedPoses: {} },
        isRunning: false,
      }),
    ).toBe("idle");
  });

  it("returns idle when the document fingerprint changes", () => {
    expect(
      deriveFaderSlotPhase({
        sequenceId: 15,
        fingerprint: "fp-15-b",
        ready: { sequenceId: 15, fingerprint: "fp-15-a", initialTransition: null, preparedPoses: {} },
        isRunning: false,
      }),
    ).toBe("idle");
  });

  it("prefers running over a leftover ready record", () => {
    expect(
      deriveFaderSlotPhase({
        sequenceId: 15,
        fingerprint: "fp-15",
        ready: { sequenceId: 15, fingerprint: "fp-15", initialTransition: null, preparedPoses: {} },
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
      result.current.markSlotReady(0, 15, "fp-15", null, {});
      result.current.markSlotReady(1, 16, "fp-16", null, {});
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

  it("stores the transition while ready and drops it when ready is cleared or the fingerprint changes", () => {
    const plan = { totalTime: 3, models: [] };
    const poses = { 1: { h: 10, p: 0, y: 0 } };
    let fingerprints: Record<number, string> = { 15: "fp-15", 16: "fp-16" };
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(
        ExecutorSlotsProvider,
        { pageItems: pageItemsFor([15, 16]), sequenceFingerprints: fingerprints },
        children,
      );
    const { result, rerender } = renderHook(() => useExecutorSlots(), { wrapper });

    act(() => {
      result.current.markSlotReady(0, 15, "fp-15", plan, poses);
    });
    expect(result.current.faderSlots[0]?.phase).toBe("ready");
    expect(result.current.faderSlots[0]?.initialTransition).toEqual(plan);
    expect(result.current.faderSlots[0]?.preparedPoses).toEqual(poses);
    expect(result.current.faderSlots[1]?.initialTransition).toBeNull();
    expect(result.current.faderSlots[1]?.preparedPoses).toBeNull();

    act(() => {
      result.current.setSlotRunning(0, true);
    });
    expect(result.current.faderSlots[0]?.phase).toBe("running");
    expect(result.current.faderSlots[0]?.initialTransition).toBeNull();
    expect(result.current.faderSlots[0]?.preparedPoses).toBeNull();

    act(() => {
      result.current.setSlotRunning(0, false);
    });
    expect(result.current.faderSlots[0]?.phase).toBe("ready");
    expect(result.current.faderSlots[0]?.initialTransition).toEqual(plan);
    expect(result.current.faderSlots[0]?.preparedPoses).toEqual(poses);

    act(() => {
      result.current.clearSlotReady(0);
    });
    expect(result.current.faderSlots[0]?.phase).toBe("idle");
    expect(result.current.faderSlots[0]?.initialTransition).toBeNull();
    expect(result.current.faderSlots[0]?.preparedPoses).toBeNull();

    act(() => {
      result.current.markSlotReady(0, 15, "fp-15", plan, poses);
    });
    fingerprints = { 15: "fp-15-next", 16: "fp-16" };
    rerender();
    expect(result.current.faderSlots[0]?.initialTransition).toBeNull();
    expect(result.current.faderSlots[0]?.preparedPoses).toBeNull();
  });

  it("always exposes twelve F1–F12 slots", () => {
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(
        ExecutorSlotsProvider,
        { pageItems: pageItemsFor([15]), sequenceFingerprints: { 15: "fp-15" } },
        children,
      );
    const { result } = renderHook(() => useExecutorSlots(), { wrapper });
    expect(result.current.faderSlots).toHaveLength(12);
    expect(result.current.faderSlots.map((slot) => slot.label)).toEqual([
      "F1",
      "F2",
      "F3",
      "F4",
      "F5",
      "F6",
      "F7",
      "F8",
      "F9",
      "F10",
      "F11",
      "F12",
    ]);
    expect(result.current.faderSlots[0]?.sequence?.id).toBe(15);
    expect(result.current.faderSlots[1]?.sequence).toBeNull();
  });
});
