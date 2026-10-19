// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DisplayLengthUnitProvider } from "@/app/project/display-length-unit-provider";
import { resolveActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import type { ActionSequenceConfig, PoseBlock } from "@/app/project/action-sequence/types";
import type { SequenceSelection } from "../sequence-selection";
import { SequencePropertiesPanel } from "./sequence-properties-panel";

vi.mock("../use-action-builder", () => ({
  useActionBuilder: () => ({
    getTimelineObject: () => ({ enabledAxes: ["v1", "v2"] }),
    getLivePose: () => null,
    handleApplyPoseAxisWrite: vi.fn(),
    sequenceIssues: [],
  }),
}));

// 0–4s 慢速到 400，4–6s 快速到 1000；虚轴2 不动
const slowFast = (middle: Partial<PoseBlock> = {}): ActionSequenceConfig => ({
  id: 1,
  name: "slow-fast",
  trajectoryMode: true,
  blocks: [
    { id: "p0", kind: "pose", objectId: 1, atMs: 0, pose: { v1: 0, v2: 0 } },
    { id: "p1", kind: "pose", objectId: 1, atMs: 4000, pose: { v1: 400, v2: 0 }, ...middle },
    { id: "p2", kind: "pose", objectId: 1, atMs: 6000, pose: { v1: 1000, v2: 0 } },
  ],
  segments: [],
});

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

const speedRow = (label: string) => screen.getByRole("group", { name: `${label} 经过速度设置` });

afterEach(cleanup);

describe("pass speed on a pose", () => {
  it("shows the automatic pass speed and turns an edit into a hand-entered one", () => {
    const { onReplaceBlock } = renderPanel(slowFast(), { kind: "block", blockId: "p1" });
    const v1 = speedRow("虚轴1");
    expect(within(v1).getByLabelText("虚轴1 经过速度").textContent).toContain("150.0");
    expect(within(v1).getByText("自动")).not.toBeNull();
    // 虚轴2 前后都不动，固定为 0，不能改
    expect(within(speedRow("虚轴2")).getByText("停留")).not.toBeNull();
    expect(within(speedRow("虚轴2")).queryByRole("button", { name: "增加" })).toBeNull();

    fireEvent.mouseDown(within(v1).getByRole("button", { name: "增加" }));
    expect(onReplaceBlock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "p1", passSpeeds: { v1: 151 } }),
    );
  });

  it("shows a hand-entered 0 as a stop and can go back to automatic", () => {
    const { onReplaceBlock } = renderPanel(slowFast({ passSpeeds: { v1: 0 } }), {
      kind: "block",
      blockId: "p1",
    });
    const v1 = speedRow("虚轴1");
    expect(within(v1).getByText("停")).not.toBeNull();
    fireEvent.click(within(v1).getByRole("button", { name: "虚轴1 经过速度改回自动" }));
    const replaced = onReplaceBlock.mock.calls[0]?.[0];
    expect(replaced).not.toHaveProperty("passSpeeds");
  });

  it("drops the pass speed when the axis is set to pass through", () => {
    const { onReplaceBlock } = renderPanel(slowFast({ passSpeeds: { v1: 120 } }), {
      kind: "block",
      blockId: "p1",
    });
    fireEvent.click(screen.getByRole("button", { name: "虚轴1 经过" }));
    const replaced = onReplaceBlock.mock.calls[0]?.[0];
    expect(replaced.pose).toEqual({ v2: 0 });
    expect(replaced).not.toHaveProperty("passSpeeds");
  });

  it("fixes the speed at 0 where the axis turns back", () => {
    const turnBack: ActionSequenceConfig = {
      ...slowFast(),
      blocks: [
        { id: "p0", kind: "pose", objectId: 1, atMs: 0, pose: { v1: 0, v2: 0 } },
        { id: "p1", kind: "pose", objectId: 1, atMs: 4000, pose: { v1: 400, v2: 0 } },
        { id: "p2", kind: "pose", objectId: 1, atMs: 6000, pose: { v1: 0, v2: 0 } },
      ],
    };
    renderPanel(turnBack, { kind: "block", blockId: "p1" });
    const v1 = speedRow("虚轴1");
    expect(within(v1).getByText("折返停")).not.toBeNull();
    expect(within(v1).queryByRole("button", { name: "增加" })).toBeNull();
  });

  it("shows the entry speed and speed-change phases on the next segment", () => {
    renderPanel(slowFast(), { kind: "segment", objectId: 1, fromRef: "p1", toRef: "p2" });
    fireEvent.click(screen.getByRole("button", { name: /^V1 / }));
    expect(screen.getByText("从 150 mm/s 进入")).not.toBeNull();
    expect(screen.getByLabelText("段首变速")).not.toBeNull();
    expect(screen.getByLabelText("段尾变速")).not.toBeNull();
  });
});
