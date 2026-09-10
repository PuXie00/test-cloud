import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";

/** 非成员物体的透明度；0.4 为下限，低于此值太像被隐藏 */
export const DIMMED_VISIBILITY = 0.7;

/** 对 root 下全部后代 mesh 写 visibility（不改材质 alpha，避免共用材质串色） */
export const applyVisibility = (root: TransformNode, visibility: number): void => {
  for (const mesh of root.getChildMeshes(false)) {
    mesh.visibility = visibility;
  }
};
