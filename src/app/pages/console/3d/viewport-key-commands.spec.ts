import { describe, expect, it } from "vitest";
import { resolveViewportKeyCommand } from "./viewport-key-commands";

const key = (code: string, key: string, mods: Partial<Record<"ctrlKey" | "metaKey" | "altKey" | "shiftKey", boolean>> = {}) => ({
  code,
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe("resolveViewportKeyCommand（同 Blender 小键盘）", () => {
  it("1 前、3 右、7 顶；Ctrl 取反方向", () => {
    expect(resolveViewportKeyCommand(key("Numpad1", "1"))).toEqual({ kind: "view", preset: "front" });
    expect(resolveViewportKeyCommand(key("Numpad3", "3"))).toEqual({ kind: "view", preset: "side" });
    expect(resolveViewportKeyCommand(key("Numpad7", "7"))).toEqual({ kind: "view", preset: "top" });
    expect(resolveViewportKeyCommand(key("Numpad1", "1", { ctrlKey: true }))).toEqual({
      kind: "view",
      preset: "back",
    });
    expect(resolveViewportKeyCommand(key("Numpad3", "3", { ctrlKey: true }))).toEqual({
      kind: "view",
      preset: "left",
    });
    // 没有底视图
    expect(resolveViewportKeyCommand(key("Numpad7", "7", { ctrlKey: true }))).toBeNull();
  });

  it("5 切透视 / 正交，Ctrl+Alt+Q 开关四视图", () => {
    expect(resolveViewportKeyCommand(key("Numpad5", "5"))).toEqual({ kind: "toggleOrtho" });
    expect(resolveViewportKeyCommand(key("KeyQ", "q", { ctrlKey: true, altKey: true }))).toEqual({
      kind: "toggleQuad",
    });
  });

  it("主键盘数字、NumLock 关着的小键盘、带 Shift / Alt 都不算", () => {
    expect(resolveViewportKeyCommand(key("Digit1", "1"))).toBeNull();
    expect(resolveViewportKeyCommand(key("Numpad1", "End"))).toBeNull();
    expect(resolveViewportKeyCommand(key("Numpad7", "7", { shiftKey: true }))).toBeNull();
    expect(resolveViewportKeyCommand(key("Numpad7", "7", { altKey: true }))).toBeNull();
    expect(resolveViewportKeyCommand(key("KeyQ", "q", { ctrlKey: true }))).toBeNull();
  });
});
