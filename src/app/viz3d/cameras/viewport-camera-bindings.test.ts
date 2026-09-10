import { describe, expect, it } from "vitest";
import {
  applyViewportCameraBindings,
  type ViewportCameraMapEntry,
} from "./viewport-camera-bindings";

const seedCurrentBindings = (): ViewportCameraMapEntry[] => [
  { source: "pointer", button: 0, modifiers: { ctrl: true }, interaction: "pan" },
  { source: "pointer", button: 0, interaction: "rotate" },
  { source: "pointer", button: 2, interaction: "pan" },
  { source: "wheel", interaction: "zoom" },
  { source: "pointer", button: 1, interaction: "pan" },
];

const pointerEntries = (map: ViewportCameraMapEntry[]) =>
  map.filter((entry) => entry.source === "pointer");

describe("applyViewportCameraBindings", () => {
  it("maps middle-drag to pan and alt+middle to rotate", () => {
    const map = seedCurrentBindings();
    applyViewportCameraBindings(map);
    expect(pointerEntries(map)).toEqual([
      { source: "pointer", button: 1, modifiers: { alt: true }, interaction: "rotate" },
      { source: "pointer", button: 1, interaction: "pan" },
    ]);
    expect(map.some((entry) => entry.source === "wheel")).toBe(true);
  });

  it("is idempotent", () => {
    const map = seedCurrentBindings();
    applyViewportCameraBindings(map);
    applyViewportCameraBindings(map);
    expect(pointerEntries(map)).toEqual([
      { source: "pointer", button: 1, modifiers: { alt: true }, interaction: "rotate" },
      { source: "pointer", button: 1, interaction: "pan" },
    ]);
  });
});
