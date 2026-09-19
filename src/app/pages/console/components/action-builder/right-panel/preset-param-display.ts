import type { PresetParamField } from "@/app/project/action-sequence/preset-registry";
import { msToSeconds, secondsToMs } from "../timeline/timeline-data";

const isStoredMillisecondDurationField = (field: PresetParamField): boolean =>
  field.key === "staggerMs";

export const presetParamDisplayNumber = (field: PresetParamField, stored: number): number =>
  isStoredMillisecondDurationField(field) ? msToSeconds(stored) : stored;

export const presetParamStoredNumber = (field: PresetParamField, displayed: number): number =>
  isStoredMillisecondDurationField(field) ? secondsToMs(displayed) : displayed;
