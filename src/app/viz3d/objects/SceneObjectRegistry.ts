import { Scene } from "@babylonjs/core/scene";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type {
  Disposable,
  RuntimeTransform,
  SceneObjectConfig,
  SceneObjectStatus,
  Vec3,
  Viz3DColorMap,
} from "../types";
import type { WorldBounds } from "../babylon/utils";
import type { HoistLabelMode } from "../hoist-label-mode";

export type SceneObjectHandle = {
  id: string;
  object3d: TransformNode;
  attachmentPivot: TransformNode;
  selectionBoundsTarget: TransformNode;
  getConfig: () => SceneObjectConfig;
  getTransformCenterWorldPosition: () => Vec3;
  getVisualRoot: () => TransformNode;
  getVisualRevision: () => number;
  applyConfig: (config: SceneObjectConfig) => void;
  applyRuntimeTransform: (transform: RuntimeTransform) => void;
  getWorldBounds: () => WorldBounds;
  getBodyMesh: () => Mesh;
  setStatus: (status: SceneObjectStatus | undefined) => void;
  setColor: (hex: string) => void;
  setCenterOffset: (offset: Vec3) => void;
  getTransform: () => { position: Vec3; rotation: Vec3; scale: Vec3 };
  applyColors: (colors: Viz3DColorMap) => void;
  setDimmed: (dimmed: boolean) => void;
  getHoistPointRoot: (motorId: string) => TransformNode | undefined;
  getHoistPointSelectionBoundsTarget: (motorId: string) => TransformNode | undefined;
  refreshHoistLabels: (mode: HoistLabelMode) => void;
  dispose: () => void;
};

export type ObjectContainer = Scene | {
  add: (object: TransformNode) => void;
  remove: (object: TransformNode) => void;
};

export type SceneObjectFactory = (config: SceneObjectConfig) => SceneObjectHandle;

const addToContainer = (container: ObjectContainer, object: TransformNode): void => {
  if (container instanceof Scene) {
    // Babylon 9: Scene 不再是 Node；构造时已挂入场景，根节点 parent 保持 null
    object.parent = null;
    return;
  }
  container.add(object);
};

const removeFromContainer = (container: ObjectContainer, object: TransformNode): void => {
  if (container instanceof Scene) {
    object.parent = null;
    return;
  }
  container.remove(object);
};

export class SceneObjectRegistry implements Disposable {
  private handles = new Map<string, SceneObjectHandle>();

  constructor(
    private readonly container: ObjectContainer,
    private readonly factory: SceneObjectFactory,
  ) {}

  sync(configs: SceneObjectConfig[]): void {
    const nextIds = new Set(configs.map((c) => c.id));

    this.handles.forEach((handle, id) => {
      if (!nextIds.has(id)) {
        removeFromContainer(this.container, handle.object3d);
        handle.dispose();
        this.handles.delete(id);
      }
    });

    configs.forEach((config) => {
      const existing = this.handles.get(config.id);
      if (existing) {
        existing.applyConfig(config);
        if (config.status !== undefined) {
          existing.setStatus(config.status);
        }
        return;
      }
      const handle = this.factory(config);
      this.handles.set(config.id, handle);
      addToContainer(this.container, handle.object3d);
    });
  }

  get(id: string): SceneObjectHandle | undefined {
    return this.handles.get(id);
  }

  remove(id: string): void {
    const handle = this.handles.get(id);
    if (!handle) {
      return;
    }
    removeFromContainer(this.container, handle.object3d);
    handle.dispose();
    this.handles.delete(id);
  }

  list(): SceneObjectHandle[] {
    return [...this.handles.values()];
  }

  applyColors(colors: Viz3DColorMap): void {
    this.handles.forEach((handle) => handle.applyColors(colors));
  }

  clear(): void {
    this.handles.forEach((handle) => {
      removeFromContainer(this.container, handle.object3d);
      handle.dispose();
    });
    this.handles.clear();
  }

  dispose(): void {
    this.clear();
  }
}
