import { prepareCollisionShape, type CollisionShape } from "./geometry";
import { CollisionScanCache, scanCollisionSteps } from "./scan";
import type { CollisionAsset, ScanControl, ScanReply, ScanRequest } from "./types";
import { WorkerJob } from "./worker-job";

const pairCache = new CollisionScanCache();
const modelAssets = new Map<string, CollisionAsset>();
const shapeCache = new Map<string, CollisionShape>();
let active: WorkerJob | undefined;

async function scan(request: ScanRequest, job: WorkerJob): Promise<void> {
  const { input, assets, full, jobId } = request;
  try {
    for (const [key, asset] of assets) modelAssets.set(key, asset);
    const usedShapes = new Set<string>();
    const shapes = new Map<number, CollisionShape>();
    for (const object of input.objects) {
      await job.ready();
      const { shape, dimensions, holeDimensions, model } = object.config;
      const key = JSON.stringify([shape, dimensions, holeDimensions, model, object.modelKey]);
      let geometry = shapeCache.get(key);
      if (!geometry) {
        geometry = await prepareCollisionShape(object, modelAssets.get(object.modelKey ?? ""), job.run);
        await job.ready();
      }
      if (geometry) {
        usedShapes.add(key);
        shapeCache.set(key, geometry);
        shapes.set(object.id, geometry);
      }
    }
    if (full) pairCache.clear();
    const report = await job.run(scanCollisionSteps(input, shapes, pairCache));
    if (active !== job) return;
    const usedAssets = new Set(input.objects.map(object => object.modelKey));
    for (const key of modelAssets.keys()) if (!usedAssets.has(key)) modelAssets.delete(key);
    for (const key of shapeCache.keys()) if (!usedShapes.has(key)) shapeCache.delete(key);
    self.postMessage({ jobId, ok: true, report, cachedAssets: [...modelAssets.keys()] } satisfies ScanReply);
  } catch (error) {
    if (active === job) {
      self.postMessage({ jobId, ok: false, error: error instanceof Error ? error.message : String(error) } satisfies ScanReply);
    }
  } finally {
    if (active === job) active = undefined;
  }
}

self.onmessage = ({ data }: MessageEvent<ScanRequest | ScanControl>) => {
  if ("type" in data) {
    if (active?.id !== data.jobId) return;
    if (data.type === "pause") active.pause();
    if (data.type === "resume") active.resume();
    if (data.type === "cancel") { active.cancel(); active = undefined; }
    return;
  }
  active?.cancel();
  active = new WorkerJob(data.jobId);
  void scan(data, active);
};
