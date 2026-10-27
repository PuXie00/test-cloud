/**
 * 操作日志与报警记录：C++ 写入当前工程目录下的 SQLite（logs.db），界面直接读库查询；
 * 界面侧事件通过 Log|write 交给 C++ 写。日志按工程独立。表结构见 docs/cpp-operation-log-api.md
 */

/**
 * 记录类别：optCall 前端下发的指令（只存库，不查不显示）/ optRet 操作回码（PLC 回码后写，界面上的「操作」）/
 * alarm 报警 / system 系统
 */
export type LogCategory = 'optCall' | 'optRet' | 'alarm' | 'system'

/** 界面查询和显示的类别 */
export type VisibleLogCategory = Exclude<LogCategory, 'optCall'>

export const VISIBLE_LOG_CATEGORIES: VisibleLogCategory[] = ['optRet', 'alarm', 'system']

/** 日志级别；debug 为用户无感的内部细节，默认隐藏 */
export type LogLevel = 'debug' | 'info' | 'warning' | 'error'

/** 操作分组：配置操作 / 设备操作 */
export type LogOpGroup = 'config' | 'device'

/** 操作结果：0 失败 1 成功 2 超时 */
export type LogResult = 0 | 1 | 2

export const LOG_RESULT = { failed: 0, ok: 1, timeout: 2 } as const

export type LogTimeRange = { start: number; end: number }

export type LogRecord = {
  /** 库里的自增 id，转成字符串 */
  id: string
  /** 毫秒时间戳 */
  timestamp: number
  category: LogCategory
  level: LogLevel
  /** 展示文案（报警时为报警描述），C++ 拼好 */
  message: string
  /** 操作人（操作回码填） */
  user?: string
  /** 操作分组（操作回码填） */
  opGroup?: LogOpGroup
  /** 操作结果（操作回码填） */
  result?: LogResult
}

/** 日志查询：多维筛选；数组为空或缺省表示不限 */
export type LogQueryParams = {
  startTime?: number
  endTime?: number
  /** 缺省为全部可见类别；optCall 永远不查 */
  categories?: VisibleLogCategory[]
  /** 只约束操作回码 */
  users?: string[]
  logLevels?: LogLevel[]
  /** 时间排序，offset/limit 按此顺序取；缺省 asc。desc = 先取最新的 */
  order?: 'asc' | 'desc'
  offset?: number
  limit?: number
}

export type LogQueryPage = {
  /** 满足条件的总条数（不受 offset/limit 影响） */
  total: number
  /** 按 order 排序 */
  records: LogRecord[]
}

/** 筛选项：当前工程日志里实际出现过的取值 */
export type LogFilterOptions = {
  users: string[]
  /** 最早 / 最晚一条可见记录的时间；无记录为 null */
  timeRange: LogTimeRange | null
}

export type LogAlarmReviewParams = {
  alarmId: string
}

/** 快照采样点；没有的量缺省 */
export type LogSnapshotPoint = {
  t: number
  /** mm */
  position?: number
  /** mm/s */
  speed?: number
  /** 额定转矩的百分比 */
  torque?: number
  /** ℃ */
  temperature?: number
}

/** 一台电机（轴）在快照时间段内的状态曲线 */
export type LogSnapshotSeries = {
  deviceId: number
  /** 时间升序 */
  points: LogSnapshotPoint[]
}

/** 报警回看：时间段固定为报警前 10s ~ 后 5s（alarmSnapshotWindow） */
export type LogAlarmReview = {
  alarm: LogRecord
  /** 时间段内的操作回码 / 报警 / 系统记录（含 debug），时间升序，含 alarm 本身 */
  records: LogRecord[]
  /** 按电机 id 升序；报警后 5s 尚未写完时可能不完整 */
  snapshot: LogSnapshotSeries[]
}

/** Log|write：界面侧事件（如保存工程）交给 C++ 写入；id、user 由 C++ 填 */
export type LogWriteParams = {
  category: 'optRet' | 'system'
  level: LogLevel
  message: string
  opGroup?: LogOpGroup
  opType?: string
  result?: LogResult
  /** 事件发生时间，缺省为 C++ 收到时间 */
  timestamp?: number
}

/** 控制页日志列表条数 */
export const RECENT_LOG_LIMIT = 30

/** 报警快照：固定为报警前 10s + 后 5s */
export const ALARM_SNAPSHOT_BEFORE_MS = 10_000
export const ALARM_SNAPSHOT_AFTER_MS = 5_000

export const alarmSnapshotWindow = (alarmTime: number): LogTimeRange => ({
  start: alarmTime - ALARM_SNAPSHOT_BEFORE_MS,
  end: alarmTime + ALARM_SNAPSHOT_AFTER_MS,
})

/** 默认显示的日志级别（不含 debug） */
export const VISIBLE_LOG_LEVELS: LogLevel[] = ['info', 'warning', 'error']

/** 快照曲线的键 */
export const deviceKey = (series: Pick<LogSnapshotSeries, 'deviceId'>): string => String(series.deviceId)

/** 快照里只有电机 id */
export const motorLabel = (deviceId: number): string => `电机 ${deviceId}`

/** 合并推送的记录：去重、去 debug 和 optCall、按时间升序、只保留最新 limit 条 */
export const mergeRecentLogs = (
  current: readonly LogRecord[],
  incoming: readonly LogRecord[],
  limit: number = RECENT_LOG_LIMIT,
): LogRecord[] => {
  const byId = new Map<string, LogRecord>()
  for (const record of current) byId.set(record.id, record)
  for (const record of incoming) {
    if (record.level === 'debug' || record.category === 'optCall') continue
    byId.set(record.id, record)
  }
  return [...byId.values()]
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-limit)
}
