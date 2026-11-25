import type { VirtualAxisId } from "../project-document-types";
import { uncontrolledAxesOf, type ResolvedActionSequence } from "./resolve-sequence";
import type { KeyframePose } from "./types";

const AXES: readonly VirtualAxisId[] = ["v1", "v2", "v3"];

/**
 * 拿序列当造型：每个物体每个轴的值。
 * - start：序列开始时的样子，每个轴取第一次设定的值（各物体的第一个位姿不一定在 0 s，各取各的）；
 * - end：序列结束时的样子，每个轴取最后一次设定的值。
 * 和播放时一致：第一个设定值之前保持首值，最后一个之后保持末值。序列不控制的轴不给。
 */
export const sequenceShape = (
  resolved: ResolvedActionSequence,
  which: "start" | "end",
): Map<number, KeyframePose> => {
  const shape = new Map<number, KeyframePose>();
  for (const [objectId, points] of resolved.posesByObject) {
    const point = which === "start" ? points[0] : points[points.length - 1];
    if (!point) continue;
    const uncontrolled = uncontrolledAxesOf(resolved, objectId);
    const pose: KeyframePose = {};
    for (const axis of AXES) {
      if (!uncontrolled.includes(axis)) pose[axis] = point.pose[axis];
    }
    if (Object.keys(pose).length > 0) shape.set(objectId, pose);
  }
  return shape;
};
