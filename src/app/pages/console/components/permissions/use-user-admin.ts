import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type {
  AuthResult, AuthRole, AuthUser, CreateRoleParams, CreateUserParams, UpdateRoleParams, UpdateUserParams,
} from "@shared/auth/types";
import { useAuth } from "@/app/auth/use-auth";
import { logRoleAccess, logUserAccess } from "./permission-operation-log";

export type UserAdmin = ReturnType<typeof useUserAdmin>;

/** 用户与权限对话框的数据：打开时读一次，改完再读，不轮询 */
export const useUserAdmin = (open: boolean) => {
  const { refreshSession } = useAuth();
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [roles, setRoles] = useState<AuthRole[]>([]);
  const [loading, setLoading] = useState(false);
  const [permissionsPending, setPermissionsPending] = useState(false);
  const permissionsInFlight = useRef(false);
  // 已确认的状态用于比较相邻两次写入；UI 的列表在重读期间可能还是旧的一帧。
  const knownUsers = useRef(new Map<string, AuthUser>());
  const knownRoles = useRef(new Map<string, AuthRole>());
  const revision = useRef(0);

  const reload = useCallback(async () => {
    const api = window.authAPI;
    if (!api) return;
    const version = revision.current;
    const [userResult, roleResult] = await Promise.all([api.listUsers(), api.listRoles()]);
    if (version !== revision.current) return;
    if (userResult.ok) {
      knownUsers.current = new Map(userResult.data.map(user => [user.id, user]));
      setUsers(userResult.data);
    } else toast.error(userResult.message);
    if (roleResult.ok) {
      knownRoles.current = new Map(roleResult.data.map(role => [role.id, role]));
      setRoles(roleResult.data);
    } else toast.error(roleResult.message);
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void reload().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, reload]);

  const run = useCallback(
    async <T,>(action: () => Promise<AuthResult<T>> | undefined, success?: string, onSaved?: (data: T) => void) => {
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
      revision.current++;
      onSaved?.(result.data);
      if (success) toast.success(success);
      await Promise.all([reload(), refreshSession()]);
      return { data: result.data };
    },
    [reload, refreshSession],
  );

  const saveRole = async (params: CreateRoleParams | UpdateRoleParams, success?: string) => {
    // 角色权限提交整张勾选表；下一次勾选必须基于这次刷新后的结果。
    const editingPermissions = "id" in params && params.permissions !== undefined;
    if (editingPermissions) {
      if (permissionsInFlight.current) return null;
      permissionsInFlight.current = true;
      setPermissionsPending(true);
    }
    try {
      return await run(() => "id" in params ? window.authAPI?.updateRole(params) : window.authAPI?.createRole(params), success, saved => {
        const previous = knownRoles.current.get(saved.id);
        if (previous || !("id" in params)) logRoleAccess(previous ?? null, saved);
        knownRoles.current.set(saved.id, saved);
      });
    } finally {
      if (editingPermissions) {
        permissionsInFlight.current = false;
        setPermissionsPending(false);
      }
    }
  };

  const deleteRole = (role: AuthRole) => run(() => window.authAPI?.deleteRole({ id: role.id }), "角色已删除", () => {
    logRoleAccess(knownRoles.current.get(role.id) ?? role, null);
    knownRoles.current.delete(role.id);
  });

  const saveUser = (params: CreateUserParams | UpdateUserParams, success?: string) =>
    run(() => "id" in params ? window.authAPI?.updateUser(params) : window.authAPI?.createUser(params), success, saved => {
      const previous = knownUsers.current.get(saved.id);
      if (previous || !("id" in params)) logUserAccess(previous ?? null, saved, [...knownRoles.current.values()]);
      knownUsers.current.set(saved.id, saved);
    });

  const deleteUser = (user: AuthUser) => run(() => window.authAPI?.deleteUser({ id: user.id }), "用户已删除", () => {
    logUserAccess(knownUsers.current.get(user.id) ?? user, null, [...knownRoles.current.values()]);
    knownUsers.current.delete(user.id);
  });

  return { users, roles, loading, permissionsPending, run, saveRole, deleteRole, saveUser, deleteUser };
};
