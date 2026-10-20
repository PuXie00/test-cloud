import { DIMENSION_KEY_TO_VIRTUAL_AXIS, VIRTUAL_AXES } from "@/app/project/manual-jog";
import type { VirtualAxisId, VirtualAxisValues } from "@/app/project/project-document-types";
import type { ControlledObjectSnapshot } from "../../monitor-grid/monitor-data";
import {
  clampToAxisRange,
  positionsToAxisValues,
  resolveRelativeBase,
  type AxisRange,
  type GoReadyEntry,
} from "../../../hooks/go-ready";
import { intersectAxisRange, type AxisEditMode } from "../../action-builder/virtual-axis-edit";
import { virtualAxisRangeFor, type AxisRangeSource } from "./dimension-axis-range";

/**
 * 维度控制的批量编辑规则，和动作页「多选位姿」一致：
 * - 显示所选物体虚轴的并集（按虚轴 id，不是按位置）
 * - 绝对：各物体值相同时显示该值，不同时显示 --；物体的值 = 已设的 GO 目标，没设目标就是当前监控位置
 * - 相对：输入从 0 开始，相对物体当前的实际位置（不是已设的 GO 目标）
 * - 单位只有在所有会被写入的物体一致时才显示
 * - 绝对输入的上下限是各物体行程的交集，写入时再按每个物体自己的行程截断
 * - 没有该虚轴的物体不写入
 * 不同的只有一点：写入不是直接动物体，而是设为 GO 目标（影子模型），按 GO 才执行。
 */

export type DimensionParticipant = {
  /** String(物体 id)，和 GO 准备条目的 objectId 一致 */
  objectId: string;
  snapshot: ControlledObjectSnapshot;
  /** 物体启用的虚轴（取自描述的维度，按 v1→v3 排列） */
  axes: readonly VirtualAxisId[];
  /** 各虚轴的标准单位（mm / °） */
  unitByAxis: Partial<Record<VirtualAxisId, string>>;
  /** 各虚轴的行程，没有配置时缺省 */
  ranges: Partial<Record<VirtualAxisId, AxisRange>>;
};

export type DimensionWrite = {
  mode: AxisEditMode;
  axis: VirtualAxisId;
  value: number;
};

export type DimensionWriteResult = {
  entries: GoReadyEntry[];
  /** 相对模式下有物体没有监控位置，无法算出基准而被跳过 */
  missingPosition: boolean;
};

export const buildDimensionParticipants = (
  snapshots: readonly ControlledObjectSnapshot[],
  objects: readonly AxisRangeSource[],
): DimensionParticipant[] => {
  const objectById = new Map(objects.map((object) => [object.id, object]));
  return snapshots.map((snapshot) => {
    const axes: VirtualAxisId[] = [];
    const unitByAxis: Partial<Record<VirtualAxisId, string>> = {};
    for (const dim of snapshot.descriptor.dimensions) {
      const axis = DIMENSION_KEY_TO_VIRTUAL_AXIS[dim.key];
      if (!axis || axes.includes(axis)) continue;
      axes.push(axis);
      unitByAxis[axis] = dim.unit;
    }
    const object = objectById.get(snapshot.descriptor.id);
    const ranges: Partial<Record<VirtualAxisId, AxisRange>> = {};
    for (const axis of axes) {
      const range = object ? virtualAxisRangeFor(object, axis) : undefined;
      if (range) ranges[axis] = range;
    }
    return {
      objectId: String(snapshot.descriptor.id),
      snapshot,
      axes: VIRTUAL_AXES.filter((axis) => axes.includes(axis)),
      unitByAxis,
      ranges,
    };
  });
};

/** 会被这根虚轴的写入影响的物体 */
export const writableParticipants = (
  participants: readonly DimensionParticipant[],
  axis: VirtualAxisId,
): DimensionParticipant[] => participants.filter((item) => item.axes.includes(axis));

export const unionAxes = (participants: readonly DimensionParticipant[]): VirtualAxisId[] =>
  VIRTUAL_AXES.filter((axis) => participants.some((item) => item.axes.includes(axis)));

/** 所有会被写入的物体单位一致才返回，否则不显示单位 */
export const axisUnit = (
  participants: readonly DimensionParticipant[],
  axis: VirtualAxisId,
): string | undefined => {
  const units = writableParticipants(participants, axis).map((item) => item.unitByAxis[axis]);
  const [first] = units;
  return first !== undefined && units.every((unit) => unit === first) ? first : undefined;
};

/** 绝对输入的上下限：各物体行程的交集；没有交集或没有行程时不设 */
export const axisInputRange = (
  participants: readonly DimensionParticipant[],
  axis: VirtualAxisId,
): { min?: number; max?: number } =>
  intersectAxisRange(
    writableParticipants(participants, axis).flatMap((item) => {
      const range = item.ranges[axis];
      return range ? [range] : [];
    }),
  );

/** 比较和显示都按输入框的精度（一位小数）；+ 0 把 -0 变成 0 */
const roundToInputPrecision = (value: number): number => Math.round(value * 10) / 10 + 0;

/**
 * 绝对模式的显示值：每个物体取已设的 GO 目标，没设目标就取当前监控位置；
 * 各物体一致时显示该值，不一致或没有位置数据时返回 undefined（显示 --）。
 */
export const sharedAxisValue = (
  participants: readonly DimensionParticipant[],
  axis: VirtualAxisId,
  armedTargetsByObjectId: Readonly<Record<string, VirtualAxisValues>>,
): number | undefined =>
  sharedRoundedValue(
    writableParticipants(participants, axis).map(
      (item) =>
        armedTargetsByObjectId[item.objectId]?.[axis] ??
        positionsToAxisValues(item.snapshot.positions)[axis],
    ),
  );

const sharedRoundedValue = (raw: readonly (number | undefined)[]): number | undefined => {
  const values = raw.map((value) => (value === undefined ? undefined : roundToInputPrecision(value)));
  const [shared] = values;
  if (shared === undefined || values.some((value) => value !== shared)) return undefined;
  return shared;
};

/**
 * 把一次虚轴输入转成每个物体的 GO 目标：
 * - 绝对：该轴 = 输入值；相对：该轴 = 当前监控位置 + 增量（已设的目标不算基准）
 * - 每个物体按自己的行程截断；没有这根虚轴的物体不写
 * - 物体第一次进入 GO 准备时，其余虚轴保持当前位置（和输入框里看到的一致），写进目标，
 *   否则按 GO 时没写的轴会被当成 0；已经有目标的物体只改这一根轴
 */
export const buildDimensionEntries = (
  participants: readonly DimensionParticipant[],
  write: DimensionWrite,
  armedTargetsByObjectId: Readonly<Record<string, VirtualAxisValues>> = {},
): DimensionWriteResult => {
  const { mode, axis, value } = write;
  const entries: GoReadyEntry[] = [];
  let missingPosition = false;

  for (const item of writableParticipants(participants, axis)) {
    const armed = armedTargetsByObjectId[item.objectId];
    const current = positionsToAxisValues(item.snapshot.positions);
    const target: VirtualAxisValues = {};

    if (mode === "rel") {
      if (value === 0) continue;
      const base = resolveRelativeBase(axis, current);
      if (base === undefined) {
        missingPosition = true;
        continue;
      }
      target[axis] = clampToAxisRange(base + value, item.ranges[axis]);
    } else {
      target[axis] = clampToAxisRange(value, item.ranges[axis]);
    }

    if (!armed) {
      for (const other of item.axes) {
        if (other === axis) continue;
        const held = current[other];
        if (held !== undefined) target[other] = clampToAxisRange(held, item.ranges[other]);
      }
    }

    entries.push({ objectId: item.objectId, target, current });
  }

  return { entries, missingPosition };
};
