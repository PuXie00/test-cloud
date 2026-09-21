import type {
  ActionSequenceConfig,
} from "@/app/project/action-sequence/types";
import type { ControlledObject } from "./timeline/timeline-data";

export type TimelineObjectLookup = (objectId: number) => ControlledObject | undefined;

export const DEFAULT_BLOCK_MS = 3000;

export const nextId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export const createEmptySequence = (id: number, name?: string): ActionSequenceConfig => ({
  id,
  name: name ?? "新建动作序列",
  trajectoryMode: false,
  loop: false,
  blocks: [],
  segments: [],
});
