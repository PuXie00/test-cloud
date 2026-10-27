/** 本机用户与权限：主进程 / 渲染进程共用契约 */
import type { PermissionId } from './permissions'

export type AuthErrorCode =
  /** 用户名或密码错误 */
  | 'INVALID_CREDENTIALS'
  /** 账号已停用 */
  | 'USER_DISABLED'
  /** 首次登录或密码被重置，改完密码才能登录 */
  | 'MUST_CHANGE_PASSWORD'
  | 'NOT_LOGGED_IN'
  /** 没有权限（用户与角色管理只给管理员） */
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  /** 重名、角色还有人在用、最后一个管理员等 */
  | 'CONFLICT'
  | 'STORAGE_ERROR'
  /** 渲染进程拿不到 authAPI（测试 / 纯浏览器环境） */
  | 'UNAVAILABLE'

export type AuthResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: AuthErrorCode; message: string }

export type DisplayLengthUnitPreference = 'mm' | 'cm' | 'm' | 'in'

/** 跟着用户走的偏好 */
export type UserPreferences = {
  displayLengthUnit: DisplayLengthUnitPreference
}

/** 用户（不含密码哈希，哈希不出主进程） */
export type AuthUser = {
  id: string
  /** 登录用，本机唯一，不区分大小写，创建后不能改 */
  username: string
  /** 界面和操作日志里显示，本机唯一 */
  displayName: string
  roleId: string
  enabled: boolean
  /** 首次登录 / 密码被重置后要先改密码 */
  mustChangePassword: boolean
  createdAt: string
  lastLoginAt: string | null
  preferences: UserPreferences
}

export type AuthRole = {
  id: string
  name: string
  description: string
  /** 内置管理员角色 */
  builtin: boolean
  permissions: PermissionId[]
  createdAt: string
}

export type AuthSession = {
  user: AuthUser
  role: AuthRole
  /** 角色当前的权限（管理员为全部） */
  permissions: PermissionId[]
  /** 管理员：外加用户与权限管理 */
  isAdmin: boolean
  loggedInAt: string
}

export type LoginParams = { username: string; password: string }

export type LoginWithNewPasswordParams = LoginParams & { newPassword: string }

export type ChangePasswordParams = { oldPassword: string; newPassword: string }

export type UpdatePreferencesParams = Partial<UserPreferences>

export type CreateUserParams = {
  username: string
  displayName: string
  roleId: string
  password: string
  /** 下次登录要先改密码 */
  mustChangePassword: boolean
}

export type UpdateUserParams = {
  id: string
  displayName?: string
  roleId?: string
  enabled?: boolean
}

export type ResetPasswordParams = {
  id: string
  password: string
  mustChangePassword: boolean
}

export type DeleteUserParams = { id: string }

export type CreateRoleParams = {
  name: string
  description?: string
  permissions: PermissionId[]
}

export type UpdateRoleParams = {
  id: string
  name?: string
  description?: string
  permissions?: PermissionId[]
}

export type DeleteRoleParams = { id: string }

export const MIN_PASSWORD_LENGTH = 4
export const MAX_PASSWORD_LENGTH = 64
export const MAX_NAME_LENGTH = 32

/** 首次使用自动建的管理员账号；默认密码写进说明书，登录后必须先改 */
export const DEFAULT_ADMIN_USERNAME = 'admin'
export const DEFAULT_ADMIN_PASSWORD = 'admin123'

export const AUTH_CHANNELS = {
  current: 'auth:current',
  login: 'auth:login',
  loginWithNewPassword: 'auth:login-with-new-password',
  logout: 'auth:logout',
  changePassword: 'auth:change-password',
  updatePreferences: 'auth:update-preferences',
  listUsers: 'auth:users:list',
  createUser: 'auth:users:create',
  updateUser: 'auth:users:update',
  resetPassword: 'auth:users:reset-password',
  deleteUser: 'auth:users:delete',
  listRoles: 'auth:roles:list',
  createRole: 'auth:roles:create',
  updateRole: 'auth:roles:update',
  deleteRole: 'auth:roles:delete',
} as const
