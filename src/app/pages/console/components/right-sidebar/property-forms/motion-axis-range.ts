import type { MotionAxisKind, MotionAxisParams } from "@/app/project/configuration-types";

export type AxisRangeConfig = {
  label: string;
  minKey: keyof MotionAxisParams;
  maxKey: keyof MotionAxisParams;
  specKey: keyof MotionAxisParams;
  minAriaLabel: string;
  maxAriaLabel: string;
};

export const AXIS_RANGE_CONFIG: Record<MotionAxisKind, AxisRangeConfig> = {
  move: {
    label: "行程范围",
    minKey: "minAngle",
    maxKey: "maxAngle",
    specKey: "maxAngle",
    minAriaLabel: "移动行程下限",
    maxAriaLabel: "移动行程上限",
  },
  rotation: {
    label: "行程范围",
    minKey: "minAngle",
    maxKey: "maxAngle",
    specKey: "maxAngle",
    minAriaLabel: "旋转行程下限",
    maxAriaLabel: "旋转行程上限",
  },
  swingX: {
    label: "摆动 X 范围",
    minKey: "minAngle",
    maxKey: "maxAngle",
    specKey: "minAngle",
    minAriaLabel: "摆动 X 范围下限",
    maxAriaLabel: "摆动 X 范围上限",
  },
  swingY: {
    label: "摆动 Y 范围",
    minKey: "minAngle",
    maxKey: "maxAngle",
    specKey: "minAngle",
    minAriaLabel: "摆动 Y 范围下限",
    maxAriaLabel: "摆动 Y 范围上限",
  },
  yawY: {
    label: "偏转角范围",
    minKey: "minAngle",
    maxKey: "maxAngle",
    specKey: "minAngle",
    minAriaLabel: "偏转角范围下限",
    maxAriaLabel: "偏转角范围上限",
  },
};
