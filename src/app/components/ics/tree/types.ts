import type { HTMLAttributes, MouseEvent, KeyboardEvent, ReactNode } from "react";

export type DropPosition = "before" | "inside" | "after";

export type FlattenedTreeRow<T> = {
  node: T;
  id: string;
  depth: number;
  isLast: boolean;
  ancestorIsLast: boolean[];
  hasChildren: boolean;
  parentId: string | null;
};

export type TreeDropArgs<T> = {
  dragNode: T;
  dropNode: T;
  dropPosition: DropPosition;
};

/** 跨树 DnD 时由外层 DndContext 注入，用于 drop 高亮 */
export type TreeDropHighlight = {
  overId: string;
  position: DropPosition;
} | null;

export type TreeViewProps<T> = {
  nodes: T[];
  getNodeId: (node: T) => string;
  getChildren?: (node: T) => T[] | undefined;

  expandedIds: Set<string>;
  onExpandedChange: (ids: Set<string>) => void;

  selectedIds: Set<string>;
  focusedId?: string | null;
  onSelect: (node: T, event: MouseEvent | KeyboardEvent) => void;
  /** Delete / Backspace on a focused row */
  onDelete?: (node: T) => void;

  renderLabel: (node: T) => ReactNode;
  renderIcon?: (node: T) => ReactNode;
  renderExtra?: (node: T) => ReactNode;
  renderContextMenu?: (node: T) => ReactNode;
  /** 合并到行根节点（如 HTML5 拖放到 3D） */
  getRowProps?: (node: T) => HTMLAttributes<HTMLDivElement> | undefined;

  /** DnD id 前缀，跨树时必填以避免冲突，如 "pending-co" / "plc-tree" */
  dndIdPrefix?: string;
  /** wrap=TreeView 自建 DndContext；none=使用外层 Provider（跨树场景） */
  dndContext?: "wrap" | "none";
  draggable?: boolean | ((node: T) => boolean);
  droppable?: boolean | ((node: T) => boolean);
  canDrop?: (args: TreeDropArgs<T>) => boolean;
  onDrop?: (args: TreeDropArgs<T>) => void;
  /** 外层 DndContext 管理的 drop 高亮（跨树场景） */
  dropHighlight?: TreeDropHighlight;

  indent?: number;
  rowHeight?: number;
  className?: string;
  "aria-label"?: string;
};

/** @dnd-kit data payload */
export type TreeDndDragData<T> = {
  type: "tree-node";
  node: T;
  nodeId: string;
  prefix: string;
};

export type TreeDndDropData<T> = TreeDndDragData<T>;
