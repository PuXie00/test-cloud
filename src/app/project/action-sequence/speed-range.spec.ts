import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { RangeParameters } from "./algorithm-params";
import { fsum, nextDown, nextUp, SpeedInterval } from "./speed-interval";
import { calculateRangeResult, findUnitIntervalRoots } from "./speed-range";

/** 期望值由 python/调速范围计算/调速范围计算.py 对同一份 算法参数.json 计算得到。 */
const example = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../../../python/调速范围计算/算法参数.json"), "utf-8").replace(
    /^﻿/,
    "",
  ),
) as RangeParameters;

const range = (trajectoryRun: boolean, edit?: (parameters: RangeParameters) => void) => {
  const parameters = structuredClone(example);
  parameters.command.trajectory_run = trajectoryRun;
  edit?.(parameters);
  return calculateRangeResult(parameters);
};

describe("calculateRangeResult", () => {
  it("takes the smallest motor-limit ratio of every model", () => {
    expect(range(true)).toEqual({
      max_factor: 3.804880930591192,
      unlimited: false,
      action_category: "强制轨迹：按原始曲线计算",
      range_version: "shared_json_v1",
    });
    expect(range(false)).toMatchObject({
      max_factor: 3.804880930591192,
      action_category: "同步非单点：可升速、可降速",
    });
  });

  it.each([
    [0, 5],
    [1, 3.804880930591192],
    [2, 3.804881005317467],
    [3, 4.045722432090806],
  ])("bounds the motor speed of model %i on its own", (index, expected) => {
    const result = range(true, (parameters) => {
      parameters.models = [parameters.models[index]!];
    });
    expect(result.max_factor).toBeCloseTo(expected, 12);
  });

  it("caps an unsynchronized non-single-point action at 100%", () => {
    const result = range(false, (parameters) => {
      const [first, second] = parameters.models[1]!.segments;
      first!.c![1] = 0;
      first!.b![1] = 0.01;
      first!.target_HPY![1] = 0.2;
      second!.a![1] = 0.2;
      second!.start_HPY![1] = 0.2;
    });
    expect(result).toMatchObject({
      max_factor: 1,
      unlimited: false,
      action_category: "不同步或未确认同步的非单点：只能降速，最高100%",
    });
  });

  it("reports no upper limit when nothing moves", () => {
    const result = range(false, (parameters) => {
      const model = parameters.models[0]!;
      for (const segment of model.segments) {
        for (const name of ["b", "c", "d", "e", "f"] as const) segment[name] = [0, 0, 0];
        segment.a = [2000, 0, 0];
        segment.start_HPY = [2000, 0, 0];
        segment.target_HPY = [2000, 0, 0];
      }
      parameters.models = [model];
    });
    expect(result).toMatchObject({
      max_factor: null,
      unlimited: true,
      action_category: "全部单点：可升速、可降速",
    });
  });

  it("rejects an unsupported model type", () => {
    expect(() =>
      range(true, (parameters) => {
        parameters.models[0]!.model_type = 3;
      }),
    ).toThrow("不支持的模型类型：3，目前只支持 2、6、7、8");
  });
});

describe("numeric helpers", () => {
  it("steps to the neighbouring doubles", () => {
    expect(nextUp(1)).toBe(1 + Number.EPSILON);
    expect(nextDown(1)).toBe(1 - Number.EPSILON / 2);
    expect(nextUp(0)).toBe(Number.MIN_VALUE);
    expect(nextUp(-Number.MIN_VALUE)).toBe(-0);
    expect(nextUp(Number.MAX_VALUE)).toBe(Number.POSITIVE_INFINITY);
  });

  it("sums exactly like math.fsum", () => {
    expect(fsum([0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1])).toBe(1);
    expect(fsum([1e100, 1, -1e100])).toBe(1);
  });

  it("widens interval results outward", () => {
    const sum = new SpeedInterval(0.1).add(0.2);
    expect(sum.lo).toBeLessThan(0.30000000000000004);
    expect(sum.hi).toBeGreaterThan(0.30000000000000004);
    expect(() => new SpeedInterval(1).div(new SpeedInterval(-1, 1))).toThrow("速度上界的区间除数包含0");
  });

  it("finds the roots of a polynomial inside [0, 1]", () => {
    // (x-0.25)(x-0.75) = 0.1875 - x + x²
    const roots = findUnitIntervalRoots([0.1875, -1, 1]);
    expect(roots).toHaveLength(2);
    expect(roots[0]).toBeCloseTo(0.25, 12);
    expect(roots[1]).toBeCloseTo(0.75, 12);
    expect(findUnitIntervalRoots([1, 0, 0])).toEqual([]);
  });
});
