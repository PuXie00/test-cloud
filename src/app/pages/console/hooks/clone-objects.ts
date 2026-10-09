import { poseRelativeToParent } from "@/app/project/object-mount";
import type { ControlledObject } from "../components/right-sidebar/config-wizard/config-wizard-types";
import { allocateCopyName, type Vec3Mm } from "../3d/object-clipboard";
import { withMountPose } from "./mount-objects";

/**
 * 剪贴板里，父物体也被复制的子物体保持局部坐标、改挂到新父物体；
 * 其余物体（复制根）的 position / rotation 是世界值，原父物体仍在时换算回局部继续挂在它上面。
 */
export const cloneObjectsAt = (
  snapshots: readonly ControlledObject[],
  positions: readonly Vec3Mm[],
  existingObjects: readonly ControlledObject[],
  createId: () => number,
): ControlledObject[] => {
  const usedNames = new Set(existingObjects.map((o) => o.name));
  const newIdByOld = new Map(snapshots.map((snap) => [snap.id, createId()]));
  const created: ControlledObject[] = [];
  snapshots.forEach((snap, i) => {
    const position = positions[i] ?? snap.position;
    let copy = structuredClone(snap) as ControlledObject;
    copy.id = newIdByOld.get(snap.id)!;
    copy.name = allocateCopyName(snap.name, usedNames);
    usedNames.add(copy.name);
    copy.position = { ...position };
    const copiedParentId = snap.parentId != null ? newIdByOld.get(snap.parentId) : undefined;
    if (copiedParentId !== undefined) {
      copy.parentId = copiedParentId;
    } else {
      const parentId =
        snap.parentId != null && existingObjects.some((object) => object.id === snap.parentId)
          ? snap.parentId
          : null;
      copy = withMountPose(
        copy,
        parentId,
        poseRelativeToParent(existingObjects, parentId, {
          position: copy.position,
          rotation: copy.rotation,
        }),
      );
    }
    created.push(copy);
  });
  return created;
};
