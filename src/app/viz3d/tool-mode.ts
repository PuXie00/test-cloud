import type { ToolMode } from "./types";

export const TRANSFORM_TOOL_MODES = ["translate", "rotate", "scale"] as const;
export type TransformToolMode = (typeof TRANSFORM_TOOL_MODES)[number];

export const isTransformToolMode = (mode: ToolMode): mode is TransformToolMode =>
  (TRANSFORM_TOOL_MODES as readonly string[]).includes(mode);

export const BUILD_MENU_TOOL_MODES: ToolMode[] = [
  "select",
  "translate",
  "rotate",
  "scale",
];

export const isBuildMenuToolMode = (mode: ToolMode): boolean =>
  BUILD_MENU_TOOL_MODES.includes(mode);
