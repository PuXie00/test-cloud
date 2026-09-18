# Preset owned virtual axes

Date: 2026-09-18

## Problem

Every action-builder preset currently appends generic `v2` / `v3` fields labeled 「摆动 X」 / 「摆动 Y」. Resolve writes those values onto every generated pose, so a v1-only algorithm (slope, wave, level, …) overwrites swing/yaw that the preset does not own.

`v3` is not always swing Y: object control type maps it to 摆动 Y or 偏转 via `getVirtualAxisMeta` / `virtualAxisDescriptor`.

## Decision

Approach A: each preset declares the virtual axes its algorithm owns. The form and resolver only author those axes. Unowned axes are filled from the object's latest timeline pose strictly before the generated point's time; if none, `0`.

Not in scope: hardware GO, control-page sequence preview, changing `ModelPose` to a partial type, new presets that own `v2`/`v3` (the declaration exists so they can be added later).

## Owned axes

`PresetDefinition` gains:

```ts
ownedAxes: readonly VirtualAxisId[];
```

Current presets:

| id | ownedAxes |
|---|---|
| static-flat, static-slope, static-arc, static-wave, dynamic-level, dynamic-wave | `["v1"]` |

`paramFields` must only describe parameters for owned-axis algorithms (plus non-axis params such as `cycles`, `sampleIntervalMs`). Remove shared `AXIS_FIELDS`.

If a future preset owns `v3`, field labels/units come from `getVirtualAxisMeta(axis, controlType)` of the relevant object, never hardcoded 「摆动 Y」.

## Resolve and carry

1. `resolvePreset` writes owned axes only. Unowned axes on the returned `ModelPose` may be `0` placeholders; they are not semantically authored.
2. `resolveActionSequence` after collecting and sorting all timed poses, for each preset-generated point, copies unowned axes from that object's latest pose with `atMs` **strictly less than** the point's `atMs`. No earlier pose → `0`.
3. Dynamic presets: every sample for an object (start, interior, end) uses the same carry as the first sample (value from before `startMs`). Walking points in time and copying unowned axes from the previous point of the same object is sufficient, because the first sample is filled from an authored pose (or 0) and later samples inherit that hold.
4. Same-time points: carry only from strictly earlier `atMs`, not from another block at the same millisecond.
5. `ModelPose` stays `{ v1, v2, v3 }`.

## Persistence

Existing documents may still have `v2` / `v3` in preset `params`. Validation must not require them and must not fail on leftover `v2`/`v3` keys. `fitPresetParams` must not write `v2`/`v3`.

## Dynamic motion profiles

`MotionProfileEditor` axis context is `ownedAxes ∩ object.enabledAxes`. Unowned axes have zero travel after carry-hold; they must not appear as curve fields. Segment interpolation still uses full poses.

## UI

`PresetBlockFields` already maps `definition.paramFields`; dropping `AXIS_FIELDS` removes the generic swing form. No extra UI flag.

## Tests

- Registry: current presets' `paramFields` have no `v2`/`v3`; `ownedAxes` is `["v1"]`.
- Resolve: authored pose `{ v2: 10, v3: 5 }` before a slope at a later time → generated slope poses keep `v2: 10`, `v3: 5` and only change `v1`.
- Resolve: no prior pose → generated `v2`/`v3` are `0`.
- Dynamic preset: interior samples hold the pre-`startMs` swing, not 0 and not a new swing from params.
- `fitPresetParams` output has no `v2`/`v3`.
- Leftover `params.v2` on disk still resolves.
- Preset properties panel does not render 「摆动 X」 / 「摆动 Y」.

## Non-goals

- Do not reuse control-page `SequencePreviewProvider`.
- Do not send PLC from the action editor.
- Do not loop playback with the sequence loop switch (unrelated).
