import type {
  Motor,
  Plc,
} from "../components/right-sidebar/config-wizard/config-wizard-types";
import { isCppAckFailed } from "@shared/csocket/ack";
import type { CppAckResult } from "@shared/csocket/types";
import { getMotorDisplayIndex } from "./motor-mid";

/** 失焦提交前可跳过的数值驱动参（不含枚举 axisDirection） */
export const NUMERIC_MOTOR_DRIVE_PARAM_IDS = [
  "workingStroke",
  "maxAxisVelocity",
  "reductionRatio",
  "positionError",
  "weightLow",
  "weightHigh",
  "loadLow",
  "loadHigh",
] as const;

const isNumericMotorDriveParamId = (id: string): boolean =>
  (NUMERIC_MOTOR_DRIVE_PARAM_IDS as readonly string[]).includes(id);

const numParam = (params: Motor["params"], key: string): number => {
  const n = Number(params[key]);
  return Number.isFinite(n) ? n : 0;
};

export type MotorAxisParamCount = {
  deviceId: number;
  axisDirection: number;
  workingStroke: number;
  reductionRatio: number;
  positionError: number;
  maxAxisVelocity: number;
  weightLow: number;
  weightHigh: number;
  loadLow: number;
  loadHigh: number;
};

export type MotorDeletePayload = {
  parentId: number;
  deviceId: number;
  deviceType: number;
  deviceIndex: number;
  busNo: number;
};

export const buildMotorParamPayload = (
  motor: Pick<Motor, "id" | "axisType" | "params">,
): { paramCount: MotorAxisParamCount } => ({
  paramCount: {
    deviceId: motor.id,
    axisDirection: numParam(motor.params, "axisDirection"),
    workingStroke: numParam(motor.params, "workingStroke"),
    reductionRatio: numParam(motor.params, "reductionRatio"),
    positionError: numParam(motor.params, "positionError"),
    maxAxisVelocity: numParam(motor.params, "maxAxisVelocity"),
    weightLow: numParam(motor.params, "weightLow"),
    weightHigh: numParam(motor.params, "weightHigh"),
    loadLow: numParam(motor.params, "loadLow"),
    loadHigh: numParam(motor.params, "loadHigh"),
  },
});

export type MotorSyncPayload = {
  parentId: number;
  deviceId: number;
  deviceType: number;
  deviceIndex: number;
  busNo: number;
};

export const buildMotorSyncPayload = (
  motor: Motor,
  motors: readonly Motor[],
): MotorSyncPayload => ({
  parentId: motor.plcId,
  deviceId: motor.id,
  deviceType: motor.axisType === 1 ? 1 : 0,
  deviceIndex: getMotorDisplayIndex(motors, motor.id),
  busNo: motor.busNo,
});

export const buildMotorSyncList = (motors: readonly Motor[]): MotorSyncPayload[] =>
  motors.map((motor) => buildMotorSyncPayload(motor, motors));

export const buildMotorDeletePayload = (
  motor: Motor,
  motors: readonly Motor[],
): MotorDeletePayload => buildMotorSyncPayload(motor, motors);

const paramsEqual = (a: Motor["params"], b: Motor["params"]): boolean => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
};

export const motorDriveParamsChanged = (prev: Motor, next: Motor): boolean =>
  !paramsEqual(prev.params, next.params);

/** true：仅数值驱动参变化（可在 tracked edit 内跳过即时 configure） */
export const onlyNumericDriveParamsChanged = (prev: Motor, next: Motor): boolean => {
  if (
    prev.id !== next.id ||
    prev.plcId !== next.plcId ||
    prev.busNo !== next.busNo ||
    prev.axisType !== next.axisType ||
    prev.productModel !== next.productModel ||
    prev.controlledObjectId !== next.controlledObjectId ||
    prev.axisKey !== next.axisKey
  ) {
    return false;
  }
  const keys = new Set([...Object.keys(prev.params), ...Object.keys(next.params)]);
  let anyNumericChanged = false;
  for (const key of keys) {
    if (prev.params[key] === next.params[key]) continue;
    if (!isNumericMotorDriveParamId(key)) return false;
    anyNumericChanged = true;
  }
  return anyNumericChanged;
};

export const runCsocket = (label: string, run: () => Promise<CppAckResult>): void => {
  void (async () => {
    try {
      const result = await run();
      if (isCppAckFailed(result)) {
        console.error(`[csocket] ${label}`, result);
      }
    } catch (err) {
      console.error(`[csocket] ${label}`, err);
    }
  })();
};

/** undo/redo 水合时按 id 差量同步 C++ PLC 设备 */
export const syncPlcDevicesByDiff = (prev: readonly Plc[], next: readonly Plc[]): void => {
  const prevIds = new Set(prev.map((plc) => plc.id));
  const nextIds = new Set(next.map((plc) => plc.id));
  const added = next.filter((plc) => !prevIds.has(plc.id));
  const removed = prev.filter((plc) => !nextIds.has(plc.id));
  if (added.length > 0) {
    void window.csocketApi.addDevicePlc(
      added.map((plc) => ({ deviceId: plc.id, ip: plc.ip })),
    );
  }
  if (removed.length > 0) {
    void window.csocketApi.deleteDevicePlc(
      removed.map((plc) => ({ deviceId: plc.id })),
    );
  }
};

/** 结构变更：同步完整电机列表；可选再给指定电机配参 */
export const syncAllMotors = (
  motors: readonly Motor[],
  configure: readonly Motor[] = [],
): void => {
  runCsocket("syncMotorPlc", async () => {
    const result = await window.csocketApi.syncMotorPlc(buildMotorSyncList(motors));
    if (isCppAckFailed(result)) return result;
    if (configure.length === 0) return { success: true };
    return window.csocketApi.configureAxisParamMotor(
      configure.map((motor) => buildMotorParamPayload(motor)),
    );
  });
};

/** undo/redo：全量同步电机列表，再给新增/改参的电机配参 */
export const syncMotorsByDiff = (prev: readonly Motor[], next: readonly Motor[]): void => {
  const prevById = new Map(prev.map((motor) => [motor.id, motor]));
  const structureChanged =
    JSON.stringify(buildMotorSyncList(prev)) !== JSON.stringify(buildMotorSyncList(next));
  const added = next.filter((motor) => !prevById.has(motor.id));
  const paramsChanged = next.filter((nextMotor) => {
    const prevMotor = prevById.get(nextMotor.id);
    return prevMotor !== undefined && motorDriveParamsChanged(prevMotor, nextMotor);
  });
  const configure = [
    ...added,
    ...paramsChanged.filter((motor) => !added.some((item) => item.id === motor.id)),
  ];

  if (!structureChanged && configure.length === 0) return;
  if (structureChanged) {
    syncAllMotors(next, configure);
    return;
  }
  runCsocket("configureAxisParamMotor", () =>
    window.csocketApi.configureAxisParamMotor(
      configure.map((motor) => buildMotorParamPayload(motor)),
    ),
  );
};
