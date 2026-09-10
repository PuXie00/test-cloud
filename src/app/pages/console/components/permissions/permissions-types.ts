export type PermissionsTabId = "users" | "roles" | "security";

export type RoleId = "admin" | "tech" | "operator";

export type PermissionLevel = "view" | "operate" | "config" | "manage";

export type PermissionModuleId =
  | "project"
  | "device"
  | "action"
  | "rules"
  | "permissions"
  | "settings";

export type PermissionMatrix = Record<
  PermissionModuleId,
  Record<PermissionLevel, boolean>
>;

export type UserRecord = {
  id: string;
  username: string;
  displayName: string;
  role: RoleId;
  email: string;
  online: boolean;
};

export type RoleRecord = {
  id: RoleId;
  label: string;
  description: string;
  permissions: PermissionMatrix;
};

export type RoleFilter = "all" | RoleId;

export type SecurityPolicyDefaults = {
  minPasswordLength: string;
  requireUppercase: boolean;
  requireNumber: boolean;
  requireSpecial: boolean;
  passwordExpiry: string;
  expiryReminder: string;
  loginLockEnabled: boolean;
  maxFailedAttempts: number;
  lockDuration: string;
  sessionTimeout: string;
  maxConcurrentSessions: string;
  auditPermissionChanges: boolean;
  auditLoginLogout: boolean;
  auditRetention: string;
};
