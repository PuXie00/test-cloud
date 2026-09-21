import { describe, expect, it } from "vitest";
import { assertProjectDocumentStructure } from "../project-document-assert";
import { createEmptyDocument } from "../project-document-empty";
import type { ActionSequenceConfig } from "./types";

const sequence: ActionSequenceConfig = {
  id: 1,
  name: "测试动作",
  trajectoryMode: false,
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
      kind: "instruction",
      presetId: "set-enabled",
      objectId: 7,
      atMs: 0,
      instr: { enabled: true },
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
        id: 1,
        name: "old",
        trajectoryMode: false,
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
      id: 1,
      name: "序列",
      trajectoryMode: false,
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

  it("accepts optional loop and rejects a non-boolean", () => {
    const document = createEmptyDocument({ id: "p", name: "P", author: "tester" });
    const sequence: ActionSequenceConfig = {
      id: 1,
      name: "序列",
      trajectoryMode: false,
      blocks: [],
      segments: [],
    };
    document.motion.actionSequences = [sequence];
    expect(() => assertProjectDocumentStructure(document)).not.toThrow();

    document.motion.actionSequences = [{ ...sequence, loop: true }];
    expect(() => assertProjectDocumentStructure(document)).not.toThrow();

    document.motion.actionSequences = [{ ...sequence, loop: false }];
    expect(() => assertProjectDocumentStructure(document)).not.toThrow();

    document.motion.actionSequences = [
      { ...sequence, loop: "yes" } as unknown as ActionSequenceConfig,
    ];
    expect(() => assertProjectDocumentStructure(document)).toThrow(/loop/);
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
        id: 1,
        name: "序列",
        trajectoryMode: false,
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
        id: 1,
        name: "序列",
        trajectoryMode: false,
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

  it("accepts idle profiles without params and rejects idle with params", () => {
    const document = createEmptyDocument({ id: "p", name: "P", author: "tester" });
    const idleProfiles = {
      v1: { kind: "idle" as const },
      v2: { kind: "idle" as const },
      v3: { kind: "idle" as const },
    };
    document.motion.actionSequences = [
      {
        id: 1,
        name: "序列",
        trajectoryMode: false,
        blocks: [],
        segments: [{ fromRef: "a", toRef: "b", settings: { profiles: idleProfiles } }],
      },
    ];
    expect(() => assertProjectDocumentStructure(document)).not.toThrow();

    document.motion.actionSequences = [
      {
        id: 1,
        name: "序列",
        trajectoryMode: false,
        blocks: [],
        segments: [
          {
            fromRef: "a",
            toRef: "b",
            settings: {
              profiles: {
                ...idleProfiles,
                v1: { kind: "idle", params: { accelMs: 0, decelMs: 0 } },
              },
            },
          },
        ],
      },
    ] as never;
    expect(() => assertProjectDocumentStructure(document)).toThrow(/params/);
  });

  it("accepts set-enabled instructions and rejects the old set-enabled kind", () => {
    const document = createEmptyDocument({ id: "p", name: "P", author: "tester" });
    const instruction = {
      id: "enable-1",
      kind: "instruction" as const,
      presetId: "set-enabled" as const,
      objectId: 7,
      atMs: 0,
      instr: { enabled: true },
    };
    document.motion.actionSequences = [
      {
        id: 1,
        name: "序列",
        trajectoryMode: false,
        blocks: [instruction],
        segments: [],
      },
    ];
    expect(() => assertProjectDocumentStructure(document)).not.toThrow();

    document.motion.actionSequences = [
      {
        id: 1,
        name: "序列",
        trajectoryMode: false,
        blocks: [{ id: "old", kind: "set-enabled", objectId: 7, atMs: 0, enabled: true }],
        segments: [],
      },
    ] as never;
    expect(() => assertProjectDocumentStructure(document)).toThrow(/kind/);

    document.motion.actionSequences = [
      {
        id: 1,
        name: "序列",
        trajectoryMode: false,
        blocks: [{ ...instruction, enabled: true }],
        segments: [],
      },
    ] as never;
    expect(() => assertProjectDocumentStructure(document)).toThrow(/enabled/);

    document.motion.actionSequences = [
      {
        id: 1,
        name: "序列",
        trajectoryMode: false,
        blocks: [{ ...instruction, instr: { enabled: true, extra: 1 } }],
        segments: [],
      },
    ] as never;
    expect(() => assertProjectDocumentStructure(document)).toThrow(/instr/);
  });

  it("requires unique integer sequence ids in 1~65535", () => {
    const document = createEmptyDocument({ id: "p", name: "P", author: "tester" });
    document.motion.actionSequences = [{ ...sequence, id: 0 }];
    expect(() => assertProjectDocumentStructure(document)).toThrow(/1~65535/);

    document.motion.actionSequences = [{ ...sequence, id: "seq-1" as never }];
    expect(() => assertProjectDocumentStructure(document)).toThrow();

    document.motion.actionSequences = [sequence, { ...sequence, name: "副本" }];
    expect(() => assertProjectDocumentStructure(document)).toThrow(/duplicate sequence id 1/);
  });
});
