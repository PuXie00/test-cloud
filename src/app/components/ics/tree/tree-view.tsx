import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuTrigger,
} from "@/app/components/ui/context-menu";
import { cn } from "@/app/components/ui/utils";
import { TreeRow } from "./tree-row";
import { flattenVisibleNodes } from "./tree-utils";
import type { DndRowProps } from "./tree-view-dnd";
import { TreeDndShell } from "./tree-view-dnd";
import type { FlattenedTreeRow, TreeViewProps } from "./types";

export const TreeView = <T,>({
  nodes,
  getNodeId,
  getChildren,
  expandedIds,
  onExpandedChange,
  selectedIds,
  focusedId,
  onSelect,
  onDelete,
  renderLabel,
  renderIcon,
  renderExtra,
  renderContextMenu,
  getRowProps,
  dndIdPrefix = "tree",
  dndContext = "wrap",
  draggable,
  droppable,
  canDrop,
  onDrop,
  dropHighlight,
  indent = 20,
  rowHeight = 36,
  className,
  "aria-label": ariaLabel,
}: TreeViewProps<T>) => {
  const rows = useMemo(
    () => flattenVisibleNodes(nodes, getNodeId, getChildren, expandedIds),
    [nodes, getNodeId, getChildren, expandedIds],
  );

  const [activeRowId, setActiveRowId] = useState<string | null>(
    rows[0]?.id ?? null,
  );

  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const handleToggleExpand = useCallback(
    (row: FlattenedTreeRow<T>) => {
      const next = new Set(expandedIds);
      if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
      onExpandedChange(next);
    },
    [expandedIds, onExpandedChange],
  );

  const focusRow = useCallback((id: string) => {
    setActiveRowId(id);
    rowRefs.current.get(id)?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (row: FlattenedTreeRow<T>, event: React.KeyboardEvent) => {
      const idx = rows.findIndex((r) => r.id === row.id);
      if (idx < 0) return;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        const next = rows[idx + 1];
        if (next) focusRow(next.id);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        const prev = rows[idx - 1];
        if (prev) focusRow(prev.id);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        if (row.hasChildren) {
          if (!expandedIds.has(row.id)) handleToggleExpand(row);
          else {
            const child = rows[idx + 1];
            if (child && child.depth > row.depth) focusRow(child.id);
          }
        }
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (row.hasChildren && expandedIds.has(row.id)) {
          handleToggleExpand(row);
        } else if (row.parentId) {
          focusRow(row.parentId);
        }
      } else if (
        onDelete &&
        (event.key === "Delete" || event.key === "Backspace") &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        event.preventDefault();
        onDelete(row.node);
      }
    },
    [rows, expandedIds, focusRow, handleToggleExpand, onDelete],
  );

  const renderRow = (
    row: FlattenedTreeRow<T>,
    dndProps?: DndRowProps,
  ): ReactNode => {
    const selected =
      selectedIds.has(row.id) || (focusedId != null && focusedId === row.id);
    const expanded = expandedIds.has(row.id);
    const isActive = activeRowId === row.id;

    const rowEl = (
      <TreeRow
        depth={row.depth}
        indent={indent}
        label={renderLabel(row.node)}
        icon={renderIcon?.(row.node)}
        extra={renderExtra?.(row.node)}
        hasChildren={row.hasChildren}
        expanded={expanded}
        selected={selected}
        onToggleExpand={() => handleToggleExpand(row)}
        onSelect={(event) => onSelect(row.node, event)}
        showDragHandle={dndProps?.showDragHandle}
        dragHandleProps={dndProps?.dragHandleProps}
        rowDragListeners={dndProps?.rowDragListeners}
        dropIndicator={dndProps?.dropIndicator}
        rowRef={(el) => {
          if (el) rowRefs.current.set(row.id, el);
          else rowRefs.current.delete(row.id);
          dndProps?.setRowElement(el);
        }}
        rowProps={{
          tabIndex: isActive ? 0 : -1,
          onKeyDown: (event) => handleKeyDown(row, event),
          onFocus: () => setActiveRowId(row.id),
          ...getRowProps?.(row.node),
        }}
      />
    );

    if (!renderContextMenu) {
      return <div key={row.id}>{rowEl}</div>;
    }

    const menu = renderContextMenu(row.node);
    if (!menu) {
      return <div key={row.id}>{rowEl}</div>;
    }

    return (
      <ContextMenu key={row.id}>
        {/* asChild 需要可挂 ref 的 DOM 节点；TreeRow 不 forwardRef，故包一层 */}
        <ContextMenuTrigger asChild>
          <div>{rowEl}</div>
        </ContextMenuTrigger>
        {menu}
      </ContextMenu>
    );
  };

  return (
    <div
      role="tree"
      aria-label={ariaLabel}
      className={cn("flex flex-col py-1", className)}
    >
      <TreeDndShell
        dndIdPrefix={dndIdPrefix}
        dndContext={dndContext}
        draggable={draggable}
        droppable={droppable}
        canDrop={canDrop}
        onDrop={onDrop}
        dropHighlight={dropHighlight}
        renderIcon={renderIcon}
        renderLabel={renderLabel}
        rowHeight={rowHeight}
        rows={rows}
        renderRow={renderRow}
      />
    </div>
  );
};
