import type { PlcCompiledEvent } from "@shared/csocket/action-data-save";
import type { InstructionBlock, SetEnabledInstruction } from "./types";

export const INSTRUCTION_PRESET_IDS = ["set-enabled"] as const;
export type InstructionPresetId = (typeof INSTRUCTION_PRESET_IDS)[number];

export const isInstructionPresetId = (value: string): value is InstructionPresetId =>
  (INSTRUCTION_PRESET_IDS as readonly string[]).includes(value);

export const createSetEnabledInstruction = (
  id: string,
  objectId: number,
  atMs: number,
  enabled: boolean,
  label?: string,
): SetEnabledInstruction => ({
  id,
  kind: "instruction",
  presetId: "set-enabled",
  objectId,
  atMs,
  instr: { enabled },
  ...(label !== undefined ? { label } : {}),
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const validateInstructionInstr = (presetId: string, instr: unknown): string[] => {
  if (!isInstructionPresetId(presetId)) {
    return [`unknown instruction ${presetId}`];
  }
  if (!isRecord(instr)) {
    return ["instr must be an object"];
  }
  const errors: string[] = [];
  for (const key of Object.keys(instr)) {
    if (key !== "enabled") errors.push(`unknown parameter: ${key}`);
  }
  if (!Object.prototype.hasOwnProperty.call(instr, "enabled")) {
    errors.push("missing parameter: enabled");
  } else if (typeof instr.enabled !== "boolean") {
    errors.push("parameter enabled must be a boolean");
  }
  return errors;
};

export const instructionBlockTitle = (block: InstructionBlock): string => {
  if (block.presetId === "set-enabled") {
    return block.instr.enabled ? "使能指令" : "断使能指令";
  }
  return block.presetId;
};

export const instructionToPlcEvent = (block: InstructionBlock): PlcCompiledEvent => {
  if (block.presetId !== "set-enabled") {
    throw new Error(`cannot compile instruction ${block.presetId}`);
  }
  return {
    modelNo: block.objectId,
    atMs: block.atMs,
    kind: "set-enabled",
    enabled: block.instr.enabled,
  };
};
