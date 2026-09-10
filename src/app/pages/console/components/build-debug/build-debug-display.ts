import {
  formatLengthFamilyValue,
  getDisplayLengthFamilyUnit,
  toCanonicalLengthValue,
  toDisplayLengthValue,
  type DisplayLengthUnit,
} from "@/app/project/display-length-units";

/** Canonical debug motion units (store / native bridge). */
export const DEBUG_SPEED_UNIT = "mm/s";
export const DEBUG_ACCEL_UNIT = "mm/s²";
export const DEBUG_POSITION_UNIT = "mm";

export const debugSpeedDisplayUnit = (display: DisplayLengthUnit): string =>
  getDisplayLengthFamilyUnit(DEBUG_SPEED_UNIT, display);

export const debugAccelDisplayUnit = (display: DisplayLengthUnit): string =>
  getDisplayLengthFamilyUnit(DEBUG_ACCEL_UNIT, display);

export const debugPositionDisplayUnit = (display: DisplayLengthUnit): string =>
  getDisplayLengthFamilyUnit(DEBUG_POSITION_UNIT, display);

/** Read: canonical → display for editable debug fields. */
export const toDebugDisplayValue = (
  canonical: number,
  display: DisplayLengthUnit,
): number => toDisplayLengthValue(canonical, display);

/** Write: display → canonical for debug apply / move. */
export const toDebugCanonicalValue = (
  displayValue: number,
  display: DisplayLengthUnit,
): number => toCanonicalLengthValue(displayValue, display);

/** Canonical mm magnitudes for relative-move quick presets (symmetric ±). */
export const RELATIVE_MOVE_QUICK_PRESETS_MM = [1, 10, 100, 1000] as const;

/** Display-unit deltas: negatives ascending, then positives. */
export const relativeMoveQuickDeltas = (display: DisplayLengthUnit): number[] => {
  const magnitudes = RELATIVE_MOVE_QUICK_PRESETS_MM.map((mm) =>
    toDisplayLengthValue(mm, display),
  );
  return [...[...magnitudes].reverse().map((m) => -m), ...magnitudes];
};

export const formatRelativeQuickLabel = (
  deltaDisplay: number,
  display: DisplayLengthUnit,
): string => {
  const sign = deltaDisplay > 0 ? "+" : deltaDisplay < 0 ? "−" : "";
  const magnitude = formatLengthFamilyValue(
    toCanonicalLengthValue(Math.abs(deltaDisplay), display),
    DEBUG_POSITION_UNIT,
    display,
  );
  return `${sign}${magnitude}`;
};
