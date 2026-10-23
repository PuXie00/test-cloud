import { describe, expect, it } from "vitest";
import { ALGORITHM_SETTINGS, buildAlgorithmModels } from "./algorithm-models";
import { evaluatePiece, type AlgorithmModel } from "./algorithm-params";
import { calculateNearestEntry } from "./nearest-entry";
import type { HpyPose } from "./nearest-start-motion";
import { fixtureObjects, fixtureSequence } from "./nearest-start.fixture";
import { resolveActionSequence } from "./resolve-sequence";
import type { ActionSequenceConfig, KeyframePose } from "./types";

const STOP = { v1: 0, v2: 0, v3: 0 };

const pose = (objectId: number, atMs: number, value: KeyframePose, stop = false) => ({
  id: `p${objectId}-${atMs}`,
  kind: "pose" as const,
  objectId,
  atMs,
  pose: value,
  ...(stop ? { passSpeeds: STOP } : {}),
});

const sequenceOf = (blocks: ActionSequenceConfig["blocks"]): ActionSequenceConfig => ({
  id: 9,
  name: "s",
  trajectoryMode: true,
  blocks,
  segments: [],
});

const build = (sequence: ActionSequenceConfig, telemetry: Record<number, HpyPose> = {}) =>
  buildAlgorithmModels({
    resolved: resolveActionSequence(sequence),
    objects: fixtureObjects(),
    motors: [],
    telemetryByObjectId: new Map(Object.entries(telemetry).map(([id, value]) => [Number(id), value])),
  });

/** 在模型曲线上取某一帧的位置与每秒速度 */
const stateAt = (model: AlgorithmModel, frameMs: number) => {
  const pieces = model.segments.flatMap((segment) => segment.coefficient_segments ?? []);
  const piece =
    pieces.find((item) => item.start_frame <= frameMs && frameMs < item.end_frame) ??
    pieces[pieces.length - 1]!;
  return evaluatePiece(piece, frameMs);
};

describe("buildAlgorithmModels", () => {
  it("maps each object to the business model type with its geometry", () => {
    const { models } = build(fixtureSequence(true));
    expect(models.map((model) => [model.model_id, model.device_id, model.model_type, model.motor_num])).toEqual([
      [1, 1, 2, 1],
      [2, 2, 6, 2],
      [3, 3, 7, 4],
      [4, 4, 8, 8],
    ]);
    expect(models[1]).toMatchObject({ BaseHight1: 100, BaseHight2: 0, lLenth_inside: 2000, maxheight: 8000 });
    expect(models[2]).toMatchObject({ lLenth_inside: 2000, wLenth_inside: 1800, moveWhat: 1 });
    expect(models[3]).toMatchObject({ Baseheight1: 100, Baseheight2: 0, maxheight: 8000, betainit: 0 });
    expect(models[3]!.point_init_pos).toHaveLength(8);
    expect(models[2]).toMatchObject({
      max_velocity_HPY: [500, 3, 3],
      max_acceleration_HPY: [500, 3, 3],
      max_motor_velocity: 475,
    });
  });

  it("cuts one original segment per pose span and holds the last pose until the sequence ends", () => {
    const { models } = build(fixtureSequence(true));
    const two = models[1]!;
    expect(two.segments.map((segment) => [segment.start_frame, segment.end_frame])).toEqual([
      [0, 6000],
      [6000, 11000],
      [11000, 16000],
    ]);
    expect(stateAt(two, 6000).positions[0]).toBeCloseTo(1800, 9);
    expect(stateAt(two, 6000).positions[1]).toBeCloseTo(10, 9);
    expect(stateAt(two, 14000).positions).toEqual([2200, -5, 0].map((value) => expect.closeTo(value, 9)));
    expect(stateAt(two, 14000).velocities).toEqual([0, 0, 0]);
  });

  it("holds an object that finishes before the others instead of extending its last curve row", () => {
    const { models } = build(
      sequenceOf([
        pose(1, 0, { v1: 0 }, true),
        pose(1, 4000, { v1: 400 }, true),
        pose(2, 0, { v1: 1000, v2: 0 }),
        pose(2, 8000, { v1: 1400, v2: 0 }),
      ]),
    );
    const single = models[0]!;
    expect(single.segments.map((segment) => segment.end_frame)).toEqual([4000, 8000]);
    expect(stateAt(single, 4000).positions[0]).toBeCloseTo(400, 9);
    expect(stateAt(single, 7999).positions[0]).toBeCloseTo(400, 9);
    expect(stateAt(single, 7999).velocities[0]).toBe(0);
  });

  it("keeps an axis the sequence never sets at the live position", () => {
    const { models, runtime } = build(
      sequenceOf([pose(2, 0, { v1: 1000 }), pose(2, 5000, { v1: 1500 })]),
      { 2: { h: 1100, p: 3.5, y: 0 } },
    );
    const [two] = models;
    expect(two).toMatchObject({ follow_axes: ["H"], prepare_axes: ["H"], active_axes: ["H"] });
    for (const segment of two!.segments) {
      for (const piece of segment.coefficient_segments ?? []) expect(piece.a[1]).toBe(3.5);
    }
    expect(runtime).toEqual([
      {
        model_id: 2,
        plc_id: "1",
        device_id: 2,
        position_HPY: [1100, 3.5, 0],
        velocity_HPY: [0, 0, 0],
        standstill: true,
      },
    ]);
  });

  it("prepares a fixed axis that is away from its programmed value", () => {
    const sequence = sequenceOf([pose(2, 0, { v1: 1000, v2: 5 }), pose(2, 5000, { v1: 1500, v2: 5 })]);
    expect(build(sequence, { 2: { h: 1000, p: 0, y: 0 } }).models[0]).toMatchObject({
      follow_axes: ["H"],
      prepare_axes: ["H", "P"],
    });
    expect(build(sequence, { 2: { h: 1000, p: 5, y: 0 } }).models[0]).toMatchObject({
      follow_axes: ["H"],
      prepare_axes: ["H"],
    });
  });

  it("cuts original segments on whole milliseconds when preset poses land between them", () => {
    const third = 10000 / 6;
    const sequence = sequenceOf([
      pose(1, 0, { v1: 0 }),
      pose(1, third, { v1: 300 }),
      pose(1, third * 2, { v1: 0 }),
      pose(1, 5000, { v1: 200 }),
    ]);
    const { models, runtime } = build(sequence, { 1: { h: 150, p: 0, y: 0 } });
    const [single] = models;
    expect(single!.segments.map((segment) => [segment.start_frame, segment.end_frame])).toEqual([
      [0, 1667],
      [1667, 3333],
      [3333, 5000],
    ]);
    // 曲线仍在精确的位姿时间到达
    expect(stateAt(single!, third).positions[0]).toBeCloseTo(300, 6);
    const result = calculateNearestEntry({
      command: { trajectory_run: false, nearest_start: true, reverse: false, loop_count: 1 },
      settings: ALGORITHM_SETTINGS,
      models,
      runtime: { models: runtime },
    });
    expect(Number.isInteger(result.selected_curve_time_ms)).toBe(true);
  });

  it("holds a single pose placed at the very end from the first frame of the sequence", () => {
    const { models } = build(
      sequenceOf([pose(1, 0, { v1: 0 }), pose(1, 6000, { v1: 500 }), pose(2, 6000, { v1: 1300, v2: 2 })]),
    );
    const two = models[1]!;
    expect(two.segments.map((segment) => [segment.start_frame, segment.end_frame])).toEqual([[0, 6000]]);
    expect(stateAt(two, 0).positions).toEqual([1300, 2, 0]);
  });
});
