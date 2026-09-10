export type SelectionMode = "replace" | "toggle" | "range";

type ModifierKeys = {
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
};

/** Shift wins over Ctrl/Meta (matches timeline action-block). */
export const resolveSelectionMode = (event: ModifierKeys): SelectionMode => {
  if (event.shiftKey) return "range";
  if (event.ctrlKey || event.metaKey) return "toggle";
  return "replace";
};

/** Inclusive slice between anchor and target in orderedIds; missing anchor → [target]. */
export const idsInRange = (
  orderedIds: readonly number[],
  anchorId: number | null | undefined,
  targetId: number,
): number[] => {
  if (!anchorId) return [targetId];
  const anchorIndex = orderedIds.indexOf(anchorId);
  const targetIndex = orderedIds.indexOf(targetId);
  if (anchorIndex < 0 || targetIndex < 0) return [targetId];
  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return orderedIds.slice(start, end + 1);
};
