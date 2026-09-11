# Program and Control Sequence-Only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Control execution and program chapters only use action sequences (16 fader slots per page); Cue stays an action-page authoring primitive.

**Architecture:** Narrow `ProgramItemRef` to `{ kind: "sequence"; refId: number }`. Hydrate drops leftover Cue chapter items. Control executors lose the Cue button row and show two rows × eight sequence faders. Action-page 节目管理 rejects Cue inserts. `positionCues`, Cue editor, and Cue→timeline composition stay.

**Tech Stack:** TypeScript, React, Vitest (`npx vitest run <file>` only).

## Global Constraints

- Cue authoring stays: `positionCues`, Cue editor, content-library Cue rows, Cue→timeline, 3D Cue preview.
- Do not change sequence GO, fader 0–200% speed, or `startLocalAuthoredSequence`.
- No Cue→sequence migration. Drop `kind: "cue"` program items on read. No toast.
- Executor: delete Cue row; two rows × 8 `FaderSlot`s; per-slot height stays `h-[140px]`; labels `F1`–`F16`.
- `PROGRAM_SLOTS_PER_PAGE = 16`.
- Cue dropped on a program chapter: no insert, no toast.
- Targeted vitest only. No bare `vitest run`, no `tsc --noEmit`, no production build.
- `docs/` is gitignored; force-add plan/spec files with `git add -f` when committing docs. Do not commit unrelated dirty files (`curve-segments`, `sequence-execution`, etc.).

## File map

- Modify: `src/app/project/project-document-types.ts` (`ProgramItemRef`, `isSequenceProgramItemRef`)
- Modify: `src/app/project/project-document-validate.ts`
- Modify: `src/app/project/project-document-validate.spec.ts`
- Modify: `src/app/pages/console/components/program-panel/resolve-program-motion.ts`
- Modify: `src/app/pages/console/components/program-panel/resolve-program-motion.test.ts`
- Modify: `src/app/project/motion-adapters.ts`
- Modify: `src/app/project/motion-persist.ts`
- Modify: `src/app/project/mock-documents/gz-2025.document.ts`
- Modify: `src/app/project/mock-documents/sh-ballet.document.ts`
- Modify: `src/app/project/project-motion-readiness.ts` (`getProgramRepairIssues` sequence-only copy)
- Modify: `src/app/project/project-object-deletion.test.ts`
- Modify: `src/app/pages/console/components/program-panel/program-data.ts`
- Modify: `src/app/pages/console/components/program-panel/program-utils.ts`
- Create: `src/app/pages/console/components/program-panel/program-utils.spec.ts`
- Modify: `src/app/pages/console/hooks/program-context.ts`
- Modify: `src/app/pages/console/hooks/use-program.tsx`
- Modify: `src/app/pages/console/hooks/use-program.persist.test.tsx`
- Modify: `src/app/pages/console/hooks/use-executor-slots.tsx`
- Modify: `src/app/pages/console/hooks/use-exec-cards.tsx`
- Modify: `src/app/pages/console/hooks/project-configuration-history.integration.test.tsx`
- Modify: `src/app/pages/console/components/exec-area/executors/executors.tsx`
- Modify: `src/app/pages/console/components/exec-area/executors/fader-slot.tsx`
- Modify: `src/app/pages/console/components/exec-area/executors/executor-section-guide.tsx`
- Delete: `src/app/pages/console/components/exec-area/executors/button-slot.tsx`
- Modify: `src/app/pages/console/components/exec-area/exec-area.tsx`
- Modify: `src/app/pages/console/components/exec-area/exec-area.test.tsx`
- Modify: `src/app/pages/console/components/exec-area/exec-cards/exec-card.tsx`
- Modify: `src/app/pages/console/components/exec-area/exec-cards/exec-empty-state.tsx`
- Modify: `src/app/pages/console/components/program-panel/program-panel.tsx`
- Modify: `src/app/pages/console/components/program-panel/chapter-section.tsx`
- Modify: `src/app/pages/console/components/program-panel/page-section.tsx`
- Modify: `src/app/pages/console/components/program-panel/chapter-item-row.tsx`
- Modify: `src/app/pages/console/components/program-panel/program-empty-guide.tsx`
- Modify: `src/app/pages/console/components/action-builder/action-builder-context-types.ts`
- Modify: `src/app/pages/console/components/action-builder/action-builder-context.tsx`
- Modify: `src/app/pages/console/components/action-builder/right-panel/program-panel.tsx`
- Modify: `src/app/pages/console/components/action-builder/content-library/library-dnd.ts`
- Modify: `src/app/pages/console/components/action-builder/content-library/library-dnd.spec.ts`
- Modify: `src/app/pages/console/components/action-builder/content-library/content-library-panel.tsx`
- Modify: `src/app/pages/console/components/action-builder/action-builder-persist.test.tsx`

Do not edit Cue editor, Cue library select/preview (except chapter-insert menu), `positionCues` persist, timeline Cue composition, or 3D Cue preview.

---

### Task 1: Sequence-only `ProgramItemRef`, hydrate drop, validate

**Files:**
- Modify: `src/app/project/project-document-types.ts`
- Modify: `src/app/project/project-document-validate.ts`
- Modify: `src/app/project/project-document-validate.spec.ts`
- Modify: `src/app/pages/console/components/program-panel/resolve-program-motion.ts`
- Modify: `src/app/pages/console/components/program-panel/resolve-program-motion.test.ts`
- Modify: `src/app/project/motion-adapters.ts`
- Modify: `src/app/project/motion-persist.ts`
- Modify: `src/app/project/mock-documents/gz-2025.document.ts`
- Modify: `src/app/project/mock-documents/sh-ballet.document.ts`
- Modify: `src/app/project/project-motion-readiness.ts`
- Modify: `src/app/project/project-object-deletion.test.ts`
- Modify: `src/app/pages/console/hooks/project-configuration-history.integration.test.tsx`
- Modify: `src/app/pages/console/components/action-builder/action-builder-persist.test.tsx` (fixture fallout only)

**Interfaces:**
- Consumes: `ProjectMotion.programs[].chapters[].items` (on-disk may still contain `{ kind: "cue" }`)
- Produces: `ProgramItemRef = { kind: "sequence"; refId: number }`; `isSequenceProgramItemRef(item: unknown): item is ProgramItemRef`

- [ ] **Step 1: Write the failing guard + hydrate + validate tests**

Replace the cue-resolution cases in `resolve-program-motion.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import type { ProgramItemRef, ProjectMotion } from "@/app/project/project-document-types";
import { GZ_2025_DOCUMENT } from "@/app/project/mock-documents/gz-2025.document";
import {
  motionProgramToLegacyProgram,
  resolveProgramChapterItems,
} from "./resolve-program-motion";

const mixedItems = [
  { kind: "cue", refId: "cue-open" },
  { kind: "sequence", refId: 1 },
] as unknown as ProgramItemRef[];

describe("resolveProgramChapterItems", () => {
  it("drops cue refs and keeps sequence refs", () => {
    const motion: ProjectMotion = {
      ...GZ_2025_DOCUMENT.motion,
      actionSequences: [
        {
          id: 1,
          name: "Seq 1",
          trajectoryMode: "non-forced",
          blocks: [],
          segments: [],
        },
      ],
    };
    const resolved = resolveProgramChapterItems(motion, mixedItems);
    expect(resolved).toEqual([
      expect.objectContaining({ kind: "sequence", sequence: expect.objectContaining({ id: 1 }) }),
    ]);
  });
});

describe("motionProgramToLegacyProgram", () => {
  it("builds embedded program without cue chapter items", () => {
    const program = motionProgramToLegacyProgram({
      ...GZ_2025_DOCUMENT.motion,
      programs: [
        {
          id: "p1",
          name: GZ_2025_DOCUMENT.motion.programs[0]!.name,
          chapters: [{ id: "ch", name: "Ch", items: mixedItems }],
        },
      ],
      actionSequences: [
        {
          id: 1,
          name: "Seq 1",
          trajectoryMode: "non-forced",
          blocks: [],
          segments: [],
        },
      ],
    });
    expect(program?.chapters[0]?.items.every((item) => item.kind === "sequence")).toBe(true);
    expect(program?.chapters[0]?.items).toHaveLength(1);
  });
});
```

In `project-document-validate.spec.ts`, replace `"reports dangling program cue and sequence refs"` with:

```ts
it("rejects non-sequence program items and dangling sequence refs", () => {
  const document = documentOf({
    motion: {
      positionCues: [],
      actionSequences: [emptySequence(1)],
      programs: [
        {
          id: "p-bad",
          name: "Bad",
          chapters: [
            {
              id: "ch",
              name: "Ch",
              items: [
                { kind: "cue", refId: "missing-cue-ref" },
                { kind: "sequence", refId: 17 },
              ] as unknown as ProgramItemRef[],
            },
          ],
        },
      ],
    },
  });
  const result = validateProjectDocument(document);
  expect(result.ok).toBe(false);
  expect(result.errors.some((error) => error.includes("must be sequence"))).toBe(true);
  expect(result.errors.some((error) => error.includes("17"))).toBe(true);
  expect(result.errors.some((error) => error.includes("missing-cue-ref"))).toBe(false);
});
```

Import `ProgramItemRef` in that spec if it is not already imported.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/pages/console/components/program-panel/resolve-program-motion.test.ts src/app/project/project-document-validate.spec.ts`

Expected: FAIL (cue items still resolve; validate still reports `missing-cue-ref`).

- [ ] **Step 3: Implement types, guard, validate, hydrate, persist skip, mocks**

In `project-document-types.ts` replace `ProgramItemRef` with:

```ts
export type ProgramItemRef = {
  kind: "sequence";
  refId: number;
};

export const isSequenceProgramItemRef = (item: unknown): item is ProgramItemRef => {
  if (typeof item !== "object" || item === null) return false;
  const rec = item as { kind?: unknown; refId?: unknown };
  return rec.kind === "sequence" && typeof rec.refId === "number" && Number.isInteger(rec.refId);
};
```

In `project-document-validate.ts` program loop:

```ts
for (const item of chapter.items) {
  if (!isSequenceProgramItemRef(item)) {
    errors.push(`program ${program.id}: item kind must be sequence`);
    continue;
  }
  if (!seqIds.has(item.refId)) {
    errors.push(`program ${program.id}: missing sequence ref ${item.refId}`);
  }
}
```

Import `isSequenceProgramItemRef`. Keep `positionCues` object/axis checks unchanged.

In `resolve-program-motion.ts`:
- `ResolvedChapterItem` = `{ kind: "sequence"; sequence: ActionSequenceConfig }` only.
- `resolveProgramChapterItems`: `flatMap` with `if (!isSequenceProgramItemRef(item)) return [];` then look up sequence.
- `resolvedToChapterItems`: sequence branch only (delete cue mapping).

In `motion-adapters.ts` `motionToProgramNodes` chapter children:

```ts
children: chapter.items.flatMap((item) => {
  if (!isSequenceProgramItemRef(item)) return [];
  const sequence = seqById.get(item.refId);
  return [
    {
      id: String(item.refId),
      name: sequence?.name ?? String(item.refId),
      type: "sequence" as const,
    },
  ];
}),
```

In `motion-persist.ts`:
- `programNodeToChapter`: if `child.type === "cue"` return `[]` (do not write Cue refs). Sequence branch unchanged.
- `programToConfig`: skip `item.kind === "cue"`; only emit sequence refs. Until Task 2, `ChapterItem` may still have a cue variant — drop those rows.
- `legacyProgramToMotion`: delete the loop that upserts `positionCues` from program Cue items. Return `existing.positionCues` unchanged (plus existing sequence/program write). Cue authoring still writes `positionCues` via `actionBuilderStateToMotion`.

Mock documents: set every program chapter `items: []`. Keep `positionCues` arrays as they are.

`getProgramRepairIssues`: only sequence copy. After the guard, `item.kind` is sequence:

```ts
message: missing
  ? `节目引用不可用动作序列「${item.refId}」，待修复`
  : `节目引用空动作序列「${item.refId}」，待修复`,
```

Keep `getMotionItemRepairIssue(document, "cue", id)` for action-page Cue repair.

In `project-object-deletion.test.ts` cascade fixture, program items = sequences only (`refId: 12` and `13`). Replace `"reports dangling program cue and sequence refs"` the same way as validate spec (non-sequence + dangling 17).

In `project-configuration-history.integration.test.tsx` seed helper, append only `{ kind: "sequence", refId: sequenceId }`. Assertions: sequence ref present; do not assert Cue program items.

In `action-builder-persist.test.tsx`:
- `"rehydrates Program when ActionBuilder writes motion"`: assert `builder.cues` renamed Cue; do not look up `chapter.items` Cue rows.
- `"rehydrates Program chapter refs after same-length"`: assert chapter name + `builder.cues` name; delete `openItem` Cue-in-program assertion.
- Leave `addCue` tests for Task 2.

- [ ] **Step 4: Re-run Task 1 tests**

Run: `npx vitest run src/app/pages/console/components/program-panel/resolve-program-motion.test.ts src/app/project/project-document-validate.spec.ts src/app/project/project-object-deletion.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/project/project-document-types.ts src/app/project/project-document-validate.ts src/app/project/project-document-validate.spec.ts src/app/pages/console/components/program-panel/resolve-program-motion.ts src/app/pages/console/components/program-panel/resolve-program-motion.test.ts src/app/project/motion-adapters.ts src/app/project/motion-persist.ts src/app/project/mock-documents/gz-2025.document.ts src/app/project/mock-documents/sh-ballet.document.ts src/app/project/project-motion-readiness.ts src/app/project/project-object-deletion.test.ts src/app/pages/console/hooks/project-configuration-history.integration.test.tsx src/app/pages/console/components/action-builder/action-builder-persist.test.tsx
git commit -m "Drop Cue refs from program documents; hydrate and validate sequences only."
```

---

### Task 2: Control program model — 16 slots, no `addCue`

**Files:**
- Modify: `src/app/pages/console/components/program-panel/program-data.ts`
- Modify: `src/app/pages/console/components/program-panel/program-utils.ts`
- Create: `src/app/pages/console/components/program-panel/program-utils.spec.ts`
- Modify: `src/app/pages/console/hooks/program-context.ts`
- Modify: `src/app/pages/console/hooks/use-program.tsx`
- Modify: `src/app/pages/console/hooks/use-program.persist.test.tsx`
- Modify: `src/app/pages/console/components/action-builder/action-builder-persist.test.tsx`
- Modify: `src/app/pages/console/hooks/use-executor-slots.tsx` (slot count only; button row in Task 3)

**Interfaces:**
- Consumes: `ProgramItemRef`, sequence-only hydrate from Task 1
- Produces: `PROGRAM_SLOTS_PER_PAGE = 16`; `ChapterItem = { kind: "sequence"; sequence: ActionSequence }`; `PageItems = { sequences: ChapterItem[] }`; `sliceProgramPage` / `programPageCount`; no `addCue`

- [ ] **Step 1: Write failing pagination tests**

Create `src/app/pages/console/components/program-panel/program-utils.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PROGRAM_SLOTS_PER_PAGE, type ChapterItem } from "./program-data";
import { programPageCount, sliceProgramPage } from "./program-utils";

const seq = (id: number): ChapterItem => ({
  kind: "sequence",
  sequence: { id, name: `S${id}`, durationMs: 1000 },
});

describe("program page slicing", () => {
  it("uses 16 slots per page", () => {
    expect(PROGRAM_SLOTS_PER_PAGE).toBe(16);
  });

  it("slices sequences into pages of 16", () => {
    const items = Array.from({ length: 17 }, (_, i) => seq(i + 1));
    expect(programPageCount(items)).toBe(2);
    expect(sliceProgramPage(items, 0)).toHaveLength(16);
    expect(sliceProgramPage(items, 1).map((item) => item.sequence.id)).toEqual([17]);
  });
});
```

Replace `use-program.persist.test.tsx` `"addCue appends to document.motion.positionCues"` with this full test (keep the existing `wrapper` / `beforeEach` / `afterEach`):

```ts
it("addSequence appends an action sequence and a program ref, not a position cue", async () => {
  const { result } = renderHook(
    () => ({ program: useProgram(), project: useProject() }),
    { wrapper },
  );

  await waitFor(() => expect(result.current.project.loading).toBe(false));

  await act(async () => {
    await result.current.project.openProject(GZ_2025_RECORD.folderName);
  });

  if (!result.current.program.program.chapters[0]?.id) {
    act(() => {
      result.current.program.addChapter();
    });
  }
  const chapterId = result.current.program.program.chapters[0]!.id;
  const cuesBefore =
    result.current.project.currentProject?.document?.motion.positionCues.length ?? 0;
  const seqBefore =
    result.current.project.currentProject?.document?.motion.actionSequences.length ?? 0;
  act(() => {
    result.current.program.addSequence(chapterId);
  });
  expect(result.current.project.currentProject?.document?.motion.positionCues.length).toBe(
    cuesBefore,
  );
  expect(result.current.project.currentProject?.document?.motion.actionSequences.length).toBe(
    seqBefore + 1,
  );
  expect(result.current.program.pageItems.sequences).toHaveLength(1);
  expect(result.current.program).not.toHaveProperty("addCue");
});
```

In `action-builder-persist.test.tsx` delete `"Program addCue appends to document.motion.positionCues"`. Change `"rehydrates ActionBuilder when Program writes motion"` to call `addSequence` and assert `actionSequences.length` increased (not `cues.length`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/pages/console/components/program-panel/program-utils.spec.ts src/app/pages/console/hooks/use-program.persist.test.tsx`

Expected: FAIL (`sliceProgramPage` missing; `addCue` still present).

- [ ] **Step 3: Implement model**

`program-data.ts` — keep `PositionCue` until Task 3 (button slots still import it). Add `PROGRAM_SLOTS_PER_PAGE` and make `ChapterItem` sequence-only:

```ts
export const PROGRAM_SLOTS_PER_PAGE = 16;

export type PositionCue = {
  id: string;
  name: string;
  note?: string;
  durationMs: number;
  targets: Record<string, number>;
};

export type ActionSequence = {
  id: number;
  name: string;
  note?: string;
  durationMs: number;
};

export type ChapterItem = {
  kind: "sequence";
  sequence: ActionSequence;
};

export type Chapter = {
  id: string;
  name: string;
  note?: string;
  items: ChapterItem[];
};

export type Program = {
  id: string;
  name: string;
  note?: string;
  chapters: Chapter[];
};
```

`program-utils.ts` add:

```ts
import { PROGRAM_SLOTS_PER_PAGE, type ChapterItem } from "./program-data";

export const sliceProgramPage = (items: ChapterItem[], pageIndex: number): ChapterItem[] => {
  const start = pageIndex * PROGRAM_SLOTS_PER_PAGE;
  return items.slice(start, start + PROGRAM_SLOTS_PER_PAGE);
};

export const programPageCount = (items: ChapterItem[]): number =>
  Math.max(1, Math.ceil(items.length / PROGRAM_SLOTS_PER_PAGE));
```

`program-context.ts`:
- `PageItems = { sequences: ChapterItem[] }` (no `cues`)
- Remove `addCue`

`use-program.tsx`:
- Delete `SLOT_PER_PAGE` / local `getPageItems` / cue-aware `getTotalPages`.
- `totalPages = programPageCount(currentChapter?.items ?? [])`
- `pageItems = { sequences: sliceProgramPage(currentChapter?.items ?? [], currentPageIndex) }`
- Delete `addCue` and its context value entries.

`use-executor-slots.tsx`:
- Import `PROGRAM_SLOTS_PER_PAGE`.
- `faderSlots` length = `PROGRAM_SLOTS_PER_PAGE`.
- Leave `buttonSlots` until Task 3 so Task 2 can compile.

`motion-persist.ts` `programToConfig`: `ChapterItem` is sequence-only; map ` { kind: "sequence", refId: item.sequence.id }`.

- [ ] **Step 4: Re-run Task 2 tests plus persist addSequence**

Run: `npx vitest run src/app/pages/console/components/program-panel/program-utils.spec.ts src/app/pages/console/hooks/use-program.persist.test.tsx src/app/pages/console/components/action-builder/action-builder-persist.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/pages/console/components/program-panel/program-data.ts src/app/pages/console/components/program-panel/program-utils.ts src/app/pages/console/components/program-panel/program-utils.spec.ts src/app/pages/console/hooks/program-context.ts src/app/pages/console/hooks/use-program.tsx src/app/pages/console/hooks/use-program.persist.test.tsx src/app/pages/console/components/action-builder/action-builder-persist.test.tsx src/app/pages/console/hooks/use-executor-slots.tsx src/app/project/motion-persist.ts
git commit -m "Paginate programs by 16 sequence slots and remove addCue."
```

---

### Task 3: Control executors and program tree UI

**Files:**
- Modify: `src/app/pages/console/hooks/use-executor-slots.tsx`
- Modify: `src/app/pages/console/components/exec-area/executors/executors.tsx`
- Modify: `src/app/pages/console/components/exec-area/executors/fader-slot.tsx`
- Modify: `src/app/pages/console/components/exec-area/executors/executor-section-guide.tsx`
- Delete: `src/app/pages/console/components/exec-area/executors/button-slot.tsx`
- Modify: `src/app/pages/console/components/exec-area/exec-area.tsx`
- Modify: `src/app/pages/console/components/exec-area/exec-area.test.tsx` (executor/GO/program-tree cases; exec-card kind in Task 4 if still blocked)
- Modify: `src/app/pages/console/components/program-panel/program-panel.tsx`
- Modify: `src/app/pages/console/components/program-panel/chapter-section.tsx`
- Modify: `src/app/pages/console/components/program-panel/page-section.tsx`
- Modify: `src/app/pages/console/components/program-panel/chapter-item-row.tsx`
- Modify: `src/app/pages/console/components/program-panel/program-empty-guide.tsx`

**Interfaces:**
- Consumes: `pageItems.sequences`, `PROGRAM_SLOTS_PER_PAGE`, `FaderSlotState`
- Produces: 16 fader slots, no `buttonSlots` / `ButtonSlot` / `onTriggerCue`; tree rows `F1`–`F16`; rehearsal add button is 序列 only

- [ ] **Step 1: Rewrite failing executor tests**

In `exec-area.test.tsx`:
- Remove `ButtonSlotState`, `buttonSlotsRef`, `onTriggerCue`, all `ButtonSlot` renders, Cue GO / empty-cue launch tests, Cue program-repair tree tests.
- Mock `useExecutorSlots` to return `faderSlots` of length 16 and no `buttonSlots`.
- Add:

```ts
it("renders sixteen fader slots and no Cue button slots", async () => {
  faderSlotsRef.current = Array.from({ length: 16 }, (_, index) => ({
    index,
    label: `F${index + 1}`,
    sequence: null,
    faderValue: 100,
    isRunning: false,
  }));
  renderExecArea();
  expect(screen.queryByText("Cue")).toBeNull();
  expect(screen.getAllByLabelText(/速度$/)).toHaveLength(16);
});
```

Keep FaderSlot GO-gate tests for empty/unrepaired sequences (existing sequence cases). Delete Cue-specific GO-gate tests.

Empty-guide / page-section tests: if they click `onAddCue` or pass `cues={...}`, switch to sequences only and `F1` labels.

- [ ] **Step 2: Run the executor test file to verify failure**

Run: `npx vitest run src/app/pages/console/components/exec-area/exec-area.test.tsx`

Expected: FAIL (Cue row / `onTriggerCue` still there, or 8 faders).

- [ ] **Step 3: Implement UI**

`use-executor-slots.tsx`:
- Delete `ButtonSlotState`, `buttonSlots`, `runningButtons`, `setSlotRunning` `"button"` branch.
- Delete `PositionCue` from `program-data.ts` if nothing else imports it.
- `setSlotRunning(index, running)` only for faders. Prefer:

```ts
setSlotRunning: (index: number, running: boolean) => void;
```

`executor-section-guide.tsx`: remove `kind`. Always 推子槽 / 动作序列. Drop Cue copy.

`executors.tsx`:

```tsx
<section className="flex h-full flex-col bg-muted">
  <ExecutorPaginationBar />
  <div className="flex-1 overflow-y-auto p-3">
    <div className="flex gap-2">
      <ExecutorSectionGuide className="self-stretch" />
      <div className="grid min-w-0 flex-1 grid-cols-8 gap-2">
        {faderSlots.map((slot) => (
          <FaderSlot
            key={slot.index}
            slot={slot}
            repairMessage={...}
            onGo={() => slot.sequence && onTriggerSequence(slot.index, slot.sequence.id)}
            onFaderChange={(value) => setFaderValue(slot.index, value)}
            onAssignFromDrag={handleAssignFromDrag(slot.index)}
          />
        ))}
      </div>
    </div>
  </div>
</section>
```

`handleAssignFromDrag(targetSlotIndex)`:
- Payload `{ chapterId, index, kind: "sequence" }` only.
- `insertAt = targetSlotIndex + currentPageIndex * PROGRAM_SLOTS_PER_PAGE` (items are sequences in chapter order). If that index is past `items.length`, append.

`fader-slot.tsx`: `onAssignFromDrag` payload kind `"sequence"` only. Keep `h-[140px]`.

`exec-area.tsx`: delete `onTriggerCue` and `buttonSlots`. Sequence trigger unchanged.

Delete `button-slot.tsx`.

Control `program-panel.tsx`: delete `addCue`, Cue double-click launch. Double-click only sequences (existing `startLocalAuthoredSequence` path). Drag payload `kind: "sequence"`.

`chapter-section.tsx`:
- `SLOT = PROGRAM_SLOTS_PER_PAGE`.
- Pages = chunks of 16 items (no cue/sequence split).
- Remove `onAddCue`.
- `itemIndexOffset = pageIndex * PROGRAM_SLOTS_PER_PAGE`.

`page-section.tsx`:
- Props: `sequences: ChapterItem[]` only; no `cues`, no `onAddCue`.
- Rows: `slotLabel={`F${idx + 1}`}` with `idx` 0–15 on that page.
- Rehearsal footer: one dashed button 「序列」 calling `onAddSequence`.

`chapter-item-row.tsx`: sequence-only (name/note/duration from `item.sequence`; glyph `║`).

`program-empty-guide.tsx` body:

```tsx
请先在动作界面创建动作序列，并组装为节目章节后再回到控制界面执行。
```

- [ ] **Step 4: Re-run executor tests**

Run: `npx vitest run src/app/pages/console/components/exec-area/exec-area.test.tsx`

Expected: PASS for executor/tree cases. If exec-card Cue tests still fail, leave them for Task 4.

- [ ] **Step 5: Commit**

```bash
git add src/app/pages/console/hooks/use-executor-slots.tsx src/app/pages/console/components/exec-area src/app/pages/console/components/program-panel
git commit -m "Show sixteen sequence fader slots and remove Cue control UI."
```

Do not `git add` Task 4 files you have not finished.

---

### Task 4: Exec cards are sequences only

**Files:**
- Modify: `src/app/pages/console/hooks/use-exec-cards.tsx`
- Modify: `src/app/pages/console/components/exec-area/exec-cards/exec-card.tsx`
- Modify: `src/app/pages/console/components/exec-area/exec-cards/exec-empty-state.tsx`
- Modify: `src/app/pages/console/components/exec-area/exec-area.test.tsx`

**Interfaces:**
- Consumes: `launch({ kind: "sequence", ... })` from control/program
- Produces: `ExecCardKind = "sequence"`; `ExecCardSource` without `{ kind: "button" }`; no Cue chrome

- [ ] **Step 1: Rewrite the failing card tests**

Replace `"keeps a sequence card running after wall-clock exceeds 编排时长 while cue cards auto-complete"` with:

```ts
it("keeps a sequence card running after wall-clock exceeds 编排时长", () => {
  const sequenceCard = runningCard({
    id: "seq-card",
    kind: "sequence",
    name: "正常序列",
    durationMs: null,
  });
  const next = advanceRunningCards([sequenceCard], 2500);
  expect(next![0]?.status).toBe("running");
  expect(next![0]?.elapsedMs).toBe(2500);
});
```

`runningCard` default `kind: "sequence"`. Delete Cue auto-complete assertions. Empty state test (if any) should not mention Cue.

- [ ] **Step 2: Run card tests expecting failure or type errors**

Run: `npx vitest run src/app/pages/console/components/exec-area/exec-area.test.tsx`

- [ ] **Step 3: Implement**

```ts
export type ExecCardKind = "sequence";
export type ExecCardSource =
  | { kind: "fader"; slotIndex: number }
  | { kind: "program" }
  | { kind: "external" }
  | { kind: "manual" };
```

`exec-card.tsx`:
- Delete Cue vs Seq badge branches; always `"Seq"`.
- `maxSpeed = 200`.
- Ring always `ring-show/40` (not primary Cue ring).
- Delete `source.kind === "button"` (`B{n}`) from `sourceLabel`.

`exec-empty-state.tsx`:

```tsx
<p className="text-body-sm">从下方 Executor 槽位触发，或双击节目结构中的动作序列</p>
```

Grep `kind: "cue"` under `exec-area` / `use-exec-cards` and remove leftover launches.

- [ ] **Step 4: Re-run**

Run: `npx vitest run src/app/pages/console/components/exec-area/exec-area.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/pages/console/hooks/use-exec-cards.tsx src/app/pages/console/components/exec-area/exec-cards src/app/pages/console/components/exec-area/exec-area.test.tsx
git commit -m "Remove Cue exec cards; running cards are sequences only."
```

---

### Task 5: Action-page 节目管理 rejects Cue

**Files:**
- Modify: `src/app/pages/console/components/action-builder/action-builder-context-types.ts`
- Modify: `src/app/pages/console/components/action-builder/action-builder-context.tsx`
- Modify: `src/app/pages/console/components/action-builder/content-library/library-dnd.ts`
- Modify: `src/app/pages/console/components/action-builder/content-library/library-dnd.spec.ts`
- Modify: `src/app/pages/console/components/action-builder/right-panel/program-panel.tsx`
- Modify: `src/app/pages/console/components/action-builder/content-library/content-library-panel.tsx`

**Interfaces:**
- Consumes: `LibraryDragPayload` (Cue still valid for timeline)
- Produces: `ProgramItemInput = { kind: "sequence"; refId: number }`; `sequenceProgramItemFromLibrary(payload): ProgramItemInput | null`

- [ ] **Step 1: Write failing library tests**

Append to `library-dnd.spec.ts`:

```ts
import { sequenceProgramItemFromLibrary } from "./library-dnd";

it("does not convert a Cue library drag into a program item", () => {
  expect(sequenceProgramItemFromLibrary({ kind: "cue", id: "cue-1" })).toBeNull();
});

it("converts a sequence library drag into a program item", () => {
  expect(sequenceProgramItemFromLibrary({ kind: "sequence", id: 14 })).toEqual({
    kind: "sequence",
    refId: 14,
  });
});
```

- [ ] **Step 2: Run**

Run: `npx vitest run src/app/pages/console/components/action-builder/content-library/library-dnd.spec.ts`

Expected: FAIL (`sequenceProgramItemFromLibrary` missing).

- [ ] **Step 3: Implement**

`library-dnd.ts`:

```ts
import type { ProgramItemInput } from "../action-builder-context-types";

export const sequenceProgramItemFromLibrary = (
  payload: LibraryDragPayload,
): ProgramItemInput | null => {
  if (payload.kind !== "sequence") return null;
  return { kind: "sequence", refId: payload.id };
};
```

`action-builder-context-types.ts`:

```ts
export type ProgramItemInput = { kind: "sequence"; refId: number };
```

`handleProgramItemInsert`: if `item.kind !== "sequence"` return (after the type change this is a runtime belt for stale callers). Look up sequence only; `type: "sequence"` node.

Action `program-panel.tsx` `handleDropAt`:

```ts
const libraryPayload = readLibraryDrag(event.dataTransfer);
const programItem = libraryPayload ? sequenceProgramItemFromLibrary(libraryPayload) : null;
if (programItem) {
  onInsert(chapter.id, programItem, index);
  return;
}
```

Do not toast. Cue mime is ignored.

`ItemMeta` and `handleLaunch`: sequence only. Delete Cue launch / `estimateArrivalMs` import if unused.

Empty copy:

```tsx
暂无节目。新建章节后，把左侧内容库的动作序列拖入章节即可编排。
```

`content-library-panel.tsx`: 「添加到章节」 only for `entry.kind === "sequence"`. Cue rows keep timeline / combine drag (`writeLibraryDrag` Cue payload unchanged).

- [ ] **Step 4: Re-run**

Run: `npx vitest run src/app/pages/console/components/action-builder/content-library/library-dnd.spec.ts src/app/pages/console/components/action-builder/content-library/content-library-panel.spec.tsx src/app/pages/console/components/action-builder/action-builder-persist.test.tsx`

Expected: PASS. Library Cue select/preview tests must still pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/pages/console/components/action-builder/action-builder-context-types.ts src/app/pages/console/components/action-builder/action-builder-context.tsx src/app/pages/console/components/action-builder/content-library/library-dnd.ts src/app/pages/console/components/action-builder/content-library/library-dnd.spec.ts src/app/pages/console/components/action-builder/right-panel/program-panel.tsx src/app/pages/console/components/action-builder/content-library/content-library-panel.tsx
git commit -m "Reject Cue inserts in 节目管理; chapters only accept sequences."
```

---

### Task 6: Sweep remaining Cue-as-executable tests

**Files:**
- Grep leftovers (do not “fix” Cue authoring):

```bash
rg "addCue|onTriggerCue|ButtonSlot|kind: \"cue\"" src/app/pages/console/components/program-panel src/app/pages/console/components/exec-area src/app/pages/console/hooks/use-program.tsx src/app/pages/console/hooks/program-context.ts src/app/pages/console/hooks/use-executor-slots.tsx src/app/project/motion-persist.ts src/app/project/motion-adapters.ts
```

- Modify any remaining compile/test breaks in the files above.
- Do not change `cue-pose-editor`, `membership-dim.test.ts`, Cue library preview, or `positionCues` authoring tests unless they import removed `addCue` / program Cue items.

**Interfaces:**
- Consumes: Tasks 1–5
- Produces: no Cue executable path on control/program

- [ ] **Step 1: Run the affected suite**

```bash
npx vitest run src/app/pages/console/components/exec-area/exec-area.test.tsx src/app/pages/console/components/program-panel/resolve-program-motion.test.ts src/app/pages/console/components/program-panel/program-utils.spec.ts src/app/pages/console/hooks/use-program.persist.test.tsx src/app/pages/console/components/action-builder/action-builder-persist.test.tsx src/app/pages/console/components/action-builder/content-library/library-dnd.spec.ts src/app/project/project-document-validate.spec.ts src/app/project/project-object-deletion.test.ts
```

Expected: PASS. If a listed file fails because it still treats Cue as a program/control item, fix it in this task. If it fails for an unrelated reason, do not expand scope.

- [ ] **Step 2: Commit only if this task produced diffs**

```bash
git add <files-you-changed>
git commit -m "Finish sequence-only program and control test sweep."
```

Skip the commit if the working tree has no Task 6 changes.

---

## Spec coverage

| Spec | Task |
|---|---|
| `ProgramItemRef` sequence-only | 1 |
| Hydrate drops Cue program items, no toast | 1 |
| Validate program items must be sequence | 1 |
| Mock/docs/tests lose program Cue refs | 1 |
| `getProgramRepairIssues` sequence copy | 1 |
| Cue authoring / `getMotionItemRepairIssue("cue")` kept | 1 (untouched Cue editor) |
| `SLOT=16`, `pageItems` sequences only, no `addCue` | 2 |
| Two rows × 8 faders, delete Cue row / ButtonSlot | 3 |
| Guide stretched to both rows; `F1`–`F16` | 3 |
| Rehearsal add = 序列 only; empty copy without Cue | 3 |
| Sequence GO / fader unchanged | 3 |
| No Cue exec cards | 4 |
| Cue drop on 节目管理 no insert / no toast | 5 |
| Content-library Cue still drags to timeline | 5 |
| Targeted tests only | all |
