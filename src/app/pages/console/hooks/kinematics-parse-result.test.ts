import { describe, expect, it } from "vitest";
import {
  buildKinematicsCallFile,
  parseKinematicsResultFile,
} from "@shared/kinematics/parse-result";

describe("buildKinematicsCallFile", () => {
  it("顶层为 path + data 数组", () => {
    const items = [{ index: 1, type: 7 }];
    expect(buildKinematicsCallFile(items, "M:\\yuezhong\\main\\console")).toEqual({
      path: "M:\\yuezhong\\main\\console",
      data: items,
    });
  });
});

describe("parseKinematicsResultFile", () => {
  it("合法数组成功", () => {
    const result = parseKinematicsResultFile(
      [{ index: 1, HPY: [100, 0, 0], Motor_H: [10, 20] }],
      1,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(1);
    }
  });

  it("成功信封 data 数组", () => {
    const result = parseKinematicsResultFile(
      {
        version: "1.0",
        errPrintStr: "",
        data: [{ index: 1, HPY: [100, 0, 0], Motor_H: [10, 20] }],
      },
      1,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([{ index: 1, HPY: [100, 0, 0], Motor_H: [10, 20] }]);
    }
  });

  it("errPrintStr 包为 SOLVE_ERROR", () => {
    const result = parseKinematicsResultFile(
      {
        version: "1.0",
        errPrintStr: "SOURCE_PARSE_ERROR: YXZ_call.json顶层必须是对象",
        data: [],
      },
      1,
    );
    expect(result).toEqual({
      ok: false,
      code: "SOLVE_ERROR",
      message: "SOURCE_PARSE_ERROR: YXZ_call.json顶层必须是对象",
    });
  });

  it("项上 error 字符串为 SOLVE_ERROR", () => {
    const result = parseKinematicsResultFile(
      [{ index: 1, error: "boom", HPY: [0, 0, 0], Motor_H: [] }],
      1,
    );
    expect(result).toEqual({ ok: false, code: "SOLVE_ERROR", message: "boom" });
  });
});
