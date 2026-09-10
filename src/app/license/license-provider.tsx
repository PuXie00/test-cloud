import {
  createContext,
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_LICENSE_META,
  DEMO_LICENSE_KEY,
} from "./license-constants";
import { clearStoredLicense, getStoredLicense, setStoredLicense } from "./license-storage";
import type { LicenseRecord } from "./license-types";

type LicenseContextValue = {
  license: LicenseRecord | null;
  isActivated: boolean;
  activate: (licenseKey: string) => boolean;
  clearLicense: () => void;
};

export const LicenseContext = createContext<LicenseContextValue | null>(null);

export const LicenseProvider = ({ children }: { children: ReactNode }) => {
  const [license, setLicense] = useState<LicenseRecord | null>(() => getStoredLicense());

  const activate = useCallback((licenseKey: string) => {
    if (licenseKey.trim() !== DEMO_LICENSE_KEY) return false;
    const record: LicenseRecord = {
      activated: true,
      ...DEFAULT_LICENSE_META,
      activatedAt: new Date().toISOString(),
    };
    setStoredLicense(record);
    setLicense(record);
    return true;
  }, []);

  const clearLicense = useCallback(() => {
    clearStoredLicense();
    setLicense(null);
  }, []);

  const value = useMemo(
    () => ({
      license,
      isActivated: license !== null,
      activate,
      clearLicense,
    }),
    [license, activate, clearLicense],
  );

  return <LicenseContext.Provider value={value}>{children}</LicenseContext.Provider>;
};
