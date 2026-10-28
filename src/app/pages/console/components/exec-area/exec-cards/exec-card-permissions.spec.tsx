// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TestPermissionsProvider } from "@/app/auth/permissions";
import type { ExecCard } from "../../../hooks/use-exec-cards";
import { ExecCardView } from "./exec-card";

afterEach(() => cleanup());

const handlers = {
  onStop: vi.fn(),
  onContinue: vi.fn(),
  onReverseBack: vi.fn(),
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

describe("任务卡按权限显示", () => {
  it("没有「运行动作」：停止照常可点，调速只读，关闭任务不显示", () => {
    render(
      <TestPermissionsProvider permissions={[]}>
        <ExecCardView card={card()} hasNextSequence {...handlers} />
      </TestPermissionsProvider>,
    );
    expect(screen.getByRole("button", { name: /停止/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "关闭任务" })).toBeNull();
    expect(screen.queryByRole("button", { name: "下一条" })).toBeNull();
    expect((screen.getByRole("slider", { name: "速度倍率" }) as HTMLInputElement).disabled).toBe(true);
  });

  it("没有「运行动作」时停下的任务没有继续 / 反向回", () => {
    render(
      <TestPermissionsProvider permissions={[]}>
        <ExecCardView card={card({ status: "stopped" })} hasNextSequence {...handlers} />
      </TestPermissionsProvider>,
    );
    expect(screen.queryByRole("button", { name: /继续/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "反向回" })).toBeNull();
  });

  it("没有「运行动作」时结束的任务也没有关闭 / 反向回", () => {
    render(
      <TestPermissionsProvider permissions={[]}>
        <ExecCardView card={card({ status: "completed" })} hasNextSequence {...handlers} />
      </TestPermissionsProvider>,
    );
    expect(screen.getByText("已结束")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /关闭/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "反向回" })).toBeNull();
  });

  it("有「运行动作」时继续、反向回、下一条都在", () => {
    render(
      <TestPermissionsProvider permissions={["control.run"]}>
        <ExecCardView card={card({ status: "stopped" })} hasNextSequence {...handlers} />
      </TestPermissionsProvider>,
    );
    expect(screen.getByRole("button", { name: /继续/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "反向回" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "下一条" })).toBeTruthy();
    expect((screen.getByRole("slider", { name: "速度倍率" }) as HTMLInputElement).disabled).toBe(false);
  });
});
