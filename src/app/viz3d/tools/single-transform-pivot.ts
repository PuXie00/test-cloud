import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { Vec3 } from "../types";

export class SingleTransformPivot {
  readonly pivot: TransformNode;
  private member: TransformNode | null = null;
  private originalParent: TransformNode["parent"] = null;

  constructor(scene: Scene) {
    this.pivot = new TransformNode("viz3d-single-transform-pivot", scene);
  }

  attach(object: TransformNode, center: Vec3): void {
    this.release();
    this.pivot.position.set(center.x, center.y, center.z);
    this.pivot.rotation.set(0, 0, 0);
    this.pivot.scaling.set(1, 1, 1);
    this.pivot.rotationQuaternion = null;
    this.pivot.computeWorldMatrix(true);
    this.originalParent = object.parent;
    object.setParent(this.pivot, true);
    this.member = object;
  }

  release(): void {
    this.member?.setParent(this.originalParent, true);
    this.member = null;
    this.originalParent = null;
  }

  dispose(): void {
    this.release();
    this.pivot.dispose();
  }
}
