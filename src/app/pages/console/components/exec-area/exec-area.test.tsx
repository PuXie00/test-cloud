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
import type { ButtonSlotState, FaderSlotState } from "../../hooks/use-executor-slots";
import type { ChapterItem, Program } from "../program-panel/program-data";
import { PageSection } from "../program-panel/page-section";
import { ButtonSlot } from "./executors/button-slot";
import { FaderSlot } from "./executors/fader-slot";

const {
  toastWarning,
  launchMock,
  stopSequenceMock,
  localSequenceTransport,
  buttonSlotsRef,
  faderSlotsRef,
  documentRef,
  capturedTriggers,
  programState,
  actionBuilderState,
} = vi.hoisted(() => ({
  toastWarning: vi.fn(),
  launchMock: vi.fn(() => "card-1"),
  stopSequenceMock: vi.fn(async () => undefined),
  localSequenceTransport: {
    saveAction: vi.fn(),
    syncCall: vi.fn(),
    stopAction: vi.fn(),
  },
  buttonSlotsRef: {
    current: [] as ButtonSlotState[],
  },
  faderSlotsRef: {
    current: [] as FaderSlotState[],
  },
  documentRef: {
    current: null as ProjectDocument | null,
  },
  capturedTriggers: {
    onTriggerCue: null as null | ((slotIndex: number, cueId: string) => void),
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
      cues: [
        { id: "cue-empty", name: "空 Cue", targets: {} },
        { id: "cue-ok", name: "正常 Cue", targets: { "co-1": { v1: 0 } } },
      ],
      sequences: [
        {
          id: 14,
          name: "空序列",
          trajectoryMode: "non-forced" as const,
          blocks: [],
          segments: [],
        },
        {
          id: 15,
          name: "正常序列",
          trajectoryMode: "non-forced" as const,
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
          children: Array<{ id: string; name: string; type: "cue" | "sequence" }>;
        }>;
      }>,
      dockMode: "cue" as const,
      selectedCueId: null as string | null,
      selectedSequenceId: null as number | null,
      combineFromCueId: null as string | null,
      selectedObjectIds: [] as string[],
      getTimelineObject: () => null,
      handleCueSelect: vi.fn(),
      handleSequenceSelect: vi.fn(),
      handleCuePreview: vi.fn(),
      handleCombineStart: vi.fn(),
      handleGenerateTransition: vi.fn(),
      handleCreateCue: vi.fn(),
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
    error: vi.fn(),
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
      cards: [],
      launch: launchMock,
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(),
      skipNext: vi.fn(),
      setSpeed: vi.fn(),
      emergencyStopAll: vi.fn(),
      close: vi.fn(),
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
      buttonSlots: buttonSlotsRef.current,
      faderSlots: faderSlotsRef.current,
      setFaderValue: vi.fn(),
      setSlotRunning: vi.fn(),
    }),
  };
});

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
    addCue: vi.fn(),
    addSequence: vi.fn(),
    isProgramEmpty: programState.current.chapters.length === 0,
  }),
}));

vi.mock("../../hooks/use-selection", () => ({
  useSelection: () => ({ clearSelection: vi.fn() }),
}));

vi.mock("./exec-cards/exec-cards", () => ({
  ExecCards: () => <div data-testid="exec-cards" />,
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
      onTriggerCue: (slotIndex: number, cueId: string) => void;
      onTriggerSequence: (slotIndex: number, sequenceId: number) => void;
    }) => {
      capturedTriggers.onTriggerCue = props.onTriggerCue;
      capturedTriggers.onTriggerSequence = props.onTriggerSequence;
      return (
        <>
          <actual.Executors {...props} />
          <button
            type="button"
            onClick={() => props.onTriggerCue(0, "cue-empty")}
          >
            force-cue-empty
          </button>
          <button
            type="button"
            onClick={() => props.onTriggerSequence(0, 14)}
          >
            force-seq-empty
          </button>
          <button
            type="button"
            onClick={() => props.onTriggerCue(1, "cue-ok")}
          >
            force-cue-ok
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
  startLocalAuthoredSequence: vi.fn(async (args: { sequenceId: number }) => ({
    ok: true,
    name: args.sequenceId === 15 ? "正常序列" : args.sequenceId,
    speedPercent: 100,
    sequenceHandle: { actionNo: 1, syncGroupId: 1 },
  })),
  stopSequence: (...args: unknown[]) => stopSequenceMock(...args),
  getLocalSequenceTransport: () => localSequenceTransport,
}));

vi.mock("../action-builder/use-action-builder", () => ({
  useActionBuilder: () => actionBuilderState.current,
}));

import { ExecArea } from "./exec-area";
import { ContentLibraryPanel } from "../action-builder/content-library/content-library-panel";
import { ProgramPanel as ConsoleProgramPanel } from "../program-panel/program-panel";
import { ProgramPanel as ActionBuilderProgramPanel } from "../action-builder/right-panel/program-panel";
import { ExecCardView } from "./exec-cards/exec-card";
import { advanceRunningCards, type ExecCard } from "../../hooks/use-exec-cards";

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
    positionCues: [
      { id: "cue-empty", name: "空 Cue", targets: {} },
      {
        id: "cue-ok",
        name: "正常 Cue",
        durationMs: 1000,
        targets: { "co-1": { v1: 10 } },
      },
    ],
    actionSequences: [
      {
        id: 14,
        name: "空序列",
        trajectoryMode: "non-forced",
        blocks: [],
        segments: [],
      },
      {
        id: 15,
        name: "正常序列",
        trajectoryMode: "non-forced",
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
        trajectoryMode: "non-forced",
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
              { kind: "cue", refId: "cue-empty" },
              { kind: "sequence", refId: 14 },
              { kind: "cue", refId: "cue-ok" },
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

const emptyCueItem: ChapterItem = {
  kind: "cue",
  cue: { id: "cue-empty", name: "空 Cue", durationMs: 1000, targets: {} },
};
const okCueItem: ChapterItem = {
  kind: "cue",
  cue: {
    id: "cue-ok",
    name: "正常 Cue",
    durationMs: 1000,
    targets: { "co-1": 10 },
  },
};
const emptySequenceItem: ChapterItem = {
  kind: "sequence",
  sequence: { id: 14, name: "空序列", durationMs: 0 },
};

afterEach(() => {
  cleanup();
  launchMock.mockClear();
  stopSequenceMock.mockClear();
  toastWarning.mockClear();
  capturedTriggers.onTriggerCue = null;
  capturedTriggers.onTriggerSequence = null;
  documentRef.current = null;
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
    const emptyCue = getMotionItemRepairIssue(document, "cue", "cue-empty");
    const emptySequence = getMotionItemRepairIssue(
      document,
      "sequence",
      14,
    );
    expect(emptyCue?.code).toBe("empty-cue");
    expect(emptySequence?.code).toBe("empty-sequence");
    expect(emptySequence?.message).toBe("动作序列为空，待编排");
    expect(document.motion.positionCues[0]).not.toHaveProperty("needsRepair");
    expect(document.motion.actionSequences[0]).not.toHaveProperty("needsRepair");
    expect(getMotionItemRepairIssue(document, "cue", "cue-ok")).toBeNull();
    expect(getMotionItemRepairIssue(document, "sequence", 15)).toBeNull();
    expect(getMotionItemRepairIssue(document, "sequence", 16)).toBeNull();

    // kind+id namespaces are distinct; missing must not look executable (null)
    const cueAsSequence = getMotionItemRepairIssue(document, "sequence", "cue-empty");
    const sequenceAsCue = getMotionItemRepairIssue(document, "cue", 14);
    expect(cueAsSequence).not.toBeNull();
    expect(sequenceAsCue).not.toBeNull();
    expect(cueAsSequence?.code).not.toBe("empty-cue");
    expect(sequenceAsCue?.code).not.toBe("empty-sequence");
  });

  it("reports programs that reference empty or missing motion items (fail closed)", () => {
    const document = makeDocument();
    expect(
      getProgramRepairIssues(document, "program-a").map((issue) => issue.itemId),
    ).toEqual(["cue-empty", 14]);
    expect(
      getProgramRepairIssues(document, "program-a").every(
        (issue) => issue.code === "program-ref-empty",
      ),
    ).toBe(true);

    document.motion.programs[0]!.chapters[0]!.items.push({
      kind: "cue",
      refId: "cue-missing",
    });
    const withMissing = getProgramRepairIssues(document, "program-a");
    expect(withMissing.map((issue) => issue.itemId)).toContain("cue-missing");
    expect(withMissing.find((issue) => issue.itemId === "cue-missing")?.code).toBe(
      "program-ref-empty",
    );
  });

  it("resolveMotionLaunchBlock fails closed for missing document/items", () => {
    const document = makeDocument();
    expect(resolveMotionLaunchBlock(null, "cue", "cue-ok")).not.toBeNull();
    expect(resolveMotionLaunchBlock(document, "cue", "cue-empty")?.code).toBe("empty-cue");
    expect(resolveMotionLaunchBlock(document, "sequence", "nope")).not.toBeNull();
    expect(resolveMotionLaunchBlock(document, "cue", "cue-ok")).toBeNull();
    expect(resolveMotionLaunchBlock(document, "sequence", 14)?.code).toBe(
      "empty-sequence",
    );
    expect(resolveMotionLaunchBlock(document, "sequence", 15)).toBeNull();
    expect(resolveMotionLaunchBlock(document, "sequence", 16)).toBeNull();
  });
});

describe("ButtonSlot / FaderSlot GO gate", () => {
  it("disables GO for repair-required cue/sequence and exposes warning reason", () => {
    const cueSlot: ButtonSlotState = {
      index: 0,
      label: "B1",
      cue: {
        id: "cue-empty",
        name: "空 Cue",
        durationMs: 1000,
        targets: {},
      },
      isRunning: false,
    };
    const seqSlot: FaderSlotState = {
      index: 0,
      label: "F1",
      sequence: {
        id: 14,
        name: "空序列",
        durationMs: 0,
      },
      faderValue: 100,
      isRunning: false,
    };
    const onGoCue = vi.fn();
    const onGoSeq = vi.fn();

    render(
      withMode(
        <>
          <ButtonSlot
            slot={cueSlot}
            repairMessage="Cue 无目标，待修复"
            onGo={onGoCue}
            onAssignFromDrag={vi.fn()}
          />
          <FaderSlot
            slot={seqSlot}
            repairMessage="动作序列无轨道，待修复"
            onGo={onGoSeq}
            onFaderChange={vi.fn()}
            onAssignFromDrag={vi.fn()}
          />
        </>,
      ),
    );

    const cueGo = screen.getAllByRole("button", { name: /GO/i })[0] as HTMLButtonElement;
    const seqGo = screen.getAllByRole("button", { name: /GO/i })[1] as HTMLButtonElement;
    expect(cueGo.disabled).toBe(true);
    expect(seqGo.disabled).toBe(true);
    expect(cueGo.getAttribute("aria-describedby")).toBeTruthy();
    expect(seqGo.getAttribute("aria-describedby")).toBeTruthy();
    const cueReason = document.getElementById(cueGo.getAttribute("aria-describedby")!);
    const seqReason = document.getElementById(seqGo.getAttribute("aria-describedby")!);
    expect(cueReason?.textContent).toMatch(/待修复/);
    expect(seqReason?.textContent).toMatch(/待修复/);

    fireEvent.click(cueGo);
    fireEvent.click(seqGo);
    expect(onGoCue).not.toHaveBeenCalled();
    expect(onGoSeq).not.toHaveBeenCalled();
  });

  it("keeps GO enabled for healthy filled slots", () => {
    const onGo = vi.fn();
    render(
      withMode(
        <ButtonSlot
          slot={{
            index: 0,
            label: "B1",
            cue: {
              id: "cue-ok",
              name: "正常 Cue",
              durationMs: 1000,
              targets: { "co-1": 10 },
            },
            isRunning: false,
          }}
          onGo={onGo}
          onAssignFromDrag={vi.fn()}
        />,
      ),
    );
    const go = screen.getByRole("button", { name: /GO/i }) as HTMLButtonElement;
    expect(go.disabled).toBe(false);
    fireEvent.click(go);
    expect(onGo).toHaveBeenCalledTimes(1);
  });
});

describe("ExecArea launch guard", () => {
  beforeEach(() => {
    documentRef.current = makeDocument();
    buttonSlotsRef.current = [
      {
        index: 0,
        label: "B1",
        cue: {
          id: "cue-empty",
          name: "空 Cue",
          durationMs: 1000,
          targets: {},
        },
        isRunning: false,
      },
      {
        index: 1,
        label: "B2",
        cue: {
          id: "cue-ok",
          name: "正常 Cue",
          durationMs: 1000,
          targets: { "co-1": 10 },
        },
        isRunning: false,
      },
    ];
    faderSlotsRef.current = [
      {
        index: 0,
        label: "F1",
        sequence: {
          id: 14,
          name: "空序列",
          durationMs: 0,
        },
        faderValue: 100,
        isRunning: false,
      },
      {
        index: 1,
        label: "F2",
        sequence: {
          id: 15,
          name: "正常序列",
          durationMs: 2000,
        },
        faderValue: 100,
        isRunning: false,
      },
    ];
  });

  it("blocks launch for empty cue/sequence even when trigger is forced", async () => {
    render(withMode(<ExecArea />));

    const goButtons = screen.getAllByRole("button", { name: /GO/i }) as HTMLButtonElement[];
    expect(goButtons[0]!.disabled).toBe(true);
    expect(goButtons[2]!.disabled).toBe(true);

    const healthyCueGo = goButtons[1]!;
    expect(healthyCueGo.disabled).toBe(false);
    fireEvent.click(healthyCueGo);
    expect(launchMock).toHaveBeenCalledTimes(1);
    launchMock.mockClear();

    fireEvent.click(goButtons[0]!);
    fireEvent.click(goButtons[2]!);
    expect(launchMock).not.toHaveBeenCalled();

    expect(capturedTriggers.onTriggerCue).toBeTruthy();
    expect(capturedTriggers.onTriggerSequence).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "force-cue-empty" }));
    fireEvent.click(screen.getByRole("button", { name: "force-seq-empty" }));
    expect(launchMock).not.toHaveBeenCalled();
    expect(toastWarning).toHaveBeenCalled();
    expect(String(toastWarning.mock.calls[0]?.[0])).toMatch(/待修复|待编排|无目标|无轨道/);

    fireEvent.click(screen.getByRole("button", { name: "force-cue-ok" }));
    fireEvent.click(screen.getByRole("button", { name: "force-seq-ok" }));
    await waitFor(() => {
      expect(launchMock).toHaveBeenCalledTimes(2);
    });
    expect(launchMock.mock.calls[1]?.[0]).toMatchObject({
      kind: "sequence",
      name: "正常序列",
      durationMs: null,
    });
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
          cues={[emptyCueItem, okCueItem]}
          sequences={[emptySequenceItem]}
          onClickHeader={vi.fn()}
          onAddCue={vi.fn()}
          onAddSequence={vi.fn()}
          onItemDragStart={() => vi.fn()}
          itemIndexOffset={0}
        />,
      ),
    );

    const emptyCueRow = screen.getByRole("treeitem", { name: /空 Cue/i });
    expect(emptyCueRow.getAttribute("aria-label")).toMatch(/待修复|无目标/);
    expect(emptyCueRow.getAttribute("title")).toMatch(/待修复|无目标/);

    const okCueRow = screen.getByRole("treeitem", { name: /^正常 Cue$/i });
    expect(okCueRow.getAttribute("aria-label")).toBe("正常 Cue");
    expect(okCueRow.getAttribute("title")).toBeFalsy();

    const emptySeqRow = screen.getByRole("treeitem", { name: /空序列/i });
    expect(emptySeqRow.getAttribute("aria-label")).toMatch(/待修复|待编排|无轨道/);
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
          items: [emptyCueItem, emptySequenceItem, okCueItem],
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
              { id: "cue-empty", name: "空 Cue", type: "cue" },
              { id: "14", name: "空序列", type: "sequence" },
              { id: "cue-ok", name: "正常 Cue", type: "cue" },
            ],
          },
        ],
      },
    ];
  });

  it("console ProgramPanel blocks double-click launch for unrepaired items", () => {
    render(withMode(<ConsoleProgramPanel />));
    expect(
      screen.getByLabelText(/节目引用空 Cue「cue-empty」，待修复/),
    ).toBeTruthy();

    fireEvent.doubleClick(screen.getByRole("treeitem", { name: /空 Cue/i }));
    fireEvent.doubleClick(screen.getByRole("treeitem", { name: /空序列/i }));
    expect(launchMock).not.toHaveBeenCalled();
    expect(toastWarning).toHaveBeenCalled();
    expect(String(toastWarning.mock.calls[0]?.[0])).toMatch(/待修复|待编排|无目标|无轨道/);

    toastWarning.mockClear();
    fireEvent.doubleClick(screen.getByRole("treeitem", { name: /^正常 Cue$/i }));
    expect(launchMock).toHaveBeenCalledTimes(1);
    expect(toastWarning).not.toHaveBeenCalled();
  });

  it("action-builder ProgramPanel blocks handleLaunch for unrepaired items", () => {
    render(withMode(<ActionBuilderProgramPanel />));
    expect(
      screen.getByLabelText(/节目引用空 Cue「cue-empty」，待修复/),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "运行 空 Cue" }));
    fireEvent.click(screen.getByRole("button", { name: "运行 空序列" }));
    expect(launchMock).not.toHaveBeenCalled();
    expect(toastWarning).toHaveBeenCalled();

    toastWarning.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "运行 正常 Cue" }));
    expect(launchMock).toHaveBeenCalledTimes(1);
    expect(toastWarning).not.toHaveBeenCalled();
  });
});

describe("warning UI accessibility", () => {
  it("marks ContentLibrary empty rows with accessible warning", () => {
    render(withMode(<ContentLibraryPanel />));
    expect(screen.getAllByText("待修复").length).toBeGreaterThan(0);
    const emptyCueRow = screen.getByRole("button", { name: "空 Cue，待修复" });
    expect(emptyCueRow.getAttribute("aria-label")).toMatch(/待修复/);
    expect(within(emptyCueRow).getByText("待修复").className).toMatch(/text-warning/);
  });
});

const noopCardHandlers = {
  onPause: vi.fn(),
  onResume: vi.fn(),
  onStop: vi.fn(),
  onSkipNext: vi.fn(),
  onSetSpeed: vi.fn(),
  onClose: vi.fn(),
};

const runningCard = (overrides: Partial<ExecCard>): ExecCard => ({
  id: "card",
  kind: "cue",
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
  it("keeps a sequence card running after wall-clock exceeds 编排时长 while cue cards auto-complete", () => {
    const authoredSequenceMs = 2000;
    const sequenceCard = runningCard({
      id: "seq-card",
      kind: "sequence",
      name: "正常序列",
      durationMs: null,
    });
    const cueCard = runningCard({
      id: "cue",
      kind: "cue",
      name: "正常 Cue",
      durationMs: 1000,
    });

    const next = advanceRunningCards([sequenceCard, cueCard], authoredSequenceMs + 500);
    expect(next).toBeTruthy();
    const sequence = next!.find((card) => card.kind === "sequence");
    const cue = next!.find((card) => card.kind === "cue");
    expect(sequence?.status).toBe("running");
    expect(sequence?.elapsedMs).toBe(authoredSequenceMs + 500);
    expect(cue?.status).toBe("completed");
    expect(cue?.elapsedMs).toBe(1000);
  });

  it("renders elapsed wall time and C++ 运行中 without percentage for sequence cards", () => {
    render(
      <ExecCardView
        card={runningCard({
          id: "seq-card",
          kind: "sequence",
          name: "正常序列",
          durationMs: null,
          elapsedMs: 1500,
        })}
        {...noopCardHandlers}
      />,
    );
    expect(screen.getByText("C++ 运行中")).toBeTruthy();
    expect(screen.getByText("00:01.5")).toBeTruthy();
    expect(screen.queryByText(/剩 /)).toBeNull();
  });

  it("does not show C++ 运行中 for a skipped or completed null-duration card", () => {
    render(
      <ExecCardView
        card={runningCard({
          id: "seq-card",
          kind: "sequence",
          name: "正常序列",
          durationMs: null,
          elapsedMs: 1500,
          status: "completed",
        })}
        {...noopCardHandlers}
      />,
    );
    expect(screen.queryByText("C++ 运行中")).toBeNull();
    expect(screen.getByText("00:01.5")).toBeTruthy();
  });

  it("skipNext stops the sequence handle when present then marks the card completed", async () => {
    const { ExecCardsProvider, useExecCards: useRealExecCards } = await vi.importActual<
      typeof import("../../hooks/use-exec-cards")
    >("../../hooks/use-exec-cards");

    const Probe = () => {
      const { launch, skipNext, cards } = useRealExecCards();
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
                sequenceHandle: { actionNo: 9, syncGroupId: 3 },
              })
            }
          >
            launch-seq
          </button>
          {cards.map((card) => (
            <button key={card.id} type="button" onClick={() => skipNext(card.id)}>
              skip-{card.status}
            </button>
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
    fireEvent.click(screen.getByRole("button", { name: "skip-running" }));
    expect(stopSequenceMock).toHaveBeenCalledTimes(1);
    expect(stopSequenceMock).toHaveBeenCalledWith(
      { actionNo: 9, syncGroupId: 3 },
      localSequenceTransport,
    );
    expect(screen.getByRole("button", { name: "skip-completed" })).not.toBeNull();
  });
});
