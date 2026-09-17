import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultAxisProfiles, sampleVelocityNorm } from "./motion-profile";
import { resolveActionSequence } from "./resolve-sequence";
import type { ActionSequenceConfig, AxisMotionProfiles, MotionProfile } from "./types";
import { evaluateResolvedSequence, interpolatePoseWithProfiles } from "./evaluate-sequence";

const trap = (accelMs = 200, decelMs = 200): MotionProfile => ({
  kind: "trapezoid",
  params: { accelMs, decelMs },
});

const axisProfiles = (accelMs: number, decelMs: number): AxisMotionProfiles => ({
  v1: trap(accelMs, decelMs),
  v2: trap(accelMs, decelMs),
  v3: trap(accelMs, decelMs),
});

type PreviewWindow = { csocketApi?: { enableModel: ReturnType<typeof vi.fn> } };

const previewWindow = globalThis as typeof globalThis & { window?: PreviewWindow };

const sequence: ActionSequenceConfig = {
  id: 1,
  name: "Seq",
  trajectoryMode: "non-forced",
  blocks: [
    {
      id: "start",
      kind: "pose",
      objectId: 7,
      atMs: 0,
      pose: { v1: 0, v2: 0, v3: 0 },
    },
    {
      id: "pose",
      kind: "pose",
      objectId: 7,
      atMs: 1000,
      pose: { v1: 1000, v2: 10, v3: 0 },
    },
  ],
  segments: [
    {
      fromRef: "start",
      toRef: "pose",
      settings: {
        profiles: createDefaultAxisProfiles(1000),
      },
    },
  ],
};

const timedPreviewSequence: ActionSequenceConfig = {
  id: 1,
  name: "Seq",
  trajectoryMode: "non-forced",
  blocks: [
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
  ],
  segments: [],
};

afterEach(() => {
  Reflect.deleteProperty(previewWindow, "window");
});

describe("evaluateResolvedSequence", () => {
  it("evaluates the same derived segment used by the timeline", () => {
    const resolved = resolveActionSequence(sequence);
    const poses = evaluateResolvedSequence(resolved, 500);
    expect(poses.get(7)).toEqual({ v1: 500, v2: 5, v3: 0 });
  });

  it("does not execute set-enabled while evaluating", () => {
    const enableModel = vi.fn();
    previewWindow.window = { csocketApi: { enableModel } };
    const resolved = resolveActionSequence({
      ...sequence,
      blocks: [
        ...sequence.blocks,
        { id: "enable", kind: "instruction",
      presetId: "set-enabled", objectId: 7, atMs: 250, instr: { enabled: true } },
      ],
    });
    evaluateResolvedSequence(resolved, 1000);
    expect(enableModel).not.toHaveBeenCalled();
  });

  it("holds the timed initial pose before its authored time", () => {
    const resolved = resolveActionSequence({
      id: 1,
      name: "Seq",
      trajectoryMode: "non-forced",
      blocks: [
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
      ],
      segments: [],
    });

    expect(evaluateResolvedSequence(resolved, 0).get(7)?.v1).toBe(30);
    expect(evaluateResolvedSequence(resolved, 2999).get(7)?.v1).toBe(30);
  });

  it("interpolates between adjacent poses from 3000 to 5000", () => {
    const resolved = resolveActionSequence(timedPreviewSequence);
    expect(evaluateResolvedSequence(resolved, 3000).get(7)?.v1).toBe(30);
    expect(evaluateResolvedSequence(resolved, 4000).get(7)?.v1).toBe(40);
    expect(evaluateResolvedSequence(resolved, 5000).get(7)?.v1).toBe(50);
  });

  it("holds the last pose after the last authored time", () => {
    const resolved = resolveActionSequence(timedPreviewSequence);
    expect(evaluateResolvedSequence(resolved, 5000).get(7)?.v1).toBe(50);
    expect(evaluateResolvedSequence(resolved, 5001).get(7)?.v1).toBe(50);
    expect(evaluateResolvedSequence(resolved, 8000).get(7)?.v1).toBe(50);
  });

  it("does not create a pose override for a command-only object", () => {
    const resolved = resolveActionSequence({
      id: "commands",
      name: "Commands",
      trajectoryMode: "non-forced",
      blocks: [
        { id: "enable", kind: "instruction",
      presetId: "set-enabled", objectId: 7, atMs: 1000, instr: { enabled: true } },
      ],
      segments: [],
    });
    expect(evaluateResolvedSequence(resolved, 1000).has(7)).toBe(false);
  });

  it("holds the final pose after the last segment", () => {
    const resolved = resolveActionSequence(sequence);
    expect(evaluateResolvedSequence(resolved, 1000).get(7)).toEqual({ v1: 1000, v2: 10, v3: 0 });
    expect(evaluateResolvedSequence(resolved, 2500).get(7)).toEqual({ v1: 1000, v2: 10, v3: 0 });
  });

  it("evaluates a 20/60/20 trapezoid between v1 0 and 1000 over 1000 ms", () => {
    const resolved = resolveActionSequence(sequence);
    expect(evaluateResolvedSequence(resolved, 100).get(7)?.v1).toBeCloseTo(31.25, 5);
    expect(evaluateResolvedSequence(resolved, 200).get(7)?.v1).toBeCloseTo(125, 5);
    expect(evaluateResolvedSequence(resolved, 800).get(7)?.v1).toBeCloseTo(875, 5);
    expect(evaluateResolvedSequence(resolved, 900).get(7)?.v1).toBeCloseTo(968.75, 5);
  });

  it("reaches each dynamic-wave sample exactly and restarts the next segment with acceleration", () => {
    const resolved = resolveActionSequence({
      id: 1,
      name: "Seq",
      trajectoryMode: "non-forced",
      blocks: [
        {
          id: "wave-1",
          kind: "dynamic-preset",
          presetId: "dynamic-wave",
          startMs: 1000,
          endMs: 3000,
          orderedObjectIds: [7, 8],
          params: {
            baseHeightMm: 1000,
            amplitudeMm: 500,
            cycles: 1,
            direction: 1,
            intervalDeg: 90,
          },
          profiles: axisProfiles(20, 20),
        },
      ],
      segments: [],
    });

    expect(evaluateResolvedSequence(resolved, 1500).get(7)?.v1).toBe(1500);

    const at1600 = evaluateResolvedSequence(resolved, 1600).get(7)?.v1 ?? 0;
    const restarted = evaluateResolvedSequence(resolved, 1510).get(7)?.v1;
    const linear = 1500 + (at1600 - 1500) * 0.1;
    expect(restarted).not.toBeCloseTo(linear, 1);
  });

  it("interpolates each axis with its own accel profile at the same tNorm", () => {
    const durationMs = 1000;
    const tNorm = 0.2;
    const from = { v1: 0, v2: 0, v3: 0 };
    const to = { v1: 1000, v2: 1000, v3: 0 };
    const profiles: AxisMotionProfiles = {
      v1: trap(100, 200),
      v2: trap(400, 200),
      v3: trap(200, 200),
    };

    expect(sampleVelocityNorm(profiles.v1, tNorm, durationMs)).toBe(1);
    expect(sampleVelocityNorm(profiles.v2, tNorm, durationMs)).toBeLessThan(1);

    const pose = interpolatePoseWithProfiles(from, to, profiles, tNorm, durationMs);
    expect(pose.v1).toBeGreaterThan(pose.v2);
    expect(pose.v3).toBe(0);

    const resolved = resolveActionSequence({
      id: 1,
      name: "Seq",
      trajectoryMode: "non-forced",
      blocks: [
        { id: "start", kind: "pose", objectId: 7, atMs: 0, pose: from },
        { id: "end", kind: "pose", objectId: 7, atMs: durationMs, pose: to },
      ],
      segments: [{ fromRef: "start", toRef: "end", settings: { profiles } }],
    });
    expect(evaluateResolvedSequence(resolved, durationMs * tNorm).get(7)).toEqual(pose);
  });
});
