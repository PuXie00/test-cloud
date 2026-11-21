import type {
  PoseJunctionKind,
  ResolvedPosePoint,
} from "@/app/project/action-sequence/resolve-sequence";
import type { PoseBlock } from "@/app/project/action-sequence/types";
import type { VirtualAxisId } from "@/app/project/project-document-types";

/** 运动区间的哪一头 */
export type SegmentEnd = "start" | "end";

/**
 * 区间一头停不停：
 * - choice：能选，axes 是能选的轴，stop 为 mixed 时各轴不一样
 * - fixed：由序列决定（开头结尾、折返、前后不动），只给原因
 */
export type EndJunctionView =
  | { kind: "choice"; axes: VirtualAxisId[]; stop: boolean | "mixed" }
  | { kind: "fixed"; text: string }
  | { kind: "none" };

type FixedKind = Exclude<PoseJunctionKind, "auto" | "manual">;

const FIXED_TEXT: Record<SegmentEnd, Record<FixedKind, string>> = {
  start: {
    edge: "开头，从静止起步",
    reverse: "方向相反，停稳再走",
    hold: "上一段不动，从静止起步",
  },
  end: {
    edge: "结尾，停在这里",
    reverse: "方向相反，在这里停",
    hold: "下一段不动，停在这里",
  },
};

export const PRESET_POINT_TEXT = "预设的关键点，在预设里改";

const isChoice = (kind: PoseJunctionKind): boolean => kind === "auto" || kind === "manual";

/** 区间一头（那个位姿上）这段在动的轴停不停 */
export const endJunctionView = (
  point: ResolvedPosePoint | undefined,
  movingAxes: readonly VirtualAxisId[],
  end: SegmentEnd,
): EndJunctionView => {
  if (!point) return { kind: "none" };
  const junctions = point.junctions ?? {};
  const present = movingAxes.filter((axis) => junctions[axis] !== undefined);
  if (present.length === 0) return { kind: "none" };
  if (point.sourceKind !== "pose") return { kind: "fixed", text: PRESET_POINT_TEXT };
  const choice = present.filter((axis) => isChoice(junctions[axis]!.kind));
  if (choice.length === 0) {
    return { kind: "fixed", text: FIXED_TEXT[end][junctions[present[0]!]!.kind as FixedKind] };
  }
  const stops = choice.filter((axis) => junctions[axis]!.speed === 0).length;
  return {
    kind: "choice",
    axes: choice,
    stop: stops === choice.length ? true : stops === 0 ? false : "mixed",
  };
};

const withPassSpeeds = (
  block: PoseBlock,
  speeds: Partial<Record<VirtualAxisId, number>>,
): PoseBlock => {
  const { passSpeeds: _previous, ...rest } = block;
  return Object.keys(speeds).length > 0 ? { ...rest, passSpeeds: speeds } : rest;
};

/** 选「停」：这几个轴的经过速度填 0；选「接」：去掉填的 0 回到自动，手填的非 0 速度保留 */
export const withEndStop = (
  block: PoseBlock,
  axes: readonly VirtualAxisId[],
  stop: boolean,
): PoseBlock => {
  const speeds = { ...(block.passSpeeds ?? {}) };
  for (const axis of axes) {
    if (stop) speeds[axis] = 0;
    else if (speeds[axis] === 0) delete speeds[axis];
  }
  return withPassSpeeds(block, speeds);
};

/** 手填一个轴的经过速度；null 回到自动 */
export const withAxisPassSpeed = (
  block: PoseBlock,
  axis: VirtualAxisId,
  speed: number | null,
): PoseBlock => {
  const speeds = { ...(block.passSpeeds ?? {}) };
  if (speed === null) delete speeds[axis];
  else speeds[axis] = speed;
  return withPassSpeeds(block, speeds);
};
