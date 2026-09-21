# Traveling Wave Chase Poses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 行进波浪每个周期只显示基准→波峰→基准；块头尾等待不打 tick，由解析层隐式 hold 接线。

**Architecture:** `resolvePreset` 只发可见关键帧（`1 + 2 * cycles` 个点）。放宽动态预设契约为第一点 `>= startMs`、最后一点 `<= endMs`。`resolveActionSequence` 为缺边的物体补 `visible: false` 的边界 hold；从 `startMs` hold 到第一可见点的内部段 `toPose` 等于 hold（等待保持块前位姿，不插值到基准）。时间轴 tick 与「每物体 N 个位姿」只数 `visible: true`。

**Tech Stack:** TypeScript, Vitest, existing action-sequence resolve/evaluate/timeline.

## Global Constraints

- 不恢复正弦密采样
- 不改 PLC 梯形三相格式（`a/b/c`）
- 不把「水平升降」改成可以不贴 `startMs`/`endMs`（它仍发两点贴边界）
- 不做连续正弦下发
- 禁止全量 `vitest run` / `npm test` / `tsc --noEmit` / 整包 build；只跑本任务点名的文件
- 中文 UI 文案；token 用 theme，不硬编码色值

---

### Task 1: Visible chase keyframes and relaxed dynamic contract

**Files:**
- Modify: `src/app/project/action-sequence/preset-registry.ts` (`dynamicWave.resolve`, `assertPoseContract`)
- Test: `src/app/project/action-sequence/preset-registry.spec.ts`

**Interfaces:**
- Consumes: existing `dynamicWavePhaseDurationMs(startMs, endMs, objectCount, staggerMs, cycles): number`, `staggerIndexOf`, `pushChasePose`
- Produces: `resolvePreset` for `dynamic-wave` emits only visible keyframes: first at `motionStart`, then peak/base per cycle. Count per object is `1 + 2 * cycles`. `assertPoseContract` for dynamic presets requires `series[0].atMs >= dyn.startMs` and `series[series.length - 1].atMs <= dyn.endMs` (equality no longer required).

- [ ] **Step 1: Write the failing test**

In `src/app/project/action-sequence/preset-registry.spec.ts`, replace the current 4-point chase expectations with 3 visible points (and add a 2-cycle case). Keep `waveBlock()` as `startMs: 1000`, `endMs: 3000`, `staggerMs: 500`, `cycles: 1`, objects `[7, 8]`.

```ts
  it("staggers a rise-fall chase along participant order", () => {
    const points = resolvePreset(waveBlock());
    expect(points.map((point) => [point.objectId, point.atMs, point.pose.v1, point.sourceRef])).toEqual([
      [7, 1000, 1000, "preset:wave-1:7:0"],
      [7, 1750, 1500, "preset:wave-1:7:1"],
      [7, 2500, 1000, "preset:wave-1:7:2"],
      [8, 1500, 1000, "preset:wave-1:8:0"],
      [8, 2250, 1500, "preset:wave-1:8:1"],
      [8, 3000, 1000, "preset:wave-1:8:2"],
    ]);
    expect(countPosesPerObject(points).get(7)).toBe(3);
    expect(countPosesPerObject(points).get(8)).toBe(3);
    const reversed = resolvePreset({ ...waveBlock(), orderedObjectIds: [8, 7] });
    expect(reversed[0]?.sourceRef).toBe("preset:wave-1:8:0");
    expect(reversed.find((point) => point.sourceRef === "preset:wave-1:8:1")?.atMs).toBe(1750);
    expect(reversed.find((point) => point.sourceRef === "preset:wave-1:7:0")?.atMs).toBe(1500);
    const backward = resolvePreset({ ...waveBlock(), params: { ...waveBlock().params, direction: -1 } });
    expect(backward.find((point) => point.sourceRef === "preset:wave-1:7:0")?.atMs).toBe(1500);
    expect(backward.find((point) => point.sourceRef === "preset:wave-1:8:0")?.atMs).toBe(1000);
  });

  it("stretches equal rise/fall phases when the block duration changes", () => {
    const points = resolvePreset({
      ...waveBlock(),
      endMs: 3100,
    });
    expect(points.filter((point) => point.objectId === 7).map((point) => point.atMs)).toEqual([
      1000, 1800, 2600,
    ]);
    expect(points.filter((point) => point.objectId === 8).map((point) => point.atMs)).toEqual([
      1500, 2300, 3100,
    ]);
  });

  it("shares the baseline between stitched cycles", () => {
    const points = resolvePreset({
      ...waveBlock(),
      params: { ...waveBlock().params, cycles: 2 },
    });
    expect(points.filter((point) => point.objectId === 7).map((point) => [point.atMs, point.pose.v1])).toEqual([
      [1000, 1000],
      [1375, 1500],
      [1750, 1000],
      [2125, 1500],
      [2500, 1000],
    ]);
    expect(countPosesPerObject(points).get(7)).toBe(5);
  });
```

Import `countPosesPerObject` if the file does not already (it does).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/project/action-sequence/preset-registry.spec.ts`

Expected: FAIL. Current resolve still pushes `startMs`/`endMs` baseline pads, so object 7 has a fourth point at 3000 and object 8 has a point at 1000.

- [ ] **Step 3: Write minimal implementation**

In `dynamicWave.resolve`, emit only the motion window keyframes (do not push `dyn.startMs` or `dyn.endMs` unless they coincide with `motionStart` / last fall):

```ts
    dyn.orderedObjectIds.forEach((objectId, participantIndex) => {
      const delayMs = staggerIndexOf(participantIndex, count, direction) * staggerMs;
      const motionStartMs = dyn.startMs + delayMs;
      const nextIndex = { value: 0 };
      pushChasePose(points, dyn, objectId, nextIndex, motionStartMs, baseV1);
      for (let cycle = 0; cycle < cycles; cycle += 1) {
        const riseEndMs = motionStartMs + (cycle * 2 + 1) * phaseMs;
        const fallEndMs = motionStartMs + (cycle * 2 + 2) * phaseMs;
        pushChasePose(points, dyn, objectId, nextIndex, riseEndMs, peakV1);
        pushChasePose(points, dyn, objectId, nextIndex, fallEndMs, baseV1);
      }
    });
```

In `assertPoseContract`, replace the two equality checks with inclusive bounds:

```ts
    if (series[0]!.atMs < dyn.startMs) {
      throw new Error("dynamic preset first pose must be at or after startMs");
    }
    if (series[series.length - 1]!.atMs > dyn.endMs) {
      throw new Error("dynamic preset last pose must be at or before endMs");
    }
```

Do not change `dynamic-level` resolve; it still emits exactly `startMs` and `endMs`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/project/action-sequence/preset-registry.spec.ts`

Expected: PASS (17+ tests; the new cycle test included).

- [ ] **Step 5: Commit**

```bash
git add src/app/project/action-sequence/preset-registry.ts src/app/project/action-sequence/preset-registry.spec.ts
git commit -m "Emit only baseline-peak-baseline keyframes for traveling wave."
```

---

### Task 2: Invisible boundary holds and wait-segment hold

**Files:**
- Modify: `src/app/project/action-sequence/resolve-sequence.ts`
- Test: `src/app/project/action-sequence/resolve-sequence.spec.ts`

**Interfaces:**
- Consumes: `resolvePreset` visible points from Task 1; `syncSettingsToTravel`
- Produces: `ResolvedPosePoint.visible: boolean`. Wave objects missing a visible point at `startMs`/`endMs` get `visible: false` holds. Wait internal segment (`hold-start` → first visible) uses `toPose === fromPose` (block-previous pose), then `syncSettingsToTravel` makes it `idle`. Neighbor configurable segments attach to hold refs at the block edges.

- [ ] **Step 1: Write the failing test**

Add/replace in `src/app/project/action-sequence/resolve-sequence.spec.ts`. Use the same wave block as Task 1 (`staggerMs: 500`, 1000–3000). Extend `"owns every dynamic-wave chase interval..."` and add a neighbor-attachment case.

```ts
  it("owns every dynamic-wave chase interval as a cloned shared profile", () => {
    const profiles = axisProfiles(400, 400);
    const block: DynamicPresetBlock = {
      id: "wave-1",
      kind: "dynamic-preset",
      presetId: "dynamic-wave",
      startMs: 1000,
      endMs: 3000,
      orderedObjectIds: [7, 8],
      params: {
        baseV1: 1000,
        amplitude: 500,
        cycles: 1,
        direction: 1,
        staggerMs: 500,
        v2: 0,
        v3: 0,
      },
      profiles,
    };
    const resolved = resolveActionSequence(sequenceOf([block]));
    const visibles = resolved.poses.filter((point) => point.visible);
    expect(visibles.filter((point) => point.objectId === 7).map((point) => point.atMs)).toEqual([
      1000, 1750, 2500,
    ]);
    expect(visibles.filter((point) => point.objectId === 8).map((point) => point.atMs)).toEqual([
      1500, 2250, 3000,
    ]);
    expect(
      resolved.poses.filter((point) => point.objectId === 7 && !point.visible).map((point) => [
        point.atMs,
        point.sourceRef,
      ]),
    ).toEqual([[3000, "preset:wave-1:7:hold-end"]]);
    expect(
      resolved.poses.filter((point) => point.objectId === 8 && !point.visible).map((point) => [
        point.atMs,
        point.sourceRef,
      ]),
    ).toEqual([[1000, "preset:wave-1:8:hold-start"]]);

    const internals = resolved.segments.filter((segment) => !segment.configurable);
    expect(
      internals.filter((segment) => segment.objectId === 7).map((segment) => [
        segment.fromRef,
        segment.toRef,
        segment.settings.profiles.v1.kind,
      ]),
    ).toEqual([
      ["preset:wave-1:7:0", "preset:wave-1:7:1", "trapezoid"],
      ["preset:wave-1:7:1", "preset:wave-1:7:2", "trapezoid"],
      ["preset:wave-1:7:2", "preset:wave-1:7:hold-end", "idle"],
    ]);
    expect(
      internals.filter((segment) => segment.objectId === 8).map((segment) => [
        segment.fromRef,
        segment.toRef,
        segment.settings.profiles.v1.kind,
      ]),
    ).toEqual([
      ["preset:wave-1:8:hold-start", "preset:wave-1:8:0", "idle"],
      ["preset:wave-1:8:0", "preset:wave-1:8:1", "trapezoid"],
      ["preset:wave-1:8:1", "preset:wave-1:8:2", "trapezoid"],
    ]);
    expect(reconcileSegmentConfigs(resolved.segments, [])).toEqual([]);
  });

  it("attaches neighbors to wave boundary holds, not the first delayed keyframe", () => {
    const resolved = resolveActionSequence(
      sequenceOf([
        pose("prior", 8, 0, { v1: 200, v2: 10, v3: 5 }),
        {
          id: "wave-1",
          kind: "dynamic-preset",
          presetId: "dynamic-wave",
          startMs: 1000,
          endMs: 3000,
          orderedObjectIds: [7, 8],
          params: {
            baseV1: 1000,
            amplitude: 500,
            cycles: 1,
            direction: 1,
            staggerMs: 500,
          },
          profiles: axisProfiles(400, 400),
        },
        pose("after", 7, 4000, { v1: 0, v2: 0, v3: 0 }),
      ]),
    );
    expect(resolved.segments.filter((segment) => segment.configurable && segment.objectId === 8)).toEqual([
      expect.objectContaining({
        fromRef: "prior",
        toRef: "preset:wave-1:8:hold-start",
        endMs: 1000,
      }),
    ]);
    expect(resolved.segments.filter((segment) => segment.configurable && segment.objectId === 7)).toEqual([
      expect.objectContaining({
        fromRef: "preset:wave-1:7:hold-end",
        toRef: "after",
        startMs: 3000,
      }),
    ]);
    const wait = resolved.segments.find(
      (segment) => segment.fromRef === "preset:wave-1:8:hold-start" && segment.toRef === "preset:wave-1:8:0",
    );
    expect(wait?.fromPose.v1).toBe(200);
    expect(wait?.toPose.v1).toBe(200);
    expect(wait?.settings.profiles.v1.kind).toBe("idle");
  });
```

Every existing `timed.push({ ... editable })` site in tests that construct `ResolvedPosePoint` literals must include `visible: true` once the field exists — only the spec file at line ~265 currently asserts a full point object; update that literal when the type grows.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/project/action-sequence/resolve-sequence.spec.ts`

Expected: FAIL. No `visible` field; delayed object still has a visible point at 1000; neighbor `toRef` is the first keyframe at 1500.

- [ ] **Step 3: Write minimal implementation**

Add `visible: boolean` to `ResolvedPosePoint` in `resolve-sequence.ts`. Set `visible: true` on authored poses and on points copied from `resolvePreset`.

After `timed.sort` and `carryUnownedAxes`, inject holds then sort again:

```ts
const WAVE_HOLD_START = "hold-start";
const WAVE_HOLD_END = "hold-end";

const injectDynamicWaveBoundaryHolds = (
  timed: ResolvedPosePoint[],
  blocks: ActionSequenceConfig["blocks"],
): void => {
  for (const block of blocks) {
    if (block.kind !== "dynamic-preset" || block.presetId !== "dynamic-wave") continue;
    for (const objectId of block.orderedObjectIds) {
      const visibles = timed.filter(
        (point) =>
          point.objectId === objectId &&
          point.sourceBlockId === block.id &&
          point.visible,
      );
      const first = visibles[0];
      const last = visibles[visibles.length - 1];
      if (!first || !last) continue;
      if (first.atMs > block.startMs) {
        const previous = [...timed]
          .filter((point) => point.objectId === objectId && point.atMs < block.startMs)
          .sort((left, right) => left.atMs - right.atMs)
          .at(-1);
        timed.push({
          sourceRef: `preset:${block.id}:${objectId}:${WAVE_HOLD_START}`,
          sourceBlockId: block.id,
          sourceKind: "dynamic-preset",
          objectId,
          atMs: block.startMs,
          pose: clonePose(previous?.pose ?? first.pose),
          editable: false,
          visible: false,
        });
      }
      if (last.atMs < block.endMs) {
        timed.push({
          sourceRef: `preset:${block.id}:${objectId}:${WAVE_HOLD_END}`,
          sourceBlockId: block.id,
          sourceKind: "dynamic-preset",
          objectId,
          atMs: block.endMs,
          pose: clonePose(last.pose),
          editable: false,
          visible: false,
        });
      }
    }
  }
};
```

Call it after the first sort + `carryUnownedAxes`, then sort `timed` again (same comparator), then rebuild `posesByObject` from the injected list (move the `posesByObject` loop to after injection).

When building an internal dynamic segment, if `from.visible === false` and `from.atMs === block.startMs`, force hold:

```ts
        const fromPose = clonePose(from.pose);
        const toPose =
          from.visible === false && from.atMs === block.startMs
            ? clonePose(from.pose)
            : clonePose(to.pose);
```

Then `syncSettingsToTravel` as today.

Also set `visible: true` in `preset-block-panel.tsx` fallback `resolvePreset(...).map` so the type checks.

Update `resolve-sequence.spec.ts` full-object assertion around the existing `editable: true` literal to include `visible: true`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/project/action-sequence/resolve-sequence.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/project/action-sequence/resolve-sequence.ts src/app/project/action-sequence/resolve-sequence.spec.ts src/app/pages/console/components/action-builder/right-panel/preset-block-panel.tsx
git commit -m "Hide traveling-wave edge waits as idle boundary holds."
```

---

### Task 3: Timeline ticks and pose count ignore holds

**Files:**
- Modify: `src/app/pages/console/components/action-builder/timeline/timeline-editor.tsx` (generatedTicksByPreset filter)
- Modify: `src/app/pages/console/components/action-builder/right-panel/preset-block-panel.tsx` (`generatedPosesFor`)
- Test: `src/app/pages/console/components/action-builder/timeline/preset-projection.spec.tsx` (keep passing; add a resolve-driven tick test if none exists)

**Interfaces:**
- Consumes: `ResolvedPosePoint.visible` from Task 2
- Produces: `generatedTicksByPreset` and 「每物体 N 个位姿」 count only `visible` points (3 for one cycle).

- [ ] **Step 1: Write the failing test**

There is no editor-level tick unit test today. Add a focused test next to timeline helpers, or extend `preset-projection.spec.tsx` only if you extract the filter. Prefer a tiny helper in `timeline-editor.tsx` is wrong (file already large). Put the filter in `src/app/pages/console/components/action-builder/timeline/preset-ticks.ts`:

```ts
import type { ResolvedPosePoint } from "@/app/project/action-sequence/resolve-sequence";

export const visibleGeneratedAtMs = (
  poses: readonly ResolvedPosePoint[],
  objectId: number,
  blockId: string,
): number[] =>
  poses
    .filter(
      (point) =>
        point.visible &&
        point.objectId === objectId &&
        point.sourceBlockId === blockId &&
        point.sourceKind === "dynamic-preset",
    )
    .map((point) => point.atMs);
```

Test file `src/app/pages/console/components/action-builder/timeline/preset-ticks.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import { createDefaultAxisProfiles } from "@/app/project/action-sequence/motion-profile";
import { visibleGeneratedAtMs } from "./preset-ticks";

it("omits wave boundary holds from generated ticks", () => {
  const resolved = resolveActionSequence({
    id: 1,
    name: "Seq",
    trajectoryMode: "non-forced",
    blocks: [
      {
        id: "wave-1",
        kind: "dynamic-preset",
        presetId: "dynamic-wave",
        startMs: 1000,
        endMs: 3000,
        orderedObjectIds: [7, 8],
        params: { baseV1: 1000, amplitude: 500, cycles: 1, direction: 1, staggerMs: 500 },
        profiles: createDefaultAxisProfiles(750),
      },
    ],
    segments: [],
  });
  expect(visibleGeneratedAtMs(resolved.poses, 7, "wave-1")).toEqual([1000, 1750, 2500]);
  expect(visibleGeneratedAtMs(resolved.poses, 8, "wave-1")).toEqual([1500, 2250, 3000]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/pages/console/components/action-builder/timeline/preset-ticks.spec.ts`

Expected: FAIL until the helper exists (or FAIL with extra 1000/3000 ticks if the helper is written as an unfiltered copy of today’s editor logic).

- [ ] **Step 3: Write minimal implementation**

Create `preset-ticks.ts` as above.

In `timeline-editor.tsx` replace the inline filter with:

```ts
generatedTicksByPreset[block.id] = visibleGeneratedAtMs(resolved.poses, objectId, block.id);
```

In `preset-block-panel.tsx` `generatedPosesFor`:

```ts
  const fromResolved = resolved.poses.filter(
    (point) => point.sourceBlockId === block.id && point.visible,
  );
```

Fallback `resolvePreset` map: `{ ...point, sourceKind: block.kind, sourceBlockId: block.id, editable: false, visible: true }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/pages/console/components/action-builder/timeline/preset-ticks.spec.ts src/app/pages/console/components/action-builder/timeline/preset-projection.spec.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/pages/console/components/action-builder/timeline/preset-ticks.ts src/app/pages/console/components/action-builder/timeline/preset-ticks.spec.ts src/app/pages/console/components/action-builder/timeline/timeline-editor.tsx src/app/pages/console/components/action-builder/right-panel/preset-block-panel.tsx
git commit -m "Count and tick only visible traveling-wave keyframes."
```

---

### Task 4: Evaluate wait as previous pose; keep stretch valid

**Files:**
- Modify: `src/app/project/action-sequence/evaluate-sequence.spec.ts`
- Modify: `src/app/project/action-sequence/preset-defaults.spec.ts` (only if assertions still expect padded times)
- Test: those two files plus `src/app/project/action-sequence/preset-defaults.ts` (no logic change expected)

**Interfaces:**
- Consumes: Task 2 hold segments (`toPose` stays at previous during wait)
- Produces: evaluation at wait times equals block-previous pose; peak/fall behavior unchanged; fitted wave plus +100ms duration still has no error issues.

- [ ] **Step 1: Write the failing test**

Replace/extend the chase evaluate test in `evaluate-sequence.spec.ts`:

```ts
  it("holds the pre-block pose during the delayed object's wait, then chases", () => {
    const resolved = resolveActionSequence({
      id: 1,
      name: "Seq",
      trajectoryMode: "non-forced",
      blocks: [
        {
          id: "prior",
          kind: "pose",
          objectId: 8,
          atMs: 0,
          pose: { v1: 200, v2: 10, v3: 5 },
        },
        {
          id: "wave-1",
          kind: "dynamic-preset",
          presetId: "dynamic-wave",
          startMs: 1000,
          endMs: 3000,
          orderedObjectIds: [7, 8],
          params: {
            baseV1: 1000,
            amplitude: 500,
            cycles: 1,
            direction: 1,
            staggerMs: 500,
          },
          profiles: axisProfiles(100, 100),
        },
      ],
      segments: [],
    });

    expect(evaluateResolvedSequence(resolved, 1200).get(8)?.v1).toBe(200);
    expect(evaluateResolvedSequence(resolved, 1500).get(8)?.v1).toBe(1000);
    expect(evaluateResolvedSequence(resolved, 1750).get(7)?.v1).toBe(1500);
    const restarted = evaluateResolvedSequence(resolved, 1760).get(7)?.v1;
    expect(restarted).toBeGreaterThan(1493);
    expect(restarted).toBeLessThan(1500);
    expect(evaluateResolvedSequence(resolved, 2700).get(7)?.v1).toBe(1000);
  });
```

Keep the existing `preset-defaults.spec.ts` stretch test; it should still expect zero errors.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/project/action-sequence/evaluate-sequence.spec.ts`

Expected: FAIL if wait still interpolates 200→1000 (value between 200 and 1000 at 1200ms) or if Task 2 is not done.

- [ ] **Step 3: Write minimal implementation**

If Task 2 wait `toPose` is correct, evaluate already holds 200 (idle, travel 0). No evaluate-sequence.ts change. If 1200 still lerps, fix the wait `toPose` clone in Task 2 (do not interpolate in evaluate).

Confirm `preset-defaults.spec.ts` still passes without changing `fitPresetParams`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/project/action-sequence/evaluate-sequence.spec.ts src/app/project/action-sequence/preset-defaults.spec.ts src/app/project/action-sequence/preset-registry.spec.ts src/app/project/action-sequence/resolve-sequence.spec.ts src/app/project/action-sequence/validate-sequence.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/project/action-sequence/evaluate-sequence.spec.ts src/app/project/action-sequence/preset-defaults.spec.ts
git commit -m "Assert traveling-wave wait holds the pose from before the block."
```

---

## Self-review

**Spec coverage:**
- Visible 3/5 poses → Task 1
- Relaxed first/last bounds → Task 1
- Implicit holds, idle wait, neighbor attach at block edges → Task 2
- Ticks / pose count exclude holds → Task 3
- Evaluate wait + peak + post-fall hold; stretch +100ms → Task 4
- Params unchanged; no sine/PLC/`dynamic-level` rewrite → not tasked

**Placeholders:** none.

**Types:** `ResolvedPosePoint.visible` is introduced in Task 2 and consumed in Tasks 3–4. Hold refs are `preset:${blockId}:${objectId}:hold-start` and `hold-end`.
