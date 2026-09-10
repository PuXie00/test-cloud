import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import type { SceneObjectHandle } from "../objects/SceneObjectRegistry";
import type { VirtualAxisValues, Viz3DColorMap } from "../types";
import { GoShadow } from "./GoShadow";

export type GoShadowEntry = { objectId: string; target: VirtualAxisValues };

const targetsEqual = (a: VirtualAxisValues, b: VirtualAxisValues): boolean =>
  (a.v1 ?? 0) === (b.v1 ?? 0) && (a.v2 ?? 0) === (b.v2 ?? 0) && (a.v3 ?? 0) === (b.v3 ?? 0);

export class GoShadowController {
  private readonly shadows = new Map<string, GoShadow>();
  private readonly targets = new Map<string, VirtualAxisValues>();
  private observer: Observer<Scene> | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly getHandle: (id: string) => SceneObjectHandle | undefined,
    private readonly colors: Viz3DColorMap,
  ) {
    this.observer = scene.onBeforeRenderObservable.add(() => {
      for (const shadow of this.shadows.values()) shadow.updateConnector();
    });
  }

  set(entries: GoShadowEntry[]): void {
    const nextIds = new Set(entries.map((entry) => entry.objectId));
    for (const id of [...this.shadows.keys()]) {
      if (nextIds.has(id)) continue;
      this.shadows.get(id)?.dispose();
      this.shadows.delete(id);
      this.targets.delete(id);
    }
    for (const entry of entries) {
      const existing = this.shadows.get(entry.objectId);
      const existingTarget = this.targets.get(entry.objectId);
      if (existing && existingTarget && targetsEqual(existingTarget, entry.target)) continue;
      existing?.dispose();
      const handle = this.getHandle(entry.objectId);
      if (!handle) continue;
      this.shadows.set(entry.objectId, new GoShadow(handle, entry.target, this.scene, this.colors));
      this.targets.set(entry.objectId, entry.target);
    }
  }

  clear(): void {
    for (const shadow of this.shadows.values()) shadow.dispose();
    this.shadows.clear();
    this.targets.clear();
  }

  dispose(): void {
    this.clear();
    this.observer?.remove();
    this.observer = null;
  }
}
