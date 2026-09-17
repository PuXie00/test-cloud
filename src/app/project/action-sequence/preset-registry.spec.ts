import { describe, expect, it } from "vitest";
import { createDefaultAxisProfiles } from "./motion-profile";
import {
  DEFAULT_SPACING_MM,
  DYNAMIC_WAVE_SAMPLE_INTERVAL_MS,
  getPresetDefinition,
  listPresetDefinitions,
  migratePresetParams,
  resolvePreset,
} from "./preset-registry";
import type { DynamicPresetBlock, StaticPresetBlock } from "./types";

const slopeDegFromRise = (riseMm: number, spacingMm = DEFAULT_SPACING_MM): number =>
  (Math.atan(riseMm / spacingMm) * 180) / Math.PI;

const slopeBlock = (overrides: Partial<StaticPresetBlock> = {}): StaticPresetBlock => ({
  id: "preset-1",
  kind: "static-preset",
  presetId: "static-slope",
  atMs: 1000,
  orderedObjectIds: [9, 7, 8],
  params: {
    baseHeightMm: 1000,
    slopeDeg: slopeDegFromRise(250),
    spacingMm: DEFAULT_SPACING_MM,
    alignTilt: false,
  },
  ...overrides,
});

const waveBlock = (): DynamicPresetBlock => ({
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
  profiles: createDefaultAxisProfiles(2000),
});

describe("preset registry formations", () => {
  it("lists static and dynamic presets with Chinese labels", () => {
    expect(listPresetDefinitions("static").map((item) => [item.id, item.label])).toEqual([
      ["static-flat", "平面"],
      ["static-slope", "斜面"],
      ["static-arc", "弧形"],
      ["static-wave", "静态波浪"],
    ]);
    expect(listPresetDefinitions("dynamic").map((item) => [item.id, item.label])).toEqual([
      ["dynamic-level", "水平升降"],
      ["dynamic-wave", "行进波浪"],
    ]);
  });

  it("uses explicit participant order for a static slope height and optional tilt", () => {
    const points = resolvePreset(slopeBlock());
    expect(points.map(({ objectId, pose }) => [objectId, pose.v1, pose.v2, pose.v3])).toEqual([
      [9, 1000, 0, 0],
      [7, 1250, 0, 0],
      [8, 1500, 0, 0],
    ]);
    const tilted = resolvePreset(
      slopeBlock({
        params: {
          baseHeightMm: 1000,
          slopeDeg: 10,
          spacingMm: DEFAULT_SPACING_MM,
          alignTilt: true,
        },
      }),
    );
    expect(tilted[0]?.pose.v2).toBe(10);
    expect(tilted[1]?.pose.v1).toBeCloseTo(1000 + DEFAULT_SPACING_MM * Math.tan((10 * Math.PI) / 180), 10);
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
      params: { heightMm: 200 },
    };
    const points = resolvePreset(block);
    expect(points.map((point) => [point.objectId, point.atMs, point.pose, point.sourceRef])).toEqual([
      [11, 400, { v1: 200, v2: 0, v3: 0 }, "preset:flat-1:11:0"],
      [5, 400, { v1: 200, v2: 0, v3: 0 }, "preset:flat-1:5:0"],
    ]);
  });

  it("places a circular static-arc peak on the middle participant", () => {
    const block: StaticPresetBlock = {
      id: "arc-1",
      kind: "static-preset",
      presetId: "static-arc",
      atMs: 50,
      orderedObjectIds: [4, 5, 6],
      params: { baseHeightMm: 1000, sagittaMm: 500, spacingMm: DEFAULT_SPACING_MM, alignTilt: true },
    };
    const forward = resolvePreset(block);
    expect(forward[0]?.pose.v1).toBeCloseTo(1000, 10);
    expect(forward[1]?.pose.v1).toBeCloseTo(1500, 10);
    expect(forward[2]?.pose.v1).toBeCloseTo(1000, 10);
    expect(forward[1]?.pose.v2).toBeCloseTo(0, 10);
    expect(forward[0]?.pose.v2).toBeCloseTo((Math.atan(4 / 3) * 180) / Math.PI, 10);
    expect(forward[2]?.pose.v2).toBeCloseTo((-Math.atan(4 / 3) * 180) / Math.PI, 10);
    const reversed = resolvePreset({ ...block, orderedObjectIds: [6, 5, 4] });
    expect(reversed.map((point) => point.objectId)).toEqual([6, 5, 4]);
    expect(reversed[1]?.pose.v1).toBeCloseTo(1500, 10);
  });

  it("treats a zero-sagitta arc as a flat line", () => {
    const points = resolvePreset({
      id: "arc-flat",
      kind: "static-preset",
      presetId: "static-arc",
      atMs: 0,
      orderedObjectIds: [1, 2, 3],
      params: { baseHeightMm: 40, sagittaMm: 0, spacingMm: DEFAULT_SPACING_MM, alignTilt: true },
    });
    expect(points.every((point) => point.pose.v1 === 40 && point.pose.v2 === 0)).toBe(true);
  });

  it("applies static-wave phase along participant order", () => {
    const block: StaticPresetBlock = {
      id: "sw-1",
      kind: "static-preset",
      presetId: "static-wave",
      atMs: 10,
      orderedObjectIds: [9, 2],
      params: {
        baseHeightMm: 1000,
        amplitudeMm: 500,
        phaseDeg: 0,
        intervalDeg: 90,
        spacingMm: DEFAULT_SPACING_MM,
        alignTilt: false,
      },
    };
    const forward = resolvePreset(block);
    expect(forward.map((point) => [point.objectId, point.pose.v1, point.pose.v2])).toEqual([
      [9, 1000, 0],
      [2, 1500, 0],
    ]);
    const reversed = resolvePreset({ ...block, orderedObjectIds: [2, 9] });
    expect(reversed.map((point) => [point.objectId, point.pose.v1])).toEqual([
      [2, 1000],
      [9, 1500],
    ]);
  });

  it("tilts a static wave to the sine tangent when alignTilt is on", () => {
    const points = resolvePreset({
      id: "sw-tilt",
      kind: "static-preset",
      presetId: "static-wave",
      atMs: 0,
      orderedObjectIds: [1, 2],
      params: {
        baseHeightMm: 0,
        amplitudeMm: 500,
        phaseDeg: 0,
        intervalDeg: 90,
        spacingMm: DEFAULT_SPACING_MM,
        alignTilt: true,
      },
    });
    expect(points[0]?.pose.v2).toBeCloseTo((Math.atan(Math.PI / 4) * 180) / Math.PI, 10);
  });

  it("emits dynamic-level start and end poses at block boundaries with zero tilt", () => {
    const block: DynamicPresetBlock = {
      id: "lvl-1",
      kind: "dynamic-preset",
      presetId: "dynamic-level",
      startMs: 100,
      endMs: 400,
      orderedObjectIds: [3, 1],
      params: { startHeightMm: 10, endHeightMm: 40 },
      profiles: createDefaultAxisProfiles(300),
    };
    const points = resolvePreset(block);
    expect(points.map((point) => [point.objectId, point.atMs, point.pose, point.sourceRef])).toEqual([
      [3, 100, { v1: 10, v2: 0, v3: 0 }, "preset:lvl-1:3:0"],
      [3, 400, { v1: 40, v2: 0, v3: 0 }, "preset:lvl-1:3:1"],
      [1, 100, { v1: 10, v2: 0, v3: 0 }, "preset:lvl-1:1:0"],
      [1, 400, { v1: 40, v2: 0, v3: 0 }, "preset:lvl-1:1:1"],
    ]);
  });

  it("samples dynamic-wave on the 100ms grid with order-sensitive phase", () => {
    const points = resolvePreset(waveBlock());
    const object7 = points.filter((point) => point.objectId === 7);
    expect(object7.map((point) => point.atMs)).toEqual(
      Array.from(
        { length: (3000 - 1000) / DYNAMIC_WAVE_SAMPLE_INTERVAL_MS + 1 },
        (_, index) => 1000 + index * DYNAMIC_WAVE_SAMPLE_INTERVAL_MS,
      ),
    );
    expect(object7[0]?.pose.v1).toBeCloseTo(1000, 10);
    expect(object7.find((point) => point.atMs === 1500)?.pose.v1).toBeCloseTo(1500, 10);
    expect(object7.find((point) => point.atMs === 2000)?.pose.v1).toBeCloseTo(1000, 10);
    expect(object7[0]?.pose.v2).toBe(0);
    const reversed = resolvePreset({ ...waveBlock(), orderedObjectIds: [8, 7] });
    expect(reversed[0]?.sourceRef).toBe("preset:wave-1:8:0");
    expect(reversed[0]?.pose.v1).toBe(1000);
    expect(reversed.find((point) => point.sourceRef === "preset:wave-1:7:0")?.pose.v1).toBe(1500);
  });

  it("always includes the dynamic-wave end sample when the interval does not divide the span", () => {
    const points = resolvePreset({
      ...waveBlock(),
      endMs: 1230,
    });
    expect(points.filter((point) => point.objectId === 7).map((point) => point.atMs)).toEqual([
      1000, 1100, 1200, 1230,
    ]);
  });

  it("generates stable dynamic wave references", () => {
    const block = waveBlock();
    expect(resolvePreset(block)).toEqual(resolvePreset(structuredClone(block)));
    expect(resolvePreset(block)[0]?.sourceRef).toBe("preset:wave-1:7:0");
  });

  it("does not mutate the authored block", () => {
    const orderedObjectIds = [9, 7, 8];
    const params = {
      baseHeightMm: 1000,
      slopeDeg: slopeDegFromRise(250),
      spacingMm: DEFAULT_SPACING_MM,
      alignTilt: false,
    };
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
    expect(params).toEqual({
      baseHeightMm: 1000,
      slopeDeg: slopeDegFromRise(250),
      spacingMm: DEFAULT_SPACING_MM,
      alignTilt: false,
    });
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
    for (const definition of listPresetDefinitions()) {
      expect(definition.validateParams(definition.defaultParams()), definition.id).toEqual([]);
    }
  });

  it("returns named validateParams errors for missing, unknown, typed, non-finite, and range issues", () => {
    const slope = getPresetDefinition("static-slope");
    expect(slope).toBeDefined();
    expect(
      slope?.validateParams({
        baseHeightMm: 1,
        slopeDeg: 1,
        spacingMm: 1000,
        alignTilt: true,
      }),
    ).toEqual([]);
    expect(
      slope?.validateParams({
        slopeDeg: 1,
        spacingMm: 1000,
        alignTilt: true,
      }),
    ).toEqual(["missing parameter: baseHeightMm"]);
    expect(
      slope?.validateParams({
        baseHeightMm: 1,
        slopeDeg: 1,
        spacingMm: 1000,
        alignTilt: true,
        extra: 1,
      }),
    ).toEqual(["unknown parameter: extra"]);
    expect(
      slope?.validateParams({
        baseHeightMm: "1",
        slopeDeg: 1,
        spacingMm: 1000,
        alignTilt: true,
      }),
    ).toEqual(["parameter baseHeightMm must be a number"]);
    expect(
      slope?.validateParams({
        baseHeightMm: Number.NaN,
        slopeDeg: 1,
        spacingMm: 1000,
        alignTilt: true,
      }),
    ).toEqual(["parameter baseHeightMm must be finite"]);
    expect(
      slope?.validateParams({
        baseHeightMm: 1,
        slopeDeg: 90,
        spacingMm: 1000,
        alignTilt: true,
      }),
    ).toEqual(["parameter slopeDeg must be > -90 and < 90"]);
    expect(
      slope?.validateParams({
        baseHeightMm: 1,
        slopeDeg: 1,
        spacingMm: 0,
        alignTilt: true,
      }),
    ).toEqual(["parameter spacingMm must be > 0"]);

    const wave = getPresetDefinition("dynamic-wave");
    expect(wave).toBeDefined();
    expect(
      wave?.validateParams({
        baseHeightMm: 1,
        amplitudeMm: 1,
        cycles: 1,
        direction: 0,
        intervalDeg: 90,
      }),
    ).toEqual(["parameter direction must be 1 or -1"]);
    expect(
      wave?.validateParams({
        baseHeightMm: 1,
        amplitudeMm: 1,
        cycles: -1,
        direction: 1,
        intervalDeg: 90,
      }),
    ).toEqual(["parameter cycles must be >= 0"]);
  });

  it("throws from resolvePreset instead of emitting invalid poses", () => {
    expect(() =>
      resolvePreset({
        ...slopeBlock(),
        params: {
          baseHeightMm: Number.NaN,
          slopeDeg: 10,
          spacingMm: DEFAULT_SPACING_MM,
          alignTilt: false,
        },
      }),
    ).toThrow("parameter baseHeightMm must be finite");
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
});

describe("migratePresetParams", () => {
  it("maps v1-centric keys onto formation params and drops copied tilt", () => {
    expect(migratePresetParams("static-flat", { v1: 200, v2: 3, v3: -4 })).toEqual({ heightMm: 200 });
    const slope = migratePresetParams("static-slope", { baseV1: 1000, stepV1: 250, v2: 0, v3: 0 });
    expect(slope.baseHeightMm).toBe(1000);
    expect(slope.spacingMm).toBe(DEFAULT_SPACING_MM);
    expect(slope.alignTilt).toBe(true);
    expect(slope.slopeDeg as number).toBeCloseTo(slopeDegFromRise(250), 10);
    expect(
      migratePresetParams("static-arc", { baseV1: 10, amplitude: 40, v2: 1, v3: 2 }),
    ).toEqual({
      baseHeightMm: 10,
      sagittaMm: 40,
      spacingMm: DEFAULT_SPACING_MM,
      alignTilt: true,
    });
    expect(
      migratePresetParams("static-wave", {
        baseV1: 1,
        amplitude: 2,
        phaseDeg: 15,
        intervalDeg: 45,
        v2: 0,
        v3: 0,
      }),
    ).toEqual({
      baseHeightMm: 1,
      amplitudeMm: 2,
      phaseDeg: 15,
      intervalDeg: 45,
      spacingMm: DEFAULT_SPACING_MM,
      alignTilt: true,
    });
    expect(migratePresetParams("dynamic-level", { startV1: 10, targetV1: 40, v2: 5, v3: 6 })).toEqual({
      startHeightMm: 10,
      endHeightMm: 40,
    });
    expect(
      migratePresetParams("dynamic-wave", {
        baseV1: 8,
        amplitude: 9,
        cycles: 2,
        direction: -1,
        intervalDeg: 30,
        sampleIntervalMs: 500,
        v2: 0,
        v3: 0,
      }),
    ).toEqual({
      baseHeightMm: 8,
      amplitudeMm: 9,
      cycles: 2,
      direction: -1,
      intervalDeg: 30,
    });
  });

  it("keeps already-migrated params and does not re-derive slope from leftover stepV1", () => {
    expect(
      migratePresetParams("static-slope", {
        baseHeightMm: 12,
        slopeDeg: 8,
        spacingMm: 500,
        alignTilt: false,
        stepV1: 999,
      }),
    ).toEqual({
      baseHeightMm: 12,
      slopeDeg: 8,
      spacingMm: 500,
      alignTilt: false,
    });
  });
});
