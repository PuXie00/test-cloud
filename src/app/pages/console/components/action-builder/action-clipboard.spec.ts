import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import {
  actionClipboard,
  buildPastedSequence,
  matchClipboardObjects,
  nextPastedSequenceName,
  retargetToSelectedObjects,
  type ClipboardObject,
} from "./action-clipboard";

const object = (id: number, name: string, controlType = 2): ClipboardObject => ({
  id,
  name,
  controlType,
});

afterEach(() => actionClipboard.clear());

describe("matchClipboardObjects", () => {
  it("prefers the same id with the same control type", () => {
    expect(matchClipboardObjects([object(7, "A")], [object(7, "改名了"), object(8, "A")])).toEqual(
      new Map([[7, 7]]),
    );
  });

  it("falls back to a unique object with the same name and control type", () => {
    const targets = [object(7, "B", 6), object(21, "A")];
    expect(matchClipboardObjects([object(7, "A")], targets)).toEqual(new Map([[7, 21]]));
  });

  it("leaves objects unmatched when the name is ambiguous or missing", () => {
    expect(matchClipboardObjects([object(7, "A")], [object(1, "A"), object(2, "A")])).toEqual(
      new Map(),
    );
    expect(matchClipboardObjects([object(7, "A")], [object(1, "B")])).toEqual(new Map());
  });

  it("never maps two sources onto one target", () => {
    expect(
      matchClipboardObjects([object(7, "A"), object(8, "A")], [object(7, "A")]),
    ).toEqual(new Map([[7, 7]]));
  });
});

describe("retargetToSelectedObjects", () => {
  it("pastes a single-object copy onto every selected object", () => {
    expect(retargetToSelectedObjects([object(7, "A")], [3, 4])).toEqual({
      ok: true,
      maps: [new Map([[7, 3]]), new Map([[7, 4]])],
    });
  });

  it("maps several objects one-to-one in track order", () => {
    expect(retargetToSelectedObjects([object(7, "A"), object(8, "B")], [3, 4])).toEqual({
      ok: true,
      maps: [new Map([[7, 3], [8, 4]])],
    });
  });

  it("asks for the same number of selected objects", () => {
    expect(retargetToSelectedObjects([object(7, "A"), object(8, "B")], [3])).toEqual({
      ok: false,
      message: "复制的动作涉及 2 个物体，请选中 2 个物体再粘贴",
    });
  });
});

describe("nextPastedSequenceName", () => {
  it("keeps the name when it is free", () => {
    expect(nextPastedSequenceName("开幕升降", ["谢幕"])).toBe("开幕升降");
  });

  it("appends a number when the name is taken", () => {
    expect(nextPastedSequenceName("开幕升降", ["开幕升降"])).toBe("开幕升降 (2)");
    expect(nextPastedSequenceName("开幕升降", ["开幕升降", "开幕升降 (2)"])).toBe("开幕升降 (3)");
  });

  it("shortens long names so the suffix fits the 8-character limit", () => {
    expect(nextPastedSequenceName("一二三四五六七八", ["一二三四五六七八"])).toBe("一二三四 (2)");
  });
});

describe("buildPastedSequence", () => {
  const source: ActionSequenceConfig = {
    id: 5,
    name: "开幕升降",
    trajectoryMode: true,
    loop: false,
    blocks: [
      { id: "a", kind: "pose", objectId: 7, atMs: 1000, pose: { v1: 0, v2: 0, v3: 0 } },
      { id: "b", kind: "pose", objectId: 7, atMs: 3000, pose: { v1: 100, v2: 0, v3: 0 } },
      { id: "c", kind: "pose", objectId: 8, atMs: 1000, pose: { v1: 0, v2: 0, v3: 0 } },
    ],
    segments: [
      {
        fromRef: "a",
        toRef: "b",
        settings: {
          profiles: {
            v1: { kind: "trapezoid", params: { accelMs: 500, decelMs: 500 } },
            v2: { kind: "idle" },
            v3: { kind: "idle" },
          },
        },
      },
    ],
  };
  const clipboard = {
    projectId: "other",
    sequence: source,
    objects: [object(7, "主吊杆"), object(8, "侧幕")],
  };

  it("creates a new sequence in another project with matched objects", () => {
    const pasted = buildPastedSequence(clipboard, {
      id: 42,
      existingNames: ["开幕升降"],
      objects: [object(3, "主吊杆"), object(4, "侧幕")],
    });
    expect(pasted.sequence).toMatchObject({ id: 42, name: "开幕升降 (2)", trajectoryMode: true });
    expect(pasted.sequence.blocks.map((block) => (block.kind === "pose" ? block.objectId : 0))).toEqual([
      3, 3, 4,
    ]);
    expect(pasted.sequence.segments.find((item) => item.fromRef === "a")?.settings.profiles.v1).toEqual(
      source.segments[0]!.settings.profiles.v1,
    );
    expect(pasted.droppedBlocks).toBe(0);
    expect(pasted.unmatchedObjectNames).toEqual([]);
  });

  it("drops blocks of objects the project does not have and names them", () => {
    const pasted = buildPastedSequence(clipboard, {
      id: 42,
      existingNames: [],
      objects: [object(3, "主吊杆")],
    });
    expect(pasted.sequence.name).toBe("开幕升降");
    expect(pasted.sequence.blocks.map((block) => block.id)).toEqual(["a", "b"]);
    expect(pasted.droppedBlocks).toBe(1);
    expect(pasted.unmatchedObjectNames).toEqual(["侧幕"]);
  });
});

describe("actionClipboard store", () => {
  it("keeps sequence and block copies apart and notifies subscribers", () => {
    const listener = vi.fn();
    const off = actionClipboard.subscribe(listener);
    actionClipboard.setSequence({
      projectId: "p",
      sequence: { id: 1, name: "S", trajectoryMode: false, blocks: [], segments: [] },
      objects: [],
    });
    actionClipboard.setBlocks({
      projectId: "p",
      objectSelectionVersion: 1,
      blocks: [],
      segments: [],
      objects: [],
    });
    off();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(actionClipboard.get().sequence?.sequence.name).toBe("S");
    expect(actionClipboard.get().blocks?.objectSelectionVersion).toBe(1);
  });

  it("stores a copy, so later edits to the source do not change the clipboard", () => {
    const sequence: ActionSequenceConfig = { id: 1, name: "S", trajectoryMode: false, blocks: [], segments: [] };
    actionClipboard.setSequence({ projectId: "p", sequence, objects: [] });
    sequence.name = "改了";
    expect(actionClipboard.get().sequence?.sequence.name).toBe("S");
  });
});
