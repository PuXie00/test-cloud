// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import { resolveActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import type { TimelineEditorProps } from "../timeline/timeline-editor";
import { EditorDock } from "./editor-dock";

const sequence: ActionSequenceConfig = {
  id: 1,
  name: "Seq",
  trajectoryMode: "non-forced",
  blocks: [],
  segments: [],
};

const { builderState, capturedEditor } = vi.hoisted(() => ({
  builderState: { current: {} as Record<string, unknown> },
  capturedEditor: { current: null as TimelineEditorProps | null },
}));

vi.mock("../timeline/timeline-editor", () => ({
  TimelineEditor: (props: TimelineEditorProps) => {
    capturedEditor.current = props;
    return <div data-testid="timeline-editor" />;
  },
}));

vi.mock("../use-action-builder", () => ({
  useActionBuilder: () => builderState.current,
}));

vi.mock("../../../hooks/use-selection", () => ({
  useSelection: () => ({
    replaceSelection: vi.fn(),
    selectedId: null,
    multiSelectedIds: [],
  }),
}));

vi.mock("@/app/project/display-length-unit-provider", () => ({
  useSessionDisplayLengthUnit: () => "mm" as const,
}));

const handleSelectionChange = vi.fn();
const handleMoveTimelineBlock = vi.fn();
const handleResizeDynamicPreset = vi.fn();

const timelineObjects = [
  {
    id: 7,
    name: "模型 7",
    currentPosition: 0,
    unit: "mm",
    axisLabel: "H",
    enabled: true,
    enabledAxes: ["v1", "v2", "v3"],
  },
  {
    id: 8,
    name: "模型 8",
    currentPosition: 0,
    unit: "mm",
    axisLabel: "H",
    enabled: true,
    enabledAxes: ["v1", "v2", "v3"],
  },
];

const mockBuilder = (overrides: Record<string, unknown> = {}) => {
  builderState.current = {
    sequence,
    selection: null,
    selectedObjectIds: [7],
    timelineObjects,
    cursorMs: 500,
    timelinePxPerSecond: 16,
    canPasteBlock: false,
    dockMode: "sequence",
    handleSelectionChange,
    handleCursorChange: vi.fn(),
    handlePlaybackCursorChange: vi.fn(),
    handleMoveTimelineBlock,
    handleResizeDynamicPreset,
    handleBlockDelete: vi.fn(),
    handleDeleteSequence: vi.fn(),
    handleBlockCopy: vi.fn(),
    handleBlockPaste: vi.fn(),
    handleTimelinePxPerSecondChange: vi.fn(),
    handleTimelineZoomIn: vi.fn(),
    handleTimelineZoomOut: vi.fn(),
    handleSave: vi.fn(),
    handleTrajectoryModeChange: vi.fn(),
    handleLoopChange: vi.fn(),
    sequenceIssues: [],
    ...overrides,
  };
};

afterEach(() => {
  cleanup();
  capturedEditor.current = null;
});

describe("editor dock sequence editor", () => {
  beforeEach(() => {
    mockBuilder();
  });

  it("rewires TimelineEditor to authored selection and shared-preset handlers", () => {
    render(<EditorDock />);
    const props = capturedEditor.current;
    expect(props).not.toBeNull();
    expect(props!.sequence).toBe(sequence);
    expect(props!.resolved).toEqual(resolveActionSequence(sequence));
    expect(props!.selection).toBeNull();
    expect(props!.onSelectionChange).toBe(handleSelectionChange);
    expect(props!.onPoseMove).toBe(handleMoveTimelineBlock);
    expect(props!.onPresetMove).toBe(handleMoveTimelineBlock);
    expect(props!.onDynamicPresetResize).toBe(handleResizeDynamicPreset);
    expect(props!.objects).toBe(timelineObjects);
  });

  it("does not offer an add-action control in the sequence editor header", () => {
    render(<EditorDock />);
    expect(screen.queryByRole("button", { name: /添加动作/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "添加位姿" })).toBeNull();
    expect(screen.queryByLabelText("关闭添加动作")).toBeNull();
  });

  it("keeps SequenceEditor toolbar when an unknown preset cannot resolve", () => {
    const broken: ActionSequenceConfig = {
      id: 97,
      name: "Broken",
      trajectoryMode: "non-forced",
      blocks: [
        {
          id: "bad-preset",
          kind: "static-preset",
          presetId: "not-a-preset",
          atMs: 1000,
          orderedObjectIds: [7],
          params: { v1: 0, v2: 0, v3: 0 },
        },
      ],
      segments: [],
    };
    mockBuilder({ sequence: broken });
    expect(() => render(<EditorDock />)).not.toThrow();
    expect(screen.queryByRole("button", { name: /添加动作/ })).toBeNull();
    expect(screen.getByRole("button", { name: "保存" })).not.toBeNull();
    expect(screen.getByText("预设无法解析，可继续编辑块")).not.toBeNull();
    expect(capturedEditor.current).not.toBeNull();
    expect(capturedEditor.current!.sequence).toBe(broken);
    expect(capturedEditor.current!.resolved.totalMs).toBe(0);
    expect(capturedEditor.current!.resolved.initialPoseByObject).toEqual(new Map());
  });

  it("toggles trajectory mode from the sequence editor header", () => {
    const handleTrajectoryModeChange = vi.fn();
    mockBuilder({ handleTrajectoryModeChange });
    render(<EditorDock />);
    const toggle = screen.getByRole("switch", { name: "强制轨迹" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    expect(handleTrajectoryModeChange).toHaveBeenCalledWith("forced");
  });

  it("toggles trajectory mode from forced to non-forced in the sequence editor header", () => {
    const handleTrajectoryModeChange = vi.fn();
    mockBuilder({
      sequence: { ...sequence, trajectoryMode: "forced" },
      handleTrajectoryModeChange,
    });
    render(<EditorDock />);
    const toggle = screen.getByRole("switch", { name: "强制轨迹" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    expect(handleTrajectoryModeChange).toHaveBeenCalledWith("non-forced");
  });

  it("disables 循环 when the sequence path is not closed", () => {
    const handleLoopChange = vi.fn();
    mockBuilder({ handleLoopChange });
    render(<EditorDock />);
    const toggle = screen.getByRole("switch", { name: "循环" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(toggle.getAttribute("data-disabled")).toBe("");
    fireEvent.click(toggle);
    expect(handleLoopChange).not.toHaveBeenCalled();
  });

  it("toggles 循环 on when start and end poses match", () => {
    const handleLoopChange = vi.fn();
    const closed: ActionSequenceConfig = {
      id: 1,
      name: "Closed",
      trajectoryMode: "non-forced",
      loop: false,
      blocks: [
        {
          id: "a",
          kind: "pose",
          objectId: 7,
          atMs: 0,
          pose: { v1: 0, v2: 0, v3: 0 },
        },
        {
          id: "b",
          kind: "pose",
          objectId: 7,
          atMs: 1000,
          pose: { v1: 100, v2: 0, v3: 0 },
        },
        {
          id: "c",
          kind: "pose",
          objectId: 7,
          atMs: 2000,
          pose: { v1: 0, v2: 0, v3: 0 },
        },
      ],
      segments: [],
    };
    mockBuilder({ sequence: closed, handleLoopChange });
    render(<EditorDock />);
    const toggle = screen.getByRole("switch", { name: "循环" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(toggle.getAttribute("data-disabled")).toBeNull();
    fireEvent.click(toggle);
    expect(handleLoopChange).toHaveBeenCalledWith(true);
  });

  it("deletes multi-selected timeline blocks on window Delete when the dock is unfocused", () => {
    const handleBlockDelete = vi.fn();
    mockBuilder({
      selection: { kind: "multi-block", blockIds: ["pose-a", "pose-b"] },
      handleBlockDelete,
    });
    render(<EditorDock />);
    fireEvent.keyDown(window, { key: "Delete" });
    expect(handleBlockDelete).toHaveBeenCalledTimes(1);
  });

  it("does not delete timeline blocks while typing in an input", () => {
    const handleBlockDelete = vi.fn();
    mockBuilder({
      selection: { kind: "multi-block", blockIds: ["pose-a", "pose-b"] },
      handleBlockDelete,
    });
    render(
      <>
        <input aria-label="到达时间" />
        <EditorDock />
      </>,
    );
    fireEvent.keyDown(screen.getByLabelText("到达时间"), { key: "Delete" });
    expect(handleBlockDelete).not.toHaveBeenCalled();
  });

  it("toolbar 删除序列 deletes the current sequence even when blocks are selected", () => {
    const handleDeleteSequence = vi.fn();
    const handleBlockDelete = vi.fn();
    mockBuilder({
      selection: { kind: "multi-block", blockIds: ["pose-a", "pose-b"] },
      handleDeleteSequence,
      handleBlockDelete,
    });
    render(<EditorDock />);
    fireEvent.click(screen.getByRole("button", { name: "删除序列" }));
    expect(handleDeleteSequence).toHaveBeenCalledTimes(1);
    expect(handleBlockDelete).not.toHaveBeenCalled();
  });

  it("enables 删除序列 without a timeline block selection", () => {
    mockBuilder({ selection: null });
    render(<EditorDock />);
    expect(
      (screen.getByRole("button", { name: "删除序列" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("toggles 循环 off when it is already on", () => {
    const handleLoopChange = vi.fn();
    mockBuilder({
      sequence: {
        id: 1,
        name: "Closed",
        trajectoryMode: "non-forced",
        loop: true,
        blocks: [
          {
            id: "a",
            kind: "pose",
            objectId: 7,
            atMs: 0,
            pose: { v1: 40, v2: 0, v3: 0 },
          },
        ],
        segments: [],
      },
      handleLoopChange,
    });
    render(<EditorDock />);
    const toggle = screen.getByRole("switch", { name: "循环" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    expect(handleLoopChange).toHaveBeenCalledWith(false);
  });

  it("disables 播放 when the sequence has no duration", () => {
    render(<EditorDock />);
    expect((screen.getByRole("button", { name: "播放" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("disables 播放 when the sequence cannot resolve", () => {
    const broken: ActionSequenceConfig = {
      id: 97,
      name: "Broken",
      trajectoryMode: "non-forced",
      blocks: [
        {
          id: "bad-preset",
          kind: "static-preset",
          presetId: "not-a-preset",
          atMs: 1000,
          orderedObjectIds: [7],
          params: { v1: 0, v2: 0, v3: 0 },
        },
      ],
      segments: [],
    };
    mockBuilder({ sequence: broken });
    render(<EditorDock />);
    expect((screen.getByRole("button", { name: "播放" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("toggles playback from the toolbar and Space, but not while typing", () => {
    const playable: ActionSequenceConfig = {
      id: 1,
      name: "Seq",
      trajectoryMode: "non-forced",
      blocks: [
        {
          id: "a",
          kind: "pose",
          objectId: 7,
          atMs: 0,
          pose: { v1: 0, v2: 0, v3: 0 },
        },
        {
          id: "b",
          kind: "pose",
          objectId: 7,
          atMs: 2000,
          pose: { v1: 100, v2: 0, v3: 0 },
        },
      ],
      segments: [],
    };
    mockBuilder({ sequence: playable });
    render(
      <>
        <input aria-label="到达时间" />
        <EditorDock />
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "播放" }));
    expect(screen.getByRole("button", { name: "暂停" })).toBeTruthy();
    expect(capturedEditor.current?.isPlaying).toBe(true);

    fireEvent.keyDown(window, { key: " " });
    expect(screen.getByRole("button", { name: "播放" })).toBeTruthy();
    expect(capturedEditor.current?.isPlaying).toBe(false);

    fireEvent.keyDown(screen.getByLabelText("到达时间"), { key: " " });
    expect(screen.getByRole("button", { name: "播放" })).toBeTruthy();
    expect(capturedEditor.current?.isPlaying).toBe(false);
  });
});
