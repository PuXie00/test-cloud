import { randomUUID } from 'node:crypto'
import {
  ADMIN_ROLE_ID,
  ALL_PERMISSION_IDS,
  PRESET_ROLES,
  normalizePermissions,
  type PermissionId,
} from '../../../shared/auth/permissions'
import {
  DEFAULT_ADMIN_PASSWORD,
  DEFAULT_ADMIN_USERNAME,
  MAX_NAME_LENGTH,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  type AuthErrorCode,
  type AuthResult,
  type AuthRole,
  type AuthSession,
  type AuthUser,
  type ChangePasswordParams,
  type CreateRoleParams,
  type CreateUserParams,
  type DeleteRoleParams,
  type DeleteUserParams,
  type DisplayLengthUnitPreference,
  type LoginParams,
  type LoginWithNewPasswordParams,
  type ResetPasswordParams,
  type UpdatePreferencesParams,
  type UpdateRoleParams,
  type UpdateUserParams,
  type UserPreferences,
} from '../../../shared/auth/types'
import { hashPassword, verifyPassword } from './password'
import type { AuthStorage } from './storage'

type StoredRole = {
  id: string
  name: string
  description: string
  permissions: PermissionId[]
  createdAt: string
}

type StoredUser = Omit<AuthUser, 'preferences'> & {
  passwordHash: string
  preferences: UserPreferences
}

type AuthData = {
  version: 1
  roles: StoredRole[]
  users: StoredUser[]
}

export type AuthServiceDeps = {
  storage: AuthStorage
  now?: () => Date
  newId?: () => string
  /** 登录、切换、退出，以及当前用户的显示名 / 偏好变化时调用 */
  onSessionChange?: (session: AuthSession | null) => void
}

const MAX_DESCRIPTION_LENGTH = 100
const DISPLAY_UNITS = new Set<DisplayLengthUnitPreference>(['mm', 'cm', 'm', 'in'])
const DEFAULT_PREFERENCES: UserPreferences = { displayLengthUnit: 'mm' }

class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message: string,
  ) {
    super(message)
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

const usernameKey = (username: string) => username.trim().toLowerCase()

const parsePreferences = (raw: unknown): UserPreferences => {
  const unit = isRecord(raw) ? raw.displayLengthUnit : undefined
  return {
    displayLengthUnit: DISPLAY_UNITS.has(unit as DisplayLengthUnitPreference)
      ? (unit as DisplayLengthUnitPreference)
      : DEFAULT_PREFERENCES.displayLengthUnit,
  }
}

const parseRole = (raw: unknown): StoredRole | null => {
  if (!isRecord(raw) || !text(raw.id) || !text(raw.name)) return null
  return {
    id: text(raw.id),
    name: text(raw.name),
    description: text(raw.description),
    permissions: normalizePermissions(Array.isArray(raw.permissions) ? raw.permissions : []),
    createdAt: text(raw.createdAt),
  }
}

const parseUser = (raw: unknown): StoredUser | null => {
  if (!isRecord(raw)) return null
  const id = text(raw.id)
  const username = text(raw.username).trim()
  const passwordHash = text(raw.passwordHash)
  if (!id || !username || !passwordHash) return null
  return {
    id,
    username,
    displayName: text(raw.displayName).trim() || username,
    roleId: text(raw.roleId),
    enabled: raw.enabled !== false,
    mustChangePassword: raw.mustChangePassword === true,
    createdAt: text(raw.createdAt),
    lastLoginAt: text(raw.lastLoginAt) || null,
    passwordHash,
    preferences: parsePreferences(raw.preferences),
  }
}

const toPublicUser = ({ passwordHash: _hash, ...user }: StoredUser): AuthUser => ({
  ...user,
  preferences: { ...user.preferences },
})

const toPublicRole = (role: StoredRole): AuthRole => {
  const builtin = role.id === ADMIN_ROLE_ID
  return {
    ...role,
    builtin,
    // 以后新增的权限点管理员自动拥有
    permissions: builtin ? [...ALL_PERMISSION_IDS] : [...role.permissions],
  }
}

const validateName = (raw: string, what: string): string => {
  const value = raw.trim()
  if (!value) throw new AuthError('INVALID_INPUT', `请输入${what}`)
  if (value.length > MAX_NAME_LENGTH) {
    throw new AuthError('INVALID_INPUT', `${what}不能超过 ${MAX_NAME_LENGTH} 个字符`)
  }
  return value
}

const validateUsername = (raw: string): string => {
  const value = validateName(raw, '用户名')
  if (/\s/.test(value)) throw new AuthError('INVALID_INPUT', '用户名不能包含空格')
  return value
}

const validatePassword = (password: string): void => {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new AuthError('INVALID_INPUT', `密码至少 ${MIN_PASSWORD_LENGTH} 位`)
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new AuthError('INVALID_INPUT', `密码不能超过 ${MAX_PASSWORD_LENGTH} 位`)
  }
}

const validateDescription = (raw: string | undefined): string => {
  const value = (raw ?? '').trim()
  if (value.length > MAX_DESCRIPTION_LENGTH) {
    throw new AuthError('INVALID_INPUT', `说明不能超过 ${MAX_DESCRIPTION_LENGTH} 个字符`)
  }
  return value
}

const enabledAdminCount = (users: readonly StoredUser[]) =>
  users.filter((user) => user.enabled && user.roleId === ADMIN_ROLE_ID).length

/**
 * 本机用户、角色和当前会话。会话只在内存里：渲染进程刷新不用重新登录，软件退出即结束。
 * 所有操作排队执行，避免两次 IPC 交错写文件。
 */
export class AuthService {
  private data: AuthData | null = null
  private sessionUserId: string | null = null
  private loggedInAt: string | null = null
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly deps: AuthServiceDeps) {}

  current() {
    return this.run(async (data) => this.sessionOf(data))
  }

  login(params: LoginParams) {
    return this.run(async (data) => {
      const user = await this.verifyCredentials(data, params)
      if (user.mustChangePassword) {
        throw new AuthError('MUST_CHANGE_PASSWORD', '请先修改密码再登录')
      }
      return this.startSession(data, user)
    })
  }

  /** 首次登录 / 密码被重置后：验证原密码，改成新密码并登录 */
  loginWithNewPassword(params: LoginWithNewPasswordParams) {
    return this.run(async (data) => {
      const user = await this.verifyCredentials(data, params)
      await this.setPassword(user, params.password, params.newPassword)
      user.mustChangePassword = false
      // 新密码必须先落盘，写不进去就算失败（内存会从文件重读）
      await this.save(data)
      return this.startSession(data, user)
    })
  }

  logout() {
    return this.run(async () => {
      if (this.sessionUserId === null) return null
      this.sessionUserId = null
      this.loggedInAt = null
      this.deps.onSessionChange?.(null)
      return null
    })
  }

  changePassword(params: ChangePasswordParams) {
    return this.run(async (data) => {
      const user = this.requireSessionUser(data)
      if (!(await verifyPassword(params.oldPassword ?? '', user.passwordHash))) {
        throw new AuthError('INVALID_CREDENTIALS', '原密码不对')
      }
      await this.setPassword(user, params.oldPassword, params.newPassword)
      user.mustChangePassword = false
      await this.save(data)
      return null
    })
  }

  updatePreferences(params: UpdatePreferencesParams) {
    return this.run(async (data) => {
      const user = this.requireSessionUser(data)
      const next: UserPreferences = { ...user.preferences }
      if (params.displayLengthUnit !== undefined) {
        if (!DISPLAY_UNITS.has(params.displayLengthUnit)) {
          throw new AuthError('INVALID_INPUT', '不支持的显示单位')
        }
        next.displayLengthUnit = params.displayLengthUnit
      }
      user.preferences = next
      await this.save(data)
      return this.notifySession(data)
    })
  }

  listUsers() {
    return this.run(async (data) => {
      this.requireAdmin(data)
      return data.users.map(toPublicUser)
    })
  }

  createUser(params: CreateUserParams) {
    return this.run(async (data) => {
      this.requireAdmin(data)
      const username = validateUsername(text(params.username))
      if (data.users.some((user) => usernameKey(user.username) === usernameKey(username))) {
        throw new AuthError('CONFLICT', `用户名「${username}」已存在`)
      }
      const displayName = this.validateDisplayName(data, text(params.displayName))
      this.requireRole(data, params.roleId)
      validatePassword(params.password)
      const user: StoredUser = {
        id: this.newId(),
        username,
        displayName,
        roleId: params.roleId,
        enabled: true,
        mustChangePassword: params.mustChangePassword === true,
        createdAt: this.nowIso(),
        lastLoginAt: null,
        passwordHash: await hashPassword(params.password),
        preferences: { ...DEFAULT_PREFERENCES },
      }
      data.users.push(user)
      await this.save(data)
      return toPublicUser(user)
    })
  }

  updateUser(params: UpdateUserParams) {
    return this.run(async (data) => {
      const actor = this.requireAdmin(data)
      const user = this.requireUser(data, params.id)
      const isSelf = user.id === actor.id
      const next: StoredUser = { ...user }
      if (params.displayName !== undefined) {
        next.displayName = this.validateDisplayName(data, text(params.displayName), user.id)
      }
      if (params.roleId !== undefined && params.roleId !== user.roleId) {
        if (isSelf) throw new AuthError('FORBIDDEN', '不能修改自己的角色')
        this.requireRole(data, params.roleId)
        next.roleId = params.roleId
      }
      if (params.enabled !== undefined && params.enabled !== user.enabled) {
        if (isSelf) throw new AuthError('FORBIDDEN', '不能停用自己')
        next.enabled = params.enabled === true
      }
      this.ensureAdminRemains(data.users.map((item) => (item.id === user.id ? next : item)))
      Object.assign(user, next)
      await this.save(data)
      if (isSelf) this.notifySession(data)
      return toPublicUser(user)
    })
  }

  resetPassword(params: ResetPasswordParams) {
    return this.run(async (data) => {
      const actor = this.requireAdmin(data)
      const user = this.requireUser(data, params.id)
      if (user.id === actor.id) {
        throw new AuthError('FORBIDDEN', '自己的密码请在「系统设置 → 用户」里修改')
      }
      validatePassword(params.password)
      user.passwordHash = await hashPassword(params.password)
      user.mustChangePassword = params.mustChangePassword === true
      await this.save(data)
      return toPublicUser(user)
    })
  }

  deleteUser(params: DeleteUserParams) {
    return this.run(async (data) => {
      const actor = this.requireAdmin(data)
      const user = this.requireUser(data, params.id)
      if (user.id === actor.id) throw new AuthError('FORBIDDEN', '不能删除自己')
      const remaining = data.users.filter((item) => item.id !== user.id)
      this.ensureAdminRemains(remaining)
      data.users = remaining
      await this.save(data)
      return null
    })
  }

  listRoles() {
    return this.run(async (data) => {
      this.requireAdmin(data)
      return data.roles.map(toPublicRole)
    })
  }

  createRole(params: CreateRoleParams) {
    return this.run(async (data) => {
      this.requireAdmin(data)
      const role: StoredRole = {
        id: this.newId(),
        name: this.validateRoleName(data, text(params.name)),
        description: validateDescription(params.description),
        permissions: normalizePermissions(Array.isArray(params.permissions) ? params.permissions : []),
        createdAt: this.nowIso(),
      }
      data.roles.push(role)
      await this.save(data)
      return toPublicRole(role)
    })
  }

  updateRole(params: UpdateRoleParams) {
    return this.run(async (data) => {
      this.requireAdmin(data)
      const role = this.requireRole(data, params.id)
      if (role.id === ADMIN_ROLE_ID) throw new AuthError('FORBIDDEN', '管理员角色不能修改')
      const next: StoredRole = { ...role }
      if (params.name !== undefined) next.name = this.validateRoleName(data, text(params.name), role.id)
      if (params.description !== undefined) next.description = validateDescription(params.description)
      if (params.permissions !== undefined) {
        next.permissions = normalizePermissions(Array.isArray(params.permissions) ? params.permissions : [])
      }
      Object.assign(role, next)
      await this.save(data)
      return toPublicRole(role)
    })
  }

  deleteRole(params: DeleteRoleParams) {
    return this.run(async (data) => {
      this.requireAdmin(data)
      const role = this.requireRole(data, params.id)
      if (role.id === ADMIN_ROLE_ID) throw new AuthError('FORBIDDEN', '管理员角色不能删除')
      const inUse = data.users.filter((user) => user.roleId === role.id).length
      if (inUse > 0) {
        throw new AuthError('CONFLICT', `还有 ${inUse} 个用户是「${role.name}」，请先把他们改到别的角色`)
      }
      data.roles = data.roles.filter((item) => item.id !== role.id)
      await this.save(data)
      return null
    })
  }

  // ── 内部 ──

  private run<T>(task: (data: AuthData) => Promise<T>): Promise<AuthResult<T>> {
    const result = this.queue.then(async (): Promise<AuthResult<T>> => {
      try {
        const data = await this.ensureData()
        return { ok: true, data: await task(data) }
      } catch (err) {
        if (err instanceof AuthError) return { ok: false, code: err.code, message: err.message }
        console.error('[auth]', err)
        // 内存里可能已改、文件没写成：下次从文件重读
        this.data = null
        return {
          ok: false,
          code: 'STORAGE_ERROR',
          message: `用户数据读写失败：${err instanceof Error ? err.message : String(err)}`,
        }
      }
    })
    this.queue = result
    return result
  }

  private async ensureData(): Promise<AuthData> {
    if (this.data) return this.data
    const loaded = this.parse(await this.deps.storage.load())
    if (loaded) {
      this.data = loaded
      return loaded
    }
    const seeded = await this.createInitialData()
    await this.deps.storage.save(seeded)
    this.data = seeded
    return seeded
  }

  /** 读不出用户就当首次使用；缺了管理员角色补回来 */
  private parse(raw: unknown): AuthData | null {
    if (!isRecord(raw)) return null
    const users = (Array.isArray(raw.users) ? raw.users : [])
      .map(parseUser)
      .filter((user): user is StoredUser => user !== null)
    if (users.length === 0) return null
    const roles = (Array.isArray(raw.roles) ? raw.roles : [])
      .map(parseRole)
      .filter((role): role is StoredRole => role !== null)
    if (!roles.some((role) => role.id === ADMIN_ROLE_ID)) {
      const preset = PRESET_ROLES[0]
      roles.unshift({
        id: ADMIN_ROLE_ID,
        name: preset.name,
        description: preset.description,
        permissions: [...ALL_PERMISSION_IDS],
        createdAt: this.nowIso(),
      })
    }
    return { version: 1, roles, users }
  }

  private async createInitialData(): Promise<AuthData> {
    const createdAt = this.nowIso()
    return {
      version: 1,
      roles: PRESET_ROLES.map((role) => ({
        id: role.id,
        name: role.name,
        description: role.description,
        permissions: [...role.permissions],
        createdAt,
      })),
      users: [
        {
          id: this.newId(),
          username: DEFAULT_ADMIN_USERNAME,
          displayName: '管理员',
          roleId: ADMIN_ROLE_ID,
          enabled: true,
          mustChangePassword: true,
          createdAt,
          lastLoginAt: null,
          passwordHash: await hashPassword(DEFAULT_ADMIN_PASSWORD),
          preferences: { ...DEFAULT_PREFERENCES },
        },
      ],
    }
  }

  private async save(data: AuthData): Promise<void> {
    await this.deps.storage.save(data)
  }

  private sessionOf(data: AuthData): AuthSession | null {
    if (this.sessionUserId === null) return null
    const user = data.users.find((item) => item.id === this.sessionUserId)
    if (!user || !user.enabled) {
      this.sessionUserId = null
      this.loggedInAt = null
      return null
    }
    const stored = data.roles.find((role) => role.id === user.roleId)
    const role: AuthRole = stored
      ? toPublicRole(stored)
      : { id: user.roleId, name: '未知角色', description: '', builtin: false, permissions: [], createdAt: '' }
    return {
      user: toPublicUser(user),
      role,
      permissions: [...role.permissions],
      isAdmin: role.builtin,
      loggedInAt: this.loggedInAt ?? this.nowIso(),
    }
  }

  private notifySession(data: AuthData): AuthSession | null {
    const session = this.sessionOf(data)
    this.deps.onSessionChange?.(session)
    return session
  }

  private async startSession(data: AuthData, user: StoredUser): Promise<AuthSession> {
    const now = this.nowIso()
    user.lastLoginAt = now
    // 上次登录时间只是记录：磁盘出问题也不能挡住登录
    try {
      await this.save(data)
    } catch (err) {
      console.error('[auth] 记录登录时间失败', err)
    }
    this.sessionUserId = user.id
    this.loggedInAt = now
    const session = this.notifySession(data)
    if (!session) throw new AuthError('USER_DISABLED', '账号已停用，请联系管理员')
    return session
  }

  private async verifyCredentials(data: AuthData, params: LoginParams): Promise<StoredUser> {
    const key = usernameKey(text(params?.username))
    const user = key ? data.users.find((item) => usernameKey(item.username) === key) : undefined
    if (!user || !(await verifyPassword(text(params?.password), user.passwordHash))) {
      throw new AuthError('INVALID_CREDENTIALS', '用户名或密码错误')
    }
    if (!user.enabled) throw new AuthError('USER_DISABLED', '账号已停用，请联系管理员')
    return user
  }

  private async setPassword(user: StoredUser, oldPassword: string, newPassword: string): Promise<void> {
    validatePassword(newPassword)
    if (newPassword === oldPassword) throw new AuthError('INVALID_INPUT', '新密码不能和原密码相同')
    user.passwordHash = await hashPassword(newPassword)
  }

  private requireSessionUser(data: AuthData): StoredUser {
    const session = this.sessionOf(data)
    const user = session && data.users.find((item) => item.id === session.user.id)
    if (!user) throw new AuthError('NOT_LOGGED_IN', '请先登录')
    return user
  }

  private requireAdmin(data: AuthData): StoredUser {
    const user = this.requireSessionUser(data)
    if (user.roleId !== ADMIN_ROLE_ID) {
      throw new AuthError('FORBIDDEN', '只有管理员可以管理用户与角色')
    }
    return user
  }

  private requireUser(data: AuthData, id: string): StoredUser {
    const user = data.users.find((item) => item.id === id)
    if (!user) throw new AuthError('NOT_FOUND', '用户不存在')
    return user
  }

  private requireRole(data: AuthData, id: string): StoredRole {
    const role = data.roles.find((item) => item.id === id)
    if (!role) throw new AuthError('NOT_FOUND', '角色不存在')
    return role
  }

  private validateDisplayName(data: AuthData, raw: string, selfId?: string): string {
    const value = validateName(raw, '显示名')
    if (data.users.some((user) => user.id !== selfId && user.displayName === value)) {
      throw new AuthError('CONFLICT', `显示名「${value}」已被其他用户使用`)
    }
    return value
  }

  private validateRoleName(data: AuthData, raw: string, selfId?: string): string {
    const value = validateName(raw, '角色名称')
    if (data.roles.some((role) => role.id !== selfId && role.name === value)) {
      throw new AuthError('CONFLICT', `角色「${value}」已存在`)
    }
    return value
  }

  /** 至少留一个启用的管理员 */
  private ensureAdminRemains(users: readonly StoredUser[]): void {
    if (enabledAdminCount(users) === 0) {
      throw new AuthError('CONFLICT', '至少要保留一个启用的管理员')
    }
  }

  private nowIso(): string {
    return (this.deps.now?.() ?? new Date()).toISOString()
  }

  private newId(): string {
    return this.deps.newId?.() ?? randomUUID()
  }
}
