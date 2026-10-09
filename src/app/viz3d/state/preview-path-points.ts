import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { SceneObjectConfig, Vec3, VirtualAxisValues } from "../types";
import { resolveVirtualAxisTransform } from "../telemetry/virtual-axis-mapper";

/** 某一时刻父物体运动枢轴的世界矩阵；null 表示没有父物体 */
export type ParentFrameAt = (index: number) => Matrix | null;

/**
 * 物体运动枢轴（挂载子物体的坐标系）相对其父节点的矩阵：
 * 与 SceneObject 的 root（位置 + 朝向）× runtimePivot（虚轴姿态）一致。
 */
export const attachmentFrameMatrix = (
  config: SceneObjectConfig,
  pose: VirtualAxisValues,
): Matrix => {
  const transform = resolveVirtualAxisTransform(config, pose);
  const pivot = transform.pivotPosition ?? { x: 0, y: 0, z: 0 };
  const pivotRotation = transform.rotationQuaternion
    ? new Quaternion(
        transform.rotationQuaternion.x,
        transform.rotationQuaternion.y,
        transform.rotationQuaternion.z,
        transform.rotationQuaternion.w,
      )
    : Quaternion.Identity();
  const pivotLocal = Matrix.Compose(Vector3.One(), pivotRotation, new Vector3(pivot.x, pivot.y, pivot.z));
  const rootLocal = Matrix.Compose(
    Vector3.One(),
    Quaternion.RotationYawPitchRoll(config.rotation.y, config.rotation.x, config.rotation.z),
    new Vector3(transform.position.x, transform.position.y, transform.position.z),
  );
  return pivotLocal.multiply(rootLocal);
};

/** 物体运动中心（运动枢轴原点）的世界轨迹；挂载子物体按 parentFrameAt 叠加父物体姿态 */
export const previewPathPoints = (
  config: SceneObjectConfig,
  poses: VirtualAxisValues[],
  parentFrameAt: ParentFrameAt = () => null,
): Vec3[] =>
  poses.map((pose, index) => {
    const frame = attachmentFrameMatrix(config, pose);
    const parent = parentFrameAt(index);
    const point = Vector3.TransformCoordinates(Vector3.Zero(), parent ? frame.multiply(parent) : frame);
    return { x: point.x, y: point.y, z: point.z };
  });
