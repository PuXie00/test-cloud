# Action Data Save Curve Segments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace sampled-point `actionDataSave` with PLC curve-segment payloads (`actionId`, `a/b/c` phases, `eventCount`) on addr `0x1016`.

**Architecture:** Extract `trapezoidToCurveSegments` as a pure kinematics function. `compilePlcAction` concatenates per-axis segments and maps enable instructions. `toActionDataSaveItems` fills `actionId` from `sequence.id`. Electron only changes the address. Runtime handle uses `actionId`; there is no `actionNo`.

**Tech Stack:** TypeScript, Vitest (`npx vitest run <file>` only), existing motion-profile kinematics, Electron csocket `sendBuilt`.

## Global Constraints

- `actionId` (uint16) = `ActionSequenceConfig.id` (1–65535). Never send or parse `actionNo`.
- Addr `0x104A` → `0x1016`. OptCmd stays `Config|actionDataSave`.
- `d = e = f = 0`. `a/b/c` signed with travel. Units: position-unit/s², /s, /s² from `calculateMotionProfileKinematics`.
- Triangle: still 3 rows; cruise `b = 0` and cruise `startTime` equals decel `startTime`. Idle / zero travel: 1 zero-coeff row.
- `virtualAxisNo`: v1→1, v2→2, v3→3. Disabled axes emit no timeline.
- `segmentCount > 100` throws; download treats it as validation failure.
- Events: `{ modelId, atTime, enableFlag }` with `true→1`, `false→0`.
- ACK: `success === false` or `data[0].errorCount > 0` fails. Missing `errorCount` means 0.
- Do not change preview sampling, trapezoid editor, `actionPrepare` / `actionSyncCall` / `stopAction` wire shapes. Stop adapter still maps `actionId` → `{ deviceId }`.
- Targeted vitest only. No `vitest run` without a path, no `tsc --noEmit`, no production build.

## File map

- Create: `src/app/project/action-sequence/curve-segments.ts`
- Create: `src/app/project/action-sequence/curve-segments.spec.ts`
- Modify: `shared/csocket/action-data-save.ts`
- Modify: `src/app/project/action-sequence/compile-plc-action.ts`
- Modify: `src/app/project/action-sequence/compile-plc-action.spec.ts`
- Modify: `src/app/project/action-sequence/instruction-registry.ts`
- Modify: `src/app/project/action-sequence/instruction-registry.spec.ts`
- Modify: `src/app/project/action-sequence/plc-action-payload.ts`
- Modify: `src/app/project/action-sequence/plc-action-payload.spec.ts`
- Modify: `electron/main/cSocket/api.ts` (addr only)
- Modify: `src/app/pages/console/hooks/sequence-execution.ts`
- Modify: `src/app/pages/console/hooks/sequence-execution.spec.ts`
- Modify: `src/app/pages/console/components/exec-area/exec-area.test.tsx` (`actionNo` → `actionId` on handles)

---

### Task 1: `trapezoidToCurveSegments`

**Files:**
- Create: `src/app/project/action-sequence/curve-segments.ts`
- Create: `src/app/project/action-sequence/curve-segments.spec.ts`
- Modify: `shared/csocket/action-data-save.ts` (add `PlcCurveSegment` only; do not delete old types yet)

**Interfaces:**
- Consumes: `MotionProfile`, `calculateMotionProfileKinematics`, `cruiseMsOf`, `evaluateMotionProfile` from `motion-profile.ts` / `types.ts`
- Produces: `PlcCurveSegment`; `trapezoidToCurveSegments(profile, startMs, startPos, endPos, durationMs): PlcCurveSegment[]`

- [ ] **Step 1: Add `PlcCurveSegment` to shared types**

In `shared/csocket/action-data-save.ts`, add (keep existing types):

```ts
export type PlcCurveSegment = {
  startTime: number
  position: number
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}
```

- [ ] **Step 2: Write the failing tests**

Create `src/app/project/action-sequence/curve-segments.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { trapezoidToCurveSegments } from "./curve-segments";
import type { MotionProfile } from "./types";

const trap = (accelMs: number, decelMs: number): MotionProfile => ({
  kind: "trapezoid",
  params: { accelMs, decelMs },
});

const idle = (): MotionProfile => ({ kind: "idle" });

const zeroTail = { d: 0, e: 0, f: 0 };

describe("trapezoidToCurveSegments", () => {
  it("emits three signed phase rows for a forward trapezoid", () => {
    const rows = trapezoidToCurveSegments(trap(200, 200), 0, 0, 100, 1000);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ startTime: 0, position: 0, a: 625, b: 0, c: 0, ...zeroTail });
    expect(rows[1]).toEqual({ startTime: 200, position: 12.5, a: 0, b: 125, c: 0, ...zeroTail });
    expect(rows[2]).toEqual({ startTime: 800, position: 87.5, a: 0, b: 0, c: 625, ...zeroTail });
  });

  it("negates a/b/c when travel is negative", () => {
    const rows = trapezoidToCurveSegments(trap(200, 200), 0, 50, 30, 1000);
    expect(rows[0]?.a).toBe(-125);
    expect(rows[1]?.b).toBe(-25);
    expect(rows[2]?.c).toBe(-125);
    expect(rows[0]?.position).toBe(50);
    expect(rows[1]?.position).toBe(47.5);
    expect(rows[2]?.position).toBe(32.5);
  });

  it("keeps three rows for a triangle with b=0 and shared cruise/decel startTime", () => {
    const rows = trapezoidToCurveSegments(trap(200, 200), 1000, 0, 100, 400);
    expect(rows).toHaveLength(3);
    expect(rows[1]?.b).toBe(0);
    expect(rows[1]?.startTime).toBe(1200);
    expect(rows[2]?.startTime).toBe(1200);
    expect(rows[1]?.position).toBe(rows[2]?.position);
    expect(rows[0]?.a).toBe(2500);
    expect(rows[2]?.c).toBe(2500);
  });

  it("emits one zero-coeff hold for idle or zero travel", () => {
    expect(trapezoidToCurveSegments(idle(), 3000, 42, 42, 1000)).toEqual([
      { startTime: 3000, position: 42, a: 0, b: 0, c: 0, ...zeroTail },
    ]);
    expect(trapezoidToCurveSegments(trap(200, 200), 0, 10, 10, 1000)).toEqual([
      { startTime: 0, position: 10, a: 0, b: 0, c: 0, ...zeroTail },
    ]);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/app/project/action-sequence/curve-segments.spec.ts`

Expected: FAIL (cannot find module `./curve-segments` or `trapezoidToCurveSegments` is not exported).

- [ ] **Step 4: Implement `trapezoidToCurveSegments`**

Create `src/app/project/action-sequence/curve-segments.ts`:

```ts
import type { PlcCurveSegment } from "@shared/csocket/action-data-save";
import {
  calculateMotionProfileKinematics,
  cruiseMsOf,
  evaluateMotionProfile,
} from "./motion-profile";
import type { MotionProfile } from "./types";

const ZERO_COEFF = { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 };

const holdSegment = (startTime: number, position: number): PlcCurveSegment => ({
  startTime,
  position,
  ...ZERO_COEFF,
});

export const trapezoidToCurveSegments = (
  profile: MotionProfile,
  startMs: number,
  startPos: number,
  endPos: number,
  durationMs: number,
): PlcCurveSegment[] => {
  const travel = endPos - startPos;
  if (profile.kind !== "trapezoid" || travel === 0) {
    return [holdSegment(startMs, startPos)];
  }

  const sign = Math.sign(travel);
  const kinematics = calculateMotionProfileKinematics(profile, travel, durationMs);
  const accelMs = profile.params.accelMs;
  const cruiseMs = Math.max(0, cruiseMsOf(profile, durationMs));
  const accelEndPos =
    startPos + evaluateMotionProfile(profile, accelMs / durationMs, durationMs) * travel;
  const cruiseEndPos =
    startPos +
    evaluateMotionProfile(profile, (accelMs + cruiseMs) / durationMs, durationMs) * travel;
  const cruiseStartTime = startMs + accelMs;
  const decelStartTime = cruiseStartTime + cruiseMs;

  return [
    { ...holdSegment(startMs, startPos), a: sign * kinematics.acceleration },
    {
      ...holdSegment(cruiseStartTime, accelEndPos),
      b: cruiseMs === 0 ? 0 : sign * kinematics.peakVelocity,
    },
    { ...holdSegment(decelStartTime, cruiseEndPos), c: sign * kinematics.deceleration },
  ];
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/app/project/action-sequence/curve-segments.spec.ts`

Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add shared/csocket/action-data-save.ts src/app/project/action-sequence/curve-segments.ts src/app/project/action-sequence/curve-segments.spec.ts
git commit -m "Add trapezoid-to-curve-segment conversion for PLC save."
```

---

### Task 2: Compile, events, payload, wire types

**Files:**
- Modify: `shared/csocket/action-data-save.ts` (replace sampled types)
- Modify: `src/app/project/action-sequence/instruction-registry.ts`
- Modify: `src/app/project/action-sequence/instruction-registry.spec.ts`
- Modify: `src/app/project/action-sequence/compile-plc-action.ts`
- Modify: `src/app/project/action-sequence/compile-plc-action.spec.ts`
- Modify: `src/app/project/action-sequence/plc-action-payload.ts`
- Modify: `src/app/project/action-sequence/plc-action-payload.spec.ts`

**Interfaces:**
- Consumes: `trapezoidToCurveSegments`; `instructionToPlcEvent`
- Produces:
  - `PlcCompiledTimeline = { modelId, virtualAxisNo, segments: PlcCurveSegment[] }`
  - `PlcCompiledEvent = { modelId, atTime, enableFlag }`
  - `PlcCompiledAction = { totalDuration, timelines, events }` (no checksum, no trajectoryMode)
  - `ActionDataSaveItem` as in the spec wire item
  - `compilePlcAction(sequence, context)` where `PlcCompileContext` has no `sampleIntervalMs`
  - `toActionDataSaveItems(compiled, actionId): ActionDataSaveItem[]`
  - `MAX_PLC_CURVE_SEGMENTS = 100`
  - `VIRTUAL_AXIS_NO = { v1: 1, v2: 2, v3: 3 }`

- [ ] **Step 1: Rewrite failing instruction + payload + compile tests**

Replace the event assertion in `instruction-registry.spec.ts`:

```ts
expect(instructionToPlcEvent(enable)).toEqual({
  modelId: 7,
  atTime: 100,
  enableFlag: 1,
});
```

Replace `plc-action-payload.spec.ts` body `describe` with:

```ts
describe("toActionDataSaveItems", () => {
  it("fills actionId, counts, curve segments, and enableFlag events", () => {
    const compiled = compilePlcAction(sequence, context);
    const items = toActionDataSaveItems(compiled, 7);
    const item = items[0];
    expect(item.actionId).toBe(7);
    expect(item).not.toHaveProperty("actionNo");
    expect(item).not.toHaveProperty("checksum");
    expect(item).not.toHaveProperty("trajectoryMode");
    expect(item.timelineCount).toBe(compiled.timelines.length);
    expect(item.timelineList[0]?.modelId).toBe(7);
    expect(item.timelineList[0]?.virtualAxisNo).toBe(1);
    expect(item.timelineList[0]?.segmentCount).toBe(item.timelineList[0]?.segmentList.length);
    expect(item.eventCount).toBe(1);
    expect(item.eventList).toEqual([{ modelId: 7, atTime: 500, enableFlag: 0 }]);
  });

  it("maps a command-only compile to events and zero timelines", () => {
    const compiled = compilePlcAction(
      sequenceOf([{
        id: "enable",
        kind: "instruction",
        presetId: "set-enabled",
        objectId: 7,
        atMs: 1000,
        instr: { enabled: true },
      }]),
      context,
    );
    const items = toActionDataSaveItems(compiled, 3);
    expect(items[0].actionId).toBe(3);
    expect(items[0].timelineCount).toBe(0);
    expect(items[0].timelineList).toEqual([]);
    expect(items[0].eventList).toEqual([{ modelId: 7, atTime: 1000, enableFlag: 1 }]);
  });
});
```

Remove `sampleIntervalMs` from that file's `context`.

Replace `compile-plc-action.spec.ts` helper and cases. Drop checksum and `timeArray` tests. Use:

```ts
const compileContext = (
  objects: { id: number; enabledVirtualAxes: readonly VirtualAxisId[] }[],
) => ({
  objects: objects.map((object) => ({
    ...object,
    limits: limitsFor(object.enabledVirtualAxes),
  })),
});

const threeAxisContext = compileContext(
  [{ id: 7, enabledVirtualAxes: ["v1", "v2", "v3"] as const }],
);
```

Keep `laterInitialSequence` / `sequenceOf`. Replace the describe body with these tests (do not keep checksum or sample-union tests):

```ts
describe("compilePlcAction", () => {
  it("maps v1/v2/v3 to virtualAxisNo 1/2/3 and omits disabled axes", () => {
    const compiled = compilePlcAction(
      laterInitialSequence,
      compileContext([{ id: 7, enabledVirtualAxes: ["v1"] as const }]),
    );
    expect(compiled).not.toHaveProperty("checksum");
    expect(compiled).not.toHaveProperty("trajectoryMode");
    expect(compiled.timelines).toHaveLength(1);
    expect(compiled.timelines[0]?.virtualAxisNo).toBe(1);
    expect(compiled.timelines[0]?.modelId).toBe(7);
    expect(compiled.timelines[0]?.segments.length).toBeGreaterThan(0);
  });

  it("emits enableFlag events", () => {
    const compiled = compilePlcAction(laterInitialSequence, threeAxisContext);
    expect(compiled.events).toContainEqual({ modelId: 7, atTime: 500, enableFlag: 0 });
  });

  it("starts the first moving segment at the first pose time", () => {
    const compiled = compilePlcAction(laterInitialSequence, threeAxisContext);
    const v1 = compiled.timelines.find((timeline) => timeline.virtualAxisNo === 1);
    expect(v1?.segments[0]?.startTime).toBe(3000);
  });

  it("emits one hold row per enabled axis for a single pose", () => {
    const compiled = compilePlcAction(
      sequenceOf([{
        id: "only",
        kind: "pose",
        objectId: 7,
        atMs: 4000,
        pose: { v1: 42, v2: 1, v3: 2 },
      }]),
      threeAxisContext,
    );
    expect(compiled.timelines).toHaveLength(3);
    const byAxis = Object.fromEntries(
      compiled.timelines.map((timeline) => [timeline.virtualAxisNo, timeline.segments]),
    );
    expect(byAxis[1]).toEqual([
      { startTime: 4000, position: 42, a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 },
    ]);
    expect(byAxis[2]?.[0]?.position).toBe(1);
    expect(byAxis[3]?.[0]?.position).toBe(2);
  });

  it("compiles a command-only sequence with events and no timelines", () => {
    const compiled = compilePlcAction(
      sequenceOf([{
        id: "enable",
        kind: "instruction",
        presetId: "set-enabled",
        objectId: 7,
        atMs: 1000,
        instr: { enabled: true },
      }]),
      threeAxisContext,
    );
    expect(compiled.timelines).toEqual([]);
    expect(compiled.events).toEqual([{ modelId: 7, atTime: 1000, enableFlag: 1 }]);
  });

  it("uses three phase rows whose startTimes match accel/cruise/decel", () => {
    const sequence = sequenceOf(
      [
        { id: "start", kind: "pose", objectId: 7, atMs: 1000, pose: origin },
        { id: "end", kind: "pose", objectId: 7, atMs: 2000, pose: { v1: 1000, v2: 0, v3: 0 } },
      ],
      {
        segments: [{
          fromRef: "start",
          toRef: "end",
          settings: { profiles: axisProfiles(150, 250) },
        }],
      },
    );
    const compiled = compilePlcAction(
      sequence,
      compileContext([{ id: 7, enabledVirtualAxes: ["v1"] as const }]),
    );
    const segments = compiled.timelines[0]?.segments ?? [];
    expect(segments).toHaveLength(3);
    expect(segments[0]?.startTime).toBe(1000);
    expect(segments[1]?.startTime).toBe(1150);
    expect(segments[2]?.startTime).toBe(1750);
  });

  it("throws when a timeline exceeds 100 segments", () => {
    const poseCount = 36;
    const blocks = Array.from({ length: poseCount }, (_, index) => ({
      id: `p${index}`,
      kind: "pose" as const,
      objectId: 7,
      atMs: index * 1000,
      pose: { v1: index, v2: 0, v3: 0 },
    }));
    const segments = Array.from({ length: poseCount - 1 }, (_, index) => ({
      fromRef: `p${index}`,
      toRef: `p${index + 1}`,
      settings: { profiles: axisProfiles(200, 200) },
    }));
    expect(() =>
      compilePlcAction(
        sequenceOf(blocks, { segments }),
        compileContext([{ id: 7, enabledVirtualAxes: ["v1"] as const }]),
      ),
    ).toThrow(/100/);
  });
});
```

35 motion segments × 3 rows = 105 > 100.

- [ ] **Step 2: Run the three spec files and confirm they fail**

Run:

```
npx vitest run src/app/project/action-sequence/instruction-registry.spec.ts src/app/project/action-sequence/plc-action-payload.spec.ts src/app/project/action-sequence/compile-plc-action.spec.ts
```

Expected: FAIL on new field names (`modelId`, `enableFlag`, `actionId`, missing `sampleIntervalMs`, etc.).

- [ ] **Step 3: Replace shared types**

Replace `shared/csocket/action-data-save.ts` entirely:

```ts
export type PlcCurveSegment = {
  startTime: number
  position: number
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

export type PlcCompiledTimeline = {
  modelId: number
  virtualAxisNo: number
  segments: PlcCurveSegment[]
}

export type PlcCompiledEvent = {
  modelId: number
  atTime: number
  enableFlag: 0 | 1
}

export type PlcCompiledAction = {
  totalDuration: number
  timelines: PlcCompiledTimeline[]
  events: PlcCompiledEvent[]
}

export type ActionDataSaveItem = {
  actionId: number
  totalDuration: number
  timelineCount: number
  timelineList: Array<{
    modelId: number
    virtualAxisNo: number
    segmentCount: number
    segmentList: PlcCurveSegment[]
  }>
  eventCount: number
  eventList: PlcCompiledEvent[]
}
```

Remove the `TrajectoryMode` import; it is no longer on this payload.

- [ ] **Step 4: Map instructions**

In `instruction-registry.ts`, replace `instructionToPlcEvent`:

```ts
export const instructionToPlcEvent = (block: InstructionBlock): PlcCompiledEvent => {
  if (block.presetId !== "set-enabled") {
    throw new Error(`cannot compile instruction ${block.presetId}`);
  }
  return {
    modelId: block.objectId,
    atTime: block.atMs,
    enableFlag: block.instr.enabled ? 1 : 0,
  };
};
```

- [ ] **Step 5: Rewrite `compilePlcAction`**

Replace `src/app/project/action-sequence/compile-plc-action.ts` with:

```ts
import type {
  PlcCompiledAction,
  PlcCompiledEvent,
  PlcCompiledTimeline,
} from "@shared/csocket/action-data-save";
import { trapezoidToCurveSegments } from "./curve-segments";
import { instructionToPlcEvent } from "./instruction-registry";
import { resolveActionSequence } from "./resolve-sequence";
import type { ActionSequenceConfig } from "./types";
import {
  hasBlockingSequenceIssues,
  validateActionSequence,
  type SequenceValidationContext,
  type VirtualAxisId,
} from "./validate-sequence";

export type PlcCompileObject = {
  id: number;
  enabledVirtualAxes: readonly VirtualAxisId[];
  limits: SequenceValidationContext["objects"][number]["limits"];
};

export type PlcCompileContext = {
  objects: readonly PlcCompileObject[];
  hoistObjects?: SequenceValidationContext["hoistObjects"];
};

export const MAX_PLC_CURVE_SEGMENTS = 100;

const VIRTUAL_AXIS_NO: Record<VirtualAxisId, number> = {
  v1: 1,
  v2: 2,
  v3: 3,
};

const compareNumber = (left: number, right: number): number => left - right;

const sortTimelines = (timelines: PlcCompiledTimeline[]): PlcCompiledTimeline[] =>
  [...timelines].sort((left, right) => {
    const modelDelta = compareNumber(left.modelId, right.modelId);
    if (modelDelta !== 0) return modelDelta;
    return compareNumber(left.virtualAxisNo, right.virtualAxisNo);
  });

const sortEvents = (events: PlcCompiledEvent[]): PlcCompiledEvent[] =>
  [...events].sort((left, right) => {
    const timeDelta = compareNumber(left.atTime, right.atTime);
    if (timeDelta !== 0) return timeDelta;
    const modelDelta = compareNumber(left.modelId, right.modelId);
    if (modelDelta !== 0) return modelDelta;
    return left.enableFlag - right.enableFlag;
  });

export const compilePlcAction = (
  sequence: ActionSequenceConfig,
  context: PlcCompileContext,
): PlcCompiledAction => {
  const issues = validateActionSequence(sequence, {
    objects: context.objects.map((object) => ({
      id: object.id,
      enabledVirtualAxes: [...object.enabledVirtualAxes],
      limits: object.limits,
    })),
    ...(context.hoistObjects ? { hoistObjects: context.hoistObjects } : {}),
  });
  if (hasBlockingSequenceIssues(issues)) {
    throw new Error("sequence has blocking validation issues");
  }

  const resolved = resolveActionSequence(sequence);
  const objectById = new Map(context.objects.map((object) => [object.id, object]));

  const timelines = sortTimelines(
    [...resolved.posesByObject.entries()].flatMap(([modelId, poses]) => {
      const object = objectById.get(modelId);
      const first = poses[0];
      if (!object || first === undefined) return [];
      const objectSegments = resolved.segments.filter((segment) => segment.objectId === modelId);

      return object.enabledVirtualAxes.map((axis) => {
        const virtualAxisNo = VIRTUAL_AXIS_NO[axis];
        const segments =
          objectSegments.length === 0
            ? trapezoidToCurveSegments(
                { kind: "idle" },
                first.atMs,
                first.pose[axis],
                first.pose[axis],
                0,
              )
            : objectSegments.flatMap((segment) =>
                trapezoidToCurveSegments(
                  segment.settings.profiles[axis],
                  segment.startMs,
                  segment.fromPose[axis],
                  segment.toPose[axis],
                  segment.durationMs,
                ),
              );
        if (segments.length > MAX_PLC_CURVE_SEGMENTS) {
          throw new Error(`PLC timeline segmentCount exceeds ${MAX_PLC_CURVE_SEGMENTS}`);
        }
        return { modelId, virtualAxisNo, segments };
      });
    }),
  );

  return {
    totalDuration: resolved.totalMs,
    timelines,
    events: sortEvents(resolved.commands.map(instructionToPlcEvent)),
  };
};
```

- [ ] **Step 6: Rewrite payload mapper**

Replace `src/app/project/action-sequence/plc-action-payload.ts`:

```ts
import type { ActionDataSaveItem, PlcCompiledAction } from "@shared/csocket/action-data-save";

export const toActionDataSaveItems = (
  compiled: PlcCompiledAction,
  actionId: number,
): ActionDataSaveItem[] => [
  {
    actionId,
    totalDuration: compiled.totalDuration,
    timelineCount: compiled.timelines.length,
    timelineList: compiled.timelines.map((timeline) => ({
      modelId: timeline.modelId,
      virtualAxisNo: timeline.virtualAxisNo,
      segmentCount: timeline.segments.length,
      segmentList: timeline.segments,
    })),
    eventCount: compiled.events.length,
    eventList: compiled.events,
  },
];
```

- [ ] **Step 7: Run the three spec files**

Run:

```
npx vitest run src/app/project/action-sequence/instruction-registry.spec.ts src/app/project/action-sequence/plc-action-payload.spec.ts src/app/project/action-sequence/compile-plc-action.spec.ts src/app/project/action-sequence/curve-segments.spec.ts
```

Expected: PASS. If `context` in payload spec still has incomplete v2/v3 limits and compile validates them, copy `threeAxisContext` limits onto v2/v3 in that spec (same `unlimited` shape as compile spec).

- [ ] **Step 8: Commit**

```bash
git add shared/csocket/action-data-save.ts src/app/project/action-sequence/instruction-registry.ts src/app/project/action-sequence/instruction-registry.spec.ts src/app/project/action-sequence/compile-plc-action.ts src/app/project/action-sequence/compile-plc-action.spec.ts src/app/project/action-sequence/plc-action-payload.ts src/app/project/action-sequence/plc-action-payload.spec.ts
git commit -m "Compile PLC save payloads as curve segments and enableFlag events."
```

---

### Task 3: Execution adapter, addr `0x1016`, drop `actionNo`

**Files:**
- Modify: `electron/main/cSocket/api.ts` (line with `'0x104A'` → `'0x1016'`)
- Modify: `src/app/pages/console/hooks/sequence-execution.ts`
- Modify: `src/app/pages/console/hooks/sequence-execution.spec.ts`
- Modify: `src/app/pages/console/components/exec-area/exec-area.test.tsx`

**Interfaces:**
- Consumes: `toActionDataSaveItems(compiled, sequence.id)`, new `ActionDataSaveItem`, `compilePlcAction` without `sampleIntervalMs`
- Produces:
  - `SequenceRuntimeHandle = { actionId: number; syncGroupId: number }`
  - `DownloadedSequence` success: `{ ok: true, actionId, sequenceId, modelIds }` (no checksum, no actionNo)
  - `syncCall` input without `actionNo` / `actionId`
  - `stopAction` input `{ actionId, syncGroupId }` mapping to `stopActionPlc([{ deviceId: actionId }])`
  - `saveAction` throws if ACK `data[0].errorCount > 0`

- [ ] **Step 1: Rewrite failing execution tests**

In `sequence-execution.spec.ts`:

- Delete `sampleIntervalMs` from `context`.
- Replace `actionNo` with `actionId` on handles, `syncCall` (omit it entirely from `syncCall` args), and `stopAction`.
- Change the download assertion from checksum/`actionNo` to:

```ts
it("passes compiled save items with actionId and no actionNo", async () => {
  const transport = createTransport();
  const downloaded = await downloadSequence(validSequence, context, transport);
  const expected = toActionDataSaveItems(
    compilePlcAction(validSequence, context),
    validSequence.id,
  );
  expect(transport.saveAction).toHaveBeenCalledWith(expected);
  expect(downloaded).toEqual({
    ok: true,
    actionId: validSequence.id,
    sequenceId: validSequence.id,
    modelIds: expect.any(Array),
  });
  expect(expected[0]).not.toHaveProperty("actionNo");
  expect(expected[0]?.actionId).toBe(validSequence.id);
});
```

- Command-only compile assertion: `event.modelId` not `event.modelNo`.
- `startLocalAuthoredSequence` expected `syncCall` args: drop `actionNo`; handle `{ actionId: validSequence.id, syncGroupId: LOCAL_SEQUENCE_SYNC_GROUP_ID }`.
- Stop test: `{ actionId: 12, syncGroupId: 3 }`.
- Local transport `syncCall` / `stopAction` use `actionId` on stop only.
- Replace save ACK tests:

```ts
it("saveAction accepts success with missing errorCount and rejects errorCount > 0", async () => {
  const ok = createMockCsocketApi({ success: true, data: [{ actionId: 1 }] });
  await expect(createCsocketSequenceTransport(ok).saveAction([])).resolves.toBeUndefined();

  const withErrors = createMockCsocketApi({
    success: true,
    data: [{ actionId: 1, errorCount: 2, errorCode: [1, 2] }],
  });
  await expect(createCsocketSequenceTransport(withErrors).saveAction([])).rejects.toThrow(
    /errorCount|errorCode/i,
  );
});
```

Keep the `{ ok: false }` and `success: false` throw cases. Delete any test that requires parsing firmware `actionNo`.

In `exec-area.test.tsx` replace the three `actionNo` handle fields with `actionId` (mock return, launch handle, `stopSequenceMock` expectation).

- [ ] **Step 2: Run tests to verify they fail**

Run:

```
npx vitest run src/app/pages/console/hooks/sequence-execution.spec.ts src/app/pages/console/components/exec-area/exec-area.test.tsx
```

Expected: FAIL (type/property `actionNo` / `sampleIntervalMs` / checksum).

- [ ] **Step 3: Change the PLC address**

In `electron/main/cSocket/api.ts`, `actionDataSavePlc`:

```ts
return this.sendBuilt('Config|actionDataSave', '0x1016', items, opts)
```

- [ ] **Step 4: Update `sequence-execution.ts`**

Apply all of the following:

1. Remove `SEQUENCE_SAMPLE_INTERVAL_MS` and `sampleIntervalMs` from `SequenceExecutionContext` / `toCompileContext` / `sequenceExecutionContextFromDocument`.
2. Types:

```ts
export type SequenceRuntimeHandle = {
  actionId: number;
  syncGroupId: number;
};

export type DownloadedSequence =
  | {
      ok: true;
      actionId: number;
      sequenceId: number;
      modelIds: number[];
    }
  | { ok: false; reason: "validation"; issues: SequenceIssue[] };

export type SequenceExecutionTransport = {
  saveAction: (items: ActionDataSaveItem[]) => Promise<void>;
  syncCall: (input: {
    syncGroupId: number;
    startTimestamp: number;
    speedScale: number;
    trajectoryMode: TrajectoryMode;
  }) => Promise<void>;
  stopAction: (input: { actionId: number; syncGroupId: number }) => Promise<void>;
};
```

3. `uniqueSortedModelIds` reads `timeline.modelId` and `event.modelId`.
4. `downloadSequence` success:

```ts
await transport.saveAction(toActionDataSaveItems(compiled, sequence.id));
return {
  ok: true,
  actionId: sequence.id,
  sequenceId: sequence.id,
  modelIds: uniqueSortedModelIds(compiled),
};
```

5. Delete `parseSavedActionNo`. Extend save ACK:

```ts
const requireSaveAck = (raw: unknown): void => {
  const ack = requireSuccessfulAck(raw, "actionDataSave");
  const first = ack.data?.[0];
  const errorCount =
    isRecord(first) && typeof first.errorCount === "number" ? first.errorCount : 0;
  if (errorCount > 0) {
    const codes = isRecord(first) && "errorCode" in first ? first.errorCode : [];
    throw new Error(`actionDataSave errorCount=${errorCount} errorCode=${JSON.stringify(codes)}`);
  }
};
```

`saveAction` of `createCsocketSequenceTransport` calls `requireSaveAck`.

6. `syncCall` no longer takes or forwards an action id. `startLocalAuthoredSequence` passes:

```ts
await transport.syncCall({
  syncGroupId: LOCAL_SEQUENCE_SYNC_GROUP_ID,
  startTimestamp: Date.now(),
  speedScale: fromFader ? mapFaderPercentToSpeedScale(speedPercent) : 1,
  trajectoryMode: sequence.trajectoryMode,
});
```

Handle:

```ts
sequenceHandle: {
  actionId: downloaded.actionId,
  syncGroupId: LOCAL_SEQUENCE_SYNC_GROUP_ID,
},
```

7. Stop adapter:

```ts
await requireSuccessfulAck(
  await api.stopActionPlc([{ deviceId: input.actionId }]),
  "stopAction",
);
```

Leave the comment that `stopActionPlc` still takes `{ deviceId }[]`.

- [ ] **Step 5: Run targeted tests**

Run:

```
npx vitest run src/app/pages/console/hooks/sequence-execution.spec.ts src/app/pages/console/components/exec-area/exec-area.test.tsx src/app/project/action-sequence/compile-plc-action.spec.ts src/app/project/action-sequence/plc-action-payload.spec.ts src/app/project/action-sequence/curve-segments.spec.ts src/app/project/action-sequence/instruction-registry.spec.ts
```

Expected: PASS.

If TypeScript in other already-open files still reads `sequenceHandle.actionNo` or `sampleIntervalMs` on `SequenceExecutionContext`, rename those properties to `actionId` / drop `sampleIntervalMs`. Do not start unrelated refactors.

- [ ] **Step 6: Commit**

```bash
git add electron/main/cSocket/api.ts src/app/pages/console/hooks/sequence-execution.ts src/app/pages/console/hooks/sequence-execution.spec.ts src/app/pages/console/components/exec-area/exec-area.test.tsx
git commit -m "Send actionDataSave on 0x1016 and identify sequences by actionId."
```

---

## Spec coverage

| Spec item | Task |
|---|---|
| `trapezoidToCurveSegments` packing, signs, triangle, idle | 1 |
| Compile per object/axis, hold, virtualAxisNo 1/2/3, 100 cap | 2 |
| Events `modelId/atTime/enableFlag` | 2 |
| Wire item + `toActionDataSaveItems` + drop checksum/`trajectoryMode` | 2 |
| Addr `0x1016` | 3 |
| `actionId = sequence.id`, no `actionNo`, ACK `errorCount` | 3 |
| Stop maps `actionId` → `deviceId` | 3 |
| exec-area handle rename | 3 |
| Preview / editor / prepare / sync / stop wire unchanged | (non-goals, no task) |
