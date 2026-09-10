import { isCppAckResult } from "@shared/csocket/ack";
import { PROTOCOL_VERSION } from "@shared/csocket/protocol";
import type { CppAckResult } from "@shared/csocket/types";
import type { PlcRuntimeState } from "./plc-runtime-types";

export type PlcVerifyRecord = {
  version: number;
  proVerify: number;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export const parseProjectVerifyItem = (
  raw: unknown,
): (PlcVerifyRecord & { deviceId: number }) | null => {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  if (
    !isFiniteNumber(item.deviceId) ||
    !isFiniteNumber(item.version) ||
    !isFiniteNumber(item.proVerify)
  ) {
    return null;
  }
  return {
    deviceId: item.deviceId,
    version: item.version,
    proVerify: item.proVerify,
  };
};

export const pruneProjectVerifyMap = (
  map: ReadonlyMap<number, PlcVerifyRecord>,
  knownPlcIds: ReadonlySet<number>,
): Map<number, PlcVerifyRecord> => {
  const next = new Map(map);
  for (const id of next.keys()) {
    if (!knownPlcIds.has(id)) next.delete(id);
  }
  return next;
};

export const ingestProjectVerifyFrame = (
  prev: ReadonlyMap<number, PlcVerifyRecord>,
  data: unknown,
  knownPlcIds: ReadonlySet<number>,
): Map<number, PlcVerifyRecord> => {
  const next = new Map(prev);
  if (Array.isArray(data)) {
    for (const raw of data) {
      const item = parseProjectVerifyItem(raw);
      if (!item || !knownPlcIds.has(item.deviceId)) continue;
      next.set(item.deviceId, { version: item.version, proVerify: item.proVerify });
    }
  }
  return pruneProjectVerifyMap(next, knownPlcIds);
};

/** Temporary: skip protocol-version gate until C++ / console versions align. */
const SKIP_PROTOCOL_VERSION_MISMATCH = true;

export const runtimeVersionMismatch = (runtime: PlcRuntimeState): boolean =>
  !SKIP_PROTOCOL_VERSION_MISMATCH &&
  runtime.protocolVersion !== undefined &&
  runtime.protocolVersion !== PROTOCOL_VERSION;

export const runtimeProjectMismatch = (runtime: PlcRuntimeState): boolean =>
  runtime.proVerify === 1;

export const toOpenProjectCppAck = (raw: unknown): CppAckResult | null => {
  if (isCppAckResult(raw)) return raw;
  if (!raw || typeof raw !== "object") return null;
  const wrapped = raw as { ok?: unknown; data?: unknown };
  if (wrapped.ok === true && isCppAckResult(wrapped.data)) return wrapped.data;
  return null;
};

export const isFailedOpenProjectVerifyAck = (raw: unknown): boolean => {
  const ack = toOpenProjectCppAck(raw);
  return ack !== null && ack.success === false;
};

let lastOpenProjectAck: unknown = null;
const openAckListeners = new Set<() => void>();

export const setLastOpenProjectAck = (ack: unknown): void => {
  lastOpenProjectAck = ack;
  for (const listener of openAckListeners) listener();
};

export const getLastOpenProjectAck = (): unknown => lastOpenProjectAck;

export const subscribeLastOpenProjectAck = (listener: () => void): (() => void) => {
  openAckListeners.add(listener);
  return () => {
    openAckListeners.delete(listener);
  };
};

export const shouldShowProjectMismatchDialog = (
  runtimes: readonly PlcRuntimeState[],
  consumed: boolean,
): boolean => {
  if (consumed) return false;
  const reported = runtimes.filter((item) => item.protocolVersion !== undefined);
  if (reported.length === 0) return false;
  if (reported.some(runtimeVersionMismatch)) return false;
  return reported.some(runtimeProjectMismatch);
};

export const plcVerifyStatusLabel = (runtime: PlcRuntimeState): string | undefined => {
  if (runtime.protocolVersion === undefined) return undefined;
  if (runtimeVersionMismatch(runtime)) return "版本不一致";
  if (runtimeProjectMismatch(runtime)) return "工程不匹配";
  return undefined;
};
