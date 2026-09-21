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
export type cCompiledModel = {
  deviceId:number, // 物体id
  timeBlockList:{
    time:number,
    virtualAxis:{
      pos:number, // 虚轴值
      vel:number, // 速度
      accVel:number, // 加速度
      decVel:number, // 减速度
    }[] // 虚轴列表，【v1，v2，v3】
  }[] // 时间块列表，如：[ { time:0, virtualAxis:[ { pos:0, vel:0, accVel:0, decVel:0 } ] } ]
}

export type ActionDataSaveItem = {
  actionId: number
  totalDuration: number
  timelineCount: number
  timelineList: Array<{
    modelId: number
    virtualAxisNo: number
    segmentCount: number
    segmentList: PlcCurveSegment[]
  }>//plc需要的
  modelList:cCompiledModel[] // C++ 需要的
  IOBlockList: cCompiledEvent[]
}
