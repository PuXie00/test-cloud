import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { Vec3 } from "../types";

export const computeSelectionCentroid = (positions: Vec3[]): Vec3 => {
  if (positions.length === 0) {
    return { x: 0, y: 0, z: 0 };
  }

  let x = 0;
  let y = 0;
  let z = 0;
  for (const position of positions) {
    x += position.x;
    y += position.y;
    z += position.z;
  }

  const count = positions.length;
  return { x: x / count, y: y / count, z: z / count };
};

export class MultiTransformPivot {
  readonly pivot: TransformNode;
  private members: TransformNode[] = [];
  private scene: Scene | null = null;

  constructor(scene: Scene) {
    this.pivot = new TransformNode("viz3d-multi-transform-pivot", scene);
    this.scene = scene;
  }

  mount(scene: Scene): void {
    this.scene = scene;
  }

  attach(objects: TransformNode[], centroid: Vec3): void {
    this.release();
    this.pivot.position.set(centroid.x, centroid.y, centroid.z);
    this.pivot.rotation.set(0, 0, 0);
    this.pivot.scaling.set(1, 1, 1);
    this.pivot.rotationQuaternion = null;
    this.pivot.computeWorldMatrix(true);

    for (const object of objects) {
      object.setParent(this.pivot, true);
      this.members.push(object);
    }
  }

  release(): void {
    if (!this.scene) {
      this.members = [];
      return;
    }

    for (const object of [...this.members]) {
      object.setParent(null, true);
    }
    this.members = [];
  }

  dispose(): void {
    this.release();
    this.pivot.dispose();
    this.scene = null;
  }
}
