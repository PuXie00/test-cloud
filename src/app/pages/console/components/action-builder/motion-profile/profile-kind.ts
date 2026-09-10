import {
  applyTrapezoidHandleDrag,
  createDefaultAxisProfile,
  trapezoidHandles,
} from "@/app/project/action-sequence/motion-profile";
import type { MotionProfile } from "@/app/project/action-sequence/types";

export type ProfileHandleId = string;

export type ProfileHandle = {
  id: ProfileHandleId;
  tNorm: number;
  label: string;
};

export type ProfileKindMeta = {
  kind: MotionProfile["kind"];
  label: string;
  createProfile: (durationMs: number, minAccelMs?: number) => MotionProfile;
  handles: (profile: MotionProfile, durationMs: number) => ProfileHandle[];
  applyHandleDrag: (
    profile: MotionProfile,
    handleId: ProfileHandleId,
    nextTNorm: number,
    durationMs: number,
    minAccelMs?: number,
  ) => MotionProfile;
};

const TRAPEZOID_HANDLE_LABELS: Record<"accel-end" | "decel-start", string> = {
  "accel-end": "加速结束",
  "decel-start": "减速开始",
};

const trapezoidMeta: ProfileKindMeta = {
  kind: "trapezoid",
  label: "梯形",
  createProfile: (durationMs, minAccelMs) =>
    createDefaultAxisProfile(
      durationMs,
      minAccelMs === undefined ? undefined : minAccelMs / 1000,
    ),
  handles: (profile, durationMs) =>
    trapezoidHandles(profile, durationMs).map((handle) => ({
      id: handle.id,
      tNorm: handle.tNorm,
      label: TRAPEZOID_HANDLE_LABELS[handle.id],
    })),
  applyHandleDrag: (profile, handleId, nextTNorm, durationMs, minAccelMs) =>
    applyTrapezoidHandleDrag(
      profile,
      handleId as "accel-end" | "decel-start",
      nextTNorm,
      durationMs,
      minAccelMs,
    ),
};

export const PROFILE_KIND_OPTIONS: ReadonlyArray<{
  kind: MotionProfile["kind"];
  label: string;
}> = [{ kind: "trapezoid", label: "梯形" }];

const PROFILE_KIND_REGISTRY: Readonly<
  Record<MotionProfile["kind"], ProfileKindMeta>
> = {
  trapezoid: trapezoidMeta,
};

export const profileKindMeta = (
  kind: MotionProfile["kind"],
): ProfileKindMeta | undefined => PROFILE_KIND_REGISTRY[kind];
