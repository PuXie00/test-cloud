import type { SceneObjectStatus, Viz3DColorKey, Viz3DColorMap } from "../types";

const STATUS_COLOR_KEY: Record<SceneObjectStatus, Viz3DColorKey> = {
  running: "show",
  ready: "primary",
  warning: "warning",
  alarm: "destructive",
  disabled: "mutedForeground",
  offline: "border",
};

export const resolveStatusColorKey = (status: SceneObjectStatus): Viz3DColorKey =>
  STATUS_COLOR_KEY[status];

export const getStatusColor = (status: SceneObjectStatus, colors: Viz3DColorMap): number =>
  colors[resolveStatusColorKey(status)];
