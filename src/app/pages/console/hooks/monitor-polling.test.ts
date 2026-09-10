import { describe, expect, it } from "vitest";
import {
  buildMotorSnapshots,
  buildObjectSnapshots,
  ingestPollingFrame,
  pruneLiveMap,
  type AxisInfoPollingItem,
  type ModelInfoPollingItem,
} from "./monitor-polling";

describe("pruneLiveMap", () => {
  it("removes ids not in knownIds", () => {
    const map = new Map([[1, { deviceId: 1, modelStatus: 3 }]]);
    const pruned = pruneLiveMap(map, new Set([2]));
    expect(pruned.has(1)).toBe(false);
    expect(pruned.size).toBe(0);
  });
});

describe("ingestPollingFrame", () => {
  const known = new Set([1, 2]);

  it("merges only known deviceIds", () => {
    const next = ingestPollingFrame<ModelInfoPollingItem>(
      new Map(),
      {
        success: true,
        data: [
          { deviceId: 1, modelStatus: 3, virtualAxisHPosition: 10, virtualAxisPPosition: 1, virtualAxisYPosition: 2 },
          { deviceId: 99, modelStatus: 3, virtualAxisHPosition: 0, virtualAxisPPosition: 0, virtualAxisYPosition: 0 },
        ],
      },
      known,
    );
    expect(next.size).toBe(1);
    expect(next.get(1)?.virtualAxisHPosition).toBe(10);
    expect(next.has(99)).toBe(false);
  });

  it("ignores failed frames", () => {
    const prev = new Map<number, ModelInfoPollingItem>([
      [1, { deviceId: 1, modelStatus: 2, virtualAxisHPosition: 5, virtualAxisPPosition: 0, virtualAxisYPosition: 0 }],
    ]);
    const next = ingestPollingFrame(prev, { success: false, data: [{ deviceId: 1, modelStatus: 1, virtualAxisHPosition: 0, virtualAxisPPosition: 0, virtualAxisYPosition: 0 }] }, known);
    expect(next.get(1)?.modelStatus).toBe(2);
  });

  it("keeps previous fields when omitted", () => {
    const prev = new Map<number, AxisInfoPollingItem>([
      [1, { deviceId: 1, axisStatus: 2, actualPosition: 1, actualSpeed: 2, actualLoadRate: 3, actualTemperature: 4, actualTorque: 5, actualWeight: 6, driveAlarmCode: 0 }],
    ]);
    const next = ingestPollingFrame(
      prev,
      { success: true, data: [{ deviceId: 1, axisStatus: 3, actualSpeed: 9 }] },
      known,
    );
    expect(next.get(1)?.axisStatus).toBe(3);
    expect(next.get(1)?.actualPosition).toBe(1);
    expect(next.get(1)?.actualSpeed).toBe(9);
  });

  it("same-frame later item wins", () => {
    const next = ingestPollingFrame<ModelInfoPollingItem>(
      new Map(),
      {
        success: true,
        data: [
          { deviceId: 1, modelStatus: 2, virtualAxisHPosition: 1, virtualAxisPPosition: 0, virtualAxisYPosition: 0 },
          { deviceId: 1, modelStatus: 3, virtualAxisHPosition: 8, virtualAxisPPosition: 0, virtualAxisYPosition: 0 },
        ],
      },
      known,
    );
    expect(next.get(1)?.modelStatus).toBe(3);
    expect(next.get(1)?.virtualAxisHPosition).toBe(8);
  });

  it("prunes stale ids after ingest when knownIds no longer includes them", () => {
    const msg1 = { success: true as const, data: [{ deviceId: 1, modelStatus: 3 }] };
    let map = ingestPollingFrame(new Map(), msg1, new Set([1]));
    expect(map.has(1)).toBe(true);

    const msg2 = { success: true as const, data: [] };
    map = ingestPollingFrame(map, msg2, new Set([2]));
    expect(map.has(1)).toBe(false);
  });

  it("clears all live items on an empty success frame", () => {
    const prev = new Map<number, ModelInfoPollingItem>([
      [1, { deviceId: 1, modelStatus: 3 }],
    ]);
    const next = ingestPollingFrame(prev, { success: true, data: [] }, new Set([1]));
    expect(next.size).toBe(0);
  });
});

describe("buildObjectSnapshots", () => {
  it("object: one live one offline, unknown id ignored", () => {
    const objects = [
      { id: 1, name: "A", controlType: "singlePointMove" },
      { id: 2, name: "B", controlType: "singlePointMove" },
    ];
    const live = new Map<number, ModelInfoPollingItem>([
      [1, { deviceId: 1, modelStatus: 17, virtualAxisHPosition: 100, virtualAxisPPosition: 2, virtualAxisYPosition: 3 }],
      [9, { deviceId: 9, modelStatus: 3, virtualAxisHPosition: 1, virtualAxisPPosition: 0, virtualAxisYPosition: 0 }],
    ]);
    const rows = buildObjectSnapshots(objects as never, live);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.live).toBe(true);
    expect(rows[0]?.descriptor.status).toBe("running");
    expect(rows[0]?.modelStatus).toBe(17);
    expect(rows[0]?.positions).toEqual({ h: 100, p: 2, y: 3 });
    expect(rows[0]?.values.height).toBe(100);
    expect(rows[1]?.live).toBe(false);
    expect(rows[1]?.descriptor.status).toBe("offline");
    expect(rows[1]?.modelStatus).toBeNull();
    expect(rows[1]?.positions).toBeNull();
  });
});

describe("buildMotorSnapshots", () => {
  it("motor: alarm code overrides display status; filter keeps axisStatus", () => {
    const motors = [{ id: 1, productModel: "YZ_AXIS_HOIST_500KG", plcId: 1, busNo: 0 }];
    const live = new Map<number, AxisInfoPollingItem>([
      [1, { deviceId: 1, axisStatus: 2, actualPosition: 10, actualSpeed: 1, actualLoadRate: 2, actualTemperature: 3, actualTorque: 4, actualWeight: 5, driveAlarmCode: 7 }],
    ]);
    const rows = buildMotorSnapshots(motors as never, live);
    expect(rows[0]?.status).toBe("alarm");
    expect(rows[0]?.axisStatus).toBe(2);
    expect(rows[0]?.driveAlarmCode).toBe(7);
    expect(rows[0]?.live).toBe(true);
  });

  it("motor unlive stays offline with null telemetry", () => {
    const rows = buildMotorSnapshots([{ id: 2, productModel: "X", plcId: 1, busNo: 0 }] as never, new Map());
    expect(rows[0]?.live).toBe(false);
    expect(rows[0]?.status).toBe("offline");
    expect(rows[0]?.actualPosition).toBeNull();
    expect(rows[0]?.axisStatus).toBeNull();
  });
});

describe("buildMotorSnapshots 4-code axisStatus", () => {
  it("maps axisStatus 3 to running when no alarm code", () => {
    const motors = [{ id: 1, productModel: "YZ_AXIS_HOIST_500KG", plcId: 1, busNo: 0 }];
    const live = new Map<number, AxisInfoPollingItem>([
      [1, { deviceId: 1, axisStatus: 3, actualPosition: 10, actualSpeed: 1, actualLoadRate: 2, actualTemperature: 3, actualTorque: 4, actualWeight: 5, driveAlarmCode: 0 }],
    ]);
    const rows = buildMotorSnapshots(motors as never, live);
    expect(rows[0]?.status).toBe("running");
    expect(rows[0]?.axisStatus).toBe(3);
  });

  it("maps axisStatus 2 to ready (静止)", () => {
    const motors = [{ id: 1, productModel: "X", plcId: 1, busNo: 0 }];
    const live = new Map<number, AxisInfoPollingItem>([
      [1, { deviceId: 1, axisStatus: 2, driveAlarmCode: 0 }],
    ]);
    const rows = buildMotorSnapshots(motors as never, live);
    expect(rows[0]?.status).toBe("ready");
    expect(rows[0]?.axisStatus).toBe(2);
  });
});
