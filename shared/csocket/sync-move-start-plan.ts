import type { ActionDataSaveItem, ActionStartPlan } from './action-data-save'


export type SyncMoveVirtualAxis = {
  pos: number
  vel: number
  accVel: number
  decVel: number
}

/** syncMovePrepare 下发的接入计划。direction：true 正向，false 反向。transitionSec 单位是毫秒。 */
export type SyncMoveStartPlan = {
  direction: boolean
  nearest: boolean
  targetFrameMs: number
  transitionSec: number
  modelList: {
    deviceId: number
    virtualAxis: SyncMoveVirtualAxis[]
  }[]
}

export type SyncMovePrepareSource = {
  actionId: number
  modelList: ActionDataSaveItem['modelList'] | unknown[]
  IOBlockList: ActionDataSaveItem['IOBlockList'] | unknown[]
  startPlan?: ActionStartPlan
}

const AXIS_ORDER = ['v1', 'v2', 'v3'] as const

const ZERO_AXIS: SyncMoveVirtualAxis = { pos: 0, vel: 0, accVel: 0, decVel: 0 }

const round1 = (value: number) => Math.round(value * 10) / 10

/**
 * 非强制准备：把上位机 startPlan 转成 [v1, v2, v3]。
 * 算法给了准备 Move（entryMove）的轴原样下发，三轴都有（不动的轴 pos 为当前位置、vel > 0）；
 * 没有的轴补 0（vel 为 0 不下发）。接入帧、准备时间取整到毫秒。
 */
export const toSyncMoveStartPlan = (plan: ActionStartPlan): SyncMoveStartPlan => ({
  direction: plan.direction === 1,
  nearest: plan.nearest,
  targetFrameMs: Math.round(plan.targetFrameMs),
  transitionSec: Math.round(plan.transitionSec * 1000),
  modelList: plan.members.map((member) => {
    const moves = new Map(member.axes.map((axis) => [axis.axis, axis]))
    return {
      deviceId: member.objectId,
      virtualAxis: AXIS_ORDER.map((axis) => {
        const move = moves.get(axis)
        if (!move) return { ...ZERO_AXIS }
        if (move.entryMove) return { ...move.entryMove }
        return {
          pos: move.to,
          vel: round1(move.velocity),
          accVel: round1(move.acceleration),
          decVel: round1(move.deceleration),
        }
      }),
    }
  }),
})

export const toSyncMovePrepareItems = <T extends SyncMovePrepareSource>(items: readonly T[]) =>
  items.map((item) => {
    const prepared = {
      actionId: item.actionId,
      modelList: item.modelList,
      IOBlockList: item.IOBlockList,
    }
    if (!item.startPlan) return prepared
    return { ...prepared, startPlan: toSyncMoveStartPlan(item.startPlan) }
  })
