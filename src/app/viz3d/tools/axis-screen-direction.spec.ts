import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveViewPose } from "../cameras/ViewPresets";
import type { ViewPreset } from "../types";
import { computeAxisScreenDirections, DEFAULT_AXIS_SCREEN_DIRECTIONS } from "./axis-screen-direction";

describe("坐标轴在屏幕上的朝向", () => {
  let engine: NullEngine;
  let scene: Scene;

  beforeEach(() => {
    engine = new NullEngine();
    scene = new Scene(engine);
  });

  afterEach(() => {
    scene.dispose();
    engine.dispose();
  });

  // 和 ViewportManager 摆预设视角的方式一致
  const presetDirections = (preset: ViewPreset) => {
    const pose = resolveViewPose(preset);
    const camera = new FreeCamera(preset, new Vector3(pose.position.x, pose.position.y, pose.position.z), scene);
    camera.upVector.set(pose.up.x, pose.up.y, pose.up.z);
    camera.setTarget(new Vector3(pose.target.x, pose.target.y, pose.target.z));
    return computeAxisScreenDirections(camera.getViewMatrix(true));
  };

  it("前视图里 +X 朝屏幕左，+Z 朝镜头", () => {
    expect(presetDirections("front")).toEqual({ x: 180, z: 225 });
  });

  it("顶视图里 +X 朝左，+Z 朝下", () => {
    expect(presetDirections("top")).toEqual({ x: 180, z: 270 });
  });

  it("后视图里 +X 朝右，+Z 背离镜头", () => {
    expect(presetDirections("back")).toEqual({ x: 0, z: 45 });
  });

  it("右视图里 +X 朝镜头，+Z 朝右", () => {
    expect(presetDirections("side")).toEqual({ x: 225, z: 0 });
  });

  it("左视图里 +X 背离镜头，+Z 朝左", () => {
    expect(presetDirections("left")).toEqual({ x: 45, z: 180 });
  });

  it("工程默认透视里 +X 朝右下，+Z 朝右上，和默认值一致", () => {
    const camera = new ArcRotateCamera("saved", -Math.PI / 4, Math.PI / 3, 14, Vector3.Zero(), scene);
    expect(computeAxisScreenDirections(camera.getViewMatrix(true))).toEqual(DEFAULT_AXIS_SCREEN_DIRECTIONS);
  });
});
