import { useEffect, type MutableRefObject } from "react";
import type { ModelPose } from "@/app/project/action-sequence/types";
import { captureCollisionBasePoses } from "./collision-preview";
import { useOptionalControlledObjects } from "../../hooks/use-controlled-objects";
import { poseFromControlSnapshot } from "../right-tab-panel/manual-control-tab/pose-from-control-snapshot";

export type LivePoseLookup = (objectId: number) => ModelPose | null;

/** 把实时位姿查询放进 ref：遥测刷新只重渲染这里，不带着整个动作页 */
export const LivePoseBridge = ({
  lookupRef,
  collisionPosesRef,
}: {
  lookupRef: MutableRefObject<LivePoseLookup | null>;
  collisionPosesRef: MutableRefObject<() => Map<number, Partial<ModelPose>>>;
}) => {
  const controlled = useOptionalControlledObjects();
  useEffect(() => {
    collisionPosesRef.current = () => captureCollisionBasePoses(controlled?.snapshots ?? []);
    lookupRef.current = controlled
      ? (objectId) => {
          const snapshot = controlled.getById(objectId);
          return snapshot ? poseFromControlSnapshot(snapshot) : null;
        }
      : null;
  }, [controlled, lookupRef, collisionPosesRef]);
  return null;
};
