import { isCppAckOk } from "./ack";

export const DISCONNECTED_MASTER_STATUS = -1;

export type PlcMasterStatus = {
  deviceId: number;
  plcModel: number;
  masterStatus: number;
  simulationStatus: number;
  busStatus: number;
  ruleStartStatus: number;
  ruleId: number;
  autoRunStatus: number;
  autoId: number;
};

export const PLC_MASTER_STATUS_KEYS = [
  "plcModel",
  "masterStatus",
  "simulationStatus",
  "busStatus",
  "ruleStartStatus",
  "ruleId",
  "autoRunStatus",
  "autoId",
] as const;

export type CsocketStatusForClear =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

export const shouldClearPlcMasterStatus = (state: CsocketStatusForClear): boolean =>
  state === "disconnected" || state === "reconnecting";

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const finiteOrZero = (value: unknown): number => (isFiniteNumber(value) ? value : 0);

export const isSamePlcStatus = (
  prev: PlcMasterStatus | undefined,
  next: PlcMasterStatus,
): boolean => {
  if (!prev) return false;
  for (const key of PLC_MASTER_STATUS_KEYS) {
    if (prev[key] !== next[key]) return false;
  }
  return true;
};

const parsePlcItem = (raw: unknown): PlcMasterStatus | null => {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  if (!isFiniteNumber(item.deviceId)) return null;
  return {
    deviceId: item.deviceId,
    plcModel: finiteOrZero(item.plcModel),
    masterStatus: finiteOrZero(item.masterStatus),
    simulationStatus: finiteOrZero(item.simulationStatus),
    busStatus: finiteOrZero(item.busStatus),
    ruleStartStatus: finiteOrZero(item.ruleStartStatus),
    ruleId: finiteOrZero(item.ruleId),
    autoRunStatus: finiteOrZero(item.autoRunStatus),
    autoId: finiteOrZero(item.autoId),
  };
};

export const parseMasterStatusAck = (
  result: unknown,
): PlcMasterStatus[] | null => {
  if (!isCppAckOk(result) || !Array.isArray(result.data)) return null;
  const out: PlcMasterStatus[] = [];
  for (const raw of result.data) {
    const parsed = parsePlcItem(raw);
    if (parsed) out.push(parsed);
  }
  return out;
};

const parseTcpConnItem = (
  raw: unknown,
): { deviceId: number; connected: number } | null => {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  if (!isFiniteNumber(item.deviceId) || !isFiniteNumber(item.connected)) return null;
  return { deviceId: item.deviceId, connected: item.connected };
};

const disconnectedStub = (deviceId: number): PlcMasterStatus => ({
  deviceId,
  plcModel: 0,
  masterStatus: DISCONNECTED_MASTER_STATUS,
  simulationStatus: 0,
  busStatus: 0,
  ruleStartStatus: 0,
  ruleId: 0,
  autoRunStatus: 0,
  autoId: 0,
});

export class PlcMasterStatusStore {
  private readonly projectPlcIds = new Set<number>();
  private readonly lastByDeviceId = new Map<number, PlcMasterStatus>();
  private readonly disconnected = new Set<number>();

  snapshot(): PlcMasterStatus[] {
    const out: PlcMasterStatus[] = [];
    for (const id of this.projectPlcIds) {
      const item = this.lastByDeviceId.get(id);
      if (item) out.push(item);
    }
    return out;
  }

  clear(): void {
    this.projectPlcIds.clear();
    this.lastByDeviceId.clear();
    this.disconnected.clear();
  }

  ingestPlc(result: unknown): PlcMasterStatus[] | null {
    if (!isCppAckOk(result) || !Array.isArray(result.data)) return null;
    let changed = false;
    for (const raw of result.data) {
      const parsed = parsePlcItem(raw);
      if (!parsed) continue;
      if (!this.projectPlcIds.has(parsed.deviceId)) continue;
      const next = this.disconnected.has(parsed.deviceId)
        ? { ...parsed, masterStatus: DISCONNECTED_MASTER_STATUS }
        : parsed;
      if (isSamePlcStatus(this.lastByDeviceId.get(parsed.deviceId), next)) continue;
      this.lastByDeviceId.set(parsed.deviceId, next);
      changed = true;
    }
    return changed ? this.snapshot() : null;
  }

  ingestTcpConn(result: unknown): PlcMasterStatus[] | null {
    if (!isCppAckOk(result) || !Array.isArray(result.data)) return null;
    let changed = false;
    for (const raw of result.data) {
      const parsed = parseTcpConnItem(raw);
      if (!parsed) continue;
      this.projectPlcIds.add(parsed.deviceId);
      if (parsed.connected === 0) {
        this.disconnected.delete(parsed.deviceId);
        continue;
      }
      this.disconnected.add(parsed.deviceId);
      const prev = this.lastByDeviceId.get(parsed.deviceId);
      const next = prev
        ? { ...prev, masterStatus: DISCONNECTED_MASTER_STATUS }
        : disconnectedStub(parsed.deviceId);
      if (isSamePlcStatus(prev, next)) continue;
      this.lastByDeviceId.set(parsed.deviceId, next);
      changed = true;
    }
    return changed ? this.snapshot() : null;
  }
}
