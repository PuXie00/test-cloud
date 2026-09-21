import type { TrajectoryMode } from "@shared/action-sequence";
import type { ActionDataSaveItem, PlcCompiledAction } from "@shared/csocket/action-data-save";

export const toActionDataSaveItems = (
  compiled: PlcCompiledAction,
  actionId: number,
  trajectoryMode: TrajectoryMode,
): ActionDataSaveItem[] => [
  {
    actionId,
    totalDuration: compiled.totalDuration,
    trajectoryMode,
    timelineCount: compiled.timelines.length,
    timelineList: compiled.timelines.map((timeline) => ({
      modelId: timeline.modelId,
      virtualAxisNo: timeline.virtualAxisNo,
      segmentCount: timeline.segments.length,
      segmentList: timeline.segments,
    })),
    modelList: compiled.models,
    IOBlockList: compiled.ioBlocks,
  },
];
