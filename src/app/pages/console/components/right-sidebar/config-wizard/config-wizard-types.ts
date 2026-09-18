export type { WizardMeta, WizardStepKey } from "@/app/project/project-document-types";
export type {
  MountLayout,
  MountLayoutCircle,
  MountLayoutCustom,
  MountLayoutLine,
} from "@/app/project/project-document-types";
export type {
  ControlType,
  MotionAxisKind,
  MotionAxisParams,
  PlcProtocol,
  ShapeDimensions,
  ShapePresetId,
} from "@/app/project/configuration-types";
export type { MotionSpeedControl } from "@/app/project/motion-speed";

import type {
  ControlType,
  MotionAxisKind,
  MotionAxisParams,
  ShapeDimensions,
  ShapePresetId,
} from "@/app/project/configuration-types";
import type { MountLayout } from "@/app/project/project-document-types";
import type { MotionSpeedControl } from "@/app/project/motion-speed";
import type { ScannedAxis } from "@/app/pages/console/hooks/plc-runtime-types";

export type WizardStepState = "pending" | "current" | "done" | "skipped";

/** 吊点 XZ 偏移，单位 mm */
export type AxisMount = { x: number; z: number };

export type AxisDefinition = {
  key: string;
  /** 用户手动添加的轴（非控制类型模板） */
  custom: boolean;
  mount: AxisMount;
};

export type ControlledObject = {
  id: number;
  name: string;
  controlType: ControlType;
  shapePreset: ShapePresetId;
  /** 形状语义尺寸，长度字段单位 mm */
  shapeDimensions: ShapeDimensions;
  /** 包围盒尺寸，单位 mm */
  dimensions: { w: number; h: number; d: number };
  /** 世界坐标，单位 mm */
  position: { x: number; y: number; z: number };
  /** 3D 模型变换中心相对几何中心的局部偏移，单位 mm；不改变吊点/运动基准 */
  centerOffset: { x: number; y: number; z: number };
  /** 模型朝向欧拉角，单位 deg，0–360；Babylon 顺序 XYZ */
  rotation: { x: number; y: number; z: number };
  color: string;
  motionParams?: Partial<Record<MotionAxisKind, MotionAxisParams>>;
  motionSpeedControl?: MotionSpeedControl;
  /** 最大轴速度，速度比例基准；不是虚轴 1 运行上限 */
  maxAxisVelocity: number;
  /** 虚轴 2 最大速度（°/s）；启用 v2 时必有 */
  pDefaultMaxVelocity?: number;
  /** 虚轴 3 最大速度（°/s）；启用 v3 时必有 */
  yDefaultMaxVelocity?: number;
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
  axes: AxisDefinition[];
  modelId?: string;
  /** 扩展属性占位；后续扩展使用 */
  params: Record<string, number>;
};

export type Plc = {
  id: number;
  /** 描述文件 device.id，如 AC802_0 */
  masterTypeId: string;
  ip: string;
  status: "online" | "offline";
};

/** 从站口：0=C口，1=D口（对齐 PLC 描述 busNo） */
export type BusNo = 0 | 1;

export type Motor = {
  /** 工程内与 PLC/物体全局互斥的实体 id（1~65535）；显示名派生为 {型号 name}-{C|D}-{同口序号} */
  id: number;
  /** 描述文件关联键 = device.id（如 YZ_AXIS_HOIST_500KG） */
  productModel: string;
  plcId: number;
  /** 从站口归属：0=C口，1=D口 */
  busNo: BusNo;
  /** 轴类型：0=线性轴，1=无极旋转轴（基础信息，不进 params） */
  axisType: 0 | 1;
  nodeAddress: string | null;
  discoveryId?: string | null;
  selected: boolean;
  controlledObjectId: number | null;
  axisKey: string | null;
  params: Record<string, number | boolean | string>;
};

export type PlcInput = {
  ip: string;
  masterTypeId: string;
};
export type MotorInput = Pick<Motor, "productModel" | "plcId"> & {
  busNo?: BusNo;
  /** 省略则默认线性轴（0）；绑定吊点后由物体控制类型覆盖 */
  axisType?: Motor["axisType"];
};

export type PlcScanResult = {
  id: string;
  ip: string;
  plcModel: number;
  axis: ScannedAxis[];
};

export type MotorScanResult = {
  id: string;
  nodeAddress: string;
  productModel: string;
  plcId: number;
};
