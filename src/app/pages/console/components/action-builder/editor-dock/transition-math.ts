import type { VirtualAxisId } from "@/app/project/project-document-types";
import type { ControlType } from "@/app/project/configuration-types";
import {
  calculateMotionProfileKinematics,
  createDefaultAxisProfiles,
} from "@/app/project/action-sequence/motion-profile";
import type { MotionProfile } from "@/app/project/action-sequence/types";
import {
  VIRTUAL_AXIS_IDS,
  type ControlledObject,
  type CueItem,
} from "../timeline/timeline-data";

export type TransitionRow = {
  objectId: number;
  objectName: string;
  axis: VirtualAxisId;
  fromValue: number;
  toValue: number;
  travel: number;
  requiredSpeed: number;
  peakVelocity: number;
  acceleration: number;
  deceleration: number;
  maxSpeed?: number;
  controlType?: ControlType;
  velocityExceeded: boolean;
  exceeded: boolean;
};

type ObjectLookup = (objectId: number) => ControlledObject | undefined;

const parseObjectIdKey = (key: string): number | null => {
  const id = Number(key);
  return Number.isFinite(id) ? id : null;
};

const axisProfileForObject = (
  objectId: number,
  axis: VirtualAxisId,
  durationMs: number,
  lookup?: ObjectLookup,
): MotionProfile => {
  const profiles = createDefaultAxisProfiles(
    durationMs,
    lookup?.(objectId)?.minAccelTimeByAxis,
  );
  return profiles[axis];
};

/** 计算 A→B 过渡在给定时长下每个物体×轴的行程与所需速度 */
export const computeTransitionRows = (
  from: CueItem,
  to: CueItem,
  durationMs: number,
  lookup?: ObjectLookup,
): TransitionRow[] => {
  const rows: TransitionRow[] = [];

  for (const [objectKey, toValues] of Object.entries(to.targets)) {
    const objectId = parseObjectIdKey(objectKey);
    if (objectId === null) continue;
    const fromValues = from.targets[objectKey];
    if (!fromValues) continue;
    const object = lookup?.(objectId);

    for (const axis of VIRTUAL_AXIS_IDS) {
      const fromValue = fromValues[axis];
      const toValue = toValues[axis];
      if (fromValue === undefined || toValue === undefined) continue;

      const travel = Math.abs(toValue - fromValue);
      const profile = axisProfileForObject(objectId, axis, durationMs, lookup);
      const metrics = calculateMotionProfileKinematics(profile, travel, durationMs);
      const maxSpeed = object?.maxSpeedByAxis?.[axis];
      const velocityExceeded = maxSpeed !== undefined && metrics.peakVelocity > maxSpeed;
      rows.push({
        objectId,
        objectName: object?.name ?? objectKey,
        axis,
        fromValue,
        toValue,
        travel,
        requiredSpeed: metrics.peakVelocity,
        peakVelocity: metrics.peakVelocity,
        acceleration: metrics.acceleration,
        deceleration: metrics.deceleration,
        maxSpeed,
        controlType: object?.controlType,
        velocityExceeded,
        exceeded: velocityExceeded,
      });
    }
  }
  return rows;
};

export const minFeasibleDurationMs = (
  from: CueItem,
  to: CueItem,
  lookup?: ObjectLookup,
): number | null => {
  const rows = computeTransitionRows(from, to, 1000, lookup);
  let minSec = 0;
  let constrained = false;
  for (const row of rows) {
    if (row.travel <= 0) continue;
    if (row.maxSpeed !== undefined && row.maxSpeed > 0) {
      constrained = true;
      minSec = Math.max(minSec, row.peakVelocity / row.maxSpeed);
    }
  }
  if (!constrained) return null;
  return Math.ceil(minSec * 10) * 100;
};

/** 各轴未配置速度上限时的估算速度（v1: mm/s；v2/v3: °/s）。Legacy v1 default was 0.35 m/s. */
const FALLBACK_AXIS_SPEED: Record<VirtualAxisId, number> = {
  v1: 350,
  v2: 15,
  v3: 15,
};

/**
 * 估算「当前场景位置 → Cue 目标值」的到达时间。
 * v1 起点取物体当前位置，v2/v3 起点按 0 处理；速度取轴上限，缺省用回退估值。
 * 结果向上取整到 0.1s；Cue 无有效目标时返回 null。
 */
export const estimateArrivalMs = (
  cue: CueItem,
  lookup?: ObjectLookup,
): number | null => {
  let maxSec = 0;
  let hasTarget = false;

  for (const [objectKey, targetValues] of Object.entries(cue.targets)) {
    const objectId = parseObjectIdKey(objectKey);
    if (objectId === null) continue;
    const object = lookup?.(objectId);
    const currentValues: Record<VirtualAxisId, number> = {
      v1: object?.currentPosition ?? 0,
      v2: 0,
      v3: 0,
    };

    for (const axis of VIRTUAL_AXIS_IDS) {
      const target = targetValues[axis];
      if (target === undefined) continue;
      hasTarget = true;
      const travel = Math.abs(target - currentValues[axis]);
      const speed = object?.maxSpeedByAxis?.[axis] ?? FALLBACK_AXIS_SPEED[axis];
      if (speed <= 0) continue;
      maxSec = Math.max(maxSec, travel / speed);
    }
  }

  if (!hasTarget) return null;
  return Math.ceil(maxSec * 10) * 100;
};

/** 按速度模式：以 v1（升降）最大行程换算时长；无 v1 行程返回 null */
export const durationMsFromSpeed = (
  from: CueItem,
  to: CueItem,
  speed: number,
): number | null => {
  if (speed <= 0) return null;
  let maxTravelV1 = 0;
  for (const [objectId, toValues] of Object.entries(to.targets)) {
    const fromV1 = from.targets[objectId]?.v1;
    if (fromV1 === undefined || toValues.v1 === undefined) continue;
    maxTravelV1 = Math.max(maxTravelV1, Math.abs(toValues.v1 - fromV1));
  }
  if (maxTravelV1 === 0) return null;
  return Math.round((maxTravelV1 / speed) * 1000);
};
