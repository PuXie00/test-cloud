export type ControlType =
  | "singlePointMove"
  | "singlePointRotation"
  | "continuousRotation"
  | "multiLevelHoist"
  | "railCar"
  | "staticProp"
  | "twoPointSwing"
  | "fourPointSwing"
  | "dualTiltFourPointSwing"
  | "multiPointSwing";

/** 运动轴类型：决定单位、标签、默认值；由控制类型 + 运动轴派生，不落盘 */
export type MotionAxisKind = "rotation" | "move" | "swingX" | "swingY" | "yawY";

/** motionParams 的键：h / p / y 依次对应虚轴 v1 / v2 / v3 */
export type MotionAxisId = "h" | "p" | "y";

export type ShapePresetId =
  | "cube"
  | "cyl"
  | "sphere"
  | "ring"
  | "sqRing"
  | "prism6"
  | "external";

export type ShapeDimensionValuesByPreset = {
  cube: { width: number; height: number; depth: number };
  cyl: { diameter: number; height: number };
  sphere: { diameter: number };
  ring: { outerDiameter: number; innerDiameter: number; thickness: number };
  sqRing: {
    outerWidth: number;
    outerDepth: number;
    ringWidth: number;
    thickness: number;
  };
  prism6: { acrossFlats: number; height: number };
  external: { width: number; height: number; depth: number };
};

export type ShapeDimensions<T extends ShapePresetId = ShapePresetId> =
  T extends ShapePresetId ? ShapeDimensionValuesByPreset[T] : never;

export type MotionAxisParams = {
  /** 范围下限（线性 mm / 角度 °） */
  minAngle: number;
  /** 范围上限（线性 mm / 角度 °） */
  maxAngle: number;
  speed: number;
  accelTime: number;
  minAccelTime: number;
  emergencyDecelTime: number;
  /** 加速度，由 speed / accelTime 派生（与 deceleration 相等） */
  acceleration: number;
  /** 减速度，由 speed / accelTime 派生（与 acceleration 相等） */
  deceleration: number;
  /**
   * 最大加速度，由 speed / minAccelTime 派生（与 maxDeceleration 相等）。
   * 下发 PLC 时不用此值，改按虚轴最大速度 / minAccelTime 换算（见 model-csocket-payload）。
   */
  maxAcceleration: number;
  /** 最大减速度，由 speed / minAccelTime 派生（与 maxAcceleration 相等） */
  maxDeceleration: number;
  /** 异常减速度，由 speed / emergencyDecelTime 派生 */
  abnormalDeceleration: number;
  /** 虚轴最大速度（°/s）；仅 p / y（虚轴 2/3）必有，h（虚轴 1）无 */
  defaultMaxVelocity?: number;
};

export type MotionParamsByAxis = Partial<Record<MotionAxisId, MotionAxisParams>>;

/** 表单逐项编辑的数值字段；defaultMaxVelocity 按虚轴单独编辑 */
export type MotionAxisFieldKey = Exclude<keyof MotionAxisParams, "defaultMaxVelocity">;

export type PlcProtocol = "modbus-tcp" | "ethercat" | "profinet";
