import type { ControlType } from "./configuration-types";

/** 多级升降的分段配置（只有多级升降有） */
export type MultiLevelConfig = {
  /** 中间分段点的 H 位置，单位 mm；严格递增，不含行程端点 */
  adjustDistances: number[];
  /** 过分段点速度保留比例，单位 %，0–100 */
  decelerationRatio: number;
};

/** 中间分段点最多几个（nSections 0–10） */
export const MULTI_LEVEL_MAX_SECTIONS = 10;
export const DEFAULT_DECELERATION_RATIO = 50;
/** 分段点位置的取值范围（主控描述 ±200000 mm） */
export const ADJUST_DISTANCE_LIMIT = 200000;

type StrokeRange = { min: number; max: number };

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** 分段点主控精度 0.1 mm */
const roundTenth = (value: number): number => Math.round(value * 10) / 10;

const sortedUnique = (values: readonly number[]): number[] =>
  [...new Set(values)].sort((a, b) => a - b);

export const normalizeMultiLevelConfig = (value: unknown): MultiLevelConfig => {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const points = Array.isArray(record.adjustDistances)
    ? record.adjustDistances
        .filter(isFiniteNumber)
        .map((point) =>
          roundTenth(Math.min(ADJUST_DISTANCE_LIMIT, Math.max(-ADJUST_DISTANCE_LIMIT, point))),
        )
    : [];
  const ratio = record.decelerationRatio;
  return {
    adjustDistances: sortedUnique(points).slice(0, MULTI_LEVEL_MAX_SECTIONS),
    decelerationRatio: isFiniteNumber(ratio)
      ? Math.round(Math.min(100, Math.max(0, ratio)))
      : DEFAULT_DECELERATION_RATIO,
  };
};

export const controlTypeHasMultiLevelParams = (controlType: ControlType): boolean =>
  controlType === "multiLevelHoist";

/** 按控制类型补齐 / 剥离多级升降的分段配置 */
export const resolveMultiLevelParams = (
  controlType: ControlType,
  current?: { multiLevel?: unknown },
): { multiLevel?: MultiLevelConfig } =>
  controlTypeHasMultiLevelParams(controlType)
    ? { multiLevel: normalizeMultiLevelConfig(current?.multiLevel) }
    : {};

/** 分段点要在行程内，不含两端 */
export const isAdjustDistanceInStroke = (value: number, stroke: StrokeRange): boolean =>
  value > stroke.min && value < stroke.max;

export type AdjustDistanceEdit =
  | { ok: true; adjustDistances: number[] }
  | { ok: false; reason: string };

/**
 * 改第 index 个分段点（index 等于长度即新增）：要在行程内、不和别的点重复，
 * 结果按位置排好（严格递增）
 */
export const setAdjustDistance = (
  points: readonly number[],
  index: number,
  value: number,
  stroke: StrokeRange,
): AdjustDistanceEdit => {
  const next = roundTenth(value);
  if (!isAdjustDistanceInStroke(next, stroke)) {
    return { ok: false, reason: "分段点要在行程范围内，不含两端" };
  }
  const others = points.filter((_, at) => at !== index);
  if (others.includes(next)) return { ok: false, reason: "已经有这个位置的分段点" };
  if (others.length >= MULTI_LEVEL_MAX_SECTIONS) {
    return { ok: false, reason: `最多 ${MULTI_LEVEL_MAX_SECTIONS} 个分段点` };
  }
  return { ok: true, adjustDistances: sortedUnique([...others, next]) };
};

/** 新增分段点的默认位置：行程内最大空档的中点；没有空档时为 null */
export const nextAdjustDistance = (
  points: readonly number[],
  stroke: StrokeRange,
): number | null => {
  const inside = points.filter((point) => isAdjustDistanceInStroke(point, stroke));
  const edges = [stroke.min, ...sortedUnique(inside), stroke.max];
  let best: number | null = null;
  let widest = 0;
  for (let index = 1; index < edges.length; index += 1) {
    const gap = edges[index]! - edges[index - 1]!;
    const middle = roundTenth(edges[index - 1]! + gap / 2);
    if (gap > widest && middle > edges[index - 1]! && middle < edges[index]!) {
      widest = gap;
      best = middle;
    }
  }
  return best;
};

/** 下发主控的分段点：只发行程内的（行程改小后落在外面的不发） */
export const adjustDistancesForPlc = (
  points: readonly number[],
  stroke: StrokeRange,
): number[] => points.filter((point) => isAdjustDistanceInStroke(point, stroke));
