// @vitest-environment node
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { describe, expect, it } from "vitest";
import type { CollisionObject } from "./types";
import { prepareCollisionShape, shapeDistance, shapeRadius } from "./geometry";

const object = (shape: CollisionObject["config"]["shape"] = "cube", size = 1): CollisionObject => ({
  id: 1, name: "道具", basePose: {},
  config: {
    id: "1", name: "道具", shape, dimensions: { w: size, h: size, d: size },
    holeDimensions: { w: 2, d: 2 }, position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 }, centerOffset: { x: 0, y: 0, z: 0 }, color: "#fff",
  },
});
const frame = Matrix.Identity();
const preset = async (shape: CollisionObject["config"]["shape"], size: number) =>
  (await prepareCollisionShape(object(shape, size)))!;

describe("模型实体碰撞", () => {
  it("区分分离、接触、完全包含，返回米", async () => {
    const box = await preset("cube", 2);
    const small = await preset("cube", 0.2);
    expect(shapeDistance(box, frame, box, Matrix.Translation(2.25, 0, 0))).toBeCloseTo(0.25);
    expect(shapeDistance(box, frame, box, Matrix.Translation(2, 0, 0))).toBe(0);
    expect(shapeDistance(box, Matrix.RotationY(0.4), small, frame)).toBe(0);
    expect(shapeRadius(box)).toBeCloseTo(Math.sqrt(3));
  });

  it.each(["ring", "sqRing"] as const)("保留 %s 孔洞，只撞实体边", async (kind) => {
    const ring = await preset(kind, 4);
    const small = await preset("cube", 0.2);
    expect(shapeDistance(ring, frame, small, frame)).toBeGreaterThan(0.8);
    expect(shapeDistance(ring, frame, small, Matrix.Translation(1.5, 0, 0))).toBe(0);
  });

  it("导入所有 OBJ 子网格并按模型宽度等比缩放，开面也能确认实交", async () => {
    const asset = { format: "obj" as const, bytes: new TextEncoder().encode([
      "o left", "v 0 0 0", "v 0 1000 0", "v 0 0 1000", "f 1 2 3",
      "o right", "v 2000 0 0", "v 2000 1000 0", "v 2000 0 1000", "f 4 5 6",
    ].join("\n")) };
    const model = (await prepareCollisionShape({ ...object("cube", 4), modelKey: "frames.obj" }, asset))!;
    const small = await preset("cube", 0.2);
    expect(shapeRadius(model)).toBeCloseTo(Math.sqrt(6));
    for (const x of [-2, 2]) expect(shapeDistance(model, frame, small, Matrix.Translation(x, 0, 0))).toBe(0);
  });

  it.each(["model.glb", "xiaolu.glb"])("在没有 DOM 的线程载入真实工程 GLB %s", async (name) => {
    const path = join(process.cwd(), "Project/2025广州演唱会/Models", name);
    const asset = { format: "glb" as const, bytes: await readFile(path) };
    const model = (await prepareCollisionShape({ ...object(), modelKey: name }, asset))!;
    expect(model).toBeDefined();
    expect(shapeRadius(model)).toBeGreaterThanOrEqual(0.49);
    const enclosure = await preset("cube", shapeRadius(model) * 3);
    expect(shapeDistance(model, frame, enclosure, frame)).toBe(0);
  });

  it("未封闭的箱体不报告确定包含", async () => {
    const asset = { format: "obj" as const, bytes: new TextEncoder().encode([
      "o open", "v -1 -1 -1", "v -1 -1 1", "v 1 -1 1", "v 1 -1 -1",
      "v -1 1 -1", "v -1 1 1", "v 1 1 1", "v 1 1 -1",
      "f 1 2 3 4", "f 1 5 6 2", "f 2 6 7 3", "f 3 7 8 4", "f 4 8 5 1",
    ].join("\n")) };
    const model = (await prepareCollisionShape({ ...object("cube", 2), modelKey: "open" }, asset))!;
    const small = await preset("cube", 0.1);
    expect(shapeDistance(model, frame, small, frame)).toBeNaN();
    expect(shapeDistance(model, frame, small, Matrix.Translation(2, 0, 0))).toBeGreaterThan(0);
  });

  it("外模丢失或损坏时标记几何不可用", async () => {
    const external = { ...object(), modelKey: "broken.glb" };
    expect(await prepareCollisionShape(external)).toBeUndefined();
    expect(await prepareCollisionShape(external, { format: "glb", bytes: new Uint8Array(4) })).toBeUndefined();
  });
});
