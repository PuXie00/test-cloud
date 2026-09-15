import { useMemo } from "react";
import { ENABLED_VIRTUAL_AXES_BY_CONTROL_TYPE } from "@/app/project/configuration-rules";
import type { ModelPose } from "@/app/project/action-sequence/types";
import { useActionBuilder } from "../components/action-builder/use-action-builder";
import { useControlledObjects } from "../hooks/use-controlled-objects";
import { useProjectStore } from "../hooks/use-project-store";
import { useLivePoseHold } from "./live-pose-hold";
import { mergeHoldPoses, resolveLivePoses } from "./resolve-live-poses";
import { resolvePreviewPoses } from "./resolve-preview-poses";

export const useActionPreviewPoses = (): Map<number, ModelPose> => {
  const { dockMode, sequence, cursorMs } = useActionBuilder();
  const { snapshots } = useControlledObjects();
  const { objects } = useProjectStore();
  const holdingLivePose = useLivePoseHold();

  const virtualAxisObjectIds = useMemo(
    () =>
      new Set(
        objects
          .filter((object) => ENABLED_VIRTUAL_AXES_BY_CONTROL_TYPE[object.controlType].length > 0)
          .map((object) => object.id),
      ),
    [objects],
  );

  const previewPoses = useMemo(
    () => resolvePreviewPoses({ dockMode, sequence, cursorMs, virtualAxisObjectIds }),
    [dockMode, sequence, cursorMs, virtualAxisObjectIds],
  );

  const livePoses = useMemo(
    () =>
      resolveLivePoses(
        snapshots.map((snapshot) => ({
          id: snapshot.descriptor.id,
          positions: snapshot.positions,
        })),
        virtualAxisObjectIds,
      ),
    [snapshots, virtualAxisObjectIds],
  );

  return useMemo(
    () => mergeHoldPoses(previewPoses, livePoses, holdingLivePose),
    [previewPoses, livePoses, holdingLivePose],
  );
};
