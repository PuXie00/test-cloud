import type { PermissionsTabId } from "./permissions-types";

export const PERMISSION_TABS: { id: PermissionsTabId; label: string }[] = [
  { id: "users", label: "用户" },
  { id: "roles", label: "角色" },
];

export const DEFAULT_PERMISSIONS_TAB: PermissionsTabId = "users";
