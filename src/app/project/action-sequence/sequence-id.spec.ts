import { describe, expect, it } from "vitest";
import {
  allocateSequenceIds,
  collectUsedSequenceIds,
} from "./sequence-id";

describe("allocateSequenceIds", () => {
  it("starts from 1 in an empty project", () => {
    expect(allocateSequenceIds([], 1)).toEqual([1]);
    expect(allocateSequenceIds([], 3)).toEqual([1, 2, 3]);
  });

  it("continues after the current max", () => {
    expect(allocateSequenceIds([1, 2], 1)).toEqual([3]);
  });

  it("fills gaps from 1 when the high water is 65535", () => {
    expect(allocateSequenceIds([65535], 1)).toEqual([1]);
    expect(allocateSequenceIds([2, 65535], 1)).toEqual([1]);
  });

  it("throws when the sequence id pool is full", () => {
    const used = Array.from({ length: 65535 }, (_, index) => index + 1);
    expect(() => allocateSequenceIds(used, 1)).toThrow("动作序列 id 已满（1~65535）");
  });
});

describe("collectUsedSequenceIds", () => {
  it("keeps only integers in 1~65535", () => {
    expect(collectUsedSequenceIds([{ id: 1 }, { id: 0 }, { id: "seq-1" }, { id: 65535 }])).toEqual(
      new Set([1, 65535]),
    );
  });
});
