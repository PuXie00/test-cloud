import {
  LOG_RESULT,
  VISIBLE_LOG_CATEGORIES,
  type LogCategory,
  type LogLevel,
  type LogOpGroup,
  type LogRecord,
  type VisibleLogCategory,
} from "@shared/csocket/operation-log";

/** operation 只存库不显示；界面上的「操作」是操作回码 */
export const CATEGORY_LABEL: Record<LogCategory, string> = {
  operation: "操作记录",
  optCall: "操作",
  alarm: "报警",
  system: "系统",
};

export const OP_GROUP_LABEL: Record<LogOpGroup, string> = {
  config: "配置操作",
  device: "设备操作",
};

export const LOG_LEVEL_LABEL: Record<LogLevel, string> = {
  debug: "调试",
  info: "信息",
  warning: "警告",
  error: "错误",
};

export const ALL_CATEGORIES: VisibleLogCategory[] = VISIBLE_LOG_CATEGORIES;

/** 类别徽标的颜色只看日志级别 */
const LEVEL_BADGE: Record<LogLevel, string> = {
  debug: "border-border/60 text-muted-foreground/70",
  info: "border-border text-muted-foreground",
  warning: "border-warning/50 text-warning",
  error: "border-destructive/50 text-destructive",
};

/** 时间线标记的颜色，与类别徽标一样只看日志级别 */
export const LEVEL_MARKER: Record<LogLevel, string> = {
  debug: "bg-muted-foreground/50",
  info: "bg-muted-foreground",
  warning: "bg-warning",
  error: "bg-destructive",
};

export const isAlarm = (record: LogRecord): boolean => record.category === "alarm";

/** 徽标：文字按类别（操作 / 报警 / 系统），颜色按日志级别 */
export const logBadge = (record: LogRecord): { label: string; className: string } => ({
  label: CATEGORY_LABEL[record.category],
  className: LEVEL_BADGE[record.level],
});

const RESULT_TEXT: Record<number, string> = {
  [LOG_RESULT.failed]: "失败",
  [LOG_RESULT.ok]: "成功",
  [LOG_RESULT.timeout]: "超时",
};

/** 操作结果文字；非操作回码或没有结果返回 null */
export const resultText = (record: LogRecord): string | null => {
  if (record.category !== "optCall" || record.result == null) return null;
  return RESULT_TEXT[record.result] ?? null;
};

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
