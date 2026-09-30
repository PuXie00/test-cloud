import { MOTION_DEFAULTS } from "@/app/project/configuration-rules";
import type { ControlledObjectConfig } from "@/app/project/project-document-types";
import type { ActionSequenceConfig, ModelPose } from "./types";

const baseObject = (overrides: Partial<ControlledObjectConfig>): ControlledObjectConfig => ({
  id: 1,
  name: "O",
  controlType: 2,
  enabledVirtualAxes: ["v1"],
  shapePreset: "cube",
  shapeDimensions: { width: 1000, height: 1000, depth: 1000 },
  dimensions: { w: 1000, h: 1000, d: 1000 },
  position: { x: 0, y: 0, z: 0 },
  centerOffset: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  color: "#869398",
  pulleyDistance: 0,
  modelRunDirection: 1,
  driveAxes: [{ key: "0", mount: { x: 0, z: 0 } }],
  maxAxisVelocity: 200,
  motionParams: { h: { ...MOTION_DEFAULTS.move, maxAngle: 8000 } },
  params: {},
  ...overrides,
});

export const singlePointFixture = (): ControlledObjectConfig =>
  baseObject({ id: 1, name: "单点", maxAxisVelocity: 400 });

export const twoPointFixture = (): ControlledObjectConfig =>
  baseObject({
    id: 2,
    name: "两点",
    controlType: 6,
    enabledVirtualAxes: ["v1", "v2"],
    pulleyDistance: 100,
    maxAxisVelocity: 500,
    driveAxes: [
      { key: "0", mount: { x: -1000, z: 0 } },
      { key: "1", mount: { x: 1000, z: 0 } },
    ],
    motionParams: {
      h: { ...MOTION_DEFAULTS.move, maxAngle: 8000 },
      p: { ...MOTION_DEFAULTS.swingX },
    },
  });

export const fourPointFixture = (): ControlledObjectConfig =>
  baseObject({
    id: 3,
    name: "四点",
    controlType: 9,
    enabledVirtualAxes: ["v1", "v2", "v3"],
    pulleyDistance: 100,
    maxAxisVelocity: 500,
    driveAxes: [
      { key: "0", mount: { x: -1000, z: -900 } },
      { key: "1", mount: { x: 1000, z: -900 } },
      { key: "2", mount: { x: 1000, z: 900 } },
      { key: "3", mount: { x: -1000, z: 900 } },
    ],
    motionParams: {
      h: { ...MOTION_DEFAULTS.move, maxAngle: 8000 },
      p: { ...MOTION_DEFAULTS.swingX },
      y: { ...MOTION_DEFAULTS.swingY },
    },
  });

const ring = (radius: number, count: number) =>
  Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2;
    return {
      key: String(index),
      mount: { x: Math.round(radius * Math.cos(angle) * 100) / 100, z: Math.round(radius * Math.sin(angle) * 100) / 100 },
    };
  });

export const multiPointFixture = (): ControlledObjectConfig =>
  baseObject({
    id: 4,
    name: "多点",
    controlType: 7,
    enabledVirtualAxes: ["v1", "v2", "v3"],
    pulleyDistance: 100,
    maxAxisVelocity: 500,
    driveAxes: ring(2000, 8),
    motionParams: {
      h: { ...MOTION_DEFAULTS.move, maxAngle: 8000 },
      p: { ...MOTION_DEFAULTS.swingX },
      y: { ...MOTION_DEFAULTS.yawY },
    },
  });

export const fixtureObjects = (): ControlledObjectConfig[] => [
  singlePointFixture(),
  twoPointFixture(),
  fourPointFixture(),
  multiPointFixture(),
];

const pose = (v1: number, v2 = 0, v3 = 0): ModelPose => ({ v1, v2, v3 });

const posesFor: Record<number, Array<[number, ModelPose]>> = {
  1: [[0, pose(0)], [4000, pose(500)], [7500, pose(1000)], [12000, pose(500)]],
  2: [[0, pose(1000)], [6000, pose(1800, 10)], [11000, pose(2200, -5)]],
  3: [[0, pose(1000)], [6000, pose(1800, 8)], [11500, pose(2200, 8)], [16000, pose(1600)]],
  4: [[0, pose(1000)], [7000, pose(1800, 6, -10)], [15000, pose(2300, -8, 15)]],
};

export const fixtureSequence = (trajectoryMode: boolean, loop = false): ActionSequenceConfig => ({
  id: 99,
  name: "接入",
  trajectoryMode,
  ...(loop ? { loop: true } : {}),
  blocks: Object.entries(posesFor).flatMap(([objectId, entries]) =>
    entries.map(([atMs, value], index) => ({
      id: `p${objectId}-${index}`,
      kind: "pose" as const,
      objectId: Number(objectId),
      atMs,
      pose: value,
    })),
  ),
  segments: [],
});

export const fixtureCurrent: Record<number, ModelPose> = {
  1: pose(120),
  2: pose(1100, 2),
  3: pose(1050, 1),
  4: pose(1080, 1, -1),
};
