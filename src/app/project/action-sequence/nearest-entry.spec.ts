import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Hpy, NearestParameters } from "./algorithm-params";
import { calculateNearestEntry, type NearestEntryResult } from "./nearest-entry";

/** 期望值由 python/就近计算/就近接入计算.py（停稳同步准备）对同一份 算法参数.json 计算得到。 */
const example = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../../../python/就近计算/算法参数.json"), "utf-8").replace(
    /^﻿/,
    "",
  ),
) as NearestParameters;

const run = (command: Partial<NearestParameters["command"]>, edit?: (parameters: NearestParameters) => void) => {
  const parameters = structuredClone(example);
  Object.assign(parameters.command, command);
  edit?.(parameters);
  return calculateNearestEntry(parameters);
};

const deviceOf = (result: NearestEntryResult, deviceId: number) =>
  result.devices.flatMap((group) => group.models).find((model) => model.device_id === deviceId)!;

const expectHpy = (actual: Hpy, expected: Hpy) =>
  expected.forEach((value, axis) => expect(actual[axis]).toBeCloseTo(value, 9));

const STEADY: Record<number, Hpy> = { 100: [150, 0, 0], 200: [150, 0, 0], 300: [150, 0, 0], 400: [150, 0, 0] };
const STEADY_A: Hpy = [2000, 0, 0];
const START_TARGETS: Record<number, Hpy> = {
  100: [2000, 0, 0],
  200: [2020, 0, 0],
  300: [2040, 0, 0],
  400: [2060, 0, 0],
};

describe("calculateNearestEntry", () => {
  it.each([
    [true, false],
    [false, false],
    [true, true],
  ])("starts forward from frame 0 (forced=%s, nearest=%s)", (forced, nearest) => {
    const result = run({ trajectory_run: forced, nearest_start: nearest, reverse: false });
    expect(result.selected_curve_time_ms).toBe(0);
    expect(result.prepare_time_ms).toBeCloseTo(208.33333333333331, 9);
    expect(result.prepare_time_ms_ceil).toBe(209);
    expect(result.motor_limit_scale).toBe(1);
    expect(result.start_mode).toBe(nearest ? "nearest" : "action_boundary");
    for (const deviceId of [100, 200, 300, 400]) {
      const device = deviceOf(result, deviceId);
      expectHpy(device.velocity_HPY, STEADY[deviceId]!);
      expectHpy(device.acceleration_HPY, STEADY_A);
      expectHpy(device.target_HPY, START_TARGETS[deviceId]!);
    }
  });

  it.each([true, false])("slows every model by one motor factor from the last frame (forced=%s)", (forced) => {
    const result = run({ trajectory_run: forced, nearest_start: false, reverse: true });
    expect(result.selected_curve_time_ms).toBe(8000);
    expect(result.prepare_time_ms).toBeCloseTo(4292.321298981101, 8);
    expect(result.prepare_time_ms_ceil).toBe(4293);
    expect(result.motor_limit_scale).toBeCloseTo(0.9804329732567543, 12);
    const h = 147.06494598851313;
    const p = 2.7998835974494263;
    const ah = 1922.4976300981589;
    const ap = 435.51934218146346;
    expectHpy(deviceOf(result, 100).velocity_HPY, [h, 0, 0]);
    expectHpy(deviceOf(result, 200).velocity_HPY, [h, p, 0]);
    expectHpy(deviceOf(result, 400).velocity_HPY, [h, p, p]);
    expectHpy(deviceOf(result, 400).acceleration_HPY, [ah, ap, ap]);
    // 强制取 min(A, D)，PLC D=A
    expectHpy(deviceOf(result, 400).deceleration_HPY, [ah, ap, ap]);
    expectHpy(deviceOf(result, 300).target_HPY, [2640, 12, 0]);
  });

  it("takes the nearest original keyframe in the running direction when not forced", () => {
    const result = run({ trajectory_run: false, nearest_start: true, reverse: false });
    expect(result.selected_curve_time_ms).toBe(2000);
    expect(result.prepare_time_ms).toBeCloseTo(874.9999999999999, 9);
    expect(result.prepare_time_ms_ceil).toBe(875);
    expectHpy(deviceOf(result, 200).velocity_HPY, [150, 2.306285714285715, 0]);
    expectHpy(deviceOf(result, 400).acceleration_HPY, [2000, 295.4974331065761, 295.4974331065761]);
    expectHpy(deviceOf(result, 400).target_HPY, [2160, 2, 2]);
    expect(run({ trajectory_run: false, nearest_start: true, reverse: true }).selected_curve_time_ms).toBe(0);
  });

  it("builds one 1006 payload with the shared prepare time and per-device V/A", () => {
    const result = run({ trajectory_run: true, nearest_start: false, reverse: true });
    expect(result["1006_payloads"]).toHaveLength(1);
    const [payload] = result["1006_payloads"];
    expect(payload).toMatchObject({ plc_id: "1", selectedCurveTimeMs: 8000, loopCount: 1, prepareTimeMs: 4293 });
    expect(payload!.devices.map((device) => device.deviceID)).toEqual([100, 200, 300, 400]);
    expect(payload!.devices[0]!.execute_HPY).toEqual([true, false, false]);
  });

  it("falls back to a single run when the curve does not close", () => {
    const result = run({ trajectory_run: true, loop_count: 0 });
    expect(result.effective_loop_count).toBe(1);
    expect(result.effective_loop_once).toBe(true);
    expect(result.loop_fallback.map((item) => [item.model_id, item.axis])).toEqual([
      [100, "H"],
      [101, "H"],
      [101, "P"],
      [102, "H"],
      [102, "P"],
      [103, "H"],
      [103, "P"],
      [103, "Y"],
    ]);
  });

  it("evaluates a specified frame and searches from a stop frame", () => {
    const specified = run({
      trajectory_run: true,
      nearest_start: true,
      use_specified_time: true,
      specified_time_ms: 3000,
    });
    expect(specified.selected_curve_time_ms).toBe(3000);
    expect(specified.prepare_time_ms).toBeCloseTo(1541.6666666666665, 9);
    const stopped = run({ trajectory_run: false, nearest_start: true, stopped_time_ms: 3000 });
    expect(stopped.selected_curve_time_ms).toBe(6000);
    expect(stopped.prepare_time_ms).toBeCloseTo(3565.463207204749, 8);
  });

  it("rejects a model that has not stopped", () => {
    expect(() =>
      run({ trajectory_run: true }, (parameters) => {
        parameters.runtime.models[0]!.standstill = false;
        parameters.runtime.models[0]!.velocity_HPY = [5, 0, 0];
      }),
    ).toThrow("1/100尚未停稳，不能用零速准备规划");
  });

  it("rejects runtime that does not cover every model", () => {
    expect(() =>
      run({ trajectory_run: true }, (parameters) => {
        parameters.runtime.models.pop();
      }),
    ).toThrow("runtime.models必须完整覆盖本动作全部模型");
  });

  it("does not modify the input", () => {
    const parameters = structuredClone(example);
    const snapshot = JSON.stringify(parameters);
    calculateNearestEntry(parameters);
    expect(JSON.stringify(parameters)).toBe(snapshot);
  });
});

/**
 * 两种选帧（python/新就近算法，2026-10-28）：期望值由该目录的就近接入计算.py 的 _calculate_nearest_entry_v4
 * 对同一份 算法参数.json 计算得到。示例当前位置在原曲线 5000ms 处，已停稳。
 */
describe("calculateNearestEntry frame selection (指定帧 / 从参考帧按方向就近)", () => {
  const current = JSON.parse(
    readFileSync(path.resolve(__dirname, "../../../../python/新就近算法/算法参数.json"), "utf-8").replace(
      /^\uFEFF/,
      "",
    ),
  ) as NearestParameters;
  const runCurrent = (command: Partial<NearestParameters["command"]>) => {
    const parameters = structuredClone(current);
    Object.assign(parameters.command, command);
    return calculateNearestEntry(parameters);
  };

  it("searches the whole original segment of the reference frame and joins at the nearest position", () => {
    const result = runCurrent({ trajectory_run: true, nearest_start: true, use_specified_time: false, stopped_time_ms: 3500 });
    expect(result.selected_curve_time_ms).toBe(5000);
    expect(result.prepare_time_ms).toBe(0);
    expect(result).toMatchObject({
      frame_selection_mode: "current_segment_first",
      reference_frame_ms: 3500,
      search_origin_frame_ms: 3500,
      search_range_ms: [2000, 6000],
      reference_segment_range_ms: [2000, 6000],
      selected_segment_range_ms: [2000, 6000],
      segment_search_phase: "current_segment",
    });
    expect(deviceOf(result, 400).execute_HPY).toEqual([false, false, false]);
  });

  it("stays in the current segment even when another segment is nearer, and lets reverse join after the reference", () => {
    // 当前位置在 5000ms 处；参考 6500 所在原段是 [6000, 8000]，只在这段里找
    const current = runCurrent({ trajectory_run: true, nearest_start: true, reverse: true, stopped_time_ms: 6500 });
    expect(current.selected_curve_time_ms).toBe(6000);
    expect(current.prepare_time_ms).toBeCloseTo(741.6666666666666, 9);
    expect(current.selected_segment_range_ms).toEqual([6000, 8000]);
    // 反向也可以选在参考帧之后
    expect(
      runCurrent({ trajectory_run: true, nearest_start: true, reverse: true, stopped_time_ms: 3500 }).selected_curve_time_ms,
    ).toBe(5000);
  });

  it("assigns a reference on a segment boundary to the right segment forward and the left one in reverse", () => {
    const forward = runCurrent({ trajectory_run: true, nearest_start: true, stopped_time_ms: 2000 });
    expect(forward).toMatchObject({ selected_curve_time_ms: 5000, selected_segment_range_ms: [2000, 6000] });
    const reverse = runCurrent({ trajectory_run: true, nearest_start: true, reverse: true, stopped_time_ms: 2000 });
    expect(reverse).toMatchObject({ selected_curve_time_ms: 2000, selected_segment_range_ms: [0, 2000] });
    expect(reverse.prepare_time_ms).toBeCloseTo(2108.2526606410656, 9);
  });

  it("falls back to the next segment in the running direction only when the whole current one cannot be prepared", () => {
    const parameters = structuredClone(current);
    // 行程上限 2300：当前段 [6000, 8000] 的目标都超出行程
    for (const model of parameters.models) model.max_position_HPY = [2300, 15, 15];
    for (const state of parameters.runtime.models) state.position_HPY[0] = Math.min(state.position_HPY[0], 2300);
    Object.assign(parameters.command, {
      trajectory_run: true,
      nearest_start: true,
      use_specified_time: false,
      reverse: true,
      stopped_time_ms: 7000,
      loop_count: 1,
    });
    const result = calculateNearestEntry(parameters);
    expect(result.selected_curve_time_ms).toBe(3400);
    expect(result.segment_search_phase).toBe("directional_fallback");
    expect(result.segment_search_attempts).toEqual([
      {
        range_ms: [6000, 8000],
        phase: "current_segment",
        index: 0,
        reference_frame_ms: 7000,
        status: "infeasible",
        reason: "本原段窗口内没有可执行的准备接入点",
      },
      { range_ms: [2000, 6000], phase: "directional_fallback", index: 1, reference_frame_ms: 7000, status: "planned" },
    ]);
  });

  it("searches the whole action from the direction boundary without a reference frame", () => {
    const result = runCurrent({ trajectory_run: true, nearest_start: true, stopped_time_ms: null });
    expect(result.selected_curve_time_ms).toBe(5000);
    expect(result).toMatchObject({ reference_frame_ms: null, search_origin_frame_ms: 0, search_range_ms: [0, 8000] });
  });

  it("joins exactly at a specified frame, even without nearest", () => {
    for (const nearest of [true, false]) {
      const result = runCurrent({
        trajectory_run: true,
        nearest_start: nearest,
        use_specified_time: true,
        specified_time_ms: 3500,
      });
      expect(result.selected_curve_time_ms).toBe(3500);
      expect(result.prepare_time_ms).toBe(1075);
      expect(result.frame_selection_mode).toBe("specified_frame");
      expect(result.search_range_ms).toEqual([3500, 3500]);
    }
  });

  it("rejects a reference frame outside the action instead of running from an end", () => {
    expect(() => runCurrent({ trajectory_run: true, nearest_start: true, stopped_time_ms: 8001 })).toThrow(
      "停止参考帧必须是动作首末范围内的整数毫秒",
    );
  });

  it("takes the next keyframe after the reference frame when not forced", () => {
    const result = runCurrent({ trajectory_run: false, nearest_start: true, stopped_time_ms: 3500 });
    expect(result.selected_curve_time_ms).toBe(6000);
    expect(result.prepare_time_ms).toBeCloseTo(741.6666666666666, 9);
    expect(result).toMatchObject({ frame_selection_mode: "directional_nearest", search_range_ms: [6000, 8000] });
  });
});

/**
 * 往返曲线同一位置有两个时刻（python/新就近算法 接入说明第 7 节的例子，两段线性插值）：
 * 期望值由 _calculate_nearest_entry_v4 计算得到。
 */
describe("calculateNearestEntry on a round trip that repeats a position", () => {
  const roundTrip = (
    points: Array<[number, number]>,
    h: number,
    stop: number,
    reverse: boolean,
  ): NearestParameters => {
    const parameters = structuredClone(example);
    const template = parameters.models.find((model) => model.model_type === 2)!;
    const segments = points.slice(1).map(([end, to], index) => {
      const [start, from] = points[index]!;
      const zero: Hpy = [0, 0, 0];
      return {
        segment_id: index,
        start_frame: start,
        end_frame: end,
        start_HPY: [from, 0, 0] as Hpy,
        target_HPY: [to, 0, 0] as Hpy,
        a: [from, 0, 0] as Hpy,
        b: [(to - from) / ((end - start) / 100), 0, 0] as Hpy,
        c: zero,
        d: zero,
        e: zero,
        f: zero,
      };
    });
    const { min_position_HPY: _min, max_position_HPY: _max, ...free } = template;
    const model = { ...free, segments, follow_axes: ["H"], active_axes: ["H"], prepare_axes: ["H"] };
    return {
      command: {
        trajectory_run: true,
        reverse,
        nearest_start: true,
        use_specified_time: false,
        stopped_time_ms: stop,
        loop_count: 1,
      },
      settings: parameters.settings,
      models: [model],
      runtime: {
        models: [
          {
            model_id: model.model_id,
            plc_id: model.plc_id,
            device_id: model.device_id,
            position_HPY: [h, 0, 0],
            velocity_HPY: [0, 0, 0],
            standstill: true,
          },
        ],
      },
    };
  };

  it("keeps the first time the position is met in the running direction", () => {
    const symmetric: Array<[number, number]> = [[0, 0], [2000, 1000], [4000, 0]];
    expect(calculateNearestEntry(roundTrip(symmetric, 500, 800, false)).selected_curve_time_ms).toBe(1000);
    expect(calculateNearestEntry(roundTrip(symmetric, 500, 3200, true)).selected_curve_time_ms).toBe(3000);
  });

  it("checks the whole fine grid, not only around the coarse best, on an unequal round trip", () => {
    const unequal: Array<[number, number]> = [[0, 0], [1100, 1000], [2700, 0]];
    const forward = calculateNearestEntry(roundTrip(unequal, 500, 0, false));
    // 粗搜正好落在回程的 1900，前支的 550 只在细网格上
    expect(forward.selected_curve_time_ms).toBe(550);
    expect(forward.search_statistics).toEqual({
      method: "position_envelope_branch_and_bound",
      evaluated_frames: 14,
      bound_intervals: 3,
      pruned_grid_frames: 110,
      full_fine_grid_covered: true,
      fine_grid_frames: 111,
      normalized_position_tolerance: 2.4253192047278088e-14,
      infeasible_frames: 0,
    });
    expect(calculateNearestEntry(roundTrip(unequal, 500, 2700, true)).selected_curve_time_ms).toBe(1900);
  });

  it.each([500, 499.999999, 499.99, 500.000001])(
    "does not jump to the return branch over a float tail (H=%s)",
    (h) => {
      expect(
        calculateNearestEntry(roundTrip([[0, 0], [3000, 1000], [4000, 0]], h, 1500, false)).selected_curve_time_ms,
      ).toBe(1500);
      expect(
        calculateNearestEntry(roundTrip([[0, 0], [1000, 1000], [4000, 0]], h, 2500, true)).selected_curve_time_ms,
      ).toBe(2500);
    },
  );

  it("joins the current segment on the far side of a long round trip, in either direction", () => {
    // 接入说明的例子：停止参考 12500 在 [10000, 20000]，惯性停在 534.98，不跳回前半段 4850 附近
    const points: Array<[number, number]> = [[0, 100], [10000, 1000], [20000, 0]];
    for (const reverse of [false, true]) {
      const result = calculateNearestEntry(roundTrip(points, 534.98, 12500, reverse));
      expect(result.selected_curve_time_ms).toBe(14650);
      expect(result.prepare_time_ms).toBeCloseTo(6.324555320333882, 9);
      expect(result.selected_segment_range_ms).toEqual([10000, 20000]);
    }
    // 参考恰在 10000 且反向：归左段 [0, 10000]
    expect(calculateNearestEntry(roundTrip(points, 534.98, 10000, true)).selected_curve_time_ms).toBe(4830);
  });

  it("reports no search statistics outside the directional search", () => {
    const parameters = roundTrip([[0, 0], [2000, 1000], [4000, 0]], 500, 800, false);
    parameters.command.use_specified_time = true;
    parameters.command.specified_time_ms = 800;
    expect(calculateNearestEntry(parameters).search_statistics).toEqual({});
  });
});
