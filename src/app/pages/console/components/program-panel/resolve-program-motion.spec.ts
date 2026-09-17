import { describe, expect, it } from "vitest";
import type { ProgramItemRef, ProjectMotion } from "@/app/project/project-document-types";
import {
  motionProgramToLegacyProgram,
  resolveProgramChapterItems,
} from "./resolve-program-motion";

const motion: ProjectMotion = {
  actionSequences: [
    {
      id: 1,
      name: "Seq",
      trajectoryMode: "non-forced",
      blocks: [],
      segments: [],
    },
  ],
  programs: [
    {
      id: "p",
      name: "P",
      chapters: [
        {
          id: "ch",
          name: "Ch",
          items: [
            { kind: "sequence", refId: 1 },
            { kind: "sequence", refId: 99 },
          ] as unknown as ProgramItemRef[],
        },
      ],
    },
  ],
};

describe("resolve-program-motion", () => {
  it("drops Cue refs and missing sequences on hydrate", () => {
    const resolved = resolveProgramChapterItems(
      motion,
      motion.programs[0]!.chapters[0]!.items,
    );
    expect(resolved).toEqual([
      { kind: "sequence", sequence: motion.actionSequences[0] },
    ]);

    const program = motionProgramToLegacyProgram(motion);
    expect(program?.chapters[0]?.items).toHaveLength(1);
    expect(program?.chapters[0]?.items[0]).toMatchObject({
      kind: "sequence",
      sequence: { id: 1, name: "Seq", trajectoryMode: "non-forced" },
    });
  });

  it("copies forced trajectoryMode onto the control-page sequence summary", () => {
    const forcedMotion: ProjectMotion = {
      ...motion,
      actionSequences: [{ ...motion.actionSequences[0]!, trajectoryMode: "forced" }],
    };
    const program = motionProgramToLegacyProgram(forcedMotion);
    expect(program?.chapters[0]?.items[0]?.sequence.trajectoryMode).toBe("forced");
  });
});
