import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
import { hexToColor3 } from "../babylon/utils";
import type { SceneObjectHandle } from "../objects/SceneObjectRegistry";
import type { VirtualAxisValues, Viz3DColorMap } from "../types";
import { previewPathPoints } from "./preview-path-points";

export type SequencePreviewPath = { objectId: string; poses: VirtualAxisValues[] };
export type SequencePreviewEntries = { paths: SequencePreviewPath[] };

export class SequencePreviewController {
  private readonly paths = new Map<string, LinesMesh>();

  constructor(
    private readonly scene: Scene,
    private readonly getHandle: (id: string) => SceneObjectHandle | undefined,
    private readonly colors: Viz3DColorMap,
  ) {}

  set(entries: SequencePreviewEntries): void {
    this.syncPaths(entries.paths);
  }

  clear(): void {
    for (const path of this.paths.values()) path.dispose();
    this.paths.clear();
  }

  dispose(): void {
    this.clear();
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
}
