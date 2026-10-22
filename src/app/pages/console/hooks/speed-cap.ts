/** 速度百分比不超过调速范围的上限；上限缺省或为 null 时不限 */
export const capSpeedPercent = (percent: number, maxPercent: number | null | undefined): number =>
  maxPercent === null || maxPercent === undefined ? percent : Math.min(percent, maxPercent);
