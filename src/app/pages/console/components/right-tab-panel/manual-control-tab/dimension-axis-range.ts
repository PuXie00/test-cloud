import { CONTROL_TYPE_RULES } from "@/app/project/configuration-rules";
import type { ControlType, MotionAxisKind, MotionAxisParams } from "@/app/project/configuration-types";
import { DIMENSION_KEY_TO_VIRTUAL_AXIS, VIRTUAL_AXES } from "@/app/project/manual-jog";
import type { VirtualAxisId, VirtualAxisValues } from "@/app/project/project-document-types";
import { motionKindForVirtualAxis } from "@/app/project/virtual-axis-mapping";
import type { ControlledObjectSnapshot } from "../../monitor-grid/monitor-data";
import {
  clampToAxisRange,
  positionsToAxisValues,
  resolveRelativeBase,
  type AxisRange,
} from "../../../hooks/go-ready";

export type AxisRangeSource = {
  id: number;
  controlType: ControlType;
  motionParams?: Partial<Record<MotionAxisKind, Pick<MotionAxisParams, "minAngle" | "maxAngle">>>;
};

const isRange = (range: AxisRange | undefined): range is AxisRange =>
  range !== undefined &&
  Number.isFinite(range.min) &&
  Number.isFinite(range.max) &&
  range.min <= range.max;

export const virtualAxisRangeFor = (
  object: AxisRangeSource,
  axis: VirtualAxisId,
): AxisRange | undefined => {
  const kinds = CONTROL_TYPE_RULES[object.controlType].motionAxes;
  const params = object.motionParams?.[motionKindForVirtualAxis(kinds, axis)];
  if (!params) return undefined;
  const range = { min: params.minAngle, max: params.maxAngle };
  return isRange(range) ? range : undefined;
};

export const axisRangesByObjectId = (
  objects: readonly AxisRangeSource[],
): Record<string, Partial<Record<VirtualAxisId, AxisRange>>> => {
  const result: Record<string, Partial<Record<VirtualAxisId, AxisRange>>> = {};
  for (const object of objects) {
    const ranges: Partial<Record<VirtualAxisId, AxisRange>> = {};
    for (const axis of VIRTUAL_AXES) {
      const range = virtualAxisRangeFor(object, axis);
      if (range) ranges[axis] = range;
    }
    if (Object.keys(ranges).length > 0) result[String(object.id)] = ranges;
  }
  return result;
};

const intersectRanges = (ranges: readonly AxisRange[]): AxisRange | undefined => {
  if (ranges.length === 0) return undefined;
  const min = Math.max(...ranges.map((range) => range.min));
  const max = Math.min(...ranges.map((range) => range.max));
  return isRange({ min, max }) ? { min, max } : undefined;
};

/** 输入框允许的给定值。绝对模式是虚轴行程交集；相对模式是使结果仍落在行程内的位移交集。 */
export const dimensionCommandRange = (
  dimKey: string,
  mode: "abs" | "rel",
  snapshots: readonly ControlledObjectSnapshot[],
  objects: readonly AxisRangeSource[],
  armedTargetsByObjectId: Record<string, VirtualAxisValues>,
): AxisRange | undefined => {
  const axis = DIMENSION_KEY_TO_VIRTUAL_AXIS[dimKey];
  if (!axis) return undefined;
  const byId = new Map(objects.map((object) => [object.id, object]));
  const ranges: AxisRange[] = [];
  for (const snapshot of snapshots) {
    const object = byId.get(snapshot.descriptor.id);
    if (!object) continue;
    const axisRange = virtualAxisRangeFor(object, axis);
    if (!axisRange) continue;
    if (mode === "abs") {
      ranges.push(axisRange);
      continue;
    }
    const objectId = String(snapshot.descriptor.id);
    const base = resolveRelativeBase(
      axis,
      armedTargetsByObjectId[objectId] ?? {},
      positionsToAxisValues(snapshot.positions),
    );
    if (base === undefined) continue;
    ranges.push({
      min: axisRange.min - base,
      max: axisRange.max - base,
    });
  }
  return intersectRanges(ranges);
};

export const clampDraftToCommandRange = (
  value: number,
  range: AxisRange | undefined,
): number => clampToAxisRange(value, range);
