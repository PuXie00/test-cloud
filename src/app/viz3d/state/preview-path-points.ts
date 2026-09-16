import type { SceneObjectConfig, Vec3, VirtualAxisValues } from "../types";
import { resolveVirtualAxisTransform } from "../telemetry/virtual-axis-mapper";

export const previewPathPoints = (config: SceneObjectConfig, poses: VirtualAxisValues[]): Vec3[] =>
  poses.map((pose) => resolveVirtualAxisTransform(config, pose).position);
