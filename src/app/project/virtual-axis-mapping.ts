import type { MotionAxisKind } from "./configuration-types";
import type { VirtualAxisId } from "./project-document-types";

export const virtualAxisForMotionKind = (kind: MotionAxisKind): VirtualAxisId => {
  if (kind === "swingX") return "v2";
  if (kind === "swingY" || kind === "yawY") return "v3";
  return "v1";
};

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
