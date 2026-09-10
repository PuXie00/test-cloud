// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DisplayLengthUnitProvider } from "@/app/project/display-length-unit-provider";
import { resolveActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import { SelectionContextBar } from "./selection-context-bar";

const sequence: ActionSequenceConfig = {
  id: "seq",
  name: "Seq",
  trajectoryMode: "non-forced",
  blocks: [
    { id: "pose", kind: "pose", objectId: 7, atMs: 1000, pose: { v1: 1, v2: 2, v3: 3 } },
    { id: "enable", kind: "set-enabled", objectId: 7, atMs: 500, enabled: true },
  ],
  segments: [],
};
const resolved = resolveActionSequence(sequence);

const { builderState } = vi.hoisted(() => ({
  builderState: { current: {} as Record<string, unknown> },
}));

vi.mock("../use-action-builder", () => ({
  useActionBuilder: () => builderState.current,
}));

const onReplaceBlock = vi.fn();
const onUpdateSegment = vi.fn();
const onDeleteBlock = vi.fn();

const renderBar = (
  selection: Parameters<typeof SelectionContextBar>[0]["selection"],
  selectedObjectIds: number[] = [],
) => {
  builderState.current = {
    getTimelineObject: (id: number) => ({
      id,
      name: `模型 ${id}`,
      currentPosition: 0,
      unit: "mm",
      axisLabel: "H",
      enabled: true,
    }),
  };
  return render(
    <DisplayLengthUnitProvider initialUnit="mm">
      <SelectionContextBar
        sequence={sequence}
        resolved={resolved}
        selection={selection}
        selectedObjectIds={selectedObjectIds}
        onReplaceBlock={onReplaceBlock}
        onUpdateSegment={onUpdateSegment}
        onDeleteBlock={onDeleteBlock}
      />
    </DisplayLengthUnitProvider>,
  );
};

afterEach(() => {
  cleanup();
  onReplaceBlock.mockClear();
  onUpdateSegment.mockClear();
  onDeleteBlock.mockClear();
});

describe("selection context bar", () => {
  it("shows pose context from an authored timeline block", () => {
    renderBar({ kind: "block", blockId: "pose" });
    expect(screen.getByText("位姿")).not.toBeNull();
    expect(screen.queryByText("目标值")).toBeNull();
  });

  it("deletes the selected timeline block", () => {
    renderBar({ kind: "block", blockId: "pose" });
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(onDeleteBlock).toHaveBeenCalledWith("pose");
  });

  it("shows command context for set-enabled blocks", () => {
    renderBar({ kind: "block", blockId: "enable" });
    expect(screen.getByText("使能指令")).not.toBeNull();
    expect(screen.queryByText("goto-value")).toBeNull();
  });

  it("shows orchestration duration for the sequence when nothing is selected", () => {
    renderBar(null);
    expect(screen.getByText("编排时长")).not.toBeNull();
    expect(screen.queryByText("总时长")).toBeNull();
  });

  it("shows segment duration without compact phase fields", () => {
    const withLater: ActionSequenceConfig = {
      ...sequence,
      blocks: [
        ...sequence.blocks,
        { id: "later", kind: "pose", objectId: 7, atMs: 2500, pose: { v1: 4, v2: 5, v3: 6 } },
      ],
    };
    builderState.current = {
      getTimelineObject: () => ({
        id: 7,
        name: "模型 7",
        currentPosition: 0,
        unit: "mm",
        axisLabel: "H",
        enabled: true,
      }),
    };
    render(
      <DisplayLengthUnitProvider initialUnit="mm">
        <SelectionContextBar
          sequence={withLater}
          resolved={resolveActionSequence(withLater)}
          selection={{ kind: "segment", objectId: 7, fromRef: "pose", toRef: "later" }}
          selectedObjectIds={[]}
          onReplaceBlock={onReplaceBlock}
          onUpdateSegment={onUpdateSegment}
          onDeleteBlock={onDeleteBlock}
        />
      </DisplayLengthUnitProvider>,
    );
    expect(screen.getByText("运动区间")).not.toBeNull();
    expect(screen.getByLabelText("时长")).not.toBeNull();
    expect(screen.queryByRole("spinbutton", { name: "加速占比" })).toBeNull();
    expect(screen.queryByRole("spinbutton", { name: "加速时间" })).toBeNull();
  });
});
