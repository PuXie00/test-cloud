export type HoistLabelMode = "hoist" | "motor";

export const HOIST_LABEL_MODE_STORAGE_KEY = "yz.console.hoistLabelMode";
export const DEFAULT_HOIST_LABEL_MODE: HoistLabelMode = "hoist";
export const UNBOUND_HOIST_LABEL_TEXT = "—";

export const parseHoistLabelMode = (raw: unknown): HoistLabelMode =>
  raw === "motor" ? "motor" : "hoist";

export const readStoredHoistLabelMode = (): HoistLabelMode => {
  try {
    return parseHoistLabelMode(localStorage.getItem(HOIST_LABEL_MODE_STORAGE_KEY));
  } catch {
    return DEFAULT_HOIST_LABEL_MODE;
  }
};

export const writeStoredHoistLabelMode = (mode: HoistLabelMode): void => {
  try {
    localStorage.setItem(HOIST_LABEL_MODE_STORAGE_KEY, mode);
  } catch {
    // ignore quota / private-mode failures
  }
};

export const resolveHoistLabelText = (
  mode: HoistLabelMode,
  axisIndex: number,
  motorDisplayIndex: number | null,
): string => {
  if (mode === "hoist") return `${axisIndex + 1}`;
  if (motorDisplayIndex == null) return UNBOUND_HOIST_LABEL_TEXT;
  return `${motorDisplayIndex + 1}`;
};
