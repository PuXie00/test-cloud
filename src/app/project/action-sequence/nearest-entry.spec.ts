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

  it("searches forward from the reference frame and joins at the nearest position, not at the reference", () => {
    const result = runCurrent({ trajectory_run: true, nearest_start: true, use_specified_time: false, stopped_time_ms: 3500 });
    expect(result.selected_curve_time_ms).toBe(5000);
    expect(result.prepare_time_ms).toBe(0);
    expect(result).toMatchObject({
      frame_selection_mode: "directional_nearest",
      reference_frame_ms: 3500,
      search_origin_frame_ms: 3500,
      search_range_ms: [3500, 8000],
    });
    expect(deviceOf(result, 400).execute_HPY).toEqual([false, false, false]);
  });

  it("searches backward only up to the reference frame in reverse", () => {
    const back = runCurrent({ trajectory_run: true, nearest_start: true, reverse: true, stopped_time_ms: 6500 });
    expect(back.selected_curve_time_ms).toBe(5000);
    expect(back.search_range_ms).toEqual([0, 6500]);
    // [0, 3550] 里离 5000ms 处最近的是区间端点 3550
    const bounded = runCurrent({ trajectory_run: true, nearest_start: true, reverse: true, stopped_time_ms: 3550 });
    expect(bounded.selected_curve_time_ms).toBe(3550);
    expect(bounded.prepare_time_ms).toBeCloseTo(1041.6666666666667, 9);
    expect(bounded.prepare_time_ms_ceil).toBe(1042);
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
      "stopped_time_ms必须是动作首末范围内的整数毫秒",
    );
  });

  it("takes the next keyframe after the reference frame when not forced", () => {
    const result = runCurrent({ trajectory_run: false, nearest_start: true, stopped_time_ms: 3500 });
    expect(result.selected_curve_time_ms).toBe(6000);
    expect(result.prepare_time_ms).toBeCloseTo(741.6666666666666, 9);
    expect(result).toMatchObject({ frame_selection_mode: "directional_nearest", search_range_ms: [6000, 8000] });
  });
});
