export const FADER_MIN = 0;
export const FADER_MAX = 200;
export const FADER_STEP = 1;
export const FADER_LARGE_STEP = 10;

export const clampFaderValue = (value: number): number =>
  Math.min(FADER_MAX, Math.max(FADER_MIN, Math.round(value)));

export const faderValueFromClientY = (
  clientY: number,
  track: Pick<DOMRect, "top" | "height">,
): number => {
  if (track.height <= 0) return FADER_MIN;
  const ratioFromBottom = (track.top + track.height - clientY) / track.height;
  return clampFaderValue(ratioFromBottom * FADER_MAX);
};

export const stepFaderValue = (value: number, key: string, large: boolean): number | null => {
  if (key === "PageUp") return clampFaderValue(value + FADER_LARGE_STEP);
  if (key === "PageDown") return clampFaderValue(value - FADER_LARGE_STEP);
  const delta = large ? FADER_LARGE_STEP : FADER_STEP;
  if (key === "ArrowUp" || key === "ArrowRight") return clampFaderValue(value + delta);
  if (key === "ArrowDown" || key === "ArrowLeft") return clampFaderValue(value - delta);
  return null;
};
