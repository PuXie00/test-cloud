import type { PermissionId } from "@shared/auth/permissions";
import type { AuthResult, AuthSession, AuthUser } from "@shared/auth/types";

/** 测试用的 window.authAPI：只有一个用户，规则从简（完整规则在主进程 AuthService 的测试里） */
export type FakeAuthOptions = {
  username?: string;
  password?: string;
  displayName?: string;
  permissions?: PermissionId[];
  isAdmin?: boolean;
  mustChangePassword?: boolean;
  /** 一开始就登录着（渲染进程刷新后从主进程读回） */
  loggedIn?: boolean;
};

const fail = <T,>(code: "INVALID_CREDENTIALS" | "MUST_CHANGE_PASSWORD" | "NOT_LOGGED_IN", message: string): AuthResult<T> => ({
  ok: false,
  code,
  message,
});

export const installFakeAuthApi = (options: FakeAuthOptions = {}) => {
  const state = {
    password: options.password ?? "1234",
    mustChangePassword: options.mustChangePassword ?? false,
    loggedIn: options.loggedIn ?? false,
    unit: "mm" as AuthUser["preferences"]["displayLengthUnit"],
  };
  const username = options.username ?? "op";
  const permissions = options.permissions ?? [];

  const session = (): AuthSession => ({
    user: {
      id: "u1",
      username,
      displayName: options.displayName ?? "王操",
      roleId: options.isAdmin ? "admin" : "operator",
      enabled: true,
      mustChangePassword: state.mustChangePassword,
      createdAt: "2026-10-26T00:00:00.000Z",
      lastLoginAt: null,
      preferences: { displayLengthUnit: state.unit },
    },
    role: {
      id: options.isAdmin ? "admin" : "operator",
      name: options.isAdmin ? "管理员" : "操作员",
      description: "",
      builtin: options.isAdmin ?? false,
      permissions,
      createdAt: "",
    },
    permissions,
    isAdmin: options.isAdmin ?? false,
    loggedInAt: "2026-10-26T08:00:00.000Z",
  });

  const ok = <T,>(data: T): AuthResult<T> => ({ ok: true, data });
  const checkCredentials = (params: { username: string; password: string }) =>
    params.username.trim().toLowerCase() === username && params.password === state.password;

  const api = {
    current: async () => ok(state.loggedIn ? session() : null),
    login: async (params: { username: string; password: string }) => {
      if (!checkCredentials(params)) return fail<AuthSession>("INVALID_CREDENTIALS", "用户名或密码错误");
      if (state.mustChangePassword) return fail<AuthSession>("MUST_CHANGE_PASSWORD", "请先修改密码再登录");
      state.loggedIn = true;
      return ok(session());
    },
    loginWithNewPassword: async (params: { username: string; password: string; newPassword: string }) => {
      if (!checkCredentials(params)) return fail<AuthSession>("INVALID_CREDENTIALS", "用户名或密码错误");
      state.password = params.newPassword;
      state.mustChangePassword = false;
      state.loggedIn = true;
      return ok(session());
    },
    logout: async () => {
      state.loggedIn = false;
      return ok(null);
    },
    changePassword: async () => ok(null),
    updatePreferences: async (params: { displayLengthUnit?: AuthUser["preferences"]["displayLengthUnit"] }) => {
      if (!state.loggedIn) return fail<AuthSession | null>("NOT_LOGGED_IN", "请先登录");
      if (params.displayLengthUnit) state.unit = params.displayLengthUnit;
      return ok<AuthSession | null>(session());
    },
    listUsers: async () => ok([session().user]),
    createUser: async () => ok(session().user),
    updateUser: async () => ok(session().user),
    resetPassword: async () => ok(session().user),
    deleteUser: async () => ok(null),
    listRoles: async () => ok([session().role]),
    createRole: async () => ok(session().role),
    updateRole: async () => ok(session().role),
    deleteRole: async () => ok(null),
  };
  window.authAPI = api as unknown as NonNullable<Window["authAPI"]>;
  return { api, state };
};

export const uninstallFakeAuthApi = () => {
  delete window.authAPI;
};
