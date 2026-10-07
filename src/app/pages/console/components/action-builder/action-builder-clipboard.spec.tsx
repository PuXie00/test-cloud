// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { ProjectProvider } from "@/app/project/project-provider";
import {
  installMemoryProjectAPI,
  uninstallMemoryProjectAPI,
} from "@/app/project/install-memory-project-api";
import type { MotionSegmentSettings, TimelineBlock } from "@/app/project/action-sequence/types";
import { GZ_2025_RECORD } from "@/app/project/test-fixtures";
import { useProject } from "@/app/project/use-project";
import { ProgramProvider } from "@/app/pages/console/hooks/use-program";
import { ProjectStoreProvider } from "@/app/pages/console/hooks/use-project-store";
import { ActionBuilderProvider } from "./action-builder-context";
import { actionClipboard } from "./action-clipboard";
import { useActionBuilder } from "./use-action-builder";

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

const pose = (id: string, objectId: number, atMs: number, v1: number): TimelineBlock => ({
  id,
  kind: "pose",
  objectId,
  atMs,
  pose: { v1, v2: 0, v3: 0 },
});

const tuned: MotionSegmentSettings = {
  profiles: {
    v1: { kind: "trapezoid", params: { accelMs: 400, decelMs: 300 } },
    v2: { kind: "idle" },
    v3: { kind: "idle" },
  },
};

/** 新建序列，在物体 7 上放两个相连的位姿并调过区间，选中这两个块 */
const armTwoPoses = (result: Rendered) => {
  act(() => result.current.builder.handleCreateSequence([]));
  act(() => {
    result.current.builder.handleInsertTimelineBlock(pose("a", 7, 1000, 0));
    result.current.builder.handleInsertTimelineBlock(pose("b", 7, 3000, 100));
  });
  act(() => result.current.builder.handleUpdateSegmentSettings("a", "b", tuned));
  act(() => result.current.builder.handleSelectionChange({ kind: "multi-block", blockIds: ["a", "b"] }));
};

const pastedBlocks = (result: Rendered) =>
  result.current.builder.sequence!.blocks.filter((block) => block.id !== "a" && block.id !== "b");

describe("action builder copy / paste", () => {
  beforeEach(() => {
    actionClipboard.clear();
    installMemoryProjectAPI();
    stubCsocketOpenProject();
  });

  afterEach(() => {
    uninstallMemoryProjectAPI();
    delete window.csocketApi;
    actionClipboard.clear();
  });

  it("pastes two connected blocks with their motion segment at the playhead", async () => {
    const { result } = renderBuilder();
    await openFixtureProject(result);
    armTwoPoses(result);
    act(() => result.current.builder.handleBlockCopy());
    expect(result.current.builder.canPasteBlock).toBe(true);
    act(() => result.current.builder.handleCursorChange(5000));
    act(() => result.current.builder.handleBlockPaste());

    const pasted = pastedBlocks(result);
    expect(pasted.map((block) => (block.kind === "pose" ? [block.objectId, block.atMs] : null))).toEqual([
      [7, 5000],
      [7, 7000],
    ]);
    const segment = result.current.builder.sequence!.segments.find(
      (item) => item.fromRef === pasted[0]!.id && item.toRef === pasted[1]!.id,
    );
    expect(segment?.settings.profiles.v1).toEqual(tuned.profiles.v1);
    expect(result.current.builder.selection).toEqual({
      kind: "multi-block",
      blockIds: pasted.map((block) => block.id),
    });
  });

  it("pastes onto the object selected after copying", async () => {
    const { result } = renderBuilder();
    await openFixtureProject(result);
    armTwoPoses(result);
    act(() => result.current.builder.handleBlockCopy());
    act(() => result.current.builder.handleObjectSelect(8));
    act(() => result.current.builder.handleCursorChange(5000));
    act(() => result.current.builder.handleBlockPaste());

    expect(pastedBlocks(result).map((block) => (block.kind === "pose" ? block.objectId : null))).toEqual([
      8, 8,
    ]);
  });

  it("pastes back onto the original object when the object selection did not change", async () => {
    const { result } = renderBuilder();
    await openFixtureProject(result);
    act(() => result.current.builder.handleObjectsSelect([8, 9]));
    armTwoPoses(result);
    act(() => result.current.builder.handleBlockCopy());
    act(() => result.current.builder.handleCursorChange(5000));
    act(() => result.current.builder.handleBlockPaste());

    expect(pastedBlocks(result).map((block) => (block.kind === "pose" ? block.objectId : null))).toEqual([
      7, 7,
    ]);
  });

  it("copies a sequence and pastes it as a new, selected sequence", async () => {
    const { result } = renderBuilder();
    await openFixtureProject(result);
    armTwoPoses(result);
    const source = result.current.builder.sequence!;
    const before = result.current.builder.sequences.length;
    act(() => result.current.builder.handleSequenceCopy(source.id));
    expect(result.current.builder.canPasteSequence).toBe(true);
    act(() => result.current.builder.handleSequencePaste());

    expect(result.current.builder.sequences).toHaveLength(before + 1);
    const pasted = result.current.builder.sequence!;
    expect(pasted.id).not.toBe(source.id);
    expect(pasted.name).toBe(`${source.name} (2)`);
    expect(pasted.blocks).toEqual(source.blocks);
    expect(pasted.segments).toEqual(source.segments);
    expect(
      result.current.project.currentProject!.document!.motion.actionSequences.some(
        (item) => item.id === pasted.id,
      ),
    ).toBe(true);
  });

  it("pastes a sequence copied in another project onto objects with the same name", async () => {
    const { result } = renderBuilder();
    await openFixtureProject(result);
    actionClipboard.setSequence({
      projectId: "another-project",
      sequence: {
        id: 300,
        name: "外部动作",
        trajectoryMode: false,
        blocks: [pose("x", 77, 1000, 10), pose("y", 78, 1000, 10)],
        segments: [],
      },
      objects: [
        { id: 77, name: "升降灯架-01", controlType: 2 },
        { id: 78, name: "不存在的物体", controlType: 2 },
      ],
    });
    act(() => result.current.builder.handleSequencePaste());

    const pasted = result.current.builder.sequence!;
    expect(pasted.name).toBe("外部动作");
    expect(pasted.blocks).toEqual([pose("x", 7, 1000, 10)]);
  });
});
