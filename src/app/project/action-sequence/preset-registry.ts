import type { VirtualAxisId } from "../project-document-types";
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

export type PresetParamChoice = {
  value: number;
  label: string;
};

export type PresetParamField = {
  key: string;
  label: string;
  kind: "number" | "choice";
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
  options?: readonly PresetParamChoice[];
};

export type PresetDefinition = {
  id: string;
  kind: "static" | "dynamic";
  label: string;
  description: string;
  minObjects: number;
  maxObjects?: number;
  ownedAxes: readonly VirtualAxisId[];
  paramFields: readonly PresetParamField[];
  resolve: (block: StaticPresetBlock | DynamicPresetBlock) => ResolvedPresetPose[];
  validateParams: (params: Record<string, PresetParamValue>) => string[];
};

type PresetBlock = StaticPresetBlock | DynamicPresetBlock;

const DEG_TO_RAD = Math.PI / 180;

const asStatic = (block: PresetBlock): StaticPresetBlock => block as StaticPresetBlock;
const asDynamic = (block: PresetBlock): DynamicPresetBlock => block as DynamicPresetBlock;

const OWNED_V1: readonly VirtualAxisId[] = ["v1"];
const LEGACY_UNOWNED_PARAM_KEYS = new Set(["v2", "v3"]);

const poseOf = (v1: number): ModelPose => ({ v1, v2: 0, v3: 0 });

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

const fieldKeys = (fields: readonly PresetParamField[]): string[] => fields.map((field) => field.key);

const numericParams = (
  params: Record<string, PresetParamValue>,
  keys: readonly string[],
): string[] => {
  const errors: string[] = [];
  const allowed = new Set(keys);
  for (const key of Object.keys(params)) {
    if (!allowed.has(key) && !LEGACY_UNOWNED_PARAM_KEYS.has(key)) {
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

const STATIC_FLAT_FIELDS: readonly PresetParamField[] = [
  { key: "v1", label: "升降", kind: "number", unit: "mm", step: 1 },
];

const STATIC_SLOPE_FIELDS: readonly PresetParamField[] = [
  { key: "baseV1", label: "起点升降", kind: "number", unit: "mm", step: 1 },
  { key: "stepV1", label: "级差", kind: "number", unit: "mm", step: 1 },
];

const STATIC_ARC_FIELDS: readonly PresetParamField[] = [
  { key: "baseV1", label: "基准升降", kind: "number", unit: "mm", step: 1 },
  { key: "amplitude", label: "拱高", kind: "number", unit: "mm", step: 1 },
];

const STATIC_WAVE_FIELDS: readonly PresetParamField[] = [
  { key: "baseV1", label: "基准升降", kind: "number", unit: "mm", step: 1 },
  { key: "amplitude", label: "振幅", kind: "number", unit: "mm", step: 1 },
  { key: "phaseDeg", label: "相位", kind: "number", unit: "°", step: 1 },
  { key: "intervalDeg", label: "间隔", kind: "number", unit: "°", step: 1 },
];

const DYNAMIC_LEVEL_FIELDS: readonly PresetParamField[] = [
  { key: "startV1", label: "起点升降", kind: "number", unit: "mm", step: 1 },
  { key: "targetV1", label: "终点升降", kind: "number", unit: "mm", step: 1 },
];

const DYNAMIC_WAVE_FIELDS: readonly PresetParamField[] = [
  { key: "baseV1", label: "基准升降", kind: "number", unit: "mm", step: 1 },
  { key: "amplitude", label: "振幅", kind: "number", unit: "mm", step: 1 },
  { key: "cycles", label: "周期数", kind: "number", step: 0.5, min: 0 },
  {
    key: "direction",
    label: "方向",
    kind: "choice",
    options: [
      { value: 1, label: "正向" },
      { value: -1, label: "反向" },
    ],
  },
  { key: "intervalDeg", label: "间隔", kind: "number", unit: "°", step: 1 },
  { key: "sampleIntervalMs", label: "采样间隔", kind: "number", unit: "ms", step: 100, min: 1 },
];

const mapStatic = (
  block: StaticPresetBlock,
  v1At: (participantIndex: number, count: number) => number,
): ResolvedPresetPose[] => {
  const count = block.orderedObjectIds.length;
  return block.orderedObjectIds.map((objectId, participantIndex) =>
    pointOf(block, objectId, 0, block.atMs, poseOf(v1At(participantIndex, count))),
  );
};

const staticFlat: PresetDefinition = {
  id: "static-flat",
  kind: "static",
  label: "平面",
  description: "同一时刻全体同一位姿",
  minObjects: 2,
  ownedAxes: OWNED_V1,
  paramFields: STATIC_FLAT_FIELDS,
  validateParams: (params) => numericParams(params, fieldKeys(STATIC_FLAT_FIELDS)),
  resolve: (block) => {
    const { v1 } = numbers(asStatic(block).params);
    return mapStatic(asStatic(block), () => v1);
  },
};

const staticSlope: PresetDefinition = {
  id: "static-slope",
  kind: "static",
  label: "斜面",
  description: "沿参与顺序按级差排布升降",
  minObjects: 2,
  ownedAxes: OWNED_V1,
  paramFields: STATIC_SLOPE_FIELDS,
  validateParams: (params) => numericParams(params, fieldKeys(STATIC_SLOPE_FIELDS)),
  resolve: (block) => {
    const { baseV1, stepV1 } = numbers(asStatic(block).params);
    return mapStatic(asStatic(block), (participantIndex) => baseV1 + participantIndex * stepV1);
  },
};

const staticArc: PresetDefinition = {
  id: "static-arc",
  kind: "static",
  label: "弧形",
  description: "沿参与顺序形成拱形",
  minObjects: 2,
  ownedAxes: OWNED_V1,
  paramFields: STATIC_ARC_FIELDS,
  validateParams: (params) => numericParams(params, fieldKeys(STATIC_ARC_FIELDS)),
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
  label: "静态波浪",
  description: "沿参与顺序按相位采样正弦",
  minObjects: 2,
  ownedAxes: OWNED_V1,
  paramFields: STATIC_WAVE_FIELDS,
  validateParams: (params) => numericParams(params, fieldKeys(STATIC_WAVE_FIELDS)),
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
  label: "水平升降",
  description: "全体从起点升降到终点",
  minObjects: 2,
  ownedAxes: OWNED_V1,
  paramFields: DYNAMIC_LEVEL_FIELDS,
  validateParams: (params) => numericParams(params, fieldKeys(DYNAMIC_LEVEL_FIELDS)),
  resolve: (block) => {
    const dyn = asDynamic(block);
    const { startV1, targetV1 } = numbers(dyn.params);
    const points: ResolvedPresetPose[] = [];
    for (const objectId of dyn.orderedObjectIds) {
      points.push(pointOf(dyn, objectId, 0, dyn.startMs, poseOf(startV1)));
      points.push(pointOf(dyn, objectId, 1, dyn.endMs, poseOf(targetV1)));
    }
    return points;
  },
};

export const sampleTimesMs = (startMs: number, endMs: number, sampleIntervalMs: number): number[] => {
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
  label: "行进波浪",
  description: "沿时间推进的行进正弦波",
  minObjects: 2,
  ownedAxes: OWNED_V1,
  paramFields: DYNAMIC_WAVE_FIELDS,
  validateParams: (params) => {
    const errors = numericParams(params, fieldKeys(DYNAMIC_WAVE_FIELDS));
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
    const { baseV1, amplitude, cycles, direction, intervalDeg, sampleIntervalMs } = numbers(
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
        points.push(pointOf(dyn, objectId, index, atMs, poseOf(v1)));
      });
    });
    return points;
  },
};

const PRESET_ORDER = [
  staticFlat,
  staticSlope,
  staticArc,
  staticWave,
  dynamicLevel,
  dynamicWave,
] as const;

const PRESETS: Record<string, PresetDefinition> = Object.fromEntries(
  PRESET_ORDER.map((definition) => [definition.id, definition]),
);

export const getPresetDefinition = (presetId: string): PresetDefinition | undefined => PRESETS[presetId];

export const listPresetDefinitions = (kind?: "static" | "dynamic"): PresetDefinition[] =>
  PRESET_ORDER.filter((definition) => kind === undefined || definition.kind === kind);

export const presetLabelOf = (presetId: string): string => getPresetDefinition(presetId)?.label ?? presetId;

export const presetParamLabelOf = (presetId: string, key: string): string => {
  const field = getPresetDefinition(presetId)?.paramFields.find((item) => item.key === key);
  return field?.label ?? key;
};

export const countPosesPerObject = (
  points: readonly ResolvedPresetPose[],
): Map<number, number> => {
  const counts = new Map<number, number>();
  for (const point of points) {
    counts.set(point.objectId, (counts.get(point.objectId) ?? 0) + 1);
  }
  return counts;
};

const assertPoseContract = (
  definition: PresetDefinition,
  block: PresetBlock,
  points: ResolvedPresetPose[],
): void => {
  const expectedIds = [...block.orderedObjectIds];
  const grouped = new Map<number, ResolvedPresetPose[]>();
  for (const point of points) {
    const list = grouped.get(point.objectId);
    if (list) list.push(point);
    else grouped.set(point.objectId, [point]);
  }
  if (grouped.size !== expectedIds.length || expectedIds.some((id) => !grouped.has(id))) {
    throw new Error("preset pose objects must match orderedObjectIds");
  }
  for (const objectId of expectedIds) {
    const series = grouped.get(objectId) ?? [];
    if (definition.kind === "static") {
      if (series.length !== 1) {
        throw new Error("static preset must emit exactly 1 pose per object");
      }
      if (series[0]?.atMs !== asStatic(block).atMs) {
        throw new Error("static preset pose time must equal atMs");
      }
      continue;
    }
    if (series.length < 2) {
      throw new Error("dynamic preset must emit at least 2 poses per object");
    }
    const dyn = asDynamic(block);
    if (series[0]?.atMs !== dyn.startMs) {
      throw new Error("dynamic preset first pose must be at startMs");
    }
    if (series[series.length - 1]?.atMs !== dyn.endMs) {
      throw new Error("dynamic preset last pose must be at endMs");
    }
    for (let index = 1; index < series.length; index += 1) {
      const previous = series[index - 1];
      const current = series[index];
      if (previous === undefined || current === undefined) continue;
      if (current.atMs <= previous.atMs) {
        throw new Error("dynamic preset pose times must be strictly increasing");
      }
    }
  }
};

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
  const points = definition.resolve(block);
  assertPoseContract(definition, block, points);
  return points;
};
