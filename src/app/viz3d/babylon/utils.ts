import { Color3 } from "@babylonjs/core/Maths/math.color";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { Vec3 } from "../types";

export type WorldBounds = {
  min: Vec3;
  max: Vec3;
};

export const hexToColor3 = (hex: number): Color3 => {
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  return new Color3(r, g, b);
};

export const hexStringToColor3 = (hex: string): Color3 => {
  const normalized = hex.startsWith("#") ? hex : `#${hex}`;
  return Color3.FromHexString(normalized);
};

export const setNodeMetadata = (node: TransformNode, key: string, value: unknown): void => {
  node.metadata = node.metadata ?? {};
  node.metadata[key] = value;
};

export const getNodeMetadata = (node: TransformNode, key: string): unknown =>
  node.metadata?.[key];

export const getWorldBounds = (node: TransformNode): WorldBounds => {
  node.computeWorldMatrix(true);
  const { min, max } = node.getHierarchyBoundingVectors(true);
  return {
    min: { x: min.x, y: min.y, z: min.z },
    max: { x: max.x, y: max.y, z: max.z },
  };
};

export const getWorldPosition = (node: TransformNode): Vec3 => {
  const world = node.getAbsolutePosition();
  return { x: world.x, y: world.y, z: world.z };
};

export const cloneHierarchy = (source: TransformNode, scene: Scene, name?: string): TransformNode => {
  // Third arg is doNotCloneChildren — must be false/omitted to keep mesh hierarchy.
  const clone = source.clone(name ?? `${source.name}-clone`, null, false);
  if (!clone) {
    throw new Error("Failed to clone node hierarchy");
  }
  // Templates stay disabled in the loader cache; clones must be visible on the object.
  clone.setEnabled(true);
  void scene;
  return clone;
};

export const disposeNodeHierarchy = (root: TransformNode): void => {
  const meshes = root.getChildMeshes(false);
  for (const mesh of meshes) {
    mesh.dispose(false, true);
  }
  if (root instanceof AbstractMesh) {
    root.dispose(false, true);
    return;
  }
  root.dispose(false, true);
};
