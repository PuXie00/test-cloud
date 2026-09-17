import { describe, expect, it } from "vitest";
import { formatBlockRepairItems, formatPresetRepairMessage } from "./preset-repair";
import type { SequenceIssue } from "./validate-sequence";

const issue = (partial: Partial<SequenceIssue> & Pick<SequenceIssue, "code" | "message">): SequenceIssue => ({
  severity: "error",
  ...partial,
});

describe("preset repair copy", () => {
  it("translates axis limit errors into 待修复 copy", () => {
    expect(
      formatPresetRepairMessage(
        issue({
          code: "limit-exceeded",
          message: "axis v1 position 1800 outside [0, 1000]",
          objectId: 7,
          blockId: "p1",
        }),
        { objectName: (id) => (id === 7 ? "升降灯架-01" : undefined) },
      ),
    ).toBe("升降灯架-01 虚轴1 位姿 1800 超出范围 [0, 1000]");
    expect(
      formatPresetRepairMessage(
        issue({
          code: "limit-exceeded",
          message: "axis v1 velocity 900 exceeds 500",
          objectId: 8,
          blockId: "p1",
        }),
      ),
    ).toBe("模型 8 虚轴1 速度 900 超过上限 500");
  });

  it("uses catalog labels for parameter errors", () => {
    expect(
      formatPresetRepairMessage(
        issue({
          code: "invalid-preset",
          message: "parameter sampleIntervalMs must be > 0",
          blockId: "p1",
        }),
        { presetId: "dynamic-wave" },
      ),
    ).toBe("参数「采样间隔」必须大于 0");
  });

  it("dedupes repair items for one block", () => {
    const items = formatBlockRepairItems(
      [
        issue({
          code: "limit-exceeded",
          message: "axis v1 position 1800 outside [0, 1000]",
          objectId: 7,
          blockId: "p1",
        }),
        issue({
          code: "limit-exceeded",
          message: "axis v1 position 1800 outside [0, 1000]",
          objectId: 7,
          blockId: "p1",
        }),
        issue({
          code: "limit-exceeded",
          message: "axis v1 position 1800 outside [0, 1000]",
          objectId: 8,
          blockId: "other",
        }),
      ],
      "p1",
    );
    expect(items).toEqual(["模型 7 虚轴1 位姿 1800 超出范围 [0, 1000]"]);
  });
});
