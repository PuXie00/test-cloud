import { describe, expect, it, vi } from "vitest";
import { AXIS_INFO_STALE_MS, AxisInfoStore } from "../shared/csocket/axis-info";

const ack = (data: unknown[]) => ({ success: true as const, data });

const full = {
  deviceId: 1,
  axisStatus: 2,
  actualPosition: 10,
  actualSpeed: 1,
  actualLoadRate: 2,
  actualTemperature: 3,
  actualTorque: 4,
  actualWeight: 5,
  driveAlarmCode: 0,
};

describe("AxisInfoStore", () => {
  it("dedupes identical fixed-column frames", () => {
    const store = new AxisInfoStore();
    expect(store.ingest(ack([full]))).toEqual([full]);
    expect(store.ingest(ack([full]))).toBeNull();
  });

  it("emits when a fixed column changes", () => {
    const store = new AxisInfoStore();
    store.ingest(ack([full]));
    const next = { ...full, actualSpeed: 9 };
    expect(store.ingest(ack([next]))).toEqual([next]);
  });

  it("does not emit a partial frame whose present keys match the overlay", () => {
    const store = new AxisInfoStore();
    expect(store.ingest(ack([{ deviceId: 1, axisStatus: 2 }]))).toEqual([
      { deviceId: 1, axisStatus: 2 },
    ]);
    expect(store.ingest(ack([{ deviceId: 1, axisStatus: 2 }]))).toBeNull();
  });

  it("emits when a previously missing key appears", () => {
    const store = new AxisInfoStore();
    store.ingest(ack([{ deviceId: 1, axisStatus: 2 }]));
    expect(store.ingest(ack([{ deviceId: 1, actualPosition: 10 }]))).toEqual([
      { deviceId: 1, axisStatus: 2, actualPosition: 10 },
    ]);
  });

  it("emits when an extras key appears or its value changes", () => {
    const store = new AxisInfoStore();
    store.ingest(ack([full]));
    const withExtra = { ...full, customLoad: 8 };
    expect(store.ingest(ack([withExtra]))).toEqual([withExtra]);
    expect(store.ingest(ack([{ ...withExtra, customLoad: 9 }]))).toEqual([
      { ...withExtra, customLoad: 9 },
    ]);
  });

  it("does not emit when only a non-number key changes", () => {
    const store = new AxisInfoStore();
    store.ingest(ack([{ ...full, note: "a" }]));
    expect(store.ingest(ack([{ ...full, note: "b" }]))).toBeNull();
  });

  it("does not overlay NaN or Infinity", () => {
    const store = new AxisInfoStore();
    store.ingest(ack([full]));
    expect(
      store.ingest(ack([{ ...full, actualPosition: Number.NaN, actualSpeed: Number.POSITIVE_INFINITY }])),
    ).toBeNull();
  });

  it("ignores failed ACK and non-array data", () => {
    const store = new AxisInfoStore();
    expect(store.ingest({ success: false, data: [full] })).toBeNull();
    expect(store.ingest({ success: true, data: { deviceId: 1 } })).toBeNull();
  });

  it("drops illegal items and still compares legal ones", () => {
    const store = new AxisInfoStore();
    expect(
      store.ingest(ack([null, { axisStatus: 2 }, { deviceId: 1, axisStatus: 2 }])),
    ).toEqual([{ deviceId: 1, axisStatus: 2 }]);
  });

  it("does not emit when the same deviceId reverts within the frame", () => {
    const store = new AxisInfoStore();
    store.ingest(ack([{ deviceId: 1, axisStatus: 2, actualSpeed: 1 }]));
    expect(
      store.ingest(
        ack([
          { deviceId: 1, actualSpeed: 9 },
          { deviceId: 1, actualSpeed: 1 },
        ]),
      ),
    ).toBeNull();
  });

  it("emits the same payload again after clear", () => {
    const store = new AxisInfoStore();
    store.ingest(ack([full]));
    store.clear();
    expect(store.ingest(ack([full]))).toEqual([full]);
  });

  it("calls onStale and forgets overlay after 3s without a new frame", () => {
    vi.useFakeTimers();
    const onStale = vi.fn();
    const store = new AxisInfoStore(onStale);
    store.ingest(ack([full]));
    vi.advanceTimersByTime(AXIS_INFO_STALE_MS - 1);
    expect(onStale).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(store.ingest(ack([full]))).toEqual([full]);
    vi.useRealTimers();
  });
});
