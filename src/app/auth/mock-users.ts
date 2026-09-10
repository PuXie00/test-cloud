import type { AuthSession, UserRole } from "./auth-types";

export type MockUserRecord = {
  username: string;
  password: string;
  role: UserRole;
  displayName: string;
};

export const MOCK_USERS: MockUserRecord[] = [
  { username: "admin", password: "admin123", role: "admin", displayName: "管理员" },
  { username: "tech", password: "tech123", role: "tech", displayName: "技术员" },
  { username: "operator", password: "op123", role: "operator", displayName: "操作员" },
];

export const findMockUser = (
  username: string,
  password: string,
): Omit<AuthSession, "loggedInAt"> | null => {
  const normalized = username.trim().toLowerCase();
  const match = MOCK_USERS.find((u) => u.username === normalized && u.password === password);
  if (!match) return null;
  return {
    username: match.username,
    role: match.role,
    displayName: match.displayName,
  };
};
