import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Hpy, NearestParameters } from "./algorithm-params";
import { calculateNearestEntry, type NearestEntryResult } from "./nearest-entry";

/** 期望值由 python/强制就近算法/就近接入计算.py 对同一份 算法参数.json 计算得到。 */
const example = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../../../python/强制就近算法/算法参数.json"), "utf-8").replace(
    /^\uFEFF/,
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

describe("calculateNearestEntry", () => {
  it("starts forward from frame 0 when nearest is off", () => {
    const result = run({ trajectory_run: true, nearest_start: false, reverse: false });
    expect(result.selected_curve_time_ms).toBe(0);
    expect(result.prepare_time_ms).toBeCloseTo(2741.666666666667, 9);
    expect(result.prepare_time_ms_ceil).toBe(2742);
    expect(result.motor_limit_scale).toBe(1);
    expect(result.start_mode).toBe("action_boundary");
    expectHpy(deviceOf(result, 100).velocity_HPY, [150, 0, 0]);
    expectHpy(deviceOf(result, 100).acceleration_HPY, [2000, 0, 0]);
    expectHpy(deviceOf(result, 100).target_HPY, [2000, 0, 0]);
    expectHpy(deviceOf(result, 400).velocity_HPY, [150, 2.9244984802431597, 2.9244984802431597]);
    expectHpy(deviceOf(result, 400).target_HPY, [2060, 0, 0]);
  });

  it("joins the last frame with the shared virtual-axis time", () => {
    const result = run({ trajectory_run: true, nearest_start: false, reverse: true });
    expect(result.selected_curve_time_ms).toBe(8000);
    expect(result.prepare_time_ms).toBeCloseTo(4005.9999999999995, 8);
    expect(result.prepare_time_ms_ceil).toBe(4006);
    expect(result.motor_limit_scale).toBe(1);
    expectHpy(deviceOf(result, 100).velocity_HPY, [52.73339990014978, 0, 0]);
    expectHpy(deviceOf(result, 400).velocity_HPY, [52.73339990014978, 1.0029955067398904, 1.0029955067398904]);
    expectHpy(deviceOf(result, 400).acceleration_HPY, [247.18324133592148, 55.888888141133876, 55.888888141133876]);
    expectHpy(deviceOf(result, 400).deceleration_HPY, [247.18324133592148, 55.888888141133876, 55.888888141133876]);
    expectHpy(deviceOf(result, 300).target_HPY, [2660, 12, 12]);
  });

  it("rejects a non-forced request", () => {
    expect(() => run({ trajectory_run: false, nearest_start: true, reverse: false })).toThrow(
      "非强制就近请调用非强制就近接入",
    );
  });

  it("builds one 1006 payload with the shared prepare time and per-device V/A", () => {
    const result = run({ trajectory_run: true, nearest_start: false, reverse: true });
    expect(result["1006_payloads"]).toHaveLength(1);
    const [payload] = result["1006_payloads"];
    expect(payload).toMatchObject({ plc_id: "1", selectedCurveTimeMs: 8000, loopCount: 1, prepareTimeMs: 4006 });
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
      [102, "H"],
      [102, "P"],
      [102, "Y"],
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
    expect(specified.prepare_time_ms).toBeCloseTo(1408.3333333333333, 9);
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
 * 当前原段优先（python/强制就近算法）。示例停在 3500ms 所在段，最近可执行点在 3000ms。
 */
describe("calculateNearestEntry frame selection (指定帧 / 从参考帧按方向就近)", () => {
  const current = JSON.parse(
    readFileSync(path.resolve(__dirname, "../../../../python/强制就近算法/算法参数.json"), "utf-8").replace(
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
    expect(result.selected_curve_time_ms).toBe(3000);
    expect(result.prepare_time_ms).toBeCloseTo(1408.3333333333333, 9);
    expect(result).toMatchObject({
      frame_selection_mode: "current_segment_first",
      reference_frame_ms: 3500,
      search_origin_frame_ms: 3500,
      search_range_ms: [2000, 6000],
      reference_segment_range_ms: [2000, 6000],
      selected_segment_range_ms: [2000, 6000],
      segment_search_phase: "current_segment",
    });
    expect(deviceOf(result, 400).execute_HPY).toEqual([true, true, true]);
  });

  it("stays in the current segment even when another segment is nearer, and lets reverse join after the reference", () => {
    // 当前位置在 5000ms 处；参考 6500 所在原段是 [6000, 8000]，只在这段里找
    const current = runCurrent({ trajectory_run: true, nearest_start: true, reverse: true, stopped_time_ms: 6500 });
    expect(current.selected_curve_time_ms).toBe(6000);
    expect(current.prepare_time_ms).toBeCloseTo(3339.333333333333, 9);
    expect(current.selected_segment_range_ms).toEqual([6000, 8000]);
    // 反向也可以选在参考帧之后
    expect(
      runCurrent({ trajectory_run: true, nearest_start: true, reverse: true, stopped_time_ms: 3500 }).selected_curve_time_ms,
    ).toBe(3000);
  });

  it("assigns a reference on a segment boundary to the right segment forward and the left one in reverse", () => {
    const forward = runCurrent({ trajectory_run: true, nearest_start: true, stopped_time_ms: 2000 });
    expect(forward).toMatchObject({ selected_curve_time_ms: 3000, selected_segment_range_ms: [2000, 6000] });
    const reverse = runCurrent({ trajectory_run: true, nearest_start: true, reverse: true, stopped_time_ms: 2000 });
    expect(reverse).toMatchObject({ selected_curve_time_ms: 2000, selected_segment_range_ms: [0, 2000] });
    expect(reverse.prepare_time_ms).toBeCloseTo(2075, 9);
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
    expect(result.selected_curve_time_ms).toBe(3000);
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
    expect(result.selected_curve_time_ms).toBe(3000);
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
      expect(result.prepare_time_ms).toBeCloseTo(1672.6666666666665, 9);
      expect(result.frame_selection_mode).toBe("specified_frame");
      expect(result.search_range_ms).toEqual([3500, 3500]);
    }
  });

  it("rejects a reference frame outside the action instead of running from an end", () => {
    expect(() => runCurrent({ trajectory_run: true, nearest_start: true, stopped_time_ms: 8001 })).toThrow(
      "停止参考帧必须是动作首末范围内的整数毫秒",
    );
  });

});

/**
 * 往返曲线同一位置有两个时刻（两段线性插值）。选帧规则与强制包一致。
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
