import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
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

/** Write a pose onto a node as local TRS (world pose when the node is unparented). */
export const applyWorldTransform = (node: TransformNode, transform: WorldTransform): void => {
  node.rotationQuaternion = null;
  node.position.set(transform.position.x, transform.position.y, transform.position.z);
  node.rotation.set(transform.rotation.x, transform.rotation.y, transform.rotation.z);
  node.scaling.set(transform.scale.x, transform.scale.y, transform.scale.z);
  node.computeWorldMatrix(true);
};

/** 自上而下强制刷新 node 及其祖先的世界矩阵（Gizmo 换父节点后缓存可能过期） */
export const refreshWorldMatrixChain = (node: TransformNode): void => {
  const chain: TransformNode[] = [];
  for (let current: TransformNode | null = node; current; current = current.parent as TransformNode | null) {
    chain.unshift(current);
  }
  for (const entry of chain) entry.computeWorldMatrix(true);
};

/**
 * 把世界姿态写成相对 node.parent 的局部 TRS（挂载子物体），返回该局部姿态；
 * 无父节点时等同 applyWorldTransform。
 */
export const applyWorldTransformUnderParent = (
  node: TransformNode,
  world: WorldTransform,
): WorldTransform => {
  const parent = node.parent as TransformNode | null;
  if (!parent) {
    applyWorldTransform(node, world);
    return world;
  }
  refreshWorldMatrixChain(parent);
  const worldMatrix = Matrix.Compose(
    new Vector3(world.scale.x, world.scale.y, world.scale.z),
    Quaternion.FromEulerAngles(world.rotation.x, world.rotation.y, world.rotation.z),
    new Vector3(world.position.x, world.position.y, world.position.z),
  );
  const scale = new Vector3();
  const rotation = new Quaternion();
  const position = new Vector3();
  worldMatrix.multiply(parent.getWorldMatrix().clone().invert()).decompose(scale, rotation, position);
  const euler = rotation.toEulerAngles();
  const local: WorldTransform = {
    position: { x: position.x, y: position.y, z: position.z },
    rotation: { x: euler.x, y: euler.y, z: euler.z },
    scale: { x: scale.x, y: scale.y, z: scale.z },
  };
  applyWorldTransform(node, local);
  return local;
};
