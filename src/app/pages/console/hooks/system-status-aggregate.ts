import type { PlcLifecycle, PlcRuntimeState } from "./plc-runtime-types";
import {
  runtimeProjectMismatch,
  runtimeVersionMismatch,
} from "./project-verify";

/** TopBar 聚合系统状态（「配置成功」不进入主文案） */
export type SystemStatusKind =
  | "unconfigured"
  | "versionMismatch"
  | "projectMismatch"
  | "configuring"
  | "configFailed"
  | "initializing"
  | "suspended"
  | "normal";

export type AggregatedSystemStatus = {
  kind: SystemStatusKind;
  label: string;
  /** 明细副文案（如挂起原因） */
  detail?: string;
  simulatingCount: number;
  totalCount: number;
};

export const SYSTEM_STATUS_LABELS: Record<SystemStatusKind, string> = {
  unconfigured: "未配置",
  versionMismatch: "版本不一致",
  projectMismatch: "工程不匹配",
  configuring: "配置中",
  configFailed: "配置失败",
  initializing: "初始化",
  suspended: "挂起",
  normal: "正常",
};

export const LIFECYCLE_LABELS: Record<PlcLifecycle, string> = {
  configuring: "配置中",
  configFailed: "配置失败",
  initializing: "初始化",
  suspended: "挂起",
  normal: "正常",
};

const pickFirstReason = (
  runtimes: readonly PlcRuntimeState[],
  lifecycles: readonly PlcLifecycle[],
): string | undefined => {
  for (const runtime of runtimes) {
    if (lifecycles.includes(runtime.lifecycle) && runtime.lifecycleReason) {
      return runtime.lifecycleReason;
    }
  }
  return undefined;
};

/**
 * P1：版本不一致 > 工程不匹配 > 挂起/配置失败 > 配置中 > 初始化 > 正常
 * 全部 normal 且全开仿真：kind 仍为 normal（绿色），detail 为「仿真」
 */
export const aggregateSystemStatus = (
  runtimes: readonly PlcRuntimeState[],
): AggregatedSystemStatus => {
  const totalCount = runtimes.length;
  if (totalCount === 0) {
    return {
      kind: "unconfigured",
      label: SYSTEM_STATUS_LABELS.unconfigured,
      simulatingCount: 0,
      totalCount: 0,
    };
  }

  const simulatingCount = runtimes.filter((item) => item.simulation).length;

  if (runtimes.some(runtimeVersionMismatch)) {
    return {
      kind: "versionMismatch",
      label: SYSTEM_STATUS_LABELS.versionMismatch,
      simulatingCount,
      totalCount,
    };
  }

  if (runtimes.some(runtimeProjectMismatch)) {
    return {
      kind: "projectMismatch",
      label: SYSTEM_STATUS_LABELS.projectMismatch,
      simulatingCount,
      totalCount,
    };
  }

  const hasConfigFailed = runtimes.some((item) => item.lifecycle === "configFailed");
  if (hasConfigFailed) {
    return {
      kind: "configFailed",
      label: SYSTEM_STATUS_LABELS.configFailed,
      detail: pickFirstReason(runtimes, ["configFailed"]),
      simulatingCount,
      totalCount,
    };
  }

  const hasSuspended = runtimes.some((item) => item.lifecycle === "suspended");
  if (hasSuspended) {
    return {
      kind: "suspended",
      label: SYSTEM_STATUS_LABELS.suspended,
      detail: pickFirstReason(runtimes, ["suspended"]),
      simulatingCount,
      totalCount,
    };
  }

  const hasConfiguring = runtimes.some((item) => item.lifecycle === "configuring");
  if (hasConfiguring) {
    return {
      kind: "configuring",
      label: SYSTEM_STATUS_LABELS.configuring,
      simulatingCount,
      totalCount,
    };
  }

  const hasInitializing = runtimes.some((item) => item.lifecycle === "initializing");
  if (hasInitializing) {
    return {
      kind: "initializing",
      label: SYSTEM_STATUS_LABELS.initializing,
      simulatingCount,
      totalCount,
    };
  }

  return {
    kind: "normal",
    label: SYSTEM_STATUS_LABELS.normal,
    detail: simulatingCount === totalCount ? "仿真" : undefined,
    simulatingCount,
    totalCount,
  };
};

export const isLifecycleBusy = (lifecycle: PlcLifecycle): boolean =>
  lifecycle === "configuring" || lifecycle === "initializing";
