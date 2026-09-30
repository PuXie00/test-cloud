import { describe, expect, it } from "vitest";
import type { ChapterItem } from "../components/program-panel/program-data";
import {
  formatExecTime,
  hasNextChapterSequence,
  nextChapterSequence,
  nextSequenceIsFree,
  nextSequenceSlot,
} from "./sequence-run-status";

const item = (id: number): ChapterItem => ({
  kind: "sequence",
  sequence: { id, name: `S${id}`, durationMs: 0 },
});

describe("formatExecTime", () => {
  it("formats elapsed and total", () => {
    expect(formatExecTime(12300)).toBe("00:12.3");
    expect(formatExecTime(60000)).toBe("01:00.0");
  });
});

describe("hasNextChapterSequence", () => {
  it("is true when a later sequence exists after the id", () => {
    expect(hasNextChapterSequence([item(7), item(8), item(9)], 8)).toBe(true);
  });

  it("is false when the id is last, missing, or the list is empty", () => {
    expect(hasNextChapterSequence([item(7), item(8)], 8)).toBe(false);
    expect(hasNextChapterSequence([item(7)], 99)).toBe(false);
    expect(hasNextChapterSequence([], 7)).toBe(false);
  });
});

describe("nextChapterSequence", () => {
  it("returns the following sequence", () => {
    expect(nextChapterSequence([item(7), item(8), item(9)], 8)?.sequence.id).toBe(9);
  });
});

describe("nextSequenceIsFree", () => {
  it("is false when the following sequence is already a task", () => {
    expect(nextSequenceIsFree([item(7), item(8)], 7, [8])).toBe(false);
    expect(nextSequenceIsFree([item(7), item(8)], 7, [])).toBe(true);
    expect(nextSequenceIsFree([item(7)], 7, [])).toBe(false);
  });
});

describe("nextSequenceSlot", () => {
  const items = [item(1), item(2), item(3)];
  const slots = [
    { index: 0, sequence: { id: 1 } },
    { index: 1, sequence: { id: 2 } },
    { index: 2, sequence: null },
  ];

  it("finds the fader slot that holds the next sequence", () => {
    expect(nextSequenceSlot(items, 1, slots)).toBe(slots[1]);
  });

  it("is null when the next sequence is not on the current page, or there is none", () => {
    expect(nextSequenceSlot(items, 2, slots)).toBeNull();
    expect(nextSequenceSlot(items, 3, slots)).toBeNull();
    expect(nextSequenceSlot(items, undefined, slots)).toBeNull();
  });
});
