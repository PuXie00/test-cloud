import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { SceneObjectConfig, Vec3, VirtualAxisValues } from "../types";
import { resolveVirtualAxisTransform } from "../telemetry/virtual-axis-mapper";

/** 物体运动中心（运动枢轴原点）的世界轨迹 */
export const previewPathPoints = (config: SceneObjectConfig, poses: VirtualAxisValues[]): Vec3[] => {
  const rootRotation = Matrix.RotationYawPitchRoll(config.rotation.y, config.rotation.x, config.rotation.z);
  return poses.map((pose) => {
    const transform = resolveVirtualAxisTransform(config, pose);
    const pivot = transform.pivotPosition ?? { x: 0, y: 0, z: 0 };
    const offset = Vector3.TransformCoordinates(new Vector3(pivot.x, pivot.y, pivot.z), rootRotation);
    return {
      x: transform.position.x + offset.x,
      y: transform.position.y + offset.y,
      z: transform.position.z + offset.z,
    };
  });
};
