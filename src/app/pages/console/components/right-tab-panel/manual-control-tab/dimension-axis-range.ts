import type { ControlType, MotionAxisId, MotionAxisParams } from "@/app/project/configuration-types";
import type { VirtualAxisId } from "@/app/project/project-document-types";
import { motionAxisIdForVirtualAxis } from "@/app/project/virtual-axis-mapping";
import type { AxisRange } from "../../../hooks/go-ready";

export type AxisRangeSource = {
  id: number;
  controlType: ControlType;
  motionParams?: Partial<Record<MotionAxisId, Pick<MotionAxisParams, "minAngle" | "maxAngle">>>;
};

const isRange = (range: AxisRange): boolean =>
  Number.isFinite(range.min) && Number.isFinite(range.max) && range.min <= range.max;

/** 物体某根虚轴的行程；没有配置或配置无效时为 undefined */
export const virtualAxisRangeFor = (
  object: AxisRangeSource,
  axis: VirtualAxisId,
): AxisRange | undefined => {
  const params = object.motionParams?.[motionAxisIdForVirtualAxis(axis)];
  if (!params) return undefined;
  const range = { min: params.minAngle, max: params.maxAngle };
  return isRange(range) ? range : undefined;
};
