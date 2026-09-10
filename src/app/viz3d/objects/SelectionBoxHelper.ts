import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateGreasedLine } from "@babylonjs/core/Meshes/Builders/greasedLineBuilder";
import { GreasedLineMesh } from "@babylonjs/core/Meshes/GreasedLine/greasedLineMesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { GreasedLineSimpleMaterial } from "@babylonjs/core/Materials/GreasedLine/greasedLineSimpleMaterial";
import { GreasedLineMeshMaterialType } from "@babylonjs/core/Materials/GreasedLine/greasedLineMaterialInterfaces";
import type { WorldBounds } from "../babylon/utils";
import { getWorldBounds, getNodeMetadata, hexStringToColor3, setNodeMetadata } from "../babylon/utils";
import type { Vec3 } from "../types";

const BOX_NAME = "viz3d-selection-box";
const BOUNDS_TARGET_KEY = "viz3dBoundsTarget";
const BOUNDS_CACHE_KEY = "viz3dBoundsCache";
const EDGE_PATHS_KEY = "viz3dEdgePaths";
const BOUNDS_EPSILON = 1e-4;

/** Screen-space line width when sizeAttenuation is enabled. */
const SELECTION_LINE_WIDTH = 3.5;

const BOX_EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 4],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

const buildMaterialOptions = (colorHex: string) => ({
  width: SELECTION_LINE_WIDTH,
  sizeAttenuation: true,
  color: hexStringToColor3(colorHex),
  materialType: GreasedLineMeshMaterialType.MATERIAL_TYPE_SIMPLE,
  createAndAssignMaterial: true,
});

const boundsEqual = (a: Vec3, b: Vec3): boolean =>
  Math.abs(a.x - b.x) <= BOUNDS_EPSILON &&
  Math.abs(a.y - b.y) <= BOUNDS_EPSILON &&
  Math.abs(a.z - b.z) <= BOUNDS_EPSILON;

const boundsChanged = (next: WorldBounds, cached: WorldBounds): boolean =>
  !boundsEqual(next.min, cached.min) || !boundsEqual(next.max, cached.max);

const createEdgePaths = (): Vector3[][] => {
  const corners = Array.from({ length: 8 }, () => new Vector3());
  return BOX_EDGES.map(([a, b]) => [corners[a], corners[b]]);
};

const getEdgePaths = (helper: GreasedLineMesh): Vector3[][] => {
  const paths = getNodeMetadata(helper, EDGE_PATHS_KEY) as Vector3[][] | undefined;
  if (!paths) {
    throw new Error("Selection box helper is missing reusable edge paths");
  }
  return paths;
};

const writeBoundsToEdgePaths = (bounds: WorldBounds, paths: Vector3[][]): void => {
  const { min, max } = bounds;
  const corners = [
    paths[0][0],
    paths[0][1],
    paths[1][1],
    paths[2][1],
    paths[4][0],
    paths[4][1],
    paths[5][1],
    paths[6][1],
  ];

  corners[0].set(min.x, min.y, min.z);
  corners[1].set(max.x, min.y, min.z);
  corners[2].set(max.x, min.y, max.z);
  corners[3].set(min.x, min.y, max.z);
  corners[4].set(min.x, max.y, min.z);
  corners[5].set(max.x, max.y, min.z);
  corners[6].set(max.x, max.y, max.z);
  corners[7].set(min.x, max.y, max.z);
};

const refreshGreasedLine = (helper: GreasedLineMesh, paths: Vector3[][]): void => {
  // CreateGreasedLine with `instance` calls addPoints (append). setPoints replaces geometry.
  helper.setPoints(paths);
};

export type SelectionBoxHelper = GreasedLineMesh;

const applyLineColor = (helper: GreasedLineMesh, colorHex: string): void => {
  const material = helper.material;
  if (material instanceof GreasedLineSimpleMaterial) {
    material.setColor(hexStringToColor3(colorHex));
  }
};

export const createSelectionBoxHelper = (
  object: TransformNode,
  colorHex: string,
  id?: string,
): GreasedLineMesh => {
  const scene = object.getScene();
  if (!scene) {
    throw new Error("Selection box helper requires target in a scene");
  }

  const bounds = getWorldBounds(object);
  const edgePaths = createEdgePaths();
  writeBoundsToEdgePaths(bounds, edgePaths);

  const helper = CreateGreasedLine(
    id ? `${BOX_NAME}-${id}` : BOX_NAME,
    { points: edgePaths, updatable: true },
    buildMaterialOptions(colorHex),
    scene,
  ) as GreasedLineMesh;

  helper.isPickable = false;
  setNodeMetadata(helper, BOUNDS_TARGET_KEY, object);
  setNodeMetadata(helper, EDGE_PATHS_KEY, edgePaths);
  setNodeMetadata(helper, BOUNDS_CACHE_KEY, {
    min: { ...bounds.min },
    max: { ...bounds.max },
  } satisfies WorldBounds);
  return helper;
};

export const updateSelectionBoxHelper = (helper: GreasedLineMesh): void => {
  const target = getNodeMetadata(helper, BOUNDS_TARGET_KEY) as TransformNode | undefined;
  if (!target) {
    return;
  }

  const bounds = getWorldBounds(target);
  const cached = getNodeMetadata(helper, BOUNDS_CACHE_KEY) as WorldBounds | undefined;
  if (cached && !boundsChanged(bounds, cached)) {
    return;
  }

  const paths = getEdgePaths(helper);
  writeBoundsToEdgePaths(bounds, paths);
  refreshGreasedLine(helper, paths);
  setNodeMetadata(helper, BOUNDS_CACHE_KEY, {
    min: { ...bounds.min },
    max: { ...bounds.max },
  } satisfies WorldBounds);
};

export const setBoxHelperColor = (helper: GreasedLineMesh, colorHex: string): void => {
  applyLineColor(helper, colorHex);
};

export const disposeSelectionBoxHelper = (helper: GreasedLineMesh): void => {
  helper.dispose(false, true);
};
