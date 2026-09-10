import { useContext } from "react";
import { LicenseContext } from "./license-provider";

export const useLicense = () => {
  const ctx = useContext(LicenseContext);
  if (!ctx) throw new Error("useLicense must be used within LicenseProvider");
  return ctx;
};
