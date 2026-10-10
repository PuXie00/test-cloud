import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiStatusDelta } from "../shared/ai-bridge/types";
import { AiStatusForwarder } from "../electron/main/ai-bridge/status-forwarder";

const plc = (deviceId: number, masterStatus = 1) => ({
  deviceId,
  plcModel: 0,
  masterStatus,
  simulationStatus: 0,
  busStatus: 1,
  ruleStartStatus: 0,
  ruleId: 0,
  autoRunStatus: 0,
  autoId: 0,
});

const act = (actionId: number, runTime: number) => ({
  success: true,
  data: [{ actionId, state: 3, loopCount: 1, loopCountSet: 0, runTime }],
});

describe("AiStatusForwarder", () => {
  let now = 0;
  let sent: AiStatusDelta[] = [];
  let forwarder: AiStatusForwarder;

  beforeEach(() => {
    vi.useFakeTimers();
    now = 0;
    sent = [];
    forwarder = new AiStatusForwarder((delta) => sent.push(delta), {
      flushMs: 100,
      actionStaleMs: 1000,
      now: () => now,
    });
  });

  afterEach(() => {
    forwarder.dispose();
    vi.useRealTimers();
  });

  it("coalesces bursts into one delta carrying only the latest item per device", () => {
    forwarder.upsertObjects([{ deviceId: 21, modelStatus: 17, virtualAxisHPosition: 10 }]);
    forwarder.upsertObjects([{ deviceId: 21, modelStatus: 17, virtualAxisHPosition: 20 }]);
    forwarder.upsertMotors([{ deviceId: 11, axisStatus: 3 }]);
    forwarder.setConnection("connected");
    expect(sent).toHaveLength(0);

    vi.advanceTimersByTime(100);
    expect(sent).toEqual([
      {
        connection: "connected",
        upsert: {
          objects: [{ deviceId: 21, modelStatus: 17, virtualAxisHPosition: 20 }],
          motors: [{ deviceId: 11, axisStatus: 3 }],
        },
      },
    ]);

    vi.advanceTimersByTime(500);
    expect(sent).toHaveLength(1);
  });

  it("sends PLC snapshots as a whole replacement and skips unchanged connection state", () => {
    forwarder.setConnection("idle");
    forwarder.setPlcs([plc(1), plc(2)]);
    vi.advanceTimersByTime(100);
    expect(sent).toEqual([{ upsert: { plcs: [plc(1), plc(2)] } }]);
  });

  it("orders a clear before upserts that arrive in the same window", () => {
    forwarder.upsertMotors([{ deviceId: 11, axisStatus: 3 }]);
    forwarder.clear("motors");
    forwarder.upsertMotors([{ deviceId: 12, axisStatus: 2 }]);
    vi.advanceTimersByTime(100);
    expect(sent).toEqual([
      { clear: ["motors"], upsert: { motors: [{ deviceId: 12, axisStatus: 2 }] } },
    ]);
  });

  it("drops an action once the PLC stops reporting it", () => {
    forwarder.ingestActions(act(5, 10));
    vi.advanceTimersByTime(100);
    expect(sent[0].upsert?.actions).toEqual([
      { actionId: 5, state: 3, loopCount: 1, loopCountSet: 0, runTime: 10 },
    ]);

    // 不再上报：过期检查继续跑，超过 1000ms 后移除
    now = 1001;
    vi.advanceTimersByTime(1000);
    expect(sent.at(-1)).toEqual({ remove: { actions: [5] } });

    const count = sent.length;
    vi.advanceTimersByTime(2000);
    expect(sent).toHaveLength(count);
  });

  it("ignores malformed action reports", () => {
    forwarder.ingestActions({ success: false, data: [{ actionId: 1, state: 3 }] });
    forwarder.ingestActions({ success: true, data: [{ actionId: "x", state: 3 }] });
    vi.advanceTimersByTime(100);
    expect(sent).toHaveLength(0);
  });

  it("snapshot() carries the full mirror for a restarted child", () => {
    forwarder.setConnection("connected");
    forwarder.setPlcs([plc(1)]);
    forwarder.upsertObjects([{ deviceId: 21, modelStatus: 16 }]);
    forwarder.upsertMotors([{ deviceId: 11, axisStatus: 2 }]);
    forwarder.ingestActions(act(5, 10));

    expect(forwarder.snapshot()).toEqual({
      reset: true,
      connection: "connected",
      upsert: {
        plcs: [plc(1)],
        objects: [{ deviceId: 21, modelStatus: 16 }],
        motors: [{ deviceId: 11, axisStatus: 2 }],
        actions: [{ actionId: 5, state: 3, loopCount: 1, loopCountSet: 0, runTime: 10 }],
      },
    });
  });
});
