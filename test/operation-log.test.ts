import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  queryLogs,
  readFilterOptions,
  reviewAlarm,
  rowToRecord,
  type SqlDatabase,
} from "../electron/main/cSocket/operation-log-db";
import { mockLogWrite } from "../electron/main/cSocket/operation-log-mock";
import { mergeRecentLogs, type LogQueryParams, type LogRecord } from "../shared/csocket/operation-log";

const record = (overrides: Partial<LogRecord> & { id: string; timestamp: number }): LogRecord => ({
  category: "optRet",
  level: "info",
  message: overrides.id,
  ...overrides,
});

describe("mergeRecentLogs", () => {
  it("dedupes by id, drops debug and sent commands (optCall), sorts and keeps the newest N", () => {
    const current = [record({ id: "a", timestamp: 1 }), record({ id: "b", timestamp: 3 })];
    const incoming = [
      record({ id: "b", timestamp: 3, message: "b2" }),
      record({ id: "c", timestamp: 2 }),
      record({ id: "d", timestamp: 4, category: "system", level: "debug" }),
      record({ id: "e", timestamp: 5, category: "optCall" }),
    ];
    const merged = mergeRecentLogs(current, incoming, 2);
    expect(merged.map((r) => r.id)).toEqual(["c", "b"]);
    expect(merged[1].message).toBe("b2");
  });
});

describe("mockLogWrite", () => {
  it("returns the written record with the sender as operator", () => {
    const written = mockLogWrite(
      { category: "optRet", level: "info", opGroup: "config", opType: "saveProject", message: "保存工程", result: 1 },
      "管理员",
    ).data?.[0];
    expect(written).toEqual(expect.objectContaining({ user: "管理员", opType: "saveProject", result: 1 }));
  });
});

/** 与 docs/cpp-operation-log-api.md 里的表结构一致 */
const SCHEMA = `
CREATE TABLE log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          INTEGER NOT NULL,
  category    TEXT    NOT NULL CHECK (category IN ('optCall','optRet','alarm','system')),
  level       TEXT    NOT NULL CHECK (level IN ('debug','info','warning','error')),
  message     TEXT    NOT NULL,
  user_name   TEXT,
  op_group    TEXT    CHECK (op_group IN ('config','device')),
  op_type     TEXT,
  addr        TEXT,
  result_ok   INTEGER CHECK (result_ok IN (0,1,2))
);
CREATE INDEX idx_log_ts ON log(ts);
CREATE TABLE snapshot_sample (
  ts          INTEGER NOT NULL,
  device_id   INTEGER NOT NULL,
  position    REAL,
  speed       REAL,
  torque      REAL,
  temperature REAL,
  PRIMARY KEY (ts, device_id)
) WITHOUT ROWID;
`;

type NodeSqlite = typeof import("node:sqlite");

/** Electron 里用 better-sqlite3（按 Electron 编译，Node 加载不了），单测用 Node 22.13+ 自带的 node:sqlite */
const sqlite = (() => {
  try {
    return createRequire(import.meta.url)("node:sqlite") as NodeSqlite;
  } catch {
    return null;
  }
})();

type Row = [ts: number, category: string, level: string, message: string, user?: string | null, group?: string | null, addr?: string | null, result?: number | null];

const ROWS: Row[] = [
  [500, "optCall", "info", "下发点动", "u1", "device", "0x0104", null],
  [1_000, "optRet", "info", "点动", "u1", "device", "0x0104", 1],
  [2_000, "optRet", "warning", "保存工程：磁盘已满", "u2", "config", null, 0],
  [3_000, "optRet", "warning", "耦合", "u1", "device", "0x0102", 2],
  [12_000, "optRet", "info", "启动", "u2", "device", "0x0103", 1],
  [15_000, "system", "info", "主控已连接"],
  [16_000, "system", "debug", "内部细节"],
  [18_000, "optCall", "info", "下发启动", "u2", "device", "0x0103", null],
  [20_000, "alarm", "error", "电机过载"],
  [40_000, "alarm", "error", "限位触发"],
];

const openDb = (): SqlDatabase => {
  const db = new sqlite!.DatabaseSync(":memory:");
  db.exec(SCHEMA);
  const insert = db.prepare(
    "INSERT INTO log (ts, category, level, message, user_name, op_group, op_type, addr, result_ok) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  for (const [ts, category, level, message, user = null, group = null, addr = null, result = null] of ROWS) {
    insert.run(ts, category, level, message, user, group, group ? "jog" : null, addr, result);
  }
  const sample = db.prepare(
    "INSERT INTO snapshot_sample (ts, device_id, position, speed, torque, temperature) VALUES (?, ?, ?, ?, ?, ?)",
  );
  for (let t = 9_000; t <= 26_000; t += 100) {
    sample.run(t, 3, t / 10, 5, 40, null);
    sample.run(t, 1, t / 100, 2, 30, 42);
  }
  return db as unknown as SqlDatabase;
};

const idOf = (db: SqlDatabase, message: string) =>
  String((db.prepare("SELECT id FROM log WHERE message = ?").get(message) as { id: number }).id);

const messages = (db: SqlDatabase, params: LogQueryParams) =>
  queryLogs(db, params).records.map((r) => r.message);

describe.skipIf(!sqlite)("operation log db", () => {
  it("never returns sent commands (optCall) and pages newest-first with an exact total", () => {
    const db = openDb();
    const all = queryLogs(db, {});
    expect(all.total).toBe(8);
    expect(all.records.some((r) => r.category === "optCall")).toBe(false);
    expect(all.records.map((r) => r.timestamp)).toEqual([...all.records.map((r) => r.timestamp)].sort((a, b) => a - b));

    const page = queryLogs(db, { order: "desc", offset: 2, limit: 3 });
    expect(page.total).toBe(8);
    expect(page.records.map((r) => r.message)).toEqual(["内部细节", "主控已连接", "启动"]);
    expect(queryLogs(db, { order: "desc", offset: 50, limit: 50 })).toEqual({ total: 8, records: [] });
  });

  it("maps a row to a record without the stored-only op type and addr, dropping empty columns", () => {
    const db = openDb();
    const saved = queryLogs(db, { categories: ["optRet"] }).records.find((r) => r.timestamp === 2_000);
    expect(saved).toEqual({
      id: idOf(db, "保存工程：磁盘已满"),
      timestamp: 2_000,
      category: "optRet",
      level: "warning",
      message: "保存工程：磁盘已满",
      user: "u2",
      opGroup: "config",
      result: 0,
    });
    const alarm = rowToRecord({
      id: 9, ts: 1, category: "alarm", level: "error", message: "x",
      user_name: null, op_group: null, result_ok: null,
    });
    expect(alarm).toEqual({ id: "9", timestamp: 1, category: "alarm", level: "error", message: "x" });
  });

  it("scopes users to op returns only", () => {
    const db = openDb();
    expect(messages(db, { users: ["u2"], logLevels: ["info", "warning", "error"] })).toEqual([
      "保存工程：磁盘已满",
      "启动",
      "主控已连接",
      "电机过载",
      "限位触发",
    ]);
  });

  it("filters categories, log levels and an inclusive time range", () => {
    const db = openDb();
    expect(messages(db, { categories: ["alarm"] })).toEqual(["电机过载", "限位触发"]);
    expect(messages(db, { categories: ["optCall" as never] })).toEqual([]);
    expect(messages(db, { categories: ["system"], logLevels: ["info", "warning", "error"] })).toEqual(["主控已连接"]);
    expect(messages(db, { startTime: 2_000, endTime: 12_000 })).toEqual(["保存工程：磁盘已满", "耦合", "启动"]);
  });

  it("lists users seen in op returns and the visible time range", () => {
    const options = readFilterOptions(openDb());
    expect(options).toEqual({ users: ["u1", "u2"], timeRange: { start: 1_000, end: 40_000 } });
  });

  it("has no time range when the log is empty", () => {
    const db = new sqlite!.DatabaseSync(":memory:");
    db.exec(SCHEMA);
    expect(readFilterOptions(db as unknown as SqlDatabase)).toEqual({ users: [], timeRange: null });
  });

  it("reviews an alarm with 10s before / 5s after of records and motor samples", () => {
    const db = openDb();
    const review = reviewAlarm(db, idOf(db, "电机过载"))!;
    expect(review.alarm.message).toBe("电机过载");
    expect(review.records.map((r) => r.message)).toEqual(["启动", "主控已连接", "内部细节", "电机过载"]);
    expect(review.snapshot.map((s) => s.deviceId)).toEqual([1, 3]);
    const motor3 = review.snapshot[1];
    expect(motor3.points).toHaveLength(151);
    expect(motor3.points[0]).toEqual({ t: 10_000, position: 1_000, speed: 5, torque: 40 });
    expect(motor3.points.at(-1)?.t).toBe(25_000);
    expect(review.snapshot[0].points[0]).toEqual({ t: 10_000, position: 100, speed: 2, torque: 30, temperature: 42 });
  });

  it("returns an empty snapshot when nothing was sampled, and null for non-alarms", () => {
    const db = openDb();
    expect(reviewAlarm(db, idOf(db, "限位触发"))?.snapshot).toEqual([]);
    expect(reviewAlarm(db, idOf(db, "点动"))).toBeNull();
    expect(reviewAlarm(db, "999")).toBeNull();
    expect(reviewAlarm(db, "log-w-0001")).toBeNull();
  });
});
