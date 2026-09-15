# Control Eight Fader Slots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Control-page executors show eight console-strip fader slots per page (program tree paging matches), with a custom fill-from-bottom fader, a shorter exec area, and a narrower guide.

**Architecture:** Keep `PROGRAM_SLOTS_PER_PAGE` as the only page-size constant (`program-data.ts`). Slot count, tree slices, and drag insert already read it. Add a presentational `VerticalFader` (`role="slider"`, no native range). Restyle `FaderSlot` into a tall strip. Do not change Ready/GO/PLC.

**Tech Stack:** React, TypeScript, Tailwind, Vitest, Testing Library. Run only the named vitest files; do not run the full suite, `tsc --noEmit`, or a production build. No GUI / screen testing.

**Spec:** `docs/superpowers/specs/2026-09-15-control-eight-fader-slots-design.md`

## Global Constraints

- `PROGRAM_SLOTS_PER_PAGE = 8`. Faders and program pages share it.
- Slot labels `F1`–`F8` on the current page (page 2 is `F1`–`F8` again, not `F9`–`F16`).
- One row × eight columns. Horizontal scroll if a strip would go below `min-w-[72px]`; never wrap to two rows.
- Exec area height `330px` → `260px`. Guide width `148px` → `96px`.
- Custom fader: fill from bottom, 0–200 integer, default 100, `role="slider"`, no `<input type="range">`.
- `%` under the track, hidden when the slot is empty.
- Ready/GO, fingerprints, busy, running, toasts, and PLC stay as they are.
- No project document migration.
- `docs/` is gitignored — `git add -f` for plan/spec files.
- Targeted vitest only: `npx vitest run <paths>`.

## File structure

| File | Role |
|---|---|
| `src/app/pages/console/components/program-panel/program-data.ts` | `PROGRAM_SLOTS_PER_PAGE = 8` |
| `src/app/pages/console/components/program-panel/program-utils.ts` | Already slices by that constant |
| `src/app/pages/console/components/program-panel/program-utils.spec.ts` | Page size 8 cases |
| `src/app/pages/console/hooks/use-executor-slots.tsx` | Already builds `length: PROGRAM_SLOTS_PER_PAGE` |
| `src/app/pages/console/hooks/use-executor-slots.spec.tsx` | Assert eight `F1`–`F8` slots |
| `src/app/pages/console/components/exec-area/exec-area.test.tsx` | Eight Ready buttons in the mock grid |
| `src/app/pages/console/components/exec-area/executors/vertical-fader-math.ts` | Clamp / pointer Y / keyboard step math |
| `src/app/pages/console/components/exec-area/executors/vertical-fader.tsx` | Custom slider UI |
| `src/app/pages/console/components/exec-area/executors/vertical-fader-math.spec.ts` | Math unit tests |
| `src/app/pages/console/components/exec-area/executors/vertical-fader.spec.tsx` | Slider keyboard + pointer |
| `src/app/pages/console/components/exec-area/executors/fader-slot.tsx` | Console strip layout |
| `src/app/pages/console/components/exec-area/executors/executors.tsx` | One-row overflow container |
| `src/app/pages/console/components/exec-area/executors/executor-section-guide.tsx` | 96px + one-line copy |
| `src/app/pages/console/components/exec-area/executors/executor-section-guide.spec.tsx` | Guide copy |
| `src/app/pages/console/console-page.tsx` | `ExecArea` `h-[260px]` |

`chapter-section.tsx` / `page-section.tsx` already use `PROGRAM_SLOTS_PER_PAGE` for offsets and `F${idx + 1}` labels. Do not edit them.

---

### Task 1: Eight slots per page

**Files:**
- Modify: `src/app/pages/console/components/program-panel/program-utils.spec.ts`
- Modify: `src/app/pages/console/hooks/use-executor-slots.spec.tsx`
- Modify: `src/app/pages/console/components/program-panel/program-data.ts` (line 1)
- Modify: `src/app/pages/console/components/exec-area/exec-area.test.tsx` (`length: 14` → `6`, `toHaveLength(16)` → `8`)

**Interfaces:**
- Consumes: none
- Produces: `export const PROGRAM_SLOTS_PER_PAGE = 8`

- [ ] **Step 1: Write the failing tests**

Replace `program-utils.spec.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { PROGRAM_SLOTS_PER_PAGE, type ChapterItem } from "./program-data";
import { programPageCount, sliceProgramPage } from "./program-utils";

const item = (id: number): ChapterItem => ({
  kind: "sequence",
  sequence: { id, name: `S${id}`, durationMs: 0 },
});

describe("program paging", () => {
  it("uses 8 slots per page", () => {
    expect(PROGRAM_SLOTS_PER_PAGE).toBe(8);
  });

  it("returns at least one page for empty chapters", () => {
    expect(programPageCount([])).toBe(1);
  });

  it("slices 8 items per page and counts leftover pages", () => {
    const eight = Array.from({ length: 8 }, (_, index) => item(index + 1));
    expect(programPageCount(eight)).toBe(1);
    expect(sliceProgramPage(eight, 0)).toHaveLength(8);

    const nine = Array.from({ length: 9 }, (_, index) => item(index + 1));
    expect(programPageCount(nine)).toBe(2);
    expect(sliceProgramPage(nine, 0)).toHaveLength(8);
    expect(sliceProgramPage(nine, 1)).toEqual([item(9)]);

    const items = Array.from({ length: 17 }, (_, index) => item(index + 1));
    expect(programPageCount(items)).toBe(3);
    expect(sliceProgramPage(items, 0)).toHaveLength(8);
    expect(sliceProgramPage(items, 1)).toHaveLength(8);
    expect(sliceProgramPage(items, 2)).toEqual([item(17)]);
    expect(sliceProgramPage(items, 0)[0]?.sequence.id).toBe(1);
    expect(sliceProgramPage(items, 0)[7]?.sequence.id).toBe(8);
  });
});
```

In `use-executor-slots.spec.tsx`, add this test inside `describe("ExecutorSlotsProvider"` (same `pageItemsFor` / wrapper pattern as the existing test):

```ts
  it("always exposes eight F1–F8 slots", () => {
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(
        ExecutorSlotsProvider,
        { pageItems: pageItemsFor([15]), sequenceFingerprints: { 15: "fp-15" } },
        children,
      );
    const { result } = renderHook(() => useExecutorSlots(), { wrapper });
    expect(result.current.faderSlots).toHaveLength(8);
    expect(result.current.faderSlots.map((slot) => slot.label)).toEqual([
      "F1",
      "F2",
      "F3",
      "F4",
      "F5",
      "F6",
      "F7",
      "F8",
    ]);
    expect(result.current.faderSlots[0]?.sequence?.id).toBe(15);
    expect(result.current.faderSlots[1]?.sequence).toBeNull();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/pages/console/components/program-panel/program-utils.spec.ts src/app/pages/console/hooks/use-executor-slots.spec.tsx`

Expected: FAIL (`PROGRAM_SLOTS_PER_PAGE` is 16; `faderSlots` length 16).

- [ ] **Step 3: Set the constant and align ExecArea fixtures**

In `program-data.ts`:

```ts
export const PROGRAM_SLOTS_PER_PAGE = 8;
```

In `exec-area.test.tsx` `describe("ExecArea launch guard")` `beforeEach`, change the empty-slot pad and Ready count:

```ts
      ...Array.from({ length: 6 }, (_, idx) => makeFaderSlot({ index: idx + 2 })),
```

```ts
    expect(readyButtons).toHaveLength(8);
```

Do not change `handleAssignFromDrag` in `executors.tsx` — it already multiplies by `PROGRAM_SLOTS_PER_PAGE`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/pages/console/components/program-panel/program-utils.spec.ts src/app/pages/console/hooks/use-executor-slots.spec.tsx src/app/pages/console/components/exec-area/exec-area.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/pages/console/components/program-panel/program-data.ts \
  src/app/pages/console/components/program-panel/program-utils.spec.ts \
  src/app/pages/console/hooks/use-executor-slots.spec.tsx \
  src/app/pages/console/components/exec-area/exec-area.test.tsx
git commit -m "Paginate control faders and program pages by eight slots."
```

---

### Task 2: Vertical fader math and slider

**Files:**
- Create: `src/app/pages/console/components/exec-area/executors/vertical-fader-math.ts`
- Create: `src/app/pages/console/components/exec-area/executors/vertical-fader.tsx`
- Create: `src/app/pages/console/components/exec-area/executors/vertical-fader-math.spec.ts`
- Create: `src/app/pages/console/components/exec-area/executors/vertical-fader.spec.tsx`

**Interfaces:**
- Consumes: none
- Produces:
  - `export const FADER_MIN = 0`
  - `export const FADER_MAX = 200`
  - `export const FADER_STEP = 1`
  - `export const FADER_LARGE_STEP = 10`
  - `export const clampFaderValue = (value: number): number`
  - `export const faderValueFromClientY = (clientY: number, track: Pick<DOMRect, "top" | "height">): number`
  - `export const stepFaderValue = (value: number, key: string, large: boolean): number | null`
  - `export type VerticalFaderProps = { value: number; onChange: (value: number) => void; disabled?: boolean; "aria-label": string; className?: string }`
  - `export const VerticalFader = (props: VerticalFaderProps) => JSX.Element`

Fill is from the **bottom**: `clientY` at `track.top` → 200; at `track.top + height` → 0.

- [ ] **Step 1: Write the failing math tests**

Create `vertical-fader-math.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  FADER_MAX,
  FADER_MIN,
  clampFaderValue,
  faderValueFromClientY,
  stepFaderValue,
} from "./vertical-fader-math";

describe("clampFaderValue", () => {
  it("rounds and clamps to 0–200", () => {
    expect(FADER_MIN).toBe(0);
    expect(FADER_MAX).toBe(200);
    expect(clampFaderValue(100.4)).toBe(100);
    expect(clampFaderValue(100.6)).toBe(101);
    expect(clampFaderValue(-8)).toBe(0);
    expect(clampFaderValue(250)).toBe(200);
  });
});

describe("faderValueFromClientY", () => {
  const track = { top: 0, height: 200 };

  it("maps bottom to 0 and top to 200", () => {
    expect(faderValueFromClientY(200, track)).toBe(0);
    expect(faderValueFromClientY(0, track)).toBe(200);
    expect(faderValueFromClientY(100, track)).toBe(100);
  });

  it("clamps outside the track", () => {
    expect(faderValueFromClientY(-20, track)).toBe(200);
    expect(faderValueFromClientY(260, track)).toBe(0);
  });

  it("returns 0 when height is 0", () => {
    expect(faderValueFromClientY(10, { top: 0, height: 0 })).toBe(0);
  });
});

describe("stepFaderValue", () => {
  it("steps 1 on arrows and 10 on Shift or Page", () => {
    expect(stepFaderValue(100, "ArrowUp", false)).toBe(101);
    expect(stepFaderValue(100, "ArrowRight", false)).toBe(101);
    expect(stepFaderValue(100, "ArrowDown", false)).toBe(99);
    expect(stepFaderValue(100, "ArrowLeft", false)).toBe(99);
    expect(stepFaderValue(100, "ArrowUp", true)).toBe(110);
    expect(stepFaderValue(100, "PageUp", false)).toBe(110);
    expect(stepFaderValue(100, "PageDown", false)).toBe(90);
    expect(stepFaderValue(198, "ArrowUp", true)).toBe(200);
    expect(stepFaderValue(2, "ArrowDown", false)).toBe(1);
    expect(stepFaderValue(0, "ArrowDown", false)).toBe(0);
    expect(stepFaderValue(100, "Home", false)).toBeNull();
  });
});
```

- [ ] **Step 2: Run math tests to verify they fail**

Run: `npx vitest run src/app/pages/console/components/exec-area/executors/vertical-fader-math.spec.ts`

Expected: FAIL (module not found).

- [ ] **Step 3: Implement math**

Create `vertical-fader-math.ts`:

```ts
export const FADER_MIN = 0;
export const FADER_MAX = 200;
export const FADER_STEP = 1;
export const FADER_LARGE_STEP = 10;

export const clampFaderValue = (value: number): number =>
  Math.min(FADER_MAX, Math.max(FADER_MIN, Math.round(value)));

export const faderValueFromClientY = (
  clientY: number,
  track: Pick<DOMRect, "top" | "height">,
): number => {
  if (track.height <= 0) return FADER_MIN;
  const ratioFromBottom = (track.top + track.height - clientY) / track.height;
  return clampFaderValue(ratioFromBottom * FADER_MAX);
};

export const stepFaderValue = (value: number, key: string, large: boolean): number | null => {
  if (key === "PageUp") return clampFaderValue(value + FADER_LARGE_STEP);
  if (key === "PageDown") return clampFaderValue(value - FADER_LARGE_STEP);
  const delta = large ? FADER_LARGE_STEP : FADER_STEP;
  if (key === "ArrowUp" || key === "ArrowRight") return clampFaderValue(value + delta);
  if (key === "ArrowDown" || key === "ArrowLeft") return clampFaderValue(value - delta);
  return null;
};
```

- [ ] **Step 4: Run math tests to verify they pass**

Run: `npx vitest run src/app/pages/console/components/exec-area/executors/vertical-fader-math.spec.ts`

Expected: PASS.

- [ ] **Step 5: Write the failing slider tests**

Create `vertical-fader.spec.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VerticalFader } from "./vertical-fader";

afterEach(() => {
  cleanup();
});

const mockRect = (element: Element, rect: { left: number; top: number; width: number; height: number }) => {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    x: rect.left,
    y: rect.top,
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    toJSON() {
      return {};
    },
  } as DOMRect);
};

describe("VerticalFader", () => {
  it("exposes a 0–200 slider and steps from the keyboard", () => {
    const onChange = vi.fn();
    render(<VerticalFader value={100} onChange={onChange} aria-label="F1 速度" />);
    const slider = screen.getByRole("slider", { name: "F1 速度" });
    expect(slider).toHaveAttribute("aria-valuemin", "0");
    expect(slider).toHaveAttribute("aria-valuemax", "200");
    expect(slider).toHaveAttribute("aria-valuenow", "100");
    fireEvent.keyDown(slider, { key: "ArrowUp" });
    expect(onChange).toHaveBeenCalledWith(101);
    fireEvent.keyDown(slider, { key: "ArrowUp", shiftKey: true });
    expect(onChange).toHaveBeenCalledWith(110);
  });

  it("does not change when disabled", () => {
    const onChange = vi.fn();
    render(<VerticalFader value={100} onChange={onChange} disabled aria-label="F1 速度" />);
    const slider = screen.getByRole("slider", { name: "F1 速度" });
    fireEvent.keyDown(slider, { key: "ArrowUp" });
    fireEvent.pointerDown(slider, { clientY: 0, button: 0, pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("maps pointer down and drag on the track", () => {
    const onChange = vi.fn();
    render(<VerticalFader value={100} onChange={onChange} aria-label="F1 速度" />);
    const slider = screen.getByRole("slider", { name: "F1 速度" });
    mockRect(slider, { left: 0, top: 0, width: 16, height: 200 });
    vi.spyOn(slider, "setPointerCapture").mockImplementation(() => {});
    vi.spyOn(slider, "hasPointerCapture").mockReturnValue(true);
    fireEvent.pointerDown(slider, { clientY: 50, button: 0, pointerId: 1 });
    expect(onChange).toHaveBeenCalledWith(150);
    fireEvent.pointerMove(slider, { clientY: 0, pointerId: 1 });
    expect(onChange).toHaveBeenCalledWith(200);
  });
});
```

- [ ] **Step 6: Run slider tests to verify they fail**

Run: `npx vitest run src/app/pages/console/components/exec-area/executors/vertical-fader.spec.tsx`

Expected: FAIL (`VerticalFader` is not exported from the tsx module).

- [ ] **Step 7: Implement VerticalFader**

Create `vertical-fader.tsx`:

```tsx
import { cn } from "@/app/components/ui/utils";
import {
  FADER_MAX,
  FADER_MIN,
  faderValueFromClientY,
  stepFaderValue,
} from "./vertical-fader-math";

export type VerticalFaderProps = {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  "aria-label": string;
  className?: string;
};

export const VerticalFader = ({
  value,
  onChange,
  disabled = false,
  "aria-label": ariaLabel,
  className,
}: VerticalFaderProps) => {
  const fillPercent = `${(value / FADER_MAX) * 100}%`;

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    onChange(faderValueFromClientY(event.clientY, event.currentTarget.getBoundingClientRect()));
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    onChange(faderValueFromClientY(event.clientY, event.currentTarget.getBoundingClientRect()));
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const next = stepFaderValue(value, event.key, event.shiftKey);
    if (next === null) return;
    event.preventDefault();
    onChange(next);
  };

  return (
    <div
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-valuemin={FADER_MIN}
      aria-valuemax={FADER_MAX}
      aria-valuenow={value}
      aria-disabled={disabled || undefined}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onKeyDown={handleKeyDown}
      className={cn(
        "relative min-h-0 w-full flex-1 touch-none outline-none focus-visible:ring-1 focus-visible:ring-primary",
        disabled && "pointer-events-none opacity-30",
        className,
      )}
    >
      <div className="absolute inset-y-0 left-1/2 w-1.5 -translate-x-1/2 rounded-full bg-muted" />
      <div
        className="absolute bottom-0 left-1/2 w-1.5 -translate-x-1/2 rounded-full bg-primary"
        style={{ height: fillPercent }}
      />
      <div
        className="absolute left-1/2 h-3 w-3 -translate-x-1/2 translate-y-1/2 rounded-sm border border-border bg-card"
        style={{ bottom: fillPercent }}
      />
    </div>
  );
};
```

- [ ] **Step 8: Run both fader suites**

Run: `npx vitest run src/app/pages/console/components/exec-area/executors/vertical-fader-math.spec.ts src/app/pages/console/components/exec-area/executors/vertical-fader.spec.tsx`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/app/pages/console/components/exec-area/executors/vertical-fader-math.ts \
  src/app/pages/console/components/exec-area/executors/vertical-fader.tsx \
  src/app/pages/console/components/exec-area/executors/vertical-fader-math.spec.ts \
  src/app/pages/console/components/exec-area/executors/vertical-fader.spec.tsx
git commit -m "Add a custom vertical fader with fill-from-bottom pointing."
```

---

### Task 3: Console-strip fader slot

**Files:**
- Modify: `src/app/pages/console/components/exec-area/executors/fader-slot.tsx` (replace layout; keep Ready/GO props and drag/drop)
- Modify: `src/app/pages/console/components/exec-area/exec-area.test.tsx` (add `%` / slider cases under `describe("FaderSlot Ready/GO gate")`)

**Interfaces:**
- Consumes: `VerticalFader` / `VerticalFaderProps` from Task 2; existing `FaderSlotProps`
- Produces: same `FaderSlot` export; native range input gone; speed control is `role="slider"` named `${slot.label} 速度`

- [ ] **Step 1: Write the failing slot tests**

Append inside `describe("FaderSlot Ready/GO gate")` in `exec-area.test.tsx`:

```ts
  it("hides percent on empty slots and shows a disabled slider", () => {
    render(
      withMode(
        <FaderSlot
          slot={makeFaderSlot({ index: 0 })}
          onGo={vi.fn()}
          onFaderChange={vi.fn()}
          onAssignFromDrag={vi.fn()}
        />,
      ),
    );
    expect(screen.getByRole("slider", { name: "F1 速度" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByText("100%")).toBeNull();
    expect(document.querySelector("input[type='range']")).toBeNull();
  });

  it("shows the sequence name, percent, and an enabled slider when filled", () => {
    const onFaderChange = vi.fn();
    render(
      withMode(
        <FaderSlot
          slot={makeFaderSlot({
            index: 2,
            faderValue: 120,
            sequence: { id: 15, name: "开幕A", durationMs: 2000 },
          })}
          onGo={vi.fn()}
          onFaderChange={onFaderChange}
          onAssignFromDrag={vi.fn()}
        />,
      ),
    );
    expect(screen.getByText("开幕A")).toBeTruthy();
    expect(screen.getByText("120%")).toBeTruthy();
    const slider = screen.getByRole("slider", { name: "F3 速度" });
    expect(slider.getAttribute("aria-disabled")).toBeNull();
    fireEvent.keyDown(slider, { key: "ArrowUp" });
    expect(onFaderChange).toHaveBeenCalledWith(121);
  });
```

- [ ] **Step 2: Run the FaderSlot tests to verify they fail**

Run: `npx vitest run src/app/pages/console/components/exec-area/exec-area.test.tsx`

Expected: FAIL (speed control is still `input[type=range]`; empty slots still show `100%`).

- [ ] **Step 3: Restyle FaderSlot**

Replace `fader-slot.tsx` with:

```tsx
import { Loader2, Play, Plus } from "lucide-react";
import { cn } from "@/app/components/ui/utils";
import { useConsoleMode } from "../../../hooks/use-console-mode";
import type { FaderSlotState } from "../../../hooks/use-executor-slots";
import { VerticalFader } from "./vertical-fader";

type FaderSlotProps = {
  slot: FaderSlotState;
  repairMessage?: string | null;
  onGo: () => void;
  onFaderChange: (value: number) => void;
  onAssignFromDrag: (payload: { chapterId: string; index: number; kind: "sequence" }) => void;
};

export const FaderSlot = ({
  slot,
  repairMessage,
  onGo,
  onFaderChange,
  onAssignFromDrag,
}: FaderSlotProps) => {
  const { mode } = useConsoleMode();
  const isEmpty = !slot.sequence;
  const isRunning = slot.phase === "running";
  const isReady = slot.phase === "ready";
  const actionLabel = isReady || isRunning ? "GO" : "Ready";
  const isBlocked = isEmpty || Boolean(repairMessage) || slot.isBusy || isRunning;
  const isRehearsal = mode === "rehearsal";
  const reasonId = `fader-slot-repair-${slot.index}`;

  const handleDragOver = (event: React.DragEvent) => {
    if (!isRehearsal) return;
    if (!event.dataTransfer.types.includes("application/x-console-item")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (event: React.DragEvent) => {
    if (!isRehearsal) return;
    const raw = event.dataTransfer.getData("application/x-console-item");
    if (!raw) return;
    try {
      const payload = JSON.parse(raw);
      if (payload?.kind !== "sequence") return;
      onAssignFromDrag(payload);
    } catch {
      // ignore
    }
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={cn(
        "flex h-full min-h-0 min-w-[72px] w-full flex-col gap-1 rounded-sm border bg-card p-2 transition-colors",
        isRunning
          ? "border-show/60"
          : isEmpty
            ? cn("border-dashed border-muted-foreground/40", isRehearsal && "hover:border-primary/40")
            : repairMessage
              ? "border-warning/50"
              : isReady
                ? "border-primary/50"
                : "border-border",
      )}
    >
      <div className="flex items-center gap-1">
        <span className="font-mono text-label-caps text-muted-foreground">{slot.label}</span>
        <span
          className={cn(
            "ml-auto h-1.5 w-1.5 rounded-full",
            isRunning
              ? "bg-show"
              : isEmpty
                ? "bg-muted-foreground/40"
                : repairMessage
                  ? "bg-warning"
                  : isReady
                    ? "bg-primary"
                    : "bg-show/70",
          )}
        />
      </div>
      {!isEmpty ? (
        <>
          <span className="line-clamp-1 text-body-sm text-foreground">{slot.sequence?.name}</span>
          {repairMessage ? (
            <span id={reasonId} className="line-clamp-2 text-body-sm text-warning">
              {repairMessage}
            </span>
          ) : null}
        </>
      ) : null}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <VerticalFader
          value={slot.faderValue}
          onChange={onFaderChange}
          disabled={isEmpty}
          aria-label={`${slot.label} 速度`}
        />
        {isEmpty ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-muted-foreground/60">
            <Plus className="h-3.5 w-3.5" />
            <span className="mt-0.5 text-body-sm">{isRehearsal ? "拖入序列" : "—"}</span>
          </div>
        ) : (
          <span className="mt-1 text-center font-mono text-mono-sm tabular-nums text-foreground">
            {slot.faderValue}%
          </span>
        )}
      </div>
      <button
        type="button"
        disabled={isBlocked}
        aria-busy={slot.isBusy || undefined}
        aria-label={`${slot.label} ${actionLabel}`}
        aria-describedby={repairMessage ? reasonId : undefined}
        onClick={onGo}
        className={cn(
          "inline-flex h-9 shrink-0 items-center justify-center gap-1 rounded-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-30",
          isRunning
            ? "bg-show text-background"
            : isBlocked
              ? "border border-border text-muted-foreground"
              : "bg-primary text-primary-foreground hover:bg-primary/90",
        )}
      >
        {slot.isBusy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <Play className="h-3.5 w-3.5 fill-current" aria-hidden />
        )}
        {actionLabel}
      </button>
    </div>
  );
};
```

- [ ] **Step 4: Run exec-area tests**

Run: `npx vitest run src/app/pages/console/components/exec-area/exec-area.test.tsx`

Expected: PASS (Ready/GO cases unchanged; new empty/filled slider cases pass).

- [ ] **Step 5: Commit**

```bash
git add src/app/pages/console/components/exec-area/executors/fader-slot.tsx \
  src/app/pages/console/components/exec-area/exec-area.test.tsx
git commit -m "Restyle control fader slots as console strips."
```

---

### Task 4: Exec area height, guide, one-row overflow

**Files:**
- Create: `src/app/pages/console/components/exec-area/executors/executor-section-guide.spec.tsx`
- Modify: `src/app/pages/console/components/exec-area/executors/executor-section-guide.tsx`
- Modify: `src/app/pages/console/components/exec-area/executors/executors.tsx` (scroll container)
- Modify: `src/app/pages/console/console-page.tsx` (`h-[330px]` → `h-[260px]`)

**Interfaces:**
- Consumes: eight `FaderSlot` strips from Task 3 (`min-w-[72px] h-full`)
- Produces: guide `w-[96px]` with icon + 「推子槽」 + one line (`拖入序列` rehearsal / `推子调速` show); exec area `h-[260px]`; executor body `overflow-x-auto overflow-y-hidden`

- [ ] **Step 1: Write the failing guide tests**

Create `executor-section-guide.spec.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createElement, useEffect, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ConsoleModeProvider, useConsoleMode } from "../../../hooks/use-console-mode";
import { ExecutorSectionGuide } from "./executor-section-guide";

afterEach(() => {
  cleanup();
});

const withMode = (children: ReactNode) => createElement(ConsoleModeProvider, null, children);

const ShowMode = ({ children }: { children: ReactNode }) => {
  const { enterShow } = useConsoleMode();
  useEffect(() => {
    enterShow();
  }, [enterShow]);
  return children;
};

describe("ExecutorSectionGuide", () => {
  it("keeps a short rehearsal line and drops the old tutorial copy", () => {
    render(withMode(<ExecutorSectionGuide />));
    expect(screen.getByText("推子槽")).toBeTruthy();
    expect(screen.getByText("拖入序列")).toBeTruthy();
    expect(screen.queryByText("动作序列")).toBeNull();
    expect(screen.queryByText("默认 100%")).toBeNull();
    expect(screen.queryByText("排练可拖放编排")).toBeNull();
  });

  it("uses a short show-mode line", async () => {
    render(withMode(<ShowMode><ExecutorSectionGuide /></ShowMode>));
    expect(await screen.findByText("推子调速")).toBeTruthy();
    expect(screen.queryByText("演出模式只执行")).toBeNull();
  });
});
```

- [ ] **Step 2: Run guide tests to verify they fail**

Run: `npx vitest run src/app/pages/console/components/exec-area/executors/executor-section-guide.spec.tsx`

Expected: FAIL (copy is still the long tutorial; 「拖入序列」 is not the guide text).

- [ ] **Step 3: Narrow the guide and layout**

Replace `executor-section-guide.tsx` with:

```tsx
import { SlidersVertical } from "lucide-react";
import { cn } from "@/app/components/ui/utils";
import { useConsoleMode } from "../../../hooks/use-console-mode";

type ExecutorSectionGuideProps = {
  className?: string;
};

export const ExecutorSectionGuide = ({ className }: ExecutorSectionGuideProps) => {
  const { mode } = useConsoleMode();
  const isRehearsal = mode === "rehearsal";

  return (
    <div
      className={cn(
        "flex w-[96px] shrink-0 flex-col gap-1.5 rounded-sm border border-border bg-card p-2",
        className,
      )}
    >
      <div className="flex items-start gap-1.5">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-muted">
          <SlidersVertical className="h-3.5 w-3.5 text-primary" aria-hidden />
        </div>
        <p className="min-w-0 text-label-caps text-foreground">推子槽</p>
      </div>
      <p className="text-body-sm text-muted-foreground">{isRehearsal ? "拖入序列" : "推子调速"}</p>
    </div>
  );
};
```

In `executors.tsx`, replace the body wrapper (keep `handleAssignFromDrag` and the slot map). The `return` should be:

```tsx
  return (
    <section className="flex h-full flex-col bg-muted">
      <ExecutorPaginationBar />
      <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden p-3">
        <div className="flex h-full min-h-0 gap-2">
          <ExecutorSectionGuide className="self-stretch" />
          <div className="grid h-full min-w-0 flex-1 grid-cols-8 gap-2">
            {faderSlots.map((slot) => {
              const repairMessage =
                document && slot.sequence
                  ? getMotionItemRepairIssue(document, "sequence", slot.sequence.id)?.message ??
                    null
                  : null;
              return (
                <FaderSlot
                  key={slot.index}
                  slot={slot}
                  repairMessage={repairMessage}
                  onGo={() => slot.sequence && onTriggerSequence(slot.index, slot.sequence.id)}
                  onFaderChange={(value) => setFaderValue(slot.index, value)}
                  onAssignFromDrag={handleAssignFromDrag(slot.index)}
                />
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
```

In `console-page.tsx`, change only the ExecArea height class:

```tsx
        {isControl && <ExecArea className="h-[260px]" />}
```

- [ ] **Step 4: Run targeted tests**

Run: `npx vitest run src/app/pages/console/components/exec-area/executors/executor-section-guide.spec.tsx src/app/pages/console/components/exec-area/executors/vertical-fader-math.spec.ts src/app/pages/console/components/exec-area/executors/vertical-fader.spec.tsx src/app/pages/console/components/exec-area/exec-area.test.tsx src/app/pages/console/components/program-panel/program-utils.spec.ts src/app/pages/console/hooks/use-executor-slots.spec.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/pages/console/components/exec-area/executors/executor-section-guide.tsx \
  src/app/pages/console/components/exec-area/executors/executor-section-guide.spec.tsx \
  src/app/pages/console/components/exec-area/executors/executors.tsx \
  src/app/pages/console/console-page.tsx
git commit -m "Tighten the control exec strip: 260px area and a 96px guide."
```

---

## Self-review (spec coverage)

| Spec item | Task |
|---|---|
| `PROGRAM_SLOTS_PER_PAGE = 8` + tree paging + F1–F8 | 1 |
| 9 items → 2 pages; 17 → 3 pages | 1 |
| Drag insert `pageIndex * 8 + slotIndex` | 1 (existing formula) |
| Custom fader math + `role="slider"` keyboard/pointer | 2 |
| Console strip, `%` hidden when empty, no native range | 3 |
| Ready/GO / repair / empty enablement | 3 (existing tests + restyle) |
| Exec `260px`, guide `96px` one line, one row, x-scroll | 4 |
| No PLC / document migration / mixer ticks | none (out of scope) |
