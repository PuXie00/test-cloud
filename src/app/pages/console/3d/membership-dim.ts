import { sequenceObjectIds } from "@/app/project/action-sequence/sequence-object-ids";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import type { LeftNavId } from "../components/LeftSidebar";
import type { EditorDockMode } from "../components/action-builder/action-builder-context-types";

export type MembershipDimInput = {
  activeNav: LeftNavId;
  dockMode: EditorDockMode;
  sequence: ActionSequenceConfig | null;
  allObjectIds: number[];
  pickedObjectIds: number[];
};

const nonEmptyOrNull = (ids: Iterable<number>): Set<number> | null => {
  const set = new Set(ids);
  return set.size === 0 ? null : set;
};

/** 当前序列的成员集合；null 表示不做变淡 */
export const resolveMemberObjectIds = (input: MembershipDimInput): Set<number> | null => {
  if (input.activeNav !== "sequences") return null;
  if (input.dockMode !== "sequence" || !input.sequence) return null;
  return nonEmptyOrNull(sequenceObjectIds(input.sequence));
};

/** 需要变淡的物体：非成员且未被 3D 选中 */
export const resolveDimmedObjectIds = (input: MembershipDimInput): number[] => {
  const members = resolveMemberObjectIds(input);
  if (members === null) return [];
  const picked = new Set(input.pickedObjectIds);
  return input.allObjectIds.filter((id) => !members.has(id) && !picked.has(id));
};
