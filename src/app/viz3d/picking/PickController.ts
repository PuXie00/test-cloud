import { Ray } from "@babylonjs/core/Culling/ray";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { Node } from "@babylonjs/core/node";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { PickTarget } from "../types";
import { getNodeMetadata } from "../babylon/utils";

// RegisterRay() patches scene.pick / scene.createPickingRay onto Scene.prototype.
// Must run before any pick call, regardless of tree-shaking of raycast-ground.ts.
void Ray;

const findPickTarget = (node: Node | null): PickTarget | null => {
  let current: Node | null = node;
  while (current) {
    if (current instanceof TransformNode) {
      const axisKey = getNodeMetadata(current, "viz3dAxisKey");
      const hoistObjectId = getNodeMetadata(current, "viz3dObjectId");
      if (typeof axisKey === "string" && typeof hoistObjectId === "string") {
        const motorId = getNodeMetadata(current, "viz3dMotorId");
        return {
          kind: "hoist-axis",
          objectId: hoistObjectId,
          axisKey,
          motorId: typeof motorId === "string" ? motorId : null,
        };
      }
      const motorId = getNodeMetadata(current, "viz3dMotorId");
      if (typeof motorId === "string") {
        return { kind: "motor", id: motorId };
      }
      const objectId = getNodeMetadata(current, "viz3dObjectId");
      if (typeof objectId === "string") {
        return { kind: "object", id: objectId };
      }
    }
    current = current.parent;
  }
  return null;
};

const isDescendantOfTargets = (mesh: AbstractMesh, targets: TransformNode[]): boolean => {
  let current: Node | null = mesh;
  const targetSet = new Set(targets);
  while (current) {
    if (current instanceof TransformNode && targetSet.has(current)) {
      return true;
    }
    current = current.parent;
  }
  return false;
};

export class PickController {
  /**
   * Pick at canvas-relative CSS pixel coordinates (offsetX / offsetY).
   * scene.pick handles DPR scaling internally via engine.getHardwareScalingLevel().
   */
  pick(canvasX: number, canvasY: number, camera: Camera, targets: TransformNode[]): PickTarget | null {
    const scene = camera.getScene();
    if (!scene) {
      return null;
    }

    const pickInfo = scene.pick(
      canvasX,
      canvasY,
      (mesh) => isDescendantOfTargets(mesh, targets),
      false,
      camera,
    );

    if (!pickInfo?.hit || !pickInfo.pickedMesh) {
      return null;
    }

    return findPickTarget(pickInfo.pickedMesh);
  }
}
