import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  AuthResult,
  AuthSession,
  AuthUser,
  ChangePasswordParams,
  LoginParams,
  LoginWithNewPasswordParams,
  UpdatePreferencesParams,
} from "@shared/auth/types";
import { PermissionsProvider } from "./permissions";

type AuthContextValue = {
  /** 主进程会话读回来之前为 false */
  ready: boolean;
  session: AuthSession | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  login: (params: LoginParams) => Promise<AuthResult<AuthSession>>;
  /** 首次登录 / 密码被重置：改成新密码并登录 */
  loginWithNewPassword: (params: LoginWithNewPasswordParams) => Promise<AuthResult<AuthSession>>;
  logout: () => Promise<void>;
  changePassword: (params: ChangePasswordParams) => Promise<AuthResult<null>>;
  updatePreferences: (params: UpdatePreferencesParams) => Promise<AuthResult<AuthSession | null>>;
  /** 管理员改了自己（显示名等）后重读会话 */
  refreshSession: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

const unavailable = <T,>(): AuthResult<T> => ({
  ok: false,
  code: "UNAVAILABLE",
  message: "当前环境不支持登录",
});

/**
 * 会话由主进程保管（渲染进程刷新、崩溃重载后仍是登录状态）；这里只是镜像。
 * 不轮询：会话只在登录、切换、退出、改偏好时变化。
 */
export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [ready, setReady] = useState(() => !window.authAPI);
  const [session, setSession] = useState<AuthSession | null>(null);

  const refreshSession = useCallback(async () => {
    const api = window.authAPI;
    if (!api) return;
    const result = await api.current();
    setSession(result.ok ? result.data : null);
  }, []);

  useEffect(() => {
    if (!window.authAPI) return;
    let cancelled = false;
    void window.authAPI
      .current()
      .then((result) => {
        if (cancelled) return;
        if (result.ok) setSession(result.data);
        else console.error("[auth] 读取当前会话失败", result.message);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const applySession = useCallback(<T extends AuthSession | null>(result: AuthResult<T>) => {
    if (result.ok) setSession(result.data);
    return result;
  }, []);

  const login = useCallback(
    async (params: LoginParams) =>
      window.authAPI ? applySession(await window.authAPI.login(params)) : unavailable<AuthSession>(),
    [applySession],
  );

  const loginWithNewPassword = useCallback(
    async (params: LoginWithNewPasswordParams) =>
      window.authAPI
        ? applySession(await window.authAPI.loginWithNewPassword(params))
        : unavailable<AuthSession>(),
    [applySession],
  );

  const logout = useCallback(async () => {
    if (window.authAPI) await window.authAPI.logout();
    setSession(null);
  }, []);

  const changePassword = useCallback(
    async (params: ChangePasswordParams) =>
      window.authAPI ? window.authAPI.changePassword(params) : unavailable<null>(),
    [],
  );

  const updatePreferences = useCallback(
    async (params: UpdatePreferencesParams) =>
      window.authAPI
        ? applySession(await window.authAPI.updatePreferences(params))
        : unavailable<AuthSession | null>(),
    [applySession],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      ready,
      session,
      user: session?.user ?? null,
      isAuthenticated: session !== null,
      login,
      loginWithNewPassword,
      logout,
      changePassword,
      updatePreferences,
      refreshSession,
    }),
    [ready, session, login, loginWithNewPassword, logout, changePassword, updatePreferences, refreshSession],
  );

  return (
    <AuthContext.Provider value={value}>
      <PermissionsProvider session={session}>{ready ? children : null}</PermissionsProvider>
    </AuthContext.Provider>
  );
};
