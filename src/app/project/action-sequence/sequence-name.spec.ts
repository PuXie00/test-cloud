import { describe, expect, it } from "vitest";
import {
  NEW_SEQUENCE_BASE_NAME,
  SEQUENCE_NAME_MAX_LENGTH,
  nextNewSequenceName,
  nextShapeName,
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

  it("keeps every generated name within the limit", () => {
    const names = ["新动作"];
    for (let index = 0; index < 20; index += 1) {
      const next = nextNewSequenceName(names);
      expect([...next].length).toBeLessThanOrEqual(SEQUENCE_NAME_MAX_LENGTH);
      names.push(next);
    }
    expect(names).toContain("新动作 (10)");
  });
});

describe("sequenceNameError", () => {
  it("rejects empty, overlong, and duplicate names", () => {
    expect(sequenceNameError("   ", [])).toBe("请输入序列名");
    expect(sequenceNameError("一".repeat(16), [])).toBe("序列名不能超过 15 个字符");
    expect(sequenceNameError("新动作", ["新动作"])).toBe("序列名已存在");
    expect(sequenceNameError(" 新动作 ", ["新动作"])).toBe("序列名已存在");
  });

  it("accepts a unique name within 15 characters", () => {
    expect(sequenceNameError("开场", ["新动作"])).toBeNull();
    expect(sequenceNameError("一".repeat(15), [])).toBeNull();
    expect(sequenceNameError("kaichangdongzuo", [])).toBeNull();
  });
});

describe("nextShapeName", () => {
  it("numbers 造型 from 1 and fills gaps", () => {
    expect(nextShapeName([])).toBe("造型 1");
    expect(nextShapeName(["造型 1", "造型 3"])).toBe("造型 2");
  });
});
