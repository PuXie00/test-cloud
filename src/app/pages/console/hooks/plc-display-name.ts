type PlcLabelSource = { id: number };

/** 工程 plcs 数组顺序的显示索引（从 0 起） */
export const getPlcDisplayIndex = (
  plcs: readonly PlcLabelSource[],
  plcId: number,
): number => {
  const index = plcs.findIndex((plc) => plc.id === plcId);
  return index < 0 ? 0 : index;
};

/** PLC 显示名（不入库）：主控PLC-{两位序号} */
export const formatPlcLabel = (index: number): string =>
  `主控PLC-${String(index + 1).padStart(2, "0")}`;

/** 按工程 PLC 列表计算显示名 */
export const formatPlcDisplayName = (
  plcs: readonly PlcLabelSource[],
  plc: PlcLabelSource | number,
): string => {
  const id = typeof plc === "number" ? plc : plc.id;
  if (!plcs.some((item) => item.id === id)) return String(id);
  return formatPlcLabel(getPlcDisplayIndex(plcs, id));
};
