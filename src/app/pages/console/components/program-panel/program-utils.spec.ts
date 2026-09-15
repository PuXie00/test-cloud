import { describe, expect, it } from "vitest";
import { PROGRAM_SLOTS_PER_PAGE, type ChapterItem } from "./program-data";
import { programPageCount, sliceProgramPage } from "./program-utils";

const item = (id: number): ChapterItem => ({
  kind: "sequence",
  sequence: { id, name: `S${id}`, durationMs: 0 },
});

describe("program paging", () => {
  it("uses 8 slots per page", () => {
    expect(PROGRAM_SLOTS_PER_PAGE).toBe(8);
  });

  it("returns at least one page for empty chapters", () => {
    expect(programPageCount([])).toBe(1);
  });

  it("slices 8 items per page and counts leftover pages", () => {
    const eight = Array.from({ length: 8 }, (_, index) => item(index + 1));
    expect(programPageCount(eight)).toBe(1);
    expect(sliceProgramPage(eight, 0)).toHaveLength(8);

    const nine = Array.from({ length: 9 }, (_, index) => item(index + 1));
    expect(programPageCount(nine)).toBe(2);
    expect(sliceProgramPage(nine, 0)).toHaveLength(8);
    expect(sliceProgramPage(nine, 1)).toEqual([item(9)]);

    const items = Array.from({ length: 17 }, (_, index) => item(index + 1));
    expect(programPageCount(items)).toBe(3);
    expect(sliceProgramPage(items, 0)).toHaveLength(8);
    expect(sliceProgramPage(items, 1)).toHaveLength(8);
    expect(sliceProgramPage(items, 2)).toEqual([item(17)]);
    expect(sliceProgramPage(items, 0)[0]?.sequence.id).toBe(1);
    expect(sliceProgramPage(items, 0)[7]?.sequence.id).toBe(8);
  });
});
