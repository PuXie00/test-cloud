import type {
  ControlType,
  MotionAxisKind,
  MotionAxisParams,
  ShapeDimensions,
  ShapePresetId,
} from "@/app/project/configuration-types";
import {
  CONTROL_TYPE_RULES,
  MOTION_DEFAULTS,
  SHAPE_DIMENSION_KEYS,
  ensureMinimumDriveAxes,
} from "@/app/project/configuration-rules";

import type { AxisDefinition } from "./config-wizard-types";

type LegacyControlType = "syncLift" | "swing" | "floatSwing";

export type ControlTypeDefinition<T extends ControlType = ControlType> = {
  id: T;
  label: string;
  minimumDriveAxes: number;
  motionAxes: readonly MotionAxisKind[];
};

export const CONTROL_TYPE_DEFINITION_BY_ID = {
  staticProp: {
    id: "staticProp",
    label: "无控制（占位）",
    ...CONTROL_TYPE_RULES.staticProp,
  },
  singlePointMove: {
    id: "singlePointMove",
    label: "单点移动模型（单移动）",
    ...CONTROL_TYPE_RULES.singlePointMove,
  },
  singlePointRotation: {
    id: "singlePointRotation",
    label: "单点旋转模型（单旋转）",
    ...CONTROL_TYPE_RULES.singlePointRotation,
  },
  continuousRotation: {
    id: "continuousRotation",
    label: "无极旋转模型（单旋转）",
    ...CONTROL_TYPE_RULES.continuousRotation,
  },
  multiLevelHoist: {
    id: "multiLevelHoist",
    label: "多级升降模型（单移动）",
    ...CONTROL_TYPE_RULES.multiLevelHoist,
  },
  railCar: {
    id: "railCar",
    label: "轨道车模型",
    ...CONTROL_TYPE_RULES.railCar,
  },
 
  twoPointSwing: {
    id: "twoPointSwing",
    label: "两点摆模型（移动和摆动）",
    ...CONTROL_TYPE_RULES.twoPointSwing,
  },
  fourPointSwing: {
    id: "fourPointSwing",
    label: "四点摆模型（移动、摆动X、摆动Y）",
    ...CONTROL_TYPE_RULES.fourPointSwing,
  },
  dualTiltFourPointSwing: {
    id: "dualTiltFourPointSwing",
    label: "多点倾斜模型（移动、摆动X、摆动Y）",
    ...CONTROL_TYPE_RULES.dualTiltFourPointSwing,
  },
  multiPointSwing: {
    id: "multiPointSwing",
    label: "多点摆模型（移动、摆动、偏转）",
    ...CONTROL_TYPE_RULES.multiPointSwing,
  },
} as const satisfies { [T in ControlType]: ControlTypeDefinition<T> };

export const CONTROL_TYPE_DEFINITIONS = Object.values(CONTROL_TYPE_DEFINITION_BY_ID);

export const LEGACY_CONTROL_TYPE_MAP = {
  syncLift: "singlePointMove",
  swing: "twoPointSwing",
  floatSwing: "dualTiltFourPointSwing",
} as const satisfies Record<LegacyControlType, ControlType>;

const getControlTypeDefinition = (controlType: ControlType) =>
  CONTROL_TYPE_DEFINITION_BY_ID[controlType];

const LEGACY_CONTROL_TYPES = ["syncLift", "swing", "floatSwing"] as const;

/** @deprecated Adapter for pre-1.1 wizard selectors. */
export const LEGACY_CONTROL_TYPE_OPTIONS = LEGACY_CONTROL_TYPES.map((value) => ({
  value,
  label: getControlTypeDefinition(LEGACY_CONTROL_TYPE_MAP[value]).label,
}));

const createLegacyAxis = (
  _controlType: LegacyControlType,
  index: number,
): { key: string; label: string } => ({
  key: String(index),
  label: `轴${index + 1}`,
});

/** @deprecated Adapter for pre-1.1 wizard axis templates. */
export const LEGACY_AXES_BY_CONTROL_TYPE = Object.fromEntries(
  LEGACY_CONTROL_TYPES.map((legacyControlType) => {
    const minimumDriveAxes = getControlTypeDefinition(
      LEGACY_CONTROL_TYPE_MAP[legacyControlType],
    ).minimumDriveAxes;
    return [
      legacyControlType,
      Array.from({ length: minimumDriveAxes }, (_, index) =>
        createLegacyAxis(legacyControlType, index),
      ),
    ];
  }),
) as Record<LegacyControlType, { key: string; label: string }[]>;

/** @deprecated Adapter for the pre-1.1 custom device card. */
export const LEGACY_CUSTOM_DEVICE_TYPE_ID = "custom";

type LegacyDeviceMetadata = {
  id: string;
  label: string;
  summary: string;
  controlType: LegacyControlType;
  descriptorControlType?: ControlType;
  defaultAxes?: { key: string; label: string }[];
};

const LEGACY_DEVICE_METADATA: LegacyDeviceMetadata[] = [
  {
    id: "lf-3000a",
    label: "移动升降架 LF-3000A",
    summary: "单升降轴",
    controlType: "syncLift",
  },
  {
    id: "xz-2000b",
    label: "升降摆动架 XZ-2000B",
    summary: "升降 + 摆动",
    controlType: "swing",
  },
  {
    id: "pb-1500c",
    label: "飘摆架 PB-1500C",
    summary: "升降 + 双摆",
    controlType: "floatSwing",
  },
  {
    id: "lf-4000d",
    label: "四轴升降灯架 LF-4000D",
    summary: "四同步升降",
    controlType: "syncLift",
    descriptorControlType: "dualTiltFourPointSwing",
    defaultAxes: [
      { key: "0", label: "轴1" },
      { key: "1", label: "轴2" },
      { key: "2", label: "轴3" },
      { key: "3", label: "轴4" },
    ],
  },
  {
    id: LEGACY_CUSTOM_DEVICE_TYPE_ID,
    label: "自定义设备",
    summary: "多轴自定义，通常 4 轴以上",
    controlType: "syncLift",
    descriptorControlType: "railCar",
    defaultAxes: [],
  },
];

/** @deprecated Adapter for pre-1.1 device cards. */
export const LEGACY_DEVICE_TYPES = LEGACY_DEVICE_METADATA.map(
  ({ descriptorControlType, ...device }) => ({
    ...device,
    axisCount: getControlTypeDefinition(
      descriptorControlType ?? LEGACY_CONTROL_TYPE_MAP[device.controlType],
    ).minimumDriveAxes,
  }),
);

/** @deprecated Adapter for pre-1.1 shape card descriptions. */
export const LEGACY_SHAPE_DESCRIPTION_OVERRIDES: Partial<Record<ShapePresetId, string>> = {
  cube: "灯架…",
  cyl: "立柱…",
};

export const ensureMinimumAxes = (
  controlType: ControlType,
  axes: AxisDefinition[],
): AxisDefinition[] => {
  const priorByKey = new Map(axes.map((axis) => [axis.key, axis]));
  return ensureMinimumDriveAxes(controlType, axes).map((axis, index) => ({
    key: axis.key,
    custom: axis.custom ?? priorByKey.get(axis.key)?.custom ?? false,
    mount: priorByKey.get(axis.key)?.mount ?? axis.mount ?? { x: 0, z: 0 },
  }));
};

export { MOTION_DEFAULTS };
export const MOVE_DEFAULTS = MOTION_DEFAULTS.move;
export const SHAPE_FIELD_KEYS = SHAPE_DIMENSION_KEYS;

type MotionFieldTier = "common" | "advanced";

export type MotionAxisFieldDefinition = {
  key: keyof MotionAxisParams;
  label: string;
  unit: string;
  tier: MotionFieldTier;
  step?: number;
  precision?: number;
  /** input 用原生步进输入框，numeric 用拖动/点击编辑输入框 */
  control?: "input" | "numeric";
};

const LINEAR_MOTION_FIELDS: MotionAxisFieldDefinition[] = [
  { key: "maxAngle", label: "最大行程", unit: "mm", tier: "common", step: 10, precision: 1 },
  { key: "minAngle", label: "最小行程", unit: "mm", tier: "common", step: 10, precision: 1 },
  { key: "speed", label: "速度", unit: "mm/s", tier: "common", step: 1, precision: 1 },
  { key: "accelTime", label: "加减速时间", unit: "s", tier: "advanced", step: 0.1, precision: 1, control: "input" },
  { key: "minAccelTime", label: "最短加减速时间", unit: "s", tier: "advanced", step: 0.1, precision: 1, control: "input" },
  {
    key: "emergencyDecelTime",
    label: "异常减速时间",
    unit: "s",
    tier: "advanced",
    step: 0.1,
    precision: 1,
    control: "input",
  },
];

const ROTATION_MOTION_FIELDS: MotionAxisFieldDefinition[] = [
  { key: "maxAngle", label: "最大角度", unit: "°", tier: "common", step: 1, precision: 1 },
  { key: "minAngle", label: "最小角度", unit: "°", tier: "common", step: 1, precision: 1 },
  { key: "speed", label: "速度", unit: "°/s", tier: "common", step: 1, precision: 1 },
  { key: "accelTime", label: "加减速时间", unit: "s", tier: "advanced", step: 0.1, precision: 1, control: "input" },
  { key: "minAccelTime", label: "最短加减速时间", unit: "s", tier: "advanced", step: 0.1, precision: 1, control: "input" },
  {
    key: "emergencyDecelTime",
    label: "异常减速时间",
    unit: "s",
    tier: "advanced",
    step: 0.1,
    precision: 1,
    control: "input",
  },
];

const SWING_MOTION_FIELDS: MotionAxisFieldDefinition[] = [
  { key: "maxAngle", label: "最大角度", unit: "°", tier: "common", step: 1, precision: 1 },
  { key: "minAngle", label: "最小角度", unit: "°", tier: "common", step: 1, precision: 1 },
  { key: "speed", label: "速度", unit: "°/s", tier: "common", step: 0.1, precision: 1 },
  { key: "accelTime", label: "加减速时间", unit: "s", tier: "advanced", step: 0.1, precision: 1, control: "input" },
  { key: "minAccelTime", label: "最短加减速时间", unit: "s", tier: "advanced", step: 0.1, precision: 1, control: "input" },
  {
    key: "emergencyDecelTime",
    label: "异常减速时间",
    unit: "s",
    tier: "advanced",
    step: 0.1,
    precision: 1,
    control: "input",
  },
];

export const MOTION_AXIS_FIELD_DEFINITIONS: Record<MotionAxisKind, MotionAxisFieldDefinition[]> = {
  move: LINEAR_MOTION_FIELDS,
  rotation: ROTATION_MOTION_FIELDS,
  swingX: SWING_MOTION_FIELDS,
  swingY: SWING_MOTION_FIELDS,
  yawY: SWING_MOTION_FIELDS,
};

export const MOTION_AXIS_LABELS: Record<MotionAxisKind, string> = {
  move: "移动",
  rotation: "旋转",
  swingX: "摆动 X",
  swingY: "摆动 Y",
  yawY: "偏转角",
};

const SHAPE_FIELD_DEFINITIONS = {
  width: { label: "宽", unit: "mm", defaultValue: 2000 },
  height: { label: "高", unit: "mm", defaultValue: 1000 },
  depth: { label: "深", unit: "mm", defaultValue: 1500 },
  diameter: { label: "直径", unit: "mm", defaultValue: 1000 },
  outerDiameter: { label: "外径", unit: "mm", defaultValue: 1200 },
  innerDiameter: { label: "内径", unit: "mm", defaultValue: 800 },
  thickness: { label: "厚度", unit: "mm", defaultValue: 200 },
  outerWidth: { label: "外宽", unit: "mm", defaultValue: 2000 },
  outerDepth: { label: "外深", unit: "mm", defaultValue: 2000 },
  ringWidth: { label: "环宽", unit: "mm", defaultValue: 200 },
  acrossFlats: { label: "对边距", unit: "mm", defaultValue: 800 },
} as const;

const SHAPE_LABELS: Record<ShapePresetId, string> = {
  cube: "立方体",
  cyl: "圆柱体",
  sphere: "球体",
  ring: "圆环",
  sqRing: "方环",
  prism6: "六棱柱",
  external: "其它",
};

const SHAPE_DEFAULT_OVERRIDES: Partial<
  Record<ShapePresetId, Partial<Record<keyof typeof SHAPE_FIELD_DEFINITIONS, number>>>
> = {
  cube: { height: 400 },
  cyl: { diameter: 500, height: 3000 },
  prism6: { height: 2500 },
  external: { height: 400 },
};

export const SHAPE_DEFINITIONS = (Object.keys(SHAPE_FIELD_KEYS) as ShapePresetId[]).map(
  (id) => ({
    id,
    label: SHAPE_LABELS[id],
    fields: SHAPE_FIELD_KEYS[id].map((key) => ({
      key,
      label: SHAPE_FIELD_DEFINITIONS[key].label,
      unit: SHAPE_FIELD_DEFINITIONS[key].unit,
      defaultValue:
        SHAPE_DEFAULT_OVERRIDES[id]?.[key] ?? SHAPE_FIELD_DEFINITIONS[key].defaultValue,
    })),
  }),
);

export const getShapeFieldKeys = (shapePreset: ShapePresetId): readonly string[] =>
  SHAPE_FIELD_KEYS[shapePreset];

export const defaultShapeDimensions = <T extends ShapePresetId>(
  shapePreset: T,
): ShapeDimensions<T> => {
  const definition = SHAPE_DEFINITIONS.find((shape) => shape.id === shapePreset);
  if (!definition) {
    throw new Error(`Unknown shape preset "${shapePreset}"`);
  }
  return Object.fromEntries(
    definition.fields.map((field) => [field.key, field.defaultValue]),
  ) as ShapeDimensions<T>;
};

/** Shapes available in drag/drop and wizard palettes (excludes external imports). */
export const PALETTE_SHAPE_DEFINITIONS = SHAPE_DEFINITIONS.filter(
  (shape) => shape.id !== "external",
);

type EngineDimensions = { w: number; h: number; d: number };

export function toEngineDimensions<T extends ShapePresetId>(
  shapePreset: T,
  dimensions: ShapeDimensions<NoInfer<T>>,
): EngineDimensions;
export function toEngineDimensions(
  shapePreset: ShapePresetId,
  dimensions: ShapeDimensions,
): EngineDimensions {
  const source: Record<string, unknown> | null =
    typeof dimensions === "object" && dimensions !== null
      ? (dimensions as unknown as Record<string, unknown>)
      : null;
  const validated = Object.fromEntries(
    SHAPE_FIELD_KEYS[shapePreset].map((key) => {
      const value = source?.[key];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(
          `Invalid ${shapePreset} dimension "${key}": expected a finite number`,
        );
      }
      return [key, value];
    }),
  ) as Record<string, number>;
  const get = (key: string): number => validated[key];

  switch (shapePreset) {
    case "cube":
      return { w: get("width"), h: get("height"), d: get("depth") };
    case "cyl":
      return { w: get("diameter"), h: get("height"), d: get("diameter") };
    case "sphere":
      return { w: get("diameter"), h: get("diameter"), d: get("diameter") };
    case "ring":
      return {
        w: get("outerDiameter"),
        h: get("thickness"),
        d: get("outerDiameter"),
      };
    case "sqRing":
      return { w: get("outerWidth"), h: get("thickness"), d: get("outerDepth") };
    case "prism6":
      return { w: get("acrossFlats"), h: get("height"), d: get("acrossFlats") };
    case "external":
      return { w: get("width"), h: get("height"), d: get("depth") };
  }
}
