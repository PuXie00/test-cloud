import type { RuntimeTransform, SceneObjectConfig, VirtualAxisValues } from "../types";

export const MM_TO_M = 0.001;
export const DEG_TO_RAD = Math.PI / 180;

const cloneVec3 = (v: { x: number; y: number; z: number }) => ({
  x: v.x,
  y: v.y,
  z: v.z,
});

export const resolveVirtualAxisTransform = (
  base: SceneObjectConfig,
  values: VirtualAxisValues,
): RuntimeTransform => {
  const position = cloneVec3(base.position);
  const rotation = { x: 0, y: 0, z: 0 };
  const dir = base.modelRunDirection === 2 ? -1 : 1;

  for (const motion of base.virtualAxes ?? []) {
    const delta = (values[motion.axis] ?? 0) * dir;
    switch (motion.kind) {
      case "move":
        position.y += delta * MM_TO_M;
        break;
      case "rotation":
        rotation.y += delta * DEG_TO_RAD;
        break;
      case "swingX":
        rotation.x += delta * DEG_TO_RAD;
        break;
      case "swingY":
      case "yawY":
        rotation.y += delta * DEG_TO_RAD;
        break;
    }
  }

  return { position, rotation };
};
