import { describe, expect, it } from "vitest";
import { createDefaultAxisProfiles } from "./motion-profile";
import {
  countPosesPerObject,
  getPresetDefinition,
  listPresetDefinitions,
  resolvePreset,
} from "./preset-registry";
import type { DynamicPresetBlock, StaticPresetBlock } from "./types";

const slopeBlock = (): StaticPresetBlock => ({
  id: "preset-1",
  kind: "static-preset",
  presetId: "static-slope",
  atMs: 1000,
  orderedObjectIds: [9, 7, 8],
  params: { baseV1: 1000, stepV1: 250, v2: 0, v3: 0 },
});

const waveBlock = (): DynamicPresetBlock => ({
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
});

describe("preset registry", () => {
  it("uses explicit participant order for a static slope", () => {
    const points = resolvePreset({
      id: "preset-1",
      kind: "static-preset",
      presetId: "static-slope",
      atMs: 1000,
      orderedObjectIds: [9, 7, 8],
      params: { baseV1: 1000, stepV1: 250, v2: 0, v3: 0 },
    });
    expect(points.map(({ objectId, pose }) => [objectId, pose.v1])).toEqual([
      [9, 1000],
      [7, 1250],
      [8, 1500],
    ]);
  });

  it("generates stable dynamic wave references", () => {
    const block = {
      id: "wave-1",
      kind: "dynamic-preset" as const,
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
      profiles: createDefaultAxisProfiles(2000),
    };
    expect(resolvePreset(block)).toEqual(resolvePreset(structuredClone(block)));
    expect(resolvePreset(block)[0]?.sourceRef).toBe("preset:wave-1:7:0");
  });

  it("does not reorder slope participants by id", () => {
    const forward = resolvePreset(slopeBlock());
    const reversed = resolvePreset({
      ...slopeBlock(),
      orderedObjectIds: [8, 7, 9],
    });
    expect(forward.map((point) => point.objectId)).toEqual([9, 7, 8]);
    expect(reversed.map((point) => [point.objectId, point.pose.v1])).toEqual([
      [8, 1000],
      [7, 1250],
      [9, 1500],
    ]);
  });

  it("keeps a static flat pose identical across participant order", () => {
    const block: StaticPresetBlock = {
      id: "flat-1",
      kind: "static-preset",
      presetId: "static-flat",
      atMs: 400,
      orderedObjectIds: [11, 5],
      params: { v1: 200, v2: 3, v3: -4 },
    };
    const points = resolvePreset(block);
    expect(points.map((point) => [point.objectId, point.atMs, point.pose, point.sourceRef])).toEqual([
      [11, 400, { v1: 200, v2: 0, v3: 0 }, "preset:flat-1:11:0"],
      [5, 400, { v1: 200, v2: 0, v3: 0 }, "preset:flat-1:5:0"],
    ]);
  });

  it("places the static-arc peak on the middle participant in order", () => {
    const block: StaticPresetBlock = {
      id: "arc-1",
      kind: "static-preset",
      presetId: "static-arc",
      atMs: 50,
      orderedObjectIds: [4, 5, 6],
      params: { baseV1: 1000, amplitude: 500, v2: 1, v3: 2 },
    };
    const forward = resolvePreset(block);
    expect(forward.map((point) => [point.objectId, point.pose.v2, point.pose.v3])).toEqual([
      [4, 0, 0],
      [5, 0, 0],
      [6, 0, 0],
    ]);
    expect(forward[0]?.pose.v1).toBeCloseTo(1000, 10);
    expect(forward[1]?.pose.v1).toBeCloseTo(1500, 10);
    expect(forward[2]?.pose.v1).toBeCloseTo(1000, 10);
    const reversed = resolvePreset({ ...block, orderedObjectIds: [6, 5, 4] });
    expect(reversed.map((point) => point.objectId)).toEqual([6, 5, 4]);
    expect(reversed[1]?.pose.v1).toBeCloseTo(1500, 10);
    expect(reversed[0]?.pose.v1).toBeCloseTo(1000, 10);
    expect(reversed[2]?.pose.v1).toBeCloseTo(1000, 10);
  });

  it("applies static-wave phase along participant order, not id", () => {
    const block: StaticPresetBlock = {
      id: "sw-1",
      kind: "static-preset",
      presetId: "static-wave",
      atMs: 10,
      orderedObjectIds: [9, 2],
      params: {
        baseV1: 1000,
        amplitude: 500,
        phaseDeg: 0,
        intervalDeg: 90,
        v2: 0,
        v3: 0,
      },
    };
    const forward = resolvePreset(block);
    expect(forward.map((point) => [point.objectId, point.pose.v1])).toEqual([
      [9, 1000],
      [2, 1500],
    ]);
    const reversed = resolvePreset({ ...block, orderedObjectIds: [2, 9] });
    expect(reversed.map((point) => [point.objectId, point.pose.v1])).toEqual([
      [2, 1000],
      [9, 1500],
    ]);
  });

  it("emits dynamic-level start and end poses at block boundaries", () => {
    const block: DynamicPresetBlock = {
      id: "lvl-1",
      kind: "dynamic-preset",
      presetId: "dynamic-level",
      startMs: 100,
      endMs: 400,
      orderedObjectIds: [3, 1],
      params: { startV1: 10, targetV1: 40, v2: 5, v3: 6 },
      profiles: createDefaultAxisProfiles(300),
    };
    const points = resolvePreset(block);
    expect(points.map((point) => [point.objectId, point.atMs, point.pose.v1, point.sourceRef])).toEqual([
      [3, 100, 10, "preset:lvl-1:3:0"],
      [3, 400, 40, "preset:lvl-1:3:1"],
      [1, 100, 10, "preset:lvl-1:1:0"],
      [1, 400, 40, "preset:lvl-1:1:1"],
    ]);
    expect(points.every((point) => point.pose.v2 === 0 && point.pose.v3 === 0)).toBe(true);
  });

  it("staggers a rise-fall chase along participant order", () => {
    const points = resolvePreset(waveBlock());
    expect(points.map((point) => [point.objectId, point.atMs, point.pose.v1, point.sourceRef])).toEqual([
      [7, 1000, 1000, "preset:wave-1:7:0"],
      [7, 1750, 1500, "preset:wave-1:7:1"],
      [7, 2500, 1000, "preset:wave-1:7:2"],
      [8, 1500, 1000, "preset:wave-1:8:0"],
      [8, 2250, 1500, "preset:wave-1:8:1"],
      [8, 3000, 1000, "preset:wave-1:8:2"],
    ]);
    expect(countPosesPerObject(points).get(7)).toBe(3);
    expect(countPosesPerObject(points).get(8)).toBe(3);
    const reversed = resolvePreset({ ...waveBlock(), orderedObjectIds: [8, 7] });
    expect(reversed[0]?.sourceRef).toBe("preset:wave-1:8:0");
    expect(reversed.find((point) => point.sourceRef === "preset:wave-1:8:1")?.atMs).toBe(1750);
    expect(reversed.find((point) => point.sourceRef === "preset:wave-1:7:0")?.atMs).toBe(1500);
    const backward = resolvePreset({ ...waveBlock(), params: { ...waveBlock().params, direction: -1 } });
    expect(backward.find((point) => point.sourceRef === "preset:wave-1:7:0")?.atMs).toBe(1500);
    expect(backward.find((point) => point.sourceRef === "preset:wave-1:8:0")?.atMs).toBe(1000);
  });

  it("stretches equal rise/fall phases when the block duration changes", () => {
    const points = resolvePreset({
      ...waveBlock(),
      endMs: 3100,
    });
    expect(points.filter((point) => point.objectId === 7).map((point) => point.atMs)).toEqual([
      1000, 1800, 2600,
    ]);
    expect(points.filter((point) => point.objectId === 8).map((point) => point.atMs)).toEqual([
      1500, 2300, 3100,
    ]);
  });

  it("shares the baseline between stitched cycles", () => {
    const points = resolvePreset({
      ...waveBlock(),
      params: { ...waveBlock().params, cycles: 2 },
    });
    expect(points.filter((point) => point.objectId === 7).map((point) => [point.atMs, point.pose.v1])).toEqual([
      [1000, 1000],
      [1375, 1500],
      [1750, 1000],
      [2125, 1500],
      [2500, 1000],
    ]);
    expect(countPosesPerObject(points).get(7)).toBe(5);
  });

  it("does not mutate the authored block", () => {
    const orderedObjectIds = [9, 7, 8];
    const params = { baseV1: 1000, stepV1: 250, v2: 0, v3: 0 };
    const block: StaticPresetBlock = {
      id: "preset-1",
      kind: "static-preset",
      presetId: "static-slope",
      atMs: 1000,
      orderedObjectIds,
      params,
    };
    Object.freeze(orderedObjectIds);
    Object.freeze(params);
    Object.freeze(block);
    expect(() => resolvePreset(block)).not.toThrow();
    expect(orderedObjectIds).toEqual([9, 7, 8]);
    expect(params).toEqual({ baseV1: 1000, stepV1: 250, v2: 0, v3: 0 });
  });

  it("exposes definitions with minObjects of at least 2", () => {
    const ids = [
      "static-flat",
      "static-slope",
      "static-arc",
      "static-wave",
      "dynamic-level",
      "dynamic-wave",
    ];
    for (const id of ids) {
      const definition = getPresetDefinition(id);
      expect(definition, id).toBeDefined();
      expect(definition?.minObjects, id).toBeGreaterThanOrEqual(2);
    }
    expect(getPresetDefinition("missing-preset")).toBeUndefined();
    expect(getPresetDefinition("static-slope")?.kind).toBe("static");
    expect(getPresetDefinition("dynamic-wave")?.kind).toBe("dynamic");
  });

  it("returns named validateParams errors for missing, unknown, typed, non-finite, and range issues", () => {
    const slope = getPresetDefinition("static-slope");
    expect(slope).toBeDefined();
    expect(slope?.validateParams({ baseV1: 1, stepV1: 1, v2: 0, v3: 0 })).toEqual([]);
    expect(slope?.validateParams({ stepV1: 1, v2: 0, v3: 0 })).toEqual(["missing parameter: baseV1"]);
    expect(slope?.validateParams({ baseV1: 1, stepV1: 1, v2: 0, v3: 0, extra: 1 })).toEqual([
      "unknown parameter: extra",
    ]);
    expect(slope?.validateParams({ baseV1: "1", stepV1: 1, v2: 0, v3: 0 })).toEqual([
      "parameter baseV1 must be a number",
    ]);
    expect(slope?.validateParams({ baseV1: NaN, stepV1: 1, v2: 0, v3: 0 })).toEqual([
      "parameter baseV1 must be finite",
    ]);
    expect(slope?.validateParams({ baseV1: Infinity, stepV1: 1, v2: 0, v3: 0 })).toEqual([
      "parameter baseV1 must be finite",
    ]);

    const wave = getPresetDefinition("dynamic-wave");
    expect(wave).toBeDefined();
    expect(
      wave?.validateParams({
        baseV1: 1,
        amplitude: 1,
        cycles: 1,
        direction: 1,
        staggerMs: -1,
        v2: 0,
        v3: 0,
      }),
    ).toEqual(["parameter staggerMs must be >= 0"]);
    expect(
      wave?.validateParams({
        baseV1: 1,
        amplitude: 1,
        cycles: 1,
        direction: 0,
        staggerMs: 100,
        v2: 0,
        v3: 0,
      }),
    ).toEqual(["parameter direction must be 1 or -1"]);
    expect(
      wave?.validateParams({
        baseV1: 1,
        amplitude: 1,
        cycles: 1,
        direction: 1,
        staggerMs: 100,
        intervalDeg: 90,
        sampleIntervalMs: 500,
        v2: 0,
        v3: 0,
      }),
    ).toEqual([]);
  });

  it("throws from resolvePreset instead of emitting invalid poses", () => {
    expect(() =>
      resolvePreset({
        ...slopeBlock(),
        params: { baseV1: NaN, stepV1: 250, v2: 0, v3: 0 },
      }),
    ).toThrow("parameter baseV1 must be finite");
    expect(() =>
      resolvePreset({
        ...slopeBlock(),
        orderedObjectIds: [7],
      }),
    ).toThrow("preset requires at least 2 objects");
    expect(() =>
      resolvePreset({
        ...slopeBlock(),
        presetId: "does-not-exist",
      }),
    ).toThrow("unknown preset: does-not-exist");
    expect(() =>
      resolvePreset({
        ...slopeBlock(),
        kind: "static-preset",
        presetId: "dynamic-wave",
      }),
    ).toThrow(/kind/);
    expect(() =>
      resolvePreset({
        ...waveBlock(),
        endMs: 1000,
      }),
    ).toThrow("dynamic preset endMs must be greater than startMs");
  });

  it("lists catalog metadata with distinct formulas and labeled params", () => {
    const staticIds = listPresetDefinitions("static").map((item) => item.id);
    const dynamicIds = listPresetDefinitions("dynamic").map((item) => item.id);
    expect(staticIds).toEqual(["static-flat", "static-slope", "static-arc", "static-wave"]);
    expect(dynamicIds).toEqual(["dynamic-level", "dynamic-wave"]);
    for (const definition of listPresetDefinitions()) {
      expect(definition.label.length).toBeGreaterThan(0);
      expect(definition.description.length).toBeGreaterThan(0);
      expect(definition.paramFields.length).toBeGreaterThan(0);
      expect(new Set(definition.paramFields.map((field) => field.key)).size).toBe(
        definition.paramFields.length,
      );
    }
    expect(getPresetDefinition("static-slope")?.paramFields.map((field) => field.key)).toEqual([
      "baseV1",
      "stepV1",
    ]);
    expect(getPresetDefinition("dynamic-wave")?.paramFields.map((field) => field.key)).toEqual([
      "baseV1",
      "amplitude",
      "staggerMs",
      "cycles",
      "direction",
    ]);
    expect(getPresetDefinition("dynamic-wave")?.paramFields.some((field) => field.kind === "choice")).toBe(
      true,
    );
  });

  it("declares ownedAxes as v1 only and omits swing param fields", () => {
    for (const definition of listPresetDefinitions()) {
      expect(definition.ownedAxes, definition.id).toEqual(["v1"]);
      expect(definition.paramFields.map((field) => field.key), definition.id).not.toContain("v2");
      expect(definition.paramFields.map((field) => field.key), definition.id).not.toContain("v3");
    }
  });

  it("accepts leftover v2/v3 params without requiring or authoring them", () => {
    const slope = getPresetDefinition("static-slope");
    expect(slope?.validateParams({ baseV1: 1, stepV1: 1 })).toEqual([]);
    expect(slope?.validateParams({ baseV1: 1, stepV1: 1, v2: 9, v3: -4 })).toEqual([]);
    const points = resolvePreset({
      id: "flat-legacy",
      kind: "static-preset",
      presetId: "static-flat",
      atMs: 400,
      orderedObjectIds: [11, 5],
      params: { v1: 200, v2: 3, v3: -4 },
    });
    expect(points.map((point) => point.pose)).toEqual([
      { v1: 200, v2: 0, v3: 0 },
      { v1: 200, v2: 0, v3: 0 },
    ]);
  });

  it("enforces one pose per object for static presets and at least two for dynamic", () => {
    const staticPoints = resolvePreset(slopeBlock());
    expect([...countPosesPerObject(staticPoints).values()]).toEqual([1, 1, 1]);
    const level = resolvePreset({
      id: "lvl-1",
      kind: "dynamic-preset",
      presetId: "dynamic-level",
      startMs: 100,
      endMs: 400,
      orderedObjectIds: [3, 1],
      params: { startV1: 10, targetV1: 40, v2: 5, v3: 6 },
      profiles: createDefaultAxisProfiles(300),
    });
    expect([...countPosesPerObject(level).values()]).toEqual([2, 2]);
    const wave = resolvePreset(waveBlock());
    expect(countPosesPerObject(wave).get(7)).toBeGreaterThanOrEqual(2);
    expect(countPosesPerObject(wave).get(8)).toBeGreaterThanOrEqual(2);
  });
});
