export const DEFAULT_MAX_LABEL_MULTIPLIER = 20;
export const DEFAULT_LABEL_SCREEN_FRACTION = 0.03;

export type HoistLabelSizeOptions = {
  /** 相机到标签的距离（米） */
  distance: number;
  /** 透视相机垂直 FOV（弧度）；正交相机忽略 */
  fov: number;
  /** 是否正交相机 */
  orthographic: boolean;
  /** 基础（最小）世界尺寸；标签不会小于此值 */
  baseSize: number;
  /** 相对 baseSize 的封顶倍数 */
  maxMultiplier?: number;
  /** 放大后目标占屏幕高度的比例（仅透视） */
  screenFraction?: number;
};

/**
 * 计算吊点编号标签的世界尺寸：
 * - 正交相机：屏幕尺寸恒定，恒为 baseSize
 * - 透视相机：size = distance · 2·tan(fov/2) · screenFraction，clamp 到 [baseSize, baseSize·maxMultiplier]
 */
export const resolveHoistLabelSize = (options: HoistLabelSizeOptions): number => {
  const maxMultiplier = options.maxMultiplier ?? DEFAULT_MAX_LABEL_MULTIPLIER;
  const screenFraction = options.screenFraction ?? DEFAULT_LABEL_SCREEN_FRACTION;
  const base = Math.max(0, options.baseSize);
  const max = base * maxMultiplier;

  if (options.orthographic) return base;

  const fov = options.fov;
  if (!Number.isFinite(fov) || fov <= 0) return base;

  const grown = options.distance * 2 * Math.tan(fov / 2) * screenFraction;
  return Math.min(max, Math.max(base, grown));
};
