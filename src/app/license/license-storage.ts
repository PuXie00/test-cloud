import type { LicenseRecord } from "./license-types";
import { LICENSE_STORAGE_KEY } from "./license-constants";

const readRaw = (): string | null => {
  try {
    const persistent = window.localStorage.getItem(LICENSE_STORAGE_KEY);
    if (persistent) return persistent;
    return null;
  } catch {
    return null;
  }
};

export const getStoredLicense = (): LicenseRecord | null => {
  try {
    const raw = readRaw();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LicenseRecord;
    if (!parsed?.activated) return null;
    return parsed;
  } catch {
    return null;
  }
};

export const setStoredLicense = (record: LicenseRecord): void => {
  const raw = JSON.stringify(record);
  window.localStorage.setItem(LICENSE_STORAGE_KEY, raw);
  try {
    window.sessionStorage.removeItem(LICENSE_STORAGE_KEY);
  } catch {
    // ignore
  }
};

export const clearStoredLicense = (): void => {
  try {
    window.localStorage.removeItem(LICENSE_STORAGE_KEY);
    window.sessionStorage.removeItem(LICENSE_STORAGE_KEY);
  } catch {
    // ignore
  }
};
