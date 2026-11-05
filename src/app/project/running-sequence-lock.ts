import type { ActionSequenceConfig } from "./action-sequence/types";

/** 动作正在运行时的提示（actionId 即序列 id） */
export const runningSequenceMessage = (names: readonly string[], action: string): string =>
  `${names.map((name) => `「${name}」`).join("")}正在运行，停下后再${action}`;

/**
 * 正在运行的动作序列被改动或删掉时返回提示，否则 null。
 * 写入工程会整体复制序列，引用不同时按内容比较。
 */
export const runningSequenceEditBlock = (
  previous: readonly ActionSequenceConfig[],
  next: readonly ActionSequenceConfig[],
  runningIds: ReadonlySet<number>,
): string | null => {
  for (const id of runningIds) {
    const before = previous.find((item) => item.id === id);
    if (!before) continue;
    const after = next.find((item) => item.id === id);
    if (after === before) continue;
    if (after && JSON.stringify(after) === JSON.stringify(before)) continue;
    return runningSequenceMessage([before.name], "修改");
  }
  return null;
};
