// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { MOTION_DEFAULTS } from "@/app/project/configuration-rules";
import { createDefaultSavedView } from "@/app/project/saved-view";
import {
  PROJECT_SCHEMA_VERSION,
  type ControlledObjectConfig,
  type ProjectDocument,
} from "@/app/project/project-document-types";
import {
  getMotionItemRepairIssue,
  getProgramRepairIssues,
  resolveMotionLaunchBlock,
} from "@/app/project/project-motion-readiness";
import { ConsoleModeProvider } from "../../hooks/use-console-mode";
import type { ExecCard } from "../../hooks/use-exec-cards";
import type { FaderSlotState } from "../../hooks/use-executor-slots";
import type { ChapterItem, Program } from "../program-panel/program-data";
import { PageSection } from "../program-panel/page-section";
import { FaderSlot } from "./executors/fader-slot";

const {
  toastWarning,
  toastError,
  launchMock,
  stopSequenceMock,
  localSequenceTransport,
  faderSlotsRef,
  documentRef,
  capturedTriggers,
  programState,
  actionBuilderState,
  readySequenceMock,
  goSequenceMock,
  startLocalAuthoredSequenceMock,
  markSlotReadyMock,
  clearSlotReadyMock,
  setSlotBusyMock,
  setSlotRunningMock,
  execCardsRef,
  closeMock,
  coupledObjectIdsRef,
  snapshotsRef,
} = vi.hoisted(() => ({
  toastWarning: vi.fn(),
  toastError: vi.fn(),
  launchMock: vi.fn(() => "card-1"),
  stopSequenceMock: vi.fn(async () => undefined),
  localSequenceTransport: {
    saveAction: vi.fn(),
    syncCall: vi.fn(),
    stopAction: vi.fn(),
  },
  readySequenceMock: vi.fn(async (args: { sequenceId: number }) => ({
    ok: true as const,
    name: args.sequenceId === 15 ? "正常序列" : String(args.sequenceId),
    sequenceHandle: { actionId: args.sequenceId },
    fingerprint: `fp-${args.sequenceId}`,
  })),
  goSequenceMock: vi.fn(async (args: { sequenceId: number; faderPercent?: number }) => ({
    ok: true as const,
    name: args.sequenceId === 15 ? "正常序列" : String(args.sequenceId),
    speedPercent: args.faderPercent ?? 100,
    sequenceHandle: { actionId: args.sequenceId },
  })),
  startLocalAuthoredSequenceMock: vi.fn(async (args: { sequenceId: number }) => ({
    ok: true as const,
    name: args.sequenceId === 15 ? "正常序列" : args.sequenceId,
    speedPercent: 100,
    sequenceHandle: { actionNo: 1 },
  })),
  markSlotReadyMock: vi.fn(),
  clearSlotReadyMock: vi.fn(),
  setSlotBusyMock: vi.fn(),
  setSlotRunningMock: vi.fn(),
  execCardsRef: {
    current: [] as ExecCard[],
  },
  closeMock: vi.fn(),
  coupledObjectIdsRef: {
    current: new Set<number>([1]),
  },
  faderSlotsRef: {
    current: [] as FaderSlotState[],
  },
  documentRef: {
    current: null as ProjectDocument | null,
  },
  snapshotsRef: {
    current: [{ descriptor: { id: 1 }, positions: { h: 10, p: 0, y: 0 } }] as Array<{
      descriptor: { id: number };
      positions: { h?: number; p?: number; y?: number } | null;
    }>,
  },
  capturedTriggers: {
    onTriggerSequence: null as null | ((slotIndex: number, sequenceId: number) => void),
  },
  programState: {
    current: {
      id: "program-a",
      name: "节目 A",
      chapters: [] as Program["chapters"],
    } satisfies Program,
  },
  actionBuilderState: {
    current: {
      sequences: [
        {
          id: 14,
          name: "空序列",
          trajectoryMode: false,
          blocks: [],
          segments: [],
        },
        {
          id: 15,
          name: "正常序列",
          trajectoryMode: false,
          blocks: [
            {
              id: "tr-1",
              kind: "pose",
              objectId: 1,
              atMs: 1000,
              pose: { v1: 0, v2: 0, v3: 0 },
            },
          ],
          segments: [],
        },
      ],
      programs: [] as Array<{
        id: string;
        name: string;
        type: "program";
        children: Array<{
          id: string;
          name: string;
          type: "chapter";
          children: Array<{ id: string; name: string; type: "sequence" }>;
        }>;
      }>,
      dockMode: "sequence" as const,
      selectedSequenceId: null as number | null,
      selectedObjectIds: [] as string[],
      getTimelineObject: () => null,
      handleSequenceSelect: vi.fn(),
      handleCreateSequence: vi.fn(),
      handleProgramItemInsert: vi.fn(),
      handleChapterAdd: vi.fn(),
      handleProgramItemRemove: vi.fn(),
      handleProgramItemMove: vi.fn(),
    },
  },
}));

vi.mock("sonner", () => ({
  toast: {
    warning: (...args: unknown[]) => toastWarning(...args),
    success: vi.fn(),
    error: (...args: unknown[]) => toastError(...args),
    message: vi.fn(),
  },
}));

vi.mock("@/app/project/use-project", () => ({
  useProject: () => ({
    currentProject: documentRef.current
      ? { id: "proj-1", document: documentRef.current }
      : null,
  }),
}));

vi.mock("../../hooks/use-exec-cards", async () => {
  const actual = await vi.importActual<typeof import("../../hooks/use-exec-cards")>(
    "../../hooks/use-exec-cards",
  );
  return {
    ...actual,
    useExecCards: () => ({
      cards: execCardsRef.current,
      launch: launchMock,
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(),
      skipNext: vi.fn(),
      setSpeed: vi.fn(),
      emergencyStopAll: vi.fn(),
      close: (...args: unknown[]) => closeMock(...args),
    }),
  };
});

vi.mock("../../hooks/use-executor-slots", async () => {
  const actual = await vi.importActual<typeof import("../../hooks/use-executor-slots")>(
    "../../hooks/use-executor-slots",
  );
  return {
    ...actual,
    useExecutorSlots: () => ({
      faderSlots: faderSlotsRef.current,
      setFaderValue: vi.fn(),
      setSlotRunning: (...args: unknown[]) => setSlotRunningMock(...args),
      setSlotBusy: (...args: unknown[]) => setSlotBusyMock(...args),
      markSlotReady: (...args: unknown[]) => markSlotReadyMock(...args),
      clearSlotReady: (...args: unknown[]) => clearSlotReadyMock(...args),
    }),
  };
});

vi.mock("../build-debug/build-debug-context", () => ({
  useBuildDebug: () => ({
    coupledObjectIds: coupledObjectIdsRef.current,
  }),
}));

vi.mock("../../hooks/use-program", () => ({
  useProgram: () => ({
    program: programState.current,
    reorderItemInChapter: vi.fn(),
    moveItemAcrossChapter: vi.fn(),
    currentChapterId: programState.current.chapters[0]?.id ?? "ch-1",
    currentPageIndex: 0,
    setCurrentChapter: vi.fn(),
    nextPage: vi.fn(),
    prevPage: vi.fn(),
    addChapter: vi.fn(),
    addSequence: vi.fn(),
    isProgramEmpty: programState.current.chapters.length === 0,
  }),
}));

vi.mock("../../hooks/use-selection", () => ({
  useSelection: () => ({ clearSelection: vi.fn() }),
}));

vi.mock("./exec-cards/exec-cards", () => ({
  ExecCards: ({ onNextSequence }: { onNextSequence?: (cardId: string) => void }) => (
    <div data-testid="exec-cards">
      <button type="button" onClick={() => onNextSequence?.("card-stopped")}>
        下一条
      </button>
    </div>
  ),
}));

vi.mock("./executors/executor-pagination-bar", () => ({
  ExecutorPaginationBar: () => <div data-testid="executor-pagination" />,
}));

vi.mock("./executors/executors", async () => {
  const actual = await vi.importActual<typeof import("./executors/executors")>(
    "./executors/executors",
  );
  return {
    Executors: (props: {
      onTriggerSequence: (slotIndex: number, sequenceId: number) => void;
    }) => {
      capturedTriggers.onTriggerSequence = props.onTriggerSequence;
      return (
        <>
          <actual.Executors {...props} />
          <button
            type="button"
            onClick={() => props.onTriggerSequence(0, 14)}
          >
            force-seq-empty
          </button>
          <button
            type="button"
            onClick={() => props.onTriggerSequence(1, 15)}
          >
            force-seq-ok
          </button>
        </>
      );
    },
  };
});

vi.mock("../../hooks/sequence-execution", () => ({
  readySequence: (...args: unknown[]) => readySequenceMock(...args as [{ sequenceId: number }]),
  goSequence: (...args: unknown[]) =>
    goSequenceMock(...args as [{ sequenceId: number; faderPercent?: number }]),
  startLocalAuthoredSequence: (...args: unknown[]) =>
    startLocalAuthoredSequenceMock(...args as [{ sequenceId: number }]),
  stopSequence: (...args: unknown[]) => stopSequenceMock(...args),
  getLocalSequenceTransport: () => localSequenceTransport,
  getSequenceTransport: () => localSequenceTransport,
}));

vi.mock("../action-builder/use-action-builder", () => ({
  useActionBuilder: () => actionBuilderState.current,
}));

const {
  togglePreviewMock,
  startPreviewMock,
  stopPreviewMock,
  previewSequenceIdRef,
} = vi.hoisted(() => ({
  togglePreviewMock: vi.fn(),
  startPreviewMock: vi.fn(),
  stopPreviewMock: vi.fn(),
  previewSequenceIdRef: { current: null as number | null },
}));

vi.mock("../../hooks/use-sequence-preview", () => ({
  useSequencePreview: () => ({
    sequenceId: previewSequenceIdRef.current,
    togglePreview: togglePreviewMock,
    startPreview: startPreviewMock,
    stopPreview: stopPreviewMock,
    cursorMs: 0,
    isPlaying: false,
    holdMode: false,
    faderPercent: 100,
    multiplier: 1,
    totalMs: 0,
    resolved: null,
    setCursorMs: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    setMultiplier: vi.fn(),
  }),
}));

vi.mock("../../hooks/use-controlled-objects", () => ({
  useControlledObjects: () => ({
    snapshots: snapshotsRef.current,
    getById: () => undefined,
    motorSnapshots: [],
  }),
}));

import { ExecArea } from "./exec-area";
import { ContentLibraryPanel } from "../action-builder/content-library/content-library-panel";
import { ProgramPanel } from "../program-panel/program-panel";
import { ExecEmptyState } from "./exec-cards/exec-empty-state";
import { advanceRunningCards } from "../../hooks/advance-running-cards";

const makeFaderSlot = (overrides: Partial<FaderSlotState> & { index: number }): FaderSlotState => ({
  label: `F${overrides.index + 1}`,
  sequence: null,
  faderValue: 100,
  phase: "idle",
  isBusy: false,
  initialTransition: null,
  preparedPoses: null,
  ...overrides,
});

const withMode = (children: ReactNode) =>
  createElement(ConsoleModeProvider, null, children);

const FIXTURE_OBJECT_ID = 1;

const fixtureObject = (): ControlledObjectConfig => ({
  id: FIXTURE_OBJECT_ID,
  name: "O1",
  controlType: 2,
  enabledVirtualAxes: ["v1"],
  shapePreset: "cube",
  shapeDimensions: { width: 1000, height: 1000, depth: 1000 },
  dimensions: { w: 1000, h: 1000, d: 1000 },
  position: { x: 0, y: 0, z: 0 },
  centerOffset: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  color: "#869398",
  pulleyDistance: 0,
  modelRunDirection: 1,
  driveAxes: [{ key: "0" }],
  maxAxisVelocity: 200,
  motionParams: { move: { ...MOTION_DEFAULTS.move } },
  params: {},
});

const makeDocument = (): ProjectDocument => ({
  schemaVersion: PROJECT_SCHEMA_VERSION,
  meta: {
    id: "t",
    name: "t",
    createdAt: "2024-01-01T00:00:00Z",
    modifiedAt: "2024-01-01T00:00:00Z",
    author: "test",
    wizard: {
      currentStep: "objects",
      completedSteps: [],
      skippedSteps: [],
      simulationOnly: false,
      wizardCompleted: false,
    },
  },
  setup: {
    plcs: [],
    motors: [],
    controlledObjects: [fixtureObject()],
    alignment: {},
  },
  motion: {
    actionSequences: [
      {
        id: 14,
        name: "空序列",
        trajectoryMode: false,
        blocks: [],
        segments: [],
      },
      {
        id: 15,
        name: "正常序列",
        trajectoryMode: false,
        blocks: [
          {
            id: "ok-pose",
            kind: "pose",
            objectId: FIXTURE_OBJECT_ID,
            atMs: 2000,
            pose: { v1: 10, v2: 0, v3: 0 },
          },
        ],
        segments: [],
      },
      {
        id: 16,
        name: "指令序列",
        trajectoryMode: false,
        blocks: [
          {
            id: "enable-1",
            kind: "instruction",
            presetId: "set-enabled",
            objectId: FIXTURE_OBJECT_ID,
            atMs: 1000,
            instr: { enabled: true },
          },
        ],
        segments: [],
      },
    ],
    programs: [
      {
        id: "program-a",
        name: "节目 A",
        chapters: [
          {
            id: "ch-1",
            name: "章节 1",
            items: [
              { kind: "sequence", refId: 14 },
              { kind: "sequence", refId: 15 },
            ],
          },
        ],
      },
    ],
  },
  rules: { rules: [] },
  view: createDefaultSavedView(),
  snapshots: [],
});

const emptySequenceItem: ChapterItem = {
  kind: "sequence",
  sequence: { id: 14, name: "空序列", durationMs: 0 },
};
const okSequenceItem: ChapterItem = {
  kind: "sequence",
  sequence: { id: 15, name: "正常序列", durationMs: 2000 },
};

afterEach(() => {
  cleanup();
  launchMock.mockClear();
  stopSequenceMock.mockClear();
  toastWarning.mockClear();
  toastError.mockClear();
  readySequenceMock.mockClear();
  goSequenceMock.mockClear();
  startLocalAuthoredSequenceMock.mockClear();
  markSlotReadyMock.mockClear();
  clearSlotReadyMock.mockClear();
  setSlotBusyMock.mockClear();
  setSlotRunningMock.mockClear();
  togglePreviewMock.mockClear();
  startPreviewMock.mockClear();
  stopPreviewMock.mockClear();
  previewSequenceIdRef.current = null;
  execCardsRef.current = [];
  closeMock.mockClear();
  coupledObjectIdsRef.current = new Set([1]);
  capturedTriggers.onTriggerSequence = null;
  documentRef.current = null;
  snapshotsRef.current = [{ descriptor: { id: 1 }, positions: { h: 10, p: 0, y: 0 } }];
  programState.current = {
    id: "program-a",
    name: "节目 A",
    chapters: [],
  };
  actionBuilderState.current.programs = [];
});

describe("project-motion-readiness (pure)", () => {
  it("derives empty items without persisting repair flags", () => {
    const document = makeDocument();
    const emptySequence = getMotionItemRepairIssue(
      document,
      "sequence",
      14,
    );
    expect(emptySequence?.code).toBe("empty-sequence");
    expect(emptySequence?.message).toBe("动作序列为空，待编排");
    expect(document.motion.actionSequences[0]).not.toHaveProperty("needsRepair");
    expect(getMotionItemRepairIssue(document, "sequence", 15)).toBeNull();
    expect(getMotionItemRepairIssue(document, "sequence", 16)).toBeNull();

    const missingSequence = getMotionItemRepairIssue(document, "sequence", 999);
    expect(missingSequence).not.toBeNull();
  });

  it("reports programs that reference empty or missing motion items (fail closed)", () => {
    const document = makeDocument();
    expect(
      getProgramRepairIssues(document, "program-a").map((issue) => issue.itemId),
    ).toEqual([14]);
    expect(
      getProgramRepairIssues(document, "program-a").every(
        (issue) => issue.code === "program-ref-empty",
      ),
    ).toBe(true);

    document.motion.programs[0]!.chapters[0]!.items.push({
      kind: "sequence",
      refId: 99,
    });
    const withMissing = getProgramRepairIssues(document, "program-a");
    expect(withMissing.map((issue) => issue.itemId)).toContain(99);
    expect(withMissing.find((issue) => issue.itemId === 99)?.code).toBe(
      "program-ref-empty",
    );
  });

  it("resolveMotionLaunchBlock fails closed for missing document/items", () => {
    const document = makeDocument();
    expect(resolveMotionLaunchBlock(null, "sequence", 15)).not.toBeNull();
    expect(resolveMotionLaunchBlock(document, "sequence", "nope")).not.toBeNull();
    expect(resolveMotionLaunchBlock(document, "sequence", 14)?.code).toBe(
      "empty-sequence",
    );
    expect(resolveMotionLaunchBlock(document, "sequence", 15)).toBeNull();
    expect(resolveMotionLaunchBlock(document, "sequence", 16)).toBeNull();
  });
});

describe("FaderSlot Ready/GO gate", () => {
  it("disables Ready for a repair-required sequence and exposes the warning reason", () => {
    const seqSlot = makeFaderSlot({
      index: 0,
      sequence: {
        id: 14,
        name: "空序列",
        durationMs: 0,
      },
    });
    const onGoSeq = vi.fn();

    render(
      withMode(
        <FaderSlot
          slot={seqSlot}
          repairMessage="动作序列无轨道，待修复"
          isPreviewing={false}
          onPreviewToggle={vi.fn()}
          onPreviewHoldStart={vi.fn()}
          onPreviewHoldEnd={vi.fn()}
          onGo={onGoSeq}
          onFaderChange={vi.fn()}
          onAssignFromDrag={vi.fn()}
        />,
      ),
    );

    const seqGo = screen.getByRole("button", { name: /Ready/i }) as HTMLButtonElement;
    expect(seqGo.disabled).toBe(true);
    expect(seqGo.getAttribute("aria-describedby")).toBeTruthy();
    const seqReason = document.getElementById(seqGo.getAttribute("aria-describedby")!);
    expect(seqReason?.textContent).toMatch(/待修复/);

    fireEvent.click(seqGo);
    expect(onGoSeq).not.toHaveBeenCalled();
  });

  it("keeps Ready enabled for healthy filled idle slots", () => {
    const onGo = vi.fn();
    render(
      withMode(
        <FaderSlot
          slot={makeFaderSlot({
            index: 0,
            sequence: {
              id: 15,
              name: "正常序列",
              durationMs: 2000,
            },
          })}
          isPreviewing={false}
          onPreviewToggle={vi.fn()}
          onPreviewHoldStart={vi.fn()}
          onPreviewHoldEnd={vi.fn()}
          onGo={onGo}
          onFaderChange={vi.fn()}
          onAssignFromDrag={vi.fn()}
        />,
      ),
    );
    const ready = screen.getByRole("button", { name: /Ready/i }) as HTMLButtonElement;
    expect(ready.disabled).toBe(false);
    fireEvent.click(ready);
    expect(onGo).toHaveBeenCalledTimes(1);
  });

  it("shows GO when the slot is ready", () => {
    const onGo = vi.fn();
    const onFaderChange = vi.fn();
    render(
      withMode(
        <FaderSlot
          slot={makeFaderSlot({
            index: 0,
            sequence: {
              id: 15,
              name: "正常序列",
              durationMs: 2000,
            },
            phase: "ready",
          })}
          isPreviewing={false}
          onPreviewToggle={vi.fn()}
          onPreviewHoldStart={vi.fn()}
          onPreviewHoldEnd={vi.fn()}
          onGo={onGo}
          onFaderChange={onFaderChange}
          onAssignFromDrag={vi.fn()}
        />,
      ),
    );
    const go = screen.getByRole("button", { name: /GO/i }) as HTMLButtonElement;
    expect(go.disabled).toBe(false);
    const slider = screen.getByRole("slider", { name: "F1 速度" });
    expect(slider.getAttribute("aria-disabled")).toBeNull();
    fireEvent.keyDown(slider, { key: "ArrowUp" });
    expect(onFaderChange).toHaveBeenCalledWith(101);
    fireEvent.click(go);
    expect(onGo).toHaveBeenCalledTimes(1);
  });

  it("hides percent on empty slots and shows a disabled slider", () => {
    render(
      withMode(
        <FaderSlot
          slot={makeFaderSlot({ index: 0 })}
          isPreviewing={false}
          onPreviewToggle={vi.fn()}
          onPreviewHoldStart={vi.fn()}
          onPreviewHoldEnd={vi.fn()}
          onGo={vi.fn()}
          onFaderChange={vi.fn()}
          onAssignFromDrag={vi.fn()}
        />,
      ),
    );
    expect(screen.getByRole("slider", { name: "F1 速度" }).getAttribute("aria-disabled")).toBe("true");
    expect(screen.queryByText("100%")).toBeNull();
    expect(document.querySelector("input[type='range']")).toBeNull();
  });

  it("shows the sequence name and percent, and locks the slider until ready", () => {
    const onFaderChange = vi.fn();
    render(
      withMode(
        <FaderSlot
          slot={makeFaderSlot({
            index: 2,
            faderValue: 120,
            sequence: { id: 15, name: "开幕A", durationMs: 2000 },
          })}
          isPreviewing={false}
          onPreviewToggle={vi.fn()}
          onPreviewHoldStart={vi.fn()}
          onPreviewHoldEnd={vi.fn()}
          onGo={vi.fn()}
          onFaderChange={onFaderChange}
          onAssignFromDrag={vi.fn()}
        />,
      ),
    );
    expect(screen.getByText("开幕A")).toBeTruthy();
    expect(screen.getByText("120%")).toBeTruthy();
    const slider = screen.getByRole("slider", { name: "F3 速度" });
    expect(slider.getAttribute("aria-disabled")).toBe("true");
    fireEvent.keyDown(slider, { key: "ArrowUp" });
    expect(onFaderChange).not.toHaveBeenCalled();
    expect(screen.queryByText("强制")).toBeNull();
  });

  it("lets the slider move while the slot is running", () => {
    const onFaderChange = vi.fn();
    render(
      withMode(
        <FaderSlot
          slot={makeFaderSlot({
            index: 0,
            phase: "running",
            faderValue: 80,
            sequence: { id: 15, name: "开幕A", durationMs: 2000 },
          })}
          isPreviewing={false}
          onPreviewToggle={vi.fn()}
          onPreviewHoldStart={vi.fn()}
          onPreviewHoldEnd={vi.fn()}
          onGo={vi.fn()}
          onFaderChange={onFaderChange}
          onAssignFromDrag={vi.fn()}
        />,
      ),
    );
    const slider = screen.getByRole("slider", { name: "F1 速度" });
    expect(slider.getAttribute("aria-disabled")).toBeNull();
    fireEvent.keyDown(slider, { key: "ArrowUp" });
    expect(onFaderChange).toHaveBeenCalledWith(81);
  });

  it("shows 强制 only for a forced-trajectory sequence", () => {
    render(
      withMode(
        <FaderSlot
          slot={makeFaderSlot({
            index: 0,
            sequence: { id: 15, name: "开幕A", durationMs: 2000, trajectoryMode: true },
          })}
          isPreviewing={false}
          onPreviewToggle={vi.fn()}
          onPreviewHoldStart={vi.fn()}
          onPreviewHoldEnd={vi.fn()}
          onGo={vi.fn()}
          onFaderChange={vi.fn()}
          onAssignFromDrag={vi.fn()}
        />,
      ),
    );
    expect(screen.getByText("强制")).toBeTruthy();
    expect(screen.queryByText("F1")).toBeNull();
    expect(screen.getByRole("button", { name: "预览 开幕A，强制轨迹" })).toBeTruthy();
  });

  it("shows safety in both states, loop only when enabled, and cancels ready from the mark popover", () => {
    const onCancelReady = vi.fn();
    render(
      withMode(
        <FaderSlot
          slot={makeFaderSlot({
            index: 0,
            phase: "ready",
            sequence: { id: 15, name: "开幕A", durationMs: 2000, loop: true, trajectoryMode: true },
          })}
          isPreviewing={false}
          onPreviewToggle={vi.fn()}
          onPreviewHoldStart={vi.fn()}
          onPreviewHoldEnd={vi.fn()}
          onGo={vi.fn()}
          onCancelReady={onCancelReady}
          onFaderChange={vi.fn()}
          onAssignFromDrag={vi.fn()}
        />,
      ),
    );

    expect(screen.getByText("安全组开启")).toBeTruthy();
    expect(screen.getByText("循环")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "开幕A 标记" }));
    expect((screen.getByRole("button", { name: "开启就近" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "开启反向" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "关闭安全组" }));
    expect(screen.getByText("安全组关闭")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "取消准备" }));
    expect(onCancelReady).toHaveBeenCalledTimes(1);
  });

  it("shows nearest and reverse only after they are turned on, and only before ready", () => {
    const { rerender } = render(
      withMode(
        <FaderSlot
          slot={makeFaderSlot({
            index: 0,
            phase: "idle",
            sequence: { id: 15, name: "开幕A", durationMs: 2000 },
          })}
          isPreviewing={false}
          onPreviewToggle={vi.fn()}
          onPreviewHoldStart={vi.fn()}
          onPreviewHoldEnd={vi.fn()}
          onGo={vi.fn()}
          onFaderChange={vi.fn()}
          onAssignFromDrag={vi.fn()}
        />,
      ),
    );
    expect(screen.queryByText("就近")).toBeNull();
    expect(screen.queryByText("反向")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "开幕A 标记" }));
    fireEvent.click(screen.getByRole("button", { name: "开启就近" }));
    fireEvent.click(screen.getByRole("button", { name: "开启反向" }));
    expect(screen.getByText("就近")).toBeTruthy();
    expect(screen.getByText("反向")).toBeTruthy();

    rerender(
      withMode(
        <FaderSlot
          slot={makeFaderSlot({
            index: 0,
            phase: "ready",
            sequence: { id: 15, name: "开幕A", durationMs: 2000 },
          })}
          isPreviewing={false}
          onPreviewToggle={vi.fn()}
          onPreviewHoldStart={vi.fn()}
          onPreviewHoldEnd={vi.fn()}
          onGo={vi.fn()}
          onFaderChange={vi.fn()}
          onAssignFromDrag={vi.fn()}
        />,
      ),
    );
    expect((screen.getByRole("button", { name: "关闭就近" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "关闭反向" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "关闭就近" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭反向" }));
    expect(screen.getByText("就近")).toBeTruthy();
    expect(screen.getByText("反向")).toBeTruthy();
  });
});

describe("FaderSlot sequence preview", () => {
  const filledSlot = () =>
    makeFaderSlot({
      index: 0,
      sequence: { id: 15, name: "开幕A", durationMs: 2000 },
    });

  const renderPreviewSlot = (overrides: {
    repairMessage?: string | null;
    isPreviewing?: boolean;
    onPreviewToggle?: () => void;
    onPreviewHoldStart?: () => void;
    onPreviewHoldEnd?: () => void;
  } = {}) => {
    const onPreviewToggle = overrides.onPreviewToggle ?? vi.fn();
    const onPreviewHoldStart = overrides.onPreviewHoldStart ?? vi.fn();
    const onPreviewHoldEnd = overrides.onPreviewHoldEnd ?? vi.fn();
    render(
      withMode(
        <FaderSlot
          slot={filledSlot()}
          repairMessage={overrides.repairMessage}
          isPreviewing={overrides.isPreviewing ?? false}
          onPreviewToggle={onPreviewToggle}
          onPreviewHoldStart={onPreviewHoldStart}
          onPreviewHoldEnd={onPreviewHoldEnd}
          onGo={vi.fn()}
          onFaderChange={vi.fn()}
          onAssignFromDrag={vi.fn()}
        />,
      ),
    );
    return { onPreviewToggle, onPreviewHoldStart, onPreviewHoldEnd };
  };

  it("exposes a card preview overlay that toggles and disables when repair is required", () => {
    const onPreviewToggle = vi.fn();
    const { rerender } = render(
      withMode(
        <FaderSlot
          slot={filledSlot()}
          isPreviewing={false}
          onPreviewToggle={onPreviewToggle}
          onPreviewHoldStart={vi.fn()}
          onPreviewHoldEnd={vi.fn()}
          onGo={vi.fn()}
          onFaderChange={vi.fn()}
          onAssignFromDrag={vi.fn()}
        />,
      ),
    );

    const preview = screen.getByRole("button", { name: "预览 开幕A" });
    expect(preview.getAttribute("aria-pressed")).toBe("false");
    expect(preview.className).toContain("absolute");
    expect(preview.className).toContain("inset-0");
    expect(screen.getByText("开幕A")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Ready/i })).toBeTruthy();
    fireEvent.click(preview);
    expect(onPreviewToggle).toHaveBeenCalledTimes(1);

    rerender(
      withMode(
        <FaderSlot
          slot={filledSlot()}
          repairMessage="动作序列无轨道，待修复"
          isPreviewing={false}
          onPreviewToggle={onPreviewToggle}
          onPreviewHoldStart={vi.fn()}
          onPreviewHoldEnd={vi.fn()}
          onGo={vi.fn()}
          onFaderChange={vi.fn()}
          onAssignFromDrag={vi.fn()}
        />,
      ),
    );
    expect((screen.getByRole("button", { name: "预览 开幕A" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("long-press starts hold preview and suppresses the following click", () => {
    vi.useFakeTimers();
    const onPreviewToggle = vi.fn();
    const onPreviewHoldStart = vi.fn();
    const onPreviewHoldEnd = vi.fn();
    try {
      renderPreviewSlot({ onPreviewToggle, onPreviewHoldStart, onPreviewHoldEnd });
      const preview = screen.getByRole("button", { name: "预览 开幕A" });
      fireEvent.pointerDown(preview, { clientX: 10, clientY: 10 });
      vi.advanceTimersByTime(400);
      expect(onPreviewHoldStart).toHaveBeenCalledTimes(1);
      fireEvent.pointerUp(preview);
      expect(onPreviewHoldEnd).toHaveBeenCalledTimes(1);
      fireEvent.click(preview);
      expect(onPreviewToggle).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a new pointerdown after leave-to-end-hold still toggles on click", () => {
    vi.useFakeTimers();
    const onPreviewToggle = vi.fn();
    const onPreviewHoldStart = vi.fn();
    const onPreviewHoldEnd = vi.fn();
    try {
      renderPreviewSlot({ onPreviewToggle, onPreviewHoldStart, onPreviewHoldEnd });
      const preview = screen.getByRole("button", { name: "预览 开幕A" });
      fireEvent.pointerDown(preview, { clientX: 10, clientY: 10 });
      vi.advanceTimersByTime(400);
      fireEvent.pointerLeave(preview);
      expect(onPreviewHoldEnd).toHaveBeenCalledTimes(1);
      fireEvent.pointerDown(preview, { clientX: 10, clientY: 10 });
      fireEvent.pointerUp(preview);
      fireEvent.click(preview);
      expect(onPreviewToggle).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("pointer move of 20px before 400ms cancels hold and still toggles on click", () => {
    vi.useFakeTimers();
    const onPreviewToggle = vi.fn();
    const onPreviewHoldStart = vi.fn();
    const onPreviewHoldEnd = vi.fn();
    try {
      renderPreviewSlot({ onPreviewToggle, onPreviewHoldStart, onPreviewHoldEnd });
      const preview = screen.getByRole("button", { name: "预览 开幕A" });
      fireEvent.pointerDown(preview, { clientX: 0, clientY: 0 });
      fireEvent.pointerMove(preview, { clientX: 20, clientY: 0 });
      vi.advanceTimersByTime(400);
      expect(onPreviewHoldStart).not.toHaveBeenCalled();
      fireEvent.pointerUp(preview);
      expect(onPreviewHoldEnd).not.toHaveBeenCalled();
      fireEvent.click(preview);
      expect(onPreviewToggle).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("Ready does not toggle preview", () => {
    const onPreviewToggle = vi.fn();
    const onGo = vi.fn();
    render(
      withMode(
        <FaderSlot
          slot={filledSlot()}
          isPreviewing={false}
          onPreviewToggle={onPreviewToggle}
          onPreviewHoldStart={vi.fn()}
          onPreviewHoldEnd={vi.fn()}
          onGo={onGo}
          onFaderChange={vi.fn()}
          onAssignFromDrag={vi.fn()}
        />,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: /Ready/i }));
    expect(onGo).toHaveBeenCalledTimes(1);
    expect(onPreviewToggle).not.toHaveBeenCalled();
  });

  it("fader slider does not toggle preview", () => {
    const onPreviewToggle = vi.fn();
    render(
      withMode(
        <FaderSlot
          slot={filledSlot()}
          isPreviewing={false}
          onPreviewToggle={onPreviewToggle}
          onPreviewHoldStart={vi.fn()}
          onPreviewHoldEnd={vi.fn()}
          onGo={vi.fn()}
          onFaderChange={vi.fn()}
          onAssignFromDrag={vi.fn()}
        />,
      ),
    );
    const slider = screen.getByRole("slider", { name: "F1 速度" });
    fireEvent.click(slider);
    fireEvent.keyDown(slider, { key: "ArrowUp" });
    expect(onPreviewToggle).not.toHaveBeenCalled();
  });
});

describe("ExecArea launch guard", () => {
  beforeEach(() => {
    documentRef.current = makeDocument();
    faderSlotsRef.current = [
      makeFaderSlot({
        index: 0,
        sequence: {
          id: 14,
          name: "空序列",
          durationMs: 0,
        },
      }),
      makeFaderSlot({
        index: 1,
        sequence: {
          id: 15,
          name: "正常序列",
          durationMs: 2000,
        },
      }),
      ...Array.from({ length: 10 }, (_, idx) => makeFaderSlot({ index: idx + 2 })),
    ];
  });

  it("blocks launch for an empty sequence even when trigger is forced", async () => {
    render(withMode(<ExecArea />));

    const readyButtons = screen.getAllByRole("button", { name: /Ready/i }) as HTMLButtonElement[];
    expect(readyButtons).toHaveLength(12);
    expect(readyButtons[0]!.disabled).toBe(true);
    expect(readyButtons[1]!.disabled).toBe(false);
    expect(readyButtons[2]!.disabled).toBe(true);

    fireEvent.click(readyButtons[1]!);
    await waitFor(() => {
      expect(readySequenceMock).toHaveBeenCalledTimes(1);
    });
    expect(launchMock).not.toHaveBeenCalled();
    expect(goSequenceMock).not.toHaveBeenCalled();
    expect(markSlotReadyMock).toHaveBeenCalledWith(1, 15, "fp-15", null, {
      1: { h: 10, p: 0, y: 0 },
    });
    expect(screen.queryByRole("alertdialog")).toBeNull();

    fireEvent.click(readyButtons[0]!);
    expect(launchMock).not.toHaveBeenCalled();

    expect(capturedTriggers.onTriggerSequence).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "force-seq-empty" }));
    expect(launchMock).not.toHaveBeenCalled();
    expect(toastWarning).toHaveBeenCalled();
    expect(String(toastWarning.mock.calls[0]?.[0])).toMatch(/待修复|待编排|无目标|无轨道/);
  });

  it("blocks Ready and toasts when a member object is not coupled", () => {
    coupledObjectIdsRef.current = new Set();
    render(withMode(<ExecArea />));
    fireEvent.click(screen.getByRole("button", { name: "F2 Ready" }));
    expect(toastWarning).toHaveBeenCalledWith("未耦合");
    expect(readySequenceMock).not.toHaveBeenCalled();
    expect(markSlotReadyMock).not.toHaveBeenCalled();
  });

  it("blocks GO and toasts when a member object is not coupled", () => {
    coupledObjectIdsRef.current = new Set();
    faderSlotsRef.current = faderSlotsRef.current.map((slot) =>
      slot.index === 1 ? { ...slot, phase: "ready" } : slot,
    );
    render(withMode(<ExecArea />));
    fireEvent.click(screen.getByRole("button", { name: "F2 GO" }));
    expect(toastWarning).toHaveBeenCalledWith("未耦合");
    expect(goSequenceMock).not.toHaveBeenCalled();
    expect(launchMock).not.toHaveBeenCalled();
  });

  it("Ready failure stays idle and does not launch", async () => {
    readySequenceMock.mockResolvedValueOnce({
      ok: false,
      toast: "warning",
      message: "动作序列校验失败，无法下载",
    });
    render(withMode(<ExecArea />));
    fireEvent.click(screen.getByRole("button", { name: "F2 Ready" }));
    await waitFor(() => {
      expect(readySequenceMock).toHaveBeenCalled();
    });
    expect(launchMock).not.toHaveBeenCalled();
    expect(goSequenceMock).not.toHaveBeenCalled();
    expect(clearSlotReadyMock).toHaveBeenCalledWith(1);
    expect(toastWarning).toHaveBeenCalledWith("动作序列校验失败，无法下载");
    expect(markSlotReadyMock).not.toHaveBeenCalled();
  });

  it("GO uses the current fader value and launches only after Ready", async () => {
    faderSlotsRef.current = faderSlotsRef.current.map((slot) =>
      slot.index === 1
        ? { ...slot, phase: "ready", faderValue: 150, preparedPoses: { 1: { h: 10, p: 0, y: 0 } } }
        : slot,
    );
    render(withMode(<ExecArea />));

    fireEvent.click(screen.getByRole("button", { name: "F2 GO" }));
    await waitFor(() => {
      expect(goSequenceMock).toHaveBeenCalledTimes(1);
    });
    expect(goSequenceMock.mock.calls[0]?.[0]).toMatchObject({
      sequenceId: 15,
      faderPercent: 150,
    });
    expect(readySequenceMock).not.toHaveBeenCalled();
    expect(launchMock).toHaveBeenCalledTimes(1);
    expect(launchMock.mock.calls[0]?.[0]).toMatchObject({
      kind: "sequence",
      name: "正常序列",
      durationMs: null,
      speedPercent: 150,
      source: { kind: "fader", slotIndex: 1 },
    });
    expect(stopPreviewMock).toHaveBeenCalledTimes(1);
  });

  it("GO failure stays ready and does not launch", async () => {
    goSequenceMock.mockResolvedValueOnce({
      ok: false,
      toast: "error",
      message: "动作序列启动失败",
    });
    faderSlotsRef.current = faderSlotsRef.current.map((slot) =>
      slot.index === 1
        ? { ...slot, phase: "ready", preparedPoses: { 1: { h: 10, p: 0, y: 0 } } }
        : slot,
    );
    render(withMode(<ExecArea />));
    fireEvent.click(screen.getByRole("button", { name: "F2 GO" }));
    await waitFor(() => {
      expect(goSequenceMock).toHaveBeenCalled();
    });
    expect(launchMock).not.toHaveBeenCalled();
    expect(clearSlotReadyMock).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("动作序列启动失败");
  });

  it("marks the fader slot running while its card is locally stopped", () => {
    execCardsRef.current = [
      runningCard({
        id: "fader-stopped",
        source: { kind: "fader", slotIndex: 1 },
        status: "stopped",
      }),
    ];
    render(withMode(<ExecArea />));
    expect(setSlotRunningMock).toHaveBeenCalledWith(1, true);
  });

  it("opens the start-pose dialog and waits for confirm before ready", async () => {
    snapshotsRef.current = [{ descriptor: { id: 1 }, positions: { h: 0, p: 0, y: 0 } }];
    render(withMode(<ExecArea />));
    fireEvent.click(screen.getByRole("button", { name: "F2 Ready" }));

    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "未在起始位姿" })).toBeTruthy();
    expect(screen.getByTestId("pose-extra-time").textContent).toMatch(/秒/);
    expect(screen.getByTestId("pose-total-time").textContent).toMatch(/秒/);
    expect(readySequenceMock).not.toHaveBeenCalled();
    expect(markSlotReadyMock).not.toHaveBeenCalled();

    const extraBefore = screen.getByTestId("pose-extra-time").textContent;
    fireEvent.click(screen.getByRole("button", { name: "最快速度" }));
    await waitFor(() => {
      expect(screen.getByTestId("pose-extra-time").textContent).not.toBe(extraBefore);
    });
    expect(readySequenceMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "立即到起点" }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(readySequenceMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    await waitFor(() => {
      expect(readySequenceMock).toHaveBeenCalledTimes(1);
    });
    expect(markSlotReadyMock).toHaveBeenCalledTimes(1);
    const stored = markSlotReadyMock.mock.calls[0];
    expect(stored?.[0]).toBe(1);
    expect(stored?.[1]).toBe(15);
    expect(stored?.[2]).toBe("fp-15");
    expect(stored?.[3]).toMatchObject({ totalTime: expect.any(Number), models: expect.any(Array) });
    expect(stored?.[3].totalTime).toBeGreaterThan(0);
    expect(stored?.[4]).toEqual({ 1: { h: 0, p: 0, y: 0 } });
  });

  it("ignores a second confirm click before the dialog closes", async () => {
    snapshotsRef.current = [{ descriptor: { id: 1 }, positions: { h: 0, p: 0, y: 0 } }];
    render(withMode(<ExecArea />));
    fireEvent.click(screen.getByRole("button", { name: "F2 Ready" }));
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    const confirm = screen.getByRole("button", { name: "确认" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => {
      expect(readySequenceMock).toHaveBeenCalledTimes(1);
    });
    expect(markSlotReadyMock).toHaveBeenCalledTimes(1);
  });

  it("cancel closes the dialog and does not ready", async () => {
    snapshotsRef.current = [{ descriptor: { id: 1 }, positions: { h: 0, p: 0, y: 0 } }];
    render(withMode(<ExecArea />));
    fireEvent.click(screen.getByRole("button", { name: "F2 Ready" }));
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
    expect(readySequenceMock).not.toHaveBeenCalled();
    expect(markSlotReadyMock).not.toHaveBeenCalled();
  });

  it("shows the planner error and keeps confirm disabled", async () => {
    snapshotsRef.current = [{ descriptor: { id: 1 }, positions: { h: 0, p: 0, y: 0 } }];
    documentRef.current!.setup.controlledObjects[0]!.maxAxisVelocity = 0;
    render(withMode(<ExecArea />));
    fireEvent.click(screen.getByRole("button", { name: "F2 Ready" }));
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText(/max motor velocity/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "确认" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
    expect(readySequenceMock).not.toHaveBeenCalled();
  });

  it("blocks GO when the member left the prepared pose", async () => {
    snapshotsRef.current = [{ descriptor: { id: 1 }, positions: { h: 0, p: 0, y: 0 } }];
    faderSlotsRef.current = faderSlotsRef.current.map((slot) =>
      slot.index === 1
        ? { ...slot, phase: "ready", preparedPoses: { 1: { h: 10, p: 0, y: 0 } } }
        : slot,
    );
    render(withMode(<ExecArea />));
    fireEvent.click(screen.getByRole("button", { name: "F2 GO" }));
    expect(await screen.findByRole("heading", { name: "当前未在准备位姿，请重新准备" })).toBeTruthy();
    expect(goSequenceMock).not.toHaveBeenCalled();
    expect(launchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
    expect(clearSlotReadyMock).toHaveBeenCalledWith(1);
    expect(goSequenceMock).not.toHaveBeenCalled();
  });

  it("GO does not open the start-pose dialog", async () => {
    snapshotsRef.current = [{ descriptor: { id: 1 }, positions: { h: 0, p: 0, y: 0 } }];
    faderSlotsRef.current = faderSlotsRef.current.map((slot) =>
      slot.index === 1
        ? { ...slot, phase: "ready", preparedPoses: { 1: { h: 0, p: 0, y: 0 } } }
        : slot,
    );
    render(withMode(<ExecArea />));
    fireEvent.click(screen.getByRole("button", { name: "F2 GO" }));
    await waitFor(() => {
      expect(goSequenceMock).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(readySequenceMock).not.toHaveBeenCalled();
  });

  const armStoppedChapter = (status: "stopped" | "paused" = "stopped") => {
    execCardsRef.current = [
      {
        id: "card-stopped",
        kind: "sequence",
        name: "空序列",
        source: { kind: "fader", slotIndex: 0 },
        durationMs: null,
        elapsedMs: 0,
        speedPercent: 80,
        status,
        startedAt: 0,
        emergencyStopped: false,
        sequenceId: 14,
        sequenceHandle: { actionId: 14 },
        trajectoryMode: false,
      },
    ];
    programState.current = {
      id: "program-a",
      name: "节目 A",
      chapters: [
        {
          id: "ch-1",
          name: "章节 1",
          items: [
            { kind: "sequence", sequence: { id: 14, name: "空序列", durationMs: 0 } },
            { kind: "sequence", sequence: { id: 15, name: "正常序列", durationMs: 2000 } },
          ],
        },
      ],
    };
  };

  it("prepares the next sequence and then goes without another pose check", async () => {
    armStoppedChapter();
    render(withMode(<ExecArea />));
    fireEvent.click(screen.getByRole("button", { name: "下一条" }));
    await waitFor(() => {
      expect(goSequenceMock).toHaveBeenCalledTimes(1);
    });
    expect(readySequenceMock).toHaveBeenCalledTimes(1);
    expect(readySequenceMock.mock.calls[0]?.[0]).toMatchObject({ sequenceId: 15 });
    expect(closeMock).toHaveBeenCalledWith("card-stopped");
    expect(goSequenceMock.mock.calls[0]?.[0]).toMatchObject({ sequenceId: 15, faderPercent: 100 });
    expect(readySequenceMock.mock.invocationCallOrder[0]).toBeLessThan(closeMock.mock.invocationCallOrder[0]!);
    expect(closeMock.mock.invocationCallOrder[0]).toBeLessThan(goSequenceMock.mock.invocationCallOrder[0]!);
    expect(launchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: { kind: "program" },
        sequenceId: 15,
        speedPercent: 100,
      }),
    );
    expect(screen.queryByRole("heading", { name: "当前未在准备位姿，请重新准备" })).toBeNull();
    expect(markSlotReadyMock).not.toHaveBeenCalled();
  });

  it("asks for the start pose before preparing the next sequence", async () => {
    armStoppedChapter();
    snapshotsRef.current = [{ descriptor: { id: 1 }, positions: { h: 0, p: 0, y: 0 } }];
    render(withMode(<ExecArea />));
    fireEvent.click(screen.getByRole("button", { name: "下一条" }));
    expect(await screen.findByRole("heading", { name: "未在起始位姿" })).toBeTruthy();
    expect(readySequenceMock).not.toHaveBeenCalled();
    expect(closeMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    await waitFor(() => {
      expect(goSequenceMock).toHaveBeenCalledTimes(1);
    });
    expect(readySequenceMock).toHaveBeenCalledTimes(1);
    expect(closeMock).toHaveBeenCalledWith("card-stopped");
  });

  it("leaves the stopped card when the start-pose dialog is cancelled", async () => {
    armStoppedChapter();
    snapshotsRef.current = [{ descriptor: { id: 1 }, positions: { h: 0, p: 0, y: 0 } }];
    render(withMode(<ExecArea />));
    fireEvent.click(screen.getByRole("button", { name: "下一条" }));
    expect(await screen.findByRole("heading", { name: "未在起始位姿" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
    expect(readySequenceMock).not.toHaveBeenCalled();
    expect(closeMock).not.toHaveBeenCalled();
  });

  it("keeps the stopped card when the next sequence is not coupled", () => {
    armStoppedChapter();
    coupledObjectIdsRef.current = new Set();
    render(withMode(<ExecArea />));
    fireEvent.click(screen.getByRole("button", { name: "下一条" }));
    expect(toastWarning).toHaveBeenCalledWith("未耦合");
    expect(readySequenceMock).not.toHaveBeenCalled();
    expect(closeMock).not.toHaveBeenCalled();
  });

  it("keeps the stopped card when preparing the next sequence fails", async () => {
    armStoppedChapter();
    readySequenceMock.mockResolvedValueOnce({
      ok: false,
      toast: "warning",
      message: "动作序列校验失败，无法下载",
    });
    render(withMode(<ExecArea />));
    fireEvent.click(screen.getByRole("button", { name: "下一条" }));
    await waitFor(() => {
      expect(readySequenceMock).toHaveBeenCalled();
    });
    expect(closeMock).not.toHaveBeenCalled();
    expect(goSequenceMock).not.toHaveBeenCalled();
    expect(toastWarning).toHaveBeenCalledWith("动作序列校验失败，无法下载");
  });

  it("closes the current card when the following go fails", async () => {
    armStoppedChapter();
    goSequenceMock.mockResolvedValueOnce({
      ok: false,
      toast: "error",
      message: "动作序列启动失败",
    });
    render(withMode(<ExecArea />));
    fireEvent.click(screen.getByRole("button", { name: "下一条" }));
    await waitFor(() => {
      expect(goSequenceMock).toHaveBeenCalled();
    });
    expect(closeMock).toHaveBeenCalledWith("card-stopped");
    expect(launchMock).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("动作序列启动失败");
  });

  it("does not prepare the next sequence while the card is paused", () => {
    armStoppedChapter("paused");
    render(withMode(<ExecArea />));
    fireEvent.click(screen.getByRole("button", { name: "下一条" }));
    expect(readySequenceMock).not.toHaveBeenCalled();
  });

  it("does not prepare the next sequence when it is already a task", () => {
    armStoppedChapter();
    execCardsRef.current = [
      ...execCardsRef.current,
      {
        id: "card-next",
        kind: "sequence",
        name: "正常序列",
        source: { kind: "program" },
        durationMs: null,
        elapsedMs: 0,
        speedPercent: 100,
        status: "running",
        startedAt: 0,
        emergencyStopped: false,
        sequenceId: 15,
      },
    ];
    render(withMode(<ExecArea />));
    fireEvent.click(screen.getByRole("button", { name: "下一条" }));
    expect(readySequenceMock).not.toHaveBeenCalled();
  });
});

describe("PageSection readiness wiring", () => {
  it("derives hasWarning/warningMessage from authoritative document", () => {
    documentRef.current = makeDocument();
    render(
      withMode(
        <PageSection
          chapterId="ch-1"
          pageIndex={0}
          pageTotal={1}
          isCurrent
          sequences={[emptySequenceItem, okSequenceItem]}
          onClickHeader={vi.fn()}
          onItemDragStart={() => vi.fn()}
          itemIndexOffset={0}
        />,
      ),
    );

    const emptySeqRow = screen.getByRole("treeitem", { name: /空序列/i });
    expect(emptySeqRow.getAttribute("aria-label")).toMatch(/待修复|待编排|无轨道/);
    expect(emptySeqRow.getAttribute("title")).toMatch(/待修复|待编排|无轨道/);

    const okSeqRow = screen.getByRole("treeitem", { name: /^正常序列$/i });
    expect(okSeqRow.getAttribute("aria-label")).toBe("正常序列");
    expect(okSeqRow.getAttribute("title")).toBeFalsy();
  });
});

describe("program panel launch guards", () => {
  beforeEach(() => {
    documentRef.current = makeDocument();
    programState.current = {
      id: "program-a",
      name: "节目 A",
      chapters: [
        {
          id: "ch-1",
          name: "章节 1",
          items: [emptySequenceItem, okSequenceItem],
        },
      ],
    };
    actionBuilderState.current.programs = [
      {
        id: "program-a",
        name: "节目 A",
        type: "program",
        children: [
          {
            id: "ch-1",
            name: "章节 1",
            type: "chapter",
            children: [
              { id: "14", name: "空序列", type: "sequence" },
              { id: "15", name: "正常序列", type: "sequence" },
            ],
          },
        ],
      },
    ];
  });

  it("console ProgramPanel does not launch on double-click", async () => {
    render(withMode(<ProgramPanel variant="control" />));
    expect(
      screen.getByLabelText(/节目引用空动作序列「14」，待修复/),
    ).toBeTruthy();

    fireEvent.doubleClick(screen.getByRole("treeitem", { name: /空序列/i }));
    fireEvent.doubleClick(screen.getByRole("treeitem", { name: /^正常序列$/i }));
    await waitFor(() => {
      expect(screen.getByRole("treeitem", { name: /^正常序列$/i })).toBeTruthy();
    });
    expect(launchMock).not.toHaveBeenCalled();
    expect(startLocalAuthoredSequenceMock).not.toHaveBeenCalled();
    expect(readySequenceMock).not.toHaveBeenCalled();
    expect(goSequenceMock).not.toHaveBeenCalled();
    expect(toastWarning).not.toHaveBeenCalled();
  });

  it("control ProgramPanel row click toggles sequence preview", () => {
    render(withMode(<ProgramPanel variant="control" />));
    fireEvent.click(screen.getByRole("treeitem", { name: /^正常序列$/i }));
    expect(togglePreviewMock).toHaveBeenCalledWith(15);
  });

  it("action-builder ProgramPanel blocks handleLaunch for unrepaired items", async () => {
    render(withMode(<ProgramPanel variant="authoring" />));
    expect(
      screen.getByLabelText(/节目引用空动作序列「14」，待修复/),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "运行 空序列" }));
    expect(launchMock).not.toHaveBeenCalled();
    expect(toastWarning).toHaveBeenCalled();

    toastWarning.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "运行 正常序列" }));
    await waitFor(() => {
      expect(launchMock).toHaveBeenCalledTimes(1);
    });
    expect(toastWarning).not.toHaveBeenCalled();
  });
});

describe("warning UI accessibility", () => {
  it("marks ContentLibrary empty rows with accessible warning", () => {
    render(withMode(<ContentLibraryPanel />));
    expect(screen.getAllByText("待修复").length).toBeGreaterThan(0);
    const emptySequenceRow = screen.getByRole("button", { name: "空序列，待修复" });
    expect(emptySequenceRow.getAttribute("aria-label")).toMatch(/待修复/);
    expect(within(emptySequenceRow).getByText("待修复").className).toMatch(/text-warning/);
  });
});

const runningCard = (overrides: Partial<ExecCard>): ExecCard => ({
  id: "card",
  kind: "sequence",
  name: "Item",
  source: { kind: "program" },
  durationMs: 1000,
  elapsedMs: 0,
  speedPercent: 100,
  status: "running",
  startedAt: 0,
  emergencyStopped: false,
  ...overrides,
});

describe("execution cards", () => {
  it("empty state no longer mentions program double-click", () => {
    render(<ExecEmptyState />);
    expect(screen.getByText("暂无活跃任务")).toBeTruthy();
    expect(screen.queryByText(/双击节目/)).toBeNull();
    expect(screen.getByText(/Executor 槽位/)).toBeTruthy();
  });
  it("keeps a sequence card running after wall-clock exceeds 编排时长", () => {
    const authoredSequenceMs = 2000;
    const sequenceCard = runningCard({
      id: "seq-card",
      kind: "sequence",
      name: "正常序列",
      durationMs: null,
    });

    const next = advanceRunningCards([sequenceCard], authoredSequenceMs + 500);
    expect(next).toBeTruthy();
    const sequence = next!.find((card) => card.kind === "sequence");
    expect(sequence?.status).toBe("running");
    expect(sequence?.elapsedMs).toBe(authoredSequenceMs + 500);
  });

  it("stop calls action stop and skipNext does not", async () => {
    const { ExecCardsProvider, useExecCards: useRealExecCards } = await vi.importActual<
      typeof import("../../hooks/use-exec-cards")
    >("../../hooks/use-exec-cards");

    const Probe = () => {
      const { launch, stop, skipNext, restart, cards } = useRealExecCards();
      return (
        <div>
          <button
            type="button"
            onClick={() =>
              launch({
                kind: "sequence",
                name: "正常序列",
                durationMs: null,
                source: { kind: "program" },
                sequenceId: 15,
                sequenceHandle: { actionId: 9 },
                trajectoryMode: true,
              })
            }
          >
            launch-seq
          </button>
          {cards.map((card) => (
            <div key={card.id}>
              <span>{card.status}</span>
              <button type="button" onClick={() => stop(card.id)}>
                stop
              </button>
              <button type="button" onClick={() => skipNext(card.id)}>
                skip
              </button>
              <button type="button" onClick={() => restart(card.id)}>
                restart
              </button>
            </div>
          ))}
        </div>
      );
    };

    render(
      <ExecCardsProvider>
        <Probe />
      </ExecCardsProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "launch-seq" }));
    expect(screen.getByText("running")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "skip" }));
    expect(stopSequenceMock).not.toHaveBeenCalled();
    expect(screen.getByText("running")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "stop" }));
    expect(stopSequenceMock).toHaveBeenCalledWith(
      { actionId: 9, trajectoryMode: true },
      localSequenceTransport,
    );
    expect(screen.getByText("stopped")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "restart" }));
    expect(screen.getByText("running")).toBeTruthy();
  });
});
