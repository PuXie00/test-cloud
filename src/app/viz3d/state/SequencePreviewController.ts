import type { Observer } from "@babylonjs/core/Misc/observable";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
import type { Scene } from "@babylonjs/core/scene";
import { hexToColor3 } from "../babylon/utils";
import type { SceneObjectHandle } from "../objects/SceneObjectRegistry";
import type { VirtualAxisValues, Viz3DColorMap } from "../types";
import { GoShadow } from "./GoShadow";
import { previewPathPoints } from "./preview-path-points";

export type SequencePreviewPath = { objectId: string; poses: VirtualAxisValues[] };
export type SequencePreviewGhost = { objectId: string; role: string; pose: VirtualAxisValues };
export type SequencePreviewEntries = { paths: SequencePreviewPath[]; ghosts: SequencePreviewGhost[] };

const targetsEqual = (a: VirtualAxisValues, b: VirtualAxisValues): boolean =>
  (a.v1 ?? 0) === (b.v1 ?? 0) && (a.v2 ?? 0) === (b.v2 ?? 0) && (a.v3 ?? 0) === (b.v3 ?? 0);

export class SequencePreviewController {
  private readonly paths = new Map<string, LinesMesh>();
  private readonly ghosts = new Map<string, GoShadow>();
  private readonly ghostPoses = new Map<string, VirtualAxisValues>();
  private observer: Observer<Scene> | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly getHandle: (id: string) => SceneObjectHandle | undefined,
    private readonly colors: Viz3DColorMap,
  ) {
    this.observer = scene.onBeforeRenderObservable.add(() => {
      for (const ghost of this.ghosts.values()) ghost.updateConnector();
    });
  }

  set(entries: SequencePreviewEntries): void {
    this.syncPaths(entries.paths);
    this.syncGhosts(entries.ghosts);
  }

  clear(): void {
    for (const path of this.paths.values()) path.dispose();
    this.paths.clear();
    for (const ghost of this.ghosts.values()) ghost.dispose();
    this.ghosts.clear();
    this.ghostPoses.clear();
  }

  dispose(): void {
    this.clear();
    this.observer?.remove();
    this.observer = null;
  }

  private syncPaths(paths: SequencePreviewPath[]): void {
    const nextIds = new Set(paths.map((path) => path.objectId));
    for (const id of [...this.paths.keys()]) {
      if (nextIds.has(id)) continue;
      this.paths.get(id)?.dispose();
      this.paths.delete(id);
    }
    for (const path of paths) {
      const handle = this.getHandle(path.objectId);
      if (!handle) continue;
      const points = previewPathPoints(handle.getConfig(), path.poses).map(
        (point) => new Vector3(point.x, point.y, point.z),
      );
      if (points.length < 2) continue;
      const name = `viz3d-seq-preview-path-${path.objectId}`;
      const existing = this.paths.get(path.objectId);
      if (existing && existing.getTotalVertices() === points.length) {
        MeshBuilder.CreateLines(name, { points, instance: existing }, this.scene);
        continue;
      }
      existing?.dispose();
      const line = MeshBuilder.CreateLines(name, { points, updatable: true }, this.scene);
      line.color = hexToColor3(this.colors.primary);
      line.isPickable = false;
      this.paths.set(path.objectId, line);
    }
  }

  private syncGhosts(ghosts: SequencePreviewGhost[]): void {
    const nextKeys = new Set(ghosts.map((ghost) => `${ghost.objectId}:${ghost.role}`));
    for (const key of [...this.ghosts.keys()]) {
      if (nextKeys.has(key)) continue;
      this.ghosts.get(key)?.dispose();
      this.ghosts.delete(key);
      this.ghostPoses.delete(key);
    }
    for (const ghost of ghosts) {
      const key = `${ghost.objectId}:${ghost.role}`;
      const existing = this.ghosts.get(key);
      const existingPose = this.ghostPoses.get(key);
      if (existing && existingPose && targetsEqual(existingPose, ghost.pose)) continue;
      existing?.dispose();
      const handle = this.getHandle(ghost.objectId);
      if (!handle) continue;
      this.ghosts.set(
        key,
        new GoShadow(handle, ghost.pose, this.scene, this.colors, this.colors.primary),
      );
      this.ghostPoses.set(key, ghost.pose);
    }
  }
}
