/** 软件授权（Auth|localStatus / activate / verify）：离线期限（7 天）、到期都由 C++ 判断，这里只转述 */

/** C++ 回复 data[0].status */
export const LICENSE_STATUS_CODES = {
  0: 'inactive',
  1: 'needVerify',
  2: 'expired',
  3: 'valid',
} as const

export type LicenseStatus =
  /** 未激活：要输入授权码激活 */
  | 'inactive'
  /** 激活过，但离线超过 7 天：要联网校验 */
  | 'needVerify'
  /** 超过有效期：要重新激活 */
  | 'expired'
  /** 正常 */
  | 'valid'
  /** C++ 回了不认识的 status */
  | 'unknown'

/** C++ 统一回复：状态、过期时间、宽限日期、激活时间、信息（时间原样转述） */
export type LicenseInfo = {
  status: LicenseStatus
  statusCode: number
  activatedAt: string
  expireAt: string
  /** 离线可用到这天，过了要联网校验 */
  graceUntil: string
  message: string
}

export type LicenseState = {
  /** 本次运行已放行（授权正常，或开发模式跳过）；放行后运行中不再拦，下次启动再查 */
  passed: boolean
  /** 开发模式跳过放行的 */
  skipped: boolean
  /** 未打包时允许跳过 */
  devSkipAllowed: boolean
  /** C++ 最近一次回复的授权信息；还没问到为 null */
  info: LicenseInfo | null
}

/** Auth|activate 的 params 项 */
export type LicenseActivateItem = { code: string }

export const LICENSE_TIMEOUTS = {
  /** 启动时 C++ 进程起来后才连上 WebSocket，先等连接 */
  connectWaitMs: 20_000,
  /** 本地状态不联网 */
  localStatusMs: 10_000,
  /** 激活 / 校验要连授权服务器 */
  onlineMs: 30_000,
}

/** 没拿到 C++ 回复时的 code（连不上 / 超时 / 没发出去）；C++ 自己回的 code 是数字 */
export const LICENSE_NO_REPLY_CODES = ['NOT_CONNECTED', 'ACK_TIMEOUT', 'SEND_FAILED'] as const

/** 授权指令的回复：data[0] 总是最新授权状态 */
export type LicenseAck = {
  success: boolean
  code?: string | number
  message?: string
  data?: LicenseState[]
}

export const isLicenseNoReply = (result: LicenseAck): boolean =>
  !result.success && (LICENSE_NO_REPLY_CODES as readonly unknown[]).includes(result.code)

export const licenseStateOf = (result: LicenseAck | undefined): LicenseState | null =>
  result?.data?.[0] ?? null

const text = (value: unknown): string =>
  value === undefined || value === null ? '' : String(value).trim()

/** C++ 回复的 result → 授权信息；data 里没有 status 时返回 null */
export const toLicenseInfo = (result: unknown): LicenseInfo | null => {
  if (!result || typeof result !== 'object') return null
  const r = result as { message?: unknown; data?: unknown }
  const raw = Array.isArray(r.data) ? r.data[0] : undefined
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  if (item.status === undefined || item.status === null || item.status === '') return null
  const statusCode = Number(item.status)
  if (!Number.isFinite(statusCode)) return null
  return {
    status: LICENSE_STATUS_CODES[statusCode as keyof typeof LICENSE_STATUS_CODES] ?? 'unknown',
    statusCode,
    activatedAt: text(item.activated_at),
    expireAt: text(item.expire_at),
    graceUntil: text(item.grace_until),
    message: text(item.message) || text(r.message),
  }
}

/**
 * 本次运行的授权状态（主进程保管，渲染进程刷新后不用重新过授权）。
 * 放行只进不退：长时间运行中不因为授权变化把界面拦掉，下次启动再查。
 */
export class LicenseStore {
  private info: LicenseInfo | null = null
  private passed = false
  private skipped = false

  constructor(private readonly devSkipAllowed: boolean) {}

  snapshot(): LicenseState {
    return {
      passed: this.passed,
      skipped: this.skipped,
      devSkipAllowed: this.devSkipAllowed,
      info: this.info,
    }
  }

  /** Auth|* 的回复（含超时后迟到的）；有变化返回新快照，否则 null */
  ingest(result: unknown): LicenseState | null {
    const info = toLicenseInfo(result)
    if (!info) return null
    const before = JSON.stringify(this.snapshot())
    this.info = info
    if (info.status === 'valid') this.passed = true
    const next = this.snapshot()
    return JSON.stringify(next) === before ? null : next
  }

  /** 开发模式跳过；正式版返回 false */
  skip(): boolean {
    if (!this.devSkipAllowed) return false
    this.passed = true
    this.skipped = true
    return true
  }
}
