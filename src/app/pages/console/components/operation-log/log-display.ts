import type {
  AlarmLevel,
  LogCategory,
  LogLevel,
  LogOpGroup,
  LogRecord,
} from "@shared/csocket/operation-log";

export const CATEGORY_LABEL: Record<LogCategory, string> = {
  operation: "操作",
  alarm: "报警",
  system: "系统",
};

export const OP_GROUP_LABEL: Record<LogOpGroup, string> = {
  config: "配置操作",
  device: "设备操作",
  debug: "设备调试",
};

export const LOG_LEVEL_LABEL: Record<LogLevel, string> = {
  debug: "调试",
  info: "信息",
  warning: "警告",
  error: "错误",
};

export const ALARM_LEVEL_LABEL: Record<AlarmLevel, string> = {
  1: "一般",
  2: "严重",
  3: "紧急",
};

export const ALL_CATEGORIES: LogCategory[] = ["operation", "alarm", "system"];

const OP_BADGE_LABEL: Record<LogOpGroup, string> = {
  config: "配置",
  device: "操作",
  debug: "调试",
};

const ALARM_BADGE: Record<AlarmLevel, string> = {
  1: "border-warning/50 text-warning",
  2: "border-destructive/50 text-destructive",
  3: "border-destructive/70 bg-destructive/15 text-destructive font-bold",
};

const SYSTEM_BADGE: Record<LogLevel, string> = {
  debug: "border-border/60 text-muted-foreground/70",
  info: "border-border text-muted-foreground",
  warning: "border-warning/50 text-warning",
  error: "border-destructive/50 text-destructive",
};

export const isRaisedAlarm = (record: LogRecord): boolean =>
  record.category === "alarm" && record.alarmState !== "cleared";

export const isFailedOperation = (record: LogRecord): boolean =>
  record.category === "operation" && record.result?.ok === false;

/** 徽标文字和样式：操作按分组（失败标红），报警按报警级别，系统按日志级别 */
export const logBadge = (record: LogRecord): { label: string; className: string } => {
  switch (record.category) {
    case "alarm":
      if (record.alarmState === "cleared") {
        return { label: "报警·清除", className: "border-show/50 text-show" };
      }
      return {
        label: record.alarmLevel ? `报警·${ALARM_LEVEL_LABEL[record.alarmLevel]}` : "报警",
        className: ALARM_BADGE[record.alarmLevel ?? 2],
      };
    case "operation":
      return {
        label: OP_BADGE_LABEL[record.opGroup ?? "device"],
        className: isFailedOperation(record)
          ? "border-destructive/50 text-destructive"
          : "border-primary/40 text-primary",
      };
    case "system":
      return {
        label: record.level === "warning" || record.level === "error" ? LOG_LEVEL_LABEL[record.level] : "系统",
        className: SYSTEM_BADGE[record.level],
      };
  }
};

/** 操作结果文字；非操作类返回 null */
export const resultText = (record: LogRecord): string | null => {
  if (record.category !== "operation" || !record.result) return null;
  if (record.result.ok) return "成功";
  return record.result.message ? `失败：${record.result.message}` : "失败";
};

export const devicesText = (record: LogRecord): string =>
  record.devices?.length ? record.devices.map((d) => d.deviceName).join("、") : "—";

const pad2 = (value: number) => value.toString().padStart(2, "0");

export const formatClock = (ts: number): string => {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
};

export const formatClockMs = (ts: number): string =>
  `${formatClock(ts)}.${new Date(ts).getMilliseconds().toString().padStart(3, "0")}`;

export const formatDate = (ts: number): string => {
  const d = new Date(ts);
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

export const formatDateTime = (ts: number): string => `${formatDate(ts)} ${formatClock(ts)}`;

/** 相对报警时刻：−4.2s / +1.0s / 0.0s */
export const formatRelativeSeconds = (deltaMs: number): string => {
  const seconds = Math.round(deltaMs / 100) / 10;
  if (seconds === 0) return "0.0s";
  return `${seconds > 0 ? "+" : "−"}${Math.abs(seconds).toFixed(1)}s`;
};

export const formatSpan = (ms: number): string => {
  if (ms < 60_000) return `${Math.round(ms / 100) / 10}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 6_000) / 10}min`;
  return `${Math.round(ms / 360_000) / 10}h`;
};
