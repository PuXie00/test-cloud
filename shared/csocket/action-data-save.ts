import type { TrajectoryMode } from '../action-sequence'

export type PlcCompiledTimeline = {
  modelNo: number
  virtualAxisType: number
  timeArray: number[]
  positionArray: number[]
}

export type PlcCompiledEvent = {
  modelNo: number
  atMs: number
  kind: 'set-enabled'
  enabled: boolean
}

export type PlcCompiledAction = {
  checksum: number
  trajectoryMode: TrajectoryMode
  totalDuration: number
  timelines: PlcCompiledTimeline[]
  events: PlcCompiledEvent[]
}

export type ActionDataSaveItem = {
  checksum: number
  trajectoryMode: TrajectoryMode
  totalDuration: number
  timelineCount: number
  timelineList: Array<{
    modelNo: number
    virtualAxisType: number
    pointCount: number
    timeArray: number[]
    positionArray: number[]
  }>
  eventCount: number
  eventList: PlcCompiledEvent[]
}
