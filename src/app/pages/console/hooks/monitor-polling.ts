import type { CppAckResult } from "../../../../../shared/csocket/types";
import {
  FIXED_AXIS_FIELD_IDS,
  type ControlledObjectSnapshot,
  type MonitorPositions,
  type MotorMonitorSnapshot,
} from "../components/monitor-grid/monitor-data";
import type { ControlledObject, Motor } from "../components/right-sidebar/config-wizard/config-wizard-types";
import {
  buildStaticMonitorSnapshot,
  wizardObjectToMonitorDescriptor,
} from "@/app/project/monitor-adapters";
import { formatMotorDisplayName } from "./motor-mid";
import {
  classifyAxisStatus,
  classifyModelStatus,
} from "../components/monitor-grid/monitor-status";

export type ModelInfoPollingItem = {
  deviceId: number;
  modelStatus?: number;
  virtualAxisHPosition?: number;
  virtualAxisPPosition?: number;
  virtualAxisYPosition?: number;
};

export type AxisInfoPollingItem = {
  deviceId: number;
  axisStatus?: number;
  actualPosition?: number;
  actualSpeed?: number;
  actualLoadRate?: number;
  actualTemperature?: number;
  actualTorque?: number;
  actualWeight?: number;
  driveAlarmCode?: number;
};

export type ModelLiveState = ModelInfoPollingItem;
export type AxisLiveState = AxisInfoPollingItem;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readDeviceId = (item: unknown): number | null => {
  if (!isRecord(item)) return null;
  const id = item.deviceId;
  return typeof id === "number" && Number.isFinite(id) ? id : null;
};

/**
 * 不按当前工程的物体 / 电机过滤：主进程只在数值变化时转发，
 * 工程还没加载完时到的帧丢掉就再也补不回来；未知 id 由 build*Snapshots 忽略。
 */
export const ingestPollingFrame = <T extends { deviceId: number }>(
  prev: ReadonlyMap<number, T>,
  msg: CppAckResult<T>,
): Map<number, T> => {
  if (msg.success !== true || !Array.isArray(msg.data)) return new Map(prev);
  if (msg.data.length === 0) return new Map();
  const next = new Map(prev);
  for (const raw of msg.data) {
    const deviceId = readDeviceId(raw);
    if (deviceId === null) continue;
    const incoming = raw as T;
    const previous = next.get(deviceId);
    next.set(deviceId, { ...(previous as T | undefined), ...incoming, deviceId });
  }
  return next;
};

/** 主进程缓存的快照垫在下面，已收到的实时帧字段优先 */
export const mergePollingSnapshot = <T extends { deviceId: number }>(
  prev: ReadonlyMap<number, T>,
  snapshot: CppAckResult<T>,
): Map<number, T> => {
  const next = ingestPollingFrame(new Map<number, T>(), snapshot);
  for (const [deviceId, live] of prev) {
    next.set(deviceId, { ...next.get(deviceId), ...live });
  }
  return next;
};

const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** 从轮询项收集扩展（非固定列）数值字段，key = variableStateAttri.id */
const collectAxisExtras = (liveItem: AxisInfoPollingItem): Record<string, number> => {
  const extras: Record<string, number> = {};
  for (const [key, value] of Object.entries(liveItem as Record<string, unknown>)) {
    if (FIXED_AXIS_FIELD_IDS.has(key)) continue;
    if (typeof value === "number" && Number.isFinite(value)) extras[key] = value;
  }
  return extras;
};

export const buildObjectSnapshots = (
  objects: readonly ControlledObject[],
  liveById: ReadonlyMap<number, ModelInfoPollingItem>,
): ControlledObjectSnapshot[] =>
  objects.map((object) => {
    const liveItem = liveById.get(object.id);
    if (!liveItem) {
      const descriptor = wizardObjectToMonitorDescriptor(object, "offline");
      return buildStaticMonitorSnapshot(descriptor);
    }
    const status = classifyModelStatus(liveItem.modelStatus ?? 0);
    const descriptor = wizardObjectToMonitorDescriptor(object, status);
    const snapshot = buildStaticMonitorSnapshot(descriptor);
    const h = finite(liveItem.virtualAxisHPosition);
    const p = finite(liveItem.virtualAxisPPosition);
    const y = finite(liveItem.virtualAxisYPosition);
    const positions: MonitorPositions | null =
      h !== null || p !== null || y !== null
        ? {
            ...(h !== null ? { h } : {}),
            ...(p !== null ? { p } : {}),
            ...(y !== null ? { y } : {}),
          }
        : null;
    const dims = descriptor.dimensions;
    return {
      ...snapshot,
      live: true,
      positions,
      values: {
        ...snapshot.values,
        ...(h !== null && dims[0] ? { [dims[0].key]: h } : {}),
        ...(p !== null && dims[1] ? { [dims[1].key]: p } : {}),
        ...(y !== null && dims[2] ? { [dims[2].key]: y } : {}),
      },
      speed: 0,
      torquePercent: 0,
      modelStatus: finite(liveItem.modelStatus),
    };
  });

export const buildMotorSnapshots = (
  motors: readonly Motor[],
  liveById: ReadonlyMap<number, AxisInfoPollingItem>,
): MotorMonitorSnapshot[] =>
  motors.map((motor) => {
    const liveItem = liveById.get(motor.id);
    if (!liveItem) {
      return {
        id: motor.id,
        displayName: formatMotorDisplayName(motors, motor),
        productModel: motor.productModel,
        live: false,
        status: "offline",
        axisStatus: null,
        actualPosition: null,
        actualSpeed: null,
        actualLoadRate: null,
        actualTemperature: null,
        actualTorque: null,
        actualWeight: null,
        driveAlarmCode: null,
        extras: {},
      };
    }
    const axisStatus = finite(liveItem.axisStatus);
    const driveAlarmCode = finite(liveItem.driveAlarmCode);
    const mapped = classifyAxisStatus(axisStatus ?? 0);
    const status = driveAlarmCode !== null && driveAlarmCode !== 0 ? "alarm" : mapped;
    return {
      id: motor.id,
      displayName: formatMotorDisplayName(motors, motor),
      productModel: motor.productModel,
      live: true,
      status,
      axisStatus,
      actualPosition: finite(liveItem.actualPosition),
      actualSpeed: finite(liveItem.actualSpeed),
      actualLoadRate: finite(liveItem.actualLoadRate),
      actualTemperature: finite(liveItem.actualTemperature),
      actualTorque: finite(liveItem.actualTorque),
      actualWeight: finite(liveItem.actualWeight),
      driveAlarmCode,
      extras: collectAxisExtras(liveItem),
    };
  });
