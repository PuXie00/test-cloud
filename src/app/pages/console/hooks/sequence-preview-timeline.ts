import { evaluateResolvedSequence } from "@/app/project/action-sequence/evaluate-sequence";
import { remainingProgramMs } from "@/app/project/action-sequence/initial-pose-gate";
import {
  nearestStartPosesAt,
  type NearestStartPlan,
} from "@/app/project/action-sequence/nearest-start";
import type { ResolvedActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import type { ModelPose } from "@/app/project/action-sequence/types";

/**
 * 预览时间轴 = [过渡段 transitionMs][编程段]。
 * 编程段正向从 programStartMs 走到末尾，反向从 programStartMs 倒回 0。
 */
export type PreviewTimeline = {
  plan: NearestStartPlan | null;
  transitionMs: number;
  direction: 1 | -1;
  programStartMs: number;
  programTotalMs: number;
  totalMs: number;
};

export type PreviewPhase =
  | { phase: "transition"; elapsedMs: number }
  | { phase: "program"; programMs: number };

export const TRANSITION_PATH_STEP_MS = 100;

export const buildPreviewTimeline = (
  programTotalMs: number,
  plan: NearestStartPlan | null,
  reverse: boolean,
): PreviewTimeline => {
  if (plan && plan.transitionSec > 0) {
    const transitionMs = plan.transitionSec * 1000;
    return {
      plan,
      transitionMs,
      direction: plan.direction,
      programStartMs: plan.targetFrameMs,
      programTotalMs,
      totalMs: transitionMs + remainingProgramMs(plan, programTotalMs),
    };
  }
  const direction: 1 | -1 = reverse ? -1 : 1;
  const programStartMs = plan ? plan.targetFrameMs : direction > 0 ? 0 : programTotalMs;
  const programSpan = direction > 0 ? programTotalMs - programStartMs : programStartMs;
  return {
    plan: null,
    transitionMs: 0,
    direction,
    programStartMs,
    programTotalMs,
    totalMs: Math.max(0, programSpan),
  };
};

/** 循环预览第二轮起不再过渡，按完整编程段循环。 */
export const fullProgramTimeline = (timeline: PreviewTimeline): PreviewTimeline =>
  buildPreviewTimeline(timeline.programTotalMs, null, timeline.direction < 0);

export const previewPhaseAt = (timeline: PreviewTimeline, cursorMs: number): PreviewPhase => {
  if (timeline.transitionMs > 0 && cursorMs < timeline.transitionMs) {
    return { phase: "transition", elapsedMs: Math.max(0, cursorMs) };
  }
  const elapsed = Math.max(0, cursorMs - timeline.transitionMs);
  const programMs =
    timeline.direction > 0
      ? Math.min(timeline.programTotalMs, timeline.programStartMs + elapsed)
      : Math.max(0, timeline.programStartMs - elapsed);
  return { phase: "program", programMs };
};

export const previewPosesAtCursor = (
  resolved: ResolvedActionSequence,
  timeline: PreviewTimeline,
  cursorMs: number,
): Map<number, ModelPose> => {
  const phase = previewPhaseAt(timeline, cursorMs);
  if (phase.phase === "program") return evaluateResolvedSequence(resolved, phase.programMs);
  const poses = evaluateResolvedSequence(resolved, timeline.programStartMs);
  for (const [objectId, pose] of nearestStartPosesAt(timeline.plan!, phase.elapsedMs)) {
    poses.set(objectId, pose);
  }
  return poses;
};

export const transitionPathSamples = (
  plan: NearestStartPlan,
  stepMs = TRANSITION_PATH_STEP_MS,
): Map<number, ModelPose[]> => {
  const durationMs = plan.transitionSec * 1000;
  const times: number[] = [];
  for (let t = 0; t < durationMs; t += stepMs) times.push(t);
  times.push(durationMs);
  const paths = new Map<number, ModelPose[]>();
  for (const member of plan.members) {
    if (member.axes.length === 0) continue;
    paths.set(member.objectId, []);
  }
  for (const t of times) {
    for (const [objectId, pose] of nearestStartPosesAt(plan, t)) {
      paths.get(objectId)?.push(pose);
    }
  }
  return paths;
};

export const advancePreviewTimeline = (args: {
  timeline: PreviewTimeline;
  cursorMs: number;
  dtMs: number;
  faderPercent: number;
  multiplier: number;
  loop: boolean;
}): { timeline: PreviewTimeline; cursorMs: number; ended: boolean } => {
  const { timeline } = args;
  if (timeline.totalMs <= 0) return { timeline, cursorMs: 0, ended: true };
  const next = args.cursorMs + args.dtMs * (args.faderPercent / 100) * args.multiplier;
  if (next < timeline.totalMs) return { timeline, cursorMs: next, ended: false };
  if (!args.loop) return { timeline, cursorMs: timeline.totalMs, ended: true };
  const full = fullProgramTimeline(timeline);
  if (full.totalMs <= 0) return { timeline: full, cursorMs: 0, ended: true };
  return { timeline: full, cursorMs: (next - timeline.totalMs) % full.totalMs, ended: false };
};
