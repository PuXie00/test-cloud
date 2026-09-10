// @vitest-environment jsdom

import {
  act,
  cleanup,
  renderHook,
  waitFor,
  type RenderHookResult,
} from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEmptyDocument } from "./project-document-empty";
import { applyDocumentUpdate } from "./project-document-update";
import type { ProjectDocument } from "./project-document-types";
import {
  installMemoryProjectAPI,
  uninstallMemoryProjectAPI,
} from "./install-memory-project-api";
import { ProjectIpcError } from "./project-ipc";
import { ProjectProvider } from "./project-provider";
import type { ProjectRecord } from "./project-types";
import { createDefaultSavedView } from "./saved-view";
import { GZ_2025_RECORD, SH_BALLET_RECORD } from "./test-fixtures";
import { useProject } from "./use-project";
import type { ProjectAPI } from "@/types/electron";

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(ProjectProvider, null, children);

const renderProjectHook = () =>
  renderHook(() => useProject(), { wrapper });

const openFixtureProject = async (
  result: RenderHookResult<ReturnType<typeof useProject>, unknown>["result"],
) => {
  await waitFor(() => {
    expect(result.current.loading).toBe(false);
  });
  await act(async () => {
    await result.current.openProject(GZ_2025_RECORD.folderName);
  });
  await waitFor(() => {
    expect(result.current.currentProject?.document).toBeTruthy();
  });
};

const changeSetup = (document: ProjectDocument): ProjectDocument => ({
  ...document,
  setup: {
    ...document.setup,
    scene: {
      groups: [
        ...(document.setup.scene?.groups ?? []),
        { id: "group-test", name: "测试组", objectIds: [] },
      ],
    },
  },
});

const changeMotion = (document: ProjectDocument): ProjectDocument => ({
  ...document,
  motion: {
    ...document.motion,
    positionCues: [
      ...document.motion.positionCues,
      {
        id: "cue-boundary-test",
        name: "边界 Cue",
        targets: {},
      },
    ],
  },
});

const makeRecord = (id: string): ProjectRecord => {
  const doc = createEmptyDocument({ id, name: "测试工程", author: "tester" });
  return {
    id,
    folderName: "测试工程",
    name: "测试工程",
    modifiedAt: "2026-01-01 00:00",
    createdAt: "2026-01-01 00:00",
    version: "v0.1.0-draft",
    author: "tester",
    sizeMb: 0,
    deviceCount: 0,
    controlledObjectCount: 0,
    trussCount: 0,
    fixtureCount: 0,
    status: "draft",
    tags: [],
    recent: true,
    versionHistory: [],
    document: doc,
  };
};

describe("applyDocumentUpdate touchModifiedAt", () => {
  it("touches modifiedAt by default and skips when touchModifiedAt is false", () => {
    const projects = [makeRecord("p1")];
    const touched = applyDocumentUpdate(projects, "p1", (doc) => ({
      ...doc,
      setup: { ...doc.setup, scene: { groups: [] } },
    }));
    expect(touched.current?.modifiedAt).not.toBe("2026-01-01 00:00");
    expect(touched.current?.document?.meta.modifiedAt).toBeTruthy();

    const untouched = applyDocumentUpdate(
      projects,
      "p1",
      (doc) => ({
        ...doc,
        setup: { ...doc.setup, scene: { groups: [{ id: "g", name: "g", objectIds: [] }] } },
      }),
      { touchModifiedAt: false },
    );
    expect(untouched.current?.modifiedAt).toBe("2026-01-01 00:00");
    expect(untouched.current?.document?.meta.modifiedAt).toBe(
      projects[0].document!.meta.modifiedAt,
    );
  });
});

describe("ProjectProvider configuration history", () => {
  let api: ProjectAPI;

  beforeEach(() => {
    window.sessionStorage.clear();
    api = installMemoryProjectAPI();
    window.csocketApi = {
      openProject: async () => ({ ok: true as const, data: { success: true } }),
    } as Window["csocketApi"];
  });

  afterEach(() => {
    cleanup();
    uninstallMemoryProjectAPI();
  });

  it("tracks commit, undo, redo, branch, and dirty against the saved state", async () => {
    const { result } = renderProjectHook();
    await openFixtureProject(result);
    const originalSetup = result.current.currentProject!.document!.setup;

    act(() => {
      result.current.runTrackedDocumentUpdate("修改搭建", (document) => ({
        ...document,
        setup: {
          ...document.setup,
          scene: {
            groups: [
              ...(document.setup.scene?.groups ?? []),
              { id: "group-test", name: "测试组", objectIds: [] },
            ],
          },
        },
      }));
    });
    expect(result.current.canUndo).toBe(true);
    expect(result.current.undoLabel).toBe("修改搭建");
    expect(result.current.isDirty).toBe(true);

    act(() => {
      result.current.undoProjectConfiguration();
    });
    expect(result.current.currentProject!.document!.setup).toBe(originalSetup);
    expect(result.current.canRedo).toBe(true);
    expect(result.current.isDirty).toBe(false);

    act(() => {
      result.current.redoProjectConfiguration();
    });
    expect(result.current.isDirty).toBe(true);

    act(() => {
      result.current.undoProjectConfiguration();
      result.current.runTrackedDocumentUpdate("分支提交", changeSetup);
    });
    expect(result.current.canRedo).toBe(false);
    expect(result.current.undoLabel).toBe("分支提交");
  });

  it("groups previews into one owner transaction and cancels back to before", async () => {
    const { result } = renderProjectHook();
    await openFixtureProject(result);
    const before = result.current.currentProject!.document!.setup;

    act(() => {
      expect(result.current.beginTrackedEdit("field:x", "修改 X")).toBe(true);
      for (const x of [10, 20, 30]) {
        result.current.runTrackedDocumentUpdate("修改 X", (document) => ({
          ...document,
          setup: {
            ...document.setup,
            scene: {
              groups: [{ id: "preview", name: `预览 ${x}`, objectIds: [] }],
            },
          },
        }));
      }
      result.current.commitTrackedEdit("field:x");
    });
    expect(result.current.undoLabel).toBe("修改 X");
    const afterCommit = result.current.currentProject!.document!.setup;

    act(() => {
      result.current.beginTrackedEdit("field:x", "修改 X");
      result.current.runTrackedDocumentUpdate("修改 X", (document) => ({
        ...document,
        setup: {
          ...document.setup,
          scene: { groups: [{ id: "cancelled", name: "取消", objectIds: [] }] },
        },
      }));
      result.current.cancelTrackedEdit("field:x");
    });
    expect(result.current.currentProject!.document!.setup).not.toBe(before);
    expect(result.current.currentProject!.document!.setup).toBe(afterCommit);
  });

  it("creates a non-tracked motion boundary that undo cannot cross", async () => {
    const { result } = renderProjectHook();
    await openFixtureProject(result);
    act(() => {
      result.current.runTrackedDocumentUpdate("修改搭建", changeSetup);
      result.current.updateCurrentDocument(changeMotion, "motion");
    });
    expect(result.current.canUndo).toBe(false);
  });

  it("keeps history after save and restores dirty around the saved state", async () => {
    const { result } = renderProjectHook();
    await openFixtureProject(result);

    act(() => {
      result.current.runTrackedDocumentUpdate("修改搭建", changeSetup);
    });
    expect(result.current.isDirty).toBe(true);

    await act(async () => {
      await result.current.saveCurrentProject();
    });
    expect(result.current.isDirty).toBe(false);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.undoLabel).toBe("修改搭建");

    act(() => {
      result.current.undoProjectConfiguration();
    });
    expect(result.current.isDirty).toBe(true);

    act(() => {
      result.current.redoProjectConfiguration();
    });
    expect(result.current.isDirty).toBe(false);
  });

  it("stays dirty when a newer configuration state is created during save", async () => {
    let releaseSave: (() => void) | null = null;
    const originalSave = api.save.bind(api);
    api.save = async (params) => {
      await new Promise<void>((resolve) => {
        releaseSave = resolve;
      });
      return originalSave(params);
    };

    const { result } = renderProjectHook();
    await openFixtureProject(result);

    act(() => {
      result.current.runTrackedDocumentUpdate("保存前修改", changeSetup);
    });
    const midSaveSetupName = "保存中预览";

    let savePromise: Promise<void>;
    await act(async () => {
      savePromise = result.current.saveCurrentProject();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(releaseSave).toBeTruthy();
    });

    act(() => {
      result.current.runTrackedDocumentUpdate("保存中修改", (document) => ({
        ...document,
        setup: {
          ...document.setup,
          scene: {
            groups: [{ id: "during-save", name: midSaveSetupName, objectIds: [] }],
          },
        },
      }));
    });
    const duringSaveSetup = result.current.currentProject!.document!.setup;

    await act(async () => {
      releaseSave?.();
      await savePromise!;
    });

    expect(result.current.isDirty).toBe(true);
    expect(result.current.currentProject!.document!.setup).toBe(duringSaveSetup);
    expect(
      result.current.currentProject!.document!.setup.scene?.groups?.[0]?.name,
    ).toBe(midSaveSetupName);
  });

  it("merges captured save view into the latest configuration roots after concurrent edits", async () => {
    let releaseSave: (() => void) | null = null;
    const originalSave = api.save.bind(api);
    api.save = async (params) => {
      await new Promise<void>((resolve) => {
        releaseSave = resolve;
      });
      return originalSave(params);
    };

    const { result } = renderProjectHook();
    await openFixtureProject(result);
    const openedView = result.current.currentProject!.document!.view;
    const savedView = {
      ...createDefaultSavedView(),
      alpha: 1.23,
      preset: "top" as const,
    };

    act(() => {
      result.current.runTrackedDocumentUpdate("保存前修改", changeSetup);
    });

    let savePromise: Promise<void>;
    await act(async () => {
      savePromise = result.current.saveCurrentProject({ view: savedView });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(releaseSave).toBeTruthy();
    });

    act(() => {
      result.current.runTrackedDocumentUpdate("保存中修改", (document) => ({
        ...document,
        setup: {
          ...document.setup,
          scene: {
            groups: [{ id: "during-save-view", name: "保留最新搭建", objectIds: [] }],
          },
        },
      }));
    });
    const latestSetup = result.current.currentProject!.document!.setup;
    const latestMotion = result.current.currentProject!.document!.motion;
    const latestRules = result.current.currentProject!.document!.rules;

    await act(async () => {
      releaseSave?.();
      await savePromise!;
    });

    const doc = result.current.currentProject!.document!;
    expect(doc.setup).toBe(latestSetup);
    expect(doc.motion).toBe(latestMotion);
    expect(doc.rules).toBe(latestRules);
    expect(doc.view).toBe(savedView);
    expect(doc.view).not.toBe(openedView);
    expect(doc.view.alpha).toBe(1.23);
  });

  it("rejects save while a tracked edit transaction is active", async () => {
    const { result } = renderProjectHook();
    await openFixtureProject(result);

    act(() => {
      expect(result.current.beginTrackedEdit("field:x", "编辑中")).toBe(true);
      result.current.runTrackedDocumentUpdate("编辑中", changeSetup);
    });

    let error: unknown;
    await act(async () => {
      try {
        await result.current.saveCurrentProject();
      } catch (err) {
        error = err;
      }
    });
    expect(error).toBeInstanceOf(ProjectIpcError);
    expect((error as ProjectIpcError).message).toMatch(/事务|编辑/);
    expect(result.current.currentProject!.document!.setup.scene?.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "group-test" }),
      ]),
    );
    expect(result.current.canUndo).toBe(false);
  });

  it("rejects saveProjectAs during active transaction or version restore without calling API", async () => {
    const { result } = renderProjectHook();
    await openFixtureProject(result);
    const sourceFolder = result.current.currentProject!.folderName;
    const sourceId = result.current.currentProject!.id;

    let saveCalls = 0;
    let saveAsCalls = 0;
    const originalSave = api.save.bind(api);
    const originalSaveAs = api.saveAs.bind(api);
    api.save = async (params) => {
      saveCalls += 1;
      return originalSave(params);
    };
    api.saveAs = async (params) => {
      saveAsCalls += 1;
      return originalSaveAs(params);
    };

    act(() => {
      expect(result.current.beginTrackedEdit("field:as", "另存编辑中")).toBe(true);
      result.current.runTrackedDocumentUpdate("另存编辑中", changeSetup);
    });

    let txnError: unknown;
    await act(async () => {
      try {
        await result.current.saveProjectAs("另存预览工程");
      } catch (err) {
        txnError = err;
      }
    });
    expect(txnError).toBeInstanceOf(ProjectIpcError);
    expect((txnError as ProjectIpcError).code).toBe("EDIT_IN_PROGRESS");
    expect(saveCalls).toBe(0);
    expect(saveAsCalls).toBe(0);
    expect(result.current.currentProject!.folderName).toBe(sourceFolder);
    expect(result.current.currentProject!.id).toBe(sourceId);

    act(() => {
      result.current.cancelTrackedEdit("field:as");
    });

    const restorePayload = structuredClone(
      result.current.currentProject!.document!,
    );
    let releaseRestore: (() => void) | null = null;
    api.restoreHistory = async () => {
      await new Promise<void>((resolve) => {
        releaseRestore = resolve;
      });
      return {
        ok: true as const,
        data: structuredClone(restorePayload),
      };
    };

    let restorePromise: Promise<void>;
    await act(async () => {
      restorePromise = result.current.restoreVersion("hist-save-as");
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(releaseRestore).toBeTruthy();
    });

    let restoreError: unknown;
    await act(async () => {
      try {
        await result.current.saveProjectAs("恢复中另存");
      } catch (err) {
        restoreError = err;
      }
    });
    expect(restoreError).toBeInstanceOf(ProjectIpcError);
    expect((restoreError as ProjectIpcError).code).toBe("RESTORE_IN_PROGRESS");
    expect(saveCalls).toBe(0);
    expect(saveAsCalls).toBe(0);
    expect(result.current.currentProject!.folderName).toBe(sourceFolder);

    await act(async () => {
      releaseRestore?.();
      await restorePromise!;
    });
  });

  it("rejects save and configuration mutations while restoring a version", async () => {
    const { result } = renderProjectHook();
    await openFixtureProject(result);
    const beforeSetup = result.current.currentProject!.document!.setup;
    const beforeRevision = result.current.documentRevision.value;
    const restorePayload = structuredClone(
      result.current.currentProject!.document!,
    );

    let releaseRestore: (() => void) | null = null;
    api.restoreHistory = async () => {
      await new Promise<void>((resolve) => {
        releaseRestore = resolve;
      });
      return {
        ok: true as const,
        data: structuredClone(restorePayload),
      };
    };

    let restorePromise: Promise<void>;
    await act(async () => {
      restorePromise = result.current.restoreVersion("hist-busy");
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(releaseRestore).toBeTruthy();
    });

    let saveError: unknown;
    await act(async () => {
      try {
        await result.current.saveCurrentProject();
      } catch (err) {
        saveError = err;
      }
    });
    expect(saveError).toBeInstanceOf(ProjectIpcError);
    expect((saveError as ProjectIpcError).message).toMatch(/恢复/);

    let tracked: ReturnType<typeof result.current.runTrackedDocumentUpdate>;
    let boundary: ReturnType<typeof result.current.updateCurrentDocument>;
    let began = true;
    act(() => {
      tracked = result.current.runTrackedDocumentUpdate("恢复中修改", changeSetup);
      boundary = result.current.updateCurrentDocument(changeMotion);
      began = result.current.beginTrackedEdit("field:busy", "恢复中");
    });
    expect(tracked!.ok).toBe(false);
    if (!tracked!.ok) expect(tracked!.reason).toMatch(/恢复/);
    expect(boundary!.ok).toBe(false);
    if (!boundary!.ok) expect(boundary!.reason).toMatch(/恢复/);
    expect(began).toBe(false);
    expect(result.current.currentProject!.document!.setup).toBe(beforeSetup);
    expect(result.current.documentRevision.value).toBe(beforeRevision);

    await act(async () => {
      releaseRestore?.();
      await restorePromise!;
    });
  });

  it("rejects project-command during an active tracked transaction", async () => {
    const { result } = renderProjectHook();
    await openFixtureProject(result);
    const beforeSetup = result.current.currentProject!.document!.setup;
    const beforeRevision = result.current.documentRevision.value;

    let rejected: ReturnType<typeof result.current.runTrackedDocumentUpdate>;
    act(() => {
      expect(result.current.beginTrackedEdit("field:x", "修改 X")).toBe(true);
      rejected = result.current.runTrackedDocumentUpdate(
        "删除物体",
        changeSetup,
        "project-command",
      );
    });
    expect(rejected!.ok).toBe(false);
    if (!rejected!.ok) {
      expect(rejected!.reason).toMatch(/事务|project-command|命令/);
    }
    expect(result.current.currentProject!.document!.setup).toBe(beforeSetup);
    expect(result.current.documentRevision.value).toBe(beforeRevision);

    act(() => {
      result.current.cancelTrackedEdit("field:x");
    });
    expect(result.current.currentProject!.document!.setup).toBe(beforeSetup);
    expect(result.current.canUndo).toBe(false);

    // Ordinary setup preview inside a transaction remains allowed.
    act(() => {
      expect(result.current.beginTrackedEdit("field:x", "修改 X")).toBe(true);
      result.current.runTrackedDocumentUpdate("修改 X", (document) => ({
        ...document,
        setup: {
          ...document.setup,
          scene: {
            groups: [{ id: "setup-origin", name: "输入", objectIds: [] }],
          },
        },
      }));
      result.current.commitTrackedEdit("field:x");
    });
    expect(result.current.documentRevision.origin).toBe("setup");
    expect(result.current.canUndo).toBe(true);

    // Discrete project-command outside a transaction still commits.
    act(() => {
      result.current.runTrackedDocumentUpdate("删除物体", changeSetup, "project-command");
    });
    expect(result.current.documentRevision.origin).toBe("project-command");
  });

  it("rejects updateCurrentDocument changes outside the motion root", async () => {
    const { result } = renderProjectHook();
    await openFixtureProject(result);
    const beforeDoc = result.current.currentProject!.document!;
    const beforeRevision = result.current.documentRevision.value;

    let setupResult: ReturnType<typeof result.current.updateCurrentDocument>;
    act(() => {
      setupResult = result.current.updateCurrentDocument((document) => ({
        ...document,
        setup: changeSetup(document).setup,
      }));
    });
    expect(setupResult!.ok).toBe(false);
    expect(result.current.currentProject!.document!.setup).toBe(beforeDoc.setup);
    expect(result.current.documentRevision.value).toBe(beforeRevision);
    expect(result.current.canUndo).toBe(false);

    act(() => {
      setupResult = result.current.updateCurrentDocument((document) => ({
        ...document,
        meta: { ...document.meta, name: "被拒绝" },
        motion: changeMotion(document).motion,
      }));
    });
    expect(setupResult!.ok).toBe(false);
    expect(result.current.currentProject!.document!.meta.name).toBe(beforeDoc.meta.name);
    expect(result.current.currentProject!.document!.motion).toBe(beforeDoc.motion);

    act(() => {
      setupResult = result.current.updateCurrentDocument((document) => ({
        ...document,
        rules: { ...document.rules },
        motion: changeMotion(document).motion,
      }));
    });
    expect(setupResult!.ok).toBe(false);
    expect(result.current.currentProject!.document!.motion).toBe(beforeDoc.motion);
  });

  it("validates updateCurrentDocument before resetting history", async () => {
    const { result } = renderProjectHook();
    await openFixtureProject(result);

    act(() => {
      result.current.runTrackedDocumentUpdate("修改搭建", changeSetup);
    });
    expect(result.current.canUndo).toBe(true);
    const beforeMotion = result.current.currentProject!.document!.motion;
    const beforeSetup = result.current.currentProject!.document!.setup;
    const beforeRevision = result.current.documentRevision.value;

    let invalid: ReturnType<typeof result.current.updateCurrentDocument>;
    act(() => {
      invalid = result.current.updateCurrentDocument((document) => ({
        ...document,
        motion: {
          ...document.motion,
          positionCues: [
            ...document.motion.positionCues,
            {
              id: "cue-invalid",
              name: "无效 Cue",
              targets: { "missing-object": { x: 1 } },
            },
          ],
        },
      }));
    });
    expect(invalid!.ok).toBe(false);
    expect(result.current.currentProject!.document!.motion).toBe(beforeMotion);
    expect(result.current.currentProject!.document!.setup).toBe(beforeSetup);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.undoLabel).toBe("修改搭建");
    expect(result.current.documentRevision.value).toBe(beforeRevision);
  });

  it("discards stale openProject responses when a newer open wins", async () => {
    let releaseGz: (() => void) | null = null;
    const originalOpen = api.open.bind(api);
    api.open = async (params) => {
      if (params.name === GZ_2025_RECORD.folderName) {
        await new Promise<void>((resolve) => {
          releaseGz = resolve;
        });
      }
      return originalOpen(params);
    };

    const { result } = renderProjectHook();
    await waitFor(() => expect(result.current.loading).toBe(false));

    let staleOpen!: Promise<void>;
    let latestOpen!: Promise<void>;
    await act(async () => {
      staleOpen = result.current.openProject(GZ_2025_RECORD.folderName);
      await Promise.resolve();
      latestOpen = result.current.openProject(SH_BALLET_RECORD.folderName);
      await latestOpen;
    });

    act(() => {
      result.current.runTrackedDocumentUpdate("芭蕾修改", changeSetup);
    });
    expect(result.current.currentProject?.folderName).toBe(SH_BALLET_RECORD.folderName);
    expect(result.current.canUndo).toBe(true);
    const balletRevision = result.current.documentRevision.value;
    const balletSetup = result.current.currentProject!.document!.setup;

    await act(async () => {
      releaseGz?.();
      await staleOpen;
    });

    expect(result.current.currentProject?.folderName).toBe(SH_BALLET_RECORD.folderName);
    expect(result.current.currentProject!.document!.setup).toBe(balletSetup);
    expect(result.current.documentRevision.value).toBe(balletRevision);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.undoLabel).toBe("芭蕾修改");
  });

  it("rejects tracked updates that mutate meta, view, or snapshots", async () => {
    const { result } = renderProjectHook();
    await openFixtureProject(result);
    const beforeDoc = result.current.currentProject!.document!;
    const beforeSetup = beforeDoc.setup;
    const beforeRevision = result.current.documentRevision.value;

    let metaResult: ReturnType<typeof result.current.runTrackedDocumentUpdate>;
    act(() => {
      metaResult = result.current.runTrackedDocumentUpdate("改 meta", (document) => ({
        ...document,
        meta: { ...document.meta, name: "被拒绝" },
        setup: {
          ...document.setup,
          scene: { groups: [{ id: "x", name: "x", objectIds: [] }] },
        },
      }));
    });
    expect(metaResult!.ok).toBe(false);
    expect(result.current.currentProject!.document!.setup).toBe(beforeSetup);
    expect(result.current.currentProject!.document!.meta.name).toBe(beforeDoc.meta.name);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.documentRevision.value).toBe(beforeRevision);

    act(() => {
      metaResult = result.current.runTrackedDocumentUpdate("改 view", (document) => ({
        ...document,
        view: { ...document.view },
        setup: changeSetup(document).setup,
      }));
    });
    expect(metaResult!.ok).toBe(false);
    expect(result.current.canUndo).toBe(false);

    act(() => {
      metaResult = result.current.runTrackedDocumentUpdate("改 snapshots", (document) => ({
        ...document,
        snapshots: [...document.snapshots],
        setup: changeSetup(document).setup,
      }));
    });
    expect(metaResult!.ok).toBe(false);
    expect(result.current.currentProject!.document!.setup).toBe(beforeSetup);
    expect(result.current.canUndo).toBe(false);
  });

  it("treats updateCurrentDocument without origin as a non-tracked boundary", async () => {
    const { result } = renderProjectHook();
    await openFixtureProject(result);
    act(() => {
      result.current.runTrackedDocumentUpdate("修改搭建", changeSetup);
      result.current.updateCurrentDocument(changeMotion);
    });
    expect(result.current.canUndo).toBe(false);
    expect(result.current.documentRevision.origin).toBe("motion");
  });

  it("does not touch meta on transaction preview, cancel, undo, or redo", async () => {
    const { result } = renderProjectHook();
    await openFixtureProject(result);
    const openedMeta = result.current.currentProject!.document!.meta;

    act(() => {
      expect(result.current.beginTrackedEdit("field:y", "预览 Y")).toBe(true);
      result.current.runTrackedDocumentUpdate("预览 Y", (document) => ({
        ...document,
        setup: {
          ...document.setup,
          scene: { groups: [{ id: "y", name: "y1", objectIds: [] }] },
        },
      }));
    });
    expect(result.current.currentProject!.document!.meta).toBe(openedMeta);

    act(() => {
      result.current.cancelTrackedEdit("field:y");
    });
    expect(result.current.currentProject!.document!.meta).toBe(openedMeta);

    act(() => {
      result.current.runTrackedDocumentUpdate("正式修改", changeSetup);
    });
    const afterCommitMeta = result.current.currentProject!.document!.meta;
    expect(afterCommitMeta).not.toBe(openedMeta);
    expect(afterCommitMeta.modifiedAt).not.toBe(openedMeta.modifiedAt);

    act(() => {
      result.current.undoProjectConfiguration();
    });
    expect(result.current.currentProject!.document!.meta).toBe(afterCommitMeta);

    act(() => {
      result.current.redoProjectConfiguration();
    });
    expect(result.current.currentProject!.document!.meta).toBe(afterCommitMeta);
  });
});
