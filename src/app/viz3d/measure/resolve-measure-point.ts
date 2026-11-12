import type { Camera } from "@babylonjs/core/Cameras/camera";
import { Ray } from "@babylonjs/core/Culling/ray";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Plane } from "@babylonjs/core/Maths/math.plane";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Node } from "@babylonjs/core/node";
import { getNodeMetadata, getWorldPosition } from "../babylon/utils";
import type { SlotRect, Vec3 } from "../types";
import { projectWorldToCell } from "../viewports/project-to-cell";
import type { MeasurePoint } from "./MeasureTool";
import { nearestScreenCandidate, type ScreenPoint } from "./measure-rulers";

// 注册 scene.createPickingRay / pickWithRay
void Ray;

export type MeasurePickContext = {
  camera: Camera;
  /** 这一格在画布里的矩形（CSS px） */
  cellRect: SlotRect;
  /** 可测量的物体根节点 */
  targets: readonly TransformNode[];
  /** 可见吊点中心 */
  hoistAnchors: readonly Vec3[];
};

export const MEASURE_SNAP_RADIUS_PX = {
  hoist: { fine: 14, coarse: 28 },
  vertex: { fine: 18, coarse: 32 },
} as const;

/** 顶点不多的网格全部参与顶点吸附，再多就只看点中的那个三角形 */
const MAX_SNAP_VERTICES = 4096;

/** 射线几乎贴着地面时改用视图平面，免得点跑到很远处 */
const MIN_GROUND_RAY_SLOPE = 0.02;

const GROUND_PLANE = Plane.FromPositionAndNormal(Vector3.Zero(), Vector3.Up());

const isDescendantOf = (mesh: AbstractMesh, targets: ReadonlySet<Node>): boolean => {
  let current: Node | null = mesh;
  while (current) {
    if (targets.has(current)) return true;
    current = current.parent;
  }
  return false;
};

/** 点中的网格属于某个吊点时返回吊点根节点 */
const findHoistRoot = (mesh: AbstractMesh): TransformNode | null => {
  let current: Node | null = mesh;
  while (current) {
    if (current instanceof TransformNode && typeof getNodeMetadata(current, "viz3dAxisKey") === "string") {
      return current;
    }
    current = current.parent;
  }
  return null;
};

const toVec3 = (vector: Vector3): Vec3 => ({ x: vector.x, y: vector.y, z: vector.z });

/** 点中网格的候选顶点（世界坐标） */
const meshSnapVertices = (mesh: AbstractMesh, faceId: number): Vec3[] => {
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
  if (!positions || positions.length < 3) return [];
  const world = mesh.getWorldMatrix();
  const scratch = new Vector3();
  const toWorld = (index: number): Vec3 => {
    Vector3.TransformCoordinatesFromFloatsToRef(
      positions[index * 3]!,
      positions[index * 3 + 1]!,
      positions[index * 3 + 2]!,
      world,
      scratch,
    );
    return toVec3(scratch);
  };
  const count = positions.length / 3;
  if (count <= MAX_SNAP_VERTICES) {
    return Array.from({ length: count }, (_, index) => toWorld(index));
  }
  const indices = mesh.getIndices();
  if (!indices || faceId < 0 || faceId * 3 + 2 >= indices.length) return [];
  return [0, 1, 2].map((corner) => toWorld(indices[faceId * 3 + corner]!));
};

const projectCandidates = (points: readonly Vec3[], camera: Camera, cellRect: SlotRect) =>
  points.flatMap((world) => {
    const screen = projectWorldToCell(world, camera, cellRect);
    return screen.inFront ? [{ world, screen: { x: screen.x, y: screen.y } }] : [];
  });

/**
 * 画布上一点在这一格里落到哪：吊点中心（自动吸附） > 顶点（吸附开关 / Ctrl） > 物体表面 > 地面 > 过相机目标点的视图平面。
 * 吊点被更近的表面挡住时不吸。
 */
export const resolveMeasurePoint = (
  x: number,
  y: number,
  context: MeasurePickContext,
  options: { snapVertices: boolean; coarse: boolean },
): MeasurePoint | null => {
  const { camera, cellRect } = context;
  const scene = camera.getScene();
  const ray = scene.createPickingRay(x, y, null, camera);
  const targets = new Set<Node>(context.targets);
  const pick = scene.pickWithRay(
    ray,
    (mesh) => mesh.isEnabled() && mesh.isVisible && mesh.isPickable && isDescendantOf(mesh, targets),
    false,
  );
  const hit = pick?.hit && pick.pickedMesh && pick.pickedPoint ? pick : null;
  const cursor: ScreenPoint = { x, y };
  const size = options.coarse ? "coarse" : "fine";
  const depthAlongRay = (point: Vec3) =>
    (point.x - ray.origin.x) * ray.direction.x +
    (point.y - ray.origin.y) * ray.direction.y +
    (point.z - ray.origin.z) * ray.direction.z;

  const hoistRoot = hit ? findHoistRoot(hit.pickedMesh!) : null;
  if (hoistRoot) return { point: getWorldPosition(hoistRoot), snap: "hoist" };

  const hitDepth = hit ? Vector3.Distance(ray.origin, hit.pickedPoint!) : Number.POSITIVE_INFINITY;
  const unoccluded = context.hoistAnchors.filter(
    (anchor) => depthAlongRay(anchor) <= hitDepth + Math.max(0.05, hitDepth * 0.02),
  );
  const hoist = nearestScreenCandidate(
    cursor,
    projectCandidates(unoccluded, camera, cellRect),
    MEASURE_SNAP_RADIUS_PX.hoist[size],
  );
  if (hoist) return { point: hoist.world, snap: "hoist" };

  if (hit) {
    if (options.snapVertices) {
      const vertex = nearestScreenCandidate(
        cursor,
        projectCandidates(meshSnapVertices(hit.pickedMesh!, hit.faceId), camera, cellRect),
        MEASURE_SNAP_RADIUS_PX.vertex[size],
      );
      if (vertex) return { point: vertex.world, snap: "vertex" };
    }
    return { point: toVec3(hit.pickedPoint!), snap: "surface" };
  }

  if (Math.abs(ray.direction.y) >= MIN_GROUND_RAY_SLOPE) {
    const distance = ray.intersectsPlane(GROUND_PLANE);
    if (distance !== null && distance > 0 && distance <= camera.maxZ) {
      return { point: toVec3(ray.origin.add(ray.direction.scale(distance))), snap: "ground" };
    }
  }

  // 各格都是 ArcRotateCamera：视图平面过它的目标点
  const target = (camera as { target?: Vector3 }).target;
  if (!target) return null;
  const forward = target.subtract(camera.globalPosition).normalize();
  const distance = ray.intersectsPlane(Plane.FromPositionAndNormal(target, forward));
  if (distance === null) return null;
  return { point: toVec3(ray.origin.add(ray.direction.scale(distance))), snap: "view" };
};
