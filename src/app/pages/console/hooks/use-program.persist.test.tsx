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
import { ProgramProvider, useProgram } from "./use-program";
import { useProject } from "@/app/project/use-project";

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
    createElement(ProgramProvider, null, children),
  );

describe("ProgramProvider document persist", () => {
  beforeEach(() => {
    installMemoryProjectAPI();
    stubCsocketOpenProject();
  });

  afterEach(() => {
    uninstallMemoryProjectAPI();
    delete window.csocketApi;
  });

  it("addSequence appends an action sequence and a program ref, not a position cue", async () => {
    const { result } = renderHook(
      () => ({ program: useProgram(), project: useProject() }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.project.loading).toBe(false));

    await act(async () => {
      await result.current.project.openProject(GZ_2025_RECORD.folderName);
    });
    await waitFor(() => {
      expect(result.current.project.currentProject?.document).toBeTruthy();
    });

    if (!result.current.program.program.chapters[0]?.id) {
      act(() => {
        result.current.program.addChapter();
      });
    }
    const chapterId = result.current.program.program.chapters[0]!.id;
    const cuesBefore =
      result.current.project.currentProject?.document?.motion.positionCues.length ?? 0;
    const seqBefore =
      result.current.project.currentProject?.document?.motion.actionSequences.length ?? 0;
    act(() => {
      result.current.program.addSequence(chapterId);
    });
    expect(result.current.project.currentProject?.document?.motion.positionCues.length).toBe(
      cuesBefore,
    );
    expect(result.current.project.currentProject?.document?.motion.actionSequences.length).toBe(
      seqBefore + 1,
    );
    expect(result.current.program.pageItems.sequences).toHaveLength(1);
    expect(result.current.program).not.toHaveProperty("addCue");
  });
});
