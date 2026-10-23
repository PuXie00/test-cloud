import type { TrajectoryMode } from "@shared/action-sequence";
import type { ActionDataSaveItem } from "@shared/csocket/action-data-save";
import { toActionPrepareDevices, type ActionPrepareDevice } from "@shared/csocket/action-sync-prepare";
import type { CppAckResult, CsocketResult } from "@shared/csocket/types";
import {
  compilePlcAction,
  type PlcCompileContext,
} from "@/app/project/action-sequence/compile-plc-action";
import type { HpyPose } from "@/app/project/action-sequence/initial-pose-gate";
import type { NearestStartPlan } from "@/app/project/action-sequence/nearest-start";
import { toActionDataSaveItems } from "@/app/project/action-sequence/plc-action-payload";
import { resolveActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import { sequenceObjectIds } from "@/app/project/action-sequence/sequence-object-ids";
import { isSequenceLooping } from "@/app/project/action-sequence/sequence-loop";
import { evaluateSequenceSpeedRange } from "@/app/project/action-sequence/sequence-speed-range";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import {
  hasBlockingSequenceIssues,
  validateActionSequence,
  type SequenceIssue,
  type SequenceValidationContext,
  type VirtualAxisId,
} from "@/app/project/action-sequence/validate-sequence";
import type { ProjectDocument } from "@/app/project/project-document-types";
import { sequenceValidationContextFromSetup } from "@/app/project/project-motion-readiness";
import { capSpeedPercent, SPEED_CEILING_PERCENT } from "./speed-cap";

export type SequenceExecutionObject = {
  id: number;
  enabledVirtualAxes: readonly VirtualAxisId[];
  limits: SequenceValidationContext["objects"][number]["limits"];
  safetyRadius?: number;
};

export type SequenceExecutionContext = {
  objects: readonly SequenceExecutionObject[];
  hoistObjects?: SequenceValidationContext["hoistObjects"];
};

export type SequenceRuntimeHandle = {
  actionId: number;
  trajectoryMode?: boolean;
  deviceId?: number[];
  /** GO 时下发的循环配置，调速时原样带上 */
  loopCount?: number;
};

/** 运行中调速（强制轨迹走 actionSpeedScale） */
export type SequenceSpeedInput = {
  actionId: number;
  /** 速度倍率，1 = 100% */
  speedScale: number;
  runDirection: 1 | 2;
  loopCount: number;
  deviceId: number[];
};

export type DownloadedSequence =
  | {
      ok: true;
      actionId: number;
      sequenceId: number;
      modelIds: number[];
    }
  | { ok: false; reason: "validation"; issues: SequenceIssue[] };

export type SequenceExecutionTransport = {
  saveAction: (items: ActionDataSaveItem[]) => Promise<void>;
  syncCall: (input: {
    actionId: number;
    startTimestamp: number;
    speedScale: number;
    trajectoryMode: TrajectoryMode;
    loopCount: number;
    deviceId: number[];
    runDirection: 1 | 2;
    /** 强制轨迹 1006：就近算法选中的曲线时刻、准备时间（ms）与各设备准备 V/A */
    selectedCurveTimeMs?: number;
    prepareTimeMs?: number;
    prepareDevices?: ActionPrepareDevice[];
  }) => Promise<void>;
  stopAction: (input: {
    actionId: number;
    trajectoryMode: boolean;
    deviceId: number[];
  }) => Promise<void>;
  /** 运行中调速；没有该能力的传输层可以不提供 */
  setSpeed?: (input: SequenceSpeedInput) => Promise<void>;
};

export type SequenceCsocketClient = {
  actionReady: (items: ActionDataSaveItem[], opts?: unknown) => Promise<unknown>;
  actionGo: (items: unknown[], opts?: unknown) => Promise<unknown>;
  actionStop: (items: unknown[], opts?: unknown) => Promise<unknown>;
  actionSpeedScale?: (items: unknown[], opts?: unknown) => Promise<unknown>;
};

const COMPILE_FAILURE_ISSUE: SequenceIssue = {
  severity: "error",
  code: "invalid-preset",
  message: "动作序列无法编译",
};

type AxisLimits = SequenceValidationContext["objects"][number]["limits"];

const cloneLimits = (limits: AxisLimits): AxisLimits => {
  const cloned: AxisLimits = {};
  for (const axis of ["v1", "v2", "v3"] as const) {
    const limit = limits[axis];
    if (limit !== undefined) cloned[axis] = { ...limit };
  }
  return cloned;
};

const toValidationContext = (
  context: SequenceExecutionContext,
): SequenceValidationContext => ({
  objects: context.objects.map((object) => ({
    id: object.id,
    enabledVirtualAxes: [...object.enabledVirtualAxes],
    limits: cloneLimits(object.limits),
    ...(object.safetyRadius !== undefined ? { safetyRadius: object.safetyRadius } : {}),
  })),
  ...(context.hoistObjects ? { hoistObjects: context.hoistObjects } : {}),
});

const toCompileContext = (context: SequenceExecutionContext): PlcCompileContext => ({
  objects: context.objects.map((object) => ({
    id: object.id,
    enabledVirtualAxes: [...object.enabledVirtualAxes],
    limits: cloneLimits(object.limits),
    ...(object.safetyRadius !== undefined ? { safetyRadius: object.safetyRadius } : {}),
  })),
  ...(context.hoistObjects ? { hoistObjects: context.hoistObjects } : {}),
});

const uniqueSortedModelIds = (
  compiled: ReturnType<typeof compilePlcAction>,
): number[] =>
  [
    ...new Set([
      ...compiled.timelines.map((timeline) => timeline.modelId),
      ...compiled.models.map((model) => model.deviceId),
      ...compiled.ioBlocks.flatMap((block) =>
        block.params.params.map((item) => item.deviceId),
      ),
    ]),
  ].sort((left, right) => left - right);

export const mapFaderPercentToSpeedScale = (percent: number): number => {
  const clamped = Math.min(SPEED_CEILING_PERCENT, Math.max(0, percent));
  return clamped / 100;
};

/** 调速范围算不出来时只允许原速 */
export const FALLBACK_SPEED_CAP_PERCENT = 100;

export type SequenceSpeedCap =
  | { ok: true; maxPercent: number | null }
  | { ok: false; maxPercent: number; message: string };

/** 准备时按调速范围给推子封顶；与就近准备用同一份实时位置 */
export const resolveSequenceSpeedCap = (
  document: ProjectDocument,
  sequenceId: number,
  telemetryByObjectId: ReadonlyMap<number, HpyPose>,
): SequenceSpeedCap => {
  const sequence = document.motion.actionSequences.find((entry) => entry.id === sequenceId);
  if (!sequence) return { ok: true, maxPercent: null };
  try {
    const range = evaluateSequenceSpeedRange({
      resolved: resolveActionSequence(sequence),
      objects: document.setup.controlledObjects,
      motors: document.setup.motors,
      telemetryByObjectId,
      forced: sequence.trajectoryMode === true,
    });
    return { ok: true, maxPercent: range.maxPercent };
  } catch (error) {
    return {
      ok: false,
      maxPercent: FALLBACK_SPEED_CAP_PERCENT,
      message: `调速范围计算失败，速度最高 ${FALLBACK_SPEED_CAP_PERCENT}%：${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
};

export const downloadSequence = async (
  sequence: ActionSequenceConfig,
  context: SequenceExecutionContext,
  transport: SequenceExecutionTransport,
  startPlan?: NearestStartPlan | null,
  safeGroup = 1,
  runDirection = true,
): Promise<DownloadedSequence> => {
  const issues = validateActionSequence(sequence, toValidationContext(context));
  if (hasBlockingSequenceIssues(issues)) {
    return { ok: false, reason: "validation", issues };
  }

  let compiled: ReturnType<typeof compilePlcAction>;
  try {
    resolveActionSequence(sequence);
    compiled = compilePlcAction(sequence, toCompileContext(context), !runDirection);
  } catch {
    return { ok: false, reason: "validation", issues: [COMPILE_FAILURE_ISSUE] };
  }

  const items = toActionDataSaveItems(
    compiled,
    sequence.id,
    sequence.trajectoryMode,
    safeGroup,
    runDirection,
  );
  await transport.saveAction(startPlan ? items.map((item) => ({ ...item, startPlan })) : items);
  return {
    ok: true,
    actionId: sequence.id,
    sequenceId: sequence.id,
    modelIds: uniqueSortedModelIds(compiled),
  };
};

export const stopSequence = async (
  handle: {
    actionId: number;
    trajectoryMode: boolean;
    deviceId: number[];
  },
  transport: SequenceExecutionTransport,
): Promise<void> => {
  await transport.stopAction(handle);
};

export type SequenceReleaseResult = { ok: true } | LocalSequenceFailure;

/**
 * 释放一个已停下的动作（同停止指令）。PLC 拒绝时如实报错；没连上 PLC 时按成功处理。
 * 下一个动作准备前要先释放上一个，否则释放会把刚准备好的同一批物体一起停掉。
 */
export const releaseSequence = async (
  handle: { actionId: number; trajectoryMode: boolean; deviceId: number[] },
  transport: SequenceExecutionTransport = getSequenceTransport(),
): Promise<SequenceReleaseResult> => {
  try {
    await stopSequence(handle, transport);
    return { ok: true };
  } catch (error) {
    if (isPlcRejection(error)) return plcFailure("上一条动作释放失败", error);
    return { ok: true };
  }
};

export const createLocalSequenceTransport = (): SequenceExecutionTransport => ({
  saveAction: async () => undefined,
  syncCall: async () => undefined,
  stopAction: async () => undefined,
  setSpeed: async () => undefined,
});

let localSequenceTransport: SequenceExecutionTransport | null = null;

export const getLocalSequenceTransport = (): SequenceExecutionTransport => {
  if (!localSequenceTransport) {
    localSequenceTransport = createLocalSequenceTransport();
  }
  return localSequenceTransport;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isCsocketFailure = (value: unknown): value is CsocketResult<never> & { ok: false } =>
  isRecord(value) && value.ok === false;

/** C++ 没连上或没有应答时 sendBuilt 回的错误码 */
const PLC_UNREACHABLE_CODE = "SEND_FAILED";

/** 动作指令被 PLC 拒绝或没有送达；code 为 SEND_FAILED 表示没连上 / 没应答 */
export class PlcCommandError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "PlcCommandError";
  }
}

/**
 * PLC 明确拒绝了指令（有应答但 success=false，或下载有错误）。
 * 没连上 / 没应答 / 通道异常这一阶段仍按本地模拟成功处理，不算拒绝。
 */
export const isPlcRejection = (error: unknown): boolean =>
  error instanceof PlcCommandError && error.code !== PLC_UNREACHABLE_CODE;

/**
 * actionReady / actionGo / actionStop 在主进程里按模式拆成多条指令，返回的是应答数组；
 * 单条应答也兼容。
 */
const unwrapCppAcks = (raw: unknown, label: string): CppAckResult[] => {
  if (isCsocketFailure(raw)) {
    throw new PlcCommandError(raw.message || `csocket ${label} failed`, PLC_UNREACHABLE_CODE);
  }
  const inner = isRecord(raw) && raw.ok === true ? raw.data : raw;
  const acks: unknown[] = Array.isArray(inner) ? inner : [inner];
  if (acks.length === 0 || acks.some((ack) => !isRecord(ack) || typeof ack.success !== "boolean")) {
    // 没拿到可用的应答，按没应答处理
    throw new PlcCommandError(`csocket ${label} missing CppAckResult`, PLC_UNREACHABLE_CODE);
  }
  return acks as CppAckResult[];
};

const requireSuccessfulAcks = (raw: unknown, label: string): CppAckResult[] => {
  const acks = unwrapCppAcks(raw, label);
  const failed = acks.find((ack) => !ack.success);
  if (failed) {
    throw new PlcCommandError(
      failed.message || `${label} success=false`,
      String(failed.code ?? "ACK_FAILED"),
    );
  }
  return acks;
};

const requireSaveAck = (raw: unknown): void => {
  for (const ack of requireSuccessfulAcks(raw, "actionDataSave")) {
    const first = ack.data?.[0];
    const errorCount =
      isRecord(first) && typeof first.errorCount === "number" ? first.errorCount : 0;
    if (errorCount > 0) {
      const codes = isRecord(first) && "errorCode" in first ? first.errorCode : [];
      throw new PlcCommandError(
        `actionDataSave errorCount=${errorCount} errorCode=${JSON.stringify(codes)}`,
        "SAVE_ERROR",
      );
    }
  }
};

/** PLC 准备头：未开反向为 1，开启反向为 2。 */
export const toPlcRunDirection = (reverse: boolean): 1 | 2 => (reverse ? 2 : 1);

/** C++: 0 = 一直循环，1 = 播一次。 */
export const toActionGoLoopCount = (looping: boolean): 0 | 1 => (looping ? 0 : 1);

export const createCsocketSequenceTransport = (
  api: SequenceCsocketClient,
): SequenceExecutionTransport => ({
  saveAction: async (items) => {
    requireSaveAck(await api.actionReady(items));
  },
  syncCall: async (input) => {
    void input.startTimestamp;
    requireSuccessfulAcks(
      await api.actionGo([
        {
          actionId: input.actionId,
          runDirection: input.runDirection,
          speedScale: input.speedScale,
          loopCount: input.loopCount,
          trajectoryMode: input.trajectoryMode,
          deviceId: input.deviceId,
          ...(input.selectedCurveTimeMs !== undefined
            ? { selectedCurveTimeMs: input.selectedCurveTimeMs }
            : {}),
          ...(input.prepareTimeMs !== undefined ? { prepareTimeMs: input.prepareTimeMs } : {}),
          ...(input.prepareDevices ? { prepareDevices: input.prepareDevices } : {}),
        },
      ]),
      "actionGo",
    );
  },
  stopAction: async (input) => {
    requireSuccessfulAcks(
      await api.actionStop([
        {
          actionId: input.actionId,
          trajectoryMode: input.trajectoryMode,
          deviceId: input.deviceId,
        },
      ]),
      "actionStop",
    );
  },
  setSpeed: async (input) => {
    if (!api.actionSpeedScale) return;
    requireSuccessfulAcks(await api.actionSpeedScale([input]), "actionSpeedScale");
  },
});

const hasSequenceCsocketApi = (value: unknown): value is SequenceCsocketClient => {
  if (!isRecord(value)) return false;
  return (
    typeof value.actionReady === "function" &&
    typeof value.actionGo === "function" &&
    typeof value.actionStop === "function"
  );
};

/** Prefer the live csocket API; fall back to the no-op local transport. */
export const getSequenceTransport = (): SequenceExecutionTransport => {
  const api = typeof window !== "undefined" ? window.csocketApi : undefined;
  if (hasSequenceCsocketApi(api)) return createCsocketSequenceTransport(api);
  return getLocalSequenceTransport();
};

export type LocalSequenceFailure = {
  ok: false;
  toast: "warning" | "error";
  message: string;
};

export type LocalSequenceReadyResult =
  | {
      ok: true;
      name: string;
      sequenceHandle: SequenceRuntimeHandle;
      fingerprint: string;
    }
  | LocalSequenceFailure;

export type LocalSequenceStartResult =
  | {
      ok: true;
      name: string;
      speedPercent: number;
      sequenceHandle: SequenceRuntimeHandle;
    }
  | LocalSequenceFailure;

const plcFailure = (action: string, error: unknown): LocalSequenceFailure => ({
  ok: false,
  toast: "error",
  message: `${action}：${error instanceof Error ? error.message : String(error)}`,
});

type SequenceLookup =
  | { ok: true; sequence: ActionSequenceConfig }
  | LocalSequenceFailure;

export const sequenceReadyFingerprint = (sequence: ActionSequenceConfig): string =>
  JSON.stringify({
    id: sequence.id,
    trajectoryMode: sequence.trajectoryMode,
    blocks: sequence.blocks,
    segments: sequence.segments,
  });

export const sequenceExecutionContextFromDocument = (
  document: ProjectDocument,
): SequenceExecutionContext => {
  const validation = sequenceValidationContextFromSetup(document);
  return {
    objects: validation.objects,
    ...(validation.hoistObjects ? { hoistObjects: validation.hoistObjects } : {}),
  };
};

const lookupAuthoredSequence = (
  document: ProjectDocument,
  sequenceId: number,
): SequenceLookup => {
  const sequence = document.motion.actionSequences.find((entry) => entry.id === sequenceId);
  if (!sequence) {
    return { ok: false, toast: "warning", message: "动作序列不可用，待修复" };
  }
  return { ok: true, sequence };
};

export const readySequence = async (args: {
  document: ProjectDocument;
  sequenceId: number;
  startPlan?: NearestStartPlan | null;
  safeGroup?: number;
  runDirection?: boolean;
  transport?: SequenceExecutionTransport;
}): Promise<LocalSequenceReadyResult> => {
  const found = lookupAuthoredSequence(args.document, args.sequenceId);
  if (!found.ok) return found;

  const transport = args.transport ?? getSequenceTransport();
  try {
    const downloaded = await downloadSequence(
      found.sequence,
      sequenceExecutionContextFromDocument(args.document),
      transport,
      args.startPlan,
      args.safeGroup ?? 1,
      args.runDirection ?? true,
    );
    if (!downloaded.ok) {
      return { ok: false, toast: "warning", message: "动作序列校验失败，无法下载" };
    }

    return {
      ok: true,
      name: found.sequence.name,
      sequenceHandle: {
        actionId: downloaded.actionId,
      },
      fingerprint: sequenceReadyFingerprint(found.sequence),
    };
  } catch (error) {
    // PLC 拒绝了准备：如实报错，不能当成已准备
    if (isPlcRejection(error)) return plcFailure("动作准备失败", error);
    // PLC / csocket is optional this phase: simulate a successful Ready locally.
    return {
      ok: true,
      name: found.sequence.name,
      sequenceHandle: {
        actionId: found.sequence.id,
      },
      fingerprint: sequenceReadyFingerprint(found.sequence),
    };
  }
};

export const goSequence = async (args: {
  document: ProjectDocument;
  sequenceId: number;
  faderPercent?: number;
  reverse?: boolean;
  /** 准备时就近算法给出的计划：1006 用它的准备所需时间、各设备 V/A 与实际循环配置 */
  startPlan?: NearestStartPlan | null;
  /** 调速范围给出的速度上限（百分比）；缺省或 null 为不限 */
  maxSpeedPercent?: number | null;
  transport?: SequenceExecutionTransport;
}): Promise<LocalSequenceStartResult> => {
  const found = lookupAuthoredSequence(args.document, args.sequenceId);
  if (!found.ok) return found;

  const speedPercent = capSpeedPercent(args.faderPercent ?? 100, args.maxSpeedPercent);
  const deviceId = [...sequenceObjectIds(found.sequence)].sort((left, right) => left - right);
  const transport = args.transport ?? getSequenceTransport();
  const plan = args.startPlan ?? null;
  const loopCount = plan?.loopCount ?? toActionGoLoopCount(isSequenceLooping(found.sequence));

  try {
    await transport.syncCall({
      actionId: found.sequence.id,
      startTimestamp: Date.now(),
      speedScale: mapFaderPercentToSpeedScale(speedPercent),
      trajectoryMode: found.sequence.trajectoryMode,
      loopCount,
      deviceId,
      runDirection: toPlcRunDirection(args.reverse === true),
      ...(plan
        ? {
            selectedCurveTimeMs: plan.targetFrameMs,
            prepareTimeMs: plan.prepareTimeMs,
            prepareDevices: toActionPrepareDevices(plan, deviceId),
          }
        : {}),
    });

    return {
      ok: true,
      name: found.sequence.name,
      speedPercent,
      sequenceHandle: {
        actionId: found.sequence.id,
        deviceId,
        loopCount,
      },
    };
  } catch (error) {
    // PLC 拒绝了启动：如实报错，不能出任务卡
    if (isPlcRejection(error)) return plcFailure("动作启动失败", error);
    // PLC / csocket is optional this phase: simulate a successful GO locally.
    return {
      ok: true,
      name: found.sequence.name,
      speedPercent,
      sequenceHandle: {
        actionId: found.sequence.id,
        deviceId,
        loopCount,
      },
    };
  }
};

export const startLocalAuthoredSequence = async (args: {
  document: ProjectDocument;
  sequenceId: number;
  faderPercent?: number;
  reverse?: boolean;
  transport?: SequenceExecutionTransport;
}): Promise<LocalSequenceStartResult> => {
  const readied = await readySequence(args);
  if (!readied.ok) return readied;
  return goSequence(args);
};
