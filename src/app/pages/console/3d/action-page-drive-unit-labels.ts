import { ENABLED_VIRTUAL_AXES_BY_CONTROL_TYPE } from "@/app/project/configuration-rules";
import type { ControlType } from "@/app/project/configuration-types";
import type { ModelPose } from "@/app/project/action-sequence/types";
import type { DisplayLengthUnit } from "@/app/project/display-length-units";
import { formatVirtualAxesCompact } from "../components/action-builder/virtual-axis-display";

export type ActionPageLabelObject = {
  id: number;
  controlType: ControlType;
};

const INSTALL_POSE: ModelPose = { v1: 0, v2: 0, v3: 0 };

export const collectActionPageDriveUnitLabels = (
  poses: Map<number, ModelPose>,
  objects: readonly ActionPageLabelObject[],
  display: DisplayLengthUnit,
  memberIds: ReadonlySet<number> | null,
): Map<string, string | null> => {
  const labels = new Map<string, string | null>();
  for (const object of objects) {
    const axes = ENABLED_VIRTUAL_AXES_BY_CONTROL_TYPE[object.controlType];
    if (axes.length === 0) continue;
    const id = String(object.id);
    if (!memberIds?.has(object.id)) {
      labels.set(id, null);
      continue;
    }
    const pose = poses.get(object.id) ?? INSTALL_POSE;
    const text = formatVirtualAxesCompact(axes, pose, display, undefined, object.controlType);
    labels.set(id, text || null);
  }
  return labels;
};
