import type { DisplayAttribute } from "@shared/config";
import {
  getDisplayLengthFamilyUnit,
  isLengthFamilyUnit,
  normalizeLengthFamilyUnit,
  type DisplayLengthUnit,
} from "@/app/project/display-length-units";

/** 电机固定驱动参数：与描述文件 configurationAttributes.id 对齐 */
export const MOTOR_DRIVE_PARAM_IDS = {
  axisType: "axisType",
  workingStroke: "workingStroke",
  maxAxisVelocity: "maxAxisVelocity",
  reductionRatio: "reductionRatio",
  axisDirection: "axisDirection",
  positionError: "positionError",
  weightLow: "weightLow",
  weightHigh: "weightHigh",
  loadLow: "loadLow",
  loadHigh: "loadHigh",
} as const;

export type FixedMotorDriveParamId =
  (typeof MOTOR_DRIVE_PARAM_IDS)[keyof typeof MOTOR_DRIVE_PARAM_IDS];

/** 驱动参数表单字段（不含顶层 axisType） */
export const FIXED_MOTOR_DRIVE_PARAM_IDS = [
  MOTOR_DRIVE_PARAM_IDS.workingStroke,
  MOTOR_DRIVE_PARAM_IDS.maxAxisVelocity,
  MOTOR_DRIVE_PARAM_IDS.reductionRatio,
  MOTOR_DRIVE_PARAM_IDS.axisDirection,
  MOTOR_DRIVE_PARAM_IDS.positionError,
  MOTOR_DRIVE_PARAM_IDS.weightLow,
  MOTOR_DRIVE_PARAM_IDS.weightHigh,
  MOTOR_DRIVE_PARAM_IDS.loadLow,
  MOTOR_DRIVE_PARAM_IDS.loadHigh,
] as const satisfies readonly FixedMotorDriveParamId[];

export const AXIS_TYPE = {
  linear: 0,
  continuous: 1,
} as const;

export type AxisTypeCode = (typeof AXIS_TYPE)[keyof typeof AXIS_TYPE];

export const AXIS_TYPE_OPTIONS = [
  { label: "线性轴", value: String(AXIS_TYPE.linear) },
  { label: "无极旋转轴", value: String(AXIS_TYPE.continuous) },
] as const;

type AxisTypeFieldUi = {
  unit?: string;
  help: string;
};

type FixedDriveParamUi = {
  help?: string;
  byAxisType?: Partial<Record<AxisTypeCode, AxisTypeFieldUi>>;
};

/** 程序内写死的说明 / 单位覆盖；label、DefaultValue、min、max 仍来自描述文件 */
export const FIXED_DRIVE_PARAM_UI: Record<FixedMotorDriveParamId, FixedDriveParamUi> = {
  axisType: {
    help: "决定轴按平移还是连续旋转运动。升降/导轨选线性轴，转台等可多圈机构选无极旋转轴。",
  },
  workingStroke: {
    byAxisType: {
      [AXIS_TYPE.linear]: {
        unit: "mm",
        help: "零点到极限的有效行程。按图纸、铭牌或点动标定结果填写（数值按当前显示单位）。",
      },
      [AXIS_TYPE.continuous]: {
        unit: "°",
        help: "角度行程或软限位范围。按单圈当量或机械允许转角填写（°）。",
      },
    },
  },
  maxAxisVelocity: {
    help: "该驱动轴允许的最大速度上限，单位与描述文件一致（通常为 mm/s）。",
  },
  reductionRatio: {
    help: "电机到负载的减速传动比，影响位置换算。看减速机/葫芦铭牌，如 15:1 填 15。",
  },
  axisDirection: {
    byAxisType: {
      [AXIS_TYPE.linear]: {
        help: "对齐指令正方向与实物升降/进退。点动试向，反了就改。",
      },
      [AXIS_TYPE.continuous]: {
        help: "对齐指令正方向与顺/逆时针。点动试向，反了就改。",
      },
    },
  },
  positionError: {
    byAxisType: {
      [AXIS_TYPE.linear]: {
        unit: "mm",
        help: "到位容差：实际与目标差在此内算到位（数值按当前显示单位）。过小易报警。",
      },
      [AXIS_TYPE.continuous]: {
        unit: "°",
        help: "到位角度容差：实际与目标差在此内算到位。过小易报警。",
      },
    },
  },
  weightLow: {
    help: "称重保护下限。低于此值可能触发保护。",
  },
  weightHigh: {
    help: "称重保护上限。超过此值可能触发保护。",
  },
  loadLow: {
    help: "力矩保护下限。低于此值可能触发保护。",
  },
  loadHigh: {
    help: "力矩保护上限。超过此值可能触发保护。",
  },
};

export const isFixedMotorDriveParamId = (id: string): id is FixedMotorDriveParamId =>
  (FIXED_MOTOR_DRIVE_PARAM_IDS as readonly string[]).includes(id);

export const indexAttributesById = (
  attrs: readonly DisplayAttribute[],
): Map<string, DisplayAttribute> => {
  const map = new Map<string, DisplayAttribute>();
  for (const attr of attrs) map.set(attr.id, attr);
  return map;
};

export const resolveAxisType = (
  raw: unknown,
  fallback: AxisTypeCode = AXIS_TYPE.linear,
): AxisTypeCode => {
  const value = Number(raw);
  if (value === AXIS_TYPE.continuous) return AXIS_TYPE.continuous;
  if (value === AXIS_TYPE.linear) return AXIS_TYPE.linear;
  return fallback;
};

/** Canonical unit for store / UnitAware props (aliases normalized). */
export const resolveDriveFieldUnit = (
  id: FixedMotorDriveParamId,
  attr: DisplayAttribute,
  axisType: AxisTypeCode,
): string => {
  const override = FIXED_DRIVE_PARAM_UI[id].byAxisType?.[axisType]?.unit;
  const unit = (override ?? attr.unit?.trim() ?? "").trim();
  return unit ? normalizeLengthFamilyUnit(unit) : "";
};

export const toDriveDisplayUnit = (
  canonicalUnit: string,
  displayUnit: DisplayLengthUnit = "mm",
): string => {
  if (!canonicalUnit) return "";
  return isLengthFamilyUnit(canonicalUnit)
    ? getDisplayLengthFamilyUnit(canonicalUnit, displayUnit)
    : normalizeLengthFamilyUnit(canonicalUnit);
};

export const formatDriveAttrLabel = (
  attr: Pick<DisplayAttribute, "label" | "unit">,
  displayUnit: DisplayLengthUnit = "mm",
): string => {
  const unit = attr.unit?.trim() ? normalizeLengthFamilyUnit(attr.unit) : "";
  if (!unit) return attr.label;
  return `${attr.label} (${toDriveDisplayUnit(unit, displayUnit)})`;
};

export const resolveDriveFieldHelp = (
  id: FixedMotorDriveParamId,
  axisType: AxisTypeCode,
  _displayUnit: DisplayLengthUnit = "mm",
): string | undefined => {
  const ui = FIXED_DRIVE_PARAM_UI[id];
  // Help copy stays unit-neutral so example magnitudes are never left on the wrong scale.
  return ui.byAxisType?.[axisType]?.help ?? ui.help;
};

export const resolveDriveFieldLabel = (
  id: FixedMotorDriveParamId,
  attr: DisplayAttribute,
  axisType: AxisTypeCode,
  displayUnit: DisplayLengthUnit = "mm",
): string => {
  const unit = resolveDriveFieldUnit(id, attr, axisType);
  if (!unit) return attr.label;
  return `${attr.label} (${toDriveDisplayUnit(unit, displayUnit)})`;
};

export const enumOptionsFromAttr = (attr: DisplayAttribute) =>
  (attr.values ?? []).map(([value, label]) => ({
    label,
    value: String(value),
  }));
