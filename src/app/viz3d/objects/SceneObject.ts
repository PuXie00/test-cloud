import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type {
  Disposable,
  RuntimeTransform,
  SceneObjectConfig,
  SceneObjectStatus,
  Vec3,
  Viz3DColorMap,
} from "../types";
import { createPresetMesh } from "./PresetGeometry";
import { createPbrStandardMaterial, applyMaterialBaseColor } from "../materials/pbr-material";
import { getStatusColor } from "../state/StatusColors";
import {
  createFrontOrientationMarker,
  syncFrontOrientationMarker,
} from "./front-orientation-marker";
import { HoistPointVisual } from "./HoistPointVisual";
import { computeHoistPointScale, resolveHoistPointLocalPosition } from "./hoist-point-layout";
import {
  cloneHierarchy,
  disposeNodeHierarchy,
  getNodeMetadata,
  getWorldBounds,
  hexToColor3,
  hexStringToColor3,
  setNodeMetadata,
  type WorldBounds,
} from "../babylon/utils";
import {
  getTemplateNativeSizeM,
  setTemplateNativeSizeM,
  uniformScaleForWidth,
} from "../loaders/model-native-size";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import {
  DEFAULT_HOIST_LABEL_MODE,
  type HoistLabelMode,
} from "../hoist-label-mode";
import { applyVisibility, DIMMED_VISIBILITY } from "./scene-object-dim";
import { applyRuntimePivot, resetRuntimePivot } from "./runtime-pivot";

export type ModelTemplateProvider = (id: string) => TransformNode | undefined;

export class SceneObject implements Disposable {
  readonly id: string;
  readonly root: TransformNode;
  readonly runtimePivot: TransformNode;
  private visual: TransformNode;
  private bodyMesh: Mesh | null = null;
  private frontMarker: Mesh | null = null;
  private presetMaterial: StandardMaterial | null = null;
  private usesModelVisual = false;
  private config: SceneObjectConfig;
  private hoistPoints = new Map<string, HoistPointVisual>();
  private fallbackBodyMesh: Mesh | null = null;
  private visualRevision = 0;
  private dimmed = false;

  constructor(
    config: SceneObjectConfig,
    private readonly scene: Scene,
    private colors: Viz3DColorMap,
    private getModelTemplate?: ModelTemplateProvider,
    private readonly getHoistLabelMode: () => HoistLabelMode = () => DEFAULT_HOIST_LABEL_MODE,
  ) {
    this.id = config.id;
    this.config = config;
    this.root = new TransformNode(`viz3d-object-${config.id}`, scene);
    setNodeMetadata(this.root, "viz3dObjectId", config.id);

    this.runtimePivot = new TransformNode(`viz3d-object-${config.id}-pivot`, scene);
    this.runtimePivot.parent = this.root;

    this.visual = new TransformNode(`viz3d-object-${config.id}-visual`, scene);
    this.rebuildVisual(config);
    this.applyTransformFromConfig(config);
    // Create path must sync hoists too — applyConfig only runs on subsequent setObjects.
    this.syncHoistPoints(config);
  }

  get object3d(): TransformNode {
    return this.root;
  }

  get attachmentPivot(): TransformNode {
    return this.runtimePivot;
  }

  getVisualRoot(): TransformNode {
    return this.visual;
  }

  getVisualRevision(): number {
    return this.visualRevision;
  }

  get selectionBoundsTarget(): TransformNode {
    return this.visual;
  }

  getConfig(): SceneObjectConfig {
    return this.config;
  }

  getTransformCenterWorldPosition(): Vec3 {
    const { centerOffset } = this.config;
    const world = Vector3.TransformCoordinates(
      new Vector3(centerOffset.x, centerOffset.y, centerOffset.z),
      this.runtimePivot.computeWorldMatrix(true),
    );
    return { x: world.x, y: world.y, z: world.z };
  }

  applyConfig(config: SceneObjectConfig): void {
    const visualKindChanged = this.shouldRebuildVisual(config);
    const dimsChanged =
      config.dimensions.w !== this.config.dimensions.w ||
      config.dimensions.h !== this.config.dimensions.h ||
      config.dimensions.d !== this.config.dimensions.d;
    if (visualKindChanged) {
      this.rebuildVisual(config);
    } else if (this.usesModelVisual) {
      if (dimsChanged) {
        this.applyModelDimensions(config.dimensions);
      }
    } else {
      const shapeOrDimsChanged = config.shape !== this.config.shape || dimsChanged;
      if (shapeOrDimsChanged) {
        const mesh = this.bodyMesh;
        if (!mesh) return;
        const nextMesh = createPresetMesh(config.shape, config.dimensions, this.scene);
        nextMesh.parent = mesh.parent;
        nextMesh.position.copyFrom(mesh.position);
        nextMesh.rotation.copyFrom(mesh.rotation);
        nextMesh.scaling.copyFrom(mesh.scaling);
        nextMesh.material = mesh.material;
        nextMesh.receiveShadows = false;
        setNodeMetadata(nextMesh, "viz3dObjectId", config.id);
        // 保留 material（与 this.presetMaterial 共享），只换几何
        // 朝向标记挂在 body 下：先摘掉再挂到新 mesh，避免随旧 mesh dispose
        const marker = this.frontMarker;
        if (marker) {
          marker.parent = null;
        }
        mesh.dispose(false, false);
        this.bodyMesh = nextMesh;
        nextMesh.visibility = this.dimmed ? DIMMED_VISIBILITY : 1;
        applyVisibility(nextMesh, this.dimmed ? DIMMED_VISIBILITY : 1);
        if (marker) {
          marker.parent = nextMesh;
          syncFrontOrientationMarker(nextMesh, marker);
        } else {
          this.attachFrontMarker(nextMesh);
        }
      }
    }

    this.applyTransformFromConfig(config);
    this.config = config;
    this.refreshColor();
    this.syncHoistPoints(config);
  }

  applyRuntimeTransform(transform: RuntimeTransform): void {
    this.root.position.set(transform.position.x, transform.position.y, transform.position.z);
    applyRuntimePivot(this.runtimePivot, transform);
  }

  getWorldBounds(): WorldBounds {
    return getWorldBounds(this.selectionBoundsTarget);
  }

  getBodyMesh(): Mesh {
    if (this.bodyMesh) {
      return this.bodyMesh;
    }
    const childMesh = this.visual.getChildMeshes(false).find((mesh): mesh is Mesh => mesh instanceof Mesh);
    if (childMesh) {
      return childMesh;
    }
    if (!this.fallbackBodyMesh) {
      this.fallbackBodyMesh = MeshBuilder.CreateBox("viz3d-body-fallback", { size: 1 }, this.scene);
    }
    return this.fallbackBodyMesh;
  }

  setStatus(status: SceneObjectStatus | undefined): void {
    this.config = { ...this.config, status };
    this.refreshColor();
  }

  setColor(hex: string): void {
    this.config = { ...this.config, color: hex };
    this.refreshColor();
  }

  setCenterOffset(offset: Vec3): void {
    this.config = { ...this.config, centerOffset: offset };
  }

  getTransform(): { position: Vec3; rotation: Vec3; scale: Vec3 } {
    return {
      position: {
        x: this.root.position.x,
        y: this.root.position.y,
        z: this.root.position.z,
      },
      rotation: {
        x: this.root.rotation.x,
        y: this.root.rotation.y,
        z: this.root.rotation.z,
      },
      scale: {
        x: this.root.scaling.x,
        y: this.root.scaling.y,
        z: this.root.scaling.z,
      },
    };
  }

  applyColors(colors: Viz3DColorMap): void {
    this.colors = colors;
    this.refreshColor();
  }

  setDimmed(dimmed: boolean): void {
    if (this.dimmed === dimmed) return;
    this.dimmed = dimmed;
    this.applyDimState();
  }

  /** 把当前 dimmed 状态写到 visual 与全部吊点；visual / 吊点重建后必须重放 */
  private applyDimState(): void {
    const visibility = this.dimmed ? DIMMED_VISIBILITY : 1;
    applyVisibility(this.visual, visibility);
    for (const hoist of this.hoistPoints.values()) {
      applyVisibility(hoist.root, visibility);
    }
  }

  dispose(): void {
    this.clearHoistPoints();
    this.fallbackBodyMesh?.dispose(false, true);
    this.fallbackBodyMesh = null;
    this.detachVisual();
    this.root.dispose();
  }

  private shouldRebuildVisual(next: SceneObjectConfig): boolean {
    const nextModelId = next.model?.id;
    const prevModelId = this.config.model?.id;
    if (nextModelId !== prevModelId) {
      return true;
    }

    const nextTemplate = nextModelId ? this.getModelTemplate?.(nextModelId) : undefined;
    const nextUsesModel = Boolean(nextTemplate);
    // 仅模型/预设形态切换时整树重建；shape/dimensions 由 applyConfig 就地换 mesh
    return nextUsesModel !== this.usesModelVisual;
  }

  private rebuildVisual(config: SceneObjectConfig): void {
    this.visualRevision += 1;
    this.detachVisual();
    const template = config.model?.id ? this.getModelTemplate?.(config.model.id) : undefined;
    if (template) {
      this.mountModelVisual(template, config.id, config.dimensions);
    } else {
      this.mountPresetVisual(config);
    }
    this.applyDimState();
  }

  private attachFrontMarker(body: Mesh): void {
    if (!this.presetMaterial) return;
    this.frontMarker = createFrontOrientationMarker(body);
    // 挂到 body 上，布局使用 body 局部包围盒，改尺寸/位移后仍正确
    this.frontMarker.parent = body;
  }

  private mountModelVisual(
    template: TransformNode,
    objectId: string,
    dimensions: { w: number; h: number; d: number },
  ): void {
    const clone = cloneHierarchy(template, this.scene, `viz3d-model-${objectId}`);
    const native = getTemplateNativeSizeM(template);
    if (native) {
      setTemplateNativeSizeM(clone, native);
    }
    setNodeMetadata(clone, "viz3dObjectId", objectId);
    clone.getChildMeshes().forEach((mesh) => {
      mesh.receiveShadows = false;
    });
    this.visual = clone;
    this.bodyMesh = null;
    this.frontMarker = null;
    this.usesModelVisual = true;
    this.presetMaterial = null;
    this.visual.parent = this.runtimePivot;
    this.applyModelDimensions(dimensions);
    this.refreshColor();
  }

  /** Uniform scale from width only — preserves model proportions (no stretch). */
  private applyModelDimensions(dimensions: { w: number; h: number; d: number }): void {
    if (!this.usesModelVisual) return;
    const native = getTemplateNativeSizeM(this.visual);
    if (!native) {
      this.visual.scaling.set(1, 1, 1);
      return;
    }
    const scale = uniformScaleForWidth(native, dimensions.w);
    this.visual.scaling.set(scale, scale, scale);
  }

  private mountPresetVisual(config: SceneObjectConfig): void {
    this.presetMaterial = createPbrStandardMaterial({
      scene: this.scene,
      color: hexStringToColor3(config.color),
    });
    const body = createPresetMesh(config.shape, config.dimensions, this.scene);
    body.receiveShadows = false;
    body.material = this.presetMaterial;
    setNodeMetadata(body, "viz3dObjectId", config.id);

    const group = new TransformNode(`viz3d-preset-${config.id}`, this.scene);
    body.parent = group;
    this.bodyMesh = body;
    this.visual = group;
    this.usesModelVisual = false;
    this.attachFrontMarker(body);
    this.visual.parent = this.runtimePivot;
    this.refreshColor();
  }

  private detachVisual(): void {
    if (this.usesModelVisual) {
      disposeNodeHierarchy(this.visual);
    } else {
      // 预设：销毁几何与朝向标记；material 单独 dispose（mesh.dispose 勿带材质）
      this.bodyMesh?.dispose(false, false);
      this.frontMarker?.dispose(false, true);
      this.presetMaterial?.dispose();
      if (this.visual.parent || this.visual.getChildren().length > 0) {
        this.visual.dispose(false, false);
      }
    }
    this.visual.parent = null;
    this.bodyMesh = null;
    this.frontMarker = null;
    this.presetMaterial = null;
  }

  private applyTransformFromConfig(config: SceneObjectConfig): void {
    this.visual.position.set(0, 0, 0);
    this.root.position.set(config.position.x, config.position.y, config.position.z);
    this.root.rotation.set(config.rotation.x, config.rotation.y, config.rotation.z);
    resetRuntimePivot(this.runtimePivot);
  }

  private forEachStandardMaterial(fn: (material: StandardMaterial) => void): void {
    if (this.presetMaterial) {
      fn(this.presetMaterial);
      return;
    }
    this.visual.getChildMeshes(false).forEach((mesh) => {
      const material = mesh.material;
      if (material && material.getClassName() === "StandardMaterial") {
        fn(material as StandardMaterial);
      }
    });
  }

  private refreshColor(): void {
    const status = this.config.status;
    const base =
      !status || status === "ready"
        ? hexStringToColor3(this.config.color)
        : hexToColor3(getStatusColor(status, this.colors));
    this.forEachStandardMaterial((material) => {
      applyMaterialBaseColor(material, base);
    });
  }

  private clearHoistPoints(): void {
    for (const visual of this.hoistPoints.values()) {
      visual.dispose();
    }
    this.hoistPoints.clear();
  }

  private syncHoistPoints(config: SceneObjectConfig): void {
    if (!config.showHoistPoints || !config.hoistAxes?.length) {
      this.clearHoistPoints();
      return;
    }

    const dimensions = config.dimensions;
    const scale = computeHoistPointScale(dimensions);
    const activeKeys = new Set<string>();

    for (const axis of config.hoistAxes) {
      activeKeys.add(axis.key);
      let visual = this.hoistPoints.get(axis.key);
      if (!visual) {
        visual = new HoistPointVisual(this.scene, scale);
        visual.root.parent = this.runtimePivot;
        this.hoistPoints.set(axis.key, visual);
      } else {
        visual.setScale(scale);
      }

      const pos = resolveHoistPointLocalPosition(dimensions, axis.mount);
      visual.root.position.set(pos.x, pos.y, pos.z);
      visual.setLabelSource(axis.index, axis.motorDisplayIndex ?? null);
      visual.setLabelMode(this.getHoistLabelMode());
      visual.setBindingIdentity(config.id, axis.key, axis.motorId);
      const selectedIds = config.selectedMotorIds;
      const selected =
        Boolean(axis.motorId) &&
        (selectedIds
          ? selectedIds.includes(axis.motorId!)
          : axis.motorId === config.selectedMotorId);
      visual.setBound(Boolean(axis.motorId), selected);
    }

    for (const [key, visual] of this.hoistPoints) {
      if (!activeKeys.has(key)) {
        visual.dispose();
        this.hoistPoints.delete(key);
      }
    }
    this.applyDimState();
  }

  refreshHoistLabels(mode: HoistLabelMode): void {
    for (const visual of this.hoistPoints.values()) {
      visual.setLabelMode(mode);
    }
  }

  getHoistPointRoot(motorId: string): TransformNode | undefined {
    for (const visual of this.hoistPoints.values()) {
      if (getNodeMetadata(visual.root, "viz3dMotorId") === motorId) {
        return visual.root;
      }
    }
    return undefined;
  }

  getHoistPointSelectionBoundsTarget(motorId: string): TransformNode | undefined {
    for (const visual of this.hoistPoints.values()) {
      if (getNodeMetadata(visual.root, "viz3dMotorId") === motorId) {
        return visual.selectionBoundsTarget;
      }
    }
    return undefined;
  }
}
