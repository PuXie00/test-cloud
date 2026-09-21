import { describe, expect, it } from "vitest";
import type { InstructionBlock } from "./types";
import {
  createSetEnabledInstruction,
  instructionBlockTitle,
  instructionToCompiledEvent,
  isInstructionPresetId,
  SET_ENABLED_ADDR,
  SET_ENABLED_OPT_CMD,
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
    expect(instructionToCompiledEvent(enable)).toEqual({
      time: 100,
      params: {
        OptCmd: SET_ENABLED_OPT_CMD,
        addr: SET_ENABLED_ADDR,
        params: [{ deviceId: 7, enableFlag: 1 }],
      },
    });
    expect(instructionToCompiledEvent(disable)).toEqual({
      time: 200,
      params: {
        OptCmd: "Operation|enable",
        addr: "0x0102",
        params: [{ deviceId: 7, enableFlag: 0 }],
      },
    });
  });

  it("throws when compiling an unknown instruction preset", () => {
    const block = {
      id: "x",
      kind: "instruction",
      presetId: "nope",
      objectId: 7,
      atMs: 0,
      instr: { enabled: true },
    } as InstructionBlock;
    expect(() => instructionToCompiledEvent(block)).toThrow(/cannot compile instruction nope/);
  });
});
