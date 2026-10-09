import type { ControlledObject } from "../components/right-sidebar/config-wizard/config-wizard-types";

export const OBJECT_PASTE_OFFSET_MM = { x: 1000, y: 0, z: 0 } as const;

export type Vec3Mm = { x: number; y: number; z: number };

type ClipboardState = {
  snapshots: ControlledObject[];
  pasteCount: number;
};

let state: ClipboardState = { snapshots: [], pasteCount: 0 };

export const clearObjectClipboard = (): void => {
  state = { snapshots: [], pasteCount: 0 };
};

export const setObjectClipboard = (objects: readonly ControlledObject[]): void => {
  state = {
    snapshots: structuredClone(objects) as ControlledObject[],
    pasteCount: 0,
  };
};

export const hasObjectClipboard = (): boolean => state.snapshots.length > 0;

export const getObjectClipboardSnapshots = (): ControlledObject[] => state.snapshots;

export const getObjectClipboardPasteCount = (): number => state.pasteCount;

export const bumpObjectClipboardPasteCount = (): number => {
  state = { ...state, pasteCount: state.pasteCount + 1 };
  return state.pasteCount;
};

/** 父物体也在剪贴板里的子物体：position 是相对父物体的局部值，粘贴时不平移 */
const isCopiedChild = (
  snapshot: ControlledObject,
  copiedIds: ReadonlySet<number>,
): boolean => snapshot.parentId != null && copiedIds.has(snapshot.parentId);

/** 剪贴板根物体（世界坐标）的包围中心 */
export const computeSourceAnchorMm = (snapshots: readonly ControlledObject[]): Vec3Mm => {
  const copiedIds = new Set(snapshots.map((snapshot) => snapshot.id));
  const objects = snapshots.filter((snapshot) => !isCopiedChild(snapshot, copiedIds));
  if (objects.length === 0) return { x: 0, y: 0, z: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const object of objects) {
    minX = Math.min(minX, object.position.x);
    minY = Math.min(minY, object.position.y);
    minZ = Math.min(minZ, object.position.z);
    maxX = Math.max(maxX, object.position.x);
    maxY = Math.max(maxY, object.position.y);
    maxZ = Math.max(maxZ, object.position.z);
  }
  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    z: (minZ + maxZ) / 2,
  };
};

export const computePastePositionsMm = (
  snapshots: readonly ControlledObject[],
  targetAnchorXZ: Pick<Vec3Mm, "x" | "z"> | null,
  pasteCount: number,
): Vec3Mm[] => {
  const anchor = computeSourceAnchorMm(snapshots);
  const delta =
    targetAnchorXZ === null
      ? {
          x: OBJECT_PASTE_OFFSET_MM.x * pasteCount,
          y: OBJECT_PASTE_OFFSET_MM.y * pasteCount,
          z: OBJECT_PASTE_OFFSET_MM.z * pasteCount,
        }
      : {
          x: targetAnchorXZ.x - anchor.x,
          y: 0,
          z: targetAnchorXZ.z - anchor.z,
        };
  const copiedIds = new Set(snapshots.map((snapshot) => snapshot.id));
  return snapshots.map((snapshot) =>
    isCopiedChild(snapshot, copiedIds)
      ? { ...snapshot.position }
      : {
          x: snapshot.position.x + delta.x,
          y: snapshot.position.y + delta.y,
          z: snapshot.position.z + delta.z,
        },
  );
};

const COPY_SUFFIX_RE = /\s+副本(?:\s+\d+)?$/;

export const allocateCopyName = (
  sourceName: string,
  existingNames: Iterable<string>,
): string => {
  const names = new Set(existingNames);
  const base = sourceName.replace(COPY_SUFFIX_RE, "");
  let n = 1;
  for (;;) {
    const candidate = n === 1 ? `${base} 副本` : `${base} 副本 ${n}`;
    if (!names.has(candidate)) return candidate;
    n += 1;
  }
};
