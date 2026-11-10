export type PlcCurveSegment = {
  startTime: number
  position: number
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

export type PlcCompiledTimeline = {
  modelId: number
  virtualAxisNo: number
  segments: PlcCurveSegment[]
}

export type cCompiledEvent = {
  time: number
  params:{
    OptCmd: string // 指令名，比如断使能为Operation|enable，固定唯一的
    addr: string // 地址，比如断使能为0x0102，固定的
    params:({ deviceId: number } & Record<string, number>)[]// 指令参数,如：{ deviceId:1, enableFlag:0}
  }
}

export type PlcCompiledAction = {
  totalDuration: number
  timelines: PlcCompiledTimeline[]
  models: cCompiledModel[]
  ioBlocks: cCompiledEvent[]
}
/**
 * 非强制动作给 C++ 的帧表，按汇川轮廓位置模式 / MC_MoveAbsolute（立即更新）的 move 生成：
 * 驱动器按 速度 / 加速度 / 减速度 走梯形到 pos 并停下。
 *
 * 帧 = 该物体的全部关键帧，加上中途要变速的时刻，按 time 升序。
 * 正向：C++ 在每一帧取【下一帧】的 pos、vel、accVel、decVel 下发 move；反向：取【上一帧】。
 * 例：0（0s）→ 1000（10s）→ 0（20s），正向帧表为
 *   0s  { pos: 0,    vel: 0 }        起点，不下发
 *   10s { pos: 1000, vel: 111.111 }  0s 时下发
 *   20s { pos: 0,    vel: 111.111 }  10s 时下发
 *
 * - pos 是这段连续运动最终停下的位置；中途不停的位姿（如 0→500→1000 的 500）不当目标，
 *   只在要变速的时刻重发同一个 pos、改速度（提速按加速度，降速按减速度），
 *   最后一条的减速度就是停到 pos 的减速度，驱动器到点自己减速。
 * - vel 为 0 的项不下发 move：这一帧没有 move 落在这里，pos 只是这一帧的虚轴值
 *   （曲线上本该到的值；序列不控制的轴是准备时的实时值）。
 * - 反向的帧表按倒走的曲线单独生成，time 仍是原曲线时刻。
 * - 中途接入（就近帧）：各轴从接入帧的下一帧（反向为上一帧）往回找第一条 vel > 0 的立即下发，
 *   之后照常逐帧。
 * - 调速倍率 k（GO 时）：time / k，vel × k，accVel、decVel × k²，走出的就是按时间缩放的同一条曲线。
 * - 运行中改倍率 k1 → k2：剩余帧按 k2 重新排时间；当前生效的 move 立刻按 k2 重发，但这段运动剩下的
 *   move（到下一条 vel > 0 且 passVel = 0 之前）减速度按 max(k1, k2)² 缩放且只增不减，
 *   否则降倍率时可能来不及停在 pos；vel > 0 且 passVel = 0 的 move 要等轴停在上一个 pos 后再发
 *   （提倍率时轴会落后于新时间表）。
 */
export type cCompiledModel = {
  deviceId:number, // 物体id
  timeBlockList:{
    time:number, // 帧时刻，ms（原曲线时间）
    virtualAxis:({
      pos:number, // 目标位置：这段连续运动停下的位置；vel 为 0 时是这一帧的虚轴值
      vel:number, // 速度（绝对值）；0 表示这一帧不下发
      accVel:number, // 加速度
      decVel:number, // 减速度
      passVel:number, // 下发这条 move 时轴应有的速度（绝对值）；vel > 0 时 0 表示从静止起步（新的一段运动）
    })[] // 虚轴列表，按启用的轴排【v1，v2，v3】
  }[] // 帧列表，按 time 升序
}

/** 上位机就近算法算出的接入计划。非强制由 syncMovePrepare 转成 PLC 报文，强制由 actionGo 的 1006 下发。 */
export type ActionStartMode = 'nearest' | 'boundary' | 'at-start'

export type ActionStartPlan = {
  nearest: boolean
  direction: 1 | -1
  startMode: ActionStartMode
  targetFrameMs: number
  /** 过渡时长，秒。下发前换算成毫秒。 */
  transitionSec: number
  /** 1006 准备所需的时间：过渡时长向上取整到毫秒 */
  prepareTimeMs: number
  /** 实际循环配置：曲线首尾不闭合时算法回退为 1 */
  loopCount: number
  motorLimitScale: number | null
  members: readonly {
    objectId: number
    axes: readonly {
      axis: 'v1' | 'v2' | 'v3'
      to: number
      velocity: number
      acceleration: number
      deceleration: number
      /** 非强制：GO 时原样下发的准备 Move（pos 为停车目标，不一定是接入点） */
      entryMove?: { pos: number; vel: number; accVel: number; decVel: number }
    }[]
  }[]
}

export type ActionDataSaveItem = {
  actionId: number
  totalDuration: number
  trajectoryMode: boolean
  timelineCount: number
  timelineList: Array<{
    modelId: number
    virtualAxisNo: number
    segmentCount: number
    segmentList: PlcCurveSegment[]
  }>//plc需要的
  modelList:cCompiledModel[] // C++ 需要的
  IOBlockList: cCompiledEvent[]
  runDirection: boolean // 运行方向，true为正向，false为反向
  safeGroup: number // 安全组开启 1开启，0关闭
  /** 上位机算出的就近/回起点接入计划。非强制准备转入 syncMovePrepare，强制轨迹只打印。 */
  startPlan?: ActionStartPlan
}
