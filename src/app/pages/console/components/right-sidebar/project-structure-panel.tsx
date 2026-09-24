import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Box, Cpu, Link2, Loader2, Plus, ScanLine, Zap } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { toast } from "sonner";
import { PanelHeader } from "@/app/components/ics/panel-header";
import { TabBar } from "@/app/components/ics/tab-bar";
import { TreeView, resolveDropPosition } from "@/app/components/ics/tree";
import type { TreeDropArgs, TreeDropHighlight, TreeDndDragData } from "@/app/components/ics/tree";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/app/components/ui/context-menu";
import { cn } from "@/app/components/ui/utils";
import { writeMotorHoistDrag } from "@/app/pages/console/3d/motor-hoist-drop";
import {
  reconcileMotorsByOrder,
  type MotorOrderReconciliation,
} from "@/app/pages/console/hooks/plc-reconciliation";
import { usePlcRuntime } from "@/app/pages/console/hooks/plc-runtime-provider";
import { formatMotorDisplayName } from "@/app/pages/console/hooks/motor-mid";
import { formatPlcDisplayName } from "@/app/pages/console/hooks/plc-display-name";
import type { InsertMotorsPosition } from "@/app/pages/console/hooks/setup-operations";
import { useObjectDeletion } from "@/app/pages/console/hooks/use-object-deletion";
import { useProjectStore } from "@/app/pages/console/hooks/use-project-store";
import { objectHasUnboundAxes } from "@/app/pages/console/hooks/binding-utils";
import { idsInRange, resolveSelectionMode } from "@/app/pages/console/hooks/selection-range";
import { useSelection } from "@/app/pages/console/hooks/use-selection";
import type { PlcScanResult } from "./config-wizard/config-wizard-types";
import { MotorAddDialog } from "./config-wizard/dialogs/motor-add-dialog";
import { PlcAddDialog } from "./config-wizard/dialogs/plc-add-dialog";
import { PlcScanDialog } from "./config-wizard/dialogs/plc-scan-dialog";
import { DeleteImpactDialog } from "./delete-impact-dialog";
import { MotorInsertMenuItems } from "./motor-insert-menu-items";
import {
  buildBusGroupTreeNode,
  buildPlcTreeNodes,
  computeDeleteImpact,
  deleteImpactRequiresConfirmation,
  getBusGroupTreeId,
  getPlcTreeStatus,
  getStructureNodeId,
  type BusGroupTreeNode,
  type DeleteImpact,
  type DeleteTarget,
  type DiscoveredMotorTreeNode,
  type LinkedCoTreeNode,
  type MotorTreeNode,
  type PendingCoNode,
  type PlcTreeNode,
  type PlcTreeStatusTone,
  type StructureTreeNode,
} from "./project-structure-tree-data";
import { PropertySection } from "./property-panel";

const iconBtn =
  "inline-flex h-7 w-7 items-center justify-center rounded-sm border border-border text-muted-foreground hover:bg-accent hover:text-foreground";

const TREE_ROW_HEIGHT = 36;

type StructureViewId = "all" | "objects" | "masters";

const STRUCTURE_VIEW_TABS: readonly { id: StructureViewId; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "objects", label: "物体" },
  { id: "masters", label: "主控" },
];

const STATUS_DOT_CLASS: Record<PlcTreeStatusTone, string> = {
  muted: "bg-muted-foreground",
  primary: "bg-primary animate-pulse",
  show: "bg-show",
  warning: "bg-warning",
};

type StructurePanelNode = PendingCoNode | StructureTreeNode;

const isPendingCo = (node: unknown): node is PendingCoNode =>
  typeof node === "object" && node !== null && "kind" in node && node.kind === "pending-co";

const isPlcNode = (node: unknown): node is PlcTreeNode =>
  typeof node === "object" && node !== null && "kind" in node && node.kind === "plc";

const isMotorNode = (node: unknown): node is MotorTreeNode =>
  typeof node === "object" && node !== null && "kind" in node && node.kind === "motor";

const isBusGroupNode = (node: unknown): node is BusGroupTreeNode =>
  typeof node === "object" && node !== null && "kind" in node && node.kind === "bus-group";

const isDiscoveredMotorNode = (node: unknown): node is DiscoveredMotorTreeNode =>
  typeof node === "object" &&
  node !== null &&
  "kind" in node &&
  node.kind === "discovered-motor";

const isLinkedCoNode = (node: unknown): node is LinkedCoTreeNode =>
  typeof node === "object" && node !== null && "kind" in node && node.kind === "linked-co";

const handleCoSelect = (
  event: MouseEvent | KeyboardEvent,
  objectId: number,
  select: ReturnType<typeof useSelection>["select"],
  toggleMulti: ReturnType<typeof useSelection>["toggleMulti"],
  replaceSelection: ReturnType<typeof useSelection>["replaceSelection"],
  clearSelection: ReturnType<typeof useSelection>["clearSelection"],
  setTreeFocus: ReturnType<typeof useSelection>["setTreeFocus"],
  multiSelectedIds: number[],
  orderedObjectIds: readonly number[],
) => {
  const mode = resolveSelectionMode(event);
  if (mode === "toggle") {
    setTreeFocus({ kind: "controlled-object", id: objectId });
    toggleMulti(objectId);
    return;
  }
  if (mode === "range") {
    const anchor = multiSelectedIds[multiSelectedIds.length - 1];
    const next = idsInRange(orderedObjectIds, anchor, objectId);
    replaceSelection(next);
    setTreeFocus({ kind: "controlled-object", id: objectId });
    return;
  }
  if (multiSelectedIds.length === 1 && multiSelectedIds[0] === objectId) {
    clearSelection();
    setTreeFocus(null);
    return;
  }
  setTreeFocus({ kind: "controlled-object", id: objectId });
  select(objectId);
};

export const ProjectStructurePanel = () => {
  const {
    objects,
    motors,
    plcs,
    getPlcUnassignedMotors,
    getPlcLinkedObjects,
    getObjectMotorsForPlc,
    getPlcMotors,
    findObject,
    removePlc,
    removeMotor,
    removeMotors,
    bindAxis,
    addMotorsFromScannedAxes,
  } = useProjectStore();
  const objectDeletion = useObjectDeletion();
  const { getPlcRuntime, scanAll } = usePlcRuntime();
  const {
    multiSelectedIds,
    multiSelectedMotorIds,
    treeFocus,
    select,
    toggleMulti,
    toggleMultiMotor,
    replaceSelection,
    replaceMotorSelection,
    setTreeFocus,
    clearSelection,
  } = useSelection();
  const [structureView, setStructureView] = useState<StructureViewId>("all");
  const [plcScanOpen, setPlcScanOpen] = useState(false);
  const [scanningMasters, setScanningMasters] = useState(false);
  const [scanResults, setScanResults] = useState<PlcScanResult[]>([]);
  const [plcAddOpen, setPlcAddOpen] = useState(false);
  const [motorAddPlcId, setMotorAddPlcId] = useState<number | null>(null);
  const [motorInsert, setMotorInsert] = useState<{
    anchorMotorId: number;
    plcId: number;
    position: InsertMotorsPosition;
  } | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(plcs.map((plc) => String(plc.id))),
  );
  const [dropHighlight, setDropHighlight] = useState<TreeDropHighlight>(null);
  const [activeDragNode, setActiveDragNode] = useState<StructurePanelNode | null>(null);
  const [deleteImpact, setDeleteImpact] = useState<DeleteImpact | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const pendingDeleteRef = useRef<DeleteTarget | null>(null);
  const dropHighlightRef = useRef<TreeDropHighlight>(null);

  useEffect(() => {
    dropHighlightRef.current = dropHighlight;
  }, [dropHighlight]);

  useEffect(() => {
    setExpandedIds((current) => {
      const next = new Set(current);
      for (const plc of plcs) {
        next.add(String(plc.id));
        next.add(getBusGroupTreeId(plc.id, 0));
        next.add(getBusGroupTreeId(plc.id, 1));
      }
      return next;
    });
  }, [plcs]);

  const reconciliationByPlcId = useMemo(() => {
    const map = new Map<number, MotorOrderReconciliation>();
    for (const plc of plcs) {
      const runtime = getPlcRuntime(plc.id);
      const configured = motors.filter((motor) => motor.plcId === plc.id);
      map.set(plc.id, reconcileMotorsByOrder(configured, runtime.scannedAxes ?? []));
    }
    return map;
  }, [getPlcRuntime, motors, plcs]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const pendingObjects = useMemo(
    () =>
      objects.filter(
        (object) =>
          !motors.some(
            (motor) => motor.controlledObjectId === object.id && Boolean(motor.axisKey),
          ),
      ),
    [objects, motors],
  );
  const pendingNodes = useMemo<PendingCoNode[]>(
    () => pendingObjects.map((object) => ({ kind: "pending-co", object })),
    [pendingObjects],
  );
  const allObjectNodes = useMemo<PendingCoNode[]>(
    () => objects.map((object) => ({ kind: "pending-co", object })),
    [objects],
  );
  const plcNodes = useMemo<PlcTreeNode[]>(
    () => plcs.map((plc) => ({ kind: "plc", plc })),
    [plcs],
  );
  const showObjectsSection = structureView === "all" || structureView === "objects";
  const showMastersSection = structureView === "all" || structureView === "masters";
  const objectSectionNodes = structureView === "objects" ? allObjectNodes : pendingNodes;
  const objectSectionEmptyLabel =
    structureView === "objects" ? "暂无受控物体" : "暂无待绑定受控物体";
  const objectSectionTitle = structureView === "objects" ? "受控物体" : "待绑定受控物体";
  const objectSectionAriaLabel = objectSectionTitle;

  const selectedIds = useMemo(
    () => new Set([...multiSelectedIds, ...multiSelectedMotorIds].map((id) => String(id))),
    [multiSelectedIds, multiSelectedMotorIds],
  );
  const focusedId = treeFocus?.id != null ? String(treeFocus.id) : null;

  const motorNodeWithStatus = useCallback(
    (plcId: number, motor: MotorTreeNode["motor"]): MotorTreeNode => {
      const reconciliation = reconciliationByPlcId.get(plcId);
      if (!reconciliation) return { kind: "motor", motor };

      const onlineIds = new Set(reconciliation.online.map((i) => i.motor.id));
      const modelMismatchIds = new Set(reconciliation.modelMismatch.map((i) => i.motor.id));
      const portMismatchIds = new Set(reconciliation.portMismatch.map((i) => i.motor.id));
      const offlineIds = new Set(reconciliation.offline.map((i) => i.id));

      return {
        kind: "motor",
        motor,
        status: onlineIds.has(motor.id)
          ? "connected"
          : modelMismatchIds.has(motor.id)
            ? "modelMismatch"
            : portMismatchIds.has(motor.id)
              ? "portMismatch"
              : offlineIds.has(motor.id)
                ? "missing"
                : undefined,
      };
    },
    [reconciliationByPlcId],
  );

  const getStructureChildren = useCallback(
    (node: StructureTreeNode): StructureTreeNode[] | undefined => {
      if (node.kind === "linked-co") {
        return getObjectMotorsForPlc(node.object.id, node.plcId).map((motor) =>
          motorNodeWithStatus(node.plcId, motor),
        );
      }
      if (node.kind === "plc") {
        const reconciliation =
          reconciliationByPlcId.get(node.plc.id) ?? reconcileMotorsByOrder([], []);

        // 主控视图：主控 → C口/D口分组 → 电机（含待加入发现项）
        if (structureView === "masters") {
          const plcMotors = getPlcMotors(node.plc.id);
          const busGroups = ([0, 1] as const)
            .filter((busNo) => plcMotors.some((motor) => motor.busNo === busNo))
            .map((busNo) => buildBusGroupTreeNode(node.plc.id, busNo));
          const discoveredNodes = buildPlcTreeNodes(
            node.plc,
            [],
            [],
            reconciliation,
          ).filter((child) => child.kind === "discovered-motor");
          return [...busGroups, ...discoveredNodes];
        }

        return buildPlcTreeNodes(
          node.plc,
          getPlcUnassignedMotors(node.plc.id),
          getPlcLinkedObjects(node.plc.id),
          reconciliation,
        );
      }
      if (node.kind === "bus-group") {
        return getPlcMotors(node.plcId)
          .filter((motor) => motor.busNo === node.busNo)
          .map((motor) => motorNodeWithStatus(node.plcId, motor));
      }
      return undefined;
    },
    [
      getObjectMotorsForPlc,
      getPlcLinkedObjects,
      getPlcMotors,
      getPlcUnassignedMotors,
      motorNodeWithStatus,
      reconciliationByPlcId,
      structureView,
    ],
  );

  const orderedObjectIds = useMemo(() => {
    const ids: number[] = [];
    const seen = new Set<number>();
    const push = (id: number) => {
      if (seen.has(id)) return;
      seen.add(id);
      ids.push(id);
    };
    if (showObjectsSection) {
      for (const node of objectSectionNodes) {
        push(node.object.id);
      }
    }
    if (showMastersSection) {
      const walk = (nodes: StructureTreeNode[]) => {
        for (const node of nodes) {
          if (node.kind === "linked-co") push(node.object.id);
          const children = getStructureChildren(node);
          if (children) walk(children);
        }
      };
      walk(plcNodes);
    }
    return ids;
  }, [
    getStructureChildren,
    objectSectionNodes,
    plcNodes,
    showMastersSection,
    showObjectsSection,
  ]);

  const orderedMotorIds = useMemo(() => {
    const ids: number[] = [];
    const walk = (nodes: StructureTreeNode[]) => {
      for (const node of nodes) {
        if (node.kind === "motor") ids.push(node.motor.id);
        const children = getStructureChildren(node);
        if (children) walk(children);
      }
    };
    walk(plcNodes);
    return ids;
  }, [getStructureChildren, plcNodes]);

  const pruneObjectSelection = useCallback(
    (removedIds: readonly number[]) => {
      const removed = new Set(removedIds);
      const remaining = multiSelectedIds.filter((id) => !removed.has(id));
      if (remaining.length === 0) {
        clearSelection();
        setTreeFocus(null);
        return;
      }
      replaceSelection(remaining);
      if (treeFocus?.kind === "controlled-object" && removed.has(treeFocus.id)) {
        setTreeFocus(null);
      }
    },
    [clearSelection, multiSelectedIds, replaceSelection, setTreeFocus, treeFocus],
  );

  const executeDelete = useCallback(
    (target: DeleteTarget) => {
      if (target.kind === "motor") removeMotor(target.motorId);
      else if (target.kind === "motors") removeMotors(target.motorIds);
      else if (target.kind === "plc") removePlc(target.plcId);
      clearSelection();
      setTreeFocus(null);
    },
    [clearSelection, removeMotor, removeMotors, removePlc, setTreeFocus],
  );

  const requestObjectDelete = useCallback(
    (objectId: number) => {
      const objectIds =
        multiSelectedIds.length > 1 && multiSelectedIds.includes(objectId)
          ? [...multiSelectedIds]
          : [objectId];
      objectDeletion.requestDelete(objectIds);
    },
    [multiSelectedIds, objectDeletion],
  );

  const requestDelete = useCallback(
    (target: DeleteTarget) => {
      if (target.kind === "object") {
        requestObjectDelete(target.objectId);
        return;
      }
      if (target.kind === "objects") {
        objectDeletion.requestDelete(target.objectIds);
        return;
      }

      const impact = computeDeleteImpact(target, { objects, motors, plcs });
      if (!impact) return;

      if (deleteImpactRequiresConfirmation(impact)) {
        pendingDeleteRef.current = target;
        setDeleteImpact(impact);
        setDeleteOpen(true);
        return;
      }

      executeDelete(target);
    },
    [executeDelete, motors, objectDeletion, objects, plcs, requestObjectDelete],
  );

  const resolveMotorDeleteTarget = useCallback(
    (motorId: number): DeleteTarget => {
      if (multiSelectedMotorIds.length > 1 && multiSelectedMotorIds.includes(motorId)) {
        return { kind: "motors", motorIds: [...multiSelectedMotorIds] };
      }
      return { kind: "motor", motorId };
    },
    [multiSelectedMotorIds],
  );

  const handleConfirmDelete = useCallback(() => {
    const target = pendingDeleteRef.current;
    if (target) executeDelete(target);
    pendingDeleteRef.current = null;
    setDeleteImpact(null);
    setDeleteOpen(false);
  }, [executeDelete]);

  const handleConfirmObjectDelete = useCallback((): boolean => {
    const removedIds = objectDeletion.impact?.objectIds ?? [];
    const outcome = objectDeletion.confirmDelete();
    if (outcome === "deleted") {
      pruneObjectSelection(removedIds);
      return true;
    }
    if (outcome === "no-op") {
      pruneObjectSelection(
        removedIds.length > 0
          ? removedIds
          : multiSelectedIds.filter((id) => !findObject(id)),
      );
      return true;
    }
    return false;
  }, [findObject, multiSelectedIds, objectDeletion, pruneObjectSelection]);

  const handleObjectDeleteOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) objectDeletion.cancelDelete();
    },
    [objectDeletion],
  );

  /** Delete 键：主控 / 受控物体 / 电机（含多选） */
  const handleStructureDeleteKey = useCallback(
    (node: StructureTreeNode) => {
      if (isPlcNode(node)) {
        requestDelete({ kind: "plc", plcId: node.plc.id });
        return;
      }
      if (isLinkedCoNode(node)) {
        requestObjectDelete(node.object.id);
        return;
      }
      if (isMotorNode(node)) {
        requestDelete(resolveMotorDeleteTarget(node.motor.id));
      }
    },
    [requestDelete, requestObjectDelete, resolveMotorDeleteTarget],
  );

  const handlePendingObjectDeleteKey = useCallback(
    (node: PendingCoNode) => {
      requestObjectDelete(node.object.id);
    },
    [requestObjectDelete],
  );

  const handleAdoptDiscovered = useCallback(
    (plcId: number, axis: { slaveNo: number; busNo: number; gourdNo: number }) => {
      addMotorsFromScannedAxes(plcId, [axis]);
    },
    [addMotorsFromScannedAxes],
  );

  const handleCanDrop = useCallback(
    ({ dragNode, dropNode, dropPosition }: TreeDropArgs<StructurePanelNode>) => {
      if (isPendingCo(dragNode) && isPlcNode(dropNode) && dropPosition === "inside") {
        return true;
      }
      return false;
    },
    [],
  );

  const handleDrop = useCallback(
    ({ dragNode, dropNode, dropPosition }: TreeDropArgs<StructurePanelNode>) => {
      if (isPendingCo(dragNode) && isPlcNode(dropNode) && dropPosition === "inside") {
        setTreeFocus({ kind: "master", id: dropNode.plc.id });
      }
    },
    [setTreeFocus],
  );

  const getMotorRowProps = useCallback(
    (node: StructureTreeNode) => {
      if (node.kind !== "motor") return undefined;
      return {
        draggable: true,
        onDragStart: (event: DragEvent<HTMLDivElement>) => {
          const motorIds =
            multiSelectedMotorIds.length > 0 &&
            multiSelectedMotorIds.includes(node.motor.id)
              ? multiSelectedMotorIds
              : [node.motor.id];
          writeMotorHoistDrag(event.dataTransfer, motorIds.map(String));
        },
      };
    },
    [multiSelectedMotorIds],
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current as TreeDndDragData<StructurePanelNode> | undefined;
    setActiveDragNode(data?.node ?? null);
  }, []);

  const handleDragMove = useCallback(
    (event: DragMoveEvent) => {
      if (!event.over) {
        setDropHighlight(null);
        return;
      }
      const dragData = event.active.data.current as TreeDndDragData<StructurePanelNode> | undefined;
      const overData = event.over.data.current as TreeDndDragData<StructurePanelNode> | undefined;
      if (!dragData || !overData) {
        setDropHighlight(null);
        return;
      }

      const activeTop =
        event.active.rect.current.translated?.top ??
        event.active.rect.current.initial?.top;
      if (activeTop == null) {
        setDropHighlight(null);
        return;
      }
      const position = resolveDropPosition(
        activeTop + TREE_ROW_HEIGHT / 2,
        event.over.rect.top,
        TREE_ROW_HEIGHT,
      );

      const args: TreeDropArgs<StructurePanelNode> = {
        dragNode: dragData.node,
        dropNode: overData.node,
        dropPosition: position,
      };

      if (!handleCanDrop(args)) {
        setDropHighlight(null);
        return;
      }

      setDropHighlight({ overId: String(event.over.id), position });
    },
    [handleCanDrop],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const highlight = dropHighlightRef.current;
      const dragData = event.active.data.current as TreeDndDragData<StructurePanelNode> | undefined;
      const overData = event.over?.data.current as TreeDndDragData<StructurePanelNode> | undefined;
      if (highlight && dragData && overData) {
        handleDrop({
          dragNode: dragData.node,
          dropNode: overData.node,
          dropPosition: highlight.position,
        });
      }
      setDropHighlight(null);
      setActiveDragNode(null);
    },
    [handleDrop],
  );

  const handleDragCancel = useCallback(() => {
    setDropHighlight(null);
    setActiveDragNode(null);
  }, []);

  const renderDragOverlayLabel = (node: StructurePanelNode) => {
    if (isPendingCo(node)) return node.object.name;
    if (isPlcNode(node)) return formatPlcDisplayName(plcs, node.plc);
    if (isBusGroupNode(node)) return node.label;
    if (isMotorNode(node)) return formatMotorDisplayName(motors, node.motor);
    if (isDiscoveredMotorNode(node)) return node.label;
    return node.object.name;
  };

  const renderDragOverlayIcon = (node: StructurePanelNode) => {
    if (isPendingCo(node) || isLinkedCoNode(node)) {
      return <Box className="h-3.5 w-3.5" aria-hidden />;
    }
    if (isPlcNode(node)) return <Cpu className="h-3.5 w-3.5" aria-hidden />;
    if (isDiscoveredMotorNode(node)) {
      return <Zap className="h-3.5 w-3.5 opacity-50" aria-hidden />;
    }
    return <Zap className="h-3.5 w-3.5" aria-hidden />;
  };

  const renderStructureIcon = (node: StructureTreeNode) => {
    if (node.kind === "plc") {
      const runtime = getPlcRuntime(node.plc.id);
      const iconClass =
        runtime.connection === "connected" && runtime.modelMismatch
          ? "text-warning"
          : runtime.connection === "connected"
            ? "text-show"
            : runtime.connection === "connecting"
              ? "text-primary"
              : runtime.connection === "abnormal"
                ? "text-warning"
                : "text-muted-foreground";
      return <Cpu className={cn("h-3.5 w-3.5", iconClass)} aria-hidden />;
    }
    if (node.kind === "bus-group") {
      return <span className="h-3.5 w-3.5 shrink-0" aria-hidden />;
    }
    if (node.kind === "discovered-motor") {
      return <Zap className="h-3.5 w-3.5 text-muted-foreground opacity-50" aria-hidden />;
    }
    if (node.kind === "motor") {
      const iconClass =
        node.status === "modelMismatch" || node.status === "portMismatch"
          ? "text-warning"
          : node.status === "connected"
            ? "text-show"
            : "text-muted-foreground";
      return <Zap className={cn("h-3.5 w-3.5", iconClass)} aria-hidden />;
    }
    if (node.kind === "linked-co") {
      const fullyBound = !objectHasUnboundAxes(node.object, motors);
      return (
        <Box
          className={cn("h-3.5 w-3.5", fullyBound ? "text-show" : "text-warning")}
          aria-hidden
        />
      );
    }
    return <Box className="h-3.5 w-3.5" aria-hidden />;
  };

  const renderStructureLabel = (node: StructureTreeNode) => {
    if (node.kind === "plc") {
      const runtime = getPlcRuntime(node.plc.id);
      const configuredCount = getPlcMotors(node.plc.id).length;
      const reconciliation = reconciliationByPlcId.get(node.plc.id);
      const actualCount =
        runtime.connection === "disconnected" || runtime.connection === "connecting"
          ? 0
          : (reconciliation?.online.length ?? 0) +
            (reconciliation?.modelMismatch.length ?? 0) +
            (reconciliation?.portMismatch.length ?? 0);
      const status = getPlcTreeStatus(runtime, configuredCount, actualCount);

      return (
        <>
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 py-1">
            <span className="min-w-0 truncate">{formatPlcDisplayName(plcs, node.plc)}</span>
            <span className="min-w-0 truncate font-mono text-mono-sm tabular-nums text-muted-foreground">
              {node.plc.ip || "—"}
            </span>
          </div>
          <span className="shrink-0 font-mono text-mono-sm tabular-nums text-muted-foreground">
            {status.label}
          </span>
        </>
      );
    }
    if (node.kind === "bus-group") {
      return <span className="min-w-0 truncate text-foreground">{node.label}</span>;
    }
    if (node.kind === "motor") {
      return (
        <span className="min-w-0 truncate font-mono tabular-nums">
          {formatMotorDisplayName(motors, node.motor)}
        </span>
      );
    }
    if (node.kind === "discovered-motor") {
      return (
        <>
          <span className="min-w-0 truncate border border-dashed border-border/60 px-1.5 font-mono text-mono-sm text-muted-foreground">
            {node.label}
          </span>
          <span className="shrink-0 text-body-sm text-secondary">待加入</span>
        </>
      );
    }
    return <span className="min-w-0 truncate">{node.object.name}</span>;
  };

  const handleJumpToBoundObject = useCallback(
    (objectId: number, plcId?: number) => {
      setStructureView("all");
      if (plcId != null) {
        setExpandedIds((current) => {
          const next = new Set(current);
          next.add(String(plcId));
          next.add(String(objectId));
          return next;
        });
      }
      select(objectId);
      setTreeFocus({ kind: "controlled-object", id: objectId });
    },
    [select, setTreeFocus],
  );

  const renderStructureExtra = (node: StructureTreeNode) => {
    if (node.kind === "discovered-motor") {
      return (
        <button
          type="button"
          aria-label={`加入工程 ${node.label}`}
          className="inline-flex h-7 shrink-0 items-center rounded-sm px-2 text-[10px] text-primary hover:bg-accent"
          onClick={(event) => {
            event.stopPropagation();
            handleAdoptDiscovered(node.plcId, {
              slaveNo: node.slaveNo,
              busNo: node.busNo,
              gourdNo: node.gourdNo,
            });
          }}
        >
          加入工程
        </button>
      );
    }
    if (
      node.kind === "motor" &&
      structureView === "masters" &&
      node.motor.controlledObjectId != null
    ) {
      const objectId = node.motor.controlledObjectId;
      const objectName = objects.find((item) => item.id === objectId)?.name ?? "模型";
      return (
        <button
          type="button"
          aria-label={`跳转到 ${objectName}`}
          title={`跳转到 ${objectName}`}
          className={iconBtn}
          onClick={(event) => {
            event.stopPropagation();
            handleJumpToBoundObject(objectId, node.motor.plcId);
          }}
        >
          <Link2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      );
    }
    if (node.kind !== "plc") return null;
    return (
      <button
        type="button"
        aria-label={`${formatPlcDisplayName(plcs, node.plc)} 手动添加电机`}
        className={iconBtn}
        title="手动添加电机"
        onClick={(event) => {
          event.stopPropagation();
          setMotorAddPlcId(node.plc.id);
        }}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
      </button>
    );
  };

  const handleUnbindMotor = useCallback(
    (motorId: number) => {
      const motor = motors.find((item) => item.id === motorId);
      if (motor?.controlledObjectId == null || motor.axisKey == null) return;
      bindAxis(motor.controlledObjectId, motor.axisKey, null);
    },
    [bindAxis, motors],
  );

  const renderStructureContextMenu = (node: StructureTreeNode) => {
    if (isDiscoveredMotorNode(node)) {
      return (
        <ContextMenuContent>
          <ContextMenuItem
            onSelect={() =>
              handleAdoptDiscovered(node.plcId, {
                slaveNo: node.slaveNo,
                busNo: node.busNo,
                gourdNo: node.gourdNo,
              })
            }
          >
            加入工程
          </ContextMenuItem>
        </ContextMenuContent>
      );
    }

    if (isMotorNode(node)) {
      const isBound = node.motor.controlledObjectId != null && node.motor.axisKey != null;
      const isMotorMultiSelect =
        multiSelectedMotorIds.length > 1 &&
        multiSelectedMotorIds.includes(node.motor.id);

      return (
        <ContextMenuContent className={isMotorMultiSelect ? undefined : "min-w-55"}>
          {!isMotorMultiSelect ? (
            <>
              <MotorInsertMenuItems
                onRequestInsert={(position) =>
                  setMotorInsert({
                    anchorMotorId: node.motor.id,
                    plcId: node.motor.plcId,
                    position,
                  })
                }
              />
              <ContextMenuSeparator />
            </>
          ) : null}
          <ContextMenuItem
            disabled={!isBound}
            onSelect={() => handleUnbindMotor(node.motor.id)}
          >
            解绑吊点
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            onSelect={() => requestDelete(resolveMotorDeleteTarget(node.motor.id))}
          >
            删除
          </ContextMenuItem>
        </ContextMenuContent>
      );
    }

    if (isLinkedCoNode(node)) {
      return (
        <ContextMenuContent>
          <ContextMenuItem
            variant="destructive"
            onSelect={() => requestObjectDelete(node.object.id)}
          >
            删除
          </ContextMenuItem>
        </ContextMenuContent>
      );
    }

    if (!isPlcNode(node)) return null;

    return (
      <ContextMenuContent>
        <ContextMenuItem
          variant="destructive"
          onSelect={() => requestDelete({ kind: "plc", plcId: node.plc.id })}
        >
          删除
        </ContextMenuItem>
      </ContextMenuContent>
    );
  };

  const handleStructureSelect = (
    node: StructureTreeNode,
    event: MouseEvent | KeyboardEvent,
  ) => {
    if (node.kind === "bus-group") {
      clearSelection();
      setTreeFocus({ kind: "master", id: node.plcId });
      return;
    }
    if (node.kind === "discovered-motor") {
      clearSelection();
      setTreeFocus({ kind: "master", id: node.plcId });
      return;
    }
    if (node.kind === "linked-co") {
      handleCoSelect(
        event,
        node.object.id,
        select,
        toggleMulti,
        replaceSelection,
        clearSelection,
        setTreeFocus,
        multiSelectedIds,
        orderedObjectIds,
      );
      return;
    }
    if (node.kind === "plc") {
      clearSelection();
      setTreeFocus({ kind: "master", id: node.plc.id });
      return;
    }
    // motor — 再次点击取消选中（未连接限制仅在调试 Tab）
    const motorMode = resolveSelectionMode(event);
    if (motorMode === "toggle") {
      toggleMultiMotor(node.motor.id);
      setTreeFocus({ kind: "motor", id: node.motor.id });
      return;
    }
    if (motorMode === "range") {
      const anchor =
        multiSelectedMotorIds[multiSelectedMotorIds.length - 1] ??
        (treeFocus?.kind === "motor" ? treeFocus.id : null);
      const next = idsInRange(orderedMotorIds, anchor, node.motor.id);
      replaceMotorSelection(next);
      setTreeFocus({ kind: "motor", id: node.motor.id });
      return;
    }
    if (multiSelectedMotorIds.length === 1 && multiSelectedMotorIds[0] === node.motor.id) {
      clearSelection();
      setTreeFocus(null);
      return;
    }
    replaceMotorSelection([node.motor.id]);
    setTreeFocus({ kind: "motor", id: node.motor.id });
  };

  const handleScanAllMaster = () => {
    if (scanningMasters) return;
    setScanningMasters(true);
    void (async () => {
      try {
        const masters = await scanAll();
        const next = masters
          .filter((m) => !plcs.some((plc) => plc.ip === m.ip))
          .map((m) => ({ id: m.ip, ip: m.ip, plcModel: m.plcModel, axis: m.axis }));
        if (next.length === 0) {
          toast.success("未发现新主控");
          return;
        }
        setScanResults(next);
        setPlcScanOpen(true);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "扫描失败");
      } finally {
        setScanningMasters(false);
      }
    })();
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-row overflow-hidden">
      <div className="custom-scrollbar flex min-h-0 w-[280px] shrink-0 flex-col overflow-y-auto bg-card">
        <TabBar
          tabs={STRUCTURE_VIEW_TABS}
          active={structureView}
          onChange={setStructureView}
          variant="underline"
          className="shrink-0"
        />
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          {showObjectsSection ? (
            <>
              <PanelHeader title={objectSectionTitle} icon={Box} />
              {objectSectionNodes.length > 0 ? (
                <TreeView
                  nodes={objectSectionNodes}
                  getNodeId={getStructureNodeId}
                  expandedIds={new Set()}
                  onExpandedChange={() => {}}
                  selectedIds={selectedIds}
                  focusedId={focusedId}
                  onSelect={(node, event) =>
                    handleCoSelect(
                      event,
                      node.object.id,
                      select,
                      toggleMulti,
                      replaceSelection,
                      clearSelection,
                      setTreeFocus,
                      multiSelectedIds,
                      orderedObjectIds,
                    )
                  }
                  onDelete={handlePendingObjectDeleteKey}
                  renderLabel={(node) => (
                    <span className="min-w-0 truncate">{node.object.name}</span>
                  )}
                  renderIcon={() => <Box className="h-3.5 w-3.5" aria-hidden />}
                  renderContextMenu={(node) => (
                    <ContextMenuContent>
                      <ContextMenuItem
                        variant="destructive"
                        onSelect={() => requestObjectDelete(node.object.id)}
                      >
                        删除
                      </ContextMenuItem>
                    </ContextMenuContent>
                  )}
                  dndIdPrefix="pending-co"
                  dndContext="none"
                  draggable={structureView === "all"}
                  dropHighlight={dropHighlight}
                  aria-label={objectSectionAriaLabel}
                />
              ) : (
                <p className="px-3 py-2 text-body-sm text-muted-foreground">
                  {objectSectionEmptyLabel}
                </p>
              )}
            </>
          ) : null}

          {showMastersSection ? (
            <>
              <PanelHeader
                title="主控"
                icon={Cpu}
                extra={
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label="扫描添加主控"
                      aria-busy={scanningMasters}
                      disabled={scanningMasters}
                      className={cn(
                        iconBtn,
                        "bg-primary text-primary-foreground hover:text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-40",
                      )}
                      title="扫描"
                      onClick={handleScanAllMaster}
                    >
                      {scanningMasters ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      ) : (
                        <ScanLine className="h-3.5 w-3.5" aria-hidden />
                      )}
                    </button>
                    <button
                      type="button"
                      aria-label="添加主控"
                      className={iconBtn}
                      title="添加主控"
                      onClick={() => setPlcAddOpen(true)}
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </div>
                }
              />
              <TreeView
                nodes={plcNodes}
                getNodeId={getStructureNodeId}
                getChildren={getStructureChildren}
                expandedIds={expandedIds}
                onExpandedChange={setExpandedIds}
                selectedIds={selectedIds}
                focusedId={focusedId}
                onSelect={handleStructureSelect}
                onDelete={handleStructureDeleteKey}
                renderLabel={renderStructureLabel}
                renderIcon={renderStructureIcon}
                renderExtra={renderStructureExtra}
                renderContextMenu={renderStructureContextMenu}
                getRowProps={getMotorRowProps}
                dndIdPrefix="plc-tree"
                dndContext="none"
                droppable={(node) => structureView === "all" && node.kind === "plc"}
                dropHighlight={dropHighlight}
                aria-label="主控结构"
              />
            </>
          ) : null}
          <DragOverlay dropAnimation={null}>
            {activeDragNode ? (
              <div className="flex items-center gap-2 rounded-md bg-card px-3 py-2 opacity-90 shadow-lg">
                {renderDragOverlayIcon(activeDragNode)}
                <span className="text-body-md">{renderDragOverlayLabel(activeDragNode)}</span>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
      <PropertySection />

      <PlcScanDialog
        open={plcScanOpen}
        onOpenChange={setPlcScanOpen}
        results={scanResults}
      />
      <PlcAddDialog open={plcAddOpen} onOpenChange={setPlcAddOpen} />
      <MotorAddDialog
        open={motorAddPlcId !== null}
        onOpenChange={(open) => {
          if (!open) setMotorAddPlcId(null);
        }}
        mode="add"
        plcId={motorAddPlcId ?? 0}
      />
      <MotorAddDialog
        open={motorInsert !== null}
        onOpenChange={(open) => {
          if (!open) setMotorInsert(null);
        }}
        mode="insert"
        plcId={motorInsert?.plcId ?? 0}
        anchorMotorId={motorInsert?.anchorMotorId}
        initialPosition={motorInsert?.position ?? "after"}
      />
      <DeleteImpactDialog
        impact={deleteImpact}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={handleConfirmDelete}
      />
      <DeleteImpactDialog
        objectImpact={objectDeletion.impact}
        open={objectDeletion.open}
        onOpenChange={handleObjectDeleteOpenChange}
        onConfirm={handleConfirmObjectDelete}
        error={objectDeletion.lastError}
      />
    </div>
  );
};
