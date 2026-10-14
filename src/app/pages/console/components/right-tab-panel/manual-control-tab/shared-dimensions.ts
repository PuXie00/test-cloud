import { DIMENSION_KEY_TO_VIRTUAL_AXIS, VIRTUAL_AXES } from "@/app/project/manual-jog";
import type { VirtualAxisId } from "@/app/project/project-document-types";
import type { DimensionDescriptor } from "../../monitor-grid/monitor-data";

/** 维度属于哪根虚轴；不是虚轴维度时为 undefined */
export const dimensionAxis = (dim: Pick<DimensionDescriptor, "key">): VirtualAxisId | undefined =>
  DIMENSION_KEY_TO_VIRTUAL_AXIS[dim.key];

/**
 * 所选物体的维度并集：按虚轴 id（v1→v3）合并，不是按位置取交集。
 * 某根虚轴只有部分物体有时也保留，点动和写入时只作用于有这根虚轴的物体。
 * 虚轴 1 有的物体是升降（mm）、有的是旋转（°）时只保留一行，标记 mixed，单位兜底 mm。
 */
export const unionDimensions = (
  lists: readonly (readonly DimensionDescriptor[])[],
): DimensionDescriptor[] => {
  const result: DimensionDescriptor[] = [];
  for (const axis of VIRTUAL_AXES) {
    const dims = lists.flatMap((list) => {
      const dim = list.find((item) => dimensionAxis(item) === axis);
      return dim ? [dim] : [];
    });
    const [first] = dims;
    if (!first) continue;
    const mixed = dims.some((dim) => dim.unit !== first.unit);
    if (!mixed) {
      result.push({ key: first.key, label: first.label, unit: first.unit });
    } else if (axis === "v1") {
      result.push({ key: "height", label: "升降", unit: "mm", mixed: true });
    } else {
      result.push({ ...first, mixed: true });
    }
  }
  return result;
};
