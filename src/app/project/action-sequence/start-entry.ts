import { resolveActionSequence } from "./resolve-sequence";
import {
  evaluateStartGate,
  remainingProgramMs,
  type StartGateInput,
  type StartGateOptions,
  type StartGateResult,
} from "./initial-pose-gate";
import { entryFramesOf, type EntryFrames, type NearestStartPlan } from "./nearest-start";

/**
 * 准备弹窗里操作者可选的接入方式，全部映射到就近算法已有的参数：
 * nearest 就近（有参考帧时就是“从停下处继续”）、boundary 从头开始（反向从末尾）、
 * frame 指定位置（强制、非强制都正好从这一帧开始，接不上就报错）。
 */
export type StartEntryChoice =
  | { kind: "nearest" }
  | { kind: "boundary" }
  | { kind: "frame"; frameMs: number };

export type StartEntryInput = Omit<StartGateInput, "nearest" | "specifiedFrameMs">;

export const startGateOptionsFor = (
  choice: StartEntryChoice,
  base: { reverse: boolean; referenceFrameMs?: number },
): StartGateOptions => {
  if (choice.kind === "boundary") return { nearest: false, reverse: base.reverse };
  if (choice.kind === "frame") {
    return { nearest: true, reverse: base.reverse, specifiedFrameMs: choice.frameMs };
  }
  return {
    nearest: true,
    reverse: base.reverse,
    ...(base.referenceFrameMs !== undefined ? { referenceFrameMs: base.referenceFrameMs } : {}),
  };
};

/** 弹窗默认选中的方式：有参考帧（继续 / 反向回）或开了就近选就近，否则从头开始 */
export const defaultStartEntry = (options: StartGateOptions): StartEntryChoice =>
  options.nearest || options.referenceFrameMs !== undefined ? { kind: "nearest" } : { kind: "boundary" };

export type StartEntryOutcome =
  | {
      ok: true;
      plan: NearestStartPlan;
      /** 先移动到接入点的共同准备时间 */
      transitionSeconds: number;
      /** 接入后还要跑的编程时长 */
      runSeconds: number;
      /** 跳过的编程时长：正向是接入帧之前，反向是接入帧之后 */
      skippedSeconds: number;
      totalSeconds: number;
      programSeconds: number;
    }
  | { ok: false; message: string; detail: string };

/** 算法报错转成操作者看得懂的话；原文留作详细原因 */
export const describeEntryError = (message: string): string => {
  if (/计算超时/.test(message)) return "计算超时，可改选从头开始或指定位置";
  if (/原帧表.*(超过最大能力|超出协议上限|超出行程)/.test(message)) return "动作里有超出设备能力或行程的运动，在它之前接不上";
  if (/最多比参考帧靠后/.test(message)) return "停下处附近接不上，可改选从头开始或指定位置";
  if (/均无可执行接入方案|运行方向上没有可接入的帧/.test(message)) return "沿运行方向找不到能接入的位置";
  if (/没有可执行的共同关键帧|没有候选关键帧/.test(message)) return "沿运行方向没有能接入的关键帧";
  if (/当前位置(已)?超出.*行程/.test(message)) return "有设备当前位置超出行程";
  if (/超出虚轴行程|接入位置超出行程/.test(message)) return "接入点超出设备行程";
  if (/还在运动/.test(message)) return "有设备还在运动，停稳后再准备";
  if (/^指定帧无法接入/.test(message)) return "这个位置接不上，可换一个位置或改选从头开始";
  if (/^起点无法接入/.test(message)) return "无法从起点开始，可改选就近或指定位置";
  if (/速度必须大于0|速度为0|速度不能为0/.test(message)) return "有设备的速度参数为 0，无法计算移动";
  if (/缺少受控物体/.test(message)) return "动作里有设备不在当前工程中";
  if (/无法解析/.test(message)) return "动作数据有误，无法计算";
  return "无法计算接入方案";
};

export const startEntryOutcome = (gate: StartGateResult): StartEntryOutcome => {
  if (gate.status === "error") {
    return { ok: false, message: describeEntryError(gate.message), detail: gate.message };
  }
  const { plan, programSeconds } = gate;
  const runSeconds = remainingProgramMs(plan, programSeconds * 1000) / 1000;
  const transitionSeconds = gate.status === "transition" ? gate.transitionSeconds : plan.transitionSec;
  return {
    ok: true,
    plan,
    transitionSeconds,
    runSeconds,
    skippedSeconds: Math.max(0, programSeconds - runSeconds),
    totalSeconds: transitionSeconds + runSeconds,
    programSeconds,
  };
};

export const evaluateStartEntry = (
  input: StartEntryInput,
  choice: StartEntryChoice,
): StartEntryOutcome => {
  // 参考帧只属于就近：从头开始和指定位置都不带它
  const { referenceFrameMs: _reference, ...rest } = input;
  return startEntryOutcome(evaluateStartGate({ ...rest, ...startGateOptionsFor(choice, input) }));
};

/** 时间轴与指定位置用的帧范围；算不出来（数据有误）时为 null */
export const startEntryFrames = (input: StartEntryInput): (EntryFrames & { totalMs: number }) | null => {
  try {
    const resolved = resolveActionSequence(input.sequence);
    return { ...entryFramesOf({ ...input, resolved }), totalMs: Math.max(0, resolved.totalMs) };
  } catch {
    return null;
  }
};

/** 指定位置的步进 */
export const ENTRY_FRAME_STEP_MS = 100;

/** 指定位置 − / +：按 0.1 秒步进，落在 [首帧, 末帧] */
export const stepEntryFrame = (frames: EntryFrames, frameMs: number, delta: -1 | 1): number => {
  const stepped = Math.round(frameMs / ENTRY_FRAME_STEP_MS + delta) * ENTRY_FRAME_STEP_MS;
  return Math.min(Math.max(stepped, frames.firstMs), frames.lastMs);
};

/** 在时间轴上点的位置：靠近关键帧（总长 2% 以内）时吸过去，否则按 0.1 秒取整 */
export const pickEntryFrame = (frames: EntryFrames, frameMs: number): number => {
  const span = Math.max(1, frames.lastMs - frames.firstMs);
  const clamped = Math.min(Math.max(frameMs, frames.firstMs), frames.lastMs);
  let nearest: number | null = null;
  for (const frame of frames.keyframesMs) {
    if (nearest === null || Math.abs(frame - clamped) < Math.abs(nearest - clamped)) nearest = frame;
  }
  if (nearest !== null && Math.abs(nearest - clamped) <= span * 0.02) return nearest;
  const rounded = Math.round(clamped / ENTRY_FRAME_STEP_MS) * ENTRY_FRAME_STEP_MS;
  return Math.min(Math.max(rounded, frames.firstMs), frames.lastMs);
};
