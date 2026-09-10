import type { MotorRuntimeStatus } from "../monitor-grid/monitor-status";

export {
  MOTOR_STATUS_LABEL,
  type MotorRuntimeStatus,
} from "../monitor-grid/monitor-status";

/** 与描述文件 variableStateAttri.id 对齐的模拟字段 */
export const MOCK_STATE_IDS = {
  actualPosition: "actualPosition",
  actualTemperature: "actualTemperature",
  actualTorque: "actualTorque",
  actualWeight: "actualWeight",
} as const;

/** 搭建调试遥测：status + values[stateAttr.id] */
export type BuildMotorTelemetry = {
  status: MotorRuntimeStatus;
  /** key = variableStateAttri.id；有则列表直接展示 */
  values: Record<string, number>;
};

export const TEMPERATURE_ALARM_C = 70;
export const TORQUE_IMBALANCE_THRESHOLD = 10;
export const JOG_STEPS = [1, 5, 10, 100, 300] as const;
export type JogStep = (typeof JOG_STEPS)[number];

/** 调试运动参数（与 C++ axisRunConfig 字段对齐，运行时读写，前端不持久化） */
export type DebugMotionParams = {
  defaultVelocity: number;
  defaultAcceleration: number;
  defaultDeceleration: number;
  maximumStroke: number;
};

/** 占位默认值；正式环境由 C++ 回读覆盖 */
export const DEFAULT_DEBUG_MOTION_PARAMS: DebugMotionParams = {
  defaultVelocity: 100,
  defaultAcceleration: 500,
  defaultDeceleration: 500,
  maximumStroke: 3000,
};
