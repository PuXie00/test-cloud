import { nextId } from "@/app/pages/console/components/action-builder/action-builder-ops";
import type {
  ActionSequenceConfig,
  KeyframePose,
  ModelPose,
  TimelineBlock,
} from "./action-sequence/types";

/** 「保存当前位姿」：所选物体及按实时位置取位姿的函数 */
export type CapturedPoseRequest = {
  objectIds: readonly number[];
  poseForObject: (objectId: number) => ModelPose | null;
};

/** 新建一条单帧动作序列（造型）：每个物体一个位姿，都在 0 s；位姿可以只设部分轴 */
export const buildCapturedPoseSequence = (args: {
  objectIds: readonly number[];
  poseForObject: (objectId: number) => KeyframePose | null;
  id: number;
  name: string;
}): ActionSequenceConfig | null => {
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
