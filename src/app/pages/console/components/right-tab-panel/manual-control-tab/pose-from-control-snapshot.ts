import type { ModelPose } from "@/app/project/action-sequence/types";
import type {
  ControlledObjectDescriptor,
  ControlledObjectSnapshot,
} from "../../monitor-grid/monitor-data";

/**
 * Capture pose from control telemetry: live h / p / y become v1 / v2 / v3 for the object's
 * enabled axes (descriptor dimensions, in v1→v3 order); axes the object doesn't have stay 0.
 */
export const poseFromControlSnapshot = (
  snapshot: Pick<ControlledObjectSnapshot, "positions"> & {
    descriptor: Pick<ControlledObjectDescriptor, "dimensions">;
  },
): ModelPose => {
  const axisCount = snapshot.descriptor.dimensions.length;
  const live = snapshot.positions;
  return {
    v1: axisCount >= 1 ? (live?.h ?? 0) : 0,
    v2: axisCount >= 2 ? (live?.p ?? 0) : 0,
    v3: axisCount >= 3 ? (live?.y ?? 0) : 0,
  };
};
