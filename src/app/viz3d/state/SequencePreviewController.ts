import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateGreasedLine } from "@babylonjs/core/Meshes/Builders/greasedLineBuilder";
import { GreasedLineMesh } from "@babylonjs/core/Meshes/GreasedLine/greasedLineMesh";
import { GreasedLineMeshMaterialType } from "@babylonjs/core/Materials/GreasedLine/greasedLineMaterialInterfaces";
import { hexToColor3 } from "../babylon/utils";
import type { SceneObjectHandle } from "../objects/SceneObjectRegistry";
import type { VirtualAxisValues, Viz3DColorMap } from "../types";
import { previewPathPoints } from "./preview-path-points";

export type SequencePreviewPath = { objectId: string; poses: VirtualAxisValues[] };
export type SequencePreviewEntries = { paths: SequencePreviewPath[] };

/** Screen-space px. Thicker and opaque vs CreateLines (1px, looks washed-out). */
export const PREVIEW_PATH_LINE_WIDTH = 7;

export class SequencePreviewController {
  private readonly paths = new Map<string, GreasedLineMesh>();

  constructor(
    private readonly scene: Scene,
    private readonly getHandle: (id: string) => SceneObjectHandle | undefined,
    private readonly colors: Viz3DColorMap,
  ) {}

  set(entries: SequencePreviewEntries): void {
    this.syncPaths(entries.paths);
  }

  clear(): void {
    for (const path of this.paths.values()) path.dispose(false, true);
    this.paths.clear();
  }

  dispose(): void {
    this.clear();
  }

  private syncPaths(paths: SequencePreviewPath[]): void {
    const nextIds = new Set(paths.map((path) => path.objectId));
    for (const id of [...this.paths.keys()]) {
      if (nextIds.has(id)) continue;
      this.paths.get(id)?.dispose(false, true);
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
      if (existing) {
        existing.setPoints([points]);
        continue;
      }
      const line = CreateGreasedLine(
        name,
        { points: [points], updatable: true },
        {
          width: PREVIEW_PATH_LINE_WIDTH,
          sizeAttenuation: true,
          color: hexToColor3(this.colors.primary),
          materialType: GreasedLineMeshMaterialType.MATERIAL_TYPE_SIMPLE,
          createAndAssignMaterial: true,
        },
        this.scene,
      ) as GreasedLineMesh;
      line.isPickable = false;
      line.renderingGroupId = 1;
      this.paths.set(path.objectId, line);
    }
  }
}
