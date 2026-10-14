/**
 * 操作日志与报警记录：C++ 负责写入、存储、查询；界面只读，界面侧事件通过 Log|write 交给 C++ 写。
 * 日志按工程独立：打开工程开始记录，关闭工程结束。接口说明见 docs/cpp-operation-log-api.md
 */

/** 记录类别：操作 / 报警 / 系统（状态变化、内部细节） */
export type LogCategory = 'operation' | 'alarm' | 'system'

/** 日志级别；debug 为用户无感的内部细节，默认隐藏 */
export type LogLevel = 'debug' | 'info' | 'warning' | 'error'

/** 操作分组：配置操作 / 设备操作 / 设备调试 */
export type LogOpGroup = 'config' | 'device' | 'debug'

/** 报警级别：1 一般 2 严重 3 紧急 */
export type AlarmLevel = 1 | 2 | 3

/** 设备类型：主控 / 电机（轴） / 物体（模型），与 Info|plc / Info|axis / Info|model 对应 */
export type LogDeviceType = 'plc' | 'axis' | 'model'

export type LogDeviceRef = {
  deviceType: LogDeviceType
  deviceId: number
}

/** 日志里涉及的设备；一条操作可以涉及多台 */
export type LogDevice = LogDeviceRef & {
  /** 记录当时的设备名，设备删除后仍可显示 */
  deviceName: string
  /** 多设备操作时该设备的执行结果；缺省看整体 result */
  ok?: boolean
}

export type LogTimeRange = { start: number; end: number }

export type LogRecord = {
  /** 全局唯一，字符串 */
  id: string
  /** 毫秒时间戳 */
  timestamp: number
  category: LogCategory
  level: LogLevel
  /** 展示文案（报警时为报警描述），C++ 拼好 */
  message: string
  /** 操作人；操作类必填 */
  user?: string
  devices?: LogDevice[]
  /** 操作类必填 */
  opGroup?: LogOpGroup
  /** 操作类型编码（操作类必填），取值见 Log|filterOptions.opTypes */
  opType?: string
  /** 操作结果（操作类必填） */
  result?: { ok: boolean; message?: string }
  /** 报警类必填 */
  alarmLevel?: AlarmLevel
  alarmCode?: number
  /** raised 报警发生 / cleared 报警清除 */
  alarmState?: 'raised' | 'cleared'
  /** 报警发生时写入的状态快照覆盖的时间段（报警前 10s ~ 后 5s）；无快照则缺省 */
  snapshotRange?: LogTimeRange
}

/** Log|query：多维筛选；数组为空或缺省表示不限 */
export type LogQueryParams = {
  startTime?: number
  endTime?: number
  categories?: LogCategory[]
  users?: string[]
  devices?: LogDeviceRef[]
  opGroups?: LogOpGroup[]
  opTypes?: string[]
  alarmLevels?: AlarmLevel[]
  logLevels?: LogLevel[]
  /** 时间排序，offset/limit 按此顺序取；缺省 asc。desc = 先取最新的 */
  order?: 'asc' | 'desc'
  offset?: number
  limit?: number
}

/** Log|query 返回 data[0] */
export type LogQueryPage = {
  /** 满足条件的总条数（不受 offset/limit 影响） */
  total: number
  /** 按 order 排序 */
  records: LogRecord[]
}

export type LogDeviceOption = LogDeviceRef & { deviceName: string }

export type LogOpTypeOption = { group: LogOpGroup; code: string; label: string }

/** Log|filterOptions 返回 data[0]：当前工程日志里实际出现过的取值 */
export type LogFilterOptions = {
  users: string[]
  devices: LogDeviceOption[]
  opTypes: LogOpTypeOption[]
  /** 最早 / 最晚一条记录的时间；无记录为 null */
  timeRange: LogTimeRange | null
}

/** Log|alarmReview */
export type LogAlarmReviewParams = {
  alarmId: string
}

/** 快照采样点；没有的量缺省 */
export type LogSnapshotPoint = {
  t: number
  position?: number
  speed?: number
  /** 额定转矩的百分比 */
  torque?: number
  /** ℃ */
  temperature?: number
}

/** 直线轴位置 mm、速度 mm/s；旋转轴 ° 和 °/s */
export type LogPositionUnit = 'mm' | '°'

/** 一台设备在快照时间段内的状态曲线 */
export type LogSnapshotSeries = LogDeviceRef & {
  deviceName: string
  /** 缺省 mm */
  unit?: LogPositionUnit
  /** 时间升序 */
  points: LogSnapshotPoint[]
}

/** Log|alarmReview 返回 data[0] */
export type LogAlarmReview = {
  alarm: LogRecord
  /** 快照时间段：报警前 10s ~ 报警后 5s */
  range: LogTimeRange
  /** range 内的操作 / 报警 / 系统记录，时间升序，含 alarm 本身 */
  records: LogRecord[]
  /** 报警写入的状态快照；报警后 5s 尚未写完时可能不完整 */
  snapshot: LogSnapshotSeries[]
}

/** Log|write：界面侧事件（如保存工程）交给 C++ 写入；id、user 由 C++ 填 */
export type LogWriteParams = {
  category: 'operation' | 'system'
  level: LogLevel
  message: string
  opGroup?: LogOpGroup
  opType?: string
  devices?: LogDevice[]
  result?: { ok: boolean; message?: string }
  /** 事件发生时间，缺省为 C++ 收到时间 */
  timestamp?: number
}

/** 控制页日志列表条数 */
export const RECENT_LOG_LIMIT = 30

/** 报警快照：前 10s + 后 5s（C++ 环形缓冲区决定，前端仅在缺 snapshotRange 时兜底） */
export const ALARM_SNAPSHOT_BEFORE_MS = 10_000
export const ALARM_SNAPSHOT_AFTER_MS = 5_000

/** 默认显示的日志级别（不含 debug） */
export const VISIBLE_LOG_LEVELS: LogLevel[] = ['info', 'warning', 'error']

export const deviceKey = (ref: LogDeviceRef): string => `${ref.deviceType}:${ref.deviceId}`

/** 合并推送的记录：去重、去 debug、按时间升序、只保留最新 limit 条 */
export const mergeRecentLogs = (
  current: readonly LogRecord[],
  incoming: readonly LogRecord[],
  limit: number = RECENT_LOG_LIMIT,
): LogRecord[] => {
  const byId = new Map<string, LogRecord>()
  for (const record of current) byId.set(record.id, record)
  for (const record of incoming) {
    if (record.level === 'debug') continue
    byId.set(record.id, record)
  }
  return [...byId.values()]
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-limit)
}
