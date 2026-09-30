import { describe, expect, it } from "vitest";
import { fixtureSequence } from "@/app/project/action-sequence/nearest-start.fixture";
import { resolveActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import { sequenceObjectIds } from "@/app/project/action-sequence/sequence-object-ids";
import type { ProjectDocument } from "@/app/project/project-document-types";
import { buildActionCardSeed, sequenceTotalMs } from "./action-card-seed";
import { DEFAULT_SLOT_RUN_OPTIONS, type FaderSlotState } from "./use-executor-slots";

const sequence = fixtureSequence(true);
const document = { motion: { actionSequences: [sequence], programs: [] } } as unknown as ProjectDocument;
const deviceId = [...sequenceObjectIds(sequence)].sort((left, right) => left - right);
const totalMs = resolveActionSequence(sequence).totalMs;

const slot = (overrides: Partial<FaderSlotState> = {}): FaderSlotState => ({
  index: 2,
  label: "F3",
  sequence: { id: sequence.id, name: sequence.name, durationMs: totalMs },
  faderValue: 80,
  phase: "idle",
  isBusy: false,
  runOptions: { ...DEFAULT_SLOT_RUN_OPTIONS, reverse: true },
  startPlan: null,
  preparedPoses: null,
  ...overrides,
});

describe("sequenceTotalMs", () => {
  it("is the resolved sequence duration, or undefined without a sequence", () => {
    expect(sequenceTotalMs(sequence)).toBe(totalMs);
    expect(sequenceTotalMs(undefined)).toBeUndefined();
  });
});

describe("buildActionCardSeed", () => {
  it("takes name, duration and devices from the sequence, and source, speed and direction from its slot", () => {
    expect(buildActionCardSeed(sequence.id, document, [slot()])).toEqual({
      name: sequence.name,
      source: { kind: "fader", slotIndex: 2 },
      speedPercent: 80,
      sequenceId: sequence.id,
      sequenceHandle: { actionId: sequence.id, deviceId },
      trajectoryMode: true,
      totalMs,
      reverse: true,
    });
  });

  it("marks the action external when no slot holds the sequence", () => {
    const seed = buildActionCardSeed(sequence.id, document, [slot({ sequence: null })]);
    expect(seed.source).toEqual({ kind: "external" });
    expect(seed.speedPercent).toBe(100);
    expect(seed).not.toHaveProperty("reverse");
    expect(seed.totalMs).toBe(totalMs);
  });

  it("still yields a stoppable card for an action the project does not know", () => {
    expect(buildActionCardSeed(7, document, [slot()])).toEqual({
      name: "动作 7",
      source: { kind: "external" },
      speedPercent: 100,
      sequenceHandle: { actionId: 7 },
    });
    expect(buildActionCardSeed(7, undefined, []).sequenceHandle).toEqual({ actionId: 7 });
  });
});
