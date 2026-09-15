import { describe, expect, it } from "vitest";
import type { ChapterItem } from "../components/program-panel/program-data";
import {
  EXAMPLE_SEQUENCE_RUNTIME,
  formatExecTime,
  hasNextChapterSequence,
} from "./sequence-run-status";

const item = (id: number): ChapterItem => ({
  kind: "sequence",
  sequence: { id, name: `S${id}`, durationMs: 0 },
});

describe("sequence run status fixture", () => {
  it("exposes elapsed 12300, total 60000, loop 1", () => {
    expect(EXAMPLE_SEQUENCE_RUNTIME).toHaveLength(1);
    const row = EXAMPLE_SEQUENCE_RUNTIME[0]!;
    expect(row.elapsedMs).toBe(12300);
    expect(row.totalMs).toBe(60000);
    expect(row.loopCount).toBe(1);
    expect(row.speedPercent).toBe(100);
    expect(row.remainingMs).toBe(47700);
  });
});

describe("formatExecTime", () => {
  it("formats the fixture elapsed and total", () => {
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
