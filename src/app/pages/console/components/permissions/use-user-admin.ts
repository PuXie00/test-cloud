import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { AuthResult, AuthRole, AuthUser } from "@shared/auth/types";
import { useAuth } from "@/app/auth/use-auth";

export type UserAdmin = {
  users: AuthUser[];
  roles: AuthRole[];
  loading: boolean;
  /**
   * 调一次管理接口：成功后重读用户、角色和自己的会话；失败弹提示并返回 null
   * （界面据此把输入框还原）。
   */
  run: <T>(
    action: () => Promise<AuthResult<T>> | undefined,
    success?: string,
  ) => Promise<{ data: T } | null>;
};

/** 用户与权限对话框的数据：打开时读一次，改完再读，不轮询 */
export const useUserAdmin = (open: boolean): UserAdmin => {
  const { refreshSession } = useAuth();
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [roles, setRoles] = useState<AuthRole[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    const api = window.authAPI;
    if (!api) return;
    const [userResult, roleResult] = await Promise.all([api.listUsers(), api.listRoles()]);
    if (userResult.ok) setUsers(userResult.data);
    else toast.error(userResult.message);
    if (roleResult.ok) setRoles(roleResult.data);
    else toast.error(roleResult.message);
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void reload().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, reload]);

  const run = useCallback(
    async <T,>(action: () => Promise<AuthResult<T>> | undefined, success?: string) => {
      const pending = action();
      if (!pending) {
        toast.error("当前环境不支持用户管理");
        return null;
      }
      const result = await pending;
      if (!result.ok) {
        toast.error(result.message);
        return null;
      }
      if (success) toast.success(success);
      await Promise.all([reload(), refreshSession()]);
      return { data: result.data };
    },
    [reload, refreshSession],
  );

  return { users, roles, loading, run };
};
