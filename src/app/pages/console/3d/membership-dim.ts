import { sequenceObjectIds } from "@/app/project/action-sequence/sequence-object-ids";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import type { LeftNavId } from "../components/LeftSidebar";
import type {
  EditorDockMode,
  TransitionDraft,
} from "../components/action-builder/action-builder-context-types";
import type { CueItem } from "../components/action-builder/timeline/timeline-data";

export type MembershipDimInput = {
  activeNav: LeftNavId;
  dockMode: EditorDockMode;
  sequence: ActionSequenceConfig | null;
  cues: CueItem[];
  selectedCueId: string | null;
  transitionDraft: TransitionDraft | null;
  allObjectIds: number[];
  pickedObjectIds: number[];
};

const cueTargetIds = (cues: CueItem[], cueId: string | null): number[] => {
  if (cueId === null) return [];
  const cue = cues.find((item) => item.id === cueId);
  if (!cue) return [];
  return Object.keys(cue.targets).map(Number);
};

const nonEmptyOrNull = (ids: Iterable<number>): Set<number> | null => {
  const set = new Set(ids);
  return set.size === 0 ? null : set;
};

/** 当前序列 / Cue 的成员集合；null 表示不做变淡 */
export const resolveMemberObjectIds = (input: MembershipDimInput): Set<number> | null => {
  if (input.activeNav !== "sequences") return null;
  if (input.dockMode === "empty") return null;
  if (input.dockMode === "cue") return nonEmptyOrNull(cueTargetIds(input.cues, input.selectedCueId));
  if (input.dockMode === "sequence") {
    if (!input.sequence) return null;
    return nonEmptyOrNull(sequenceObjectIds(input.sequence));
  }
  if (!input.transitionDraft) return null;
  return nonEmptyOrNull([
    ...cueTargetIds(input.cues, input.transitionDraft.fromCueId),
    ...cueTargetIds(input.cues, input.transitionDraft.toCueId),
  ]);
};

/** 需要变淡的物体：非成员且未被 3D 选中 */
export const resolveDimmedObjectIds = (input: MembershipDimInput): number[] => {
  const members = resolveMemberObjectIds(input);
  if (members === null) return [];
  const picked = new Set(input.pickedObjectIds);
  return input.allObjectIds.filter((id) => !members.has(id) && !picked.has(id));
};
