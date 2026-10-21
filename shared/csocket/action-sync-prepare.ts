import type { ActionStartPlan } from './action-data-save'

/** 0x1006 动作同步准备：每个设备的准备 V/A（D=A），由就近算法给出 */
export type ActionPrepareDevice = {
  deviceId: number
  velocityH: number
  accelerationH: number
  velocityP: number
  accelerationP: number
  velocityY: number
  accelerationY: number
}

/** actionGo 的一项。强制轨迹走 1006 准备 + 1007 启动；非强制走 syncMovebegin。 */
export type ActionGoItem = {
  actionId: number
  /** 1 正向，2 反向 */
  runDirection: number
  /** 速度倍率，1 = 100% */
  speedScale: number
  /** 0 一直循环，1 播一次 */
  loopCount: number
  trajectoryMode: boolean
  /** 该动作下面的所有物体 id */
  deviceId: number[]
  /** 准备所需的时间，ms（就近算法的共同准备时间，已向上取整） */
  prepareTimeMs?: number
  /** 各设备准备 V/A；缺的设备按 0 下发 */
  prepareDevices?: ActionPrepareDevice[]
}

const AXIS_FIELDS = [
  ['v1', 'velocityH', 'accelerationH'],
  ['v2', 'velocityP', 'accelerationP'],
  ['v3', 'velocityY', 'accelerationY'],
] as const

const zeroDevice = (deviceId: number): ActionPrepareDevice => ({
  deviceId,
  velocityH: 0,
  accelerationH: 0,
  velocityP: 0,
  accelerationP: 0,
  velocityY: 0,
  accelerationY: 0,
})

/** 就近计划 → 各设备准备 V/A：移动的轴填算法给出的速度、加速度，不动的轴为 0 */
export const toActionPrepareDevices = (
  plan: Pick<ActionStartPlan, 'members'>,
  deviceIds: readonly number[],
): ActionPrepareDevice[] =>
  deviceIds.map((deviceId) => {
    const device = zeroDevice(deviceId)
    const member = plan.members.find((item) => item.objectId === deviceId)
    for (const [axis, velocityKey, accelerationKey] of AXIS_FIELDS) {
      const move = member?.axes.find((item) => item.axis === axis)
      if (!move) continue
      device[velocityKey] = move.velocity
      device[accelerationKey] = move.acceleration
    }
    return device
  })

/** 1006 报文头：动作、方向、倍率（百分比）、循环、准备所需的时间、设备数 */
export const toActionSyncPrepareHead = (item: ActionGoItem) => ({
  actionId: item.actionId,
  runDirection: item.runDirection === 2 ? 2 : 1,
  speedScale: Math.round(item.speedScale * 100),
  loopCount: item.loopCount,
  prepareTimeMs: item.prepareTimeMs ?? 0,
  deviceCount: item.deviceId.length,
})

/** 1006 设备参数：按 deviceId 顺序，每台一组准备 V/A */
export const toActionSyncPrepareParams = (item: ActionGoItem): ActionPrepareDevice[] =>
  item.deviceId.map(
    (deviceId) =>
      item.prepareDevices?.find((device) => device.deviceId === deviceId) ?? zeroDevice(deviceId),
  )
