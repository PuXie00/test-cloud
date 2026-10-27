import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { PermissionId } from "@shared/auth/permissions";
import type { AuthSession } from "@shared/auth/types";

export type PermissionsValue = {
  /** 当前用户有没有这个权限；没登录时一律没有 */
  can: (permission: PermissionId) => boolean;
  /** 有其中任意一个 */
  canAny: (...permissions: PermissionId[]) => boolean;
  /** 管理员：外加用户与权限管理 */
  isAdmin: boolean;
};

const ALLOW_ALL: PermissionsValue = {
  can: () => true,
  canAny: () => true,
  isAdmin: true,
};

/**
 * 没有 AuthProvider 时（只渲染局部的单元测试）按全部权限处理；
 * 软件里 AuthProvider 包在最外层，不会走到默认值。
 */
const PermissionsContext = createContext<PermissionsValue>(ALLOW_ALL);

export const PermissionsProvider = ({
  session,
  children,
}: {
  session: AuthSession | null;
  children: ReactNode;
}) => {
  const value = useMemo<PermissionsValue>(() => {
    const granted = new Set<PermissionId>(session?.permissions ?? []);
    const can = (permission: PermissionId) => granted.has(permission);
    return {
      can,
      canAny: (...permissions) => permissions.some(can),
      isAdmin: session?.isAdmin ?? false,
    };
  }, [session]);
  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
};

/** 测试里指定权限 */
export const TestPermissionsProvider = ({
  permissions,
  isAdmin = false,
  children,
}: {
  permissions: readonly PermissionId[];
  isAdmin?: boolean;
  children: ReactNode;
}) => {
  const value = useMemo<PermissionsValue>(() => {
    const granted = new Set(permissions);
    const can = (permission: PermissionId) => granted.has(permission);
    return { can, canAny: (...ids) => ids.some(can), isAdmin };
  }, [permissions, isAdmin]);
  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
};

export const usePermissions = (): PermissionsValue => useContext(PermissionsContext);

/** 有权限才渲染（按钮、菜单项、标签页）；anyOf 有其一即可 */
export const Can = ({
  permission,
  anyOf,
  children,
  fallback = null,
}: {
  permission?: PermissionId;
  anyOf?: readonly PermissionId[];
  children: ReactNode;
  fallback?: ReactNode;
}) => {
  const { can } = usePermissions();
  const allowed = (permission ? can(permission) : true) && (anyOf ? anyOf.some(can) : true);
  return <>{allowed ? children : fallback}</>;
};
