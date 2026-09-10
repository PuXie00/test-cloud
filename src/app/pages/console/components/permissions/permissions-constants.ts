import type {
  PermissionLevel,
  PermissionMatrix,
  PermissionModuleId,
  RoleFilter,
  RoleId,
  RoleRecord,
  SecurityPolicyDefaults,
  UserRecord,
} from "./permissions-types";

export const PERMISSION_TABS = [
  { id: "users" as const, label: "用户管理" },
  { id: "roles" as const, label: "角色配置" },
  { id: "security" as const, label: "安全策略" },
];

export const DEFAULT_PERMISSIONS_TAB = "users" as const;

export const PERMISSION_LEVELS: { id: PermissionLevel; label: string }[] = [
  { id: "view", label: "查看" },
  { id: "operate", label: "操作" },
  { id: "config", label: "配置" },
  { id: "manage", label: "管理" },
];

export const PERMISSION_MODULES: { id: PermissionModuleId; label: string }[] = [
  { id: "project", label: "工程管理" },
  { id: "device", label: "设备调试" },
  { id: "action", label: "动作编辑" },
  { id: "rules", label: "规则引擎" },
  { id: "permissions", label: "权限管理" },
  { id: "settings", label: "系统设置" },
];

const allLevels = (value: boolean): Record<PermissionLevel, boolean> => ({
  view: value,
  operate: value,
  config: value,
  manage: value,
});

const levels = (
  view: boolean,
  operate: boolean,
  config: boolean,
  manage: boolean,
): Record<PermissionLevel, boolean> => ({ view, operate, config, manage });

const buildMatrix = (
  modules: Partial<Record<PermissionModuleId, Record<PermissionLevel, boolean>>>,
): PermissionMatrix => {
  const defaults = allLevels(false);
  return PERMISSION_MODULES.reduce((acc, mod) => {
    acc[mod.id] = modules[mod.id] ?? { ...defaults };
    return acc;
  }, {} as PermissionMatrix);
};

export const ADMIN_MATRIX = buildMatrix(
  Object.fromEntries(
    PERMISSION_MODULES.map((m) => [m.id, allLevels(true)]),
  ) as Record<PermissionModuleId, Record<PermissionLevel, boolean>>,
);

export const TECH_MATRIX = buildMatrix({
  project: levels(true, true, true, false),
  device: levels(true, true, true, false),
  action: levels(true, true, true, false),
  rules: levels(true, true, true, false),
  permissions: levels(true, false, false, false),
  settings: levels(true, false, false, false),
});

export const OPERATOR_MATRIX = buildMatrix({
  project: levels(true, true, false, false),
  device: levels(true, true, false, false),
  action: levels(true, true, false, false),
  rules: levels(true, true, false, false),
  permissions: allLevels(false),
  settings: allLevels(false),
});

export const ROLE_PRESETS: RoleRecord[] = [
  {
    id: "admin",
    label: "管理员",
    description: "所有功能，包括用户管理、系统设置",
    permissions: ADMIN_MATRIX,
  },
  {
    id: "tech",
    label: "技术员",
    description: "工程配置、调试、动作编辑，不可修改权限",
    permissions: TECH_MATRIX,
  },
  {
    id: "operator",
    label: "操作员",
    description: "仅执行和基本操作，不可修改配置",
    permissions: OPERATOR_MATRIX,
  },
];

export const ROLE_LABEL: Record<RoleId, string> = {
  admin: "管理员",
  tech: "技术员",
  operator: "操作员",
};

export const MOCK_USERS: UserRecord[] = [
  {
    id: "u1",
    username: "zhangGong",
    displayName: "张工",
    role: "tech",
    email: "zhang@yzditec.com",
    online: true,
  },
  {
    id: "u2",
    username: "liZong",
    displayName: "李总",
    role: "admin",
    email: "li@yzditec.com",
    online: true,
  },
  {
    id: "u3",
    username: "wangCao",
    displayName: "王操",
    role: "operator",
    email: "wang@yzditec.com",
    online: false,
  },
  {
    id: "u4",
    username: "zhaoBian",
    displayName: "赵编",
    role: "tech",
    email: "zhao@yzditec.com",
    online: false,
  },
];

export const ROLE_FILTERS: { id: RoleFilter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "admin", label: "管理员" },
  { id: "tech", label: "技术员" },
  { id: "operator", label: "操作员" },
];

export const getRolePreset = (roleId: RoleId): PermissionMatrix => {
  const role = ROLE_PRESETS.find((r) => r.id === roleId);
  return role?.permissions ?? TECH_MATRIX;
};

export const cloneMatrix = (matrix: PermissionMatrix): PermissionMatrix =>
  JSON.parse(JSON.stringify(matrix)) as PermissionMatrix;

export const SECURITY_DEFAULTS: SecurityPolicyDefaults = {
  minPasswordLength: "8",
  requireUppercase: true,
  requireNumber: true,
  requireSpecial: false,
  passwordExpiry: "90",
  expiryReminder: "7",
  loginLockEnabled: true,
  maxFailedAttempts: 5,
  lockDuration: "15",
  sessionTimeout: "8",
  maxConcurrentSessions: "1",
  auditPermissionChanges: true,
  auditLoginLogout: true,
  auditRetention: "180",
};
