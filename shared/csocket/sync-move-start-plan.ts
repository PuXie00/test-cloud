import type { ActionDataSaveItem, ActionStartPlan } from './action-data-save'


export type SyncMoveVirtualAxis = {
  pos: number
  vel: number
  accVel: number
  decVel: number
}

/**
 * syncMovePrepare（0x010A）下发的非强制接入计划，GO（syncMovebegin，0x010B）时执行。
 * 上位机按 python/非强制就近接入.py 算出（TS 移植：src/app/project/action-sequence/nonforced-entry.ts）。
 *
 * 字段
 * - direction：true 正向，false 反向。
 * - targetFrameMs：接入帧，原曲线时刻，整数毫秒。帧表从这一帧接上。
 * - transitionSec：GO 到接入帧的时间，单位是【毫秒】（沿用旧字段名），整数。
 * - modelList[].virtualAxis：每台设备 [v1, v2, v3] 各一条准备 Move：pos 停车目标、vel、accVel、decVel（0.1 精度）。
 *
 * C++ 执行约定
 * 1. GO 时每台设备三轴的准备 Move 同时下发（一条三轴 move）。vel > 0 的都要发，包括不动的轴：
 *    它的 pos 就是当前位置，原地保持。设备没有的轴 pos 为实时值、vel / accVel / decVel 为 0，不下发。
 * 2. pos 是这条 Move 的停车目标，不是接入点；轴到接入帧时可能还在运动。算法保证 GO 后 transitionSec 毫秒时，
 *    各轴的位置和速度都与帧表回放在 targetFrameMs 处一致（位置差 ≤ 0.05，速度差 ≤ 0.05/秒），之后整段也一致。
 * 3. 帧表在 GO 后 transitionSec 毫秒按计时开始，不能等“到位 / 停稳”：带速接入的轴不会在 pos 停下等待。
 *    开始晚了，准备 Move 会按自己的减速度朝 pos 刹车，晚得越多偏得越多。
 * 4. 帧表开始时按帧表的“中途接入”规则（见 cCompiledModel）：从接入帧的下一帧（反向为上一帧）往回找第一条
 *    vel > 0 的立即下发，之后照常逐帧；接入帧之前（反向为之后）的帧跳过。带速接入时，这条补发把运动交回原 Move；
 *    接入帧正好是原 Move 的下发时刻时必须发。
 * 5. 倍率：计划按 100% 算。GO 一律按 100% 起步；接入帧之前收到的倍率（包括 GO 前刚下发的推子倍率）
 *    都推迟到接入帧，再按帧表“运行中改倍率”的规则生效。准备 Move 不按倍率缩放：缩放后接入速度对不上，
 *    倍率 > 1 时还会超出设备能力。
 * 6. 准备 Move 按设备真实最大速度、加减速度计算（不是默认速度），可能用到满能力。
 * 7. transitionSec 为 0：已在接入点（at-start），原地保持的 Move 照发，GO 后直接从 targetFrameMs 开始。
 */
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
 * 算法给了准备 Move（entryMove）的轴原样下发：不动的轴 pos 为当前位置、vel > 0；
 * 设备没有的轴 pos 为实时值、速度为 0（不下发）。计划里没有的轴补 0。接入帧、准备时间取整到毫秒。
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
