import { maxDriveAxesForControlType, CONTROL_TYPE_RULES } from "@/app/project/configuration-rules";
import type { ControlType } from "@/app/project/configuration-types";

export type WizardMotionOption = {
  controlType: ControlType;
  title: string;
  detail: string;
};

export type WizardMotionGroup = {
  label: string;
  /** 每行占满 4 列的分组，还是和相邻分组各占 2 列 */
  span: 2 | 4;
  /** 占位类选项不放示意图 */
  compact?: boolean;
  options: WizardMotionOption[];
};

export const WIZARD_MOTION_GROUPS: readonly WizardMotionGroup[] = [
  {
    label: "移动",
    span: 2,
    options: [
      { controlType: "singlePointMove", title: "单点移动", detail: "沿一个方向直线移动" },
      { controlType: "multiLevelHoist", title: "多级升降", detail: "多节结构逐级升降" },
    ],
  },
  {
    label: "旋转",
    span: 2,
    options: [
      { controlType: "singlePointRotation", title: "单点旋转", detail: "在角度范围内转动" },
      { controlType: "continuousRotation", title: "无极旋转", detail: "可以连续转圈" },
    ],
  },
  {
    label: "摆动",
    span: 4,
    options: [
      { controlType: "twoPointSwing", title: "两点摆", detail: "移动并单向摆动" },
      { controlType: "fourPointSwing", title: "四点摆", detail: "移动并双向摆动" },
      { controlType: "dualTiltFourPointSwing", title: "多点倾斜", detail: "移动并双向倾斜" },
      { controlType: "multiPointSwing", title: "多点摆", detail: "移动、摆动并偏转" },
    ],
  },
  {
    label: "其他",
    span: 4,
    compact: true,
    options: [
      { controlType: "staticProp", title: "无控制", detail: "只在 3D 中占位，不运动" },
      { controlType: "railCar", title: "轨道车", detail: "暂不运动，可作为挂载载体" },
    ],
  },
];

export const formatAxisRequirement = (controlType: ControlType): string => {
  const minimum = CONTROL_TYPE_RULES[controlType].minimumDriveAxes;
  if (minimum === 0) return "不需要吊点";
  return maxDriveAxesForControlType(controlType) === minimum
    ? `固定 ${minimum} 吊点`
    : `${minimum} 吊点起`;
};
