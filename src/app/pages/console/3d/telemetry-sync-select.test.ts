import { describe, expect, it } from "vitest";
import { selectSnapshotsForTelemetryApply } from "./telemetry-sync-select";
import type { ControlledObjectSnapshot } from "../components/monitor-grid/monitor-data";

const snap = (id: number, live: boolean): ControlledObjectSnapshot =>
  ({
    descriptor: { id, name: String(id), type: "mover", status: "ready", dimensions: [] },
    values: {},
    targets: {},
    speed: 0,
    torquePercent: 0,
    temperatureC: 0,
    history: [],
    live,
    positions: live ? { h: 1, p: 0, y: 0 } : null,
    modelStatus: live ? 2 : null,
  });

describe("selectSnapshotsForTelemetryApply", () => {
  it("drops non-live even without cue running", () => {
    const selected = selectSnapshotsForTelemetryApply([snap(1, false), snap(2, true)], {
      transformMode: false,
      skipEngineObjectIds: new Set(),
      resolveObjectId: (id) => id,
    });
    expect(selected.map((row) => row.descriptor.id)).toEqual([2]);
  });

  it("skips transform-tool engine selection", () => {
    const selected = selectSnapshotsForTelemetryApply([snap(1, true), snap(2, true)], {
      transformMode: true,
      skipEngineObjectIds: new Set(["1"]),
      resolveObjectId: (id) => id,
    });
    expect(selected.map((row) => row.descriptor.id)).toEqual([2]);
  });

  it("skips preview member ids even outside transform mode", () => {
    const selected = selectSnapshotsForTelemetryApply([snap(1, true), snap(2, true)], {
      transformMode: false,
      skipEngineObjectIds: new Set(),
      skipObjectIds: new Set(["1"]),
      resolveObjectId: (id) => id,
    });
    expect(selected.map((row) => row.descriptor.id)).toEqual([2]);
  });
});
