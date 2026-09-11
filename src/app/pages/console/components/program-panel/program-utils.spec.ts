import { describe, expect, it } from "vitest";
import { PROGRAM_SLOTS_PER_PAGE, type ChapterItem } from "./program-data";
import { programPageCount, sliceProgramPage } from "./program-utils";

const seq = (id: number): ChapterItem => ({
  kind: "sequence",
  sequence: { id, name: `S${id}`, durationMs: 1000 },
});

describe("program page slicing", () => {
  it("uses 16 slots per page", () => {
    expect(PROGRAM_SLOTS_PER_PAGE).toBe(16);
  });

  it("slices sequences into pages of 16", () => {
    const items = Array.from({ length: 17 }, (_, i) => seq(i + 1));
    expect(programPageCount(items)).toBe(2);
    expect(sliceProgramPage(items, 0)).toHaveLength(16);
    expect(sliceProgramPage(items, 1).map((item) => item.sequence.id)).toEqual([17]);
  });
});
