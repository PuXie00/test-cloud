export type NumericClampOptions = {
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  snapToStep?: boolean;
};

export const roundToStep = (value: number, step = 1, precision?: number): number => {
  const stepped = Math.round(value / step) * step;
  if (precision == null) {
    return stepped;
  }
  const factor = 10 ** precision;
  return Math.round(stepped * factor) / factor;
};

export const clampNumeric = (value: number, min?: number, max?: number): number => {
  let next = value;
  if (min != null) {
    next = Math.max(min, next);
  }
  if (max != null) {
    next = Math.min(max, next);
  }
  return next;
};

export const normalizeNumeric = (value: number, options: NumericClampOptions = {}): number => {
  const { min, max, step = 1, precision, snapToStep = true } = options;
  const clamped = clampNumeric(value, min, max);
  if (!snapToStep) {
    if (precision == null) return clamped;
    const factor = 10 ** precision;
    return Math.round(clamped * factor) / factor;
  }
  return roundToStep(clamped, step, precision);
};

export const inferPrecision = (step: number): number => {
  const stepText = String(step);
  const dotIndex = stepText.indexOf(".");
  if (dotIndex === -1) {
    return 0;
  }
  return stepText.length - dotIndex - 1;
};

export const formatNumericDisplay = (value: number, precision: number): string => {
  if (!Number.isFinite(value)) {
    return "0";
  }
  return value.toFixed(precision);
};

export const parseNumericInput = (text: string): number | null => {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

export type ScrubDeltaOptions = {
  deltaPx: number;
  step?: number;
  sensitivity?: number;
  fineFactor?: number;
  coarseFactor?: number;
  shiftKey?: boolean;
  ctrlKey?: boolean;
};

export const applyScrubDelta = (startValue: number, options: ScrubDeltaOptions): number => {
  const {
    deltaPx,
    step = 1,
    sensitivity = 1,
    fineFactor = 0.1,
    coarseFactor = 10,
    shiftKey = false,
    ctrlKey = false,
  } = options;

  let factor = 1;
  if (shiftKey) {
    factor = fineFactor;
  } else if (ctrlKey) {
    factor = coarseFactor;
  }

  return startValue + deltaPx * sensitivity * step * factor;
};
