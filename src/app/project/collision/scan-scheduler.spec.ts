import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionSequenceConfig } from "../action-sequence/types";
import type { ProjectSetup } from "../project-document-types";
import { CollisionScanScheduler } from "./scan-scheduler";
import type { ScanControl, ScanRequest } from "./types";

const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../project-ipc", () => ({ getProjectAPI: () => ({ models: { read } }), unwrapResult: (value: unknown) => value }));
vi.mock("./snapshot", () => ({ snapshotCollisionObjects: () => [] }));

const sequence = { id: 1, blocks: [], segments: [] } as unknown as ActionSequenceConfig;
const file = { ext: "obj", data: new Uint8Array([1, 2]) };
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const deferredFile = () => {
  let finish!: (value: typeof file) => void;
  const pending = new Promise<typeof file>(resolve => { finish = resolve; });
  return { pending, finish: () => finish(file) };
};
const post = vi.fn<(message: ScanRequest | ScanControl) => void>();
const messages = () => post.mock.calls.map(([m]) => "type" in m ? m.type : "scan");
const schedulerFor = (...ids: string[]) => new CollisionScanScheduler(
  ids.map(modelId => ({ modelId })) as ProjectSetup["controlledObjects"], () => {},
);

beforeEach(() => {
  read.mockReset();
  post.mockReset();
  vi.stubGlobal("Worker", class { postMessage = post; terminate() {} });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("等待模型时的播放和草稿竞态", () => {
  it("无须等待时，同一轮发送任务并登记随后到达的暂停", async () => {
    const scheduler = schedulerFor();
    scheduler.request(sequence, new Map(), false);
    scheduler.suspend(true);
    await settle();
    expect(messages()).toEqual(["scan", "pause"]);
    expect(scheduler.state(sequence).status).toBe("paused");
  });

  it("最后一份资源在暂停中返回，恢复后的另一条微任务又暂停时，Worker 不会独自运行", async () => {
    const first = deferredFile();
    read.mockReturnValueOnce(first.pending);
    const scheduler = schedulerFor("frame.obj");
    scheduler.request(sequence, new Map(), false);
    await settle();
    scheduler.suspend(true);
    first.finish();
    await settle();
    expect(messages()).toEqual([]);
    scheduler.suspend(false);
    queueMicrotask(() => scheduler.suspend(true));
    await settle();
    expect(messages()).toEqual(["scan", "pause"]);
    scheduler.suspend(false);
    await settle();
    expect(messages().filter(type => type === "scan")).toHaveLength(1);
  });

  it("暂停和取消都不能从过期的检查结果启动下一次 IPC", async () => {
    for (const change of ["pause", "cancel"] as const) {
      const first = deferredFile(), second = deferredFile();
      const scheduler = schedulerFor("first.obj", "second.obj");
      const starts: string[] = [];
      read.mockImplementation(({ modelId }) => {
        starts.push(scheduler.state(sequence).status);
        return modelId === "first.obj" ? first.pending : second.pending;
      });
      scheduler.request(sequence, new Map(), false);
      await settle();
      scheduler.suspend(true);
      first.finish();
      await settle();
      scheduler.suspend(false);
      queueMicrotask(() => {
        if (change === "pause") scheduler.suspend(true);
        else scheduler.select(null);
      });
      await settle();
      expect(starts).toEqual(["running", "running"]);
      second.finish();
      await settle();
      expect(messages()).toEqual([]);
      if (change === "pause") {
        scheduler.suspend(false);
        await settle();
        expect(messages()).toEqual(["scan"]);
      }
      scheduler.dispose();
      post.mockClear();
    }
  });

  it("恢复后刚发送的草稿被替换，Worker 会收到匹配的取消消息", async () => {
    const first = deferredFile();
    read.mockReturnValueOnce(first.pending).mockResolvedValue(file);
    const scheduler = schedulerFor("frame.obj");
    scheduler.request(sequence, new Map(), false);
    await settle();
    scheduler.suspend(true);
    first.finish();
    await settle();
    scheduler.suspend(false);
    queueMicrotask(() => scheduler.select(null));
    await settle();
    expect(messages()).toEqual(["scan", "cancel"]);
    expect(scheduler.state(sequence).status).toBe("idle");
  });
});
