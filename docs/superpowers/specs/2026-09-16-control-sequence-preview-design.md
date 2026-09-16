# Control Sequence Preview

Date: 2026-09-16

Operators on the control page need to see what an action sequence will do before pressing Ready / GO: the rough trajectory and total time, and the run itself played through. The preview is used constantly during rehearsal, so it must be one gesture, leave no stale state, never talk to the PLC, and never leave the viewport at a preview pose after exit.

## Goal

- **Preview trajectory and time**: for the chosen sequence, draw each member object's path in the 3D viewport and show the authored total duration.
- **Preview the run**: the scene objects themselves take the pose at `cursorMs`. Scrub or auto-play; closing preview restores live telemetry poses. No ghost clones.
- Two gestures on the same entry points, sharing one preview state:
  - **B — click**: click the F-slot card (except the fader and Ready/GO) or a program row → preview mode with a mini transport bar in the viewport. Click again or `Esc` to exit.
  - **C — long-press**: press and hold the F-slot card (except the fader and Ready/GO) ≥ 400ms → objects auto-play while held; release → preview cleared.
- Local evaluation only (`resolveActionSequence` + `evaluateResolvedSequence`). No PLC download, no Ready, no GO.

## Non-goals

- Previewing on the action (sequences) page (it already scrubs real meshes via the timeline).
- Previewing more than one sequence at a time.
- Moving hardware, writing telemetry, or talking to the PLC. Viewport meshes may take the preview pose and must restore on exit.
- Motor-level trajectory (drive axes); preview is virtual-axis (v1/v2/v3) only.
- Collision or limit checking during preview.
- A dedicated 预览 tab in the right sidebar.
- Hover-to-preview.
- Changing Ready / GO, fader paging, active-task cards, or the program list.

## Locked decisions

| Topic | Decision |
|---|---|
| Entry points | F slot **card** except fader and Ready/GO (`fader-slot.tsx` overlay) and control **program row** (`ProgramSequenceRow` via `ChapterItemRow`). |
| Click (B) | Toggles preview for that sequence. Clicking a different entry switches the previewed sequence. |
| Long-press (C) | ≥ 400ms on the F-slot overlay. Starts preview with `isPlaying: true`, `holdMode: true`. `pointerup` / `pointercancel` / `pointerleave` → `stopPreview()`. Pointer movement > 8px before the timer fires cancels the long-press (so drag-to-assign keeps working). |
| Program row long-press | Not required this phase (rows already use click). |
| Ghost rendering | None. Preview does not use `GoShadow`. GO shadows stay `secondary`. |
| Viewport motion | Member meshes take `evaluateResolvedSequence(resolved, cursorMs)` via `applyVirtualAxisPose`. Telemetry skips those ids while previewing. Exit restores live `snapshots.positions` (or v1/v2/v3 = 0 if none). |
| Trajectory rendering | Opaque cyan GreasedLine, screen-space **7px** (`sizeAttenuation`), `isPickable = false`, drawn in rendering group 1 so it sits above meshes. Not `CreateLines` (1px, looks washed-out). |
| Sampling | Every **100ms** from 0 to `totalMs`, plus every segment `startMs` / `endMs`. Positions from `resolveVirtualAxisTransform(config, pose).position`. |
| Labels | Member axis labels follow `cursorMs` during preview; others stay on telemetry. |
| Non-members | Stay opaque during control preview. Do not dim. Stay at live telemetry pose. |
| Transport bar | Bottom of the viewport, inside `ViewportOverlay`, only when `activeNav === "control"` and a preview is active. Height 32px, `bg-card/90`. Content: ▶/⏸/↺, range slider (step 100ms), `mm:ss.s / mm:ss.s`, speed chips `1× 2× 4×`, `×` close. When paused at `cursorMs >= totalMs`, the play control is a replay icon (`重新播放`); `play()` rewinds to 0 then starts. |
| Time display | Authored time (`cursorMs / totalMs`) using `formatExecTime` (`00:05.2 / 00:12.3`). |
| Playback speed | `advance = dt × (faderPercent / 100) × multiplier`. `faderPercent` = slot fader value when preview started from an F slot, else 100. `multiplier` from chips (1/2/4), default 1. |
| End of playback | Click-mode: stop at `totalMs` and leave members at the end pose until exit. Play at end rewinds to 0. Hold-mode: loop back to 0 while held. |
| Keyboard (click-mode) | `Space` play/pause, `Esc` exit, `←`/`→` ±100ms, `Home`/`End`. Only when focus is not in an input. |
| Auto-exit | On GO launch (any slot), on leaving the control nav, on project change, on the previewed sequence being removed or becoming invalid. |
| Ready / GO while previewing | Allowed; GO auto-exits preview. Ready does not. |
| Invalid / empty sequence | Do not enter preview; `toast.warning(issue.message)` from `getMotionItemRepairIssue`. |
| Show mode | Preview available (it is read-only). Long-press works on touch. |
| Visual state on entry points | Previewed F slot name gets `text-primary` + `aria-pressed="true"`; previewed program row gets `aria-selected="true"` (existing treeitem highlight). |

## Architecture

```
FaderSlot name / ProgramSequenceRow
   click ──────────► startPreview(id, { faderPercent })   toggle
   long-press ─────► startPreview(id, { faderPercent, autoplay: true, holdMode: true })
   release ────────► stopPreview()
                          │
                          ▼
              SequencePreviewProvider (control-page state)
              { sequenceId, cursorMs, isPlaying, holdMode, faderPercent, multiplier }
                          │ rAF tick while isPlaying
                          ▼
   ┌──────────────────────┴──────────────────────┐
   ▼                                             ▼
Viz3DSequencePreviewSync                 SequencePreviewBar (ViewportOverlay)
 resolveActionSequence(seq)               ▶ ┃━━●━━┃ 00:05.2 / 00:12.3  1× 2× 4×  ×
 sampleSequencePaths(...)
 evaluateResolvedSequence(resolved, cursorMs)
 engine.setSequencePreview({ paths })
 engine.applyVirtualAxisPose(id, pose)   // members only
```

`Viz3DGoShadowSync` and `Viz3DActionPreviewSync` are untouched. Control preview does not dim non-members. `Viz3DTelemetrySync` skips preview members; `Viz3DVirtualAxisLabelSync` shows cursor poses for those members.

## Components

### `sequence-preview.ts` (pure, `src/app/pages/console/hooks/`)

- `sampleSequencePaths(resolved, stepMs = 100): Map<number, { atMs: number; pose: ModelPose }[]>` — sorted unique sample times per object (`0…totalMs` at `stepMs`, plus segment boundaries), poses via `evaluateResolvedSequence`.
- `previewPosesAt(resolved, cursorMs): Map<number, ModelPose>` — one pose per member at the cursor (`evaluateResolvedSequence`).
- `memberObjectIds(resolved): number[]` — keys of `posesByObject`.
- `advancePreviewCursor(cursorMs, dtMs, faderPercent, multiplier, totalMs, loop): { cursorMs; ended }`.

### `SequencePreviewProvider` (`src/app/pages/console/hooks/sequence-preview-provider.tsx`)

State: `sequenceId | null`, `cursorMs`, `isPlaying`, `holdMode`, `faderPercent`, `multiplier`.

API: `startPreview(sequenceId, { faderPercent?, autoplay?, holdMode? })`, `togglePreview(sequenceId, opts)` (same id → stop), `stopPreview()`, `setCursorMs(ms)`, `play()`, `pause()`, `setMultiplier(1|2|4)`.

Ticker: `requestAnimationFrame` loop while `isPlaying`, calling `advancePreviewCursor`. Needs `totalMs`; the provider resolves it from `currentProject.document.motion.actionSequences` and keeps `resolved` in a ref so the sync and the bar share one resolution.

Auto-exit: effect on `activeNav !== "control"`, on `currentProject?.id` change, on the sequence disappearing.

### Engine: `SequencePreviewController` (`src/app/viz3d/state/`)

- `set({ paths: { objectId: string; poses: VirtualAxisValues[] }[] })`
- `clear()`; `dispose()`.
- Paths: `MeshBuilder.CreateLines` (updatable, `instance` reuse when point count is unchanged). No ghosts.
- Engine methods: `setSequencePreview(entries)`, `clearSequencePreview()`; disposed with the scene like `goShadowController`.
- Pure helper `previewPathPoints(config, poses): Vec3[]` in `src/app/viz3d/state/preview-path-points.ts` for unit tests (no Babylon).

### `Viz3DSequencePreviewSync` (`src/app/pages/console/3d/`)

- Reads preview state + `useProjectStore().objects` (scene object configs).
- If `activeNav !== "control"` or no `sequenceId` → `engine.clearSequencePreview()` and restore live poses for previously previewed members.
- Otherwise compute paths once per `resolved` (memo), apply `previewPosesAt` per `cursorMs` via `applyVirtualAxisPose`, call `engine.setSequencePreview({ paths })`.
- Unmount → clear paths and restore live poses.

### `SequencePreviewBar` (`src/app/pages/console/3d/overlays/sequence-preview-bar.tsx`)

- Rendered by `ViewportOverlay` when `isControl && preview.sequenceId !== null && !preview.holdMode`.
- `role="toolbar" aria-label="序列预览"`. Slider `aria-label="预览进度"`, play button `aria-label` `播放` / `暂停` / `重新播放` (paused at end), close `aria-label="退出预览"`, speed chips `aria-pressed`.
- Keyboard handler on `window` while mounted.

### Entry points

- `FaderSlot`: new props `isPreviewing`, `onPreviewToggle()`, `onPreviewHoldStart()`, `onPreviewHoldEnd()`. A full-card overlay `<button type="button" aria-label="预览 {name}" aria-pressed>` sits behind the fader and Ready/GO (`z-10`). Header/name are `pointer-events-none` so clicks hit the overlay. Disabled when empty or `repairMessage`.
- `Executors`: wires the above from `useSequencePreview()`; passes `faderPercent: slot.faderValue`.
- `ControlProgramPanel`: `onClickItem={(item) => togglePreview(item.sequence.id)}`; `ChapterItemRow` gets `isActive` from the preview id.
- `ExecArea.handleTriggerSequence`: after a successful GO `launch`, call `stopPreview()`.

## Data flow

1. Click F2 name → `togglePreview(15, { faderPercent: 150 })` → state `{ sequenceId: 15, cursorMs: 0, isPlaying: false }`.
2. Sync samples paths and applies start poses to member meshes. Other objects stay at telemetry. Bar appears: `00:00.0 / 00:12.3`.
3. Drag slider to 5200 → `setCursorMs(5200)` → member meshes take that pose; labels follow.
4. Press ▶ → rAF advances `cursorMs` by `dt × 1.5 × 1`; at `totalMs` → `isPlaying: false`, members stay at the end pose.
5. Press GO on F2 → `launch(...)`, then `stopPreview()` → paths cleared, members restore to telemetry.
6. Long-press F3 name → `startPreview(16, { autoplay: true, holdMode: true, faderPercent: 100 })`; members loop; release → restore. No bar in hold mode.

## Error handling

| Case | Behavior |
|---|---|
| Empty slot / repair issue | Name button disabled; long-press ignored |
| Sequence resolve throws | `toast.warning("动作序列无法预览")`, no preview state |
| Member object missing from scene | Skip that object's path/pose; others still render |
| Long-press then drag > 8px | Cancel timer; normal drag-assign |
| Nav leaves control | `stopPreview()` and engine clear |
| GO on any slot | `stopPreview()` |
| Sequence edited on action page while previewing | Not possible on the same nav; nav change already exits |

## Testing

Targeted vitest only. No GUI / screen tests, no full suite, no `tsc --noEmit`, no production build.

- `sequence-preview.spec.ts`: sample count/uniqueness, segment boundary inclusion, `previewPosesAt` one pose per member, `advancePreviewCursor` speed and end/loop.
- `sequence-preview-provider.spec.tsx`: toggle on/off, switch id, hold-mode autoplay + release clears, multiplier, auto-exit on nav change (mock `useConsoleNav`).
- `preview-path-points.spec.ts`: v1 lift maps to y, direction 2 inverts.
- `fader-slot` in `exec-area.test.tsx`: overlay `aria-pressed`, click calls `onPreviewToggle`, long-press timers call hold start/end, disabled when repair; Ready and fader do not toggle.
- `sequence-preview-bar.spec.tsx`: renders times, play toggles label, paused-at-end is `重新播放`, Esc calls stop, close calls stop.
- `sequence-preview-provider.spec.tsx`: `play()` at end rewinds to 0.
- `exec-area.test.tsx`: GO success calls `stopPreview`.

## Out of range

Action-page timeline, GO shadows, PLC transport, active-task card, monitor grid, drive-axis kinematics.
