import type { DragMember } from "./pose-handle-drag";
import {
  localTopCenter,
  pointRateOf,
  poseWorldBox,
  type PoseKinematics,
  type PoseWorldBox,
} from "./pose-handle-kinematics";
import { lengthVec } from "./pose-handle-math";
import type { PoseHandleUpdate } from "./pose-handle-types";

/**
 * 动作页队形工具（多选时）：只改升降（虚轴 1），按世界高度算，
 * 每台按自己的正解反推虚轴值（正反向、挂载都不用手写）。
 */

/** 量哪一条：尺寸盒的底边、中心、顶边 */
export type FormationEdge = "bottom" | "center" | "top";

export type FormationTarget =
  /** 这几台的这条边都对到 height（世界高度，米） */
  | { kind: "align"; edge: FormationEdge; height: number }
  /** 以平均高度为中心（按尺寸盒中心量），高低差乘 factor：0 拉平，负数上下翻转 */
  | { kind: "scale"; factor: number };

export type FormationSolution = {
  updates: PoseHandleUpdate[];
  /** 行程不够、停在行程头上的 */
  clamped: string[];
  /** 升降基本不改变高度（如挂在侧放的物体上），没动的 */
  skipped: string[];
};

export type FormationSpread = { min: number; max: number; mean: number };

/** 升降方向和竖直差得太多（竖直分量不到这个比例）就不拿它调高度 */
const MIN_VERTICAL_SHARE = 0.2;
/** 解到这么近就停（米） */
const HEIGHT_TOLERANCE_M = 1e-5;
const MAX_ITERATIONS = 4;

export const edgeHeightOf = (box: PoseWorldBox, edge: FormationEdge): number =>
  edge === "bottom" ? box.bottom : edge === "top" ? box.top : box.center.y;

export const formationHeightOf = (input: PoseKinematics, edge: FormationEdge): number =>
  edgeHeightOf(poseWorldBox(input), edge);

/** 各台中心高度的最低、最高、平均；不到两台为 null */
export const formationSpread = (members: readonly DragMember[]): FormationSpread | null => {
  if (members.length < 2) return null;
  const heights = members.map((member) => formationHeightOf(member.input, "center"));
  return {
    min: Math.min(...heights),
    max: Math.max(...heights),
    mean: heights.reduce((sum, height) => sum + height, 0) / heights.length,
  };
};

const withLift = (input: PoseKinematics, v1: number): PoseKinematics => ({
  ...input,
  values: { ...input.values, v1 },
});

/**
 * 让这条边到 height 时的虚轴 1：按「这条边的高度对虚轴 1 的变化率」换算，再修正几次
 * （多点摆升降时吊点平面会稍微横移，不完全线性）；超出行程时停在行程头上。
 * 升降不改变高度时返回 null。
 */
export const solveLiftForHeight = (
  member: DragMember,
  edge: FormationEdge,
  height: number,
): { value: number; clamped: boolean } | null => {
  const anchor = localTopCenter(member.input.config);
  let value = member.input.values.v1;
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    const input = withLift(member.input, value);
    const error = height - formationHeightOf(input, edge);
    if (Math.abs(error) < HEIGHT_TOLERANCE_M) break;
    const rate = pointRateOf(input, "v1", anchor);
    const speed = lengthVec(rate);
    if (speed < 1e-12 || Math.abs(rate.y) < MIN_VERTICAL_SHARE * speed) {
      if (iteration === 0) return null;
      break;
    }
    value += error / rate.y;
  }
  const range = member.ranges?.v1;
  if (range && (value < range.min || value > range.max)) {
    return { value: Math.min(range.max, Math.max(range.min, value)), clamped: true };
  }
  return { value, clamped: false };
};

/** 每台要到的高度（按哪条边量） */
const goalsOf = (
  members: readonly DragMember[],
  target: FormationTarget,
): Array<{ member: DragMember; edge: FormationEdge; height: number }> => {
  if (target.kind === "align") {
    return members.map((member) => ({ member, edge: target.edge, height: target.height }));
  }
  const spread = formationSpread(members);
  if (!spread) return [];
  return members.map((member) => {
    const center = formationHeightOf(member.input, "center");
    return { member, edge: "center" as const, height: spread.mean + target.factor * (center - spread.mean) };
  });
};

export const solveFormation = (members: readonly DragMember[], target: FormationTarget): FormationSolution => {
  const solution: FormationSolution = { updates: [], clamped: [], skipped: [] };
  for (const { member, edge, height } of goalsOf(members, target)) {
    const solved = solveLiftForHeight(member, edge, height);
    if (!solved) {
      solution.skipped.push(member.objectId);
      continue;
    }
    if (solved.clamped) solution.clamped.push(member.objectId);
    solution.updates.push({ objectId: member.objectId, values: { v1: solved.value } });
  }
  return solution;
};

/** 右键菜单里的队形操作（引擎里的物体 id） */
export type PoseFormationRequest =
  /** 高度对齐到这台：选中的其他物体这条边对到参照的同一条边 */
  | { kind: "align"; referenceId: string; edge: FormationEdge }
  /** 以平均高度为中心按比例放大 / 缩小高低差 */
  | { kind: "scale"; factor: number };

export type PoseFormationBlocked = { objectId: string; reason: string };

/** 队形工具能不能用 */
export type PoseFormationInfo = {
  /** 能升降、拖得了的选中物体 */
  memberIds: string[];
  /** 选中了、能升降但这一刻拖不了的（游标在预设里等）和原因 */
  blocked: PoseFormationBlocked[];
  /** 各台中心高度（米）；不到两台为 null */
  spread: FormationSpread | null;
  /** 右键的这台能当对齐参照：它之外还有能升降的物体 */
  canAlign: boolean;
};

/** 引擎算好的队形：交给动作编辑器像拖手柄一样写进游标处的位姿（没有就加），一步撤销 */
export type PoseFormationEvent = FormationSolution & {
  request: PoseFormationRequest;
  blocked: PoseFormationBlocked[];
};
