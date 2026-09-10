// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultAxisProfiles } from "@/app/project/action-sequence/motion-profile";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import { LIBRARY_ITEM_MIME } from "../content-library/library-dnd";
import { msToPx } from "./timeline-data";
import { PresetProjection } from "./preset-projection";
import { TimelineEditor } from "./timeline-editor";
import { createTimelineProps, installTimelinePaneWidth } from "./timeline-test-helpers";

const sequenceWithSharedSlope: ActionSequenceConfig = {
  id: "seq",
  name: "Shared slope",
  trajectoryMode: "non-forced",
  blocks: [
    {
      id: "slope-1",
      kind: "static-preset",
      presetId: "static-slope",
      atMs: 1000,
      orderedObjectIds: [7, 8, 9],
      params: { baseV1: 0, stepV1: 100, v2: 0, v3: 0 },
      label: "斜面",
    },
  ],
  segments: [],
};

const sequenceWithDynamicLevel: ActionSequenceConfig = {
  id: "seq-dynamic",
  name: "Dynamic level",
  trajectoryMode: "non-forced",
  blocks: [
    {
      id: "dynamic-1",
      kind: "dynamic-preset",
      presetId: "dynamic-level",
      startMs: 1000,
      endMs: 2000,
      orderedObjectIds: [7, 8],
      params: { startV1: 0, targetV1: 100, v2: 0, v3: 0 },
      profiles: createDefaultAxisProfiles(1000),
      label: "水平升降",
    },
  ],
  segments: [],
};

const sequenceWithCommands: ActionSequenceConfig = {
  id: "seq-cmd",
  name: "Commands",
  trajectoryMode: "non-forced",
  blocks: [
    {
      id: "enable-1",
      kind: "set-enabled",
      objectId: 7,
      atMs: 0,
      enabled: true,
    },
    {
      id: "disable-1",
      kind: "set-enabled",
      objectId: 7,
      atMs: 1500,
      enabled: false,
    },
  ],
  segments: [],
};

const cueDataTransfer = (cueId: string) => ({
  types: [LIBRARY_ITEM_MIME],
  getData: (type: string) =>
    type === LIBRARY_ITEM_MIME ? JSON.stringify({ kind: "cue", id: cueId }) : "",
  setData: vi.fn(),
  dropEffect: "copy",
  effectAllowed: "copy",
});

let restorePaneWidth: (() => void) | undefined;
beforeEach(() => {
  restorePaneWidth = installTimelinePaneWidth();
});
afterEach(() => {
  restorePaneWidth?.();
  cleanup();
  delete window.csocketApi;
});

describe("preset projections", () => {
  it("renders one logical preset on all participant tracks", () => {
    render(<TimelineEditor {...createTimelineProps(sequenceWithSharedSlope)} />);
    const projections = screen.getAllByRole("button", { name: /静态预设.*斜面/ });
    expect(projections).toHaveLength(3);
    expect(projections.map((node) => node.getAttribute("data-block-id"))).toEqual([
      "slope-1",
      "slope-1",
      "slope-1",
    ]);
  });

  it("selecting any projection selects the source preset", () => {
    const handleSelect = vi.fn();
    render(
      <TimelineEditor {...createTimelineProps(sequenceWithSharedSlope, handleSelect)} />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: /静态预设.*斜面/ })[1]!);
    expect(handleSelect).toHaveBeenCalledWith({ kind: "block", blockId: "slope-1" });
  });

  it("dragging any projection moves the source preset", () => {
    const onPresetMove = vi.fn();
    render(
      <TimelineEditor
        {...createTimelineProps(sequenceWithSharedSlope)}
        onPresetMove={onPresetMove}
      />,
    );
    const projection = screen.getAllByRole("button", { name: /静态预设.*斜面/ })[1]!;
    fireEvent.pointerDown(projection, { clientX: 100 });
    fireEvent.pointerMove(window, { clientX: 150 });
    fireEvent.pointerUp(window);
    expect(onPresetMove).toHaveBeenCalledWith("slope-1", 1500);
  });

  it("positions static projections only from atMs", () => {
    render(<TimelineEditor {...createTimelineProps(sequenceWithSharedSlope)} />);
    const projection = screen.getAllByRole("button", { name: /静态预设.*斜面/ })[0]!;
    expect(projection.getAttribute("data-timeline-time")).toBe("1000");
    expect(projection.style.left).toBe(`${msToPx(1000, 100)}px`);
  });

  it("marks a static preset projection as the derived initial pose", () => {
    render(<TimelineEditor {...createTimelineProps(sequenceWithSharedSlope)} />);
    const projections = screen.getAllByRole("button", { name: /静态预设.*斜面/ });
    for (const projection of projections) {
      expect(projection.textContent).toContain("起");
    }
  });
});

describe("dynamic preset projections", () => {
  it("renders one range per participant with the shared block id", () => {
    render(<TimelineEditor {...createTimelineProps(sequenceWithDynamicLevel)} />);
    const ranges = screen.getAllByRole("button", { name: /动态预设.*水平升降/ });
    expect(ranges).toHaveLength(2);
    expect(ranges.map((node) => node.getAttribute("data-block-id"))).toEqual([
      "dynamic-1",
      "dynamic-1",
    ]);
    expect(ranges[0]!.style.left).toBe(`${msToPx(1000, 100)}px`);
    expect(ranges[0]!.style.width).toBe(`${msToPx(1000, 100)}px`);
    expect(ranges[0]!.textContent).toContain("起");
    expect(ranges[1]!.textContent).toContain("起");
  });

  it("renders generated-point ticks from resolver output that are not independently editable", () => {
    const handleSelect = vi.fn();
    const onPoseMove = vi.fn();
    render(
      <TimelineEditor
        {...createTimelineProps(sequenceWithDynamicLevel, handleSelect)}
        onPoseMove={onPoseMove}
      />,
    );
    const range = screen.getAllByRole("button", { name: /动态预设.*水平升降/ })[0]!;
    const ticks = range.querySelectorAll("[data-generated-tick]");
    expect(ticks).toHaveLength(2);
    expect(ticks[0]!.getAttribute("role")).not.toBe("button");
    fireEvent.click(ticks[0]!);
    expect(handleSelect).toHaveBeenCalledWith({ kind: "block", blockId: "dynamic-1" });
    expect(handleSelect.mock.calls.every((call) => call[0]?.kind === "block")).toBe(true);
    fireEvent.pointerDown(ticks[1]!, { clientX: 40 });
    fireEvent.pointerMove(window, { clientX: 90 });
    fireEvent.pointerUp(window);
    expect(onPoseMove).not.toHaveBeenCalled();
  });

  it("resizing a dynamic projection delegates to the source block", () => {
    const onDynamicPresetResize = vi.fn();
    render(
      <TimelineEditor
        {...createTimelineProps(sequenceWithDynamicLevel)}
        onDynamicPresetResize={onDynamicPresetResize}
      />,
    );
    const range = screen.getAllByRole("button", { name: /动态预设.*水平升降/ })[0]!;
    const handle = range.querySelector("[data-resize='end']");
    expect(handle).not.toBeNull();
    fireEvent.pointerDown(handle!, { clientX: 200 });
    fireEvent.pointerMove(window, { clientX: 250 });
    fireEvent.pointerUp(window);
    expect(onDynamicPresetResize).toHaveBeenCalledWith("dynamic-1", 1000, 2500);
  });

  it("positions the initial-pose badge from startMs", () => {
    const initialPoseAtMs = 1500;
    const startMs = 1000;
    const pxPerSecond = 100;
    render(
      <PresetProjection
        blockId="dynamic-1"
        kind="dynamic-preset"
        label="水平升降"
        startMs={startMs}
        endMs={2000}
        initialPoseAtMs={initialPoseAtMs}
        selected={false}
        viewStartMs={0}
        pxPerSecond={pxPerSecond}
        onSelect={vi.fn()}
        onMove={vi.fn()}
      />,
    );
    expect(screen.getByText("起").style.left).toBe(
      `${msToPx(initialPoseAtMs - startMs, pxPerSecond)}px`,
    );
  });
});

describe("command event markers", () => {
  it("renders enable and disable with distinct semantics and accessible names", () => {
    render(<TimelineEditor {...createTimelineProps(sequenceWithCommands)} />);
    const enable = screen.getByRole("button", { name: "使能指令 enable-1" });
    const disable = screen.getByRole("button", { name: "断使能指令 disable-1" });
    expect(enable.getAttribute("data-block-id")).toBe("enable-1");
    expect(disable.getAttribute("data-block-id")).toBe("disable-1");
    expect(enable.getAttribute("data-enabled")).toBe("true");
    expect(disable.getAttribute("data-enabled")).toBe("false");
    expect(enable.getAttribute("data-timeline-time")).toBe("0");
    expect(disable.getAttribute("data-timeline-time")).toBe("1500");
    expect(disable.style.left).toBe(`${msToPx(1500, 100)}px`);
    expect(enable.className).not.toBe(disable.className);
  });

  it("selecting or scrubbing never calls window.csocketApi", () => {
    const enableModel = vi.fn();
    window.csocketApi = { enableModel } as unknown as Window["csocketApi"];
    const handleSelect = vi.fn();
    const onCursorChange = vi.fn();
    render(
      <TimelineEditor
        {...createTimelineProps(sequenceWithCommands, handleSelect)}
        onCursorChange={onCursorChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "使能指令 enable-1" }));
    fireEvent.click(screen.getByRole("button", { name: "断使能指令 disable-1" }));
    const playhead = screen.getByRole("slider", { name: "播放游标" });
    fireEvent.pointerDown(playhead, { clientX: 100 });
    fireEvent.pointerMove(window, { clientX: 180 });
    fireEvent.pointerUp(window);
    expect(handleSelect).toHaveBeenCalledWith({ kind: "block", blockId: "enable-1" });
    expect(handleSelect).toHaveBeenCalledWith({ kind: "block", blockId: "disable-1" });
    expect(enableModel).not.toHaveBeenCalled();
    expect(window.csocketApi.enableModel).not.toHaveBeenCalled();
  });
});

describe("cue drop on a model track", () => {
  it("drops a library Cue onto a track at atMs", () => {
    const onCueDrop = vi.fn();
    render(
      <TimelineEditor {...createTimelineProps(sequenceWithCommands)} onCueDrop={onCueDrop} />,
    );
    const track = document.querySelector("[data-track-object-id='7']");
    expect(track).not.toBeNull();
    fireEvent.drop(track!, { dataTransfer: cueDataTransfer("cue-1") });
    expect(onCueDrop).toHaveBeenCalledTimes(1);
    expect(onCueDrop.mock.calls[0]![0]).toBe(7);
    expect(onCueDrop.mock.calls[0]![1]).toBe("cue-1");
    expect(onCueDrop.mock.calls[0]![2]).toBeGreaterThanOrEqual(0);
  });
});
