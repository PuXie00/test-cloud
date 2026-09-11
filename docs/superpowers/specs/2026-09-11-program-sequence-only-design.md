# Program and Control: Sequence Only

Date: 2026-09-11

Cue remains an action-page authoring primitive (pose snapshots). Control execution and program chapters only use action sequences.

## Goal

- Control page has no Cue GO path. Executor shows action-sequence fader slots only: two rows × eight columns, sixteen slots per page. Slot chrome and height stay as today's sequence fader slot.
- Program chapters (control tree and action-page 节目管理) only reference sequences. No `addCue`, no Cue drop into a chapter, no Cue launch from program.
- `ProgramItemRef` is `{ kind: "sequence"; refId: number }` only.

## Non-goals

- Removing Cue from the product (`positionCues`, Cue editor, content-library Cue rows, Cue→timeline composition, 3D Cue preview).
- Changing sequence GO, fader speed, or `startLocalAuthoredSequence`.
- Migrating existing program Cue refs into sequences. Treat chapters as empty for this stage.
- Redesigning executor slot visuals (width, fader, GO) beyond dropping the Cue row and adding a second sequence row.

## Architecture

Cue and sequence stay separate stores. Only the program/control surfaces stop treating Cue as a launchable item.

```
positionCues          →  Cue editor / library / timeline  (unchanged)
actionSequences       →  sequence editor / library
programs[].items      →  sequence refs only
        │
        ▼
useProgram pageItems  →  16 sequences / page
        │
        ▼
faderSlots[0..15]     →  GO / fader  (existing sequence path)
```

Read path: if a chapter item has `kind: "cue"`, drop it. Do not convert, do not toast. Validation then requires every remaining item to be a sequence ref.

## Components

### Control executors

- Remove the Cue button row, `onTriggerCue`, `ButtonSlot`, and `buttonSlots`.
- Keep `FaderSlot`. Right side: `grid` two rows × eight columns (sixteen slots). Per-slot height unchanged.
- One left-side guide for the block: 推子槽 / 动作序列, stretched to both rows. Do not keep a second Cue guide.

### Pagination and slots

- `SLOT_PER_PAGE = 16`.
- `pageItems` is the current page's sequences only (no `cues` array).
- `faderSlots` length 16, index `0..15`, aligned with that page.
- Remove `addCue` from program context. Keep `addSequence` on the control chapter UI.

### Control program tree

- Page/chapter lists, drag-to-slot, and double-click operate on sequences only.
- Empty-state copy must not tell the user to create Cues.
- Per-page slot labels stay fader-style: `F1`–`F16` (today’s sequence rows use `F1`–`F8`; Cue rows used `B1`–`B8` and go away).
- Rehearsal page actions: only 「序列」. Remove the dashed 「Cue」 button.

### Action-page 节目管理

- Chapter insert accepts content-library sequences only.
- Cue dragged onto a chapter: do not insert, no toast. Cue drag onto the sequence timeline is unchanged.
- In-row play starts a sequence only (existing download/GO path).

### Types and persist

- `ProgramItemRef`, control `ChapterItem`, and `ProgramItemInput` lose the Cue variant.
- `motion-persist`, document validate, motion readiness, object-deletion cleanup, and mock documents must not put Cue items in `programs`.
- `positionCues` and Cue editor persist unchanged.

## Data flow

1. Hydrate `Program` from `document.motion.programs`. Filter out any `kind: "cue"` items.
2. `useProgram` slices sequences for `currentPageIndex` in chunks of 16.
3. `useExecutorSlots` maps `pageItems[i]` → `faderSlots[i]`. Empty slots stay empty.
4. Fader GO / tree double-click / 节目管理 play → `resolveMotionLaunchBlock` → `startLocalAuthoredSequence` → exec card `kind: "sequence"`.
5. Rehearsal drag between tree and fader slots reorders or moves sequence items only. Drag payload `kind` is `"sequence"` only.
6. `addSequence` still creates an `ActionSequenceConfig` and a program sequence ref.

Do not enqueue Cue exec cards. Remove `kind: "cue"` from the exec-card model and Cue-only card chrome (label, 150% cap). Running cards are sequences only.

## Error handling

| Case | Behavior |
|---|---|
| Empty / missing / unrepaired sequence | Existing GO block + chapter-row warning |
| Cue dropped on a program chapter | No insert, no toast |
| Loaded chapter contains `kind: "cue"` | Drop the item; no migration; no toast |
| Document validate | Program items must be `{ kind: "sequence", refId }` |
| Cue authoring issues (empty Cue, etc.) | Still reported on the action page, not on control/program |

## Testing

Targeted vitest only. Do not run the full suite.

Update (Cue as program/control executable is gone):

- `exec-area` Cue button slots, Cue GO, program Cue repair
- Control tree / `addCue`
- `project-document-validate`, `project-object-deletion`, `motion-persist` program Cue refs
- `action-builder-persist` “program addCue writes positionCues”

Keep (Cue as authoring):

- Cue editor, library select/preview, `positionCues` persist
- Sequence timeline composition from Cues
- 3D Cue preview / membership dim in Cue dock mode

Add:

- Content-library Cue drop onto a program chapter does not insert
- Load drops `kind: "cue"` program items
- Pagination uses 16 sequences
- `Executors` does not render button slots; sixteen fader slots
