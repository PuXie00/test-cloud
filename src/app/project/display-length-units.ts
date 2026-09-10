import { clampNumeric, inferPrecision } from "@/app/components/ics/numeric-input-utils";

export const DISPLAY_LENGTH_UNIT_STORAGE_KEY = "yz.console.displayLengthUnit";

export type DisplayLengthUnit = "mm" | "cm" | "m" | "in";
export type CanonicalLengthFamilyUnit = "mm" | "mm/s" | "mm/s²";

export type FormatLengthFamilyOptions = {
  canonicalPrecision?: number;
  trimTrailingZeros?: boolean;
  nonFiniteText?: string;
};

export type NormalizeCanonicalLengthOptions = {
  min?: number;
  max?: number;
  precision?: number;
  step?: number;
};

const FACTOR: Record<DisplayLengthUnit, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
};

const DISPLAY_LENGTH_UNITS = new Set<DisplayLengthUnit>(["mm", "cm", "m", "in"]);

export const normalizeLengthFamilyUnit = (unit: string): string => {
  const t = unit.trim();
  return t === "mm/s2" ? "mm/s²" : t;
};

/** True for length-family units including aliases (e.g. mm/s2). Does not narrow `unit` to the normalized canonical string — callers must `normalizeLengthFamilyUnit` when they need the standard form. */
export const isLengthFamilyUnit = (unit: string | undefined): boolean => {
  if (!unit) return false;
  const n = normalizeLengthFamilyUnit(unit);
  return n === "mm" || n === "mm/s" || n === "mm/s²";
};

export const getMmFactor = (display: DisplayLengthUnit): number => FACTOR[display];

export const toDisplayLengthValue = (
  canonicalMm: number,
  display: DisplayLengthUnit,
): number => canonicalMm / FACTOR[display];

export const toCanonicalLengthValue = (
  displayValue: number,
  display: DisplayLengthUnit,
): number => displayValue * FACTOR[display];

export const resolveCanonicalPrecision = (precision?: number, step?: number): number =>
  precision != null
    ? Math.max(0, precision)
    : Math.max(1, inferPrecision(step ?? 1));

export const resolveDisplayPrecision = (
  canonicalPrecision: number,
  display: DisplayLengthUnit,
): number => {
  const factor = FACTOR[display];
  const extra = factor <= 1 ? 0 : Math.ceil(Math.log10(factor));
  return canonicalPrecision + extra;
};

export const scaleBound = (
  value: number | undefined,
  display: DisplayLengthUnit,
  direction: "toDisplay" | "toCanonical",
): number | undefined => {
  if (value == null) return undefined;
  return direction === "toDisplay"
    ? toDisplayLengthValue(value, display)
    : toCanonicalLengthValue(value, display);
};

export const getDisplayLengthFamilyUnit = (
  canonicalUnit: string,
  display: DisplayLengthUnit,
): string => {
  const normalized = normalizeLengthFamilyUnit(canonicalUnit);
  if (!isLengthFamilyUnit(normalized)) {
    return normalized;
  }
  if (normalized === "mm") return display;
  if (normalized === "mm/s") return `${display}/s`;
  return `${display}/s²`;
};

const roundToPrecision = (value: number, precision: number): number => {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
};

const formatRoundedText = (
  value: number,
  precision: number,
  trimTrailingZeros: boolean,
): string => {
  const fixed = value.toFixed(precision);
  if (!trimTrailingZeros) {
    return fixed;
  }
  return fixed.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
};

export const formatLengthFamilyValue = (
  canonicalValue: number,
  canonicalUnit: string,
  display: DisplayLengthUnit,
  options: FormatLengthFamilyOptions = {},
): string => {
  const nonFiniteText = options.nonFiniteText ?? "—";
  if (!Number.isFinite(canonicalValue)) {
    return nonFiniteText;
  }

  const trimTrailingZeros = options.trimTrailingZeros ?? true;

  if (!isLengthFamilyUnit(canonicalUnit)) {
    // Unknown units: honor caller precision as-is (no length-family min of 1).
    const callerPrec = options.canonicalPrecision ?? 0;
    return formatRoundedText(canonicalValue, callerPrec, trimTrailingZeros);
  }

  const cPrec = resolveCanonicalPrecision(options.canonicalPrecision);
  const displayValue = toDisplayLengthValue(canonicalValue, display);
  const dPrec = resolveDisplayPrecision(cPrec, display);
  return formatRoundedText(displayValue, dPrec, trimTrailingZeros);
};

export const formatLengthFamily = (
  canonicalValue: number,
  canonicalUnit: string,
  display: DisplayLengthUnit,
  options: FormatLengthFamilyOptions = {},
): string => {
  const nonFiniteText = options.nonFiniteText ?? "—";
  if (!Number.isFinite(canonicalValue)) {
    return nonFiniteText;
  }

  const valueText = formatLengthFamilyValue(
    canonicalValue,
    canonicalUnit,
    display,
    options,
  );
  const unitText = isLengthFamilyUnit(canonicalUnit)
    ? getDisplayLengthFamilyUnit(canonicalUnit, display)
    : normalizeLengthFamilyUnit(canonicalUnit);
  return `${valueText} ${unitText}`;
};

export const parseDisplayLengthUnit = (raw: unknown): DisplayLengthUnit => {
  if (typeof raw !== "string") return "mm";
  const trimmed = raw.trim() as DisplayLengthUnit;
  return DISPLAY_LENGTH_UNITS.has(trimmed) ? trimmed : "mm";
};

export const readStoredDisplayLengthUnit = (): DisplayLengthUnit => {
  try {
    return parseDisplayLengthUnit(localStorage.getItem(DISPLAY_LENGTH_UNIT_STORAGE_KEY));
  } catch {
    return "mm";
  }
};

export const writeStoredDisplayLengthUnit = (unit: DisplayLengthUnit): boolean => {
  try {
    localStorage.setItem(DISPLAY_LENGTH_UNIT_STORAGE_KEY, unit);
    return true;
  } catch {
    return false;
  }
};

export const normalizeCanonicalLengthValue = (
  value: number,
  options: NormalizeCanonicalLengthOptions = {},
): number => {
  const { min, max, precision, step } = options;
  const resolvedPrecision = resolveCanonicalPrecision(precision, step);
  return roundToPrecision(clampNumeric(value, min, max), resolvedPrecision);
};
