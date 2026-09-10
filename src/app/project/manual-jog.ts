import type { ManualJogSettings, VirtualAxisId } from "./project-document-types";

export const DEFAULT_MANUAL_JOG: ManualJogSettings = {
  v1: { velocity: 20, accelDecelTime: 2 },
  v2: { velocity: 5, accelDecelTime: 2 },
  v3: { velocity: 5, accelDecelTime: 2 },
};

export const VIRTUAL_AXES: readonly VirtualAxisId[] = ["v1", "v2", "v3"];

export const DIMENSION_KEY_TO_VIRTUAL_AXIS: Record<string, VirtualAxisId> = {
  height: "v1",
  angle: "v1",
  pitch: "v2",
  yaw: "v3",
};

const isNonNegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

export const normalizeManualJog = (
  jog: ManualJogSettings | undefined,
): ManualJogSettings => {
  const result: ManualJogSettings = {};
  for (const axis of VIRTUAL_AXES) {
    const entry = jog?.[axis];
    const fallback = DEFAULT_MANUAL_JOG[axis]!;
    result[axis] = {
      velocity: isNonNegative(entry?.velocity) ? entry.velocity : fallback.velocity,
      accelDecelTime: isNonNegative(entry?.accelDecelTime)
        ? entry.accelDecelTime
        : fallback.accelDecelTime,
    };
  }
  return result;
};
