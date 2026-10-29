import { describe, expect, it } from "vitest";
import type { ActionSequenceConfig } from "./types";
import { singlePointFixture } from "./nearest-start.fixture";
import {
  defaultStartEntry,
  describeEntryError,
  evaluateStartEntry,
  pickEntryFrame,
  startEntryFrames,
  startGateOptionsFor,
  stepEntryFrame,
  type StartEntryInput,
} from "./start-entry";

/** 10 → 210（2000ms）→ 10（4000ms），原关键帧 0 / 2000 / 4000 */
const roundTrip = (trajectoryMode: boolean): ActionSequenceConfig => ({
  id: 1,
  name: "s",
  trajectoryMode,
  blocks: [
    { id: "a", kind: "pose", objectId: 1, atMs: 0, pose: { v1: 10, v2: 0, v3: 0 } },
    { id: "b", kind: "pose", objectId: 1, atMs: 2000, pose: { v1: 210, v2: 0, v3: 0 } },
    { id: "c", kind: "pose", objectId: 1, atMs: 4000, pose: { v1: 10, v2: 0, v3: 0 } },
  ],
  segments: [],
});

const inputAt = (
  h: number,
  options: { forced?: boolean; reverse?: boolean; referenceFrameMs?: number } = {},
): StartEntryInput => ({
  sequence: roundTrip(options.forced ?? false),
  objects: [{ ...singlePointFixture(), id: 1 }],
  motors: [],
  telemetryByObjectId: new Map([[1, { h, p: 0, y: 0 }]]),
  reverse: options.reverse ?? false,
  ...(options.referenceFrameMs !== undefined ? { referenceFrameMs: options.referenceFrameMs } : {}),
});

describe("startGateOptionsFor", () => {
  it("maps each choice onto the algorithm switches", () => {
    expect(startGateOptionsFor({ kind: "boundary" }, { reverse: true, referenceFrameMs: 10 })).toEqual({
      nearest: false,
      reverse: true,
    });
    expect(startGateOptionsFor({ kind: "nearest" }, { reverse: false, referenceFrameMs: 10 })).toEqual({
      nearest: true,
      reverse: false,
      referenceFrameMs: 10,
    });
    expect(startGateOptionsFor({ kind: "frame", frameMs: 1200 }, { reverse: false, referenceFrameMs: 10 })).toEqual({
      nearest: true,
      reverse: false,
      specifiedFrameMs: 1200,
    });
  });

  it("defaults to nearest when the slot has it on or a reference frame is given", () => {
    expect(defaultStartEntry({ nearest: false, reverse: false })).toEqual({ kind: "boundary" });
    expect(defaultStartEntry({ nearest: true, reverse: false })).toEqual({ kind: "nearest" });
    expect(defaultStartEntry({ nearest: false, reverse: false, referenceFrameMs: 0 })).toEqual({ kind: "nearest" });
  });
});

describe("evaluateStartEntry", () => {
  it("reports the run and skipped program time for each choice", () => {
    const input = inputAt(100, { forced: true });
    const boundary = evaluateStartEntry(input, { kind: "boundary" });
    expect(boundary).toMatchObject({ ok: true, runSeconds: 4, skippedSeconds: 0, programSeconds: 4 });
    const frame = evaluateStartEntry(input, { kind: "frame", frameMs: 3000 });
    expect(frame).toMatchObject({ ok: true, runSeconds: 1, skippedSeconds: 3, plan: { targetFrameMs: 3000 } });
    if (frame.ok) expect(frame.totalSeconds).toBeCloseTo(frame.transitionSeconds + 1, 9);
  });

  it("counts a reverse run back to zero", () => {
    const result = evaluateStartEntry(inputAt(100, { forced: true, reverse: true }), { kind: "frame", frameMs: 3000 });
    expect(result).toMatchObject({ ok: true, runSeconds: 3, skippedSeconds: 1, plan: { direction: -1 } });
  });

  it("uses the reference frame only for nearest", () => {
    const input = inputAt(10, { forced: true, referenceFrameMs: 3000 });
    expect(evaluateStartEntry(input, { kind: "nearest" })).toMatchObject({ ok: true, plan: { targetFrameMs: 4000 } });
    expect(evaluateStartEntry(input, { kind: "boundary" })).toMatchObject({ ok: true, plan: { targetFrameMs: 0 } });
  });

  it("turns an algorithm error into operator wording and keeps the original", () => {
    const input = { ...inputAt(100), objects: [{ ...singlePointFixture(), id: 1, maxAxisVelocity: 0 }] };
    expect(evaluateStartEntry(input, { kind: "boundary" })).toEqual({
      ok: false,
      message: "有设备的速度参数为 0，无法计算移动",
      detail: "模型1的最大电机速度必须大于0",
    });
  });
});

describe("describeEntryError", () => {
  it.each([
    ["当前原段及运行方向后续原段均无可执行接入方案", "沿运行方向找不到能接入的位置"],
    ["沿当前方向没有可执行的共同关键帧：[]", "沿运行方向没有能接入的关键帧"],
    ["模型1当前位置已超出H行程", "有设备当前位置超出行程"],
    ["模型1的候选准备目标超出虚轴行程", "接入点超出设备行程"],
    ["缺少受控物体 3", "动作里有设备不在当前工程中"],
    ["something else", "无法计算接入方案"],
  ])("%s → %s", (message, expected) => {
    expect(describeEntryError(message)).toBe(expected);
  });
});

describe("entry frames", () => {
  const frames = startEntryFrames(inputAt(10))!;

  it("lists the keyframes the algorithm can join at", () => {
    expect(frames).toEqual({ firstMs: 0, lastMs: 4000, keyframesMs: [0, 2000, 4000], totalMs: 4000 });
  });

  it("steps a forced frame by 0.1 s inside the action", () => {
    expect(stepEntryFrame(frames, 1000, 1, true)).toBe(1100);
    expect(stepEntryFrame(frames, 1049, -1, true)).toBe(900);
    expect(stepEntryFrame(frames, 3950, 1, true)).toBe(4000);
    expect(stepEntryFrame(frames, 0, -1, true)).toBe(0);
  });

  it("steps a non-forced frame between keyframes", () => {
    expect(stepEntryFrame(frames, 0, 1, false)).toBe(2000);
    expect(stepEntryFrame(frames, 2500, -1, false)).toBe(2000);
    expect(stepEntryFrame(frames, 4000, 1, false)).toBe(4000);
    expect(stepEntryFrame(frames, 0, -1, false)).toBe(0);
  });

  it("snaps a tap on the timeline", () => {
    expect(pickEntryFrame(frames, 1300, false)).toBe(2000);
    expect(pickEntryFrame(frames, 1960, true)).toBe(2000);
    expect(pickEntryFrame(frames, 1234, true)).toBe(1200);
    expect(pickEntryFrame(frames, -50, true)).toBe(0);
  });
});
