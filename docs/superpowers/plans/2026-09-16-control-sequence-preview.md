# Control Sequence Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the control page, click an F-slot name or a program row to preview that sequence in 3D (trajectory lines + ghosts + total time) with a mini transport bar for scrub / play; long-press an F-slot name to auto-play while held. Local evaluation only, no PLC, real objects never move.

**Architecture:** A `SequencePreviewProvider` owns `{ sequenceId, cursorMs, isPlaying, holdMode, faderPercent, multiplier }` and a rAF ticker. Pure helpers in `sequence-preview.ts` sample paths and pick ghosts from `resolveActionSequence` / `evaluateResolvedSequence`. A new engine `SequencePreviewController` draws `LinesMesh` paths and reuses `GoShadow` (cyan) for ghosts. `Viz3DSequencePreviewSync` pushes state to the engine; `SequencePreviewBar` lives in `ViewportOverlay`; `FaderSlot` / control `ProgramPanel` are the entry points; GO exits preview.

**Tech Stack:** React, TypeScript, Babylon.js, Vitest, Testing Library. Targeted vitest only. No full suite, `tsc --noEmit`, production build, or GUI / screen testing.

**Spec:** `docs/superpowers/specs/2026-09-16-control-sequence-preview-design.md`

## Global Constraints

- Entry points are the F-slot **card** (except fader and Ready/GO) and the control program **row**. Not Ready/GO, not the fader, not hover.
- Click toggles; a different id switches. Long-press (≥ 400ms, < 8px movement) = hold-mode autoplay, release clears.
- Ghosts reuse `GoShadow` with `colors.primary`; GO shadows stay `colors.secondary`. Paths are cyan `LinesMesh`, `isPickable = false`.
- Sampling: 100ms step + segment boundaries. Positions computed inside the engine from `handle.getConfig()` via `resolveVirtualAxisTransform`.
- Playback advance = `dt × faderPercent/100 × multiplier`. Click-mode stops at `totalMs`; hold-mode loops.
- Auto-exit on GO launch, on leaving `control` nav, on project change, on sequence disappearing.
- Invalid sequence: `toast.warning`, no preview.
- Do not touch `Viz3DGoShadowSync`, `Viz3DActionPreviewSync`, Ready/GO flow, active-task cards, or PLC transport.
- `docs/` is gitignored — `git add -f` for plan/spec files.
- Targeted vitest only: `npx vitest run <paths>`. `ReadLints` only on changed files.

## File structure

| File | Role |
|---|---|
| `src/app/pages/console/hooks/sequence-preview.ts` | Pure: `sampleSequencePaths`, `previewGhostsAt`, `memberObjectIds`, `advancePreviewCursor` |
| `src/app/pages/console/hooks/sequence-preview.spec.ts` | Tests for the above |
| `src/app/pages/console/hooks/sequence-preview-provider.tsx` | Context + rAF ticker + auto-exit; `useSequencePreview` |
| `src/app/pages/console/hooks/sequence-preview-provider.spec.tsx` | Provider tests |
| `src/app/viz3d/state/preview-path-points.ts` | Pure: `previewPathPoints(config, poses): Vec3[]` |
| `src/app/viz3d/state/preview-path-points.spec.ts` | Tests |
| `src/app/viz3d/state/GoShadow.ts` | Optional `color` ctor arg |
| `src/app/viz3d/state/SequencePreviewController.ts` | Paths + ghosts controller |
| `src/app/viz3d/engine/Viz3DEngine.ts` | `setSequencePreview`, `clearSequencePreview`, lifecycle |
| `src/app/pages/console/3d/Viz3DSequencePreviewSync.tsx` | State → engine |
| `src/app/pages/console/3d/membership-dim.ts` (+ test) | Accept control-preview member ids |
| `src/app/pages/console/3d/Viz3DMembershipDimSync.tsx` | Pass preview sequence |
| `src/app/pages/console/3d/overlays/sequence-preview-bar.tsx` (+ spec) | Mini transport |
| `src/app/pages/console/3d/overlays/ViewportOverlay.tsx` | Mount the bar on control |
| `src/app/pages/console/components/exec-area/executors/fader-slot.tsx` | Name button, click + long-press |
| `src/app/pages/console/components/exec-area/executors/executors.tsx` | Wire preview |
| `src/app/pages/console/components/program-panel/program-panel.tsx` | Control row click → preview |
| `src/app/pages/console/components/program-panel/page-section.tsx` | Pass `onClickItem`, `activeSequenceId` |
| `src/app/pages/console/components/exec-area/exec-area.tsx` | `stopPreview()` after GO launch |
| `src/app/pages/console/components/exec-area/exec-area.test.tsx` | Slot name / long-press / GO-exit tests |
| `src/app/pages/console/console-page.tsx` | Mount provider + sync |

---

### Task 1: Pure preview helpers

**Files:**
- Create: `src/app/pages/console/hooks/sequence-preview.ts`
- Create: `src/app/pages/console/hooks/sequence-preview.spec.ts`

**Interfaces:**
- Consumes: `ResolvedActionSequence` from `@/app/project/action-sequence/resolve-sequence`; `evaluateResolvedSequence` from `@/app/project/action-sequence/evaluate-sequence`; `ModelPose` from `@/app/project/action-sequence/types`.
- Produces:
  - `export const PREVIEW_SAMPLE_STEP_MS = 100`
  - `export type PreviewSample = { atMs: number; pose: ModelPose }`
  - `export const sampleSequencePaths = (resolved: ResolvedActionSequence, stepMs = PREVIEW_SAMPLE_STEP_MS): Map<number, PreviewSample[]>`
  - `export type PreviewGhost = { objectId: number; role: "start" | "end" | "cursor"; pose: ModelPose }`
  - `export const previewGhostsAt = (resolved: ResolvedActionSequence, cursorMs: number): PreviewGhost[]`
  - `export const memberObjectIds = (resolved: ResolvedActionSequence): number[]`
  - `export const advancePreviewCursor = (args: { cursorMs: number; dtMs: number; faderPercent: number; multiplier: number; totalMs: number; loop: boolean }): { cursorMs: number; ended: boolean }`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { resolveActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import { createDefaultAxisProfiles } from "@/app/project/action-sequence/motion-profile";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import {
  advancePreviewCursor,
  memberObjectIds,
  previewGhostsAt,
  sampleSequencePaths,
} from "./sequence-preview";

const moving: ActionSequenceConfig = {
  id: 1,
  name: "Seq",
  trajectoryMode: "forced",
  blocks: [
    { id: "a", kind: "pose", objectId: 7, atMs: 0, pose: { v1: 0, v2: 0, v3: 0 } },
    { id: "b", kind: "pose", objectId: 7, atMs: 1050, pose: { v1: 100, v2: 0, v3: 0 } },
    { id: "c", kind: "pose", objectId: 9, atMs: 500, pose: { v1: 5, v2: 0, v3: 0 } },
  ],
  segments: [{ fromRef: "a", toRef: "b", settings: { profiles: createDefaultAxisProfiles(1050) } }],
};

describe("sampleSequencePaths", () => {
  it("samples every 100ms plus segment boundaries, sorted and unique", () => {
    const resolved = resolveActionSequence(moving);
    const samples = sampleSequencePaths(resolved).get(7)!;
    const times = samples.map((s) => s.atMs);
    expect(times[0]).toBe(0);
    expect(times).toContain(1000);
    expect(times).toContain(1050);
    expect(new Set(times).size).toBe(times.length);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(samples[0]!.pose.v1).toBe(0);
    expect(samples[samples.length - 1]!.pose.v1).toBe(100);
  });
});

describe("previewGhostsAt", () => {
  it("shows start and end ghosts at cursor 0", () => {
    const ghosts = previewGhostsAt(resolveActionSequence(moving), 0);
    expect(ghosts.filter((g) => g.objectId === 7).map((g) => g.role).sort()).toEqual(["end", "start"]);
  });
  it("shows start and cursor ghosts mid-run", () => {
    const ghosts = previewGhostsAt(resolveActionSequence(moving), 500);
    const roles = ghosts.filter((g) => g.objectId === 7).map((g) => g.role).sort();
    expect(roles).toEqual(["cursor", "start"]);
  });
});

describe("memberObjectIds", () => {
  it("lists objects with poses", () => {
    expect(memberObjectIds(resolveActionSequence(moving)).sort()).toEqual([7, 9]);
  });
});

describe("advancePreviewCursor", () => {
  it("scales by fader percent and multiplier", () => {
    expect(
      advancePreviewCursor({ cursorMs: 0, dtMs: 100, faderPercent: 150, multiplier: 2, totalMs: 5000, loop: false }),
    ).toEqual({ cursorMs: 300, ended: false });
  });
  it("clamps at total when not looping", () => {
    expect(
      advancePreviewCursor({ cursorMs: 4950, dtMs: 100, faderPercent: 100, multiplier: 1, totalMs: 5000, loop: false }),
    ).toEqual({ cursorMs: 5000, ended: true });
  });
  it("wraps when looping", () => {
    expect(
      advancePreviewCursor({ cursorMs: 4950, dtMs: 100, faderPercent: 100, multiplier: 1, totalMs: 5000, loop: true }),
    ).toEqual({ cursorMs: 50, ended: false });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

`npx vitest run src/app/pages/console/hooks/sequence-preview.spec.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
import { evaluateResolvedSequence } from "@/app/project/action-sequence/evaluate-sequence";
import type { ResolvedActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import type { ModelPose } from "@/app/project/action-sequence/types";

export const PREVIEW_SAMPLE_STEP_MS = 100;

export type PreviewSample = { atMs: number; pose: ModelPose };
export type PreviewGhost = { objectId: number; role: "start" | "end" | "cursor"; pose: ModelPose };

const sampleTimes = (resolved: ResolvedActionSequence, stepMs: number): number[] => {
  const times = new Set<number>([0, resolved.totalMs]);
  for (let t = 0; t < resolved.totalMs; t += stepMs) times.add(t);
  for (const segment of resolved.segments) {
    times.add(segment.startMs);
    times.add(segment.endMs);
  }
  return [...times].sort((a, b) => a - b);
};

export const memberObjectIds = (resolved: ResolvedActionSequence): number[] =>
  [...resolved.posesByObject.keys()];

export const sampleSequencePaths = (
  resolved: ResolvedActionSequence,
  stepMs = PREVIEW_SAMPLE_STEP_MS,
): Map<number, PreviewSample[]> => {
  const result = new Map<number, PreviewSample[]>();
  for (const id of memberObjectIds(resolved)) result.set(id, []);
  for (const atMs of sampleTimes(resolved, stepMs)) {
    const poses = evaluateResolvedSequence(resolved, atMs);
    for (const [objectId, pose] of poses) result.get(objectId)?.push({ atMs, pose });
  }
  return result;
};

export const previewGhostsAt = (
  resolved: ResolvedActionSequence,
  cursorMs: number,
): PreviewGhost[] => {
  const start = evaluateResolvedSequence(resolved, 0);
  const other = cursorMs <= 0
    ? { role: "end" as const, poses: evaluateResolvedSequence(resolved, resolved.totalMs) }
    : { role: "cursor" as const, poses: evaluateResolvedSequence(resolved, cursorMs) };
  const ghosts: PreviewGhost[] = [];
  for (const [objectId, pose] of start) ghosts.push({ objectId, role: "start", pose });
  for (const [objectId, pose] of other.poses) ghosts.push({ objectId, role: other.role, pose });
  return ghosts;
};

export const advancePreviewCursor = (args: {
  cursorMs: number;
  dtMs: number;
  faderPercent: number;
  multiplier: number;
  totalMs: number;
  loop: boolean;
}): { cursorMs: number; ended: boolean } => {
  const next = args.cursorMs + args.dtMs * (args.faderPercent / 100) * args.multiplier;
  if (args.totalMs <= 0) return { cursorMs: 0, ended: true };
  if (next < args.totalMs) return { cursorMs: next, ended: false };
  if (args.loop) return { cursorMs: next % args.totalMs, ended: false };
  return { cursorMs: args.totalMs, ended: true };
};
```

- [ ] **Step 4: Run to verify it passes**
- [ ] **Step 5: Commit**

```bash
git add src/app/pages/console/hooks/sequence-preview.ts src/app/pages/console/hooks/sequence-preview.spec.ts
git commit -m "Add pure helpers for control sequence preview sampling and playback."
```

---

### Task 2: SequencePreviewProvider

**Files:**
- Create: `src/app/pages/console/hooks/sequence-preview-provider.tsx`
- Create: `src/app/pages/console/hooks/sequence-preview-provider.spec.tsx`
- Modify: `src/app/pages/console/console-page.tsx` (mount inside `ConsoleNavProvider`, above `ViewportSlotProvider`)

**Interfaces:**
- Consumes: `useProject` (`currentProject.document.motion.actionSequences`, `currentProject.id`), `useConsoleNav`, `resolveActionSequence`, `getMotionItemRepairIssue` from `@/app/project/project-motion-readiness`, `toast` from `sonner`, `advancePreviewCursor`.
- Produces:

```ts
export type SequencePreviewMultiplier = 1 | 2 | 4;
export type SequencePreviewState = {
  sequenceId: number | null;
  cursorMs: number;
  isPlaying: boolean;
  holdMode: boolean;
  faderPercent: number;
  multiplier: SequencePreviewMultiplier;
  totalMs: number;
  resolved: ResolvedActionSequence | null;
};
export type StartPreviewOptions = { faderPercent?: number; autoplay?: boolean; holdMode?: boolean };
export type SequencePreviewValue = SequencePreviewState & {
  startPreview: (sequenceId: number, options?: StartPreviewOptions) => void;
  togglePreview: (sequenceId: number, options?: StartPreviewOptions) => void;
  stopPreview: () => void;
  setCursorMs: (ms: number) => void;
  play: () => void;
  pause: () => void;
  setMultiplier: (m: SequencePreviewMultiplier) => void;
};
export const SequencePreviewProvider: FC<{ children: ReactNode }>;
export const useSequencePreview: () => SequencePreviewValue;
```

Behavior:
- `startPreview`: look up the sequence; if missing or `getMotionItemRepairIssue(document, "sequence", id)` returns an issue → `toast.warning(issue?.message ?? "动作序列无法预览")`, do nothing. Else `resolveActionSequence` (catch → same toast) and set state `{ sequenceId, cursorMs: 0, isPlaying: !!autoplay, holdMode: !!holdMode, faderPercent: options.faderPercent ?? 100, multiplier: 1, totalMs, resolved }`.
- `togglePreview`: same id and not holdMode → `stopPreview()`, else `startPreview`.
- Ticker: `useEffect` on `isPlaying`; `requestAnimationFrame` loop using `performance.now()` deltas; `advancePreviewCursor({ ..., loop: holdMode })`; when `ended` set `isPlaying: false`.
- Auto-exit effects: `activeNav !== "control"` → stop; `currentProject?.id` change → stop; sequence id no longer in `actionSequences` → stop.

- [ ] **Step 1: Write failing tests** (jsdom; mock `../hooks/use-console-nav`, `@/app/project/use-project`, `sonner`; use `vi.useFakeTimers()` and stub `requestAnimationFrame` to `setTimeout(cb, 16)`).

Cases:
- toggle enters with `cursorMs 0`, `totalMs` from resolved, `faderPercent` passed; toggling same id exits.
- toggling a different id switches `sequenceId`.
- hold-mode autoplay advances `cursorMs` after timers; `stopPreview` resets to `sequenceId null`.
- `setMultiplier(4)` advances 4× faster than 1× for the same dt.
- invalid sequence (empty blocks) → `toast.warning` called, `sequenceId` stays null.
- nav mock switched to `"sequences"` on rerender → `sequenceId` null.

- [ ] **Step 2: Run to verify fails**
- [ ] **Step 3: Implement provider + mount in `console-page.tsx`**
- [ ] **Step 4: Run** `npx vitest run src/app/pages/console/hooks/sequence-preview-provider.spec.tsx`
- [ ] **Step 5: Commit** — `"Add a control-page sequence preview provider with rAF playback."`

---

### Task 3: Engine — path points, GoShadow color, SequencePreviewController

**Files:**
- Create: `src/app/viz3d/state/preview-path-points.ts` (+ `.spec.ts`)
- Modify: `src/app/viz3d/state/GoShadow.ts` — add `color?: number` as 5th ctor arg, default `colors.secondary`, used for both ghost material and connector line.
- Create: `src/app/viz3d/state/SequencePreviewController.ts`
- Modify: `src/app/viz3d/engine/Viz3DEngine.ts`

**Interfaces:**

```ts
// preview-path-points.ts
export const previewPathPoints = (config: SceneObjectConfig, poses: VirtualAxisValues[]): Vec3[] =>
  poses.map((pose) => resolveVirtualAxisTransform(config, pose).position);

// SequencePreviewController.ts
export type SequencePreviewPath = { objectId: string; poses: VirtualAxisValues[] };
export type SequencePreviewGhost = { objectId: string; role: string; pose: VirtualAxisValues };
export type SequencePreviewEntries = { paths: SequencePreviewPath[]; ghosts: SequencePreviewGhost[] };
export class SequencePreviewController {
  constructor(scene: Scene, getHandle: (id: string) => SceneObjectHandle | undefined, colors: Viz3DColorMap);
  set(entries: SequencePreviewEntries): void;
  clear(): void;
  dispose(): void;
}

// Viz3DEngine.ts
setSequencePreview(entries: SequencePreviewEntries): void;
clearSequencePreview(): void;
```

Controller details:
- Paths keyed by `objectId`; build `Vector3[]` via `previewPathPoints(handle.getConfig(), poses)`; `MeshBuilder.CreateLines(name, { points, updatable: true })`; color `hexToColor3(colors.primary)`; `isPickable = false`. On `set`, reuse via `{ points, instance }` when the point count matches, otherwise dispose and recreate. Remove paths whose id is absent.
- Ghosts keyed by `${objectId}:${role}`; `new GoShadow(handle, pose, scene, colors, colors.primary)`; skip recreate when pose equal (same `targetsEqual` idea as `GoShadowController`). Connector update on `scene.onBeforeRenderObservable` like `GoShadowController`.
- Engine: field `sequencePreviewController`, constructed next to `goShadowController` (same `scene`, `registry.get`, `colors`); disposed with it.

- [ ] **Step 1: Write failing test for `previewPathPoints`**

```ts
import { describe, expect, it } from "vitest";
import type { SceneObjectConfig } from "../types";
import { previewPathPoints } from "./preview-path-points";

const base = {
  position: { x: 1, y: 2, z: 3 },
  modelRunDirection: 1,
  virtualAxes: [{ axis: "v1", kind: "move" }],
} as unknown as SceneObjectConfig;

describe("previewPathPoints", () => {
  it("maps v1 lift (mm) to y (m) offsets", () => {
    const points = previewPathPoints(base, [{ v1: 0 }, { v1: 1000 }]);
    expect(points[0]!.y).toBeCloseTo(2);
    expect(points[1]!.y).toBeCloseTo(3);
  });
  it("inverts for run direction 2", () => {
    const points = previewPathPoints({ ...base, modelRunDirection: 2 } as SceneObjectConfig, [{ v1: 1000 }]);
    expect(points[0]!.y).toBeCloseTo(1);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/app/viz3d/state/preview-path-points.spec.ts` → FAIL
- [ ] **Step 3: Implement `preview-path-points.ts`, GoShadow `color` arg, controller, engine methods**
- [ ] **Step 4: Run** the spec and `npx vitest run src/app/viz3d/state/GoShadow.test.ts` (existing) → PASS. `ReadLints` on the four changed files.
- [ ] **Step 5: Commit** — `"Add an engine controller for sequence preview paths and cyan ghosts."`

---

### Task 4: Viz3DSequencePreviewSync + membership dim

**Files:**
- Create: `src/app/pages/console/3d/Viz3DSequencePreviewSync.tsx`
- Modify: `src/app/pages/console/3d/membership-dim.ts`, `membership-dim.test.ts`
- Modify: `src/app/pages/console/3d/Viz3DMembershipDimSync.tsx`
- Modify: `src/app/pages/console/console-page.tsx` (mount `<Viz3DSequencePreviewSync />` next to `Viz3DGoShadowSync`)

**Interfaces:**
- `MembershipDimInput` gains `controlPreviewSequence: ActionSequenceConfig | null`. `resolveMemberObjectIds`: if `activeNav === "control"` and `controlPreviewSequence` → `nonEmptyOrNull(sequenceObjectIds(controlPreviewSequence))`; existing sequences-page branch unchanged.
- Sync:

```tsx
export const Viz3DSequencePreviewSync = () => {
  const engine = useViz3DContext();
  const { activeNav } = useConsoleNav();
  const { sequenceId, cursorMs, resolved } = useSequencePreview();
  const paths = useMemo(() => (resolved ? sampleSequencePaths(resolved) : null), [resolved]);
  useEffect(() => {
    if (activeNav !== "control" || sequenceId === null || !resolved || !paths) {
      engine.clearSequencePreview();
      return;
    }
    engine.setSequencePreview({
      paths: [...paths].map(([objectId, samples]) => ({ objectId: String(objectId), poses: samples.map((s) => s.pose) })),
      ghosts: previewGhostsAt(resolved, cursorMs).map((g) => ({ objectId: String(g.objectId), role: g.role, pose: g.pose })),
    });
  }, [engine, activeNav, sequenceId, resolved, paths, cursorMs]);
  useEffect(() => () => engine.clearSequencePreview(), [engine]);
  return null;
};
```

- [ ] **Step 1: Extend `membership-dim.test.ts`** — control nav + `controlPreviewSequence` returns its members; control nav without preview returns null; add `controlPreviewSequence: null` to `base`.
- [ ] **Step 2: Run** `npx vitest run src/app/pages/console/3d/membership-dim.test.ts` → FAIL
- [ ] **Step 3: Implement** dim change, `Viz3DMembershipDimSync` reads `useSequencePreview().sequenceId` and looks up the sequence from `useProject().currentProject?.document.motion.actionSequences`; create sync; mount in `console-page.tsx`.
- [ ] **Step 4: Run** the dim test → PASS; `ReadLints` on changed files.
- [ ] **Step 5: Commit** — `"Push control sequence preview paths, ghosts, and dimming to the 3D engine."`

---

### Task 5: SequencePreviewBar in ViewportOverlay

**Files:**
- Create: `src/app/pages/console/3d/overlays/sequence-preview-bar.tsx` (+ `sequence-preview-bar.spec.tsx`)
- Modify: `src/app/pages/console/3d/overlays/ViewportOverlay.tsx`

**Interfaces:** `SequencePreviewBar` has no props; reads `useSequencePreview()`. Uses `formatExecTime` from `../../hooks/sequence-run-status`.

Markup (Tailwind, design tokens):
- Container: `pointer-events-auto absolute inset-x-3 bottom-3 flex h-8 items-center gap-2 rounded-md bg-card/90 px-2` with `onPointerDown={stopPointer}`; `role="toolbar" aria-label="序列预览"`.
- Play/pause button `h-7 w-7 rounded-sm text-primary hover:bg-accent`, `aria-label` `播放` / `暂停`, icons `Play` / `Pause`.
- `<input type="range" min={0} max={totalMs} step={100} aria-label="预览进度" className="min-w-0 flex-1 accent-primary">`.
- Time `font-mono text-mono-sm tabular-nums text-foreground`: `{formatExecTime(cursorMs)} / {formatExecTime(totalMs)}`.
- Speed chips `1× 2× 4×`: `h-6 rounded-sm px-1.5 text-label-caps`, active `bg-primary text-primary-foreground`, inactive `text-muted-foreground hover:bg-accent`, `aria-pressed`.
- Close `aria-label="退出预览"` (`X` icon).
- Keyboard: `useEffect` adding `keydown` on `window`; ignore when `event.target` is `input`/`textarea`/`[contenteditable]`; `Space` toggle, `Escape` stop, `ArrowLeft/Right` ±100, `Home` 0, `End` total.
- `ViewportOverlay`: `const preview = useSequencePreview();` render `{isControl && preview.sequenceId !== null && !preview.holdMode ? <SequencePreviewBar /> : null}` inside the root div (after the top bar).

- [ ] **Step 1: Write failing bar tests** (mock `../../hooks/sequence-preview-provider`): renders `00:05.2 / 00:12.3`; play button label flips with `isPlaying`; clicking close calls `stopPreview`; `Escape` keydown on window calls `stopPreview`; `4×` click calls `setMultiplier(4)`.
- [ ] **Step 2: Run** `npx vitest run src/app/pages/console/3d/overlays/sequence-preview-bar.spec.tsx` → FAIL
- [ ] **Step 3: Implement bar + mount**
- [ ] **Step 4: Run** → PASS; `ReadLints` on both files.
- [ ] **Step 5: Commit** — `"Add the in-viewport transport bar for control sequence preview."`

---

### Task 6: Entry points — FaderSlot click + long-press, program row click, GO exits

**Files:**
- Modify: `src/app/pages/console/components/exec-area/executors/fader-slot.tsx`
- Modify: `src/app/pages/console/components/exec-area/executors/executors.tsx`
- Modify: `src/app/pages/console/components/program-panel/program-panel.tsx`, `chapter-section.tsx`, `page-section.tsx`
- Modify: `src/app/pages/console/components/exec-area/exec-area.tsx`
- Modify: `src/app/pages/console/components/exec-area/exec-area.test.tsx`

**Interfaces:**
- `FaderSlotProps` adds `isPreviewing: boolean; onPreviewToggle: () => void; onPreviewHoldStart: () => void; onPreviewHoldEnd: () => void;`.
- Name becomes:

```tsx
<button
  type="button"
  aria-label={`预览 ${slot.sequence?.name}`}
  aria-pressed={isPreviewing}
  disabled={Boolean(repairMessage)}
  onClick={handleNameClick}
  onPointerDown={handleNamePointerDown}
  onPointerMove={handleNamePointerMove}
  onPointerUp={handleNamePointerUp}
  onPointerLeave={cancelHold}
  onPointerCancel={cancelHold}
  onContextMenu={(e) => e.preventDefault()}
  className={cn("line-clamp-1 text-left text-body-sm", isPreviewing ? "text-primary" : "text-foreground", "disabled:opacity-60")}
>
```

Long-press (`LONG_PRESS_MS = 400`, `LONG_PRESS_MOVE_PX = 8`), refs: `timerRef`, `startPointRef`, `holdActiveRef`.
- `pointerdown`: record point; `timerRef = setTimeout(() => { holdActiveRef = true; onPreviewHoldStart(); }, 400)`.
- `pointermove`: if distance > 8 → clear timer.
- `pointerup`: clear timer; if `holdActiveRef` → `holdActiveRef = false; onPreviewHoldEnd();` and set `suppressClickRef = true`.
- `click`: if `suppressClickRef` → reset and return; else `onPreviewToggle()`.
- `pointerleave`/`pointercancel` → clear timer; if hold active → end.

- `Executors`: `const { sequenceId: previewSequenceId, togglePreview, startPreview, stopPreview } = useSequencePreview();` and pass `isPreviewing={previewSequenceId === slot.sequence?.id}`, `onPreviewToggle={() => slot.sequence && togglePreview(slot.sequence.id, { faderPercent: slot.faderValue })}`, `onPreviewHoldStart={() => slot.sequence && startPreview(slot.sequence.id, { faderPercent: slot.faderValue, autoplay: true, holdMode: true })}`, `onPreviewHoldEnd={stopPreview}`.
- Program: `ChapterSection`/`PageSection` add `onClickItem?: (item: ChapterItem) => void` and `activeSequenceId?: number | null`; `PageSection` passes `isActive={item.sequence.id === activeSequenceId}` and `onClick={() => onClickItem?.(item)}` to `ChapterItemRow`. `ControlProgramPanel` wires `onClickItem={(item) => togglePreview(item.sequence.id)}` and `activeSequenceId={previewSequenceId}`.
- `ExecArea`: `const { stopPreview } = useSequencePreview();` call `stopPreview()` right after `launch({...})` in the GO branch.

Tests (`exec-area.test.tsx`, add a `vi.mock("../../hooks/sequence-preview-provider", ...)` with `togglePreviewMock`, `startPreviewMock`, `stopPreviewMock`, `previewSequenceIdRef`):
- `FaderSlot` name button: `aria-pressed="false"`; click → `onPreviewToggle`; with `repairMessage` → disabled.
- Long-press: `pointerDown` + `vi.advanceTimersByTime(400)` → `onPreviewHoldStart`; `pointerUp` → `onPreviewHoldEnd`; subsequent `click` does **not** call `onPreviewToggle`.
- Long-press cancelled by `pointerMove` 20px → no hold start; `click` → toggle.
- GO success path (`"GO uses the current fader value..."`) also expects `stopPreviewMock` called once.
- Control program row click → `togglePreviewMock` called with the item's sequence id.

- [ ] **Step 1: Write failing tests**
- [ ] **Step 2: Run** `npx vitest run src/app/pages/console/components/exec-area/exec-area.test.tsx src/app/pages/console/components/program-panel/program-panel.spec.tsx` → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** same → PASS; `ReadLints` on changed files.
- [ ] **Step 5: Commit** — `"Preview control sequences from fader names and program rows; GO exits preview."`

---

### Task 7: Final whole-branch review

- [ ] Re-run all targeted specs from Tasks 1–6 in one command.
- [ ] `ReadLints` on every file in the file-structure table that was touched.
- [ ] Verify against the spec's locked decisions: no PLC calls added, real objects untouched (`applyVirtualAxisPose` not called from preview), GO shadows still `secondary`, bar hidden in hold-mode, auto-exit on nav/GO/project change.
- [ ] Push and update the PR body with the tested paths.

## Acceptance

| Spec requirement | Task |
|---|---|
| Trajectory lines + start/end ghosts + total time | 1, 3, 4, 5 |
| Scrub and auto-play at fader speed × multiplier | 1, 2, 5 |
| Click F-slot name / program row toggles preview | 6 |
| Long-press ≥ 400ms autoplay while held, release clears | 2, 6 |
| Cyan ghosts vs secondary GO shadows | 3 |
| Non-members stay opaque on control during preview | — |
| GO / nav / project change exits preview | 2, 6 |
| Invalid sequence → toast, no preview | 2 |
