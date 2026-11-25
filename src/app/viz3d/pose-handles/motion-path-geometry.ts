import type { Matrix } from "@babylonjs/core/Maths/math.vector";
import type { SceneObjectConfig, Vec3 } from "../types";
import {
  frontDirectionOf,
  localTopCenter,
  poseWorldMatrix,
  toFullAxisValues,
  transformPoint,
  type PoseKinematics,
} from "./pose-handle-kinematics";
import { crossVec, dotVec } from "./pose-handle-math";
import { poseHandleModel, type RingHandleModel } from "./pose-handle-model";
import type { MotionPathEntry, MotionPathIssueSpan, MotionPathSample } from "./motion-path-types";

/** 旋转类不画轨迹线，在旋转环上画各位姿的刻点 */
const RING_CONTROL_TYPES = new Set(["singlePointRotation", "continuousRotation"]);

/** 游标正在有问题的那段里：物体套红框 */
export type MotionPathOutlineKind = "issue";

/** 一台物体整条动作在世界里的样子 */
export type MotionPathWorld = {
  objectId: string;
  selected: boolean;
  style: "path" | "ring";
  /** 顶面中心随时间的位置（style 为 path 时） */
  points: Array<{ atMs: number; point: Vec3 }>;
  /** 关键点：path 时在轨迹上，ring 时是环上的角度（相对游标处朝前方向，弧度） */
  keyframes: Array<{
    atMs: number;
    point: Vec3;
    angle: number | null;
    blockId: string | null;
    selected: boolean;
    invalid: boolean;
  }>;
  cursorPoint: Vec3 | null;
  /** style 为 ring 时游标处的旋转环 */
  ring: RingHandleModel | null;
  issues: MotionPathIssueSpan[];
  outlines: Array<{ kind: MotionPathOutlineKind; corners: Vec3[] }>;
};

/** 父物体运动枢轴的世界矩阵：给了时刻按父物体那一刻的姿态，null 取父物体现在的样子 */
export type ParentFrameAt = (atMs: number | null) => Matrix | null;

/** 尺寸盒 8 个角：下标按位 x(1)、y(2)、z(4) 取正负 */
export const boxCornersOf = (input: PoseKinematics): Vec3[] => {
  const frame = poseWorldMatrix(input);
  const { w, h, d } = input.config.dimensions;
  return Array.from({ length: 8 }, (_, index) =>
    transformPoint(frame, {
      x: ((index & 1 ? 1 : -1) * w) / 2,
      y: ((index & 2 ? 1 : -1) * h) / 2,
      z: ((index & 4 ? 1 : -1) * d) / 2,
    }),
  );
};

/** 尺寸盒的 12 条棱（角的下标对） */
export const BOX_EDGES: ReadonlyArray<readonly [number, number]> = (() => {
  const edges: Array<[number, number]> = [];
  for (let index = 0; index < 8; index += 1) {
    for (const bit of [1, 2, 4]) {
      const other = index ^ bit;
      if (index < other) edges.push([index, other]);
    }
  }
  return edges;
})();

/** 世界包围盒（米） */
export type MotionRangeBounds = { min: Vec3; max: Vec3 };

/** 一台物体按这些取样的姿态扫过的范围：每个取样时尺寸盒 8 个角的包围盒 */
export const motionRangeOf = (
  samples: readonly MotionPathSample[],
  config: SceneObjectConfig,
  parentFrameAt: ParentFrameAt,
): MotionRangeBounds | null => {
  if (!config.kinematics || samples.length === 0) return null;
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const sample of samples) {
    const corners = boxCornersOf({
      config,
      values: toFullAxisValues(sample.values),
      parentWorld: parentFrameAt(sample.atMs),
    });
    for (const corner of corners) {
      min.x = Math.min(min.x, corner.x);
      min.y = Math.min(min.y, corner.y);
      min.z = Math.min(min.z, corner.z);
      max.x = Math.max(max.x, corner.x);
      max.y = Math.max(max.y, corner.y);
      max.z = Math.max(max.z, corner.z);
    }
  }
  return Number.isFinite(min.x) ? { min, max } : null;
};

export const motionPathWorld = (
  entry: MotionPathEntry,
  config: SceneObjectConfig,
  parentFrameAt: ParentFrameAt,
): MotionPathWorld | null => {
  const controlType = config.kinematics?.controlType;
  if (!controlType) return null;
  const inputAt = (sample: MotionPathSample): PoseKinematics => ({
    config,
    values: toFullAxisValues(sample.values),
    parentWorld: parentFrameAt(sample.atMs),
  });
  const style = RING_CONTROL_TYPES.has(controlType) ? "ring" : "path";
  const anchor = localTopCenter(config);
  const anchorOf = (input: PoseKinematics) => transformPoint(poseWorldMatrix(input), anchor);

  const cursorInput = entry.cursor ? inputAt(entry.cursor) : null;
  // 只为标红而来的物体（没画轨迹）：只画红框，不画环和亮点
  const outlineOnly = entry.samples.length === 0 && entry.keyframes.length === 0;
  const ringModel = style === "ring" && cursorInput && !outlineOnly ? poseHandleModel("yaw", cursorInput) : null;
  const ring = ringModel && ringModel.kind === "yaw" ? ringModel : null;
  const angleOf = (input: PoseKinematics): number | null => {
    if (!ring) return null;
    const front = frontDirectionOf(input);
    return Math.atan2(dotVec(front, crossVec(ring.rotationAxis, ring.ref)), dotVec(front, ring.ref));
  };

  const outlines: MotionPathWorld["outlines"] = [];
  if (entry.issueAtCursor && cursorInput) outlines.push({ kind: "issue", corners: boxCornersOf(cursorInput) });

  return {
    objectId: entry.objectId,
    selected: entry.selected,
    style,
    points: style === "path" ? entry.samples.map((sample) => ({ atMs: sample.atMs, point: anchorOf(inputAt(sample)) })) : [],
    keyframes: entry.keyframes.map((keyframe) => {
      const input = inputAt(keyframe);
      return {
        atMs: keyframe.atMs,
        point: anchorOf(input),
        angle: angleOf(input),
        blockId: keyframe.blockId,
        selected: keyframe.selected,
        invalid: keyframe.invalid,
      };
    }),
    cursorPoint: style === "path" && cursorInput && !outlineOnly ? anchorOf(cursorInput) : null,
    ring,
    issues: entry.issues,
    outlines,
  };
};
