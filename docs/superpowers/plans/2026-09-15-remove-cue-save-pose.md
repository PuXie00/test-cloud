# Remove Cue; Save Current Pose as Sequence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete Cue from the product. Control-page 「保存当前位姿」 creates a new sequence named 新建动作序列 with pose blocks at `atMs = 0` and appends it to the current chapter.

**Architecture:** Add a pure `buildCapturedPoseSequence` helper. Remove `positionCues` from `ProjectMotion` and all Cue UI/handlers. Control capture is one document write: new sequence + chapter append, using the same pose snapshot as 添加位姿 (`v1` from live position, `v2`/`v3` `0`).

**Tech Stack:** React, TypeScript, Vitest, Testing Library. Run only the named vitest files; do not run the full suite, `tsc --noEmit`, or a production build. No GUI / screen testing.

**Spec:** `docs/superpowers/specs/2026-09-15-remove-cue-save-pose-design.md`

## Global Constraints

- No `positionCues`. No Cue UI or Cue logic on the action page.
- Keep 添加位姿 (insert at playhead on the selected sequence).
- Capture uses current object selection; disabled if none selected or no current chapter.
- Sequence name is always `新建动作序列` (no auto suffix).
- Pose blocks all use `atMs = 0`. Pose values match 添加位姿: `v1` from current position, `v2`/`v3` `0`.
- Append to current chapter `items` (dense list). One document update; no half-written sequence.
- No old-file Cue migration. Repo mocks/fixtures only.
- Do not change Ready/GO, 8-slot faders, 100ms grid, or PLC.
- `docs/` is gitignored — `git add -f` for plan/spec files.
- Targeted vitest only: `npx vitest run <paths>`.

## File structure

| File | Role |
|---|---|
| `src/app/project/capture-pose-sequence.ts` | Pure builder: selected ids → sequence or null |
| `src/app/project/capture-pose-sequence.spec.ts` | Builder tests |
| `src/app/project/project-document-types.ts` | Drop `PositionCueConfig` / `positionCues` |
| `src/app/project/project-document-empty.ts` | Empty motion without cues |
| `electron/main/project/empty-document.ts` | Same |
| `src/app/project/mock-documents/gz-2025.document.ts` | Drop Cue data |
| `src/app/project/mock-documents/sh-ballet.document.ts` | Drop Cue data |
| `src/app/project/project-document-validate.ts` | Drop Cue loops |
| `src/app/project/motion-persist.ts` | Drop Cue mapping |
| `src/app/project/motion-adapters.ts` | Drop Cue mapping |
| `src/app/project/project-motion-readiness.ts` | `kind: "sequence"` only |
| `src/app/project/project-object-deletion.ts` | Stop Cue target stripping |
| Action-builder ops/context/library/dock/panels | Remove Cue |
| `src/app/pages/console/hooks/use-program.tsx` | `addCapturedPoseSequence` |
| `src/app/pages/console/components/right-tab-panel/manual-control-tab/quick-actions.tsx` | Wire 保存当前位姿 |

---

### Task 1: Capture helper

**Files:**
- Create: `src/app/project/capture-pose-sequence.ts`
- Create: `src/app/project/capture-pose-sequence.spec.ts`

**Interfaces:**
- Consumes: `ActionSequenceConfig`, `ModelPose`, `TimelineBlock` from `src/app/project/action-sequence/types.ts`; `nextId` from `src/app/pages/console/components/action-builder/action-builder-ops.ts`
- Produces:
  - `export const CAPTURED_SEQUENCE_NAME = "新建动作序列"`
  - `export const buildCapturedPoseSequence = (args: { id: number; objectIds: readonly number[]; poseForObject: (objectId: number) => ModelPose | null }): ActionSequenceConfig | null`

- [ ] **Step 1: Write the failing test**

Create `capture-pose-sequence.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ModelPose } from "./action-sequence/types";
import {
  CAPTURED_SEQUENCE_NAME,
  buildCapturedPoseSequence,
} from "./capture-pose-sequence";

const pose = (v1: number): ModelPose => ({ v1, v2: 0, v3: 0 });

describe("buildCapturedPoseSequence", () => {
  it("returns null when no object yields a pose", () => {
    expect(
      buildCapturedPoseSequence({
        id: 9,
        objectIds: [1, 2],
        poseForObject: () => null,
      }),
    ).toBeNull();
    expect(
      buildCapturedPoseSequence({
        id: 9,
        objectIds: [],
        poseForObject: () => pose(1),
      }),
    ).toBeNull();
  });

  it("builds one t=0 pose block per object that has a pose", () => {
    const sequence = buildCapturedPoseSequence({
      id: 12,
      objectIds: [7, 8, 9],
      poseForObject: (id) => (id === 8 ? null : pose(id * 10)),
    });
    expect(sequence).not.toBeNull();
    expect(sequence!.id).toBe(12);
    expect(sequence!.name).toBe(CAPTURED_SEQUENCE_NAME);
    expect(CAPTURED_SEQUENCE_NAME).toBe("新建动作序列");
    expect(sequence!.trajectoryMode).toBe("non-forced");
    expect(sequence!.segments).toEqual([]);
    expect(sequence!.blocks).toHaveLength(2);
    expect(sequence!.blocks.every((block) => block.kind === "pose" && block.atMs === 0)).toBe(true);
    const poses = sequence!.blocks.filter((block) => block.kind === "pose");
    expect(poses.map((block) => [block.objectId, block.pose.v1])).toEqual([
      [7, 70],
      [9, 90],
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/project/capture-pose-sequence.spec.ts`

Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `capture-pose-sequence.ts`:

```ts
import { nextId } from "@/app/pages/console/components/action-builder/action-builder-ops";
import type { ActionSequenceConfig, ModelPose, TimelineBlock } from "./action-sequence/types";

export const CAPTURED_SEQUENCE_NAME = "新建动作序列";

export const buildCapturedPoseSequence = (args: {
  id: number;
  objectIds: readonly number[];
  poseForObject: (objectId: number) => ModelPose | null;
}): ActionSequenceConfig | null => {
  const blocks: TimelineBlock[] = [];
  for (const objectId of args.objectIds) {
    const pose = args.poseForObject(objectId);
    if (!pose) continue;
    blocks.push({
      id: nextId("blk"),
      kind: "pose",
      objectId,
      atMs: 0,
      pose,
    });
  }
  if (blocks.length === 0) return null;
  return {
    id: args.id,
    name: CAPTURED_SEQUENCE_NAME,
    trajectoryMode: "non-forced",
    blocks,
    segments: [],
  };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/project/capture-pose-sequence.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/project/capture-pose-sequence.ts src/app/project/capture-pose-sequence.spec.ts
git commit -m "Add a helper that builds a t=0 pose sequence from a snapshot."
```

---

### Task 2: Remove `positionCues` from the document

**Files:**
- Modify: `src/app/project/project-document-types.ts` (delete `PositionCueConfig`; `ProjectMotion` has only `actionSequences` and `programs`)
- Modify: `src/app/project/project-document-empty.ts` — `motion: { actionSequences: [], programs: [] }`
- Modify: `electron/main/project/empty-document.ts` — same
- Modify: `src/app/project/mock-documents/gz-2025.document.ts` — delete the `positionCues` property (and its array)
- Modify: `src/app/project/mock-documents/sh-ballet.document.ts` — same
- Modify: `src/app/project/project-document-validate.ts` — delete the `for (const cue of doc.motion.positionCues)` loop
- Modify: `src/app/project/project-document-validate.spec.ts` — remove Cue-target cases; every fixture `motion` omits `positionCues`
- Modify: `src/app/project/motion-persist.ts` — drop Cue helpers and `cues` on action-builder state
- Modify: `src/app/project/motion-persist.spec.ts` — fixtures without `positionCues`
- Modify: `src/app/project/motion-adapters.ts` — stop mapping cues
- Modify: `src/app/project/project-motion-readiness.ts` — sequence-only `kind`
- Modify: `src/app/project/project-object-deletion.ts` — drop Cue counts/stripping
- Modify: every remaining `positionCues:` in `src/` and `electron/` (grep). Replace `motion: { positionCues: [], actionSequences, programs }` with `motion: { actionSequences, programs }`. Delete tests whose only job is empty-cue / Cue targets.

**Interfaces:**
- Consumes: none from Task 1
- Produces: `ProjectMotion = { actionSequences: ActionSequenceConfig[]; programs: ProgramConfig[] }`
- `getMotionItemRepairIssue(document, "sequence", id)` — first arg document, kind is only `"sequence"`
- `resolveMotionLaunchBlock(document, "sequence", id)` — same
- `legacyProgramToMotion` / `actionBuilderStateToMotion` no longer read or write cues
- `MotionRepairIssue.code` no longer includes `"empty-cue"`

- [ ] **Step 1: Write the failing readiness test first**

In `src/app/project/project-document-validate.spec.ts` (or the existing readiness tests in `exec-area.test.tsx` / validate spec), add:

```ts
it("does not type motion with positionCues", () => {
  const document = createEmptyDocument({ id: "t", name: "t", author: "a" });
  expect(document.motion).not.toHaveProperty("positionCues");
});
```

(`createEmptyDocument` from `project-document-empty.ts`.)

Also change `getMotionItemRepairIssue` call sites that pass `"cue"` — after this task they must not compile in tests. Replace Cue cases in `exec-area.test.tsx` “repair issue” describes: delete the Cue-empty / cue-as-sequence assertions (keep sequence repair). Delete `expect(getMotionItemRepairIssue(document, "cue", ...))` blocks.

- [ ] **Step 2: Run a fixture test to verify it fails**

Run: `npx vitest run src/app/project/project-document-validate.spec.ts`

Expected: FAIL or error (`positionCues` still present, or Cue tests still look for Cue codes).

- [ ] **Step 3: Implement document + persist + readiness + deletion**

`ProjectMotion`:

```ts
export type ProjectMotion = {
  actionSequences: ActionSequenceConfig[];
  programs: ProgramConfig[];
};
```

Delete the `PositionCueConfig` type.

`legacyProgramToMotion`:

```ts
  return {
    actionSequences: structuredClone(existing.actionSequences),
    programs,
  };
```

`actionBuilderStateToMotion`:

```ts
export const actionBuilderStateToMotion = (
  state: { sequences: ActionSequenceConfig[]; programs: ProgramNode[] },
  existing: ProjectMotion,
): ProjectMotion => ({
  actionSequences: structuredClone(state.sequences),
  programs:
    state.programs.length > 0
      ? state.programs.filter((n) => n.type === "program" || !n.type).map(programNodeToConfig)
      : existing.programs,
});
```

Delete `cueItemToPositionCueConfig`.

`getMotionItemRepairIssue` / `resolveMotionLaunchBlock`: remove the `"cue"` union member, the cue branch, `EMPTY_CUE_MESSAGE`, `MISSING_CUE_MESSAGE`, and `empty-cue` from `MotionRepairIssue.code`.

`project-object-deletion.ts`: remove `cueCount`, `cueTargetCount`, `emptyCueIds`, `stripCueTargets`, and mapping `positionCues`. Impact summary and apply-delete only touch sequences/programs. Update `project-object-deletion.test.ts` to drop Cue cases (keep sequence empty-drop).

`motion-adapters.ts`: remove `cues` from the adapted bundle; `hydrate` / `toTimeline` (whatever currently maps `positionCues`) only returns sequences + programs.

Grep `positionCues` under `/workspace` and clear every hit (including `project-document-assert.ts`, `control-type-change.ts`, `project-provider.history.test.tsx`, `use-object-deletion.test.tsx`, `use-program.persist.test.tsx` — that last test should stop reading `positionCues` and only assert `actionSequences` grew).

- [ ] **Step 4: Run targeted tests**

Run: `npx vitest run src/app/project/project-document-validate.spec.ts src/app/project/motion-persist.spec.ts src/app/project/project-object-deletion.test.ts src/app/project/capture-pose-sequence.spec.ts src/app/pages/console/components/program-panel/resolve-program-motion.spec.ts`

Expected: PASS. Fix any remaining `positionCues` in those files if they still fail.

If `resolve-program-motion.spec.ts` still plants `positionCues` or `{ kind: "cue" }` items, delete those fields/items (Cue program refs are already invalid).

- [ ] **Step 5: Commit**

```bash
git add -A src/app/project electron/main/project
git add src/app/pages/console/hooks/use-program.persist.test.tsx \
  src/app/pages/console/hooks/project-configuration-history.integration.test.tsx \
  src/app/pages/console/hooks/use-object-deletion.test.tsx \
  src/app/pages/console/components/exec-area/exec-area.test.tsx \
  src/app/pages/console/components/program-panel/resolve-program-motion.spec.ts \
  src/app/pages/console/hooks/control-type-change.ts
git commit -m "Drop positionCues from the project document."
```

Only stage files that actually changed. Do not add unrelated dirty files.

---

### Task 3: Strip Cue from the action page

**Files:**
- Modify: `src/app/pages/console/components/action-builder/action-builder-ops.ts` — delete `createCueItem`, `cueDropPoseForObject`, `buildTransitionSequence`, and Cue-only helpers; keep `createEmptySequence`, `collectTargets` only if still used by 添加位姿 (today 添加位姿 uses `poseForObject`, not `collectTargets` — delete `collectTargets` too if it becomes unused)
- Delete: `src/app/pages/console/components/action-builder/editor-dock/cue-pose-editor.tsx`
- Delete: `src/app/pages/console/components/action-builder/editor-dock/cue-drop.spec.ts`
- Delete: `src/app/pages/console/components/action-builder/editor-dock/transition-composer.tsx`
- Delete: `src/app/pages/console/components/action-builder/editor-dock/transition-math.ts`
- Delete: `src/app/pages/console/components/action-builder/editor-dock/transition-math.spec.ts`
- Modify: `src/app/pages/console/components/action-builder/timeline/timeline-data.ts` — delete `CueItem`, `cueObjectIds`, `cueObjectSetsMatch`. Keep `ProgramNode` but drop `"cue"` from `type`
- Modify: `src/app/pages/console/components/action-builder/action-builder-context-types.ts` — `EditorDockMode = "sequence" | "empty"`; remove all Cue/transition fields and handlers
- Modify: `src/app/pages/console/components/action-builder/action-builder-context.tsx` — remove Cue state, hydration of cues, every `handleCue*`, combine/transition, `updateCues`. Persist via `actionBuilderStateToMotion({ sequences, programs })` only. `dockMode` is `"sequence"` when a sequence is selected, else `"empty"`
- Modify: `src/app/pages/console/components/action-builder/content-library/library-dnd.ts` and `.spec.ts` — payload is `{ kind: "sequence"; id: number }` only; delete `cueIdFromLibraryDrag`
- Modify: `src/app/pages/console/components/action-builder/content-library/content-library-panel.tsx` — sequences only; delete Cue filter, Cue rows, combine UI, 新建 Cue
- Modify: `src/app/pages/console/components/action-builder/right-panel/object-selection-panel.tsx` — delete Cue mode, 新建 Cue, 加入当前 Cue, `onCreateCue`, `onAddToCurrentCue`, `cueObjectIds`
- Modify: `src/app/pages/console/components/action-builder/right-panel/object-selection-mode.ts` — `ObjectSelectionMode = "sequence" | "empty"`; delete `idsNotInCue`
- Modify: `src/app/pages/console/components/action-builder/editor-dock/editor-dock.tsx` — only sequence editor / empty; no CuePoseEditor / TransitionComposer
- Modify: `src/app/pages/console/3d/membership-dim.ts` and test — drop `cues`, `selectedCueId`, `transitionDraft`; dim only for `dockMode === "sequence"`
- Modify: `src/app/pages/console/3d/Viz3DMembershipDimSync.tsx` — stop reading Cue fields
- Modify: `src/app/pages/console/components/action-builder/action-builder-persist.test.tsx` — delete `handleCreateCue` tests; keep 添加位姿 / create sequence
- Modify: `src/app/pages/console/hooks/project-configuration-history.integration.test.tsx` — replace `handleCreateCue` with sequence/pose setup
- Grep `handleCreateCue|selectedCueId|CueItem|createCueItem|dockMode === "cue"|新建 Cue` under `src/` until zero

**Interfaces:**
- Consumes: Task 2 `actionBuilderStateToMotion` without cues
- Produces: action builder with no Cue API; `handleCreatePose` unchanged; `handleCreateSequence` still creates an empty 新建动作序列

- [ ] **Step 1: Write failing panel tests**

Replace `object-selection-panel.spec.tsx` so it no longer renders Cue mode or 新建 Cue:

```tsx
// keep the 添加位姿 / 使能 tests
it("has 新建动作序列 and not 新建 Cue", () => {
  renderPanel([7], { mode: "empty" });
  expect(screen.queryByRole("button", { name: "新建 Cue" })).toBeNull();
  expect(screen.queryByRole("button", { name: "加入当前 Cue" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "新建动作序列" }));
  expect(onCreateSequence).toHaveBeenCalledWith([7]);
});
```

Delete the two Cue-mode tests (`adds 3D multi-selection to the current cue`, `disables add-to-cue`). Drop `onCreateCue` / `onAddToCurrentCue` from the panel props in the test.

Replace `library-dnd.spec.ts` Cue round-trip with:

```ts
  it("round-trips a sequence payload and ignores Cue-shaped json", () => {
    const transfer = fakeTransfer();
    writeLibraryDrag(transfer as unknown as DataTransfer, { kind: "sequence", id: 12 });
    expect(readLibraryDrag(transfer as unknown as DataTransfer)).toEqual({
      kind: "sequence",
      id: 12,
    });
    expect(
      sequenceProgramItemFromLibrary({ kind: "sequence", id: 12 }),
    ).toEqual({ kind: "sequence", refId: 12 });
  });
```

Delete `cueIdFromLibraryDrag` imports.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/pages/console/components/action-builder/right-panel/object-selection-panel.spec.tsx src/app/pages/console/components/action-builder/content-library/library-dnd.spec.ts`

Expected: FAIL (新建 Cue still exists; Cue drag helpers still exported).

- [ ] **Step 3: Implement the strip**

`object-selection-panel.tsx` 新建 section — only 新建动作序列:

```tsx
      <SectionHeader title="新建" />
      <div className="grid grid-cols-1 gap-2">
        <button
          type="button"
          onClick={() => onCreateSequence(selectedObjectIds)}
          className="rounded-md border border-border bg-transparent py-2 text-body-sm text-foreground hover:bg-accent"
        >
          新建动作序列
        </button>
      </div>
```

Remove the entire `mode === "cue"` block and Cue props.

`library-dnd.ts` `LibraryDragPayload`:

```ts
export type LibraryDragPayload = { kind: "sequence"; id: number };
```

`readLibraryDrag` only accepts `kind === "sequence"`. Delete `cueIdFromLibraryDrag`.

`content-library-panel.tsx`: `LibraryEntry` is sequence-only; drop filter tabs (or a single implicit sequence list). Plus button only `handleCreateSequence`. Delete combine banner.

`editor-dock.tsx`: delete Cue/transition branches and those imports.

`membership-dim.ts`:

```ts
export type MembershipDimInput = {
  activeNav: LeftNavId;
  dockMode: EditorDockMode;
  sequence: ActionSequenceConfig | null;
  allObjectIds: number[];
  pickedObjectIds: number[];
};

export const resolveMemberObjectIds = (input: MembershipDimInput): Set<number> | null => {
  if (input.activeNav !== "sequences") return null;
  if (input.dockMode !== "sequence" || !input.sequence) return null;
  return nonEmptyOrNull(sequenceObjectIds(input.sequence));
};
```

Rewrite `membership-dim.test.ts` without Cue fixtures (empty dock → no dim; sequence dock dims non-members).

`action-builder-context.tsx`: grep-delete Cue. Hydrate sequences/programs only. `handleCreatePose` stays.

Timeline Cue drop: in `timeline-editor.tsx` / `sequence-track` / editor-dock drop handlers, delete `cueIdFromLibraryDrag` branches so dropping a library item that is not a sequence is a no-op.

- [ ] **Step 4: Run action-page tests**

Run: `npx vitest run src/app/pages/console/components/action-builder/right-panel/object-selection-panel.spec.tsx src/app/pages/console/components/action-builder/content-library/library-dnd.spec.ts src/app/pages/console/components/action-builder/action-builder-persist.test.tsx src/app/pages/console/3d/membership-dim.test.ts src/app/pages/console/components/action-builder/editor-dock/editor-dock.spec.tsx`

Expected: PASS. If `editor-dock.spec.tsx` asserts 添加位姿 is null in Cue mode, change it to sequence-only cases. Delete `cue-drop.spec.ts` (file removed).

- [ ] **Step 5: Commit**

```bash
git add src/app/pages/console/components/action-builder src/app/pages/console/3d
git commit -m "Remove Cue authoring from the action page."
```

---

### Task 4: Control-page 保存当前位姿

**Files:**
- Modify: `src/app/pages/console/hooks/program-context.ts` — add `addCapturedPoseSequence`
- Modify: `src/app/pages/console/hooks/use-program.tsx` — implement it
- Modify: `src/app/pages/console/hooks/use-program.persist.test.tsx` — capture test
- Modify: `src/app/pages/console/components/right-tab-panel/manual-control-tab/quick-actions.tsx` — wire button
- Modify: `src/app/pages/console/components/right-tab-panel/manual-control-tab/manual-control-tab.tsx` — pass selection + handler
- Create: `src/app/pages/console/components/right-tab-panel/manual-control-tab/quick-actions.spec.tsx`

**Interfaces:**
- Consumes: `buildCapturedPoseSequence`, `CAPTURED_SEQUENCE_NAME` from Task 1; `allocateSequenceIdsInProject`; `legacyProgramToMotion` from Task 2
- Produces:
  - `addCapturedPoseSequence: (args: { objectIds: readonly number[]; poseForObject: (objectId: number) => ModelPose | null }) => void`
  - No-ops when hydrating, no document, no current chapter, or builder returns null

- [ ] **Step 1: Write failing persist + button tests**

Append to `use-program.persist.test.tsx`:

```tsx
  it("addCapturedPoseSequence appends a t=0 pose sequence to the current chapter", async () => {
    const { result } = renderHook(
      () => ({ program: useProgram(), project: useProject() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.project.loading).toBe(false));
    await act(async () => {
      await result.current.project.openProject(GZ_2025_RECORD.folderName);
    });
    await waitFor(() => {
      expect(result.current.project.currentProject?.document).toBeTruthy();
    });
    if (!result.current.program.program.chapters[0]?.id) {
      act(() => result.current.program.addChapter());
    }
    const seqBefore =
      result.current.project.currentProject!.document!.motion.actionSequences.length;
    const itemsBefore = result.current.program.program.chapters[0]!.items.length;
    act(() => {
      result.current.program.addCapturedPoseSequence({
        objectIds: [result.current.project.currentProject!.document!.setup.controlledObjects[0]!.id],
        poseForObject: () => ({ v1: 42, v2: 0, v3: 0 }),
      });
    });
    const sequences = result.current.project.currentProject!.document!.motion.actionSequences;
    expect(sequences).toHaveLength(seqBefore + 1);
    const created = sequences[sequences.length - 1]!;
    expect(created.name).toBe("新建动作序列");
    expect(created.blocks).toEqual([
      expect.objectContaining({ kind: "pose", atMs: 0, pose: { v1: 42, v2: 0, v3: 0 } }),
    ]);
    expect(result.current.program.program.chapters[0]!.items).toHaveLength(itemsBefore + 1);
  });

  it("addCapturedPoseSequence writes nothing when every pose is missing", async () => {
    const { result } = renderHook(
      () => ({ program: useProgram(), project: useProject() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.project.loading).toBe(false));
    await act(async () => {
      await result.current.project.openProject(GZ_2025_RECORD.folderName);
    });
    await waitFor(() => {
      expect(result.current.project.currentProject?.document).toBeTruthy();
    });
    if (!result.current.program.program.chapters[0]?.id) {
      act(() => result.current.program.addChapter());
    }
    const seqBefore =
      result.current.project.currentProject!.document!.motion.actionSequences.length;
    act(() => {
      result.current.program.addCapturedPoseSequence({
        objectIds: [1],
        poseForObject: () => null,
      });
    });
    expect(result.current.project.currentProject!.document!.motion.actionSequences).toHaveLength(
      seqBefore,
    );
  });
```

If GZ-2025 has no controlled objects, use `objectIds: [1]` with a synthetic `poseForObject` (the first test already stubs poses; object id on the block does not need to exist in setup for this persist test). Prefer `objectIds: [1]` always to avoid depending on mock objects:

```ts
        objectIds: [1],
        poseForObject: () => ({ v1: 42, v2: 0, v3: 0 }),
```

Create `quick-actions.spec.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuickActions } from "./quick-actions";

afterEach(() => cleanup());

describe("QuickActions", () => {
  it("disables save when there is no selection or no chapter", () => {
    const onSave = vi.fn();
    const { rerender } = render(
      <QuickActions canSave={false} onSave={onSave} />,
    );
    const button = screen.getByRole("button", { name: "保存当前位姿" });
    expect(button).toHaveProperty("disabled", true);
    fireEvent.click(button);
    expect(onSave).not.toHaveBeenCalled();
    rerender(<QuickActions canSave onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "保存当前位姿" }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
```

If `toHaveProperty("disabled")` is awkward, use `(button as HTMLButtonElement).disabled`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/pages/console/hooks/use-program.persist.test.tsx src/app/pages/console/components/right-tab-panel/manual-control-tab/quick-actions.spec.tsx`

Expected: FAIL (`addCapturedPoseSequence` missing; button still 保存为 Cue).

- [ ] **Step 3: Implement**

`program-context.ts` add:

```ts
  addCapturedPoseSequence: (args: {
    objectIds: readonly number[];
    poseForObject: (objectId: number) => ModelPose | null;
  }) => void;
```

Import `ModelPose` from `@/app/project/action-sequence/types`.

In `use-program.tsx`, next to `addSequence`:

```ts
  const addCapturedPoseSequence = useCallback(
    (args: {
      objectIds: readonly number[];
      poseForObject: (objectId: number) => ModelPose | null;
    }) => {
      if (hydratingRef.current) return;
      if (!currentProject?.document) return;
      const chapterId = currentChapterIdRef.current;
      if (!chapterId) return;
      const current = programRef.current;
      if (!current.chapters.some((chapter) => chapter.id === chapterId)) return;
      let id: number;
      try {
        [id] = allocateSequenceIdsInProject(currentProject.document.motion.actionSequences, 1);
      } catch (error) {
        setLastPersistError(error instanceof Error ? error.message : "动作序列 id 已满（1~65535）");
        return;
      }
      const createdSequence = buildCapturedPoseSequence({
        id,
        objectIds: args.objectIds,
        poseForObject: args.poseForObject,
      });
      if (!createdSequence) return;
      let found = false;
      const nextProgram: Program = {
        ...current,
        chapters: current.chapters.map((chapter) => {
          if (chapter.id !== chapterId) return chapter;
          found = true;
          return {
            ...chapter,
            items: [
              ...chapter.items,
              {
                kind: "sequence",
                sequence: {
                  id: createdSequence.id,
                  name: createdSequence.name,
                  durationMs: 0,
                },
              },
            ],
          };
        }),
      };
      if (!found) return;
      const result = updateCurrentDocument(
        (doc) => {
          const motion = legacyProgramToMotion(nextProgram, doc.motion);
          return {
            ...doc,
            motion: {
              ...motion,
              actionSequences: [...motion.actionSequences, createdSequence],
            },
          };
        },
        "program",
      );
      if (!result.ok) {
        setLastPersistError(result.reason);
        return;
      }
      setLastPersistError(null);
      programRef.current = nextProgram;
      setProgram(nextProgram);
    },
    [currentProject?.document, updateCurrentDocument],
  );
```

Put `addCapturedPoseSequence` on the context value next to `addSequence`.

Replace `quick-actions.tsx`:

```tsx
import { Save } from "lucide-react";

type QuickActionsProps = {
  canSave: boolean;
  onSave: () => void;
};

export const QuickActions = ({ canSave, onSave }: QuickActionsProps) => (
  <div className="space-y-2 px-3 py-3">
    <div className="overflow-hidden rounded-md">
      <div className="flex h-9 items-center bg-muted px-3">快捷操作</div>
      <div className="bg-background p-3">
        <div className="flex gap-1">
          <button
            type="button"
            disabled={!canSave}
            onClick={onSave}
            className="inline-flex h-10 flex-1 items-center justify-center gap-1 rounded-sm bg-foreground text-background hover:bg-foreground/80 disabled:pointer-events-none disabled:opacity-40"
          >
            <Save className="h-4 w-4" /> 保存当前位姿
          </button>
        </div>
      </div>
    </div>
  </div>
);
```

In `manual-control-tab.tsx`, after the existing `selectedIds` / snapshots (the tab already returns early when `snapshots.length === 0`):

```tsx
  const { addCapturedPoseSequence, currentChapterId, isProgramEmpty } = useProgram();
  const { getById } = useControlledObjects();
  const canSave = !isProgramEmpty && Boolean(currentChapterId) && selectedIds.length > 0;

  const handleSaveCurrentPose = () => {
    addCapturedPoseSequence({
      objectIds: selectedIds,
      poseForObject: (objectId) => {
        const snapshot = getById(objectId);
        if (!snapshot) return null;
        return { v1: snapshot.values.v1 ?? 0, v2: 0, v3: 0 };
      },
    });
  };
```

`getById` is already destructured in this file — reuse it. Pass:

```tsx
      <QuickActions canSave={canSave} onSave={handleSaveCurrentPose} />
```

Import `useProgram`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/app/project/capture-pose-sequence.spec.ts src/app/pages/console/hooks/use-program.persist.test.tsx src/app/pages/console/components/right-tab-panel/manual-control-tab/quick-actions.spec.tsx src/app/pages/console/components/action-builder/right-panel/object-selection-panel.spec.tsx src/app/pages/console/components/exec-area/exec-area.test.tsx`

Expected: PASS.

If `exec-area.test.tsx` still mocks `handleCreateCue` / `dockMode: "cue"`, delete those mock fields so the suite loads.

- [ ] **Step 5: Commit**

```bash
git add src/app/pages/console/hooks/program-context.ts \
  src/app/pages/console/hooks/use-program.tsx \
  src/app/pages/console/hooks/use-program.persist.test.tsx \
  src/app/pages/console/components/right-tab-panel/manual-control-tab/quick-actions.tsx \
  src/app/pages/console/components/right-tab-panel/manual-control-tab/quick-actions.spec.tsx \
  src/app/pages/console/components/right-tab-panel/manual-control-tab/manual-control-tab.tsx \
  src/app/pages/console/components/exec-area/exec-area.test.tsx
git commit -m "Save the current pose as a new sequence on the control page."
```

---

## Self-review (spec coverage)

| Spec item | Task |
|---|---|
| `build` t=0 pose sequence helper | 1 |
| Remove `positionCues`; mocks; validate; persist; deletion; readiness | 2 |
| Action page Cue UI/logic gone; 添加位姿 kept | 3 |
| 保存当前位姿; disabled no selection/chapter; append chapter; name 新建动作序列 | 4 |
| No PLC / Ready/GO / 8-slot changes | none |
