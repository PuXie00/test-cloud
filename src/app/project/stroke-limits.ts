import type { ControlType, MotionAxisId, MotionAxisParams } from "./configuration-types";

/** 一端行程（最小或最大行程）允许的取值区间，单位同运动参数（mm / deg） */
export type StrokeBound = { min: number; max: number };

export type StrokeLimits = { minStroke: StrokeBound; maxStroke: StrokeBound };

/** 主控描述里不设上限的写法（uint32 最大值） */
const UNBOUNDED = 4294967295;

const NON_NEGATIVE: StrokeLimits = {
  minStroke: { min: 0, max: UNBOUNDED },
  maxStroke: { min: 0, max: UNBOUNDED },
};

/** 摆动 / 倾斜角：最小行程在 [下限, 0]，最大行程不小于 0 */
const angleLimits = (minStrokeFloor: number): StrokeLimits => ({
  minStroke: { min: minStrokeFloor, max: 0 },
  maxStroke: { min: 0, max: UNBOUNDED },
});

/**
 * 各物体类型的行程范围（来自主控物体描述，每种类型不同）；
 * h / p / y 对应运动参数的高度（或旋转角度）、角度（X 倾斜）、偏转（Y 倾斜）。轨道车、占位没有行程
 */
export const STROKE_LIMITS: Record<ControlType, Partial<Record<MotionAxisId, StrokeLimits>>> = {
  singlePointMove: { h: NON_NEGATIVE },
  singlePointRotation: { h: NON_NEGATIVE },
  continuousRotation: { h: NON_NEGATIVE },
  multiLevelHoist: {
    h: {
      minStroke: { min: -200000, max: 0 },
      maxStroke: { min: 0, max: 200000 },
    },
  },
  multiPointSwing: { h: NON_NEGATIVE, p: angleLimits(-89.9), y: angleLimits(-3000) },
  dualTiltFourPointSwing: { h: NON_NEGATIVE, p: angleLimits(-89.9), y: angleLimits(-89.9) },
  railCar: {},
  staticProp: {},
};

const intersect = (a: StrokeBound, b: StrokeBound): StrokeBound => ({
  min: Math.max(a.min, b.min),
  max: Math.min(a.max, b.max),
});

/** 几种物体一起改（批量）时取各自范围的交集；都没有这根轴的限制时为 undefined */
export const strokeLimitsFor = (
  controlTypes: Iterable<ControlType>,
  axisId: MotionAxisId,
): StrokeLimits | undefined => {
  let result: StrokeLimits | undefined;
  for (const controlType of controlTypes) {
    const limits = STROKE_LIMITS[controlType][axisId];
    if (!limits) continue;
    result = result
      ? {
          minStroke: intersect(result.minStroke, limits.minStroke),
          maxStroke: intersect(result.maxStroke, limits.maxStroke),
        }
      : limits;
  }
  return result;
};

const clampTo = (value: number, bound: StrokeBound): number =>
  Math.min(bound.max, Math.max(bound.min, value));

/** 把运动参数的行程收进该类型的范围（如切换类型后沿用的旧参数） */
export const clampStroke = (
  params: MotionAxisParams,
  limits: StrokeLimits | undefined,
): MotionAxisParams => {
  if (!limits) return params;
  const minAngle = clampTo(params.minAngle, limits.minStroke);
  const maxAngle = clampTo(params.maxAngle, limits.maxStroke);
  return minAngle === params.minAngle && maxAngle === params.maxAngle
    ? params
    : { ...params, minAngle, maxAngle };
};
