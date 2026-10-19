// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DisplayLengthUnitProvider } from "@/app/project/display-length-unit-provider";
import { resolveActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import type { SequenceSelection } from "../sequence-selection";
import { SequencePropertiesPanel } from "./sequence-properties-panel";

vi.mock("../use-action-builder", () => ({
  useActionBuilder: () => ({
    getTimelineObject: () => ({ enabledAxes: ["v1", "v2"] }),
    getLivePose: () => ({ v1: 0, v2: 12, v3: 0 }),
    handleApplyPoseAxisWrite: vi.fn(),
    sequenceIssues: [],
  }),
}));

// 虚轴1 在 p1 经过、虚轴2 在 p2 经过
const wave: ActionSequenceConfig = {
  id: 1,
  name: "wave",
  trajectoryMode: false,
  blocks: [
    { id: "p0", kind: "pose", objectId: 1, atMs: 0, pose: { v1: 0, v2: 0, v3: 0 } },
    { id: "p1", kind: "pose", objectId: 1, atMs: 2000, pose: { v2: 0, v3: 0 } },
    { id: "p2", kind: "pose", objectId: 1, atMs: 4000, pose: { v1: 1000, v3: 0 } },
    { id: "p3", kind: "pose", objectId: 1, atMs: 6000, pose: { v2: 1000, v3: 0 } },
  ],
  segments: [],
};

const renderPanel = (selection: SequenceSelection, sequence: ActionSequenceConfig = wave) => {
  const onReplaceBlock = vi.fn();
  const onUpdateSegment = vi.fn();
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
  return { onReplaceBlock, onUpdateSegment };
};

afterEach(cleanup);

describe("pose axes passing through", () => {
  it("shows the pass-through value read-only and sets the axis back at that value", () => {
    const { onReplaceBlock } = renderPanel({ kind: "block", blockId: "p1" });
    expect(screen.getByLabelText("虚轴1").textContent).toContain("500.0");
    const toggle = screen.getByRole("button", { name: "虚轴1 经过" });
    const v2Row = screen.getByRole("button", { name: "虚轴2 经过" }).parentElement!;
    // 经过的轴不能直接改值，没有步进按钮
    expect(within(toggle.parentElement!).queryByRole("button", { name: "减少" })).toBeNull();
    expect(within(v2Row).queryByRole("button", { name: "减少" })).not.toBeNull();
    expect(toggle.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(toggle);
    expect(onReplaceBlock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "p1", pose: { v1: 500, v2: 0, v3: 0 } }),
    );
  });

  it("unsets an axis but keeps at least one enabled axis set", () => {
    const { onReplaceBlock } = renderPanel({ kind: "block", blockId: "p0" });
    fireEvent.click(screen.getByRole("button", { name: "虚轴1 经过" }));
    expect(onReplaceBlock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "p0", pose: { v2: 0, v3: 0 } }),
    );
    cleanup();

    renderPanel({ kind: "block", blockId: "p3" });
    expect((screen.getByRole("button", { name: "虚轴2 经过" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("edits the whole span of an axis that passes the band's end", () => {
    renderPanel({ kind: "multi-block", blockIds: ["p1", "p2"], focus: "segments" });
    fireEvent.click(screen.getByRole("button", { name: /^V1 / }));
    expect(screen.getByText(/虚轴1在区间端点经过，这里是 0\.0–4\.0 s 整段曲线/)).not.toBeNull();
    expect(screen.getByLabelText("时长").textContent).toBe("4.0 s");
  });

  it("marks an axis no pose sets as not controlled and sets it at the live position", () => {
    const liftOnly: ActionSequenceConfig = {
      ...wave,
      blocks: [
        { id: "a", kind: "pose", objectId: 1, atMs: 0, pose: { v1: 0 } },
        { id: "b", kind: "pose", objectId: 1, atMs: 2000, pose: { v1: 500 } },
      ],
    };
    const { onReplaceBlock } = renderPanel({ kind: "block", blockId: "b" }, liftOnly);
    expect(screen.getByLabelText("虚轴2").textContent).toContain("--");
    expect(screen.getByText("虚轴2 在所有位姿上都不设定，这条序列不控制它，停在原位")).not.toBeNull();
    expect(screen.queryByText(/经过的轴这一帧不停/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "虚轴2 经过" }));
    expect(onReplaceBlock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "b", pose: { v1: 500, v2: 12 } }),
    );
  });
});
