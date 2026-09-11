import { describe, expect, it } from "vitest";
import { MOTION_DEFAULTS } from "./configuration-rules";
import type { ActionSequenceConfig } from "./action-sequence/types";
import { GZ_2025_DOCUMENT } from "./mock-documents/gz-2025.document";
import { SH_BALLET_DOCUMENT } from "./mock-documents/sh-ballet.document";
import { createEmptyDocument } from "./project-document-empty";
import { assertProjectDocumentStructure } from "./project-document-assert";
import { validateProjectDocument } from "./project-document-validate";
import {
  getMotionItemRepairIssue,
  getProgramRepairIssues,
  resolveMotionLaunchBlock,
} from "./project-motion-readiness";
import type { ControlledObjectConfig, ProjectDocument } from "./project-document-types";

const OBJECT_A = 1;
const OBJECT_B = 2;

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
  rotation: { x: 0, y: 0, z: 0 },
  color: "#869398",
  pulleyDistance: 0,
  modelRunDirection: 1,
  driveAxes: [{ key: "0", mount: { x: 0, z: 0 } }],
  maxAxisVelocity: 200,
  motionParams: { move: { ...MOTION_DEFAULTS.move } },
  params: {},
  ...overrides,
});

const origin = { v1: 0, v2: 0, v3: 0 };

const emptySequence = (id = 1): ActionSequenceConfig => ({
  id,
  name: "Empty",
  trajectoryMode: "non-forced",
  blocks: [],
  segments: [],
});

const validSequence = (id = 2): ActionSequenceConfig => ({
  id,
  name: "Ok",
  trajectoryMode: "non-forced",
  blocks: [
    {
      id: "pose-1",
      kind: "pose",
      objectId: OBJECT_A,
      atMs: 1000,
      pose: { v1: 80, v2: 0, v3: 0 },
    },
  ],
  segments: [],
});

const documentOf = (
  extra?: Partial<Pick<ProjectDocument, "setup" | "motion">>,
): ProjectDocument => {
  const document = createEmptyDocument({ id: "p", name: "P", author: "tester" });
  document.setup.controlledObjects = [makeObject(OBJECT_A, "A"), makeObject(OBJECT_B, "B")];
  if (extra?.setup) Object.assign(document.setup, extra.setup);
  if (extra?.motion) Object.assign(document.motion, extra.motion);
  return document;
};

describe("validateProjectDocument sequence refs", () => {
  it("accepts empty authored sequences as structurally ok", () => {
    const document = documentOf({
      motion: {
        positionCues: [],
        actionSequences: [emptySequence()],
        programs: [],
      },
    });
    expect(validateProjectDocument(document).ok).toBe(true);
  });

  it("does not throw when a sequence preset cannot be resolved", () => {
    const document = documentOf({
      motion: {
        positionCues: [],
        actionSequences: [
          {
            id: 3,
            name: "Bad",
            trajectoryMode: "non-forced",
            blocks: [
              {
                id: "p1",
                kind: "static-preset",
                presetId: "not-a-preset",
                atMs: 1000,
                orderedObjectIds: [OBJECT_A, OBJECT_B],
                params: { v1: 0, v2: 0, v3: 0 },
              },
            ],
            segments: [],
          },
        ],
        programs: [],
      },
    });
    expect(() => validateProjectDocument(document)).not.toThrow();
    expect(validateProjectDocument(document).ok).toBe(true);
  });

  it("reports unknown objects in pose blocks, commands, and presets", () => {
    const document = documentOf({
      motion: {
        positionCues: [],
        actionSequences: [
          {
            id: 4,
            name: "Refs",
            trajectoryMode: "non-forced",
            blocks: [
              { id: "pose", kind: "pose", objectId: 98, atMs: 1000, pose: origin },
              { id: "cmd", kind: "instruction",
      presetId: "set-enabled", objectId: 97, atMs: 0, instr: { enabled: true } },
              {
                id: "preset",
                kind: "static-preset",
                presetId: "static-flat",
                atMs: 500,
                orderedObjectIds: [OBJECT_A, 96],
                params: { v1: 0, v2: 0, v3: 0 },
              },
            ],
            segments: [],
          },
        ],
        programs: [],
      },
    });
    const result = validateProjectDocument(document);
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes("98"))).toBe(true);
    expect(result.errors.some((error) => error.includes("97"))).toBe(true);
    expect(result.errors.some((error) => error.includes("96"))).toBe(true);
  });

  it("reports dangling program cue and sequence refs", () => {
    const document = documentOf({
      motion: {
        positionCues: [],
        actionSequences: [emptySequence(1)],
        programs: [
          {
            id: "p-bad",
            name: "Bad",
            chapters: [
              {
                id: "ch",
                name: "Ch",
                items: [
                  { kind: "cue", refId: "missing-cue-ref" },
                  { kind: "sequence", refId: 17 },
                ],
              },
            ],
          },
        ],
      },
    });
    const result = validateProjectDocument(document);
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes("missing-cue-ref"))).toBe(true);
    expect(result.errors.some((error) => error.includes(17))).toBe(true);
  });

  it("still reports cue unknown objects and disabled axes", () => {
    const document = documentOf({
      motion: {
        positionCues: [
          { id: "cue-ghost", name: "Ghost", targets: { "77": { v1: 1 } } },
          { id: "cue-axis", name: "Axis", targets: { [String(OBJECT_A)]: { v3: 1 } } },
        ],
        actionSequences: [],
        programs: [],
      },
    });
    const result = validateProjectDocument(document);
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes("77"))).toBe(true);
    expect(result.errors.some((error) => error.includes("v3"))).toBe(true);
  });
});

describe("project-motion-readiness sequence gate", () => {
  it("preserves Cue empty and missing behavior", () => {
    const document = documentOf({
      motion: {
        positionCues: [
          { id: "cue-empty", name: "Empty", targets: {} },
          { id: "cue-ok", name: "Ok", targets: { [String(OBJECT_A)]: { v1: 1 } } },
        ],
        actionSequences: [],
        programs: [],
      },
    });
    expect(getMotionItemRepairIssue(document, "cue", "cue-empty")?.code).toBe("empty-cue");
    expect(getMotionItemRepairIssue(document, "cue", "cue-ok")).toBeNull();
    expect(getMotionItemRepairIssue(document, "cue", "missing")?.code).toBe("empty-cue");
    expect(resolveMotionLaunchBlock(null, "cue", "cue-ok")?.code).toBe("empty-cue");
  });

  it("blocks a missing sequence or a sequence with error issues", () => {
    const document = documentOf({
      motion: {
        positionCues: [],
        actionSequences: [
          {
            id: 98,
            name: "Invalid",
            trajectoryMode: "non-forced",
            blocks: [
              { id: "pose", kind: "pose", objectId: OBJECT_A, atMs: -1, pose: { v1: 80, v2: 0, v3: 0 } },
            ],
            segments: [],
          },
        ],
        programs: [
          {
            id: "prog",
            name: "Prog",
            chapters: [
              {
                id: "ch",
                name: "Ch",
                items: [
                  { kind: "sequence", refId: 98 },
                  { kind: "sequence", refId: 96 },
                ],
              },
            ],
          },
        ],
      },
    });
    expect(getMotionItemRepairIssue(document, "sequence", 96)?.code).toBe(
      "empty-sequence",
    );
    expect(getMotionItemRepairIssue(document, "sequence", 98)?.code).toBe(
      "empty-sequence",
    );
    expect(resolveMotionLaunchBlock(document, "sequence", 98)).not.toBeNull();
    expect(
      getProgramRepairIssues(document, "prog")
        .map((issue) => issue.itemId)
        .sort((left, right) => Number(left) - Number(right)),
    ).toEqual([96, 98]);
  });

  it("allows a sequence that exists and has no error-severity issues", () => {
    const document = documentOf({
      motion: {
        positionCues: [],
        actionSequences: [validSequence()],
        programs: [],
      },
    });
    expect(getMotionItemRepairIssue(document, "sequence", 2)).toBeNull();
    expect(resolveMotionLaunchBlock(document, "sequence", 2)).toBeNull();
  });
});

describe("virtual axis max velocity fields", () => {
  it("rejects missing pMaxVelocity when v2 is enabled", () => {
    const document = documentOf({
      setup: {
        plcs: [],
        motors: [],
        controlledObjects: [
          makeObject(OBJECT_A, "A", {
            controlType: 6,
            enabledVirtualAxes: ["v1", "v2"],
            motionParams: {
              move: { ...MOTION_DEFAULTS.move },
              swingX: { ...MOTION_DEFAULTS.swingX },
            },
            driveAxes: [
              { key: "0", mount: { x: 0, z: 0 } },
              { key: "1", mount: { x: 1, z: 0 } },
            ],
          }),
        ],
        alignment: {},
      },
    });
    expect(() => assertProjectDocumentStructure(document)).toThrow(/pMaxVelocity/);
  });

  it("rejects pMaxVelocity on v1-only objects", () => {
    const document = documentOf();
    document.setup.controlledObjects[0] = makeObject(OBJECT_A, "A", { pMaxVelocity: 3 });
    expect(() => assertProjectDocumentStructure(document)).toThrow(/pMaxVelocity/);
  });

  it("accepts swing objects with p/y max velocity", () => {
    const document = documentOf({
      setup: {
        plcs: [],
        motors: [],
        controlledObjects: [
          makeObject(OBJECT_A, "A", {
            controlType: 7,
            enabledVirtualAxes: ["v1", "v2", "v3"],
            pMaxVelocity: 3,
            yMaxVelocity: 3,
            safetyRadius: 1000,
            initialTiltDirection: 0,
            mountRotation: 0,
            motionParams: {
              move: { ...MOTION_DEFAULTS.move },
              swingX: { ...MOTION_DEFAULTS.swingX },
              yawY: { ...MOTION_DEFAULTS.yawY },
            },
            driveAxes: [
              { key: "0", mount: { x: 0, z: 0 } },
              { key: "1", mount: { x: 1, z: 0 } },
              { key: "2", mount: { x: 0, z: 1 } },
              { key: "3", mount: { x: 1, z: 1 } },
            ],
          }),
        ],
        alignment: {},
      },
    });
    expect(() => assertProjectDocumentStructure(document)).not.toThrow();
  });

  it("mock documents satisfy virtual-axis max fields", () => {
    expect(() => assertProjectDocumentStructure(GZ_2025_DOCUMENT)).not.toThrow();
    expect(() => assertProjectDocumentStructure(SH_BALLET_DOCUMENT)).not.toThrow();
  });
});
