/**
 * 热备时指令按类处理（方案 6.1、6.3）：
 * - 停止类：不等结果立即同步给另一台；备机任何时候都能发。
 * - 配置：不走指令同步，走工程同步；备机上带「不写 PLC」标志，只由主机写 PLC。
 * - 整台 PLC 的指令：只在主机上做，执行成功后同步给备机。
 * - 读取类、日志、授权、链路本身：不同步。
 * - 其它写指令：发起那台执行成功后同步。
 * 另一台收到同步来的指令，一律带上「不写 PLC」标志交给本机 C++。
 */

export type HaCommandClass = 'stop' | 'config' | 'whole-plc' | 'local' | 'write'

const STOP_COMMANDS = new Set([
  'Opera|stop',
  'Opera|eStop',
  'Opera|AllStop',
  'Opera|stopAction',
  'Opera|syncMoveEnd',
  // 只在停止强制动作时用（api.ts actionStop）
  'Opera|actionCall',
])

const CONFIG_COMMANDS = new Set([
  'CONFIG|DEV|addPlc',
  'CONFIG|DEV|deletePlc',
  'Config|addAxis',
  'Config|axisParam',
  'Config|addModel',
  'Config|deleteModel',
  'Config|modelParam',
  'Config|configureRailBinding',
])

const WHOLE_PLC_COMMANDS = new Set([
  'Opera|simulationSwitch',
  'Opera|plcReset',
  'Opera|busReset',
  'CONFIG|Pro|download',
  'Config|downloadPLCInfo',
  'Config|clearConfig',
])

/** 本机自己的读取、维护指令，不同步 */
const LOCAL_COMMANDS = new Set([
  'CONFIG|Pro|open',
  'Info|scan',
  'Opera|readrunconfig',
  'Opera|clockSync',
])

const LOCAL_PREFIXES = ['Information|', 'Log|', 'Auth|', 'HA|']

/**
 * 点动松开发的是方向为 0 的 Opera|jog（物体 0x0104、电机 0x0006 都是），不是 Opera|stop：
 * 它要按停止类处理，备机断线时也不能拦，否则设备停不下来。
 */
const isJogRelease = (optCmd: string, params?: unknown[]): boolean =>
  optCmd === 'Opera|jog' &&
  Array.isArray(params) &&
  params.length > 0 &&
  params.every(
    (item) =>
      typeof item === 'object' &&
      item !== null &&
      (item as { direction?: unknown }).direction === 0,
  )

export const classifyHaCommand = (optCmd: string, params?: unknown[]): HaCommandClass => {
  if (STOP_COMMANDS.has(optCmd) || isJogRelease(optCmd, params)) return 'stop'
  if (CONFIG_COMMANDS.has(optCmd)) return 'config'
  if (WHOLE_PLC_COMMANDS.has(optCmd)) return 'whole-plc'
  if (LOCAL_COMMANDS.has(optCmd) || LOCAL_PREFIXES.some((prefix) => optCmd.startsWith(prefix))) {
    return 'local'
  }
  return 'write'
}

/** 链路本身的指令（HA|start、HA|stop、HA|send）不受热备规则约束 */
export const isHaLinkCommand = (optCmd: string): boolean => optCmd.startsWith('HA|')

/** 执行后要同步给另一台的（配置走工程同步，读取类不同步） */
export const isHaSyncedCommand = (optCmd: string, params?: unknown[]): boolean => {
  const kind = classifyHaCommand(optCmd, params)
  return kind === 'stop' || kind === 'whole-plc' || kind === 'write'
}
