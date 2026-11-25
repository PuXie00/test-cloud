// @vitest-environment jsdom
import { cleanup, createEvent, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DisplayLengthUnitProvider } from "@/app/project/display-length-unit-provider";
import { resolveActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import { buildSequenceRefBlock } from "@/app/project/action-sequence/sequence-ref";
import type { ActionSequenceConfig, MotionSegmentConfig } from "@/app/project/action-sequence/types";
import { ContentLibraryPanel } from "./content-library/content-library-panel";
import { SEQUENCE_REF_MIME } from "./content-library/library-dnd";
import { SequencePropertiesPanel } from "./right-panel/sequence-properties-panel";
import { TimelineEditor } from "./timeline/timeline-editor";
import { msToPx } from "./timeline/timeline-data";
import { createTimelineProps, installTimelinePaneWidth } from "./timeline/timeline-test-helpers";

const { builderState } = vi.hoisted(() => ({ builderState: { current: {} as Record<string, unknown> } }));

vi.mock("./use-action-builder", () => ({ useActionBuilder: () => builderState.current }));
vi.mock("@/app/project/use-project", () => ({ useProject: () => ({ currentProject: null }) }));

const ramp: MotionSegmentConfig = {
  fromRef: "s0",
  toRef: "s1",
  settings: {
    profiles: {
      v1: { kind: "trapezoid", params: { accelMs: 300, decelMs: 300 } },
      v2: { kind: "idle" },
      v3: { kind: "idle" },
    },
  },
};

// 被引用的「抬起」：物体 7 两秒从 100 走到 300
const source: ActionSequenceConfig = {
  id: 2,
  name: "抬起",
  trajectoryMode: false,
  blocks: [
    { id: "s0", kind: "pose", objectId: 7, atMs: 0, pose: { v1: 100 } },
    { id: "s1", kind: "pose", objectId: 7, atMs: 2000, pose: { v1: 300 } },
  ],
  segments: [ramp],
};

const parent: ActionSequenceConfig = {
  id: 1,
  name: "主序列",
  trajectoryMode: false,
  blocks: [
    { id: "p0", kind: "pose", objectId: 7, atMs: 0, pose: { v1: 0 } },
    buildSequenceRefBlock(source, { id: "ref", atMs: 1000 }),
  ],
  segments: [],
};

let restorePaneWidth: (() => void) | undefined;
beforeEach(() => {
  restorePaneWidth = installTimelinePaneWidth();
});
afterEach(() => {
  restorePaneWidth?.();
  cleanup();
});

describe("a reference on the timeline", () => {
  it("shows a named bar as long as the referenced sequence that opens it on double-click", () => {
    const onOpenSequence = vi.fn();
    const onPresetMove = vi.fn();
    render(
      <TimelineEditor
        {...createTimelineProps(parent)}
        sequenceNames={new Map([[2, "抬起"]])}
        onOpenSequence={onOpenSequence}
        onPresetMove={onPresetMove}
        snapEnabled={false}
      />,
    );
    const bar = screen.getByRole("button", { name: "引用 抬起" });
    expect(bar.style.left).toBe(`${msToPx(1000, 100)}px`);
    expect(bar.style.width).toBe(`${msToPx(2000, 100)}px`);
    fireEvent.doubleClick(bar);
    expect(onOpenSequence).toHaveBeenCalledWith(2);
    fireEvent.pointerDown(bar, { clientX: 108, button: 0 });
    fireEvent.pointerMove(window, { clientX: 158 });
    fireEvent.pointerUp(window);
    expect(onPresetMove).toHaveBeenLastCalledWith("ref", 1500);
  });

  it("keeps a reference whose sequence was deleted, under its stored name", () => {
    const onOpenSequence = vi.fn();
    render(
      <TimelineEditor {...createTimelineProps(parent)} sequenceNames={new Map()} onOpenSequence={onOpenSequence} />,
    );
    const bar = screen.getByRole("button", { name: "引用 抬起" });
    expect(bar.getAttribute("title")).toContain("原序列已删除");
    fireEvent.doubleClick(bar);
    expect(onOpenSequence).not.toHaveBeenCalled();
  });

  it("references a sequence dropped from the library at the drop time", () => {
    const onDropSequence = vi.fn();
    render(<TimelineEditor {...createTimelineProps(parent)} onDropSequence={onDropSequence} snapEnabled={false} />);
    const tracks = screen.getByTestId("timeline-tracks");
    const dataTransfer = {
      types: [SEQUENCE_REF_MIME],
      dropEffect: "none",
      getData: (type: string) => (type === SEQUENCE_REF_MIME ? JSON.stringify({ id: 2 }) : ""),
    };
    // jsdom 的拖放事件不带指针位置，补上
    const at = (event: Event) => {
      Object.defineProperty(event, "clientX", { value: 408 });
      return event;
    };
    fireEvent(tracks, at(createEvent.dragOver(tracks, { dataTransfer })));
    expect(screen.getByTestId("timeline-drop-line")).toBeTruthy();
    fireEvent(tracks, at(createEvent.drop(tracks, { dataTransfer })));
    expect(onDropSequence).toHaveBeenCalledWith(2, 4000);
    expect(screen.queryByTestId("timeline-drop-line")).toBeNull();
  });
});

describe("a reference in the properties panel", () => {
  it("says what it follows and can open or expand it", () => {
    const handleExplodeSequenceRefs = vi.fn();
    const handleSequenceSelect = vi.fn();
    builderState.current = {
      sequences: [parent, source],
      draftSequenceIds: new Set([2]),
      getTimelineObject: (id: number) => ({ id, name: `升降-${id}` }),
      handleExplodeSequenceRefs,
      handleExplodePresets: vi.fn(),
      handleSequenceSelect,
      sequenceIssues: [],
    };
    render(
      <DisplayLengthUnitProvider initialUnit="mm">
        <SequencePropertiesPanel
          sequence={parent}
          resolved={resolveActionSequence(parent)}
          selection={{ kind: "block", blockId: "ref" }}
          onReplaceBlock={vi.fn()}
          onUpdateSegment={vi.fn()}
          onDeleteBlock={vi.fn()}
        />
      </DisplayLengthUnitProvider>,
    );
    expect(screen.getByText("引用「抬起」")).toBeTruthy();
    expect(screen.getByText("「抬起」有未保存的修改，保存后这里跟着变")).toBeTruthy();
    expect(screen.getByLabelText("引用时长").textContent).toBe("2.0 s（到 3.0 s）");
    fireEvent.click(screen.getByRole("button", { name: "打开「抬起」" }));
    expect(handleSequenceSelect).toHaveBeenCalledWith(2);
    fireEvent.click(screen.getByRole("button", { name: "展开成普通块" }));
    expect(handleExplodeSequenceRefs).toHaveBeenCalledWith(["ref"]);
  });
});

describe("referencing from the sequence library", () => {
  it("references the right-clicked sequence at the playhead of the one being edited", async () => {
    const handleInsertSequenceRef = vi.fn(() => true);
    builderState.current = {
      sequences: [parent, source],
      draftSequenceIds: new Set<number>(),
      dockMode: "sequence",
      selectedSequenceId: 1,
      programs: [],
      selectedObjectIds: [],
      handleSequenceSelect: vi.fn(),
      handleCreateSequence: () => {},
      handleProgramItemInsert: () => {},
      handleInsertSequenceRef,
    };
    render(<ContentLibraryPanel />);
    fireEvent.contextMenu(screen.getByRole("button", { name: "抬起" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "在游标处引用「抬起」" }));
    expect(handleInsertSequenceRef).toHaveBeenCalledWith(2);
  });

  it("puts the sequence on the drag for the timeline", () => {
    builderState.current = {
      sequences: [parent, source],
      draftSequenceIds: new Set<number>(),
      dockMode: "sequence",
      selectedSequenceId: 1,
      programs: [],
      selectedObjectIds: [],
      handleSequenceSelect: vi.fn(),
      handleCreateSequence: () => {},
      handleProgramItemInsert: () => {},
    };
    render(<ContentLibraryPanel />);
    const data = new Map<string, string>();
    const dataTransfer = { setData: (type: string, value: string) => data.set(type, value), effectAllowed: "" };
    fireEvent.dragStart(screen.getByRole("button", { name: "抬起" }), { dataTransfer });
    expect(JSON.parse(data.get(SEQUENCE_REF_MIME) ?? "null")).toEqual({ id: 2 });
  });
});
