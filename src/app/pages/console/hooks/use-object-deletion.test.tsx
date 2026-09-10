// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { useEffect, createElement, type ReactNode } from "react";
import { ProjectProvider } from "@/app/project/project-provider";
import {
  installMemoryProjectAPI,
  uninstallMemoryProjectAPI,
} from "@/app/project/install-memory-project-api";
import { GZ_2025_RECORD } from "@/app/project/test-fixtures";
import { ActionBuilderProvider } from "@/app/pages/console/components/action-builder/action-builder-context";
import { DeleteImpactDialog } from "@/app/pages/console/components/right-sidebar/delete-impact-dialog";
import { ProgramProvider } from "@/app/pages/console/hooks/use-program";
import { ProjectStoreProvider, useProjectStore } from "@/app/pages/console/hooks/use-project-store";
import { useProject } from "@/app/project/use-project";
import type { ObjectDeletionImpact } from "@/app/project/project-object-deletion";
import { formatObjectDeletionImpact } from "./object-deletion-impact-format";
import {
  useObjectDeletion,
  type ObjectDeletionConfirmResult,
  type ObjectDeletionController,
} from "./use-object-deletion";

const OBJECT_LIFT = 7;
const OBJECT_SWING = 8;

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

type DeletionApi = {
  deletion: ObjectDeletionController;
  store: ReturnType<typeof useProjectStore>;
  project: ReturnType<typeof useProject>;
};

const renderDeletionController = () =>
  renderHook(
    () => ({
      deletion: useObjectDeletion(),
      store: useProjectStore(),
      project: useProject(),
    }),
    { wrapper },
  );

const openFixtureProject = async (
  result: { current: { project: ReturnType<typeof useProject> } },
) => {
  await waitFor(() => expect(result.current.project.loading).toBe(false));
  await act(async () => {
    await result.current.project.openProject(GZ_2025_RECORD.folderName);
  });
};

const allowCloseFromOutcome = (outcome: ObjectDeletionConfirmResult): boolean =>
  outcome === "deleted" || outcome === "no-op";

const DeletionDialogHost = ({
  onApi,
}: {
  onApi: (api: DeletionApi) => void;
}) => {
  const deletion = useObjectDeletion();
  const store = useProjectStore();
  const project = useProject();

  useEffect(() => {
    onApi({ deletion, store, project });
  });

  return (
    <DeleteImpactDialog
      objectImpact={deletion.impact}
      open={deletion.open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) deletion.cancelDelete();
      }}
      onConfirm={() => allowCloseFromOutcome(deletion.confirmDelete())}
      error={deletion.lastError}
    />
  );
};

const renderDeletionDialog = () => {
  let api: DeletionApi | null = null;
  const view = render(
    createElement(wrapper, {
      children: createElement(DeletionDialogHost, {
        onApi: (next) => {
          api = next;
        },
      }),
    }),
  );
  return {
    ...view,
    getApi: () => {
      if (!api) throw new Error("DeletionDialogHost api not ready");
      return api;
    },
  };
};

describe("useObjectDeletion", () => {
  beforeEach(() => {
    installMemoryProjectAPI();
    stubCsocketOpenProject();
  });

  afterEach(() => {
    cleanup();
    uninstallMemoryProjectAPI();
    // @ts-expect-error test cleanup
    delete window.csocketApi;
  });

  it("recomputes stale impact instead of deleting", async () => {
    const { result } = renderDeletionController();
    await openFixtureProject(result);

    act(() => result.current.deletion.requestDelete([OBJECT_LIFT]));
    expect(result.current.deletion.open).toBe(true);
    const originalStateId = result.current.deletion.impact!.stateId;

    act(() => result.current.store.updateObject(OBJECT_LIFT, { name: "新名称" }));
    expect(result.current.project.currentConfigurationStateId).not.toBe(originalStateId);

    act(() => {
      expect(result.current.deletion.confirmDelete()).toBe("refreshed");
    });
    expect(result.current.store.findObject(OBJECT_LIFT)).toBeDefined();
    expect(result.current.deletion.open).toBe(true);
    expect(result.current.deletion.impact!.objectNames).toEqual(["新名称"]);
    expect(result.current.deletion.impact!.stateId).toBe(
      result.current.project.currentConfigurationStateId,
    );
  });

  it("deletes only after a second confirm following stale refresh", async () => {
    const { result } = renderDeletionController();
    await openFixtureProject(result);

    act(() => result.current.deletion.requestDelete([OBJECT_LIFT]));
    act(() => result.current.store.updateObject(OBJECT_LIFT, { name: "再确认名称" }));
    act(() => {
      expect(result.current.deletion.confirmDelete()).toBe("refreshed");
    });

    act(() => {
      expect(result.current.deletion.confirmDelete()).toBe("deleted");
    });
    expect(result.current.store.findObject(OBJECT_LIFT)).toBeUndefined();
    expect(result.current.deletion.open).toBe(false);
    expect(result.current.project.documentRevision.origin).toBe("project-command");
  });

  it("deletes multiple objects as one history step and restores on undo", async () => {
    const { result } = renderDeletionController();
    await openFixtureProject(result);

    act(() => result.current.deletion.requestDelete([OBJECT_LIFT, OBJECT_SWING]));
    act(() => {
      expect(result.current.deletion.confirmDelete()).toBe("deleted");
    });

    expect(result.current.store.findObject(OBJECT_LIFT)).toBeUndefined();
    expect(result.current.store.findObject(OBJECT_SWING)).toBeUndefined();
    expect(result.current.project.undoLabel).toBe("删除 2 个受控物体");

    act(() => {
      result.current.project.undoProjectConfiguration();
    });
    expect(result.current.store.findObject(OBJECT_LIFT)).toBeDefined();
    expect(result.current.store.findObject(OBJECT_SWING)).toBeDefined();
  });

  it("opens confirmation even when the object has no cross-domain references", async () => {
    const { result } = renderDeletionController();
    await openFixtureProject(result);

    act(() => {
      result.current.store.addObjectFromShape("cube");
    });
    const loneId = result.current.store.objects.at(-1)!.id;

    act(() => result.current.deletion.requestDelete([loneId]));
    expect(result.current.deletion.open).toBe(true);
    expect(result.current.deletion.impact).toMatchObject({
      objectIds: [loneId],
      motorBindingCount: 0,
      alignmentCount: 0,
      sceneGroupMemberCount: 0,
      cueCount: 0,
      sequenceCount: 0,
      emptyCueIds: [],
      emptySequenceIds: [],
    } satisfies Partial<ObjectDeletionImpact>);
  });

  it("no-ops when targets disappear before confirm", async () => {
    const { result } = renderDeletionController();
    await openFixtureProject(result);

    act(() => result.current.deletion.requestDelete([OBJECT_LIFT]));
    expect(result.current.deletion.open).toBe(true);

    act(() => {
      result.current.store.removeObjects([OBJECT_LIFT]);
    });
    expect(result.current.store.findObject(OBJECT_LIFT)).toBeUndefined();

    act(() => {
      expect(result.current.deletion.confirmDelete()).toBe("no-op");
    });
    expect(result.current.deletion.open).toBe(false);
    expect(result.current.deletion.impact).toBeNull();
  });

  it("keeps the dialog open and exposes reason when delete fails", async () => {
    const { result } = renderDeletionController();
    await openFixtureProject(result);

    act(() => result.current.deletion.requestDelete([OBJECT_LIFT]));
    expect(result.current.deletion.open).toBe(true);

    await act(async () => {
      await result.current.project.closeProject();
    });

    act(() => {
      expect(result.current.deletion.confirmDelete()).toBe("failed");
    });
    expect(result.current.deletion.open).toBe(true);
    expect(result.current.deletion.lastError).toBeTruthy();
  });

  it("removeObject cascades through project-command history like removeObjects", async () => {
    const { result } = renderDeletionController();
    await openFixtureProject(result);

    const cueBefore = result.current.project.currentProject!.document!.motion.positionCues.find(
      (cue) => cue.id === "cue-open",
    );
    expect(cueBefore?.targets).toHaveProperty(String(OBJECT_LIFT));

    act(() => {
      result.current.store.removeObject(OBJECT_LIFT);
    });

    expect(result.current.store.findObject(OBJECT_LIFT)).toBeUndefined();
    expect(result.current.project.undoLabel).toBe("删除受控物体");
    expect(result.current.project.documentRevision.origin).toBe("project-command");
    const cueAfter = result.current.project.currentProject!.document!.motion.positionCues.find(
      (cue) => cue.id === "cue-open",
    );
    expect(cueAfter?.targets).not.toHaveProperty(String(OBJECT_LIFT));

    act(() => {
      result.current.project.undoProjectConfiguration();
    });
    expect(result.current.store.findObject(OBJECT_LIFT)).toBeDefined();
    const cueRestored = result.current.project.currentProject!.document!.motion.positionCues.find(
      (cue) => cue.id === "cue-open",
    );
    expect(cueRestored?.targets).toHaveProperty(String(OBJECT_LIFT));
  });
});

describe("DeleteImpactDialog + useObjectDeletion integration", () => {
  beforeEach(() => {
    installMemoryProjectAPI();
    stubCsocketOpenProject();
  });

  afterEach(() => {
    cleanup();
    uninstallMemoryProjectAPI();
    // @ts-expect-error test cleanup
    delete window.csocketApi;
  });

  it("keeps dialog open after stale confirm click, then deletes on second confirm", async () => {
    const { getApi } = renderDeletionDialog();
    await waitFor(() => expect(getApi().project.loading).toBe(false));
    await act(async () => {
      await getApi().project.openProject(GZ_2025_RECORD.folderName);
    });

    act(() => getApi().deletion.requestDelete([OBJECT_LIFT]));
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText(/升降灯架-01/)).toBeTruthy();

    act(() => getApi().store.updateObject(OBJECT_LIFT, { name: "对话框新名称" }));

    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    await waitFor(() => {
      expect(screen.getByRole("alertdialog")).toBeTruthy();
      expect(screen.getByText(/对话框新名称/)).toBeTruthy();
    });
    expect(getApi().deletion.open).toBe(true);
    expect(getApi().deletion.impact!.objectNames).toEqual(["对话框新名称"]);
    expect(getApi().store.findObject(OBJECT_LIFT)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
    expect(getApi().deletion.open).toBe(false);
    expect(getApi().store.findObject(OBJECT_LIFT)).toBeUndefined();
  });

  it("keeps dialog open and shows accessible error after failed confirm click", async () => {
    const { getApi } = renderDeletionDialog();
    await waitFor(() => expect(getApi().project.loading).toBe(false));
    await act(async () => {
      await getApi().project.openProject(GZ_2025_RECORD.folderName);
    });

    act(() => getApi().deletion.requestDelete([OBJECT_LIFT]));
    expect(await screen.findByRole("alertdialog")).toBeTruthy();

    await act(async () => {
      await getApi().project.closeProject();
    });

    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    await waitFor(() => {
      expect(screen.getByRole("alertdialog")).toBeTruthy();
      expect(getApi().deletion.open).toBe(true);
      expect(getApi().deletion.lastError).toBeTruthy();
    });
    expect(screen.getByText(getApi().deletion.lastError!)).toBeTruthy();
  });
});

describe("formatObjectDeletionImpact", () => {
  it("exposes names, counts, and empty-item warning copy", () => {
    const view = formatObjectDeletionImpact({
      stateId: "s1",
      objectIds: [1, 2],
      objectNames: ["甲", "乙"],
      motorBindingCount: 2,
      alignmentCount: 1,
      sceneGroupCount: 1,
      sceneGroupMemberCount: 3,
      cueCount: 2,
      cueTargetCount: 4,
      sequenceCount: 1,
      trackCount: 2,
      blockCount: 5,
      emptyCueIds: ["cue-empty"],
      emptySequenceIds: ["seq-empty"],
      affectedRuleIds: [],
    });

    expect(view.confirmLabel).toBe("删除");
    expect(view.summary).toContain("2");
    expect(view.summary).toMatch(/受控物体/);
    expect(view.summary).toContain("甲");
    expect(view.summary).toContain("乙");
    expect(view.detailLines.join("\n")).toMatch(/电机/);
    expect(view.detailLines.join("\n")).toMatch(/alignment|对齐/i);
    expect(view.detailLines.join("\n")).toMatch(/场景组/);
    expect(view.detailLines.join("\n")).toMatch(/Cue/);
    expect(view.detailLines.join("\n")).toMatch(/动作/);
    expect(view.warningLines.join("\n")).toMatch(/待修复/);
    expect(view.warningLines.join("\n")).not.toMatch(/0 个/);
  });

  it("omits zero empty-item counts from warning copy", () => {
    const cuesOnly = formatObjectDeletionImpact({
      stateId: "s1",
      objectIds: ["a"],
      objectNames: ["甲"],
      motorBindingCount: 0,
      alignmentCount: 0,
      sceneGroupCount: 0,
      sceneGroupMemberCount: 0,
      cueCount: 1,
      cueTargetCount: 1,
      sequenceCount: 0,
      trackCount: 0,
      blockCount: 0,
      emptyCueIds: ["cue-empty"],
      emptySequenceIds: [],
      affectedRuleIds: [],
    });
    expect(cuesOnly.warningLines).toHaveLength(1);
    expect(cuesOnly.warningLines[0]).toMatch(/Cue/);
    expect(cuesOnly.warningLines[0]).not.toMatch(/0 个/);
    expect(cuesOnly.warningLines[0]).not.toMatch(/动作序列/);

    const sequencesOnly = formatObjectDeletionImpact({
      stateId: "s1",
      objectIds: ["a"],
      objectNames: ["甲"],
      motorBindingCount: 0,
      alignmentCount: 0,
      sceneGroupCount: 0,
      sceneGroupMemberCount: 0,
      cueCount: 0,
      cueTargetCount: 0,
      sequenceCount: 1,
      trackCount: 1,
      blockCount: 1,
      emptyCueIds: [],
      emptySequenceIds: ["seq-empty"],
      affectedRuleIds: [],
    });
    expect(sequencesOnly.warningLines).toHaveLength(1);
    expect(sequencesOnly.warningLines[0]).toMatch(/动作序列/);
    expect(sequencesOnly.warningLines[0]).not.toMatch(/0 个/);
    expect(sequencesOnly.warningLines[0]).not.toMatch(/Cue/);
  });

  it("keeps a short confirmation for a lone unreferenced object", () => {
    const view = formatObjectDeletionImpact({
      stateId: "s1",
      objectIds: ["lone"],
      objectNames: ["孤立物体"],
      motorBindingCount: 0,
      alignmentCount: 0,
      sceneGroupCount: 0,
      sceneGroupMemberCount: 0,
      cueCount: 0,
      cueTargetCount: 0,
      sequenceCount: 0,
      trackCount: 0,
      blockCount: 0,
      emptyCueIds: [],
      emptySequenceIds: [],
      affectedRuleIds: [],
    });

    expect(view.summary).toContain("孤立物体");
    expect(view.detailLines).toEqual([]);
    expect(view.warningLines).toEqual([]);
  });
});
