import { useEffect, useState } from "react";
import type {
  LogAlarmReview,
  LogFilterOptions,
  LogRecord,
} from "@shared/csocket/operation-log";
import type { CppAckResult } from "@shared/csocket/types";
import { filtersToQuery, type LogFilters, type LogPage } from "./log-filters";

const getCsocketApi = () => (typeof window !== "undefined" ? window.csocketApi : undefined);

const unavailable = () => new Error("C++ 服务不可用");

const unwrapAck = <T>(ack: CppAckResult<T> | undefined, fallback: string): T[] => {
  if (!ack) throw unavailable();
  if (!ack.success) throw new Error(ack.message || fallback);
  return Array.isArray(ack.data) ? ack.data : [];
};

const errorText = (err: unknown, fallback: string) =>
  err instanceof Error && err.message ? err.message : fallback;

export const useLogFilterOptions = (): LogFilterOptions | null => {
  const [options, setOptions] = useState<LogFilterOptions | null>(null);
  useEffect(() => {
    const api = getCsocketApi();
    if (!api?.logFilterOptions) return;
    let cancelled = false;
    api
      .logFilterOptions()
      .then((ack) => {
        if (!cancelled) setOptions(unwrapAck(ack, "读取筛选项失败")[0] ?? null);
      })
      .catch((err) => console.warn("[log] logFilterOptions failed", err));
    return () => {
      cancelled = true;
    };
  }, []);
  return options;
};

export type LogQueryState = {
  status: "loading" | "ready" | "error";
  total: number;
  /** 时间升序 */
  records: LogRecord[];
  error?: string;
};

/**
 * 查一页日志。now 是"最近 15 分钟"等相对时间的基准：改筛选或刷新时才更新，
 * 翻页沿用同一个基准，前后页的时间范围才对得上。
 */
export const useLogQuery = (filters: LogFilters, page: LogPage, now: number): LogQueryState => {
  const [state, setState] = useState<LogQueryState>({ status: "loading", total: 0, records: [] });

  useEffect(() => {
    const api = getCsocketApi();
    if (!api?.logQuery) {
      setState({ status: "error", total: 0, records: [], error: unavailable().message });
      return;
    }
    let cancelled = false;
    setState((prev) => ({ ...prev, status: "loading", error: undefined }));
    api
      .logQuery([filtersToQuery(filters, now, { index: page.index, size: page.size })])
      .then((ack) => {
        if (cancelled) return;
        const page = unwrapAck(ack, "日志查询失败")[0];
        const records = [...(page?.records ?? [])].sort((a, b) => a.timestamp - b.timestamp);
        setState({ status: "ready", total: page?.total ?? records.length, records });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ status: "error", total: 0, records: [], error: errorText(err, "日志查询失败") });
      });
    return () => {
      cancelled = true;
    };
  }, [filters, page.index, page.size, now]);

  return state;
};

export type AlarmReviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; review: LogAlarmReview };

/** 报警回看：报警快照（前 10s + 后 5s 状态曲线）及该时段内的记录 */
export const useAlarmReview = (alarmId: string | null): AlarmReviewState => {
  const [state, setState] = useState<AlarmReviewState>({ status: "idle" });

  useEffect(() => {
    if (!alarmId) {
      setState({ status: "idle" });
      return;
    }
    const api = getCsocketApi();
    if (!api?.logAlarmReview) {
      setState({ status: "error", error: unavailable().message });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    api
      .logAlarmReview([{ alarmId }])
      .then((ack) => {
        if (cancelled) return;
        const review = unwrapAck(ack, "报警回看失败")[0];
        setState(
          review
            ? { status: "ready", review }
            : { status: "error", error: "报警记录不存在" },
        );
      })
      .catch((err) => {
        if (!cancelled) setState({ status: "error", error: errorText(err, "报警回看失败") });
      });
    return () => {
      cancelled = true;
    };
  }, [alarmId]);

  return state;
};
