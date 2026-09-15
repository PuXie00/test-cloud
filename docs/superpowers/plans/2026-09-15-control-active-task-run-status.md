# Control Active-Task Run Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the control-page 活跃任务 sequence card: show fixture elapsed/total and loop count, keep the speed slider as speed ratio, and use local 停止 / 继续 / 重新 / icon-only 跳过 states with no PLC.

**Architecture:** Add a PLC-shaped fixture and `hasNextChapterSequence`. `ExecCardView` reads times/loops from the fixture and button enablement from card status + `hasNextSequence`. `stop` keeps the card (`stopped`); 继续 / 重新 only flip local status; 跳过 is a no-op this phase.

**Tech Stack:** React, TypeScript, Vitest, Testing Library. Targeted vitest only. No full suite, `tsc --noEmit`, production build, or GUI / screen testing.

**Spec:** `docs/superpowers/specs/2026-09-15-control-active-task-run-status-design.md`

## Global Constraints

- Surface is the existing left-column 活跃任务 card, not faders or a new panel.
- Layout B: 运行时间 as `elapsed / total` (e.g. `00:12.3 / 01:00.0`), 循环次数, speed slider only (no second 速度比例 tile, no remaining tile).
- 跳过 is always icon-only (`aria-label="跳过"`). Disabled while running. When stopped, enabled only if the current chapter has a later sequence after this card’s `sequenceId`.
- 继续 = resume from stop (UI). 重新 = current sequence from the start (UI). No 暂停. Running shows 停止.
- This phase: hardcoded fixture numbers; 停止 / 继续 / 重新 / 跳过 do not call PLC (`stopSequence`, GO, download).
- Do not show remaining time, a progress bar, or 「C++ 运行中」.
- Empty list stays 「暂无活跃任务」. Do not seed a demo card without GO.
- Do not change Ready/GO, 8-slot faders, 100ms grid, or capture 「保存当前位姿」.
- `docs/` is gitignored — `git add -f` for plan/spec files.
- Targeted vitest only: `npx vitest run <paths>`.

## File structure

| File | Role |
|---|---|
| `src/app/pages/console/hooks/sequence-run-status.ts` | Fixture type, example list, `formatExecTime`, `hasNextChapterSequence` |
| `src/app/pages/console/hooks/sequence-run-status.spec.ts` | Pure helper tests |
| `src/app/pages/console/components/exec-area/exec-cards/exec-card.tsx` | Restyled card |
| `src/app/pages/console/components/exec-area/exec-cards/exec-card.spec.tsx` | Card UI tests |
| `src/app/pages/console/components/exec-area/exec-cards/exec-cards.tsx` | Pass `hasNextSequence`; wire 重新 / 继续 / 停止 / 跳过 |
| `src/app/pages/console/hooks/use-exec-cards.tsx` | `stopped` status; stop keeps card; skip/restart local-only; `sequenceId` on launch |
| `src/app/pages/console/components/exec-area/exec-area.tsx` | Pass `sequenceId` into `launch` |
| `src/app/pages/console/components/action-builder/right-panel/program-panel.tsx` | Pass `sequenceId` into `launch` |
| `src/app/pages/console/components/exec-area/exec-area.test.tsx` | Drop C++ 运行中 assertions; rewrite skipNext PLC test |

---

### Task 1: Fixture and chapter-next helper

**Files:**
- Create: `src/app/pages/console/hooks/sequence-run-status.ts`
- Create: `src/app/pages/console/hooks/sequence-run-status.spec.ts`

**Interfaces:**
- Consumes: `ChapterItem` from `src/app/pages/console/components/program-panel/program-data.ts`
- Produces:
  - `export type SequenceRunStatusItem = { sequenceId: number; elapsedMs: number; totalMs: number; remainingMs: number; loopCount: number; speedPercent: number; status: "running" | "stopped" }`
  - `export const EXAMPLE_SEQUENCE_RUNTIME: readonly SequenceRunStatusItem[]`
  - `export const formatExecTime = (ms: number): string`
  - `export const hasNextChapterSequence = (items: readonly ChapterItem[], sequenceId: number): boolean`

- [ ] **Step 1: Write the failing test**

Create `sequence-run-status.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ChapterItem } from "../components/program-panel/program-data";
import {
  EXAMPLE_SEQUENCE_RUNTIME,
  formatExecTime,
  hasNextChapterSequence,
} from "./sequence-run-status";

const item = (id: number): ChapterItem => ({
  kind: "sequence",
  sequence: { id, name: `S${id}`, durationMs: 0 },
});

describe("sequence run status fixture", () => {
  it("exposes elapsed 12300, total 60000, loop 1", () => {
    expect(EXAMPLE_SEQUENCE_RUNTIME).toHaveLength(1);
    const row = EXAMPLE_SEQUENCE_RUNTIME[0]!;
    expect(row.elapsedMs).toBe(12300);
    expect(row.totalMs).toBe(60000);
    expect(row.loopCount).toBe(1);
    expect(row.speedPercent).toBe(100);
    expect(row.remainingMs).toBe(47700);
  });
});

describe("formatExecTime", () => {
  it("formats the fixture elapsed and total", () => {
    expect(formatExecTime(12300)).toBe("00:12.3");
    expect(formatExecTime(60000)).toBe("01:00.0");
  });
});

describe("hasNextChapterSequence", () => {
  it("is true when a later sequence exists after the id", () => {
    expect(hasNextChapterSequence([item(7), item(8), item(9)], 8)).toBe(true);
  });

  it("is false when the id is last, missing, or the list is empty", () => {
    expect(hasNextChapterSequence([item(7), item(8)], 8)).toBe(false);
    expect(hasNextChapterSequence([item(7)], 99)).toBe(false);
    expect(hasNextChapterSequence([], 7)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/pages/console/hooks/sequence-run-status.spec.ts`

Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `sequence-run-status.ts`:

```ts
import type { ChapterItem } from "../components/program-panel/program-data";

export type SequenceRunStatusItem = {
  sequenceId: number;
  elapsedMs: number;
  totalMs: number;
  remainingMs: number;
  loopCount: number;
  speedPercent: number;
  status: "running" | "stopped";
};

export const EXAMPLE_SEQUENCE_RUNTIME: readonly SequenceRunStatusItem[] = [
  {
    sequenceId: 1,
    elapsedMs: 12300,
    totalMs: 60000,
    remainingMs: 47700,
    loopCount: 1,
    speedPercent: 100,
    status: "running",
  },
];

export const formatExecTime = (ms: number): string => {
  const totalSeconds = ms / 1000;
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const s = (totalSeconds % 60).toFixed(1).padStart(4, "0");
  return `${m}:${s}`;
};

export const hasNextChapterSequence = (
  items: readonly ChapterItem[],
  sequenceId: number,
): boolean => {
  const index = items.findIndex((entry) => entry.sequence.id === sequenceId);
  if (index < 0) return false;
  return items.slice(index + 1).some((entry) => entry.kind === "sequence");
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/pages/console/hooks/sequence-run-status.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/pages/console/hooks/sequence-run-status.ts src/app/pages/console/hooks/sequence-run-status.spec.ts
git commit -m "Add a PLC-shaped fixture for active-task run status."
```

---

### Task 2: Restyle ExecCardView

**Files:**
- Modify: `src/app/pages/console/components/exec-area/exec-cards/exec-card.tsx`
- Create: `src/app/pages/console/components/exec-area/exec-cards/exec-card.spec.tsx`
- Modify: `src/app/pages/console/components/exec-area/exec-area.test.tsx` (delete the two 「C++ 运行中」 render tests)

**Interfaces:**
- Consumes: `EXAMPLE_SEQUENCE_RUNTIME`, `formatExecTime` from Task 1; `ExecCard` from `use-exec-cards`
- Produces: `ExecCardView` props `{ card, hasNextSequence, onStop, onResume, onRestart, onSkipNext, onSetSpeed, onClose }` (no `onPause`). Display times/loops from `EXAMPLE_SEQUENCE_RUNTIME[0]`. Speed from `card.speedPercent`. Running vs stopped from `card.status === "stopped"` (and treat `"paused"` as stopped if it still appears). Keep error / completed close actions.

- [ ] **Step 1: Write the failing card tests**

Create `exec-card.spec.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExecCard } from "../../../hooks/use-exec-cards";
import { ExecCardView } from "./exec-card";

afterEach(() => cleanup());

const handlers = {
  onStop: vi.fn(),
  onResume: vi.fn(),
  onRestart: vi.fn(),
  onSkipNext: vi.fn(),
  onSetSpeed: vi.fn(),
  onClose: vi.fn(),
};

const card = (overrides: Partial<ExecCard> = {}): ExecCard => ({
  id: "card",
  kind: "sequence",
  name: "开幕升降",
  source: { kind: "fader", slotIndex: 0 },
  durationMs: null,
  elapsedMs: 0,
  speedPercent: 100,
  status: "running",
  startedAt: 0,
  emergencyStopped: false,
  ...overrides,
});

describe("ExecCardView run status", () => {
  it("shows elapsed/total and loop, not remaining or C++ copy", () => {
    render(<ExecCardView card={card()} hasNextSequence onStop={handlers.onStop} onResume={handlers.onResume} onRestart={handlers.onRestart} onSkipNext={handlers.onSkipNext} onSetSpeed={handlers.onSetSpeed} onClose={handlers.onClose} />);
    expect(screen.getByText("运行时间")).toBeTruthy();
    expect(screen.getByText("00:12.3 / 01:00.0")).toBeTruthy();
    expect(screen.getByText("循环次数")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.queryByText(/剩余/)).toBeNull();
    expect(screen.queryByText("C++ 运行中")).toBeNull();
    expect(screen.queryByText("暂停")).toBeNull();
    expect(document.querySelector("[style*='width']")).toBeNull();
  });

  it("disables restart and skip while running; stop is enabled", () => {
    render(<ExecCardView card={card()} hasNextSequence {...handlers} />);
    expect(screen.getByRole("button", { name: "重新" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "跳过" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "跳过" }).textContent).not.toMatch(/跳过|下一个/);
    expect(screen.getByRole("button", { name: "停止" })).toHaveProperty("disabled", false);
  });

  it("shows restart, continue, and skip when stopped with a next sequence", () => {
    render(<ExecCardView card={card({ status: "stopped" })} hasNextSequence {...handlers} />);
    expect(screen.getByRole("button", { name: "重新" })).toHaveProperty("disabled", false);
    expect(screen.getByRole("button", { name: "继续" })).toHaveProperty("disabled", false);
    expect(screen.getByRole("button", { name: "跳过" })).toHaveProperty("disabled", false);
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    expect(handlers.onResume).toHaveBeenCalledTimes(1);
  });

  it("keeps skip disabled when stopped with no next sequence", () => {
    render(<ExecCardView card={card({ status: "stopped" })} hasNextSequence={false} {...handlers} />);
    expect(screen.getByRole("button", { name: "跳过" })).toHaveProperty("disabled", true);
  });
});
```

If `toHaveProperty("disabled", true)` is awkward, use `(screen.getByRole("button", { name: "重新" }) as HTMLButtonElement).disabled`.

Progress-bar assertion: the old fill was `style={{ width: \`${progressPercent}%\` }}`. Assert no element with that width style, or `expect(container.querySelector(".h-1.5.overflow-hidden")).toBeNull()`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/pages/console/components/exec-area/exec-cards/exec-card.spec.tsx`

Expected: FAIL (props / copy still 暂停 and C++ 运行中).

- [ ] **Step 3: Implement ExecCardView**

Replace `exec-card.tsx` with:

```tsx
import { MoreVertical, Play, SkipForward, Square, Minus, Plus, X, RotateCcw } from "lucide-react";
import { cn } from "@/app/components/ui/utils";
import type { ExecCard, ExecCardSource } from "../../../hooks/use-exec-cards";
import { EXAMPLE_SEQUENCE_RUNTIME, formatExecTime } from "../../../hooks/sequence-run-status";

type ExecCardProps = {
  card: ExecCard;
  hasNextSequence: boolean;
  onStop: () => void;
  onResume: () => void;
  onRestart: () => void;
  onSkipNext: () => void;
  onSetSpeed: (percent: number) => void;
  onClose: () => void;
};

const sourceLabel = (source: ExecCardSource) => {
  switch (source.kind) {
    case "fader":
      return `F${source.slotIndex + 1}`;
    case "program":
      return "节目";
    case "external":
      return "外部";
    case "manual":
      return "手动";
  }
};

const actionBtnClass =
  "inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-sm text-body-sm transition-colors";

export const ExecCardView = ({
  card,
  hasNextSequence,
  onStop,
  onResume,
  onRestart,
  onSkipNext,
  onSetSpeed,
  onClose,
}: ExecCardProps) => {
  const fixture = EXAMPLE_SEQUENCE_RUNTIME[0]!;
  const isStopped = card.status === "stopped" || card.status === "paused";
  const isCompleted = card.status === "completed";
  const isError = card.status === "error" || card.emergencyStopped;
  const skipDisabled = !isStopped || !hasNextSequence || isError;
  const maxSpeed = 200;

  return (
    <div
      className={cn(
        "flex h-[152px] w-full shrink-0 flex-col gap-1.5 rounded-md bg-background p-2.5",
        isError
          ? "ring-1 ring-destructive/60 animate-pulse"
          : isCompleted
            ? ""
            : "ring-1 ring-show/40",
      )}
    >
      <div className="flex min-h-0 items-center gap-1.5">
        <Play className="h-3.5 w-3.5 shrink-0 fill-current text-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-body-sm font-semibold text-foreground">
          {card.name}
        </span>
        <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-label-caps text-muted-foreground">
          Seq
        </span>
        <span className="shrink-0 font-mono text-mono-sm tabular-nums text-muted-foreground">
          {sourceLabel(card.source)}
        </span>
        <button
          type="button"
          aria-label="更多操作"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <MoreVertical className="h-3 w-3" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        <div>
          <div className="text-label-caps text-muted-foreground">运行时间</div>
          <div className="font-mono text-mono-sm tabular-nums text-foreground">
            {formatExecTime(fixture.elapsedMs)} / {formatExecTime(fixture.totalMs)}
          </div>
        </div>
        <div>
          <div className="text-label-caps text-muted-foreground">循环次数</div>
          <div className="font-mono text-mono-sm tabular-nums text-foreground">{fixture.loopCount}</div>
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-label="降低速度"
          disabled={isError}
          onClick={() => onSetSpeed(Math.max(0, card.speedPercent - 10))}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-input-background text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
        >
          <Minus className="h-3 w-3" />
        </button>
        <input
          type="range"
          min={0}
          max={maxSpeed}
          value={card.speedPercent}
          disabled={isError}
          onChange={(event) => onSetSpeed(Number(event.target.value))}
          className="h-1.5 min-w-0 flex-1 accent-primary disabled:opacity-30"
          aria-label="速度倍率"
        />
        <button
          type="button"
          aria-label="提高速度"
          disabled={isError}
          onClick={() => onSetSpeed(Math.min(maxSpeed, card.speedPercent + 10))}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-input-background text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
        >
          <Plus className="h-3 w-3" />
        </button>
        <span className="w-10 shrink-0 text-right font-mono text-mono-sm tabular-nums text-foreground">
          {card.speedPercent}%
        </span>
      </div>

      <div className="flex gap-1.5">
        {isError ? (
          <button
            type="button"
            onClick={onClose}
            className={cn(actionBtnClass, "bg-destructive text-destructive-foreground hover:bg-destructive/90")}
          >
            <X className="h-3.5 w-3.5" /> 确认清除
          </button>
        ) : isCompleted ? (
          <button
            type="button"
            onClick={onClose}
            className={cn(actionBtnClass, "bg-muted/50 text-foreground hover:bg-muted")}
          >
            <X className="h-3.5 w-3.5" /> 关闭
          </button>
        ) : (
          <>
            <button
              type="button"
              aria-label="重新"
              disabled={!isStopped}
              onClick={onRestart}
              className={cn(actionBtnClass, "bg-muted/50 text-foreground hover:bg-muted disabled:opacity-40")}
            >
              <RotateCcw className="h-3.5 w-3.5" /> 重新
            </button>
            {isStopped ? (
              <button
                type="button"
                onClick={onResume}
                className={cn(actionBtnClass, "bg-primary text-primary-foreground hover:bg-primary/90")}
              >
                <Play className="h-3.5 w-3.5 fill-current" /> 继续
              </button>
            ) : (
              <button
                type="button"
                onClick={onStop}
                className={cn(actionBtnClass, "bg-muted/50 text-foreground hover:bg-muted")}
              >
                <Square className="h-3.5 w-3.5" /> 停止
              </button>
            )}
            <button
              type="button"
              aria-label="跳过"
              disabled={skipDisabled}
              onClick={onSkipNext}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-muted/50 text-foreground hover:bg-muted disabled:opacity-40"
            >
              <SkipForward className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
};
```

The skip button must have `aria-label="跳过"` and **no** visible 「跳过」 / 「下一个」 text (icon only).

Delete from `exec-area.test.tsx` the tests named:
- `renders elapsed wall time and C++ 运行中 without percentage for sequence cards`
- `does not show C++ 运行中 for a skipped or completed null-duration card`

Keep empty-state and `advanceRunningCards` tests.

Fix `ExecCards` temporarily if TypeScript in the same package fails on missing `hasNextSequence`: add `hasNextSequence={false}` and `onRestart={() => undefined}` in `exec-cards.tsx` so the tree compiles; Task 3 replaces those with real wiring. Do not leave `onPause` — remove it.

- [ ] **Step 4: Run card tests**

Run: `npx vitest run src/app/pages/console/components/exec-area/exec-cards/exec-card.spec.tsx src/app/pages/console/hooks/sequence-run-status.spec.ts src/app/pages/console/components/exec-area/exec-area.test.tsx`

Expected: PASS. If `exec-area.test.tsx` still renders `ExecCardView` with old props, update those call sites to the new props (only the tests you did not delete).

- [ ] **Step 5: Commit**

```bash
git add src/app/pages/console/components/exec-area/exec-cards/exec-card.tsx \
  src/app/pages/console/components/exec-area/exec-cards/exec-card.spec.tsx \
  src/app/pages/console/components/exec-area/exec-cards/exec-cards.tsx \
  src/app/pages/console/components/exec-area/exec-area.test.tsx
git commit -m "Restyle the active-task card with elapsed/total and local buttons."
```

---

### Task 3: Local stop/continue/restart/skip (no PLC)

**Files:**
- Modify: `src/app/pages/console/hooks/use-exec-cards.tsx`
- Modify: `src/app/pages/console/components/exec-area/exec-cards/exec-cards.tsx`
- Modify: `src/app/pages/console/components/exec-area/exec-area.tsx`
- Modify: `src/app/pages/console/components/action-builder/right-panel/program-panel.tsx`
- Modify: `src/app/pages/console/components/exec-area/exec-area.test.tsx` (skipNext test)

**Interfaces:**
- Consumes: `hasNextChapterSequence` from Task 1; `ExecCardView` from Task 2
- Produces:
  - `ExecCardStatus` includes `"stopped"`
  - `ExecCard.sequenceId?: number`
  - `launch({ ..., sequenceId?: number })`
  - `stop(id)` sets `status: "stopped"` and **does not** remove the card or call `stopSequence`
  - `resume(id)` sets `status: "running"` from `stopped` or `paused`
  - `restart(id)` sets `status: "running"`
  - `skipNext(id)` no-op (does not call `stopSequence`, does not mark completed)
  - `emergencyStopAll` still calls `stopSequence` (unchanged)

- [ ] **Step 1: Write the failing persist-style hook tests**

Replace the `skipNext stops the sequence handle...` test in `exec-area.test.tsx` with:

```tsx
  it("stop keeps the card locally and skipNext does not call PLC", async () => {
    const { ExecCardsProvider, useExecCards: useRealExecCards } = await vi.importActual<
      typeof import("../../hooks/use-exec-cards")
    >("../../hooks/use-exec-cards");

    const Probe = () => {
      const { launch, stop, skipNext, restart, cards } = useRealExecCards();
      return (
        <div>
          <button
            type="button"
            onClick={() =>
              launch({
                kind: "sequence",
                name: "正常序列",
                durationMs: null,
                source: { kind: "program" },
                sequenceId: 15,
                sequenceHandle: { actionId: 9, syncGroupId: 3 },
              })
            }
          >
            launch-seq
          </button>
          {cards.map((card) => (
            <div key={card.id}>
              <span>{card.status}</span>
              <button type="button" onClick={() => stop(card.id)}>
                stop
              </button>
              <button type="button" onClick={() => skipNext(card.id)}>
                skip
              </button>
              <button type="button" onClick={() => restart(card.id)}>
                restart
              </button>
            </div>
          ))}
        </div>
      );
    };

    render(
      <ExecCardsProvider>
        <Probe />
      </ExecCardsProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "launch-seq" }));
    expect(screen.getByText("running")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "skip" }));
    expect(stopSequenceMock).not.toHaveBeenCalled();
    expect(screen.getByText("running")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "stop" }));
    expect(stopSequenceMock).not.toHaveBeenCalled();
    expect(screen.getByText("stopped")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "restart" }));
    expect(screen.getByText("running")).toBeTruthy();
  });
```

Use the live `SequenceRuntimeHandle` field names from `sequence-execution.ts` (`actionId`, not `actionNo`). If `stopSequenceMock` is not in scope, keep the existing mock name from the top of `exec-area.test.tsx`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/pages/console/components/exec-area/exec-area.test.tsx`

Expected: FAIL (`restart` missing and/or skip still calls `stopSequence` / marks completed).

- [ ] **Step 3: Implement hook + wiring**

In `use-exec-cards.tsx`:

- Add `"stopped"` to `ExecCardStatus`.
- Add `sequenceId?: number` on `ExecCard` and on `launch` input; copy it onto the new card.
- Add `restart` to the context value:

```ts
  const restart = useCallback((id: string) => {
    setCards((current) =>
      current.map((card) => (card.id === id ? { ...card, status: "running" as const } : card)),
    );
  }, []);
```

- Change `stop`:

```ts
  const stop = useCallback((id: string) => {
    setCards((current) =>
      current.map((card) => (card.id === id ? { ...card, status: "stopped" as const } : card)),
    );
  }, []);
```

- Change `resume` to also accept `stopped`:

```ts
  const resume = useCallback((id: string) => {
    setCards((current) =>
      current.map((card) =>
        card.id === id && (card.status === "paused" || card.status === "stopped")
          ? { ...card, status: "running" as const }
          : card,
      ),
    );
  }, []);
```

- Change `skipNext` to a no-op (empty callback is fine). Do **not** call `stopSequence`. Do **not** set `completed`.

- Put `restart` on the context value next to `stop`.

In `exec-area.tsx` launch:

```ts
          launch({
            kind: "sequence",
            name: started.name,
            durationMs: null,
            source: { kind: "fader", slotIndex },
            speedPercent: started.speedPercent,
            sequenceId,
            sequenceHandle: started.sequenceHandle,
          });
```

(`sequenceId` is already the handler argument.)

In `program-panel.tsx` launch add `sequenceId: meta.refId`.

In `exec-cards.tsx`:

```tsx
import { useProgram } from "../../../hooks/use-program";
import { hasNextChapterSequence } from "../../../hooks/sequence-run-status";

export const ExecCards = () => {
  const { cards, resume, stop, skipNext, setSpeed, close, restart } = useExecCards();
  const { program, currentChapterId } = useProgram();
  const chapterItems =
    program.chapters.find((chapter) => chapter.id === currentChapterId)?.items ??
    program.chapters[0]?.items ??
    [];

  if (cards.length === 0) {
    return <ExecEmptyState />;
  }

  return (
    <div className="custom-scrollbar flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
      {cards.map((card) => (
        <ExecCardView
          key={card.id}
          card={card}
          hasNextSequence={
            card.sequenceId !== undefined &&
            hasNextChapterSequence(chapterItems, card.sequenceId)
          }
          onStop={() => stop(card.id)}
          onResume={() => resume(card.id)}
          onRestart={() => restart(card.id)}
          onSkipNext={() => skipNext(card.id)}
          onSetSpeed={(percent) => setSpeed(card.id, percent)}
          onClose={() => close(card.id)}
        />
      ))}
    </div>
  );
};
```

`currentChapter` is computed in `ExecCards` from `useProgram()` (`program` + `currentChapterId`). Do not add a new program field. Match fader fallback: the chapter with `currentChapterId`, else `chapters[0]`.

Leave `emergencyStopAll` calling `stopSequence`. Leave `advanceRunningCards` as-is (only `status === "running"` ticks). Auto-remove still only for `completed`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/app/pages/console/hooks/sequence-run-status.spec.ts src/app/pages/console/components/exec-area/exec-cards/exec-card.spec.tsx src/app/pages/console/components/exec-area/exec-area.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/pages/console/hooks/use-exec-cards.tsx \
  src/app/pages/console/components/exec-area/exec-cards/exec-cards.tsx \
  src/app/pages/console/components/exec-area/exec-area.tsx \
  src/app/pages/console/components/action-builder/right-panel/program-panel.tsx \
  src/app/pages/console/components/exec-area/exec-area.test.tsx
git commit -m "Keep stopped active-task cards local without PLC transport."
```

---

## Self-review (spec coverage)

| Spec item | Task |
|---|---|
| Fixture PLC-shaped list; elapsed 12300 / total 60000 / loop 1 | 1 |
| `hasNextChapterSequence` | 1 |
| Card layout B: 运行时间 `elapsed / total`, 循环次数, slider = speed | 2 |
| No remaining, progress, C++ 运行中, 暂停, 「下一个」 text | 2 |
| Running: 重新+跳过 disabled; 停止 enabled | 2 |
| Stopped: 重新+继续; skip icon enabled iff next | 2 |
| Empty 「暂无活跃任务」 | unchanged empty state (task 2 keeps that test) |
| Stop keeps card; no PLC on stop/skip/restart/continue | 3 |
| `sequenceId` on launch for next-item check | 3 |
| No Ready/GO / fader / capture changes | none |
