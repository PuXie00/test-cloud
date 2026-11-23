// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DisplayLengthUnitProvider } from "@/app/project/display-length-unit-provider";
import { resolveActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import type { ActionSequenceConfig, MotionSegmentConfig, PoseBlock } from "@/app/project/action-sequence/types";
import type { SequenceSelection } from "../sequence-selection";
import { SequencePropertiesPanel } from "./sequence-properties-panel";

const { builderState, toastWarning } = vi.hoisted(() => ({
  builderState: { current: {} as Record<string, unknown> },
  toastWarning: vi.fn(),
}));

vi.mock("../use-action-builder", () => ({
  useActionBuilder: () => builderState.current,
}));

vi.mock("sonner", () => ({ toast: { warning: toastWarning, info: vi.fn() } }));

const ramp = (fromRef: string, toRef: string, accelMs: number, decelMs: number): MotionSegmentConfig => ({
  fromRef,
  toRef,
  settings: {
    profiles: {
      v1: { kind: "trapezoid", params: { accelMs, decelMs } },
      v2: { kind: "idle" },
      v3: { kind: "idle" },
    },
  },
});

// 0–4 s 走到 400，4–6 s 走到 1000
const slowFast = (middle: Partial<PoseBlock> = {}, firstDecelMs = 1000): ActionSequenceConfig => ({
  id: 1,
  name: "slow-fast",
  trajectoryMode: false,
  blocks: [
    { id: "p0", kind: "pose", objectId: 1, atMs: 0, pose: { v1: 0 } },
    { id: "p1", kind: "pose", objectId: 1, atMs: 4000, pose: { v1: 400 }, ...middle },
    { id: "p2", kind: "pose", objectId: 1, atMs: 6000, pose: { v1: 1000 } },
  ],
  segments: [ramp("p0", "p1", 1000, firstDecelMs), ramp("p1", "p2", 500, 500)],
});

const handleSetPassSpeedMode = vi.fn(() => true);
const handleRetimeSegmentCurves = vi.fn(() => true);

const mockBuilder = (phaseInputMode: "time" | "speed" = "time") => {
  builderState.current = {
    getTimelineObject: () => ({ enabledAxes: ["v1"] }),
    getLivePose: () => null,
    handleApplyPoseAxisWrite: vi.fn(),
    handleWriteSegmentProfiles: vi.fn(),
    handleRetimeSegmentCurves,
    handleAlignSegments: vi.fn(),
    handleAlignPoses: vi.fn(),
    handleStaggerSegments: vi.fn(),
    handlePhaseInputModeChange: vi.fn(),
    handleSetPassSpeedMode,
    phaseInputMode,
    sequenceIssues: [],
  };
};

const renderPanel = (sequence: ActionSequenceConfig, selection: SequenceSelection) => {
  const onReplaceBlock = vi.fn();
  render(
    <DisplayLengthUnitProvider initialUnit="mm">
      <SequencePropertiesPanel
        sequence={sequence}
        resolved={resolveActionSequence(sequence)}
        selection={selection}
        onReplaceBlock={onReplaceBlock}
        onUpdateSegment={vi.fn()}
        onDeleteBlock={vi.fn()}
      />
    </DisplayLengthUnitProvider>,
  );
  return { onReplaceBlock };
};

const firstSegment: SequenceSelection = { kind: "multi-block", blockIds: ["p0", "p1"], focus: "segments" };
const secondSegment: SequenceSelection = { kind: "multi-block", blockIds: ["p1", "p2"], focus: "segments" };

/** 某一阶段那行的 − + */
const stepper = (label: string, name: "减少" | "增加") => {
  const input = screen.getByLabelText(label);
  return within(input.closest("div")!.parentElement!).getByRole("button", { name });
};

beforeEach(() => {
  mockBuilder();
  handleSetPassSpeedMode.mockClear();
  handleRetimeSegmentCurves.mockClear();
  toastWarning.mockClear();
});

afterEach(cleanup);

describe("pass speed choices on a pose", () => {
  it("follows the previous segment and drops a hand-entered speed", () => {
    const { onReplaceBlock } = renderPanel(slowFast({ passSpeeds: { v1: 90 } }), { kind: "block", blockId: "p1" });
    const row = screen.getByRole("group", { name: "虚轴1 经过速度设置" });
    expect(within(row).getByText("手填")).not.toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: "虚轴1 经过速度跟前段" }));
    const replaced = onReplaceBlock.mock.calls[0]?.[0] as PoseBlock;
    expect(replaced.passSpeedModes).toEqual({ v1: "prev" });
    expect(replaced).not.toHaveProperty("passSpeeds");
  });

  it("shows which rule is in use and a typed speed replaces it", () => {
    const { onReplaceBlock } = renderPanel(slowFast({ passSpeedModes: { v1: "next" } }), {
      kind: "block",
      blockId: "p1",
    });
    const row = screen.getByRole("group", { name: "虚轴1 经过速度设置" });
    expect(within(row).getByRole("button", { name: "虚轴1 经过速度跟后段" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.mouseDown(within(row).getByRole("button", { name: "增加" }));
    const replaced = onReplaceBlock.mock.calls[0]?.[0] as PoseBlock;
    expect(replaced.passSpeeds?.v1).toBeGreaterThan(0);
    expect(replaced).not.toHaveProperty("passSpeedModes");
  });
});

describe("a flat segment end from the phase editor", () => {
  it("turns a typed 0 at 段尾变速 into following the previous segment at the end pose", () => {
    renderPanel(slowFast(), firstSegment);
    const last = screen.getByLabelText("段尾变速");
    fireEvent.change(last, { target: { value: "0" } });
    fireEvent.keyDown(last, { key: "Enter" });
    expect(handleSetPassSpeedMode).toHaveBeenCalledWith("p1", "v1", "prev", undefined);
  });

  it("goes flat when − is pressed at 0.1 s", () => {
    renderPanel(slowFast({}, 100), firstSegment);
    fireEvent.click(stepper("段尾变速", "减少"));
    expect(handleSetPassSpeedMode).toHaveBeenCalledWith("p1", "v1", "prev", undefined);
  });

  it("shows a flat end as 0 and + brings the speed change back", () => {
    renderPanel(slowFast({ passSpeedModes: { v1: "prev" } }), firstSegment);
    expect((screen.getByLabelText("段尾变速") as HTMLInputElement).value).toBe("0.0");
    expect(screen.getByText(/段尾不变速/)).not.toBeNull();
    fireEvent.click(stepper("段尾变速", "增加"));
    expect(handleSetPassSpeedMode).toHaveBeenCalledWith("p1", "v1", null, undefined);
  });

  it("follows the next segment from 段首变速", () => {
    renderPanel(slowFast(), secondSegment);
    const first = screen.getByLabelText("段首变速");
    fireEvent.change(first, { target: { value: "0" } });
    fireEvent.keyDown(first, { key: "Enter" });
    expect(handleSetPassSpeedMode).toHaveBeenCalledWith("p1", "v1", "next", undefined);
  });

  it("says why when the end has to stop", () => {
    renderPanel(slowFast(), secondSegment);
    const last = screen.getByLabelText("段尾变速");
    fireEvent.change(last, { target: { value: "0" } });
    fireEvent.keyDown(last, { key: "Enter" });
    expect(handleSetPassSpeedMode).not.toHaveBeenCalled();
    expect(toastWarning).toHaveBeenCalledWith("终点是序列的起止，必须停在这一帧，段尾变速不能为 0");
  });

  it("speeds up from a flat start when the cruise speed is raised by speed", () => {
    mockBuilder("speed");
    // 中间位姿跟前段：后半段进来就是前半段的匀速，段首不变速
    renderPanel(slowFast({ passSpeedModes: { v1: "prev" } }), secondSegment);
    const cruise = screen.getByLabelText("匀速速度");
    fireEvent.change(cruise, { target: { value: "500" } });
    fireEvent.keyDown(cruise, { key: "Enter" });
    expect(handleRetimeSegmentCurves).toHaveBeenCalled();
    expect(toastWarning).not.toHaveBeenCalled();
  });
});
