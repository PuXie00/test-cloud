import type { TrajectoryMode } from "@shared/action-sequence";
import type { ActionDataSaveItem } from "@shared/csocket/action-data-save";
import type { CppAckResult, CsocketResult } from "@shared/csocket/types";
import {
  compilePlcAction,
  type PlcCompileContext,
} from "@/app/project/action-sequence/compile-plc-action";
import { toActionDataSaveItems } from "@/app/project/action-sequence/plc-action-payload";
import { resolveActionSequence } from "@/app/project/action-sequence/resolve-sequence";
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

export const SEQUENCE_SAMPLE_INTERVAL_MS = 20;
/** Local placeholder until firmware confirms actionNo ↔ syncGroupId. */
export const LOCAL_SEQUENCE_SYNC_GROUP_ID = 1;

export type SequenceExecutionObject = {
  id: number;
  enabledVirtualAxes: readonly VirtualAxisId[];
  limits: SequenceValidationContext["objects"][number]["limits"];
};

export type SequenceExecutionContext = {
  objects: readonly SequenceExecutionObject[];
  sampleIntervalMs: number;
  hoistObjects?: SequenceValidationContext["hoistObjects"];
};

export type SequenceRuntimeHandle = {
  actionNo: number;
  syncGroupId: number;
};

export type DownloadedSequence =
  | {
      ok: true;
      actionNo: number;
      checksum: number;
      sequenceId: number;
      modelIds: number[];
    }
  | { ok: false; reason: "validation"; issues: SequenceIssue[] };

export type SequenceExecutionTransport = {
  saveAction: (items: ActionDataSaveItem[]) => Promise<void>;
  syncCall: (input: {
    actionNo: number;
    syncGroupId: number;
    startTimestamp: number;
    speedScale: number;
    trajectoryMode: TrajectoryMode;
  }) => Promise<void>;
  stopAction: (input: { actionNo: number; syncGroupId: number }) => Promise<void>;
};

export type SequenceCsocketClient = {
  actionDataSavePlc: (items: ActionDataSaveItem[], opts?: unknown) => Promise<unknown>;
  actionSyncCallPlc: (items: unknown[], opts?: unknown) => Promise<unknown>;
  stopActionPlc: (items: unknown[], opts?: unknown) => Promise<unknown>;
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
  })),
  ...(context.hoistObjects ? { hoistObjects: context.hoistObjects } : {}),
});

const toCompileContext = (context: SequenceExecutionContext): PlcCompileContext => ({
  objects: context.objects.map((object) => ({
    id: object.id,
    enabledVirtualAxes: [...object.enabledVirtualAxes],
    limits: cloneLimits(object.limits),
  })),
  sampleIntervalMs: context.sampleIntervalMs,
  ...(context.hoistObjects ? { hoistObjects: context.hoistObjects } : {}),
});

const uniqueSortedModelIds = (
  compiled: ReturnType<typeof compilePlcAction>,
): number[] =>
  [
    ...new Set([
      ...compiled.timelines.map((timeline) => timeline.modelNo),
      ...compiled.events.map((event) => event.modelNo),
    ]),
  ].sort((left, right) => left - right);

export const mapFaderPercentToSpeedScale = (percent: number): number => {
  const clamped = Math.min(200, Math.max(0, percent));
  return clamped / 100;
};

export const downloadSequence = async (
  sequence: ActionSequenceConfig,
  context: SequenceExecutionContext,
  transport: SequenceExecutionTransport,
): Promise<DownloadedSequence> => {
  const issues = validateActionSequence(sequence, toValidationContext(context));
  if (hasBlockingSequenceIssues(issues)) {
    return { ok: false, reason: "validation", issues };
  }

  let compiled: ReturnType<typeof compilePlcAction>;
  try {
    resolveActionSequence(sequence);
    compiled = compilePlcAction(sequence, toCompileContext(context));
  } catch {
    return { ok: false, reason: "validation", issues: [COMPILE_FAILURE_ISSUE] };
  }

  await transport.saveAction(toActionDataSaveItems(compiled, sequence.id));
  return {
    ok: true,
    actionNo: sequence.id,
    checksum: compiled.checksum,
    sequenceId: sequence.id,
    modelIds: uniqueSortedModelIds(compiled),
  };
};

export const stopSequence = async (
  handle: SequenceRuntimeHandle,
  transport: SequenceExecutionTransport,
): Promise<void> => {
  await transport.stopAction(handle);
};

export const createLocalSequenceTransport = (): SequenceExecutionTransport => ({
  saveAction: async () => undefined,
  syncCall: async () => undefined,
  stopAction: async () => undefined,
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

const unwrapCppAck = (raw: unknown, label: string): CppAckResult => {
  if (isCsocketFailure(raw)) {
    throw new Error(raw.message || `csocket ${label} failed`);
  }
  const inner = isRecord(raw) && raw.ok === true ? raw.data : raw;
  if (!isRecord(inner) || typeof inner.success !== "boolean") {
    throw new Error(`csocket ${label} missing CppAckResult`);
  }
  return inner as CppAckResult;
};

const requireSuccessfulAck = (raw: unknown, label: string): CppAckResult => {
  const ack = unwrapCppAck(raw, label);
  if (!ack.success) {
    throw new Error(ack.message || `${label} success=false`);
  }
  return ack;
};

/**
 * Placeholder fields until the protocol gate confirms prepare/sync encoding.
 * Do not change electron/main item shapes.
 */
const ADAPTER_START_MODE = 0;
const ADAPTER_RUN_DIRECTION = 0;
const ADAPTER_LOOP_COUNT = 1;
const ADAPTER_AUTO_POSITION_CHECK = 0;

export const createCsocketSequenceTransport = (
  api: SequenceCsocketClient,
): SequenceExecutionTransport => ({
  saveAction: async (items) => {
    await requireSuccessfulAck(await api.actionDataSavePlc(items), "actionDataSave");
  },
  syncCall: async (input) => {
    // The C++ contract has not assigned a wire field for this semantic mode yet.
    // Keep the mode at the adapter boundary; do not guess a numeric mapping.
    void input.trajectoryMode;
    await requireSuccessfulAck(
      await api.actionSyncCallPlc([
        {
          syncGroupId: input.syncGroupId,
          startMode: ADAPTER_START_MODE,
          runDirection: ADAPTER_RUN_DIRECTION,
          speedScale: input.speedScale,
          loopCount: ADAPTER_LOOP_COUNT,
          autoPositionCheckFlag: ADAPTER_AUTO_POSITION_CHECK,
          startTimestamp: input.startTimestamp,
        },
      ]),
      "actionSyncCall",
    );
  },
  stopAction: async (input) => {
    // UNCONFIRMED: stopActionPlc currently takes `{ deviceId }[]`. Map actionNo → deviceId
    // inside this adapter only until firmware confirms the stop payload.
    await requireSuccessfulAck(
      await api.stopActionPlc([{ deviceId: input.actionNo }]),
      "stopAction",
    );
  },
});

export type LocalSequenceStartResult =
  | {
      ok: true;
      name: string;
      speedPercent: number;
      sequenceHandle: SequenceRuntimeHandle;
    }
  | { ok: false; toast: "warning" | "error"; message: string };

export const sequenceExecutionContextFromDocument = (
  document: ProjectDocument,
): SequenceExecutionContext => {
  const validation = sequenceValidationContextFromSetup(document);
  return {
    objects: validation.objects,
    sampleIntervalMs: SEQUENCE_SAMPLE_INTERVAL_MS,
    ...(validation.hoistObjects ? { hoistObjects: validation.hoistObjects } : {}),
  };
};

export const startLocalAuthoredSequence = async (args: {
  document: ProjectDocument;
  sequenceId: number;
  faderPercent?: number;
  transport?: SequenceExecutionTransport;
}): Promise<LocalSequenceStartResult> => {
  const sequence = args.document.motion.actionSequences.find(
    (entry) => entry.id === args.sequenceId,
  );
  if (!sequence) {
    return { ok: false, toast: "warning", message: "动作序列不可用，待修复" };
  }

  const fromFader = args.faderPercent !== undefined;
  const speedPercent = args.faderPercent ?? 100;
  const transport = args.transport ?? getLocalSequenceTransport();

  try {
    const downloaded = await downloadSequence(
      sequence,
      sequenceExecutionContextFromDocument(args.document),
      transport,
    );
    if (!downloaded.ok) {
      return { ok: false, toast: "warning", message: "动作序列校验失败，无法下载" };
    }

    await transport.syncCall({
      actionNo: downloaded.actionNo,
      syncGroupId: LOCAL_SEQUENCE_SYNC_GROUP_ID,
      startTimestamp: Date.now(),
      speedScale: fromFader ? mapFaderPercentToSpeedScale(speedPercent) : 1,
      trajectoryMode: sequence.trajectoryMode,
    });

    return {
      ok: true,
      name: sequence.name,
      speedPercent,
      sequenceHandle: {
        actionNo: downloaded.actionNo,
        syncGroupId: LOCAL_SEQUENCE_SYNC_GROUP_ID,
      },
    };
  } catch {
    return { ok: false, toast: "error", message: "动作序列启动失败" };
  }
};
