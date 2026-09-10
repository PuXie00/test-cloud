/**
 * Identifies DOM targets that should keep native editing shortcuts
 * (e.g. Ctrl+Z) instead of project configuration Undo/Redo.
 *
 * Readonly/disabled controls return false so Task 9 can route those
 * keystrokes to global history.
 */
export const isEditableHistoryTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  ) {
    return !target.readOnly && !target.disabled;
  }

  if (target instanceof HTMLSelectElement) {
    return !target.disabled;
  }

  if (target.isContentEditable) {
    return true;
  }

  // Prefer the IDL property: jsdom may leave isContentEditable unset and omit the attribute.
  const mode = target.contentEditable;
  if (mode === "true" || mode === "plaintext-only") {
    return true;
  }

  const attr = target.getAttribute("contenteditable");
  return attr != null && attr !== "false";
};

export type ProjectHistoryShortcutAction = "undo" | "redo";

type HistoryShortcutEvent = Pick<
  KeyboardEvent,
  "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey" | "target"
>;

/**
 * Resolves project configuration Undo/Redo shortcuts.
 * Returns null for editable targets (native-then-global) or non-matching keys.
 */
export const resolveProjectHistoryShortcut = (
  event: HistoryShortcutEvent,
): ProjectHistoryShortcutAction | null => {
  if (event.altKey) {
    return null;
  }
  if (!event.ctrlKey && !event.metaKey) {
    return null;
  }
  if (isEditableHistoryTarget(event.target)) {
    return null;
  }

  const key = event.key.toLowerCase();
  if (key === "z") {
    return event.shiftKey ? "redo" : "undo";
  }
  // Ctrl/Meta+Y redo; Shift+Y must not alias redo.
  if (key === "y" && !event.shiftKey) {
    return "redo";
  }
  return null;
};

export const isAppleHistoryShortcutPlatform = (
  platform = typeof navigator === "undefined" ? "" : navigator.platform,
): boolean => /Mac|iPhone|iPad|iPod/i.test(platform);

/** Visible shortcut hint for tooltips / aria-label (platform localized). */
export const formatProjectHistoryShortcutHint = (
  action: ProjectHistoryShortcutAction,
  platform = typeof navigator === "undefined" ? "" : navigator.platform,
): string => {
  const apple = isAppleHistoryShortcutPlatform(platform);
  if (action === "undo") {
    return apple ? "⌘Z" : "Ctrl+Z";
  }
  return apple ? "⇧⌘Z" :  "Ctrl+Y";
};

/**
 * Standard aria-keyshortcuts tokens (space-separated alternatives).
 * @see https://www.w3.org/TR/wai-aria-1.2/#aria-keyshortcuts
 */
export const formatProjectHistoryAriaKeyshortcuts = (
  action: ProjectHistoryShortcutAction,
  platform = typeof navigator === "undefined" ? "" : navigator.platform,
): string => {
  const apple = isAppleHistoryShortcutPlatform(platform);
  if (action === "undo") {
    return apple ? "Meta+Z" : "Control+Z";
  }
  return apple ? "Meta+Shift+Z" : "Control+Shift+Z Control+Y";
};
