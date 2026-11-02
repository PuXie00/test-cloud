import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Viz3DEngine } from "./Viz3DEngine";

const HALF = 1;

type TestHandle = {
  id: string;
  object3d: TransformNode;
  parentId?: string;
  getConfig: () => { status: string };
  getTransform: () => { position: Vector3; rotation: Vector3; scale: Vector3 };
  getWorldBounds: () => { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
};

describe("Viz3DEngine 对齐与均布", () => {
  let babylon: NullEngine;
  let scene: Scene;
  let handles: Map<string, TestHandle>;
  let engine: Viz3DEngine;

  const addObject = (id: string, x: number, parentId?: string): TransformNode => {
    const node = new TransformNode(id, scene);
    if (parentId) node.parent = handles.get(parentId)!.object3d;
    node.position = new Vector3(x, 0, 0);
    handles.set(id, {
      id,
      object3d: node,
      parentId,
      getConfig: () => ({ status: "active" }),
      getTransform: () => ({ position: node.position, rotation: node.rotation, scale: node.scaling }),
      getWorldBounds: () => {
        node.computeWorldMatrix(true);
        const world = node.getAbsolutePosition();
        return {
          min: { x: world.x - HALF, y: world.y - HALF, z: world.z - HALF },
          max: { x: world.x + HALF, y: world.y + HALF, z: world.z + HALF },
        };
      },
    });
    return node;
  };

  const worldX = (id: string) => {
    const node = handles.get(id)!.object3d;
    node.computeWorldMatrix(true);
    return node.getAbsolutePosition().x;
  };

  beforeEach(() => {
    babylon = new NullEngine();
    scene = new Scene(babylon);
    handles = new Map();
    engine = Object.assign(Object.create(Viz3DEngine.prototype) as Viz3DEngine, {
      boundingBoxes: new Map(),
      objectRegistry: {
        get: (id: string) => handles.get(id),
        getMountParent: (id: string) => {
          const parentId = handles.get(id)?.parentId;
          return parentId ? handles.get(parentId) : undefined;
        },
      },
    });
  });

  afterEach(() => {
    scene.dispose();
    babylon.dispose();
  });

  it("均布移动中间的物体，只返回移动过的", () => {
    addObject("a", 0);
    addObject("b", 3);
    addObject("c", 10);

    const payloads = engine.distribute(["a", "b", "c"], "x");

    expect(worldX("a")).toBeCloseTo(0);
    expect(worldX("b")).toBeCloseTo(5);
    expect(worldX("c")).toBeCloseTo(10);
    expect(payloads.map((payload) => payload.id)).toEqual(["b"]);
  });

  it("已经均布时不返回任何物体", () => {
    addObject("a", 0);
    addObject("b", 5);
    addObject("c", 10);

    expect(engine.distribute(["a", "b", "c"], "x")).toEqual([]);
  });

  it("全部重合时不返回任何物体", () => {
    addObject("a", 2);
    addObject("b", 2);
    addObject("c", 2);

    expect(engine.distribute(["a", "b", "c"], "x")).toEqual([]);
  });

  it("对齐移动全部物体到选中整体的中心", () => {
    addObject("a", 0);
    addObject("b", 10);

    const payloads = engine.align(["a", "b"], "x", "center");

    expect(worldX("a")).toBeCloseTo(5);
    expect(worldX("b")).toBeCloseTo(5);
    expect(payloads).toHaveLength(2);
  });

  it("父子物体一起选中时，子物体先于父物体传入也落在目标世界位置", () => {
    addObject("parent", 0);
    addObject("child", 2, "parent");
    addObject("other", 10);

    const payloads = engine.align(["child", "parent", "other"], "x", "center");

    expect(worldX("parent")).toBeCloseTo(5);
    expect(worldX("child")).toBeCloseTo(5);
    expect(worldX("other")).toBeCloseTo(5);
    // 子物体写回相对父物体的局部坐标
    const child = payloads.find((payload) => payload.id === "child")!;
    expect(child.position.x).toBeCloseTo(0);
  });

  it("目标世界位置没变、但父物体动了的子物体也要写回新的局部坐标", () => {
    addObject("a", 0);
    addObject("parent", 2);
    addObject("child", 20 / 3 - 2, "parent");
    addObject("z", 10);

    // 均布目标 0、10/3、20/3、10：子物体本来就在 20/3，父物体要从 2 移到 10/3
    const payloads = engine.distribute(["a", "parent", "child", "z"], "x");

    expect(worldX("parent")).toBeCloseTo(10 / 3);
    expect(worldX("child")).toBeCloseTo(20 / 3);
    const child = payloads.find((payload) => payload.id === "child")!;
    expect(child.position.x).toBeCloseTo(10 / 3);
  });
});
