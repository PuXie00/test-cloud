# Action Timeline: 100ms Grid

Date: 2026-09-14

The action-page sequence timeline stores integer milliseconds but currently rounds the playhead and block times to **1ms**. The ruler readout is `mm:ss` with no tenths (1500ms shows as `00:01`). Property and context-bar time fields use `ms` with `step={1}`. This spec makes authored time a **100ms / 0.1s** grid and shows **total seconds with one decimal**.

## Goal

- Playhead moves on 100ms steps (click, drag, empty-track, arrow keys).
- All authored sequence times (`atMs`, `startMs`, `endMs`, insert/paste/resize/shift, transition duration) snap to 100ms on write.
- Action-page duration/time labels show total seconds with one decimal: `0.0`, `1.5`, `90.5` (not `mm:ss`).
- Storage and PLC stay integer milliseconds (multiples of 100).

## Non-goals

- Migrating existing documents (development stage; 1ms leftovers like 501ms are ignored).
- Control-page exec-card elapsed time (keep its own `00:01.5` formatter).
- Log timestamps, alignment-confirm clocks.
- Cue pose snapshots (no execution time on Cue).
- Motion-profile accel/decel fields (local physics seconds, two decimals).
- Preset numeric params that are not time.
- Changing PLC `actionDataSave` / compile wire shapes.
- Snapping horizontal pan / zoom `viewStartMs` to 100ms (viewport, not authored time).

## Locked decisions

| Topic | Decision |
|---|---|
| Grid | 100ms on cursor **and** all authored times |
| Old documents | Ignore; no load-time quantize |
| Display | Seconds, one decimal |
| ≥ 60s | Keep total seconds (`90.5`), not `m:ss.d` |
| Surfaces | All action-page duration/time readouts (timeline, content library, 节目管理, sequence total, transition composer) |
| Approach | Store ms; snap at every write; central helpers |
| Keyboard | Arrow ±0.1s; Shift ±1.0s |

## Architecture

Document and PLC keep integer ms. Action-page authored times snap to 100ms before write.

In `timeline-data.ts`:

| Symbol | Meaning |
|---|---|
| `TIME_STEP_MS = 100` | Grid |
| `snapTimeMs(ms)` | `max(0, round(ms / 100) * 100)` |
| `formatTime(ms)` | Total seconds, one decimal (`0.0`, `1.5`, `90.5`) |
| `msToSeconds` / `secondsToMs` | Property/context fields: s ↔ ms, step 0.1 on the second side |

All writes go through `snapTimeMs`: `clampCursorMs`, `pxToMs`, insert / drag / paste / `atMs` replace, transition duration.

Do not add a validator that rejects non-multiples of 100. Snap on write so new edits cannot land off-grid.

```
pointer / input (px or seconds)
        │
        ▼
   pxToMs / secondsToMs
        │
        ▼
    snapTimeMs  →  atMs | cursorMs | startMs | endMs
        │
        ▼
   persist / compile (integer ms)
        │
        ▼
    formatTime  →  "1.5"  (read-only display)
```

## Components

### `timeline-data.ts` / `timeline-view-extent.ts`

- Add `TIME_STEP_MS`, `snapTimeMs`, `msToSeconds`, `secondsToMs`.
- Replace `formatTime` (`mm:ss` → total seconds, one decimal).
- `pxToMs` and `clampCursorMs` return multiples of 100.
- `MIN_BLOCK_MS = 500` stays (already on-grid).

### Timeline chrome

- Ruler scrub, empty-track click, playhead drag: snapped cursor.
- Arrow: ±100ms; Shift+arrow: ±1000ms (today ±1000 / ±5000).
- Drag labels (pose / preset) use new `formatTime`.
- Nice ticks may keep 0.1s as the finest major candidate.

### Properties + context bar

- Sequence time fields (`atMs`, `startMs`, `endMs`): unit `s`, step 0.1, precision 1.
- Display `msToSeconds`; commit `snapTimeMs(secondsToMs(value))`.
- Resolved-point copy that shows `N ms` uses `formatTime` (or equivalent seconds).

### Other action-page readouts

- Content library sequence duration, 节目管理 duration, sequence context-bar total, transition-composer duration labels: shared `formatTime`.
- Transition duration writes also snap.

### `sequence-ops` / context writes

- `move` / `insert` / `resize` / `paste` / `shift` snap times before persist.

Leave unchanged: preset non-time params, trapezoid accel/decel local formatter, control exec cards, logs.

## Data flow

1. Pointer/drag px → `pxToMs` → `snapTimeMs` → `cursorMs` / block times.
2. New blocks use the current (already snapped) playhead.
3. Property fields show seconds; user edits seconds → `secondsToMs` → `snapTimeMs` → `onReplaceBlock`.
4. Readouts only format; they do not rewrite storage.
5. Compile / `actionDataSave` consume integer ms (multiples of 100).

`viewStartMs` pan/zoom may stay pixel-rounded.

## Error handling

No new toasts or modals. Snap is silent.

| Case | Behavior |
|---|---|
| 0.14s typed / drag off-grid | Nearest 0.1s |
| Negative | Existing clamp to 0 / `invalid-time` |
| Resize `end <= start` | Existing reject |
| Two poses on the same tick | Existing same-time overlap rules |
| Off-grid documents | Ignored; no migration |

## Testing

Targeted vitest only. Do not run the full suite, `tsc --noEmit`, or a production build.

### `timeline-data` / `timeline-view-extent`

- `snapTimeMs`: 0; 50→100; 149→100; 150→200; negative→0
- `formatTime`: `0.0`, `1.5`, `90.5`; no `mm:ss`
- `pxToMs` / `clampCursorMs` are multiples of 100

### Timeline

- Empty-track / scrub lands on the 100ms grid
- Arrow +100ms; Shift +1000ms

### Properties / context bar

- Time inputs unit `s`, step 0.1
- Commits are multiples of 100 (replace the `atMs: 501` case)

### Readouts

- Content library / 节目管理 / sequence total use new `formatTime`

Do not test: control exec-card `00:01.5`, document migration, PLC payload shape, trapezoid accel two-decimal fields.
