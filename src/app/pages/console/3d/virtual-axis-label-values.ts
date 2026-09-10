import type { VirtualAxisId, VirtualAxisValues } from "@/app/project/project-document-types";
import type { MonitorPositions } from "../components/monitor-grid/monitor-data";

export type VirtualAxisLabelMode = "current" | "target";

export const resolveVirtualAxisLabelValues = (params: {
  mode: VirtualAxisLabelMode;
  positions: MonitorPositions | null;
  targetValues?: VirtualAxisValues;
}): VirtualAxisValues => {
  if (params.mode === "target") return params.targetValues ?? {};
  if (!params.positions) return {};
  const values: VirtualAxisValues = {};
  if (params.positions.h !== undefined) values.v1 = params.positions.h;
  if (params.positions.p !== undefined) values.v2 = params.positions.p;
  if (params.positions.y !== undefined) values.v3 = params.positions.y;
  return values;
};
