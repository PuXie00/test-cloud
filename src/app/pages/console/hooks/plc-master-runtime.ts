import {
  DISCONNECTED_MASTER_STATUS,
  parseMasterStatusAck,
  type PlcMasterStatus,
} from "@shared/csocket/plc-master-status";
import { resolveMasterTypeIdByPlcModel } from "./motor-config";
import type { PlcVerifyRecord } from "./project-verify";
import {
  createDisconnectedPlcRuntime,
  type PlcConnectionState,
  type PlcLifecycle,
  type PlcRuntimeState,
  type ScannedMaster,
} from "./plc-runtime-types";
import { isLifecycleBusy } from "./system-status-aggregate";

export const SIMULATION_SWITCH_CONNECT_TITLE = "需全部主控已连接后才能开启仿真";

export type PlcMasterRuntimeFields = {
  connection: PlcConnectionState;
  lifecycle: PlcLifecycle;
  lifecycleReason: string | undefined;
  simulation: boolean;
};

export type ComposePlcRuntimeInput = {
  plcs: readonly { id: number; ip: string; masterTypeId: string }[];
  masterById: ReadonlyMap<number, PlcMasterStatus>;
  verify: PlcVerifyRecord | undefined;
  scannedMasters: readonly ScannedMaster[];
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

export const composePlcRuntime = (
  plcId: number,
  input: ComposePlcRuntimeInput,
): PlcRuntimeState => {
  const mapped = mapMasterStatusToRuntimeFields(input.masterById.get(plcId));
  const base: PlcRuntimeState = {
    ...createDisconnectedPlcRuntime(plcId),
    ...mapped,
  };
  const withVerify = input.verify
    ? { ...base, protocolVersion: input.verify.version, proVerify: input.verify.proVerify }
    : base;
  const plc = input.plcs.find((row) => row.id === plcId);
  const scanned = plc
    ? input.scannedMasters.find((row) => row.ip === plc.ip)
    : undefined;
  if (!scanned || !plc) return withVerify;
  return {
    ...withVerify,
    modelMismatch: resolveMasterTypeIdByPlcModel(scanned.plcModel) !== plc.masterTypeId,
    scannedAxes: scanned.axis,
  };
};

export const resolveSimulationSwitchState = (
  runtimes: readonly PlcRuntimeState[],
  inFlight: boolean,
): SimulationSwitchState => {
  const total = runtimes.length;
  const checked = total > 0 && runtimes.every((row) => row.simulation);
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
