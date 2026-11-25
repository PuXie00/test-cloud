import { createDefaultAxisProfile } from "@/app/project/action-sequence/motion-profile";
import { isAxisSet } from "@/app/project/action-sequence/keyframe-pose";
import type {
  ActionSequenceConfig,
  AxisMotionProfiles,
  KeyframePose,
  MotionProfile,
  TimelineBlock,
} from "@/app/project/action-sequence/types";
import type { VirtualAxisId } from "@/app/project/project-document-types";
import { nextId } from "./action-builder-ops";
import { resolveEnabledAxes } from "./motion-profile/motion-profile-status";
import { referencePlan, type SegmentRampAxis } from "./motion-profile/segment-presets";
import { objectRateLimits } from "./right-panel/segment-retime";
import { TIME_STEP_MS, snapTimeMs, type ControlledObject } from "./timeline/timeline-data";

/** 两个造型之间怎么走：同时到达（最慢那台走最快，其它台等比放慢）、各自最快 */
export type TransitionTiming = "sync" | "each";

export const TRANSITION_TIMINGS: ReadonlyArray<{ id: TransitionTiming; label: string }> = [
  { id: "sync", label: "同时到达" },
  { id: "each", label: "各自最快" },
];

/** 没配速度上限也没配默认速度、算不出来的物体，先按这个时长走，生成后再改 */
export const FALLBACK_TRANSITION_MS = 3000;

export type TransitionObjectPlan = {
  objectId: number;
  from: KeyframePose;
  to: KeyframePose;
  /** 这台按这次的走法要多久；不动的为 0 */
  durationMs: number;
  /** 这台自己最快要多久（没配上限时是按默认速度） */
  fastestMs: number;
  /** 各个要动的轴的曲线 */
  profiles: Partial<Record<VirtualAxisId, MotionProfile>>;
  /** limits：按上限 95% 算的；default：没配上限，按默认速度算的；unknown：都没配，按 FALLBACK 时长 */
  basis: "limits" | "default" | "unknown";
};

export type ShapeTransitionPlan = {
  /** 两边都有的物体（不动的也在，durationMs 为 0） */
  objects: TransitionObjectPlan[];
  /** 最晚到的那台到的时刻 */
  totalMs: number;
  /** 最慢的那台（自己最快也要最久） */
  slowestObjectId: number | null;
  /** 只在起点造型 / 终点造型里的物体：不动，不放进过渡 */
  onlyFrom: number[];
  onlyTo: number[];
};

const PLACEHOLDER_PROFILE: MotionProfile = { kind: "trapezoid", params: { accelMs: TIME_STEP_MS, decelMs: TIME_STEP_MS } };

/** 等比放慢到 durationMs：变速时间同比例拉长，取整到 0.1 s 后要放得下 */
const stretchProfile = (profile: MotionProfile, factor: number, durationMs: number): MotionProfile => {
  if (profile.kind !== "trapezoid" || factor === 1) return profile;
  let accelMs = Math.max(TIME_STEP_MS, snapTimeMs(profile.params.accelMs * factor));
  let decelMs = Math.max(TIME_STEP_MS, snapTimeMs(profile.params.decelMs * factor));
  while (accelMs + decelMs > durationMs && Math.max(accelMs, decelMs) > TIME_STEP_MS) {
    if (accelMs >= decelMs) accelMs -= TIME_STEP_MS;
    else decelMs -= TIME_STEP_MS;
  }
  return { kind: "trapezoid", params: { accelMs, decelMs } };
};

/**
 * 两个造型之间的过渡：两边都有的物体各轴从起点造型走到终点造型，从静止到静止。
 * 每台先按速度上限的 95% 算最快（没配上限按默认速度，都没配按 FALLBACK_TRANSITION_MS）；
 * 同时到达时总时长取最慢那台的最快，其它台曲线等比放慢到同一时长；各自最快时各走各的。
 */
export const planShapeTransition = (input: {
  from: ReadonlyMap<number, KeyframePose>;
  to: ReadonlyMap<number, KeyframePose>;
  objectOf: (objectId: number) => ControlledObject | undefined;
  timing: TransitionTiming;
}): ShapeTransitionPlan => {
  const onlyFrom = [...input.from.keys()].filter((objectId) => !input.to.has(objectId));
  const onlyTo = [...input.to.keys()].filter((objectId) => !input.from.has(objectId));
  const objects: TransitionObjectPlan[] = [];
  for (const [objectId, fromPose] of input.from) {
    const toPose = input.to.get(objectId);
    if (!toPose) continue;
    const object = input.objectOf(objectId);
    const limits = objectRateLimits(object);
    const axes = resolveEnabledAxes(object?.enabledAxes ?? []).filter(
      (axis) => isAxisSet(fromPose, axis) && isAxisSet(toPose, axis),
    );
    const from: KeyframePose = {};
    const to: KeyframePose = {};
    for (const axis of axes) {
      from[axis] = fromPose[axis];
      to[axis] = toPose[axis];
    }
    const ramps = axes.flatMap((axis): Array<SegmentRampAxis & { axis: VirtualAxisId }> => {
      const distance = Math.abs((toPose[axis] ?? 0) - (fromPose[axis] ?? 0));
      return distance > 0
        ? [{ axis, distance, profile: PLACEHOLDER_PROFILE, durationMs: TIME_STEP_MS, limits: limits[axis] ?? {} }]
        : [];
    });
    if (axes.length === 0) continue;
    if (ramps.length === 0) {
      objects.push({ objectId, from, to, durationMs: 0, fastestMs: 0, profiles: {}, basis: "limits" });
      continue;
    }
    const fastest = referencePlan(ramps, "fastest");
    const fallback = fastest ? null : referencePlan(ramps, "default");
    const plan = fastest ?? fallback;
    if (!plan) {
      const durationMs = FALLBACK_TRANSITION_MS;
      objects.push({
        objectId,
        from,
        to,
        durationMs,
        fastestMs: durationMs,
        profiles: Object.fromEntries(ramps.map((ramp) => [ramp.axis, createDefaultAxisProfile(durationMs)])),
        basis: "unknown",
      });
      continue;
    }
    objects.push({
      objectId,
      from,
      to,
      durationMs: plan.durationMs,
      fastestMs: plan.durationMs,
      profiles: Object.fromEntries(plan.profiles),
      basis: fastest ? "limits" : "default",
    });
  }
  let slowest: TransitionObjectPlan | null = null;
  for (const object of objects) {
    if (object.fastestMs > 0 && (slowest === null || object.fastestMs > slowest.fastestMs)) slowest = object;
  }
  const totalMs = slowest?.fastestMs ?? 0;
  const timed =
    input.timing === "each"
      ? objects
      : objects.map((object) => {
          if (object.durationMs === 0 || object.durationMs === totalMs) return object;
          const factor = totalMs / object.durationMs;
          const profiles = Object.fromEntries(
            Object.entries(object.profiles).map(([axis, profile]) => [axis, stretchProfile(profile, factor, totalMs)]),
          );
          return { ...object, durationMs: totalMs, profiles };
        });
  return { objects: timed, totalMs, slowestObjectId: slowest?.objectId ?? null, onlyFrom, onlyTo };
};

const IDLE: MotionProfile = { kind: "idle" };

/**
 * 过渡生成一条序列：每台 0 s 是起点造型，到它的时长是终点造型；不动的只放 0 s 那一帧。
 * 区间曲线用过渡算好的（没动的轴留给区间同步成空闲）
 */
export const buildTransitionSequence = (
  plan: ShapeTransitionPlan,
  input: { id: number; name: string },
): ActionSequenceConfig | null => {
  const blocks: TimelineBlock[] = [];
  const segments: ActionSequenceConfig["segments"] = [];
  for (const object of plan.objects) {
    const startId = nextId("blk");
    blocks.push({ id: startId, kind: "pose", objectId: object.objectId, atMs: 0, pose: { ...object.from } });
    if (object.durationMs <= 0) continue;
    const endId = nextId("blk");
    blocks.push({
      id: endId,
      kind: "pose",
      objectId: object.objectId,
      atMs: object.durationMs,
      pose: { ...object.to },
    });
    const profiles: AxisMotionProfiles = {
      v1: object.profiles.v1 ?? IDLE,
      v2: object.profiles.v2 ?? IDLE,
      v3: object.profiles.v3 ?? IDLE,
    };
    segments.push({ fromRef: startId, toRef: endId, settings: { profiles } });
  }
  if (blocks.length === 0) return null;
  return { id: input.id, name: input.name, trajectoryMode: false, loop: false, blocks, segments };
};
