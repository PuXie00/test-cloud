export type ControlledObjectStatus =
  | "ready"
  | "running"
  | "warning"
  | "alarm"
  | "disabled"
  | "offline";

export type ControlledObjectType =
  | "lift-truss"
  | "mover"
  | "rotator"
  | "lift-pitch";

export type DimensionDescriptor = {
  key: string;
  label: string;
  unit: string;
  mixed?: boolean;
};

export type ControlledObjectDescriptor = {
  id: number;
  name: string;
  type: ControlledObjectType;
  status: ControlledObjectStatus;
  dimensions: DimensionDescriptor[];
};

export type MonitorPositions = { h?: number; p?: number; y?: number };

export type ControlledObjectSnapshot = {
  descriptor: ControlledObjectDescriptor;
  values: Record<string, number>;
  targets: Record<string, number>;
  speed: number;
  torquePercent: number;
  temperatureC: number;
  history: number[]; // last 12 speed samples
  live: boolean;
  positions: MonitorPositions | null;
  /** C++ modelStatus；无轮询时为 null，徽章文案走语义态 */
  modelStatus: number | null;
};

export type MotorMonitorSnapshot = {
  id: number;
  displayName: string;
  /** 描述文件关联键 = device.id，用于解析扩展状态属性 */
  productModel: string;
  live: boolean;
  status: ControlledObjectStatus;
  axisStatus: number | null;
  actualPosition: number | null;
  actualSpeed: number | null;
  actualLoadRate: number | null;
  actualTemperature: number | null;
  actualTorque: number | null;
  actualWeight: number | null;
  driveAlarmCode: number | null;
  /** 扩展/未知状态参数运行时值（key = variableStateAttri.id） */
  extras: Record<string, number>;
};

/** 电机监控表固定展示（非扩展）的字段 id */
export const FIXED_AXIS_FIELD_IDS: ReadonlySet<string> = new Set([
  "deviceId",
  "axisStatus",
  "actualPosition",
  "actualSpeed",
  "actualLoadRate",
  "actualTemperature",
  "actualTorque",
  // "actualWeight",
  "driveAlarmCode",
]);

/** Spatial dimensions shown in 3D view, not in monitor cards */
export const SPATIAL_DIMENSION_KEYS = new Set(["height", "pitch", "yaw", "angle", "x", "y"]);

export const isSpatialDimension = (key: string): boolean => SPATIAL_DIMENSION_KEYS.has(key);
