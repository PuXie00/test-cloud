import type {
  DynamicPresetBlock,
  ModelPose,
  PresetParamValue,
  StaticPresetBlock,
} from "./types";

export type ResolvedPresetPose = {
  sourceRef: string;
  sourceBlockId: string;
  objectId: number;
  atMs: number;
  pose: ModelPose;
};

export type PresetDefinition = {
  id: string;
  kind: "static" | "dynamic";
  minObjects: number;
  maxObjects?: number;
  resolve: (block: StaticPresetBlock | DynamicPresetBlock) => ResolvedPresetPose[];
  validateParams: (params: Record<string, PresetParamValue>) => string[];
};

type PresetBlock = StaticPresetBlock | DynamicPresetBlock;

const DEG_TO_RAD = Math.PI / 180;

const asStatic = (block: PresetBlock): StaticPresetBlock => block as StaticPresetBlock;
const asDynamic = (block: PresetBlock): DynamicPresetBlock => block as DynamicPresetBlock;

const poseOf = (v1: number, v2: number, v3: number): ModelPose => ({ v1, v2, v3 });

const pointOf = (
  block: PresetBlock,
  objectId: number,
  index: number,
  atMs: number,
  pose: ModelPose,
): ResolvedPresetPose => ({
  sourceRef: `preset:${block.id}:${objectId}:${index}`,
  sourceBlockId: block.id,
  objectId,
  atMs,
  pose,
});

const numericParams = (
  params: Record<string, PresetParamValue>,
  keys: readonly string[],
): string[] => {
  const errors: string[] = [];
  const allowed = new Set(keys);
  for (const key of Object.keys(params)) {
    if (!allowed.has(key)) {
      errors.push(`unknown parameter: ${key}`);
    }
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(params, key)) {
      errors.push(`missing parameter: ${key}`);
      continue;
    }
    const value = params[key];
    if (typeof value !== "number") {
      errors.push(`parameter ${key} must be a number`);
      continue;
    }
    if (!Number.isFinite(value)) {
      errors.push(`parameter ${key} must be finite`);
    }
  }
  return errors;
};

const numbers = (params: Record<string, PresetParamValue>): Record<string, number> =>
  params as Record<string, number>;

const mapStatic = (
  block: StaticPresetBlock,
  v1At: (participantIndex: number, count: number) => number,
): ResolvedPresetPose[] => {
  const { v2, v3 } = numbers(block.params);
  const count = block.orderedObjectIds.length;
  return block.orderedObjectIds.map((objectId, participantIndex) =>
    pointOf(block, objectId, 0, block.atMs, poseOf(v1At(participantIndex, count), v2, v3)),
  );
};

const staticFlat: PresetDefinition = {
  id: "static-flat",
  kind: "static",
  minObjects: 2,
  validateParams: (params) => numericParams(params, ["v1", "v2", "v3"]),
  resolve: (block) => {
    const { v1 } = numbers(asStatic(block).params);
    return mapStatic(asStatic(block), () => v1);
  },
};

const staticSlope: PresetDefinition = {
  id: "static-slope",
  kind: "static",
  minObjects: 2,
  validateParams: (params) => numericParams(params, ["baseV1", "stepV1", "v2", "v3"]),
  resolve: (block) => {
    const { baseV1, stepV1 } = numbers(asStatic(block).params);
    return mapStatic(asStatic(block), (participantIndex) => baseV1 + participantIndex * stepV1);
  },
};

const staticArc: PresetDefinition = {
  id: "static-arc",
  kind: "static",
  minObjects: 2,
  validateParams: (params) => numericParams(params, ["baseV1", "amplitude", "v2", "v3"]),
  resolve: (block) => {
    const { baseV1, amplitude } = numbers(asStatic(block).params);
    return mapStatic(asStatic(block), (participantIndex, count) => {
      const span = Math.max(1, count - 1);
      return baseV1 + amplitude * Math.sin((Math.PI * participantIndex) / span);
    });
  },
};

const staticWave: PresetDefinition = {
  id: "static-wave",
  kind: "static",
  minObjects: 2,
  validateParams: (params) =>
    numericParams(params, ["baseV1", "amplitude", "phaseDeg", "intervalDeg", "v2", "v3"]),
  resolve: (block) => {
    const { baseV1, amplitude, phaseDeg, intervalDeg } = numbers(asStatic(block).params);
    return mapStatic(
      asStatic(block),
      (participantIndex) =>
        baseV1 + amplitude * Math.sin((phaseDeg + participantIndex * intervalDeg) * DEG_TO_RAD),
    );
  },
};

const dynamicLevel: PresetDefinition = {
  id: "dynamic-level",
  kind: "dynamic",
  minObjects: 2,
  validateParams: (params) => numericParams(params, ["startV1", "targetV1", "v2", "v3"]),
  resolve: (block) => {
    const dyn = asDynamic(block);
    const { startV1, targetV1, v2, v3 } = numbers(dyn.params);
    const points: ResolvedPresetPose[] = [];
    for (const objectId of dyn.orderedObjectIds) {
      points.push(pointOf(dyn, objectId, 0, dyn.startMs, poseOf(startV1, v2, v3)));
      points.push(pointOf(dyn, objectId, 1, dyn.endMs, poseOf(targetV1, v2, v3)));
    }
    return points;
  },
};

const sampleTimesMs = (startMs: number, endMs: number, sampleIntervalMs: number): number[] => {
  const times: number[] = [];
  const steps = Math.floor((endMs - startMs) / sampleIntervalMs);
  for (let step = 0; step <= steps; step += 1) {
    times.push(startMs + step * sampleIntervalMs);
  }
  if (times[times.length - 1] !== endMs) {
    times.push(endMs);
  }
  return times;
};

const dynamicWave: PresetDefinition = {
  id: "dynamic-wave",
  kind: "dynamic",
  minObjects: 2,
  validateParams: (params) => {
    const errors = numericParams(params, [
      "baseV1",
      "amplitude",
      "cycles",
      "direction",
      "intervalDeg",
      "sampleIntervalMs",
      "v2",
      "v3",
    ]);
    const sampleIntervalMs = params.sampleIntervalMs;
    if (typeof sampleIntervalMs === "number" && Number.isFinite(sampleIntervalMs) && sampleIntervalMs <= 0) {
      errors.push("parameter sampleIntervalMs must be > 0");
    }
    const direction = params.direction;
    if (typeof direction === "number" && Number.isFinite(direction) && direction !== 1 && direction !== -1) {
      errors.push("parameter direction must be 1 or -1");
    }
    return errors;
  },
  resolve: (block) => {
    const dyn = asDynamic(block);
    const { baseV1, amplitude, cycles, direction, intervalDeg, sampleIntervalMs, v2, v3 } = numbers(
      dyn.params,
    );
    const times = sampleTimesMs(dyn.startMs, dyn.endMs, sampleIntervalMs);
    const durationMs = dyn.endMs - dyn.startMs;
    const points: ResolvedPresetPose[] = [];
    dyn.orderedObjectIds.forEach((objectId, participantIndex) => {
      const spatial = direction * participantIndex * intervalDeg * DEG_TO_RAD;
      times.forEach((atMs, index) => {
        const tNorm = (atMs - dyn.startMs) / durationMs;
        const v1 = baseV1 + amplitude * Math.sin(2 * Math.PI * cycles * tNorm + spatial);
        points.push(pointOf(dyn, objectId, index, atMs, poseOf(v1, v2, v3)));
      });
    });
    return points;
  },
};

const PRESETS: Record<string, PresetDefinition> = {
  "static-flat": staticFlat,
  "static-slope": staticSlope,
  "static-arc": staticArc,
  "static-wave": staticWave,
  "dynamic-level": dynamicLevel,
  "dynamic-wave": dynamicWave,
};

export const getPresetDefinition = (presetId: string): PresetDefinition | undefined => PRESETS[presetId];

export const resolvePreset = (block: StaticPresetBlock | DynamicPresetBlock): ResolvedPresetPose[] => {
  const definition = getPresetDefinition(block.presetId);
  if (!definition) {
    throw new Error(`unknown preset: ${block.presetId}`);
  }
  const expectedKind = definition.kind === "static" ? "static-preset" : "dynamic-preset";
  if (block.kind !== expectedKind) {
    throw new Error(`preset ${block.presetId} kind is ${definition.kind} but block kind is ${block.kind}`);
  }
  if (block.orderedObjectIds.length < definition.minObjects) {
    throw new Error(`preset requires at least ${definition.minObjects} objects`);
  }
  if (definition.maxObjects !== undefined && block.orderedObjectIds.length > definition.maxObjects) {
    throw new Error(`preset allows at most ${definition.maxObjects} objects`);
  }
  const paramErrors = definition.validateParams(block.params);
  if (paramErrors.length > 0) {
    throw new Error(paramErrors.join("; "));
  }
  if (definition.kind === "static") {
    if (!Number.isFinite(asStatic(block).atMs)) {
      throw new Error("atMs must be finite");
    }
  } else {
    const dyn = asDynamic(block);
    if (!Number.isFinite(dyn.startMs) || !Number.isFinite(dyn.endMs)) {
      throw new Error("startMs and endMs must be finite");
    }
    if (dyn.endMs <= dyn.startMs) {
      throw new Error("dynamic preset endMs must be greater than startMs");
    }
  }
  return definition.resolve(block);
};
