import { describe, expect, it } from "vitest";
import { MOTION_DEFAULTS } from "./configuration-rules";
import {
  analyzeObjectDeletion,
  applyObjectDeletion,
} from "./project-object-deletion";
import { validateProjectDocument } from "./project-document-validate";
import {
  PROJECT_SCHEMA_VERSION,
  type ControlledObjectConfig,
  type MotorConfig,
  type ProgramItemRef,
  type ProjectDocument,
} from "./project-document-types";
import { createDefaultSavedView } from "./saved-view";

const PLC_1 = 10;
const OBJECT_A = 1;
const OBJECT_B = 2;
const OBJECT_C = 3;
const MOTOR_A_1 = 11;
const MOTOR_A_2 = 12;
const MOTOR_B_1 = 13;
const LONE = 20;

const staticSlopePreset = (
  id: string,
  orderedObjectIds: number[],
  atMs = 3000,
) => ({
  id,
  kind: "static-preset" as const,
  presetId: "static-slope",
  orderedObjectIds,
  atMs,
  params: { baseV1: 0, stepV1: 10, v2: 0, v3: 0 },
});

const makeObject = (
  id: number,
  name: string,
  overrides: Partial<ControlledObjectConfig> = {},
): ControlledObjectConfig => ({
  id,
  name,
  controlType: 2,
  enabledVirtualAxes: ["v1"],
  shapePreset: "cube",
  shapeDimensions: { width: 1000, height: 1000, depth: 1000 },
  dimensions: { w: 1000, h: 1000, d: 1000 },
  position: { x: 0, y: 0, z: 0 },
  centerOffset: { x: 0, y: 0, z: 0 },
  color: "#869398",
  pulleyDistance: 0,
  modelRunDirection: 1,
  driveAxes: [{ key: "0" }],
  maxAxisVelocity: 200,
  motionParams: { move: { ...MOTION_DEFAULTS.move } },
  params: {},
  ...overrides,
});

const makeMotor = (
  id: number,
  controlledObjectId: number | null,
  axisKey: string | null = "0",
): MotorConfig => ({
  id,
  productModel: "YZ_AXIS_HOIST_500KG",
  plcId: PLC_1,
  busNo: 0,
  axisType: 0,
  nodeAddress: "1.1",
  controlledObjectId,
  axisKey,
  params: {},
});

const baseMeta = {
  id: "proj-del",
  name: "deletion fixture",
  createdAt: "2026-08-10T00:00:00Z",
  modifiedAt: "2026-08-10T00:00:00Z",
  author: "test",
  wizard: {
    currentStep: "objects" as const,
    completedSteps: [] as const,
    skippedSteps: [] as const,
    simulationOnly: true,
    wizardCompleted: false,
  },
};

const cascadeDocument = (): ProjectDocument => {
  const objectA = makeObject(OBJECT_A, "Object A");
  const objectB = makeObject(OBJECT_B, "Object B");
  const seqUntouched = {
    id: 11,
    name: "Seq Untouched",
    trajectoryMode: "non-forced" as const,
    blocks: [
      {
        id: "b-untouched",
        kind: "pose" as const,
        objectId: OBJECT_B,
        atMs: 1000,
        pose: { v1: 10, v2: 0, v3: 0 },
      },
    ],
    segments: [],
  };
  const seqEmptyAfter = {
    id: 12,
    name: "Seq Empty After",
    trajectoryMode: "non-forced" as const,
    blocks: [
      {
        id: "b-a-1",
        kind: "pose" as const,
        objectId: OBJECT_A,
        atMs: 500,
        pose: { v1: 100, v2: 0, v3: 0 },
      },
      {
        id: "b-a-2",
        kind: "instruction" as const,
        presetId: "set-enabled" as const,
        objectId: OBJECT_A,
        atMs: 0,
        instr: { enabled: true },
      },
    ],
    segments: [],
  };
  const seqKeep = {
    id: 13,
    name: "Seq Keep",
    trajectoryMode: "non-forced" as const,
    blocks: [
      {
        id: "b-a-3",
        kind: "pose" as const,
        objectId: OBJECT_A,
        atMs: 200,
        pose: { v1: 20, v2: 0, v3: 0 },
      },
      {
        id: "b-b-1",
        kind: "pose" as const,
        objectId: OBJECT_B,
        atMs: 200,
        pose: { v1: 30, v2: 0, v3: 0 },
      },
    ],
    segments: [],
  };
  const programs = [
    {
      id: "program-1",
      name: "Program",
      chapters: [
        {
          id: "ch-1",
          name: "Chapter",
          items: [
            { kind: "sequence" as const, refId: 12 },
            { kind: "sequence" as const, refId: 13 },
          ],
        },
      ],
    },
  ];
  const rules = {
    rules: [{ id: "rule-1", name: "Rule", enabled: true }],
  };

  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    meta: baseMeta,
    setup: {
      plcs: [
        {
          id: PLC_1,
          masterTypeId: "AC810_1",
          ip: "192.168.1.100",
        },
      ],
      motors: [
        makeMotor(MOTOR_A_1, OBJECT_A),
        makeMotor(MOTOR_A_2, OBJECT_A),
        makeMotor(MOTOR_B_1, OBJECT_B),
      ],
      controlledObjects: [objectA, objectB],
      alignment: {
        [String(OBJECT_A)]: {
          method: "distance",
          status: "aligned",
          alignedAt: "2026-08-10T00:00:00Z",
        },
        [String(OBJECT_B)]: { method: null, status: "not_started", alignedAt: null },
      },
      scene: {
        groups: [
          { id: "group-1", name: "G1", objectIds: [OBJECT_A, OBJECT_B] },
          { id: "group-2", name: "G2", objectIds: [OBJECT_A] },
          { id: "group-empty", name: "Empty", objectIds: [] },
        ],
      },
    },
    motion: {
      actionSequences: [seqUntouched, seqEmptyAfter, seqKeep],
      programs,
    },
    rules,
    view: createDefaultSavedView(),
    snapshots: [],
  };
};

describe("analyzeObjectDeletion / applyObjectDeletion", () => {
  it("analyzes cascade impact and atomically deletes with structural sharing", () => {
    const document = cascadeDocument();
    const impact = analyzeObjectDeletion(document, [OBJECT_A], "state-7");

    expect(impact).toMatchObject({
      stateId: "state-7",
      objectIds: [OBJECT_A],
      objectNames: ["Object A"],
      motorBindingCount: 2,
      alignmentCount: 1,
      sceneGroupCount: 2,
      sceneGroupMemberCount: 2,
      sequenceCount: 2,
      trackCount: 2,
      blockCount: 3,
      emptySequenceIds: [12],
      affectedRuleIds: [],
    });

    const next = applyObjectDeletion(document, [OBJECT_A]);

    expect(next.setup.controlledObjects).not.toContainEqual(
      expect.objectContaining({ id: OBJECT_A }),
    );
    expect(
      next.setup.motors.filter((motor) => motor.controlledObjectId === OBJECT_A),
    ).toEqual([]);
    expect(next.setup.motors.find((m) => m.id === MOTOR_A_1)).toMatchObject({
      controlledObjectId: null,
      axisKey: null,
    });
    expect(next.setup.alignment).not.toHaveProperty(String(OBJECT_A));
    expect(next.setup.alignment).toHaveProperty(String(OBJECT_B));
    expect(next.setup.scene?.groups.find((g) => g.id === "group-2")).toMatchObject({
      objectIds: [],
    });
    expect(next.setup.scene?.groups.find((g) => g.id === "group-empty")).toMatchObject({
      objectIds: [],
    });
    expect(
      next.motion.actionSequences.find(
        (sequence) => sequence.id === 12,
      ),
    ).toBeUndefined();
    expect(JSON.stringify(next.motion.programs)).not.toContain(
      12,
    );
    expect(next.rules).toBe(document.rules);
    expect(next.motion.actionSequences.find((s) => s.id === 11)).toBe(
      document.motion.actionSequences.find((s) => s.id === 11),
    );
    expect(next.setup.motors.find((m) => m.id === MOTOR_B_1)).toBe(
      document.setup.motors.find((m) => m.id === MOTOR_B_1),
    );
    expect(validateProjectDocument(next).ok).toBe(true);
    expect(document.setup.controlledObjects.some((o) => o.id === OBJECT_A)).toBe(true);
  });

  it("dedupes ids and ignores missing ids for names and counts", () => {
    const document = cascadeDocument();
    const impact = analyzeObjectDeletion(
      document,
      [OBJECT_A, OBJECT_A, 999, OBJECT_B],
      "state-9",
    );

    expect(impact.objectIds).toEqual([OBJECT_A, OBJECT_B]);
    expect(impact.objectNames).toEqual(["Object A", "Object B"]);
    expect(impact.objectIds).not.toContain(999);
    expect(impact.objectNames).not.toContain(undefined);

    const next = applyObjectDeletion(document, [OBJECT_A, OBJECT_A, 999, OBJECT_B]);
    expect(next.setup.controlledObjects).toEqual([]);
    expect(validateProjectDocument(next).ok).toBe(true);
  });

  it("deletes only the object when it has no references", () => {
    const lone = makeObject(LONE, "Lone");
    const document: ProjectDocument = {
      ...cascadeDocument(),
      setup: {
        plcs: [],
        motors: [],
        controlledObjects: [lone],
        alignment: {},
      },
      motion: { actionSequences: [], programs: [] },
      rules: { rules: [] },
    };

    const impact = analyzeObjectDeletion(document, [LONE], "s1");
    expect(impact).toMatchObject({
      objectIds: [LONE],
      objectNames: ["Lone"],
      motorBindingCount: 0,
      alignmentCount: 0,
      sceneGroupCount: 0,
      sceneGroupMemberCount: 0,
      sequenceCount: 0,
      trackCount: 0,
      blockCount: 0,
      emptySequenceIds: [],
      affectedRuleIds: [],
    });

    const next = applyObjectDeletion(document, [LONE]);
    expect(next.setup.controlledObjects).toEqual([]);
    expect(next.motion).toBe(document.motion);
    expect(next.rules).toBe(document.rules);
    expect(validateProjectDocument(next).ok).toBe(true);
  });

  it("returns the same document reference for semantic no-op", () => {
    const document = cascadeDocument();
    expect(applyObjectDeletion(document, [])).toBe(document);
    expect(applyObjectDeletion(document, [999])).toBe(document);
  });

  it("keeps current rules schema by reference and empty affectedRuleIds", () => {
    const document = cascadeDocument();
    const impact = analyzeObjectDeletion(document, [OBJECT_A], "s");
    expect(impact.affectedRuleIds).toEqual([]);
    const next = applyObjectDeletion(document, [OBJECT_A]);
    expect(next.rules).toBe(document.rules);
    expect(next.rules.rules[0]).toBe(document.rules.rules[0]);
  });

  it("removes an object from poses, commands, and preset participants", () => {
    const next = applyObjectDeletion(cascadeDocument(), [OBJECT_A]);
    for (const sequence of next.motion.actionSequences) {
      expect(sequence).not.toHaveProperty("initialPoses");
      expect(
        sequence.blocks.some(
          (block) => "objectId" in block && block.objectId === OBJECT_A,
        ),
      ).toBe(false);
      expect(
        sequence.blocks.some(
          (block) =>
            "orderedObjectIds" in block &&
            block.orderedObjectIds.includes(OBJECT_A),
        ),
      ).toBe(false);
    }
  });

  it("removes empty sequences and their program references", () => {
    const document = cascadeDocument();
    document.motion.actionSequences = [
      {
        id: 5,
        name: "Only",
        trajectoryMode: "non-forced",
        blocks: [
          {
            id: "only-pose",
            kind: "pose",
            objectId: OBJECT_A,
            atMs: 0,
            pose: { v1: 0, v2: 0, v3: 0 },
          },
        ],
        segments: [],
      },
    ];
    document.motion.programs[0].chapters[0].items = [
      { kind: "sequence", refId: 5 },
    ];
    const next = applyObjectDeletion(document, [OBJECT_A]);
    expect(next.motion.actionSequences).toEqual([]);
    expect(JSON.stringify(next.motion.programs)).not.toContain(5);
  });

  it("keeps a preset when remaining participants meet minObjects", () => {
    const document = cascadeDocument();
    document.setup.controlledObjects.push(makeObject(OBJECT_C, "Object C"));
    const keep = document.motion.actionSequences.find(
      (sequence) => sequence.id === 13,
    )!;
    keep.blocks.push(staticSlopePreset("preset-keep", [OBJECT_A, OBJECT_B, OBJECT_C]));
    const next = applyObjectDeletion(document, [OBJECT_A]);
    const sequence = next.motion.actionSequences.find(
      (entry) => entry.id === 13,
    );
    const preset = sequence?.blocks.find((block) => block.id === "preset-keep");
    expect(preset).toMatchObject({
      kind: "static-preset",
      orderedObjectIds: [OBJECT_B, OBJECT_C],
    });
  });

  it("drops a preset when remaining participants fall below minObjects", () => {
    const document = cascadeDocument();
    const keep = document.motion.actionSequences.find(
      (sequence) => sequence.id === 13,
    )!;
    keep.blocks.push(staticSlopePreset("preset-drop", [OBJECT_A, OBJECT_B]));
    const next = applyObjectDeletion(document, [OBJECT_A]);
    const sequence = next.motion.actionSequences.find(
      (entry) => entry.id === 13,
    );
    expect(sequence?.blocks.some((block) => block.id === "preset-drop")).toBe(false);
  });

  it("drops empty sequences while keeping remaining sequences", () => {
    const next = applyObjectDeletion(cascadeDocument(), [OBJECT_A]);
    expect(
      next.motion.actionSequences.some(
        (sequence) => sequence.id === 12,
      ),
    ).toBe(false);
    expect(
      next.motion.programs
        .flatMap((program) => program.chapters)
        .flatMap((chapter) => chapter.items)
        .some(
          (item) =>
            item.kind === "sequence" && item.refId === 12,
        ),
    ).toBe(false);
    const keep = next.motion.actionSequences.find(
      (sequence) => sequence.id === 13,
    );
    expect(keep).toBeTruthy();
    expect(keep?.blocks).toHaveLength(1);
    expect(
      keep?.blocks.some(
        (block) => "objectId" in block && block.objectId === OBJECT_A,
      ),
    ).toBe(false);
    expect(
      analyzeObjectDeletion(cascadeDocument(), [OBJECT_A], "confirm").emptySequenceIds,
    ).toContain(12);
  });
});

describe("validateProjectDocument reference consistency (deletion-related)", () => {
  it("does not leave empty sequences", () => {
    const document = applyObjectDeletion(cascadeDocument(), [OBJECT_A]);
    const emptySeq = document.motion.actionSequences.find(
      (s) => s.id === 12,
    );
    expect(emptySeq).toBeUndefined();
    expect(validateProjectDocument(document).ok).toBe(true);
  });

  it("reports dangling motor controlledObjectId", () => {
    const document = cascadeDocument();
    document.setup.motors[0] = {
      ...document.setup.motors[0],
      controlledObjectId: 999,
      axisKey: "0",
    };
    const result = validateProjectDocument(document);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("999"))).toBe(true);
  });

  it("reports dangling motor axisKey on bound object", () => {
    const document = cascadeDocument();
    document.setup.motors[0] = {
      ...document.setup.motors[0],
      controlledObjectId: OBJECT_A,
      axisKey: "missing-axis",
    };
    const result = validateProjectDocument(document);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("missing-axis"))).toBe(true);
  });

  it("reports dangling alignment key", () => {
    const document = cascadeDocument();
    document.setup.alignment["ghost-align"] = {
      method: null,
      status: "not_started",
      alignedAt: null,
    };
    const result = validateProjectDocument(document);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("ghost-align"))).toBe(true);
  });

  it("reports dangling scene group object id", () => {
    const document = cascadeDocument();
    document.setup.scene = {
      groups: [{ id: "g", name: "G", objectIds: [998] }],
    };
    const result = validateProjectDocument(document);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("998"))).toBe(true);
  });

  it("reports unknown objects in authored sequence poses", () => {
    const document = cascadeDocument();
    document.motion.actionSequences[0] = {
      ...document.motion.actionSequences[0],
      blocks: [
        {
          id: "ghost-pose",
          kind: "pose",
          objectId: 996,
          atMs: 1000,
          pose: { v1: 1, v2: 0, v3: 0 },
        },
      ],
      segments: [],
    };
    const missingObject = validateProjectDocument(document);
    expect(missingObject.ok).toBe(false);
    expect(missingObject.errors.some((e) => e.includes("996"))).toBe(true);
  });

  it("reports dangling program sequence refs and rejects leftover Cue items", () => {
    const document = cascadeDocument();
    document.motion.programs[0] = {
      id: "p-bad",
      name: "Bad",
      chapters: [
        {
          id: "ch",
          name: "Ch",
          items: [
            { kind: "cue", refId: "missing-cue-ref" },
            { kind: "sequence", refId: 17 },
          ] as unknown as ProgramItemRef[],
        },
      ],
    };
    const result = validateProjectDocument(document);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("must be sequence"))).toBe(true);
    expect(result.errors.some((e) => e.includes(17))).toBe(true);
    expect(result.errors.some((e) => e.includes("missing-cue-ref"))).toBe(false);
  });
});
