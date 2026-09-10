import { describe, expect, it } from "vitest";
import {
  DISCONNECTED_MASTER_STATUS,
  parseMasterStatusAck,
  PlcMasterStatusStore,
  shouldClearPlcMasterStatus,
  type PlcMasterStatus,
} from "../shared/csocket/plc-master-status";

const plc = (
  overrides: Partial<PlcMasterStatus> & { deviceId: number },
): PlcMasterStatus => ({
  plcModel: 1,
  masterStatus: 1,
  simulationStatus: 0,
  busStatus: 0,
  ruleStartStatus: 0,
  ruleId: 0,
  autoRunStatus: 0,
  autoId: 0,
  ...overrides,
});

const ack = (data: unknown[]) => ({ success: true as const, data });

const enroll = (store: PlcMasterStatusStore, deviceId: number, connected = 0) =>
  store.ingestTcpConn(ack([{ deviceId, connected }]));

describe("shouldClearPlcMasterStatus", () => {
  it("clears on disconnected and reconnecting only", () => {
    expect(shouldClearPlcMasterStatus("disconnected")).toBe(true);
    expect(shouldClearPlcMasterStatus("reconnecting")).toBe(true);
    expect(shouldClearPlcMasterStatus("connected")).toBe(false);
    expect(shouldClearPlcMasterStatus("connecting")).toBe(false);
    expect(shouldClearPlcMasterStatus("idle")).toBe(false);
  });
});

describe("PlcMasterStatusStore", () => {
  it("does not emit Info|plc when the roster is empty", () => {
    const store = new PlcMasterStatusStore();
    expect(store.ingestPlc(ack([plc({ deviceId: 1 })]))).toBeNull();
  });

  it("drops Info|plc rows that are not in the tcpConn roster", () => {
    const store = new PlcMasterStatusStore();
    enroll(store, 1, 1);
    const frame = store.ingestPlc(
      ack([plc({ deviceId: 1, masterStatus: DISCONNECTED_MASTER_STATUS }), plc({ deviceId: 99 })]),
    );
    expect(frame?.map((item) => item.deviceId)).toEqual([1]);
  });

  it("dedupes identical Info|plc fields", () => {
    const store = new PlcMasterStatusStore();
    enroll(store, 1);
    const first = plc({ deviceId: 1 });
    expect(store.ingestPlc(ack([first]))).toEqual([first]);
    expect(store.ingestPlc(ack([first]))).toBeNull();
  });

  it("emits when masterStatus or plcModel changes", () => {
    const store = new PlcMasterStatusStore();
    enroll(store, 1);
    store.ingestPlc(ack([plc({ deviceId: 1 })]));
    const next = plc({ deviceId: 1, masterStatus: 2, plcModel: 4 });
    expect(store.ingestPlc(ack([next]))).toEqual([next]);
  });

  it("emits immediately on tcpConn disconnect with a stub when unseen", () => {
    const store = new PlcMasterStatusStore();
    const frame = store.ingestTcpConn(ack([{ deviceId: 7, connected: 1 }]));
    expect(frame).toEqual([
      plc({
        deviceId: 7,
        plcModel: 0,
        masterStatus: DISCONNECTED_MASTER_STATUS,
      }),
    ]);
  });

  it("overlays Info|plc running status to -1 while disconnected and then dedupes", () => {
    const store = new PlcMasterStatusStore();
    store.ingestTcpConn(ack([{ deviceId: 1, connected: 2 }]));
    const runningSameStubFields = plc({
      deviceId: 1,
      plcModel: 0,
      masterStatus: 1,
    });
    expect(store.ingestPlc(ack([runningSameStubFields]))).toBeNull();
  });

  it("emits when other fields change while disconnected", () => {
    const store = new PlcMasterStatusStore();
    store.ingestTcpConn(ack([{ deviceId: 1, connected: 1 }]));
    const next = plc({ deviceId: 1, masterStatus: 1, simulationStatus: 1 });
    expect(store.ingestPlc(ack([next]))).toEqual([
      { ...next, masterStatus: DISCONNECTED_MASTER_STATUS },
    ]);
  });

  it("does not emit on tcpConn reconnect; next Info|plc restores real masterStatus", () => {
    const store = new PlcMasterStatusStore();
    store.ingestTcpConn(ack([{ deviceId: 1, connected: 1 }]));
    expect(store.ingestTcpConn(ack([{ deviceId: 1, connected: 0 }]))).toBeNull();
    const live = plc({ deviceId: 1, masterStatus: 1 });
    expect(store.ingestPlc(ack([live]))).toEqual([live]);
  });

  it("emits again after clear even if payload is unchanged", () => {
    const store = new PlcMasterStatusStore();
    enroll(store, 1);
    const first = plc({ deviceId: 1 });
    store.ingestPlc(ack([first]));
    store.clear();
    expect(store.ingestPlc(ack([first]))).toBeNull();
    enroll(store, 1);
    expect(store.ingestPlc(ack([first]))).toEqual([first]);
  });

  it("ignores failed acks and non-finite deviceId items", () => {
    const store = new PlcMasterStatusStore();
    expect(store.ingestTcpConn({ success: false, data: [{ deviceId: 1, connected: 1 }] })).toBeNull();
    expect(store.ingestTcpConn(ack([{ deviceId: Number.NaN, connected: 1 }]))).toBeNull();
    enroll(store, 1);
    expect(store.ingestPlc({ success: false, data: [plc({ deviceId: 1 })] })).toBeNull();
    expect(store.ingestPlc(ack(["nope", plc({ deviceId: 1 })]))).toEqual([plc({ deviceId: 1 })]);
  });

  it("keeps roster order from first tcpConn appearance", () => {
    const store = new PlcMasterStatusStore();
    store.ingestTcpConn(
      ack([
        { deviceId: 2, connected: 1 },
        { deviceId: 1, connected: 1 },
      ]),
    );
    expect(store.snapshot().map((item) => item.deviceId)).toEqual([2, 1]);
  });
});

describe("parseMasterStatusAck", () => {
  it("returns empty array for successful empty data", () => {
    expect(parseMasterStatusAck({ success: true, data: [] })).toEqual([]);
  });

  it("returns null when success is not true or data is not an array", () => {
    expect(parseMasterStatusAck({ success: false, data: [] })).toBeNull();
    expect(parseMasterStatusAck({ success: true, data: {} })).toBeNull();
    expect(parseMasterStatusAck(null)).toBeNull();
  });

  it("keeps valid items and drops illegal ones", () => {
    const parsed = parseMasterStatusAck({
      success: true,
      data: [
        null,
        { deviceId: 1, masterStatus: 1, simulationStatus: 1 },
        { deviceId: "x", masterStatus: 1 },
      ],
    });
    expect(parsed).toHaveLength(1);
    expect(parsed?.[0]?.deviceId).toBe(1);
    expect(parsed?.[0]?.masterStatus).toBe(1);
    expect(parsed?.[0]?.simulationStatus).toBe(1);
  });
});
