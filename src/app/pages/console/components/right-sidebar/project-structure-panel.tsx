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
  discoveredAxesThrough,
  toScannedAxes,
  type RealAxis,
} from "@/app/pages/console/hooks/plc-online";
import { usePlcRuntime } from "@/app/pages/console/hooks/plc-runtime-provider";
import { useSetupEditState } from "@/app/pages/console/hooks/axis-motion";
import { formatMotorDisplayName } from "@/app/pages/console/hooks/motor-mid";
import { formatPlcDisplayName } from "@/app/pages/console/hooks/plc-display-name";
import type { InsertMotorsPosition } from "@/app/pages/console/hooks/setup-operations";
import { useMasterScan } from "@/app/pages/console/hooks/use-master-scan";
import { useObjectDeletion } from "@/app/pages/console/hooks/use-object-deletion";
import { useProjectStore } from "@/app/pages/console/hooks/use-project-store";
import { objectHasUnboundAxes } from "@/app/pages/console/hooks/binding-utils";
import { idsInRange, resolveSelectionMode } from "@/app/pages/console/hooks/selection-range";
import { useSelection } from "@/app/pages/console/hooks/use-selection";
import { resolveMountDropParent } from "@/app/pages/console/hooks/mount-objects";
import { orderByMountTree, resolveMountParentId } from "@/app/project/object-mount";
import type { ControlledObject } from "./config-wizard/config-wizard-types";
import { MotorAddDialog } from "./config-wizard/dialogs/motor-add-dialog";
import { PlcAddDialog } from "./config-wizard/dialogs/plc-add-dialog";
import { PlcScanDialog } from "./config-wizard/dialogs/plc-scan-dialog";
import { DeleteImpactDialog } from "./delete-impact-dialog";
import { MotorInsertMenuItems } from "./motor-insert-menu-items";
import {
  buildBusGroupTreeNode,
  buildDiscoveredTreeNodes,
  buildMotorTreeNode,
  buildPlcTreeNodes,
  computeDeleteImpact,
  deleteImpactRequiresConfirmation,
  getBusGroupTreeId,
  getLinkedCoTreeId,
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

const STRUCTURE_VIEW_TABS: readonly { id: StructureViewId; label: string; guide?: string }[] = [
  { id: "all", label: "全部" },
  { id: "objects", label: "物体", guide: "console-controlled-objects-tab" },
  { id: "masters", label: "主控", guide: "console-masters-tab" },
];

const STATUS_TEXT_CLASS: Record<PlcTreeStatusTone, string> = {
  muted: "text-muted-foreground",
  primary: "text-primary",
  show: "text-show",
  warning: "text-warning",
};

const BUS_NOS = [0, 1] as const;

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
  // 单击就是选中它（再点一次不会取消，免得触屏上点两下就丢了选择）；取消用 Ctrl/⌘ 单击、Esc 或点空白处
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
    mountObjects,
  } = useProjectStore();
  const objectDeletion = useObjectDeletion();
  // 没有「编辑工程配置」或轴运动中只能浏览：不显示增删、右键菜单，Delete 键和拖动挂载 / 绑定都不生效
  const canEdit = !useSetupEditState().readOnly;
  const { getPlcOnline, scan } = usePlcRuntime();
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
  const masterScan = useMasterScan({ canAdd: canEdit });
  const [plcAddOpen, setPlcAddOpen] = useState(false);
  const [motorAddPlcId, setMotorAddPlcId] = useState<number | null>(null);
  const [motorInsert, setMotorInsert] = useState<{
    anchorMotorId: number;
    plcId: number;
    position: InsertMotorsPosition;
  } | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  /** 已经自动展开过的主控：只有新出现的主控才自动展开，用户收起的不会因为改了别的配置又被撑开 */
  const autoExpandedPlcIdsRef = useRef<Set<number>>(new Set());
  const treeScrollRef = useRef<HTMLDivElement>(null);
  /** 受控物体视图按挂载树显示；记录用户折叠的父物体 */
  const [collapsedObjectIds, setCollapsedObjectIds] = useState<Set<string>>(() => new Set());
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
    const seen = autoExpandedPlcIdsRef.current;
    const fresh = plcs.filter((plc) => !seen.has(plc.id));
    if (fresh.length === 0) return;
    for (const plc of fresh) seen.add(plc.id);
    setExpandedIds((current) => {
      const next = new Set(current);
      for (const plc of fresh) {
        next.add(String(plc.id));
        for (const busNo of BUS_NOS) next.add(getBusGroupTreeId(plc.id, busNo));
      }
      return next;
    });
  }, [plcs]);

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
  const mountTreeOrder = useMemo(() => orderByMountTree(objects), [objects]);
  const mountChildrenById = useMemo(() => {
    const map = new Map<number, ControlledObject[]>();
    for (const { object, depth } of mountTreeOrder) {
      const parentId = depth > 0 ? resolveMountParentId(objects, object.id) : null;
      if (parentId == null) continue;
      map.set(parentId, [...(map.get(parentId) ?? []), object]);
    }
    return map;
  }, [mountTreeOrder, objects]);
  const allObjectNodes = useMemo<PendingCoNode[]>(
    () =>
      mountTreeOrder
        .filter(({ depth }) => depth === 0)
        .map(({ object }) => ({ kind: "pending-co", object })),
    [mountTreeOrder],
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
  const showMountTree = structureView === "objects";
  const getObjectSectionChildren = useCallback(
    (node: PendingCoNode): PendingCoNode[] | undefined => {
      if (!showMountTree) return undefined;
      const children = mountChildrenById.get(node.object.id);
      return children?.map((object) => ({ kind: "pending-co", object }));
    },
    [mountChildrenById, showMountTree],
  );
  const objectSectionExpandedIds = useMemo(
    () =>
      new Set(
        [...mountChildrenById.keys()]
          .map(String)
          .filter((id) => !collapsedObjectIds.has(id)),
      ),
    [collapsedObjectIds, mountChildrenById],
  );
  const handleObjectSectionExpandedChange = useCallback(
    (ids: Set<string>) => {
      setCollapsedObjectIds(
        new Set([...mountChildrenById.keys()].map(String).filter((id) => !ids.has(id))),
      );
    },
    [mountChildrenById],
  );

  /** 高亮的行：选中的物体 / 电机 + 属性面板正在看的那一项（物体在每个主控下都有一行） */
  const selectedIds = useMemo(() => {
    const ids = new Set<string>();
    const objectIds = new Set(multiSelectedIds);
    if (treeFocus?.kind === "controlled-object") objectIds.add(treeFocus.id);
    for (const objectId of objectIds) {
      ids.add(String(objectId));
      for (const plc of plcs) ids.add(getLinkedCoTreeId(plc.id, objectId));
    }
    for (const motorId of multiSelectedMotorIds) ids.add(String(motorId));
    if (treeFocus?.kind === "motor" || treeFocus?.kind === "master") ids.add(String(treeFocus.id));
    return ids;
  }, [multiSelectedIds, multiSelectedMotorIds, plcs, treeFocus]);

  /** Esc / 点树下面的空白处：清空选择 */
  const clearTreeSelection = useCallback(() => {
    clearSelection();
    setTreeFocus(null);
  }, [clearSelection, setTreeFocus]);

  // 在 3D 里（或别处）选中时，展开到选中的行并滚到能看见；只在选择变化时做，不跟用户的收起较劲
  const revealSourceRef = useRef({ motors, plcs, structureView });
  revealSourceRef.current = { motors, plcs, structureView };
  const revealKey = `${treeFocus?.kind ?? ""}:${treeFocus?.id ?? ""}|${multiSelectedIds.join(",")}|${multiSelectedMotorIds.join(",")}`;
  useEffect(() => {
    const { motors: allMotors, plcs: allPlcs, structureView: view } = revealSourceRef.current;
    const ancestors = new Set<string>();
    const targets: string[] = [];
    const motorIds = new Set(multiSelectedMotorIds);
    if (treeFocus?.kind === "motor") motorIds.add(treeFocus.id);
    for (const motorId of motorIds) {
      const motor = allMotors.find((item) => item.id === motorId);
      if (!motor) continue;
      ancestors.add(String(motor.plcId));
      if (view === "masters") ancestors.add(getBusGroupTreeId(motor.plcId, motor.busNo));
      else if (motor.controlledObjectId != null) {
        ancestors.add(getLinkedCoTreeId(motor.plcId, motor.controlledObjectId));
      }
      targets.push(String(motor.id));
    }
    const objectIds = new Set(multiSelectedIds);
    if (treeFocus?.kind === "controlled-object") objectIds.add(treeFocus.id);
    for (const objectId of objectIds) {
      targets.push(String(objectId));
      if (view !== "all") continue;
      for (const plc of allPlcs) {
        if (allMotors.some((motor) => motor.plcId === plc.id && motor.controlledObjectId === objectId)) {
          ancestors.add(String(plc.id));
          targets.push(getLinkedCoTreeId(plc.id, objectId));
        }
      }
    }
    if (treeFocus?.kind === "master") targets.push(String(treeFocus.id));
    if (ancestors.size > 0) {
      setExpandedIds((current) => {
        if ([...ancestors].every((id) => current.has(id))) return current;
        return new Set([...current, ...ancestors]);
      });
    }
    if (targets.length === 0) return;
    const frame = requestAnimationFrame(() => {
      const root = treeScrollRef.current;
      if (!root) return;
      for (const id of targets) {
        const row = root.querySelector<HTMLElement>(`[data-tree-id="${CSS.escape(id)}"]`);
        if (row) {
          row.scrollIntoView?.({ block: "nearest" });
          return;
        }
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [revealKey]); // 只在选择本身变化时跟随（工程数据从 ref 读）

  const getStructureChildren = useCallback(
    (node: StructureTreeNode): StructureTreeNode[] | undefined => {
      if (node.kind === "linked-co") {
        const online = getPlcOnline(node.plcId);
        return getObjectMotorsForPlc(node.object.id, node.plcId).map((motor) =>
          buildMotorTreeNode(motor, online),
        );
      }
      if (node.kind === "plc") {
        const online = getPlcOnline(node.plc.id);

        // 主控视图：主控 → C口/D口分组 → 电机，扫到但工程里没有的实轴排在同口末尾
        if (structureView === "masters") {
          const plcMotors = getPlcMotors(node.plc.id);
          return BUS_NOS.filter(
            (busNo) =>
              plcMotors.some((motor) => motor.busNo === busNo) ||
              online.discovered.some((axis) => axis.busNo === busNo),
          ).map((busNo) => buildBusGroupTreeNode(node.plc.id, busNo));
        }

        return buildPlcTreeNodes(
          node.plc,
          getPlcUnassignedMotors(node.plc.id),
          getPlcLinkedObjects(node.plc.id),
          online,
        );
      }
      if (node.kind === "bus-group") {
        const online = getPlcOnline(node.plcId);
        return [
          ...getPlcMotors(node.plcId)
            .filter((motor) => motor.busNo === node.busNo)
            .map((motor) => buildMotorTreeNode(motor, online)),
          ...buildDiscoveredTreeNodes(node.plcId, online, node.busNo),
        ];
      }
      return undefined;
    },
    [
      getObjectMotorsForPlc,
      getPlcLinkedObjects,
      getPlcMotors,
      getPlcOnline,
      getPlcUnassignedMotors,
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
      if (showMountTree) {
        for (const { object } of mountTreeOrder) push(object.id);
      } else {
        for (const node of objectSectionNodes) push(node.object.id);
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
    mountTreeOrder,
    objectSectionNodes,
    plcNodes,
    showMastersSection,
    showMountTree,
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

  /** 加入一根实轴时，同口排在它前面的待加入实轴一起加入，电机才能按口内顺序对上实轴 */
  const handleAdoptDiscovered = useCallback(
    (plcId: number, axis: RealAxis) => {
      const axes = discoveredAxesThrough(getPlcOnline(plcId), axis);
      if (axes.length === 0) return;
      addMotorsFromScannedAxes(plcId, toScannedAxes(axes));
    },
    [addMotorsFromScannedAxes, getPlcOnline],
  );

  /** 拖动已多选的物体时整组挂载，否则只挂被拖的那个 */
  const mountDragIds = useCallback(
    (objectId: number): number[] =>
      multiSelectedIds.includes(objectId) ? multiSelectedIds : [objectId],
    [multiSelectedIds],
  );

  /** 受控物体视图：拖到物体中部 = 挂载到它；拖到上下沿 = 与它同级（根层即解除挂载） */
  const resolveObjectDropParent = useCallback(
    ({ dragNode, dropNode, dropPosition }: TreeDropArgs<StructurePanelNode>) => {
      if (!showMountTree || !isPendingCo(dragNode) || !isPendingCo(dropNode)) return undefined;
      return resolveMountDropParent(
        objects,
        mountDragIds(dragNode.object.id),
        dropNode.object.id,
        dropPosition,
      );
    },
    [mountDragIds, objects, showMountTree],
  );

  const handleCanDrop = useCallback(
    (args: TreeDropArgs<StructurePanelNode>) => {
      const { dragNode, dropNode, dropPosition } = args;
      if (isPendingCo(dragNode) && isPlcNode(dropNode) && dropPosition === "inside") {
        return true;
      }
      return resolveObjectDropParent(args) !== undefined;
    },
    [resolveObjectDropParent],
  );

  const handleDrop = useCallback(
    (args: TreeDropArgs<StructurePanelNode>) => {
      const { dragNode, dropNode, dropPosition } = args;
      if (isPendingCo(dragNode) && isPlcNode(dropNode) && dropPosition === "inside") {
        setTreeFocus({ kind: "master", id: dropNode.plc.id });
        return;
      }
      const parentId = resolveObjectDropParent(args);
      if (parentId === undefined || !isPendingCo(dragNode)) return;
      mountObjects(mountDragIds(dragNode.object.id), parentId);
      if (parentId != null) {
        setCollapsedObjectIds((current) => {
          if (!current.has(String(parentId))) return current;
          const next = new Set(current);
          next.delete(String(parentId));
          return next;
        });
      }
    },
    [mountDragIds, mountObjects, resolveObjectDropParent, setTreeFocus],
  );

  const getMotorRowProps = useCallback(
    (node: StructureTreeNode) => {
      if (node.kind !== "motor" || !canEdit) return undefined;
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
    [canEdit, multiSelectedMotorIds],
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
      const status = getPlcTreeStatus(getPlcOnline(node.plc.id));
      return <Cpu className={cn("h-3.5 w-3.5", STATUS_TEXT_CLASS[status.iconTone])} aria-hidden />;
    }
    if (node.kind === "bus-group") {
      return <span className="h-3.5 w-3.5 shrink-0" aria-hidden />;
    }
    if (node.kind === "discovered-motor") {
      return <Zap className="h-3.5 w-3.5 text-muted-foreground opacity-50" aria-hidden />;
    }
    if (node.kind === "motor") {
      const iconClass =
        node.status === "modelMismatch"
          ? "text-warning"
          : node.status === "online"
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
      const status = getPlcTreeStatus(getPlcOnline(node.plc.id));

      return (
        <>
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 py-1">
            <span className="min-w-0 truncate">{formatPlcDisplayName(plcs, node.plc)}</span>
            <span className="min-w-0 truncate font-mono text-mono-sm tabular-nums text-muted-foreground">
              {node.plc.ip || "—"}
            </span>
          </div>
          {status.label ? (
            <span className="shrink-0 font-mono text-mono-sm tabular-nums text-muted-foreground">
              {status.label}
            </span>
          ) : null}
        </>
      );
    }
    if (node.kind === "bus-group") {
      return <span className="min-w-0 truncate text-foreground">{node.label}</span>;
    }
    // 在线与否看图标颜色：绿在线、黄型号不符、灰离线 / 未扫描
    if (node.kind === "motor") {
      return (
        <span className="min-w-0 truncate font-mono tabular-nums">
          {formatMotorDisplayName(motors, node.motor)}
        </span>
      );
    }
    if (node.kind === "discovered-motor") {
      const unknownModel = node.axis.productModel === null;
      return (
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-muted-foreground">
          <span className="shrink-0 font-mono text-mono-sm tabular-nums">{node.label}</span>
          <span className={`min-w-0 truncate text-body-sm ${unknownModel ? "text-warning" : ""}`}>
            {node.modelLabel}
          </span>
        </span>
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
          next.add(getLinkedCoTreeId(plcId, objectId));
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
      if (!canEdit) return null;
      return (
        <button
          type="button"
          aria-label={`加入工程 ${node.label}`}
          className="inline-flex h-7 shrink-0 items-center rounded-sm px-2 text-body-sm text-primary hover:bg-muted pointer-coarse:h-11"
          onClick={(event) => {
            event.stopPropagation();
            handleAdoptDiscovered(node.plcId, node.axis);
          }}
        >
          加入
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
    if (node.kind !== "plc" || !canEdit) return null;
    return (
      <button
        data-guide="console-real-axis-add"
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
          <ContextMenuItem onSelect={() => handleAdoptDiscovered(node.plcId, node.axis)}>
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
            data-guide="console-real-axis-delete"
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
          data-guide="console-master-delete"
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
    // C口 / D口 只是分组：点它展开 / 收起，不动选择
    if (node.kind === "bus-group") {
      const id = getBusGroupTreeId(node.plcId, node.busNo);
      setExpandedIds((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
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
    // motor — 单击选中（再点不取消）；未连接限制仅在调试 Tab
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
    replaceMotorSelection([node.motor.id]);
    setTreeFocus({ kind: "motor", id: node.motor.id });
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-row overflow-hidden">
      <div
        ref={treeScrollRef}
        className="custom-scrollbar flex min-h-0 w-[280px] shrink-0 flex-col overflow-y-auto bg-card"
      >
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
                  getChildren={getObjectSectionChildren}
                  expandedIds={showMountTree ? objectSectionExpandedIds : new Set()}
                  onExpandedChange={showMountTree ? handleObjectSectionExpandedChange : () => {}}
                  selectedIds={selectedIds}
                  onClearSelection={clearTreeSelection}
                  onSelect={(node, event) =>
                    handleCoSelect(
                      event,
                      node.object.id,
                      select,
                      toggleMulti,
                      replaceSelection,
                      setTreeFocus,
                      multiSelectedIds,
                      orderedObjectIds,
                    )
                  }
                  onDelete={canEdit ? handlePendingObjectDeleteKey : undefined}
                  renderLabel={(node) => (
                    <span className="min-w-0 truncate">{node.object.name}</span>
                  )}
                  renderIcon={() => <Box className="h-3.5 w-3.5" aria-hidden />}
                  renderContextMenu={canEdit ? (node) => (
                    <ContextMenuContent>
                      {node.object.parentId != null ? (
                        <ContextMenuItem onSelect={() => mountObjects([node.object.id], null)}>
                          解除挂载
                        </ContextMenuItem>
                      ) : null}
                      <ContextMenuItem
                        variant="destructive"
                        onSelect={() => requestObjectDelete(node.object.id)}
                      >
                        删除
                      </ContextMenuItem>
                    </ContextMenuContent>
                  ) : undefined}
                  dndIdPrefix="pending-co"
                  dndContext="none"
                  draggable={canEdit}
                  droppable={canEdit && showMountTree}
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
                    {/* 扫描只读网络，不改工程：只读时也能刷新在线状态 */}
                    <button
                      data-guide="console-master-scan"
                      type="button"
                      aria-label={scan.error ? `扫描主控（${scan.error}）` : "扫描主控"}
                      aria-busy={masterScan.scanning}
                      disabled={masterScan.scanning}
                      className={cn(
                        iconBtn,
                        "relative bg-primary text-primary-foreground hover:text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-40",
                      )}
                      title={scan.error ?? "扫描主控"}
                      onClick={masterScan.startScan}
                    >
                      {masterScan.scanning ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      ) : (
                        <ScanLine className="h-3.5 w-3.5" aria-hidden />
                      )}
                      {/* 上次扫描失败：按钮角上一个黄点，再点一次就是重试 */}
                      {scan.error && !masterScan.scanning ? (
                        <span
                          className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-warning ring-2 ring-muted"
                          aria-hidden
                        />
                      ) : null}
                    </button>
                    {canEdit ? (
                      <button
                        data-guide="console-master-add"
                        type="button"
                        aria-label="添加主控"
                        className={iconBtn}
                        title="添加主控"
                        onClick={() => setPlcAddOpen(true)}
                      >
                        <Plus className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    ) : null}
                  </div>
                }
              />
              <TreeView
                data-guide="console-master-tree"
                nodes={plcNodes}
                getNodeId={getStructureNodeId}
                getChildren={getStructureChildren}
                expandedIds={expandedIds}
                onExpandedChange={setExpandedIds}
                selectedIds={selectedIds}
                onClearSelection={clearTreeSelection}
                onSelect={handleStructureSelect}
                onDelete={canEdit ? handleStructureDeleteKey : undefined}
                renderLabel={renderStructureLabel}
                renderIcon={renderStructureIcon}
                renderExtra={renderStructureExtra}
                renderContextMenu={canEdit ? renderStructureContextMenu : undefined}
                getRowProps={getMotorRowProps}
                dndIdPrefix="plc-tree"
                dndContext="none"
                droppable={(node) => canEdit && structureView === "all" && node.kind === "plc"}
                dropHighlight={dropHighlight}
                aria-label="主控结构"
              />
            </>
          ) : null}
          {/* 点树下面的空白处取消选择 */}
          <div className="min-h-12 flex-1" aria-hidden onClick={clearTreeSelection} />
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

      <PlcScanDialog open={masterScan.resultsOpen} onOpenChange={masterScan.setResultsOpen} />
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
