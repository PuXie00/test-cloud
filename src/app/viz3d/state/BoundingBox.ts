import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { BoundingBoxKind, Disposable } from "../types";
import { hexToColor3, type WorldBounds } from "../babylon/utils";
import type { Vec3 } from "../types";

const BOX_EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 4],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

const BOUNDS_EPSILON = 1e-4;

const boundsEqual = (a: Vec3, b: Vec3): boolean =>
  Math.abs(a.x - b.x) <= BOUNDS_EPSILON &&
  Math.abs(a.y - b.y) <= BOUNDS_EPSILON &&
  Math.abs(a.z - b.z) <= BOUNDS_EPSILON;

const boundsChanged = (next: WorldBounds, cached: WorldBounds): boolean =>
  !boundsEqual(next.min, cached.min) || !boundsEqual(next.max, cached.max);

const createEdgePaths = (): Vector3[][] => {
  const corners = Array.from({ length: 8 }, () => new Vector3());
  return BOX_EDGES.map(([a, b]) => [corners[a], corners[b]]);
};

const writeLocalBoundsToEdgePaths = (min: Vector3, max: Vector3, paths: Vector3[][]): void => {
  const corners = [
    paths[0][0],
    paths[0][1],
    paths[1][1],
    paths[2][1],
    paths[4][0],
    paths[4][1],
    paths[5][1],
    paths[6][1],
  ];

  corners[0].set(min.x, min.y, min.z);
  corners[1].set(max.x, min.y, min.z);
  corners[2].set(max.x, min.y, max.z);
  corners[3].set(min.x, min.y, max.z);
  corners[4].set(min.x, max.y, min.z);
  corners[5].set(max.x, max.y, min.z);
  corners[6].set(max.x, max.y, max.z);
  corners[7].set(min.x, max.y, max.z);
};

const boundsCenter = (bounds: WorldBounds): Vector3 => {
  const { min, max } = bounds;
  return new Vector3((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
};

const boundsSize = (bounds: WorldBounds): Vector3 => {
  const { min, max } = bounds;
  return new Vector3(
    Math.max(max.x - min.x, 0.001),
    Math.max(max.y - min.y, 0.001),
    Math.max(max.z - min.z, 0.001),
  );
};

const emptyBounds = (): WorldBounds => ({
  min: { x: 0, y: 0, z: 0 },
  max: { x: 0, y: 0, z: 0 },
});

export class BoundingBox implements Disposable {
  private helper: LinesMesh;
  private kind: BoundingBoxKind;
  private readonly warningColor: number;
  private readonly parent: TransformNode;
  private readonly scene: Scene;
  private boxEdgePaths: Vector3[][] | null;
  private cachedBounds: WorldBounds | null = null;

  constructor(parent: TransformNode, kind: BoundingBoxKind, warningColor: number) {
    const scene = parent.getScene();
    if (!scene) {
      throw new Error("BoundingBox parent must belong to a scene");
    }
    this.scene = scene;
    this.parent = parent;
    this.kind = kind;
    this.warningColor = warningColor;
    this.boxEdgePaths = kind === "box" ? createEdgePaths() : null;
    this.helper = this.createHelper(emptyBounds(), kind);
    this.helper.parent = parent;
  }

  setKind(kind: BoundingBoxKind): void {
    if (kind === this.kind) {
      return;
    }
    if (kind === "box" && !this.boxEdgePaths) {
      this.boxEdgePaths = createEdgePaths();
    }
    this.kind = kind;
    this.cachedBounds = null;
    this.replaceHelper(emptyBounds(), kind);
  }

  update(bounds: WorldBounds): void {
    if (this.kind === "box" && this.boxEdgePaths) {
      if (this.cachedBounds && !boundsChanged(bounds, this.cachedBounds)) {
        return;
      }
      this.refreshBoxHelper(bounds);
      this.cachedBounds = {
        min: { ...bounds.min },
        max: { ...bounds.max },
      };
      return;
    }
    if (this.cachedBounds && !boundsChanged(bounds, this.cachedBounds)) {
      return;
    }
    this.replaceHelper(bounds, this.kind);
    this.cachedBounds = {
      min: { ...bounds.min },
      max: { ...bounds.max },
    };
  }

  setVisible(visible: boolean): void {
    this.helper.setEnabled(visible);
  }

  dispose(): void {
    this.helper.dispose();
  }

  private worldToParentLocal(world: Vector3): Vector3 {
    const parentMatrix = this.parent.getWorldMatrix();
    const inverted = parentMatrix.invert();
    return Vector3.TransformCoordinates(world, inverted);
  }

  private createHelper(bounds: WorldBounds, kind: BoundingBoxKind): LinesMesh {
    const helper =
      kind === "sphere"
        ? this.createSphereHelper(boundsSize(bounds), this.worldToParentLocal(boundsCenter(bounds)))
        : this.createBoxHelper(bounds);
    helper.color = hexToColor3(this.warningColor);
    helper.isPickable = false;
    return helper;
  }

  private createBoxHelper(bounds: WorldBounds): LinesMesh {
    if (!this.boxEdgePaths) {
      throw new Error("Box edge paths are required for box bounding helpers");
    }

    const size = boundsSize(bounds);
    const center = boundsCenter(bounds);
    const localCenter = this.worldToParentLocal(center);
    const half = size.scale(0.5);
    const min = new Vector3(
      localCenter.x - half.x,
      localCenter.y - half.y,
      localCenter.z - half.z,
    );
    const max = new Vector3(
      localCenter.x + half.x,
      localCenter.y + half.y,
      localCenter.z + half.z,
    );
    writeLocalBoundsToEdgePaths(min, max, this.boxEdgePaths);

    return MeshBuilder.CreateLineSystem(
      "viz3d-bbox",
      { lines: this.boxEdgePaths, updatable: true },
      this.scene,
    );
  }

  private refreshBoxHelper(bounds: WorldBounds): void {
    if (!this.boxEdgePaths) {
      return;
    }

    const size = boundsSize(bounds);
    const center = boundsCenter(bounds);
    const localCenter = this.worldToParentLocal(center);
    const half = size.scale(0.5);
    const min = new Vector3(
      localCenter.x - half.x,
      localCenter.y - half.y,
      localCenter.z - half.z,
    );
    const max = new Vector3(
      localCenter.x + half.x,
      localCenter.y + half.y,
      localCenter.z + half.z,
    );
    writeLocalBoundsToEdgePaths(min, max, this.boxEdgePaths);
    MeshBuilder.CreateLineSystem(
      this.helper.name,
      { lines: this.boxEdgePaths, instance: this.helper, updatable: true },
      this.scene,
    );
  }

  private createSphereHelper(size: Vector3, center: Vector3): LinesMesh {
    const radius = Math.max(size.length() / 2, 0.001);
    const segments = 16;
    const rings = 12;
    const lines: Vector3[][] = [];

    for (let ring = 0; ring <= rings; ring++) {
      const phi = (ring / rings) * Math.PI;
      const ringPoints: Vector3[] = [];
      for (let seg = 0; seg <= segments; seg++) {
        const theta = (seg / segments) * Math.PI * 2;
        ringPoints.push(
          new Vector3(
            center.x + radius * Math.sin(phi) * Math.cos(theta),
            center.y + radius * Math.cos(phi),
            center.z + radius * Math.sin(phi) * Math.sin(theta),
          ),
        );
      }
      lines.push(ringPoints);
    }

    for (let seg = 0; seg < segments; seg++) {
      const meridian: Vector3[] = [];
      const theta = (seg / segments) * Math.PI * 2;
      for (let ring = 0; ring <= rings; ring++) {
        const phi = (ring / rings) * Math.PI;
        meridian.push(
          new Vector3(
            center.x + radius * Math.sin(phi) * Math.cos(theta),
            center.y + radius * Math.cos(phi),
            center.z + radius * Math.sin(phi) * Math.sin(theta),
          ),
        );
      }
      lines.push(meridian);
    }

    return MeshBuilder.CreateLineSystem("viz3d-bbox-sphere", { lines }, this.scene);
  }

  private replaceHelper(bounds: WorldBounds, kind: BoundingBoxKind): void {
    const parent = this.helper.parent;
    this.helper.dispose();
    this.helper = this.createHelper(bounds, kind);
    this.helper.parent = parent;
  }
}
