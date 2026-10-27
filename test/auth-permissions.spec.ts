import { describe, expect, it } from 'vitest'
import {
  ALL_PERMISSION_IDS,
  PERMISSION_GROUPS,
  PRESET_ROLES,
  normalizePermissions,
  togglePermission,
} from '../shared/auth/permissions'

describe('权限注册表', () => {
  it('6 个板块、19 个权限点，标识不重复', () => {
    expect(PERMISSION_GROUPS).toHaveLength(6)
    expect(ALL_PERMISSION_IDS).toHaveLength(19)
    expect(new Set(ALL_PERMISSION_IDS).size).toBe(19)
  })

  it('依赖的「进入」权限在同一板块里', () => {
    for (const group of PERMISSION_GROUPS) {
      const ids = new Set(group.points.map((point) => point.id))
      for (const point of group.points) {
        if (point.requires) expect(ids.has(point.requires)).toBe(true)
      }
    }
  })

  it('预设角色：操作员只有运行、手动、设备状态和日志', () => {
    const operator = PRESET_ROLES.find((role) => role.id === 'operator')
    expect(operator?.permissions).toEqual(['control.run', 'control.manual', 'control.device', 'log.view'])
    const tech = PRESET_ROLES.find((role) => role.id === 'tech')
    expect(tech?.permissions).not.toContain('project.delete')
    expect(tech?.permissions).toHaveLength(18)
  })
})

describe('normalizePermissions / togglePermission', () => {
  it('去掉未知项和重复项，补上依赖，按注册表顺序', () => {
    expect(normalizePermissions(['build.edit', 'nope', 'control.run', 'build.edit', 3])).toEqual([
      'control.run',
      'build.view',
      'build.edit',
    ])
  })

  it('勾编辑类自动勾「进入」，取消「进入」一起取消编辑类', () => {
    const checked = togglePermission([], 'build.calibrate', true)
    expect(checked).toEqual(['build.view', 'build.calibrate'])
    const more = togglePermission(checked, 'build.plc', true)
    expect(togglePermission(more, 'build.view', false)).toEqual(['build.plc'])
    expect(togglePermission(more, 'build.calibrate', false)).toEqual(['build.view', 'build.plc'])
  })
})
