import { describe, expect, it } from "vitest";
import {
  canMountTo,
  mountAncestorIds,
  mountDescendantIds,
  objectWorldPose,
  orderByMountTree,
  remountPose,
  topmostMountIds,
  type MountNode,
} from "./object-mount";

const node = (
  id: number,
  parentId: number | null,
  position = { x: 0, y: 0, z: 0 },
  rotation = { x: 0, y: 0, z: 0 },
): MountNode => ({ id, parentId, position, rotation });

describe("object mount tree", () => {
  const objects = [node(1, null), node(2, 1), node(3, 2), node(4, null)];

  it("walks ancestors nearest first", () => {
    expect(mountAncestorIds(objects, 3)).toEqual([2, 1]);
    expect(mountAncestorIds(objects, 4)).toEqual([]);
  });

  it("stops on cycles and missing parents", () => {
    expect(mountAncestorIds([node(1, 2), node(2, 1)], 1)).toEqual([2]);
    expect(mountAncestorIds([node(1, 99)], 1)).toEqual([]);
  });

  it("collects descendants and keeps only topmost selections", () => {
    expect([...mountDescendantIds(objects, [1])].sort()).toEqual([2, 3]);
    expect(topmostMountIds(objects, [3, 1, 4])).toEqual([1, 4]);
  });

  it("refuses self and descendant parents", () => {
    expect(canMountTo(objects, 1, 1)).toBe(false);
    expect(canMountTo(objects, 1, 3)).toBe(false);
    expect(canMountTo(objects, 3, 4)).toBe(true);
    expect(canMountTo(objects, 3, 99)).toBe(false);
  });

  it("orders depth first with depths, falling back to roots for cycles", () => {
    expect(orderByMountTree([node(3, 2), node(4, null), node(2, 1), node(1, null)]).map(
      ({ object, depth }) => [object.id, depth],
    )).toEqual([[4, 0], [1, 0], [2, 1], [3, 2]]);
    expect(orderByMountTree([node(1, 2), node(2, 1)])).toHaveLength(2);
  });
});

describe("object mount poses", () => {
  it("composes parent translation and yaw into the child world pose", () => {
    const objects = [
      node(1, null, { x: 1000, y: 5000, z: 0 }, { x: 0, y: 90, z: 0 }),
      node(2, 1, { x: 500, y: -1000, z: 0 }),
    ];
    const world = objectWorldPose(objects, 2)!;
    // Babylon 左手系绕 Y 转 90°：局部 +X → 世界 −Z
    expect(world.position.x).toBeCloseTo(1000);
    expect(world.position.y).toBeCloseTo(4000);
    expect(world.position.z).toBeCloseTo(-500);
    expect(world.rotation.y).toBeCloseTo(90);
  });

  it("keeps the world pose when mounting and unmounting", () => {
    const objects = [
      node(1, null, { x: 1000, y: 5000, z: 200 }, { x: 0, y: 30, z: 0 }),
      node(2, null, { x: 1500, y: 3000, z: -400 }, { x: 0, y: 45, z: 0 }),
    ];
    const mounted = remountPose(objects, 2, 1)!;
    expect(mounted.parentId).toBe(1);
    expect(mounted.rotation.y).toBeCloseTo(15);

    const after = objects.map((object) => (object.id === 2 ? { ...object, ...mounted } : object));
    const world = objectWorldPose(after, 2)!;
    expect(world.position.x).toBeCloseTo(1500);
    expect(world.position.y).toBeCloseTo(3000);
    expect(world.position.z).toBeCloseTo(-400);
    expect(world.rotation.y).toBeCloseTo(45);

    const detached = remountPose(after, 2, null)!;
    expect(detached.parentId).toBeNull();
    expect(detached.position.x).toBeCloseTo(1500);
    expect(detached.position.z).toBeCloseTo(-400);
    expect(detached.rotation.y).toBeCloseTo(45);
  });

  it("chains through multiple mount levels", () => {
    const objects = [
      node(1, null, { x: 0, y: 6000, z: 0 }),
      node(2, 1, { x: 2000, y: 0, z: 0 }),
      node(3, 2, { x: 0, y: -1500, z: 300 }),
    ];
    expect(objectWorldPose(objects, 3)!.position).toEqual({ x: 2000, y: 4500, z: 300 });
  });
});
