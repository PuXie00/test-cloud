import { nextId } from "@/app/pages/console/components/action-builder/action-builder-ops";
import type { ActionSequenceConfig, ModelPose, TimelineBlock } from "./action-sequence/types";

/** 「保存当前位姿」：所选物体及按实时位置取位姿的函数 */
export type CapturedPoseRequest = {
  objectIds: readonly number[];
  poseForObject: (objectId: number) => ModelPose | null;
};

export const buildCapturedPoseSequence = (
  args: CapturedPoseRequest & { id: number; name: string },
): ActionSequenceConfig | null => {
  const blocks: TimelineBlock[] = [];
  for (const objectId of args.objectIds) {
    const pose = args.poseForObject(objectId);
    if (!pose) continue;
    blocks.push({
      id: nextId("blk"),
      kind: "pose",
      objectId,
      atMs: 0,
      pose,
    });
  }
  if (blocks.length === 0) return null;
  return {
    id: args.id,
    name: args.name,
    trajectoryMode: false,
    loop: false,
    blocks,
    segments: [],
  };
};
