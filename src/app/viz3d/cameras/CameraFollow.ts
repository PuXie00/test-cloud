import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import type { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import type { Vec3 } from "../types";
import type { OrbitControlsAdapter } from "./OrbitControlsAdapter";

export type FollowOffset = { x: number; y: number; z: number };

export const computeFollowOffset = (cameraPos: Vec3, target: Vec3): FollowOffset => ({
  x: cameraPos.x - target.x,
  y: cameraPos.y - target.y,
  z: cameraPos.z - target.z,
});

export const applyCameraFollow = (
  camera: FreeCamera | ArcRotateCamera,
  controls: OrbitControlsAdapter,
  target: Vec3,
): void => {
  const currentTarget = controls.getTarget();
  const offset = computeFollowOffset(
    { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    currentTarget,
  );

  controls.setTarget(target);
  camera.position.set(target.x + offset.x, target.y + offset.y, target.z + offset.z);
  controls.update();
};
