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

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(
    ProjectProvider,
    null,
    createElement(ProgramProvider, null, children),
  );

describe("ProgramProvider document persist", () => {
  beforeEach(() => {
    installMemoryProjectAPI();
  });

  afterEach(() => {
    uninstallMemoryProjectAPI();
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
