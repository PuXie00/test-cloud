import type { ResolvedPosePoint } from "@/app/project/action-sequence/resolve-sequence";

export const visibleGeneratedAtMs = (
  poses: readonly ResolvedPosePoint[],
  objectId: number,
  blockId: string,
): number[] =>
  poses
    .filter(
      (point) =>
        point.visible &&
        point.objectId === objectId &&
        point.sourceBlockId === blockId &&
        point.sourceKind === "dynamic-preset",
    )
    .map((point) => point.atMs);
