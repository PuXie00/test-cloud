import { describe, expect, it } from "vitest";
import { compilePlcAction } from "./compile-plc-action";
import { axisMoveCommands } from "./move-commands";
import { objectAxisMotions, resolveActionSequence } from "./resolve-sequence";
import { createDefaultAxisProfiles } from "./motion-profile";
import type { ActionSequenceConfig, AxisMotionProfiles, DynamicPresetBlock, ModelPose, MotionProfile, TimelineBlock } from "./types";
import type { AxisLimit, VirtualAxisId } from "./validate-sequence";

const origin: ModelPose = { v1: 0, v2: 0, v3: 0 };

const trap = (accelMs: number, decelMs: number): MotionProfile => ({
  kind: "trapezoid",
  params: { accelMs, decelMs },
});

const axisProfiles = (accelMs: number, decelMs: number): AxisMotionProfiles => ({
  v1: trap(accelMs, decelMs),
  v2: trap(accelMs, decelMs),
  v3: trap(accelMs, decelMs),
});

const unlimitedAxis = (): AxisLimit => ({
  min: -1_000_000,
  max: 1_000_000,
  maxVelocity: 1_000_000,
  minAccelTime: 0.001,
});

const limitsFor = (axes: readonly VirtualAxisId[]) =>
  Object.fromEntries(axes.map((axis) => [axis, unlimitedAxis()])) as Partial<
    Record<VirtualAxisId, AxisLimit>
  >;

const compileContext = (
  objects: { id: number; enabledVirtualAxes: readonly VirtualAxisId[] }[],
) => ({
  objects: objects.map((object) => ({
    ...object,
    limits: limitsFor(object.enabledVirtualAxes),
  })),
});

const sequenceOf = (
  blocks: TimelineBlock[],
  extra?: Partial<ActionSequenceConfig>,
): ActionSequenceConfig => ({
  id: 1,
  name: "Seq",
  trajectoryMode: false,
  blocks,
  segments: [],
  ...extra,
});

const threeAxisContext = compileContext(
  [{ id: 7, enabledVirtualAxes: ["v1", "v2", "v3"] as const }],
);

const laterInitialSequence: ActionSequenceConfig = sequenceOf(
  [
    {
      id: "first",
      kind: "pose",
      objectId: 7,
      atMs: 3000,
      pose: { v1: 30, v2: 0, v3: 0 },
    },
    {
      id: "second",
      kind: "pose",
      objectId: 7,
      atMs: 5000,
      pose: { v1: 50, v2: 0, v3: 0 },
    },
    { id: "disable", kind: "instruction",
      presetId: "set-enabled", objectId: 7, atMs: 500, instr: { enabled: false } },
  ],
  {
    trajectoryMode: true,
    segments: [{
      fromRef: "first",
      toRef: "second",
      settings: { profiles: axisProfiles(400, 400) },
    }],
  },
);

describe("compilePlcAction", () => {
  it("maps v1/v2/v3 to virtualAxisNo 1/2/3 and omits disabled axes", () => {
    const compiled = compilePlcAction(
      laterInitialSequence,
      compileContext([{ id: 7, enabledVirtualAxes: ["v1"] as const }]),
    );
    expect(compiled).not.toHaveProperty("checksum");
    expect(compiled).not.toHaveProperty("trajectoryMode");
    expect(compiled.timelines).toHaveLength(1);
    expect(compiled.timelines[0]?.virtualAxisNo).toBe(1);
    expect(compiled.timelines[0]?.modelId).toBe(7);
    expect(compiled.timelines[0]?.segments.length).toBeGreaterThan(0);
  });

  it("emits enableFlag io blocks", () => {
    const compiled = compilePlcAction(laterInitialSequence, threeAxisContext);
    expect(compiled.ioBlocks).toContainEqual({
      time: 500,
      params: {
        OptCmd: "Operation|enable",
        addr: "0x0102",
        params: [{ deviceId: 7, enableFlag: 0 }],
      },
    });
  });

  it("starts the first moving segment at the first pose time", () => {
    const compiled = compilePlcAction(laterInitialSequence, threeAxisContext);
    const v1 = compiled.timelines.find((timeline) => timeline.virtualAxisNo === 1);
    expect(v1?.segments[0]?.startTime).toBe(3000);
  });

  it("emits one hold row per enabled axis for a single pose", () => {
    const compiled = compilePlcAction(
      sequenceOf([{
        id: "only",
        kind: "pose",
        objectId: 7,
        atMs: 4000,
        pose: { v1: 42, v2: 1, v3: 2 },
      }]),
      threeAxisContext,
    );
    expect(compiled.timelines).toHaveLength(3);
    const byAxis = Object.fromEntries(
      compiled.timelines.map((timeline) => [timeline.virtualAxisNo, timeline.segments]),
    );
    expect(byAxis[1]).toEqual([
      { startTime: 4000, position: 42, a: 42, b: 0, c: 0, d: 0, e: 0, f: 0 },
    ]);
    expect(byAxis[2]?.[0]?.position).toBe(1);
    expect(byAxis[3]?.[0]?.position).toBe(2);
  });

  it("keeps hold-row position and sets A to the same value", () => {
    const compiled = compilePlcAction(
      sequenceOf([{
        id: "only",
        kind: "pose",
        objectId: 7,
        atMs: 4000,
        pose: { v1: 42.16, v2: 1.24, v3: 2 },
      }]),
      threeAxisContext,
    );
    const byAxis = Object.fromEntries(
      compiled.timelines.map((timeline) => [timeline.virtualAxisNo, timeline.segments[0]]),
    );
    expect(byAxis[1]).toMatchObject({ position: 42.16, a: 42.16 });
    expect(byAxis[2]).toMatchObject({ position: 1.24, a: 1.24 });
    expect(byAxis[3]).toMatchObject({ position: 2, a: 2 });
  });

  it("compiles a command-only sequence with io blocks and no timelines or models", () => {
    const compiled = compilePlcAction(
      sequenceOf([{
        id: "enable",
        kind: "instruction",
        presetId: "set-enabled",
        objectId: 7,
        atMs: 1000,
        instr: { enabled: true },
      }]),
      threeAxisContext,
    );
    expect(compiled.timelines).toEqual([]);
    expect(compiled.models).toEqual([]);
    expect(compiled.ioBlocks).toEqual([{
      time: 1000,
      params: {
        OptCmd: "Operation|enable",
        addr: "0x0102",
        params: [{ deviceId: 7, enableFlag: 1 }],
      },
    }]);
  });

  it("uses three phase rows whose startTimes match accel/cruise/decel", () => {
    const sequence = sequenceOf(
      [
        { id: "start", kind: "pose", objectId: 7, atMs: 1000, pose: origin },
        { id: "end", kind: "pose", objectId: 7, atMs: 2000, pose: { v1: 1000, v2: 0, v3: 0 } },
      ],
      {
        segments: [{
          fromRef: "start",
          toRef: "end",
          settings: { profiles: axisProfiles(150, 250) },
        }],
      },
    );
    const compiled = compilePlcAction(
      sequence,
      compileContext([{ id: 7, enabledVirtualAxes: ["v1"] as const }]),
    );
    const segments = compiled.timelines[0]?.segments ?? [];
    expect(segments).toHaveLength(4);
    expect(segments[0]?.startTime).toBe(1000);
    expect(segments[1]?.startTime).toBe(1150);
    expect(segments[2]?.startTime).toBe(1750);
    expect(segments[3]).toEqual({
      startTime: 2000,
      position: 1000,
      a: 1000,
      b: 0,
      c: 0,
      d: 0,
      e: 0,
      f: 0,
    });
  });

  it("matches the model-6 PLC polynomial for 0-1000-0 over 20000ms", () => {
    const idle = { kind: "idle" as const };
    const moving = trap(1000, 1000);
    const profiles = { v1: moving, v2: idle, v3: idle };
    const sequence = sequenceOf(
      [
        { id: "a", kind: "pose", objectId: 6, atMs: 0, pose: origin },
        { id: "b", kind: "pose", objectId: 6, atMs: 10000, pose: { v1: 1000, v2: 0, v3: 0 } },
        { id: "c", kind: "pose", objectId: 6, atMs: 20000, pose: origin },
      ],
      {
        segments: [
          { fromRef: "a", toRef: "b", settings: { profiles } },
          { fromRef: "b", toRef: "c", settings: { profiles } },
        ],
      },
    );
    const compiled = compilePlcAction(
      sequence,
      compileContext([{ id: 6, enabledVirtualAxes: ["v1", "v2", "v3"] as const }]),
    );
    expect(compiled.totalDuration).toBe(20000);
    const byAxis = Object.fromEntries(
      compiled.timelines.map((timeline) => [timeline.virtualAxisNo, timeline.segments]),
    );
    const h = byAxis[1] ?? [];
    expect(h).toHaveLength(7);
    expect(h.map((row) => row.startTime)).toEqual([0, 1000, 9000, 10000, 11000, 19000, 20000]);
    expect(h[0]?.c).toBeCloseTo(0.5555556, 6);
    expect(h[1]?.position).toBeCloseTo(55.5555556, 6);
    expect(h[1]?.a).toBe(h[1]?.position);
    expect(h[1]?.b).toBeCloseTo(11.1111111, 6);
    expect(h[2]?.position).toBeCloseTo(944.4444444, 6);
    expect(h[2]?.b).toBeCloseTo(11.1111111, 6);
    expect(h[2]?.c).toBeCloseTo(-0.5555556, 6);
    expect(h[3]).toMatchObject({ position: 1000, a: 1000, b: 0 });
    expect(h[3]?.c).toBeCloseTo(-0.5555556, 6);
    expect(h[4]?.position).toBeCloseTo(944.4444444, 6);
    expect(h[4]?.b).toBeCloseTo(-11.1111111, 6);
    expect(h[5]?.position).toBeCloseTo(55.5555556, 6);
    expect(h[5]?.b).toBeCloseTo(-11.1111111, 6);
    expect(h[5]?.c).toBeCloseTo(0.5555556, 6);
    expect(h[6]).toMatchObject({ position: 0, a: 0, b: 0, c: 0 });
    for (const axis of [2, 3]) {
      expect(byAxis[axis]).toEqual([
        { startTime: 0, position: 0, a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 },
        { startTime: 20000, position: 0, a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 },
      ]);
    }
  });

  describe("an object that finishes before the sequence ends", () => {
    /** PLC 每一行一直算到下一行开始；t 的单位是 100ms */
    const positionAt = (rows: readonly { startTime: number; a: number; b: number; c: number }[], frameMs: number) => {
      const row = [...rows].reverse().find((item) => item.startTime <= frameMs)!;
      const t = (frameMs - row.startTime) / 100;
      return row.a + row.b * t + row.c * t * t;
    };
    const twoObjects = compileContext([
      { id: 7, enabledVirtualAxes: ["v1"] as const },
      { id: 8, enabledVirtualAxes: ["v1"] as const },
    ]);
    const endsEarly = (blocks: TimelineBlock[]) =>
      sequenceOf([
        { id: "a", kind: "pose", objectId: 7, atMs: 0, pose: origin },
        { id: "b", kind: "pose", objectId: 7, atMs: 4000, pose: { v1: 400, v2: 0, v3: 0 } },
        ...blocks,
      ]);

    it("holds its last pose instead of extending the last curve row", () => {
      const compiled = compilePlcAction(
        endsEarly([
          { id: "c", kind: "pose", objectId: 8, atMs: 0, pose: origin },
          { id: "d", kind: "pose", objectId: 8, atMs: 8000, pose: { v1: 400, v2: 0, v3: 0 } },
        ]),
        twoObjects,
      );
      const rows = compiled.timelines.find((timeline) => timeline.modelId === 7)!.segments;
      expect(rows.slice(-2)).toEqual([
        { startTime: 4000, position: 400, a: 400, b: 0, c: 0, d: 0, e: 0, f: 0 },
        { startTime: 8000, position: 400, a: 400, b: 0, c: 0, d: 0, e: 0, f: 0 },
      ]);
      for (const frameMs of [4000, 5000, 6500, 7999]) {
        expect(positionAt(rows, frameMs)).toBeCloseTo(400, 6);
      }
      // 一直跑到总时长的物体不加保持行
      const longest = compiled.timelines.find((timeline) => timeline.modelId === 8)!.segments;
      expect(longest.filter((row) => row.b === 0 && row.c === 0).map((row) => row.startTime)).toEqual([8000]);
    });

    it("holds until a later instruction block ends the sequence", () => {
      const compiled = compilePlcAction(
        endsEarly([
          { id: "on", kind: "instruction", presetId: "set-enabled", objectId: 7, atMs: 6000, instr: { enabled: true } },
        ]),
        compileContext([{ id: 7, enabledVirtualAxes: ["v1"] as const }]),
      );
      const rows = compiled.timelines[0]!.segments;
      expect(rows.slice(-2).map((row) => [row.startTime, row.position, row.b, row.c])).toEqual([
        [4000, 400, 0, 0],
        [6000, 400, 0, 0],
      ]);
      expect(positionAt(rows, 5999)).toBeCloseTo(400, 6);
    });
  });

  it("throws when a timeline exceeds 100 segments", () => {
    const poseCount = 36;
    const blocks = Array.from({ length: poseCount }, (_, index) => ({
      id: `p${index}`,
      kind: "pose" as const,
      objectId: 7,
      atMs: index * 1000,
      pose: { v1: index, v2: 0, v3: 0 },
    }));
    const segments = Array.from({ length: poseCount - 1 }, (_, index) => ({
      fromRef: `p${index}`,
      toRef: `p${index + 1}`,
      settings: { profiles: axisProfiles(200, 200) },
    }));
    expect(() =>
      compilePlcAction(
        sequenceOf(blocks, { segments }),
        compileContext([{ id: 7, enabledVirtualAxes: ["v1"] as const }]),
      ),
    ).toThrow(/100/);
  });

  it("writes each move on the frame after it is sent: 0 → 1000 (10s) → 0 (20s)", () => {
    const sequence = sequenceOf(
      [
        { id: "a", kind: "pose", objectId: 7, atMs: 0, pose: origin },
        { id: "b", kind: "pose", objectId: 7, atMs: 10_000, pose: { v1: 1000, v2: 0, v3: 0 } },
        { id: "c", kind: "pose", objectId: 7, atMs: 20_000, pose: origin },
      ],
      {
        segments: [
          { fromRef: "a", toRef: "b", settings: { profiles: axisProfiles(1000, 1000) } },
          { fromRef: "b", toRef: "c", settings: { profiles: axisProfiles(1000, 1000) } },
        ],
      },
    );
    const objects = compileContext([{ id: 7, enabledVirtualAxes: ["v1", "v2", "v3"] as const }]);
    const idle = { vel: 0, accVel: 0, decVel: 0, passVel: 0 };
    // 匀速 1000 / (10 - 1) = 111.111，加减速 111.111 / 1（向上取整）
    const move = (pos: number) => ({ pos, vel: 111.111, accVel: 111.112, decVel: 111.112, passVel: 0 });
    // 正向：C++ 在每一帧取下一帧下发
    expect(compilePlcAction(sequence, objects).models[0]!.timeBlockList).toEqual([
      { time: 0, virtualAxis: [{ pos: 0, ...idle }, { pos: 0, ...idle }, { pos: 0, ...idle }] },
      { time: 10_000, virtualAxis: [move(1000), { pos: 0, ...idle }, { pos: 0, ...idle }] },
      { time: 20_000, virtualAxis: [move(0), { pos: 0, ...idle }, { pos: 0, ...idle }] },
    ]);
    // 反向：C++ 从 20s 往回，每一帧取上一帧下发
    expect(compilePlcAction(sequence, objects, true).models[0]!.timeBlockList).toEqual([
      { time: 0, virtualAxis: [move(0), { pos: 0, ...idle }, { pos: 0, ...idle }] },
      { time: 10_000, virtualAxis: [move(1000), { pos: 0, ...idle }, { pos: 0, ...idle }] },
      { time: 20_000, virtualAxis: [{ pos: 0, ...idle }, { pos: 0, ...idle }, { pos: 0, ...idle }] },
    ]);
  });

  it("puts a single span's move on its end frame, and on its start frame when reversed", () => {
    const sequence = sequenceOf(
      [
        { id: "start", kind: "pose", objectId: 7, atMs: 1000, pose: origin },
        { id: "end", kind: "pose", objectId: 7, atMs: 2000, pose: { v1: 1000, v2: 0, v3: 0 } },
      ],
      {
        segments: [{
          fromRef: "start",
          toRef: "end",
          settings: { profiles: axisProfiles(150, 250) },
        }],
      },
    );
    const objects = compileContext([{ id: 7, enabledVirtualAxes: ["v1"] as const }]);
    const idle = { vel: 0, accVel: 0, decVel: 0, passVel: 0 };
    // 匀速 1000 / (1 - 0.075 - 0.125) = 1250，加速 1250 / 0.15，减速 1250 / 0.25
    expect(compilePlcAction(sequence, objects).models).toEqual([{
      deviceId: 7,
      timeBlockList: [
        { time: 1000, virtualAxis: [{ pos: 0, ...idle }] },
        { time: 2000, virtualAxis: [{ pos: 1000, vel: 1250, accVel: 8333.334, decVel: 5000, passVel: 0 }] },
      ],
    }]);
    // 倒走：原来的减速段变成加速段
    expect(compilePlcAction(sequence, objects, true).models).toEqual([{
      deviceId: 7,
      timeBlockList: [
        { time: 1000, virtualAxis: [{ pos: 0, vel: 1250, accVel: 5000, decVel: 8333.334, passVel: 0 }] },
        { time: 2000, virtualAxis: [{ pos: 1000, ...idle }] },
      ],
    }]);
  });

  it("omits disabled axes from C++ virtualAxis", () => {
    const compiled = compilePlcAction(
      laterInitialSequence,
      compileContext([{ id: 7, enabledVirtualAxes: ["v1"] as const }]),
    );
    expect(compiled.models[0]?.timeBlockList[0]?.virtualAxis).toHaveLength(1);
  });

  it("fills frames without a move with the axis value and zero speed", () => {
    const sequence = sequenceOf([
      { id: "a", kind: "pose", objectId: 7, atMs: 0, pose: origin },
      { id: "b", kind: "pose", objectId: 7, atMs: 1000, pose: { v1: 100, v2: 0, v3: 0 } },
      { id: "c", kind: "pose", objectId: 7, atMs: 2000, pose: { v1: 100, v2: 10, v3: 0 } },
    ]);
    const compiled = compilePlcAction(
      sequence,
      compileContext([{ id: 7, enabledVirtualAxes: ["v1", "v2"] as const }]),
    );
    const idle = { vel: 0, accVel: 0, decVel: 0, passVel: 0 };
    const blocks = compiled.models[0]!.timeBlockList;
    expect(blocks.map((block) => block.time)).toEqual([0, 1000, 2000]);
    expect(blocks[0]?.virtualAxis).toEqual([{ pos: 0, ...idle }, { pos: 0, ...idle }]);
    expect(blocks[1]?.virtualAxis[0]).toMatchObject({ pos: 100, passVel: 0 });
    expect(blocks[1]?.virtualAxis[1]).toEqual({ pos: 0, ...idle });
    expect(blocks[2]?.virtualAxis[0]).toEqual({ pos: 100, ...idle });
    expect(blocks[2]?.virtualAxis[1]).toMatchObject({ pos: 10, passVel: 0 });
  });

  it("keeps the pass-through frame, and fills an uncontrolled axis with its live value", () => {
    const sequence = sequenceOf([
      { id: "a", kind: "pose", objectId: 7, atMs: 0, pose: { v1: 0, v2: 0 } },
      { id: "b", kind: "pose", objectId: 7, atMs: 1000, pose: { v2: 10 } },
      { id: "c", kind: "pose", objectId: 7, atMs: 2000, pose: { v1: 200, v2: 10 } },
    ]);
    const compiled = compilePlcAction(sequence, {
      ...compileContext([{ id: 7, enabledVirtualAxes: ["v1", "v2", "v3"] as const }]),
      livePoseByObjectId: new Map([[7, { v1: 5, v2: 6, v3: 7.25 }]]),
    });
    const blocks = compiled.models[0]!.timeBlockList;
    expect(blocks.map((block) => block.time)).toEqual([0, 1000, 2000]);
    // v1 在 1000 处经过不停：0s 下发一条到 200 的 move，写在 1000 帧；2000 帧不再下发
    expect(blocks[1]?.virtualAxis[0]).toMatchObject({ pos: 200, passVel: 0 });
    expect(blocks[1]?.virtualAxis[1]).toMatchObject({ pos: 10, passVel: 0 });
    expect(blocks[2]?.virtualAxis[0]).toEqual({ pos: 200, vel: 0, accVel: 0, decVel: 0, passVel: 0 });
    // v3 序列不控制：每一帧都是实时值
    expect(blocks.map((block) => block.virtualAxis[2])).toEqual(
      blocks.map(() => ({ pos: 7.3, vel: 0, accVel: 0, decVel: 0, passVel: 0 })),
    );
  });

  it("keeps every wave keyframe, with one move per stroke", () => {
    const wave: DynamicPresetBlock = {
      id: "wave-1",
      kind: "dynamic-preset",
      presetId: "dynamic-wave",
      startMs: 1000,
      endMs: 3000,
      orderedObjectIds: [7, 8],
      params: {
        baseV1: 1000,
        amplitude: 500,
        cycles: 1,
        direction: 1,
        staggerMs: 500,
        v2: 0,
        v3: 0,
      },
      profiles: createDefaultAxisProfiles(750),
    };
    const compiled = compilePlcAction(
      sequenceOf([wave]),
      compileContext([
        { id: 7, enabledVirtualAxes: ["v1"] as const },
        { id: 8, enabledVirtualAxes: ["v1"] as const },
      ]),
    );
    const frames = (deviceId: number) =>
      compiled.models
        .find((model) => model.deviceId === deviceId)
        ?.timeBlockList.map((block) => [block.time, block.virtualAxis[0]?.pos, block.virtualAxis[0]?.vel === 0]);
    expect(frames(7)).toEqual([
      [1000, 1000, true],
      [1750, 1500, false],
      [2500, 1000, false],
      [3000, 1000, true],
    ]);
    expect(frames(8)?.filter(([, , idle]) => !idle).map(([, pos]) => pos)).toEqual([1500, 1000]);
  });

  it("decodes back to the verified move commands with C++'s frame rule", () => {
    const pose = (id: string, atMs: number, v1: number, passSpeed?: number) => ({
      id,
      kind: "pose" as const,
      objectId: 7,
      atMs,
      pose: { v1 },
      ...(passSpeed !== undefined ? { passSpeeds: { v1: passSpeed } } : {}),
    });
    const sequences = [
      sequenceOf([pose("p0", 0, 0), pose("p1", 4000, 400), pose("p2", 6000, 1000), pose("p3", 8000, 1700), pose("p4", 10000, 1900)]),
      sequenceOf([pose("p0", 0, 0), pose("p1", 1100, 1000), pose("p2", 1800, 1500), pose("p3", 3000, 1500), pose("p4", 5000, -300, 0)]),
      sequenceOf([pose("p0", 0, 0), pose("p1", 2000, 500), pose("p2", 6000, -500), pose("p3", 8000, 0)], { loop: true }),
    ];
    const objects = compileContext([{ id: 7, enabledVirtualAxes: ["v1"] as const }]);
    for (const sequence of sequences) {
      for (const reverse of [false, true]) {
        const frames = compilePlcAction(sequence, objects, reverse).models[0]!.timeBlockList;
        // 正向：在第 i 帧下发第 i + 1 帧；反向：在第 i 帧下发第 i - 1 帧；vel 为 0 不下发
        const decoded = frames.flatMap((frame, index) => {
          const source = frames[reverse ? index - 1 : index + 1]?.virtualAxis[0];
          if (!source || source.vel === 0) return [];
          return [{
            atMs: frame.time,
            target: source.pos,
            velocity: source.vel,
            acceleration: source.accVel,
            deceleration: source.decVel,
            passSpeed: source.passVel,
          }];
        });
        const resolved = resolveActionSequence(sequence);
        const expected = axisMoveCommands(objectAxisMotions(resolved.segments, "v1"), { reverse }).map(({ adjusted: _adjusted, ...command }) => command);
        expect(decoded).toEqual(expected);
      }
    }
  });

  it("throws when compiling an unsupported C++ motion profile", () => {
    const sequence = sequenceOf(
      [
        { id: "start", kind: "pose", objectId: 7, atMs: 0, pose: origin },
        { id: "end", kind: "pose", objectId: 7, atMs: 1000, pose: { v1: 10, v2: 0, v3: 0 } },
      ],
      {
        segments: [{
          fromRef: "start",
          toRef: "end",
          settings: {
            profiles: {
              v1: { kind: "cubic" } as unknown as MotionProfile,
              v2: { kind: "idle" },
              v3: { kind: "idle" },
            },
          },
        }],
      },
    );
    expect(() =>
      compilePlcAction(
        sequence,
        compileContext([{ id: 7, enabledVirtualAxes: ["v1"] as const }]),
      ),
    ).toThrow(/unsupported motion profile: cubic|sequence has blocking validation issues/);
  });
});
