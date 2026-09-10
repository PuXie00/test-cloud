import type { ControlledObject } from "../components/right-sidebar/config-wizard/config-wizard-types";
import { allocateCopyName, type Vec3Mm } from "../3d/object-clipboard";

export const cloneObjectsAt = (
  snapshots: readonly ControlledObject[],
  positions: readonly Vec3Mm[],
  existingObjects: readonly ControlledObject[],
  createId: () => number,
): ControlledObject[] => {
  const usedNames = new Set(existingObjects.map((o) => o.name));
  const created: ControlledObject[] = [];
  snapshots.forEach((snap, i) => {
    const position = positions[i] ?? snap.position;
    const copy = structuredClone(snap) as ControlledObject;
    copy.id = createId();
    copy.name = allocateCopyName(snap.name, usedNames);
    usedNames.add(copy.name);
    copy.position = { ...position };
    created.push(copy);
  });
  return created;
};
