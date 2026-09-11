# Action Data Save — Polynomial Curve Segments

Date: 2026-09-11

Replace sampled-point `actionDataSave` with the PLC curve-segment protocol (`0x1016`). Console assigns `actionId` from the sequence `id`. Preview sampling is unchanged.

## Goal

`Config|actionDataSave` must send one action as:

- `actionId` (uint16) = `ActionSequenceConfig.id` (already 1–65535)
- `totalDuration` (uint32, ms)
- `timelineCount` + nested timelines of polynomial segments
- `eventCount` + nested enable/disable events

Address changes from `0x104A` to `0x1016`. Electron main does not compute trajectories.

## Non-goals

- 3D / `evaluate-sequence` sampling
- Trapezoid editor UI
- `actionPrepare` / `actionSyncCall` / `stopAction` wire shapes
- Per-`errorCode` UI; codes are only included in the thrown error message

## Architecture

```
ActionSequenceConfig.id  →  actionId
        │
        ▼
validate → resolve → compilePlcAction
                        ├─ trapezoidToCurveSegments
                        └─ instruction blocks → eventList
        │
        ▼
toActionDataSaveItems → actionDataSavePlc (addr 0x1016)
        │
        ▼
ACK: success && errorCount === 0
```

`trajectoryMode` stays on the sequence for sync-call; it is not in the save payload. `checksum` and `sampleIntervalMs` are removed from PLC compile.

## Components

### `trapezoidToCurveSegments`

Pure function next to existing motion-profile kinematics.

**Input:** axis `MotionProfile`, segment `startMs`, start position, end position, `durationMs`.

**Output:** `{ startTime, position, a, b, c, d, e, f }[]` with `d = e = f = 0` always.

`travel = end − start`. `sign = Math.sign(travel)` (`0` when idle). Magnitude of acceleration, cruise velocity, and deceleration come from `calculateMotionProfileKinematics`; then multiply by `sign`.

| Case | Count | Encoding |
|---|---|---|
| Idle profile or `travel === 0` | 1 | `startTime = startMs`, `position = start`, all coefficients 0 |
| Moving trapezoid | 3 | Accel / cruise / decel rows below |
| Triangle (cruise duration 0) | 3 | Same as trapezoid; cruise `b = 0` and cruise `startTime` equals decel `startTime` |

Moving rows:

1. Accel: `startTime = startMs`, `position = start`, `a = signed acceleration`, `b..f = 0`
2. Cruise: `startTime = startMs + accelMs`, `position` = pose at accel end, `b = signed peak velocity` (0 if triangle), other coefficients 0
3. Decel: `startTime = startMs + accelMs + cruiseMs`, `position` = pose at cruise end, `c = signed deceleration`, other coefficients 0

Phase end positions use `evaluateMotionProfile` at the accel-end and decel-start ratios, mapped through `start + progress * travel`.

### `compilePlcAction`

For each object in the resolved sequence, for each **enabled** virtual axis:

- Concatenate `trapezoidToCurveSegments` over that object's motion segments in time order.
- Idle / zero-travel still emits the 1-row hold so the axis has a timeline.
- If the object has no motion segments on that axis, emit one hold row: `startTime` = first pose time, `position` = that pose's axis value, coefficients 0.
- Disabled axes emit no timeline.
- `virtualAxisNo`: `v1 → 1`, `v2 → 2`, `v3 → 3`.
- If `segmentCount > 100` on any timeline, throw (treated as validation failure by download).
- `PlcCompileContext` drops `sampleIntervalMs`.

Instruction blocks (`set-enabled`) compile to events:

- `modelId` = object id
- `atTime` = `atMs`
- `enableFlag` = `1` if enabled, `0` if not

Compiled action shape matches the wire item except `actionId` / counts, which `toActionDataSaveItems` fills.

### Wire item

```
{
  actionId,
  totalDuration,
  timelineCount,
  timelineList: [{
    modelId,
    virtualAxisNo,
    segmentCount,
    segmentList: [{ startTime, position, a, b, c, d, e, f }]
  }],
  eventCount,
  eventList: [{ modelId, atTime, enableFlag }]
}
```

`toActionDataSaveItems(compiled, sequence.id)` sets `actionId` and the two counts. Send as a one-element array, same as today.

`actionDataSavePlc` uses `Config|actionDataSave` and addr `0x1016`.

## Data flow

`actionNo` is removed. It was the old PLC-assigned save ACK id. The new protocol only has `actionId` (= `sequence.id`).

1. Validate; blocking issues → do not send.
2. Resolve + compile.
3. Save via csocket with `actionId`.
4. On success, `syncCall` as today (`syncGroupId` etc.). Do not send `actionNo`.
5. Runtime handle is `{ actionId, syncGroupId }`. Stop still maps `actionId` → `deviceId` in the existing adapter until `stopAction` wire is updated (out of scope).

Local transport does not call the network and treats save as success.

`DownloadedSequence` drops `actionNo` and `checksum`; success result is `{ ok: true, actionId, sequenceId, modelIds }` with `actionId === sequenceId === sequence.id`.

## Error handling

| Stage | Behavior |
|---|---|
| Validation / compile throw / `segmentCount > 100` | `downloadSequence` returns `{ ok: false, reason: "validation" }` |
| Socket failure or ACK `success === false` | throw → start toast "动作序列启动失败" |
| ACK `data[0].errorCount > 0` | same as ACK failure; include `data[0]` `errorCode` list in the Error message |
| Successful ACK with missing `errorCount` | treat as `0` |

Do not parse `actionNo` from ACK. Console already knows `actionId`.

## Testing

Targeted vitest only.

- `trapezoidToCurveSegments`: forward 3-row; reverse signs; triangle cruise `b = 0` and shared startTime; idle 1-row zeros; `d/e/f = 0`; positions continuous at phase boundaries.
- `compilePlcAction` / `toActionDataSaveItems`: `virtualAxisNo` 1/2/3; disabled axis omitted; events use `enableFlag`; `actionId = sequence.id`; no `checksum` / `timeArray`; >100 segments throws.
- `sequence-execution`: save payload uses `actionId`; types/handle have no `actionNo`; `errorCount > 0` fails; local transport does not touch `window.csocketApi`.

Leave preview and motion-profile editor tests alone. Rename `sequenceHandle.actionNo` → `actionId` in exec-area tests that would not compile.
