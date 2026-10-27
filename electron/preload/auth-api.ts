import { ipcRenderer } from 'electron'
import {
  AUTH_CHANNELS,
  type AuthResult,
  type AuthRole,
  type AuthSession,
  type AuthUser,
  type ChangePasswordParams,
  type CreateRoleParams,
  type CreateUserParams,
  type DeleteRoleParams,
  type DeleteUserParams,
  type LoginParams,
  type LoginWithNewPasswordParams,
  type ResetPasswordParams,
  type UpdatePreferencesParams,
  type UpdateRoleParams,
  type UpdateUserParams,
} from '../../shared/auth/types'

const call =
  <P, T>(channel: string) =>
  (params: P): Promise<AuthResult<T>> =>
    ipcRenderer.invoke(channel, params) as Promise<AuthResult<T>>

/** 本机用户与权限：window.authAPI */
export const createAuthApi = () => ({
  current: () => ipcRenderer.invoke(AUTH_CHANNELS.current) as Promise<AuthResult<AuthSession | null>>,
  login: call<LoginParams, AuthSession>(AUTH_CHANNELS.login),
  loginWithNewPassword: call<LoginWithNewPasswordParams, AuthSession>(
    AUTH_CHANNELS.loginWithNewPassword,
  ),
  logout: () => ipcRenderer.invoke(AUTH_CHANNELS.logout) as Promise<AuthResult<null>>,
  changePassword: call<ChangePasswordParams, null>(AUTH_CHANNELS.changePassword),
  updatePreferences: call<UpdatePreferencesParams, AuthSession | null>(
    AUTH_CHANNELS.updatePreferences,
  ),
  listUsers: () => ipcRenderer.invoke(AUTH_CHANNELS.listUsers) as Promise<AuthResult<AuthUser[]>>,
  createUser: call<CreateUserParams, AuthUser>(AUTH_CHANNELS.createUser),
  updateUser: call<UpdateUserParams, AuthUser>(AUTH_CHANNELS.updateUser),
  resetPassword: call<ResetPasswordParams, AuthUser>(AUTH_CHANNELS.resetPassword),
  deleteUser: call<DeleteUserParams, null>(AUTH_CHANNELS.deleteUser),
  listRoles: () => ipcRenderer.invoke(AUTH_CHANNELS.listRoles) as Promise<AuthResult<AuthRole[]>>,
  createRole: call<CreateRoleParams, AuthRole>(AUTH_CHANNELS.createRole),
  updateRole: call<UpdateRoleParams, AuthRole>(AUTH_CHANNELS.updateRole),
  deleteRole: call<DeleteRoleParams, null>(AUTH_CHANNELS.deleteRole),
})

export type AuthAPI = ReturnType<typeof createAuthApi>
