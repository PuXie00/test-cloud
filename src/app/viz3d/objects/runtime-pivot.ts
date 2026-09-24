import { Quaternion } from "@babylonjs/core/Maths/math.vector";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { RuntimeTransform } from "../types";

export const applyRuntimePivot = (pivot: TransformNode, transform: RuntimeTransform): void => {
  const offset = transform.pivotPosition;
  pivot.position.set(offset?.x ?? 0, offset?.y ?? 0, offset?.z ?? 0);
  const quaternion = transform.rotationQuaternion;
  if (!quaternion) {
    pivot.rotationQuaternion = null;
    pivot.rotation.set(transform.rotation.x, transform.rotation.y, transform.rotation.z);
    return;
  }
  if (pivot.rotationQuaternion) {
    pivot.rotationQuaternion.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
  } else {
    pivot.rotationQuaternion = new Quaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
  }
};

export const resetRuntimePivot = (pivot: TransformNode): void => {
  pivot.position.set(0, 0, 0);
  pivot.rotationQuaternion = null;
  pivot.rotation.set(0, 0, 0);
};
