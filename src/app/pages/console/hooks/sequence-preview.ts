import { evaluateResolvedSequence } from "@/app/project/action-sequence/evaluate-sequence";
import type { ResolvedActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import type { ModelPose } from "@/app/project/action-sequence/types";

export const PREVIEW_SAMPLE_STEP_MS = 100;

export type PreviewSample = { atMs: number; pose: ModelPose };

const sampleTimes = (resolved: ResolvedActionSequence, stepMs: number): number[] => {
  const times = new Set<number>([0, resolved.totalMs]);
  for (let t = 0; t < resolved.totalMs; t += stepMs) times.add(t);
  for (const segment of resolved.segments) {
    times.add(segment.startMs);
    times.add(segment.endMs);
  }
  return [...times].sort((a, b) => a - b);
};

export const memberObjectIds = (resolved: ResolvedActionSequence): number[] =>
  [...resolved.posesByObject.keys()];

export const sampleSequencePaths = (
  resolved: ResolvedActionSequence,
  stepMs = PREVIEW_SAMPLE_STEP_MS,
): Map<number, PreviewSample[]> => {
  const result = new Map<number, PreviewSample[]>();
  for (const id of memberObjectIds(resolved)) result.set(id, []);
  for (const atMs of sampleTimes(resolved, stepMs)) {
    const poses = evaluateResolvedSequence(resolved, atMs);
    for (const [objectId, pose] of poses) result.get(objectId)?.push({ atMs, pose });
  }
  return result;
};

export const previewPosesAt = (
  resolved: ResolvedActionSequence,
  cursorMs: number,
): Map<number, ModelPose> => evaluateResolvedSequence(resolved, cursorMs);

export const advancePreviewCursor = (args: {
  cursorMs: number;
  dtMs: number;
  faderPercent: number;
  multiplier: number;
  totalMs: number;
  loop: boolean;
}): { cursorMs: number; ended: boolean } => {
  const next = args.cursorMs + args.dtMs * (args.faderPercent / 100) * args.multiplier;
  if (args.totalMs <= 0) return { cursorMs: 0, ended: true };
  if (next < args.totalMs) return { cursorMs: next, ended: false };
  if (args.loop) return { cursorMs: next % args.totalMs, ended: false };
  return { cursorMs: args.totalMs, ended: true };
};
