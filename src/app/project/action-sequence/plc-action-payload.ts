import type { ActionDataSaveItem, PlcCompiledAction } from "@shared/csocket/action-data-save";

export const toActionDataSaveItems = (
  compiled: PlcCompiledAction,
  actionId: number,
): ActionDataSaveItem[] => [
  {
    actionId,
    totalDuration: compiled.totalDuration,
    timelineCount: compiled.timelines.length,
    timelineList: compiled.timelines.map((timeline) => ({
      modelId: timeline.modelId,
      virtualAxisNo: timeline.virtualAxisNo,
      segmentCount: timeline.segments.length,
      segmentList: timeline.segments,
    })),
    eventCount: compiled.events.length,
    eventList: compiled.events,
  },
];
