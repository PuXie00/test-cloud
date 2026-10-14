/**
 * 操作日志 mock：C++ 接口实现前由 api.ts 直接返回。
 * 数据在首次调用时生成一次（以当时为结束时刻往前约 40 分钟），代表当前工程的日志；
 * 只有 Log|write 会追加记录，不会定时变化。
 */
import type { CppAckResult } from '../../../shared/csocket/types'
import {
  ALARM_SNAPSHOT_AFTER_MS,
  ALARM_SNAPSHOT_BEFORE_MS,
  deviceKey,
  type AlarmLevel,
  type LogAlarmReview,
  type LogAlarmReviewParams,
  type LogDevice,
  type LogDeviceOption,
  type LogFilterOptions,
  type LogOpGroup,
  type LogOpTypeOption,
  type LogPositionUnit,
  type LogQueryPage,
  type LogQueryParams,
  type LogRecord,
  type LogSnapshotPoint,
  type LogSnapshotSeries,
  type LogWriteParams,
} from '../../../shared/csocket/operation-log'

type MockDevice = LogDeviceOption & {
  unit?: LogPositionUnit
  /** 往复运动中心、幅度、周期(ms)、相位 */
  center: number
  amp: number
  periodMs: number
  phase: number
}

const DEVICES: MockDevice[] = [
  { deviceType: 'plc', deviceId: 1, deviceName: '主控-01', center: 0, amp: 0, periodMs: 1, phase: 0 },
  { deviceType: 'model', deviceId: 101, deviceName: '升降灯架-01', center: 4200, amp: 1800, periodMs: 90_000, phase: 0 },
  { deviceType: 'model', deviceId: 102, deviceName: '升降灯架-02', center: 3800, amp: 2200, periodMs: 75_000, phase: 1.2 },
  { deviceType: 'model', deviceId: 103, deviceName: '桁架-01', center: 6000, amp: 1200, periodMs: 120_000, phase: 2.1 },
  { deviceType: 'model', deviceId: 104, deviceName: '旋转台-01', unit: '°', center: 180, amp: 160, periodMs: 60_000, phase: 0.4 },
  { deviceType: 'axis', deviceId: 1, deviceName: '电机-01', center: 4200, amp: 1800, periodMs: 90_000, phase: 0 },
  { deviceType: 'axis', deviceId: 2, deviceName: '电机-02', center: 3800, amp: 2200, periodMs: 75_000, phase: 1.2 },
  { deviceType: 'axis', deviceId: 3, deviceName: '电机-03', center: 6000, amp: 1200, periodMs: 120_000, phase: 2.1 },
]

const MOTION_DEVICES = DEVICES.filter((d) => d.deviceType !== 'plc')

const OP_TYPES: LogOpTypeOption[] = [
  { group: 'config', code: 'saveProject', label: '保存工程' },
  { group: 'config', code: 'saveProjectAs', label: '工程另存为' },
  { group: 'config', code: 'downloadProject', label: '下载工程' },
  { group: 'device', code: 'couple', label: '耦合 / 解耦' },
  { group: 'device', code: 'enable', label: '使能 / 禁用' },
  { group: 'device', code: 'jog', label: '点动' },
  { group: 'device', code: 'moveTarget', label: '启动（目标位置）' },
  { group: 'device', code: 'stop', label: '停止' },
  { group: 'device', code: 'eStop', label: '急停' },
  { group: 'device', code: 'sequence', label: '执行动作序列' },
  { group: 'debug', code: 'jog', label: '点动' },
  { group: 'debug', code: 'setOrigin', label: '设定原点' },
  { group: 'debug', code: 'ruleEdit', label: '规则引擎修改' },
]

const USERS = ['管理员', '操作员-01', '操作员-02']

const SPAN_MS = 40 * 60_000
const SNAPSHOT_INTERVAL_MS = 100

/** 报警前后的数据扰动，让曲线能看出因果 */
type Disturbance = { key: string; t: number; kind: 'speed' | 'torque' | 'position' | 'temperature' }

type Dataset = {
  records: LogRecord[]
  disturbances: Disturbance[]
}

/** 确定性伪随机，保证每次启动数据一致 */
const createRandom = (seed: number) => {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

const bump = (dt: number, widthMs: number) => Math.exp(-((dt / widthMs) ** 2))
const round1 = (v: number) => Math.round(v * 10) / 10

const sampleDevice = (
  device: MockDevice,
  t: number,
  disturbances: readonly Disturbance[],
): LogSnapshotPoint => {
  const w = (2 * Math.PI) / device.periodMs
  const maxSpeed = device.amp * w * 1000 || 1
  let position = device.center + device.amp * Math.sin(w * t + device.phase)
  let speed = maxSpeed * Math.cos(w * t + device.phase)
  let torque = 28 + (Math.abs(speed) / maxSpeed) * 22 + Math.sin(t / 137) * 1.5 + Math.sin(t / 59) * 0.8
  let temperature = 38 + (device.deviceId % 5) + Math.sin(t / 600_000 + device.phase) * 2
  const key = deviceKey(device)
  for (const d of disturbances) {
    if (d.key !== key) continue
    const dt = t - d.t
    if (Math.abs(dt) > 12_000) continue
    if (d.kind === 'speed') {
      // 报警前 4s 加速冲高，报警后快速回落
      const ramp = dt < 0 ? Math.max(0, 1 + dt / 4000) : Math.max(0, 1 - dt / 800)
      speed += Math.sign(speed || 1) * 420 * ramp
      torque += 18 * ramp
    } else if (d.kind === 'torque') {
      torque += 72 * bump(dt + 300, 1200)
      speed *= dt > 0 ? Math.max(0.05, 1 - dt / 1500) : 1
    } else if (d.kind === 'position') {
      position += 45 * bump(dt + 500, 1800)
      torque += 25 * bump(dt + 500, 1800)
    } else {
      temperature += dt < 0 ? Math.max(0, 1 + dt / 9000) * 30 : 30 - Math.min(dt / 5000, 1) * 3
    }
  }
  return {
    t,
    position: round1(position),
    speed: round1(speed),
    torque: round1(torque),
    temperature: round1(temperature),
  }
}

const toLogDevice = (device: MockDevice, ok?: boolean): LogDevice => ({
  deviceType: device.deviceType,
  deviceId: device.deviceId,
  deviceName: device.deviceName,
  ...(ok === undefined ? {} : { ok }),
})

const names = (devices: MockDevice[]) => devices.map((d) => d.deviceName).join('、')

const buildDataset = (endAt: number): Dataset => {
  const random = createRandom(20261013)
  const start = endAt - SPAN_MS
  const records: LogRecord[] = []
  const disturbances: Disturbance[] = []

  // id 在排序后统一编号
  const push = (record: Omit<LogRecord, 'id'>) => {
    const full: LogRecord = { id: '', ...record }
    records.push(full)
    return full
  }
  const op = (
    t: number,
    user: string,
    opGroup: LogOpGroup,
    opType: string,
    message: string,
    devices: LogDevice[] = [],
    result: LogRecord['result'] = { ok: true },
  ) =>
    push({
      timestamp: Math.round(t),
      category: 'operation',
      level: result?.ok === false ? 'warning' : 'info',
      user,
      opGroup,
      opType,
      message,
      ...(devices.length > 0 ? { devices } : {}),
      result,
    })
  const alarm = (t: number, device: MockDevice, alarmLevel: AlarmLevel, alarmCode: number, text: string) =>
    push({
      timestamp: Math.round(t),
      category: 'alarm',
      level: alarmLevel === 1 ? 'warning' : 'error',
      alarmLevel,
      alarmCode,
      alarmState: 'raised',
      message: `${device.deviceName} ${text}`,
      devices: [toLogDevice(device)],
      snapshotRange: {
        start: Math.round(t) - ALARM_SNAPSHOT_BEFORE_MS,
        end: Math.round(t) + ALARM_SNAPSHOT_AFTER_MS,
      },
    })
  const cleared = (t: number, raised: LogRecord, text: string) =>
    push({
      timestamp: Math.round(t),
      category: 'alarm',
      level: 'info',
      alarmLevel: raised.alarmLevel,
      alarmCode: raised.alarmCode,
      alarmState: 'cleared',
      message: `${raised.devices?.[0]?.deviceName ?? ''} ${text}已清除`,
      devices: raised.devices,
    })
  const system = (t: number, message: string, level: LogRecord['level'] = 'info', device?: MockDevice) =>
    push({
      timestamp: Math.round(t),
      category: 'system',
      level,
      message,
      ...(device ? { devices: [toLogDevice(device)] } : {}),
    })

  const [plc, lift1, lift2, truss, turntable, axis1, axis2, axis3] = DEVICES
  const models = [lift1, lift2, truss, turntable]

  // 打开工程即开始记录
  system(start + 500, '主控-01 已连接', 'info', plc)
  system(start + 1_200, '工程校验通过', 'info', plc)
  system(start + 2_000, '时钟同步完成', 'debug', plc)
  op(start + 30_000, USERS[0], 'debug', 'setOrigin', `设定原点 ${names([axis1, axis2, axis3])}`, [axis1, axis2, axis3].map((d) => toLogDevice(d, true)))
  op(start + 55_000, USERS[0], 'debug', 'jog', `点动 ${axis2.deviceName} 正向`, [toLogDevice(axis2)])
  op(start + 80_000, USERS[0], 'debug', 'ruleEdit', '修改规则「桁架限位联锁」')
  op(start + 95_000, USERS[0], 'config', 'downloadProject', '下载工程到主控-01', [toLogDevice(plc)], { ok: false, message: '主控-01 未响应' })
  op(start + 125_000, USERS[0], 'config', 'downloadProject', '下载工程到主控-01', [toLogDevice(plc)])
  op(start + 150_000, USERS[0], 'config', 'saveProject', '保存工程「演示工程」')
  op(
    start + 170_000,
    USERS[1],
    'device',
    'enable',
    `使能 ${names(models)}`,
    models.map((d) => toLogDevice(d, d !== turntable)),
    { ok: false, message: '旋转台-01 使能超时，其余成功' },
  )
  op(start + 185_000, USERS[1], 'device', 'enable', `使能 ${turntable.deviceName}`, [toLogDevice(turntable)])
  op(start + 200_000, USERS[1], 'device', 'couple', `耦合 ${names([lift1, lift2])}`, [lift1, lift2].map((d) => toLogDevice(d, true)))

  // 常规操作填充
  let t = start + 230_000
  while (t < endAt - 30_000) {
    const user = USERS[1 + Math.floor(random() * 2)]
    const roll = random()
    if (roll < 0.35) {
      const device = models[Math.floor(random() * models.length)]
      op(t, user, 'device', 'jog', `点动 ${device.deviceName} ${random() < 0.5 ? '正向' : '反向'}`, [toLogDevice(device)])
      op(t + 1_500 + random() * 2_000, user, 'device', 'stop', `停止 ${device.deviceName}`, [toLogDevice(device)])
    } else if (roll < 0.7) {
      const count = 1 + Math.floor(random() * 3)
      const picked = [...models].sort(() => random() - 0.5).slice(0, count)
      op(t, user, 'device', 'moveTarget', `启动 ${names(picked)} 到目标位置`, picked.map((d) => toLogDevice(d)))
    } else if (roll < 0.85) {
      op(t, user, 'device', 'sequence', '执行动作序列「换景 A」', [lift1, lift2].map((d) => toLogDevice(d)))
    } else {
      system(t, `主控-01 报文重发 ${1 + Math.floor(random() * 3)} 次`, 'debug', plc)
    }
    t += 12_000 + random() * 18_000
  }

  // 报警故事：操作 → 报警 → 处置 → 清除
  const s1 = start + SPAN_MS * 0.3
  op(s1 - 4_200, USERS[1], 'device', 'jog', `点动 ${lift2.deviceName} 正向（高速档）`, [toLogDevice(lift2)])
  const a1 = alarm(s1, lift2, 2, 2102, '速度超限')
  disturbances.push({ key: deviceKey(lift2), t: s1, kind: 'speed' }, { key: deviceKey(axis2), t: s1, kind: 'speed' })
  op(s1 + 900, USERS[1], 'device', 'stop', `停止 ${lift2.deviceName}`, [toLogDevice(lift2)])
  cleared(s1 + 9_400, a1, '速度超限')

  const s2 = start + SPAN_MS * 0.55
  const opening = [truss, lift1, lift2]
  op(s2 - 5_500, USERS[0], 'device', 'sequence', '执行动作序列「开场」', opening.map((d) => toLogDevice(d)))
  const a2 = alarm(s2, axis3, 3, 2103, '转矩超限')
  disturbances.push({ key: deviceKey(axis3), t: s2, kind: 'torque' }, { key: deviceKey(truss), t: s2, kind: 'torque' })
  system(s2 + 120, '动作序列「开场」已中止：电机-03 转矩超限', 'error')
  system(s2 + 300, '电机-03 驱动器报警字 0x2103', 'debug', axis3)
  op(s2 + 3_800, USERS[0], 'device', 'stop', `停止 ${names(opening)}`, opening.map((d) => toLogDevice(d, true)))
  cleared(s2 + 12_300, a2, '转矩超限')

  const s3 = start + SPAN_MS * 0.7
  system(s3 - 1_500, '主控-01 心跳超时，重连中', 'debug', plc)
  system(s3, '主控-01 已断开', 'warning', plc)
  system(s3 + 4_000, '主控-01 已连接', 'info', plc)

  const s4 = start + SPAN_MS * 0.82
  op(s4 - 6_000, USERS[2], 'device', 'moveTarget', `启动 ${lift1.deviceName} 到目标位置 5800mm`, [toLogDevice(lift1)])
  const a4 = alarm(s4, axis1, 2, 2101, '位置偏差超限')
  disturbances.push({ key: deviceKey(axis1), t: s4, kind: 'position' }, { key: deviceKey(lift1), t: s4, kind: 'position' })
  op(s4 + 1_500, USERS[2], 'device', 'eStop', '急停（全部设备）', MOTION_DEVICES.map((d) => toLogDevice(d, true)))
  const a5 = alarm(s4 + 1_600, lift1, 3, 3001, '急停触发')
  cleared(s4 + 15_200, a4, '位置偏差超限')
  cleared(s4 + 15_300, a5, '急停触发')

  const s5 = endAt - 50_000
  op(s5 - 3_000, USERS[1], 'device', 'moveTarget', `启动 ${turntable.deviceName} 到目标位置 300°`, [toLogDevice(turntable)])
  alarm(s5, turntable, 1, 1301, '驱动器温度过高 72℃')
  disturbances.push({ key: deviceKey(turntable), t: s5, kind: 'temperature' })

  records.sort((a, b) => a.timestamp - b.timestamp)
  records.forEach((record, index) => {
    record.id = `log-${(index + 1).toString().padStart(5, '0')}`
  })
  return { records, disturbances }
}

let dataset: Dataset | null = null
const getDataset = (): Dataset => {
  if (!dataset) dataset = buildDataset(Math.floor(Date.now() / 1000) * 1000)
  return dataset
}

const ok = <T>(data: T[]): CppAckResult<T> => ({ success: true, data })

const hasAny = <T>(list: readonly T[] | undefined): list is readonly T[] =>
  Array.isArray(list) && list.length > 0

/**
 * 筛选语义（C++ 需一致）：各维度之间为“且”；
 * users / opGroups / opTypes 只约束操作类，alarmLevels 只约束报警类，
 * devices 只约束带设备的记录（涉及的设备中任一命中即可），其余类别不受该维度影响。
 */
export const matchesLogQuery = (record: LogRecord, params: LogQueryParams): boolean => {
  if (params.startTime != null && record.timestamp < params.startTime) return false
  if (params.endTime != null && record.timestamp > params.endTime) return false
  if (hasAny(params.categories) && !params.categories.includes(record.category)) return false
  if (hasAny(params.logLevels) && !params.logLevels.includes(record.level)) return false
  if (record.category === 'operation') {
    if (hasAny(params.users) && !params.users.includes(record.user ?? '')) return false
    if (hasAny(params.opGroups) && (!record.opGroup || !params.opGroups.includes(record.opGroup))) return false
    if (hasAny(params.opTypes) && !params.opTypes.includes(record.opType ?? '')) return false
  }
  if (record.category === 'alarm' && hasAny(params.alarmLevels)) {
    if (record.alarmLevel == null || !params.alarmLevels.includes(record.alarmLevel)) return false
  }
  if (hasAny(params.devices) && hasAny(record.devices)) {
    const wanted = new Set(params.devices.map(deviceKey))
    if (!record.devices.some((d) => wanted.has(deviceKey(d)))) return false
  }
  return true
}

export const mockLogQuery = (params: LogQueryParams = {}): CppAckResult<LogQueryPage> => {
  const matched = getDataset().records.filter((r) => matchesLogQuery(r, params))
  if (params.order === 'desc') matched.reverse()
  const offset = Math.max(0, params.offset ?? 0)
  const limit = Math.max(1, params.limit ?? 1000)
  return ok([{ total: matched.length, records: matched.slice(offset, offset + limit) }])
}

export const mockLogFilterOptions = (): CppAckResult<LogFilterOptions> => {
  const { records } = getDataset()
  const users = [...new Set(records.map((r) => r.user).filter((u): u is string => !!u))]
  const seenDevices = new Set(records.flatMap((r) => r.devices ?? []).map(deviceKey))
  const devices = DEVICES.filter((d) => seenDevices.has(deviceKey(d))).map(
    ({ deviceType, deviceId, deviceName }) => ({ deviceType, deviceId, deviceName }),
  )
  const seenOps = new Set(records.map((r) => `${r.opGroup}/${r.opType}`))
  const opTypes = OP_TYPES.filter((op) => seenOps.has(`${op.group}/${op.code}`))
  const timeRange =
    records.length > 0
      ? { start: records[0].timestamp, end: records[records.length - 1].timestamp }
      : null
  return ok([{ users, devices, opTypes, timeRange }])
}

export const mockLogAlarmReview = (
  params: LogAlarmReviewParams,
): CppAckResult<LogAlarmReview> => {
  const { records, disturbances } = getDataset()
  const alarm = records.find((r) => r.id === params.alarmId && r.category === 'alarm')
  if (!alarm) return { success: false, code: 'NOT_FOUND', message: '报警记录不存在' }
  if (!alarm.snapshotRange) return { success: false, code: 'NO_SNAPSHOT', message: '该报警没有状态快照' }
  const range = alarm.snapshotRange
  const snapshot: LogSnapshotSeries[] = MOTION_DEVICES.map((device) => {
    const points: LogSnapshotPoint[] = []
    for (let t = range.start; t <= range.end; t += SNAPSHOT_INTERVAL_MS) {
      points.push(sampleDevice(device, t, disturbances))
    }
    return {
      deviceType: device.deviceType,
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      ...(device.unit ? { unit: device.unit } : {}),
      points,
    }
  })
  return ok([
    {
      alarm,
      range,
      records: records.filter((r) => r.timestamp >= range.start && r.timestamp <= range.end),
      snapshot,
    },
  ])
}

let writeSeq = 0

/** 界面写入：追加到 mock 日志（C++ 实现后由 C++ 写盘并 Info|log 推送） */
export const mockLogWrite = (params: LogWriteParams, user?: string): CppAckResult<LogRecord> => {
  const { timestamp, ...rest } = params
  const record: LogRecord = {
    id: `log-w-${(++writeSeq).toString().padStart(4, '0')}`,
    timestamp: timestamp ?? Date.now(),
    ...rest,
    ...(user ? { user } : {}),
  }
  const { records } = getDataset()
  records.push(record)
  records.sort((a, b) => a.timestamp - b.timestamp)
  return ok([record])
}
