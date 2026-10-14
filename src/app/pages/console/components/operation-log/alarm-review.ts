import {
  ALARM_SNAPSHOT_AFTER_MS,
  ALARM_SNAPSHOT_BEFORE_MS,
  deviceKey,
  type LogAlarmReview,
  type LogRecord,
} from "@shared/csocket/operation-log";
import type { TimeRange } from "./timeline-scale";

/** 趋势图最多同时画几台设备（与图表配色数一致） */
export const MAX_TREND_DEVICES = 3;

/** 报警快照时间段；C++ 没给时按前 10s 后 5s 兜底 */
export const alarmReviewWindow = (
  alarm: Pick<LogRecord, "timestamp" | "snapshotRange">,
): TimeRange =>
  alarm.snapshotRange ?? {
    start: alarm.timestamp - ALARM_SNAPSHOT_BEFORE_MS,
    end: alarm.timestamp + ALARM_SNAPSHOT_AFTER_MS,
  };

/** 默认画哪些设备：报警设备优先，其次是报警前操作过的设备（最近的先），只取快照里有的 */
export const pickTrendDevices = (review: LogAlarmReview): string[] => {
  const available = new Set(review.snapshot.map(deviceKey));
  const picked: string[] = [];
  const add = (record: LogRecord) => {
    for (const device of record.devices ?? []) {
      const key = deviceKey(device);
      if (picked.length < MAX_TREND_DEVICES && available.has(key) && !picked.includes(key)) {
        picked.push(key);
      }
    }
  };
  add(review.alarm);
  for (const record of review.records) {
    if (record.category === "alarm" && record.alarmState !== "cleared") add(record);
  }
  review.records
    .filter((r) => r.category === "operation" && r.timestamp <= review.alarm.timestamp)
    .reverse()
    .forEach(add);
  if (picked.length === 0 && review.snapshot[0]) picked.push(deviceKey(review.snapshot[0]));
  return picked;
};
