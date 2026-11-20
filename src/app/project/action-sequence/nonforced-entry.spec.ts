import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pythonRound, pythonRoundInt, pythonSum } from "./algorithm-params";
import { calculateNonforcedEntry, NONFORCED_ALGORITHM_VERSION } from "./nonforced-entry";

/**
 * 与 python/非强制就近接入.py 逐条对数。期望值由 python/非强制就近接入-对数.py 生成：
 * 改了 Python 就重跑那个脚本，再跑本文件。
 */
type FixtureCase = {
  name: string;
  note: string;
  command: unknown;
  settings: unknown;
  runtime: unknown;
  models: string;
  expected: unknown;
};

const fixture = JSON.parse(
  readFileSync(path.resolve(__dirname, "nonforced-entry.fixtures.json"), "utf-8"),
) as { algorithm_version: string; models: Record<string, unknown>; cases: FixtureCase[] };

/** JSON 往返：-0 记成 0，与 Python 侧 json 的比较口径一致 */
const normalized = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

describe("calculateNonforcedEntry 与 Python 逐条对数", () => {
  it("用的是同一版算法", () => {
    expect(NONFORCED_ALGORITHM_VERSION).toBe(fixture.algorithm_version);
  });

  it.each(fixture.cases.map((item) => [item.name, item] as const))("%s", (_name, item) => {
    const result = calculateNonforcedEntry({
      command: item.command,
      settings: item.settings,
      runtime: item.runtime,
      models: fixture.models[item.models],
    });
    expect(normalized(result)).toEqual(normalized(item.expected));
  });
});

describe("Python 数值规则", () => {
  it("round(x, n) 按精确十进制舍入、一半取偶", () => {
    const cases: [number, number, number][] = [
      [0.0625, 3, 0.062],
      [2.675, 2, 2.67],
      [-0.0005, 3, -0.001],
      [1234.5675, 3, 1234.568],
      [0.125, 2, 0.12],
      [4912.000000000001, 6, 4912],
      [1e-20, 3, 0],
      [7600.0005, 3, 7600.001],
      [16000.99950000001, 3, 16001],
    ];
    for (const [value, digits, expected] of cases) expect(pythonRound(value, digits)).toBe(expected);
    expect(Object.is(pythonRound(-2.5e-7, 6), -0)).toBe(true);
  });

  it("round(x) 一半取偶", () => {
    expect([0.5, 1.5, 2.5, -0.5, -1.5, 2.4999999999999996, 3.5000000000000004].map(pythonRoundInt)).toEqual([
      0, 2, 2, 0, -2, 2, 4,
    ]);
  });

  it("sum() 用 Neumaier 补偿求和（Python 3.12）", () => {
    expect(pythonSum(Array.from({ length: 10 }, () => 0.1))).toBe(1);
    expect(pythonSum([1e16, 1, -1e16])).toBe(1);
    expect(pythonSum([0.3, 0.6, 0.1])).toBe(1);
    expect(pythonSum([])).toBe(0);
  });
});

/** XY 多点摆两个吊点（2026-11-19 版算法）：期望值由 python/非强制就近算法/非强制就近接入.py 的双吊点分支计算 */
describe("calculateNonforcedEntry with a two-point XY model", () => {
  const runWithXyPoints = (caseName: string, points: Array<[number, number]>) => {
    const item = fixture.cases.find((entry) => entry.name === caseName)!;
    const models = structuredClone(fixture.models[item.models]) as Array<Record<string, unknown>>;
    for (const model of models) {
      if (model.model_type !== 9) continue;
      model.point_init_pos = points;
      model.motor_num = points.length;
    }
    return calculateNonforcedEntry({ command: item.command, settings: item.settings, runtime: item.runtime, models }) as {
      status: string;
      message: string;
      selected_curve_time_ms?: number;
      entry_lead_ms?: number;
      verification?: { passed: boolean };
    };
  };

  it("plans with two hoist points on the X axis or the Y axis", () => {
    for (const points of [
      [[-400, 0], [400, 0]],
      [[0, -500], [0, 300]],
    ] as Array<Array<[number, number]>>) {
      for (const [caseName, lead] of [
        ["stop-mid-fwd-3000", 2602.105],
        ["stop-fixture-fwd-none", 1154.701],
      ] as const) {
        const result = runWithXyPoints(caseName, points);
        expect(result.status).toBe("planned");
        expect(result.selected_curve_time_ms).toBe(0);
        expect(result.entry_lead_ms).toBe(lead);
        expect(result.verification?.passed).toBe(true);
      }
    }
  });

  it("rejects two hoist points that are off the axes", () => {
    const result = runWithXyPoints("stop-mid-fwd-3000", [
      [-400, 100],
      [400, 100],
    ]);
    expect(result.status).toBe("invalid_input");
    expect(result.message).toContain("XY双吊点须位于同一X轴或Y轴");
  });
});
