import type { ActionDataSaveItem, PlcCompiledAction } from "@shared/csocket/action-data-save";

export const toActionDataSaveItems = (
  compiled: PlcCompiledAction,
  actionNo: number,
): ActionDataSaveItem[] => [
  {
    actionNo,
    checksum: compiled.checksum,
    trajectoryMode: compiled.trajectoryMode,
    totalDuration: compiled.totalDuration,
    timelineCount: compiled.timelines.length,
    timelineList: compiled.timelines.map((timeline) => ({
      modelNo: timeline.modelNo,
      virtualAxisType: timeline.virtualAxisType,
      pointCount: timeline.timeArray.length,
      timeArray: timeline.timeArray,
      positionArray: timeline.positionArray,
    })),
    eventCount: compiled.events.length,
    eventList: compiled.events,
  },
];
