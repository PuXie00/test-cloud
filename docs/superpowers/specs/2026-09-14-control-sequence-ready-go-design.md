# Control Fader: Sequence Ready before GO

Date: 2026-09-14

Control-page fader GO currently validates, compiles, downloads (`actionDataSave`), and starts (`actionSyncCall`) in one click via `startLocalAuthoredSequence`. This spec splits that into Ready then GO on the same fader-slot button, with per-slot phase. 3D object GoReady (`idle` / `armed` / `moving`) is a different product (move-to-target) and is not reused.

## Goal

- On a filled, healthy control fader slot, the primary button is **Ready** first: validate + compile + `actionDataSave` (existing `downloadSequence`).
- After that slot succeeds, the **same button** becomes **GO**: only `actionSyncCall` / `actionSyncCallPlc`, using the **current** fader `speedScale`.
- Ready state is **per slot**, not global.
- Control program-tree double-click no longer starts a sequence.

## Non-goals

- Changing Cue authoring, sequence timeline authoring, or action-page 节目管理 Play.
- Reusing or extending 3D `GoReadyProvider`.
- Changing `startLocalAuthoredSequence` as used by action-builder right-panel Play (still one-shot save + sync).
- Persisting Ready into the program document.
- A second button, a global Ready, or Ready on the program tree.
- Locking fader speed at Ready time.
- New error channels (modals, banners). Keep existing toasts.

## Locked decisions

| Topic | Decision |
|---|---|
| Ready does | Validation + compile + `actionDataSave` (`downloadSequence`) |
| GO does | Start only (`actionSyncCall` / `actionSyncCallPlc`) |
| UI surface | Control-page fader slots only |
| Button | Same primary button: Ready, then GO after success |
| Program double-click | Remove GO; drag-to-slot remains |
| Architecture | Split sequence-execution API + per-slot ready phase |
| 3D GoReady | Unrelated; do not mix |
| Action-builder Play | Out of scope; keep `startLocalAuthoredSequence` |

## Architecture

Two layers. No shared state with 3D GoReady.

### 1. Sequence execution API (`sequence-execution.ts`)

Split the chain now inside `startLocalAuthoredSequence`:

| Function | Responsibility |
|---|---|
| `readySequence(document, sequenceId)` | Validate + compile + `actionDataSave` (existing `downloadSequence`) |
| `goSequence(document, sequenceId, speedScale)` | `actionSyncCall` / `actionSyncCallPlc` only |

Failures return the existing toast-shaped results. Do not add a new error type.

`startLocalAuthoredSequence` stays for action-builder Play: save then sync, same outward behavior.

### 2. Slot phase (`use-executor-slots`)

Each fader slot:

`idle` → Ready success → `ready` → GO success → `running` → card stop / close / complete → `idle`

- Ready in flight: slot busy; button spins; ignore extra clicks.
- Ready failure: stay `idle` + toast.
- GO failure: stay `ready` + toast (same idea as 3D GO failure leaving armed).
- Leave `ready` for `idle` when that slot’s sequence identity or document fingerprint changes, or the slot is cleared.
- Fader speed changes do **not** invalidate Ready. GO reads current `faderValue` → `speedScale`.

```
FaderSlot click
    │
    ├─ phase idle  → readySequence  → ready | idle
    └─ phase ready → goSequence(current speedScale)
                          │
                          ├─ ok  → running + exec card
                          └─ err → stay ready
```

## Components

### `sequence-execution.ts`

- Add `readySequence` / `goSequence` as above.
- Keep `startLocalAuthoredSequence` for action-builder Play.

### `use-executor-slots.tsx`

- `FaderSlotState.phase`: `idle` \| `ready` \| `running` (replaces boolean `isRunning`).
- Expose `readySlot` / `goSlot` / `clearSlotReady` (names may match existing setters).
- Store the Ready fingerprint on the slot (sequence id + content fingerprint). Do not write this into the program document.

### `exec-area.tsx`

- Slot click branches on phase: `idle` → Ready (`resolveMotionLaunchBlock` then `readySequence`); `ready` → GO (`goSequence` then `launch`).
- Exec cards still appear only after GO success, `source: { kind: "fader", slotIndex }`.

### `fader-slot.tsx`

- One primary button.
- Empty / repair: disabled.
- `idle`: label Ready.
- Ready in flight: spinner, disabled.
- `ready`: label GO.
- `running`: keep current show styling; click is a no-op (stop stays on the exec card).

### Control `program-panel.tsx`

- Remove `handleDoubleClickItem` launch (`startLocalAuthoredSequence` + `launch`).
- Double-click does not GO. Drag onto a fader slot is unchanged.

### Exec card empty copy

- `exec-empty-state.tsx`: drop “双击节目结构中的动作序列”. Trigger copy is fader slots only.

Slot phase does not appear on the program tree or on exec cards.

## Data flow

Slot phase lives only in `use-executor-slots`.

### Ready (`idle` → `ready`)

1. User clicks the slot button.
2. `exec-area` runs existing `resolveMotionLaunchBlock`.
3. Slot marked busy; button spins.
4. `readySequence(document, sequenceId)` → validate + compile + `actionDataSave`.
5. Success: that slot `phase = ready`; remember `sequenceId` + content fingerprint.
6. Failure: slot back to `idle`, toast, no exec card.

### GO (`ready` → `running`)

1. User clicks the same button.
2. Read **current** `faderValue` → `speedScale`.
3. `goSequence` → `syncCall` only.
4. Success: `phase = running`; `launch` exec card (`source: { kind: "fader", slotIndex }`).
5. Failure: stay `ready`, toast, no card.

### Invalidate (`ready` → `idle`)

Silent (no toast):

- Slot assigned a different sequence (drag, clear, page change that changes slot contents)
- Document sequence content fingerprint no longer matches what was readied
- Ready request fails, or a newer Ready for that slot replaces it

Fader speed changes do not invalidate.

### End (`running` → `idle`)

When the exec card for that fader `slotIndex` stops, closes, or completes, the slot returns to `idle`. Wire `running` to that card lifecycle (`isRunning` is unused in production today).

### Program double-click

Control `onDoubleClickItem` is not on this chain.

## Error handling

Reuse existing toasts. No modal.

| Case | Behavior |
|---|---|
| Empty slot / `repairMessage` | Button disabled |
| Ready front door `resolveMotionLaunchBlock` | `toast.warning`; slot stays `idle` |
| Missing sequence / validation / compile / `actionDataSave` fail | `readySequence` fails; warning or error toast (keep copy such as 「动作序列不可用，待修复」「校验失败，无法下载」「启动失败」); slot idle |
| Click during Ready busy | Ignored; button disabled |
| GO `syncCall` fail | `toast.error`; slot **stays `ready`**; no exec card |
| Sequence swap / fingerprint change | Silent return to `idle` |
| Click while `running` | No-op; stop is the exec card |
| Slot A Ready fails | Slot B `ready` unchanged |

## Testing

Targeted vitest only. Do not run the full suite, `tsc --noEmit`, or a production build.

### `sequence-execution.spec.ts`

- `readySequence`: success calls `saveAction` only, not `syncCall`
- `readySequence`: validation failure does not save
- `goSequence`: `syncCall` only, current `speedScale`, no save
- Keep existing `startLocalAuthoredSequence` save-then-sync cases (action-builder Play)

### `use-executor-slots` / `exec-area.test.tsx`

- Empty / repair: button disabled (neither Ready nor GO)
- Healthy slot first click: Ready; no `launch`; no `syncCall`
- After Ready, second click: GO + `launch`; `syncCall` uses fader value **at click**
- Ready failure: stay `idle`, toast, no `launch`
- GO failure: stay `ready`, no `launch`
- Sequence swap / fingerprint change: `ready` → `idle`
- Fader speed change does not leave Ready
- Slot phases are independent

### Control program panel

- Double-click does not call `startLocalAuthoredSequence` / `launch`
- Exec empty-state copy no longer mentions program double-click

Do not test: action-builder Play, 3D `GoReadyProvider`, live PLC, or browser E2E.
