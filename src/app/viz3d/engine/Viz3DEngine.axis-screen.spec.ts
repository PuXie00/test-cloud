import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Emitter } from "../events";
import { DEFAULT_AXIS_SCREEN_DIRECTIONS } from "../tools/axis-screen-direction";
import { Viz3DEngine } from "./Viz3DEngine";

describe("Viz3DEngine 坐标轴屏幕朝向", () => {
  let babylon: NullEngine;
  let scene: Scene;
  let camera: ArcRotateCamera;
  let engine: Viz3DEngine;

  const sync = () => (engine as unknown as { syncAxisScreenDirections: () => void }).syncAxisScreenDirections();

  beforeEach(() => {
    babylon = new NullEngine();
    scene = new Scene(babylon);
    camera = new ArcRotateCamera("main", -Math.PI / 4, Math.PI / 3, 14, Vector3.Zero(), scene);
    const blank = Object.create(Viz3DEngine.prototype) as Viz3DEngine;
    engine = Object.assign(blank, {
      events: new Emitter(),
      axisScreenDirections: DEFAULT_AXIS_SCREEN_DIRECTIONS,
      viewportManager: { getPrimaryCamera: () => camera },
    });
  });

  afterEach(() => {
    scene.dispose();
    babylon.dispose();
  });

  it("视角没跨过 45° 档位时不通知", () => {
    const listener = vi.fn();
    engine.events.on("axisScreenChange", listener);

    sync();
    camera.alpha += 0.05;
    sync();

    expect(listener).not.toHaveBeenCalled();
    expect(engine.getAxisScreenDirections()).toEqual(DEFAULT_AXIS_SCREEN_DIRECTIONS);
  });

  it("转到另一侧时通知一次新的朝向", () => {
    const listener = vi.fn();
    engine.events.on("axisScreenChange", listener);

    camera.alpha = Math.PI / 2;
    camera.beta = Math.PI / 2;
    sync();
    sync();

    expect(listener).toHaveBeenCalledTimes(1);
    // 相机在 +Z 一侧平视原点，和前视图一样：+X 朝左，+Z 朝镜头
    expect(listener).toHaveBeenCalledWith({ x: 180, z: 225 });
    expect(engine.getAxisScreenDirections()).toEqual({ x: 180, z: 225 });
  });
});
