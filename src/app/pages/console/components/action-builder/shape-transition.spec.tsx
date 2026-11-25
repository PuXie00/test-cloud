// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionSequenceConfig, KeyframePose } from "@/app/project/action-sequence/types";
import { ContentLibraryPanel } from "./content-library/content-library-panel";
import { buildTransitionSequence, FALLBACK_TRANSITION_MS, planShapeTransition } from "./shape-transition";
import type { ControlledObject } from "./timeline/timeline-data";

const { builderState } = vi.hoisted(() => ({ builderState: { current: {} as Record<string, unknown> } }));

vi.mock("./use-action-builder", () => ({ useActionBuilder: () => builderState.current }));
vi.mock("@/app/project/use-project", () => ({ useProject: () => ({ currentProject: null }) }));

// 速度上限 1000、最短加速 0.5 s（加速度上限 2000）、默认加速度 1000：最快 = 950 速度、1900 加速度
const limited = (id: number, name: string): ControlledObject => ({
  id,
  name,
  currentPosition: 0,
  unit: "mm",
  axisLabel: "H",
  enabled: true,
  enabledAxes: ["v1"],
  maxSpeedByAxis: { v1: 1000 },
  minAccelTimeByAxis: { v1: 0.5 },
  defaultSpeedByAxis: { v1: 500 },
  defaultAccelByAxis: { v1: 1000 },
});

const objects = new Map<number, ControlledObject>([
  [1, limited(1, "升降-1")],
  [2, limited(2, "升降-2")],
  [3, { ...limited(3, "升降-3"), maxSpeedByAxis: {}, minAccelTimeByAxis: {} }],
  [4, { ...limited(4, "升降-4"), maxSpeedByAxis: {}, defaultSpeedByAxis: {}, defaultAccelByAxis: {} }],
]);
const objectOf = (id: number) => objects.get(id);
const shape = (entries: Array<[number, KeyframePose]>) => new Map(entries);

describe("planShapeTransition", () => {
  const from = shape([
    [1, { v1: 0 }],
    [2, { v1: 0 }],
    [5, { v1: 0 }],
  ]);
  const to = shape([
    [1, { v1: 1000 }],
    [2, { v1: 500 }],
    [6, { v1: 0 }],
  ]);

  it("makes everyone arrive with the slowest one at its fastest", () => {
    const plan = planShapeTransition({ from, to, objectOf, timing: "sync" });
    // 1000 走最快：加减速各 0.5 s 走 475，匀速 525 / 950 → 1.55 s，取到 1.6 s
    expect(plan.totalMs).toBe(1600);
    expect(plan.slowestObjectId).toBe(1);
    expect(plan.objects.map((object) => object.durationMs)).toEqual([1600, 1600]);
    expect(plan.objects[1]?.fastestMs).toBe(1100);
    expect(plan.onlyFrom).toEqual([5]);
    expect(plan.onlyTo).toEqual([6]);
    // 慢的那台等比放慢：变速时间同比例拉长
    const stretched = plan.objects[1]?.profiles.v1;
    expect(stretched?.kind === "trapezoid" ? stretched.params.accelMs : 0).toBeGreaterThan(500);
  });

  it("lets each one go at its own fastest", () => {
    const plan = planShapeTransition({ from, to, objectOf, timing: "each" });
    expect(plan.objects.map((object) => object.durationMs)).toEqual([1600, 1100]);
    expect(plan.totalMs).toBe(1600);
  });

  it("falls back to the default speed, then to a fixed time, without limits", () => {
    const plan = planShapeTransition({
      from: shape([
        [3, { v1: 0 }],
        [4, { v1: 0 }],
      ]),
      to: shape([
        [3, { v1: 500 }],
        [4, { v1: 500 }],
      ]),
      objectOf,
      timing: "each",
    });
    expect(plan.objects.map((object) => object.basis)).toEqual(["default", "unknown"]);
    expect(plan.objects[1]?.durationMs).toBe(FALLBACK_TRANSITION_MS);
  });

  it("builds a sequence from the start shape at 0 s to the end shape", () => {
    const plan = planShapeTransition({ from, to, objectOf, timing: "each" });
    const sequence = buildTransitionSequence(plan, { id: 9, name: "过渡 1" });
    expect(sequence?.name).toBe("过渡 1");
    const poses = sequence?.blocks.map((block) => (block.kind === "pose" ? [block.objectId, block.atMs, block.pose.v1] : null));
    expect(poses).toEqual([
      [1, 0, 0],
      [1, 1600, 1000],
      [2, 0, 0],
      [2, 1100, 500],
    ]);
    expect(sequence?.segments).toHaveLength(2);
  });
});

describe("transition in the sequence library", () => {
  const single = (id: number, name: string, v1: number): ActionSequenceConfig => ({
    id,
    name,
    trajectoryMode: false,
    blocks: [{ id: `p${id}`, kind: "pose", objectId: 1, atMs: 0, pose: { v1 } }],
    segments: [],
  });
  const shapes = [single(1, "造型 1", 0), single(2, "造型 2", 1000)];

  afterEach(cleanup);

  it("pairs two sequences with Ctrl-click, shows the fastest time and creates the transition", () => {
    const handleCreateTransition = vi.fn(() => true);
    const handleSequenceSelect = vi.fn();
    builderState.current = {
      sequences: shapes,
      draftSequenceIds: new Set<number>(),
      dockMode: "sequence",
      selectedSequenceId: null,
      programs: [],
      selectedObjectIds: [],
      handleSequenceSelect,
      handleCreateSequence: () => {},
      handleProgramItemInsert: () => {},
      getTimelineObject: objectOf,
      handleCreateTransition,
    };
    render(<ContentLibraryPanel />);
    fireEvent.click(screen.getByRole("button", { name: "造型 1" }), { ctrlKey: true });
    expect(screen.getByText(/再 Ctrl\+点一个序列/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "造型 2" }), { ctrlKey: true });
    expect(handleSequenceSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe("最快一起到达 1.6 s · 最慢：升降-1");
    fireEvent.click(screen.getByRole("button", { name: "各自最快" }));
    expect(screen.getByRole("status").textContent).toBe("各自最快，最晚 1.6 s 到（升降-1）");
    fireEvent.click(screen.getByRole("button", { name: "调换先后" }));
    fireEvent.click(screen.getByRole("button", { name: "生成过渡" }));
    expect(handleCreateTransition).toHaveBeenCalledWith(2, 1, "each");
    // 生成后收起
    expect(screen.queryByRole("button", { name: "生成过渡" })).toBeNull();
  });
});
