import type { DimensionDescriptor } from "../../monitor-grid/monitor-data";

export const sharedDimensions = (
  lists: DimensionDescriptor[][],
): DimensionDescriptor[] => {
  const [first, ...rest] = lists;
  if (!first) return [];
  const result: DimensionDescriptor[] = [];
  first.forEach((dim, index) => {
    const present = rest.every((list) => list[index] !== undefined);
    if (!present) return;
    const unitSet = new Set([dim.unit, ...rest.map((list) => list[index].unit)]);
    const mixed = unitSet.size > 1;
    result.push(
      mixed
        ? { key: "height", label: "升降", unit: "mm", mixed: true }
        : { key: dim.key, label: dim.label, unit: dim.unit },
    );
  });
  return result;
};
