import { PointerDragBehavior } from "@babylonjs/core/Behaviors/Meshes/pointerDragBehavior";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { PointerInfo } from "@babylonjs/core/Events/pointerEvents";
import type { Scene } from "@babylonjs/core/scene";
import type { UtilityLayerRenderer } from "@babylonjs/core/Rendering/utilityLayerRenderer";
import type { PositionHandleHighlight } from "./gizmo-drag-highlight";

export type ViewPlaneDragHandleCallbacks = {
  onDragStart: () => void;
  onDrag: () => void;
  onDragEnd: () => void;
  /** When true, discard delta and keep node pinned (cancel mid-drag). */
  shouldIgnoreDrag?: () => boolean;
};

/**
 * Blender-style center white ring: drag on the current camera view plane.
 * No center dot.
 */
export class ViewPlaneDragHandle {
  private readonly utilityScene: Scene;
  private readonly root: TransformNode;
  private readonly facingRoot: Mesh;
  private readonly ring: Mesh;
  private readonly collider: Mesh;
  private readonly material: StandardMaterial;
  private readonly dragBehavior: PointerDragBehavior;
  private readonly beforeRenderObserver: Observer<Scene>;
  private readonly pointerObserver: Observer<PointerInfo>;
  private attached: TransformNode | null = null;
  private scaleReference: TransformNode | null = null;
  private visible = false;
  private hovered = false;
  private readonly tmpDelta = new Vector3();

  constructor(
    utilityLayer: UtilityLayerRenderer,
    private readonly callbacks: ViewPlaneDragHandleCallbacks,
  ) {
    this.utilityScene = utilityLayer.utilityLayerScene;
    this.root = new TransformNode("viz3d-view-plane-drag-root", this.utilityScene);
    this.root.setEnabled(false);

    this.facingRoot = new Mesh("viz3d-view-plane-drag-facing", this.utilityScene);
    this.facingRoot.parent = this.root;
    this.facingRoot.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.facingRoot.isPickable = false;

    this.material = new StandardMaterial("viz3d-view-plane-drag-mat", this.utilityScene);
    this.material.diffuseColor = Color3.White();
    this.material.emissiveColor = Color3.White().scale(0.85);
    this.material.specularColor = Color3.Black();
    this.material.disableLighting = true;

    // Torus is created in XZ (normal Y). Rotate it into XY (normal Z), then
    // billboard Z toward the camera so the complete white ring stays visible.
    this.ring = CreateTorus(
      "viz3d-view-plane-drag-ring",
      { diameter: 0.03, thickness: 0.0024, tessellation: 64 },
      this.utilityScene,
    );
    this.ring.parent = this.facingRoot;
    this.ring.material = this.material;
    this.ring.rotation.x = Math.PI / 2;
    this.ring.isPickable = false;
    this.ring.renderingGroupId = 1;

    // Keep the Blender-sized ring easy to grab with a wider invisible collider.
    this.collider = CreateTorus(
      "viz3d-view-plane-drag-collider",
      { diameter: 0.03, thickness: 0.012, tessellation: 32 },
      this.utilityScene,
    );
    this.collider.parent = this.facingRoot;
    this.collider.rotation.x = Math.PI / 2;
    this.collider.visibility = 0;
    this.collider.isPickable = true;

    // No dragPlaneNormal → plane always faces the pointer ray / camera (view plane).
    this.dragBehavior = new PointerDragBehavior();
    this.dragBehavior.moveAttached = false;
    this.dragBehavior.useObjectOrientationForDragging = false;
    this.collider.addBehavior(this.dragBehavior);

    this.dragBehavior.onDragStartObservable.add(() => {
      if (!this.attached || !this.visible) return;
      this.callbacks.onDragStart();
    });
    this.dragBehavior.onDragObservable.add((event) => {
      if (!this.attached || !this.visible) return;
      if (this.callbacks.shouldIgnoreDrag?.()) {
        return;
      }
      this.tmpDelta.copyFrom(event.delta);
      const world = this.attached.getAbsolutePosition();
      world.addInPlace(this.tmpDelta);
      this.attached.setAbsolutePosition(world);
      this.callbacks.onDrag();
    });
    this.dragBehavior.onDragEndObservable.add(() => {
      if (!this.attached || !this.visible) return;
      this.callbacks.onDragEnd();
    });

    this.pointerObserver = this.utilityScene.onPointerObservable.add((pointerInfo) => {
      this.hovered = pointerInfo.pickInfo?.pickedMesh === this.collider;
    });

    this.beforeRenderObserver = this.utilityScene.onBeforeRenderObservable.add(() => {
      this.syncPose();
    });

    const sharedLight = (
      utilityLayer as UtilityLayerRenderer & {
        _getSharedGizmoLight?: () => { includedOnlyMeshes: Mesh[] };
      }
    )._getSharedGizmoLight?.();
    if (sharedLight) {
      sharedLight.includedOnlyMeshes = sharedLight.includedOnlyMeshes.concat(this.ring);
    }
  }

  setAttached(node: TransformNode | null): void {
    this.attached = node;
    this.syncEnabled();
  }

  /** Reuse Babylon's gizmo screen-space scale exactly. */
  setScaleReference(node: TransformNode | null): void {
    this.scaleReference = node;
    if (this.attached && this.visible) {
      this.syncPose();
    }
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.syncEnabled();
  }

  get isHovered(): boolean {
    return this.hovered && this.visible && Boolean(this.attached);
  }

  get isDragging(): boolean {
    return this.dragBehavior.dragging;
  }

  setHighlight(state: PositionHandleHighlight): void {
    const dimmed = state === "dimmed";
    this.material.diffuseColor = Color3.White().scale(dimmed ? 0.35 : 1);
    this.material.emissiveColor = Color3.White().scale(dimmed ? 0.25 : 0.85);
  }

  dispose(): void {
    this.utilityScene.onPointerObservable.remove(this.pointerObserver);
    this.utilityScene.onBeforeRenderObservable.remove(this.beforeRenderObserver);
    this.collider.removeBehavior(this.dragBehavior);
    this.dragBehavior.detach();
    this.ring.dispose(false, true);
    this.collider.dispose();
    this.facingRoot.dispose();
    this.material.dispose();
    this.root.dispose();
    this.attached = null;
    this.scaleReference = null;
  }

  private syncEnabled(): void {
    const on = Boolean(this.attached && this.visible);
    this.root.setEnabled(on);
    this.dragBehavior.enabled = on;
    if (on) {
      this.syncPose();
    }
  }

  private syncPose(): void {
    if (!this.attached || !this.visible) return;
    const world = this.attached.getAbsolutePosition();
    this.root.setAbsolutePosition(world);

    if (this.scaleReference) {
      this.root.scaling.copyFrom(this.scaleReference.scaling);
      return;
    }

    const camera = this.utilityScene.activeCamera ?? this.utilityScene.getEngine().scenes[0]?.activeCamera;
    if (!camera) return;
    const distance = Vector3.Distance(camera.globalPosition, world);
    // Babylon perspective gizmos scale roughly with camera depth.
    const scale = Math.max(distance, 0.02);
    this.root.scaling.setAll(scale);
  }
}
