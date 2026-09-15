// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlLayoutProvider } from "../../hooks/use-control-layout";
import { RightTabPanel } from "./right-tab-panel";

const { modeRef } = vi.hoisted(() => ({
  modeRef: { current: "rehearsal" as "rehearsal" | "show" },
}));

vi.mock("../../hooks/use-console-mode", () => ({
  useConsoleMode: () => ({
    mode: modeRef.current,
    isLocked: false,
    enterShow: vi.fn(),
    exitShow: vi.fn(),
    lock: vi.fn(),
    unlock: vi.fn(),
  }),
}));
vi.mock("./manual-control-tab/manual-control-tab", () => ({
  ManualControlTab: () => <div data-testid="manual-tab" />,
}));
vi.mock("./log-tab/log-tab", () => ({
  LogTab: () => <div data-testid="log-tab" />,
}));
vi.mock("./detail-tab/detail-tab", () => ({
  DetailTab: () => <div data-testid="detail-tab" />,
}));
vi.mock("../program-panel/program-panel", () => ({
  ProgramPanel: () => <div data-testid="program-tab" />,
}));
vi.mock("../../hooks/use-log-stream", () => ({
  useLogStream: () => ({ unreadCount: 7, logs: [], liveTail: true }),
}));

afterEach(() => {
  cleanup();
  modeRef.current = "rehearsal";
});

const renderPanel = () =>
  render(
    <ControlLayoutProvider>
      <RightTabPanel />
    </ControlLayoutProvider>,
  );

describe("RightTabPanel", () => {
  it("orders rehearsal tabs as 手动控制、节目、日志、详情 without a log count", () => {
    renderPanel();
    const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent);
    expect(tabs).toEqual(["手动控制", "节目", "日志", "详情"]);
    expect(screen.queryByRole("tab", { name: /日志 \(\d+\)/ })).toBeNull();
  });

  it("hides 手动控制 in show mode and still omits the log count", () => {
    modeRef.current = "show";
    renderPanel();
    const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent);
    expect(tabs).toEqual(["节目", "日志", "详情"]);
    expect(screen.queryByRole("tab", { name: "手动控制" })).toBeNull();
    expect(screen.queryByRole("tab", { name: /日志 \(\d+\)/ })).toBeNull();
  });
});
