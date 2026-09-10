import { describe, expect, it } from "vitest";
import { assertProjectDocumentStructure } from "../project-document-assert";
import { createEmptyDocument } from "../project-document-empty";
import type { ActionSequenceConfig } from "./types";

const sequence: ActionSequenceConfig = {
  id: "seq-1",
  name: "测试动作",
  trajectoryMode: "non-forced",
  blocks: [
    {
      id: "pose-1",
      kind: "pose",
      objectId: 7,
      atMs: 2000,
      pose: { v1: 1000, v2: 10, v3: -10 },
    },
    {
      id: "enable-1",
      kind: "set-enabled",
      objectId: 7,
      atMs: 0,
      enabled: true,
    },
  ],
  segments: [],
};

describe("action sequence project structure", () => {
  it("accepts the authored sequence schema", () => {
    const document = createEmptyDocument({ id: "p", name: "P", author: "tester" });
    document.motion.actionSequences = [sequence];
    expect(() => assertProjectDocumentStructure(document)).not.toThrow();
  });

  it("rejects old per-axis tracks", () => {
    const document = createEmptyDocument({ id: "p", name: "P", author: "tester" });
    document.motion.actionSequences = [
      {
        id: "old",
        name: "old",
        trajectoryMode: "non-forced",
        blocks: [],
        segments: [],
        totalMs: 1,
        tracks: [],
      },
    ] as never;
    expect(() => assertProjectDocumentStructure(document)).toThrow(/tracks/);
  });

  it("accepts trajectoryMode and rejects legacy or invalid structure", () => {
    const document = createEmptyDocument({ id: "p", name: "P", author: "tester" });
    const sequence: ActionSequenceConfig = {
      id: "seq-1",
      name: "序列",
      trajectoryMode: "non-forced",
      blocks: [],
      segments: [],
    };
    document.motion.actionSequences = [sequence];

    expect(() => assertProjectDocumentStructure(document)).not.toThrow();

    document.motion.actionSequences = [
      { ...sequence, trajectoryMode: "invalid" } as unknown as ActionSequenceConfig,
    ];
    expect(() => assertProjectDocumentStructure(document)).toThrow(/trajectoryMode/);

    document.motion.actionSequences = [
      { ...sequence, initialPoses: {} } as unknown as ActionSequenceConfig,
    ];
    expect(() => assertProjectDocumentStructure(document)).toThrow(/legacy initialPoses/);

    document.motion.actionSequences = [
      {
        ...sequence,
        segments: [
          {
            fromRef: "a",
            toRef: "b",
            settings: { curve: "linear" },
          },
        ],
      } as unknown as ActionSequenceConfig,
    ];
    expect(() => assertProjectDocumentStructure(document)).toThrow(/legacy curve/);
  });

  it("accepts a trapezoid motion profile on segments and dynamic presets", () => {
    const document = createEmptyDocument({ id: "p", name: "P", author: "tester" });
    const axisProfiles = {
      v1: { kind: "trapezoid" as const, params: { accelMs: 200, decelMs: 200 } },
      v2: { kind: "trapezoid" as const, params: { accelMs: 200, decelMs: 200 } },
      v3: { kind: "trapezoid" as const, params: { accelMs: 200, decelMs: 200 } },
    };
    document.motion.actionSequences = [
      {
        id: "seq-1",
        name: "序列",
        trajectoryMode: "non-forced",
        blocks: [
          {
            id: "dyn",
            kind: "dynamic-preset",
            presetId: "dynamic-level",
            startMs: 0,
            endMs: 1000,
            orderedObjectIds: [7],
            params: { startV1: 0, targetV1: 1, v2: 0, v3: 0 },
            profiles: axisProfiles,
          },
        ],
        segments: [
          {
            fromRef: "a",
            toRef: "b",
            settings: { profiles: axisProfiles },
          },
        ],
      },
    ];
    expect(() => assertProjectDocumentStructure(document)).not.toThrow();
  });

  it("rejects unmigrated ratio profile settings", () => {
    const document = createEmptyDocument({ id: "p", name: "P", author: "tester" });
    document.motion.actionSequences = [
      {
        id: "seq-1",
        name: "序列",
        trajectoryMode: "non-forced",
        blocks: [],
        segments: [
          {
            fromRef: "a",
            toRef: "b",
            settings: {
              profile: {
                kind: "trapezoid",
                params: { accelRatio: 0.2, decelRatio: 0.2 },
              },
            },
          },
        ],
      } as unknown as ActionSequenceConfig,
    ];
    expect(() => assertProjectDocumentStructure(document)).toThrow(/settings\.profiles/);
  });
});
