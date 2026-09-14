# Action Timeline 100ms Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Action-page authored times and the playhead snap to 100ms; duration/time labels show total seconds with one decimal.

**Architecture:** Keep integer milliseconds in the document and PLC. Add `TIME_STEP_MS` / `snapTimeMs` / `formatTime` in `timeline-data.ts`. Snap at write boundaries (`clampCursorMs`, sequence-ops, property commits, transition duration). Do **not** snap `pxToMs` so pan/zoom `viewStartMs` stays a viewport coordinate.

**Tech Stack:** React, TypeScript, Vitest, Testing Library. Run only the named vitest files; do not run the full suite, `tsc --noEmit`, or a production build.

**Spec:** `docs/superpowers/specs/2026-09-14-timeline-100ms-grid-design.md`

## Global Constraints

- Grid is 100ms (`TIME_STEP_MS = 100`); `snapTimeMs(ms)` is `max(0, round(ms / 100) * 100)`.
- UI times are total seconds with one decimal (`0.0`, `1.5`, `90.5`), never `mm:ss`.
- Storage stays integer milliseconds (multiples of 100 after new writes).
- No old-document migration.
- Do not change control exec-card time, log timestamps, Cue snapshots, trapezoid accel/decel (local 2-decimal formatter), preset non-time params, or PLC payload shapes.
- `pxToMs` stays 1ms rounding. Only authored times / the playhead snap.
- `MIN_BLOCK_MS = 500` stays.
- Arrow ±100ms; Shift+arrow ±1000ms.
- `docs/` is gitignored — `git add -f` for plan/spec files.
- Targeted vitest only: `npx vitest run <paths>`.

## File structure

| File | Role |
|---|---|
| `src/app/pages/console/components/action-builder/timeline/timeline-data.ts` | `TIME_STEP_MS`, `snapTimeMs`, `msToSeconds`, `secondsToMs`, new `formatTime` |
| `src/app/pages/console/components/action-builder/timeline/timeline-data.spec.ts` | Unit tests for those helpers |
| `src/app/pages/console/components/action-builder/timeline/timeline-view-extent.ts` | `clampCursorMs` uses `snapTimeMs`; `clampViewStartMs` unchanged |
| `src/app/pages/console/components/action-builder/timeline/timeline-ruler.tsx` | Keyboard steps 100 / 1000 |
| `src/app/pages/console/components/action-builder/right-panel/sequence-properties-panel.tsx` | Time fields in `s` / 0.1 |
| `src/app/pages/console/components/action-builder/context-bar/block-context-bar.tsx` | Same time fields |
| `src/app/pages/console/components/action-builder/sequence-ops.ts` | Snap block times on insert/replace/move/shift/resize/paste |
| `src/app/pages/console/components/action-builder/editor-dock/transition-composer.tsx` | Duration writes snap; input step 0.1 |
| `src/app/pages/console/components/action-builder/action-builder-context.tsx` | Cue-drop and transition save snap |

Readouts that already import `formatTime` from `timeline-data.ts` (ruler, pose/preset drag labels, content library, 节目管理, sequence context bar, transition labels) pick up the new format from Task 1. Do not change `timeline-ticks.ts` `formatTickLabel` (`1:00` majors stay).

---

### Task 1: Time helpers and `formatTime`

**Files:**
- Create: `src/app/pages/console/components/action-builder/timeline/timeline-data.spec.ts`
- Modify: `src/app/pages/console/components/action-builder/timeline/timeline-data.ts` (after `MIN_BLOCK_MS`, replace `formatTime`)

**Interfaces:**
- Consumes: none
- Produces:
  - `export const TIME_STEP_MS = 100`
  - `export const snapTimeMs = (ms: number): number`
  - `export const msToSeconds = (ms: number): number`
  - `export const secondsToMs = (seconds: number): number`
  - `export const formatTime = (ms: number): string`

- [ ] **Step 1: Write the failing test**

Create `timeline-data.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  TIME_STEP_MS,
  formatTime,
  msToSeconds,
  pxToMs,
  secondsToMs,
  snapTimeMs,
} from "./timeline-data";

describe("snapTimeMs", () => {
  it("snaps to 100ms and clamps negatives to 0", () => {
    expect(TIME_STEP_MS).toBe(100);
    expect(snapTimeMs(0)).toBe(0);
    expect(snapTimeMs(50)).toBe(100);
    expect(snapTimeMs(149)).toBe(100);
    expect(snapTimeMs(150)).toBe(200);
    expect(snapTimeMs(-10)).toBe(0);
  });
});

describe("formatTime", () => {
  it("prints total seconds with one decimal", () => {
    expect(formatTime(0)).toBe("0.0");
    expect(formatTime(1500)).toBe("1.5");
    expect(formatTime(90_500)).toBe("90.5");
    expect(formatTime(1500)).not.toMatch(/:/);
  });
});

describe("seconds conversion", () => {
  it("converts and snaps 0.14s to 100ms", () => {
    expect(msToSeconds(1500)).toBe(1.5);
    expect(secondsToMs(0.14)).toBe(100);
    expect(secondsToMs(0.1)).toBe(100);
  });
});

describe("pxToMs", () => {
  it("still rounds to 1ms so pan is not on the authored grid", () => {
    expect(pxToMs(84.7, 100)).toBe(847);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/pages/console/components/action-builder/timeline/timeline-data.spec.ts`

Expected: FAIL (`snapTimeMs` is not exported; `formatTime` is `00:01` / `01:30`).

- [ ] **Step 3: Write minimal implementation**

In `timeline-data.ts`, after `MIN_BLOCK_MS`, replace `formatTime` and add:

```ts
export const TIME_STEP_MS = 100;

export const snapTimeMs = (ms: number): number =>
  Math.max(0, Math.round(ms / TIME_STEP_MS) * TIME_STEP_MS);

export const msToSeconds = (ms: number): number => ms / 1000;

export const secondsToMs = (seconds: number): number => snapTimeMs(seconds * 1000);

export const formatTime = (ms: number): string => msToSeconds(ms).toFixed(1);
```

Leave `pxToMs` as `Math.round((px / pxPerSecond) * 1000)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/pages/console/components/action-builder/timeline/timeline-data.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/pages/console/components/action-builder/timeline/timeline-data.ts \
  src/app/pages/console/components/action-builder/timeline/timeline-data.spec.ts
git commit -m "Add 100ms snap helpers and second-decimal formatTime."
```

---

### Task 2: Snap the playhead

**Files:**
- Modify: `src/app/pages/console/components/action-builder/timeline/timeline-view-extent.ts` (`clampCursorMs`)
- Modify: `src/app/pages/console/components/action-builder/timeline/timeline-view-extent.spec.ts`
- Modify: `src/app/pages/console/components/action-builder/timeline/sequence-track.spec.tsx` (add off-grid scrub case)

**Interfaces:**
- Consumes: `snapTimeMs` from Task 1
- Produces: `clampCursorMs(ms: number): number` — never negative, always a multiple of 100

Ruler / empty-track / playhead already call `clampCursorMs(viewStartMs + pxToMs(...))`. Snapping `clampCursorMs` is enough. Do not change `clampViewStartMs`.

- [ ] **Step 1: Extend view-extent tests**

In the existing `"does not clamp the playhead to occupied time"` test, keep `clampCursorMs(12_000) === 12_000` and add:

```ts
expect(clampCursorMs(847)).toBe(800);
expect(clampCursorMs(850)).toBe(900);
expect(clampCursorMs(851)).toBe(900);
```

(`Math.round(8.47) === 8` → 800; `Math.round(8.5) === 9` → 900.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/pages/console/components/action-builder/timeline/timeline-view-extent.spec.ts`

Expected: FAIL (`clampCursorMs(847) === 847`).

- [ ] **Step 3: Implement**

```ts
import { TIMELINE_PAD_LEFT, msToPx, pxToMs, snapTimeMs } from "./timeline-data";

export const clampCursorMs = (ms: number): number => snapTimeMs(ms);
```

- [ ] **Step 4: Add a timeline scrub assertion**

In `sequence-track.spec.tsx`, `createTimelineProps` sets `timelinePxPerSecond: 100`. Add:

```ts
it("snaps ruler scrub to 100ms", () => {
  const onCursorChange = vi.fn();
  render(<TimelineEditor {...createTimelineProps(sequence)} onCursorChange={onCursorChange} />);
  const ruler = screen.getByRole("slider", { name: "时间标尺（秒）" });
  mockRect(ruler, { left: 0, top: 0, width: 2000, height: 32 });
  fireEvent.pointerDown(ruler, { clientX: 84.7 });
  expect(onCursorChange).toHaveBeenCalledWith(800);
});
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/app/pages/console/components/action-builder/timeline/timeline-view-extent.spec.ts src/app/pages/console/components/action-builder/timeline/sequence-track.spec.tsx src/app/pages/console/components/action-builder/timeline/timeline-h-scroll.spec.tsx`

Expected: PASS. H-scroll still reports unsnapped viewStart (e.g. 4000 is fine).

- [ ] **Step 6: Commit**

```bash
git add src/app/pages/console/components/action-builder/timeline/timeline-view-extent.ts \
  src/app/pages/console/components/action-builder/timeline/timeline-view-extent.spec.ts \
  src/app/pages/console/components/action-builder/timeline/sequence-track.spec.tsx
git commit -m "Snap the timeline playhead to 100ms."
```

---

### Task 3: Arrow-key playhead steps

**Files:**
- Modify: `src/app/pages/console/components/action-builder/timeline/timeline-ruler.tsx` (`onKeyDown`, today `shiftKey ? 5000 : 1000`)
- Modify: `src/app/pages/console/components/action-builder/timeline/sequence-track.spec.tsx` (`does not clamp ruler keyboard steps to occupied time`)

**Interfaces:**
- Consumes: `TIME_STEP_MS` from Task 1
- Produces: ArrowRight from 4000 → 4100; Shift+ArrowRight from 4000 → 5000

- [ ] **Step 1: Change the existing keyboard test and add Shift**

Replace the 5000 expectation:

```ts
it("does not clamp ruler keyboard steps to occupied time", () => {
  const onCursorChange = vi.fn();
  render(
    <TimelineEditor {...createTimelineProps(sequence)} cursorMs={4000} onCursorChange={onCursorChange} />,
  );
  const ruler = screen.getByRole("slider", { name: "时间标尺（秒）" });
  fireEvent.keyDown(ruler, { key: "ArrowRight" });
  expect(onCursorChange).toHaveBeenCalledWith(4100);
  onCursorChange.mockClear();
  fireEvent.keyDown(ruler, { key: "ArrowRight", shiftKey: true });
  expect(onCursorChange).toHaveBeenCalledWith(5000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/pages/console/components/action-builder/timeline/sequence-track.spec.tsx`

Expected: FAIL (got 5000 for unshifted arrow).

- [ ] **Step 3: Implement**

In `timeline-ruler.tsx`:

```ts
import { TIME_STEP_MS, TIMELINE_PAD_LEFT, formatTime, pxToMs } from "./timeline-data";
```

```ts
const step = event.shiftKey ? TIME_STEP_MS * 10 : TIME_STEP_MS;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/pages/console/components/action-builder/timeline/sequence-track.spec.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/pages/console/components/action-builder/timeline/timeline-ruler.tsx \
  src/app/pages/console/components/action-builder/timeline/sequence-track.spec.tsx
git commit -m "Step the playhead by 0.1s, or 1s with Shift."
```

---

### Task 4: Property and context time fields in seconds

**Files:**
- Modify: `src/app/pages/console/components/action-builder/right-panel/sequence-properties-panel.tsx`
- Modify: `src/app/pages/console/components/action-builder/right-panel/sequence-properties-panel.spec.tsx` (`edits command enabled and atMs` expects `atMs: 501`)
- Modify: `src/app/pages/console/components/action-builder/context-bar/block-context-bar.tsx`

**Interfaces:**
- Consumes: `msToSeconds`, `secondsToMs` from Task 1
- Produces: time inputs `unit="s"`, `step={0.1}`, `precision={1}`; commits are multiples of 100

Leave preset **param** `step={1}` (non-time) alone.

- [ ] **Step 1: Update the 501ms test**

Enable command `atMs` is 500. After one “增加” with 0.1s step, expect 600:

```ts
stepUp("时间");
expect(handlers.onReplaceBlock).toHaveBeenCalledWith(
  expect.objectContaining({ id: "enable", atMs: 600 }),
);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/pages/console/components/action-builder/right-panel/sequence-properties-panel.spec.tsx`

Expected: FAIL (still 501).

- [ ] **Step 3: Implement property panel**

Import `msToSeconds`, `secondsToMs` from `../timeline/timeline-data`.

Pose “到达时间”, command “时间”, dynamic preset “开始时间” / “结束时间”:

```ts
value={msToSeconds(poseBlock.atMs)}
unit="s"
step={0.1}
precision={1}
min={0}
onChange={(seconds) => onReplaceBlock({ ...poseBlock, atMs: secondsToMs(seconds) })}
```

Generated pose row: `{point.atMs === null ? "—" : formatTime(point.atMs)}` — import `formatTime` from timeline-data (do not append ` ms`).

- [ ] **Step 4: Implement context bar**

Same pattern for every time `ContextNumericCell` (`时间`, `开始`, `结束`, read-only `时长`):

```ts
value={msToSeconds(block.atMs)}
unit="s"
step={0.1}
precision={1}
onChange={(seconds) => onReplaceBlock({ ...block, atMs: secondsToMs(seconds) })}
```

Read-only duration: `value={msToSeconds(segmentDurationMs)}`, `unit="s"`, no onChange.

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/app/pages/console/components/action-builder/right-panel/sequence-properties-panel.spec.tsx src/app/pages/console/components/action-builder/context-bar/selection-context-bar.spec.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/pages/console/components/action-builder/right-panel/sequence-properties-panel.tsx \
  src/app/pages/console/components/action-builder/right-panel/sequence-properties-panel.spec.tsx \
  src/app/pages/console/components/action-builder/context-bar/block-context-bar.tsx
git commit -m "Edit sequence times in seconds on a 0.1s step."
```

---

### Task 5: Snap sequence-ops writes

**Files:**
- Modify: `src/app/pages/console/components/action-builder/sequence-ops.ts`
- Modify: `src/app/pages/console/components/action-builder/sequence-ops.spec.ts`
- Modify: `src/app/pages/console/components/action-builder/action-builder-context.tsx` (`handleCueDropOnTrack` `Math.max(0, startMs)` → `snapTimeMs(startMs)`)

**Interfaces:**
- Consumes: `snapTimeMs` from Task 1
- Produces: insert/replace/move/shift/resize/paste persist snapped `atMs` / `startMs` / `endMs`

- [ ] **Step 1: Write a failing ops test**

In `sequence-ops.spec.ts` (`origin` already exists; there is no `sequenceOf`):

```ts
it("snaps moved atMs onto the 100ms grid", () => {
  const sequence: ActionSequenceConfig = {
    id: 1,
    name: "Snap",
    trajectoryMode: "non-forced",
    blocks: [{ id: "pose-a", kind: "pose", objectId: 7, atMs: 1000, pose: origin }],
    segments: [],
  };
  const next = moveTimelineBlock(sequence, "pose-a", 147);
  expect(next.blocks.find((block) => block.id === "pose-a")).toMatchObject({ atMs: 100 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/pages/console/components/action-builder/sequence-ops.spec.ts`

Expected: FAIL (`atMs: 147`).

- [ ] **Step 3: Implement**

```ts
import { snapTimeMs } from "./timeline/timeline-data";

const snapBlockTimes = (block: TimelineBlock): TimelineBlock => {
  if (block.kind === "dynamic-preset") {
    return {
      ...block,
      startMs: snapTimeMs(block.startMs),
      endMs: snapTimeMs(block.endMs),
    };
  }
  return { ...block, atMs: snapTimeMs(block.atMs) };
};
```

Call `snapBlockTimes` on the block **before** `blockError` / commit in:

- `insertTimelineBlock`
- `replaceTimelineBlock` (snap `replacement`)
- `moveTimelineBlock` (snap result of `moveBlockTo`)
- `shiftTimelineBlocks` (snap each shifted block)
- `resizeDynamicPreset` (snap `startMs`/`endMs` arguments)
- `pasteTimelineBlocks` (snap each shifted clone)

Keep existing overlap / `end <= start` rejection.

Cue drop in `action-builder-context.tsx`:

```ts
const atMs = snapTimeMs(startMs);
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/app/pages/console/components/action-builder/sequence-ops.spec.ts`

Expected: PASS. Existing cases that already use 1000/1500/2000 stay valid.

- [ ] **Step 5: Commit**

```bash
git add src/app/pages/console/components/action-builder/sequence-ops.ts \
  src/app/pages/console/components/action-builder/sequence-ops.spec.ts \
  src/app/pages/console/components/action-builder/action-builder-context.tsx
git commit -m "Snap sequence block times to 100ms on write."
```

---

### Task 6: Transition duration snap

**Files:**
- Modify: `src/app/pages/console/components/action-builder/editor-dock/transition-composer.tsx` (`applyDuration`, duration `<input step="0.5">`)
- Modify: `src/app/pages/console/components/action-builder/action-builder-context.tsx` (`handleTransitionSave`)

**Interfaces:**
- Consumes: `snapTimeMs`, `TIME_STEP_MS` from Task 1
- Produces: transition duration is a multiple of 100ms; duration input step `0.1`

- [ ] **Step 1: Implement**

`applyDuration`:

```ts
const applyDuration = (ms: number) => {
  setDurationMs(snapTimeMs(Math.max(TIME_STEP_MS, ms)));
};
```

Duration input: `step="0.1"` (was `0.5`). Keep `min="0.1"`.

`handleTransitionSave`:

```ts
const next = buildTransitionSequence(id, from, to, snapTimeMs(durationMs), getTimelineObject);
```

No new test file required unless one already covers `applyDuration`. If `transition-math.spec.ts` / a composer spec exists for the duration field, update step/snap there. Do not add a browser E2E.

- [ ] **Step 2: Run related tests**

Run: `npx vitest run src/app/pages/console/components/action-builder/editor-dock/transition-math.spec.ts src/app/pages/console/components/action-builder/timeline/timeline-data.spec.ts`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/pages/console/components/action-builder/editor-dock/transition-composer.tsx \
  src/app/pages/console/components/action-builder/action-builder-context.tsx
git commit -m "Snap Cue-transition duration to 100ms."
```

---

### Task 7: Targeted regression sweep

**Files:** none new

- [ ] **Step 1: Run the spec’s targeted files**

```
npx vitest run \
  src/app/pages/console/components/action-builder/timeline/timeline-data.spec.ts \
  src/app/pages/console/components/action-builder/timeline/timeline-view-extent.spec.ts \
  src/app/pages/console/components/action-builder/timeline/sequence-track.spec.tsx \
  src/app/pages/console/components/action-builder/timeline/timeline-h-scroll.spec.tsx \
  src/app/pages/console/components/action-builder/right-panel/sequence-properties-panel.spec.tsx \
  src/app/pages/console/components/action-builder/context-bar/selection-context-bar.spec.tsx \
  src/app/pages/console/components/action-builder/sequence-ops.spec.ts \
  src/app/pages/console/components/action-builder/content-library/content-library-panel.spec.tsx \
  src/app/pages/console/components/action-builder/editor-dock/transition-math.spec.ts
```

Expected: PASS. Do not run full `vitest`, `tsc --noEmit`, or production build.

If content-library or 节目管理 tests assert `mm:ss` duration text, update them to `formatTime` (`1.0` etc.). Exec-area `00:01.5` must still pass if you happen to open that file — do not change it.

- [ ] **Step 2: Commit only if Step 1 caused fixes**

```bash
git commit -m "Fix 100ms-grid test fallout on action-page readouts."
```

Skip this commit if the sweep was clean.
