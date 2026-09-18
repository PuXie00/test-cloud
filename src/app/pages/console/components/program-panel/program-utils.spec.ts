import { describe, expect, it } from "vitest";
import { PROGRAM_SLOTS_PER_PAGE, type ChapterItem } from "./program-data";
import { programPageCount, sliceProgramPage } from "./program-utils";

const item = (id: number): ChapterItem => ({
  kind: "sequence",
  sequence: { id, name: `S${id}`, durationMs: 0 },
});

describe("program paging", () => {
  it("uses 12 slots per page", () => {
    expect(PROGRAM_SLOTS_PER_PAGE).toBe(12);
  });

  it("returns at least one page for empty chapters", () => {
    expect(programPageCount([])).toBe(1);
  });

  it("slices 12 items per page and counts leftover pages", () => {
    const twelve = Array.from({ length: 12 }, (_, index) => item(index + 1));
    expect(programPageCount(twelve)).toBe(1);
    expect(sliceProgramPage(twelve, 0)).toHaveLength(12);

    const thirteen = Array.from({ length: 13 }, (_, index) => item(index + 1));
    expect(programPageCount(thirteen)).toBe(2);
    expect(sliceProgramPage(thirteen, 0)).toHaveLength(12);
    expect(sliceProgramPage(thirteen, 1)).toEqual([item(13)]);

    const items = Array.from({ length: 25 }, (_, index) => item(index + 1));
    expect(programPageCount(items)).toBe(3);
    expect(sliceProgramPage(items, 0)).toHaveLength(12);
    expect(sliceProgramPage(items, 1)).toHaveLength(12);
    expect(sliceProgramPage(items, 2)).toEqual([item(25)]);
    expect(sliceProgramPage(items, 0)[0]?.sequence.id).toBe(1);
    expect(sliceProgramPage(items, 0)[11]?.sequence.id).toBe(12);
  });
});
