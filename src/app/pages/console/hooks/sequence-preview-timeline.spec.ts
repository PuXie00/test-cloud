import { describe, expect, it } from "vitest";
import { planNearestStart } from "@/app/project/action-sequence/nearest-start";
import { buildNearestStartMember } from "@/app/project/action-sequence/nearest-start-model";
import {
  fixtureCurrent,
  fixtureObjects,
  fixtureSequence,
} from "@/app/project/action-sequence/nearest-start.fixture";
import { resolveActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import {
  advancePreviewTimeline,
  buildPreviewTimeline,
  previewPhaseAt,
  previewPosesAtCursor,
  transitionPathSamples,
} from "./sequence-preview-timeline";

const resolved = resolveActionSequence(fixtureSequence(false));
const planFor = (nearest: boolean, reverse: boolean) =>
  planNearestStart({
    resolved,
    members: fixtureObjects().map((object) =>
      buildNearestStartMember(object, [], fixtureCurrent[object.id]!),
    ),
    forced: false,
    nearest,
    reverse,
    loopOnce: true,
  });

describe("buildPreviewTimeline", () => {
  it("plays the whole program without a transition", () => {
    const forward = buildPreviewTimeline(16000, null, false);
    expect(forward).toMatchObject({ transitionMs: 0, programStartMs: 0, totalMs: 16000, direction: 1 });
    const reverse = buildPreviewTimeline(16000, null, true);
    expect(reverse).toMatchObject({ programStartMs: 16000, totalMs: 16000, direction: -1 });
    expect(previewPhaseAt(reverse, 1000)).toEqual({ phase: "program", programMs: 15000 });
  });

  it("puts the transition first and then resumes the program at the target frame", () => {
    const plan = planFor(true, false);
    const timeline = buildPreviewTimeline(resolved.totalMs, plan, false);
    const transitionMs = plan.transitionSec * 1000;
    expect(timeline.transitionMs).toBeCloseTo(transitionMs, 6);
    expect(timeline.programStartMs).toBe(4000);
    expect(timeline.totalMs).toBeCloseTo(transitionMs + resolved.totalMs - 4000, 6);
    expect(previewPhaseAt(timeline, transitionMs / 2)).toEqual({
      phase: "transition",
      elapsedMs: transitionMs / 2,
    });
    expect(previewPhaseAt(timeline, transitionMs + 500)).toEqual({ phase: "program", programMs: 4500 });
  });

  it("plays backwards from the target frame when reversed", () => {
    const plan = planFor(false, true);
    const timeline = buildPreviewTimeline(resolved.totalMs, plan, true);
    expect(timeline.programStartMs).toBe(16000);
    expect(timeline.totalMs).toBeCloseTo(plan.transitionSec * 1000 + 16000, 6);
    expect(previewPhaseAt(timeline, timeline.transitionMs + 1000)).toEqual({
      phase: "program",
      programMs: 15000,
    });
  });
});

describe("previewPosesAtCursor", () => {
  it("starts at the current pose and reaches the target frame pose after the transition", () => {
    const plan = planFor(true, false);
    const timeline = buildPreviewTimeline(resolved.totalMs, plan, false);
    expect(previewPosesAtCursor(resolved, timeline, 0).get(1)).toEqual(fixtureCurrent[1]);
    const joined = previewPosesAtCursor(resolved, timeline, timeline.transitionMs);
    const target = plan.members.find((member) => member.objectId === 2)!.target;
    expect(joined.get(2)!.v1).toBeCloseTo(target.v1, 6);
    expect(joined.get(2)!.v2).toBeCloseTo(target.v2, 6);
  });
});

describe("transitionPathSamples", () => {
  it("samples each moving member from its current pose to the target", () => {
    const plan = planFor(false, false);
    const paths = transitionPathSamples(plan);
    const first = paths.get(1)!;
    expect(first[0]).toEqual(fixtureCurrent[1]);
    expect(first[first.length - 1]!.v1).toBeCloseTo(0, 6);
  });
});

describe("advancePreviewTimeline", () => {
  it("stops at the end without looping", () => {
    const timeline = buildPreviewTimeline(1000, null, false);
    expect(
      advancePreviewTimeline({ timeline, cursorMs: 950, dtMs: 100, faderPercent: 100, multiplier: 1, loop: false }),
    ).toMatchObject({ cursorMs: 1000, ended: true });
  });

  it("drops the transition when a hold preview loops", () => {
    const plan = planFor(true, false);
    const timeline = buildPreviewTimeline(resolved.totalMs, plan, false);
    const advanced = advancePreviewTimeline({
      timeline,
      cursorMs: timeline.totalMs - 50,
      dtMs: 100,
      faderPercent: 100,
      multiplier: 1,
      loop: true,
    });
    expect(advanced.ended).toBe(false);
    expect(advanced.timeline.transitionMs).toBe(0);
    expect(advanced.timeline.programStartMs).toBe(0);
    expect(advanced.cursorMs).toBeCloseTo(50, 6);
  });
});
