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
  render(
    <DisplayLengthUnitProvider initialUnit="mm">
      <SequencePropertiesPanel
        sequence={sequence}
        resolved={resolveActionSequence(sequence)}
        selection={selection}
        onReplaceBlock={vi.fn()}
        onUpdateSegment={onUpdateSegment}
        onDeleteBlock={vi.fn()}
      />
    </DisplayLengthUnitProvider>,
  );
  return { onUpdateSegment };
};

const phases = () => within(screen.getByRole("region", { name: "阶段" }));

/** 点一下数值进入输入，填值后回车 */
const typeNumeric = (label: string, value: string) => {
  const readout = phases().getByLabelText(label);
  fireEvent.pointerDown(readout, { pointerId: 1, button: 0, clientX: 0 });
  fireEvent.pointerUp(readout, { pointerId: 1, button: 0, clientX: 0 });
  const input = phases().getByRole("textbox", { name: label });
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: "Enter" });
};

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
  builderState.current.handlePhaseInputModeChange.mockClear();
  toastWarning.mockClear();
});

describe("segment tabs in a multi-selection", () => {
  it("opens on the segment when the selection came from clicking it", () => {
    renderPanel(oneSpan, { kind: "multi-block", blockIds: ["a", "b"], focus: "segments" });
    expect(screen.getByRole("heading", { name: "运动区间" })).not.toBeNull();
    expect(screen.getByRole("slider", { name: "加速结束" })).not.toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "位姿（2）" }));
    expect(screen.getByRole("heading", { name: "多选位姿" })).not.toBeNull();
    expect(screen.getByLabelText("虚轴1")).not.toBeNull();
  });

  it("opens on the poses for a box selection that also covers a segment", () => {
    renderPanel(oneSpan, { kind: "multi-block", blockIds: ["a", "b"] });
    expect(screen.getByRole("heading", { name: "多选位姿" })).not.toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "运动区间（1）" }));
    expect(screen.getByRole("heading", { name: "运动区间" })).not.toBeNull();
  });

  it("switches the phase input mode from the segment editor", () => {
    renderPanel(oneSpan, { kind: "multi-block", blockIds: ["a", "b"], focus: "segments" });
    fireEvent.click(phases().getByRole("tab", { name: "按速度" }));
    expect(builderState.current.handlePhaseInputModeChange).toHaveBeenCalledWith("speed");
  });
});

describe("按速度 on one segment", () => {
  it("shows the acceleration, cruise speed and deceleration of the curve", () => {
    builderState.current.phaseInputMode = "speed";
    renderPanel(oneSpan, { kind: "multi-block", blockIds: ["a", "b"], focus: "segments" });
    expect(phases().getByLabelText("加速度").textContent).toBe("100.0mm/s²");
    expect(phases().getByLabelText("匀速速度").textContent).toBe("100.0mm/s");
    expect(phases().getByLabelText("减速度").textContent).toBe("100.0mm/s²");
    expect(phases().queryByRole("spinbutton", { name: "加速时间" })).toBeNull();
  });

  it("keeps the deceleration and the duration when the acceleration changes", () => {
    builderState.current.phaseInputMode = "speed";
    const { onUpdateSegment } = renderPanel(oneSpan, {
      kind: "multi-block",
      blockIds: ["a", "b"],
      focus: "segments",
    });
    // 200 mm/s² 加速、100 mm/s² 减速走完 400：精确是 0.46 s / 0.93 s；
    // 取整到 0.1 s 的组合里，不超过所填值又最接近的是 0.5 s / 1.0 s（188.2 / 94.1）
    typeNumeric("加速度", "200");
    expect(onUpdateSegment).toHaveBeenCalledWith("a", "b", {
      profiles: expect.objectContaining({
        v1: { kind: "trapezoid", params: { accelMs: 500, decelMs: 1000 } },
      }),
    });
  });

  it("warns and keeps the curve when the rates cannot cover the distance in time", () => {
    builderState.current.phaseInputMode = "speed";
    const { onUpdateSegment } = renderPanel(oneSpan, {
      kind: "multi-block",
      blockIds: ["a", "b"],
      focus: "segments",
    });
    typeNumeric("加速度", "10");
    expect(onUpdateSegment).not.toHaveBeenCalled();
    expect(toastWarning).toHaveBeenCalledWith("加减速度太小或进出速度太快，这段时间里排不下");
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

  it("gives every selected segment the same acceleration by speed", () => {
    builderState.current.phaseInputMode = "speed";
    renderPanel(twoSpans, both);
    expect(phases().getByLabelText("匀速速度").textContent).toBe("125.0mm/s");
    expect(phases().getByLabelText("加速度").textContent).toContain("--");

    // 各段保持自己的减速度（312.5、156.25）；取整后不超过所填值
    typeNumeric("加速度", "250");
    const [writes] = builderState.current.handleWriteSegmentProfiles.mock.calls[0]!;
    expect(writes).toEqual([
      expect.objectContaining({
        fromRef: "a1",
        profile: { kind: "trapezoid", params: { accelMs: 600, decelMs: 500 } },
      }),
      expect.objectContaining({
        fromRef: "a2",
        profile: { kind: "trapezoid", params: { accelMs: 500, decelMs: 800 } },
      }),
    ]);
  });

  it("skips and reports the segments a rate cannot fit", () => {
    builderState.current.phaseInputMode = "speed";
    renderPanel(twoSpans, both);
    // 保持各自的加速度时，2 s 走 200 的减速度至少要约 147 mm/s²，4 s 走 400 约 74 就够
    typeNumeric("减速度", "100");
    const calls = builderState.current.handleWriteSegmentProfiles.mock.calls;
    const writes = calls[0]?.[0] ?? [];
    expect(writes.map((write: { fromRef: string }) => write.fromRef)).toEqual(["a2"]);
    expect(toastWarning).toHaveBeenCalledWith(
      "有 1 段没有修改：加减速度太小或进出速度太快，这段时间里排不下",
    );
  });
});
