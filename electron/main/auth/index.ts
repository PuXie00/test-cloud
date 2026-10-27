import { app, ipcMain } from 'electron'
import path from 'node:path'
import { AUTH_CHANNELS, type AuthSession } from '../../../shared/auth/types'
import { AuthService } from './service'
import { createFileAuthStorage } from './storage'

/**
 * 用户跟着电脑走：存在本机用户数据目录，不进工程目录。
 * 安装包配置了卸载不删用户数据目录，升级、重装后用户还在。可用 YZ_USERS_FILE 覆盖。
 */
export const getUsersFilePath = (): string => {
  const override = process.env.YZ_USERS_FILE?.trim()
  if (override) return path.resolve(override)
  return path.join(app.getPath('userData'), 'users.json')
}

let service: AuthService | null = null

export type RegisterAuthOptions = {
  onSessionChange?: (session: AuthSession | null) => void
}

export const registerAuthHandlers = (options: RegisterAuthOptions = {}): void => {
  if (service) return
  const auth = new AuthService({
    storage: createFileAuthStorage(getUsersFilePath()),
    onSessionChange: options.onSessionChange,
  })
  service = auth

  ipcMain.handle(AUTH_CHANNELS.current, () => auth.current())
  ipcMain.handle(AUTH_CHANNELS.login, (_e, params) => auth.login(params ?? {}))
  ipcMain.handle(AUTH_CHANNELS.loginWithNewPassword, (_e, params) =>
    auth.loginWithNewPassword(params ?? {}),
  )
  ipcMain.handle(AUTH_CHANNELS.logout, () => auth.logout())
  ipcMain.handle(AUTH_CHANNELS.changePassword, (_e, params) => auth.changePassword(params ?? {}))
  ipcMain.handle(AUTH_CHANNELS.updatePreferences, (_e, params) =>
    auth.updatePreferences(params ?? {}),
  )
  ipcMain.handle(AUTH_CHANNELS.listUsers, () => auth.listUsers())
  ipcMain.handle(AUTH_CHANNELS.createUser, (_e, params) => auth.createUser(params ?? {}))
  ipcMain.handle(AUTH_CHANNELS.updateUser, (_e, params) => auth.updateUser(params ?? {}))
  ipcMain.handle(AUTH_CHANNELS.resetPassword, (_e, params) => auth.resetPassword(params ?? {}))
  ipcMain.handle(AUTH_CHANNELS.deleteUser, (_e, params) => auth.deleteUser(params ?? {}))
  ipcMain.handle(AUTH_CHANNELS.listRoles, () => auth.listRoles())
  ipcMain.handle(AUTH_CHANNELS.createRole, (_e, params) => auth.createRole(params ?? {}))
  ipcMain.handle(AUTH_CHANNELS.updateRole, (_e, params) => auth.updateRole(params ?? {}))
  ipcMain.handle(AUTH_CHANNELS.deleteRole, (_e, params) => auth.deleteRole(params ?? {}))
}
