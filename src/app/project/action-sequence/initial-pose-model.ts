import { CONTROL_TYPE_RULES } from "@/app/project/configuration-rules";
import { decodeControlType } from "@/app/project/control-type-code";
import type { MotionAxisKind } from "@/app/project/configuration-types";
import type {
  ControlledObjectConfig,
  DriveAxisBinding,
  MotorConfig,
  VirtualAxisId,
} from "@/app/project/project-document-types";
import { motionKindForVirtualAxis } from "@/app/project/virtual-axis-mapping";
import { resolveVirtualAxisMaxVelocity } from "@/app/project/virtual-axis-max-velocity";
import type { ModelPose } from "./types";
import type {
  AxisVad,
  HoistPointCount,
  HpyPose,
  InitialTransitionModelInput,
} from "./initial-transition-planner";

export type PoseSpeedMode = "default" | "fastest";

export type TransitionMember = {
  object: ControlledObjectConfig;
  current: HpyPose;
  target: ModelPose;
};

const ZERO_VAD: AxisVad = { velocity: 0, acceleration: 0, deceleration: 0 };

const mountOf = (axis: DriveAxisBinding): { x: number; z: number } => axis.mount ?? { x: 0, z: 0 };

const positive = (value: number | undefined, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;

const plannerTypeFor = (object: ControlledObjectConfig): HoistPointCount => {
  const kind = decodeControlType(object.controlType);
  if (kind === "twoPointSwing") return 2;
  if (kind === "fourPointSwing" || kind === "dualTiltFourPointSwing") return 4;
  if (kind === "multiPointSwing") return 8;
  return 1;
};

const moveWhatFor = (object: ControlledObjectConfig): number => {
  if (object.enabledVirtualAxes.includes("v2")) return 1;
  if (object.enabledVirtualAxes.includes("v3")) return 2;
  return 0;
};

const plannerAxes = (type: HoistPointCount, moveWhat: number): VirtualAxisId[] => {
  if (type === 1) return ["v1"];
  if (type === 2) return ["v1", "v2"];
  if (type === 4) {
    if (moveWhat === 2) return ["v1", "v3"];
    if (moveWhat === 1) return ["v1", "v2"];
    return ["v1"];
  }
  return ["v1", "v2", "v3"];
};

const maxMotorVelocityFor = (
  object: ControlledObjectConfig,
  motors: readonly MotorConfig[],
): number => {
  let min: number | undefined;
  for (const motor of motors) {
    if (motor.controlledObjectId !== object.id) continue;
    const value = motor.params.maxAxisVelocity;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) continue;
    min = min === undefined ? value : Math.min(min, value);
  }
  if (min !== undefined) return min;
  return object.maxAxisVelocity > 0 ? object.maxAxisVelocity : 0;
};

const vadForAxis = (
  object: ControlledObjectConfig,
  motors: readonly MotorConfig[],
  axis: VirtualAxisId,
  speedMode: PoseSpeedMode,
): AxisVad => {
  if (!object.enabledVirtualAxes.includes(axis)) return ZERO_VAD;
  const motionAxes = CONTROL_TYPE_RULES[decodeControlType(object.controlType)].motionAxes;
  const kind: MotionAxisKind = motionKindForVirtualAxis(motionAxes, axis);
  const params = object.motionParams[kind];
  if (!params || !(params.speed > 0)) return ZERO_VAD;
  if (speedMode === "default") {
    return {
      velocity: params.speed,
      acceleration: params.acceleration,
      deceleration: params.deceleration,
    };
  }
  const velocity = resolveVirtualAxisMaxVelocity(object, motors)[axis] ?? params.speed;
  const accel = params.minAccelTime > 0 ? velocity / params.minAccelTime : 0;
  return { velocity, acceleration: accel, deceleration: accel };
};

const targetHpy = (pose: ModelPose): HpyPose => ({ h: pose.v1, p: pose.v2, y: pose.v3 });

const alignInactivePlannerAxes = (
  current: HpyPose,
  target: HpyPose,
  object: ControlledObjectConfig,
  type: HoistPointCount,
  moveWhat: number,
): HpyPose => {
  const next = { ...current };
  const enabled = new Set(object.enabledVirtualAxes);
  for (const axis of plannerAxes(type, moveWhat)) {
    if (enabled.has(axis)) continue;
    if (axis === "v1") next.h = target.h;
    if (axis === "v2") next.p = target.p;
    if (axis === "v3") next.y = target.y;
  }
  return next;
};

const baseHeights = (object: ControlledObjectConfig): { baseHeight1: number; baseHeight2: number } =>
  object.modelRunDirection === 2
    ? { baseHeight1: 0, baseHeight2: object.pulleyDistance }
    : { baseHeight1: object.pulleyDistance, baseHeight2: 0 };

const twoPointLength = (object: ControlledObjectConfig): number => {
  const [first, second] = object.driveAxes;
  if (!first || !second) return positive(object.dimensions.w, 1);
  const start = mountOf(first);
  const end = mountOf(second);
  return positive(Math.hypot(start.x - end.x, start.z - end.z), positive(object.dimensions.w, 1));
};

const fourPointSpans = (object: ControlledObjectConfig): { lengthInside: number; widthInside: number } => {
  const mounts = object.driveAxes.map(mountOf);
  if (mounts.length === 0) {
    return {
      lengthInside: positive(object.dimensions.w, 1),
      widthInside: positive(object.dimensions.d, 1),
    };
  }
  const xs = mounts.map((mount) => mount.x);
  const zs = mounts.map((mount) => mount.z);
  return {
    lengthInside: positive(Math.max(...xs) - Math.min(...xs), positive(object.dimensions.w, 1)),
    widthInside: positive(Math.max(...zs) - Math.min(...zs), positive(object.dimensions.d, 1)),
  };
};

const maxHeightFor = (object: ControlledObjectConfig): number =>
  positive(object.motionParams.move?.maxAngle, positive(object.dimensions.h, 1));

const buildOne = (
  member: TransitionMember,
  motors: readonly MotorConfig[],
  speedMode: PoseSpeedMode,
): InitialTransitionModelInput => {
  const type = plannerTypeFor(member.object);
  const moveWhat = moveWhatFor(member.object);
  const target = targetHpy(member.target);
  const shared = {
    id: member.object.id,
    current: alignInactivePlannerAxes(member.current, target, member.object, type, moveWhat),
    target,
    h: vadForAxis(member.object, motors, "v1", speedMode),
    p: vadForAxis(member.object, motors, "v2", speedMode),
    y: vadForAxis(member.object, motors, "v3", speedMode),
    maxMotorVelocity: maxMotorVelocityFor(member.object, motors),
  };
  if (type === 1) {
    return { ...shared, type: 1, motorCount: Math.max(member.object.driveAxes.length, 1) };
  }
  const heights = baseHeights(member.object);
  const maxHeight = maxHeightFor(member.object);
  if (type === 2) {
    return { ...shared, type: 2, ...heights, lengthInside: twoPointLength(member.object), maxHeight };
  }
  if (type === 4) {
    return { ...shared, type: 4, ...heights, ...fourPointSpans(member.object), maxHeight, moveWhat };
  }
  return {
    ...shared,
    type: 8,
    ...heights,
    maxHeight,
    betaInit: member.object.initialTiltDirection ?? 0,
    pointInitPos: member.object.driveAxes.map((axis) => {
      const mount = mountOf(axis);
      return [mount.x, 0, mount.z] as [number, number, number];
    }),
  };
};

export const buildInitialTransitionModels = (input: {
  members: readonly TransitionMember[];
  motors: readonly MotorConfig[];
  speedMode: PoseSpeedMode;
}): InitialTransitionModelInput[] =>
  input.members.map((member) => buildOne(member, input.motors, input.speedMode));
