// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { ProjectProvider } from "@/app/project/project-provider";
import {
  installMemoryProjectAPI,
  uninstallMemoryProjectAPI,
} from "@/app/project/install-memory-project-api";
import { GZ_2025_RECORD } from "@/app/project/test-fixtures";
import { useProject } from "@/app/project/use-project";
import { ProgramProvider } from "@/app/pages/console/hooks/use-program";
import { ProjectStoreProvider } from "@/app/pages/console/hooks/use-project-store";
import { ActionBuilderProvider } from "./action-builder-context";
import { useActionBuilder } from "./use-action-builder";

const { toastWarning } = vi.hoisted(() => ({ toastWarning: vi.fn() }));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), warning: toastWarning, error: vi.fn(), info: vi.fn() },
}));

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
      createElement(ProgramProvider, null, createElement(ActionBuilderProvider, null, children)),
    ),
  );

const renderBuilder = () =>
  renderHook(() => ({ builder: useActionBuilder(), project: useProject() }), { wrapper });

type Rendered = ReturnType<typeof renderBuilder>["result"];

const openFixtureProject = async (result: Rendered) => {
  await waitFor(() => expect(result.current.project.loading).toBe(false));
  await act(async () => {
    await result.current.project.openProject(GZ_2025_RECORD.folderName);
  });
  await waitFor(() => expect(result.current.project.currentProject?.document).toBeTruthy());
};

const livePose = { v1: 120, v2: 3, v3: -2 };
const capture = (objectIds: number[]) => ({
  objectIds,
  poseForObject: (objectId: number) => (objectId === 99 ? null : livePose),
});

describe("action builder save current pose", () => {
  beforeEach(() => {
    toastWarning.mockClear();
    installMemoryProjectAPI();
    stubCsocketOpenProject();
  });

  afterEach(() => {
    uninstallMemoryProjectAPI();
    delete window.csocketApi;
  });

  it("adds the live pose at the playhead of the selected sequence", async () => {
    const { result } = renderBuilder();
    await openFixtureProject(result);
    act(() => result.current.builder.handleCreateSequence([]));
    const sequenceId = result.current.builder.selectedSequenceId;
    act(() => result.current.builder.handleCursorChange(2000));
    act(() => result.current.builder.handleSaveCurrentPose(capture([7, 99])));

    const blocks = result.current.builder.sequence!.blocks;
    expect(blocks).toEqual([
      expect.objectContaining({ kind: "pose", objectId: 7, atMs: 2000, pose: livePose }),
    ]);
    expect(result.current.builder.selectedSequenceId).toBe(sequenceId);
  });

  it("creates and selects a new sequence when none is selected, without adding it to the program", async () => {
    const { result } = renderBuilder();
    await openFixtureProject(result);
    const programsBefore = result.current.project.currentProject!.document!.motion.programs;
    act(() => result.current.builder.handleSequenceSelect(null));
    const countBefore = result.current.builder.sequences.length;

    act(() => result.current.builder.handleSaveCurrentPose(capture([7, 8])));

    const { sequences, selectedSequenceId, sequence } = result.current.builder;
    expect(sequences).toHaveLength(countBefore + 1);
    expect(selectedSequenceId).toBe(sequences.at(-1)!.id);
    expect(sequence!.blocks).toEqual([
      expect.objectContaining({ kind: "pose", objectId: 7, atMs: 0, pose: livePose }),
      expect.objectContaining({ kind: "pose", objectId: 8, atMs: 0, pose: livePose }),
    ]);
    expect(result.current.project.currentProject!.document!.motion.programs).toEqual(programsBefore);
  });

  it("keeps the manual tab when objects are picked, and leaves it on a timeline selection", async () => {
    const { result } = renderBuilder();
    await openFixtureProject(result);
    act(() => result.current.builder.setActiveRightTab("manual"));
    act(() => result.current.builder.handleObjectsSelect([7]));
    expect(result.current.builder.activeRightTab).toBe("manual");
    act(() => result.current.builder.handleObjectSelect(8));
    expect(result.current.builder.activeRightTab).toBe("manual");

    act(() => result.current.builder.handleSelectionChange({ kind: "block", blockId: "x" }));
    expect(result.current.builder.activeRightTab).toBe("selection");

    act(() => result.current.builder.setActiveRightTab("program"));
    act(() => result.current.builder.handleObjectsSelect([7]));
    expect(result.current.builder.activeRightTab).toBe("selection");
  });
});
