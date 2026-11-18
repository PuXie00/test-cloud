import type {
  BusNo,
  ControlledObject,
  Motor,
  Plc,
} from "@/app/pages/console/components/right-sidebar/config-wizard/config-wizard-types";
import { busNoLabel } from "@/app/pages/console/hooks/motor-bus";
import {
  formatRealAxisModel,
  formatRealAxisPosition,
  type MotorOnlineStatus,
  type PlcOnline,
  type RealAxis,
} from "@/app/pages/console/hooks/plc-online";
import { formatMotorDisplayName } from "@/app/pages/console/hooks/motor-mid";
import { formatPlcDisplayName } from "@/app/pages/console/hooks/plc-display-name";

export type PlcTreeStatusTone = "muted" | "primary" | "show" | "warning";

export type PlcTreeStatus = {
  /** 主控图标颜色：在线绿、型号不匹配黄、离线 / 未扫描灰 */
  iconTone: PlcTreeStatusTone;
  /** 在线时行尾的「实轴 / 配置」；其余不写字，看图标 */
  label: string | null;
};

export type PendingCoNode = { kind: "pending-co"; object: ControlledObject };

export type PlcTreeNode = { kind: "plc"; plc: Plc };

export type MotorTreeNode = {
  kind: "motor";
  motor: Motor;
  /** 按扫描到的实轴对出来的状态 */
  status?: MotorOnlineStatus;
  /** 对应的实轴 */
  axis?: RealAxis | null;
};

/** 主控 Tab 下从站口分组（C口 / D口） */
export type BusGroupTreeNode = {
  kind: "bus-group";
  plcId: number;
  busNo: BusNo;
  label: string;
};

/** 扫描到、工程里还没有的实轴 */
export type DiscoveredMotorTreeNode = {
  kind: "discovered-motor";
  plcId: number;
  axis: RealAxis;
  /** C-3 */
  label: string;
  /** 实轴型号显示名 */
  modelLabel: string;
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

export const getDiscoveredMotorTreeId = (plcId: number, axis: Pick<RealAxis, "busNo" | "index">): string =>
  `discovered:${plcId}:${axis.busNo}:${axis.index}`;

/** 同一个物体可能挂在几个主控下面，行 id 要带上主控 */
export const getLinkedCoTreeId = (plcId: number, objectId: number): string =>
  `co:${plcId}:${objectId}`;

export const getBusGroupTreeId = (plcId: number, busNo: BusNo): string =>
  `bus:${plcId}:${busNo}`;

export const buildBusGroupTreeNode = (plcId: number, busNo: BusNo): BusGroupTreeNode => ({
  kind: "bus-group",
  plcId,
  busNo,
  label: busNoLabel(busNo),
});

/** 主控行的在线显示：只看扫描结果（扫到 IP 即在线），与主控连接状态无关 */
export const getPlcTreeStatus = (online: PlcOnline): PlcTreeStatus => {
  if (online.kind !== "online") return { iconTone: "muted", label: null };
  return {
    iconTone: online.modelMatch ? "show" : "warning",
    label: `${online.realAxisCount} / ${online.configuredCount}`,
  };
};

export const buildMotorTreeNode = (motor: Motor, online: PlcOnline | undefined): MotorTreeNode => {
  const entry = online?.motorById.get(motor.id);
  return {
    kind: "motor",
    motor,
    status: entry?.status ?? "unknown",
    axis: entry?.axis ?? null,
  };
};

export const buildDiscoveredTreeNodes = (
  plcId: number,
  online: PlcOnline | undefined,
  busNo?: BusNo,
): DiscoveredMotorTreeNode[] =>
  (online?.discovered ?? [])
    .filter((axis) => busNo === undefined || axis.busNo === busNo)
    .map((axis) => ({
      kind: "discovered-motor",
      plcId,
      axis,
      label: formatRealAxisPosition(axis),
      modelLabel: formatRealAxisModel(axis),
    }));

export const buildPlcTreeNodes = (
  plc: Plc,
  motors: Motor[],
  linkedObjects: ControlledObject[],
  online: PlcOnline | undefined,
): StructureTreeNode[] => {
  const motorNodes = motors.map((motor) => buildMotorTreeNode(motor, online));
  const discoveredNodes = buildDiscoveredTreeNodes(plc.id, online);
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
      return getDiscoveredMotorTreeId(node.plcId, node.axis);
    case "linked-co":
      return getLinkedCoTreeId(node.plcId, node.object.id);
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
