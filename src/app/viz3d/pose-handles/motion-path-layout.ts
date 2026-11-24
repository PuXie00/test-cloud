import { distancePt, distanceToSegment, type Pt } from "./pose-handle-math";
import { projectPolyline, ringPoint, ringRadiusIn, type CellProjector } from "./pose-handle-layout";
import { BOX_EDGES, type MotionPathOutlineKind, type MotionPathWorld } from "./motion-path-geometry";
import type { MotionPathIssueSpan } from "./motion-path-types";

/** 轨迹上相邻两点在屏幕上至少隔这么远才都留着 */
const MIN_STEP_PX = 1.5;
const KEYFRAME_HIT_PX = 7;
const PATH_HIT_PX = 5;
const TICK_INNER = 0.86;
const TICK_OUTER = 1.14;

export type MotionPathKeyframeLayout = {
  at: Pt;
  atMs: number;
  blockId: string | null;
  selected: boolean;
  invalid: boolean;
};

/** 一台物体的整条动作在一格视口里的屏幕形状：画和点中都用它 */
export type MotionPathLayout = {
  objectId: string;
  selected: boolean;
  /** 轨迹折线（带每个点的时刻，点中时求是哪一刻） */
  runs: Array<{ points: Pt[]; times: number[] }>;
  /** 有问题的那几段 */
  issueRuns: Pt[][];
  issues: MotionPathIssueSpan[];
  keyframes: MotionPathKeyframeLayout[];
  /** 旋转类：环上的刻点 */
  ticks: Array<MotionPathKeyframeLayout & { from: Pt; to: Pt }>;
  /** 没选中的旋转类物体（「全部」时）自己画一圈细环；选中的用手柄的环 */
  ring: Pt[][];
  cursor: Pt | null;
  outlines: Array<{ kind: MotionPathOutlineKind; edges: Pt[][] }>;
};

const projectRuns = (
  world: MotionPathWorld,
  projector: CellProjector,
  keep: (atMs: number) => boolean = () => true,
): Array<{ points: Pt[]; times: number[] }> => {
  const runs: Array<{ points: Pt[]; times: number[] }> = [];
  let current: { points: Pt[]; times: number[] } = { points: [], times: [] };
  const flush = () => {
    if (current.points.length > 1) runs.push(current);
    current = { points: [], times: [] };
  };
  world.points.forEach(({ atMs, point }, index) => {
    const projected = keep(atMs) ? projector.project(point) : null;
    if (!projected) {
      flush();
      return;
    }
    const last = current.points[current.points.length - 1];
    const isLast = index === world.points.length - 1;
    if (last && distancePt(last, projected) < MIN_STEP_PX && !isLast) return;
    current.points.push(projected);
    current.times.push(atMs);
  });
  flush();
  return runs;
};

const inSpans = (spans: readonly MotionPathIssueSpan[], atMs: number): MotionPathIssueSpan | undefined =>
  spans.find((span) => span.fromMs <= atMs && atMs <= span.toMs);

export const layoutMotionPath = (world: MotionPathWorld, projector: CellProjector): MotionPathLayout => {
  const layout: MotionPathLayout = {
    objectId: world.objectId,
    selected: world.selected,
    runs: [],
    issueRuns: [],
    issues: world.issues,
    keyframes: [],
    ticks: [],
    ring: [],
    cursor: world.cursorPoint ? projector.project(world.cursorPoint) : null,
    outlines: world.outlines.map(({ kind, corners }) => ({
      kind,
      edges: BOX_EDGES.flatMap(([a, b]) => projectPolyline(projector, [corners[a]!, corners[b]!])),
    })),
  };

  if (world.style === "path") {
    layout.runs = projectRuns(world, projector);
    if (world.issues.length > 0) {
      layout.issueRuns = projectRuns(world, projector, (atMs) => inSpans(world.issues, atMs) !== undefined).map(
        (run) => run.points,
      );
    }
    for (const keyframe of world.keyframes) {
      const at = projector.project(keyframe.point);
      if (at) layout.keyframes.push({ ...keyframe, at });
    }
    return layout;
  }

  const ring = world.ring;
  if (!ring) return layout;
  const radius = ringRadiusIn(ring, projector);
  if (!world.selected) {
    const samples = Array.from({ length: 65 }, (_, index) => ringPoint(ring, radius, (index / 64) * Math.PI * 2));
    layout.ring = projectPolyline(projector, samples);
    layout.cursor = projector.project(ringPoint(ring, radius, 0));
  }
  for (const keyframe of world.keyframes) {
    if (keyframe.angle === null) continue;
    const from = projector.project(ringPoint(ring, radius * TICK_INNER, keyframe.angle));
    const to = projector.project(ringPoint(ring, radius * TICK_OUTER, keyframe.angle));
    const at = projector.project(ringPoint(ring, radius, keyframe.angle));
    if (from && to && at) layout.ticks.push({ ...keyframe, from, to, at });
  }
  return layout;
};

export type MotionPathHit =
  | { kind: "keyframe"; objectId: string; blockId: string; atMs: number; at: Pt; distance: number }
  | { kind: "time"; objectId: string; atMs: number; at: Pt; distance: number; segmentKey: string | null };

/** 指针下的位姿点（含环上刻点），或选中物体轨迹线上的某一刻；位姿点优先 */
export const hitTestMotionPaths = (layouts: readonly MotionPathLayout[], point: Pt): MotionPathHit | null => {
  let best: MotionPathHit | null = null;
  const consider = (hit: MotionPathHit) => {
    if (!best || hit.distance < best.distance) best = hit;
  };
  for (const layout of layouts) {
    for (const keyframe of [...layout.keyframes, ...layout.ticks]) {
      if (!keyframe.blockId) continue;
      const distance = distancePt(point, keyframe.at);
      if (distance > KEYFRAME_HIT_PX) continue;
      // 点比线好抓：同样近时算点
      consider({
        kind: "keyframe",
        objectId: layout.objectId,
        blockId: keyframe.blockId,
        atMs: keyframe.atMs,
        at: keyframe.at,
        distance: distance - 3,
      });
    }
    if (!layout.selected) continue;
    for (const run of layout.runs) {
      for (let index = 1; index < run.points.length; index += 1) {
        const a = run.points[index - 1]!;
        const b = run.points[index]!;
        const distance = distanceToSegment(point, a, b);
        if (distance > PATH_HIT_PX) continue;
        const lengthSq = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
        const t =
          lengthSq < 1e-9 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / lengthSq));
        const atMs = run.times[index - 1]! + (run.times[index]! - run.times[index - 1]!) * t;
        consider({
          kind: "time",
          objectId: layout.objectId,
          atMs,
          at: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
          distance,
          segmentKey: inSpans(layout.issues, atMs)?.segmentKey ?? null,
        });
      }
    }
  }
  return best;
};
