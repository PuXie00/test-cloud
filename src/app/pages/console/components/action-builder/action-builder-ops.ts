import type {
  ActionSequenceConfig,
  PresetParamValue,
} from "@/app/project/action-sequence/types";
import type { ControlledObject } from "./timeline/timeline-data";

export type TimelineObjectLookup = (objectId: number) => ControlledObject | undefined;

export const DEFAULT_BLOCK_MS = 3000;

export const nextId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export const createEmptySequence = (id: number, name?: string): ActionSequenceConfig => ({
  id,
  name: name ?? "新建动作序列",
  trajectoryMode: "non-forced",
  loop: false,
  blocks: [],
  segments: [],
});

export const defaultPresetParams = (
  presetId: string,
  extras?: { amplitude?: number; phase?: number },
): Record<string, PresetParamValue> | null => {
  const amplitude = extras?.amplitude ?? 100;
  const phase = extras?.phase ?? 0;
  switch (presetId) {
    case "static-flat":
      return { v1: 0, v2: 0, v3: 0 };
    case "static-slope":
      return { baseV1: 0, stepV1: amplitude, v2: 0, v3: 0 };
    case "static-arc":
      return { baseV1: 0, amplitude, v2: 0, v3: 0 };
    case "static-wave":
      return { baseV1: 0, amplitude, phaseDeg: phase, intervalDeg: 90, v2: 0, v3: 0 };
    case "dynamic-level":
      return { startV1: 0, targetV1: amplitude, v2: 0, v3: 0 };
    case "dynamic-wave":
      return {
        baseV1: 0,
        amplitude,
        cycles: 1,
        direction: 1,
        intervalDeg: 90,
        sampleIntervalMs: 500,
        v2: 0,
        v3: 0,
      };
    default:
      return null;
  }
};
