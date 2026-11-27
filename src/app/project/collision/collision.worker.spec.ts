import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScanControl, ScanRequest } from "./types";

const { progress, prepared } = vi.hoisted(() => ({ progress: [] as number[], prepared: vi.fn() }));
vi.mock("./geometry", () => ({
  prepareCollisionShape: async () => { prepared(); return { box: true }; },
}));
vi.mock("./scan", () => ({
  CollisionScanCache: class { clear() {} },
  scanCollisionSteps: function* () {
    for (let i = 0; i < 10; i++) { progress.push(i); yield; }
    return { events: [], incomplete: [] };
  },
}));

const port = { postMessage: vi.fn(), onmessage: null as unknown as (e: { data: ScanControl | ScanRequest }) => void };
const start = (jobId: number) => port.onmessage({ data: {
  jobId, full: false, assets: new Map(), input: { sequence: {}, objects: [{ id: 1, config: {} }] },
} as ScanRequest });
const control = (jobId: number, type: ScanControl["type"]) => port.onmessage({ data: { jobId, type } });

beforeEach(async () => {
  vi.useFakeTimers();
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now += 10);
  vi.stubGlobal("self", port);
  prepared.mockClear();
  port.postMessage.mockClear();
  progress.length = 0;
  vi.resetModules();
  await import("./collision.worker");
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("校验 Worker 消息协议", () => {
  it("长扫描接受暂停，恢复同一任务，保留几何和扫描位置", async () => {
    start(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.length).toBeLessThan(10);
    control(1, "pause");
    const steps = progress.slice();
    control(2, "resume");
    await vi.advanceTimersByTimeAsync(15000);
    expect(progress).toEqual(steps);
    expect(vi.getTimerCount()).toBe(0);
    expect(port.postMessage).not.toHaveBeenCalled();
    control(1, "resume");
    await vi.runAllTimersAsync();
    expect(progress).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ jobId: 1, ok: true }));
    expect(prepared).toHaveBeenCalledTimes(1);
  });

  it("新草稿替换挂起任务，仅返回新任务结果并复用已准备的几何", async () => {
    start(1);
    await vi.advanceTimersByTimeAsync(2);
    control(1, "pause");
    const before = progress.length;
    start(2);
    control(1, "resume");
    control(1, "cancel");
    await vi.runAllTimersAsync();
    expect(progress.length).toBe(before + 10);
    expect(prepared).toHaveBeenCalledTimes(1);
    expect(port.postMessage.mock.calls.map(([result]) => result.jobId)).toEqual([2]);
  });
});
