import type { ControlledObjectStatus } from "./monitor-data";

export type StatusEntry = { label: string; status: ControlledObjectStatus };

/** 电机轴状态 4 码：0 断电 / 1 错误 / 2 静止 / 3 运动 */
export type MotorRuntimeStatus = "powerOff" | "error" | "idle" | "moving";

export const MOTOR_STATUS_LABEL: Record<MotorRuntimeStatus, string> = {
  powerOff: "断电",
  error: "错误",
  idle: "静止",
  moving: "运动",
};

export const AXIS_STATUS: Record<number, StatusEntry> = {
  0: { label: MOTOR_STATUS_LABEL.powerOff, status: "offline" },
  1: { label: MOTOR_STATUS_LABEL.error, status: "alarm" },
  2: { label: MOTOR_STATUS_LABEL.idle, status: "ready" },
  3: { label: MOTOR_STATUS_LABEL.moving, status: "running" },
};

export const motorRuntimeStatusFromAxisCode = (
  code: number | null | undefined,
): MotorRuntimeStatus => {
  if (code === 1) return "error";
  if (code === 2) return "idle";
  if (code === 3) return "moving";
  return "powerOff";
};

export const motorRuntimeStatusFromLive = (params: {
  live: boolean;
  axisStatus: number | null;
  driveAlarmCode: number | null;
}): MotorRuntimeStatus => {
  if (!params.live) return "powerOff";
  if (params.driveAlarmCode) return "error";
  return motorRuntimeStatusFromAxisCode(params.axisStatus);
};

export const MODEL_STATUS: Record<number, StatusEntry> = {
  0: { label: "未初始化", status: "ready" },
  1: { label: "未耦合", status: "ready" },//可能实轴也就是物体下面的电机有问题
  2: { label: "未耦合", status: "ready" },//等待耦合指令
  3: { label: "耦合中", status: "warning" },
  16: { label: "静止", status: "ready" },
  17: { label: "运动", status: "running" },
  18: { label: "不可打断的运行", status: "running" },
  19: { label: "不可打断的停止中", status: "running" },
  255: { label: "禁用", status: "disabled" },
  49: { label: "刹车反馈异常", status: "warning" },
  50: { label: "限位开关", status: "warning" },
  51: { label: "限位开关·上限", status: "warning" },
  52: { label: "限位开关·下限", status: "warning" },
  53: { label: "过载", status: "warning" },
  54: { label: "欠载", status: "warning" },
  55: { label: "过载·称重", status: "warning" },
  56: { label: "欠载·称重", status: "warning" },
  161: { label: "实轴errorstop", status: "alarm" },
  162: { label: "虚轴errorstop", status: "alarm" },
  163: { label: "耦合时实轴/虚轴报错", status: "alarm" },
  164: { label: "走水平/回零出问题", status: "alarm" },
  165: { label: "设置高度虚轴错误", status: "alarm" },
  166: { label: "传入的参数错误", status: "alarm" },
  167: { label: "反解耦合姿态问题", status: "alarm" },
  168: { label: "耦合电机走距过大", status: "alarm" },
  170: { label: "超速解耦", status: "alarm" },
  171: { label: "超行程", status: "alarm" },
  172: { label: "超原点", status: "alarm" },
  173: { label: "超位置差", status: "alarm" },
  175: { label: "未知错误（NaN）", status: "alarm" },
  192: { label: "超距离（轨道车）", status: "alarm" },
  193: { label: "超力矩（轨道车）", status: "alarm" },
  194: { label: "虚轴未停止（轨道车）", status: "alarm" },
};

export const MODEL_PROT_RANGE = { start: 0x30, end: 0x3f };
export const MODEL_ERR_RANGE = { start: 0xa0, end: 0xef };

export const classifyAxisStatus = (code: number): ControlledObjectStatus =>
  AXIS_STATUS[code]?.status ?? "offline";

export const classifyModelStatus = (code: number): ControlledObjectStatus => {
  const entry = MODEL_STATUS[code];
  if (entry) return entry.status;
  if (code >= MODEL_PROT_RANGE.start && code <= MODEL_PROT_RANGE.end) return "warning";
  if (code >= MODEL_ERR_RANGE.start && code <= MODEL_ERR_RANGE.end) return "alarm";
  return "offline";
};

export const axisStatusLabel = (code: number): string => AXIS_STATUS[code]?.label ?? "未知";
export const modelStatusLabel = (code: number): string => MODEL_STATUS[code]?.label ?? "未知";

export const formatMotorAxisStatus = (params: {
  live: boolean;
  axisStatus: number | null;
  driveAlarmCode: number | null;
}): string => MOTOR_STATUS_LABEL[motorRuntimeStatusFromLive(params)];
