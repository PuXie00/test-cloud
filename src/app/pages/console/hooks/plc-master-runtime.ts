import {
  DISCONNECTED_MASTER_STATUS,
  parseMasterStatusAck,
  type PlcMasterStatus,
} from "@shared/csocket/plc-master-status";
import type { PlcVerifyRecord } from "./project-verify";
import {
  createDisconnectedPlcRuntime,
  type PlcConnectionState,
  type PlcLifecycle,
  type PlcRuntimeState,
} from "./plc-runtime-types";
import { isLifecycleBusy } from "./system-status-aggregate";

export const SIMULATION_SWITCH_CONNECT_TITLE = "需全部主控已连接后才能开启仿真";
export const SIMULATION_SWITCH_PERMISSION_TITLE = "需要「主控操作」权限才能切换仿真";

export type PlcMasterRuntimeFields = {
  connection: PlcConnectionState;
  lifecycle: PlcLifecycle;
  lifecycleReason: string | undefined;
  simulation: boolean;
};

export type ComposePlcRuntimeInput = {
  masterById: ReadonlyMap<number, PlcMasterStatus>;
  verify: PlcVerifyRecord | undefined;
};

export type SimulationSwitchState = {
  checked: boolean;
  disabled: boolean;
  title?: string;
};

export const mapMasterStatusToRuntimeFields = (
  item: PlcMasterStatus | undefined,
): PlcMasterRuntimeFields => {
  if (!item) {
    return {
      connection: "disconnected",
      lifecycle: "suspended",
      lifecycleReason: "未连接",
      simulation: false,
    };
  }
  const simulation = item.simulationStatus === 1;
  switch (item.masterStatus) {
    case DISCONNECTED_MASTER_STATUS:
      return {
        connection: "disconnected",
        lifecycle: "suspended",
        lifecycleReason: "未连接",
        simulation,
      };
    case 0:
      return {
        connection: "connected",
        lifecycle: "initializing",
        lifecycleReason: undefined,
        simulation,
      };
    case 1:
      return {
        connection: "connected",
        lifecycle: "normal",
        lifecycleReason: undefined,
        simulation,
      };
    case 2:
      return {
        connection: "connected",
        lifecycle: "suspended",
        lifecycleReason: undefined,
        simulation,
      };
    case 3:
      return {
        connection: "connected",
        lifecycle: "configuring",
        lifecycleReason: undefined,
        simulation,
      };
    default:
      return {
        connection: "disconnected",
        lifecycle: "suspended",
        lifecycleReason: "未连接",
        simulation,
      };
  }
};

export const replaceMasterStatusMap = (
  msg: unknown,
): Map<number, PlcMasterStatus> | null => {
  const list = parseMasterStatusAck(msg);
  if (list === null) return null;
  const next = new Map<number, PlcMasterStatus>();
  for (const row of list) next.set(row.deviceId, row);
  return next;
};

export const shouldApplyMasterStatusSnapshot = (alreadyReceived: boolean): boolean =>
  !alreadyReceived;

/** 这几项变了，主控和电机的在线情况可能跟着变，要重新扫描主控 */
const SCAN_TRIGGER_KEYS = ["masterStatus", "simulationStatus", "busStatus"] as const;

/** 已记下的主控里有一台的主控 / 仿真 / 总线状态变了；第一次出现的主控不算 */
export const hasMasterScanTriggerChange = (
  known: ReadonlyMap<number, PlcMasterStatus>,
  next: ReadonlyMap<number, PlcMasterStatus>,
): boolean =>
  [...next.values()].some((status) => {
    const prev = known.get(status.deviceId);
    return prev !== undefined && SCAN_TRIGGER_KEYS.some((key) => prev[key] !== status[key]);
  });

export const composePlcRuntime = (
  plcId: number,
  input: ComposePlcRuntimeInput,
): PlcRuntimeState => {
  const mapped = mapMasterStatusToRuntimeFields(input.masterById.get(plcId));
  const base: PlcRuntimeState = {
    ...createDisconnectedPlcRuntime(plcId),
    ...mapped,
  };
  return input.verify
    ? { ...base, protocolVersion: input.verify.version, proVerify: input.verify.proVerify }
    : base;
};

export const resolveSimulationSwitchState = (
  runtimes: readonly PlcRuntimeState[],
  inFlight: boolean,
  /** 当前用户有「主控操作」权限；没有时开关只读，照样显示是否在仿真 */
  allowed = true,
): SimulationSwitchState => {
  const total = runtimes.length;
  const checked = total > 0 && runtimes.every((row) => row.simulation);
  if (!allowed) {
    return { checked, disabled: true, title: SIMULATION_SWITCH_PERMISSION_TITLE };
  }
  const busy = runtimes.some((row) => isLifecycleBusy(row.lifecycle));
  const allConnected = total > 0 && runtimes.every((row) => row.connection === "connected");
  if (total === 0 || inFlight || busy) {
    return { checked, disabled: true };
  }
  if (!checked && !allConnected) {
    return { checked, disabled: true, title: SIMULATION_SWITCH_CONNECT_TITLE };
  }
  return { checked, disabled: false };
};
