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
 * 非强制动作给 C++ 的 move 指令表（汇川轮廓位置模式 / MC_MoveAbsolute，立即更新）。
 * 每个时间块是 time 这一刻要下发的 move：驱动器按 速度 / 加速度 / 减速度 走梯形到 pos 并停下。
 * pos 是这段连续运动最终停下的位置；中途不停的位姿（如 0→500→1000 的 500）不出时间块，
 * 只在要变速的时刻重发同一个 pos、改速度（提速按加速度，降速按减速度），
 * 最后一条的减速度就是停到 pos 的减速度，驱动器到点自己减速。
 *
 * - 反向运行时表按倒走的曲线生成，time 仍是原曲线时刻（升序）：从末尾往前，曲线时钟走到 time 时下发。
 * - 中途接入（就近帧）：各轴取运行方向上最近一条已过的指令立即下发。
 * - 调速倍率 k（GO 时）：time / k 下发，vel × k，accVel、decVel × k²，走出的就是按时间缩放的同一条曲线。
 * - 运行中改倍率 k1 → k2：剩余指令按 k2 重新排时间；当前这条立刻按 k2 重发，但当前这段运动
 *   （到下一条 passVel = 0 之前）的减速度用 max(k1, k2)² 缩放，否则降倍率时可能来不及停在 pos；
 *   passVel = 0 的指令要等轴停在上一个 pos 后再发（提倍率时轴会落后于新时间表）。
 */
export type cCompiledModel = {
  deviceId:number, // 物体id
  timeBlockList:{
    time:number, // 下发时刻，ms（原曲线时间）
    virtualAxis:({
      pos:number, // 目标位置：这段连续运动停下的位置
      vel:number, // 速度（绝对值）
      accVel:number, // 加速度
      decVel:number, // 减速度
      passVel:number, // 下发时轴应有的速度（绝对值）；0 表示从静止起步（新的一段运动）
    } | null)[] // 虚轴列表，按启用的轴排【v1，v2，v3】；这一刻不用重发的轴为 null
  }[] // 时间块列表，按 time 升序；整条序列都不动的物体为空
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
