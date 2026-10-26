import {
  VISIBLE_LOG_LEVELS,
  type LogLevel,
  type LogQueryParams,
  type VisibleLogCategory,
} from "@shared/csocket/operation-log";
import { ALL_CATEGORIES } from "./log-display";

export type TimePreset = "all" | "15m" | "1h" | "today" | "custom";

export type LogFilters = {
  timePreset: TimePreset;
  /** datetime-local 输入值，仅 custom 生效 */
  customStart: string;
  customEnd: string;
  categories: VisibleLogCategory[];
  /** 空串 = 全部 */
  user: string;
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

/** 每页条数可选值，默认 50；最大 500，再多拖动时间线会卡 */
export const PAGE_SIZE_OPTIONS = [50, 100, 500] as const;
export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];
export const DEFAULT_PAGE_SIZE: PageSize = 50;

/** 第 index 页（从 0 开始），最新的在第一页 */
export type LogPage = { index: number; size: number };

export const pageCount = (total: number, size: number): number =>
  Math.max(1, Math.ceil(total / size));

export const parsePageSize = (raw: unknown): PageSize => {
  const size = Number(raw);
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(size)
    ? (size as PageSize)
    : DEFAULT_PAGE_SIZE;
};

const PAGE_SIZE_STORAGE_KEY = "yz.operationLog.pageSize";

/** 每页条数只记在本机浏览器里，读写失败（如禁用存储）时用默认值 */
export const readStoredPageSize = (): PageSize => {
  try {
    return parsePageSize(window.localStorage.getItem(PAGE_SIZE_STORAGE_KEY));
  } catch {
    return DEFAULT_PAGE_SIZE;
  }
};

export const writeStoredPageSize = (size: PageSize): void => {
  try {
    window.localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(size));
  } catch {
    // 存不了只是下次回到默认值
  }
};

export const DEFAULT_LOG_FILTERS: LogFilters = {
  timePreset: "all",
  customStart: "",
  customEnd: "",
  categories: ALL_CATEGORIES,
  user: "",
  logLevel: "",
};

/** 日志级别筛选是否显示 debug */
export const includesDebug = (filters: LogFilters): boolean =>
  filters.logLevel === "debug" || filters.logLevel === "all";

const toLogLevels = (logLevel: LogFilters["logLevel"]): LogLevel[] | undefined => {
  if (logLevel === "all") return undefined;
  if (logLevel === "") return VISIBLE_LOG_LEVELS;
  return [logLevel];
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

/** 按页取，最新的在前；空维度不下发，日志级别默认不含 debug */
export const filtersToQuery = (
  filters: LogFilters,
  now: number,
  page: LogPage = { index: 0, size: DEFAULT_PAGE_SIZE },
): LogQueryParams => {
  const { startTime, endTime } = resolveTimeRange(filters, now);
  const logLevels = toLogLevels(filters.logLevel);
  return {
    ...(startTime != null ? { startTime } : {}),
    ...(endTime != null ? { endTime } : {}),
    ...(filters.categories.length < ALL_CATEGORIES.length
      ? { categories: filters.categories }
      : {}),
    ...(filters.user ? { users: [filters.user] } : {}),
    ...(logLevels ? { logLevels } : {}),
    order: "desc",
    offset: Math.max(0, page.index) * page.size,
    limit: page.size,
  };
};

export const isDefaultFilters = (filters: LogFilters): boolean =>
  filters.timePreset === "all" &&
  filters.categories.length === ALL_CATEGORIES.length &&
  !filters.user &&
  !filters.logLevel;
