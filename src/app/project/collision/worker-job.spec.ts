import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkerJob } from "./worker-job";

afterEach(() => vi.useRealTimers());

describe("可恢复的 Worker 时间片", () => {
  it("暂停期间不执行任何一步，继续后从原步完成", async () => {
    vi.useFakeTimers();
    const job = new WorkerJob(1, 0);
    const visited: number[] = [];
    const scan = function* () {
      for (let i = 0; i < 8; i++) { visited.push(i); yield; }
      return 42;
    };
    const finished = job.run(scan());
    await vi.advanceTimersToNextTimerAsync();
    job.pause();
    const count = visited.length;
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(8);
    await vi.advanceTimersByTimeAsync(15000);
    expect(visited.length).toBe(count);
    expect(vi.getTimerCount()).toBe(0);
    job.resume();
    await vi.runAllTimersAsync();
    expect(await finished).toBe(42);
    expect(visited).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("挂起时取消会释放迭代器并禁止旧任务继续", async () => {
    vi.useFakeTimers();
    const job = new WorkerJob(1, 0);
    let cleanup = false;
    const steps = function* () {
      try { while (true) yield; } finally { cleanup = true; }
    };
    const result = job.run(steps()).catch(error => error);
    await vi.advanceTimersToNextTimerAsync();
    job.pause();
    job.cancel();
    job.resume();
    await vi.runAllTimersAsync();
    expect(await result).toBeInstanceOf(Error);
    expect(cleanup).toBe(true);
  });
});
