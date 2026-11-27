import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { attachmentFrameMatrix } from "@/app/viz3d/state/preview-path-points";
import { ENABLED_VIRTUAL_AXES_BY_CONTROL_TYPE } from "../configuration-rules";
import { evaluateResolvedSequence, segmentPoseAt } from "../action-sequence/evaluate-sequence";
import {
  pinUncontrolledAxes, resolveActionSequence, type ResolvedMotionSegment,
} from "../action-sequence/resolve-sequence";
import type { ModelPose } from "../action-sequence/types";
import { shapeDistanceSteps, shapeRadius, type CollisionShape } from "./geometry";
import { localTravelBound } from "./motion-bound";
import type { CollisionEvent, CollisionInput, CollisionObject, CollisionReport } from "./types";

import { finishSteps, type Steps } from "./worker-job";

const MIN_INTERVAL_MS = 1;
const MAX_SAMPLES_PER_INTERVAL = 1024;
const CACHE_LIMIT = 8192;
const ZERO: ModelPose = { v1: 0, v2: 0, v3: 0 };

type IntervalEvent = Omit<CollisionEvent, "objectIds">;
type Entry = { signature: string; events: IntervalEvent[] };

/** 每条记录只依赖一对物体在某个运动区间的几何、曲线和挂载链。 */
export class CollisionScanCache {
  private readonly entries = new Map<string, Entry>();
  private readonly shapeIds = new WeakMap<CollisionShape, number>();
  private nextShapeId = 0;

  clear(): void { this.entries.clear(); }

  shapeId(shape: CollisionShape): number {
    const previous = this.shapeIds.get(shape);
    if (previous !== undefined) return previous;
    const id = ++this.nextShapeId;
    this.shapeIds.set(shape, id);
    return id;
  }

  *interval(key: string, signature: string, scan: () => Steps<IntervalEvent[]>): Steps<IntervalEvent[]> {
    const previous = this.entries.get(key);
    const current = previous?.signature === signature ? previous : { signature, events: yield* scan() };
    this.entries.delete(key);
    this.entries.set(key, current);
    if (this.entries.size > CACHE_LIMIT) this.entries.delete(this.entries.keys().next().value!);
    return current.events;
  }
}

type Track = {
  object: CollisionObject;
  shape?: CollisionShape;
  driven: boolean;
  segments: ResolvedMotionSegment[];
  signature: string;
  missing: string[];
};

type Piece = {
  track: Track;
  segment?: ResolvedMotionSegment;
  first: ModelPose;
  last: ModelPose;
  signature: string;
};

const shapeTrackKey = ({ config }: CollisionObject): string =>
  JSON.stringify([config.id, config.parentId, config.position, config.rotation, config.dimensions,
    config.kinematics, config.hoistAxes?.map(axis => axis.mount)]);

const append = (events: IntervalEvent[], event: IntervalEvent) => {
  const last = events.at(-1);
  if (last && last.kind === event.kind && event.startMs <= last.endMs) {
    last.endMs = Math.max(last.endMs, event.endMs);
  } else {
    events.push({ ...event });
  }
};

const activeSegment = (segments: ResolvedMotionSegment[], time: number): ResolvedMotionSegment | undefined => {
  let low = 0;
  let high = segments.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (segments[mid]!.endMs <= time) low = mid + 1;
    else high = mid;
  }
  const segment = segments[low];
  return segment && segment.startMs <= time ? segment : undefined;
};

type Sample = { local: Matrix; pose: ModelPose };
type SampleFrame = { samples: Sample[]; world: Matrix };

const sampleBody = (pieces: Piece[], time: number, start: number, end: number): SampleFrame => {
  // 链按子→父排列。Babylon 使用行向量，局部变换乘在父矩阵的左边。
  const samples = pieces.map(piece => {
    let pose = piece.first;
    if (time === end) pose = piece.last;
    else if (time !== start && piece.segment) pose = segmentPoseAt(piece.segment, time);
    return { pose, local: attachmentFrameMatrix(piece.track.object.config, pose) };
  });
  let world = samples[0]?.local ?? Matrix.Identity();
  for (let i = 1; i < samples.length; i++) world = world.multiply(samples[i]!.local);
  return { samples, world };
};

/** 从子向父放大待测点的转动半径，再累加各级独立运动造成的位移。 */
const bodyTravel = (pieces: Piece[], start: SampleFrame, end: SampleFrame, radius: number): number => {
  let distance = 0;
  for (let index = 0; index < pieces.length; index++) {
    const config = pieces[index]!.track.object.config;
    const a = start.samples[index]!;
    const b = end.samples[index]!;
    distance += localTravelBound(config, a.pose, b.pose, radius);
    radius += a.local.getTranslation().length() + localTravelBound(config, a.pose, b.pose, 0);
  }
  return distance;
};

function* checkInterval(
  paths: [Piece[], Piece[]], shapes: [CollisionShape, CollisionShape], start: number, end: number,
): Steps<IntervalEvent[]> {
  const radii = shapes.map(shapeRadius);
  type Point = { t: number; a: SampleFrame; b: SampleFrame; distance: number };
  function* sample(t: number): Steps<Point> {
    yield;
    const a = sampleBody(paths[0], t, start, end);
    const b = sampleBody(paths[1], t, start, end);
    // 包围球间隙本身是距离下界，只有两球相遇才需要查网格。
    const gap = a.world.getTranslation().subtract(b.world.getTranslation()).length() - radii[0]! - radii[1]!;
    const distance = gap > 0 ? gap : yield* shapeDistanceSteps(shapes[0], a.world, shapes[1], b.world);
    return { t, a, b, distance };
  };
  const events: IntervalEvent[] = [];
  let budget = MAX_SAMPLES_PER_INTERVAL;
  const issue = (kind: IntervalEvent["kind"], startMs: number, endMs: number) =>
    append(events, { kind, startMs, endMs });

  function* visit(left: Point, right: Point): Steps<void> {
    const duration = right.t - left.t;
    const travel = bodyTravel(paths[0], left.a, right.a, radii[0]!) + bodyTravel(paths[1], left.b, right.b, radii[1]!);
    if (travel === 0 || duration === 0) {
      if (left.distance === 0) issue("collision", left.t, right.t);
      else if (!Number.isFinite(left.distance)) issue("review", left.t, right.t);
      return;
    }
    // 界住整个区间中任意一点到任一端点的位移。留出 Babylon 单精度矩阵的舍入余量。
    const margin = 1e-6 * (1 + Math.max(left.a.world.getTranslation().length(),
      left.b.world.getTranslation().length(), right.a.world.getTranslation().length(),
      right.b.world.getTranslation().length(), ...radii));
    if (left.distance > travel + margin || right.distance > travel + margin) return;

    if (duration <= MIN_INTERVAL_MS || budget <= 0) {
      if (left.distance === 0 && right.distance === 0 && duration <= MIN_INTERVAL_MS) {
        issue("collision", left.t, right.t);
      } else {
        if (left.distance === 0) issue("collision", left.t, left.t);
        issue("review", left.t, right.t);
        if (right.distance === 0) issue("collision", right.t, right.t);
      }
      return;
    }
    budget--;
    const center = yield* sample((left.t + right.t) / 2);
    yield* visit(left, center);
    yield* visit(center, right);
  };
  const left = yield* sample(start);
  yield* visit(left, end === start ? left : yield* sample(end));
  return events;
};

export function* scanCollisionSteps(
  input: CollisionInput, shapes: ReadonlyMap<number, CollisionShape>, cache?: CollisionScanCache,
): Steps<CollisionReport> {
  const objects = new Map(input.objects.map(obj => [obj.id, obj]));
  const resolved = pinUncontrolledAxes(resolveActionSequence(input.sequence), (id, axis) => objects.get(id)?.basePose[axis]);
  const incomplete = new Set<string>();
  for (const id of resolved.posesByObject.keys()) {
    if (!objects.has(id)) incomplete.add(`轨道物体 ${id} 缺少场景配置`);
  }
  const segmentsById = new Map<number, ResolvedMotionSegment[]>();
  for (const segment of resolved.segments) {
    const list = segmentsById.get(segment.objectId);
    if (list) list.push(segment);
    else segmentsById.set(segment.objectId, [segment]);
  }
  const tracks = new Map<number, Track>();
  for (const object of objects.values()) {
    const k = object.config.kinematics;
    const enabled = object.enabledAxes ?? (k ? ENABLED_VIRTUAL_AXES_BY_CONTROL_TYPE[k.controlType] : []);
    const driven = resolved.posesByObject.has(object.id);
    const uncontrolled = resolved.uncontrolledAxesByObject?.get(object.id) ?? [];
    const unknown = enabled.filter(axis => (!driven || uncontrolled.includes(axis)) && !Number.isFinite(object.basePose[axis]));
    tracks.set(object.id, {
      object, shape: shapes.get(object.id), driven, segments: segmentsById.get(object.id) ?? [],
      signature: shapeTrackKey(object),
      missing: unknown.length ? [`${object.name} 缺少基准姿态（${unknown.join("、")}）`] : [],
    });
  }

  const ordered = [...tracks.values()].sort((a, b) => a.object.id - b.object.id);
  const chains = ordered.map(track => {
    const chain = [track];
    const visited = new Set([track.object.id]);
    let current = track;
    while (current.object.config.parentId != null) {
      const parent = tracks.get(Number(current.object.config.parentId));
      if (!parent || visited.has(parent.object.id)) {
        track.missing.push(`${track.object.name} 的挂载关系缺失或循环`);
        break;
      }
      chain.push(parent);
      visited.add(parent.object.id);
      current = parent;
    }
    return chain;
  });

  const endpointCache = new Map<number, Map<number, ModelPose>>();
  const poseAt = (track: Track, t: number): ModelPose => {
    let poses = endpointCache.get(t);
    if (!poses) {
      poses = evaluateResolvedSequence(resolved, t);
      endpointCache.set(t, poses);
    }
    return poses.get(track.object.id) ?? { ...ZERO, ...track.object.basePose };
  };
  const pieceFor = (track: Track, start: number, end: number): Piece => {
    const first = poseAt(track, start);
    const last = poseAt(track, end);
    const segment = start === end ? undefined : activeSegment(track.segments, start);
    return { track, first, last, segment, signature: cache ? JSON.stringify([track.signature, first, last, segment]) : "" };
  };
  const events: CollisionEvent[] = [];
  for (let i = 0; i < ordered.length; i++) {
    for (let j = i + 1; j < ordered.length; j++) {
      yield;
      const a = ordered[i]!;
      const b = ordered[j]!;
      const ca = chains[i]!;
      const cb = chains[j]!;
      if (!ca.some(track => track.driven) && !cb.some(track => track.driven)) continue;
      const missing = [...ca, ...cb].flatMap(track => track.missing);
      for (const track of [a, b]) if (!track.shape) missing.push(`${track.object.name} 缺少可校验的模型`);
      if (missing.length) {
        for (const message of missing) incomplete.add(message);
        continue;
      }
      // 去掉两边共同的父变换：同一根桁架带动两件固定子件时相对位置恒定。
      let n = ca.length;
      let m = cb.length;
      while (n > 0 && m > 0 && ca[n - 1] === cb[m - 1]) { n--; m--; }
      const paths = [ca.slice(0, n), cb.slice(0, m)] as const;
      const boundaries = new Set([0, resolved.totalMs]);
      for (const track of [...paths[0], ...paths[1]]) {
        for (const segment of track.segments) {
          boundaries.add(segment.startMs);
          boundaries.add(segment.endMs);
        }
      }
      const times = [...boundaries].sort((x, y) => x - y);
      const pair: IntervalEvent[] = [];
      for (let k = 0; k < Math.max(1, times.length - 1); k++) {
        yield;
        const start = times[k]!;
        const end = times[k + 1] ?? start;
        const pieces: [Piece[], Piece[]] = [
          paths[0].map(track => pieceFor(track, start, end)), paths[1].map(track => pieceFor(track, start, end)),
        ];
        const scan = () => checkInterval(pieces, [a.shape!, b.shape!], start, end);
        const interval = yield* (cache ? cache.interval(
          `${a.object.id}/${b.object.id}/${start}/${end}`,
          JSON.stringify([cache.shapeId(a.shape!), cache.shapeId(b.shape!), ...pieces.map(p => p.map(s => s.signature))]),
          scan,
        ) : scan());
        for (const event of interval) append(pair, event);
      }
      for (const event of pair) events.push({ ...event, objectIds: [a.object.id, b.object.id] });
    }
  }
  events.sort((a, b) => a.startMs - b.startMs || a.objectIds[0] - b.objectIds[0]);
  return { events, incomplete: [...incomplete] };
};

export const scanCollisions = (
  input: CollisionInput, shapes: ReadonlyMap<number, CollisionShape>, cache?: CollisionScanCache,
): CollisionReport => finishSteps(scanCollisionSteps(input, shapes, cache));
