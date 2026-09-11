// @vitest-environment jsdom

/**
 * Task 10: cross-provider configuration history acceptance.
 *
 * Path note: plan lists
 * `src/app/pages/console/project-configuration-history.integration.test.tsx`,
 * but that location is outside vitest `include`. This file lives under
 * `hooks/` so the single focused suite can run without changing vitest.config.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  type RenderHookResult,
} from "@testing-library/react";
import { createElement, useEffect, type ReactNode } from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { ProjectProvider } from "@/app/project/project-provider";
import {
  installMemoryProjectAPI,
  uninstallMemoryProjectAPI,
} from "@/app/project/install-memory-project-api";
import {
  GZ_2025_RECORD,
  SH_BALLET_RECORD,
} from "@/app/project/test-fixtures";
import {
  getMotionItemRepairIssue,
  getProgramRepairIssues,
  resolveMotionLaunchBlock,
} from "@/app/project/project-motion-readiness";
import { useProject } from "@/app/project/use-project";
import { ActionBuilderProvider } from "@/app/pages/console/components/action-builder/action-builder-context";
import { useActionBuilder } from "@/app/pages/console/components/action-builder/use-action-builder";
import { ProgramProvider, useProgram } from "@/app/pages/console/hooks/use-program";
import {
  ProjectStoreProvider,
  useProjectStore,
} from "@/app/pages/console/hooks/use-project-store";
import {
  useObjectDeletion,
  type ObjectDeletionController,
} from "@/app/pages/console/hooks/use-object-deletion";

const {
  consoleModeState,
  alignConfirmMock,
} = vi.hoisted(() => ({
  consoleModeState: {
    current: {
      mode: "rehearsal" as "rehearsal" | "show",
      isLocked: false,
      enterShow: vi.fn(),
      exitShow: vi.fn(),
      lock: vi.fn(),
    },
  },
  alignConfirmMock: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@/app/auth/use-auth", () => ({
  useAuth: () => ({
    user: { role: "admin" },
    logout: vi.fn(),
  }),
}));

vi.mock("@/app/pages/console/hooks/use-console-mode", () => ({
  useConsoleMode: () => consoleModeState.current,
}));

vi.mock(
  "@/app/pages/console/components/drive-debug/alignment-checklist/alignment-checklist-provider",
  () => ({
    useAlignmentChecklist: () => ({
      allConfirmed: true,
      openDialog: vi.fn(),
      dialogOpen: false,
      confirmItem: (...args: unknown[]) => alignConfirmMock(...args),
      confirmAll: (...args: unknown[]) => alignConfirmMock(...args),
    }),
  }),
);

vi.mock("@/app/components/ics/emergency-stop-button", () => ({
  EmergencyStopButton: () => null,
}));
vi.mock("@/app/components/project-center", () => ({
  ProjectCenterDialog: () => null,
}));

vi.mock(
  "@/app/pages/console/components/show-mode-confirm/show-mode-confirm-dialog",
  () => ({
    ShowModeConfirmDialog: () => null,
  }),
);

vi.mock("@/app/pages/console/components/collaboration/collab-dialog", () => ({
  CollabDialog: () => null,
}));

vi.mock(
  "@/app/pages/console/components/collaboration/collab-quick-popover",
  () => ({
    CollabQuickPopover: () => null,
  }),
);

vi.mock("@/app/pages/console/components/permissions/permissions-dialog", () => ({
  PermissionsDialog: () => null,
}));

vi.mock(
  "@/app/pages/console/components/system-settings/system-settings-dialog",
  () => ({
    SystemSettingsDialog: () => null,
  }),
);

vi.mock(
  "@/app/pages/console/components/drive-debug/alignment-checklist/alignment-checklist-dialog",
  () => ({
    AlignmentChecklistDialog: () => null,
  }),
);

vi.mock(
  "@/app/pages/console/components/system-status/system-status-popover",
  () => ({
    SystemStatusPopover: () => null,
  }),
);

vi.mock("@/app/viz3d", () => ({
  getViz3DEngine: () => ({
    getSavedView: () => null,
    captureCoverPngBase64: () => null,
  }),
}));

import { TopBar } from "@/app/pages/console/components/TopBar";

/** ConsolePage order: ProjectProvider (outer) → Program → Store → ActionBuilder */
const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(
    ProjectProvider,
    null,
    createElement(
      ProgramProvider,
      null,
      createElement(
        ProjectStoreProvider,
        null,
        createElement(ActionBuilderProvider, null, children),
      ),
    ),
  );

type IntegrationApi = {
  project: ReturnType<typeof useProject>;
  store: ReturnType<typeof useProjectStore>;
  program: ReturnType<typeof useProgram>;
  builder: ReturnType<typeof useActionBuilder>;
  deletion: ObjectDeletionController;
};

const renderIntegration = () =>
  renderHook(
    (): IntegrationApi => ({
      project: useProject(),
      store: useProjectStore(),
      program: useProgram(),
      builder: useActionBuilder(),
      deletion: useObjectDeletion(),
    }),
    { wrapper },
  );

const openFixture = async (
  result: RenderHookResult<IntegrationApi, unknown>["result"],
  folderName: string = GZ_2025_RECORD.folderName,
) => {
  await waitFor(() => expect(result.current.project.loading).toBe(false));
  await act(async () => {
    await result.current.project.openProject(folderName);
  });
  await waitFor(() => {
    expect(result.current.project.currentProject?.document).toBeTruthy();
  });
};

const plcMock = vi.fn();
const scanMock = vi.fn();
const execMock = vi.fn();
const addModelWithDefaultValues = vi.fn();
const modifyModelType = vi.fn();
const configureModelParamModel = vi.fn();
const deleteModelPlc = vi.fn();

const flushCsocketMicrotasks = async () => {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
  }
};

const clearModelCsocketMocks = () => {
  addModelWithDefaultValues.mockClear();
  modifyModelType.mockClear();
  configureModelParamModel.mockClear();
  deleteModelPlc.mockClear();
};

const expectNoModelCsocketCalls = () => {
  expect(addModelWithDefaultValues).not.toHaveBeenCalled();
  expect(modifyModelType).not.toHaveBeenCalled();
  expect(configureModelParamModel).not.toHaveBeenCalled();
  expect(deleteModelPlc).not.toHaveBeenCalled();
};

const installSideEffectMocks = () => {
  plcMock.mockReset();
  scanMock.mockReset();
  execMock.mockReset();
  alignConfirmMock.mockReset();
  const ok = async () => ({
    ok: true as const,
    data: { success: true as const },
  });
  addModelWithDefaultValues.mockReset();
  modifyModelType.mockReset();
  configureModelParamModel.mockReset();
  deleteModelPlc.mockReset();
  addModelWithDefaultValues.mockImplementation(ok);
  modifyModelType.mockImplementation(ok);
  configureModelParamModel.mockImplementation(ok);
  deleteModelPlc.mockImplementation(ok);
  window.csocketApi = {
    openProject: () => ok(),
    addDevicePlc: (...args: unknown[]) => {
      plcMock(...args);
      return ok();
    },
    deleteDevicePlc: (...args: unknown[]) => {
      plcMock(...args);
      return ok();
    },
    configureAxisParamMotor: () => ok(),
    syncMotorPlc: () => ok(),
    deleteMotorPlc: () => ok(),
    addModelWithDefaultValues,
    modifyModelType,
    configureModelParamModel,
    deleteModelPlc,
    scanMasterPlc: (...args: unknown[]) => {
      scanMock(...args);
      return ok();
    },
    actionSyncCallPlc: (...args: unknown[]) => {
      execMock(...args);
      return ok();
    },
    actionPreparePlc: (...args: unknown[]) => {
      execMock(...args);
      return ok();
    },
  } as unknown as Window["csocketApi"];
};

const expectNoHardwareSideEffects = () => {
  expect(plcMock).not.toHaveBeenCalled();
  expect(scanMock).not.toHaveBeenCalled();
  expect(execMock).not.toHaveBeenCalled();
  expect(alignConfirmMock).not.toHaveBeenCalled();
};

const seedCascadeTarget = (
  result: RenderHookResult<IntegrationApi, unknown>["result"],
) => {
  let objectId = "";
  let motorId = "";

  act(() => {
    const created = result.current.store.addObjectFromShape("cube");
    expect(created).toBeTruthy();
    objectId = created!.id;
  });

  act(() => {
    const unbound = result.current.store.motors.find(
      (motor) => motor.controlledObjectId == null,
    );
    expect(unbound).toBeTruthy();
    motorId = unbound!.id;
    expect(result.current.store.bindAxis(objectId, "0", motorId)).toBe(true);
  });

  act(() => {
    result.current.project.runTrackedDocumentUpdate(
      "配置对齐与场景组",
      (document) => ({
        ...document,
        setup: {
          ...document.setup,
          alignment: {
            ...document.setup.alignment,
            [objectId]: {
              method: "distance",
              status: "aligned",
              alignedAt: "2026-08-10T00:00:00Z",
            },
          },
          scene: {
            groups: [
              ...(document.setup.scene?.groups ?? []),
              {
                id: "group-cascade-test",
                name: "级联测试组",
                objectIds: [objectId],
              },
            ],
          },
        },
      }),
    );
  });

  expect(
    result.current.project.currentProject!.document!.setup.controlledObjects.some(
      (object) => object.id === objectId,
    ),
  ).toBe(true);
  expect(
    result.current.builder.timelineObjects.some((object) => object.id === objectId),
  ).toBe(true);

  act(() => {
    result.current.builder.handleCreateCue([objectId]);
  });
  const cueId =
    result.current.builder.selectedCueId ??
    result.current.builder.cues.at(-1)?.id ??
    "";
  expect(cueId).toBeTruthy();
  expect(
    result.current.project.currentProject!.document!.motion.positionCues.some(
      (cue) => cue.id === cueId && cue.targets[objectId] !== undefined,
    ),
  ).toBe(true);

  const sequenceId = 1;
  act(() => {
    result.current.project.updateCurrentDocument(
      (document) => ({
        ...document,
        motion: {
          ...document.motion,
          actionSequences: [
            ...document.motion.actionSequences,
            {
              id: sequenceId,
              name: "级联序列",
              trajectoryMode: "non-forced" as const,
              blocks: [
                {
                  id: "cascade-pose",
                  kind: "pose" as const,
                  objectId: Number(objectId),
                  atMs: 1000,
                  pose: { v1: 100, v2: 0, v3: 0 },
                },
              ],
              segments: [],
            },
          ],
        },
      }),
      "program",
    );
  });
  expect(
    result.current.project.currentProject!.document!.motion.actionSequences.some(
      (sequence) =>
        sequence.id === sequenceId &&
        sequence.blocks.some(
          (block) => block.kind === "pose" && block.objectId === Number(objectId),
        ),
    ),
  ).toBe(true);

  // Use motion origin so Program/ActionBuilder rehydrate (program origin
  // short-circuits hydration when the writer is assumed to be ProgramProvider).
  act(() => {
    result.current.project.updateCurrentDocument(
      (document) => ({
        ...document,
        motion: {
          ...document.motion,
          programs: document.motion.programs.map((program) =>
            program.id !== "prog-gz-main"
              ? program
              : {
                  ...program,
                  chapters: program.chapters.map((chapter) =>
                    chapter.id !== "ch-01"
                      ? chapter
                      : {
                          ...chapter,
                          items: [
                            ...chapter.items,
                            { kind: "cue" as const, refId: cueId },
                            { kind: "sequence" as const, refId: sequenceId },
                          ],
                        },
                  ),
                },
          ),
        },
      }),
      "motion",
    );
  });

  expect(
    result.current.project.currentProject!.document!.motion.programs
      .flatMap((program) => program.chapters)
      .flatMap((chapter) => chapter.items)
      .some(
        (item) =>
          (item.kind === "cue" && item.refId === cueId) ||
          (item.kind === "sequence" && item.refId === sequenceId),
      ),
  ).toBe(true);
  expect(
    result.current.program.program.chapters
      .flatMap((chapter) => chapter.items)
      .some(
        (item) =>
          (item.kind === "cue" && item.cue.id === cueId) ||
          (item.kind === "sequence" && item.sequence.id === sequenceId),
      ),
  ).toBe(true);

  // Independent motion/program edits establish a history boundary.
  expect(result.current.project.canUndo).toBe(false);
  expect(result.current.project.canRedo).toBe(false);

  return { objectId, cueId, sequenceId, motorId };
};

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: ResizeObserverStub,
  });
});

describe("project configuration history integration", () => {
  beforeEach(() => {
    installMemoryProjectAPI();
    installSideEffectMocks();
    consoleModeState.current.mode = "rehearsal";
  });

  afterEach(() => {
    cleanup();
    uninstallMemoryProjectAPI();
    // @ts-expect-error test cleanup
    delete window.csocketApi;
  });

  it("tracks setup edits with dirty/canUndo/canRedo/labels through undo and redo", async () => {
    const { result } = renderIntegration();
    await openFixture(result);
    const originalSetup = result.current.project.currentProject!.document!.setup;

    act(() => {
      result.current.store.addObjectFromShape("cube");
    });
    expect(result.current.project.canUndo).toBe(true);
    expect(result.current.project.undoLabel).toBe("新增受控物体");
    expect(result.current.project.isDirty).toBe(true);
    expect(result.current.project.canRedo).toBe(false);
    expect(result.current.store.objects.length).toBeGreaterThan(
      originalSetup.controlledObjects.length,
    );

    act(() => {
      result.current.project.undoProjectConfiguration();
    });
    await waitFor(() => {
      expect(result.current.store.objects).toHaveLength(
        originalSetup.controlledObjects.length,
      );
    });
    expect(result.current.project.currentProject!.document!.setup).toBe(originalSetup);
    expect(result.current.project.canUndo).toBe(false);
    expect(result.current.project.canRedo).toBe(true);
    expect(result.current.project.redoLabel).toBe("新增受控物体");
    expect(result.current.project.isDirty).toBe(false);

    act(() => {
      result.current.project.redoProjectConfiguration();
    });
    await waitFor(() => {
      expect(result.current.store.objects.length).toBe(
        originalSetup.controlledObjects.length + 1,
      );
    });
    expect(result.current.project.isDirty).toBe(true);
    expect(result.current.project.canUndo).toBe(true);
    expectNoHardwareSideEffects();
  });

  it("atomically deletes cascade refs, restores on one undo, and re-deletes on redo", async () => {
    const { result } = renderIntegration();
    await openFixture(result);
    const { objectId, cueId, sequenceId, motorId } = seedCascadeTarget(result);

    act(() => {
      result.current.deletion.requestDelete([objectId]);
    });
    expect(result.current.deletion.open).toBe(true);
    expect(result.current.deletion.impact?.emptyCueIds).toContain(cueId);
    expect(result.current.deletion.impact?.emptySequenceIds).toContain(sequenceId);

    act(() => {
      expect(result.current.deletion.confirmDelete()).toBe("deleted");
    });

    expect(result.current.store.findObject(objectId)).toBeUndefined();
    expect(
      result.current.project.currentProject!.document!.setup.controlledObjects.some(
        (object) => object.id === objectId,
      ),
    ).toBe(false);
    expect(
      result.current.store.motors.find((motor) => motor.id === motorId)?.controlledObjectId,
    ).toBeNull();
    expect(
      result.current.project.currentProject!.document!.setup.alignment[objectId],
    ).toBeUndefined();
    expect(
      result.current.project.currentProject!.document!.setup.scene?.groups?.find(
        (group) => group.id === "group-cascade-test",
      )?.objectIds,
    ).not.toContain(objectId);

    const docAfterDelete = result.current.project.currentProject!.document!;
    const cueAfter = docAfterDelete.motion.positionCues.find((cue) => cue.id === cueId);
    const seqAfter = docAfterDelete.motion.actionSequences.find(
      (sequence) => sequence.id === sequenceId,
    );
    expect(cueAfter).toBeTruthy();
    expect(cueAfter!.targets).toEqual({});
    expect(seqAfter).toBeUndefined();
    expect(
      docAfterDelete.motion.programs
        .flatMap((program) => program.chapters)
        .flatMap((chapter) => chapter.items)
        .some((item) => item.kind === "cue" && item.refId === cueId),
    ).toBe(true);
    expect(
      docAfterDelete.motion.programs
        .flatMap((program) => program.chapters)
        .flatMap((chapter) => chapter.items)
        .some((item) => item.kind === "sequence" && item.refId === sequenceId),
    ).toBe(false);

    expect(result.current.builder.cues.find((cue) => cue.id === cueId)?.targets).toEqual(
      {},
    );
    expect(
      result.current.builder.sequences.find((sequence) => sequence.id === sequenceId),
    ).toBeUndefined();
    expect(
      result.current.program.program.chapters
        .flatMap((chapter) => chapter.items)
        .some((item) => item.kind === "cue" && item.cue.id === cueId),
    ).toBe(true);
    expect(
      result.current.program.program.chapters
        .flatMap((chapter) => chapter.items)
        .some((item) => item.kind === "sequence" && item.sequence.id === sequenceId),
    ).toBe(false);

    expect(getMotionItemRepairIssue(docAfterDelete, "cue", cueId)?.code).toBe("empty-cue");
    expect(getMotionItemRepairIssue(docAfterDelete, "sequence", sequenceId)?.code).toBe(
      "empty-sequence",
    );
    expect(resolveMotionLaunchBlock(docAfterDelete, "cue", cueId)).toBeTruthy();
    expect(resolveMotionLaunchBlock(docAfterDelete, "sequence", sequenceId)).toBeTruthy();
    expect(
      getProgramRepairIssues(docAfterDelete, "prog-gz-main").some(
        (issue) => issue.itemId === cueId,
      ),
    ).toBe(true);
    expect(
      getProgramRepairIssues(docAfterDelete, "prog-gz-main").some(
        (issue) => issue.itemId === sequenceId,
      ),
    ).toBe(false);

    expect(result.current.project.undoLabel).toBe("删除受控物体");
    expect(result.current.project.canUndo).toBe(true);
    expect(result.current.project.canRedo).toBe(false);
    expect(result.current.project.documentRevision.origin).toBe("project-command");

    act(() => {
      result.current.project.undoProjectConfiguration();
    });

    await waitFor(() => {
      expect(result.current.store.findObject(objectId)).toBeDefined();
    });
    expect(
      result.current.store.motors.find((motor) => motor.id === motorId)?.controlledObjectId,
    ).toBe(objectId);
    expect(
      result.current.project.currentProject!.document!.setup.alignment[objectId],
    ).toBeTruthy();
    expect(
      result.current.project.currentProject!.document!.setup.scene?.groups?.find(
        (group) => group.id === "group-cascade-test",
      )?.objectIds,
    ).toContain(objectId);

    const docRestored = result.current.project.currentProject!.document!;
    expect(docRestored.motion.positionCues.find((cue) => cue.id === cueId)?.targets).toHaveProperty(
      objectId,
    );
    expect(
      docRestored.motion.actionSequences
        .find((sequence) => sequence.id === sequenceId)
        ?.blocks.some((block) => block.kind === "pose" && block.objectId === Number(objectId)),
    ).toBe(true);
    expect(result.current.builder.cues.find((cue) => cue.id === cueId)?.targets).toHaveProperty(
      objectId,
    );
    expect(
      result.current.builder.sequences
        .find((sequence) => sequence.id === sequenceId)
        ?.blocks.some((block) => block.kind === "pose" && block.objectId === Number(objectId)),
    ).toBe(true);
    expect(getMotionItemRepairIssue(docRestored, "cue", cueId)).toBeNull();
    expect(getMotionItemRepairIssue(docRestored, "sequence", sequenceId)).toBeNull();
    expect(result.current.project.canUndo).toBe(false);
    expect(result.current.project.canRedo).toBe(true);
    expect(result.current.project.redoLabel).toBe("删除受控物体");

    act(() => {
      result.current.project.redoProjectConfiguration();
    });
    await waitFor(() => {
      expect(result.current.store.findObject(objectId)).toBeUndefined();
    });
    const docRedeleted = result.current.project.currentProject!.document!;
    expect(docRedeleted.motion.positionCues.find((cue) => cue.id === cueId)?.targets).toEqual(
      {},
    );
    expect(
      docRedeleted.motion.actionSequences.find((sequence) => sequence.id === sequenceId),
    ).toBeUndefined();
    expect(resolveMotionLaunchBlock(docRedeleted, "cue", cueId)).toBeTruthy();
    expectNoHardwareSideEffects();
  });

  it("groups continuous tracked edits into one step and ignores cancel", async () => {
    const { result } = renderIntegration();
    await openFixture(result);
    const before = result.current.project.currentProject!.document!.setup;

    act(() => {
      expect(result.current.project.beginTrackedEdit("field:x", "修改 X")).toBe(true);
      for (const x of [10, 20, 30]) {
        result.current.project.runTrackedDocumentUpdate("修改 X", (document) => ({
          ...document,
          setup: {
            ...document.setup,
            scene: {
              groups: [{ id: "preview", name: `预览 ${x}`, objectIds: [] }],
            },
          },
        }));
      }
      result.current.project.commitTrackedEdit("field:x");
    });
    expect(result.current.project.undoLabel).toBe("修改 X");
    expect(result.current.project.canUndo).toBe(true);

    act(() => {
      result.current.project.undoProjectConfiguration();
    });
    expect(result.current.project.currentProject!.document!.setup).toBe(before);
    expect(result.current.project.canUndo).toBe(false);
    expect(result.current.project.canRedo).toBe(true);

    act(() => {
      result.current.project.redoProjectConfiguration();
    });
    const afterCommit = result.current.project.currentProject!.document!.setup;

    act(() => {
      expect(result.current.project.beginTrackedEdit("field:x", "修改 X")).toBe(true);
      result.current.project.runTrackedDocumentUpdate("修改 X", (document) => ({
        ...document,
        setup: {
          ...document.setup,
          scene: { groups: [{ id: "cancelled", name: "取消", objectIds: [] }] },
        },
      }));
      result.current.project.cancelTrackedEdit("field:x");
    });
    expect(result.current.project.currentProject!.document!.setup).toBe(afterCommit);
    expect(result.current.project.undoLabel).toBe("修改 X");
    expect(result.current.project.canRedo).toBe(false);
  });

  it("clears setup history on independent motion/program edits", async () => {
    const { result } = renderIntegration();
    await openFixture(result);

    act(() => {
      result.current.store.addObjectFromShape("cube");
    });
    expect(result.current.project.canUndo).toBe(true);

    act(() => {
      result.current.builder.handleCreateCue([]);
    });
    expect(result.current.project.canUndo).toBe(false);
    expect(result.current.project.documentRevision.origin).toBe("motion");

    act(() => {
      result.current.store.addObjectFromShape("cube");
    });
    expect(result.current.project.canUndo).toBe(true);
    const chapterId = result.current.program.program.chapters[0]!.id;
    act(() => {
      result.current.program.renameChapter(chapterId, "边界章节");
    });
    expect(result.current.project.canUndo).toBe(false);
    expect(result.current.project.documentRevision.origin).toBe("program");
  });

  it("keeps history across save, resets on project switch/reopen, and caps at 100 steps", async () => {
    const { result } = renderIntegration();
    await openFixture(result);

    act(() => {
      result.current.store.addObjectFromShape("cube");
    });
    expect(result.current.project.isDirty).toBe(true);
    expect(result.current.project.canUndo).toBe(true);

    await act(async () => {
      await result.current.project.saveCurrentProject();
    });
    expect(result.current.project.isDirty).toBe(false);
    expect(result.current.project.canUndo).toBe(true);
    expect(result.current.project.undoLabel).toBe("新增受控物体");

    act(() => {
      result.current.project.undoProjectConfiguration();
    });
    expect(result.current.project.isDirty).toBe(true);

    act(() => {
      result.current.project.redoProjectConfiguration();
    });
    expect(result.current.project.isDirty).toBe(false);

    act(() => {
      result.current.project.undoProjectConfiguration();
      result.current.store.addObjectFromShape("sphere");
    });
    expect(result.current.project.canRedo).toBe(false);
    expect(result.current.project.undoLabel).toBe("新增受控物体");

    await act(async () => {
      await result.current.project.openProject(SH_BALLET_RECORD.folderName);
    });
    expect(result.current.project.canUndo).toBe(false);
    expect(result.current.project.canRedo).toBe(false);

    await act(async () => {
      await result.current.project.openProject(GZ_2025_RECORD.folderName);
    });
    expect(result.current.project.canUndo).toBe(false);
    expect(result.current.project.canRedo).toBe(false);

    act(() => {
      result.current.store.addObjectFromShape("cube");
    });
    expect(result.current.project.canUndo).toBe(true);

    await act(async () => {
      await result.current.project.closeProject();
    });
    expect(result.current.project.canUndo).toBe(false);
    expect(result.current.project.canRedo).toBe(false);

    await act(async () => {
      await result.current.project.openProject(GZ_2025_RECORD.folderName);
    });
    expect(result.current.project.canUndo).toBe(false);
    expect(result.current.project.canRedo).toBe(false);

    const motionRoot = result.current.project.currentProject!.document!.motion;
    const rulesRoot = result.current.project.currentProject!.document!.rules;
    for (let index = 0; index < 101; index += 1) {
      act(() => {
        result.current.project.runTrackedDocumentUpdate(`离散 ${index}`, (document) => ({
          ...document,
          setup: {
            ...document.setup,
            scene: {
              groups: [
                {
                  id: `g-${index}`,
                  name: `组 ${index}`,
                  objectIds: [],
                },
              ],
            },
          },
        }));
      });
    }
    expect(result.current.project.currentProject!.document!.motion).toBe(motionRoot);
    expect(result.current.project.currentProject!.document!.rules).toBe(rulesRoot);

    let undoCount = 0;
    while (result.current.project.canUndo) {
      act(() => {
        result.current.project.undoProjectConfiguration();
      });
      undoCount += 1;
      if (undoCount > 110) break;
    }
    expect(undoCount).toBe(100);
    expect(result.current.project.canUndo).toBe(false);
    expect(result.current.project.currentProject!.document!.motion).toBe(motionRoot);
    expect(result.current.project.currentProject!.document!.rules).toBe(rulesRoot);
  });

  it("invokes real history from TopBar undo after a setup edit", async () => {
    type HostApi = {
      project: ReturnType<typeof useProject>;
      store: ReturnType<typeof useProjectStore>;
    };
    let hostApi: HostApi | null = null;

    const Host = () => {
      const project = useProject();
      const store = useProjectStore();
      useEffect(() => {
        hostApi = { project, store };
      });
      if (!project.currentProject?.document) return null;
      return createElement(TopBar, { onStop: () => undefined });
    };

    render(createElement(wrapper, null, createElement(Host)));

    await waitFor(() => expect(hostApi?.project.loading).toBe(false));
    await act(async () => {
      await hostApi!.project.openProject(GZ_2025_RECORD.folderName);
    });
    await waitFor(() => {
      expect(hostApi?.project.currentProject?.document).toBeTruthy();
    });

    const beforeCount = hostApi!.store.objects.length;
    act(() => {
      hostApi!.store.addObjectFromShape("cube");
    });
    expect(hostApi!.project.canUndo).toBe(true);
    expect(hostApi!.store.objects).toHaveLength(beforeCount + 1);

    fireEvent.click(screen.getByRole("button", { name: "打开应用菜单" }));
    const undoButton = await screen.findByRole("button", {
      name: /^撤销/,
    });
    expect((undoButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(undoButton);

    await waitFor(() => {
      expect(hostApi!.store.objects).toHaveLength(beforeCount);
      expect(hostApi!.project.canUndo).toBe(false);
      expect(hostApi!.project.canRedo).toBe(true);
    });
    expectNoHardwareSideEffects();
  });

  it("replays model csocket diffs on undo/redo but not on project open", async () => {
    const { result } = renderIntegration();
    await openFixture(result);
    await flushCsocketMicrotasks();
    expectNoModelCsocketCalls();

    let objectId = 0;
    act(() => {
      const created = result.current.store.addObjectFromShape("cube");
      expect(created).toBeTruthy();
      expect(created!.controlType).toBe("singlePointMove");
      objectId = created!.id;
    });
    await flushCsocketMicrotasks();
    expect(addModelWithDefaultValues).toHaveBeenCalledTimes(1);
    expect(deleteModelPlc).not.toHaveBeenCalled();
    clearModelCsocketMocks();

    act(() => {
      result.current.project.undoProjectConfiguration();
    });
    await waitFor(() => {
      expect(result.current.store.findObject(objectId)).toBeUndefined();
    });
    await flushCsocketMicrotasks();
    expect(deleteModelPlc).toHaveBeenCalledTimes(1);
    expect(addModelWithDefaultValues).not.toHaveBeenCalled();
    expect(result.current.project.documentRevision.origin).toBe("history");
    clearModelCsocketMocks();

    act(() => {
      result.current.project.redoProjectConfiguration();
    });
    await waitFor(() => {
      expect(result.current.store.findObject(objectId)).toBeDefined();
    });
    await flushCsocketMicrotasks();
    expect(addModelWithDefaultValues).toHaveBeenCalledTimes(1);
    expect(deleteModelPlc).not.toHaveBeenCalled();
    expect(result.current.project.documentRevision.origin).toBe("history");
  });
});
