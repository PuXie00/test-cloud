import { describe, expect, it } from "vitest";
import { planAiSequenceUpsert } from "../src/app/ai-bridge/ai-sequence-upsert";
import { MOTION_DEFAULTS } from "../src/app/project/configuration-rules";
import type { ActionSequenceConfig } from "../src/app/project/action-sequence/types";
import { createEmptyDocument } from "../src/app/project/project-document-empty";
import type {
  ControlledObjectConfig,
  ProjectDocument,
} from "../src/app/project/project-document-types";

const OBJECT_A = 1;

const makeObject = (id: number, name: string): ControlledObjectConfig => ({
  id,
  name,
  controlType: 2,
  enabledVirtualAxes: ["v1"],
  shapePreset: "cube",
  shapeDimensions: { width: 1000, height: 1000, depth: 1000 },
  dimensions: { w: 1000, h: 1000, d: 1000 },
  position: { x: 0, y: 0, z: 0 },
  centerOffset: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  color: "#869398",
  pulleyDistance: 0,
  modelRunDirection: 1,
  driveAxes: [{ key: "0", mount: { x: 0, z: 0 } }],
  maxAxisVelocity: 200,
  motionParams: { h: { ...MOTION_DEFAULTS.move } },
  params: {},
});

const existing: ActionSequenceConfig = {
  id: 5,
  name: "开场",
  trajectoryMode: false,
  blocks: [],
  segments: [],
};

const documentOf = (): ProjectDocument => {
  const document = createEmptyDocument({ id: "p", name: "P", author: "tester" });
  document.setup.controlledObjects = [makeObject(OBJECT_A, "A")];
  document.motion.actionSequences = [existing];
  return document;
};

const rise = (id: number, name: string, toV1 = 100): ActionSequenceConfig => ({
  id,
  name,
  trajectoryMode: false,
  blocks: [
    { id: "p0", kind: "pose", objectId: OBJECT_A, atMs: 0, pose: { v1: 0 } },
    { id: "p1", kind: "pose", objectId: OBJECT_A, atMs: 4000, pose: { v1: toV1 } },
  ],
  segments: [],
});

describe("planAiSequenceUpsert", () => {
  it("appends a sequence under a new caller-chosen id", () => {
    const document = documentOf();
    const plan = planAiSequenceUpsert(document, rise(9, "上升"));
    expect(plan.result).toMatchObject({ ok: true, created: true, changed: true });
    expect(plan.document?.motion.actionSequences.map((item) => item.id)).toEqual([5, 9]);
    // 只动 motion，其他分区原样保留
    expect(plan.document?.setup).toBe(document.setup);
  });

  it("replaces the sequence with the same id in place", () => {
    const document = documentOf();
    document.motion.actionSequences = [existing, { ...existing, id: 6, name: "收尾" }];
    const plan = planAiSequenceUpsert(document, rise(5, " 开场 "));
    expect(plan.result).toMatchObject({ ok: true, created: false, changed: true });
    const sequences = plan.document!.motion.actionSequences;
    expect(sequences.map((item) => item.id)).toEqual([5, 6]);
    expect(sequences[0].name).toBe("开场");
    expect(sequences[0].blocks).toHaveLength(2);
  });

  it("reports no change for an identical sequence regardless of key order", () => {
    const document = documentOf();
    const reordered = { segments: [], blocks: [], trajectoryMode: false, name: "开场", id: 5 };
    const plan = planAiSequenceUpsert(document, reordered);
    expect(plan.result).toMatchObject({ ok: true, created: false, changed: false });
    expect(plan.document).toBeUndefined();
  });

  it("rejects a body that does not match the project sequence structure", () => {
    const plan = planAiSequenceUpsert(documentOf(), { id: 9, name: "x", blocks: [] });
    expect(plan.result).toMatchObject({ ok: false, code: "INVALID_SEQUENCE" });
    expect(plan.document).toBeUndefined();

    const badId = planAiSequenceUpsert(documentOf(), { ...rise(0, "x") });
    expect(badId.result).toMatchObject({ ok: false, code: "INVALID_SEQUENCE" });
  });

  it("rejects a name taken by another sequence or longer than 8 characters", () => {
    expect(planAiSequenceUpsert(documentOf(), rise(9, "开场")).result).toMatchObject({
      ok: false,
      code: "VALIDATION_FAILED",
      message: "序列名：序列名已存在",
    });
    expect(planAiSequenceUpsert(documentOf(), rise(9, "123456789")).result).toMatchObject({
      ok: false,
      code: "VALIDATION_FAILED",
    });
  });

  it("rejects duplicate block ids and unknown objects", () => {
    const sequence = rise(9, "上升");
    sequence.blocks[1] = { ...sequence.blocks[1], id: "p0" };
    expect(planAiSequenceUpsert(documentOf(), sequence).result).toMatchObject({
      ok: false,
      code: "VALIDATION_FAILED",
      message: "块 id 重复：p0",
    });

    const ghost = rise(9, "上升");
    ghost.blocks = ghost.blocks.map((block) => ({ ...block, objectId: 99 }));
    expect(planAiSequenceUpsert(documentOf(), ghost).result).toMatchObject({
      ok: false,
      code: "VALIDATION_FAILED",
      message: expect.stringContaining("unknown object 99"),
    });
  });

  it("rejects blocking sequence issues and returns them", () => {
    const plan = planAiSequenceUpsert(documentOf(), rise(9, "上升", 5000));
    expect(plan.result.ok).toBe(false);
    if (plan.result.ok) return;
    expect(plan.result.code).toBe("VALIDATION_FAILED");
    expect(plan.result.issues?.map((issue) => issue.code)).toContain("limit-exceeded");
    expect(plan.document).toBeUndefined();
  });

  it("rejects loop on a sequence whose start and end poses differ", () => {
    const plan = planAiSequenceUpsert(documentOf(), { ...rise(9, "上升"), loop: true });
    expect(plan.result).toMatchObject({
      ok: false,
      code: "VALIDATION_FAILED",
      message: "起点与终点位姿不一致，无法循环",
    });
  });
});
