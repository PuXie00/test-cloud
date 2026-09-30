// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTION_RUN_STALE_MS, type ActionCardSeed } from "./exec-card-run-status";
import { ExecCardsProvider, useExecCards } from "./use-exec-cards";

const { stopSequenceMock } = vi.hoisted(() => ({
  stopSequenceMock: vi.fn(() => Promise.resolve()),
}));

vi.mock("./sequence-execution", () => ({
  stopSequence: stopSequenceMock,
  getSequenceTransport: () => ({}),
}));

type Handler = (msg: unknown) => void;
let emitActionRun: Handler = () => undefined;
const offActionRun = vi.fn();
let api: ReturnType<typeof useExecCards>;

const seed = (actionId: number): ActionCardSeed => ({
  name: `序列${actionId}`,
  source: { kind: "fader", slotIndex: 0 },
  speedPercent: 100,
  sequenceId: actionId,
  sequenceHandle: { actionId, deviceId: [1] },
  totalMs: 60000,
});

const Probe = () => {
  api = useExecCards();
  return (
    <ul>
      {api.cards.map((card) => (
        <li key={card.id}>
          {`${card.name}|${card.status}|${card.run?.state ?? "-"}|${card.run?.runTimeMs ?? "-"}`}
        </li>
      ))}
    </ul>
  );
};

const report = (items: Record<string, number>[]) =>
  act(() => emitActionRun({ success: true, data: items }));

const running = (overrides: Record<string, number> = {}) => ({
  actionId: 4,
  state: 3,
  loopCount: 1,
  loopCountSet: 1,
  runTime: 1000,
  ...overrides,
});

const rows = () => screen.queryAllByRole("listitem").map((item) => item.textContent);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  stopSequenceMock.mockClear();
  offActionRun.mockClear();
  (window as unknown as { csocketApi: unknown }).csocketApi = {
    onReadActionRun: (cb: Handler) => {
      emitActionRun = cb;
      return offActionRun;
    },
  };
  render(
    <ExecCardsProvider resolveActionSeed={seed}>
      <Probe />
    </ExecCardsProvider>,
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete (window as unknown as { csocketApi?: unknown }).csocketApi;
});

describe("ExecCardsProvider PLC action run status", () => {
  it("adds a card for a running action the UI did not launch", () => {
    report([running({ state: 1, runTime: 0 })]);
    expect(rows()).toEqual(["序列4|running|1|0"]);
  });

  it("updates the launched card instead of adding a second one", () => {
    act(() => {
      api.launch({
        kind: "sequence",
        name: "开幕",
        durationMs: null,
        source: { kind: "fader", slotIndex: 0 },
        sequenceId: 4,
        sequenceHandle: { actionId: 4, deviceId: [1] },
      });
    });
    report([running()]);
    expect(rows()).toEqual(["开幕|running|3|1000"]);
  });

  it("keeps one card when the PLC reports the action before the GO reply launches it", () => {
    report([running({ state: 1, runTime: 0 })]);
    expect(rows()).toEqual(["序列4|running|1|0"]);
    let launchedId = "";
    act(() => {
      launchedId = api.launch({
        kind: "sequence",
        name: "开幕",
        durationMs: null,
        source: { kind: "fader", slotIndex: 0 },
        sequenceId: 4,
        sequenceHandle: { actionId: 4, deviceId: [1] },
        trajectoryMode: true,
        reverse: true,
      });
    });
    expect(rows()).toEqual(["开幕|running|1|0"]);
    expect(api.cards[0]).toMatchObject({ id: launchedId, reverse: true, trajectoryMode: true, plcActive: true });
    report([running({ runTime: 300 })]);
    expect(rows()).toEqual(["开幕|running|3|300"]);
  });

  it("stops the card once the PLC no longer reports it, and leaves closing to the user", () => {
    report([running()]);
    act(() => vi.advanceTimersByTime(ACTION_RUN_STALE_MS + 200));
    expect(rows()).toEqual(["序列4|stopped|3|1000"]);
    act(() => vi.advanceTimersByTime(60_000));
    expect(rows()).toEqual(["序列4|stopped|3|1000"]);
    act(() => api.close(api.cards[0]!.id));
    expect(rows()).toEqual([]);
  });

  it("keeps the card running while reports keep arriving", () => {
    report([running()]);
    for (let step = 0; step < 5; step += 1) {
      act(() => vi.advanceTimersByTime(ACTION_RUN_STALE_MS - 100));
      report([running({ runTime: 2000 + step })]);
    }
    expect(rows()).toEqual(["序列4|running|3|2004"]);
  });

  it("stays stopping for as long as the PLC reports the action, however long it decelerates", () => {
    report([running()]);
    act(() => api.stop(api.cards[0]!.id));
    expect(stopSequenceMock).toHaveBeenCalledTimes(1);
    for (let step = 0; step < 100; step += 1) {
      act(() => vi.advanceTimersByTime(50));
      report([running({ runTime: 1100 + step })]);
    }
    expect(rows()).toEqual(["序列4|stopping|3|1199"]);
    act(() => vi.advanceTimersByTime(ACTION_RUN_STALE_MS + 200));
    expect(rows()).toEqual(["序列4|stopped|3|1199"]);
  });

  it("refuses close, resume and restart until the action has really stopped", () => {
    report([running()]);
    const id = api.cards[0]!.id;
    act(() => {
      api.close(id);
      api.resume(id);
      api.restart(id);
    });
    expect(rows()).toEqual(["序列4|running|3|1000"]);

    act(() => api.stop(id));
    report([running()]);
    act(() => {
      api.close(id);
      api.resume(id);
      api.restart(id);
    });
    expect(rows()).toEqual(["序列4|stopping|3|1000"]);

    act(() => vi.advanceTimersByTime(ACTION_RUN_STALE_MS + 200));
    expect(rows()).toEqual(["序列4|stopped|3|1000"]);
    act(() => api.close(id));
    expect(rows()).toEqual([]);
  });

  it("settles a locally launched card the PLC never reported shortly after stop", () => {
    act(() => {
      api.launch({
        kind: "sequence",
        name: "开幕",
        durationMs: null,
        source: { kind: "fader", slotIndex: 0 },
        sequenceId: 4,
        sequenceHandle: { actionId: 4, deviceId: [1] },
      });
    });
    act(() => api.stop(api.cards[0]!.id));
    expect(rows()).toEqual(["开幕|stopping|-|-"]);
    act(() => vi.advanceTimersByTime(ACTION_RUN_STALE_MS + 200));
    expect(rows()).toEqual(["开幕|stopped|-|-"]);
  });

  it("keeps an emergency-stopped card until the PLC goes silent", () => {
    report([running()]);
    const id = api.cards[0]!.id;
    act(() => api.emergencyStopAll());
    report([running()]);
    act(() => api.close(id));
    expect(rows()).toEqual(["序列4|error|3|1000"]);
    act(() => vi.advanceTimersByTime(ACTION_RUN_STALE_MS + 200));
    act(() => api.close(id));
    expect(rows()).toEqual([]);
  });

  it("does not change speed during the transition state or while stopping", () => {
    report([running({ state: 1 })]);
    act(() => api.setSpeed(api.cards[0]!.id, 150));
    expect(api.cards[0]!.speedPercent).toBe(100);
    report([running()]);
    act(() => api.setSpeed(api.cards[0]!.id, 150));
    expect(api.cards[0]!.speedPercent).toBe(150);
    act(() => api.stop(api.cards[0]!.id));
    act(() => api.setSpeed(api.cards[0]!.id, 60));
    expect(api.cards[0]!.speedPercent).toBe(150);
  });
});
