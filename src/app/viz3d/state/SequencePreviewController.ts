import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateGreasedLine } from "@babylonjs/core/Meshes/Builders/greasedLineBuilder";
import { GreasedLineMesh } from "@babylonjs/core/Meshes/GreasedLine/greasedLineMesh";
import { GreasedLineMeshMaterialType } from "@babylonjs/core/Materials/GreasedLine/greasedLineMaterialInterfaces";
import { hexToColor3 } from "../babylon/utils";
import type { SceneObjectHandle } from "../objects/SceneObjectRegistry";
import type { VirtualAxisValues, Viz3DColorMap } from "../types";
import { attachmentFrameMatrix, previewPathPoints, type ParentFrameAt } from "./preview-path-points";

export type SequencePreviewPath = {
  objectId: string;
  poses: VirtualAxisValues[];
  /** 同一物体多条路径时区分；缺省用 objectId */
  key?: string;
  /** transition：就近/回起点的过渡段，与编程轨迹分色 */
  tone?: "program" | "transition";
};
export type SequencePreviewEntries = { paths: SequencePreviewPath[] };

/** Screen-space px. Thicker and opaque vs CreateLines (1px, looks washed-out). */
export const PREVIEW_PATH_LINE_WIDTH = 7;

export class SequencePreviewController {
  private readonly paths = new Map<string, GreasedLineMesh>();

  constructor(
    private readonly scene: Scene,
    private readonly getHandle: (id: string) => SceneObjectHandle | undefined,
    private readonly colors: Viz3DColorMap,
    private readonly getMountParent: (id: string) => SceneObjectHandle | undefined = () => undefined,
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
    const keyOf = (path: SequencePreviewPath) => path.key ?? path.objectId;
    const nextIds = new Set(paths.map(keyOf));
    for (const id of [...this.paths.keys()]) {
      if (nextIds.has(id)) continue;
      this.paths.get(id)?.dispose(false, true);
      this.paths.delete(id);
    }
    const posesByTone = new Map<string, Map<string, VirtualAxisValues[]>>();
    for (const path of paths) {
      const tone = path.tone ?? "program";
      const family = posesByTone.get(tone) ?? new Map<string, VirtualAxisValues[]>();
      family.set(path.objectId, path.poses);
      posesByTone.set(tone, family);
    }
    for (const path of paths) {
      const handle = this.getHandle(path.objectId);
      if (!handle) continue;
      const family = posesByTone.get(path.tone ?? "program")!;
      const points = previewPathPoints(
        handle.getConfig(),
        path.poses,
        this.parentFrames(path.objectId, family, path.poses.length),
      ).map((point) => new Vector3(point.x, point.y, point.z));
      if (points.length < 2) continue;
      const key = keyOf(path);
      const name = `viz3d-seq-preview-path-${key}`;
      const existing = this.paths.get(key);
      if (existing) {
        existing.setPoints([points]);
        continue;
      }
      const tone = path.tone === "transition" ? this.colors.secondary : this.colors.primary;
      const line = CreateGreasedLine(
        name,
        { points: [points], updatable: true },
        {
          width: PREVIEW_PATH_LINE_WIDTH,
          sizeAttenuation: true,
          color: hexToColor3(tone),
          materialType: GreasedLineMeshMaterialType.MATERIAL_TYPE_SIMPLE,
          createAndAssignMaterial: true,
        },
        this.scene,
      ) as GreasedLineMesh;
      line.isPickable = false;
      line.renderingGroupId = 1;
      this.paths.set(key, line);
    }
  }

  /**
   * 挂载子物体轨迹叠加父物体姿态：父物体在同一组采样里（同序列、同时刻采样）
   * 时逐点用父物体的预览姿态，否则用父物体当前姿态。
   */
  private parentFrames(
    objectId: string,
    family: ReadonlyMap<string, VirtualAxisValues[]>,
    count: number,
    seen: ReadonlySet<string> = new Set([objectId]),
  ): ParentFrameAt {
    const parent = this.getMountParent(objectId);
    if (!parent || seen.has(parent.id)) return () => null;
    const parentPoses = family.get(parent.id);
    if (!parentPoses || parentPoses.length !== count) {
      const live = parent.attachmentPivot.computeWorldMatrix(true).clone();
      return () => live;
    }
    const grandparent = this.parentFrames(parent.id, family, count, new Set([...seen, parent.id]));
    const config = parent.getConfig();
    return (index) => {
      const frame = attachmentFrameMatrix(config, parentPoses[index]!);
      const above = grandparent(index);
      return above ? frame.multiply(above) : frame;
    };
  }
}
