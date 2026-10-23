/**
 * 读当前工程的日志库（log.db，C++ 写入，表结构见 docs/cpp-operation-log-api.md）。只读，只用 SELECT。
 * 只依赖 prepare().all() / get()：Electron 里用 better-sqlite3，单测用 node:sqlite。
 */
import {
  VISIBLE_LOG_CATEGORIES,
  alarmSnapshotWindow,
  opTypeLabel,
  type LogAlarmReview,
  type LogCategory,
  type LogFilterOptions,
  type LogLevel,
  type LogOpGroup,
  type LogQueryPage,
  type LogQueryParams,
  type LogRecord,
  type LogResult,
  type LogSnapshotPoint,
  type LogSnapshotSeries,
} from '../../../shared/csocket/operation-log'

/** 日志库文件名，放在工程目录下 */
export const LOG_DB_FILE = 'log.db'

export type SqlValue = string | number | null

export type SqlStatement = {
  all(...params: SqlValue[]): unknown[]
  get(...params: SqlValue[]): unknown
}

export type SqlDatabase = { prepare(sql: string): SqlStatement }

type LogRow = {
  id: number
  ts: number
  category: LogCategory
  level: LogLevel
  message: string
  user_name: string | null
  op_group: LogOpGroup | null
  op_type: string | null
  result_ok: LogResult | null
}

type SampleRow = {
  t: number
  device_id: number
  position: number | null
  speed: number | null
  torque: number | null
  temperature: number | null
}

const LOG_COLUMNS = 'id, ts, category, level, message, user_name, op_group, op_type, result_ok'

const placeholders = (count: number) => Array.from({ length: count }, () => '?').join(', ')

const VISIBLE_IN = `category IN (${placeholders(VISIBLE_LOG_CATEGORIES.length)})`

export const rowToRecord = (row: LogRow): LogRecord => ({
  id: String(row.id),
  timestamp: row.ts,
  category: row.category,
  level: row.level,
  message: row.message,
  ...(row.user_name ? { user: row.user_name } : {}),
  ...(row.op_group ? { opGroup: row.op_group } : {}),
  ...(row.op_type ? { opType: row.op_type } : {}),
  ...(row.result_ok != null ? { result: row.result_ok } : {}),
})

/**
 * 各维度之间为“且”；users / opGroups / opTypes 只约束操作回码，报警和系统记录不受影响。
 * operation 只存库，永远不查。
 */
export const buildLogWhere = (params: LogQueryParams): { sql: string; args: SqlValue[] } => {
  const clauses: string[] = []
  const args: SqlValue[] = []
  const inList = (column: string, values: readonly SqlValue[]) => {
    if (values.length === 0) return '0'
    args.push(...values)
    return `${column} IN (${placeholders(values.length)})`
  }
  const onlyOptCall = (column: string, values: readonly SqlValue[]) =>
    `(category <> 'optCall' OR ${inList(column, values)})`

  if (params.startTime != null) {
    clauses.push('ts >= ?')
    args.push(params.startTime)
  }
  if (params.endTime != null) {
    clauses.push('ts <= ?')
    args.push(params.endTime)
  }
  const wanted = params.categories?.length ? params.categories : VISIBLE_LOG_CATEGORIES
  clauses.push(inList('category', VISIBLE_LOG_CATEGORIES.filter((c) => wanted.includes(c))))
  if (params.logLevels?.length) clauses.push(inList('level', params.logLevels))
  if (params.users?.length) clauses.push(onlyOptCall('user_name', params.users))
  if (params.opGroups?.length) clauses.push(onlyOptCall('op_group', params.opGroups))
  if (params.opTypes?.length) clauses.push(onlyOptCall('op_type', params.opTypes))
  return { sql: `WHERE ${clauses.join(' AND ')}`, args }
}

const toCount = (value: number | undefined, fallback: number) =>
  value != null && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback

/** 多维筛选 + 分页；offset / limit 按 order 的方向计算，limit 缺省不限 */
export const queryLogs = (db: SqlDatabase, params: LogQueryParams): LogQueryPage => {
  const where = buildLogWhere(params)
  const order = params.order === 'desc' ? 'DESC' : 'ASC'
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM log ${where.sql}`).get(...where.args) as { n: number }
  const rows = db
    .prepare(`SELECT ${LOG_COLUMNS} FROM log ${where.sql} ORDER BY ts ${order}, id ${order} LIMIT ? OFFSET ?`)
    .all(...where.args, toCount(params.limit, -1), toCount(params.offset, 0)) as LogRow[]
  return { total: n, records: rows.map(rowToRecord) }
}

/** 筛选项：操作回码里出现过的操作人和操作类型，以及可见记录的时间范围 */
export const readFilterOptions = (db: SqlDatabase): LogFilterOptions => {
  const users = (
    db
      .prepare(
        `SELECT DISTINCT user_name FROM log
         WHERE category = 'optCall' AND user_name IS NOT NULL AND user_name <> ''
         ORDER BY user_name`,
      )
      .all() as { user_name: string }[]
  ).map((row) => row.user_name)
  const opTypes = (
    db
      .prepare(
        `SELECT DISTINCT op_group, op_type FROM log
         WHERE category = 'optCall' AND op_group IN ('config', 'device') AND op_type IS NOT NULL AND op_type <> ''
         ORDER BY op_group, op_type`,
      )
      .all() as { op_group: LogOpGroup; op_type: string }[]
  ).map((row) => ({ group: row.op_group, code: row.op_type, label: opTypeLabel(row.op_type) }))
  const range = db
    .prepare(`SELECT MIN(ts) AS start_ts, MAX(ts) AS end_ts FROM log WHERE ${VISIBLE_IN}`)
    .get(...VISIBLE_LOG_CATEGORIES) as { start_ts: number | null; end_ts: number | null } | undefined
  return {
    users,
    opTypes,
    timeRange: range?.start_ts != null && range.end_ts != null ? { start: range.start_ts, end: range.end_ts } : null,
  }
}

const toPoint = (row: SampleRow): LogSnapshotPoint => ({
  t: row.t,
  ...(row.position != null ? { position: row.position } : {}),
  ...(row.speed != null ? { speed: row.speed } : {}),
  ...(row.torque != null ? { torque: row.torque } : {}),
  ...(row.temperature != null ? { temperature: row.temperature } : {}),
})

/** 采样行须按 device_id、t 排序 */
export const groupSamples = (rows: readonly SampleRow[]): LogSnapshotSeries[] => {
  const series: LogSnapshotSeries[] = []
  for (const row of rows) {
    const last = series.at(-1)
    if (last?.deviceId === row.device_id) last.points.push(toPoint(row))
    else series.push({ deviceId: row.device_id, points: [toPoint(row)] })
  }
  return series
}

/** 报警回看：报警前 10s ~ 后 5s 的记录和快照采样；报警不存在返回 null */
export const reviewAlarm = (db: SqlDatabase, alarmId: string): LogAlarmReview | null => {
  const id = Number(alarmId)
  if (!Number.isSafeInteger(id)) return null
  const row = db
    .prepare(`SELECT ${LOG_COLUMNS} FROM log WHERE id = ? AND category = 'alarm'`)
    .get(id) as LogRow | undefined
  if (!row) return null
  const alarm = rowToRecord(row)
  const { start, end } = alarmSnapshotWindow(alarm.timestamp)
  const records = (
    db
      .prepare(`SELECT ${LOG_COLUMNS} FROM log WHERE ts BETWEEN ? AND ? AND ${VISIBLE_IN} ORDER BY ts, id`)
      .all(start, end, ...VISIBLE_LOG_CATEGORIES) as LogRow[]
  ).map(rowToRecord)
  const samples = db
    .prepare(
      `SELECT t, device_id, position, speed, torque, temperature FROM snapshot_sample
       WHERE t BETWEEN ? AND ? ORDER BY device_id, t`,
    )
    .all(start, end) as SampleRow[]
  return { alarm, records, snapshot: groupSamples(samples) }
}
