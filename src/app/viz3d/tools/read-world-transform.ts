import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Vec3 } from "../types";

export type WorldTransform = {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
};

/** World pose of a node, including when it is parented to a gizmo pivot. */
export const readWorldTransform = (node: TransformNode): WorldTransform => {
  node.computeWorldMatrix(true);
  const position = node.getAbsolutePosition();
  const scaling = node.absoluteScaling;
  const euler = node.absoluteRotationQuaternion.toEulerAngles();
  return {
    position: { x: position.x, y: position.y, z: position.z },
    rotation: { x: euler.x, y: euler.y, z: euler.z },
    scale: { x: scaling.x, y: scaling.y, z: scaling.z },
  };
};

/** Write a world pose onto an unparented node as local TRS. */
export const applyWorldTransform = (node: TransformNode, transform: WorldTransform): void => {
  node.rotationQuaternion = null;
  node.position.set(transform.position.x, transform.position.y, transform.position.z);
  node.rotation.set(transform.rotation.x, transform.rotation.y, transform.rotation.z);
  node.scaling.set(transform.scale.x, transform.scale.y, transform.scale.z);
  node.computeWorldMatrix(true);
};
