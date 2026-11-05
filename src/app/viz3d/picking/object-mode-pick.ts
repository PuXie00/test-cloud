import type { PickTarget } from "../types";

/**
 * 物体模式（除搭建调试外）点选的结果：点到吊点也是选它所在的物体，
 * 吊点紧贴物体顶面，单点物体就在正中，点物体很容易点到它。电机只在电机模式里点选。
 */
export const objectModeSelection = (
  target: PickTarget | null,
): { kind: "object"; id: string } | { kind: "motor"; id: string } | null => {
  if (target === null) return null;
  if (target.kind === "hoist-axis") return { kind: "object", id: target.objectId };
  return target;
};
