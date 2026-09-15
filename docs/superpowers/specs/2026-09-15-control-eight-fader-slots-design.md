# Control Page: Eight Fader Slots

Date: 2026-09-15

Control-page executor faders are sixteen slots per page (two rows × eight columns, `PROGRAM_SLOTS_PER_PAGE = 16`) in short 140px cards with a native vertical range input. The left guide is 148px of tutorial copy. The exec area is 330px tall. The 2026-09-11 program-sequence-only spec locked that 16-slot grid; this spec replaces **only** the slot count and chrome (sequence-only programs stay). Result: **eight slots per page**, one row, a shorter exec area, a narrower guide, and a console-strip slot with a custom fill-from-bottom fader. Ready → GO, speed 0–200%, and PLC stay as they are.

## Goal

- One control page shows **eight** sequence fader slots (`F1`–`F8`).
- Program-tree paging uses the same eight: page N is sequences `(N-1)*8 .. N*8-1` of the current chapter. Slot `Fi` is always the i-th item on the current page.
- Layout: **single row** of eight tall strips. Exec area height **330px → 260px**. Left guide **148px → 96px** (icon + title + one line).
- Slot chrome: console strip. Custom vertical fader fills the middle; label/name on top; Ready/GO on the bottom. No native range input.

## Non-goals

- Project document migration or a new persist field for page size. Pages stay a runtime slice of `chapter.items`.
- Ready/GO/PLC (`readySequence`, `goSequence`, fingerprints, busy, running).
- Fader semantic range (0–200%, default 100).
- Left exec cards, monitor grid, 3D viewport, action-page timeline, or program-tree row chrome (except page size and `F1`–`F8` labels).
- Mixer ticks (0/100/200), round GO pads, LED beads, or physical-console key mapping.

## Locked decisions

| Topic | Decision |
|---|---|
| Slots per page | `PROGRAM_SLOTS_PER_PAGE = 8` |
| Program tree pages | Same constant; more pages when a chapter has >8 sequences |
| Slot labels | `F1`–`F8` on the current page (not `F9`–`F16` on page 2) |
| Document | Unchanged; 16-item chapters become two pages at runtime |
| Grid | One row × eight columns |
| Overflow | Horizontal scroll if strips would go below min width; never wrap to two rows |
| Exec area height | `260px` |
| Guide width | `96px`; keep icon, 「推子槽」, one short line |
| Slot anatomy | Top identity, custom fader (flex 1), Ready/GO bottom |
| Fader UI | Custom track, fill from bottom, thumb, `%` label; keyboard `role="slider"` |
| Empty / repair / busy / running | Same enablement and border colors as today |
| Drag-drop | Rehearsal only; insert index `pageIndex * 8 + slotIndex` |

## Architecture

Keep a single page-size constant. Executor slot count, tree paging, and drag insert all read it.

```
chapter.items[]                    (flat sequence list, unchanged)
        │
        ▼
sliceProgramPage(..., pageIndex)   chunks of 8
        │
        ▼
pageItems.sequences[0..7]
        │
        ▼
faderSlots[0..7]  label F1..F8     use-executor-slots
        │
        ▼
Executors  1×8 grid + VerticalFader strips
```

Existing chapters with 9–16 items that used to be one page become two pages. No toast, no rewrite of `programs` JSON.

## Components

### `program-data.ts`

- `PROGRAM_SLOTS_PER_PAGE`: `16` → `8`.

### `program-utils.ts` / `chapter-section.tsx` / `page-section.tsx`

- `sliceProgramPage` / `programPageCount` already use the constant; behavior follows.
- Tree page headers still 「页 n/m」; item rows still `slotLabel={`F${idx + 1}`}` (now at most `F8`).
- `itemIndexOffset = pageIndex * PROGRAM_SLOTS_PER_PAGE` stays; the multiplier becomes 8.

### `use-executor-slots.tsx`

- `Array.from({ length: PROGRAM_SLOTS_PER_PAGE })` yields eight slots.
- Phase, busy, fader value, Ready fingerprint: unchanged.

### `console-page.tsx`

- Control `ExecArea` class: `h-[330px]` → `h-[260px]`.

### `executor-section-guide.tsx`

- Width `w-[148px]` → `w-[96px]`.
- Keep icon + 「推子槽」.
- One line of help (rehearsal: 拖入序列；演出: 推子调速). Drop the extra paragraphs (「动作序列」, default 100% block, mode footer) so the column fits 96px.

### `executors.tsx`

- Grid stays `grid-cols-8`. With eight children it is one row.
- Each strip `min-w-[72px]`. The grid container `overflow-x-auto overflow-y-hidden`. Do not use `grid-cols-4` or a second row.
- Drag assign still `targetSlotIndex + currentPageIndex * PROGRAM_SLOTS_PER_PAGE`.

### `vertical-fader.tsx` (new)

Presentational control used only by the slot:

- `value` 0–200 integer; `onChange`; `disabled`; `aria-label`.
- Track: full height of the flex middle. Fill from the **bottom** up (`value / 200`).
- Thumb sits on the fill top. Drag with pointer capture. Click track sets value.
- Keyboard: `role="slider"` on the custom root (no native `<input type="range">`, visible or hidden). `aria-valuemin={0}` `aria-valuemax={200}` `aria-valuenow`. ArrowUp/ArrowRight +1, ArrowDown/ArrowLeft −1, Shift or PageUp/PageDown ±10. Clamp to 0–200. One tab stop.
- Numeric `%` sits under the track, above Ready/GO, `font-mono` tabular nums. Empty/disabled: faded track, no pointer, `%` still shown only when the slot has a sequence.

### `fader-slot.tsx`

Strip column, not a 140px card:

```
┌─────────────┐
│ F3  ●       │  label + status dot
│ 开幕A       │  name, line-clamp 1; omit when empty
│      ║      │
│      ║      │  VerticalFader (flex-1), fill from bottom
│      █      │
│    120%     │  % under track; hidden when empty
│  Ready/GO   │  full-width, h-9
└─────────────┘
```

Empty rehearsal: drop hint in the fader region (plus + 「拖入序列」). Empty show: 「—」.

Border/background tokens unchanged:

| State | Border | Button |
|---|---|---|
| Empty | dashed muted | disabled |
| Repair | warning | disabled |
| Idle filled | default | Ready |
| Ready | primary | GO |
| Running | show | GO, no-op |
| Busy | as current phase | spinner, disabled |

Drop target is still the whole strip (rehearsal + `application/x-console-item` sequence).

## Data flow

Unchanged except page size:

1. `useProgram` slices the current chapter with size 8.
2. `ExecutorSlotsProvider` maps eight `pageItems` entries to eight `FaderSlotState`s.
3. Fader edits still `setFaderValue(index, 0..200)`.
4. Ready/GO still `exec-area` → `readySequence` / `goSequence` → exec card `source: { kind: "fader", slotIndex }` with `slotIndex` 0–7.
5. Page change remaps slot contents; existing Ready invalidation (sequence id / fingerprint) still clears a slot that no longer matches.

## Error handling

No new toasts or dialogs.

| Case | Behavior |
|---|---|
| Chapter has 0 items | One empty page, eight empty strips |
| Chapter has 9 items | Page 1: eight filled; page 2: one filled + seven empty |
| Narrow window | Horizontal scroll; never two rows |
| Empty / repair / running / busy | Same click guards as today |
| Native range gone | Keyboard and name still work via `role="slider"` |
| Loaded 16-item chapter | Two pages; no migration warning |

## Testing

Targeted vitest only. Do not run the full suite, `tsc --noEmit`, or a production build. No GUI / screen testing.

### `program-utils.spec.ts`

- `PROGRAM_SLOTS_PER_PAGE === 8`
- 8 items → 1 page, slice length 8
- 9 items → 2 pages; page 1 has 1 item
- 17 items → 3 pages

### `vertical-fader` (new spec)

- Renders `role="slider"` with min 0 / max 200 / current value
- Disabled: no `onChange` on pointer or key
- ArrowUp increments 1; Shift+ArrowUp increments 10; clamp at 200
- Pointer drag / track click calls `onChange` with a clamped integer

### `exec-area.test.tsx` / `fader-slot`

- Eight slots (`F1`–`F8`), not sixteen
- Ready/GO, repair, empty, busy: keep existing cases; update queries if the native range is gone (speed control is the slider)
- Drag insert index uses `* 8` (if covered)

### `executor-section-guide`

- Not required unless copy tests exist; if they assert the long tutorial, update to the one-line text.

Do not test: PLC, 3D, exec cards, monitor grid, physical hardware.
