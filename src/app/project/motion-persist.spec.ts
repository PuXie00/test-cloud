import { describe, expect, it } from "vitest";
import type { ActionSequenceConfig } from "./action-sequence/types";
import { MOTION_DEFAULTS } from "./configuration-rules";
import {
  hydrateMotionForActionBuilder,
  setupObjectToTimelineObject,
} from "./motion-adapters";
import { actionBuilderStateToMotion, legacyProgramToMotion } from "./motion-persist";
import { motionProgramToLegacyProgram } from "@/app/pages/console/components/program-panel/resolve-program-motion";
import type {
  ControlledObjectConfig,
  MotorConfig,
  ProjectMotion,
} from "./project-document-types";

const emptyMotion = (): ProjectMotion => ({
  actionSequences: [],
  programs: [],
});

describe("motion-persist authored sequences", () => {
  it("round-trips authored sequences without generating axis tracks", () => {
    const sequence: ActionSequenceConfig = {
      id: 1,
      name: "Seq",
      trajectoryMode: "non-forced",
      blocks: [
        {
          id: "pose",
          kind: "pose",
          objectId: 7,
          atMs: 1000,
          pose: { v1: 100, v2: 10, v3: 20 },
        },
      ],
      segments: [],
    };
    const motion = actionBuilderStateToMotion(
      { sequences: [sequence], programs: [] },
      { actionSequences: [], programs: [] },
    );
    expect(motion.actionSequences).toEqual([sequence]);
    expect(motion.actionSequences[0]).not.toHaveProperty("tracks");
  });

  it("never persists generated preset poses", () => {
    const dynamicPreset: ActionSequenceConfig = {
      id: 6,
      name: "Wave",
      trajectoryMode: "non-forced",
      blocks: [
        {
          id: "wave-1",
          kind: "dynamic-preset",
          presetId: "dynamic-wave",
          startMs: 1000,
          endMs: 3000,
          orderedObjectIds: [7, 8],
          params: {
            baseV1: 0,
            amplitude: 100,
            cycles: 1,
            direction: 1,
            staggerMs: 500,
            v2: 0,
            v3: 0,
          },
          profiles: {
            v1: { kind: "trapezoid", params: { accelMs: 400, decelMs: 400 } },
            v2: { kind: "trapezoid", params: { accelMs: 400, decelMs: 400 } },
            v3: { kind: "trapezoid", params: { accelMs: 400, decelMs: 400 } },
          },
        },
      ],
      segments: [],
    };
    const persisted = actionBuilderStateToMotion(
      { sequences: [dynamicPreset], programs: [] },
      { actionSequences: [], programs: [] },
    );
    expect(JSON.stringify(persisted)).not.toContain("preset:wave-1:7:0");
  });

  it("never persists default motion segments the user has not reviewed", () => {
    const sequence: ActionSequenceConfig = {
      id: 1,
      name: "Seq",
      trajectoryMode: "non-forced",
      blocks: [
        {
          id: "pose",
          kind: "pose",
          objectId: 7,
          atMs: 1000,
          pose: { v1: 100, v2: 10, v3: 20 },
        },
      ],
      segments: [],
    };
    const persisted = actionBuilderStateToMotion(
      { sequences: [sequence], programs: [] },
      emptyMotion(),
    );
    expect(persisted.actionSequences[0]?.segments).toEqual([]);
  });

  it("hydrates authored sequences by clone without axis tracks", () => {
    const sequence: ActionSequenceConfig = {
      id: 1,
      name: "Seq",
      trajectoryMode: "non-forced",
      blocks: [
        {
          id: "pose",
          kind: "pose",
          objectId: 7,
          atMs: 1000,
          pose: { v1: 100, v2: 10, v3: 20 },
        },
      ],
      segments: [],
    };
    const motion: ProjectMotion = {
      actionSequences: [sequence],
      programs: [],
    };
    const hydrated = hydrateMotionForActionBuilder(motion, { 7: "Obj" });
    expect(hydrated.sequences).toEqual([sequence]);
    expect(hydrated.sequences[0]).not.toBe(sequence);
    expect(hydrated.sequences[0]).not.toHaveProperty("tracks");
  });

  it("legacy program persist clones existing sequences and does not synthesize tracks", () => {
    const sequence: ActionSequenceConfig = {
      id: 1,
      name: "Original",
      trajectoryMode: "non-forced",
      blocks: [
        {
          id: "pose",
          kind: "pose",
          objectId: 7,
          atMs: 1000,
          pose: { v1: 100, v2: 0, v3: 0 },
        },
      ],
      segments: [],
    };
    const existing: ProjectMotion = {
      actionSequences: [sequence],
      programs: [],
    };
    const persisted = legacyProgramToMotion(
      {
        id: "prog",
        name: "Prog",
        chapters: [
          {
            id: "ch",
            name: "Ch",
            items: [
              {
                kind: "sequence",
                sequence: { id: 1, name: "Renamed by program", durationMs: 9999 },
              },
              {
                kind: "sequence",
                sequence: { id: 99, name: "Ghost", durationMs: 1 },
              },
            ],
          },
        ],
      },
      existing,
    );
    expect(persisted.actionSequences).toEqual([sequence]);
    expect(persisted.actionSequences[0]).not.toBe(sequence);
    expect(persisted.actionSequences[0]).not.toHaveProperty("tracks");
    expect(persisted.actionSequences.some((item) => item.id === 99)).toBe(false);
  });

  it("program panel display duration uses resolved totalMs", () => {
    const sequence: ActionSequenceConfig = {
      id: 1,
      name: "Seq",
      trajectoryMode: "non-forced",
      blocks: [
        {
          id: "pose",
          kind: "pose",
          objectId: 7,
          atMs: 1000,
          pose: { v1: 100, v2: 10, v3: 20 },
        },
      ],
      segments: [],
    };
    const program = motionProgramToLegacyProgram({
      actionSequences: [sequence],
      programs: [
        {
          id: "prog",
          name: "Prog",
          chapters: [
            {
              id: "ch",
              name: "Ch",
              items: [{ kind: "sequence", refId: 1 }],
            },
          ],
        },
      ],
    });
    expect(program?.chapters[0]?.items[0]).toEqual({
      kind: "sequence",
      sequence: { id: 1, name: "Seq", durationMs: 1000, trajectoryMode: "non-forced" },
    });
  });

  it("does not throw when projecting a program whose sequence has an unknown preset", () => {
    const sequence: ActionSequenceConfig = {
      id: 1,
      name: "Seq",
      trajectoryMode: "non-forced",
      blocks: [
        {
          id: "p1",
          kind: "static-preset",
          presetId: "not-a-preset",
          atMs: 1000,
          orderedObjectIds: [7],
          params: { v1: 0, v2: 0, v3: 0 },
        },
      ],
      segments: [],
    };
    const motion: ProjectMotion = {
      actionSequences: [sequence],
      programs: [
        {
          id: "prog",
          name: "Prog",
          chapters: [
            {
              id: "ch",
              name: "Ch",
              items: [{ kind: "sequence", refId: 1 }],
            },
          ],
        },
      ],
    };
    expect(() => motionProgramToLegacyProgram(motion)).not.toThrow();
    const program = motionProgramToLegacyProgram(motion);
    expect(program?.chapters[0]?.items[0]).toEqual({
      kind: "sequence",
      sequence: { id: 1, name: "Seq", durationMs: 0, trajectoryMode: "non-forced" },
    });
  });
});

const swingObject = (): ControlledObjectConfig => ({
  id: 8,
  name: "swing",
  controlType: 6,
  enabledVirtualAxes: ["v1", "v2"],
  shapePreset: "cube",
  shapeDimensions: { width: 1, height: 1, depth: 1 },
  dimensions: { w: 1, h: 1, d: 1 },
  position: { x: 0, y: 0, z: 0 },
  centerOffset: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  color: "#869398",
  pulleyDistance: 0,
  modelRunDirection: 1,
  safetyRadius: 1000,
  driveAxes: [
    { key: "0", mount: { x: 0, z: 0 } },
    { key: "1", mount: { x: 0, z: 0 } },
  ],
  maxAxisVelocity: 200,
  pDefaultMaxVelocity: 4,
  motionParams: {
    move: { ...MOTION_DEFAULTS.move },
    swingX: { ...MOTION_DEFAULTS.swingX },
  },
  params: {},
});

const boundMotors = (): MotorConfig[] => [
  {
    id: 1,
    productModel: "YZ_AXIS_HOIST_500KG",
    plcId: 1,
    busNo: 0,
    axisType: 0,
    nodeAddress: null,
    controlledObjectId: 8,
    axisKey: "0",
    params: { maxAxisVelocity: 400 },
  },
  {
    id: 2,
    productModel: "YZ_AXIS_HOIST_500KG",
    plcId: 1,
    busNo: 0,
    axisType: 0,
    nodeAddress: null,
    controlledObjectId: 8,
    axisKey: "1",
    params: { maxAxisVelocity: 180 },
  },
];

describe("hydrateMotionForActionBuilder maxSpeedByAxis", () => {
  it("uses bound motor min for v1 and object fields for v2", () => {
    const object = swingObject();
    const motors = boundMotors();
    const timeline = setupObjectToTimelineObject(object, motors);
    expect(timeline.maxSpeedByAxis?.v1).toBe(180);
    expect(timeline.maxSpeedByAxis?.v2).toBe(4);

    const hydrated = hydrateMotionForActionBuilder(
      { actionSequences: [], programs: [] },
      { 8: "swing" },
      [object],
      motors,
    );
    expect(hydrated.timelineObjects[0]?.maxSpeedByAxis?.v1).toBe(180);
    expect(hydrated.timelineObjects[0]?.maxSpeedByAxis?.v2).toBe(4);
  });

  it("hydrates minAccelTimeByAxis from setup motion params", () => {
    const object = swingObject();
    const motors = boundMotors();
    const timeline = setupObjectToTimelineObject(object, motors);
    expect(timeline.minAccelTimeByAxis?.v1).toBe(1);
    expect(timeline.minAccelTimeByAxis?.v2).toBe(1);

    const hydrated = hydrateMotionForActionBuilder(
      { actionSequences: [], programs: [] },
      { 8: "swing" },
      [object],
      motors,
    );
    expect(hydrated.timelineObjects[0]?.minAccelTimeByAxis?.v1).toBe(1);
    expect(hydrated.timelineObjects[0]?.minAccelTimeByAxis?.v2).toBe(1);
  });
});
