# Control Active-Task Sequence Run Status

Date: 2026-09-15

Control-page 「活跃任务」 already shows a sequence card after GO, but C++-timed cards only display wall-clock time and 「C++ 运行中」. Operators need run status on that card: elapsed / total duration, loop count, and speed ratio. PLC will later return a list of running sequences; this phase ships the card chrome and local button states with a hardcoded fixture.

## Goal

- Restyle the existing active-task sequence card (`ExecCardView`) on the control exec strip.
- Show **运行时间** as `elapsed / total` (not a separate remaining-time field).
- Show **循环次数**.
- **当前速度比例** is the existing speed slider (value + − / +), not a second numeric tile.
- Buttons:
  - Running: **重新** disabled, **停止** enabled, **跳过** icon-only disabled.
  - Stopped: **重新** enabled, **继续** enabled, **跳过** icon-only enabled when the current chapter has a next sequence.
- Empty list stays 「暂无活跃任务」. Cards still appear only after GO (approach 1).

## Non-goals

- Wiring 停止 / 继续 / 重新 / 跳过 to PLC (`stopAction`, resume, restart, launch next).
- Consuming a live PLC run-status poll (fixture only).
- Changing Ready / GO, 8-slot faders, 100ms grid, program chapter editing, or capture 「保存当前位姿」.
- Showing remaining time, a progress bar, or 「C++ 运行中」.
- A Pause label or a 「下一个」 text button.
- Seeding a demo card when there is no GO task.

## Locked decisions

| Topic | Decision |
|---|---|
| Surface | Existing left-column 活跃任务 card, not faders or a new panel |
| Layout | B: two stats (运行时间, 循环次数) + speed slider; no remaining tile |
| 运行时间 | `elapsed / total`, e.g. `00:12.3 / 01:00.0` |
| Speed | Slider is the speed ratio; do not duplicate a 速度比例 stat cell |
| 跳过 | Always icon-only, no text. Means next sequence in the **current chapter** (program / fader order) |
| 跳过 enable | Disabled while running. When stopped, enabled only if a next chapter item exists |
| 重新 vs 继续 | 继续 = resume from stop position; 重新 = current sequence from the start. UI-only this phase |
| No 暂停 | Running shows 停止, not 暂停 |
| PLC this phase | None for those buttons. Slider may move locally and does not write PLC |
| Numbers this phase | Hardcoded fixture shaped like the future PLC list |
| Future PLC list | Array of running sequences: `{ sequenceId, elapsed, loop, remaining, speedPercent, status }` plus display total (`elapsed + remaining` or a dedicated total once the wire is known) |
| Id mismatch | This phase still paint the fixture onto the GO card even if `sequenceId` does not match |
| Progress / C++ copy | Remove progress bar and 「C++ 运行中」 |

## Architecture

```
GO launch (unchanged)
        │
        ▼
ExecCard (one per launched sequence)
        │
        ▼
display layer reads fixture ──► later: PLC running-sequence list
        │
        ▼
stats + slider + local running | stopped buttons
```

Keep `ExecCardsProvider` / `launch` after GO. Add a small fixture module matching the PLC list item. The card view reads display fields from that fixture (this phase) instead of treating local `elapsedMs` as the visible truth.

Local button clicks only flip `running` ↔ `stopped` on the card. They do not call `stopSequence` / `syncCall` in this phase.

## Components

### Fixture

One exported constant, array of one item, same keys the PLC list is expected to use:

- `sequenceId`
- `elapsedMs`
- `totalMs` (for `运行时间 / 总时长`; not shown as remaining)
- `loopCount`
- `speedPercent`
- `status`: `"running"` | `"stopped"`

Example values used in UI and tests: elapsed `12300`, total `60000` → `00:12.3 / 01:00.0`, loop `1`, speed `100%`.

`remaining` may exist on the type for later PLC mapping but **must not** render.

### ExecCardView

- Title row stays (name, Seq, source F-slot).
- Stats row: 运行时间 (`formatTime(elapsed) / formatTime(total)`), 循环次数.
- Speed row: minus, range 0–200, plus, `n%`. Changing it updates local display only.
- Actions:
  - Running: 重新 (disabled), 停止, skip icon (disabled, `aria-label="跳过"`).
  - Stopped: 重新, 继续, skip icon (`aria-label="跳过"`), skip `disabled` if no next chapter sequence.
- No Pause, no 「下一个」 label, no progress bar, no 「C++ 运行中」, no 「剩 …」.

`hasNextSequence` comes from the current chapter: after the card’s `sequenceId`, is there a later `{ kind: "sequence" }` item? If the id is not in the chapter, skip stays disabled.

### ExecCards / use-exec-cards

- Stop / continue / restart / skip handlers this phase: set local `status` only (`stopped` or `running`). Do not remove the card on 停止 (today `stop` unmounts the card; that must change so 继续 / 重新 / 跳过 remain visible).
- 停止 does not call `stopSequence`. 继续 does not call GO. 重新 does not re-download. 跳过 does not launch the next fader.
- Auto-remove completed cards after 3s stays for `completed` if that status still exists; 停住 is not `completed`.

## Data flow

1. User Ready then GO on a fader (unchanged). A card is inserted.
2. Card paints fixture numbers (this phase).
3. 停止 → local `stopped` (card remains). 继续 → local `running`. 重新 → local `running` (numbers stay fixture). 跳过 → no-op besides remaining on the card; later it will target the next chapter sequence.
4. Later: replace fixture with PLC array; match `sequenceId` to the card; `status` from PLC drives the same button machine; remaining from PLC is ignored in the UI in favor of elapsed/total.

## Error handling

| Case | Behavior |
|---|---|
| No cards | 「暂无活跃任务」 |
| Fixture / PLC id mismatch | This phase still show fixture on the GO card |
| No next chapter sequence | Skip stays disabled in both states |
| 停止 / 继续 / 重新 / 跳过 | Local UI only; no PLC; no toast required |
| Empty program / no chapter | Skip disabled (no next item) |

## Testing

Targeted vitest only. No GUI / screen tests, no full suite, no `tsc --noEmit`, no production build.

- Render: `00:12.3 / 01:00.0`, loop `1`, no 「剩余」, no 「C++ 运行中」, no progress bar fill.
- Running: 重新 and skip (`aria-label="跳过"`) disabled; 停止 enabled; after click, 继续 is shown.
- Stopped: 重新 and 继续 enabled; skip still no accessible name other than 跳过; skip enabled if `hasNextSequence`, else disabled.
- Empty list: 「暂无活跃任务」.
- Do not test PLC payloads, real next-sequence launch, or resume-from-position hardware.

## Out of range

Ready/GO, fader paging, PLC `stopAction` / `actionSyncCall`, capture pose, action-page timeline.
