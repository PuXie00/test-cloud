export {
  SKIPPABLE_STEPS,
  WIZARD_STEPS,
} from "./wizard-state";
export {
  CONTROL_TYPE_DEFINITIONS,
  defaultShapeDimensions,
  MOTION_DEFAULTS,
  PALETTE_SHAPE_DEFINITIONS,
  SHAPE_DEFINITIONS,
  SHAPE_FIELD_KEYS,
  ensureMinimumAxes,
  getShapeFieldKeys,
  toEngineDimensions,
} from "./config-descriptors";

/** @deprecated 驱动轴均为升降吊点；key 现为物体内索引字符串，勿再用语义预设 */
export const MANUAL_AXIS_PRESETS: { key: string; label: string }[] = [];

export const OBJECT_COLORS = [
  "#869398",
  "#4ade80",
  "#bac3ff",
  "#ffb77d",
  "#ffb4ab",
  "#dee3e6",
  "#3d494d",
];

export const WIZARD_META_STORAGE_KEY = "console.devices.wizard.meta";
export const NEW_PROJECT_FLAG_KEY = "console.devices.wizard.newProject";
