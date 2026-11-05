// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectDocument } from "@/app/project/project-document-types";
import type { ControlledObjectSnapshot } from "./monitor-data";
import { isMonitorEmpty } from "./monitor-utils";

const snapshotOf = (id: number, name: string): ControlledObjectSnapshot =>
  ({
    descriptor: { id, name, type: "mover", status: "ready", dimensions: [] },
    values: {},
    targets: {},
    speed: 0,
    torquePercent: 0,
    temperatureC: 0,
    history: [],
    live: false,
    positions: null,
    modelStatus: null,
  }) as unknown as ControlledObjectSnapshot;

const { state } = vi.hoisted(() => ({
  state: {
    objects: [] as { id: number; controlType: string }[],
    codes: [] as number[],
  },
}));

vi.mock("../../hooks/use-controlled-objects", () => ({
  useControlledObjects: () => ({
    snapshots: [snapshotOf(1, "升降灯架"), snapshotOf(2, "舞台地面")],
    motorSnapshots: [],
    getById: vi.fn(),
  }),
}));
vi.mock("../../hooks/use-project-store", () => ({
  useProjectStore: () => ({ objects: state.objects, motors: [] }),
}));
vi.mock("@/app/project/use-project-document", () => ({
  useProjectDocument: () => ({
    setup: { controlledObjects: state.codes.map((controlType) => ({ controlType })) },
  }),
}));
vi.mock("../../hooks/use-selection", () => ({
  useSelection: () => ({ multiSelectedIds: [], select: vi.fn(), toggleMulti: vi.fn(), replaceSelection: vi.fn() }),
}));
vi.mock("@/app/project/display-length-unit-provider", () => ({
  useSessionDisplayLengthUnit: () => "mm" as const,
}));

import { MonitorGrid } from "./monitor-grid";

afterEach(cleanup);

describe("placeholder objects in the monitor", () => {
  it("are not listed", () => {
    state.objects = [
      { id: 1, controlType: "singlePointMove" },
      { id: 2, controlType: "staticProp" },
    ];
    state.codes = [2, 0];
    render(<MonitorGrid />);
    expect(screen.getByText("升降灯架")).toBeTruthy();
    expect(screen.queryByText("舞台地面")).toBeNull();
  });

  it("do not count as monitored objects", () => {
    const documentOf = (codes: number[]) =>
      ({ setup: { controlledObjects: codes.map((controlType) => ({ controlType })) } }) as unknown as ProjectDocument;
    expect(isMonitorEmpty(documentOf([0, 0]), 0)).toBe(true);
    expect(isMonitorEmpty(documentOf([0, 2]), 1)).toBe(false);
    expect(isMonitorEmpty(null, 0)).toBe(true);
  });
});
