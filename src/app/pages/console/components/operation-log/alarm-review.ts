import {
  alarmSnapshotWindow,
  deviceKey,
  type LogAlarmReview,
  type LogRecord,
} from "@shared/csocket/operation-log";
import type { TimeRange } from "./timeline-scale";

/** 趋势图最多同时画几台设备（与图表配色数一致） */
export const MAX_TREND_DEVICES = 3;

/** 报警快照时间段：固定为报警前 10s、后 5s */
export const alarmReviewWindow = (alarm: Pick<LogRecord, "timestamp">): TimeRange =>
  alarmSnapshotWindow(alarm.timestamp);

/** 默认画哪些电机：快照里 id 最小的几台（快照只有电机 id，不知道哪台报警） */
export const pickTrendDevices = (review: LogAlarmReview): string[] =>
  [...review.snapshot]
    .sort((a, b) => a.deviceId - b.deviceId)
    .slice(0, MAX_TREND_DEVICES)
    .map(deviceKey);
