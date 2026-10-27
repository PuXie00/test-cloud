import type { ReactNode } from "react";
import { LicenseGatePage } from "@/app/pages/license/license-gate-page";
import { useLicense } from "./use-license";

/**
 * 没放行之前只显示授权页，登录页和后面的页面都不挂载。
 * 放行在主进程里只进不退，所以控制台挂载后不会因为授权再被卸掉（长时间运行）。
 */
export const LicenseGate = ({ children }: { children: ReactNode }) => {
  const { available, state } = useLicense();
  if (!available || state.passed) return <>{children}</>;
  return <LicenseGatePage />;
};
