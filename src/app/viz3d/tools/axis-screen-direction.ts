import type { Matrix } from "@babylonjs/core/Maths/math.vector";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";

/** +X、+Z 在屏幕上的朝向：从屏幕右方逆时针量的角度，按 45° 取整，0–315 */
export type AxisScreenDirections = { x: number; z: number };

/** 投影到屏幕上的长度小于这个值，就当作轴正对或背对镜头 */
const FACING_CAMERA_THRESHOLD = 0.35;

/** 正对镜头时屏幕上看不出方向，按画纵深的斜线：朝镜头（近）在左下，背离（远）在右上 */
const TOWARD_CAMERA_DEG = 225;
const AWAY_FROM_CAMERA_DEG = 45;

const quantize = (deg: number): number => ((Math.round(deg / 45) * 45) % 360 + 360) % 360;

export const axisScreenAngle = (view: Matrix, axis: Vector3): number => {
  // 视图空间（左手系）：x 屏幕右，y 屏幕上，z 镜头前方
  const v = Vector3.TransformNormal(axis, view);
  if (Math.hypot(v.x, v.y) < FACING_CAMERA_THRESHOLD) {
    return v.z < 0 ? TOWARD_CAMERA_DEG : AWAY_FROM_CAMERA_DEG;
  }
  return quantize((Math.atan2(v.y, v.x) * 180) / Math.PI);
};

export const computeAxisScreenDirections = (view: Matrix): AxisScreenDirections => ({
  x: axisScreenAngle(view, new Vector3(1, 0, 0)),
  z: axisScreenAngle(view, new Vector3(0, 0, 1)),
});

/** 工程默认透视视角下的朝向，引擎出第一帧之前先用它 */
export const DEFAULT_AXIS_SCREEN_DIRECTIONS: AxisScreenDirections = { x: 315, z: 45 };
