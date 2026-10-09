import { Scene } from "@babylonjs/core/scene";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type {
  Disposable,
  HoistTravelInput,
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
  /** 可见且已绑定电机的吊点（电机框选用） */
  listHoistPointSelectionTargets: () => { motorId: string; target: TransformNode }[];
  refreshHoistLabels: (mode: HoistLabelMode) => void;
  applyHoistTravel: (byMotorId: ReadonlyMap<string, HoistTravelInput>) => void;
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
        this.detachMountChildren(handle);
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
    this.syncMountParents();
  }

  /**
   * 挂载：子物体根节点挂到父物体 attachmentPivot 下，Babylon 层级自动叠加父物体实时姿态。
   * 父物体缺失或成环时按顶层处理；挂在其它节点（会话组合）下的顶层物体不动。
   */
  syncMountParents(): void {
    const pivots = new Set<TransformNode>([...this.handles.values()].map((h) => h.attachmentPivot));
    for (const handle of this.handles.values()) {
      const target = this.resolveMountParent(handle)?.attachmentPivot ?? null;
      const node = handle.object3d;
      if (node.parent === target) continue;
      if (target === null && node.parent !== null && !pivots.has(node.parent as TransformNode)) {
        continue;
      }
      node.parent = target;
    }
  }

  /** 有效的挂载父物体（沿父链检测成环） */
  getMountParent(id: string): SceneObjectHandle | undefined {
    const handle = this.handles.get(id);
    return handle ? this.resolveMountParent(handle) : undefined;
  }

  private resolveMountParent(handle: SceneObjectHandle): SceneObjectHandle | undefined {
    const parentIdOf = (h: SceneObjectHandle) => h.getConfig().parentId ?? null;
    const first = this.handles.get(parentIdOf(handle) ?? "");
    const seen = new Set([handle.id]);
    for (let current = first; current; current = this.handles.get(parentIdOf(current) ?? "")) {
      if (seen.has(current.id)) return undefined;
      seen.add(current.id);
    }
    return first;
  }

  /** 父物体销毁前先摘下子物体根节点，避免随父节点递归 dispose */
  private detachMountChildren(parent: SceneObjectHandle): void {
    for (const handle of this.handles.values()) {
      if (handle.object3d.parent === parent.attachmentPivot) handle.object3d.parent = null;
    }
  }

  get(id: string): SceneObjectHandle | undefined {
    return this.handles.get(id);
  }

  remove(id: string): void {
    const handle = this.handles.get(id);
    if (!handle) {
      return;
    }
    this.detachMountChildren(handle);
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
      handle.object3d.parent = null;
    });
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
