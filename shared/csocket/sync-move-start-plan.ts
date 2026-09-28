import type { ActionDataSaveItem, ActionStartPlan } from './action-data-save'

export type { ActionStartPlan } from './action-data-save'

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

/** 非强制准备：把上位机 startPlan 转成 [v1, v2, v3]，缺轴补 0。pos 取目标虚轴值。 */
export const toSyncMoveStartPlan = (plan: ActionStartPlan): SyncMoveStartPlan => ({
  direction: plan.direction === 1,
  nearest: plan.nearest,
  targetFrameMs: plan.targetFrameMs,
  transitionSec: plan.transitionSec * 1000,
  modelList: plan.members.map((member) => {
    const moves = new Map(member.axes.map((axis) => [axis.axis, axis]))
    return {
      deviceId: member.objectId,
      virtualAxis: AXIS_ORDER.map((axis) => {
        const move = moves.get(axis)
        if (!move) return { ...ZERO_AXIS }
        return {
          pos: move.to,
          vel: move.velocity,
          accVel: move.acceleration,
          decVel: move.deceleration,
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
