// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { gate, store } = vi.hoisted(() => ({
  gate: { listening: true },
  store: {
    objects: [{ id: 1, name: "A", controlType: "singlePointMove" }],
    motors: [{ id: 5, productModel: "X", plcId: 1, busNo: 0 }],
  },
}));

vi.mock("./plc-runtime-provider", () => ({ useTelemetryListening: () => gate.listening }));
vi.mock("./use-project-store", () => ({ useProjectStore: () => store }));
vi.mock("./sequence-execution", () => ({
  stopSequence: vi.fn(() => Promise.resolve()),
  getSequenceTransport: () => ({}),
}));

import { ControlledObjectsProvider, useControlledObjects } from "./use-controlled-objects";
import { ExecCardsProvider, useExecCards } from "./use-exec-cards";

type Handler = (msg: unknown) => void;
const handlers: { model?: Handler; axis?: Handler; act?: Handler } = {};
const subscriptions = { model: 0, axis: 0, act: 0 };

const modelFrame = { success: true, data: [{ deviceId: 1, modelStatus: 17, virtualAxisHPosition: 100 }] };
const axisFrame = { success: true, data: [{ deviceId: 5, axisStatus: 3, actualPosition: 12 }] };

beforeEach(() => {
  gate.listening = true;
  subscriptions.model = subscriptions.axis = subscriptions.act = 0;
  (window as unknown as { csocketApi: unknown }).csocketApi = {
    onReadModelInfoPolling: (cb: Handler) => {
      subscriptions.model += 1;
      handlers.model = cb;
      return () => (handlers.model = undefined);
    },
    onReadAxisInfoPolling: (cb: Handler) => {
      subscriptions.axis += 1;
      handlers.axis = cb;
      return () => (handlers.axis = undefined);
    },
    onReadActionRun: (cb: Handler) => {
      subscriptions.act += 1;
      handlers.act = cb;
      return () => (handlers.act = undefined);
    },
    getModelInfoSnapshot: async () => modelFrame,
    getAxisInfoSnapshot: async () => axisFrame,
  };
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { csocketApi?: unknown }).csocketApi;
});

describe("ControlledObjectsProvider listens only while the system status is normal", () => {
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(ControlledObjectsProvider, null, children);

  it("does not subscribe and shows everything offline when not normal", async () => {
    gate.listening = false;
    const { result } = renderHook(() => useControlledObjects(), { wrapper });
    await act(async () => {});
    expect(subscriptions).toMatchObject({ model: 0, axis: 0 });
    expect(result.current.snapshots[0]?.live).toBe(false);
    expect(result.current.motorSnapshots[0]?.status).toBe("offline");
  });

  it("drops live values when the status leaves normal and picks them up again after", async () => {
    const { result, rerender } = renderHook(() => useControlledObjects(), { wrapper });
    await act(async () => {});
    act(() => handlers.axis?.(axisFrame));
    expect(result.current.snapshots[0]?.live).toBe(true);
    expect(result.current.motorSnapshots[0]?.actualPosition).toBe(12);

    gate.listening = false;
    rerender();
    expect(handlers.model).toBeUndefined();
    expect(handlers.axis).toBeUndefined();
    expect(result.current.snapshots[0]?.live).toBe(false);
    expect(result.current.motorSnapshots[0]?.live).toBe(false);

    gate.listening = true;
    rerender();
    await act(async () => {});
    expect(subscriptions).toMatchObject({ model: 2, axis: 2 });
    expect(result.current.snapshots[0]?.live).toBe(true);
    expect(result.current.motorSnapshots[0]?.actualPosition).toBe(12);
  });
});

describe("ExecCardsProvider listenActionReports", () => {
  const Probe = () => {
    const { cards } = useExecCards();
    return createElement("output", null, String(cards.length));
  };
  const seed = (actionId: number) => ({
    name: `序列${actionId}`,
    source: { kind: "fader" as const, slotIndex: 0 },
    speedPercent: 100,
    sequenceId: actionId,
    sequenceHandle: { actionId, deviceId: [1] },
    totalMs: 60000,
  });
  const running = { success: true, data: [{ actionId: 4, state: 3, loopCount: 1, loopCountSet: 1, runTime: 1000 }] };
  const renderCards = (listen: boolean) => (
    <ExecCardsProvider resolveActionSeed={seed} listenActionReports={listen}>
      <Probe />
    </ExecCardsProvider>
  );

  it("ignores Info|act while switched off and resumes when switched on", () => {
    const { rerender } = render(renderCards(false));
    expect(subscriptions.act).toBe(0);

    rerender(renderCards(true));
    expect(subscriptions.act).toBe(1);
    act(() => handlers.act?.(running));
    expect(screen.getByRole("status").textContent).toBe("1");

    rerender(renderCards(false));
    expect(handlers.act).toBeUndefined();
  });
});
