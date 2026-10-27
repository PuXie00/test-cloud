/**
 * 权限点注册表：板块、权限点和预设角色只在这里定义，主进程（校验、建预设角色）
 * 和界面（角色勾选、按权限显示）都从这里读。
 * 设计见 docs/superpowers/specs/2026-10-26-user-permissions-design.md
 */

export type PermissionId =
  | 'control.run'
  | 'control.manual'
  | 'control.device'
  | 'control.couple'
  | 'program.edit'
  | 'action.view'
  | 'action.edit'
  | 'build.view'
  | 'build.edit'
  | 'build.rules'
  | 'build.debug'
  | 'build.calibrate'
  | 'build.plc'
  | 'project.save'
  | 'project.files'
  | 'project.delete'
  | 'log.view'
  | 'system.settings'
  | 'collab.manage'

export type PermissionPoint = {
  id: PermissionId
  label: string
  /** 角色编辑里显示：这个开关管哪些按钮 */
  description: string
  /** 同板块的「进入」权限：勾上本项会自动勾上它，取消它会一起取消本项 */
  requires?: PermissionId
}

export type PermissionGroup = {
  id: string
  label: string
  points: readonly PermissionPoint[]
}

export const PERMISSION_GROUPS: readonly PermissionGroup[] = [
  {
    id: 'control',
    label: '控制（演出运行）',
    points: [
      {
        id: 'control.run',
        label: '运行动作',
        description: '任务卡和推子的 Ready / GO / 继续 / 重新 / 下一条 / 关闭、调速、运行选项，加载章节和翻页',
      },
      {
        id: 'control.manual',
        label: '手动运动',
        description: '点动、维度控制设目标和 GO、回原、走平（控制页和动作页）',
      },
      {
        id: 'control.device',
        label: '设备状态',
        description: '使能 / 断能、复位、清除报警',
      },
      {
        id: 'control.couple',
        label: '耦合 / 解耦',
        description: '手动控制里的耦合 / 解耦',
      },
    ],
  },
  {
    id: 'program',
    label: '节目',
    points: [
      {
        id: 'program.edit',
        label: '节目编排',
        description: '新建、改名、删除章节，序列加入章节、排序、移除，节目设置',
      },
    ],
  },
  {
    id: 'action',
    label: '动作',
    points: [
      {
        id: 'action.view',
        label: '进入动作页',
        description: '浏览序列库和时间轴，播放预览；没有编辑权限时页面只读',
      },
      {
        id: 'action.edit',
        label: '编辑动作序列',
        description: '新建、复制、改名、删除序列，编辑时间轴，保存，取当前写入位姿，本机 AI 写入序列',
        requires: 'action.view',
      },
    ],
  },
  {
    id: 'build',
    label: '搭建',
    points: [
      {
        id: 'build.view',
        label: '进入搭建页',
        description: '浏览工程结构、属性和规则；没有编辑权限时页面只读',
      },
      {
        id: 'build.edit',
        label: '编辑工程配置',
        description: '增删改主控、电机、受控物体、模型和挂载，3D 摆放，距离对齐，配置向导',
        requires: 'build.view',
      },
      {
        id: 'build.rules',
        label: '编辑安全规则',
        description: '新建、编辑、启用 / 停用、删除规则',
        requires: 'build.view',
      },
      {
        id: 'build.debug',
        label: '电机调试',
        description: '调试标签：点动、位置移动、使能、报警复位、通讯测试、调试参数',
        requires: 'build.view',
      },
      {
        id: 'build.calibrate',
        label: '零点与标定',
        description: '调试里的位置归零、设定位移，配置向导的标定运动范围',
        requires: 'build.view',
      },
      {
        id: 'build.plc',
        label: '主控操作',
        description: '下载工程到主控、PLC 复位、仿真开关',
      },
    ],
  },
  {
    id: 'project',
    label: '工程文件',
    points: [
      { id: 'project.save', label: '保存工程', description: '菜单里的保存工程' },
      {
        id: 'project.files',
        label: '工程文件管理',
        description: '新建、导入、导出、另存为、恢复历史版本',
      },
      { id: 'project.delete', label: '删除工程', description: '工程中心里删除工程' },
    ],
  },
  {
    id: 'system',
    label: '日志与系统',
    points: [
      { id: 'log.view', label: '操作日志与回放', description: '菜单里的操作日志与回放' },
      {
        id: 'system.settings',
        label: '系统设置',
        description: '界面设置、控台校准、网络配置、通知与声音',
      },
      { id: 'collab.manage', label: '多机协作管理', description: '菜单里的多机协作管理' },
    ],
  },
]

export const PERMISSION_POINTS: readonly PermissionPoint[] = PERMISSION_GROUPS.flatMap(
  (group) => group.points,
)

export const ALL_PERMISSION_IDS: readonly PermissionId[] = PERMISSION_POINTS.map((point) => point.id)

const POINT_BY_ID = new Map<string, PermissionPoint>(PERMISSION_POINTS.map((point) => [point.id, point]))

export const isPermissionId = (value: unknown): value is PermissionId =>
  typeof value === 'string' && POINT_BY_ID.has(value)

export const getPermissionPoint = (id: PermissionId): PermissionPoint | undefined =>
  POINT_BY_ID.get(id)

/** 去掉未知项、补上依赖的「进入」权限，按注册表顺序排好 */
export const normalizePermissions = (ids: readonly unknown[]): PermissionId[] => {
  const set = new Set<PermissionId>()
  for (const id of ids) {
    if (!isPermissionId(id)) continue
    set.add(id)
    const requires = POINT_BY_ID.get(id)?.requires
    if (requires) set.add(requires)
  }
  return ALL_PERMISSION_IDS.filter((id) => set.has(id))
}

/** 角色编辑里勾选 / 取消一项：勾上带上依赖，取消时把依赖它的一起取消 */
export const togglePermission = (
  current: readonly PermissionId[],
  id: PermissionId,
  checked: boolean,
): PermissionId[] => {
  if (checked) return normalizePermissions([...current, id])
  return normalizePermissions(
    current.filter((item) => item !== id && POINT_BY_ID.get(item)?.requires !== id),
  )
}

/** 内置管理员角色：全部权限，外加用户与权限管理；不能改、不能删 */
export const ADMIN_ROLE_ID = 'admin'

export type PresetRole = {
  id: string
  name: string
  description: string
  permissions: readonly PermissionId[]
}

/** 首次使用时建好的角色；技术员和操作员只是初始值，之后管理员可以改、可以删 */
export const PRESET_ROLES: readonly PresetRole[] = [
  {
    id: ADMIN_ROLE_ID,
    name: '管理员',
    description: '全部权限，管理用户与角色',
    permissions: ALL_PERMISSION_IDS,
  },
  {
    id: 'tech',
    name: '技术员',
    description: '工程配置、调试、动作编辑和演出运行，不能删除工程、管理用户',
    permissions: ALL_PERMISSION_IDS.filter((id) => id !== 'project.delete'),
  },
  {
    id: 'operator',
    name: '操作员',
    description: '运行演出和手动操作，不能修改配置',
    permissions: ['control.run', 'control.manual', 'control.device', 'log.view'],
  },
]
