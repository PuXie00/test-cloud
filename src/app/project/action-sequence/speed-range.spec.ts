import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AlgorithmModel, RangeParameters } from "./algorithm-params";
import { fsum, nextDown, nextUp, SpeedInterval } from "./speed-interval";
import { calculateRangeResult, findUnitIntervalRoots } from "./speed-range";

/**
 * 期望值由 python/调速范围计算/调速范围计算.py（2026-11-20 五模型版）对同一份 算法参数.json 计算得到。
 * 示例 models：100 单点(2)、101 多级升降(3)、102 普通多点摆(7，四吊点)、103 XY多点摆(9，X 轴上两吊点)、
 * 400 无极旋转(4，周期 360，350° 连续转到 370°)。
 */
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

/** 只留一个模型，并放开它的虚轴速度上限 */
const onlyModel = (index: number, edit?: (model: AlgorithmModel) => void) => (parameters: RangeParameters) => {
  const model = parameters.models[index]!;
  model.max_velocity_HPY = [1e9, 1e9, 1e9];
  edit?.(model);
  parameters.models = [model];
};

describe("calculateRangeResult", () => {
  it("takes the smallest ratio of every model", () => {
    // 包内示例：H 峰速 100mm/s、上限 150；多点 P/Y 峰速 2°/s、上限 3°/s，均为 150%
    expect(range(true)).toEqual({
      max_factor: 1.5,
      unlimited: false,
      action_category: "强制轨迹：按原始曲线计算",
      range_version: "shared_json_v2",
    });
    expect(range(false)).toMatchObject({
      max_factor: 1.5,
      action_category: "同步非单点：可升速、可降速",
    });
  });

  it.each([
    [0, 5],
    [1, 5],
    [2, 4.045722432090806],
    [3, 4.134169492901804],
  ])("bounds the motor speed of model index %i on its own", (index, expected) => {
    expect(range(true, onlyModel(index)).max_factor).toBeCloseTo(expected, 12);
  });

  it("treats a multi-level hoist like a single point", () => {
    expect(range(false, (parameters) => (parameters.models = parameters.models.slice(0, 2)))).toMatchObject({
      max_factor: 1.5,
      action_category: "全部单点/多级升降：可升速、可降速",
    });
  });

  it("caps an unsynchronized non-single-point action at 100%", () => {
    const result = range(false, (parameters) => {
      const first = parameters.models[2]!.segments[0]!;
      first.c![1] = 0;
      first.b![1] = 0.01;
      parameters.models = [parameters.models[0]!, parameters.models[2]!];
    });
    expect(result).toMatchObject({
      max_factor: 1,
      unlimited: false,
      action_category: "不同步或未确认同步的非单点：只能降速，最高100%",
    });
  });

  it("reports no upper limit when nothing moves", () => {
    const result = range(false, (parameters) => {
      const model = parameters.models[1]!;
      for (const segment of model.segments) {
        for (const name of ["b", "c", "d", "e", "f"] as const) segment[name] = [0, 0, 0];
        segment.a = [2000, 0, 0];
      }
      parameters.models = [model];
    });
    expect(result).toMatchObject({
      max_factor: null,
      unlimited: true,
      action_category: "全部单点/多级升降：可升速、可降速",
    });
  });

  it("rejects an unsupported model type", () => {
    expect(() =>
      range(true, (parameters) => {
        parameters.models[0]!.model_type = 8;
      }),
    ).toThrow("不支持的模型类型：8，目前只支持2、3、4、7、9");
  });
});

describe("continuous rotation (type 4)", () => {
  const rotation = 4;

  it("follows the H speed across zero on a stroke wider than the period", () => {
    // 示例软行程 0~720、周期 360：宽度 ≥ 周期即整圈。350°→370° 匀速 10°/s；实轴 15°/s 限 150%
    expect(range(true, onlyModel(rotation)).max_factor).toBe(1.5);
    expect(range(false, onlyModel(rotation))).toMatchObject({
      max_factor: 1.5,
      action_category: "全部单点/多级升降/无极旋转：可升速、可降速",
    });
  });

  const withStroke = (min: number, max: number, a = 350, b = 1) => (model: AlgorithmModel) => {
    model.min_position_HPY = [min, 0, 0];
    model.max_position_HPY = [max, 0, 0];
    model.segments[0]!.a![0] = a;
    model.segments[0]!.b![0] = b;
  };

  it("keeps a partial stroke out of its forbidden zone", () => {
    expect(() => range(true, onlyModel(rotation, withStroke(10, 300)))).toThrow(
      "无极旋转原曲线越过允许姿态弧；部分范围不能跨过禁用区",
    );
  });

  it("accepts a partial arc above the period when the whole path stays in one copy", () => {
    // 允许弧 300~400：350→370 在同一副本里
    expect(range(true, onlyModel(rotation, withStroke(300, 400))).max_factor).toBe(1.5);
    // 350 连续降到 30：两端取模后都在弧里，但中间穿过禁用区
    expect(() => range(true, onlyModel(rotation, withStroke(300, 400, 350, -16)))).toThrow(
      "无极旋转原曲线越过允许姿态弧；部分范围不能跨过禁用区",
    );
  });

  it.each([
    ["no period", (model: AlgorithmModel) => delete model.workingStroke, "无极旋转workingStroke须为真实有限正周期"],
    [
      "a negative lower bound",
      (model: AlgorithmModel) => (model.min_position_HPY = [-1, 0, 0]),
      "无极旋转H软行程须满足0<=min<max，workingStroke仍为真实正周期",
    ],
    [
      "33 motors",
      (model: AlgorithmModel) => (model.motor_num = 33),
      "无极旋转motor_num须为1到32的整数，全部绑定轴须使用相同workingStroke",
    ],
    [
      "a moving tilt axis",
      (model: AlgorithmModel) => (model.segments[0]!.b![1] = 0.1),
      "无极旋转只支持H角度轴，P/Y不能包含运动",
    ],
  ])("rejects %s", (_, edit, message) => {
    expect(() => range(true, onlyModel(rotation, edit))).toThrow(message);
  });
});

describe("multi-point geometry", () => {
  it.each([
    ["on the Y axis", [[0, -500, 0], [0, 300, 0]], 4.526811035560968],
    ["with one end at the origin", [[0, 0, 0], [700, 0, 0]], 4.999991486294694],
  ])("accepts two XY hoists %s", (_, points, expected) => {
    const result = range(true, onlyModel(3, (model) => (model.point_init_pos = points as AlgorithmModel["point_init_pos"])));
    expect(result.max_factor).toBeCloseTo(expected, 12);
  });

  it("rejects two XY hoists off one axis through the origin", () => {
    expect(() =>
      range(true, onlyModel(3, (model) => (model.point_init_pos = [[100, 100, 0], [-100, -100, 0]]))),
    ).toThrow(/XY双吊点/);
  });

  it("needs three hoists for an ordinary multi-point swing", () => {
    expect(() =>
      range(true, onlyModel(2, (model) => (model.point_init_pos = [[-600, 0, 0], [600, 0, 0]]))),
    ).toThrow(/至少需要3个吊点/);
  });

  it("keeps the tilt angle inside (-90, 90)", () => {
    expect(() =>
      range(true, (parameters) => {
        parameters.models[2]!.segments[2]!.a![1] = 95;
      }),
    ).toThrow("模型102的P倾角须在(-90,90)内");
  });
});

describe("virtual-axis velocity limit", () => {
  it("divides each axis limit by its own peak", () => {
    // P 峰速 2°/s、上限 6°/s → 300%
    const result = range(true, onlyModel(2, (model) => (model.max_velocity_HPY = [1e9, 6, 1e9])));
    expect(result.max_factor).toBe(3);
  });

  it("allows a zero limit on a still axis", () => {
    expect(range(true, (parameters) => (parameters.models = [parameters.models[0]!])).max_factor).toBe(1.5);
  });

  it("counts a negative peak inside a higher-order piece", () => {
    // H 速度 10·(-6u + 0.3u²)：两端为 0，u=10 处 -300mm/s，上限 150 → 50%
    for (const trajectoryRun of [true, false]) {
      const result = range(trajectoryRun, (parameters) => {
        const model = parameters.models[0]!;
        model.max_motor_velocity = 1e6;
        const segment = model.segments[0]!;
        segment.b![0] = 0;
        segment.c![0] = -3;
        segment.d![0] = 0.1;
        parameters.models = [model];
      });
      expect(result.max_factor).toBeCloseTo(0.5000000000000002, 12);
    }
  });

  it("rejects a zero limit on a moving axis", () => {
    expect(() =>
      range(true, (parameters) => {
        parameters.models[2]!.max_velocity_HPY = [150, 0, 3];
      }),
    ).toThrow("模型102的P最大速度为0，但原曲线包含运动");
  });

  it.each([
    ["missing", undefined, "模型100需要H/P/Y三个max_velocity_HPY最大速度"],
    ["two values", [150, 0], "模型100需要H/P/Y三个max_velocity_HPY最大速度"],
    ["negative", [150, -1, 0], "模型100的max_velocity_HPY须为三个有限非负数"],
    ["boolean", [150, true, 0], "模型100的max_velocity_HPY须为三个有限非负数"],
  ])("validates max_velocity_HPY (%s)", (_, limits, message) => {
    expect(() =>
      range(true, (parameters) => {
        (parameters.models[0] as { max_velocity_HPY?: unknown }).max_velocity_HPY = limits;
      }),
    ).toThrow(message);
  });
});

describe("acceleration capability", () => {
  it("scales acceleration with the square of the factor", () => {
    // H 原曲线加减速峰值 50mm/s²：A 上限 30 → √0.6，D 上限 40 → √0.8，取小
    const result = range(true, onlyModel(0, (model) => {
      model.max_acceleration_HPY = [30, 0, 0];
      model.max_deceleration_HPY = [40, 0, 0];
    }));
    expect(result.max_factor).toBeCloseTo(0.7745966692414834, 12);
  });

  it("covers both directions with a lone deceleration limit", () => {
    // 范围不分方向：反向时 A/D 互换，D 上限 20 同样约束加速段 → √(20/50)
    const result = range(true, onlyModel(0, (model) => {
      delete (model as Partial<AlgorithmModel>).max_acceleration_HPY;
      model.max_deceleration_HPY = [20, 0, 0];
    }));
    expect(result.max_factor).toBeCloseTo(0.6324555320336759, 12);
  });

  it("adds no capability limit when both fields are omitted", () => {
    const result = range(true, onlyModel(0, (model) => {
      delete (model as Partial<AlgorithmModel>).max_acceleration_HPY;
      delete (model as Partial<AlgorithmModel>).max_deceleration_HPY;
    }));
    expect(result.max_factor).toBe(5);
  });

  it("rejects a zero capability on a moving axis", () => {
    expect(() =>
      range(true, (parameters) => {
        parameters.models[3]!.max_acceleration_HPY = [2000, 0, 500];
      }),
    ).toThrow("模型103的P轴max_acceleration_HPY为0，但原曲线需要相应加减速");
  });

  it("validates the capability shape", () => {
    expect(() =>
      range(true, (parameters) => {
        (parameters.models[0] as { max_acceleration_HPY?: unknown }).max_acceleration_HPY = [2000];
      }),
    ).toThrow("模型100的max_acceleration_HPY须提供H/P/Y三个真实能力");
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
