import { describe, expect, it } from "vitest";
import {
  matchesLogQuery,
  mockLogAlarmReview,
  mockLogFilterOptions,
  mockLogQuery,
  mockLogWrite,
} from "../electron/main/cSocket/operation-log-mock";
import { mergeRecentLogs, type LogRecord } from "../shared/csocket/operation-log";

const record = (overrides: Partial<LogRecord> & { id: string; timestamp: number }): LogRecord => ({
  category: "operation",
  level: "info",
  message: overrides.id,
  ...overrides,
});

describe("mergeRecentLogs", () => {
  it("dedupes by id, drops debug, sorts and keeps the newest N", () => {
    const current = [record({ id: "a", timestamp: 1 }), record({ id: "b", timestamp: 3 })];
    const incoming = [
      record({ id: "b", timestamp: 3, message: "b2" }),
      record({ id: "c", timestamp: 2 }),
      record({ id: "d", timestamp: 4, category: "system", level: "debug" }),
    ];
    const merged = mergeRecentLogs(current, incoming, 2);
    expect(merged.map((r) => r.id)).toEqual(["c", "b"]);
    expect(merged[1].message).toBe("b2");
  });
});

describe("matchesLogQuery", () => {
  const op = record({
    id: "op",
    timestamp: 100,
    user: "u1",
    opGroup: "device",
    opType: "jog",
    devices: [
      { deviceType: "model", deviceId: 1, deviceName: "m1" },
      { deviceType: "model", deviceId: 2, deviceName: "m2" },
    ],
  });
  const alarm = record({
    id: "al",
    timestamp: 200,
    category: "alarm",
    level: "error",
    alarmLevel: 2,
    devices: [{ deviceType: "axis", deviceId: 1, deviceName: "a1" }],
  });
  const system = record({ id: "sys", timestamp: 300, category: "system", level: "debug" });

  it("scopes users / op groups / op types to operations and alarm levels to alarms", () => {
    const params = { users: ["u2"], opGroups: ["debug" as const], alarmLevels: [3 as const] };
    expect(matchesLogQuery(op, params)).toBe(false);
    expect(matchesLogQuery(alarm, params)).toBe(false);
    expect(matchesLogQuery(system, params)).toBe(true);
    expect(matchesLogQuery(op, { opGroups: ["device"], opTypes: ["jog"] })).toBe(true);
    expect(matchesLogQuery(op, { opGroups: ["debug"], opTypes: ["jog"] })).toBe(false);
  });

  it("matches a multi-device record when any of its devices is wanted", () => {
    const params = { devices: [{ deviceType: "model" as const, deviceId: 2 }] };
    expect(matchesLogQuery(op, params)).toBe(true);
    expect(matchesLogQuery(alarm, params)).toBe(false);
    expect(matchesLogQuery(system, params)).toBe(true);
  });

  it("filters log levels so debug can be hidden", () => {
    expect(matchesLogQuery(system, { logLevels: ["info", "warning", "error"] })).toBe(false);
    expect(matchesLogQuery(op, { startTime: 100, endTime: 100 })).toBe(true);
    expect(matchesLogQuery(op, { startTime: 101 })).toBe(false);
  });
});

describe("operation log mock", () => {
  it("pages newest-first with order desc and reports the full total", () => {
    const page = mockLogQuery({ order: "desc", limit: 5 }).data?.[0];
    const all = mockLogQuery({ limit: 100_000 }).data?.[0];
    expect(page?.total).toBe(all?.total);
    expect(page?.records).toHaveLength(5);
    expect(page?.records[0].id).toBe(all?.records.at(-1)?.id);
  });

  it("has multi-device operations with results and snapshots only on raised alarms", () => {
    const records = mockLogQuery({ limit: 100_000 }).data?.[0].records ?? [];
    expect(records.some((r) => r.category === "operation" && (r.devices?.length ?? 0) > 1)).toBe(true);
    expect(records.filter((r) => r.category === "operation").every((r) => r.result)).toBe(true);
    expect(records.filter((r) => r.snapshotRange).every((r) => r.alarmState === "raised")).toBe(true);
  });

  it("lists filter options with grouped op types", () => {
    const options = mockLogFilterOptions().data?.[0];
    expect(options?.users.length).toBeGreaterThan(0);
    expect(options?.opTypes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ group: "device", code: "jog" }),
        expect.objectContaining({ group: "debug", code: "jog" }),
      ]),
    );
  });

  it("reviews an alarm with 10s before / 5s after of records and snapshot series", () => {
    const records = mockLogQuery({ categories: ["alarm"], limit: 1000 }).data?.[0].records ?? [];
    const alarm = records.find((r) => r.alarmCode === 2102 && r.alarmState === "raised")!;
    const review = mockLogAlarmReview({ alarmId: alarm.id }).data?.[0];
    expect(review?.range).toEqual({ start: alarm.timestamp - 10_000, end: alarm.timestamp + 5_000 });
    expect(review?.records.some((r) => r.category === "operation" && r.timestamp < alarm.timestamp)).toBe(true);
    const series = review?.snapshot[0];
    expect(series?.points).toHaveLength(151);
    expect(series?.points[0]).toEqual(
      expect.objectContaining({ position: expect.any(Number), torque: expect.any(Number), temperature: expect.any(Number) }),
    );
  });

  it("fails the review for unknown or cleared alarms", () => {
    expect(mockLogAlarmReview({ alarmId: "nope" }).success).toBe(false);
    const cleared = (mockLogQuery({ categories: ["alarm"], limit: 1000 }).data?.[0].records ?? []).find(
      (r) => r.alarmState === "cleared",
    )!;
    expect(mockLogAlarmReview({ alarmId: cleared.id }).success).toBe(false);
  });

  it("appends written records with the sender as operator", () => {
    const before = mockLogQuery({ limit: 1 }).data?.[0].total ?? 0;
    const written = mockLogWrite(
      { category: "operation", level: "info", opGroup: "config", opType: "saveProject", message: "保存工程", result: { ok: true } },
      "管理员",
    ).data?.[0];
    expect(written).toEqual(expect.objectContaining({ user: "管理员", opType: "saveProject" }));
    expect(mockLogQuery({ limit: 1 }).data?.[0].total).toBe(before + 1);
  });
});
