import { describe, expect, it } from "vitest";
import { PROGRAM_SLOTS_PER_PAGE, type ChapterItem } from "./program-data";
import { programPageCount, sliceProgramPage } from "./program-utils";

const item = (id: number): ChapterItem => ({
  kind: "sequence",
  sequence: { id, name: `S${id}`, durationMs: 0 },
});

describe("program paging", () => {
  it("uses 16 slots per page", () => {
    expect(PROGRAM_SLOTS_PER_PAGE).toBe(16);
  });

  it("returns at least one page for empty chapters", () => {
    expect(programPageCount([])).toBe(1);
  });

  it("slices 16 items per page and counts leftover pages", () => {
    const items = Array.from({ length: 17 }, (_, index) => item(index + 1));
    expect(programPageCount(items)).toBe(2);
    expect(sliceProgramPage(items, 0)).toHaveLength(16);
    expect(sliceProgramPage(items, 1)).toEqual([item(17)]);
    expect(sliceProgramPage(items, 0)[0]?.sequence.id).toBe(1);
    expect(sliceProgramPage(items, 0)[15]?.sequence.id).toBe(16);
  });
});
