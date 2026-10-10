import type { ProgramItemRunOptions } from "./project-document-types";

export type SlotRunOptions = { nearest: boolean; reverse: boolean; safeGroup: boolean };

export const DEFAULT_SLOT_RUN_OPTIONS: SlotRunOptions = {
  nearest: false,
  reverse: false,
  safeGroup: false,
};

/** 节目条目里存的选项 → 完整开关，未存的项为关 */
export const resolveSlotRunOptions = (
  stored: ProgramItemRunOptions | undefined,
): SlotRunOptions => ({
  nearest: stored?.nearest === true,
  reverse: stored?.reverse === true,
  safeGroup: stored?.safeGroup === true,
});

/** 完整开关 → 节目条目里存的选项：只保留开启项，全关返回 undefined */
export const compactSlotRunOptions = (
  options: SlotRunOptions,
): ProgramItemRunOptions | undefined => {
  const compact: ProgramItemRunOptions = {};
  if (options.nearest) compact.nearest = true;
  if (options.reverse) compact.reverse = true;
  if (options.safeGroup) compact.safeGroup = true;
  return Object.keys(compact).length > 0 ? compact : undefined;
};
