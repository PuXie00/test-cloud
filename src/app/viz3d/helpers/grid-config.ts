import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
import type { Scene } from "@babylonjs/core/scene";
import { hexToColor3 } from "../babylon/utils";
import type { GridSizeM, Viz3DColorMap } from "../types";

/** 地面网格总尺寸预设（米）；cell 固定 DEFAULT_GRID_CELL_M */
export const GRID_SIZE_PRESETS = [10, 20, 40, 80] as const satisfies readonly GridSizeM[];
export const DEFAULT_GRID_SIZE_M: GridSizeM = 20;
export const DEFAULT_GRID_CELL_M = 0.5;

export const isGridSizeM = (value: unknown): value is GridSizeM =>
  typeof value === "number" && (GRID_SIZE_PRESETS as readonly number[]).includes(value);

export const normalizeGridSizeM = (value: unknown): GridSizeM =>
  isGridSizeM(value) ? value : DEFAULT_GRID_SIZE_M;

export type ResolveGridInput = {
  size: number;
  cell: number;
  colors: Viz3DColorMap;
  scene: Scene;
};

export const resolveGridConfig = ({ size, cell, colors }: Omit<ResolveGridInput, "scene">) => {
  const divisions = cell > 0 ? Math.max(1, Math.round(size / cell)) : 1;

  return {
    size,
    divisions,
    color: colors.muted,
    centerColor: colors.border,
  };
};

export const createGroundGrid = ({ size, cell, colors, scene }: ResolveGridInput): LinesMesh => {
  const config = resolveGridConfig({ size, cell, colors });
  const half = config.size / 2;
  const step = config.size / config.divisions;
  const lines: Vector3[][] = [];
  const lineColor = hexToColor3(config.color);

  for (let i = 0; i <= config.divisions; i += 1) {
    const offset = -half + i * step;
    const isCenter = i === config.divisions / 2;
    void isCenter;
    lines.push([new Vector3(-half, 0, offset), new Vector3(half, 0, offset)]);
    lines.push([new Vector3(offset, 0, -half), new Vector3(offset, 0, half)]);
  }

  const grid = MeshBuilder.CreateLineSystem(
    "viz3d-ground-grid",
    { lines, updatable: false },
    scene,
  );
  grid.color = lineColor;
  grid.isPickable = false;
  return grid;
};




// import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
// import type { Mesh } from "@babylonjs/core/Meshes/mesh";
// import type { Scene } from "@babylonjs/core/scene";
// import { GridMaterial } from "../babylon/grid-material";
// import { hexToColor3 } from "../babylon/utils";
// import type { GridSizeM, Viz3DColorMap } from "../types";

// /** 地面网格总尺寸预设（米）；cell 固定 DEFAULT_GRID_CELL_M */
// export const GRID_SIZE_PRESETS = [10, 20, 40, 80] as const satisfies readonly GridSizeM[];
// export const DEFAULT_GRID_SIZE_M: GridSizeM = 20;
// export const DEFAULT_GRID_CELL_M = 0.5;

// export const isGridSizeM = (value: unknown): value is GridSizeM =>
//   typeof value === "number" && (GRID_SIZE_PRESETS as readonly number[]).includes(value);

// export const normalizeGridSizeM = (value: unknown): GridSizeM =>
//   isGridSizeM(value) ? value : DEFAULT_GRID_SIZE_M;

// export type ResolveGridInput = {
//   size: number;
//   cell: number;
//   colors: Viz3DColorMap;
//   scene: Scene;
// };

// export const createGroundGrid = ({ size, cell, colors, scene }: ResolveGridInput): Mesh => {
//   const material = new GridMaterial("viz3d-ground-grid-material", scene);
//   // 主色与视口底色一致，地面仅呈现网格线，保持「虚空」景深
//   material.mainColor = hexToColor3(colors.canvas);
//   material.lineColor = hexToColor3(colors.muted);
//   // gridRatio 为单个网格的世界单位尺寸；majorUnitFrequency=1 使所有线等宽一致
//   material.gridRatio = cell > 0 ? cell : DEFAULT_GRID_CELL_M;
//   material.majorUnitFrequency = 1000;

//   // material.minorUnitVisibility = 1;

//   const ground = MeshBuilder.CreateGround(
//     "viz3d-ground-grid",
//     { width: size, height: size },
//     scene,
//   );
//   ground.material = material;
//   ground.isPickable = false;
//   // 略低于地面，避免与恰好贴地的对象底面产生 z-fighting
//   ground.position.y = -0.02;
//   material.backFaceCulling = false;

//   return ground;
// };
