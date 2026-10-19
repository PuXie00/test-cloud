import type { MouseEvent, ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/app/components/ui/context-menu";
import { isAppleHistoryShortcutPlatform } from "@/app/project/project-history-shortcuts";

export type ClipboardShortcut = "copy" | "paste";

/** 复制 / 粘贴之前的其它菜单项，如序列库的「重命名」 */
export type ContextMenuAction = {
  label: string;
  disabled?: boolean;
  onSelect: () => void;
};

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
};

type ShortcutEvent = Pick<
  globalThis.KeyboardEvent,
  "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey" | "target"
>;

/** Ctrl/⌘+C、Ctrl/⌘+V；输入框里的按键不拦，留给文本复制粘贴 */
export const clipboardShortcutOf = (event: ShortcutEvent): ClipboardShortcut | null => {
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
  /** 菜单项是否显示 Ctrl/⌘+C / V 提示；没有快捷键的列表传 false */
  showShortcuts?: boolean;
  actions?: readonly ContextMenuAction[];
};

/** 动作序列库、时间轴共用的右键“复制 / 粘贴”菜单；快捷键只作用于时间轴动作块 */
export const ClipboardContextMenu = ({
  children,
  copyLabel,
  pasteLabel,
  canCopy,
  canPaste,
  onCopy,
  onPaste,
  onContextMenu,
  showShortcuts = true,
  actions = [],
}: ClipboardContextMenuProps) => (
  <ContextMenu>
    <ContextMenuTrigger asChild onContextMenu={onContextMenu}>
      {children}
    </ContextMenuTrigger>
    <ContextMenuContent className="min-w-[11rem] border-border bg-card text-foreground shadow-[0_4px_24px_rgba(0,0,0,0.4)]">
      {actions.map((action) => (
        <ContextMenuItem
          key={action.label}
          className="text-body-sm"
          disabled={action.disabled}
          onSelect={action.onSelect}
        >
          {action.label}
        </ContextMenuItem>
      ))}
      {actions.length > 0 ? <ContextMenuSeparator /> : null}
      <ContextMenuItem className="text-body-sm" disabled={!canCopy} onSelect={onCopy}>
        {copyLabel}
        {showShortcuts ? <ContextMenuShortcut>{shortcutHint("C")}</ContextMenuShortcut> : null}
      </ContextMenuItem>
      <ContextMenuItem className="text-body-sm" disabled={!canPaste} onSelect={onPaste}>
        {pasteLabel}
        {showShortcuts ? <ContextMenuShortcut>{shortcutHint("V")}</ContextMenuShortcut> : null}
      </ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>
);
