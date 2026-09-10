import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { setNodeMetadata } from "../babylon/utils";
import { createUnlitHexMaterial } from "../materials/pbr-material";

/** 主题 primary — 与 theme.css `--primary` 一致 */
const MARKER_COLOR = 0x4cd6fb;

/**
 * 在 body 局部空间布局朝向条（marker 应为 body 子节点，或与 body 同父且 body 局部原点对齐）。
 * 禁止使用世界包围盒：物体不在原点时会把世界坐标误写进本地 position。
 */
const layoutFrontOrientationMarker = (body: Mesh, marker: Mesh): void => {
  body.refreshBoundingInfo(true);
  const { minimum, maximum } = body.getBoundingInfo().boundingBox;
  const sizeX = maximum.x - minimum.x;
  const sizeY = maximum.y - minimum.y;
  const sizeZ = maximum.z - minimum.z;
  const centerX = (minimum.x + maximum.x) / 2;
  const centerY = (minimum.y + maximum.y) / 2;

  const width = 0.06;
  const height = sizeY;
  const depth = Math.max(0.04, Math.min(sizeX, sizeY, sizeZ) * 0.12);

  marker.position.set(centerX, centerY, maximum.z + depth / 2);
  marker.scaling.set(width, height, depth);
};

export const createFrontOrientationMarker = (body: Mesh): Mesh => {
  const scene = body.getScene();
  if (!scene) {
    throw new Error("Front orientation marker requires body mesh in a scene");
  }

  const marker = MeshBuilder.CreateBox(
    "viz3d-front-marker",
    { width: 1, height: 1, depth: 1 },
    scene,
  );
  const material = createUnlitHexMaterial(scene, "viz3d-front-marker-mat", MARKER_COLOR);
  marker.material = material;
  marker.receiveShadows = false;

  layoutFrontOrientationMarker(body, marker);
  setNodeMetadata(marker, "viz3dFrontMarker", true);
  return marker;
};

export const syncFrontOrientationMarker = (body: Mesh, marker: Mesh): void => {
  layoutFrontOrientationMarker(body, marker);
};
