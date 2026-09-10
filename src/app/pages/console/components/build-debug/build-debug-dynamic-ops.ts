import type { DisplayOperation, OperationField } from "@shared/config";
import { isCppAckFailed } from "@shared/csocket/ack";
import { getCachedMotorModelConfig } from "@/app/pages/console/hooks/motor-config";

export const DYNAMIC_OP_SLOT_LIMIT = 4;

type MotorOpSender = (items: unknown[]) => Promise<unknown>;

/** operation.id → 已有专用 Motor API；未映射则 toast 占位 */
const MOTOR_OP_SENDERS: Record<string, MotorOpSender> = {
  enable: (items) => window.csocketApi.enableMotor(items),
  resetAlarm: (items) => window.csocketApi.resetAlarmMotor(items),
  clear731Alarm: (items) => window.csocketApi.clear731AlarmMotor(items),
  lightSlave: (items) => window.csocketApi.lightSlaveMotor(items),
  setposition: (items) => window.csocketApi.setPositionMotor(items),
  setPosition: (items) => window.csocketApi.setPositionMotor(items),
  jog: (items) => window.csocketApi.jogMotor(items),
  moveAbs: (items) => window.csocketApi.moveAbsMotor(items),
  stop: (items) => window.csocketApi.stopMotor(items),
  eStop: (items) => window.csocketApi.eStopMotor(items),
  torqueTest: (items) => window.csocketApi.torqueTestMotor(items),
  brakeTest: (items) => window.csocketApi.brakeTestMotor(items),
  commTest: (items) => window.csocketApi.commTestMotor(items),
};

export const variableOperationsForModel = (productModel: string): DisplayOperation[] => {
  const ops = getCachedMotorModelConfig(productModel)?.variableOperation ?? [];
  return ops.slice(0, DYNAMIC_OP_SLOT_LIMIT);
};

export const operationHasParams = (op: DisplayOperation): boolean => op.param.length > 0;

export const defaultParamValues = (params: readonly OperationField[]): Record<string, string> => {
  const values: Record<string, string> = {};
  for (const field of params) {
    if (field.DefaultValue !== undefined) {
      values[field.id] = String(field.DefaultValue);
      continue;
    }
    if (field.dataType === "enum" && field.values?.[0]) {
      values[field.id] = String(field.values[0][0]);
      continue;
    }
    values[field.id] = "0";
  }
  return values;
};

const toWireValue = (field: OperationField, raw: string): number | string => {
  if (field.dataType === "enum" || field.dataType?.startsWith("uint") || field.dataType?.startsWith("int")) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : raw;
};

export const buildOperationItems = (
  mid: number,
  params: readonly OperationField[],
  values: Record<string, string>,
): Record<string, unknown>[] => {
  const item: Record<string, unknown> = { mid };
  for (const field of params) {
    item[field.id] = toWireValue(field, values[field.id] ?? "0");
  }
  return [item];
};

export type ExecuteDynamicOpResult =
  | { ok: true; mode: "api" }
  | { ok: true; mode: "stub" }
  | { ok: false; error: string };

export const executeDynamicOperation = async (
  op: DisplayOperation,
  mid: number,
  values: Record<string, string> = {},
): Promise<ExecuteDynamicOpResult> => {
  const items = buildOperationItems(mid, op.param, values);
  const sender = MOTOR_OP_SENDERS[op.id];
  if (!sender) {
    return { ok: true, mode: "stub" };
  }
  if (typeof window === "undefined" || !window.csocketApi) {
    return { ok: false, error: "csocketApi 不可用" };
  }
  try {
    const result = await sender(items);
    if (isCppAckFailed(result)) {
      return { ok: false, error: result.message ?? `${op.label} 执行失败` };
    }
    return { ok: true, mode: "api" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : `${op.label} 执行失败` };
  }
};

export const confirmIfNeeded = async (op: DisplayOperation): Promise<boolean> => {
  if (op.confirmationLevel !== "normal") return true;
  return window.toolAPI.confirm({
    title: "确认执行",
    message: `确认执行「${op.label}」？`,
  });
};
