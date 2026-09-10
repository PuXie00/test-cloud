import { isCppAckFailed, isCppAckOk } from "@shared/csocket/ack";
import type { DebugMotionParams } from "./build-debug-types";
import { DEFAULT_DEBUG_MOTION_PARAMS } from "./build-debug-types";

export const MIXED_DEBUG_PARAM = "--";

export const DEBUG_MOTION_PARAM_KEYS = [
  "defaultVelocity",
  "defaultAcceleration",
  "defaultDeceleration",
  "maximumStroke",
] as const;

export type SharedDebugMotionParams = {
  [K in keyof DebugMotionParams]: number | null;
};

type AxisRunParamRecord = {
  deviceId?: number;
  deviceID?: number;
  defaultVelocity?: number;
  defaultAcceleration?: number;
  defaultDeceleration?: number;
  maximumStroke?: number;
  paramCount?: AxisRunParamRecord;
};

const num = (value: unknown, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const flattenRecord = (raw: AxisRunParamRecord): AxisRunParamRecord => {
  if (raw.paramCount && typeof raw.paramCount === "object") {
    return { ...raw, ...raw.paramCount };
  }
  return raw;
};

const toDebugMotionParams = (record: AxisRunParamRecord): DebugMotionParams => ({
  defaultVelocity: num(record.defaultVelocity, DEFAULT_DEBUG_MOTION_PARAMS.defaultVelocity),
  defaultAcceleration: num(
    record.defaultAcceleration,
    DEFAULT_DEBUG_MOTION_PARAMS.defaultAcceleration,
  ),
  defaultDeceleration: num(
    record.defaultDeceleration,
    DEFAULT_DEBUG_MOTION_PARAMS.defaultDeceleration,
  ),
  maximumStroke: num(record.maximumStroke, DEFAULT_DEBUG_MOTION_PARAMS.maximumStroke),
});

export const parseAxisRunParamRecords = (
  data: unknown,
): Map<number, DebugMotionParams> => {
  const map = new Map<number, DebugMotionParams>();
  if (!Array.isArray(data)) return map;
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const row = flattenRecord(item as AxisRunParamRecord);
    const id = Number(row.deviceId ?? row.deviceID);
    if (!Number.isFinite(id)) continue;
    map.set(id, toDebugMotionParams(row));
  }
  return map;
};

export const mergeDebugMotionParams = (
  motorIds: number[],
  records: ReadonlyMap<number, DebugMotionParams>,
): SharedDebugMotionParams | null => {
  if (motorIds.length === 0) return null;
  const rows = motorIds.map((id) => records.get(id));
  const shared = {} as SharedDebugMotionParams;
  for (const key of DEBUG_MOTION_PARAM_KEYS) {
    const values = rows.map((row) => row?.[key]);
    if (values.some((value) => value === undefined)) {
      shared[key] = null;
      continue;
    }
    const first = values[0] as number;
    shared[key] = values.every((value) => value === first) ? first : null;
  }
  return shared;
};

/** 读取在线电机调试运行参数，items 为全部在线电机 deviceId。 */
export const fetchAllDebugMotionParams = async (
  deviceIds: readonly number[],
): Promise<Map<number, DebugMotionParams>> => {
  if (deviceIds.length === 0) return new Map();
  const api = window.csocketApi;
  if (!api?.readAxisRunParamMotor) return new Map();
  const result = await api.readAxisRunParamMotor(
    deviceIds.map((deviceId) => ({ deviceId })),
  );
  if (!isCppAckOk(result)) return new Map();
  return parseAxisRunParamRecords(result.data);
};

/** 将调试运行参数下发到选中电机。 */
export const applyDebugMotionParams = async (
  items: { motorId: number; params: DebugMotionParams }[],
): Promise<void> => {
  if (items.length === 0) return;
  const api = window.csocketApi;
  if (!api?.configureAxisRunParamMotor) return;
  const result = await api.configureAxisRunParamMotor(
    items.map(({ motorId, params }) => ({
      paramCount: {
        deviceId: motorId,
        defaultVelocity: params.defaultVelocity,
        defaultAcceleration: params.defaultAcceleration,
        defaultDeceleration: params.defaultDeceleration,
        maximumStroke: params.maximumStroke,
      },
    })),
  );
  if (isCppAckFailed(result)) {
    throw new Error(String(result.message || "调试参数下发失败"));
  }
};

export const roundToTenthMm = (canonicalMm: number): number =>
  Math.round(canonicalMm * 10) / 10;

export const toSignedPositionWire = (
  canonicalMm: number,
): { positionSign: number; position: number } => {
  const rounded = roundToTenthMm(canonicalMm);
  if (rounded === 0) return { positionSign: 0, position: 0 };
  return {
    positionSign: rounded > 0 ? 1 : 0,
    position: Math.abs(rounded),
  };
};

export const toJogDirection = (dir: 1 | -1 | 0): 0 | 1 | 2 => {
  if (dir === 1) return 1;
  if (dir === -1) return 2;
  return 0;
};

export const toRangeProtectEnable = (enabled: boolean): 0 | 1 => (enabled ? 1 : 0);

export const relativeMoveTargetMm = (currentMm: number, deltaMm: number): number =>
  roundToTenthMm(currentMm + deltaMm);

/** 轴设定位移；canonicalMm 为 0 时等价设原点。 */
export const applySetPositionMotor = async (
  motorIds: number[],
  canonicalMm: number,
): Promise<void> => {
  if (motorIds.length === 0) return;
  const api = window.csocketApi;
  if (!api?.setPositionMotor) throw new Error("csocketApi 不可用");
  const wire = toSignedPositionWire(canonicalMm);
  const result = await api.setPositionMotor(
    motorIds.map((deviceId) => ({ deviceId, ...wire })),
  );
  if (isCppAckFailed(result)) {
    throw new Error(String(result.message || "设定位移失败"));
  }
};

export const applyJogMotor = async (
  motorIds: number[],
  dir: 1 | -1 | 0,
  rangeProtect: boolean,
): Promise<void> => {
  if (motorIds.length === 0) return;
  const api = window.csocketApi;
  if (!api?.jogMotor) throw new Error("csocketApi 不可用");
  const direction = toJogDirection(dir);
  const rangeProtectEnable = toRangeProtectEnable(rangeProtect);
  const result = await api.jogMotor(
    motorIds.map((deviceId) => ({ deviceId, rangeProtectEnable, direction })),
  );
  if (isCppAckFailed(result)) {
    throw new Error(String(result.message || "点动指令失败"));
  }
};

export const applyStopMotor = async (motorIds: number[]): Promise<void> => {
  if (motorIds.length === 0) return;
  const api = window.csocketApi;
  if (!api?.stopMotor) throw new Error("csocketApi 不可用");
  const result = await api.stopMotor(motorIds.map((deviceId) => ({ deviceId })));
  if (isCppAckFailed(result)) {
    throw new Error(String(result.message || "停止失败"));
  }
};

export const applyResetAlarmMotor = async (motorIds: number[]): Promise<void> => {
  if (motorIds.length === 0) return;
  const api = window.csocketApi;
  if (!api?.resetAlarmMotor) throw new Error("csocketApi 不可用");
  const result = await api.resetAlarmMotor(motorIds.map((deviceId) => ({ deviceId })));
  if (isCppAckFailed(result)) {
    throw new Error(String(result.message || "报警复位失败"));
  }
};

export const applyClear731AlarmMotor = async (motorIds: number[]): Promise<void> => {
  if (motorIds.length === 0) return;
  const api = window.csocketApi;
  if (!api?.clear731AlarmMotor) throw new Error("csocketApi 不可用");
  const result = await api.clear731AlarmMotor(motorIds.map((deviceId) => ({ deviceId })));
  if (isCppAckFailed(result)) {
    throw new Error(String(result.message || "清报警失败"));
  }
};

export const applyEnableMotor = async (
  motorIds: number[],
  enabled: boolean,
): Promise<void> => {
  if (motorIds.length === 0) return;
  const api = window.csocketApi;
  if (!api?.enableMotor) throw new Error("csocketApi 不可用");
  const enableFlag = enabled ? 1 : 0;
  const result = await api.enableMotor(
    motorIds.map((deviceId) => ({ deviceId, enableFlag })),
  );
  if (isCppAckFailed(result)) {
    throw new Error(result.message ?? (enabled ? "使能失败" : "断使能失败"));
  }
};

export const applyCommTestMotor = async (motorIds: number[]): Promise<void> => {
  if (motorIds.length === 0) return;
  const api = window.csocketApi;
  if (!api?.commTestMotor) throw new Error("csocketApi 不可用");
  const result = await api.commTestMotor(motorIds.map((deviceId) => ({ deviceId })));
  if (isCppAckFailed(result)) {
    throw new Error(String(result.message || "通讯检测失败"));
  }
};

export const applyMoveAbsMotor = async (
  items: { motorId: number; canonicalMm: number }[],
  rangeProtect: boolean,
): Promise<void> => {
  if (items.length === 0) return;
  const api = window.csocketApi;
  if (!api?.moveAbsMotor) throw new Error("csocketApi 不可用");
  const rangeProtectEnable = toRangeProtectEnable(rangeProtect);
  const result = await api.moveAbsMotor(
    items.map(({ motorId, canonicalMm }) => ({
      deviceId: motorId,
      rangeProtectEnable,
      ...toSignedPositionWire(canonicalMm),
    })),
  );
  if (isCppAckFailed(result)) {
    throw new Error(String(result.message || "位置移动失败"));
  }
};
