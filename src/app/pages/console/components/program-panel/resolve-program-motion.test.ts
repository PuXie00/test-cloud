import { describe, expect, it } from "vitest";
import type { ProgramItemRef, ProjectMotion } from "@/app/project/project-document-types";
import { GZ_2025_DOCUMENT } from "@/app/project/mock-documents/gz-2025.document";
import {
  motionProgramToLegacyProgram,
  resolveProgramChapterItems,
} from "./resolve-program-motion";

const mixedItems = [
  { kind: "cue", refId: "cue-open" },
  { kind: "sequence", refId: 1 },
] as unknown as ProgramItemRef[];

describe("resolveProgramChapterItems", () => {
  it("drops cue refs and keeps sequence refs", () => {
    const motion: ProjectMotion = {
      ...GZ_2025_DOCUMENT.motion,
      actionSequences: [
        {
          id: 1,
          name: "Seq 1",
          trajectoryMode: "non-forced",
          blocks: [],
          segments: [],
        },
      ],
    };
    const resolved = resolveProgramChapterItems(motion, mixedItems);
    expect(resolved).toEqual([
      expect.objectContaining({ kind: "sequence", sequence: expect.objectContaining({ id: 1 }) }),
    ]);
  });
});

describe("motionProgramToLegacyProgram", () => {
  it("builds embedded program without cue chapter items", () => {
    const program = motionProgramToLegacyProgram({
      ...GZ_2025_DOCUMENT.motion,
      programs: [
        {
          id: "p1",
          name: GZ_2025_DOCUMENT.motion.programs[0]!.name,
          chapters: [{ id: "ch", name: "Ch", items: mixedItems }],
        },
      ],
      actionSequences: [
        {
          id: 1,
          name: "Seq 1",
          trajectoryMode: "non-forced",
          blocks: [],
          segments: [],
        },
      ],
    });
    expect(program?.chapters[0]?.items.every((item) => item.kind === "sequence")).toBe(true);
    expect(program?.chapters[0]?.items).toHaveLength(1);
  });
});
