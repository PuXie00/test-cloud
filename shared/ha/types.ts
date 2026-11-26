/**
 * 主备热备：主进程 ↔ 界面的契约。方案见 docs/cpp-hot-standby-api.md。
 * 机间链路由 C++ 搭（HA|start / HA|stop / HA|send，推送 HA|info / HA|haRecv），C++ 只原样转发；
 * 机器按 IP 区分。热备设置跟着电脑走，存在本机用户数据目录。
 */

export type HaRole = 'primary' | 'standby'

/** 可选同步的部分；配置（搭建）固定同步，不在这里 */
export type HaOptionalPart = 'motion' | 'rules' | 'meta' | 'models'

export type HaSyncScope = Record<HaOptionalPart, boolean>

export const DEFAULT_HA_SYNC_SCOPE: HaSyncScope = {
  motion: true,
  rules: true,
  meta: true,
  models: true,
}

export const HA_OPTIONAL_PART_LABELS: Record<HaOptionalPart, string> = {
  motion: '动作',
  rules: '规则',
  meta: '工程信息',
  models: '模型',
}

export type HaSettings = {
  role: HaRole
  /** 本机名称，提示里用（如「物体 6 正在由 控台-A 操作」） */
  hostName: string
  /** 本机 IP：主机在这个 IP 上监听，备机用它去连主机 */
  localIp: string
  /** 备机要连的主机 IP */
  primaryIp: string
  /** 主机勾选的同步范围；备机跟随主机 */
  syncScope: HaSyncScope
}

export type HaLinkState = 'up' | 'connecting' | 'down'

/** 两边打开的是不是同一个工程按 id 判断（meta.id），文件夹名可以不同 */
export type HaProjectInfo = {
  id: string
  name: string
  /** 工程格式版本（schema） */
  formatVersion: number
}

export type HaPeerView = {
  ip: string
  link: HaLinkState
  /** 对方 hello 里报的；还没收到 hello 时为 null */
  hostName: string | null
  role: HaRole | null
  project: HaProjectInfo | null
  /** 两边软件的热备消息版本不一致：只连着，不同步 */
  versionMismatch: boolean
  /** 对方主动关闭了热备（主机关闭时先发 hello 告知） */
  closedByPeer: boolean
}

export type HaState = {
  enabled: boolean
  role: HaRole
  hostName: string
  localIp: string
  primaryIp: string
  /** 主机勾选的同步范围（备机上是本机设置里的，实际跟随主机发来的） */
  syncScope: HaSyncScope
  localProject: HaProjectInfo | null
  peers: HaPeerView[]
  /**
   * 本机除停止、急停以外的设备操作被拦下的原因；null 表示不拦。
   * 只有备机会拦：链路断开、不是同一个工程、还没核对完成时只能停止、总停止。
   */
  deviceGate: string | null
  /** 开启、关闭失败等，给界面显示 */
  error: string | null
}

export type HaLocalIp = {
  address: string
  /** 网卡名 */
  iface: string
}

export type HaResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string }

export const HA_CHANNELS = {
  getSettings: 'ha:get-settings',
  saveSettings: 'ha:save-settings',
  listLocalIps: 'ha:list-local-ips',
  getState: 'ha:get-state',
  start: 'ha:start',
  stop: 'ha:stop',
  /** 主进程 → 界面：热备状态有变化 */
  state: 'ha:state',
  /** 界面 → 另一台：工程同步的消息（主进程经 C++ 转发） */
  post: 'ha:post',
  /** 主进程 → 界面：另一台发来的工程同步消息 */
  message: 'ha:message',
  /** 界面 → 主进程：备机和主机核对完成的工程 id（null 表示没核对完） */
  setSynced: 'ha:set-synced',
  /** 界面 → 主进程：备机把同步范围内的内容写进 project.json（方案 5.7） */
  writeSynced: 'ha:write-synced',
  /** 界面 → 主进程：被覆盖前存一个版本备份（方案 4.3） */
  backup: 'ha:backup',
  /** 界面 → 主进程：另一台在用的设备（主进程据此拦指令，方案 6.4） */
  setPeerBusy: 'ha:set-peer-busy',
  /** 界面 → 主进程：备机核对完成后两边补齐模型文件（prefer 是同名不同内容时用哪边的） */
  syncModels: 'ha:sync-models',
  /** 主进程 → 界面：收到另一台的模型文件、删了模型，重新载入模型 */
  modelsChanged: 'ha:models-changed',
  /** 主进程 → 界面：指令被热备规则拦下及原因 */
  blocked: 'ha:blocked',
  /** 备机的同步记录：最近一次两边一致时的摘要，和当时有没有未保存的修改 */
  getSyncRecord: 'ha:get-sync-record',
  setSyncRecord: 'ha:set-sync-record',
} as const

/** 备机的同步记录（按工程 id 存在本机） */
export type HaSyncRecord = {
  digest: string
  dirty: boolean
  at: string
}

/** 对方能不能同步：链路通着、版本一致、没关热备、打开的是同一个工程且格式版本一致 */
export const isHaPeerReady = (peer: HaPeerView, local: HaProjectInfo | null): boolean =>
  peer.link === 'up' &&
  !peer.versionMismatch &&
  !peer.closedByPeer &&
  local !== null &&
  peer.project !== null &&
  peer.project.id === local.id &&
  peer.project.formatVersion === local.formatVersion

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/

export const isIpv4 = (value: string): boolean => IPV4.test(value.trim())

export const HA_HOST_NAME_MAX = 32

/** 开启热备前检查设置；返回第一条问题，没问题返回 null */
export const validateHaSettings = (settings: HaSettings): string | null => {
  const hostName = settings.hostName.trim()
  if (!hostName) return '请填写本机名称'
  if (hostName.length > HA_HOST_NAME_MAX) return `本机名称不能超过 ${HA_HOST_NAME_MAX} 个字`
  if (!isIpv4(settings.localIp)) return '请选择本机 IP'
  if (settings.role === 'standby') {
    if (!isIpv4(settings.primaryIp)) return '请填写正确的主机 IP'
    if (settings.primaryIp.trim() === settings.localIp.trim()) return '主机 IP 不能是本机 IP'
  }
  return null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** 读盘、收 IPC 时用：缺的、坏的字段换成默认值 */
export const normalizeHaSettings = (raw: unknown, defaultHostName: string): HaSettings => {
  const r = isRecord(raw) ? raw : {}
  const scope = isRecord(r.syncScope) ? r.syncScope : {}
  const flag = (key: keyof HaSyncScope): boolean =>
    typeof scope[key] === 'boolean' ? (scope[key] as boolean) : DEFAULT_HA_SYNC_SCOPE[key]
  const text = (value: unknown, fallback: string): string =>
    typeof value === 'string' ? value.trim() : fallback
  return {
    role: r.role === 'standby' ? 'standby' : 'primary',
    hostName: text(r.hostName, defaultHostName).slice(0, HA_HOST_NAME_MAX) || defaultHostName,
    localIp: text(r.localIp, ''),
    primaryIp: text(r.primaryIp, ''),
    syncScope: {
      motion: flag('motion'),
      rules: flag('rules'),
      meta: flag('meta'),
      models: flag('models'),
    },
  }
}
