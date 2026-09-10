import "@babylonjs/core/Rendering/edgesRenderer";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { GizmoManager } from "@babylonjs/core/Gizmos/gizmoManager";
import type { IAxisDragGizmo } from "@babylonjs/core/Gizmos/axisDragGizmo";
import type { IPlaneDragGizmo } from "@babylonjs/core/Gizmos/planeDragGizmo";
import type { IPlaneRotationGizmo } from "@babylonjs/core/Gizmos/planeRotationGizmo";
import type { IPositionGizmo } from "@babylonjs/core/Gizmos/positionGizmo";
import type { IRotationGizmo } from "@babylonjs/core/Gizmos/rotationGizmo";
import type { IScaleGizmo } from "@babylonjs/core/Gizmos/scaleGizmo";
import type { Scene } from "@babylonjs/core/scene";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { VIZ3D_AXIS_COLORS } from "../helpers/axes-config";
import type { TransformMode, Vec3 } from "../types";
import {
  ALL_MODEL_ROTATION_AXES,
  bakeRotationQuaternionToEuler,
  constrainRotationAxes,
  rotationAxesEqual,
  type RotationAxisKey,
  type RotationEuler,
} from "./rotation-xy-constraint";
import { ViewPlaneDragHandle } from "./view-plane-drag-handle";
import { shouldYieldPointerToTransformHandle } from "./transform-handle-pick";
import {
  detectDraggingPositionHandle,
  resolvePositionHandleHighlight,
  shouldPickAxisGizmoMesh,
  type PositionHandleHighlight,
  type PositionHandleId,
} from "./gizmo-drag-highlight";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";

export type TransformCommitPayload = {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
};

export type TransformControllerCallbacks = {
  onOrbitToggle: (enabled: boolean) => void;
  onChange: () => void;
  onCommit: (payload: TransformCommitPayload) => void;
  onDragStart?: () => void;
  onCancel?: () => void;
};

type DragGizmo = IPositionGizmo | IRotationGizmo | IScaleGizmo;

type NodeTransformSnapshot = {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
};

const axisColor3 = (axis: keyof typeof VIZ3D_AXIS_COLORS): Color3 => {
  const color = VIZ3D_AXIS_COLORS[axis];
  return new Color3(color.r, color.g, color.b);
};

const AXIS_COLOR = {
  x: axisColor3("x"),
  y: axisColor3("y"),
  z: axisColor3("z"),
} as const;

const TRANSFORM_GIZMO_SCALE_RATIO = 0.50;
const TRANSFORM_GIZMO_THICKNESS = 1.5;

const readNodeTransform = (node: TransformNode): NodeTransformSnapshot => ({
  position: { x: node.position.x, y: node.position.y, z: node.position.z },
  rotation: { x: node.rotation.x, y: node.rotation.y, z: node.rotation.z },
  scale: { x: node.scaling.x, y: node.scaling.y, z: node.scaling.z },
});

const applyNodeTransform = (node: TransformNode, snapshot: NodeTransformSnapshot): void => {
  node.position.set(snapshot.position.x, snapshot.position.y, snapshot.position.z);
  node.rotation.set(snapshot.rotation.x, snapshot.rotation.y, snapshot.rotation.z);
  node.scaling.set(snapshot.scale.x, snapshot.scale.y, snapshot.scale.z);
  node.rotationQuaternion = null;
  node.computeWorldMatrix(true);
};

const styleDisableMaterial = (material: StandardMaterial): void => {
  material.diffuseColor = Color3.Gray();
  material.emissiveColor = Color3.Gray().scale(0.25);
  material.specularColor = Color3.Black();
  material.disableLighting = true;
  material.alpha = 0.4;
};

const styleAxisGizmo = (axis: IAxisDragGizmo, color: Color3): void => {
  axis.coloredMaterial.diffuseColor = color;
  axis.coloredMaterial.emissiveColor = color;
  axis.coloredMaterial.specularColor = Color3.Black();
  axis.coloredMaterial.disableLighting = true;
  axis.hoverMaterial.diffuseColor = color;
  axis.hoverMaterial.emissiveColor = color;
  axis.hoverMaterial.disableLighting = true;
  styleDisableMaterial(axis.disableMaterial);
};

const styleRotationGizmo = (axis: IPlaneRotationGizmo, color: Color3): void => {
  axis.coloredMaterial.diffuseColor = color;
  axis.coloredMaterial.emissiveColor = color;
  axis.coloredMaterial.specularColor = Color3.Black();
  axis.coloredMaterial.disableLighting = true;
  axis.hoverMaterial.diffuseColor = color;
  axis.hoverMaterial.emissiveColor = color;
  axis.hoverMaterial.disableLighting = true;
  axis.rotationColor = color;
  styleDisableMaterial(axis.disableMaterial);
};

/** Shorten the visible shaft so it starts just outside the center ring. */
const layoutAxisGizmo = (axis: IAxisDragGizmo): void => {
  const visibleShaft = axis._rootMesh
    .getChildMeshes(false)
    .find(
      (mesh) =>
        mesh.name === "cylinder" &&
        mesh.visibility > 0 &&
        mesh.position.z > 0 &&
        mesh.position.z < 0.2,
    );
  if (visibleShaft) {
    const originalLength = 0.275;
    const centerGap = 0.05;
    const visibleLength = originalLength - centerGap;
    visibleShaft.scaling.y = visibleLength / originalLength;
    visibleShaft.position.z = centerGap + visibleLength / 2;
  }

  for (const mesh of axis._rootMesh.getChildMeshes(false)) {
    mesh.isPickable = shouldPickAxisGizmoMesh(mesh.visibility);
  }
};

const findPlaneSquare = (plane: IPlaneDragGizmo) =>
  plane._rootMesh.getChildMeshes(false).find((mesh) => mesh.name === "dragPlane");

const stylePlaneGizmo = (plane: IPlaneDragGizmo, color: Color3): void => {
  plane.coloredMaterial.diffuseColor = color;
  plane.coloredMaterial.emissiveColor = color;
  plane.coloredMaterial.specularColor = Color3.Black();
  plane.coloredMaterial.disableLighting = true;
  plane.coloredMaterial.alpha = 0.38;
  plane.hoverMaterial.diffuseColor = color;
  plane.hoverMaterial.emissiveColor = color;
  plane.hoverMaterial.disableLighting = true;
  plane.hoverMaterial.alpha = 0.78;
  styleDisableMaterial(plane.disableMaterial);
  plane.disableMaterial.alpha = 0.4;

  const square = findPlaneSquare(plane);
  if (square) {
    square.enableEdgesRendering();
    square.edgesColor = new Color4(color.r, color.g, color.b, 1);
    square.edgesWidth = 2;
  }
};

/**
 * Babylon centers all three plane handles. Blender places each square between
 * the two axes it controls: YZ / XZ / XY respectively.
 */
const layoutPlaneGizmo = (
  plane: IPlaneDragGizmo,
  localOffset: readonly [number, number],
): void => {
  const square = findPlaneSquare(plane);
  if (!square) return;
  square.position.set(localOffset[0], localOffset[1], 0);
  square.scaling.setAll(0.38);
};

type HighlightableGizmo = {
  _rootMesh: IAxisDragGizmo["_rootMesh"];
  coloredMaterial: StandardMaterial;
  hoverMaterial: StandardMaterial;
  disableMaterial: StandardMaterial;
};

const materialForHighlight = (
  gizmo: HighlightableGizmo,
  state: PositionHandleHighlight,
): StandardMaterial => {
  if (state === "dimmed") return gizmo.disableMaterial;
  if (state === "active") return gizmo.hoverMaterial;
  return gizmo.coloredMaterial;
};

const applyGizmoHighlight = (gizmo: HighlightableGizmo, state: PositionHandleHighlight): void => {
  const material = materialForHighlight(gizmo, state);
  for (const mesh of gizmo._rootMesh.getChildMeshes(false)) {
    if (mesh.visibility > 0) {
      mesh.material = material;
    }
  }
};

export class TransformController {
  private readonly scene: Scene;
  private readonly gizmoManager: GizmoManager;
  private readonly viewPlaneDrag: ViewPlaneDragHandle;
  private attached: TransformNode | null = null;
  private mode: TransformMode = "translate";
  private rotationAxes: readonly RotationAxisKey[] = ALL_MODEL_ROTATION_AXES;
  private rotationBaseline: RotationEuler | null = null;
  private helperVisible = true;
  private enabled = true;
  private dragging = false;
  private cancelled = false;
  private dragStartTransform: NodeTransformSnapshot | null = null;
  private readonly wiredGizmos = new Set<DragGizmo>();
  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    this.restoreAndCancel();
  };
  private readonly handlePointerCancel = () => {
    this.restoreAndCancel();
  };

  constructor(
    scene: Scene,
    private readonly callbacks: TransformControllerCallbacks,
  ) {
    this.scene = scene;
    this.gizmoManager = new GizmoManager(scene, TRANSFORM_GIZMO_THICKNESS);
    this.gizmoManager.usePointerToAttachGizmos = false;
    this.gizmoManager.clearGizmoOnEmptyPointerEvent = false;

    this.viewPlaneDrag = new ViewPlaneDragHandle(this.gizmoManager.utilityLayer, {
      onDragStart: () => {
        this.dragging = true;
        this.cancelled = false;
        this.dragStartTransform = this.attached ? readNodeTransform(this.attached) : null;
        this.bindCancelListeners();
        this.callbacks.onOrbitToggle(false);
        this.callbacks.onDragStart?.();
        this.syncPositionHandleHighlight();
      },
      onDrag: () => {
        if (this.cancelled) {
          this.restoreDragStartTransform();
          return;
        }
        this.syncPositionHandleHighlight();
        this.callbacks.onChange();
      },
      onDragEnd: () => {
        if (!this.dragging) {
          return;
        }
        this.dragging = false;
        this.unbindCancelListeners();
        this.syncPositionHandleHighlight();
        this.callbacks.onOrbitToggle(true);
        if (this.cancelled) {
          this.restoreDragStartTransform();
          this.dragStartTransform = null;
          this.cancelled = false;
          return;
        }
        this.emitCommit();
      },
      shouldIgnoreDrag: () => this.cancelled,
    });

    // 预创建位移/旋转 Gizmo，避免首次显示时以默认 scaleRatio=1 闪一帧
    this.gizmoManager.positionGizmoEnabled = true;
    this.gizmoManager.rotationGizmoEnabled = true;
    this.gizmoManager.scaleRatio = TRANSFORM_GIZMO_SCALE_RATIO;
    this.gizmoManager.positionGizmoEnabled = false;
    this.gizmoManager.rotationGizmoEnabled = false;

    this.setMode(this.mode);
  }

  attach(node: TransformNode): void {
    this.attached = node;
    if (this.mode === "rotate") {
      // 仅在轴受限时投影；完整 XYZ 交给 Gizmo 自由使用四元数
      this.rotationBaseline = this.applyRotationPolicy("attach");
    } else {
      this.rotationBaseline = null;
    }
    this.syncAttachment();
  }

  detach(): void {
    this.gizmoManager.attachToNode(null);
    this.viewPlaneDrag.setAttached(null);
    this.attached = null;
    this.rotationBaseline = null;
  }

  setHelperVisible(visible: boolean): void {
    this.helperVisible = visible;
    this.syncAttachment();
  }

  /** 与侧栏一致的可旋转轴；空数组时旋转子 Gizmo 全关 */
  setRotationAxes(axes: readonly RotationAxisKey[]): void {
    if (rotationAxesEqual(this.rotationAxes, axes)) {
      return;
    }
    this.rotationAxes = axes;
    this.applyAxisVisibility(this.mode);
    if (this.mode === "rotate" && this.attached && !this.dragging) {
      this.rotationBaseline = this.applyRotationPolicy("attach");
    }
  }

  setMode(mode: TransformMode): void {
    this.mode = mode;
    this.gizmoManager.positionGizmoEnabled = mode === "translate";
    this.gizmoManager.rotationGizmoEnabled = mode === "rotate";
    this.gizmoManager.scaleGizmoEnabled = mode === "scale";
    // GizmoManager does not propagate an earlier scaleRatio to gizmos created later.
    this.gizmoManager.scaleRatio = TRANSFORM_GIZMO_SCALE_RATIO;
    this.applyAxisVisibility(mode);
    this.ensureGizmoObservers();
    if (mode === "rotate" && this.attached) {
      this.rotationBaseline = this.applyRotationPolicy("attach");
    }
    this.syncAttachment();
  }

  private isFullRotationAxes(): boolean {
    return rotationAxesEqual(this.rotationAxes, ALL_MODEL_ROTATION_AXES);
  }

  /**
   * attach：轴受限时投影到允许轴；XYZ 不改写（避免清掉四元数）。
   * commit：烘焙四元数到欧拉；轴受限时再投影。
   */
  private applyRotationPolicy(phase: "attach" | "commit"): RotationEuler | null {
    if (!this.attached) return null;
    if (phase === "attach" && this.isFullRotationAxes()) {
      return {
        x: this.attached.rotation.x,
        y: this.attached.rotation.y,
        z: this.attached.rotation.z,
      };
    }
    if (this.isFullRotationAxes()) {
      return bakeRotationQuaternionToEuler(this.attached);
    }
    return constrainRotationAxes(
      this.attached,
      this.rotationAxes,
      this.rotationBaseline ?? undefined,
    );
  }

  private applyAxisVisibility(mode: TransformMode): void {
    const rotationGizmo = this.gizmoManager.gizmos.rotationGizmo;
    if (rotationGizmo && mode === "rotate") {
      rotationGizmo.xGizmo.isEnabled = this.rotationAxes.includes("x");
      rotationGizmo.yGizmo.isEnabled = this.rotationAxes.includes("y");
      rotationGizmo.zGizmo.isEnabled = this.rotationAxes.includes("z");
      styleRotationGizmo(rotationGizmo.xGizmo, AXIS_COLOR.x);
      styleRotationGizmo(rotationGizmo.yGizmo, AXIS_COLOR.y);
      styleRotationGizmo(rotationGizmo.zGizmo, AXIS_COLOR.z);
      // 世界空间旋转环（与位移世界轴一致）
      rotationGizmo.updateGizmoRotationToMatchAttachedMesh = false;
    }

    const positionGizmo = this.gizmoManager.gizmos.positionGizmo;
    if (positionGizmo) {
      positionGizmo.xGizmo.isEnabled = true;
      positionGizmo.yGizmo.isEnabled = true;
      positionGizmo.zGizmo.isEnabled = true;
      // 世界空间位移箭头 / 平面方块：不随物体朝向旋转
      positionGizmo.updateGizmoRotationToMatchAttachedMesh = false;
      positionGizmo.planarGizmoEnabled = mode === "translate";
      styleAxisGizmo(positionGizmo.xGizmo, AXIS_COLOR.x);
      styleAxisGizmo(positionGizmo.yGizmo, AXIS_COLOR.y);
      styleAxisGizmo(positionGizmo.zGizmo, AXIS_COLOR.z);
      layoutAxisGizmo(positionGizmo.xGizmo);
      layoutAxisGizmo(positionGizmo.yGizmo);
      layoutAxisGizmo(positionGizmo.zGizmo);
      // xPlane = YZ（锁 X）→ 红；yPlane = XZ（锁 Y）→ 绿；zPlane = XY（锁 Z）→ 蓝。
      // 偏置值基于各 PlaneDragGizmo 的局部平面坐标，布局与 Blender 一致。
      stylePlaneGizmo(positionGizmo.xPlaneGizmo, AXIS_COLOR.x);
      stylePlaneGizmo(positionGizmo.yPlaneGizmo, AXIS_COLOR.y);
      stylePlaneGizmo(positionGizmo.zPlaneGizmo, AXIS_COLOR.z);
      layoutPlaneGizmo(positionGizmo.xPlaneGizmo, [-0.19, 0.19]);
      layoutPlaneGizmo(positionGizmo.yPlaneGizmo, [-0.19, -0.19]);
      layoutPlaneGizmo(positionGizmo.zPlaneGizmo, [0.19, 0.19]);
      this.viewPlaneDrag.setScaleReference(positionGizmo.xGizmo._rootMesh);
    }

    const scaleGizmo = this.gizmoManager.gizmos.scaleGizmo;
    if (scaleGizmo) {
      scaleGizmo.xGizmo.isEnabled = true;
      scaleGizmo.yGizmo.isEnabled = true;
      scaleGizmo.zGizmo.isEnabled = true;
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.syncAttachment();
  }

  /** True when a gizmo/view-plane handle is already dragging or under the pointer. */
  hitsHandle(_canvasX: number, _canvasY: number): boolean {
    return shouldYieldPointerToTransformHandle({
      dragging: this.dragging,
      enabled: this.enabled,
      helperVisible: this.helperVisible,
      attached: Boolean(this.attached),
      hovered:
        this.gizmoManager.isHovered ||
        this.viewPlaneDrag.isHovered ||
        this.viewPlaneDrag.isDragging,
    });
  }

  dispose(): void {
    this.unbindCancelListeners();
    this.viewPlaneDrag.dispose();
    this.gizmoManager.dispose();
  }

  /**
   * Restore drag-start snapshot and emit cancel once.
   * Safe during physical drag (keeps snapshot until dragEnd) or after failed commit.
   */
  restoreAndCancel(): void {
    if (this.cancelled && !this.dragStartTransform) {
      return;
    }
    if (!this.dragging && !this.dragStartTransform) {
      return;
    }

    const alreadyCancelled = this.cancelled;
    this.cancelled = true;
    this.restoreDragStartTransform();

    // Physical Babylon drag may still be active: keep snapshot + dragging so
    // later onDrag / onDragEnd can re-pin and finalize without emitting commit.
    if (!this.dragging) {
      this.dragStartTransform = null;
    }

    this.unbindCancelListeners();
    this.callbacks.onOrbitToggle(true);
    this.syncPositionHandleHighlight();
    if (!alreadyCancelled) {
      this.callbacks.onCancel?.();
    }
  }

  private restoreDragStartTransform(): void {
    if (this.attached && this.dragStartTransform) {
      applyNodeTransform(this.attached, this.dragStartTransform);
    }
  }

  private syncAttachment(): void {
    const active = Boolean(this.attached && this.enabled && this.helperVisible);
    if (!active || !this.attached) {
      this.gizmoManager.attachToNode(null);
      this.viewPlaneDrag.setAttached(null);
      this.viewPlaneDrag.setVisible(false);
      return;
    }
    this.gizmoManager.attachToNode(this.attached);
    // attach 后默认 scaling=1，须在首帧绘制前按相机距离同步，否则会看到由大变小
    this.syncGizmoScreenScale();
    this.viewPlaneDrag.setAttached(this.attached);
    this.viewPlaneDrag.setVisible(this.mode === "translate");
  }

  private readPositionHandleDragFlags(): Record<PositionHandleId, boolean> {
    const position = this.gizmoManager.gizmos.positionGizmo;
    return {
      x: Boolean(position?.xGizmo.dragBehavior.dragging),
      y: Boolean(position?.yGizmo.dragBehavior.dragging),
      z: Boolean(position?.zGizmo.dragBehavior.dragging),
      xPlane: Boolean(position?.xPlaneGizmo.dragBehavior.dragging),
      yPlane: Boolean(position?.yPlaneGizmo.dragBehavior.dragging),
      zPlane: Boolean(position?.zPlaneGizmo.dragBehavior.dragging),
      viewPlane: this.viewPlaneDrag.isDragging,
    };
  }

  private syncPositionHandleHighlight(): void {
    const handleId =
      this.dragging && this.mode === "translate" ? detectDraggingPositionHandle(this.readPositionHandleDragFlags()) : null;
    this.applyPositionHandleHighlight(handleId);
  }

  private applyPositionHandleHighlight(handleId: PositionHandleId | null): void {
    const position = this.gizmoManager.gizmos.positionGizmo;
    if (!position) {
      this.viewPlaneDrag.setHighlight("idle");
      return;
    }

    const highlight = (id: PositionHandleId): PositionHandleHighlight =>
      resolvePositionHandleHighlight({ draggingHandleId: handleId, handleId: id });

    applyGizmoHighlight(position.xGizmo, highlight("x"));
    applyGizmoHighlight(position.yGizmo, highlight("y"));
    applyGizmoHighlight(position.zGizmo, highlight("z"));
    applyGizmoHighlight(position.xPlaneGizmo, highlight("xPlane"));
    applyGizmoHighlight(position.yPlaneGizmo, highlight("yPlane"));
    applyGizmoHighlight(position.zPlaneGizmo, highlight("zPlane"));
    this.viewPlaneDrag.setHighlight(highlight("viewPlane"));

    const applyPlaneEdges = (plane: IPlaneDragGizmo, id: PositionHandleId, color: Color3): void => {
      const square = findPlaneSquare(plane);
      if (!square) return;
      const state = highlight(id);
      const edge = state === "dimmed" ? Color3.Gray() : color;
      square.edgesColor = new Color4(edge.r, edge.g, edge.b, state === "dimmed" ? 0.35 : 1);
    };
    applyPlaneEdges(position.xPlaneGizmo, "xPlane", AXIS_COLOR.x);
    applyPlaneEdges(position.yPlaneGizmo, "yPlane", AXIS_COLOR.y);
    applyPlaneEdges(position.zPlaneGizmo, "zPlane", AXIS_COLOR.z);
  }

  /** 立即执行 Babylon Gizmo._update，避免首帧以单位缩放显示 */
  private syncGizmoScreenScale(): void {
    const utilityScene = this.gizmoManager.utilityLayer.utilityLayerScene;
    const camera = utilityScene.activeCamera ?? this.scene.activeCamera;
    if (!camera) {
      return;
    }
    utilityScene.activeCamera = camera;

    const update = (gizmo: unknown) => {
      (gizmo as { _update?: () => void } | null | undefined)?._update?.();
    };

    const position = this.gizmoManager.gizmos.positionGizmo;
    if (position) {
      update(position.xGizmo);
      update(position.yGizmo);
      update(position.zGizmo);
      update(position.xPlaneGizmo);
      update(position.yPlaneGizmo);
      update(position.zPlaneGizmo);
    }

    const rotation = this.gizmoManager.gizmos.rotationGizmo;
    if (rotation) {
      update(rotation.xGizmo);
      update(rotation.yGizmo);
      update(rotation.zGizmo);
    }

    const scale = this.gizmoManager.gizmos.scaleGizmo;
    if (scale) {
      update(scale.xGizmo);
      update(scale.yGizmo);
      update(scale.zGizmo);
    }
  }

  private ensureGizmoObservers(): void {
    const gizmos: Array<DragGizmo | null> = [
      this.gizmoManager.gizmos.positionGizmo,
      this.gizmoManager.gizmos.rotationGizmo,
      this.gizmoManager.gizmos.scaleGizmo,
    ];
    for (const gizmo of gizmos) {
      if (!gizmo || this.wiredGizmos.has(gizmo)) {
        continue;
      }
      this.wiredGizmos.add(gizmo);
      gizmo.onDragStartObservable.add(() => {
        this.dragging = true;
        this.cancelled = false;
        this.dragStartTransform = this.attached ? readNodeTransform(this.attached) : null;
        this.bindCancelListeners();
        this.callbacks.onOrbitToggle(false);
        this.callbacks.onDragStart?.();
        this.syncPositionHandleHighlight();
      });
      gizmo.onDragObservable.add(() => {
        if (this.cancelled) {
          // Gizmo keeps mutating the node until physical drag ends; re-pin.
          this.restoreDragStartTransform();
          return;
        }
        this.syncPositionHandleHighlight();
        // 拖拽中不要 quat→euler 回写，否则世界轴 X/Z 会大幅偏移
        this.callbacks.onChange();
      });
      gizmo.onDragEndObservable.add(() => {
        if (!this.dragging) {
          return;
        }
        this.dragging = false;
        this.unbindCancelListeners();
        this.syncPositionHandleHighlight();
        this.callbacks.onOrbitToggle(true);
        if (this.cancelled) {
          this.restoreDragStartTransform();
          this.dragStartTransform = null;
          this.cancelled = false;
          return;
        }
        this.emitCommit();
      });
    }
  }

  private bindCancelListeners(): void {
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("pointercancel", this.handlePointerCancel);
  }

  private unbindCancelListeners(): void {
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("pointercancel", this.handlePointerCancel);
  }

  private emitCommit(): void {
    const object = this.attached;
    if (!object) {
      this.restoreAndCancel();
      return;
    }
    if (this.mode === "rotate") {
      this.rotationBaseline = this.applyRotationPolicy("commit");
    }
    // Keep dragStartTransform until commit succeeds so failed commits can restore.
    this.callbacks.onCommit({
      position: { x: object.position.x, y: object.position.y, z: object.position.z },
      rotation: { x: object.rotation.x, y: object.rotation.y, z: object.rotation.z },
      scale: { x: object.scaling.x, y: object.scaling.y, z: object.scaling.z },
    });
    if (!this.cancelled) {
      this.dragStartTransform = null;
    }
    // 落盘回写后保持挂载，避免旋转 Gizmo 松手消失
    this.syncAttachment();
  }
}
