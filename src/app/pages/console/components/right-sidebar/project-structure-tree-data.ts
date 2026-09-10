import type {
  BusNo,
  ControlledObject,
  Motor,
  Plc,
} from "@/app/pages/console/components/right-sidebar/config-wizard/config-wizard-types";
import { busNoLabel } from "@/app/pages/console/hooks/motor-bus";
import type { MotorOrderReconciliation } from "@/app/pages/console/hooks/plc-reconciliation";
import type { PlcRuntimeState } from "@/app/pages/console/hooks/plc-runtime-types";
import { formatMotorDisplayName } from "@/app/pages/console/hooks/motor-mid";
import { formatPlcDisplayName } from "@/app/pages/console/hooks/plc-display-name";

export type PlcTreeStatusTone = "muted" | "primary" | "show" | "warning";

export type PlcTreeStatus = {
  tone: PlcTreeStatusTone;
  label: string;
};

export type MotorTreeStatus = "connected" | "modelMismatch" | "portMismatch" | "missing";

export type DiscoveredMotorTreeStatus = "pending";

export type PendingCoNode = { kind: "pending-co"; object: ControlledObject };

export type PlcTreeNode = { kind: "plc"; plc: Plc };

export type MotorTreeNode = {
  kind: "motor";
  motor: Motor;
  status?: MotorTreeStatus;
};

/** 主控 Tab 下从站口分组（C口 / D口） */
export type BusGroupTreeNode = {
  kind: "bus-group";
  plcId: number;
  busNo: BusNo;
  label: string;
};

export type DiscoveredMotorTreeNode = {
  kind: "discovered-motor";
  plcId: number;
  discoveredId: string;
  label: string;
  slaveNo: number;
  busNo: number;
  gourdNo: number;
};

export type LinkedCoTreeNode = {
  kind: "linked-co";
  object: ControlledObject;
  plcId: number;
};

export type StructureTreeNode =
  | PlcTreeNode
  | BusGroupTreeNode
  | MotorTreeNode
  | DiscoveredMotorTreeNode
  | LinkedCoTreeNode;

export const getDiscoveredMotorTreeId = (plcId: number, discoveredId: string): string =>
  `discovered:${plcId}:${discoveredId}`;

export const getBusGroupTreeId = (plcId: number, busNo: BusNo): string =>
  `bus:${plcId}:${busNo}`;

export const buildBusGroupTreeNode = (plcId: number, busNo: BusNo): BusGroupTreeNode => ({
  kind: "bus-group",
  plcId,
  busNo,
  label: busNoLabel(busNo),
});

export const getPlcTreeStatus = (
  runtime: Pick<PlcRuntimeState, "connection" | "modelMismatch">,
  configuredCount: number,
  actualCount: number,
): PlcTreeStatus => {
  switch (runtime.connection) {
    case "disconnected":
      return { tone: "muted", label: "离线" };
    case "connecting":
      return { tone: "primary", label: "连接中" };
    case "connected":
      if (runtime.modelMismatch) return { tone: "warning", label: "型号不匹配" };
      return { tone: "show", label: `${actualCount} / ${configuredCount}` };
    case "abnormal":
      return { tone: "warning", label: `${actualCount} / ${configuredCount}` };
  }
};

export const buildPlcTreeNodes = (
  plc: Plc,
  motors: Motor[],
  linkedObjects: ControlledObject[],
  reconciliation: MotorOrderReconciliation,
): StructureTreeNode[] => {
  const onlineIds = new Set(reconciliation.online.map((i) => i.motor.id));
  const modelMismatchIds = new Set(reconciliation.modelMismatch.map((i) => i.motor.id));
  const portMismatchIds = new Set(reconciliation.portMismatch.map((i) => i.motor.id));
  const offlineIds = new Set(reconciliation.offline.map((i) => i.id));

  const motorNodes: MotorTreeNode[] = motors.map((motor) => ({
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
  }));

  const discoveredNodes: DiscoveredMotorTreeNode[] = reconciliation.discoveredOnly.map(
    (axis) => ({
      kind: "discovered-motor",
      plcId: plc.id,
      discoveredId: String(axis.slaveNo),
      label: `从站#${axis.slaveNo} · ${busNoLabel(axis.busNo as 0 | 1)}`,
      slaveNo: axis.slaveNo,
      busNo: axis.busNo,
      gourdNo: axis.gourdNo,
    }),
  );

  const objectNodes: LinkedCoTreeNode[] = linkedObjects.map((object) => ({
    kind: "linked-co",
    object,
    plcId: plc.id,
  }));

  return [...motorNodes, ...discoveredNodes, ...objectNodes];
};

export const getStructureNodeId = (
  node: StructureTreeNode | PendingCoNode,
): string => {
  switch (node.kind) {
    case "pending-co":
      return String(node.object.id);
    case "plc":
      return String(node.plc.id);
    case "bus-group":
      return getBusGroupTreeId(node.plcId, node.busNo);
    case "motor":
      return String(node.motor.id);
    case "discovered-motor":
      return getDiscoveredMotorTreeId(node.plcId, node.discoveredId);
    case "linked-co":
      return String(node.object.id);
  }
};

export type DeleteImpact = {
  confirmLabel: string;
  /** 一行摘要，多选时只展示数量 */
  summary: string;
  requiresConfirmation: boolean;
};

export type DeleteTarget =
  | { kind: "motor"; motorId: number }
  | { kind: "motors"; motorIds: number[] }
  | { kind: "plc"; plcId: number }
  | { kind: "object"; objectId: number }
  | { kind: "objects"; objectIds: number[] };

type DeleteContext = {
  objects: ControlledObject[];
  motors: Motor[];
  plcs: Plc[];
};

export const computeDeleteImpact = (
  target: DeleteTarget,
  context: DeleteContext,
): DeleteImpact | null => {
  if (target.kind === "motor") {
    const motor = context.motors.find((item) => item.id === target.motorId);
    if (!motor) return null;

    const bound = motor.controlledObjectId != null;
    return {
      confirmLabel: "删除",
      summary: bound
        ? `将删除「${formatMotorDisplayName(context.motors, motor)}」。已绑定受控物体将先解绑。`
        : `将删除「${formatMotorDisplayName(context.motors, motor)}」。`,
      requiresConfirmation: bound,
    };
  }

  if (target.kind === "motors") {
    const ids = [...new Set(target.motorIds)];
    if (ids.length === 0) return null;
    if (ids.length === 1) {
      return computeDeleteImpact({ kind: "motor", motorId: ids[0]! }, context);
    }

    const boundCount = ids.filter((motorId) =>
      context.motors.find((motor) => motor.id === motorId)?.controlledObjectId != null,
    ).length;

    return {
      confirmLabel: "删除",
      summary:
        boundCount > 0
          ? `将删除 ${ids.length} 个电机（${boundCount} 个已绑定，将先解绑）。`
          : `将删除 ${ids.length} 个电机。`,
      requiresConfirmation: true,
    };
  }

  if (target.kind === "objects") {
    const ids = [...new Set(target.objectIds)];
    if (ids.length === 0) return null;
    if (ids.length === 1) {
      return computeDeleteImpact({ kind: "object", objectId: ids[0]! }, context);
    }

    const boundCount = ids.filter((objectId) =>
      context.motors.some((motor) => motor.controlledObjectId === objectId),
    ).length;

    return {
      confirmLabel: "删除",
      summary:
        boundCount > 0
          ? `将删除 ${ids.length} 个受控物体（${boundCount} 个已绑定，将先解绑）。`
          : `将删除 ${ids.length} 个受控物体。`,
      requiresConfirmation: true,
    };
  }

  if (target.kind === "object") {
    const object = context.objects.find((item) => item.id === target.objectId);
    if (!object) return null;

    const boundMotorCount = context.motors.filter(
      (motor) => motor.controlledObjectId === object.id,
    ).length;

    return {
      confirmLabel: "删除",
      summary:
        boundMotorCount > 0
          ? `将删除「${object.name}」。将先解绑 ${boundMotorCount} 个电机。`
          : `将删除「${object.name}」。`,
      requiresConfirmation: true,
    };
  }

  const plc = context.plcs.find((item) => item.id === target.plcId);
  if (!plc) return null;

  const plcMotors = context.motors.filter((motor) => motor.plcId === plc.id);
  const boundObjectCount = new Set(
    plcMotors
      .map((motor) => motor.controlledObjectId)
      .filter((objectId): objectId is number => objectId != null),
  ).size;

  const motorPart =
    plcMotors.length > 0 ? `及 ${plcMotors.length} 个电机` : "";
  const unbindPart =
    boundObjectCount > 0
      ? `将先解绑 ${boundObjectCount} 个受控物体。`
      : "";

  return {
    confirmLabel: "删除",
    summary: `将删除「${formatPlcDisplayName(context.plcs, plc)}」${motorPart}。${unbindPart}`.trim(),
    requiresConfirmation: plcMotors.length > 0 || boundObjectCount > 0,
  };
};

export const deleteImpactRequiresConfirmation = (impact: DeleteImpact): boolean =>
  impact.requiresConfirmation;
