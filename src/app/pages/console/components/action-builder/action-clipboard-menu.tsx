import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/app/components/ui/context-menu";
import { isAppleHistoryShortcutPlatform } from "@/app/project/project-history-shortcuts";

export type ClipboardShortcut = "copy" | "paste";

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
};

/** Ctrl/⌘+C、Ctrl/⌘+V；输入框里的按键不拦，留给文本复制粘贴 */
export const clipboardShortcutOf = (event: KeyboardEvent): ClipboardShortcut | null => {
  if (isEditableTarget(event.target)) return null;
  if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === "c") return "copy";
  if (key === "v") return "paste";
  return null;
};

const shortcutHint = (key: "C" | "V"): string =>
  isAppleHistoryShortcutPlatform() ? `⌘${key}` : `Ctrl+${key}`;

type ClipboardContextMenuProps = {
  children: ReactNode;
  copyLabel: string;
  pasteLabel: string;
  canCopy: boolean;
  canPaste: boolean;
  onCopy: () => void;
  onPaste: () => void;
  /** 右键时先于菜单打开调用，用来记下右键点到的是哪一项 */
  onContextMenu?: (event: MouseEvent<HTMLElement>) => void;
};

/** 动作序列库、时间轴共用的右键“复制 / 粘贴”菜单 */
export const ClipboardContextMenu = ({
  children,
  copyLabel,
  pasteLabel,
  canCopy,
  canPaste,
  onCopy,
  onPaste,
  onContextMenu,
}: ClipboardContextMenuProps) => (
  <ContextMenu>
    <ContextMenuTrigger asChild onContextMenu={onContextMenu}>
      {children}
    </ContextMenuTrigger>
    <ContextMenuContent className="min-w-[11rem] border-border bg-card text-foreground shadow-[0_4px_24px_rgba(0,0,0,0.4)]">
      <ContextMenuItem className="text-body-sm" disabled={!canCopy} onSelect={onCopy}>
        {copyLabel}
        <ContextMenuShortcut>{shortcutHint("C")}</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem className="text-body-sm" disabled={!canPaste} onSelect={onPaste}>
        {pasteLabel}
        <ContextMenuShortcut>{shortcutHint("V")}</ContextMenuShortcut>
      </ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>
);
