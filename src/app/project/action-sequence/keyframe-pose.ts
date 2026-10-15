import type { VirtualAxisId } from "../project-document-types";
import type { KeyframePose } from "./types";

const AXES: readonly VirtualAxisId[] = ["v1", "v2", "v3"];

export const isAxisSet = (pose: KeyframePose, axis: VirtualAxisId): boolean =>
  typeof pose[axis] === "number";

/** 位姿里不设定的轴，按 v1→v3 */
export const unsetAxesOf = (pose: KeyframePose): VirtualAxisId[] =>
  AXES.filter((axis) => !isAxisSet(pose, axis));

/** 去掉一个轴的设定值，让它在这一帧经过 */
export const withoutAxis = (pose: KeyframePose, axis: VirtualAxisId): KeyframePose => {
  const next = { ...pose };
  delete next[axis];
  return next;
};
