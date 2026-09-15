# Remove Cue; Save Current Pose as a Sequence

Date: 2026-09-15

Cue is still an action-page authoring type (`positionCues`, library rows, Cue dock, Cue→timeline drop, two-Cue transition). Programs and control faders are already sequence-only (2026-09-11). This spec **deletes Cue from the product**. Control-page 「保存为 Cue」 becomes 「保存当前位姿」: a new action sequence whose pose blocks all sit at `atMs = 0`, inserted into the current program chapter.

Development-stage projects have no Cue data to migrate. Only in-repo mocks/fixtures change.

## Goal

- Action page has no Cue surface and no Cue logic: no library Cue tab/rows, no Cue dock, no Cue drop onto the timeline, no two-Cue transition, no 「新建 Cue」 / 「加入当前 Cue」.
- Document `motion` has `actionSequences` and `programs` only. No `positionCues`.
- Sequence authoring keeps the existing right-panel **添加位姿** (insert at the playhead into the selected sequence).
- Control-page quick action **保存当前位姿** creates a new sequence named **新建动作序列**, one pose block per selected object at `t = 0`, and appends it to the **current chapter** so a fader slot can show it.

## Non-goals

- Migrating or warning on old files that still contain `positionCues`.
- Changing 添加位姿, timeline 100ms grid, Ready/GO, fader 8-slot paging, or PLC.
- Auto Ready, auto GO, or jumping to the action page after capture.
- Sparse chapter holes (items stay a dense list). Capture always appends.

This replaces the 2026-09-11 sentence “Cue remains an action-page authoring primitive”. Sequence-only programs/faders stay.

## Locked decisions

| Topic | Decision |
|---|---|
| Existing Cue files | Ignore; no conversion, no toast. Repo mocks drop Cue. |
| `positionCues` | Removed from `ProjectMotion` and persist |
| Extra poses on a sequence | Existing 添加位姿 only |
| Capture objects | Current selection; none selected → button disabled |
| Capture output | New `ActionSequenceConfig`, pose blocks `atMs = 0` |
| Sequence name | `新建动作序列` (same as empty-sequence create; no auto suffix) |
| Program insert | Append to current chapter `items` (next empty fader in page order) |
| No current chapter | Button disabled |
| No usable pose | Do not create a sequence or chapter item |
| Show vs rehearsal | Both may click; writes the document only |

## Architecture

Cue as a store goes away. Live pose snapshot writes a sequence, then a program ref.

```
selected object ids
        │
        ▼
pose blocks at atMs=0     (same pose values as 添加位姿)
        │
        ▼
actionSequences[]  +  current chapter.items append
        │
        ▼
control fader slot (next empty on the paged list)
```

Action-page library and dock are sequence-only. `EditorDockMode` loses `"cue"` (and `"transition"` if that mode exists only for two-Cue compose).

## Components

### Document and persist

- `ProjectMotion`: drop `positionCues`.
- `motion-persist` / adapters: drop `CueItem` ↔ `PositionCueConfig` and `state.cues`.
- Validate: drop Cue unknown-object / empty-cue checks. Empty **sequences** still repair as today.
- Object deletion: stop rewriting Cue targets; only sequences/programs.
- Mocks (`gz-2025`, `sh-ballet`, tests): `positionCues: []` removed, not emptied.
- `getMotionItemRepairIssue` / `resolveMotionLaunchBlock`: drop `kind: "cue"`.

### Action builder

Remove:

- `createCueItem`, `handleCreateCue`, all `handleCue*`, `selectedCueId`, `cues`, `combineFromCueId`, `handleCombineStart`, `handleGenerateTransition`, `buildTransitionSequence`, `cueDropPoseForObject`
- `CuePoseEditor`, Cue dock branch, Cue library filter/rows/DnD (`library-dnd` Cue payload)
- Object-selection 「新建 Cue」「加入当前 Cue」 and `mode === "cue"`
- 3D Cue preview / membership dim keyed on Cue selection

Keep:

- `handleCreatePose` / 添加位姿 at `cursorMs`
- `handleCreateSequence` / 新建动作序列 (empty)
- Sequence timeline, presets, instructions

### Control quick action

`quick-actions.tsx` 「保存为 Cue」 is currently an unwired button. Wire it:

- Label: **保存当前位姿**
- Disabled when `multiSelectedIds` / selection is empty, or there is no current chapter (`isProgramEmpty` / no `currentChapterId`)
- On click: create sequence + append chapter item in **one** document update. No half-written sequence if the program write fails.

Pose values: same helper as 添加位姿 (`poseForObject`): `v1` from the object’s `currentPosition`, `v2`/`v3` `0`.

### Chapter insert

`chapter.items` is dense. Append at `items.length`. Paging (`PROGRAM_SLOTS_PER_PAGE = 8`) then shows the new item in the first trailing empty fader (new page if the last page was full). Do not splice the middle of a full page.

## Data flow

### Capture (control)

1. User has a current chapter and a non-empty object selection.
2. Click 保存当前位姿.
3. Allocate a sequence id (`allocateSequenceIdsInProject`).
4. Build blocks: for each selected id, if a pose can be read, `{ kind: "pose", objectId, atMs: 0, pose }`. If the block list is empty, stop (no document write).
5. `updateCurrentDocument` once: append the sequence to `actionSequences` and append `{ kind: "sequence", refId }` (legacy chapter item with that sequence) to the current chapter.
6. Faders on the current page update from `pageItems` as they do today.

### Action page

Selecting a sequence still opens the sequence dock. There is no Cue selection path.

## Error handling

No new modal. Existing persist error on the program provider is enough for id exhaustion.

| Case | Behavior |
|---|---|
| No object selected | Button disabled |
| No current chapter / empty program | Button disabled |
| Every selected object yields no pose | No write |
| Sequence id exhausted | Existing persist error; no sequence |
| Document update fails | No sequence and no chapter row |
| Duplicate name `新建动作序列` | Allowed (same as `addSequence`) |

## Testing

Targeted vitest only. No full suite, `tsc --noEmit`, production build, or GUI/screen tests.

- Document validate / persist / object-deletion: no `positionCues` field. Program items stay `{ kind: "sequence", refId }` only (Cue refs already forbidden).
- Action builder persist: no `handleCreateCue`; 添加位姿 still inserts at the cursor.
- Content library: no Cue filter, no 新建 Cue; 新建动作序列 remains.
- Object-selection panel: no 新建 Cue / 加入当前 Cue; 添加位姿 still calls `onCreatePose`.
- Control capture: selection + chapter → one sequence, all `atMs === 0`, chapter length +1; empty selection does not write.
- Mocks compile without `positionCues`.

Do not test: PLC, fader Ready/GO behavior, 8-slot chrome.
