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

export type PlcCompiledEvent = {
  modelId: number
  atTime: number
  enableFlag: 0 | 1
}

export type PlcCompiledAction = {
  totalDuration: number
  timelines: PlcCompiledTimeline[]
  events: PlcCompiledEvent[]
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
  }>
  eventCount: number
  eventList: PlcCompiledEvent[]
}
