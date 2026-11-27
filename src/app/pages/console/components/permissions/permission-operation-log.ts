import { PERMISSION_POINTS, type PermissionId } from "@shared/auth/permissions";
import type { AuthRole, AuthUser } from "@shared/auth/types";
import { writeConfigOperationLog } from "../../hooks/write-operation-log";

const permissionNames = (permissions: readonly PermissionId[], except: readonly PermissionId[] = []) =>
  PERMISSION_POINTS.filter(point => permissions.includes(point.id) && !except.includes(point.id))
    .map(point => point.label).join("、");

export const logRoleAccess = (previous: AuthRole | null, saved: AuthRole | null): void => {
  if (!saved) {
    if (previous) writeConfigOperationLog("deleteRole", `删除角色「${previous.name}」`);
    return;
  }
  if (!previous) {
    const granted = permissionNames(saved.permissions);
    writeConfigOperationLog("createRole", `创建角色「${saved.name}」，${granted ? `授予「${granted}」` : "未授予权限"}`);
    return;
  }
  const added = permissionNames(saved.permissions, previous.permissions);
  const removed = permissionNames(previous.permissions, saved.permissions);
  const changes = [];
  if (previous.name !== saved.name) changes.push(`更名为「${saved.name}」`);
  if (added) changes.push(`授予「${added}」`);
  if (removed) changes.push(`撤销「${removed}」`);
  if (changes.length) writeConfigOperationLog("updateRole", `角色「${previous.name}」${changes.join("，")}`);
};

export const logUserAccess = (previous: AuthUser | null, saved: AuthUser | null, roles: readonly AuthRole[]): void => {
  const roleName = (id: string) => roles.find(role => role.id === id)?.name ?? id;
  const account = saved ?? previous;
  if (!account) return;
  const target = `用户「${account.displayName}」（${account.username}）`;
  if (!saved) {
    writeConfigOperationLog("deleteUser", `删除${target}，移除角色「${roleName(account.roleId)}」`);
    return;
  }
  if (!previous) {
    writeConfigOperationLog("createUser", `创建${target}，分配角色「${roleName(saved.roleId)}」`);
    return;
  }
  const changes = [];
  if (saved.roleId !== previous.roleId) changes.push(`角色由「${roleName(previous.roleId)}」改为「${roleName(saved.roleId)}」`);
  if (saved.enabled !== previous.enabled) changes.push(saved.enabled ? "启用账号" : "停用账号");
  if (changes.length) writeConfigOperationLog("updateUser", `${target}${changes.join("，")}`);
};
