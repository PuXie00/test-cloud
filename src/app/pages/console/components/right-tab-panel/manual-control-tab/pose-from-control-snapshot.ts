import type { ModelPose } from "@/app/project/action-sequence/types";
import type { ControlledObjectSnapshot } from "../../monitor-grid/monitor-data";

/** Capture pose from control telemetry: live height (`positions.h`) as v1; v2/v3 stay 0. */
export const poseFromControlSnapshot = (
  snapshot: Pick<ControlledObjectSnapshot, "positions">,
): ModelPose => ({
  v1: snapshot.positions?.h ?? 0,
  v2: 0,
  v3: 0,
});
