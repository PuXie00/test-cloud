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
  trajectoryMode: false,
  blocks: [],
  segments: [],
};

const { builderState, capturedEditor, selectionState } = vi.hoisted(() => ({
  builderState: { current: {} as Record<string, unknown> },
  capturedEditor: { current: null as TimelineEditorProps | null },
  selectionState: { ids: [] as number[] },
}));

vi.mock("../timeline/timeline-editor", () => ({
  TimelineEditor: (props: TimelineEditorProps) => {
    capturedEditor.current = props;
    return (
      <div data-testid="timeline-editor">
        <button type="button" data-block-id="pose-1">
          位姿 pose-1
        </button>
      </div>
    );
  },
}));

vi.mock("../use-action-builder", () => ({
  useActionBuilder: () => builderState.current,
}));

vi.mock("../../../hooks/use-selection", () => ({
  useSelection: () => ({
    replaceSelection: vi.fn(),
    selectedId: null,
    multiSelectedIds: selectionState.ids,
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
    sequences: [sequence],
    handleRenameSequence: vi.fn(() => null),
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

  it("does not show a dock-wide banner for angle-protection or motor-overspeed", () => {
    mockBuilder({
      sequenceIssues: [
        {
          severity: "error",
          code: "angle-protection",
          message: "当前高度 0 mm 下虚轴2 允许 [0, 0]°，实际 10°",
        },
        {
          severity: "error",
          code: "motor-overspeed",
          message:
            "在 t = 1.10s 处线速度达到 558.9 mm/s，超过电机限速 500 mm/s。建议将本段时长延长至 9.17s",
        },
        {
          severity: "error",
          code: "motor-overspeed",
          message:
            "在 t = 2.00s 处线速度达到 600 mm/s，超过电机限速 500 mm/s。建议将本段时长延长至 10.00s",
        },
      ],
    });
    render(<EditorDock />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/等 2 处吊点电机超速/)).toBeNull();
    expect(screen.queryByText(/等 2 处角度保护/)).toBeNull();
  });

  it("keeps SequenceEditor toolbar when an unknown preset cannot resolve", () => {
    const broken: ActionSequenceConfig = {
      id: 97,
      name: "Broken",
      trajectoryMode: false,
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
    expect(handleTrajectoryModeChange).toHaveBeenCalledWith(true);
  });

  it("toggles trajectory mode from forced to non-forced in the sequence editor header", () => {
    const handleTrajectoryModeChange = vi.fn();
    mockBuilder({
      sequence: { ...sequence, trajectoryMode: true },
      handleTrajectoryModeChange,
    });
    render(<EditorDock />);
    const toggle = screen.getByRole("switch", { name: "强制轨迹" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    expect(handleTrajectoryModeChange).toHaveBeenCalledWith(false);
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
      trajectoryMode: false,
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

  it("does not show the sequence name in the timeline toolbar", () => {
    mockBuilder();
    render(<EditorDock />);
    expect(screen.queryByText(sequence.name)).toBeNull();
    expect(screen.queryByRole("button", { name: "修改序列名" })).toBeNull();
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
    expect(handleDeleteSequence).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(handleDeleteSequence).toHaveBeenCalledTimes(1);
    expect(handleBlockDelete).not.toHaveBeenCalled();
  });

  it("asks before deleting and keeps the sequence on cancel", () => {
    const handleDeleteSequence = vi.fn();
    mockBuilder({
      handleDeleteSequence,
      programs: [
        {
          id: "p1",
          name: "节目",
          type: "program",
          children: [{ id: "c1", name: "章节", type: "chapter", children: [{ id: String(sequence.id), name: sequence.name, type: "sequence" }] }],
        },
      ],
    });
    render(<EditorDock />);
    fireEvent.click(screen.getByRole("button", { name: "删除序列" }));
    expect(screen.getByRole("alertdialog")).not.toBeNull();
    expect(screen.getByText(`删除动作序列「${sequence.name}」`)).not.toBeNull();
    expect(screen.getByText("节目中有 1 处用到这条序列，删除后会一并移除。确定删除吗？")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(handleDeleteSequence).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
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
        trajectoryMode: false,
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
      trajectoryMode: false,
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
      trajectoryMode: false,
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

describe("timeline copy / paste", () => {
  const handleBlockCopy = vi.fn();
  const handleBlockPaste = vi.fn();

  beforeEach(() => {
    handleBlockCopy.mockClear();
    handleBlockPaste.mockClear();
    handleSelectionChange.mockClear();
  });

  it("selects an unselected block on right-click and copies it from the menu", async () => {
    mockBuilder({ handleBlockCopy, handleBlockPaste, canPasteBlock: false });
    render(<EditorDock />);
    fireEvent.contextMenu(screen.getByRole("button", { name: "位姿 pose-1" }));
    expect(handleSelectionChange).toHaveBeenCalledWith({ kind: "block", blockId: "pose-1" });
    await screen.findByRole("menu");
    expect(
      screen.getByRole("menuitem", { name: /粘贴到播放头/ }).getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("copies and pastes the selected blocks from the menu", async () => {
    mockBuilder({
      handleBlockCopy,
      handleBlockPaste,
      canPasteBlock: true,
      selection: { kind: "block", blockId: "pose-1" },
    });
    render(<EditorDock />);
    fireEvent.contextMenu(screen.getByRole("button", { name: "位姿 pose-1" }));
    expect(handleSelectionChange).not.toHaveBeenCalled();
    await screen.findByRole("menu");
    fireEvent.click(screen.getByRole("menuitem", { name: /复制动作块/ }));
    expect(handleBlockCopy).toHaveBeenCalledTimes(1);
    fireEvent.contextMenu(screen.getByTestId("timeline-editor"));
    await screen.findByRole("menu");
    fireEvent.click(screen.getByRole("menuitem", { name: /粘贴到播放头/ }));
    expect(handleBlockPaste).toHaveBeenCalledTimes(1);
  });

  it("disables copy when no block is selected", async () => {
    mockBuilder({ handleBlockCopy, handleBlockPaste, canPasteBlock: true });
    render(<EditorDock />);
    fireEvent.contextMenu(screen.getByTestId("timeline-editor"));
    await screen.findByRole("menu");
    expect(
      screen.getByRole("menuitem", { name: /复制动作块/ }).getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("copies and pastes with Ctrl/⌘+C and V", () => {
    mockBuilder({
      handleBlockCopy,
      handleBlockPaste,
      canPasteBlock: true,
      selection: { kind: "block", blockId: "pose-1" },
    });
    render(<EditorDock />);
    const block = screen.getByRole("button", { name: "位姿 pose-1" });
    fireEvent.keyDown(block, { key: "c", ctrlKey: true });
    fireEvent.keyDown(block, { key: "v", metaKey: true });
    expect(handleBlockCopy).toHaveBeenCalledTimes(1);
    expect(handleBlockPaste).toHaveBeenCalledTimes(1);
  });

  it("handles Ctrl/⌘+C and V on the window when the dock is unfocused", () => {
    mockBuilder({
      handleBlockCopy,
      handleBlockPaste,
      canPasteBlock: false,
      selection: { kind: "block", blockId: "pose-1" },
    });
    render(<EditorDock />);
    expect(fireEvent.keyDown(window, { key: "c", ctrlKey: true })).toBe(false);
    expect(fireEvent.keyDown(document.body, { key: "v", ctrlKey: true })).toBe(false);
    expect(handleBlockCopy).toHaveBeenCalledTimes(1);
    expect(handleBlockPaste).toHaveBeenCalledTimes(1);
  });

  it("leaves Ctrl/⌘+C alone without selected blocks, and keys already handled elsewhere", () => {
    mockBuilder({ handleBlockCopy, handleBlockPaste, canPasteBlock: true });
    render(<EditorDock />);
    expect(fireEvent.keyDown(window, { key: "c", ctrlKey: true })).toBe(true);
    const handled = new KeyboardEvent("keydown", { key: "v", ctrlKey: true, cancelable: true });
    handled.preventDefault();
    window.dispatchEvent(handled);
    expect(handleBlockCopy).not.toHaveBeenCalled();
    expect(handleBlockPaste).not.toHaveBeenCalled();
  });
});

describe("timeline navigation tools", () => {
  const navSequence: ActionSequenceConfig = {
    id: 2,
    name: "Nav",
    trajectoryMode: false,
    blocks: [
      { id: "a", kind: "pose", objectId: 7, atMs: 1000, pose: { v1: 0 } },
      { id: "b", kind: "pose", objectId: 7, atMs: 3000, pose: { v1: 100 } },
      { id: "c", kind: "pose", objectId: 8, atMs: 2000, pose: { v1: 0 } },
      { id: "d", kind: "pose", objectId: 8, atMs: 4000, pose: { v1: 100 } },
    ],
    segments: [],
  };

  afterEach(() => {
    selectionState.ids = [];
  });

  it("jumps between keyframes from the toolbar and with Alt+arrows", () => {
    const handleCursorChange = vi.fn();
    mockBuilder({ sequence: navSequence, cursorMs: 2000, handleCursorChange });
    render(<EditorDock />);
    fireEvent.click(screen.getByRole("button", { name: "下一个关键帧" }));
    expect(handleCursorChange).toHaveBeenLastCalledWith(3000);
    fireEvent.click(screen.getByRole("button", { name: "上一个关键帧" }));
    expect(handleCursorChange).toHaveBeenLastCalledWith(1000);
    fireEvent.keyDown(window, { key: "ArrowRight", altKey: true });
    expect(handleCursorChange).toHaveBeenLastCalledWith(3000);
    // 跳完要求时间轴把指针移回视野
    expect(capturedEditor.current?.revealCursorRequestId).toBe(3);
  });

  it("only uses the selected objects' keyframes when objects are selected", () => {
    selectionState.ids = [8];
    const handleCursorChange = vi.fn();
    mockBuilder({ sequence: navSequence, cursorMs: 2000, handleCursorChange });
    render(<EditorDock />);
    fireEvent.click(screen.getByRole("button", { name: "下一个关键帧" }));
    expect(handleCursorChange).toHaveBeenLastCalledWith(4000);
    fireEvent.click(screen.getByRole("button", { name: "上一个关键帧" }));
    expect(handleCursorChange).toHaveBeenLastCalledWith(0);
  });

  it("fits the timeline and toggles snapping from the toolbar and keys", () => {
    mockBuilder({ sequence: navSequence });
    render(<EditorDock />);
    expect(capturedEditor.current?.fitRequestId).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "适合窗口" }));
    fireEvent.keyDown(window, { key: "\\", code: "Backslash" });
    expect(capturedEditor.current?.fitRequestId).toBe(2);

    expect(capturedEditor.current?.snapEnabled).toBe(true);
    expect(screen.getByRole("button", { name: "吸附" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(window, { key: "s", code: "KeyS" });
    expect(capturedEditor.current?.snapEnabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "吸附" }));
    expect(capturedEditor.current?.snapEnabled).toBe(true);
  });
});

describe("explode presets from the timeline menu", () => {
  const withPreset: ActionSequenceConfig = {
    ...sequence,
    blocks: [
      { id: "pose-1", kind: "pose", objectId: 7, atMs: 0, pose: { v1: 0 } },
      {
        id: "flat",
        kind: "static-preset",
        presetId: "static-flat",
        atMs: 2000,
        orderedObjectIds: [7, 8],
        params: { v1: 50 },
      },
    ],
  };

  it("offers 拆解预设 when a preset is selected and explodes only the presets", async () => {
    const handleExplodePresets = vi.fn();
    mockBuilder({
      sequence: withPreset,
      sequences: [withPreset],
      selection: { kind: "multi-block", blockIds: ["pose-1", "flat"] },
      handleExplodePresets,
    });
    render(<EditorDock />);
    fireEvent.contextMenu(screen.getByTestId("timeline-editor"));
    await screen.findByRole("menu");
    fireEvent.click(screen.getByRole("menuitem", { name: "拆解预设" }));
    expect(handleExplodePresets).toHaveBeenCalledWith(["flat"]);
  });

  it("has no explode item without a selected preset", async () => {
    mockBuilder({
      sequence: withPreset,
      sequences: [withPreset],
      selection: { kind: "block", blockId: "pose-1" },
      handleExplodePresets: vi.fn(),
    });
    render(<EditorDock />);
    fireEvent.contextMenu(screen.getByTestId("timeline-editor"));
    await screen.findByRole("menu");
    expect(screen.queryByRole("menuitem", { name: /拆解/ })).toBeNull();
  });
});

describe("timeline markers in the dock", () => {
  const withMarkers: ActionSequenceConfig = {
    ...sequence,
    markers: [
      { id: "m2", atMs: 3000, name: "演员入场" },
      { id: "m1", atMs: 1200, name: "灯光切换" },
    ],
  };

  it("adds a marker at the playhead with M without asking for a name", () => {
    const handleAddMarker = vi.fn(() => "m1");
    mockBuilder({
      sequence: withMarkers,
      sequences: [withMarkers],
      handleAddMarker,
      handleRenameMarker: vi.fn(() => true),
    });
    render(<EditorDock />);
    fireEvent.keyDown(window, { key: "m" });
    expect(handleAddMarker).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("textbox", { name: "标记名称" })).toBeNull();
  });

  it("renames the selected marker with F2 and deletes selected markers with Delete", () => {
    const handleRenameMarker = vi.fn(() => true);
    const handleDeleteMarkers = vi.fn();
    const handleBlockDelete = vi.fn();
    mockBuilder({
      sequence: withMarkers,
      sequences: [withMarkers],
      selection: { kind: "markers", markerIds: ["m2"] },
      handleRenameMarker,
      handleDeleteMarkers,
      handleBlockDelete,
    });
    render(<EditorDock />);
    fireEvent.keyDown(window, { key: "F2" });
    const input = screen.getByRole("textbox", { name: "标记名称" });
    fireEvent.change(input, { target: { value: "开场" } });
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    expect(handleRenameMarker).toHaveBeenCalledWith("m2", "开场");

    fireEvent.keyDown(window, { key: "Delete" });
    expect(handleDeleteMarkers).toHaveBeenCalledWith(["m2"]);
    expect(handleBlockDelete).not.toHaveBeenCalled();
  });

  it("lists markers in the toolbar menu and jumps to the one picked", async () => {
    const handleCursorChange = vi.fn();
    mockBuilder({
      sequence: withMarkers,
      sequences: [withMarkers],
      handleCursorChange,
      handleAddMarker: vi.fn(() => null),
    });
    render(<EditorDock />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "标记" }), { button: 0, ctrlKey: false });
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "添加标记M",
      "灯光切换1.2 s",
      "演员入场3.0 s",
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: /演员入场/ }));
    expect(handleSelectionChange).toHaveBeenCalledWith({ kind: "markers", markerIds: ["m2"] });
    expect(handleCursorChange).toHaveBeenCalledWith(3000);
  });
});
