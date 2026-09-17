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
    expect(screen.queryByText("Seq")).toBeNull();
    expect(screen.queryByText("强制")).toBeNull();
  });

  it("shows 强制 only for a forced-trajectory sequence", () => {
    render(
      <ExecCardView
        card={card({ trajectoryMode: "forced" })}
        hasNextSequence
        {...handlers}
      />,
    );
    expect(screen.getByText("强制")).toBeTruthy();
    expect(screen.queryByText("Seq")).toBeNull();
  });

  it("disables restart and skip while running; stop is enabled", () => {
    render(<ExecCardView card={card()} hasNextSequence {...handlers} />);
    expect((screen.getByRole("button", { name: "重新" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "跳过" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "跳过" }).textContent?.trim() ?? "").toMatch(/^\s*$/);
    expect((screen.getByRole("button", { name: "停止" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows restart, continue, and skip when stopped with a next sequence", () => {
    render(<ExecCardView card={card({ status: "stopped" })} hasNextSequence {...handlers} />);
    expect((screen.getByRole("button", { name: "重新" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "继续" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "跳过" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    expect(handlers.onResume).toHaveBeenCalledTimes(1);
  });

  it("keeps skip disabled when stopped with no next sequence", () => {
    render(<ExecCardView card={card({ status: "stopped" })} hasNextSequence={false} {...handlers} />);
    expect((screen.getByRole("button", { name: "跳过" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
