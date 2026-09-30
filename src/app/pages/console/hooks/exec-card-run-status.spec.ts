import { describe, expect, it } from "vitest";
import {
  ACTION_RUN_STALE_MS,
  ACTION_RUN_STATE,
  addLaunchedCard,
  applyActionRunReports,
  canCloseExecCard,
  fallbackActionCardSeed,
  isExecCardInTransition,
  parseActionRunReports,
  settleSilentCards,
  type ActionRunReport,
} from "./exec-card-run-status";
import type { ExecCard } from "./use-exec-cards";

const card = (overrides: Partial<ExecCard> = {}): ExecCard => ({
  id: "card",
  kind: "sequence",
  name: "开幕升降",
  source: { kind: "fader", slotIndex: 0 },
  durationMs: null,
  elapsedMs: 0,
  speedPercent: 100,
  status: "running",
  startedAt: 0,
  emergencyStopped: false,
  sequenceId: 4,
  sequenceHandle: { actionId: 4, deviceId: [1] },
  ...overrides,
});

const report = (overrides: Partial<ActionRunReport> = {}): ActionRunReport => ({
  actionId: 4,
  state: ACTION_RUN_STATE.running,
  loopCount: 1,
  loopCountSet: 3,
  runTimeMs: 12300,
  ...overrides,
});

const seed = fallbackActionCardSeed;

describe("parseActionRunReports", () => {
  it("reads the running actions of an ok frame", () => {
    expect(
      parseActionRunReports({
        success: true,
        data: [{ actionId: 4, state: 3, loopCount: 2, loopCountSet: 0, runTime: 500 }],
      }),
    ).toEqual([{ actionId: 4, state: 3, loopCount: 2, loopCountSet: 0, runTimeMs: 500 }]);
  });

  it("drops failed frames and items without an actionId or state", () => {
    expect(parseActionRunReports({ success: false, data: [{ actionId: 4, state: 3 }] })).toEqual([]);
    expect(parseActionRunReports({ success: true })).toEqual([]);
    expect(parseActionRunReports({ success: true, data: [{ state: 3 }, null, { actionId: 4 }] })).toEqual([]);
  });
});

describe("applyActionRunReports", () => {
  it("writes the PLC run data onto the matching card and marks it active", () => {
    const next = applyActionRunReports([card()], [report()], 1000, seed);
    expect(next).toHaveLength(1);
    expect(next?.[0]?.plcActive).toBe(true);
    expect(next?.[0]?.run).toEqual({
      state: 3,
      loopCount: 1,
      loopCountSet: 3,
      runTimeMs: 12300,
      reportedAt: 1000,
    });
  });

  it("puts a stopped card back to running when the PLC reports it again", () => {
    const next = applyActionRunReports([card({ status: "stopped" })], [report()], 1000, seed);
    expect(next?.[0]?.status).toBe("running");
  });

  it("keeps a stopping card stopping while the PLC still reports it", () => {
    const next = applyActionRunReports(
      [card({ status: "stopping", stopRequestedAt: 900 })],
      [report()],
      1000,
      seed,
    );
    expect(next?.[0]?.status).toBe("stopping");
    expect(next?.[0]?.run?.reportedAt).toBe(1000);
  });

  it("never revives an emergency-stopped card", () => {
    const next = applyActionRunReports(
      [card({ status: "error", emergencyStopped: true })],
      [report()],
      1000,
      seed,
    );
    expect(next?.[0]?.status).toBe("error");
    expect(next?.[0]?.plcActive).toBe(true);
  });

  it("adds a card for a running action that has none", () => {
    const next = applyActionRunReports([card()], [report({ actionId: 9 })], 1000, (actionId) => ({
      name: "追光",
      source: { kind: "fader", slotIndex: 2 },
      speedPercent: 80,
      sequenceId: actionId,
      sequenceHandle: { actionId, deviceId: [1, 2] },
      totalMs: 60000,
      reverse: true,
    }));
    expect(next).toHaveLength(2);
    expect(next?.[0]).toMatchObject({
      name: "追光",
      status: "running",
      plcActive: true,
      source: { kind: "fader", slotIndex: 2 },
      speedPercent: 80,
      sequenceId: 9,
      sequenceHandle: { actionId: 9, deviceId: [1, 2] },
      totalMs: 60000,
      reverse: true,
      run: { runTimeMs: 12300, reportedAt: 1000 },
    });
    expect(next?.[1]?.id).toBe("card");
  });
});

describe("addLaunchedCard", () => {
  const seeded = card({
    id: "card-action-4-abc",
    name: "序列4",
    source: { kind: "external" },
    startedAt: 900,
    plcActive: true,
    run: { state: 1, loopCount: 1, loopCountSet: 1, runTimeMs: 0, reportedAt: 950 },
  });
  const launched = card({
    id: "card-launched",
    name: "开幕升降",
    source: { kind: "fader", slotIndex: 3 },
    speedPercent: 60,
    trajectoryMode: true,
    reverse: true,
    totalMs: 60000,
    startedAt: 1000,
  });

  it("adds the launched card on top when the action has no card yet", () => {
    const other = card({ id: "other", sequenceId: 8, sequenceHandle: { actionId: 8 } });
    expect(addLaunchedCard([other], launched)).toEqual([launched, other]);
  });

  it("keeps a single card when the PLC reported the action before the GO reply", () => {
    const next = addLaunchedCard([seeded], launched);
    expect(next).toHaveLength(1);
    expect(next[0]).toEqual({
      ...launched,
      id: seeded.id,
      startedAt: seeded.startedAt,
      plcActive: true,
      run: seeded.run,
    });
  });

  it("does not merge cards that have no action id", () => {
    const anonymous = card({ id: "a", sequenceId: undefined, sequenceHandle: undefined });
    const another = card({ id: "b", sequenceId: undefined, sequenceHandle: undefined });
    expect(addLaunchedCard([anonymous], another)).toEqual([another, anonymous]);
  });
});

describe("settleSilentCards", () => {
  const reportedAt = 1000;
  const run = { state: 3, loopCount: 1, loopCountSet: 1, runTimeMs: 0, reportedAt };
  const silentAt = reportedAt + ACTION_RUN_STALE_MS + 1;

  it("stops a running card the PLC no longer reports, and keeps it in the list", () => {
    const next = settleSilentCards([card({ run, plcActive: true })], silentAt);
    expect(next).toHaveLength(1);
    expect(next?.[0]).toMatchObject({ status: "stopped", plcActive: false, run });
  });

  it("leaves a card alone while the PLC keeps reporting it", () => {
    const stopping = card({ run, plcActive: true, status: "stopping", stopRequestedAt: 0 });
    expect(settleSilentCards([card({ run, plcActive: true }), stopping], reportedAt + ACTION_RUN_STALE_MS)).toBeNull();
  });

  it("leaves a running card the PLC never reported", () => {
    expect(settleSilentCards([card()], reportedAt + 60_000)).toBeNull();
  });

  it("turns a stopping card into stopped only once the PLC goes silent", () => {
    const stopping = card({ run, plcActive: true, status: "stopping", stopRequestedAt: 500 });
    expect(settleSilentCards([stopping], silentAt)?.[0]).toMatchObject({
      status: "stopped",
      plcActive: false,
    });
  });

  it("waits for silence after the stop request when the PLC never reported the card", () => {
    const stopping = card({ status: "stopping", stopRequestedAt: 5000 });
    expect(settleSilentCards([stopping], 5000 + ACTION_RUN_STALE_MS)).toBeNull();
    expect(settleSilentCards([stopping], 5000 + ACTION_RUN_STALE_MS + 1)?.[0]?.status).toBe("stopped");
  });

  it("clears the active flag of an emergency-stopped card without changing its status", () => {
    const errored = card({ run, plcActive: true, status: "error", emergencyStopped: true });
    expect(settleSilentCards([errored], silentAt)?.[0]).toMatchObject({
      status: "error",
      plcActive: false,
    });
  });
});

describe("canCloseExecCard", () => {
  it("allows closing only after the action has really stopped", () => {
    expect(canCloseExecCard(card({ status: "running" }))).toBe(false);
    expect(canCloseExecCard(card({ status: "stopping" }))).toBe(false);
    expect(canCloseExecCard(card({ status: "error", emergencyStopped: true, plcActive: true }))).toBe(false);
    expect(canCloseExecCard(card({ status: "stopped" }))).toBe(true);
    expect(canCloseExecCard(card({ status: "error", emergencyStopped: true, plcActive: false }))).toBe(true);
    expect(canCloseExecCard(card({ status: "completed" }))).toBe(true);
  });
});

describe("isExecCardInTransition", () => {
  it("is true only while a running card reports the transition state", () => {
    const run = { state: ACTION_RUN_STATE.transition, loopCount: 1, loopCountSet: 1, runTimeMs: 0, reportedAt: 0 };
    expect(isExecCardInTransition(card({ run }))).toBe(true);
    expect(isExecCardInTransition(card({ run, status: "stopped" }))).toBe(false);
    expect(isExecCardInTransition(card({ run: { ...run, state: ACTION_RUN_STATE.running } }))).toBe(false);
    expect(isExecCardInTransition(card())).toBe(false);
  });
});
