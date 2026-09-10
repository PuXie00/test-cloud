import type { MotionAxisKind } from "@/app/project/configuration-types";
import type { VirtualAxisId, VirtualAxisValues } from "@/app/project/project-document-types";

export type Vec3 = { x: number; y: number; z: number };

export type SlotRect = { left: number; top: number; width: number; height: number };

export type Disposable = { dispose: () => void };

export type Viz3DColorKey =
  | "canvas"
  | "background"
  | "muted"
  | "primary"
  | "show"
  | "secondary"
  | "warning"
  | "destructive"
  | "foreground"
  | "mutedForeground"
  | "border";

export type Viz3DColorMap = Record<Viz3DColorKey, number>;

/** 地面网格总尺寸（米），视图菜单可选 */
export type GridSizeM = 10 | 20 | 40 | 80;

export type AxesConfig = { size: number };

export type Viz3DOptions = {
  pixelRatioCap?: number;
  fps?: number;
};

export type SceneObjectStatus =
  | "ready"
  | "running"
  | "warning"
  | "alarm"
  | "disabled"
  | "offline";

export type PresetShape = "cube" | "cyl" | "sphere" | "ring" | "sqRing" | "prism6";

export type ModelFormat = "obj" | "gltf" | "glb" | "stl";

export type ModelSource = { id: string };

export type LoadModelOptions = {
  id?: string;
  targetSize?: number;
  format?: ModelFormat;
  name?: string;
};

export type ModelLoadedPayload =
  | { id: string; ok: true; format: ModelFormat }
  | { id: string; ok: false; error: string };

export type HoistAxisConfig = {
  key: string;
  motorId: string | null;
  mount: { x: number; z: number };
  index: number;
  /** 同主控+同口 0 基显示序号；未绑定或电机缺失为 null */
  motorDisplayIndex: number | null;
};

/** 模型朝向可编辑欧拉轴（与侧栏 / 旋转 Gizmo 一致） */
export type ModelRotationAxis = "x" | "y" | "z";

export type SceneObjectConfig = {
  id: string;
  name?: string;
  shape: PresetShape;
  dimensions: { w: number; h: number; d: number };
  position: Vec3;
  /** 3D 模型变换中心相对几何中心的局部偏移（米），不改变吊点/运动基准 */
  centerOffset: Vec3;
  /** 模型朝向，弧度（工程侧存 deg） */
  rotation: Vec3;
  /**
   * 允许的模型旋转轴；缺省视为 XYZ。
   * 带 v2/v3 的控制类型由工程侧同步为仅 `y`。
   */
  rotationAxes?: readonly ModelRotationAxis[];
  color: string;
  status?: SceneObjectStatus;
  model?: ModelSource;
  hoistAxes?: HoistAxisConfig[];
  selectedMotorId?: string | null;
  /** 多选高亮（含主选）；未提供时回退 selectedMotorId */
  selectedMotorIds?: string[];
  showHoistPoints?: boolean;
  /** 虚轴运动映射（由控制类型 motionAxes 派生）；缺省表示无虚轴，走遥测 deviceType 映射 */
  virtualAxes?: readonly VirtualAxisMotion[];
  /** 模型运行方向：1 正向，2 反向 */
  modelRunDirection?: 1 | 2;
};

export type SelectionMode = "single" | "toggle";

export type ViewPreset = "top" | "front" | "back" | "side" | "left" | "persp" | "iso";

/** 工程落盘 / 视口恢复用的主相机状态 */
export type SavedView = {
  target: [number, number, number];
  alpha: number;
  beta: number;
  zoomRadius: number;
  orthoHalfHeight: number;
  preset: ViewPreset;
  focalLengthMm: number;
  /** 地面网格总尺寸（米） */
  gridSize: GridSizeM;
};

export type ViewportLayout = "single" | "dual" | "quad";

export type ViewportSplit = { x: number; y: number };

export type CameraPose = { position: Vec3; target: Vec3 };

export type ToolMode = "select" | "translate" | "rotate" | "scale" | "measure";

export type MeasureKind = "min" | "ground";

export type MeasurePayload = {
  kind: MeasureKind;
  distance: number;
  unit: "m";
  ids: string[];
  points?: [Vec3, Vec3];
};

export type ScreenRect = { left: number; top: number; width: number; height: number };

export type TransformMode = "translate" | "rotate" | "scale";

export type AlignAxis = "x" | "y" | "z";
export type AlignEdge = "min" | "center" | "max";
export type AlignMode =
  | "left"
  | "hCenter"
  | "right"
  | "top"
  | "vCenter"
  | "bottom"
  | "center";

export type BoundingBoxKind = "box" | "sphere";

export type TransformEndPayload = {
  id: string;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
};

export type PivotChangePayload = {
  id: string;
  position: Vec3;
  centerOffset: Vec3;
};

export type TelemetryDeviceType = "lift-truss" | "mover" | "rotator" | "lift-pitch";

export type TelemetryBinding = { objectId: string; snapshotId: string };

/** Engine-facing telemetry slice (decoupled from monitor-data). */
export type TelemetrySnapshotInput = {
  snapshotId: string;
  name: string;
  status: SceneObjectStatus;
  deviceType: TelemetryDeviceType;
  values: Record<string, number>;
  speed: number;
  torquePercent: number;
  /** When present, transform is resolved from virtual axes instead of deviceType mapping. */
  virtualAxisValues?: VirtualAxisValues;
};

export type RuntimeTransform = {
  position: Vec3;
  rotation: Vec3;
  velocity?: Vec3;
};

export type { VirtualAxisId, VirtualAxisValues };
export type VirtualAxisKind = MotionAxisKind;
export type VirtualAxisMotion = { axis: VirtualAxisId; kind: VirtualAxisKind };

export type TrajectoryPoint = Vec3;

export type DriveUnitLabelFields = {
  id?: string;
  position?: string;
  speed?: string;
  load?: string;
};

export type PickTarget =
  | { kind: "motor"; id: string }
  | { kind: "object"; id: string }
  | { kind: "hoist-axis"; objectId: string; axisKey: string; motorId?: string | null };

export type RecordingOptions = {
  fps?: number;
  mimeType?: string;
  videoBitsPerSecond?: number;
};

export type RecordingState = "idle" | "recording" | "unsupported" | "error";

export type RecordingStatePayload = {
  state: RecordingState;
  message?: string;
};
