import { describe, expect, it } from "vitest";
import {
  createSetEnabledInstruction,
  instructionBlockTitle,
  instructionToPlcEvent,
  isInstructionPresetId,
  validateInstructionInstr,
} from "./instruction-registry";

describe("instruction-registry", () => {
  it("accepts set-enabled instr and rejects extra or missing keys", () => {
    expect(isInstructionPresetId("set-enabled")).toBe(true);
    expect(isInstructionPresetId("static-flat")).toBe(false);
    expect(validateInstructionInstr("set-enabled", { enabled: true })).toEqual([]);
    expect(validateInstructionInstr("nope", { enabled: true })).toEqual(["unknown instruction nope"]);
    expect(validateInstructionInstr("set-enabled", { enabled: true, extra: 1 })).toContain(
      "unknown parameter: extra",
    );
    expect(validateInstructionInstr("set-enabled", {})).toContain("missing parameter: enabled");
  });

  it("titles and compiles set-enabled from instr.enabled", () => {
    const enable = createSetEnabledInstruction("a", 7, 100, true);
    const disable = createSetEnabledInstruction("b", 7, 200, false);
    expect(instructionBlockTitle(enable)).toBe("使能指令");
    expect(instructionBlockTitle(disable)).toBe("断使能指令");
    expect(instructionToPlcEvent(enable)).toEqual({
      modelNo: 7,
      atMs: 100,
      kind: "set-enabled",
      enabled: true,
    });
  });
});
