import { describe, expect, it } from "vitest";
import type { ActionSequenceConfig } from "./action-sequence/types";
import { runningSequenceEditBlock, runningSequenceMessage } from "./running-sequence-lock";

const sequence = (id: number, name = `序列${id}`): ActionSequenceConfig => ({
  id,
  name,
  trajectoryMode: false,
  blocks: [],
  segments: [],
});

describe("runningSequenceEditBlock", () => {
  const before = [sequence(1), sequence(2)];

  it("blocks changing or deleting a running sequence", () => {
    const renamed = [sequence(1, "新"), sequence(2)];
    expect(runningSequenceEditBlock(before, renamed, new Set([1]))).toBe("「序列1」正在运行，停下后再修改");
    expect(runningSequenceEditBlock(before, [sequence(2)], new Set([1]))).toBe("「序列1」正在运行，停下后再修改");
  });

  it("lets other sequences change and copies of the running one through", () => {
    expect(runningSequenceEditBlock(before, structuredClone([before[0]!, sequence(2, "新")]), new Set([1]))).toBeNull();
    expect(runningSequenceEditBlock(before, [...before, sequence(3)], new Set([1]))).toBeNull();
    expect(runningSequenceEditBlock(before, [sequence(2)], new Set())).toBeNull();
    // 运行中的动作不在工程里（如主控上别的动作）不拦
    expect(runningSequenceEditBlock(before, [sequence(2)], new Set([9]))).toBeNull();
  });

  it("names every running sequence in one message", () => {
    expect(runningSequenceMessage(["开场", "收尾"], "保存")).toBe("「开场」「收尾」正在运行，停下后再保存");
  });
});
