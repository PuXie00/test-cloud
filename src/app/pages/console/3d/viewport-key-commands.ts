import type { ViewPreset } from "@/app/viz3d";

export type ViewportKeyCommand =
  | { kind: "view"; preset: ViewPreset }
  | { kind: "toggleOrtho" }
  | { kind: "toggleQuad" };

type KeyLike = Pick<KeyboardEvent, "code" | "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;

/**
 * 视口快捷键，照 Blender：小键盘 1 前、3 右、7 顶，Ctrl+1 后、Ctrl+3 左，5 透视 / 正交；
 * Ctrl+Alt+Q 四视图开关。小键盘只认 NumLock 开着时（key 是数字），关着时那几个键是方向键。
 */
export const resolveViewportKeyCommand = (event: KeyLike): ViewportKeyCommand | null => {
  const mod = event.ctrlKey || event.metaKey;
  if (mod && event.altKey && !event.shiftKey && event.code === "KeyQ") {
    return { kind: "toggleQuad" };
  }
  if (event.altKey || event.shiftKey || !/^\d$/.test(event.key)) {
    return null;
  }
  switch (event.code) {
    case "Numpad1":
      return { kind: "view", preset: mod ? "back" : "front" };
    case "Numpad3":
      return { kind: "view", preset: mod ? "left" : "side" };
    case "Numpad7":
      // Blender 的 Ctrl+7 是底视图，这里没有
      return mod ? null : { kind: "view", preset: "top" };
    case "Numpad5":
      return mod ? null : { kind: "toggleOrtho" };
    default:
      return null;
  }
};
