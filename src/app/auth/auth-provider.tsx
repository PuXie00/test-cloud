import {
  createContext,
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AuthSession } from "./auth-types";
import { clearStoredSession, getStoredSession, setStoredSession } from "./auth-storage";
import { findMockUser } from "./mock-users";

type AuthContextValue = {
  user: AuthSession | null;
  isAuthenticated: boolean;
  login: (username: string, password: string) => boolean;
  logout: () => void;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AuthSession | null>(() => getStoredSession());

  const login = useCallback((username: string, password: string) => {
    const match = findMockUser(username, password);
    if (!match) return false;
    const session: AuthSession = {
      ...match,
      loggedInAt: new Date().toISOString(),
    };
    setStoredSession(session);
    setUser(session);
    return true;
  }, []);

  const logout = useCallback(() => {
    clearStoredSession();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: user !== null,
      login,
      logout,
    }),
    [user, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
