// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DisplayLengthUnitProvider } from "@/app/project/display-length-unit-provider";
import { resolveActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import type { SequenceSelection } from "../sequence-selection";
import { SequencePropertiesPanel } from "./sequence-properties-panel";

const { builderState, toastWarning } = vi.hoisted(() => ({
  builderState: {
    current: {
      getTimelineObject: () => ({ enabledAxes: ["v1"] as Array<"v1" | "v2" | "v3"> }),
      getLivePose: () => null,
      handleApplyPoseAxisWrite: vi.fn(),
      handleWriteSegmentProfiles: vi.fn(),
      handleRetimeSegmentCurves: vi.fn(),
      handlePhaseInputModeChange: vi.fn(),
      phaseInputMode: "time" as "time" | "speed",
      sequenceIssues: [] as unknown[],
    },
  },
  toastWarning: vi.fn(),
}));

vi.mock("../use-action-builder", () => ({
  useActionBuilder: () => builderState.current,
}));

vi.mock("sonner", () => ({ toast: { warning: toastWarning } }));

// 两个物体各一段：2 s 走 200、4 s 走 400，匀速都是 125 mm/s，加速度不同
const twoSpans: ActionSequenceConfig = {
  id: 1,
  name: "two",
  trajectoryMode: false,
  blocks: [
    { id: "a1", kind: "pose", objectId: 1, atMs: 0, pose: { v1: 0 } },
    { id: "b1", kind: "pose", objectId: 1, atMs: 2000, pose: { v1: 200 } },
    { id: "a2", kind: "pose", objectId: 2, atMs: 0, pose: { v1: 0 } },
    { id: "b2", kind: "pose", objectId: 2, atMs: 4000, pose: { v1: 400 } },
  ],
  segments: [],
};

// 一段 5 s 走 400，默认 1 s 加减速：匀速 100 mm/s、加减速度 100 mm/s²
const oneSpan: ActionSequenceConfig = {
  id: 2,
  name: "one",
  trajectoryMode: false,
  blocks: [
    { id: "a", kind: "pose", objectId: 1, atMs: 0, pose: { v1: 0 } },
    { id: "b", kind: "pose", objectId: 1, atMs: 5000, pose: { v1: 400 } },
  ],
  segments: [],
};

const renderPanel = (sequence: ActionSequenceConfig, selection: SequenceSelection) => {
  const onUpdateSegment = vi.fn();
  const onReplaceBlock = vi.fn();
  render(
    <DisplayLengthUnitProvider initialUnit="mm">
      <SequencePropertiesPanel
        sequence={sequence}
        resolved={resolveActionSequence(sequence)}
        selection={selection}
        onReplaceBlock={onReplaceBlock}
        onUpdateSegment={onUpdateSegment}
        onDeleteBlock={vi.fn()}
      />
    </DisplayLengthUnitProvider>,
  );
  return { onUpdateSegment, onReplaceBlock };
};

const phases = () => within(screen.getByRole("region", { name: "阶段" }));

/** 在阶段的数字框里填值后回车 */
const typeNumeric = (label: string, value: string) => {
  const input = phases().getByRole("spinbutton", { name: label });
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: "Enter" });
};

const valueOf = (label: string) =>
  (phases().getByRole("spinbutton", { name: label }) as HTMLInputElement).value;

/** 阶段三行（加速、匀速、减速）各自的 − 或 + 按钮 */
const stepButtons = (name: "增加" | "减少") => phases().getAllByRole("button", { name });

beforeAll(() => {
  Object.defineProperties(HTMLElement.prototype, {
    setPointerCapture: { configurable: true, value: vi.fn() },
    hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
    releasePointerCapture: { configurable: true, value: vi.fn() },
  });
});

afterEach(() => {
  cleanup();
  builderState.current.phaseInputMode = "time";
  builderState.current.handleWriteSegmentProfiles.mockClear();
  builderState.current.handleRetimeSegmentCurves.mockClear();
  builderState.current.handlePhaseInputModeChange.mockClear();
  toastWarning.mockClear();
});

describe("one selected segment", () => {
  it("edits both end poses above the curve, without tabs", () => {
    const { onReplaceBlock } = renderPanel(oneSpan, {
      kind: "multi-block",
      blockIds: ["a", "b"],
      focus: "segments",
    });
    expect(screen.getByRole("heading", { name: "运动区间" })).not.toBeNull();
    expect(screen.queryByRole("tab", { name: "位姿（2）" })).toBeNull();
    expect(screen.getByRole("slider", { name: "加速结束" })).not.toBeNull();

    const start = within(screen.getByRole("region", { name: "起点位姿" }));
    const end = within(screen.getByRole("region", { name: "终点位姿" }));
    expect(start.getByText("0.0 s")).not.toBeNull();
    expect(end.getByText("5.0 s")).not.toBeNull();
    // 两端默认折叠，展开才能改
    expect(start.queryByLabelText("虚轴1")).toBeNull();
    expect(end.queryByLabelText("虚轴1")).toBeNull();
    fireEvent.click(end.getByRole("button", { name: "终点位姿" }));
    expect(start.queryByLabelText("虚轴1")).toBeNull();
    // 终点的虚轴1 加一档
    const endV1 = end.getByLabelText("虚轴1").closest("[data-history-interaction='numeric']");
    fireEvent.mouseDown(within(endV1 as HTMLElement).getByRole("button", { name: "增加" }));
    fireEvent.mouseUp(within(endV1 as HTMLElement).getByRole("button", { name: "增加" }));
    expect(onReplaceBlock).toHaveBeenCalledWith(expect.objectContaining({ id: "b" }));
    expect(onReplaceBlock).not.toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  });

  it("deletes both ends from the segment view", () => {
    const onDeleteBlock = vi.fn();
    render(
      <DisplayLengthUnitProvider initialUnit="mm">
        <SequencePropertiesPanel
          sequence={oneSpan}
          resolved={resolveActionSequence(oneSpan)}
          selection={{ kind: "multi-block", blockIds: ["a", "b"], focus: "segments" }}
          onReplaceBlock={vi.fn()}
          onUpdateSegment={vi.fn()}
          onDeleteBlock={onDeleteBlock}
        />
      </DisplayLengthUnitProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(onDeleteBlock).toHaveBeenCalledWith(["a", "b"]);
  });

  it("shows the same view for a box selection of exactly its two ends", () => {
    renderPanel(oneSpan, { kind: "multi-block", blockIds: ["a", "b"] });
    expect(screen.getByRole("heading", { name: "运动区间" })).not.toBeNull();
    expect(screen.getByRole("region", { name: "终点位姿" })).not.toBeNull();
  });

  it("keeps the tabs when more than the segment's ends are selected", () => {
    renderPanel(twoSpans, { kind: "multi-block", blockIds: ["a1", "b1", "a2"] });
    expect(screen.getByRole("heading", { name: "多选位姿" })).not.toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "运动区间（1）" }));
    expect(screen.getByRole("heading", { name: "运动区间" })).not.toBeNull();
    expect(screen.queryByRole("region", { name: "终点位姿" })).toBeNull();
  });

  it("switches the phase input mode from the segment editor", () => {
    renderPanel(oneSpan, { kind: "multi-block", blockIds: ["a", "b"], focus: "segments" });
    fireEvent.click(phases().getByRole("tab", { name: "按速度" }));
    expect(builderState.current.handlePhaseInputModeChange).toHaveBeenCalledWith("speed");
  });
});

describe("按时间 on one segment", () => {
  it("lays the phases out in rows with − + and steps a phase by 0.1 s", () => {
    const { onUpdateSegment } = renderPanel(oneSpan, {
      kind: "multi-block",
      blockIds: ["a", "b"],
      focus: "segments",
    });
    expect([valueOf("加速时间"), valueOf("匀速时间"), valueOf("减速时间")]).toEqual(["1.0", "3.0", "1.0"]);
    const [accelUp] = stepButtons("增加");
    fireEvent.click(accelUp!);
    expect(onUpdateSegment).toHaveBeenCalledWith("a", "b", {
      profiles: expect.objectContaining({
        v1: { kind: "trapezoid", params: { accelMs: 1100, decelMs: 1000 } },
      }),
    });
  });

  it("still takes a typed time", () => {
    const { onUpdateSegment } = renderPanel(oneSpan, {
      kind: "multi-block",
      blockIds: ["a", "b"],
      focus: "segments",
    });
    typeNumeric("减速时间", "0.5");
    expect(onUpdateSegment).toHaveBeenCalledWith("a", "b", {
      profiles: expect.objectContaining({
        v1: { kind: "trapezoid", params: { accelMs: 1000, decelMs: 500 } },
      }),
    });
  });
});

describe("按速度 on one segment", () => {
  it("shows the acceleration, cruise speed and deceleration of the curve", () => {
    builderState.current.phaseInputMode = "speed";
    renderPanel(oneSpan, { kind: "multi-block", blockIds: ["a", "b"], focus: "segments" });
    expect([valueOf("加速度"), valueOf("匀速速度"), valueOf("减速度")]).toEqual(["100.0", "100.0", "100.0"]);
    expect(phases().getAllByText("mm/s²")).toHaveLength(2);
    expect(phases().getByText("mm/s")).not.toBeNull();
    expect(phases().queryByRole("spinbutton", { name: "加速时间" })).toBeNull();
  });

  const retimeWrites = () =>
    builderState.current.handleRetimeSegmentCurves.mock.calls.map(([writes]) => writes[0]);

  it("keeps the cruise speed and deceleration and changes the duration when the acceleration changes", () => {
    builderState.current.phaseInputMode = "speed";
    const { onUpdateSegment } = renderPanel(oneSpan, {
      kind: "multi-block",
      blockIds: ["a", "b"],
      focus: "segments",
    });
    // 加速度 200：0.5 s 加速 + 1 s 减速 + 3.25 s 匀速，约 4.75 s
    typeNumeric("加速度", "200");
    expect(onUpdateSegment).not.toHaveBeenCalled();
    const [write] = retimeWrites();
    expect(write).toMatchObject({
      objectId: 1,
      fromRef: "a",
      toRef: "b",
      axis: "v1",
      profile: { kind: "trapezoid", params: { accelMs: 500, decelMs: 1000 } },
    });
    expect([4700, 4800]).toContain(write.durationMs);
  });

  it("takes a typed cruise speed and works out the duration", () => {
    builderState.current.phaseInputMode = "speed";
    renderPanel(oneSpan, { kind: "multi-block", blockIds: ["a", "b"], focus: "segments" });
    typeNumeric("匀速速度", "80");
    expect(retimeWrites()).toEqual([
      {
        objectId: 1,
        fromRef: "a",
        toRef: "b",
        axis: "v1",
        profile: { kind: "trapezoid", params: { accelMs: 800, decelMs: 800 } },
        durationMs: 5800,
      },
    ]);
  });

  it("steps the acceleration one 0.1 s level per + click", () => {
    builderState.current.phaseInputMode = "speed";
    renderPanel(oneSpan, { kind: "multi-block", blockIds: ["a", "b"], focus: "segments" });
    const [accelUp] = stepButtons("增加");
    fireEvent.click(accelUp!);
    fireEvent.click(accelUp!);
    // 两档：加速时间 1.0 s → 0.9 s → 0.8 s
    expect(retimeWrites().map((write) => write.profile.params.accelMs)).toEqual([900, 800]);
  });

  it("steps the cruise speed one 0.1 s of duration per click", () => {
    builderState.current.phaseInputMode = "speed";
    renderPanel(oneSpan, { kind: "multi-block", blockIds: ["a", "b"], focus: "segments" });
    const [, cruiseUp] = stepButtons("增加");
    fireEvent.click(cruiseUp!);
    expect(retimeWrites().map((write) => write.durationMs)).toEqual([4900]);
  });

  it("steps the deceleration one level per − click", () => {
    builderState.current.phaseInputMode = "speed";
    renderPanel(oneSpan, { kind: "multi-block", blockIds: ["a", "b"], focus: "segments" });
    const [, , decelDown] = stepButtons("减少");
    fireEvent.click(decelDown!);
    expect(retimeWrites()[0]?.profile.params.decelMs).toBe(1100);
  });

  it("warns and keeps the curve when the distance is too short for the speed", () => {
    builderState.current.phaseInputMode = "speed";
    renderPanel(oneSpan, { kind: "multi-block", blockIds: ["a", "b"], focus: "segments" });
    typeNumeric("加速度", "10");
    expect(builderState.current.handleRetimeSegmentCurves).not.toHaveBeenCalled();
    expect(toastWarning).toHaveBeenCalledWith("行程太短，按这组加减速度到不了这个匀速速度");
  });
});

describe("batch editing several segments", () => {
  const both: SequenceSelection = {
    kind: "multi-block",
    blockIds: ["a1", "b1", "a2", "b2"],
    focus: "segments",
  };

  it("shows shared phase values and -- where the segments differ", () => {
    renderPanel(twoSpans, both);
    expect(screen.getByRole("heading", { name: "多选运动区间" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "V1 2 段" })).not.toBeNull();
    // 默认 20% 加减速：0.4 s 与 0.8 s
    const accel = phases().getByRole("spinbutton", { name: "加速时间" }) as HTMLInputElement;
    expect(accel.value).toBe("");
    expect(accel.placeholder).toBe("--");
  });

  it("writes a phase time to every selected segment", () => {
    renderPanel(twoSpans, both);
    const accel = phases().getByRole("spinbutton", { name: "加速时间" });
    fireEvent.change(accel, { target: { value: "0.5" } });
    fireEvent.blur(accel);
    expect(builderState.current.handleWriteSegmentProfiles).toHaveBeenCalledWith([
      {
        fromRef: "a1",
        toRef: "b1",
        axis: "v1",
        profile: { kind: "trapezoid", params: { accelMs: 500, decelMs: 400 } },
        durationMs: 2000,
      },
      {
        fromRef: "a2",
        toRef: "b2",
        axis: "v1",
        profile: { kind: "trapezoid", params: { accelMs: 500, decelMs: 800 } },
        durationMs: 4000,
      },
    ]);
  });

  it("steps every selected segment's phase time by 0.1 s with − +", () => {
    renderPanel(twoSpans, both);
    const [, , decelDown] = stepButtons("减少");
    fireEvent.click(decelDown!);
    const [writes] = builderState.current.handleWriteSegmentProfiles.mock.calls[0]!;
    expect(writes).toEqual([
      expect.objectContaining({ fromRef: "a1", profile: { kind: "trapezoid", params: { accelMs: 400, decelMs: 300 } } }),
      expect.objectContaining({ fromRef: "a2", profile: { kind: "trapezoid", params: { accelMs: 800, decelMs: 700 } } }),
    ]);
  });

  it("gives every selected segment the same acceleration by speed and retimes each", () => {
    builderState.current.phaseInputMode = "speed";
    renderPanel(twoSpans, both);
    expect(valueOf("匀速速度")).toBe("125.0");
    const accel = phases().getByRole("spinbutton", { name: "加速度" }) as HTMLInputElement;
    expect(accel.value).toBe("");
    expect(accel.placeholder).toBe("--");

    // 各段保持自己的匀速和减速度（312.5、156.25），时长各自算：约 2.05 s、3.85 s
    typeNumeric("加速度", "250");
    expect(builderState.current.handleWriteSegmentProfiles).not.toHaveBeenCalled();
    const [writes] = builderState.current.handleRetimeSegmentCurves.mock.calls[0]!;
    expect(writes).toEqual([
      expect.objectContaining({ objectId: 1, fromRef: "a1", toRef: "b1", axis: "v1" }),
      expect.objectContaining({ objectId: 2, fromRef: "a2", toRef: "b2", axis: "v1" }),
    ]);
    expect([2000, 2100]).toContain(writes[0].durationMs);
    expect([3800, 3900]).toContain(writes[1].durationMs);
    expect(writes.map((write: { profile: { params: { accelMs: number } } }) => write.profile.params.accelMs)).toEqual([
      500, 500,
    ]);
  });

  it("skips and reports the segments that cannot reach the speed", () => {
    builderState.current.phaseInputMode = "speed";
    renderPanel(twoSpans, both);
    // 加速度 30、匀速 125：加速要走 260，2 s 那段只有 200
    typeNumeric("加速度", "30");
    const [writes] = builderState.current.handleRetimeSegmentCurves.mock.calls[0]!;
    expect(writes.map((write: { fromRef: string }) => write.fromRef)).toEqual(["a2"]);
    expect(toastWarning).toHaveBeenCalledWith(
      "有 1 段没有修改：行程太短，按这组加减速度到不了这个匀速速度",
    );
  });
});
