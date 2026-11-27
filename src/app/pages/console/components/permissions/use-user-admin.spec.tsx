// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AuthRole, AuthUser } from "@shared/auth/types";
import { useUserAdmin } from "./use-user-admin";

const { write, refresh } = vi.hoisted(() => ({ write: vi.fn(), refresh: vi.fn() }));
vi.mock("../../hooks/write-operation-log", () => ({ writeConfigOperationLog: write }));
vi.mock("@/app/auth/use-auth", () => ({ useAuth: () => ({ refreshSession: refresh }) }));
const role: AuthRole = { id: "ops", name: "操作员", description: "", builtin: false, permissions: ["log.view"], createdAt: "" };
const user: AuthUser = { id: "user1", username: "lin", displayName: "小林", roleId: "ops", enabled: true,
  mustChangePassword: false, createdAt: "", lastLoginAt: null, preferences: { displayLengthUnit: "mm" } };
const ok = <T,>(data: T) => ({ ok: true as const, data });

function setup() {
  const monitor = { ...role, id: "view", name: "监看" };
  let storedRoles = [role, monitor];
  let storedUsers = [user];
  const api = {
    listRoles: vi.fn(async () => ok(storedRoles)),
    listUsers: vi.fn(async () => ok(storedUsers)),
    updateRole: vi.fn(async () => {
      storedRoles = [{ ...role, permissions: ["action.view", "action.edit"] }, monitor];
      return ok(storedRoles[0]!);
    }),
    createUser: vi.fn(async () => {
      const added = { ...user, id: "new", username: "mei", displayName: "小梅", roleId: "view" };
      storedUsers = [...storedUsers, added];
      return ok(added);
    }),
    updateUser: vi.fn(async () => {
      storedUsers = [{ ...user, roleId: "view" }];
      return ok(storedUsers[0]!);
    }),
  };
  window.authAPI = api as unknown as Window["authAPI"];
  return { api, ...renderHook(() => useUserAdmin(true)) };
}

afterEach(() => { cleanup(); delete window.authAPI; vi.clearAllMocks(); });

it("角色保存成功后按主进程实际返回的授权记录中文差异，先发日志再刷新", async () => {
  const { api, result } = setup();
  await waitFor(() => expect(result.current.roles).toHaveLength(2));
  expect(write).not.toHaveBeenCalled();
  api.listRoles.mockClear();
  await act(async () => { await result.current.saveRole({ id: role.id, permissions: ["action.edit"] }); });
  expect(write).toHaveBeenCalledTimes(1);
  const [, message] = write.mock.calls[0]!;
  expect(message).toContain("操作员");
  expect(message).toContain("授予「进入动作页、编辑动作序列」");
  expect(message).toContain("撤销「操作日志与回放」");
  expect(write.mock.invocationCallOrder[0]).toBeLessThan(api.listRoles.mock.invocationCallOrder[0]!);
  expect(write.mock.invocationCallOrder[0]).toBeLessThan(refresh.mock.invocationCallOrder[0]!);
  await act(async () => { await result.current.saveRole({ id: role.id, permissions: ["action.edit"] }); });
  expect(write).toHaveBeenCalledTimes(1);
});

it("记录用户角色分配和改派，不包含创建用密码；拒绝授权时不发成功事件", async () => {
  const { result } = setup();
  await waitFor(() => expect(result.current.users).toHaveLength(1));
  await act(async () => {
    await result.current.saveUser({ username: "mei", displayName: "小梅", roleId: "view", password: "test-password", mustChangePassword: true });
    await result.current.saveUser({ id: user.id, roleId: "view" });
  });
  expect(write).toHaveBeenCalledTimes(2);
  expect(write.mock.calls[0]![1]).toContain("监看");
  expect(write.mock.calls[1]![1]).toMatch(/小林.*操作员.*监看/);
  expect(JSON.stringify(write.mock.calls)).not.toContain("test-password");
  window.authAPI!.updateRole = vi.fn(async () => ({ ok: false, code: "FORBIDDEN", message: "无权限" }));
  await act(async () => { await result.current.saveRole({ id: role.id, permissions: [] }); });
  expect(write).toHaveBeenCalledTimes(2);
});

it("权限列表重读完成前不会提交第二份旧勾选表", async () => {
  const { api, result } = setup();
  await waitFor(() => expect(result.current.roles).toHaveLength(2));
  let finishRefresh!: () => void;
  refresh.mockImplementationOnce(() => new Promise<void>(resolve => { finishRefresh = resolve; }));
  let first!: ReturnType<typeof result.current.saveRole>;
  await act(async () => { first = result.current.saveRole({ id: role.id, permissions: ["action.edit"] }); });
  expect(result.current.permissionsPending).toBe(true);
  await act(async () => {
    expect(await result.current.saveRole({ id: role.id, permissions: ["log.view", "project.save"] })).toBeNull();
  });
  expect(api.updateRole).toHaveBeenCalledTimes(1);
  await act(async () => { finishRefresh(); await first; });
  expect(result.current.permissionsPending).toBe(false);
  expect(write).toHaveBeenCalledTimes(1);
});

it("记录角色和账号生命周期的授权变化，身份显示信息或密码单独修改不记作授权", async () => {
  const { api, result } = setup();
  await waitFor(() => expect(result.current.roles.length).toBe(2));
  const copied = { ...role, id: "copy", name: "操作员副本" };
  window.authAPI!.createRole = vi.fn(async () => ok(copied));
  window.authAPI!.deleteRole = vi.fn(async () => ok(null));
  window.authAPI!.deleteUser = vi.fn(async () => ok(null));
  await act(async () => {
    await result.current.saveRole({ name: copied.name, permissions: copied.permissions });
    await result.current.deleteRole(copied);
    api.updateUser.mockResolvedValueOnce(ok({ ...user, enabled: false }));
    await result.current.saveUser({ id: user.id, enabled: false });
    api.updateUser.mockResolvedValueOnce(ok({ ...user, displayName: "林师傅" }));
    await result.current.saveUser({ id: user.id, displayName: "林师傅" });
    await result.current.run(async () => ok(null), "密码已重置");
    await result.current.deleteUser(user);
  });
  expect(write.mock.calls.map(call => call[0])).toEqual(["createRole", "deleteRole", "updateUser", "deleteUser"]);
  expect(write.mock.calls[0]![1]).toContain("授予「操作日志与回放」");
  expect(write.mock.calls[2]![1]).toContain("停用账号");
});
