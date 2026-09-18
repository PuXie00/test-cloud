import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
import type { ProgramItemRef, ControlledObjectConfig, ProjectDocument } from "./project-document-types";

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
  it("does not type motion with positionCues", () => {
    const document = createEmptyDocument({ id: "t", name: "t", author: "a" });
    expect(document.motion).not.toHaveProperty("positionCues");
  });

  it("accepts empty authored sequences as structurally ok", () => {
    const document = documentOf({
      motion: {
        actionSequences: [emptySequence()],
        programs: [],
      },
    });
    expect(validateProjectDocument(document).ok).toBe(true);
  });

  it("does not throw when a sequence preset cannot be resolved", () => {
    const document = documentOf({
      motion: {
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

  it("rejects non-sequence program items and dangling sequence refs", () => {
    const document = documentOf({
      motion: {
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
                ] as unknown as ProgramItemRef[],
              },
            ],
          },
        ],
      },
    });
    const result = validateProjectDocument(document);
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes("must be sequence"))).toBe(true);
    expect(result.errors.some((error) => error.includes(17))).toBe(true);
    expect(result.errors.some((error) => error.includes("missing-cue-ref"))).toBe(false);
  });

});

describe("project-motion-readiness sequence gate", () => {
  it("blocks a missing sequence or a sequence with error issues", () => {
    const document = documentOf({
      motion: {
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
        actionSequences: [validSequence()],
        programs: [],
      },
    });
    expect(getMotionItemRepairIssue(document, "sequence", 2)).toBeNull();
    expect(resolveMotionLaunchBlock(document, "sequence", 2)).toBeNull();
  });
});

describe("virtual axis max velocity fields", () => {
  it("rejects missing pDefaultMaxVelocity when v2 is enabled", () => {
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
    expect(() => assertProjectDocumentStructure(document)).toThrow(/pDefaultMaxVelocity/);
  });

  it("rejects pDefaultMaxVelocity on v1-only objects", () => {
    const document = documentOf();
    document.setup.controlledObjects[0] = makeObject(OBJECT_A, "A", { pDefaultMaxVelocity: 3 });
    expect(() => assertProjectDocumentStructure(document)).toThrow(/pDefaultMaxVelocity/);
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
            pDefaultMaxVelocity: 3,
            yDefaultMaxVelocity: 3,
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

  it("in-repo Project json files omit positionCues and Cue program items", () => {
    const projectRoot = join(process.cwd(), "Project");
    const files = readdirSync(projectRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(projectRoot, entry.name, "project.json"))
      .filter((file) => existsSync(file));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const document = JSON.parse(readFileSync(file, "utf8")) as {
        motion?: {
          positionCues?: unknown;
          programs?: Array<{ chapters?: Array<{ items?: Array<{ kind?: string }> }> }>;
        };
      };
      expect(document.motion, file).not.toHaveProperty("positionCues");
      const items =
        document.motion?.programs?.flatMap((program) =>
          (program.chapters ?? []).flatMap((chapter) => chapter.items ?? []),
        ) ?? [];
      expect(items.every((item) => item.kind !== "cue"), file).toBe(true);
    }
  });
});
