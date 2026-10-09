import {
  mountDescendantIds,
  objectWorldPose,
  orderByMountTree,
} from "@/app/project/object-mount";
import type { ControlledObject } from "../components/right-sidebar/config-wizard/config-wizard-types";
import type { DeleteTarget } from "../components/right-sidebar/project-structure-tree-data";
import {
  bumpObjectClipboardPasteCount,
  computePastePositionsMm,
  getObjectClipboardSnapshots,
  hasObjectClipboard,
  type Vec3Mm,
} from "./object-clipboard";

export const pickObjectsInSelectionOrder = (
  objects: readonly ControlledObject[],
  ids: readonly number[],
): ControlledObject[] => {
  const byId = new Map(objects.map((object) => [object.id, object]));
  const ordered: ControlledObject[] = [];
  for (const id of ids) {
    const object = byId.get(id);
    if (object) ordered.push(object);
  }
  return ordered;
};

/**
 * 复制选中物体及其全部子物体（父物体在前）。父物体不在剪贴板里的物体
 * 换成世界坐标，保留 parentId 以便粘贴时挂回原父物体。
 */
export const buildObjectClipboardSnapshots = (
  objects: readonly ControlledObject[],
  ids: readonly number[],
): ControlledObject[] => {
  const selected = pickObjectsInSelectionOrder(objects, ids);
  const selectedIds = new Set(selected.map((object) => object.id));
  const descendants = mountDescendantIds(objects, selectedIds);
  const descendantObjects = orderByMountTree(objects)
    .map(({ object }) => object)
    .filter((object) => descendants.has(object.id));
  const copied = [...selected, ...descendantObjects];
  const copiedIds = new Set(copied.map((object) => object.id));
  return copied.map((object) => {
    if (object.parentId == null || copiedIds.has(object.parentId)) return object;
    const world = objectWorldPose(objects, object.id);
    return world ? { ...object, position: world.position, rotation: world.rotation } : object;
  });
};

export const buildObjectDeleteTarget = (ids: readonly number[]): DeleteTarget | null => {
  if (ids.length === 0) return null;
  if (ids.length > 1) return { kind: "objects", objectIds: [...ids] };
  return { kind: "object", objectId: ids[0]! };
};

export type PasteMode = "menu" | "shortcut";

export type ResolvePastePositionsResult = {
  snapshots: ControlledObject[];
  positions: Vec3Mm[];
  bumped: boolean;
};

export const resolvePastePositionsForMode = (
  mode: PasteMode,
  getPasteAnchorXZ: () => Pick<Vec3Mm, "x" | "z"> | null,
): ResolvePastePositionsResult | null => {
  if (!hasObjectClipboard()) return null;
  const snapshots = getObjectClipboardSnapshots();

  if (mode === "shortcut") {
    const count = bumpObjectClipboardPasteCount();
    return {
      snapshots,
      positions: computePastePositionsMm(snapshots, null, count),
      bumped: true,
    };
  }

  const anchor = getPasteAnchorXZ();
  if (anchor == null) {
    const count = bumpObjectClipboardPasteCount();
    return {
      snapshots,
      positions: computePastePositionsMm(snapshots, null, count),
      bumped: true,
    };
  }

  return {
    snapshots,
    positions: computePastePositionsMm(snapshots, anchor, 0),
    bumped: false,
  };
};
