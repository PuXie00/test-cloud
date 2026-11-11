import type { ViewPreset, ViewportCellInfo, ViewportLayout } from "@/app/viz3d";
import { isOrthographicViewPreset } from "@/app/viz3d/cameras/ViewPresets";

export const LAYOUT_OPTIONS: { label: string; layout: ViewportLayout }[] = [
  { label: "单视图", layout: "single" },
  { label: "双视图", layout: "dual" },
  { label: "四视图", layout: "quad" },
];

/** 格名菜单「视角」：透视回到默认透视角度，其余为锁旋转的正交视图 */
export const CELL_VIEW_OPTIONS: { label: string; preset: ViewPreset }[] = [
  { label: "透视", preset: "persp" },
  { label: "顶视图", preset: "top" },
  { label: "前视图", preset: "front" },
  { label: "右视图", preset: "side" },
  { label: "左视图", preset: "left" },
  { label: "后视图", preset: "back" },
];

const PRESET_TITLES: Partial<Record<ViewPreset, string>> = Object.fromEntries(
  CELL_VIEW_OPTIONS.map(({ label, preset }) => [preset, label]),
);

/** 格名：正交预设显示视图名，其余按投影显示「透视 / 正交」 */
export const cellTitle = (cell: Pick<ViewportCellInfo, "preset" | "orthographic">): string => {
  if (isOrthographicViewPreset(cell.preset)) {
    return PRESET_TITLES[cell.preset] ?? "正交";
  }
  return cell.orthographic ? "正交" : "透视";
};

/** 「视角」单选当前值：正交预设取预设，其余都算「透视」那一项 */
export const cellViewValue = (cell: Pick<ViewportCellInfo, "preset">): ViewPreset =>
  isOrthographicViewPreset(cell.preset) ? cell.preset : "persp";
