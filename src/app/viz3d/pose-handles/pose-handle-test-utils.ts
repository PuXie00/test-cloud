import type { ControlType } from "@/app/project/configuration-types";
import type { SceneObjectConfig, Vec3, VirtualAxisKinematics } from "../types";
import type { CellProjector } from "./pose-handle-layout";
import { addVec, crossVec, dotVec, normalizeVec, scaleVec, type Pt, type Ray } from "./pose-handle-math";

/** 测试用正交相机：forward 看向，scale 像素 / 米，原点投到 origin */
export const orthoCamera = (
  forward: Vec3,
  upHint: Vec3,
  scale = 100,
  origin: Pt = { x: 400, y: 300 },
): { projector: CellProjector; rayAt: (point: Pt) => Ray } => {
  const f = normalizeVec(forward)!;
  const camUp = normalizeVec(addVec(upHint, scaleVec(f, -dotVec(upHint, f))))!;
  const right = crossVec(f, camUp);
  return {
    projector: {
      project: (point) => ({
        x: origin.x + dotVec(point, right) * scale,
        y: origin.y - dotVec(point, camUp) * scale,
      }),
      pixelsPerMeter: () => scale,
      viewDirection: () => f,
    },
    rayAt: (point) => ({
      origin: addVec(
        addVec(scaleVec(right, (point.x - origin.x) / scale), scaleVec(camUp, -(point.y - origin.y) / scale)),
        scaleVec(f, -1000),
      ),
      direction: f,
    }),
  };
};

export const FRONT_VIEW = () => orthoCamera({ x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 });
export const TOP_VIEW = () => orthoCamera({ x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: -1 });

export const testKinematics = (overrides: Partial<VirtualAxisKinematics> = {}): VirtualAxisKinematics => ({
  controlType: "singlePointMove",
  runDirection: 1,
  pulleyDistance: 100,
  maxHeight: 3000,
  betaInit: 0,
  ...overrides,
});

export const testObject = (
  controlType: ControlType,
  overrides: Partial<VirtualAxisKinematics> = {},
  config: Partial<SceneObjectConfig> = {},
): SceneObjectConfig => ({
  id: "co-1",
  shape: "cube",
  dimensions: { w: 2, h: 0.4, d: 1 },
  position: { x: 0, y: 3, z: 0 },
  centerOffset: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  color: "#869398",
  hoistAxes: [
    { key: "0", motorId: null, mount: { x: -0.8, z: -0.4 }, index: 0, motorDisplayIndex: null },
    { key: "1", motorId: null, mount: { x: 0.8, z: -0.4 }, index: 1, motorDisplayIndex: null },
    { key: "2", motorId: null, mount: { x: 0.8, z: 0.4 }, index: 2, motorDisplayIndex: null },
    { key: "3", motorId: null, mount: { x: -0.8, z: 0.4 }, index: 3, motorDisplayIndex: null },
  ],
  kinematics: testKinematics({ controlType, ...overrides }),
  ...config,
});
