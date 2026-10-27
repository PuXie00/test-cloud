// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppMenuPanel } from "./app-menu-panel";

afterEach(() => cleanup());

describe("AppMenuPanel 按权限隐藏", () => {
  it("隐藏的菜单项不显示，整组都隐藏时不留空分组", () => {
    render(
      <AppMenuPanel
        open
        onClose={vi.fn()}
        hiddenItems={new Set(["save", "save-as", "undo", "redo", "permissions"])}
      />,
    );
    expect(screen.queryByRole("button", { name: "保存工程" })).toBeNull();
    expect(screen.queryByRole("button", { name: "用户与权限" })).toBeNull();
    expect(screen.queryByRole("button", { name: "撤销" })).toBeNull();
    expect(screen.getByRole("button", { name: "工程管理" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "切换用户" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "退出登录" })).toBeTruthy();
    // 撤销 / 重做那组整组隐藏后，分隔线只剩组与组之间
    expect(screen.getAllByRole("separator")).toHaveLength(3);
  });

  it("切换用户先关菜单再打开登录框", () => {
    const onClose = vi.fn();
    const onSwitchUser = vi.fn();
    render(<AppMenuPanel open onClose={onClose} onSwitchUser={onSwitchUser} />);
    fireEvent.click(screen.getByRole("button", { name: "切换用户" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSwitchUser).toHaveBeenCalledTimes(1);
  });
});
