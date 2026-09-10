import type { FlattenedTreeRow } from "./types";

export const flattenVisibleNodes = <T>(
  nodes: T[],
  getNodeId: (node: T) => string,
  getChildren: ((node: T) => T[] | undefined) | undefined,
  expandedIds: Set<string>,
  parentId: string | null = null,
  depth = 0,
  ancestorIsLast: boolean[] = [],
): FlattenedTreeRow<T>[] => {
  const rows: FlattenedTreeRow<T>[] = [];

  nodes.forEach((node, index) => {
    const id = getNodeId(node);
    const children = getChildren?.(node) ?? [];
    const hasChildren = children.length > 0;
    const isLast = index === nodes.length - 1;

    rows.push({
      node,
      id,
      depth,
      isLast,
      ancestorIsLast: [...ancestorIsLast],
      hasChildren,
      parentId,
    });

    if (hasChildren && expandedIds.has(id)) {
      rows.push(
        ...flattenVisibleNodes(
          children,
          getNodeId,
          getChildren,
          expandedIds,
          id,
          depth + 1,
          [...ancestorIsLast, isLast],
        ),
      );
    }
  });

  return rows;
};

export const resolveDropPosition = (
  pointerY: number,
  rectTop: number,
  rowHeight: number,
): "before" | "inside" | "after" => {
  const relative = pointerY - rectTop;
  const third = rowHeight / 3;
  if (relative < third) return "before";
  if (relative > rowHeight - third) return "after";
  return "inside";
};

export const isNodeDraggable = <T>(
  node: T,
  draggable: boolean | ((node: T) => boolean) | undefined,
): boolean => {
  if (draggable === undefined) return false;
  return typeof draggable === "function" ? draggable(node) : draggable;
};

export const isNodeDroppable = <T>(
  node: T,
  droppable: boolean | ((node: T) => boolean) | undefined,
): boolean => {
  if (droppable === undefined) return false;
  return typeof droppable === "function" ? droppable(node) : droppable;
};

export const toDndId = (prefix: string, nodeId: string) => `${prefix}:${nodeId}`;
