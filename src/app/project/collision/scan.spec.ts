import { describe, expect, it, vi } from "vitest";
import type { Matrix } from "@babylonjs/core/Maths/math.vector";
import type { ActionSequenceConfig } from "../action-sequence/types";
import type { CollisionObject } from "./types";
import type { CollisionShape } from "./geometry";
import { CollisionScanCache, scanCollisionSteps, scanCollisions } from "./scan";

// 精确球体距离，把时序、运动学和缓存测试与三角网格实现分开。
const { distance } = vi.hoisted(() => ({
  distance: vi.fn((a: { radius: number }, ma: Matrix, b: { radius: number }, mb: Matrix) => {
    const offset = ma.getTranslation().subtract(mb.getTranslation());
    return Math.max(0, offset.length() - a.radius - b.radius);
  }),
}));
vi.mock("./geometry", () => ({
  shapeRadius: (shape: { radius: number }) => shape.radius,
  shapeDistanceSteps: function* (...args: Parameters<typeof distance>) { return distance(...args); },
}));

const object = (id: number, x = 0, y = 0, z = 0): CollisionObject => ({
  id, name: `物体${id}`, basePose: {},
  config: {
    id: String(id), shape: "sphere", dimensions: { w: 0.02, h: 0.02, d: 0.02 },
    position: { x, y, z }, centerOffset: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 },
    color: "#fff",
  },
});
const moving = (id: number, type: "singlePointMove" | "singlePointRotation", y = 0) => {
  const obj = object(id, 0, y);
  obj.config.kinematics = { controlType: type, runDirection: 1, pulleyDistance: 0, maxHeight: 0, betaInit: 0 };
  return obj;
};
const sequence = (...frames: [number, number, number][]): ActionSequenceConfig => ({
  id: 1, name: "扫描", trajectoryMode: true, segments: [],
  blocks: frames.map(([objectId, atMs, v1], index) => ({
    kind: "pose", id: String(index), objectId, atMs, pose: { v1 },
  })),
});
const shapesOf = (objects: CollisionObject[]) =>
  new Map(objects.map(({ id }) => [id, { radius: 0.01 } as unknown as CollisionShape]));

describe("动作序列模型碰撞扫描", () => {
  it("检查两端分离、在两个 100 ms 预览采样点间穿过的薄物体", () => {
    const objects = [moving(1, "singlePointMove", 1), object(2, 0, 0.43)];
    const report = scanCollisions({ objects, sequence: sequence([1, 0, 0], [1, 100, 2000]) }, shapesOf(objects));
    expect(report.incomplete).toEqual([]);
    const hit = report.events.find(e => e.kind === "collision");
    expect(hit?.objectIds).toEqual([1, 2]);
    expect(hit!.startMs).toBeGreaterThan(0);
    expect(hit!.endMs).toBeLessThan(50);
  });

  it("父物体旋转一整圈时检查偏心挂载子物体经过的障碍", () => {
    const lamp = object(2, 1);
    lamp.config.parentId = "1";
    const objects = [moving(1, "singlePointRotation"), lamp, object(3, 0, 0, -1)];
    const report = scanCollisions({ objects, sequence: sequence([1, 0, 0], [1, 1000, 360]) }, shapesOf(objects));
    expect(report.events.some(e => e.kind === "collision" && String(e.objectIds) === "2,3")).toBe(true);
  });

  it("单帧也检查静止接触；未入轨且缺失基准的运动物体单列为未覆盖", () => {
    const objects = [moving(1, "singlePointMove"), object(2), moving(3, "singlePointMove")];
    const report = scanCollisions({ objects, sequence: sequence([1, 0, 0]) }, shapesOf(objects));
    expect(report.events).toEqual([{ objectIds: [1, 2], startMs: 0, endMs: 0, kind: "collision" }]);
    expect(report.incomplete.join(" ")).toContain("物体3");
  });

  it("直接挂载也会检测子件相对父件的运动", () => {
    const child = moving(2, "singlePointMove", 2);
    child.config.parentId = "1";
    const objects = [object(1), child];
    const input = { objects, sequence: sequence([2, 0, 0], [2, 100, 4000]) };
    expect(scanCollisions(input, shapesOf(objects)).events.some(e =>
      e.kind === "collision" && String(e.objectIds) === "1,2")).toBe(true);
  });

  it("间隔不足 1 ms 仍无法排除的擦过标记待复核", () => {
    const objects = [moving(1, "singlePointMove", 1), object(2, 0, 0.47)];
    const report = scanCollisions({ objects, sequence: sequence([1, 0, 0], [1, 1, 2000]) }, shapesOf(objects));
    expect(report.events).toEqual([{ objectIds: [1, 2], startMs: 0, endMs: 1, kind: "review" }]);
  });

  it("开放模型无法验证包含关系时标记待复核", () => {
    const objects = [moving(1, "singlePointMove"), object(2)];
    distance.mockReturnValueOnce(NaN);
    const report = scanCollisions({ objects, sequence: sequence([1, 0, 0]) }, shapesOf(objects));
    expect(report.events).toEqual([{ objectIds: [1, 2], startMs: 0, endMs: 0, kind: "review" }]);
  });

  it("逐步执行与同步扫描得到完全相同的事件和缺失项", () => {
    const objects = [moving(1, "singlePointMove", 1), object(2, 0, 0.43), moving(3, "singlePointMove")];
    const input = { objects, sequence: sequence([1, 0, 0], [1, 100, 2000]) };
    const shapes = shapesOf(objects);
    const expected = scanCollisions(input, shapes);
    const steps = scanCollisionSteps(input, shapes);
    let count = 0, result = steps.next();
    while (!result.done) { count++; result = steps.next(); }
    expect(count).toBeGreaterThan(10);
    expect(result.value).toEqual(expected);
  });

  it("同一对对象重复扫描命中缓存，改变基准姿态后重新计算", () => {
    const objects = [moving(1, "singlePointMove"), moving(2, "singlePointMove")];
    objects[1]!.basePose.v1 = 0;
    const input = { sequence: sequence([1, 0, 0]), objects };
    const shapes = shapesOf(objects);
    const cache = new CollisionScanCache();
    expect(scanCollisions(input, shapes, cache).events.length).toBe(1);
    distance.mockClear();
    expect(scanCollisions(input, shapes, cache).events.length).toBe(1);
    expect(distance).not.toHaveBeenCalled();
    objects[1]!.basePose.v1 = 500;
    expect(scanCollisions(input, shapes, cache).events).toEqual([]);
    cache.clear();
    objects[1]!.basePose.v1 = 0;
    expect(scanCollisions(input, shapes, cache).events.length).toBe(1);
    expect(distance).toHaveBeenCalled();
  });
});
