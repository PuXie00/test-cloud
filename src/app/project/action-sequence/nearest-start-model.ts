import { CONTROL_TYPE_RULES } from "@/app/project/configuration-rules";
import { decodeControlType } from "@/app/project/control-type-code";
import type {
  ControlledObjectConfig,
  DriveAxisBinding,
  MotorConfig,
  VirtualAxisId,
} from "@/app/project/project-document-types";
import {
  motionAxisIdForVirtualAxis,
  motionParamsOfKind,
} from "@/app/project/virtual-axis-mapping";
import { resolveVirtualAxisMaxVelocity } from "@/app/project/virtual-axis-max-velocity";
import type { NearestStartGeometry, NearestStartMember } from "./nearest-start";
import { ZERO_VAD, type AxisVad } from "./nearest-start-motion";
import type { ModelPose } from "./types";

const AXES: readonly VirtualAxisId[] = ["v1", "v2", "v3"];

const mountOf = (axis: DriveAxisBinding): { x: number; z: number } => axis.mount ?? { x: 0, z: 0 };

const positive = (value: number | undefined, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;

const paramsFor = (object: ControlledObjectConfig, axis: VirtualAxisId) =>
  object.motionParams[motionAxisIdForVirtualAxis(axis)];

const defaultVadFor = (object: ControlledObjectConfig, axis: VirtualAxisId): AxisVad => {
  if (!object.enabledVirtualAxes.includes(axis)) return ZERO_VAD;
  const params = paramsFor(object, axis);
  if (!params) return ZERO_VAD;
  return {
    velocity: params.speed,
    acceleration: params.acceleration,
    deceleration: params.acceleration,
  };
};

const maxVadFor = (
  object: ControlledObjectConfig,
  motors: readonly MotorConfig[],
  axis: VirtualAxisId,
): AxisVad => {
  if (!object.enabledVirtualAxes.includes(axis)) return ZERO_VAD;
  const params = paramsFor(object, axis);
  if (!params) return ZERO_VAD;
  const velocity = resolveVirtualAxisMaxVelocity(object, motors)[axis] ?? params.speed;
  const acceleration = params.minAccelTime > 0 ? velocity / params.minAccelTime : 0;
  return { velocity, acceleration, deceleration: acceleration };
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

const baseHeights = (object: ControlledObjectConfig): { baseHeight1: number; baseHeight2: number } =>
  object.modelRunDirection === 2
    ? { baseHeight1: 0, baseHeight2: object.pulleyDistance }
    : { baseHeight1: object.pulleyDistance, baseHeight2: 0 };

const maxHeightFor = (object: ControlledObjectConfig): number =>
  positive(
    motionParamsOfKind(
      CONTROL_TYPE_RULES[decodeControlType(object.controlType)].motionAxes,
      object.motionParams,
      "move",
    )?.maxAngle,
    positive(object.dimensions.h, 1),
  );

const twoPointLength = (object: ControlledObjectConfig): number => {
  const [first, second] = object.driveAxes;
  if (!first || !second) return positive(object.dimensions.w, 1);
  const start = mountOf(first);
  const end = mountOf(second);
  return positive(Math.hypot(start.x - end.x, start.z - end.z), positive(object.dimensions.w, 1));
};

const fourPointSpans = (
  object: ControlledObjectConfig,
): { lengthInside: number; widthInside: number } => {
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

export const nearestStartGeometryFor = (object: ControlledObjectConfig): NearestStartGeometry => {
  const kind = decodeControlType(object.controlType);
  const heights = baseHeights(object);
  const maxHeight = maxHeightFor(object);
  if (kind === "twoPointSwing") {
    return { type: 2, ...heights, lengthInside: twoPointLength(object), maxHeight };
  }
  if (kind === "fourPointSwing" || kind === "dualTiltFourPointSwing") {
    return { type: 4, ...heights, ...fourPointSpans(object), maxHeight };
  }
  if (kind === "multiPointSwing") {
    return {
      type: 8,
      ...heights,
      maxHeight,
      betaInit: object.initialTiltDirection ?? 0,
      pointInitPos: object.driveAxes.map((axis) => {
        const mount = mountOf(axis);
        return [mount.x, mount.z, 0] as [number, number, number];
      }),
    };
  }
  return { type: 1 };
};

export const buildNearestStartMember = (
  object: ControlledObjectConfig,
  motors: readonly MotorConfig[],
  current: ModelPose,
): NearestStartMember => ({
  objectId: object.id,
  activeAxes: AXES.filter((axis) => object.enabledVirtualAxes.includes(axis)),
  current,
  defaultVad: {
    v1: defaultVadFor(object, "v1"),
    v2: defaultVadFor(object, "v2"),
    v3: defaultVadFor(object, "v3"),
  },
  maxVad: {
    v1: maxVadFor(object, motors, "v1"),
    v2: maxVadFor(object, motors, "v2"),
    v3: maxVadFor(object, motors, "v3"),
  },
  maxMotorVelocity: maxMotorVelocityFor(object, motors),
  geometry: nearestStartGeometryFor(object),
});
