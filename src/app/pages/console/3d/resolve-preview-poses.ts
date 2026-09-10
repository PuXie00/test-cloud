import { evaluateResolvedSequence } from "@/app/project/action-sequence/evaluate-sequence";
import { resolveActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import type { ActionSequenceConfig, ModelPose } from "@/app/project/action-sequence/types";
import type { EditorDockMode } from "../components/action-builder/action-builder-context-types";
import type { CueItem } from "../components/action-builder/timeline/timeline-data";

export type PreviewPoseInput = {
  dockMode: EditorDockMode;
  cue: CueItem | null;
  sequence: ActionSequenceConfig | null;
  cursorMs: number;
  virtualAxisObjectIds?: ReadonlySet<number>;
};

const INSTALL_POSE: ModelPose = { v1: 0, v2: 0, v3: 0 };

const poseFromTarget = (target: CueItem["targets"][string]): ModelPose => ({
  v1: target.v1 ?? 0,
  v2: target.v2 ?? 0,
  v3: target.v3 ?? 0,
});

const installPoses = (ids: ReadonlySet<number> | undefined): Map<number, ModelPose> => {
  const poses = new Map<number, ModelPose>();
  for (const id of ids ?? []) poses.set(id, { ...INSTALL_POSE });
  return poses;
};

const shouldUseInstallPose = (input: PreviewPoseInput): boolean => {
  if (input.dockMode === "empty") return true;
  if (input.dockMode === "cue") return !input.cue;
  if (input.dockMode === "sequence") return !input.sequence;
  return false;
};

export const resolvePreviewPoses = (input: PreviewPoseInput): Map<number, ModelPose> => {
  if (shouldUseInstallPose(input)) return installPoses(input.virtualAxisObjectIds);

  if (input.dockMode === "cue" && input.cue) {
    const poses = new Map<number, ModelPose>();
    for (const [objectId, target] of Object.entries(input.cue.targets)) {
      const id = Number(objectId);
      if (!Number.isFinite(id)) continue;
      poses.set(id, poseFromTarget(target));
    }
    return poses;
  }

  if (input.dockMode === "sequence" && input.sequence) {
    try {
      return evaluateResolvedSequence(resolveActionSequence(input.sequence), input.cursorMs);
    } catch {
      return new Map();
    }
  }

  return new Map();
};
