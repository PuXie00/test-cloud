import { expect, it } from "vitest";
import { getPresetDefinition } from "@/app/project/action-sequence/preset-registry";
import { presetParamDisplayNumber, presetParamStoredNumber } from "./preset-param-display";

const fieldOf = (key: string) => {
  const field = getPresetDefinition("dynamic-wave")?.paramFields.find((item) => item.key === key);
  if (!field) throw new Error(`missing ${key}`);
  return field;
};

it("shows stagger interval as seconds and stores tenths of a second as milliseconds", () => {
  const field = fieldOf("staggerMs");
  expect(presetParamDisplayNumber(field, 500)).toBe(0.5);
  expect(presetParamStoredNumber(field, 0.5)).toBe(500);
  expect(presetParamStoredNumber(field, 0.1)).toBe(100);
  expect(presetParamStoredNumber(field, 0.15)).toBe(200);
  expect(presetParamStoredNumber(field, 0)).toBe(0);
});

it("leaves amplitude in stored millimetres", () => {
  const field = fieldOf("amplitude");
  expect(presetParamDisplayNumber(field, 1500)).toBe(1500);
  expect(presetParamStoredNumber(field, 1500)).toBe(1500);
});
