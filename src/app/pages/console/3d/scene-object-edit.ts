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
