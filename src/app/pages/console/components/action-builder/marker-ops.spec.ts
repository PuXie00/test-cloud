import { describe, expect, it } from "vitest";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import {
  addMarker,
  deleteMarkers,
  nextMarkerName,
  renameMarker,
  setMarkerTime,
  shiftMarkers,
  sortedMarkers,
} from "./marker-ops";

const sequence: ActionSequenceConfig = {
  id: 1,
  name: "seq",
  trajectoryMode: false,
  blocks: [],
  segments: [],
  markers: [
    { id: "b", atMs: 3000, name: "演员入场" },
    { id: "a", atMs: 1000, name: "灯光切换" },
  ],
};

describe("marker ops", () => {
  it("lists markers by time", () => {
    expect(sortedMarkers(sequence).map((marker) => marker.id)).toEqual(["a", "b"]);
    expect(sortedMarkers({ markers: undefined })).toEqual([]);
  });

  it("names new markers with the smallest unused number", () => {
    expect(nextMarkerName([])).toBe("标记 1");
    expect(
      nextMarkerName([
        { id: "x", atMs: 0, name: "标记 1" },
        { id: "y", atMs: 0, name: "标记 3" },
      ]),
    ).toBe("标记 2");
  });

  it("adds a marker on the 0.1 s grid with a default name", () => {
    const next = addMarker({ ...sequence, markers: undefined }, { id: "m", atMs: 1234 });
    expect(next.markers).toEqual([{ id: "m", atMs: 1200, name: "标记 1" }]);
  });

  it("renames, ignoring blank names and clamping long ones", () => {
    expect(renameMarker(sequence, "a", "  切光  ").markers?.find((m) => m.id === "a")?.name).toBe("切光");
    expect(renameMarker(sequence, "a", "   ")).toBe(sequence);
    const long = renameMarker(sequence, "a", "一".repeat(30));
    expect([...(long.markers?.find((m) => m.id === "a")?.name ?? "")]).toHaveLength(20);
  });

  it("moves one marker to a snapped time", () => {
    expect(setMarkerTime(sequence, "b", 4560).markers?.find((m) => m.id === "b")?.atMs).toBe(4600);
    expect(setMarkerTime(sequence, "b", 3000)).toBe(sequence);
  });

  it("shifts a group from its origin and stops the earliest at 0", () => {
    const shifted = shiftMarkers(sequence, ["a", "b"], -1500);
    expect(sortedMarkers(shifted).map((marker) => marker.atMs)).toEqual([0, 2000]);
    expect(shiftMarkers(sequence, ["missing"], 500)).toBe(sequence);
  });

  it("deletes markers", () => {
    expect(deleteMarkers(sequence, ["a"]).markers?.map((marker) => marker.id)).toEqual(["b"]);
    expect(deleteMarkers(sequence, ["missing"])).toBe(sequence);
  });
});
