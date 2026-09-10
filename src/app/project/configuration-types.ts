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

export type MotionAxisKind = "rotation" | "move" | "swingX" | "swingY" | "yawY";

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
  /** 最大加速度，由 speed / minAccelTime 派生（与 maxDeceleration 相等） */
  maxAcceleration: number;
  /** 最大减速度，由 speed / minAccelTime 派生（与 maxAcceleration 相等） */
  maxDeceleration: number;
  /** 异常减速度，由 speed / emergencyDecelTime 派生 */
  abnormalDeceleration: number;
};

export type PlcProtocol = "modbus-tcp" | "ethercat" | "profinet";
