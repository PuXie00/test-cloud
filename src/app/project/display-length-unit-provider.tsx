import { createContext, useContext, type ReactNode } from "react";
import { AuthContext } from "@/app/auth/auth-provider";
import type { DisplayLengthUnit } from "./display-length-units";

const Ctx = createContext<DisplayLengthUnit | null>(null);

/**
 * 显示单位跟着登录用户走（用户偏好），切换用户或改偏好立即生效。
 * initialUnit 只给测试用；没登录时按毫米。
 */
export const DisplayLengthUnitProvider = ({
  children,
  initialUnit,
}: {
  children: ReactNode;
  initialUnit?: DisplayLengthUnit;
}) => {
  const auth = useContext(AuthContext);
  const unit = initialUnit ?? auth?.user?.preferences.displayLengthUnit ?? "mm";
  return <Ctx.Provider value={unit}>{children}</Ctx.Provider>;
};

export const useSessionDisplayLengthUnit = (): DisplayLengthUnit => {
  const v = useContext(Ctx);
  if (v == null) {
    throw new Error("useSessionDisplayLengthUnit must be used within DisplayLengthUnitProvider");
  }
  return v;
};
