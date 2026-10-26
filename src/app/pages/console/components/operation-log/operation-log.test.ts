import { describe, expect, it } from "vitest";
import type { LogAlarmReview, LogRecord } from "@shared/csocket/operation-log";
import { alarmReviewWindow, pickTrendDevices } from "./alarm-review";
import {
  DEFAULT_LOG_FILTERS,
  DEFAULT_PAGE_SIZE,
  filtersToQuery,
  pageCount,
  parsePageSize,
} from "./log-filters";
import { formatRelativeSeconds, logBadge, resultText } from "./log-display";
import { markerVisual } from "./log-timeline";
import { sampleAt } from "./snapshot-table";
import {
  buildTicks,
  ensureVisible,
  fitView,
  MIN_VIEW_SPAN_MS,
  pickTickStep,
  zoomView,
} from "./timeline-scale";

const record = (overrides: Partial<LogRecord> & { id: string; timestamp: number }): LogRecord => ({
  category: "optRet",
  level: "info",
  message: overrides.id,
  ...overrides,
});

describe("timeline scale", () => {
  it("zooms around the anchor and clamps the span", () => {
    const zoomed = zoomView({ start: 0, end: 10_000 }, 0.5, 2_000);
    expect(zoomed).toEqual({ start: 1_000, end: 6_000 });
    const tight = zoomView({ start: 0, end: 2_000 }, 0.01, 1_000);
    expect(tight.end - tight.start).toBe(MIN_VIEW_SPAN_MS);
    const wide = zoomView({ start: 0, end: 10_000 }, 10, 5_000, 20_000);
    expect(wide).toEqual({ start: -5_000, end: 15_000 });
  });

  it("fits with padding and widens a single point", () => {
    expect(fitView({ start: 0, end: 100_000 })).toEqual({ start: -3_000, end: 103_000 });
    const single = fitView({ start: 50_000, end: 50_000 });
    expect(single.end - single.start).toBe(30_000);
    expect((single.start + single.end) / 2).toBe(50_000);
  });

  it("re-centres only when the time is off screen", () => {
    const view = { start: 0, end: 1_000 };
    expect(ensureVisible(view, 500)).toBe(view);
    expect(ensureVisible(view, 5_000)).toEqual({ start: 4_500, end: 5_500 });
  });

  it("picks a tick step that fits and aligns ticks to it", () => {
    expect(pickTickStep(60_000, 8)).toBe(10_000);
    const ticks = buildTicks({ start: 1_234, end: 31_000 }, 10_000);
    expect(ticks).toHaveLength(3);
    expect(ticks.every((t) => (t - ticks[0]) % 10_000 === 0)).toBe(true);
    expect(ticks[0]).toBeGreaterThanOrEqual(1_234);
  });
});

describe("filtersToQuery", () => {
  it("sends the newest page of 50 without debug by default", () => {
    expect(filtersToQuery(DEFAULT_LOG_FILTERS, 1_000)).toEqual({
      logLevels: ["info", "warning", "error"],
      order: "desc",
      offset: 0,
      limit: 50,
    });
    expect(filtersToQuery({ ...DEFAULT_LOG_FILTERS, logLevel: "all" }, 1_000).logLevels).toBeUndefined();
  });

  it("maps each dimension to its query field", () => {
    const query = filtersToQuery(
      {
        ...DEFAULT_LOG_FILTERS,
        timePreset: "15m",
        categories: ["alarm"],
        user: "管理员",
        logLevel: "error",
      },
      1_000_000,
    );
    expect(query).toMatchObject({
      startTime: 1_000_000 - 15 * 60_000,
      endTime: 1_000_000,
      categories: ["alarm"],
      users: ["管理员"],
      logLevels: ["error"],
    });
    expect(query).not.toHaveProperty("opGroups");
    expect(query).not.toHaveProperty("opTypes");
  });
});

describe("op call results", () => {
  it("shows success, failure and timeout", () => {
    expect(resultText(record({ id: "ok", timestamp: 0, result: 1 }))).toBe("成功");
    expect(resultText(record({ id: "fail", timestamp: 0, result: 0 }))).toBe("失败");
    expect(resultText(record({ id: "late", timestamp: 0, result: 2 }))).toBe("超时");
    expect(resultText(record({ id: "none", timestamp: 0 }))).toBeNull();
    expect(resultText(record({ id: "sys", timestamp: 0, category: "system", result: 1 }))).toBeNull();
  });

  it("labels the badge by category only, whatever the group or level", () => {
    const labels = [
      record({ id: "c", timestamp: 0, opGroup: "config" }),
      record({ id: "d", timestamp: 0, opGroup: "device", result: 0 }),
      record({ id: "a", timestamp: 0, category: "alarm", level: "error" }),
      record({ id: "s", timestamp: 0, category: "system", level: "info" }),
      record({ id: "w", timestamp: 0, category: "system", level: "warning" }),
      record({ id: "e", timestamp: 0, category: "system", level: "error" }),
    ].map((r) => logBadge(r).label);
    expect(labels).toEqual(["操作", "操作", "报警", "系统", "系统", "系统"]);
  });

  it("colours the badge by log level only", () => {
    const optRet = (level: LogRecord["level"]) => logBadge(record({ id: level, timestamp: 0, level, result: 0 }));
    expect(optRet("info").className).toContain("text-muted-foreground");
    expect(optRet("warning").className).toContain("text-warning");
    expect(optRet("error").className).toContain("text-destructive");
    expect(logBadge(record({ id: "w", timestamp: 0, category: "system", level: "warning" })).className).toBe(
      optRet("warning").className,
    );
  });
});

describe("timeline markers", () => {
  it("colour by log level only, like the category badge", () => {
    const failed = record({ id: "f", timestamp: 0, level: "info", result: 0 });
    expect(markerVisual(failed)).toContain("bg-muted-foreground");
    expect(markerVisual(failed)).not.toContain("bg-destructive");
    expect(markerVisual(record({ id: "w", timestamp: 0, level: "warning" }))).toContain("bg-warning");
    expect(markerVisual(record({ id: "a", timestamp: 0, category: "alarm", level: "error" }))).toContain("bg-destructive");
    expect(markerVisual(record({ id: "s", timestamp: 0, category: "system", level: "warning" }))).toContain("bg-warning");
  });
});

describe("alarm review helpers", () => {
  it("always reviews 10s before and 5s after the alarm", () => {
    expect(alarmReviewWindow({ timestamp: 20_000 })).toEqual({ start: 10_000, end: 25_000 });
  });

  it("draws the motors with the lowest ids by default", () => {
    const alarm = record({ id: "a", timestamp: 10_000, category: "alarm", level: "error" });
    const series = (deviceId: number) => ({ deviceId, points: [] });
    const review: LogAlarmReview = {
      alarm,
      records: [alarm],
      snapshot: [series(9), series(2), series(7), series(4)],
    };
    expect(pickTrendDevices(review)).toEqual(["2", "4", "7"]);
    expect(pickTrendDevices({ ...review, snapshot: [] })).toEqual([]);
  });

  it("samples the latest point at or before a time", () => {
    const points = [{ t: 0, torque: 1 }, { t: 100, torque: 2 }, { t: 200, torque: 3 }];
    expect(sampleAt(points, -50)?.torque).toBe(1);
    expect(sampleAt(points, 150)?.torque).toBe(2);
    expect(sampleAt(points, 200)?.torque).toBe(3);
    expect(sampleAt([], 0)).toBeNull();
  });

  it("formats offsets relative to the alarm", () => {
    expect(formatRelativeSeconds(-4_230)).toBe("−4.2s");
    expect(formatRelativeSeconds(1_000)).toBe("+1.0s");
    expect(formatRelativeSeconds(20)).toBe("0.0s");
  });
});

describe("paging", () => {
  it("turns a page into offset and limit, newest first", () => {
    expect(filtersToQuery(DEFAULT_LOG_FILTERS, 0, { index: 2, size: 100 })).toMatchObject({
      order: "desc",
      offset: 200,
      limit: 100,
    });
  });

  it("counts pages and always has at least one", () => {
    expect(pageCount(0, 50)).toBe(1);
    expect(pageCount(50, 50)).toBe(1);
    expect(pageCount(51, 50)).toBe(2);
    expect(pageCount(1234, 500)).toBe(3);
  });

  it("only accepts 50 / 100 / 500 as a page size", () => {
    expect(DEFAULT_PAGE_SIZE).toBe(50);
    expect(parsePageSize("100")).toBe(100);
    expect(parsePageSize(500)).toBe(500);
    expect(parsePageSize("1000")).toBe(50);
    expect(parsePageSize(null)).toBe(50);
    expect(parsePageSize("abc")).toBe(50);
  });
});
