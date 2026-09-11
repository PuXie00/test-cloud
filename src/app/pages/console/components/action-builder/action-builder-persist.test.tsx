// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { ProjectProvider } from "@/app/project/project-provider";
import {
  installMemoryProjectAPI,
  uninstallMemoryProjectAPI,
} from "@/app/project/install-memory-project-api";
import { GZ_2025_RECORD } from "@/app/project/test-fixtures";
import { ActionBuilderProvider } from "./action-builder-context";
import { useActionBuilder } from "./use-action-builder";
import { ProgramProvider, useProgram } from "@/app/pages/console/hooks/use-program";
import { ProjectStoreProvider, useProjectStore } from "@/app/pages/console/hooks/use-project-store";
import { useProject } from "@/app/project/use-project";

const referencedObjectId = "7";
const referencedObjectNumericId = 7;

const stubCsocketOpenProject = () => {
  const ok = async () => ({ ok: true as const, data: { success: true as const } });
  window.csocketApi = {
    openProject: ok,
    addModelWithDefaultValues: ok,
    modifyModelType: ok,
    configureModelParamModel: ok,
    deleteModelPlc: ok,
  } as unknown as Window["csocketApi"];
};

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(
    ProjectProvider,
    null,
    createElement(
      ProjectStoreProvider,
      null,
      createElement(
        ProgramProvider,
        null,
        createElement(ActionBuilderProvider, null, children),
      ),
    ),
  );

const renderBuilderProjectAndStore = () =>
  renderHook(
    () => ({
      builder: useActionBuilder(),
      program: useProgram(),
      store: useProjectStore(),
      project: useProject(),
    }),
    { wrapper },
  );

const openFixtureProject = async (
  result: ReturnType<typeof renderBuilderProjectAndStore>["result"],
) => {
  await waitFor(() => expect(result.current.project.loading).toBe(false));
  await act(async () => {
    await result.current.project.openProject(GZ_2025_RECORD.folderName);
  });
  await waitFor(() => {
    expect(result.current.project.currentProject?.document).toBeTruthy();
  });
};

describe("ActionBuilderProvider / ProgramProvider document persist", () => {
  beforeEach(() => {
    installMemoryProjectAPI();
    stubCsocketOpenProject();
  });

  afterEach(() => {
    uninstallMemoryProjectAPI();
    delete window.csocketApi;
  });

  it("handleCreateCue appends to document.motion.positionCues", async () => {
    const { result } = renderBuilderProjectAndStore();
    await openFixtureProject(result);

    const firstObjectId =
      result.current.project.currentProject?.document?.setup.controlledObjects[0]?.id;
    expect(firstObjectId).toBeTruthy();

    const before =
      result.current.project.currentProject?.document?.motion.positionCues.length ?? 0;

    act(() => {
      result.current.builder.handleCreateCue([firstObjectId!]);
    });

    const after =
      result.current.project.currentProject?.document?.motion.positionCues.length ?? 0;
    expect(after).toBe(before + 1);
  });

  it("supports adding and removing objects from an empty Cue", async () => {
    const { result } = renderBuilderProjectAndStore();
    await openFixtureProject(result);
    const objectId =
      result.current.project.currentProject?.document?.setup.controlledObjects[0]?.id;
    expect(objectId).toBeTruthy();

    act(() => result.current.builder.handleCreateCue([]));
    const cueId = result.current.builder.selectedCueId;
    expect(cueId).toBeTruthy();

    act(() => result.current.builder.handleCueAddObjects(cueId!, [objectId!]));
    expect(result.current.builder.cues.find((cue) => cue.id === cueId)?.targets[objectId!]).toBeDefined();

    act(() => result.current.builder.handleCueRemoveObject(cueId!, objectId!));
    expect(result.current.builder.cues.find((cue) => cue.id === cueId)?.targets[objectId!]).toBeUndefined();
  });

  it("clears setup history after an independent cue edit", async () => {
    const { result } = renderBuilderProjectAndStore();
    await openFixtureProject(result);
    act(() => result.current.store.addObjectFromShape("cube"));
    expect(result.current.project.canUndo).toBe(true);
    act(() => result.current.builder.handleCreateCue([]));
    expect(result.current.project.canUndo).toBe(false);
  });

  it("clears setup history after a program edit", async () => {
    const { result } = renderBuilderProjectAndStore();
    await openFixtureProject(result);
    act(() => result.current.store.addObjectFromShape("cube"));
    expect(result.current.project.canUndo).toBe(true);
    const chapterId = result.current.program.program.chapters[0]!.id;
    act(() => result.current.program.renameChapter(chapterId, "边界章节"));
    expect(result.current.project.canUndo).toBe(false);
    expect(result.current.project.documentRevision.origin).toBe("program");
  });

  it("does not reset ActionBuilder local interaction on own-origin motion persist", async () => {
    const { result } = renderBuilderProjectAndStore();
    await openFixtureProject(result);
    act(() => {
      result.current.builder.handleCueSelect("cue-lift");
      result.current.builder.handleCombineStart("cue-lift");
    });
    act(() => {
      result.current.builder.handleCueUpdate("cue-open", { name: "开场位置-改" });
    });
    expect(result.current.builder.selectedCueId).toBe("cue-lift");
    expect(result.current.builder.combineFromCueId).toBe("cue-lift");
    expect(result.current.builder.cues.find((cue) => cue.id === "cue-open")?.name).toBe(
      "开场位置-改",
    );
  });

  it("does not reset Program chapter selection on own-origin program persist", async () => {
    const { result } = renderBuilderProjectAndStore();
    await openFixtureProject(result);
    act(() => result.current.program.setCurrentChapter("ch-02"));
    act(() => result.current.program.renameChapter("ch-02", "高潮改"));
    expect(result.current.program.currentChapterId).toBe("ch-02");
    expect(result.current.program.program.chapters.find((ch) => ch.id === "ch-02")?.name).toBe(
      "高潮改",
    );
  });

  it("rehydrates ActionBuilder when Program writes motion with program origin", async () => {
    const { result } = renderBuilderProjectAndStore();
    await openFixtureProject(result);
    const before = result.current.builder.sequences.length;
    const chapterId = result.current.program.program.chapters[0]!.id;
    act(() => result.current.program.addSequence(chapterId));
    expect(result.current.project.documentRevision.origin).toBe("program");
    expect(result.current.builder.sequences.length).toBe(before + 1);
    const motionAfter = result.current.project.currentProject!.document!.motion;
    const revisionAfter = result.current.project.documentRevision.value;
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.project.currentProject!.document!.motion).toBe(motionAfter);
    expect(result.current.project.documentRevision.value).toBe(revisionAfter);
    expect(result.current.project.documentRevision.origin).toBe("program");
  });

  it("rehydrates Program when ActionBuilder writes motion with motion origin", async () => {
    const { result } = renderBuilderProjectAndStore();
    await openFixtureProject(result);
    act(() => {
      result.current.builder.handleCueUpdate("cue-open", { name: "动作侧改名" });
    });
    expect(result.current.project.documentRevision.origin).toBe("motion");
    expect(result.current.builder.cues.find((cue) => cue.id === "cue-open")?.name).toBe(
      "动作侧改名",
    );
    const motionAfter = result.current.project.currentProject!.document!.motion;
    const revisionAfter = result.current.project.documentRevision.value;
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.project.currentProject!.document!.motion).toBe(motionAfter);
    expect(result.current.project.documentRevision.value).toBe(revisionAfter);
    expect(result.current.project.documentRevision.origin).toBe("motion");
  });

  it("refreshes timelineObjects on setup add/rename/delete without rewriting motion", async () => {
    const { result } = renderBuilderProjectAndStore();
    await openFixtureProject(result);

    act(() => {
      result.current.builder.handleCueSelect("cue-lift");
      result.current.builder.handleCombineStart("cue-lift");
      result.current.builder.handleObjectSelect(referencedObjectNumericId);
    });

    const motionBeforeAdd = result.current.project.currentProject!.document!.motion;
    const revisionBeforeAdd = result.current.project.documentRevision.value;
    act(() => result.current.store.addObjectFromShape("cube"));
    expect(result.current.project.documentRevision.origin).toBe("setup");
    expect(result.current.project.currentProject!.document!.motion).toBe(motionBeforeAdd);
    expect(result.current.project.documentRevision.value).toBeGreaterThan(revisionBeforeAdd);
    const addedId = result.current.store.objects.at(-1)!.id;
    expect(result.current.builder.timelineObjects.some((object) => object.id === addedId)).toBe(
      true,
    );
    expect(result.current.builder.selectedCueId).toBe("cue-lift");
    expect(result.current.builder.combineFromCueId).toBe("cue-lift");

    const motionBeforeRename = result.current.project.currentProject!.document!.motion;
    const revisionBeforeRename = result.current.project.documentRevision.value;
    act(() => result.current.store.updateObject(referencedObjectNumericId, { name: "升降灯架-改名" }));
    expect(result.current.project.documentRevision.origin).toBe("setup");
    expect(result.current.project.currentProject!.document!.motion).toBe(motionBeforeRename);
    expect(result.current.project.documentRevision.value).toBeGreaterThan(revisionBeforeRename);
    expect(
      result.current.builder.timelineObjects.find((object) => object.id === referencedObjectNumericId)
        ?.name,
    ).toBe("升降灯架-改名");
    expect(result.current.builder.selectedCueId).toBe("cue-lift");
    expect(result.current.builder.combineFromCueId).toBe("cue-lift");

    act(() => result.current.builder.handleObjectsSelect([referencedObjectNumericId, addedId]));
    const revisionBeforeDelete = result.current.project.documentRevision.value;
    act(() => result.current.store.removeObject(addedId));
    expect(result.current.project.documentRevision.origin).toBe("project-command");
    expect(result.current.project.documentRevision.value).toBeGreaterThan(revisionBeforeDelete);
    expect(result.current.builder.timelineObjects.some((object) => object.id === addedId)).toBe(
      false,
    );
    expect(result.current.builder.selectedObjectIds).toEqual([referencedObjectNumericId]);
    expect(result.current.builder.selectedCueId).toBe("cue-lift");
    expect(result.current.builder.combineFromCueId).toBe("cue-lift");

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.project.documentRevision.value).toBeGreaterThan(revisionBeforeDelete);
    expect(result.current.project.documentRevision.origin).toBe("project-command");
  });

  it("rehydrates cues after project-command, undo, and redo without persisting back", async () => {
    const { result } = renderBuilderProjectAndStore();
    await openFixtureProject(result);
    const cueId = result.current.builder.cues[0]!.id;
    act(() => {
      result.current.project.runTrackedDocumentUpdate(
        "模拟跨域命令",
        (document) => ({
          ...document,
          motion: {
            ...document.motion,
            positionCues: document.motion.positionCues.map((cue) => ({
              ...cue,
              targets: Object.fromEntries(
                Object.entries(cue.targets).filter(
                  ([objectId]) => objectId !== referencedObjectId,
                ),
              ),
            })),
          },
        }),
        "project-command",
      );
    });
    const afterCommandMotion =
      result.current.project.currentProject!.document!.motion;
    expect(result.current.builder.cues.find((cue) => cue.id === cueId)!.targets).not.toHaveProperty(
      referencedObjectId,
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.project.currentProject!.document!.motion).toBe(afterCommandMotion);

    act(() => result.current.project.undoProjectConfiguration());
    expect(result.current.builder.cues.find((cue) => cue.id === cueId)!.targets).toHaveProperty(
      referencedObjectId,
    );

    act(() => result.current.project.redoProjectConfiguration());
    expect(result.current.builder.cues.find((cue) => cue.id === cueId)!.targets).not.toHaveProperty(
      referencedObjectId,
    );
  });

  it("rehydrates Program chapter refs after same-length project-command motion change", async () => {
    const { result } = renderBuilderProjectAndStore();
    await openFixtureProject(result);
    act(() => {
      result.current.project.runTrackedDocumentUpdate(
        "同长度改名",
        (document) => ({
          ...document,
          motion: {
            ...document.motion,
            positionCues: document.motion.positionCues.map((cue) =>
              cue.id === "cue-open" ? { ...cue, name: "开场-同长" } : cue,
            ),
            programs: document.motion.programs.map((program) => ({
              ...program,
              chapters: program.chapters.map((chapter) =>
                chapter.id === "ch-01" ? { ...chapter, name: "第一章-同长" } : chapter,
              ),
            })),
          },
        }),
        "project-command",
      );
    });
    expect(result.current.builder.cues.find((cue) => cue.id === "cue-open")?.name).toBe(
      "开场-同长",
    );
    expect(result.current.program.program.chapters.find((ch) => ch.id === "ch-01")?.name).toBe(
      "第一章-同长",
    );
  });

  it("keeps local projection unchanged when non-tracked persist is rejected", async () => {
    const { result } = renderBuilderProjectAndStore();
    await openFixtureProject(result);
    const cueCount = result.current.builder.cues.length;
    const chapterName = result.current.program.program.chapters[0]!.name;

    act(() => {
      result.current.project.beginTrackedEdit("field:x", "修改 X");
    });

    act(() => {
      result.current.builder.handleCreateCue([]);
    });
    expect(result.current.builder.cues.length).toBe(cueCount);
    expect(result.current.builder.lastPersistError).toMatch(/活动事务/);

    act(() => {
      result.current.program.renameChapter("ch-01", "不应落地");
    });
    expect(result.current.program.program.chapters[0]!.name).toBe(chapterName);
    expect(result.current.program.lastPersistError).toMatch(/活动事务/);
  });

  it("Program addSequence persists ActionSequenceConfig and a program ref", async () => {
    const { result } = renderBuilderProjectAndStore();
    await openFixtureProject(result);
    const chapterId = result.current.program.program.chapters[0]!.id;
    const beforeIds = new Set(
      result.current.project.currentProject!.document!.motion.actionSequences.map(
        (sequence) => sequence.id,
      ),
    );

    act(() => {
      result.current.program.addSequence(chapterId);
    });

    expect(result.current.program.lastPersistError).toBeNull();
    const document = result.current.project.currentProject!.document!;
    const created = document.motion.actionSequences.find(
      (sequence) => !beforeIds.has(sequence.id),
    );
    expect(created).toMatchObject({
      name: "新建动作序列",
      trajectoryMode: "non-forced",
      blocks: [],
      segments: [],
    });
    expect(created).not.toHaveProperty("initialPoses");
    expect(created?.id).toEqual(expect.any(Number));
    const programItem = result.current.program.program.chapters
      .find((chapter) => chapter.id === chapterId)
      ?.items.find(
        (item) => item.kind === "sequence" && item.sequence.id === created!.id,
      );
    expect(programItem).toMatchObject({
      kind: "sequence",
      sequence: { id: created!.id, name: "新建动作序列" },
    });
    expect(
      document.motion.programs.some((program) =>
        program.chapters.some((chapter) =>
          chapter.items.some(
            (item) => item.kind === "sequence" && item.refId === created!.id,
          ),
        ),
      ),
    ).toBe(true);
  });
});
