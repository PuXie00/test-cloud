export type UserRole = "admin" | "tech" | "operator";

export type AuthSession = {
  username: string;
  role: UserRole;
  displayName: string;
  loggedInAt: string;
};
