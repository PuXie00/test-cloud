import { describe, expect, it } from "vitest";
import {
  NEW_SEQUENCE_BASE_NAME,
  nextNewSequenceName,
  sequenceNameError,
} from "./sequence-name";

describe("nextNewSequenceName", () => {
  it("starts at the base name", () => {
    expect(nextNewSequenceName([])).toBe(NEW_SEQUENCE_BASE_NAME);
    expect(NEW_SEQUENCE_BASE_NAME).toBe("新动作");
  });

  it("appends (2), (3) like a new folder when the name is taken", () => {
    expect(nextNewSequenceName(["新动作"])).toBe("新动作 (2)");
    expect(nextNewSequenceName(["新动作", "新动作 (2)"])).toBe("新动作 (3)");
  });

  it("ignores surrounding whitespace when detecting duplicates", () => {
    expect(nextNewSequenceName(["  新动作  "])).toBe("新动作 (2)");
  });

  it("keeps every generated name within 8 characters", () => {
    const names = ["新动作"];
    for (let index = 0; index < 20; index += 1) {
      const next = nextNewSequenceName(names);
      expect([...next].length).toBeLessThanOrEqual(8);
      names.push(next);
    }
    expect(names).toContain("新动作 (10)");
  });
});

describe("sequenceNameError", () => {
  it("rejects empty, overlong, and duplicate names", () => {
    expect(sequenceNameError("   ", [])).toBe("请输入序列名");
    expect(sequenceNameError("一二三四五六七八九", [])).toBe("序列名不能超过 8 个字符");
    expect(sequenceNameError("新动作", ["新动作"])).toBe("序列名已存在");
    expect(sequenceNameError(" 新动作 ", ["新动作"])).toBe("序列名已存在");
  });

  it("accepts a unique name within 8 characters", () => {
    expect(sequenceNameError("开场", ["新动作"])).toBeNull();
    expect(sequenceNameError("一二三四五六七八", [])).toBeNull();
  });
});
