import {
  formatLengthFamilyValue,
  getDisplayLengthFamilyUnit,
  normalizeCanonicalLengthValue,
  resolveDisplayPrecision,
  toCanonicalLengthValue,
  toDisplayLengthValue,
  type DisplayLengthUnit,
} from "@/app/project/display-length-units";
import type { DebugMotionParams } from "./build-debug-types";

/** Canonical debug motion units (store / native bridge). */
export const DEBUG_SPEED_UNIT = "mm/s";
export const DEBUG_ACCEL_UNIT = "mm/s²";
export const DEBUG_POSITION_UNIT = "mm";

/** Canonical decimals for move / set-position targets (wire rounds to 0.1 mm). */
export const DEBUG_POSITION_PRECISION = 1;

/** Canonical decimals per axisRunConfig field (descriptor scale: velocity/stroke 0.1, accel 1). */
export const DEBUG_MOTION_PARAM_PRECISION: Record<keyof DebugMotionParams, number> = {
  defaultVelocity: 1,
  defaultAcceleration: 0,
  defaultDeceleration: 0,
  maximumStroke: 1,
};

export const debugSpeedDisplayUnit = (display: DisplayLengthUnit): string =>
  getDisplayLengthFamilyUnit(DEBUG_SPEED_UNIT, display);

export const debugAccelDisplayUnit = (display: DisplayLengthUnit): string =>
  getDisplayLengthFamilyUnit(DEBUG_ACCEL_UNIT, display);

export const debugPositionDisplayUnit = (display: DisplayLengthUnit): string =>
  getDisplayLengthFamilyUnit(DEBUG_POSITION_UNIT, display);

/** Input decimals in the display unit for a canonical precision (0.1 mm → 0.001 in). */
export const debugDisplayPrecision = (
  canonicalPrecision: number,
  display: DisplayLengthUnit,
): number => resolveDisplayPrecision(canonicalPrecision, display);

/** Read: canonical → display for editable debug fields. */
export const toDebugDisplayValue = (
  canonical: number,
  display: DisplayLengthUnit,
): number => toDisplayLengthValue(canonical, display);

/** Read: canonical → display text for editable debug fields, without float noise. */
export const formatDebugDisplayValue = (
  canonical: number,
  display: DisplayLengthUnit,
  canonicalPrecision: number,
): string =>
  formatLengthFamilyValue(canonical, DEBUG_POSITION_UNIT, display, { canonicalPrecision });

/** Write: display → canonical for debug apply / move. */
export const toDebugCanonicalValue = (
  displayValue: number,
  display: DisplayLengthUnit,
): number => toCanonicalLengthValue(displayValue, display);

/** Write: display → canonical, rounded so a shown value maps back to the same canonical. */
export const toRoundedDebugCanonicalValue = (
  displayValue: number,
  display: DisplayLengthUnit,
  canonicalPrecision: number,
): number =>
  normalizeCanonicalLengthValue(toDebugCanonicalValue(displayValue, display), {
    precision: canonicalPrecision,
  });

/** Canonical mm magnitudes for relative-move quick presets (symmetric ±). */
export const RELATIVE_MOVE_QUICK_PRESETS_MM = [1, 10, 100, 1000] as const;

/** Canonical mm deltas: negatives ascending, then positives. */
export const RELATIVE_MOVE_QUICK_DELTAS_MM: readonly number[] = [
  ...[...RELATIVE_MOVE_QUICK_PRESETS_MM].reverse().map((mm) => -mm),
  ...RELATIVE_MOVE_QUICK_PRESETS_MM,
];

export const formatRelativeQuickLabel = (
  deltaMm: number,
  display: DisplayLengthUnit,
): string => {
  const sign = deltaMm > 0 ? "+" : deltaMm < 0 ? "−" : "";
  const magnitude = formatLengthFamilyValue(Math.abs(deltaMm), DEBUG_POSITION_UNIT, display, {
    canonicalPrecision: DEBUG_POSITION_PRECISION,
  });
  return `${sign}${magnitude}`;
};
