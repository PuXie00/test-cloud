import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import {
  cloneHierarchy,
  disposeNodeHierarchy,
  getWorldBounds,
  hexToColor3,
  type WorldBounds,
} from "../babylon/utils";
import { resolveVirtualAxisTransform } from "../telemetry/virtual-axis-mapper";
import { createPbrStandardMaterial } from "../materials/pbr-material";
import type { SceneObjectHandle } from "../objects/SceneObjectRegistry";
import type { VirtualAxisValues, Viz3DColorMap } from "../types";

const centerOf = (bounds: WorldBounds): Vector3 =>
  new Vector3(
    (bounds.min.x + bounds.max.x) / 2,
    (bounds.min.y + bounds.max.y) / 2,
    (bounds.min.z + bounds.max.z) / 2,
  );

export class GoShadow {
  private readonly root: TransformNode;
  private readonly pivot: TransformNode;
  private readonly visual: TransformNode;
  private line: LinesMesh;
  private disposed = false;

  constructor(
    private readonly handle: SceneObjectHandle,
    target: VirtualAxisValues,
    private readonly scene: Scene,
    private readonly colors: Viz3DColorMap,
    color?: number,
  ) {
    const config = handle.getConfig();
    const transform = resolveVirtualAxisTransform(config, target);
    const ghostColor = color ?? colors.secondary;

    this.root = new TransformNode(`viz3d-go-shadow-${handle.id}`, scene);
    this.root.position.set(transform.position.x, transform.position.y, transform.position.z);
    this.root.rotation.set(config.rotation.x, config.rotation.y, config.rotation.z);

    this.pivot = new TransformNode(`viz3d-go-shadow-${handle.id}-pivot`, scene);
    this.pivot.parent = this.root;
    this.pivot.rotation.set(transform.rotation.x, transform.rotation.y, transform.rotation.z);

    this.visual = cloneHierarchy(handle.getVisualRoot(), scene, `viz3d-go-shadow-${handle.id}-visual`);
    this.visual.parent = this.pivot;

    const ghost = createPbrStandardMaterial({
      scene,
      name: `viz3d-go-shadow-material-${handle.id}`,
      color: hexToColor3(ghostColor),
      alpha: 0.35,
      backFaceCulling: false,
    });
    for (const mesh of this.visual.getChildMeshes(false)) {
      mesh.material = ghost;
      mesh.isPickable = false;
      // 源物体可能因非成员变淡而 visibility < 1；残影透明度只由 ghost.alpha 决定
      mesh.visibility = 1;
    }

    this.line = MeshBuilder.CreateLines(
      `viz3d-go-shadow-line-${handle.id}`,
      { points: [Vector3.Zero(), Vector3.Zero()], updatable: true },
      scene,
    );
    this.line.color = hexToColor3(ghostColor);
    this.line.isPickable = false;
    this.updateConnector();
  }

  updateConnector(): void {
    if (this.disposed) return;
    const sourceCenter = centerOf(getWorldBounds(this.handle.selectionBoundsTarget));
    const shadowCenter = centerOf(getWorldBounds(this.visual));
    this.line = MeshBuilder.CreateLines(
      this.line.name,
      {
        points: [sourceCenter, shadowCenter],
        instance: this.line,
      },
      this.scene,
    );
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.line.dispose();
    disposeNodeHierarchy(this.visual);
    this.pivot.dispose(false, true);
    this.root.dispose(false, true);
  }
}
