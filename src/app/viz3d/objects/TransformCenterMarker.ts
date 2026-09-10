import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";
import type { ToolMode, Vec3 } from "../types";
import { hexToColor3 } from "../babylon/utils";

export const shouldShowTransformCenterMarker = (
  mode: ToolMode,
  selectedIds: readonly string[],
  sceneEditEnabled: boolean,
): boolean => sceneEditEnabled && mode === "select" && selectedIds.length === 1;

export class TransformCenterMarker {
  readonly root: Mesh;
  private readonly material: StandardMaterial;

  constructor(scene: Scene, warningColor: number) {
    const color = hexToColor3(warningColor);
    this.material = new StandardMaterial("viz3d-transform-center-marker-material", scene);
    this.material.diffuseColor = color;
    this.material.emissiveColor = color;
    this.material.specularColor.set(0, 0, 0);
    this.material.disableLighting = true;
    this.material.disableDepthWrite = true;

    this.root = new Mesh("viz3d-transform-center-marker", scene);
    this.root.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.root.isPickable = false;

    const ring = MeshBuilder.CreateTorus(
      "viz3d-transform-center-ring",
      { diameter: 1, thickness: 0.08, tessellation: 32 },
      scene,
    );
    ring.rotation.x = Math.PI / 2;
    this.configurePart(ring);

    const horizontal = MeshBuilder.CreateBox(
      "viz3d-transform-center-cross-x",
      { width: 0.72, height: 0.055, depth: 0.035 },
      scene,
    );
    this.configurePart(horizontal);

    const vertical = MeshBuilder.CreateBox(
      "viz3d-transform-center-cross-y",
      { width: 0.055, height: 0.72, depth: 0.035 },
      scene,
    );
    this.configurePart(vertical);

    this.root.setEnabled(false);
  }

  show(position: Vec3, size: number): void {
    this.root.position.set(position.x, position.y, position.z);
    this.root.scaling.setAll(size);
    this.root.setEnabled(true);
  }

  hide(): void {
    this.root.setEnabled(false);
  }

  setColor(warningColor: number): void {
    const color = hexToColor3(warningColor);
    this.material.diffuseColor = color;
    this.material.emissiveColor = color;
  }

  dispose(): void {
    this.root.dispose(false, false);
    this.material.dispose();
  }

  private configurePart(mesh: Mesh): void {
    mesh.parent = this.root;
    mesh.material = this.material;
    mesh.isPickable = false;
    mesh.renderingGroupId = 3;
  }
}
