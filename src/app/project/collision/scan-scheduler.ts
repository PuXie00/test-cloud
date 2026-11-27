import type { ActionSequenceConfig, ModelPose } from "../action-sequence/types";
import type { ProjectSetup } from "../project-document-types";
import { getProjectAPI, unwrapResult } from "../project-ipc";
import { snapshotCollisionObjects } from "./snapshot";
import type { CollisionAsset, CollisionReport, ScanReply, ScanRequest } from "./types";

type Poses = ReadonlyMap<number, Partial<ModelPose>>;
export type ScanState = {
  status: "idle" | "queued" | "running" | "paused" | "ready" | "failed";
  report: CollisionReport | null;
  error: string | null;
  basePoses: Poses | null;
};
export const IDLE: ScanState = { status: "idle", report: null, error: null, basePoses: null };

type Job = {
  id: number;
  sequence: ActionSequenceConfig;
  poses: Poses;
  full: boolean;
  saved: boolean;
  sent: boolean;
};

const samePoses = (a: Poses | null, b: Poses): boolean =>
  a !== null && a.size === b.size && [...a].every(([id, p]) => {
    const q = b.get(id);
    return q !== undefined && p.v1 === q.v1 && p.v2 === q.v2 && p.v3 === q.v3;
  });

/** One project geometry snapshot, one worker, and at most one executing sequence. */
export class CollisionScanScheduler {
  private readonly states = new WeakMap<ActionSequenceConfig, ScanState>();
  private queue: Job[] = [];
  private active: Job | null = null;
  private worker: Worker | null = null;
  private cachedAssets = new Set<string>();
  private serial = 0;
  private paused = false;
  private wakeReader?: () => void;

  constructor(private readonly objects: ProjectSetup["controlledObjects"], private readonly changed: () => void) {}

  state(sequence: ActionSequenceConfig | null) {
    return sequence ? this.states.get(sequence) ?? IDLE : IDLE;
  }

  select(sequence: ActionSequenceConfig | null) {
    for (const job of [...this.queue]) {
      if (!job.saved && job.sequence !== sequence) this.cancel(job);
    }
    if (this.active && !this.active.saved && this.active.sequence !== sequence) this.cancel(this.active);
    this.pump();
  }

  request(sequence: ActionSequenceConfig, poses: Poses, saved: boolean) {
    const previous = this.state(sequence);
    if (saved && previous.status === "ready" && samePoses(previous.basePoses, poses)) return;
    const jobs = [this.active, ...this.queue];
    const matching = jobs.find(job => job?.sequence === sequence);
    if (matching && samePoses(matching.poses, poses) && (saved || matching.full)) {
      matching.saved ||= saved;
      return;
    }
    // A saved version and its newer draft can both need reports.
    for (const job of jobs) {
      if (job?.sequence.id === sequence.id && (job === matching || job.saved === saved)) this.cancel(job);
    }
    const job = { id: ++this.serial, sequence, poses, saved: saved || !!matching?.saved, full: !saved, sent: false };
    if (saved) this.queue.push(job);
    else this.queue.unshift(job);
    this.set(job, { ...IDLE, status: this.paused ? "paused" : "queued" });
    this.pump();
  }

  suspend(paused: boolean) {
    if (this.paused === paused) return;
    this.paused = paused;
    if (this.active) {
      if (this.active.sent) this.worker?.postMessage({ type: paused ? "pause" : "resume", jobId: this.active.id });
      this.set(this.active, { ...IDLE, status: paused ? "paused" : "running" });
    }
    for (const job of this.queue) this.set(job, { ...IDLE, status: paused ? "paused" : "queued" });
    if (!paused) {
      this.wakeReader?.();
      this.pump();
    }
  }

  dispose() {
    this.queue = [];
    this.active = null;
    this.wakeReader?.();
    this.worker?.terminate();
    this.worker = null;
    this.cachedAssets.clear();
  }

  private set(job: Job, state: ScanState) {
    this.states.set(job.sequence, state);
    this.changed();
  }

  private cancel(job: Job) {
    this.queue = this.queue.filter(item => item !== job);
    if (job === this.active) {
      if (job.sent) {
        this.worker?.postMessage({ type: "cancel", jobId: job.id });
        // The worker may already have evicted assets for this unacknowledged request.
        this.cachedAssets.clear();
      }
      this.active = null;
      this.wakeReader?.();
    }
    this.set(job, IDLE);
  }

  private pump() {
    if (this.paused || this.active || !this.queue.length) return;
    const job = this.queue.shift()!;
    this.active = job;
    this.set(job, { ...IDLE, status: "running" });
    void this.dispatch(job);
  }

  /** Start the action in the same turn as the final pause/identity check, including after a resume. */
  private async whenRunning<T>(job: Job, action: () => T): Promise<T | undefined> {
    while (this.active === job && this.paused) {
      await new Promise<void>(resolve => { this.wakeReader = resolve; });
    }
    if (this.active !== job) return;
    this.wakeReader = undefined;
    return action();
  }

  private finish(job: Job, state: ScanState) {
    if (this.active !== job) return;
    this.active = null;
    this.set(job, state);
    this.pump();
  }

  private getWorker() {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL("./collision.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }: MessageEvent<ScanReply>) => {
      const job = this.active;
      if (this.worker !== worker || !job || data.jobId !== job.id) return;
      if (data.ok) {
        this.cachedAssets = new Set(data.cachedAssets);
        this.finish(job, { status: "ready", report: data.report, error: null, basePoses: job.poses });
      } else {
        this.cachedAssets.clear();
        this.finish(job, { ...IDLE, status: "failed", error: data.error });
      }
    };
    const onFailure = (message: string) => {
      if (this.worker !== worker) return;
      worker.terminate();
      this.worker = null;
      this.cachedAssets.clear();
      if (this.active) this.finish(this.active, { ...IDLE, status: "failed", error: message });
    };
    worker.onerror = event => onFailure(event.message || "碰撞检测线程出错");
    worker.onmessageerror = () => onFailure("无法读取碰撞检测结果");
    this.worker = worker;
    return worker;
  }

  private async dispatch(job: Job) {
    try {
      const assets = new Map<string, CollisionAsset>();
      const modelIds = new Set(this.objects.map(o => o.modelId).filter((id): id is string => !!id));
      for (const modelId of modelIds) {
        if (this.cachedAssets.has(modelId)) continue;
        try {
          const result = await this.whenRunning(job, () => getProjectAPI().models.read({ modelId, includeAssets: false }));
          if (!result || this.active !== job) return;
          const file = unwrapResult(result);
          if (file.ext === "glb" || file.ext === "obj") assets.set(modelId, { format: file.ext, bytes: new Uint8Array(file.data) });
        } catch { /* 缺失的资产由扫描器逐项报告。 */ }
      }
      await this.whenRunning(job, () => {
        const input = { sequence: job.sequence, objects: snapshotCollisionObjects(this.objects, job.poses) };
        const request: ScanRequest = { jobId: job.id, input, assets, full: job.full };
        this.getWorker().postMessage(request, Array.from(assets.values(), asset => asset.bytes.buffer as ArrayBuffer));
        job.sent = true;
      });
    } catch (error) {
      this.finish(job, { ...IDLE, status: "failed", error: error instanceof Error ? error.message : String(error) });
    }
  }
}
