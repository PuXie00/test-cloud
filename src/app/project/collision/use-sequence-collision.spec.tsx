// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionSequenceConfig, ModelPose } from "../action-sequence/types";
import type { ProjectSetup } from "../project-document-types";
import { useSequenceCollision } from "./use-sequence-collision";
import type { CollisionSaveBatch, ScanControl, ScanReply, ScanRequest } from "./types";

class TestWorker {
  static instances: TestWorker[] = [];
  onmessage?: (event: { data: ScanReply }) => void;
  postMessage = vi.fn<(request: ScanRequest | ScanControl) => void>();
  terminate = vi.fn();
  constructor() { TestWorker.instances.push(this); }
  requests() {
    return this.postMessage.mock.calls.map(([m]) => m).filter((m): m is ScanRequest => "input" in m);
  }
  finish(request = this.requests().at(-1)!) {
    this.onmessage?.({ data: { jobId: request.jobId, ok: true,
      report: { events: [], incomplete: [] }, cachedAssets: [] } });
  }
}
const first = { id: 1, blocks: [], segments: [] } as unknown as ActionSequenceConfig;
const setup = { controlledObjects: [] } as unknown as ProjectSetup;
const emptyPoses = () => new Map<number, Partial<ModelPose>>();
const defaults = { draft: first as ActionSequenceConfig | null, project: "stage", paused: false,
  saved: null as CollisionSaveBatch | null, read: emptyPoses };
const render = (initial = defaults) => renderHook(
  ({ draft, project, paused, saved, read }) => useSequenceCollision(draft, setup, project, paused, read, saved),
  { initialProps: initial },
);
const save = (...sequences: ActionSequenceConfig[]): CollisionSaveBatch => ({ projectKey: "stage", sequences });
const flush = () => act(() => vi.advanceTimersByTimeAsync(1100));

describe("editor collision checks", () => {
  beforeEach(() => { vi.useFakeTimers(); TestWorker.instances = []; vi.stubGlobal("Worker", TestWorker); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("edits and initial selection stay silent; checking a draft uses its current contents", async () => {
    const view = render();
    const draft = { ...first, name: "未保存" };
    view.rerender({ ...defaults, draft });
    await flush();
    expect(view.result.current.status).toBe("idle");
    expect(TestWorker.instances).toHaveLength(0);
    act(() => view.result.current.runFull());
    await flush();
    const worker = TestWorker.instances[0];
    const [request] = worker.requests();
    expect(request.input.sequence).toBe(draft);
    expect(request.full).toBe(true);
    act(() => worker.finish());
    expect(view.result.current.status).toBe("ready");
    view.rerender({ ...defaults, draft: { ...draft, name: "再编辑" } });
    await flush();
    expect(view.result.current.status).toBe("idle");
    expect(view.result.current.report).toBeNull();
    expect(worker.requests()).toHaveLength(1);
  });

  it("checks each saved sequence in order even if the editor is closed", async () => {
    const second = { ...first, id: 2 };
    const saved = save(first, second);
    const view = render({ ...defaults, draft: null });
    view.rerender({ ...defaults, draft: null, saved });
    await flush();
    const worker = TestWorker.instances[0];
    expect(worker.requests().map(r => r.input.sequence.id)).toEqual([1]);
    act(() => worker.finish());
    await flush();
    expect(worker.requests().map(r => r.input.sequence.id)).toEqual([1, 2]);
    act(() => worker.finish());
    view.rerender({ ...defaults, draft: second, saved });
    expect(view.result.current.status).toBe("ready");
    await flush();
    expect(worker.requests()).toHaveLength(2);
  });

  it("reuses a checked draft at save only while its baseline poses also match", async () => {
    const view = render();
    act(() => view.result.current.runFull());
    await flush();
    const worker = TestWorker.instances[0];
    act(() => worker.finish());
    view.rerender({ ...defaults, saved: save(first) });
    await flush();
    expect(worker.requests()).toHaveLength(1);
    view.rerender({ ...defaults, saved: save(first), read: () => new Map([[1, { v1: 12 }]]) });
    await flush();
    expect(worker.requests()).toHaveLength(2);
  });

  it("keeps the saved version's scan when a newer draft is checked by hand", async () => {
    const saved = save(first);
    const view = render({ ...defaults, saved });
    await flush();
    const worker = TestWorker.instances[0];
    const draft = { ...first, name: "尚未保存" };
    view.rerender({ ...defaults, saved, draft });
    act(() => view.result.current.runFull());
    await flush();
    expect(worker.requests()).toHaveLength(1);
    expect(view.result.current.status).toBe("queued");
    act(() => worker.finish());
    await flush();
    expect(worker.requests().map(job => job.input.sequence)).toEqual([first, draft]);
    act(() => worker.finish());
    view.rerender({ ...defaults, saved });
    expect(view.result.current.status).toBe("ready");
  });

  it("defers a request during playback, then pauses and resumes that same active job", async () => {
    const saved = save(first);
    const view = render({ ...defaults, paused: true, saved });
    await flush();
    expect(view.result.current.status).toBe("paused");
    expect(TestWorker.instances).toHaveLength(0);
    view.rerender({ ...defaults, saved });
    await flush();
    const worker = TestWorker.instances[0];
    const [job] = worker.requests();
    view.rerender({ ...defaults, saved, paused: true });
    expect(worker.postMessage).toHaveBeenCalledWith({ type: "pause", jobId: job.jobId });
    expect(view.result.current.status).toBe("paused");
    view.rerender({ ...defaults, saved });
    expect(worker.postMessage).toHaveBeenCalledWith({ type: "resume", jobId: job.jobId });
    await flush();
    expect(worker.requests()).toHaveLength(1);
    act(() => worker.finish());
    expect(view.result.current.status).toBe("ready");
  });

  it("discards replies to obsolete drafts and isolates project geometry and reports", async () => {
    const view = render();
    act(() => view.result.current.runFull());
    await flush();
    const worker = TestWorker.instances[0];
    const [old] = worker.requests();
    const next = { ...first, name: "第二稿" };
    view.rerender({ ...defaults, draft: next });
    act(() => view.result.current.runFull());
    await flush();
    act(() => worker.finish(old));
    expect(view.result.current.status).toBe("running");
    act(() => worker.finish());
    expect(view.result.current.status).toBe("ready");
    view.rerender({ ...defaults, project: "another" });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(view.result.current.report).toBeNull();
  });
});
