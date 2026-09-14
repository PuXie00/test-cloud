# Sequence Editor: Multi-Select Pose Edit

Date: 2026-09-14

The sequence timeline already supports multi-block selection (marquee, copy, delete, group shift). The right properties panel only shows「已选 N 项」and does not edit pose axes. This spec adds batch pose-axis editing for an all-pose multi-selection.

## Goal

- When every selected timeline block is a pose, the right panel shows a multi-pose editor: absolute / relative axis writes.
- Displayed axes are the **union** of each selected object's `enabledAxes`. A write applies only to objects that have that axis.
- Absolute sets the same axis value on those poses. Relative adds the same delta. Per-object `rangeByAxis` clamps each write.
- Multi-select does **not** edit `atMs`.
- Single-select pose editor shows only that object's `enabledAxes` (today it always draws v1/v2/v3).

## Non-goals

- Editing time on a multi-selection (absolute align or relative shift).
- Batch-editing instruction or preset blocks.
- Showing pose-axis controls on the context bar for multi-select.
- Changing marquee / Shift-select, copy, delete, or group drag.
- Changing Cue pose editing.

## Locked decisions

| Topic | Decision |
|---|---|
| Mixed selection (pose + other kinds) | No pose editor; keep「已选 N 项」 |
| Pose write modes | Absolute (same value) and relative (shared delta) |
| Time | Not editable in multi-select |
| UI surface | Right panel only |
| Axis set | Union of `enabledAxes` |
| Write filter | Skip objects that do not have that axis |
| Empty / missing `enabledAxes` | Treat as all three axes (`v1`, `v2`, `v3`) |
| Approach | New multi-pose editor + one batch write API; do not fan-out `onReplaceBlock` |

## Architecture

```
multi-block selection
        │
        ▼
lookup: every block kind === "pose"?
   no  →  「已选 N 项」
   yes →  MultiPoseAxesEditor
              │
              ├─ unionAxes(enabledAxes)
              ├─ abs: shared value or empty / —
              └─ rel: draft starts at 0
                    │
                    ▼
           applyPoseAxisWrite(sequence, ids, { mode, axis, value })
                    │
                    ├─ skip non-pose ids
                    ├─ skip objects without axis
                    ├─ abs: pose[axis] = clamp(value)
                    └─ rel: pose[axis] = clamp(pose[axis] + value)
                    ▼
           one updateSelectedSequence
```

`applyPoseAxisWrite` is a pure sequence edit (same family as `replaceTimelineBlock`). It does not change `atMs`, so this path cannot stack two poses of the same object onto one time. Existing motion-overlap rules stay on move / replace-time / resize only.

## Components

### Right panel

- All-pose multi-select: title「多选位姿」, subtitle「已选 N 项」, absolute / relative tabs (same chrome as single-select `PoseAxesEditor`).
- Render `unionAxes` only. No time field.
- Absolute: if every writable pose shares the same value on that axis, show it; otherwise empty /「—」.
- Relative: drafts start at 0; after commit, that axis draft returns to 0.
- Unit: if every selected object that has the axis agrees on the canonical unit, show it; otherwise omit the unit.
- Absolute input min/max: intersection of those objects' `rangeByAxis[axis]`. If the intersection is empty, leave min/max unset on the input; still clamp per object on write.
- Delete remains the existing multi-select delete.

### Single-select pose

- `PoseAxesEditor` lists only `enabledAxes` (or all three when empty / missing).
- Absolute / relative behavior unchanged.

### Context bar

- Multi-block selection does not gain pose-axis cells.

### Batch write

- Context (or panel callback) calls `applyPoseAxisWrite` once per committed axis change.
- Do not loop `onReplaceBlock` / `replaceTimelineBlock` per id.

## Data flow

1. Marquee or Shift-select → `selection.kind === "multi-block"`.
2. `lookupSequenceSelection` returns those blocks.
3. If any block is not `pose`, render the existing multi-select empty copy.
4. Editor computes `unionAxes` from `getTimelineObject(block.objectId)?.enabledAxes`.
5. User commits one axis → `{ mode: "abs" \| "rel", axis, value }`.
6. `applyPoseAxisWrite` updates the selected sequence in one persist.

## Error handling

| Case | Behavior |
|---|---|
| Mixed kinds | No editor, no write |
| Object lacks the axis | Skip that block; others still write |
| Value outside that object's range | Clamp that block only |
| Relative commit of 0 / absolute equal to current | No persist |
| `enabledAxes` empty or missing | Object participates in all three axes |
| Overlap from this edit | Does not occur (time is unchanged) |

## Testing

Targeted vitest only. Do not run the full suite, `tsc --noEmit`, or a production build.

Add / update:

- `applyPoseAxisWrite`: absolute, relative, skip missing axis, per-object clamp, `atMs` unchanged, ignore non-pose ids
- `SequencePropertiesPanel`: all-pose shows the editor; mixed selection stays「已选 N 项」; union axes; absolute mixed value empty; relative draft resets
- Single-select pose: only `enabledAxes` inputs

Do not change Cue editor or context-bar multi-select tests except where single-select axis filtering would otherwise fail.
