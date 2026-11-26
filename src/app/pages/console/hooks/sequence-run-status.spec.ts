import { describe, expect, it } from "vitest";
import type { ChapterItem } from "../components/program-panel/program-data";
import {
  execCardSlot,
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

describe("execCardSlot", () => {
  const slots = [
    { itemKey: "ch-1#0#7", sequence: { id: 7 } },
    { itemKey: "ch-1#1#4", sequence: { id: 4 } },
    { itemKey: "ch-1#2#", sequence: null },
    { itemKey: "ch-1#3#4", sequence: { id: 4 } },
  ];
  const fader = (itemKey: string) => ({ kind: "fader", slotIndex: 0, itemKey });

  it("uses the card's own program item while it is on the current page", () => {
    expect(execCardSlot({ source: fader("ch-1#1#4"), sequenceId: 4 }, slots)).toBe(slots[1]);
    // 同一序列在本页出现两次：认来源那一项，不是第一个同序列的槽
    expect(execCardSlot({ source: fader("ch-1#3#4"), sequenceId: 4 }, slots)).toBe(slots[3]);
  });

  it("finds the sequence on the current page when the source item is elsewhere", () => {
    expect(execCardSlot({ source: fader("ch-2#5#7"), sequenceId: 7 }, slots)).toBe(slots[0]);
    expect(execCardSlot({ source: { kind: "external" }, sequenceId: 4 }, slots)).toBe(slots[1]);
  });

  it("is null when the sequence is not on the current page or the card has none", () => {
    expect(execCardSlot({ source: fader("ch-1#0#9"), sequenceId: 9 }, slots)).toBeNull();
    expect(execCardSlot({ source: fader("ch-1#0#7") }, slots)).toBeNull();
  });
});
