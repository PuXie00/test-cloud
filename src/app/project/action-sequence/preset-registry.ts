import type {
  DynamicPresetBlock,
  ModelPose,
  PresetParamValue,
  StaticPresetBlock,
} from "./types";

export const DEFAULT_SPACING_MM = 1000;
export const DYNAMIC_WAVE_SAMPLE_INTERVAL_MS = 100;

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const ARC_FLAT_EPS_MM = 1e-6;
const SLOPE_MAX_DEG = 90;

export type ResolvedPresetPose = {
  sourceRef: string;
  sourceBlockId: string;
  objectId: number;
  atMs: number;
  pose: ModelPose;
};

export type PresetParamNumberField = {
  key: string;
  label: string;
  kind: "number";
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
};

export type PresetParamBooleanField = {
  key: string;
  label: string;
  kind: "boolean";
};

export type PresetParamEnumOption = {
  value: number;
  label: string;
};

export type PresetParamEnumField = {
  key: string;
  label: string;
  kind: "enum";
  options: readonly PresetParamEnumOption[];
};

export type PresetParamField = PresetParamNumberField | PresetParamBooleanField | PresetParamEnumField;

/** Reserved for world-space solvers (scheme B). Formation presets along object order ignore this. */
export type PresetResolveContext = {
  objects?: ReadonlyArray<{
    id: number;
    position?: { x: number; y?: number; z: number };
  }>;
};

export type PresetDefinition = {
  id: string;
  kind: "static" | "dynamic";
  label: string;
  minObjects: number;
  maxObjects?: number;
  paramFields: readonly PresetParamField[];
  defaultParams: () => Record<string, PresetParamValue>;
  migrateParams: (params: Record<string, PresetParamValue>) => Record<string, PresetParamValue>;
  resolve: (block: StaticPresetBlock | DynamicPresetBlock, ctx?: PresetResolveContext) => ResolvedPresetPose[];
  validateParams: (params: Record<string, PresetParamValue>) => string[];
};

type PresetBlock = StaticPresetBlock | DynamicPresetBlock;

const asStatic = (block: PresetBlock): StaticPresetBlock => block as StaticPresetBlock;
const asDynamic = (block: PresetBlock): DynamicPresetBlock => block as DynamicPresetBlock;

const poseOf = (v1: number, v2: number, v3: number): ModelPose => ({ v1, v2, v3 });

const heightPose = (heightMm: number, tiltDeg = 0): ModelPose => poseOf(heightMm, tiltDeg, 0);

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

const finiteNumber = (value: PresetParamValue | undefined, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const pickNumber = (
  params: Record<string, PresetParamValue>,
  keys: readonly string[],
  fallback: number,
): number => {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(params, key)) continue;
    return finiteNumber(params[key], fallback);
  }
  return fallback;
};

const pickBoolean = (
  params: Record<string, PresetParamValue>,
  key: string,
  fallback: boolean,
): boolean => (typeof params[key] === "boolean" ? params[key] : fallback);

const pickDirection = (params: Record<string, PresetParamValue>): 1 | -1 => {
  const value = params.direction;
  return value === -1 ? -1 : 1;
};

const num = (params: Record<string, PresetParamValue>, key: string): number => params[key] as number;
const flag = (params: Record<string, PresetParamValue>, key: string): boolean => params[key] as boolean;

const numberField = (
  key: string,
  label: string,
  unit: string | undefined,
  extras: Partial<Pick<PresetParamNumberField, "min" | "max" | "step" | "precision">> = {},
): PresetParamNumberField => ({
  key,
  label,
  kind: "number",
  ...(unit ? { unit } : {}),
  step: extras.step ?? 1,
  precision: extras.precision ?? 1,
  ...("min" in extras ? { min: extras.min } : {}),
  ...("max" in extras ? { max: extras.max } : {}),
});

const booleanField = (key: string, label: string): PresetParamBooleanField => ({
  key,
  label,
  kind: "boolean",
});

const enumField = (
  key: string,
  label: string,
  options: readonly PresetParamEnumOption[],
): PresetParamEnumField => ({
  key,
  label,
  kind: "enum",
  options,
});

const HEIGHT_MM = numberField("heightMm", "高度", "mm");
const BASE_HEIGHT_MM = numberField("baseHeightMm", "基准高度", "mm");
const SPACING_MM = numberField("spacingMm", "间距", "mm", { min: 1 });
const AMPLITUDE_MM = numberField("amplitudeMm", "振幅", "mm");
const PHASE_DEG = numberField("phaseDeg", "相位", "°");
const INTERVAL_DEG = numberField("intervalDeg", "间隔系数", "°");
const SAGITTA_MM = numberField("sagittaMm", "矢高", "mm");
const SLOPE_DEG = numberField("slopeDeg", "斜率", "°", { min: -89, max: 89 });
const ALIGN_SLOPE = booleanField("alignTilt", "贴合斜面");
const ALIGN_TANGENT = booleanField("alignTilt", "贴合切线");
const START_HEIGHT_MM = numberField("startHeightMm", "起点高度", "mm");
const END_HEIGHT_MM = numberField("endHeightMm", "目标高度", "mm");
const CYCLES = numberField("cycles", "周期数", undefined, { min: 0, step: 0.1, precision: 1 });
const DIRECTION = enumField("direction", "方向", [
  { value: 1, label: "沿顺序" },
  { value: -1, label: "逆顺序" },
]);

const validateFromFields = (
  fields: readonly PresetParamField[],
  params: Record<string, PresetParamValue>,
): string[] => {
  const errors: string[] = [];
  const allowed = new Set(fields.map((field) => field.key));
  for (const key of Object.keys(params)) {
    if (!allowed.has(key)) errors.push(`unknown parameter: ${key}`);
  }
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(params, field.key)) {
      errors.push(`missing parameter: ${field.key}`);
      continue;
    }
    const value = params[field.key];
    if (field.kind === "number") {
      if (typeof value !== "number") {
        errors.push(`parameter ${field.key} must be a number`);
        continue;
      }
      if (!Number.isFinite(value)) {
        errors.push(`parameter ${field.key} must be finite`);
      }
      continue;
    }
    if (field.kind === "boolean") {
      if (typeof value !== "boolean") {
        errors.push(`parameter ${field.key} must be a boolean`);
      }
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value) || !field.options.some((option) => option.value === value)) {
      errors.push(`parameter ${field.key} must be ${field.options.map((option) => option.value).join(" or ")}`);
    }
  }
  return errors;
};

const withSpacingAndSlopeChecks = (
  fields: readonly PresetParamField[],
  params: Record<string, PresetParamValue>,
  extras?: (params: Record<string, PresetParamValue>) => string[],
): string[] => {
  const errors = validateFromFields(fields, params);
  const spacingMm = params.spacingMm;
  if (typeof spacingMm === "number" && Number.isFinite(spacingMm) && spacingMm <= 0) {
    errors.push("parameter spacingMm must be > 0");
  }
  const slopeDeg = params.slopeDeg;
  if (typeof slopeDeg === "number" && Number.isFinite(slopeDeg) && Math.abs(slopeDeg) >= SLOPE_MAX_DEG) {
    errors.push("parameter slopeDeg must be > -90 and < 90");
  }
  const cycles = params.cycles;
  if (typeof cycles === "number" && Number.isFinite(cycles) && cycles < 0) {
    errors.push("parameter cycles must be >= 0");
  }
  if (extras) errors.push(...extras(params));
  return errors;
};

const migrateByFields = (
  fields: readonly PresetParamField[],
  params: Record<string, PresetParamValue>,
  resolved: Record<string, PresetParamValue>,
): Record<string, PresetParamValue> => {
  const next: Record<string, PresetParamValue> = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(resolved, field.key)) {
      next[field.key] = resolved[field.key] as PresetParamValue;
      continue;
    }
    const current = params[field.key];
    if (current !== undefined) next[field.key] = current;
  }
  return next;
};

const slopeDegFromRise = (riseMm: number, spacingMm: number): number => {
  const run = spacingMm > 0 ? spacingMm : DEFAULT_SPACING_MM;
  return Math.atan(riseMm / run) * RAD_TO_DEG;
};

const mapParticipants = (
  block: StaticPresetBlock,
  poseAt: (participantIndex: number, count: number) => ModelPose,
): ResolvedPresetPose[] => {
  const count = block.orderedObjectIds.length;
  return block.orderedObjectIds.map((objectId, participantIndex) =>
    pointOf(block, objectId, 0, block.atMs, poseAt(participantIndex, count)),
  );
};

const circularArcHeightAndTilt = (
  sAlongMm: number,
  chordMm: number,
  baseHeightMm: number,
  sagittaMm: number,
): { heightMm: number; tiltDeg: number } => {
  if (chordMm <= 0 || Math.abs(sagittaMm) < ARC_FLAT_EPS_MM) {
    return { heightMm: baseHeightMm, tiltDeg: 0 };
  }
  const radiusMm = (chordMm * chordMm) / (8 * Math.abs(sagittaMm)) + Math.abs(sagittaMm) / 2;
  const cx = chordMm / 2;
  const sign = sagittaMm > 0 ? 1 : -1;
  const cy = baseHeightMm + sagittaMm - sign * radiusMm;
  const x = Math.min(Math.max(sAlongMm, 0), chordMm);
  const dx = x - cx;
  const root = Math.sqrt(Math.max(radiusMm * radiusMm - dx * dx, 0));
  const heightMm = cy + sign * root;
  const rise = heightMm - cy;
  const tiltDeg = Math.abs(rise) < 1e-12 ? (dx === 0 ? 0 : sign * 90) : Math.atan(-dx / rise) * RAD_TO_DEG;
  return { heightMm, tiltDeg };
};

const waveHeightAndTilt = (
  participantIndex: number,
  baseHeightMm: number,
  amplitudeMm: number,
  phaseRad: number,
  intervalRad: number,
  spacingMm: number,
): { heightMm: number; tiltDeg: number } => {
  const phase = phaseRad + participantIndex * intervalRad;
  const heightMm = baseHeightMm + amplitudeMm * Math.sin(phase);
  if (spacingMm <= 0) return { heightMm, tiltDeg: 0 };
  const slope = amplitudeMm * Math.cos(phase) * (intervalRad / spacingMm);
  return { heightMm, tiltDeg: Math.atan(slope) * RAD_TO_DEG };
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

const FLAT_FIELDS = [HEIGHT_MM] as const;

const staticFlat: PresetDefinition = {
  id: "static-flat",
  kind: "static",
  label: "平面",
  minObjects: 2,
  paramFields: FLAT_FIELDS,
  defaultParams: () => ({ heightMm: 0 }),
  migrateParams: (params) =>
    migrateByFields(FLAT_FIELDS, params, {
      heightMm: pickNumber(params, ["heightMm", "v1"], 0),
    }),
  validateParams: (params) => validateFromFields(FLAT_FIELDS, params),
  resolve: (block) => {
    const heightMm = num(asStatic(block).params, "heightMm");
    const pose = heightPose(heightMm);
    return mapParticipants(asStatic(block), () => pose);
  },
};

const SLOPE_FIELDS = [BASE_HEIGHT_MM, SLOPE_DEG, SPACING_MM, ALIGN_SLOPE] as const;

const staticSlope: PresetDefinition = {
  id: "static-slope",
  kind: "static",
  label: "斜面",
  minObjects: 2,
  paramFields: SLOPE_FIELDS,
  defaultParams: () => ({
    baseHeightMm: 0,
    slopeDeg: 10,
    spacingMm: DEFAULT_SPACING_MM,
    alignTilt: true,
  }),
  migrateParams: (params) => {
    const spacingMm = pickNumber(params, ["spacingMm"], DEFAULT_SPACING_MM);
    const slopeDeg = Object.prototype.hasOwnProperty.call(params, "slopeDeg")
      ? finiteNumber(params.slopeDeg, 0)
      : slopeDegFromRise(pickNumber(params, ["stepV1"], 0), spacingMm);
    return migrateByFields(SLOPE_FIELDS, params, {
      baseHeightMm: pickNumber(params, ["baseHeightMm", "baseV1"], 0),
      slopeDeg,
      spacingMm,
      alignTilt: pickBoolean(params, "alignTilt", true),
    });
  },
  validateParams: (params) => withSpacingAndSlopeChecks(SLOPE_FIELDS, params),
  resolve: (block) => {
    const staticBlock = asStatic(block);
    const baseHeightMm = num(staticBlock.params, "baseHeightMm");
    const slopeDeg = num(staticBlock.params, "slopeDeg");
    const spacingMm = num(staticBlock.params, "spacingMm");
    const tiltDeg = flag(staticBlock.params, "alignTilt") ? slopeDeg : 0;
    const risePerStep = spacingMm * Math.tan(slopeDeg * DEG_TO_RAD);
    return mapParticipants(staticBlock, (participantIndex) =>
      heightPose(baseHeightMm + participantIndex * risePerStep, tiltDeg),
    );
  },
};

const ARC_FIELDS = [BASE_HEIGHT_MM, SAGITTA_MM, SPACING_MM, ALIGN_TANGENT] as const;

const staticArc: PresetDefinition = {
  id: "static-arc",
  kind: "static",
  label: "弧形",
  minObjects: 2,
  paramFields: ARC_FIELDS,
  defaultParams: () => ({
    baseHeightMm: 0,
    sagittaMm: 100,
    spacingMm: DEFAULT_SPACING_MM,
    alignTilt: true,
  }),
  migrateParams: (params) =>
    migrateByFields(ARC_FIELDS, params, {
      baseHeightMm: pickNumber(params, ["baseHeightMm", "baseV1"], 0),
      sagittaMm: pickNumber(params, ["sagittaMm", "amplitude"], 0),
      spacingMm: pickNumber(params, ["spacingMm"], DEFAULT_SPACING_MM),
      alignTilt: pickBoolean(params, "alignTilt", true),
    }),
  validateParams: (params) => withSpacingAndSlopeChecks(ARC_FIELDS, params),
  resolve: (block) => {
    const staticBlock = asStatic(block);
    const baseHeightMm = num(staticBlock.params, "baseHeightMm");
    const sagittaMm = num(staticBlock.params, "sagittaMm");
    const spacingMm = num(staticBlock.params, "spacingMm");
    const alignTilt = flag(staticBlock.params, "alignTilt");
    const chordMm = Math.max(0, (staticBlock.orderedObjectIds.length - 1) * spacingMm);
    return mapParticipants(staticBlock, (participantIndex) => {
      const { heightMm, tiltDeg } = circularArcHeightAndTilt(
        participantIndex * spacingMm,
        chordMm,
        baseHeightMm,
        sagittaMm,
      );
      return heightPose(heightMm, alignTilt ? tiltDeg : 0);
    });
  },
};

const STATIC_WAVE_FIELDS = [
  BASE_HEIGHT_MM,
  AMPLITUDE_MM,
  PHASE_DEG,
  INTERVAL_DEG,
  SPACING_MM,
  ALIGN_TANGENT,
] as const;

const staticWave: PresetDefinition = {
  id: "static-wave",
  kind: "static",
  label: "静态波浪",
  minObjects: 2,
  paramFields: STATIC_WAVE_FIELDS,
  defaultParams: () => ({
    baseHeightMm: 0,
    amplitudeMm: 100,
    phaseDeg: 0,
    intervalDeg: 90,
    spacingMm: DEFAULT_SPACING_MM,
    alignTilt: true,
  }),
  migrateParams: (params) =>
    migrateByFields(STATIC_WAVE_FIELDS, params, {
      baseHeightMm: pickNumber(params, ["baseHeightMm", "baseV1"], 0),
      amplitudeMm: pickNumber(params, ["amplitudeMm", "amplitude"], 0),
      phaseDeg: pickNumber(params, ["phaseDeg"], 0),
      intervalDeg: pickNumber(params, ["intervalDeg"], 90),
      spacingMm: pickNumber(params, ["spacingMm"], DEFAULT_SPACING_MM),
      alignTilt: pickBoolean(params, "alignTilt", true),
    }),
  validateParams: (params) => withSpacingAndSlopeChecks(STATIC_WAVE_FIELDS, params),
  resolve: (block) => {
    const staticBlock = asStatic(block);
    const baseHeightMm = num(staticBlock.params, "baseHeightMm");
    const amplitudeMm = num(staticBlock.params, "amplitudeMm");
    const phaseRad = num(staticBlock.params, "phaseDeg") * DEG_TO_RAD;
    const intervalRad = num(staticBlock.params, "intervalDeg") * DEG_TO_RAD;
    const spacingMm = num(staticBlock.params, "spacingMm");
    const alignTilt = flag(staticBlock.params, "alignTilt");
    return mapParticipants(staticBlock, (participantIndex) => {
      const { heightMm, tiltDeg } = waveHeightAndTilt(
        participantIndex,
        baseHeightMm,
        amplitudeMm,
        phaseRad,
        intervalRad,
        spacingMm,
      );
      return heightPose(heightMm, alignTilt ? tiltDeg : 0);
    });
  },
};

const LEVEL_FIELDS = [START_HEIGHT_MM, END_HEIGHT_MM] as const;

const dynamicLevel: PresetDefinition = {
  id: "dynamic-level",
  kind: "dynamic",
  label: "水平升降",
  minObjects: 2,
  paramFields: LEVEL_FIELDS,
  defaultParams: () => ({
    startHeightMm: 0,
    endHeightMm: 100,
  }),
  migrateParams: (params) =>
    migrateByFields(LEVEL_FIELDS, params, {
      startHeightMm: pickNumber(params, ["startHeightMm", "startV1"], 0),
      endHeightMm: pickNumber(params, ["endHeightMm", "targetV1"], 0),
    }),
  validateParams: (params) => validateFromFields(LEVEL_FIELDS, params),
  resolve: (block) => {
    const dyn = asDynamic(block);
    const startHeightMm = num(dyn.params, "startHeightMm");
    const endHeightMm = num(dyn.params, "endHeightMm");
    const startPose = heightPose(startHeightMm);
    const endPose = heightPose(endHeightMm);
    const points: ResolvedPresetPose[] = [];
    for (const objectId of dyn.orderedObjectIds) {
      points.push(pointOf(dyn, objectId, 0, dyn.startMs, startPose));
      points.push(pointOf(dyn, objectId, 1, dyn.endMs, endPose));
    }
    return points;
  },
};

const DYNAMIC_WAVE_FIELDS = [BASE_HEIGHT_MM, AMPLITUDE_MM, CYCLES, DIRECTION, INTERVAL_DEG] as const;

const dynamicWave: PresetDefinition = {
  id: "dynamic-wave",
  kind: "dynamic",
  label: "行进波浪",
  minObjects: 2,
  paramFields: DYNAMIC_WAVE_FIELDS,
  defaultParams: () => ({
    baseHeightMm: 0,
    amplitudeMm: 100,
    cycles: 1,
    direction: 1,
    intervalDeg: 90,
  }),
  migrateParams: (params) =>
    migrateByFields(DYNAMIC_WAVE_FIELDS, params, {
      baseHeightMm: pickNumber(params, ["baseHeightMm", "baseV1"], 0),
      amplitudeMm: pickNumber(params, ["amplitudeMm", "amplitude"], 0),
      cycles: pickNumber(params, ["cycles"], 1),
      direction: pickDirection(params),
      intervalDeg: pickNumber(params, ["intervalDeg"], 90),
    }),
  validateParams: (params) => withSpacingAndSlopeChecks(DYNAMIC_WAVE_FIELDS, params),
  resolve: (block) => {
    const dyn = asDynamic(block);
    const baseHeightMm = num(dyn.params, "baseHeightMm");
    const amplitudeMm = num(dyn.params, "amplitudeMm");
    const cycles = num(dyn.params, "cycles");
    const direction = num(dyn.params, "direction");
    const intervalRad = num(dyn.params, "intervalDeg") * DEG_TO_RAD;
    const times = sampleTimesMs(dyn.startMs, dyn.endMs, DYNAMIC_WAVE_SAMPLE_INTERVAL_MS);
    const durationMs = dyn.endMs - dyn.startMs;
    const points: ResolvedPresetPose[] = [];
    dyn.orderedObjectIds.forEach((objectId, participantIndex) => {
      const spatial = direction * participantIndex * intervalRad;
      times.forEach((atMs, index) => {
        const tNorm = durationMs === 0 ? 0 : (atMs - dyn.startMs) / durationMs;
        const heightMm = baseHeightMm + amplitudeMm * Math.sin(2 * Math.PI * cycles * tNorm + spatial);
        points.push(pointOf(dyn, objectId, index, atMs, heightPose(heightMm)));
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

export const listPresetDefinitions = (kind?: PresetDefinition["kind"]): PresetDefinition[] =>
  Object.values(PRESETS).filter((definition) => kind === undefined || definition.kind === kind);

export const migratePresetParams = (
  presetId: string,
  params: Record<string, PresetParamValue>,
): Record<string, PresetParamValue> => {
  const definition = getPresetDefinition(presetId);
  if (!definition) return { ...params };
  return definition.migrateParams(params);
};

export const resolvePreset = (
  block: StaticPresetBlock | DynamicPresetBlock,
  ctx?: PresetResolveContext,
): ResolvedPresetPose[] => {
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
  return definition.resolve(block, ctx);
};
