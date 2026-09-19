import { describe, expect, it } from "vitest";
import { createDefaultAxisProfiles } from "./motion-profile";
import { fitPresetParams, type PresetParticipantLimits } from "./preset-defaults";
import { countPosesPerObject, dynamicPresetProfileDurationMs, resolvePreset } from "./preset-registry";
import type { DynamicPresetBlock, StaticPresetBlock } from "./types";
import { validateActionSequence } from "./validate-sequence";

const hoist = (id: number): PresetParticipantLimits => ({
  id,
  rangeByAxis: { v1: { min: 0, max: 1000 }, v2: { min: -20, max: 20 }, v3: { min: -20, max: 20 } },
  maxSpeedByAxis: { v1: 500 },
  minAccelTimeByAxis: { v1: 1 },
});

const participants = [hoist(7), hoist(8)];

const context = {
  objects: participants.map((item) => ({
    id: item.id,
    enabledVirtualAxes: ["v1" as const],
    limits: {
      v1: {
        min: 0,
        max: 1000,
        maxVelocity: 500,
        minAccelTime: 1,
      },
    },
  })),
};

describe("fitPresetParams", () => {
  it("does not write v2 or v3 into fitted params", () => {
    for (const presetId of [
      "static-flat",
      "static-slope",
      "static-arc",
      "static-wave",
      "dynamic-level",
      "dynamic-wave",
    ] as const) {
      const fitted = fitPresetParams(presetId, participants);
      expect(fitted, presetId).not.toBeNull();
      expect(fitted!.params, presetId).not.toHaveProperty("v2");
      expect(fitted!.params, presetId).not.toHaveProperty("v3");
    }
  });

  it("keeps static-wave poses inside the shared v1 range", () => {
    const fitted = fitPresetParams("static-wave", participants);
    expect(fitted).not.toBeNull();
    const block: StaticPresetBlock = {
      id: "sw",
      kind: "static-preset",
      presetId: "static-wave",
      atMs: 0,
      orderedObjectIds: [7, 8],
      params: fitted!.params,
    };
    const points = resolvePreset(block);
    expect([...countPosesPerObject(points).values()]).toEqual([1, 1]);
    expect(points.every((point) => point.pose.v1 >= 0 && point.pose.v1 <= 1000)).toBe(true);
    expect(
      validateActionSequence(
        { id: 1, name: "Seq", trajectoryMode: "non-forced", blocks: [block], segments: [] },
        context,
      ).filter((issue) => issue.severity === "error"),
    ).toEqual([]);
  });

  it("fits dynamic-wave duration and stagger phases so generated poses pass validation", () => {
    const fitted = fitPresetParams("dynamic-wave", participants);
    expect(fitted).not.toBeNull();
    expect(fitted!.durationMs).toBeGreaterThanOrEqual(3000);
    expect(fitted!.params).toMatchObject({ cycles: 1, direction: 1 });
    expect(fitted!.params.staggerMs).toBeGreaterThan(0);
    const block: DynamicPresetBlock = {
      id: "dw",
      kind: "dynamic-preset",
      presetId: "dynamic-wave",
      startMs: 0,
      endMs: fitted!.durationMs,
      orderedObjectIds: [7, 8],
      params: fitted!.params,
      profiles: createDefaultAxisProfiles(
        dynamicPresetProfileDurationMs({
          presetId: "dynamic-wave",
          startMs: 0,
          endMs: fitted!.durationMs,
          orderedObjectIds: [7, 8],
          params: fitted!.params,
        }),
        { v1: 1 },
      ),
    };
    const points = resolvePreset(block);
    expect(countPosesPerObject(points).get(7)).toBeGreaterThanOrEqual(2);
    expect(points.every((point) => point.pose.v1 >= 0 && point.pose.v1 <= 1000)).toBe(true);
    expect(
      validateActionSequence(
        { id: 1, name: "Seq", trajectoryMode: "non-forced", blocks: [block], segments: [] },
        context,
      ).filter((issue) => issue.severity === "error"),
    ).toEqual([]);
  });

  it("keeps a fitted dynamic-wave valid after stretching duration by 100ms", () => {
    const fitted = fitPresetParams("dynamic-wave", participants);
    expect(fitted).not.toBeNull();
    const originalEndMs = fitted!.durationMs;
    const block: DynamicPresetBlock = {
      id: "dw-stretch",
      kind: "dynamic-preset",
      presetId: "dynamic-wave",
      startMs: 0,
      endMs: originalEndMs + 100,
      orderedObjectIds: [7, 8],
      params: fitted!.params,
      profiles: createDefaultAxisProfiles(
        dynamicPresetProfileDurationMs({
          presetId: "dynamic-wave",
          startMs: 0,
          endMs: originalEndMs,
          orderedObjectIds: [7, 8],
          params: fitted!.params,
        }),
        { v1: 1 },
      ),
    };
    expect(
      validateActionSequence(
        { id: 1, name: "Seq", trajectoryMode: "non-forced", blocks: [block], segments: [] },
        context,
      ).filter((issue) => issue.severity === "error"),
    ).toEqual([]);
  });

  it("fits dynamic-level to two poses per object inside limits", () => {
    const fitted = fitPresetParams("dynamic-level", participants);
    expect(fitted).not.toBeNull();
    const block: DynamicPresetBlock = {
      id: "dl",
      kind: "dynamic-preset",
      presetId: "dynamic-level",
      startMs: 0,
      endMs: fitted!.durationMs,
      orderedObjectIds: [7, 8],
      params: fitted!.params,
      profiles: createDefaultAxisProfiles(fitted!.durationMs, { v1: 1 }),
    };
    expect([...countPosesPerObject(resolvePreset(block)).values()]).toEqual([2, 2]);
    expect(
      validateActionSequence(
        { id: 1, name: "Seq", trajectoryMode: "non-forced", blocks: [block], segments: [] },
        context,
      ).filter((issue) => issue.severity === "error"),
    ).toEqual([]);
  });

  it("reports limit-exceeded when the user enlarges amplitude past the range", () => {
    const fitted = fitPresetParams("static-wave", participants);
    expect(fitted).not.toBeNull();
    const block: StaticPresetBlock = {
      id: "sw-bad",
      kind: "static-preset",
      presetId: "static-wave",
      atMs: 0,
      orderedObjectIds: [7, 8],
      params: { ...fitted!.params, amplitude: 2000 },
    };
    expect(
      validateActionSequence(
        { id: 1, name: "Seq", trajectoryMode: "non-forced", blocks: [block], segments: [] },
        context,
      ).some((issue) => issue.code === "limit-exceeded" && issue.blockId === "sw-bad"),
    ).toBe(true);
  });
});
