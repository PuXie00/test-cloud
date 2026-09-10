import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
import type { Scene } from "@babylonjs/core/scene";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AxesConfig } from "../types";

/**
 * Blender move-gizmo axis colors sampled from the UI reference:
 * X #ef4258, Y #85ce30, Z #3c8aef.
 */
export const VIZ3D_AXIS_COLORS = {
  x: { r: 239 / 255, g: 66 / 255, b: 88 / 255 },
  y: { r: 133 / 255, g: 206 / 255, b: 48 / 255 },
  z: { r: 60 / 255, g: 138 / 255, b: 239 / 255 },
} as const;

export type Viz3dAxisId = keyof typeof VIZ3D_AXIS_COLORS;

export const viz3dAxisCssColor = (axis: Viz3dAxisId, alpha = 1): string => {
  const { r, g, b } = VIZ3D_AXIS_COLORS[axis];
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`;
};

const axisColor4 = (axis: Viz3dAxisId, alpha = 1): Color4 => {
  const { r, g, b } = VIZ3D_AXIS_COLORS[axis];
  return new Color4(r, g, b, alpha);
};

export const resolveAxesConfig = (input: Partial<AxesConfig> = {}): AxesConfig => ({
  size: input.size && input.size > 0 ? input.size : 1,
});

export const createAxesHelper = (scene: Scene, size: number): LinesMesh => {
  const safeSize = size > 0 ? size : 1;
  const axes = MeshBuilder.CreateLines(
    "viz3d-axes",
    {
      points: [
        new Vector3(0, 0, 0),
        new Vector3(safeSize, 0, 0),
        new Vector3(0, 0, 0),
        new Vector3(0, safeSize, 0),
        new Vector3(0, 0, 0),
        new Vector3(0, 0, safeSize),
      ],
      colors: [
        axisColor4("x"),
        axisColor4("x"),
        axisColor4("y"),
        axisColor4("y"),
        axisColor4("z"),
        axisColor4("z"),
      ],
    },
    scene,
  );
  axes.isPickable = false;
  return axes;
};
