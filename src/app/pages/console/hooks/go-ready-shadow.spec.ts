import { describe, expect, it } from "vitest";
import { applyGoBindings, isExplicitGoEntry, releaseGoEntries, type GoBindings, type GoReadyEntry } from "./go-ready";

const entry = (objectId: string, source?: GoReadyEntry["source"], dispatched = false): GoReadyEntry => ({
  objectId,
  target: { v1: 1 },
  current: { v1: 0 },
  dispatched,
  ...(source ? { source } : {}),
});

const cursorAt = (atMs: number): GoBindings =>
  new Map([["7", { target: { v1: atMs }, current: { v1: 0 }, source: { kind: "cursor", atMs } }]]);

describe("the shadow following the playhead", () => {
  it("replaces every pending target with the playhead frame, keeping the ones already moving", () => {
    const entries = [entry("7", { kind: "manual" }), entry("8", { kind: "sequence", name: "开场" }), entry("9", undefined, true)];
    const next = applyGoBindings(entries, new Map(), cursorAt(2500), true);
    expect(next.map((item) => [item.objectId, item.source])).toEqual([
      ["9", undefined],
      ["7", { kind: "cursor", atMs: 2500 }],
    ]);
  });

  it("keeps other objects' targets when binding poses", () => {
    const entries = [entry("8", { kind: "manual" })];
    expect(applyGoBindings(entries, new Map(), cursorAt(0)).map((item) => item.objectId)).toEqual(["8", "7"]);
  });

  it("goes back to the bound frame after GO, with its source", () => {
    const released = releaseGoEntries([entry("7", { kind: "manual" }, true)], ["7"], cursorAt(4000));
    expect(released[0]?.source).toEqual({ kind: "cursor", atMs: 4000 });
  });

  it("tells targets someone asked for from ones bound to poses or the playhead", () => {
    expect(isExplicitGoEntry(entry("1"))).toBe(true);
    expect(isExplicitGoEntry(entry("1", { kind: "sequence", name: "开场" }))).toBe(true);
    expect(isExplicitGoEntry(entry("1", { kind: "pose" }))).toBe(false);
    expect(isExplicitGoEntry(entry("1", { kind: "cursor", atMs: 0 }))).toBe(false);
  });
});
