import { Ray } from "@babylonjs/core/Culling/ray";
import { Plane } from "@babylonjs/core/Maths/math.plane";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { Vec3 } from "../types";

// Side-effect import: registers scene.createPickingRay / scene.pick on Scene.prototype
void Ray;

const GROUND_PLANE = Plane.FromPositionAndNormal(Vector3.Zero(), Vector3.Up());

/**
 * Cast a ray from canvas-relative CSS pixel coordinates (offsetX / offsetY)
 * and return where it intersects the Y=0 ground plane.
 *
 * scene.createPickingRay expects CSS pixel coordinates and handles DPR
 * scaling internally via engine.getHardwareScalingLevel().
 */
export const raycastGroundPlane = (
  canvasX: number,
  canvasY: number,
  camera: Camera,
): Vec3 | null => {
  const scene = camera.getScene();
  if (!scene) {
    return null;
  }

  const ray = scene.createPickingRay(canvasX, canvasY, null, camera);
  const distance = ray.intersectsPlane(GROUND_PLANE);
  if (distance === null) {
    return null;
  }

  const hit = ray.origin.add(ray.direction.scale(distance));
  return { x: hit.x, y: hit.y, z: hit.z };
};
