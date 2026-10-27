import { describe, expect, it, vi } from 'vitest'
import { AuthService } from '../electron/main/auth/service'
import type { AuthStorage } from '../electron/main/auth/storage'
import { ALL_PERMISSION_IDS } from '../shared/auth/permissions'
import { DEFAULT_ADMIN_PASSWORD, type AuthResult } from '../shared/auth/types'

const memoryStorage = (initial: unknown = null) => {
  const store = { data: initial === null ? null : structuredClone(initial), failSave: false }
  const storage: AuthStorage = {
    load: async () => (store.data === null ? null : structuredClone(store.data)),
    save: async (data) => {
      if (store.failSave) throw new Error('disk full')
      store.data = structuredClone(data)
    },
  }
  return { store, storage }
}

const unwrap = <T>(result: AuthResult<T>): T => {
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`)
  return result.data
}

let idSeq = 0
const createService = (storage: AuthStorage, onSessionChange = vi.fn()) =>
  new AuthService({ storage, onSessionChange, newId: () => `id-${++idSeq}` })

/** 首次使用：用默认密码登录并改成 newpass */
const loginAsFirstAdmin = async (service: AuthService) =>
  unwrap(
    await service.loginWithNewPassword({
      username: 'admin',
      password: DEFAULT_ADMIN_PASSWORD,
      newPassword: 'newpass',
    }),
  )

const createOperator = async (service: AuthService) =>
  unwrap(
    await service.createUser({
      username: 'op',
      displayName: '王操',
      roleId: 'operator',
      password: '1234',
      mustChangePassword: false,
    }),
  )

describe('AuthService 首次使用', () => {
  it('建好 admin 账号和三个预设角色，文件里没有明文密码', async () => {
    const { store, storage } = memoryStorage()
    const service = createService(storage)
    expect(unwrap(await service.current())).toBeNull()
    const saved = store.data as {
      users: { username: string; mustChangePassword: boolean }[]
      roles: { name: string }[]
    }
    expect(saved.users.map((user) => user.username)).toEqual(['admin'])
    expect(saved.users[0].mustChangePassword).toBe(true)
    expect(saved.roles.map((role) => role.name)).toEqual(['管理员', '技术员', '操作员'])
    expect(JSON.stringify(saved)).not.toContain(DEFAULT_ADMIN_PASSWORD)
  })

  it('默认密码登录要先改密码，新密码不能和原密码相同', async () => {
    const { storage } = memoryStorage()
    const service = createService(storage)
    expect(await service.login({ username: 'admin', password: DEFAULT_ADMIN_PASSWORD })).toMatchObject({
      ok: false,
      code: 'MUST_CHANGE_PASSWORD',
    })
    expect(
      await service.loginWithNewPassword({
        username: 'admin',
        password: DEFAULT_ADMIN_PASSWORD,
        newPassword: DEFAULT_ADMIN_PASSWORD,
      }),
    ).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    expect(
      await service.loginWithNewPassword({
        username: 'admin',
        password: DEFAULT_ADMIN_PASSWORD,
        newPassword: 'abc',
      }),
    ).toMatchObject({ ok: false, code: 'INVALID_INPUT', message: '密码至少 4 位' })

    const session = await loginAsFirstAdmin(service)
    expect(session.isAdmin).toBe(true)
    expect(session.permissions).toEqual([...ALL_PERMISSION_IDS])
    expect(session.user.mustChangePassword).toBe(false)

    unwrap(await service.logout())
    expect(unwrap(await service.login({ username: 'ADMIN', password: 'newpass' })).user.username).toBe('admin')
  })

  it('文件里一个能用的用户都没有时按首次使用处理', async () => {
    const { store, storage } = memoryStorage({ version: 1, roles: [], users: [{ id: 'x' }] })
    const service = createService(storage)
    unwrap(await service.current())
    expect((store.data as { users: { username: string }[] }).users[0].username).toBe('admin')
  })
})

describe('AuthService 登录', () => {
  it('用户名或密码错误、停用账号', async () => {
    const { storage } = memoryStorage()
    const service = createService(storage)
    await loginAsFirstAdmin(service)
    const op = await createOperator(service)
    expect(await service.login({ username: 'op', password: 'wrong' })).toMatchObject({
      ok: false,
      code: 'INVALID_CREDENTIALS',
    })
    expect(await service.login({ username: 'nobody', password: '1234' })).toMatchObject({
      ok: false,
      code: 'INVALID_CREDENTIALS',
    })
    unwrap(await service.updateUser({ id: op.id, enabled: false }))
    expect(await service.login({ username: 'op', password: '1234' })).toMatchObject({
      ok: false,
      code: 'USER_DISABLED',
    })
  })

  it('登录、切换、退出时通知会话变化（显示名给 C++ 当操作人）', async () => {
    const { storage } = memoryStorage()
    const onSessionChange = vi.fn()
    const service = createService(storage, onSessionChange)
    await loginAsFirstAdmin(service)
    expect(onSessionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ user: expect.objectContaining({ displayName: '管理员' }) }),
    )
    unwrap(
      await service.createUser({
        username: 'zhang',
        displayName: '张工',
        roleId: 'tech',
        password: '1234',
        mustChangePassword: false,
      }),
    )
    // 切换用户：直接登录另一个人，会话被替换
    const session = unwrap(await service.login({ username: 'zhang', password: '1234' }))
    expect(session.isAdmin).toBe(false)
    expect(session.permissions).not.toContain('project.delete')
    expect(onSessionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ user: expect.objectContaining({ displayName: '张工' }) }),
    )
    unwrap(await service.logout())
    expect(onSessionChange).toHaveBeenLastCalledWith(null)
    expect(unwrap(await service.current())).toBeNull()
  })

  it('换实例（软件重启）后用户还在，会话不保留', async () => {
    const { storage } = memoryStorage()
    await loginAsFirstAdmin(createService(storage))
    const restarted = createService(storage)
    expect(unwrap(await restarted.current())).toBeNull()
    expect(unwrap(await restarted.login({ username: 'admin', password: 'newpass' })).isAdmin).toBe(true)
  })

  it('记录登录时间写盘失败不挡登录；改密码写盘失败就算失败', async () => {
    const { store, storage } = memoryStorage()
    const service = createService(storage)
    await loginAsFirstAdmin(service)
    await createOperator(service)
    unwrap(await service.logout())

    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    store.failSave = true
    expect(unwrap(await service.login({ username: 'admin', password: 'newpass' })).isAdmin).toBe(true)
    expect(await service.changePassword({ oldPassword: 'newpass', newPassword: 'abcd' })).toMatchObject({
      ok: false,
      code: 'STORAGE_ERROR',
    })
    store.failSave = false
    // 没写进去的新密码不生效，原密码照旧能用
    unwrap(await service.logout())
    unwrap(await service.login({ username: 'admin', password: 'newpass' }))
    error.mockRestore()
  })
})

describe('AuthService 用户管理', () => {
  it('只有管理员能管理用户与角色', async () => {
    const { storage } = memoryStorage()
    const service = createService(storage)
    expect(await service.listUsers()).toMatchObject({ ok: false, code: 'NOT_LOGGED_IN' })
    await loginAsFirstAdmin(service)
    await createOperator(service)
    unwrap(await service.login({ username: 'op', password: '1234' }))
    expect(await service.listUsers()).toMatchObject({ ok: false, code: 'FORBIDDEN' })
    expect(await service.listRoles()).toMatchObject({ ok: false, code: 'FORBIDDEN' })
  })

  it('用户名不区分大小写唯一，显示名唯一', async () => {
    const { storage } = memoryStorage()
    const service = createService(storage)
    await loginAsFirstAdmin(service)
    const base = { roleId: 'tech', password: '1234', mustChangePassword: false }
    unwrap(await service.createUser({ ...base, username: 'Zhang', displayName: '张工' }))
    expect(await service.createUser({ ...base, username: 'zhang', displayName: '张工2' })).toMatchObject({
      ok: false,
      code: 'CONFLICT',
    })
    expect(await service.createUser({ ...base, username: 'li', displayName: '张工' })).toMatchObject({
      ok: false,
      code: 'CONFLICT',
    })
    expect(await service.createUser({ ...base, username: 'a b', displayName: '空格' })).toMatchObject({
      ok: false,
      code: 'INVALID_INPUT',
    })
    expect(await service.createUser({ ...base, username: 'li', displayName: '李', roleId: 'none' })).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    })
  })

  it('不能改自己的角色、停用或删除自己、给自己重置密码', async () => {
    const { storage } = memoryStorage()
    const service = createService(storage)
    const self = (await loginAsFirstAdmin(service)).user.id
    expect(await service.updateUser({ id: self, roleId: 'tech' })).toMatchObject({ ok: false, code: 'FORBIDDEN' })
    expect(await service.updateUser({ id: self, enabled: false })).toMatchObject({ ok: false, code: 'FORBIDDEN' })
    expect(await service.deleteUser({ id: self })).toMatchObject({ ok: false, code: 'FORBIDDEN' })
    expect(
      await service.resetPassword({ id: self, password: '5678', mustChangePassword: true }),
    ).toMatchObject({ ok: false, code: 'FORBIDDEN' })
    // 改自己的显示名可以，会话随之更新
    unwrap(await service.updateUser({ id: self, displayName: '李总' }))
    expect(unwrap(await service.current())?.user.displayName).toBe('李总')
  })

  it('重置密码并勾选「下次登录修改」后，对方要先改密码', async () => {
    const { storage } = memoryStorage()
    const service = createService(storage)
    await loginAsFirstAdmin(service)
    const op = await createOperator(service)
    unwrap(await service.resetPassword({ id: op.id, password: '5678', mustChangePassword: true }))
    expect(await service.login({ username: 'op', password: '5678' })).toMatchObject({
      ok: false,
      code: 'MUST_CHANGE_PASSWORD',
    })
    const session = unwrap(
      await service.loginWithNewPassword({ username: 'op', password: '5678', newPassword: 'abcd' }),
    )
    expect(session.user.displayName).toBe('王操')
  })

  it('改自己的密码要输对原密码', async () => {
    const { storage } = memoryStorage()
    const service = createService(storage)
    await loginAsFirstAdmin(service)
    expect(await service.changePassword({ oldPassword: 'bad', newPassword: 'abcd' })).toMatchObject({
      ok: false,
      code: 'INVALID_CREDENTIALS',
    })
    unwrap(await service.changePassword({ oldPassword: 'newpass', newPassword: 'abcd' }))
    unwrap(await service.logout())
    unwrap(await service.login({ username: 'admin', password: 'abcd' }))
  })

  it('偏好设置跟着用户走', async () => {
    const { storage } = memoryStorage()
    const service = createService(storage)
    await loginAsFirstAdmin(service)
    expect(unwrap(await service.current())?.user.preferences.displayLengthUnit).toBe('mm')
    const session = unwrap(await service.updatePreferences({ displayLengthUnit: 'm' }))
    expect(session?.user.preferences.displayLengthUnit).toBe('m')
    expect(await service.updatePreferences({ displayLengthUnit: 'km' as never })).toMatchObject({
      ok: false,
      code: 'INVALID_INPUT',
    })
    unwrap(await service.logout())
    const again = unwrap(await service.login({ username: 'admin', password: 'newpass' }))
    expect(again.user.preferences.displayLengthUnit).toBe('m')
  })
})

describe('AuthService 角色管理', () => {
  it('新建角色时补上「进入」权限，改名不能重名', async () => {
    const { storage } = memoryStorage()
    const service = createService(storage)
    await loginAsFirstAdmin(service)
    const role = unwrap(
      await service.createRole({ name: '编排员', permissions: ['action.edit', 'program.edit'] }),
    )
    expect(role.permissions).toEqual(['program.edit', 'action.view', 'action.edit'])
    expect(await service.updateRole({ id: role.id, name: '技术员' })).toMatchObject({
      ok: false,
      code: 'CONFLICT',
    })
    const updated = unwrap(await service.updateRole({ id: role.id, permissions: ['build.debug'] }))
    expect(updated.permissions).toEqual(['build.view', 'build.debug'])
  })

  it('管理员角色不能改、不能删；有人在用的角色不能删', async () => {
    const { storage } = memoryStorage()
    const service = createService(storage)
    await loginAsFirstAdmin(service)
    expect(await service.updateRole({ id: 'admin', permissions: [] })).toMatchObject({
      ok: false,
      code: 'FORBIDDEN',
    })
    expect(await service.deleteRole({ id: 'admin' })).toMatchObject({ ok: false, code: 'FORBIDDEN' })
    await createOperator(service)
    expect(await service.deleteRole({ id: 'operator' })).toMatchObject({ ok: false, code: 'CONFLICT' })
    unwrap(await service.deleteRole({ id: 'tech' }))
    expect(unwrap(await service.listRoles()).map((role) => role.id)).toEqual(['admin', 'operator'])
  })

  it('改了角色权限，该角色的用户登录就生效', async () => {
    const { storage } = memoryStorage()
    const service = createService(storage)
    await loginAsFirstAdmin(service)
    await createOperator(service)
    unwrap(await service.updateRole({ id: 'operator', permissions: ['log.view'] }))
    const session = unwrap(await service.login({ username: 'op', password: '1234' }))
    expect(session.permissions).toEqual(['log.view'])
  })
})
