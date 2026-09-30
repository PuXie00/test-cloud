// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExecCard, ExecCardRun } from "../../../hooks/use-exec-cards";
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

const run = (overrides: Partial<ExecCardRun> = {}): ExecCardRun => ({
  state: 3,
  loopCount: 1,
  loopCountSet: 3,
  runTimeMs: 12300,
  reportedAt: 0,
  ...overrides,
});

const speedControls = () =>
  ["降低速度", "速度倍率", "提高速度"].map(
    (name) => screen.getByLabelText(name) as HTMLButtonElement | HTMLInputElement,
  );

describe("ExecCardView PLC run data", () => {
  it("leaves placeholders until the PLC reports", () => {
    render(<ExecCardView card={card({ totalMs: 60000 })} hasNextSequence {...handlers} />);
    expect(screen.getByText("--:--.- / 01:00.0")).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("shows 回迹中 and locks speed while in the transition state", () => {
    render(
      <ExecCardView card={card({ totalMs: 60000, run: run({ state: 1 }) })} hasNextSequence {...handlers} />,
    );
    expect(screen.getByText("回迹中 / 01:00.0")).toBeTruthy();
    expect(speedControls().every((control) => control.disabled)).toBe(true);
  });

  it("allows speed changes once the action is running on the trajectory", () => {
    render(<ExecCardView card={card({ run: run() })} hasNextSequence {...handlers} />);
    expect(speedControls().every((control) => !control.disabled)).toBe(true);
  });

  it("keeps the last reported time after the action stops", () => {
    render(
      <ExecCardView
        card={card({ status: "stopped", totalMs: 60000, run: run({ state: 1, runTimeMs: 5000 }) })}
        hasNextSequence
        {...handlers}
      />,
    );
    expect(screen.getByText("00:05.0 / 01:00.0")).toBeTruthy();
  });

  it("shows ∞ for an endless loop and marks a reverse run", () => {
    render(
      <ExecCardView
        card={card({ reverse: true, run: run({ loopCount: 7, loopCountSet: 0 }) })}
        hasNextSequence
        {...handlers}
      />,
    );
    expect(screen.getByText("7 / ∞")).toBeTruthy();
    expect(screen.getByText("反向")).toBeTruthy();
  });

  it("does not mark a forward run", () => {
    render(<ExecCardView card={card({ run: run() })} hasNextSequence {...handlers} />);
    expect(screen.queryByText("反向")).toBeNull();
  });
});

describe("ExecCardView stop and close gating", () => {
  const closeButton = () => screen.getByRole("button", { name: "关闭任务" }) as HTMLButtonElement;

  it("cannot be closed while running", () => {
    render(<ExecCardView card={card({ run: run(), plcActive: true })} hasNextSequence {...handlers} />);
    expect(closeButton().disabled).toBe(true);
  });

  it("shows 停止中 and keeps close, restart, next and speed locked until it really stops", () => {
    handlers.onStop.mockClear();
    render(
      <ExecCardView
        card={card({ status: "stopping", run: run(), plcActive: true })}
        hasNextSequence
        {...handlers}
      />,
    );
    expect(closeButton().disabled).toBe(true);
    expect((screen.getByRole("button", { name: "重新" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "下一条" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "继续" })).toBeNull();
    expect(speedControls().every((control) => control.disabled)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "停止中" }));
    expect(handlers.onStop).toHaveBeenCalledTimes(1);
  });

  it("can be closed once stopped", () => {
    render(<ExecCardView card={card({ status: "stopped", run: run() })} hasNextSequence {...handlers} />);
    expect(closeButton().disabled).toBe(false);
  });

  it("keeps 确认清除 locked while the PLC still reports an emergency-stopped action", () => {
    const errored = card({ status: "error", emergencyStopped: true, run: run(), plcActive: true });
    const { rerender } = render(<ExecCardView card={errored} hasNextSequence {...handlers} />);
    expect((screen.getByRole("button", { name: "确认清除" }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<ExecCardView card={{ ...errored, plcActive: false }} hasNextSequence {...handlers} />);
    expect((screen.getByRole("button", { name: "确认清除" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("ExecCardView run status", () => {
  it("shows elapsed/total and loop, not remaining or C++ copy", () => {
    render(<ExecCardView card={card({ totalMs: 60000, run: run() })} hasNextSequence onStop={handlers.onStop} onResume={handlers.onResume} onRestart={handlers.onRestart} onSkipNext={handlers.onSkipNext} onSetSpeed={handlers.onSetSpeed} onClose={handlers.onClose} />);
    expect(screen.getByText("运行时间")).toBeTruthy();
    expect(screen.getByText("00:12.3 / 01:00.0")).toBeTruthy();
    expect(screen.getByText("循环次数")).toBeTruthy();
    expect(screen.getByText("1 / 3")).toBeTruthy();
    expect(screen.queryByText(/剩余/)).toBeNull();
    expect(screen.queryByText("C++ 运行中")).toBeNull();
    expect(screen.queryByText("暂停")).toBeNull();
    expect(document.querySelector("[style*='width']")).toBeNull();
    expect(screen.queryByText("Seq")).toBeNull();
    expect(screen.queryByText("强制")).toBeNull();
  });

  it("shows 强制 only for a forced-trajectory sequence", () => {
    render(
      <ExecCardView
        card={card({ trajectoryMode: true })}
        hasNextSequence
        {...handlers}
      />,
    );
    expect(screen.getByText("强制")).toBeTruthy();
    expect(screen.queryByText("Seq")).toBeNull();
  });

  it("closes a stopped task from the top-right control", () => {
    handlers.onClose.mockClear();
    render(<ExecCardView card={card({ status: "stopped" })} hasNextSequence {...handlers} />);
    fireEvent.click(screen.getByRole("button", { name: "关闭任务" }));
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it("disables restart and skip while running; stop is enabled", () => {
    render(<ExecCardView card={card()} hasNextSequence {...handlers} />);
    expect((screen.getByRole("button", { name: "重新" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "下一条" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "下一条" }).textContent?.trim() ?? "").toMatch(/^\s*$/);
    expect((screen.getByRole("button", { name: "停止" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows restart, continue, and skip when stopped with a next sequence", () => {
    render(<ExecCardView card={card({ status: "stopped" })} hasNextSequence {...handlers} />);
    expect((screen.getByRole("button", { name: "重新" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "继续" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "下一条" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    expect(handlers.onResume).toHaveBeenCalledTimes(1);
  });

  it("keeps next disabled while paused", () => {
    render(<ExecCardView card={card({ status: "paused" })} hasNextSequence {...handlers} />);
    expect((screen.getByRole("button", { name: "下一条" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps skip disabled when stopped with no next sequence", () => {
    render(<ExecCardView card={card({ status: "stopped" })} hasNextSequence={false} {...handlers} />);
    expect((screen.getByRole("button", { name: "下一条" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
