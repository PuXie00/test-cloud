import { createContext, useContext, type ReactNode } from "react";
import { cn } from "../ui/utils";

const ReadOnlyContext = createContext(false);

/** 在只读范围里（没有编辑权限）：自绘控件（数值拖动、滑块）据此禁用 */
export const useReadOnlyScope = (): boolean => useContext(ReadOnlyContext);

/**
 * 没有编辑权限时整块只读：原生表单控件和按钮由 fieldset disabled 一起禁用，
 * 自绘控件读 useReadOnlyScope；折叠面板仍可展开查看。
 */
export const ReadOnlyScope = ({
  readOnly,
  children,
  className,
}: {
  readOnly: boolean;
  children: ReactNode;
  className?: string;
}) =>
  readOnly ? (
    <ReadOnlyContext.Provider value>
      <fieldset disabled className={cn("m-0 min-w-0 border-0 p-0", className)}>
        {children}
      </fieldset>
    </ReadOnlyContext.Provider>
  ) : (
    <>{children}</>
  );
