import type { ControlType } from "@/app/project/configuration-types";
import type { VirtualAxisId, VirtualAxisValues } from "../types";

/**
 * 动作页 3D 位姿手柄，一根虚轴一个：
 * 虚轴 1 为 lift 升降箭头或 yaw 旋转环；虚轴 2 为 tiltX 摆动 X 弧；
 * 虚轴 3 为 tiltY 摆动 Y 弧（多点倾斜）或 heading 偏转环（多点摆的倾斜方向）。
 * 每台物体同时只出一个，按当前选的虚轴（手柄旁的切换、数字键 1/2/3）。
 */
export type PoseHandleKind = "lift" | "yaw" | "tiltX" | "tiltY" | "heading";

/** 每种手柄改哪根轴 */
export const POSE_HANDLE_AXES: Record<PoseHandleKind, readonly VirtualAxisId[]> = {
  lift: ["v1"],
  yaw: ["v1"],
  tiltX: ["v2"],
  tiltY: ["v3"],
  heading: ["v3"],
};

/** 手柄改的那根轴 */
export const poseHandleAxisOf = (kind: PoseHandleKind): VirtualAxisId => POSE_HANDLE_AXES[kind][0]!;

const KINDS_BY_CONTROL_TYPE: Record<ControlType, readonly PoseHandleKind[]> = {
  singlePointMove: ["lift"],
  multiLevelHoist: ["lift"],
  singlePointRotation: ["yaw"],
  continuousRotation: ["yaw"],
  dualTiltFourPointSwing: ["lift", "tiltX", "tiltY"],
  multiPointSwing: ["lift", "tiltX", "heading"],
  railCar: [],
  staticProp: [],
};

/** 这类物体在 3D 里有哪些手柄；缺了某根轴（没启用）的手柄不出 */
export const poseHandleKindsFor = (
  controlType: ControlType,
  enabledAxes?: readonly VirtualAxisId[],
): PoseHandleKind[] =>
  KINDS_BY_CONTROL_TYPE[controlType].filter(
    (kind) => enabledAxes === undefined || POSE_HANDLE_AXES[kind].every((axis) => enabledAxes.includes(axis)),
  );

export type PoseHandleAxisRange = { min: number; max: number };

/** 拖动时手柄旁的数值：轴名、值、相对拖动开始的变化量 */
export type PoseHandleDescribe = (axis: VirtualAxisId, value: number, delta: number) => string;

/** 一台物体的手柄 */
export type PoseHandleTarget = {
  /** 引擎里的物体 id */
  objectId: string;
  kinds: readonly PoseHandleKind[];
  /** 手柄对应的虚轴值（位姿的值；位姿里不设定的轴取 3D 正在显示的值），拖动从这里起算 */
  values: VirtualAxisValues;
  /** 行程：拖到头时手柄变色、数值停在头上 */
  ranges?: Partial<Record<VirtualAxisId, PoseHandleAxisRange>>;
  /** 联机：手柄挂在 GO 影子上（父物体也有影子时按父物体的影子算） */
  onShadow?: boolean;
  /** 拖不了的原因：手柄画成虚的，按下时提示 */
  blockedReason?: string | null;
  describe?: PoseHandleDescribe;
  /** 手柄切换上各虚轴的名字（升降、摆动 X……）；没有时写「虚轴 n」 */
  axisLabels?: Partial<Record<VirtualAxisId, string>>;
};

export type PoseHandleValues = Partial<Record<VirtualAxisId, number>>;

export type PoseHandleUpdate = { objectId: string; values: PoseHandleValues };

export type PoseHandleDragStartEvent = {
  kind: PoseHandleKind;
  /** 按住的那台 */
  objectId: string;
  /** 一起动的物体（同一种手柄），按住的那台在最前 */
  objectIds: string[];
};

export type PoseHandleDragEvent = {
  kind: PoseHandleKind;
  objectId: string;
  /** 每台物体拖到的值（没按行程截断；写入时截断） */
  updates: PoseHandleUpdate[];
};

export type PoseHandleDragEndEvent = { cancelled: boolean };

export type PoseHandleBlockedEvent = { objectId: string; reason: string };
