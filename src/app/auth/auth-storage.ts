import type { AuthSession } from "./auth-types";

export const AUTH_SESSION_KEY = "ics.auth.session";

export const getStoredSession = (): AuthSession | null => {
  try {
    const raw = window.sessionStorage.getItem(AUTH_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthSession;
    if (!parsed?.username || !parsed?.displayName) return null;
    return parsed;
  } catch {
    return null;
  }
};

export const setStoredSession = (session: AuthSession): void => {
  window.sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
};

export const clearStoredSession = (): void => {
  window.sessionStorage.removeItem(AUTH_SESSION_KEY);
};
