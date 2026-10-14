import {
  VISIBLE_LOG_LEVELS,
  type AlarmLevel,
  type LogCategory,
  type LogDeviceRef,
  type LogDeviceType,
  type LogLevel,
  type LogOpGroup,
  type LogQueryParams,
} from "@shared/csocket/operation-log";
import { ALL_CATEGORIES } from "./log-display";

export type TimePreset = "all" | "15m" | "1h" | "today" | "custom";

export type LogFilters = {
  timePreset: TimePreset;
  /** datetime-local 输入值，仅 custom 生效 */
  customStart: string;
  customEnd: string;
  categories: LogCategory[];
  /** 空串 = 全部 */
  user: string;
  /** deviceKey，空串 = 全部 */
  device: string;
  /** 空串 = 全部；"device" = 整个分组；"device:jog" = 分组内某个操作类型 */
  opType: string;
  alarmLevel: "" | `${AlarmLevel}`;
  /** 空串 = 默认（不含调试）；all = 含调试的全部 */
  logLevel: "" | LogLevel | "all";
};

export const TIME_PRESET_OPTIONS: { value: TimePreset; label: string }[] = [
  { value: "all", label: "全部时间" },
  { value: "15m", label: "最近 15 分钟" },
  { value: "1h", label: "最近 1 小时" },
  { value: "today", label: "今天" },
  { value: "custom", label: "自定义" },
];

/** 单次最多加载条数；超出提示缩小范围 */
export const QUERY_LIMIT = 2000;

export const DEFAULT_LOG_FILTERS: LogFilters = {
  timePreset: "all",
  customStart: "",
  customEnd: "",
  categories: ALL_CATEGORIES,
  user: "",
  device: "",
  opType: "",
  alarmLevel: "",
  logLevel: "",
};

const DEVICE_TYPES = new Set<LogDeviceType>(["plc", "axis", "model"]);
const OP_GROUPS = new Set<LogOpGroup>(["config", "device", "debug"]);

export const opTypeKey = (group: LogOpGroup, code: string): string => `${group}:${code}`;

export const parseOpTypeFilter = (value: string): { group: LogOpGroup; code?: string } | null => {
  const [group, code] = value.split(":");
  if (!OP_GROUPS.has(group as LogOpGroup)) return null;
  return code ? { group: group as LogOpGroup, code } : { group: group as LogOpGroup };
};

/** 日志级别筛选是否显示 debug */
export const includesDebug = (filters: LogFilters): boolean =>
  filters.logLevel === "debug" || filters.logLevel === "all";

const toLogLevels = (logLevel: LogFilters["logLevel"]): LogLevel[] | undefined => {
  if (logLevel === "all") return undefined;
  if (logLevel === "") return VISIBLE_LOG_LEVELS;
  return [logLevel];
};

export const parseDeviceKey = (key: string): LogDeviceRef | null => {
  const [type, id] = key.split(":");
  const deviceId = Number(id);
  if (!DEVICE_TYPES.has(type as LogDeviceType) || !Number.isFinite(deviceId)) return null;
  return { deviceType: type as LogDeviceType, deviceId };
};

/** datetime-local 值按本地时间解析 */
export const parseLocalDateTime = (value: string): number | undefined => {
  if (!value) return undefined;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : undefined;
};

export const resolveTimeRange = (
  filters: LogFilters,
  now: number,
): { startTime?: number; endTime?: number } => {
  switch (filters.timePreset) {
    case "15m":
      return { startTime: now - 15 * 60_000, endTime: now };
    case "1h":
      return { startTime: now - 3_600_000, endTime: now };
    case "today": {
      const midnight = new Date(now);
      midnight.setHours(0, 0, 0, 0);
      return { startTime: midnight.getTime(), endTime: now };
    }
    case "custom":
      return {
        startTime: parseLocalDateTime(filters.customStart),
        endTime: parseLocalDateTime(filters.customEnd),
      };
    default:
      return {};
  }
};

/** 取最新的 QUERY_LIMIT 条；空维度不下发，日志级别默认不含 debug */
export const filtersToQuery = (filters: LogFilters, now: number): LogQueryParams => {
  const { startTime, endTime } = resolveTimeRange(filters, now);
  const device = filters.device ? parseDeviceKey(filters.device) : null;
  const opType = filters.opType ? parseOpTypeFilter(filters.opType) : null;
  const logLevels = toLogLevels(filters.logLevel);
  return {
    ...(startTime != null ? { startTime } : {}),
    ...(endTime != null ? { endTime } : {}),
    ...(filters.categories.length < ALL_CATEGORIES.length
      ? { categories: filters.categories }
      : {}),
    ...(filters.user ? { users: [filters.user] } : {}),
    ...(device ? { devices: [device] } : {}),
    ...(opType ? { opGroups: [opType.group] } : {}),
    ...(opType?.code ? { opTypes: [opType.code] } : {}),
    ...(filters.alarmLevel ? { alarmLevels: [Number(filters.alarmLevel) as AlarmLevel] } : {}),
    ...(logLevels ? { logLevels } : {}),
    order: "desc",
    offset: 0,
    limit: QUERY_LIMIT,
  };
};

export const isDefaultFilters = (filters: LogFilters): boolean =>
  filters.timePreset === "all" &&
  filters.categories.length === ALL_CATEGORIES.length &&
  !filters.user &&
  !filters.device &&
  !filters.opType &&
  !filters.alarmLevel &&
  !filters.logLevel;
