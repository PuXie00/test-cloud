import type { MotionAxisId, MotionAxisKind } from "./configuration-types";
import type { VirtualAxisId } from "./project-document-types";

export const MOTION_AXIS_IDS = ["h", "p", "y"] as const satisfies readonly MotionAxisId[];

const MOTION_AXIS_ID_BY_VIRTUAL_AXIS = {
  v1: "h",
  v2: "p",
  v3: "y",
} as const satisfies Record<VirtualAxisId, MotionAxisId>;

const VIRTUAL_AXIS_BY_MOTION_AXIS_ID = {
  h: "v1",
  p: "v2",
  y: "v3",
} as const satisfies Record<MotionAxisId, VirtualAxisId>;

export const motionAxisIdForVirtualAxis = (axis: VirtualAxisId): MotionAxisId =>
  MOTION_AXIS_ID_BY_VIRTUAL_AXIS[axis];

export const virtualAxisForMotionAxisId = (id: MotionAxisId): VirtualAxisId =>
  VIRTUAL_AXIS_BY_MOTION_AXIS_ID[id];

export const virtualAxisForMotionKind = (kind: MotionAxisKind): VirtualAxisId => {
  if (kind === "swingX") return "v2";
  if (kind === "swingY" || kind === "yawY") return "v3";
  return "v1";
};

/** 运动轴类型落在哪个 motionParams 键上：move / rotation → h，swingX → p，swingY / yawY → y */
export const motionAxisIdForKind = (kind: MotionAxisKind): MotionAxisId =>
  motionAxisIdForVirtualAxis(virtualAxisForMotionKind(kind));

/** 控制类型的 motionAxes 里，某个键对应的运动轴类型；该控制类型没有这根轴时为 undefined */
export const motionKindForAxisId = (
  motionAxes: readonly MotionAxisKind[],
  id: MotionAxisId,
): MotionAxisKind | undefined => motionAxes.find((kind) => motionAxisIdForKind(kind) === id);

/** 按运动轴类型取参数；控制类型没有该类型的轴时为 undefined（如旋转物体取 "move"） */
export const motionParamsOfKind = <T>(
  motionAxes: readonly MotionAxisKind[],
  motionParams: Partial<Record<MotionAxisId, T>> | undefined,
  kind: MotionAxisKind,
): T | undefined =>
  motionAxes.includes(kind) ? motionParams?.[motionAxisIdForKind(kind)] : undefined;

export const motionKindForVirtualAxis = (
  motionAxes: readonly MotionAxisKind[],
  axis: VirtualAxisId,
): MotionAxisKind => {
  if (axis === "v2") return "swingX";
  if (axis === "v3") return motionAxes.includes("swingY") ? "swingY" : "yawY";
  if (motionAxes.includes("rotation")) return "rotation";
  return "move";
};

export type VirtualAxisMotionKind = { axis: VirtualAxisId; kind: MotionAxisKind };

export const virtualAxisMotionKinds = (
  motionAxes: readonly MotionAxisKind[],
  enabledAxes: readonly VirtualAxisId[],
): VirtualAxisMotionKind[] =>
  enabledAxes.map((axis) => ({ axis, kind: motionKindForVirtualAxis(motionAxes, axis) }));

export type VirtualAxisDescriptor = {
  key: "height" | "angle" | "pitch" | "yaw" | "x" | "y";
  label: string;
  unit: string;
};

const KIND_DESCRIPTOR: Record<MotionAxisKind, VirtualAxisDescriptor> = {
  move:     { key: "height", label: "升降",   unit: "mm" },
  rotation: { key: "angle",  label: "旋转",   unit: "°" },
  swingX:   { key: "pitch",  label: "摆动 X", unit: "°" },
  swingY:   { key: "yaw",    label: "摆动 Y", unit: "°" },
  yawY:     { key: "yaw",    label: "偏转",   unit: "°" },
};

export const virtualAxisDescriptor = (
  motionAxes: readonly MotionAxisKind[],
  axis: VirtualAxisId,
): VirtualAxisDescriptor => KIND_DESCRIPTOR[motionKindForVirtualAxis(motionAxes, axis)];
