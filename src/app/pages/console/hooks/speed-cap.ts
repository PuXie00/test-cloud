/** 系统调速上限：调速范围算出的倍率再高，推子顶端也只到这里（范围算法不检查加速度、碰撞） */
export const SPEED_CEILING_PERCENT = 200;

/** 推子中点：编程速度 */
export const PROGRAMMED_SPEED_PERCENT = 100;

/** 速度百分比不超过调速范围的上限；上限缺省或为 null 时不限 */
export const capSpeedPercent = (percent: number, maxPercent: number | null | undefined): number =>
  maxPercent === null || maxPercent === undefined ? percent : Math.min(percent, maxPercent);

/** 推子顶端对应的速度：调速范围的最大倍率，不超过系统上限；没有算出上限时就是系统上限 */
export const speedTopPercent = (maxPercent: number | null | undefined): number =>
  Math.min(maxPercent ?? SPEED_CEILING_PERCENT, SPEED_CEILING_PERCENT);

/**
 * 推子位置（0–200）→ 实际速度百分比。推子全行程都有效：
 * 下半段 0–100 固定 1:1 减速；上半段 100–200 线性对应 100% 到顶端速度。
 * 顶端低于 100% 时（按编程速度都会超限），超过顶端的部分停在顶端。
 */
export const faderToSpeedPercent = (
  position: number,
  maxPercent: number | null | undefined,
): number => {
  const top = speedTopPercent(maxPercent);
  if (position <= PROGRAMMED_SPEED_PERCENT || top <= PROGRAMMED_SPEED_PERCENT) {
    return Math.min(position, top);
  }
  const ratio = (position - PROGRAMMED_SPEED_PERCENT) / (SPEED_CEILING_PERCENT - PROGRAMMED_SPEED_PERCENT);
  return Math.round(PROGRAMMED_SPEED_PERCENT + ratio * (top - PROGRAMMED_SPEED_PERCENT));
};
