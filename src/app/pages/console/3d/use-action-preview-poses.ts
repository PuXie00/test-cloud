import { useMemo } from "react";
import { ENABLED_VIRTUAL_AXES_BY_CONTROL_TYPE } from "@/app/project/configuration-rules";
import { resolveActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import type { ModelPose } from "@/app/project/action-sequence/types";
import { useActionBuilder } from "../components/action-builder/use-action-builder";
import { useControlledObjects } from "../hooks/use-controlled-objects";
import { useProjectStore } from "../hooks/use-project-store";
import { mergeHoldPoses, pinLiveAxes, resolveLivePoses } from "./resolve-live-poses";
import { resolvePreviewPoses } from "./resolve-preview-poses";

export const useActionPreviewPoses = (): Map<number, ModelPose> => {
  const { dockMode, sequence, cursorMs, activeRightTab } = useActionBuilder();
  const { snapshots } = useControlledObjects();
  const { objects } = useProjectStore();
  // 「当前位置」开启 ⇔ 手动控制 tab 选中
  const showLivePose = activeRightTab === "manual";

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

  const uncontrolledByObject = useMemo(() => {
    if (dockMode !== "sequence" || !sequence) return null;
    try {
      return resolveActionSequence(sequence).uncontrolledAxesByObject ?? null;
    } catch {
      return null;
    }
  }, [dockMode, sequence]);

  const sequencePoses = useMemo(
    () => pinLiveAxes(previewPoses, uncontrolledByObject, livePoses),
    [previewPoses, uncontrolledByObject, livePoses],
  );

  return useMemo(
    () => mergeHoldPoses(sequencePoses, livePoses, showLivePose),
    [sequencePoses, livePoses, showLivePose],
  );
};
