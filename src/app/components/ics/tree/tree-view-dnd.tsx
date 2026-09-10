import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/app/components/ui/utils";
import {
  isNodeDraggable,
  isNodeDroppable,
  resolveDropPosition,
  toDndId,
} from "./tree-utils";
import type {
  DropPosition,
  FlattenedTreeRow,
  TreeDndDragData,
  TreeDndDropData,
  TreeDropArgs,
  TreeDropHighlight,
  TreeViewProps,
} from "./types";

type DropState<T> = {
  overId: string;
  position: DropPosition;
  dropNode: T;
} | null;

export const DropIndicator = ({ position }: { position: DropPosition }) => {
  if (position === "inside") {
    return (
      <span className="pointer-events-none absolute inset-0 rounded-sm bg-primary/10 ring-2 ring-inset ring-primary" />
    );
  }
  return (
    <span
      className={cn(
        "pointer-events-none absolute right-0 left-0 h-0.5 bg-primary",
        position === "before" ? "top-0" : "bottom-0",
      )}
    />
  );
};

export type DndRowProps = {
  dragHandleProps: React.HTMLAttributes<HTMLButtonElement>;
  rowDragListeners: React.HTMLAttributes<HTMLDivElement>;
  showDragHandle: boolean;
  dropIndicator: ReactNode;
  setRowElement: (el: HTMLDivElement | null) => void;
};

type DndTreeRowProps<T> = {
  row: FlattenedTreeRow<T>;
  prefix: string;
  rowHeight: number;
  draggable: boolean;
  droppable: boolean;
  dropHighlight: TreeDropHighlight;
  children: (args: DndRowProps) => ReactNode;
};

const DndTreeRow = <T,>({
  row,
  prefix,
  rowHeight,
  draggable,
  droppable,
  dropHighlight,
  children,
}: DndTreeRowProps<T>) => {
  const dndId = toDndId(prefix, row.id);

  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: dndId,
    disabled: !draggable,
    data: {
      type: "tree-node",
      node: row.node,
      nodeId: row.id,
      prefix,
    } satisfies TreeDndDragData<T>,
  });

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: dndId,
    disabled: !droppable,
    data: {
      type: "tree-node",
      node: row.node,
      nodeId: row.id,
      prefix,
    } satisfies TreeDndDropData<T>,
  });

  const setRowElement = useCallback(
    (el: HTMLDivElement | null) => {
      setDropRef(el);
    },
    [setDropRef],
  );

  const showDrop =
    isOver &&
    dropHighlight &&
    dropHighlight.overId === dndId &&
    !isDragging;

  const dragListeners = draggable ? listeners : undefined;

  return (
    <div
      ref={setDragRef}
      className={cn("relative", isDragging && "opacity-40")}
      style={{ minHeight: rowHeight }}
    >
      {children({
        dragHandleProps: { ...attributes, ...dragListeners },
        rowDragListeners: dragListeners ?? {},
        showDragHandle: draggable,
        dropIndicator: showDrop ? (
          <DropIndicator position={dropHighlight!.position} />
        ) : null,
        setRowElement,
      })}
    </div>
  );
};

export type TreeDndShellProps<T> = Pick<
  TreeViewProps<T>,
  | "dndIdPrefix"
  | "draggable"
  | "droppable"
  | "canDrop"
  | "onDrop"
  | "renderIcon"
  | "renderLabel"
  | "dropHighlight"
> & {
  dndContext: "wrap" | "none";
  rowHeight: number;
  rows: FlattenedTreeRow<T>[];
  renderRow: (row: FlattenedTreeRow<T>, dndProps?: DndRowProps) => ReactNode;
};

export const TreeDndShell = <T,>({
  dndIdPrefix = "tree",
  dndContext,
  draggable,
  droppable,
  canDrop,
  onDrop,
  renderIcon,
  renderLabel,
  rowHeight,
  rows,
  renderRow,
  dropHighlight: externalDropHighlight,
}: TreeDndShellProps<T>) => {
  const [activeRow, setActiveRow] = useState<FlattenedTreeRow<T> | null>(null);
  const [localDropState, setLocalDropState] = useState<DropState<T>>(null);
  const localDropStateRef = useRef<DropState<T>>(null);

  const dndEnabled = Boolean(onDrop || draggable || droppable);
  const useExternalHighlight = dndContext === "none" && externalDropHighlight !== undefined;

  useEffect(() => {
    localDropStateRef.current = localDropState;
  }, [localDropState]);

  const dropHighlight: TreeDropHighlight = useExternalHighlight
    ? externalDropHighlight
    : localDropState
      ? { overId: localDropState.overId, position: localDropState.position }
      : null;

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as TreeDndDragData<T> | undefined;
    if (!data) return;
    const row = rows.find(
      (r) => toDndId(data.prefix, r.id) === String(event.active.id),
    );
    setActiveRow(row ?? null);
  };

  const handleDragMove = (event: DragMoveEvent) => {
    if (useExternalHighlight) return;

    const over = event.over;
    if (!over) {
      setLocalDropState(null);
      return;
    }
    const overData = over.data.current as TreeDndDropData<T> | undefined;
    const dragData = event.active.data.current as TreeDndDragData<T> | undefined;
    if (!overData || !dragData) {
      setLocalDropState(null);
      return;
    }

    const overId = String(over.id);
    const rect = over.rect;
    const activeTop =
      event.active.rect.current.translated?.top ??
      event.active.rect.current.initial?.top ??
      0;
    const position = resolveDropPosition(activeTop + rowHeight / 2, rect.top, rowHeight);

    const args: TreeDropArgs<T> = {
      dragNode: dragData.node,
      dropNode: overData.node,
      dropPosition: position,
    };

    if (canDrop && !canDrop(args)) {
      setLocalDropState(null);
      return;
    }

    setLocalDropState({ overId, position, dropNode: overData.node });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const currentDrop = localDropStateRef.current;
    const dragData = event.active.data.current as TreeDndDragData<T> | undefined;
    if (!useExternalHighlight && dragData && currentDrop && onDrop) {
      onDrop({
        dragNode: dragData.node,
        dropNode: currentDrop.dropNode,
        dropPosition: currentDrop.position,
      });
    }
    setActiveRow(null);
    setLocalDropState(null);
  };

  const handleDragCancel = () => {
    setActiveRow(null);
    setLocalDropState(null);
  };

  const rowList = rows.map((row) => {
    const canDrag = isNodeDraggable(row.node, draggable);
    const canDropTarget = isNodeDroppable(row.node, droppable);
    if (!dndEnabled || (!canDrag && !canDropTarget)) {
      return renderRow(row);
    }
    return (
      <DndTreeRow
        key={toDndId(dndIdPrefix, row.id)}
        row={row}
        prefix={dndIdPrefix}
        rowHeight={rowHeight}
        draggable={canDrag}
        droppable={canDropTarget}
        dropHighlight={dropHighlight}
      >
        {(dndProps) => renderRow(row, dndProps)}
      </DndTreeRow>
    );
  });

  const overlay = (
    <DragOverlay dropAnimation={null}>
      {activeRow ? (
        <div className="flex items-center gap-2 rounded-md bg-card px-3 py-2 opacity-90 shadow-lg">
          {renderIcon?.(activeRow.node)}
          {renderLabel(activeRow.node)}
        </div>
      ) : null}
    </DragOverlay>
  );

  if (!dndEnabled) {
    return <>{rowList}</>;
  }

  const dndContent = (
    <>
      {rowList}
      {!useExternalHighlight ? overlay : null}
    </>
  );

  if (dndContext === "wrap") {
    return (
      <DndContext
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        {dndContent}
      </DndContext>
    );
  }

  return dndContent;
};