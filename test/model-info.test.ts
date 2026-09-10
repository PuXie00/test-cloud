import { describe, expect, it, vi } from "vitest";
import { MODEL_INFO_STALE_MS, ModelInfoStore } from "../shared/csocket/model-info";

const ack = (data: unknown[]) => ({ success: true as const, data });

const full = {
  deviceId: 1,
  modelStatus: 3,
  virtualAxisHPosition: 1,
  virtualAxisPPosition: 2,
  virtualAxisYPosition: 3,
};

describe("ModelInfoStore", () => {
  it("dedupes identical four-key frames", () => {
    const store = new ModelInfoStore();
    expect(store.ingest(ack([full]))).toEqual([full]);
    expect(store.ingest(ack([full]))).toBeNull();
  });

  it("emits when modelStatus or a virtual-axis position changes", () => {
    const store = new ModelInfoStore();
    store.ingest(ack([full]));
    const next = { ...full, modelStatus: 17, virtualAxisHPosition: 10 };
    expect(store.ingest(ack([next]))).toEqual([next]);
  });

  it("does not emit a partial frame whose present keys match the overlay", () => {
    const store = new ModelInfoStore();
    expect(store.ingest(ack([{ deviceId: 1, modelStatus: 3 }]))).toEqual([
      { deviceId: 1, modelStatus: 3 },
    ]);
    expect(store.ingest(ack([{ deviceId: 1, modelStatus: 3 }]))).toBeNull();
  });

  it("emits when a previously missing key appears", () => {
    const store = new ModelInfoStore();
    store.ingest(ack([{ deviceId: 1, modelStatus: 3 }]));
    expect(store.ingest(ack([{ deviceId: 1, virtualAxisHPosition: 10 }]))).toEqual([
      { deviceId: 1, modelStatus: 3, virtualAxisHPosition: 10 },
    ]);
  });

  it("ignores failed ACK and non-array data", () => {
    const store = new ModelInfoStore();
    expect(store.ingest({ success: false, data: [full] })).toBeNull();
    expect(store.ingest({ success: true, data: { deviceId: 1 } })).toBeNull();
  });

  it("drops illegal items and still compares legal ones", () => {
    const store = new ModelInfoStore();
    expect(
      store.ingest(ack([null, { modelStatus: 3 }, { deviceId: 1, modelStatus: 3 }])),
    ).toEqual([{ deviceId: 1, modelStatus: 3 }]);
  });

  it("does not emit when the same deviceId reverts within the frame", () => {
    const store = new ModelInfoStore();
    store.ingest(ack([{ deviceId: 1, modelStatus: 3, virtualAxisHPosition: 10 }]));
    expect(
      store.ingest(
        ack([
          { deviceId: 1, virtualAxisHPosition: 99 },
          { deviceId: 1, virtualAxisHPosition: 10 },
        ]),
      ),
    ).toBeNull();
  });

  it("emits the same payload again after clear", () => {
    const store = new ModelInfoStore();
    store.ingest(ack([full]));
    store.clear();
    expect(store.ingest(ack([full]))).toEqual([full]);
  });

  it("does not treat model extras as overlay keys", () => {
    const store = new ModelInfoStore();
    store.ingest(ack([{ deviceId: 1, modelStatus: 3, foo: 1 }]));
    expect(store.ingest(ack([{ deviceId: 1, modelStatus: 3, foo: 2 }]))).toBeNull();
  });

  it("calls onStale and forgets overlay after 3s without a new frame", () => {
    vi.useFakeTimers();
    const onStale = vi.fn();
    const store = new ModelInfoStore(onStale);
    store.ingest(ack([full]));
    vi.advanceTimersByTime(MODEL_INFO_STALE_MS - 1);
    expect(onStale).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(store.ingest(ack([full]))).toEqual([full]);
    vi.useRealTimers();
  });
});
