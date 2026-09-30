import type { TrajectoryMode } from "@shared/action-sequence";
import { isCppAckOk } from "@shared/csocket/ack";
import type { SequenceRuntimeHandle } from "./sequence-execution";
import type { ExecCard, ExecCardRun, ExecCardSource } from "./use-exec-cards";

/** PLC 动作状态：1 过渡（正在走到轨迹上，回迹中），3 运行中 */
export const ACTION_RUN_STATE = { transition: 1, running: 3 } as const;

/** runTime（轨迹运行的当前帧）换算成毫秒的系数 */
export const ACTION_RUN_TIME_UNIT_MS = 1;

/**
 * PLC 只上报正在执行的动作（约 50ms 一次），不会通知完成或停止。
 * 一个动作超过这么久没再上报，才视为真正停下来了。
 */
export const ACTION_RUN_STALE_MS = 500;

export type ActionRunReport = {
  actionId: number;
  state: number;
  loopCount: number;
  loopCountSet: number;
  runTimeMs: number;
};

/** PLC 上报了没有任务卡的动作时，用来补建任务卡的信息（来自序列和执行槽） */
export type ActionCardSeed = {
  name: string;
  source: ExecCardSource;
  speedPercent: number;
  sequenceId?: number;
  sequenceHandle: SequenceRuntimeHandle;
  trajectoryMode?: TrajectoryMode;
  totalMs?: number;
  reverse?: boolean;
};

export const fallbackActionCardSeed = (actionId: number): ActionCardSeed => ({
  name: `动作 ${actionId}`,
  source: { kind: "external" },
  speedPercent: 100,
  sequenceHandle: { actionId },
});

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const parseReport = (raw: unknown): ActionRunReport | null => {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  if (!isFiniteNumber(item.actionId) || !isFiniteNumber(item.state)) return null;
  return {
    actionId: item.actionId,
    state: item.state,
    loopCount: isFiniteNumber(item.loopCount) ? item.loopCount : 0,
    loopCountSet: isFiniteNumber(item.loopCountSet) ? item.loopCountSet : 0,
    runTimeMs: isFiniteNumber(item.runTime) ? item.runTime * ACTION_RUN_TIME_UNIT_MS : 0,
  };
};

export const parseActionRunReports = (msg: unknown): ActionRunReport[] => {
  if (!isCppAckOk(msg) || !Array.isArray(msg.data)) return [];
  return msg.data.flatMap((raw) => {
    const report = parseReport(raw);
    return report ? [report] : [];
  });
};

export const execCardActionId = (card: ExecCard): number | undefined =>
  card.sequenceHandle?.actionId ?? card.sequenceId;

/** 正在走到轨迹上（回迹中）：此时不能调速 */
export const isExecCardInTransition = (card: ExecCard): boolean =>
  card.status === "running" && card.run?.state === ACTION_RUN_STATE.transition;

/** 动作真正停下来（PLC 不再上报）之后才允许关闭任务卡 */
export const canCloseExecCard = (card: ExecCard): boolean =>
  !card.plcActive && card.status !== "running" && card.status !== "stopping";

const cardFromSeed = (actionId: number, seed: ActionCardSeed, run: ExecCardRun): ExecCard => ({
  id: `card-action-${actionId}-${run.reportedAt.toString(36)}`,
  kind: "sequence",
  name: seed.name,
  source: seed.source,
  durationMs: null,
  elapsedMs: 0,
  speedPercent: seed.speedPercent,
  status: "running",
  startedAt: run.reportedAt,
  emergencyStopped: false,
  sequenceHandle: seed.sequenceHandle,
  run,
  plcActive: true,
  ...(seed.sequenceId !== undefined ? { sequenceId: seed.sequenceId } : {}),
  ...(seed.trajectoryMode !== undefined ? { trajectoryMode: seed.trajectoryMode } : {}),
  ...(seed.totalMs !== undefined ? { totalMs: seed.totalMs } : {}),
  ...(seed.reverse !== undefined ? { reverse: seed.reverse } : {}),
});

/**
 * 把 PLC 上报写进任务卡。已停止的任务卡又被上报时恢复为运行中；停止中的保持停止中（还在减速）。
 * 没有任务卡的执行中动作补建一张，保证执行中的动作一定在任务卡里。
 */
export const applyActionRunReports = (
  cards: ExecCard[],
  reports: readonly ActionRunReport[],
  now: number,
  seed: (actionId: number) => ActionCardSeed,
): ExecCard[] | null => {
  let next = cards;
  for (const report of reports) {
    const run: ExecCardRun = {
      state: report.state,
      loopCount: report.loopCount,
      loopCountSet: report.loopCountSet,
      runTimeMs: report.runTimeMs,
      reportedAt: now,
    };
    const index = next.findIndex((card) => execCardActionId(card) === report.actionId);
    if (index < 0) {
      next = [cardFromSeed(report.actionId, seed(report.actionId), run), ...next];
      continue;
    }
    const card = next[index]!;
    const revive = card.status === "stopped" || card.status === "paused";
    const updated: ExecCard = {
      ...card,
      run,
      plcActive: true,
      ...(revive ? { status: "running" as const } : {}),
    };
    next = next.map((entry, entryIndex) => (entryIndex === index ? updated : entry));
  }
  return next === cards ? null : next;
};

const isReported = (card: ExecCard, now: number): boolean =>
  card.run !== undefined && now - card.run.reportedAt <= ACTION_RUN_STALE_MS;

/**
 * PLC 不再上报的任务卡转为已停止，留给用户自己关闭：
 * 运行中的视为自然结束；停止中的视为已真正停下（从未上报过的，按停止请求后的静默时间算）。
 */
export const settleSilentCards = (cards: ExecCard[], now: number): ExecCard[] | null => {
  let changed = false;
  const next = cards.map((card) => {
    if (isReported(card, now)) return card;
    const wasActive = card.plcActive === true;
    const stopSettled =
      card.status === "stopping" && now - (card.stopRequestedAt ?? 0) > ACTION_RUN_STALE_MS;
    const stopped = stopSettled || (wasActive && card.status === "running");
    if (!wasActive && !stopped) return card;
    changed = true;
    return {
      ...card,
      plcActive: false,
      ...(stopped ? { status: "stopped" as const } : {}),
    };
  });
  return changed ? next : null;
};
