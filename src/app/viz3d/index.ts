import { Viz3DEngine } from "./engine/Viz3DEngine";

export { Viz3DEngine } from "./engine/Viz3DEngine";
export type { Viz3DEventMap } from "./engine/Viz3DEngine";
export {
  TRANSFORM_TOOL_MODES,
  isTransformToolMode,
  isBuildMenuToolMode,
  BUILD_MENU_TOOL_MODES,
} from "./tool-mode";
export type { TransformToolMode } from "./tool-mode";
export {
  DEFAULT_HOIST_LABEL_MODE,
  parseHoistLabelMode,
  readStoredHoistLabelMode,
  writeStoredHoistLabelMode,
  resolveHoistLabelText,
} from "./hoist-label-mode";
export type { HoistLabelMode } from "./hoist-label-mode";
export { hoistAxesEqual } from "./hoist-axis-config";
export type { TransformCenterPreset } from "./tools/transform-center";
export type {
  AlignAxis,
  AlignEdge,
  AlignMode,
  AxesConfig,
  BoundingBoxKind,
  CameraPose,
  Disposable,
  GridSizeM,
  ModelFormat,
  ModelLoadedPayload,
  ModelSource,
  LoadModelOptions,
  MeasureKind,
  MeasurePayload,
  PresetShape,
  HoistAxisConfig,
  SceneObjectConfig,
  SceneObjectStatus,
  ScreenRect,
  SelectionMode,
  SlotRect,
  ToolMode,
  PivotChangePayload,
  TransformEndPayload,
  TransformMode,
  Vec3,
  SavedView,
  ViewPreset,
  ViewportLayout,
  ViewportSplit,
  Viz3DColorKey,
  Viz3DColorMap,
  Viz3DOptions,
  TelemetrySnapshotInput,
  TelemetryDeviceType,
  RuntimeTransform,
  DriveUnitLabelFields,
  PickTarget,
  RecordingOptions,
  RecordingState,
  RecordingStatePayload,
  VirtualAxisId,
  VirtualAxisKind,
  VirtualAxisMotion,
  VirtualAxisValues,
} from "./types";

let singleton: Viz3DEngine | null = null;

export const getViz3DEngine = (): Viz3DEngine => {
  if (!singleton) {
    singleton = new Viz3DEngine();
  }

  return singleton;
};

export const destroyViz3DEngine = (): void => {
  singleton?.dispose();
  singleton = null;
};
