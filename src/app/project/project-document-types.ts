/** 工程文件 schema，试验版 — 见 docs/superpowers/specs/2026-06-04-project-document-design.md */
import type {
  ControlType,
  MotionAxisKind,
  MotionAxisParams,
  PlcProtocol,
  ShapeDimensions,
  ShapePresetId,
} from "./configuration-types";
import type { ControlTypeCode } from "./control-type-code";
import type { MotionSpeedControl } from "./motion-speed";
import type { SavedView } from "./saved-view";

export type { SavedView } from "./saved-view";
export type { ControlTypeCode } from "./control-type-code";

export type {
  ControlType,
  MotionAxisKind,
  MotionAxisParams,
  PlcProtocol,
  ShapeDimensions,
  ShapePresetId,
} from "./configuration-types";

export const PROJECT_SCHEMA_VERSION = "1.3.0-draft" as const;

export type ProjectSchemaVersion = typeof PROJECT_SCHEMA_VERSION;

export type ProjectStatus = "active" | "draft" | "archived";

export type WizardStepKey = "objects" | "hardware" | "binding" | "review";

export type WizardMeta = {
  currentStep: WizardStepKey;
  completedSteps: WizardStepKey[];
  skippedSteps: WizardStepKey[];
  simulationOnly: boolean;
  wizardCompleted: boolean;
};

export type ProjectMeta = {
  id: string;
  name: string;
  createdAt: string;
  modifiedAt: string;
  author: string;
  status?: ProjectStatus;
  note?: string;
  tags?: string[];
  wizard: WizardMeta;
};

export type PlcConfig = {
  /** 工程内与电机/物体全局互斥的实体 id（1~65535） */
  id: number;
  /** 描述文件 device.id，如 AC802_0 */
  masterTypeId: string;
  ip: string;
};

/** 从站口：0=C口，1=D口（对齐 PLC 描述 busNo） */
export type BusNo = 0 | 1;

export type MotorConfig = {
  /** 工程内与 PLC/物体全局互斥的实体 id（1~65535）；显示名派生为 {型号 name}-{C|D}-{同口序号} */
  id: number;
  /** 描述文件关联键 = device.id（如 YZ_AXIS_HOIST_500KG） */
  productModel: string;
  plcId: number;
  /** 从站口归属：0=C口，1=D口 */
  busNo: BusNo;
  /** 轴类型：0=线性轴，1=无极旋转轴 */
  axisType: 0 | 1;
  nodeAddress: string | null;
  discoveryId?: string | null;
  controlledObjectId: number | null;
  axisKey: string | null;
  params: Record<string, number | boolean | string>;
};

/** 耦合操作维度：v1 升降/旋转（长度 mm；旋转型为 °）, v2 摆动X °, v3 摆动Y/偏转 ° */
export type VirtualAxisId = "v1" | "v2" | "v3";

export type VirtualAxisValues = Partial<Record<VirtualAxisId, number>>;

export type VirtualAxisJogParams = {
  /** 点动速度（虚轴单位/s：mm/s 或 °/s） */
  velocity: number;
  /** 加减速时间（秒），加减速同值 */
  accelDecelTime: number;
};

export type ManualJogSettings = Partial<Record<VirtualAxisId, VirtualAxisJogParams>>;

export type DriveAxisBinding = {
  /** 物体内唯一索引字符串（"0","1",…）；驱动轴均为升降吊点 */
  key: string;
  custom?: boolean;
  /** 相对物体几何中心的 XZ 偏移，单位 mm */
  mount?: { x: number; z: number };
};

/** 多点吊点布局：缺失时按 custom */
export type MountLayoutCustom = { kind: "custom" };

export type MountLayoutCircle = {
  kind: "circle";
  /** 吊点圆半径，单位 mm；圆心为物体原点 */
  radius: number;
  /**
   * 相邻吊点弦长，单位 mm；长度 = N
   * chordLengths[i] = 吊(i+1) → 吊(i+2)，最后一项为 吊N → 吊1
   */
  chordLengths: number[];
};

export type MountLayoutLine = {
  kind: "line";
  /**
   * 相邻吊点间距，单位 mm；长度 = N - 1（开放链，不首尾闭合）
   * spacings[i] = 吊(i+1) → 吊(i+2)
   */
  spacings: number[];
};

export type MountLayout = MountLayoutCustom | MountLayoutCircle | MountLayoutLine;

export type AlignmentMethod = "distance" | "calibrate";
export type AlignmentStatus = "not_started" | "in_progress" | "aligned";

export type AlignmentRecord = {
  method: AlignmentMethod | null;
  status: AlignmentStatus;
  alignedAt: string | null;
};

export type ControlledObjectConfig = {
  /** 工程内与 PLC/电机全局互斥的实体 id（1~65535） */
  id: number;
  name: string;
  /** 控制类型数字码（见 control-type-code.ts） */
  controlType: ControlTypeCode;
  enabledVirtualAxes: VirtualAxisId[];
  shapePreset: ShapePresetId;
  /** 形状语义尺寸，长度字段单位 mm */
  shapeDimensions: ShapeDimensions;
  modelId?: string;
  /** 引擎包围盒尺寸，单位 mm */
  dimensions: { w: number; h: number; d: number };
  /** 世界坐标，单位 mm */
  position: { x: number; y: number; z: number };
  /** 3D 模型变换中心相对几何中心的局部偏移，单位 mm；不改变吊点/运动基准 */
  centerOffset: { x: number; y: number; z: number };
  /** 模型朝向欧拉角，单位 deg，0–360 */
  rotation: { x: number; y: number; z: number };
  color: string;
  parentId?: string | null;
  /** 原点到滑轮距离（轴链条最短长度），单位 mm */
  pulleyDistance: number;
  /** 模型运行方向：1 正向，2 反向 */
  modelRunDirection: 1 | 2;
  /** 安全范围半径，单位 mm；仅多点摆必填 */
  safetyRadius?: number;
  /** 初始倾斜角度，单位 deg，0–360；仅多点摆必填 */
  initialTiltDirection?: number;
  /** 吊点整体旋转，单位 deg，0–360；仅多点摆；缺省 0 */
  mountRotation?: number;
  /** 多点吊点布局参数；缺失按 custom */
  mountLayout?: MountLayout;
  driveAxes: DriveAxisBinding[];
  motionParams: Partial<Record<MotionAxisKind, MotionAxisParams>>;
  /** 最大轴速度，速度比例基准；不是虚轴 1 运行上限 */
  maxAxisVelocity: number;
  /** 虚轴 2 最大速度（°/s）；启用 v2 时必有 */
  pDefaultMaxVelocity?: number;
  /** 虚轴 3 最大速度（°/s）；启用 v3 时必有 */
  yDefaultMaxVelocity?: number;
  motionSpeedControl?: MotionSpeedControl;
  /** 扩展属性占位；后续扩展使用 */
  params: Record<string, number>;
};

export type SceneGroupConfig = {
  id: string;
  name: string;
  objectIds: number[];
};

export type SceneConfig = {
  groups?: SceneGroupConfig[];
};

export type ProjectSetup = {
  plcs: PlcConfig[];
  motors: MotorConfig[];
  controlledObjects: ControlledObjectConfig[];
  alignment: Record<string, AlignmentRecord>;
  scene?: SceneConfig;
  /** 手动点动参数（工程级按虚轴）；不属于受控物体配置 */
  manualJog?: ManualJogSettings;
};

import type {
  ActionSequenceConfig,
  DynamicPresetBlock,
  InstructionBlock,
  ModelPose,
  MotionProfile,
  MotionSegmentConfig,
  MotionSegmentSettings,
  PoseBlock,
  PresetBlockBase,
  PresetParamValue,
  SetEnabledInstruction,
  StaticPresetBlock,
  TimelineBlock,
  TrapezoidAxisProfile,
} from "./action-sequence/types";

export type {
  ActionSequenceConfig,
  DynamicPresetBlock,
  InstructionBlock,
  ModelPose,
  MotionProfile,
  MotionSegmentConfig,
  MotionSegmentSettings,
  PoseBlock,
  PresetBlockBase,
  PresetParamValue,
  SetEnabledInstruction,
  StaticPresetBlock,
  TimelineBlock,
  TrapezoidAxisProfile,
};

export type ProgramItemRef = {
  kind: "sequence";
  refId: number;
};

export const isSequenceProgramItemRef = (item: unknown): item is ProgramItemRef => {
  if (typeof item !== "object" || item === null) return false;
  const rec = item as { kind?: unknown; refId?: unknown };
  return rec.kind === "sequence" && typeof rec.refId === "number" && Number.isInteger(rec.refId);
};

export type ProgramChapterConfig = {
  id: string;
  name: string;
  note?: string;
  items: ProgramItemRef[];
};

export type ProgramConfig = {
  id: string;
  name: string;
  note?: string;
  chapters: ProgramChapterConfig[];
};

export type ProjectMotion = {
  actionSequences: ActionSequenceConfig[];
  programs: ProgramConfig[];
};

export type RuleConfigPlaceholder = {
  id: string;
  name: string;
  enabled: boolean;
  note?: string;
};

export type ProjectRules = {
  rules: RuleConfigPlaceholder[];
};

export type CurrentProjectSnapshotPayload = {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  meta: ProjectMeta;
  setup: ProjectSetup;
  motion: ProjectMotion;
  rules: ProjectRules;
};

export type ProjectSnapshotPayload = CurrentProjectSnapshotPayload;

export type ProjectSnapshot = {
  id: string;
  label: string;
  createdAt: string;
  author?: string;
  note?: string;
  payload: CurrentProjectSnapshotPayload;
};

export type ProjectDocument = {
  schemaVersion: ProjectSchemaVersion;
  meta: ProjectMeta;
  setup: ProjectSetup;
  motion: ProjectMotion;
  rules: ProjectRules;
  /** 主视口相机；缺省由新建工程补齐 */
  view: SavedView;
  snapshots: ProjectSnapshot[];
};
